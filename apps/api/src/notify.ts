import type { Member } from "@happy-learners/contracts";
import type { MailSender, NotificationFacts, NotificationType } from "@happy-learners/domain";
import { maxNotificationsPerRequest, notificationDecision, notificationMessage, notificationReason, receives } from "@happy-learners/domain";
import { attempt } from "./mail";

/**
 * Sending the notifications of one request (ST-124, DEC-042). The endpoints that change something call `notify` after
 * their write succeeded; it never throws, so a mail problem never fails the change. Messages are recorded in the outbox
 * (kind 'notification') and sent while the request waits, like invitations: one retry, at most 20 per request.
 * It only needs this part of the organization's store (the Durable Object `Database` satisfies it).
 */
type Statement = { all<T>(): Promise<{ results: T[] }>; first<T>(): Promise<T | null>; run(): Promise<unknown> };
export interface NotifyStore { prepare(sql: string): { bind(...values: (string | number | null)[]): Statement }; batch(statements: Statement[]): Promise<unknown> }
type Database = NotifyStore;
export interface Notifier { origin: string; sender: MailSender }
export interface Notice { userId: string; facts: NotificationFacts; targetId: string; path: string }

type Person = { id: string; name: string; email: string | null };

export async function mandatoryTypes(db: Database, organizationId: string) {
  const rows = (await db.prepare("SELECT type FROM notification_policies WHERE organization_id=? AND mandatory=1").bind(organizationId).all<{ type: NotificationType }>()).results;
  return new Set(rows.map(row => row.type));
}
export async function preferencesOf(db: Database, organizationId: string, userIds: string[]) {
  const map = new Map<string, Partial<Record<NotificationType, boolean>>>();
  if (!userIds.length) return map;
  const rows = (await db.prepare(`SELECT user_id AS userId,type,enabled FROM notification_preferences WHERE organization_id=? AND user_id IN (${userIds.map(() => "?").join(",")})`).bind(organizationId, ...userIds).all<{ userId: string; type: NotificationType; enabled: number }>()).results;
  for (const row of rows) map.set(row.userId, { ...map.get(row.userId), [row.type]: !!row.enabled });
  return map;
}

/**
 * Records and sends the notices of one request. The actor is never notified of their own action, nor anyone who is
 * not an active member; a turned-off optional type leaves no record. Returns how many records were written.
 */
export async function notify(db: Database, notifier: Notifier | undefined, current: Member, notices: Notice[]): Promise<number> {
  if (!notifier) return 0;
  try {
    const seen = new Set<string>();
    const list = notices.filter(notice => {
      const key = `${notice.userId}|${notice.facts.type}|${notice.targetId}`;
      if (notice.userId === current.id || seen.has(key)) return false;
      seen.add(key); return true;
    });
    if (!list.length) return 0;
    const ids = [...new Set(list.map(notice => notice.userId))];
    const people = new Map((await db.prepare(`SELECT u.id,COALESCE(u.display_name,u.username) AS name,COALESCE(u.email,p.contact_email) AS email FROM users u JOIN memberships m ON m.user_id=u.id AND m.organization_id=? AND m.active=1 LEFT JOIN staff_profiles p ON p.user_id=u.id WHERE u.id IN (${ids.map(() => "?").join(",")})`)
      .bind(current.organizationId, ...ids).all<Person>()).results.map(person => [person.id, person]));
    const [mandatory, preferences] = await Promise.all([mandatoryTypes(db, current.organizationId), preferencesOf(db, current.organizationId, ids)]);
    const organization = (await db.prepare("SELECT name FROM organizations WHERE id=?").bind(current.organizationId).first<{ name: string | null }>())?.name || "Happy Learners";
    const day = new Date().toISOString().slice(0, 10);
    const sentToday = (await db.prepare("SELECT count(*) AS sent FROM mail_outbox WHERE organization_id=? AND status='sent' AND sent_at>=?").bind(current.organizationId, `${day}T00:00:00.000Z`).first<{ sent: number }>())?.sent || 0;
    const now = new Date().toISOString();
    const pending: { id: string; message: ReturnType<typeof notificationMessage> }[] = [];
    const inserts = [];
    let sending = 0;
    for (const notice of list) {
      const person = people.get(notice.userId);
      const type = notice.facts.type;
      if (!person || !receives(type, preferences.get(person.id) || {}, mandatory)) continue;
      const required = mandatory.has(type), reason = notificationReason(notice.facts);
      const message = notificationMessage(person.email || "", { type, organization, recipientName: person.name, reason, link: `${notifier.origin}${notice.path}`, mandatory: required, preferencesLink: `${notifier.origin}/perfil#notificaciones` });
      const decision = notificationDecision({ address: person.email, configured: notifier.sender.configured, sentToday: sentToday + sending, mandatory: required, sentInRequest: sending });
      const status = decision === "send" ? "queued" : decision;
      const error = decision === "not_configured" ? "El envío de correo no está configurado."
        : decision === "no_address" ? "La persona no tiene correo de acceso ni de contacto."
        : decision === "deferred" ? (sending >= maxNotificationsPerRequest ? `Se superó el máximo de ${maxNotificationsPerRequest} correos por solicitud.` : `Se alcanzó el tope diario de correos${required ? " (aviso obligatorio)" : " para avisos opcionales"}.`) : null;
      const id = `mail-${crypto.randomUUID()}`;
      inserts.push(db.prepare("INSERT INTO mail_outbox(id,organization_id,kind,reference_id,recipient,subject,status,attempts,last_error,created_at,user_id,notification_type,reason,mandatory) VALUES (?,?,'notification',?,?,?,?,0,?,?,?,?,?,?)")
        .bind(id, current.organizationId, `${type}:${notice.targetId}`.slice(0, 200), person.email || "", message.subject, status, error, now, person.id, type, reason, required ? 1 : 0));
      if (decision === "send") { sending++; pending.push({ id, message }); }
    }
    if (inserts.length) await db.batch(inserts);
    for (const item of pending) {
      const { result, attempts } = await attempt(notifier.sender, item.message);
      await db.prepare("UPDATE mail_outbox SET status=?,attempts=?,last_error=?,sent_at=?,provider_id=? WHERE id=?")
        .bind(result.ok ? "sent" : "failed", attempts, result.ok ? null : result.error, result.ok ? new Date().toISOString() : null, result.ok ? result.id || null : null, item.id).run();
    }
    return inserts.length;
  } catch (error) {
    console.error(JSON.stringify({ event: "notification_failed", cause: error instanceof Error ? `${error.name}: ${error.message}`.slice(0, 240) : "Unknown error" }));
    return 0;
  }
}

