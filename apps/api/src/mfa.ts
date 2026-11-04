import type { Member, SignInMethod } from "@happy-learners/contracts";
import { base32, groupedKey, matchTotp, mfaAttempts, mfaChallengeMs, otpauthUri, recoveryCode, recoveryCodeCount, recoveryCodeInput, tokenPattern, tokenPrefix } from "@happy-learners/domain";
import type { Database } from "./storage";
import { digest, newToken } from "./auth";
import type { Client } from "./account";
import { event } from "./activity";
import { securityEvent } from "./security-log";
import { requireConfirmation } from "./step-up";

/**
 * ST-133: the second factor. The TOTP secret is encrypted (AES-GCM) with the organization's key, which lives in the
 * store's key-value storage, outside SQL: it never leaves in a backup or an export. Recovery codes are kept as SHA-256
 * and each works once. After the password (or a link), a person with the factor gets a 5-minute challenge instead of a
 * session; 5 wrong codes end it. A passkey already proves both factors. Every step is in the security log.
 */
const reply = (value: unknown, status = 200) => Response.json(value, { status });
const bytes = (buffer: ArrayBuffer | Uint8Array) => buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
const b64 = (data: Uint8Array) => btoa(String.fromCharCode(...data));
const unb64 = (text: string) => Uint8Array.from(atob(text), char => char.charCodeAt(0));

async function aes(db: Database) { return crypto.subtle.importKey("raw", await db.securityKey(), "AES-GCM", false, ["encrypt", "decrypt"]); }
export async function seal(db: Database, plain: Uint8Array) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const cipher = bytes(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await aes(db), plain as BufferSource));
  return `v1:${b64(iv)}:${b64(cipher)}`;
}
export async function unseal(db: Database, text: string) {
  const [version, iv, cipher] = text.split(":");
  if (version !== "v1" || !iv || !cipher) throw new Error("Unknown secret format");
  return bytes(await crypto.subtle.decrypt({ name: "AES-GCM", iv: unb64(iv) }, await aes(db), unb64(cipher)));
}

type Factor = { secret: string; status: "pending" | "active"; lastStep: number; enabledAt: string | null };
export const factorOf = (db: Database, userId: string) => db.prepare("SELECT secret,status,last_step AS lastStep,enabled_at AS enabledAt FROM totp_factors WHERE user_id=?").bind(userId).first<Factor>();
/** Whether the role must have a second factor under the organization's policy. */
export async function mfaRequired(db: Database, organizationId: string, role: Member["role"]) {
  const row = await db.prepare("SELECT mfa_admin AS admin,mfa_educator AS educator FROM security_policies WHERE organization_id=?").bind(organizationId).first<{ admin: number; educator: number }>();
  return !!row && !!(role === "admin" ? row.admin : row.educator);
}

/** Checks a TOTP code or a recovery code and records the step or uses the code. Returns how, or null. */
async function check(db: Database, userId: string, factor: Factor, input: Record<string, unknown> | null): Promise<"totp" | "recovery_code" | null> {
  const recovery = recoveryCodeInput(input?.recoveryCode);
  if (recovery) {
    const used = await db.guardedBatch(db.prepare("SELECT 1 FROM recovery_codes WHERE user_id=? AND code_hash=? AND used_at IS NULL").bind(userId, await digest(recovery)), [
      db.prepare("UPDATE recovery_codes SET used_at=? WHERE user_id=? AND code_hash=?").bind(new Date().toISOString(), userId, await digest(recovery)),
    ]);
    return used ? "recovery_code" : null;
  }
  const step = await matchTotp(await unseal(db, factor.secret), input?.code, factor.lastStep);
  if (step === null) return null;
  // The step moves forward only once: the same code twice, even at once, is refused the second time.
  const moved = await db.guardedBatch(db.prepare("SELECT 1 FROM totp_factors WHERE user_id=? AND last_step<?").bind(userId, step), [db.prepare("UPDATE totp_factors SET last_step=? WHERE user_id=?").bind(step, userId)]);
  return moved ? "totp" : null;
}
async function newRecoveryCodes(db: Database, userId: string) {
  const codes: string[] = [];
  while (codes.length < recoveryCodeCount) { const code = recoveryCode(crypto.getRandomValues(new Uint8Array(24))); if (code && !codes.includes(code)) codes.push(code); }
  const at = new Date().toISOString();
  return { codes, statements: [db.prepare("DELETE FROM recovery_codes WHERE user_id=?").bind(userId), ...await Promise.all(codes.map(async code => db.prepare("INSERT INTO recovery_codes(user_id,code_hash,created_at) VALUES (?,?,?)").bind(userId, await digest(code), at)))] };
}

