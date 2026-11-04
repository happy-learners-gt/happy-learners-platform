import type { Member, SignInMethod } from "@happy-learners/contracts";
import type { AccessPolicy, MailSender } from "@happy-learners/domain";
import { defaultAccessPolicy, identifierInput, linkRequestedMessage, passwordMessage, passwordProblem, accessPolicyInput, recoveryLifetimeMs, signInLinkLifetimeMs, tokenPattern, tokenPrefix } from "@happy-learners/domain";
import type { Database } from "./storage";
import { cookie, digest, hashPassword, newToken } from "./auth";
import { clientOf, openSession, type Client } from "./account";
import { sendNotice } from "./account-notices";
import { event } from "./activity";
import { securityEvent } from "./security-log";
import { mfaChallenge } from "./mfa";

/**
 * Ways in besides the password, and the rules every password follows (REL-007):
 * - ST-134: recovering the password with a single-use link sent by e-mail (30 minutes), the organization's minimum
 *   length, a list of the most common passwords and, when the policy keeps it on, the breach check of Have I Been
 *   Pwned by k-anonymity (only the first 5 characters of the password's SHA-1 leave the Worker).
 * - ST-130: signing in with a single-use link sent by e-mail (15 minutes).
 * A request for a link always gets the same answer, whether or not the account exists, and the message leaves after
 * the response (ctx.waitUntil) so the time does not tell either. Opening a link (GET) never uses it: a mail scanner
 * that follows links cannot sign anyone in. Each step is in the security log.
 */
declare global { interface Env { PWNED_PASSWORDS_URL?: string } }
const reply = (value: unknown, status = 200, headers: Record<string, string> = {}) => Response.json(value, { status, headers });
export const linkConfirmPath = /^\/api\/login\/link\/([a-z]_[a-f0-9]{64})$/;
export const recoveryConfirmPath = /^\/api\/account\/recovery\/([a-z]_[a-f0-9]{64})$/;
export type Defer = (work: Promise<unknown>) => void;

export async function policyOf(db: Database, organizationId: string): Promise<AccessPolicy> {
  const row = await db.prepare("SELECT min_password_length AS minPasswordLength,breached_check AS breachedCheck,mfa_admin AS mfaAdmin,mfa_educator AS mfaEducator,session_hours AS sessionHours,link_sign_in AS linkSignIn,version,updated_at AS updatedAt FROM security_policies WHERE organization_id=?")
    .bind(organizationId).first<Record<keyof AccessPolicy, number | string>>();
  if (!row) return defaultAccessPolicy;
  return { minPasswordLength: Number(row.minPasswordLength), breachedCheck: !!row.breachedCheck, mfaAdmin: !!row.mfaAdmin, mfaEducator: !!row.mfaEducator, sessionHours: Number(row.sessionHours), linkSignIn: !!row.linkSignIn, version: Number(row.version), updatedAt: String(row.updatedAt) };
}

/**
 * Where the breach check asks: Have I Been Pwned in production. A local Worker (tests, development) asks nothing
 * unless PWNED_PASSWORDS_URL names a server on the same machine; no other address is accepted.
 */
