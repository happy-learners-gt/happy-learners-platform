import type { Member } from "@happy-learners/contracts";
import { toBase64Url, tokenPrefix } from "@happy-learners/domain";
import type { Database } from "./storage";
import { digest, newToken, verifyPassword } from "./auth";
import type { Client } from "./account";
import { securityEvent } from "./security-log";

/**
 * The confirmation window of a session (docs/design/identidad-y-acceso.md §1), like GitHub's sudo mode: for 10 minutes
 * after signing in or after confirming with the password, a passkey or a code, sensitive changes of one's own account
 * (second factor, passkeys, linked accounts, tokens) do not ask for anything again. Outside it they answer
 * REAUTH_REQUIRED and the screen asks once, then repeats the action.
 */
export const confirmWindowMs = 10 * 60 * 1000;
declare global { interface Env { CONFIRM_WINDOW_MS?: string } }
let windowMs = confirmWindowMs;
/** The tests shorten the window with CONFIRM_WINDOW_MS, which only a Worker running on this machine accepts. */
export function configureConfirmWindow(env: Pick<Env, "CONFIRM_WINDOW_MS">, origin: string) {
  const value = Number(env.CONFIRM_WINDOW_MS);
  windowMs = /^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(origin) && Number.isInteger(value) && value >= 0 && value <= confirmWindowMs ? value : confirmWindowMs;
}
export const confirmWindow = () => windowMs;
const reply = (value: unknown, status = 200) => Response.json(value, { status });
export const reauthRequired = () => reply({ error: "Confirma que eres tú para hacer este cambio.", code: "REAUTH_REQUIRED" }, 403);

export async function elevated(db: Database, token: string) {
  const row = await db.prepare("SELECT elevated_until AS until FROM sessions WHERE token_hash=?").bind(await digest(token)).first<{ until: number }>();
  return !!row && row.until > Date.now();
}
const elevate = async (db: Database, token: string) => db.prepare("UPDATE sessions SET elevated_until=? WHERE token_hash=?").bind(Date.now() + windowMs, await digest(token));
async function passwordMatches(db: Database, userId: string, password: unknown) {
  if (typeof password !== "string" || !password || password.length > 128) return false;
  const user = await db.prepare("SELECT password_salt AS salt,password_hash AS hash FROM users WHERE id=?").bind(userId).first<{ salt: string; hash: string }>();
  return !!user && await verifyPassword(password, user.salt, user.hash);
}
/**
 * Null when the session is in its confirmation window, or when the request brings the right password (older screens
 * and integrations); otherwise the REAUTH_REQUIRED answer.
 */
export async function requireConfirmation(db: Database, current: Member, token: string, input: unknown): Promise<Response | null> {
  if (await elevated(db, token)) return null;
  const password = input && typeof input === "object" ? (input as Record<string, unknown>).currentPassword : undefined;
  if (await passwordMatches(db, current.id, password)) { await db.batch([await elevate(db, token)]); return null; }
  return password === undefined ? reauthRequired() : reply({ error: "La contraseña actual no es correcta.", code: "REAUTH_FAILED" }, 400);
}

export const confirmPaths = ["/api/me/confirm", "/api/me/confirm/options"];
/**
 * POST /api/me/confirm/options: the passkey ceremony to confirm (only this person's passkeys).
 * POST /api/me/confirm {password} | {code} | {credential}: opens the window. Five failures in 15 minutes stop it.
 */
export async function confirm(path: string, input: unknown, current: Member, db: Database, token: string, request: Request, client: Client,
  checks: { totp: (code: unknown) => Promise<boolean>; passkey: (input: unknown, ticketUser: string) => Promise<boolean> }) {
  const value = input && typeof input === "object" ? input as Record<string, unknown> : {};
  if (path === "/api/me/confirm/options") {
    const keys = (await db.prepare("SELECT id,transports FROM passkeys WHERE user_id=?").bind(current.id).all<{ id: string; transports: string | null }>()).results;
    if (!keys.length) return reply({ error: "No tienes passkeys." }, 404);
    const ticket = tokenPrefix(current.organizationId) + newToken(), now = Date.now();
    await db.batch([db.prepare("INSERT INTO auth_challenges(token_hash,kind,user_id,created_at,expires_at) VALUES (?,'passkey-sign-in',?,?,?)").bind(await digest(ticket), current.id, now, now + 300000)]);
    return reply({ publicKey: { challenge: toBase64Url(new TextEncoder().encode(ticket)), rpId: new URL(request.url).hostname, timeout: 300000, userVerification: "required",
      allowCredentials: keys.map(item => ({ type: "public-key", id: item.id, ...(item.transports ? { transports: JSON.parse(item.transports) } : {}) })) } });
  }
  const now = Date.now(), bucket = await digest(`confirm:${current.id}`);
  const limit = await db.prepare("SELECT attempts FROM login_limits WHERE bucket=? AND expires_at>?").bind(bucket, now).first<{ attempts: number }>();
  if (limit && limit.attempts >= 5) return reply({ error: "Demasiados intentos. Espera 15 minutos y vuelve a intentar." }, 429);
  const how = value.credential ? "passkey" : value.code ? "totp" : "password";
  const ok = how === "passkey" ? await checks.passkey(input, current.id) : how === "totp" ? await checks.totp(value.code) : await passwordMatches(db, current.id, value.password);
  if (!ok) {
    await db.batch([
      db.prepare("INSERT INTO login_limits (bucket, attempts, expires_at) VALUES (?,1,?) ON CONFLICT(bucket) DO UPDATE SET attempts=CASE WHEN expires_at<? THEN 1 ELSE attempts+1 END, expires_at=CASE WHEN expires_at<? THEN excluded.expires_at ELSE expires_at END").bind(bucket, now + 900000, now, now),
      securityEvent(db, { organizationId: current.organizationId, type: "mfa_failed", outcome: "failed", actorId: current.id, subjectId: current.id, method: how, detail: "Confirmación de identidad", client }),
    ]);
    return reply({ error: how === "password" ? "La contraseña no es correcta." : how === "totp" ? "Ese código no es correcto o ya se usó." : "La passkey no se pudo verificar.", code: "REAUTH_FAILED" }, 400);
  }
  await db.batch([await elevate(db, token), db.prepare("DELETE FROM login_limits WHERE bucket=?").bind(bucket)]);
  return reply({ ok: true, until: new Date(Date.now() + windowMs).toISOString() });
}
