import type { Invitation, InvitationPreview, Member } from "@happy-learners/contracts";
import type { AccountRole, MailSender } from "@happy-learners/domain";
import { acceptablePassword, invitationInput, invitationLifetimeMs, invitationMessage, invitationState, maxPasswordLength, roleLabel, tokenPattern, tokenPrefix, usernamePattern } from "@happy-learners/domain";
import type { Database } from "./storage";
import type { PasswordCheck } from "./sign-in";
import { digest, hashPassword, newToken } from "./auth";
import { deliver, type Delivery } from "./mail";
import { event } from "./activity";
import { startOnboarding } from "./onboarding";
import { openSession, type Client } from "./account";
import { contractSignedNameInput, localDay, record } from "@happy-learners/domain";
import { insertDraft, invitationOffer, memberSigns, organizationSigns, prepareContract } from "./contracts";

/**
 * Invitations by e-mail (ST-121, DEC-042). The link carries a 256-bit secret whose first letter names the
 * organization's store, like session tokens; only its SHA-256 is kept. The link is returned to administration so it
 * can be copied and shared when the message cannot be sent. Tokens and links never reach the activity or the logs.
 */
export const acceptPath = /^\/api\/invitations\/accept\/([a-z]_[a-f0-9]{64})$/;
const reply = (value: unknown, status = 200) => Response.json(value, { status });
const linkOf = (origin: string, token: string) => `${origin}/invitacion/${token}`;
const newSecret = (organizationId: string) => tokenPrefix(organizationId) + newToken();

type Row = { id: string; email: string; displayName: string; role: AccountRole; status: Invitation["status"]; expiresAt: string; createdAt: string; invitedBy: string; acceptedAt: string | null; delivery: Invitation["delivery"]; deliveryError: string | null; sentAt: string | null; contractId: string | null; contractTitle: string | null; contractStatus: string | null };
const columns = `i.id,i.email,i.display_name AS displayName,i.role,CASE WHEN i.status='pending' AND i.expires_at<=? THEN 'expired' ELSE i.status END AS status,i.expires_at AS expiresAt,i.created_at AS createdAt,
  COALESCE(u.display_name,u.username) AS invitedBy,i.accepted_at AS acceptedAt,o.status AS delivery,CASE WHEN o.status='failed' THEN o.last_error END AS deliveryError,o.sent_at AS sentAt,
  k.id AS contractId,k.title AS contractTitle,k.status AS contractStatus
  FROM invitations i JOIN users u ON u.id=i.invited_by
  LEFT JOIN contracts k ON k.id=(SELECT id FROM contracts WHERE invitation_id=i.id ORDER BY created_at DESC LIMIT 1)
  LEFT JOIN mail_outbox o ON o.id=(SELECT id FROM mail_outbox WHERE reference_id=i.id ORDER BY created_at DESC,rowid DESC LIMIT 1)`;
const one = (db: Database, id: string, organizationId: string) => db.prepare(`SELECT ${columns} WHERE i.id=? AND i.organization_id=?`).bind(new Date().toISOString(), id, organizationId).first<Row>();

async function send(db: Database, sender: MailSender, current: Member, invitation: { id: string; email: string; displayName: string; role: AccountRole; expiresAt: string }, link: string): Promise<Delivery> {
  const organization = await db.prepare("SELECT name,timezone FROM organizations WHERE id=?").bind(current.organizationId).first<{ name: string | null; timezone: string | null }>();
  const message = invitationMessage(invitation.email, {
    organization: organization?.name || "Happy Learners", displayName: invitation.displayName, role: invitation.role,
    inviter: current.displayName || current.username, link, expiresAt: invitation.expiresAt, timezone: organization?.timezone || "America/Guatemala",
  });
  return deliver(db, sender, current.organizationId, "invitation", invitation.id, message);
}

