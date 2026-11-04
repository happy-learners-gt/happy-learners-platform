import type { AccountOverview, AccountSession, EmailChange, EmailChangePreview, Member, SignInMethod, SignInRecord } from "@happy-learners/contracts";
import type { MailSender } from "@happy-learners/domain";
import { countryCode, deviceLabel, emailChangeInput, emailChangeLifetimeMs, emailChangeState, signInHistoryLimit, signInRetentionDays, tokenPattern, tokenPrefix } from "@happy-learners/domain";
import type { Database } from "./storage";
import { digest, newToken, verifyPassword } from "./auth";
import { sendNotice, type AccountContext } from "./account-notices";
import { event } from "./activity";
import { closureMethods, closures } from "./closures";
import { exportMyData } from "./personal-data";
import { securityEvent } from "./security-log";

/**
 * ST-158: account settings under /api/me/account. The sign-in e-mail changes only after the link sent to the new
 * address is confirmed (a 24-hour, single-use secret whose SHA-256 is all that is kept); the previous address is told.
 * Sessions carry a public id, a device summary and a country, and the person closes any of them but the current one.
 * The sign-in history shows the person's own attempts. Security notices are mandatory (kind 'account' in the outbox).
 */
const reply = (value: unknown, status = 200) => Response.json(value, { status });
export const emailConfirmPath = /^\/api\/account\/email\/([a-z]_[a-f0-9]{64})$/;
const sessionPath = /^\/api\/me\/account\/sessions\/(session-[a-f0-9]{32})$/;
const linkOf = (origin: string, token: string) => `${origin}/cuenta/correo/${token}`;

/** Allowed methods of the account, export and closure routes; null for any other path. */
export function accountMethods(path: string): string[] | null {
  if (path === "/api/me/account" || path === "/api/me/account/sessions" || path === "/api/me/account/logins" || path === "/api/me/export") return ["GET"];
  if (path === "/api/me/account/email") return ["POST", "DELETE"];
  if (path === "/api/me/account/sessions/others" || sessionPath.test(path)) return ["DELETE"];
  if (emailConfirmPath.test(path)) return ["GET", "POST"];
  return closureMethods(path);
}
/** The routes that read a JSON body. */
export const accountBody = (path: string, method: string) => method === "POST" && (path === "/api/me/account/email" || path === "/api/me/closure");

/** What a session and a sign-in keep of the client: a device summary and a country, never the IP or the User-Agent. */
export interface Client { device: string; country: string | null }
export const clientOf = (request: Request): Client => ({ device: deviceLabel(request.headers.get("User-Agent")), country: countryCode(request.headers.get("CF-IPCountry")) });
const msIso = (value: number) => new Date(value).toISOString();
export const newSessionId = () => `session-${crypto.randomUUID().replaceAll("-", "")}`;

/** The statements that open a session (8 hours) and record the successful sign-in; older history is pruned. */
export function openSession(db: Database, tokenHash: string, userId: string, organizationId: string, method: SignInMethod, client: Client, now: number, options: { hours?: number; verified?: boolean; detail?: string } = {}) {
  return [
    db.prepare("INSERT INTO sessions(token_hash,user_id,expires_at,id,created_at,last_used_at,method,device,country,verified) VALUES (?,?,?,?,?,?,?,?,?,?)")
      .bind(tokenHash, userId, now + (options.hours || 8) * 3600000, newSessionId(), now, now, method, client.device, client.country, options.verified ? 1 : 0),
    // ST-137: every sign-in joins the security log too.
    securityEvent(db, { organizationId, type: "sign_in", outcome: "succeeded", actorId: userId, subjectId: userId, method, detail: options.detail || (options.verified && method !== "passkey" ? "Con verificación en dos pasos" : undefined), client }),
    db.prepare("INSERT INTO sign_in_events(id,organization_id,user_id,outcome,method,device,country,occurred_at) VALUES (?,?,?,'succeeded',?,?,?,?)")
      .bind(`signin-${crypto.randomUUID()}`, organizationId, userId, method, client.device, client.country, msIso(now)),
    db.prepare("DELETE FROM sign_in_events WHERE organization_id=? AND occurred_at<?").bind(organizationId, msIso(now - signInRetentionDays * 86400000)),
  ];
}
/** A wrong password for an existing, active account: recorded so its owner sees it in their history. */
export const failedSignIn = (db: Database, userId: string, organizationId: string, client: Client, method: SignInMethod = "password", detail?: string) => [
  db.prepare("INSERT INTO sign_in_events(id,organization_id,user_id,outcome,method,device,country,occurred_at) VALUES (?,?,?,'failed',?,?,?,?)")
    .bind(`signin-${crypto.randomUUID()}`, organizationId, userId, method, client.device, client.country, new Date().toISOString()),
  securityEvent(db, { organizationId, type: "sign_in", outcome: "failed", actorId: userId, subjectId: userId, method, detail, client }),
];