export function breachRange(env: Pick<Env, "PWNED_PASSWORDS_URL">, origin: string): string | null {
  const configured = env.PWNED_PASSWORDS_URL?.trim();
  if (configured) return /^http:\/\/127\.0\.0\.1:\d+\/range\/$/.test(configured) || configured === "https://api.pwnedpasswords.com/range/" ? configured : null;
  return /^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(origin) ? null : "https://api.pwnedpasswords.com/range/";
}
/** Whether the password is in a known breach: true, false, or null when the service did not answer in 3 seconds. */
export async function breached(password: string, range: string): Promise<boolean | null> {
  const sha1 = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-1", new TextEncoder().encode(password))), b => b.toString(16).padStart(2, "0")).join("").toUpperCase();
  try {
    const response = await fetch(range + sha1.slice(0, 5), { headers: { "Add-Padding": "true", "User-Agent": "Happy-Learners-Platform" }, signal: AbortSignal.timeout(3000) });
    if (!response.ok) return null;
    const suffix = sha1.slice(5);
    return (await response.text()).split(/\r?\n/).some(line => { const [hash, count] = line.trim().split(":"); return hash === suffix && Number(count) > 0; });
  } catch { return null; }
}
export type PasswordCheck = (password: unknown, username: string, previous?: string) => Promise<string | null>;
/** The policy's check of a new password: an error message, or null when it is acceptable. */
export function passwordChecker(db: Database, organizationId: string, range: string | null): PasswordCheck {
  return async (password, username, previous) => {
    const policy = await policyOf(db, organizationId);
    const problem = passwordProblem(password, username, policy, previous);
    if (problem) return passwordMessage(problem, policy.minPasswordLength);
    if (policy.breachedCheck && range && await breached(password as string, range) === true) return passwordMessage("breached", policy.minPasswordLength);
    return null;
  };
}

/**
 * Opens the session of a person who proved who they are, with the policy's lifetime, and sets its cookie. ST-133: when
 * the person has a second factor (and did not use a passkey or already answer it), it answers with a challenge instead.
 */
export async function finishSignIn(db: Database, request: Request, userId: string, scope: string, method: SignInMethod, client: Client, extra: Prepared[] = [], verified = method === "passkey") {
  if (!verified) {
    if (extra.length) await db.batch(extra);
    const challenge = await mfaChallenge(db, userId, scope, method);
    if (challenge) return reply({ mfa: "required", challenge });
    extra = [];
  }
  const policy = await policyOf(db, scope), now = Date.now(), token = tokenPrefix(scope) + newToken();
  await db.batch([
    db.prepare("DELETE FROM sessions WHERE expires_at<=?").bind(now),
    db.prepare("DELETE FROM auth_challenges WHERE expires_at<=?").bind(now - 86400000),
    ...extra,
    ...openSession(db, await digest(token), userId, scope, method, client, now, { hours: policy.sessionHours, verified }),
  ]);
  return reply({ ok: true }, 200, { "Set-Cookie": cookie(token, request, false, policy.sessionHours * 3600) });
}
type Prepared = ReturnType<Database["prepare"]>;

type Person = { id: string; username: string; name: string; email: string; role: Member["role"] };
const personColumns = "u.id,u.username,COALESCE(u.display_name,u.username) AS name,u.email,CASE m.role WHEN 'instructor' THEN 'educator' ELSE m.role END AS role";
async function limited(db: Database, bucket: string, max: number) {
  const now = Date.now();
  const row = await db.prepare("INSERT INTO login_limits (bucket, attempts, expires_at) VALUES (?,1,?) ON CONFLICT(bucket) DO UPDATE SET attempts=CASE WHEN expires_at<? THEN 1 ELSE attempts+1 END, expires_at=CASE WHEN expires_at<? THEN excluded.expires_at ELSE expires_at END RETURNING attempts")
    .bind(await digest(bucket), now + 900000, now, now).first<{ attempts: number }>();
  return !row || row.attempts > max;
}

/**
 * POST /api/login/link and /api/account/recovery {identifier}: a username or a sign-in e-mail. The organization was
 * chosen from the identifier before this runs. Always the same answer; at most 10 requests per address and 3 links
 * per account every 15 minutes.
 */
