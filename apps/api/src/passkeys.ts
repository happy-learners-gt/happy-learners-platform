import type { Member } from "@happy-learners/contracts";
import { deviceLabel, fromBase64Url, identifierInput, maxPasskeys, passkeyMessage, passkeyTimeoutMs, signedChallenge, toBase64Url, tokenPattern, tokenPrefix, verifyAssertion, verifyRegistration } from "@happy-learners/domain";
import type { Database } from "./storage";
import { digest, newToken, sessionToken } from "./auth";
import { clientOf, type Client } from "./account";
import { event } from "./activity";
import { securityEvent } from "./security-log";
import { requireConfirmation } from "./step-up";
import { finishSignIn } from "./sign-in";

/**
 * ST-132: passkeys. Each ceremony has a ticket (like a session token, it names its organization by its first letter)
 * whose UTF-8 bytes are the WebAuthn challenge, so the signed client data says which ceremony and which store it
 * belongs to. Only the SHA-256 of the ticket is kept; it works once, for 5 minutes. The relying party is this host.
 * Signing in with a passkey proves both factors (ST-133). Registration and removal are in the security log.
 */
const reply = (value: unknown, status = 200) => Response.json(value, { status });
export const passkeyPath = /^\/api\/me\/passkeys\/([A-Za-z0-9_-]{16,1400})$/;
export function passkeyMethods(path: string): string[] | null {
  if (path === "/api/me/passkeys") return ["GET", "POST"];
  if (path === "/api/me/passkeys/options") return ["POST"];
  if (passkeyPath.test(path)) return ["PUT", "DELETE"];
  return null;
}
export const passkeySignInPaths = ["/api/login/passkey/options", "/api/login/passkey"];
const expected = (request: Request, challenge: string) => { const url = new URL(request.url); return { challenge, origin: url.origin, rpId: url.hostname }; };
async function ticket(db: Database, scope: string, kind: "passkey-register" | "passkey-sign-in", userId: string | null) {
  const token = tokenPrefix(scope) + newToken(), now = Date.now();
  await db.batch([db.prepare("INSERT INTO auth_challenges(token_hash,kind,user_id,created_at,expires_at) VALUES (?,?,?,?,?)").bind(await digest(token), kind, userId, now, now + passkeyTimeoutMs)]);
  return token;
}
/** Uses the ticket the client data signed, once; returns whose ceremony it was (null user for a sign-in by name). */
async function consume(db: Database, token: string | null, kind: "passkey-register" | "passkey-sign-in") {
  if (!token || !tokenPattern.test(token)) return null;
  const hash = await digest(token), now = Date.now();
  const found = await db.prepare("SELECT user_id AS userId FROM auth_challenges WHERE token_hash=? AND kind=? AND used_at IS NULL AND expires_at>?").bind(hash, kind, now).first<{ userId: string | null }>();
  if (!found) return null;
  const used = await db.guardedBatch(db.prepare("SELECT 1 FROM auth_challenges WHERE token_hash=? AND used_at IS NULL").bind(hash), [db.prepare("UPDATE auth_challenges SET used_at=? WHERE token_hash=?").bind(now, hash)]);
  return used ? found : null;
}
type Stored = { id: string; name: string; createdAt: string; lastUsedAt: string | null; backedUp: number; transports: string | null };