type ChangeRow = Omit<EmailChange, "status"> & { status: string };
const changeColumns = `c.id,c.new_email AS newEmail,c.status,c.requested_at AS requestedAt,c.expires_at AS expiresAt,c.verified_at AS verifiedAt,
  (SELECT o.status FROM mail_outbox o WHERE o.reference_id=c.id ORDER BY o.created_at DESC,o.rowid DESC LIMIT 1) AS delivery FROM email_changes c`;
const change = (row: ChangeRow, now: string): EmailChange => ({ ...row, status: emailChangeState(row.status, row.expiresAt, now) });

/** Checks the current password against a per-person daily bucket, so a session cannot be used to guess it. */
async function passwordMatches(db: Database, current: Member, password: string) {
  const now = Date.now(), bucket = await digest(`password-check:${current.id}:${new Date().toISOString().slice(0, 10)}`);
  const limit = await db.prepare("INSERT INTO login_limits (bucket, attempts, expires_at) VALUES (?,1,?) ON CONFLICT(bucket) DO UPDATE SET attempts=CASE WHEN expires_at<? THEN 1 ELSE attempts+1 END, expires_at=CASE WHEN expires_at<? THEN excluded.expires_at ELSE expires_at END RETURNING attempts")
    .bind(bucket, now + 900000, now, now).first<{ attempts: number }>();
  if (!limit || limit.attempts > 10) return "limited" as const;
  const user = await db.prepare("SELECT password_salt AS salt,password_hash AS hash FROM users WHERE id=?").bind(current.id).first<{ salt: string; hash: string }>();
  return !!user && await verifyPassword(password, user.salt, user.hash);
}