export async function requestLink(kind: "link" | "recovery", input: unknown, request: Request, scope: string, db: Database, sender: MailSender, defer: Defer) {
  const generic = reply({ ok: true, message: linkRequestedMessage });
  const day = new Date().toISOString().slice(0, 10);
  if (await limited(db, `${kind}:${day}:${request.headers.get("CF-Connecting-IP") || "local"}`, 10)) return reply({ error: "Demasiadas solicitudes. Espera 15 minutos y vuelve a intentar." }, 429, { "Retry-After": "900" });
  const identifier = identifierInput(input);
  if (!identifier) return reply({ error: "Escribe tu usuario o tu correo de acceso." }, 400);
  const client = clientOf(request);
  // nosemgrep: sql-interpolated-text -- personColumns y la condición (usuario o correo) son constantes; los valores van como parámetros
  const person = await db.prepare(`SELECT ${personColumns} FROM users u JOIN memberships m ON m.user_id=u.id AND m.organization_id=? AND m.active=1 WHERE ${"username" in identifier ? "u.username=?" : "u.email=?"} AND u.email IS NOT NULL`)
    .bind(scope, "username" in identifier ? identifier.username : identifier.email).first<Person>();
  const policy = await policyOf(db, scope);
  if (!person || (kind === "link" && !policy.linkSignIn)) {
    await db.batch([securityEvent(db, { organizationId: scope, type: kind === "link" ? "link_requested" : "password_recovery_requested", outcome: "failed", subjectId: person?.id ?? null, detail: person ? "El inicio con enlace está desactivado en la organización" : "Sin cuenta activa con correo para lo escrito", client })]);
    return generic;
  }
  if (await limited(db, `${kind}-account:${person.id}`, 3)) return generic;
  const token = tokenPrefix(scope) + newToken(), now = Date.now(), lifetime = kind === "link" ? signInLinkLifetimeMs : recoveryLifetimeMs, expiresAt = new Date(now + lifetime).toISOString();
  await db.batch([
    // Only the newest link of each kind works.
    db.prepare("UPDATE auth_challenges SET used_at=? WHERE user_id=? AND kind=? AND used_at IS NULL").bind(now, person.id, kind),
    db.prepare("INSERT INTO auth_challenges(token_hash,kind,user_id,created_at,expires_at) VALUES (?,?,?,?,?)").bind(await digest(token), kind, person.id, now, now + lifetime),
    securityEvent(db, { organizationId: scope, type: kind === "link" ? "link_requested" : "password_recovery_requested", outcome: "info", actorId: person.id, subjectId: person.id, detail: "Enlace enviado al correo de acceso", client }),
  ]);
  const link = `${new URL(request.url).origin}/${kind === "link" ? "entrar" : "recuperar"}/${token}`;
  defer(sendNotice(db, sender, scope, { id: person.id, name: person.name, email: person.email }, `${kind}:${person.id}:${now}`, { kind: kind === "link" ? "sign_in_link" : "password_recovery", username: person.username, link, expiresAt }));
  return generic;
}

type Challenge = Person & { tokenHash: string; usedAt: number | null; expiresAt: number; organization: string | null };
async function challenge(token: string, kind: "link" | "recovery", scope: string, db: Database): Promise<Challenge | null> {
  if (!tokenPattern.test(token)) return null;
  // nosemgrep: sql-interpolated-text -- personColumns es una lista constante de columnas
  return db.prepare(`SELECT ${personColumns},c.token_hash AS tokenHash,c.used_at AS usedAt,c.expires_at AS expiresAt,o.name AS organization FROM auth_challenges c JOIN users u ON u.id=c.user_id
    JOIN memberships m ON m.user_id=u.id AND m.organization_id=? AND m.active=1 JOIN organizations o ON o.id=m.organization_id WHERE c.token_hash=? AND c.kind=?`).bind(scope, await digest(token), kind).first<Challenge>();
}
const gone = (found: Challenge | null) => !found ? reply({ error: "Este enlace no existe o se reemplazó por uno más reciente.", code: "LINK_NOT_FOUND" }, 404)
  : found.usedAt ? reply({ error: "Este enlace ya se usó o se reemplazó por uno más reciente. Pide otro.", code: "LINK_USED" }, 410)
  : found.expiresAt <= Date.now() ? reply({ error: "Este enlace caducó. Pide otro.", code: "LINK_EXPIRED" }, 410) : null;