/** After the first factor: a challenge for the second, when the person has one. Null when there is nothing to ask. */
export async function mfaChallenge(db: Database, userId: string, scope: string, method: SignInMethod) {
  const factor = await factorOf(db, userId);
  if (factor?.status !== "active" || method === "passkey") return null;
  const token = tokenPrefix(scope) + newToken(), now = Date.now();
  await db.batch([db.prepare("INSERT INTO auth_challenges(token_hash,kind,user_id,data,created_at,expires_at) VALUES (?,'mfa',?,?,?,?)").bind(await digest(token), userId, JSON.stringify({ method }), now, now + mfaChallengeMs)]);
  return token;
}
export const mfaPath = "/api/login/mfa";
/** POST /api/login/mfa {challenge, code | recoveryCode}: the second step. Returns who and how, to open the session. */
export async function answerChallenge(input: unknown, scope: string, db: Database, client: Client): Promise<{ response: Response } | { userId: string; method: SignInMethod; how: "totp" | "recovery_code" }> {
  const value = input && typeof input === "object" ? input as Record<string, unknown> : null;
  const token = typeof value?.challenge === "string" ? value.challenge : "";
  if (!tokenPattern.test(token)) return { response: reply({ error: "Vuelve a iniciar sesión.", code: "MFA_CHALLENGE_INVALID" }, 400) };
  const hash = await digest(token), now = Date.now();
  const found = await db.prepare("SELECT c.user_id AS userId,c.data,c.attempts FROM auth_challenges c JOIN memberships m ON m.user_id=c.user_id AND m.organization_id=? AND m.active=1 WHERE c.token_hash=? AND c.kind='mfa' AND c.used_at IS NULL AND c.expires_at>?")
    .bind(scope, hash, now).first<{ userId: string; data: string; attempts: number }>();
  if (!found || found.attempts >= mfaAttempts) return { response: reply({ error: "El paso de verificación caducó. Vuelve a iniciar sesión.", code: "MFA_CHALLENGE_EXPIRED" }, 410) };
  const factor = await factorOf(db, found.userId);
  const how = factor?.status === "active" ? await check(db, found.userId, factor, value) : null;
  if (!how) {
    await db.batch([
      db.prepare("UPDATE auth_challenges SET attempts=attempts+1 WHERE token_hash=?").bind(hash),
      securityEvent(db, { organizationId: scope, type: "mfa_failed", outcome: "failed", actorId: found.userId, subjectId: found.userId, method: value?.recoveryCode ? "recovery_code" : "totp", detail: `Intento ${found.attempts + 1} de ${mfaAttempts}`, client }),
    ]);
    return { response: reply({ error: found.attempts + 1 >= mfaAttempts ? "Demasiados códigos incorrectos. Vuelve a iniciar sesión." : "Ese código no es correcto o ya se usó. Revisa la hora de tu teléfono y vuelve a intentar.", code: "MFA_CODE_INVALID" }, 400) };
  }
  const used = await db.guardedBatch(db.prepare("SELECT 1 FROM auth_challenges WHERE token_hash=? AND used_at IS NULL").bind(hash), [
    db.prepare("UPDATE auth_challenges SET used_at=? WHERE token_hash=?").bind(now, hash),
    ...(how === "recovery_code" ? [securityEvent(db, { organizationId: scope, type: "recovery_code_used", outcome: "succeeded", actorId: found.userId, subjectId: found.userId, method: "recovery_code", client })] : []),
  ]);
  if (!used) return { response: reply({ error: "Vuelve a iniciar sesión.", code: "MFA_CHALLENGE_EXPIRED" }, 410) };
  const method = (JSON.parse(found.data || "{}") as { method?: SignInMethod }).method || "password";
  return { userId: found.userId, method, how };
}