/** /api/me/account[/email|/sessions[/:id|/others]|/logins], /api/me/export and the closure routes, signed in. */
export async function account(path: string, method: string, input: unknown, current: Member, db: Database, context: AccountContext): Promise<Response> {
  const closing = closureMethods(path);
  if (closing) return closures(path, method, input, current, db, context);
  if (path === "/api/me/export") return exportMyData(current, db, await digest(context.token));
  const now = new Date(), iso = now.toISOString(), tokenHash = await digest(context.token);
  if (path === "/api/me/account") {
    const [person, pending, sessions] = await db.batch([
      db.prepare("SELECT u.username,COALESCE(u.display_name,u.username) AS displayName,CASE m.role WHEN 'instructor' THEN 'educator' ELSE m.role END AS role,u.email,COALESCE(o.name,'Happy Learners') AS organization FROM users u JOIN memberships m ON m.user_id=u.id AND m.organization_id=? JOIN organizations o ON o.id=m.organization_id WHERE u.id=?").bind(current.organizationId, current.id),
      db.prepare(`SELECT ${changeColumns} WHERE c.user_id=? AND c.status='pending' AND c.expires_at>? ORDER BY c.requested_at DESC LIMIT 1`).bind(current.id, iso),
      db.prepare("SELECT count(*) AS open FROM sessions WHERE user_id=? AND expires_at>?").bind(current.id, now.getTime()),
    ]) as unknown as [Omit<AccountOverview, "pendingEmail" | "mailConfigured" | "sessions">[], ChangeRow[], { open: number }[]];
    if (!person.length) return reply({ error: "Tu cuenta no está disponible." }, 404);
    const overview: AccountOverview = { ...person[0], pendingEmail: pending.length ? change(pending[0], iso) : null, mailConfigured: context.sender.configured, sessions: sessions[0]?.open || 0 };
    return reply({ account: overview });
  }
  if (path === "/api/me/account/email") {
    if (method === "DELETE") {
      const open = await db.prepare("SELECT id FROM email_changes WHERE user_id=? AND status='pending' AND expires_at>?").bind(current.id, iso).first<{ id: string }>();
      if (!open) return reply({ error: "No tienes un cambio de correo pendiente." }, 404);
      await db.batch([
        db.prepare("UPDATE email_changes SET status='cancelled',cancelled_at=max(?,requested_at) WHERE id=? AND status='pending'").bind(iso, open.id),
        event(db, current, { action: "withdrawn", targetType: "account", targetId: open.id, summary: "Canceló el cambio de su correo de acceso" }),
      ]);
      return reply({ ok: true });
    }
    const user = await db.prepare("SELECT email FROM users WHERE id=?").bind(current.id).first<{ email: string | null }>();
    const value = emailChangeInput(input, user?.email || null);
    if ("error" in value) return reply({ error: value.error === "email" ? "Escribe un correo válido." : value.error === "same" ? "Ese ya es tu correo de acceso." : "Escribe tu contraseña actual para confirmar que eres tú." }, 400);
    const matches = await passwordMatches(db, current, value.currentPassword);
    if (matches === "limited") return reply({ error: "Demasiados intentos. Espera 15 minutos y vuelve a intentar." }, 429);
    if (!matches) return reply({ error: "La contraseña actual no es correcta." }, 400);
    const [taken, invited] = await db.batch([
      db.prepare("SELECT 1 AS found FROM users WHERE email=? AND id<>?").bind(value.email, current.id),
      db.prepare("SELECT 1 AS found FROM invitations WHERE organization_id=? AND email=? AND status='pending' AND expires_at>?").bind(current.organizationId, value.email, iso),
    ]) as unknown as [unknown[], unknown[]];
    if (taken.length) return reply({ error: "Ya hay otra cuenta con ese correo en la organización." }, 409);
    if (invited.length) return reply({ error: "Esa dirección tiene una invitación pendiente en la organización. Usa otra o pide a administración que la revoque." }, 409);
    const id = `email-change-${crypto.randomUUID()}`, token = tokenPrefix(current.organizationId) + newToken(), expiresAt = new Date(now.getTime() + emailChangeLifetimeMs).toISOString();
    const ok = await db.guardedBatch(db.prepare("SELECT 1 WHERE NOT EXISTS (SELECT 1 FROM users WHERE email=? AND id<>?)").bind(value.email, current.id), [
      // A newer request replaces the one still pending; one already past its 24 hours is recorded as expired.
      db.prepare("UPDATE email_changes SET status=CASE WHEN expires_at<=? THEN 'expired' ELSE 'cancelled' END,cancelled_at=CASE WHEN expires_at<=? THEN NULL ELSE max(?,requested_at) END WHERE user_id=? AND status='pending'").bind(iso, iso, iso, current.id),
      db.prepare("INSERT INTO email_changes(id,organization_id,user_id,previous_email,new_email,token_hash,status,requested_at,expires_at) VALUES (?,?,?,?,?,?,'pending',?,?)")
        .bind(id, current.organizationId, current.id, user?.email || null, value.email, await digest(token), iso, expiresAt),
      // The new address stays out of the activity: it is personal data and the activity is administration's record.
      event(db, current, { action: "created", targetType: "account", targetId: id, summary: "Pidió cambiar su correo de acceso" }),
    ]);
    if (!ok) return reply({ error: "Ya hay otra cuenta con ese correo en la organización." }, 409);
    const name = current.displayName || current.username, link = linkOf(context.origin, token);
    const delivery = await sendNotice(db, context.sender, current.organizationId, { id: current.id, name, email: value.email }, id, { kind: "email_verify", username: current.username, link, expiresAt });
    if (user?.email) await sendNotice(db, context.sender, current.organizationId, { id: current.id, name, email: user.email }, `${id}:previous`, { kind: "email_change_requested", username: current.username, newEmail: value.email });
    const created = await db.prepare(`SELECT ${changeColumns} WHERE c.id=?`).bind(id).first<ChangeRow>();
    // DEC-042: when the message could not leave, the link is the documented way to finish; once sent, only the inbox has it.
    return reply({ change: change({ ...created!, delivery: delivery.status }, iso), delivery: delivery.status, ...(delivery.status === "sent" ? {} : { link }) }, 201);
  }
  if (path === "/api/me/account/sessions") {
    const rows = (await db.prepare("SELECT id,device,country,method,created_at AS createdAt,last_used_at AS lastUsedAt,expires_at AS expiresAt,(token_hash=?) AS current FROM sessions WHERE user_id=? AND expires_at>? ORDER BY current DESC,last_used_at DESC,created_at DESC LIMIT 50")
      .bind(tokenHash, current.id, now.getTime()).all<{ id: string; device: string | null; country: string | null; method: AccountSession["method"]; createdAt: number; lastUsedAt: number; expiresAt: number; current: number }>()).results;
    const sessions: AccountSession[] = rows.map(row => ({ id: row.id, device: row.device || "Dispositivo sin identificar", country: row.country, method: row.method, createdAt: msIso(row.createdAt), lastUsedAt: msIso(row.lastUsedAt), expiresAt: msIso(row.expiresAt), current: !!row.current }));
    return reply({ sessions });
  }
  if (path === "/api/me/account/sessions/others") {
    const closed = (await db.prepare("DELETE FROM sessions WHERE user_id=? AND token_hash<>? RETURNING id,expires_at AS expiresAt").bind(current.id, tokenHash).all<{ id: string; expiresAt: number }>()).results.filter(row => row.expiresAt > now.getTime());
    if (closed.length) await db.batch([
      event(db, current, { action: "revoked", targetType: "account", targetId: current.id, summary: closed.length === 1 ? "Cerró su otra sesión abierta" : `Cerró sus otras ${closed.length} sesiones abiertas` }),
      securityEvent(db, { organizationId: current.organizationId, type: "session_closed", actorId: current.id, subjectId: current.id, detail: closed.length === 1 ? "Su otra sesión abierta" : `Sus otras ${closed.length} sesiones abiertas` }),
    ]);
    return reply({ closed: closed.length });
  }
  const sessionId = sessionPath.exec(path)?.[1];
  if (sessionId) {
    const found = await db.prepare("SELECT device,(token_hash=?) AS current FROM sessions WHERE id=? AND user_id=? AND expires_at>?").bind(tokenHash, sessionId, current.id, now.getTime()).first<{ device: string | null; current: number }>();
    if (!found) return reply({ error: "Esa sesión ya no está abierta." }, 404);
    if (found.current) return reply({ error: "Esta es la sesión que estás usando. Para cerrarla, usa «Cerrar sesión» en el menú de tu perfil." }, 409);
    await db.batch([
      db.prepare("DELETE FROM sessions WHERE id=? AND user_id=?").bind(sessionId, current.id),
      event(db, current, { action: "revoked", targetType: "account", targetId: sessionId, summary: `Cerró una sesión abierta en ${found.device || "un dispositivo sin identificar"}` }),
      securityEvent(db, { organizationId: current.organizationId, type: "session_closed", actorId: current.id, subjectId: current.id, detail: `Sesión en ${found.device || "un dispositivo sin identificar"}` }),
    ]);
    return reply({ ok: true });
  }
  if (path === "/api/me/account/logins") {
    const rows = (await db.prepare("SELECT id,outcome,method,device,country,occurred_at AS occurredAt FROM sign_in_events WHERE user_id=? AND organization_id=? ORDER BY occurred_at DESC,rowid DESC LIMIT ?")
      .bind(current.id, current.organizationId, signInHistoryLimit).all<SignInRecord>()).results;
    return reply({ logins: rows, limit: signInHistoryLimit });
  }
  return reply({ error: "Ruta no disponible." }, 404);
}