const consume = (db: Database, found: Challenge) => db.prepare("SELECT 1 FROM auth_challenges WHERE token_hash=? AND used_at IS NULL AND expires_at>?").bind(found.tokenHash, Date.now());

/** GET /api/login/link/<token> (what it opens) and POST (sign in with it), public. */
export async function signInWithLink(token: string, method: string, request: Request, scope: string, db: Database) {
  const found = await challenge(token, "link", scope, db);
  const problem = gone(found);
  if (problem) return problem;
  const person = found!;
  if (method === "GET") return reply({ link: { username: person.username, name: person.name, organization: person.organization || "Happy Learners", expiresAt: new Date(person.expiresAt).toISOString() } });
  if (!(await policyOf(db, scope)).linkSignIn) return reply({ error: "Tu organización desactivó el inicio de sesión con enlace. Entra con tu contraseña.", code: "LINK_DISABLED" }, 410);
  const used = await db.guardedBatch(consume(db, person), [db.prepare("UPDATE auth_challenges SET used_at=? WHERE token_hash=?").bind(Date.now(), person.tokenHash)]);
  if (!used) return gone(await challenge(token, "link", scope, db)) || reply({ error: "Este enlace ya se usó. Pide otro.", code: "LINK_USED" }, 410);
  return finishSignIn(db, request, person.id, scope, "link", clientOf(request), [db.prepare("DELETE FROM login_limits WHERE bucket=?").bind(await digest(`account:${person.username}`))]);
}

/** GET /api/account/recovery/<token> (whose password) and POST {password} (set it), public. Every session closes. */
export async function recoverPassword(token: string, method: string, input: unknown, request: Request, scope: string, db: Database, check: PasswordCheck, sender: MailSender) {
  const found = await challenge(token, "recovery", scope, db);
  const problem = gone(found);
  if (problem) return problem;
  const person = found!;
  if (method === "GET") return reply({ recovery: { username: person.username, name: person.name, organization: person.organization || "Happy Learners", expiresAt: new Date(person.expiresAt).toISOString(), minimum: (await policyOf(db, scope)).minPasswordLength } });
  const password = input && typeof input === "object" ? (input as Record<string, unknown>).password : undefined;
  const invalid = await check(password, person.username);
  if (invalid) return reply({ error: invalid, code: "PASSWORD_REJECTED" }, 400);
  const { salt, hash } = await hashPassword(password as string), now = Date.now(), client = clientOf(request);
  const actor: Member = { id: person.id, username: person.username, displayName: person.name, role: person.role, organizationId: scope };
  const ok = await db.guardedBatch(consume(db, person), [
    db.prepare("UPDATE auth_challenges SET used_at=? WHERE token_hash=?").bind(now, person.tokenHash),
    db.prepare("UPDATE users SET password_salt=?,password_hash=?,must_change_password=0 WHERE id=?").bind(salt, hash, person.id),
    db.prepare("DELETE FROM sessions WHERE user_id=?").bind(person.id),
    // Recovering lifts the temporary lock of ST-134.
    db.prepare("DELETE FROM login_limits WHERE bucket=?").bind(await digest(`account:${person.username}`)),
    event(db, actor, { action: "updated", targetType: "account", targetId: person.id, summary: "Recuperó su contraseña con un enlace enviado a su correo" }),
    securityEvent(db, { organizationId: scope, type: "password_recovered", outcome: "succeeded", actorId: person.id, subjectId: person.id, method: "recovery", detail: "Sus sesiones abiertas se cerraron", client }),
  ]);
  if (!ok) return gone(await challenge(token, "recovery", scope, db)) || reply({ error: "Este enlace ya se usó. Pide otro.", code: "LINK_USED" }, 410);
  await sendNotice(db, sender, scope, { id: person.id, name: person.name, email: person.email }, `password:${person.id}:${now}`, { kind: "password_changed", username: person.username });
  return reply({ ok: true, username: person.username });
}