/** /api/me/passkeys…: the person's own passkeys. */
export async function myPasskeys(path: string, method: string, input: unknown, current: Member, db: Database, request: Request): Promise<Response> {
  const value = input && typeof input === "object" ? input as Record<string, unknown> : null, client = clientOf(request), org = current.organizationId;
  const list = async () => (await db.prepare("SELECT id,name,created_at AS createdAt,last_used_at AS lastUsedAt,backed_up AS backedUp,transports FROM passkeys WHERE user_id=? ORDER BY created_at").bind(current.id).all<Stored>()).results;
  if (path === "/api/me/passkeys" && method === "GET") return reply({ passkeys: (await list()).map(({ backedUp, transports: _, ...row }) => ({ ...row, synced: !!backedUp })) });
  // Adding or removing a passkey happens within the confirmation window; renaming does not need it.
  if (!(passkeyPath.test(path) && method === "PUT")) {
    const confirmation = await requireConfirmation(db, current, sessionToken(request)!, value);
    if (confirmation) return confirmation;
  }
  if (path === "/api/me/passkeys/options") {
    const existing = await list();
    if (existing.length >= maxPasskeys) return reply({ error: `Ya tienes ${maxPasskeys} passkeys. Elimina una antes de agregar otra.` }, 409);
    const token = await ticket(db, org, "passkey-register", current.id), url = new URL(request.url);
    return reply({ publicKey: {
      challenge: toBase64Url(new TextEncoder().encode(token)), rp: { id: url.hostname, name: "Acervum" },
      // The user handle names the organization (its letter) so the passkey signs in without typing anything.
      user: { id: toBase64Url(new TextEncoder().encode(`${tokenPrefix(org)}${current.id}`)), name: current.username, displayName: current.displayName || current.username },
      pubKeyCredParams: [{ type: "public-key", alg: -7 }, { type: "public-key", alg: -257 }], timeout: passkeyTimeoutMs, attestation: "none",
      authenticatorSelection: { residentKey: "required", requireResidentKey: true, userVerification: "required" },
      excludeCredentials: existing.map(item => ({ type: "public-key", id: item.id, ...(item.transports ? { transports: JSON.parse(item.transports) } : {}) })),
    } });
  }
  const target = passkeyPath.exec(path)?.[1];
  if (target) {
    const found = await db.prepare("SELECT name FROM passkeys WHERE id=? AND user_id=?").bind(target, current.id).first<{ name: string }>();
    if (!found) return reply({ error: "Esa passkey ya no está registrada." }, 404);
    if (method === "PUT") {
      const renamed = typeof value?.name === "string" ? value.name.trim().replace(/\s+/g, " ") : "";
      if (renamed.length < 1 || renamed.length > 60 || /[<>\x00-\x1f]/.test(renamed)) return reply({ error: "Escribe un nombre de hasta 60 caracteres." }, 400);
      await db.batch([db.prepare("UPDATE passkeys SET name=? WHERE id=? AND user_id=?").bind(renamed, target, current.id)]);
      return reply({ ok: true, name: renamed });
    }
    await db.batch([
      db.prepare("DELETE FROM passkeys WHERE id=? AND user_id=?").bind(target, current.id),
      securityEvent(db, { organizationId: org, type: "passkey_removed", actorId: current.id, subjectId: current.id, method: "passkey", detail: found.name, client }),
      event(db, current, { action: "revoked", targetType: "account", targetId: current.id, summary: `Eliminó la passkey «${found.name}»` }),
    ]);
    return reply({ ok: true });
  }
  // Without a name, the device it was created on («Chrome en Windows»); it can be renamed later.
  const name = typeof value?.name === "string" && value.name.trim() ? value.name.trim().replace(/\s+/g, " ") : deviceLabel(request.headers.get("User-Agent"));
  if (name.length < 1 || name.length > 60 || /[<>\x00-\x1f]/.test(name)) return reply({ error: "Ponle a la passkey un nombre de hasta 60 caracteres, como «Teléfono» o «Portátil»." }, 400);
  const credential = value?.credential && typeof value.credential === "object" ? value.credential as Record<string, unknown> : null;
  const response = credential?.response && typeof credential.response === "object" ? credential.response as Record<string, unknown> : {};
  const token = signedChallenge(response.clientDataJSON);
  const ceremony = await consume(db, token, "passkey-register");
  if (!ceremony || ceremony.userId !== current.id) return reply({ error: passkeyMessage.challenge, code: "PASSKEY_CHALLENGE" }, 400);
  const verified = await verifyRegistration(response, expected(request, token!));
  if ("problem" in verified) return reply({ error: passkeyMessage[verified.problem], code: "PASSKEY_REJECTED" }, 400);
  if (credential?.id !== verified.id) return reply({ error: passkeyMessage.format, code: "PASSKEY_REJECTED" }, 400);
  const transports = Array.isArray(response.transports) ? response.transports.filter(item => typeof item === "string" && /^[a-z-]{2,20}$/.test(item)).slice(0, 6) : [];
  const ok = await db.guardedBatch(db.prepare("SELECT 1 WHERE NOT EXISTS (SELECT 1 FROM passkeys WHERE id=?)").bind(verified.id), [
    db.prepare("INSERT INTO passkeys(id,user_id,name,public_key,counter,transports,backed_up,created_at) VALUES (?,?,?,?,?,?,?,?)")
      .bind(verified.id, current.id, name, verified.publicKey, verified.counter, transports.length ? JSON.stringify(transports) : null, verified.backedUp ? 1 : 0, new Date().toISOString()),
    securityEvent(db, { organizationId: org, type: "passkey_added", outcome: "succeeded", actorId: current.id, subjectId: current.id, method: "passkey", detail: name, client }),
    event(db, current, { action: "created", targetType: "account", targetId: current.id, summary: `Registró la passkey «${name}»` }),
  ]);
  if (!ok) return reply({ error: "Esa passkey ya está registrada." }, 409);
  return reply({ passkey: { id: verified.id, name, synced: verified.backedUp } }, 201);
}