const unavailable = (status: string) => status === "verified"
  ? reply({ error: "Este enlace ya se usó: el correo ya está confirmado.", code: "EMAIL_CHANGE_USED" }, 410)
  : status === "cancelled" ? reply({ error: "Este cambio de correo se canceló o lo reemplazó uno más reciente. Pide el cambio de nuevo desde tu cuenta.", code: "EMAIL_CHANGE_CANCELLED" }, 410)
  : reply({ error: "Este enlace caducó. Pide el cambio de nuevo desde tu cuenta.", code: "EMAIL_CHANGE_EXPIRED" }, 410);
const missing = () => reply({ error: "Este enlace no existe o fue reemplazado por uno más reciente.", code: "EMAIL_CHANGE_NOT_FOUND" }, 404);

type Pending = { id: string; userId: string; username: string; name: string; role: Member["role"]; previousEmail: string | null; newEmail: string; status: string; expiresAt: string; organization: string | null };
async function lookup(token: string, scope: string, db: Database) {
  if (!tokenPattern.test(token)) return null;
  return db.prepare(`SELECT c.id,c.user_id AS userId,u.username,COALESCE(u.display_name,u.username) AS name,CASE m.role WHEN 'instructor' THEN 'educator' ELSE m.role END AS role,c.previous_email AS previousEmail,c.new_email AS newEmail,c.status,c.expires_at AS expiresAt,o.name AS organization
    FROM email_changes c JOIN users u ON u.id=c.user_id JOIN memberships m ON m.user_id=u.id AND m.organization_id=c.organization_id AND m.active=1 JOIN organizations o ON o.id=c.organization_id WHERE c.token_hash=? AND c.organization_id=?`)
    .bind(await digest(token), scope).first<Pending>();
}