/** GET and PUT /api/security/policy: the organization's access policy, administration only (ST-184). */
export async function accessPolicy(method: string, input: unknown, current: Member, db: Database, client: Client) {
  if (current.role !== "admin") return reply({ error: "Solo administración cambia la política de acceso." }, 403);
  const policy = await policyOf(db, current.organizationId);
  if (method === "GET") return reply({ policy });
  const next = accessPolicyInput(input);
  if (!next) return reply({ error: "Revisa la política: longitud mínima de 12 a 64 caracteres y sesiones de 1 a 12 horas." }, 400);
  if (next.version !== policy.version) return reply({ error: "La política cambió desde que la abriste. Recarga antes de guardar." }, 409);
  // Requiring the second factor for administration, without one oneself, would lock oneself out at the next request.
  if (next.mfaAdmin && !policy.mfaAdmin) {
    const strong = await db.prepare("SELECT EXISTS (SELECT 1 FROM totp_factors WHERE user_id=?1 AND status='active') OR EXISTS (SELECT 1 FROM passkeys WHERE user_id=?1) AS yes").bind(current.id).first<{ yes: number }>();
    if (!strong?.yes) return reply({ error: "Configura tu propia verificación en dos pasos o una passkey antes de exigirla a administración: si no, quedarías sin poder seguir.", code: "SELF_MFA_FIRST" }, 409);
  }
  const changes = ([
    ["minPasswordLength", `longitud mínima ${policy.minPasswordLength} → ${next.minPasswordLength}`], ["breachedCheck", `contraseñas filtradas ${next.breachedCheck ? "se rechazan" : "no se revisan"}`],
    ["mfaAdmin", `segundo factor de administración ${next.mfaAdmin ? "obligatorio" : "opcional"}`], ["mfaEducator", `segundo factor de educadores ${next.mfaEducator ? "obligatorio" : "opcional"}`],
    ["sessionHours", `sesiones de ${policy.sessionHours} → ${next.sessionHours} horas`], ["linkSignIn", `inicio con enlace ${next.linkSignIn ? "permitido" : "desactivado"}`],
  ] as const).filter(([key]) => policy[key] !== next[key]).map(([, text]) => text);
  if (!changes.length) return reply({ policy, changed: false });
  const at = new Date().toISOString(), version = policy.version + 1;
  const saved = await db.guardedBatch(db.prepare("SELECT 1 WHERE COALESCE((SELECT version FROM security_policies WHERE organization_id=?),0)=?").bind(current.organizationId, policy.version), [
    db.prepare(`INSERT INTO security_policies(organization_id,min_password_length,breached_check,mfa_admin,mfa_educator,session_hours,link_sign_in,version,updated_at,updated_by) VALUES (?,?,?,?,?,?,?,?,?,?)
      ON CONFLICT(organization_id) DO UPDATE SET min_password_length=excluded.min_password_length,breached_check=excluded.breached_check,mfa_admin=excluded.mfa_admin,mfa_educator=excluded.mfa_educator,
      session_hours=excluded.session_hours,link_sign_in=excluded.link_sign_in,version=excluded.version,updated_at=excluded.updated_at,updated_by=excluded.updated_by`)
      .bind(current.organizationId, next.minPasswordLength, next.breachedCheck ? 1 : 0, next.mfaAdmin ? 1 : 0, next.mfaEducator ? 1 : 0, next.sessionHours, next.linkSignIn ? 1 : 0, version, at, current.id),
    securityEvent(db, { organizationId: current.organizationId, type: "policy_changed", actorId: current.id, detail: changes.join("; "), client }),
    event(db, current, { action: "updated", targetType: "account", targetId: current.organizationId, summary: `Cambió la política de acceso: ${changes.join("; ")}` }),
  ]);
  if (!saved) return reply({ error: "La política cambió desde que la abriste. Recarga antes de guardar." }, 409);
  return reply({ policy: await policyOf(db, current.organizationId), changed: true });
}