/** The ticket a sign-in assertion signed, to name the organization before anything is read. */
export function passkeyTicket(input: unknown): string | null {
  const credential = input && typeof input === "object" ? (input as Record<string, unknown>).credential : null;
  const response = credential && typeof credential === "object" ? (credential as Record<string, unknown>).response : null;
  return response && typeof response === "object" ? signedChallenge((response as Record<string, unknown>).clientDataJSON) : null;
}
/**
 * POST /api/login/passkey/options {identifier} and POST /api/login/passkey {credential}, public. The options name the
 * passkeys of the account typed; an unknown name gets options too, so the answer does not tell whether it exists.
 */
export async function passkeySignIn(path: string, input: unknown, request: Request, scope: string, db: Database, everyStore: () => Database[] = () => [db]): Promise<Response> {
  const client: Client = clientOf(request), url = new URL(request.url);
  if (path === "/api/login/passkey/options") {
    const identifier = identifierInput(input);
    // Without a name: any passkey of this site (the device offers them), with the same ticket in every organization;
    // the passkey's user handle says which one it belongs to.
    if (!identifier) {
      const token = tokenPrefix(scope) + newToken(), hash = await digest(token), now = Date.now();
      await Promise.all(everyStore().map(store => store.batch([store.prepare("INSERT INTO auth_challenges(token_hash,kind,user_id,created_at,expires_at) VALUES (?,'passkey-sign-in',NULL,?,?)").bind(hash, now, now + passkeyTimeoutMs)])));
      return reply({ publicKey: { challenge: toBase64Url(new TextEncoder().encode(token)), rpId: url.hostname, timeout: passkeyTimeoutMs, userVerification: "required", allowCredentials: [] } });
    }
    const person = await db.prepare(`SELECT u.id FROM users u JOIN memberships m ON m.user_id=u.id AND m.organization_id=? AND m.active=1 WHERE ${"username" in identifier ? "u.username=?" : "u.email=?"}`) // nosemgrep: sql-interpolated-text -- la condición es una de dos constantes; el valor va como parámetro
      .bind(scope, "username" in identifier ? identifier.username : identifier.email).first<{ id: string }>();
    const keys = person ? (await db.prepare("SELECT id,transports FROM passkeys WHERE user_id=?").bind(person.id).all<{ id: string; transports: string | null }>()).results : [];
    const token = await ticket(db, scope, "passkey-sign-in", person?.id ?? null);
    return reply({ publicKey: { challenge: toBase64Url(new TextEncoder().encode(token)), rpId: url.hostname, timeout: passkeyTimeoutMs, userVerification: "required",
      allowCredentials: keys.map(item => ({ type: "public-key", id: item.id, ...(item.transports ? { transports: JSON.parse(item.transports) } : {}) })) } });
  }
  const credential = input && typeof input === "object" ? (input as Record<string, unknown>).credential as Record<string, unknown> | undefined : undefined;
  const response = credential?.response && typeof credential.response === "object" ? credential.response as Record<string, unknown> : {};
  const token = passkeyTicket(input), ceremony = await consume(db, token, "passkey-sign-in");
  const refuse = async (problem: keyof typeof passkeyMessage, subject: string | null) => {
    await db.batch([securityEvent(db, { organizationId: scope, type: "sign_in", outcome: "failed", actorId: subject, subjectId: subject, method: "passkey", detail: passkeyMessage[problem].slice(0, 120), client })]);
    return reply({ error: passkeyMessage[problem], code: "PASSKEY_REJECTED" }, 401);
  };
  if (!ceremony) return reply({ error: passkeyMessage.challenge, code: "PASSKEY_CHALLENGE" }, 400);
  const id = typeof credential?.id === "string" && fromBase64Url(credential.id) ? credential.id : "";
  const stored = id ? await db.prepare("SELECT p.user_id AS userId,p.public_key AS publicKey,p.counter FROM passkeys p JOIN memberships m ON m.user_id=p.user_id AND m.organization_id=? AND m.active=1 WHERE p.id=?")
    .bind(scope, id).first<{ userId: string; publicKey: string; counter: number }>() : null;
  if (!stored || (ceremony.userId && ceremony.userId !== stored.userId)) return refuse("signature", stored?.userId ?? null);
  const verified = await verifyAssertion(response, stored, expected(request, token!));
  if ("problem" in verified) return refuse(verified.problem, stored.userId);
  const moved = await db.guardedBatch(db.prepare("SELECT 1 FROM passkeys WHERE id=? AND counter=?").bind(id, stored.counter), [
    db.prepare("UPDATE passkeys SET counter=?,backed_up=?,last_used_at=? WHERE id=?").bind(verified.counter, verified.backedUp ? 1 : 0, new Date().toISOString(), id),
  ]);
  if (!moved) return refuse("counter", stored.userId);
  return finishSignIn(db, request, stored.userId, scope, "passkey", client, [], true);
}