/**
 * GET /api/account/email/<token> (what is being confirmed) and POST (confirm it): public, so the link works in any
 * browser. GET never changes anything, so a mail scanner that opens links cannot confirm a change by itself.
 */
export async function confirmEmail(token: string, method: string, scope: string, db: Database, sender: MailSender) {
  const found = await lookup(token, scope, db);
  if (!found) return missing();
  const now = new Date().toISOString(), status = emailChangeState(found.status, found.expiresAt, now);
  if (status !== "pending") return unavailable(status);
  if (method === "GET") {
    const preview: EmailChangePreview = { organization: found.organization || "Happy Learners", username: found.username, newEmail: found.newEmail, expiresAt: found.expiresAt };
    return reply({ change: preview });
  }
  const actor: Member = { id: found.userId, username: found.username, displayName: found.name, role: found.role, organizationId: scope };
  const ok = await db.guardedBatch(db.prepare("SELECT 1 FROM email_changes c JOIN users u ON u.id=c.user_id WHERE c.id=? AND c.status='pending' AND c.expires_at>? AND u.email IS c.previous_email AND NOT EXISTS (SELECT 1 FROM users WHERE email=c.new_email AND id<>c.user_id)").bind(found.id, now), [
    db.prepare("UPDATE users SET email=? WHERE id=?").bind(found.newEmail, found.userId),
    db.prepare("UPDATE email_changes SET status='verified',verified_at=max(?,requested_at) WHERE id=?").bind(now, found.id),
    event(db, actor, { action: "updated", targetType: "account", targetId: found.id, summary: "Confirmó su nuevo correo de acceso" }),
    securityEvent(db, { organizationId: scope, type: "email_changed", outcome: "succeeded", actorId: found.userId, subjectId: found.userId }),
  ]);
  if (!ok) {
    const again = await lookup(token, scope, db);
    const state = again ? emailChangeState(again.status, again.expiresAt, new Date().toISOString()) : "cancelled";
    return state !== "pending" ? unavailable(state) : reply({ error: "Esa dirección ya la usa otra cuenta, o el correo de tu cuenta cambió desde que lo pediste. Pide el cambio de nuevo desde tu cuenta.", code: "EMAIL_CHANGE_CONFLICT" }, 409);
  }
  if (found.previousEmail) await sendNotice(db, sender, scope, { id: found.userId, name: found.name, email: found.previousEmail }, `${found.id}:changed`, { kind: "email_changed", username: found.username, newEmail: found.newEmail });
  return reply({ ok: true, email: found.newEmail, username: found.username });
}