/** /api/invitations[/:id/(resend|revoke)] — administration only. */
export async function invitations(path: string, method: string, input: unknown, origin: string, current: Member, db: Database, sender: MailSender) {
  if (current.role !== "admin") return reply({ error: "Solo administración invita a nuevas personas." }, 403);
  const now = new Date();
  if (method === "GET") {
    const rows = (await db.prepare(`SELECT ${columns} WHERE i.organization_id=? ORDER BY i.created_at DESC LIMIT 100`).bind(now.toISOString(), current.organizationId).all<Row>()).results;
    return reply({ invitations: rows satisfies Invitation[], mailConfigured: sender.configured });
  }
  if (path === "/api/invitations") {
    const value = invitationInput(input);
    if (!value) return reply({ error: "Escribe un correo válido, un nombre de 2 a 80 caracteres y elige un rol." }, 400);
    // DEC-046: the contract the person must sign to join; required for educators where the organization asks for one.
    const organization = await db.prepare("SELECT name,timezone,locale,contract_required AS required FROM organizations WHERE id=?").bind(current.organizationId).first<{ name: string | null; timezone: string | null; locale: string | null; required: number }>();
    const offer = record(record(input)?.contract);
    if (!offer && organization?.required && value.role === "educator") return reply({ error: "Esta organización exige un contrato: elige la plantilla y sus condiciones.", code: "CONTRACT_REQUIRED" }, 400);
    const contract = offer ? await prepareContract(db, current, { name: organization?.name || null, locale: organization?.locale || null }, offer, { name: value.displayName, email: value.email }, localDay(organization?.timezone || "America/Guatemala")) : null;
    if (contract instanceof Response) return contract;
    if (await db.prepare("SELECT 1 AS found FROM users WHERE email=?").bind(value.email).first()) return reply({ error: "Ya hay una cuenta con ese correo en la organización." }, 409);
    // An expired invitation for the same address no longer blocks a new one.
    await db.prepare("UPDATE invitations SET status='expired' WHERE organization_id=? AND email=? AND status='pending' AND expires_at<=?").bind(current.organizationId, value.email, now.toISOString()).run();
    const id = `invitation-${crypto.randomUUID()}`, token = newSecret(current.organizationId), expiresAt = new Date(now.getTime() + invitationLifetimeMs).toISOString();
    const contractId = `contract-${crypto.randomUUID()}`;
    const signed = contract ? await organizationSigns(db, current, { id: contractId, templateVersionId: contract.versionId, ...contract }, record(input)?.signature, now.toISOString()) : [];
    if (signed instanceof Response) return signed;
    const ok = await db.guardedBatch(db.prepare("SELECT 1 WHERE NOT EXISTS (SELECT 1 FROM invitations WHERE organization_id=? AND email=? AND status='pending') AND NOT EXISTS (SELECT 1 FROM users WHERE email=?)").bind(current.organizationId, value.email, value.email), [
      db.prepare("INSERT INTO invitations(id,organization_id,email,display_name,role,token_hash,expires_at,status,invited_by,created_at) VALUES (?,?,?,?,?,?,?,'pending',?,?)")
        .bind(id, current.organizationId, value.email, value.displayName, value.role, await digest(token), expiresAt, current.id, now.toISOString()),
      ...(contract ? [insertDraft(db, current, contractId, contract, { userId: null, invitationId: id, supersedesId: null }, now.toISOString()), ...signed] : []),
      event(db, current, { action: "created", targetType: "invitation", targetId: id, summary: `Invitó a ${value.displayName} con rol ${roleLabel(value.role)}${contract ? ` y el contrato «${contract.title}»` : ""}` }),
    ]);
    if (!ok) return reply({ error: "Esa dirección ya tiene una invitación pendiente. Reenvíala desde la lista." }, 409);
    const delivery = await send(db, sender, current, { id, ...value, expiresAt }, linkOf(origin, token));
    return reply({ invitation: await one(db, id, current.organizationId), link: linkOf(origin, token), delivery: delivery.status }, 201);
  }
  const [, , , id, action] = path.split("/");
  const found = await db.prepare("SELECT id,email,display_name AS displayName,role,status FROM invitations WHERE id=? AND organization_id=?").bind(id, current.organizationId).first<{ id: string; email: string; displayName: string; role: AccountRole; status: string }>();
  if (!found) return reply({ error: "Invitación no disponible." }, 404);
  if (found.status === "accepted" || found.status === "revoked") return reply({ error: found.status === "accepted" ? "Esta invitación ya fue aceptada." : "Esta invitación fue revocada." }, 409);
  if (action === "revoke") {
    await db.batch([
      db.prepare("UPDATE invitations SET status='revoked' WHERE id=? AND status IN ('pending','expired')").bind(id),
      db.prepare("UPDATE contracts SET status='voided',closed_at=?,closed_by=?,close_reason='Invitación revocada',updated_at=? WHERE invitation_id=? AND status IN ('draft','sent')").bind(now.toISOString(), current.id, now.toISOString(), id),
      event(db, current, { action: "revoked", targetType: "invitation", targetId: id, summary: `Revocó la invitación de ${found.displayName}` }),
    ]);
    return reply({ invitation: await one(db, id, current.organizationId) });
  }
  // Resending issues a new link (the previous one stops working) and gives it the full lifetime again.
  if (await db.prepare("SELECT 1 AS found FROM users WHERE email=?").bind(found.email).first()) return reply({ error: "Ya hay una cuenta con ese correo en la organización." }, 409);
  const token = newSecret(current.organizationId), expiresAt = new Date(now.getTime() + invitationLifetimeMs).toISOString();
  const ok = await db.guardedBatch(db.prepare("SELECT 1 WHERE NOT EXISTS (SELECT 1 FROM invitations WHERE organization_id=? AND email=? AND status='pending' AND id<>?)").bind(current.organizationId, found.email, id), [
    db.prepare("UPDATE invitations SET token_hash=?,expires_at=?,status='pending' WHERE id=? AND status IN ('pending','expired')").bind(await digest(token), expiresAt, id),
    event(db, current, { action: "resent", targetType: "invitation", targetId: id, summary: `Reenvió la invitación de ${found.displayName}` }),
  ]);
  if (!ok) return reply({ error: "Esa dirección ya tiene otra invitación pendiente." }, 409);
  const delivery = await send(db, sender, current, { ...found, expiresAt }, linkOf(origin, token));
  return reply({ invitation: await one(db, id, current.organizationId), link: linkOf(origin, token), delivery: delivery.status });
}