export function mfaMethods(path: string): string[] | null {
  if (path === "/api/me/mfa") return ["GET", "DELETE"];
  if (path === "/api/me/mfa/setup" || path === "/api/me/mfa/enable" || path === "/api/me/mfa/recovery-codes") return ["POST"];
  return null;
}
/** /api/me/mfa…: the person's own second factor. Allowed while the policy still asks them to set it up. */
export async function myMfa(path: string, method: string, input: unknown, current: Member, db: Database, token: string, client: Client): Promise<Response> {
  const value = input && typeof input === "object" ? input as Record<string, unknown> : null;
  const factor = await factorOf(db, current.id), required = await mfaRequired(db, current.organizationId, current.role), org = current.organizationId;
  if (path === "/api/me/mfa" && method === "GET") {
    const left = await db.prepare("SELECT count(*) AS n FROM recovery_codes WHERE user_id=? AND used_at IS NULL").bind(current.id).first<{ n: number }>();
    return reply({ mfa: { enabled: factor?.status === "active", enabledAt: factor?.status === "active" ? factor.enabledAt : null, recoveryCodesLeft: factor?.status === "active" ? left?.n || 0 : 0, required } });
  }
  if (path === "/api/me/mfa/setup") {
    if (factor?.status === "active") return reply({ error: "Ya tienes la verificación en dos pasos activa." }, 409);
    const confirmation = await requireConfirmation(db, current, token, value);
    if (confirmation) return confirmation;
    const secret = crypto.getRandomValues(new Uint8Array(20)), key = base32(secret);
    await db.batch([db.prepare("INSERT INTO totp_factors(user_id,secret,status,created_at) VALUES (?,?,'pending',?) ON CONFLICT(user_id) DO UPDATE SET secret=excluded.secret,status='pending',last_step=0,created_at=excluded.created_at,enabled_at=NULL")
      .bind(current.id, await seal(db, secret), new Date().toISOString())]);
    return reply({ setup: { key: groupedKey(key), uri: otpauthUri(key, current.username) } });
  }
  if (path === "/api/me/mfa/enable") {
    if (factor?.status !== "pending") return reply({ error: "Empieza de nuevo: genera una clave y escanéala o escríbela en tu aplicación." }, 409);
    const step = await matchTotp(await unseal(db, factor.secret), value?.code, 0);
    if (step === null) return reply({ error: "Ese código no es correcto. Escribe el que muestra tu aplicación ahora; revisa la hora de tu teléfono.", code: "MFA_CODE_INVALID" }, 400);
    const { codes, statements } = await newRecoveryCodes(db, current.id), at = new Date().toISOString(), tokenHash = await digest(token);
    await db.batch([
      db.prepare("UPDATE totp_factors SET status='active',last_step=?,enabled_at=? WHERE user_id=?").bind(step, at, current.id),
      ...statements,
      // This session proved the factor; the others close.
      db.prepare("UPDATE sessions SET verified=1 WHERE token_hash=?").bind(tokenHash),
      db.prepare("DELETE FROM sessions WHERE user_id=? AND token_hash<>?").bind(current.id, tokenHash),
      securityEvent(db, { organizationId: org, type: "mfa_enabled", outcome: "succeeded", actorId: current.id, subjectId: current.id, method: "totp", detail: `${recoveryCodeCount} códigos de recuperación; sus otras sesiones se cerraron`, client }),
      event(db, current, { action: "updated", targetType: "account", targetId: current.id, summary: "Activó la verificación en dos pasos" }),
    ]);
    return reply({ recoveryCodes: codes });
  }
  if (factor?.status !== "active") return reply({ error: "No tienes la verificación en dos pasos activa." }, 409);
  // Within the confirmation window nothing else is asked; a code, when sent, must still be right.
  const confirmation = await requireConfirmation(db, current, token, value);
  if (confirmation) return confirmation;
  if ((value?.code || value?.recoveryCode) && !await check(db, current.id, factor, value)) return reply({ error: "Ese código no es correcto o ya se usó.", code: "MFA_CODE_INVALID" }, 400);
  if (path === "/api/me/mfa/recovery-codes") {
    const { codes, statements } = await newRecoveryCodes(db, current.id);
    await db.batch([...statements, securityEvent(db, { organizationId: org, type: "recovery_codes_renewed", actorId: current.id, subjectId: current.id, detail: "Los códigos anteriores dejaron de funcionar", client })]);
    return reply({ recoveryCodes: codes });
  }
  if (required) return reply({ error: "Tu organización exige la verificación en dos pasos para tu rol: no se puede desactivar." }, 409);
  await db.batch([
    db.prepare("DELETE FROM totp_factors WHERE user_id=?").bind(current.id), db.prepare("DELETE FROM recovery_codes WHERE user_id=?").bind(current.id),
    securityEvent(db, { organizationId: org, type: "mfa_disabled", actorId: current.id, subjectId: current.id, client }),
    event(db, current, { action: "updated", targetType: "account", targetId: current.id, summary: "Desactivó la verificación en dos pasos" }),
  ]);
  return reply({ ok: true });
}

/** DELETE /api/security/people/:id/mfa: administration resets a person's second factor; their sessions close. */
export async function resetMfa(target: string, current: Member, db: Database, client: Client) {
  if (target === current.id) return reply({ error: "Tu propia verificación se cambia desde tu cuenta." }, 409);
  const person = await db.prepare("SELECT COALESCE(u.display_name,u.username) AS name FROM users u JOIN memberships m ON m.user_id=u.id WHERE u.id=? AND m.organization_id=?").bind(target, current.organizationId).first<{ name: string }>();
  if (!person) return reply({ error: "Miembro no disponible." }, 404);
  if ((await factorOf(db, target))?.status !== "active") return reply({ error: `${person.name} no tiene la verificación en dos pasos activa.` }, 409);
  await db.batch([
    db.prepare("DELETE FROM totp_factors WHERE user_id=?").bind(target), db.prepare("DELETE FROM recovery_codes WHERE user_id=?").bind(target),
    db.prepare("DELETE FROM sessions WHERE user_id=?").bind(target),
    securityEvent(db, { organizationId: current.organizationId, type: "mfa_reset", actorId: current.id, subjectId: target, detail: "Sus sesiones se cerraron; la configura de nuevo al entrar si su rol la exige", client }),
    event(db, current, { action: "reset", targetType: "account", targetId: target, summary: `Restableció la verificación en dos pasos de ${person.name}` }),
  ]);
  return reply({ ok: true });
}
export const mfaResetPath = /^\/api\/security\/people\/([a-z0-9-]{1,100})\/mfa$/;

/** ST-133 for the confirmation window: a code of the person's app, used once. */
export async function confirmWithCode(db: Database, userId: string, code: unknown) {
  const factor = await factorOf(db, userId);
  return factor?.status === "active" && !!await check(db, userId, factor, { code });
}