/** The organization letter of a passkey's user handle (`d_user-…`), to sign in without typing a name. */
export function passkeyHandleScope(input: unknown): string | null {
  const credential = input && typeof input === "object" ? (input as Record<string, unknown>).credential : null;
  const response = credential && typeof credential === "object" ? (credential as Record<string, unknown>).response as Record<string, unknown> | undefined : undefined;
  const handle = fromBase64Url(response?.userHandle);
  const text = handle ? new TextDecoder().decode(handle) : "";
  return /^[a-z]_[a-z0-9-]{1,100}$/.test(text) ? `${text[0]}_${"0".repeat(64)}` : null;
}
/** ST-132 for the confirmation window: an assertion of one of the person's own passkeys. */
export async function confirmWithPasskey(input: unknown, userId: string, db: Database, request: Request) {
  const credential = input && typeof input === "object" ? (input as Record<string, unknown>).credential as Record<string, unknown> | undefined : undefined;
  const response = credential?.response && typeof credential.response === "object" ? credential.response as Record<string, unknown> : {};
  const token = passkeyTicket(input), ceremony = await consume(db, token, "passkey-sign-in");
  if (!ceremony || ceremony.userId !== userId) return false;
  const id = typeof credential?.id === "string" ? credential.id : "";
  const stored = await db.prepare("SELECT public_key AS publicKey,counter FROM passkeys WHERE id=? AND user_id=?").bind(id, userId).first<{ publicKey: string; counter: number }>();
  if (!stored) return false;
  const verified = await verifyAssertion(response, stored, expected(request, token!));
  if ("problem" in verified) return false;
  await db.batch([db.prepare("UPDATE passkeys SET counter=?,last_used_at=? WHERE id=? AND counter=?").bind(verified.counter, new Date().toISOString(), id, stored.counter)]);
  return true;
}