const unavailable = (status: string) => status === "accepted"
  ? reply({ error: "Esta invitación ya se usó. Inicia sesión con tu usuario.", code: "INVITATION_USED" }, 410)
  : status === "revoked" ? reply({ error: "Esta invitación fue revocada. Pide a administración una nueva.", code: "INVITATION_REVOKED" }, 410)
  : reply({ error: "Esta invitación caducó. Pide a administración que te la reenvíe.", code: "INVITATION_EXPIRED" }, 410);
const missing = () => reply({ error: "Esta invitación no existe o fue reemplazada por un enlace más reciente.", code: "INVITATION_NOT_FOUND" }, 404);

type Pending = { id: string; organizationId: string; email: string; displayName: string; role: AccountRole; status: string; expiresAt: string; invitedBy: string; organization: string | null };
async function lookup(token: string, scope: string, db: Database) {
  if (!tokenPattern.test(token)) return null;
  return db.prepare("SELECT i.id,i.organization_id AS organizationId,i.email,i.display_name AS displayName,i.role,i.status,i.expires_at AS expiresAt,i.invited_by AS invitedBy,o.name AS organization FROM invitations i JOIN organizations o ON o.id=i.organization_id WHERE i.token_hash=? AND i.organization_id=?")
    .bind(await digest(token), scope).first<Pending>();
}

/** GET /api/invitations/accept/<token> — public: what the invitation offers, or why it no longer works. */
export async function previewInvitation(token: string, scope: string, db: Database) {
  const found = await lookup(token, scope, db);
  if (!found) return missing();
  const status = invitationState(found.status, found.expiresAt, new Date().toISOString());
  if (status !== "pending") return unavailable(status);
  const preview: InvitationPreview = { organization: found.organization || "Happy Learners", displayName: found.displayName, email: found.email, role: found.role, expiresAt: found.expiresAt, contract: await invitationOffer(db, found.id) };
  return reply({ invitation: preview });
}

/**
 * POST /api/invitations/accept/<token> {username, password} — public: creates the account with the invited role and
 * the password the person chooses, marks the invitation used and opens a session. Returns the session token so the
 * caller can set the cookie.
 */
