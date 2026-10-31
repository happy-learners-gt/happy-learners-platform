import type { Member } from "@happy-learners/contracts";
import { acceptablePassword, accountInput, maxPasswordLength } from "@happy-learners/domain";
import type { Database } from "./storage";
import { digest, hashPassword, newTemporaryPassword, verifyPassword } from "./auth";
import { event } from "./activity";
import { startOnboarding } from "./onboarding";
import { sendNotice } from "./account-notices";
import { notify, type Notifier } from "./notify";

const reply = (value: unknown, status = 200) => Response.json(value, { status });
const roleName = (role: string) => role === "admin" ? "Administración" : "Educador";

/**
 * POST /api/members — administration creates an account with a name, username and role (ST-093).
 * The temporary password is in this response only: it is never stored, logged or written to the activity.
 * `taken` asks every organization, since the username decides where its owner signs in.
 */
export async function createAccount(input: unknown, current: Member, db: Database, taken: (username: string) => Promise<boolean>) {
  const account = accountInput(input);
  if (!account) return reply({ error: "Escribe un nombre de 2 a 80 caracteres, un usuario de 3 a 32 letras minúsculas, números, puntos o guiones y elige un rol." }, 400);
  const unavailable = reply({ error: `El usuario «${account.username}» ya existe. Elige otro.` }, 409);
  if (await taken(account.username)) return unavailable;
  const id = `user-${crypto.randomUUID()}`, temporaryPassword = newTemporaryPassword(), { salt, hash } = await hashPassword(temporaryPassword);
  const ok = await db.guardedBatch(db.prepare("SELECT 1 WHERE NOT EXISTS (SELECT 1 FROM users WHERE username=?)").bind(account.username), [
    db.prepare("INSERT INTO users(id,username,password_salt,password_hash,display_name,must_change_password) VALUES (?,?,?,?,?,1)").bind(id, account.username, salt, hash, account.displayName),
    db.prepare("INSERT INTO memberships(user_id,organization_id,role,active) VALUES (?,?,?,1)").bind(id, current.organizationId, account.role === "educator" ? "instructor" : "admin"),
    db.prepare("INSERT INTO role_events VALUES (?,?,?,?,?,?)").bind(crypto.randomUUID(), current.id, id, account.role, 1, new Date().toISOString()),
    // ST-122: a new account goes through the guided onboarding on its first sign-in.
    startOnboarding(db, id, current.organizationId, new Date().toISOString()),
    event(db, current, { action: "created", targetType: "account", targetId: id, summary: `Creó la cuenta de ${account.displayName} (@${account.username}) con rol ${roleName(account.role)}` }),
  ]);
  if (!ok) return unavailable;
  return reply({ member: { id, username: account.username, displayName: account.displayName, role: account.role, organizationId: current.organizationId, active: true }, temporaryPassword }, 201);
}

/** POST /api/members/:id/password — a new temporary password, shown once; the person's open sessions close. */
export async function resetPassword(id: string, current: Member, db: Database, notifier?: Notifier) {
  if (id === current.id) return reply({ error: "Tu propia contraseña no se restablece desde aquí." }, 409);
  if (id === "user-0") return reply({ error: "La cuenta administradora inicial conserva su acceso." }, 409);
  const target = await db.prepare("SELECT COALESCE(u.display_name,u.username) AS name FROM users u JOIN memberships m ON m.user_id=u.id WHERE u.id=? AND m.organization_id=?").bind(id, current.organizationId).first<{ name: string }>();
  if (!target) return reply({ error: "Miembro no disponible." }, 404);
  const temporaryPassword = newTemporaryPassword(), { salt, hash } = await hashPassword(temporaryPassword);
  await db.batch([
    db.prepare("UPDATE users SET password_salt=?,password_hash=?,must_change_password=1 WHERE id=?").bind(salt, hash, id),
    db.prepare("DELETE FROM sessions WHERE user_id=?").bind(id),
    event(db, current, { action: "reset", targetType: "account", targetId: id, summary: `Restableció la contraseña de ${target.name}` }),
  ]);
  // ST-161: an account notice, mandatory on every channel.
  await notify(db, notifier, current, [{ userId: id, facts: { type: "account_security", change: "password_reset" }, targetId: id, path: "/inicio" }]);
  return reply({ temporaryPassword });
}

/**
 * POST /api/account/password — the signed-in person replaces their password; required after a temporary one.
 * Their other sessions close; this one stays open. ST-158: the sign-in e-mail, when there is one, gets a mandatory
 * security notice (not for the first change of a temporary password: that one was given by administration).
 */
export async function changePassword(input: unknown, current: Member, token: string, db: Database, notifier?: Notifier) {
  const value = input as Record<string, unknown> | null;
  if (!value || typeof value.currentPassword !== "string" || value.currentPassword.length > maxPasswordLength) return reply({ error: "Escribe tu contraseña actual." }, 400);
  const user = await db.prepare("SELECT password_salt AS salt,password_hash AS hash FROM users WHERE id=?").bind(current.id).first<{ salt: string; hash: string }>();
  if (!user || !(await verifyPassword(value.currentPassword, user.salt, user.hash))) return reply({ error: "La contraseña actual no es correcta." }, 400);
  if (!acceptablePassword(value.newPassword, current.username, value.currentPassword))
    return reply({ error: "Usa de 12 a 128 caracteres variados, distintos de tu usuario y de la contraseña actual." }, 400);
  const { salt, hash } = await hashPassword(value.newPassword);
  await db.batch([
    db.prepare("UPDATE users SET password_salt=?,password_hash=?,must_change_password=0 WHERE id=?").bind(salt, hash, current.id),
    db.prepare("DELETE FROM sessions WHERE user_id=? AND token_hash<>?").bind(current.id, await digest(token)),
    event(db, current, { action: "updated", targetType: "account", targetId: current.id, summary: "Cambió su contraseña" }),
  ]);
  // ST-158 and ST-161: the owner hears of every change of their own password, except when replacing a temporary one.
  // The bell always shows it (account_security, mandatory). The e-mail goes once: as the account's security notice
  // (kind 'account') to the sign-in address when there is one; otherwise through `notify`, to the contact address or
  // recorded as 'no_address'.
  if (!current.mustChangePassword) {
    const address = notifier ? await db.prepare("SELECT email FROM users WHERE id=?").bind(current.id).first<{ email: string | null }>() : null;
    if (notifier && address?.email) await sendNotice(db, notifier.sender, current.organizationId, { id: current.id, name: current.displayName || current.username, email: address.email }, `password:${current.id}`, { kind: "password_changed", username: current.username });
    await notify(db, notifier, current, [{ userId: current.id, facts: { type: "account_security", change: "password_changed" }, targetId: current.id, path: "/cuenta", ...(address?.email ? { email: false as const } : {}) }]);
  }
  return reply({ ok: true });
}