export async function acceptInvitation(token: string, input: unknown, scope: string, db: Database, taken: (username: string) => Promise<boolean>, client: Client = { device: "Navegador desconocido", country: null }, check?: PasswordCheck): Promise<{ response: Response; session?: string }> {
  const found = await lookup(token, scope, db);
  if (!found) return { response: missing() };
  const now = new Date();
  const status = invitationState(found.status, found.expiresAt, now.toISOString());
  if (status !== "pending") return { response: unavailable(status) };
  const value = input as Record<string, unknown> | null;
  const username = typeof value?.username === "string" ? value.username.trim().toLowerCase() : "";
  if (!usernamePattern.test(username)) return { response: reply({ error: "Elige un usuario de 3 a 32 letras minúsculas, números, puntos o guiones." }, 400) };
  if (typeof value?.password !== "string" || value.password.length > maxPasswordLength || !acceptablePassword(value.password, username))
    return { response: reply({ error: "Usa una contraseña de 12 a 128 caracteres variados, distinta de tu usuario." }, 400) };
  // ST-134: the organization's password policy.
  const rejected = check ? await check(value.password, username) : null;
  if (rejected) return { response: reply({ error: rejected, code: "PASSWORD_REJECTED" }, 400) };
  const taken409 = reply({ error: `El usuario «${username}» ya existe. Elige otro.` }, 409);
  if (await taken(username)) return { response: taken409 };
  // DEC-046: an invitation with a contract is accepted by signing it; the account and the signature are one step.
  const offer = await invitationOffer(db, found.id);
  const signedName = offer ? contractSignedNameInput(record(value?.signature)?.fullName) : null;
  if (offer && (!signedName || record(value?.signature)?.accept !== true)) return { response: reply({ error: "Lee el contrato, marca que lo aceptas y escribe tu nombre completo para firmarlo.", code: "CONTRACT_SIGNATURE_REQUIRED" }, 400) };
  const id = `user-${crypto.randomUUID()}`, { salt, hash } = await hashPassword(value.password), at = now.toISOString();
  const session = tokenPrefix(scope) + newToken();
  const actor: Member = { id, username, displayName: found.displayName, role: found.role, organizationId: found.organizationId };
  const ok = await db.guardedBatch(db.prepare("SELECT 1 FROM invitations WHERE id=? AND status='pending' AND expires_at>? AND NOT EXISTS (SELECT 1 FROM users WHERE username=? OR email=?)").bind(found.id, at, username, found.email), [
    db.prepare("INSERT INTO users(id,username,password_salt,password_hash,display_name,must_change_password,email) VALUES (?,?,?,?,?,0,?)").bind(id, username, salt, hash, found.displayName, found.email),
    db.prepare("INSERT INTO memberships(user_id,organization_id,role,active) VALUES (?,?,?,1)").bind(id, found.organizationId, found.role === "educator" ? "instructor" : "admin"),
    db.prepare("INSERT INTO role_events VALUES (?,?,?,?,?,?)").bind(crypto.randomUUID(), found.invitedBy, id, found.role, 1, at),
    db.prepare("UPDATE invitations SET status='accepted',accepted_at=?,accepted_user_id=? WHERE id=?").bind(at, id, found.id),
    startOnboarding(db, id, found.organizationId, at),
    ...(offer ? await memberSigns(db, found.organizationId, { id: offer.id, documentSha256: offer.documentSha256, supersedesId: null }, id, username, signedName!, at) : []),
    // ST-158: the first session of the account, with its device and country, opens the sign-in history.
    ...openSession(db, await digest(session), id, found.organizationId, "invitation", client, now.getTime()),
    event(db, actor, { action: "accepted", targetType: "invitation", targetId: found.id, summary: `Aceptó la invitación y creó su cuenta (@${username}) con rol ${roleLabel(found.role)}` }),
  ]);
  if (!ok) {
    const again = await lookup(token, scope, db);
    const state = again ? invitationState(again.status, again.expiresAt, new Date().toISOString()) : "pending";
    return { response: state !== "pending" ? unavailable(state) : taken409 };
  }
  return { response: reply({ ok: true, member: { id, username, displayName: found.displayName, role: found.role, organizationId: found.organizationId } }, 201), session };
}
