import type { Member } from "@happy-learners/contracts";
import type { ChannelPreferences, DeliverySettings, EmailFrequency, MailSender, NotificationFacts, NotificationType } from "@happy-learners/domain";
import { defaultDeliverySettings, digestMessage, digestReason, emailPlan, isSystemType, localeWeekStart, lockedBy, maxNotificationsPerRequest, notificationDecision, notificationMessage, notificationReason, receivesOn } from "@happy-learners/domain";
import { attempt } from "./mail";

/**
 * Sending the notifications of one request (ST-124, ST-161, DEC-042). The endpoints that change something call `notify`
 * after their write succeeded; it never throws, so a mail problem never fails the change. Each notice reaches the
 * person's bell (in-app inbox) and their e-mail, on the channels they keep on. E-mail is recorded in the outbox (kind
 * 'notification'): sent while the request waits, like invitations (one retry, at most 20 per request), or `scheduled`
 * for the person's digest or the end of their quiet hours; `deliverScheduled` sends those later, on a later access.
 * It only needs this part of the organization's store (the Durable Object `Database` satisfies it).
 */
type Statement = { all<T>(): Promise<{ results: T[] }>; first<T>(): Promise<T | null>; run(): Promise<unknown> };
export interface NotifyStore { prepare(sql: string): { bind(...values: (string | number | null)[]): Statement }; batch(statements: Statement[]): Promise<unknown> }
type Database = NotifyStore;
export interface Notifier { origin: string; sender: MailSender }
/** `email: false` leaves only the bell: the caller already sent that e-mail as an account notice (ST-158, kind 'account'). */
export interface Notice { userId: string; facts: NotificationFacts; targetId: string; path: string; email?: false }

type Person = { id: string; name: string; email: string | null; timezone?: string | null; locale?: string | null; weekStart?: number | null; frequency?: EmailFrequency | null; digestTime?: string | null; quietStart?: string | null; quietEnd?: string | null };
/** Where the preferences page lives: the e-mails link to it. */
export const preferencesPath = "/mi-cuenta/notificaciones";

export async function mandatoryTypes(db: Database, organizationId: string) {
  const rows = (await db.prepare("SELECT type FROM notification_policies WHERE organization_id=? AND mandatory=1").bind(organizationId).all<{ type: NotificationType }>()).results;
  return new Set(rows.map(row => row.type));
}
/** Each person's choices per type and channel; rows from before ST-161 had no channel and were about e-mail. */
export async function preferencesOf(db: Database, organizationId: string, userIds: string[]) {
  const map = new Map<string, ChannelPreferences>();
  if (!userIds.length) return map;
  const rows = (await db.prepare(`SELECT user_id AS userId,type,channel,enabled FROM notification_preferences WHERE organization_id=? AND user_id IN (${userIds.map(() => "?").join(",")})`).bind(organizationId, ...userIds)
    .all<{ userId: string; type: NotificationType; channel?: "in_app" | "email"; enabled: number }>()).results;
  for (const row of rows) {
    const mine = map.get(row.userId) || {};
    mine[row.type] = { ...mine[row.type], [row.channel || "email"]: !!row.enabled };
    map.set(row.userId, mine);
  }
  return map;
}
/** The active members among `ids`, with their address, their zone and how they want e-mail (ST-161). */
export async function recipients(db: Database, organizationId: string, ids: string[]) {
  if (!ids.length) return new Map<string, Person>();
  const rows = (await db.prepare(`SELECT u.id,COALESCE(u.display_name,u.username) AS name,COALESCE(u.email,p.contact_email) AS email,COALESCE(up.timezone,o.timezone) AS timezone,COALESCE(up.locale,o.locale) AS locale,up.week_start AS weekStart,
    ns.email_frequency AS frequency,ns.digest_time AS digestTime,ns.quiet_start AS quietStart,ns.quiet_end AS quietEnd
    FROM users u JOIN memberships m ON m.user_id=u.id AND m.organization_id=? AND m.active=1 LEFT JOIN staff_profiles p ON p.user_id=u.id LEFT JOIN organizations o ON o.id=m.organization_id
    LEFT JOIN user_preferences up ON up.user_id=u.id LEFT JOIN notification_settings ns ON ns.user_id=u.id WHERE u.id IN (${ids.map(() => "?").join(",")})`)
    .bind(organizationId, ...ids).all<Person>()).results;
  return new Map(rows.map(person => [person.id, person]));
}
export const deliveryOf = (person: Pick<Person, "frequency" | "digestTime" | "quietStart" | "quietEnd">): DeliverySettings => ({
  frequency: person.frequency || defaultDeliverySettings.frequency, digestTime: person.digestTime || defaultDeliverySettings.digestTime,
  quietHours: person.quietStart && person.quietEnd ? { start: person.quietStart, end: person.quietEnd } : null,
});
const zoneOf = (person: Person) => person.timezone || "UTC";
const weekStartOf = (person: Person) => person.weekStart || localeWeekStart(person.locale || "es");
const sentSince = async (db: Database, organizationId: string, now: Date) => (await db.prepare("SELECT count(*) AS sent FROM mail_outbox WHERE organization_id=? AND status='sent' AND sent_at>=?")
  .bind(organizationId, `${now.toISOString().slice(0, 10)}T00:00:00.000Z`).first<{ sent: number }>())?.sent || 0;
const organizationName = async (db: Database, organizationId: string) => (await db.prepare("SELECT name FROM organizations WHERE id=?").bind(organizationId).first<{ name: string | null }>())?.name || "Acervum";
const errorOf = (decision: string, mandatory: boolean, sending: number) => decision === "not_configured" ? "El envío de correo no está configurado."
  : decision === "no_address" ? "La persona no tiene correo de acceso ni de contacto."
  : decision === "deferred" ? (sending >= maxNotificationsPerRequest ? `Se superó el máximo de ${maxNotificationsPerRequest} correos por solicitud.` : `Se alcanzó el tope diario de correos${mandatory ? " (aviso obligatorio)" : " para avisos opcionales"}.`) : null;

/**
 * Records and sends the notices of one request. The actor is never notified of their own action (except the account
 * notices, which exist precisely for that), nor anyone who is not an active member; a channel turned off leaves no
 * record on it. Returns how many e-mail records were written.
 */
export async function notify(db: Database, notifier: Notifier | undefined, current: Member, notices: Notice[]): Promise<number> {
  if (!notifier) return 0;
  try {
    const seen = new Set<string>();
    const list = notices.filter(notice => {
      const key = `${notice.userId}|${notice.facts.type}|${notice.targetId}`;
      if ((notice.userId === current.id && !isSystemType(notice.facts.type)) || seen.has(key)) return false;
      seen.add(key); return true;
    });
    if (!list.length) return 0;
    const ids = [...new Set(list.map(notice => notice.userId))];
    const people = await recipients(db, current.organizationId, ids);
    const [mandatory, preferences] = await Promise.all([mandatoryTypes(db, current.organizationId), preferencesOf(db, current.organizationId, ids)]);
    const organization = await organizationName(db, current.organizationId);
    const now = new Date(), stamp = now.toISOString();
    const sentToday = await sentSince(db, current.organizationId, now);
    const pending: { id: string; message: ReturnType<typeof notificationMessage> }[] = [];
    const inserts = [], inbox = [];
    let sending = 0;
    for (const notice of list) {
      const person = people.get(notice.userId);
      const type = notice.facts.type;
      if (!person) continue;
      const mine = preferences.get(person.id) || {}, required = !!lockedBy(type, mandatory), reason = notificationReason(notice.facts);
      if (receivesOn(type, "in_app", mine, mandatory)) inbox.push(db.prepare("INSERT INTO notification_inbox(id,organization_id,user_id,type,reason,path,mandatory,created_at) VALUES (?,?,?,?,?,?,?,?)")
        .bind(`inbox-${crypto.randomUUID()}`, current.organizationId, person.id, type, reason, notice.path.slice(0, 300), required ? 1 : 0, stamp));
      if (notice.email === false || !receivesOn(type, "email", mine, mandatory)) continue;
      const plan = emailPlan({ mandatory: required, settings: deliveryOf(person), zone: zoneOf(person), weekStart: weekStartOf(person), now });
      if (plan.action === "skip") continue;
      const message = notificationMessage(person.email || "", { type, organization, recipientName: person.name, reason, link: `${notifier.origin}${notice.path}`, mandatory: required, preferencesLink: `${notifier.origin}${preferencesPath}` });
      const decision = plan.action === "schedule" ? (person.email ? "scheduled" : "no_address")
        : notificationDecision({ address: person.email, configured: notifier.sender.configured, sentToday: sentToday + sending, mandatory: required, sentInRequest: sending });
      const status = decision === "send" ? "queued" : decision;
      const id = `mail-${crypto.randomUUID()}`;
      inserts.push(db.prepare("INSERT INTO mail_outbox(id,organization_id,kind,reference_id,recipient,subject,status,attempts,last_error,created_at,user_id,notification_type,reason,mandatory,deliver_after,path) VALUES (?,?,'notification',?,?,?,?,0,?,?,?,?,?,?,?,?)")
        .bind(id, current.organizationId, `${type}:${notice.targetId}`.slice(0, 200), person.email || "", message.subject, status, errorOf(decision, required, sending), stamp, person.id, type, reason, required ? 1 : 0,
          plan.action === "schedule" && person.email ? plan.at.toISOString() : null, notice.path.slice(0, 300)));
      if (decision === "send") { sending++; pending.push({ id, message }); }
    }
    if (inserts.length || inbox.length) await db.batch([...inserts, ...inbox]);
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

/** The store looks for due e-mail at most this often; there is no scheduled trigger (see DEC-045 in the API README). */
export const scheduleIntervalMs = 5 * 60_000;
/** Bell notices are kept this long. */
export const inboxDays = 180;
type Due = { id: string; userId: string; type: NotificationType; reason: string; path: string | null; createdAt: string };

/**
 * Sends the scheduled e-mail that is due (ST-161): per person, one notice alone goes as itself and several go together
 * as one digest message (kind 'digest'; the notices it includes become 'digested'). Optional limits apply as for any
 * notice (DEC-042): what does not fit today's cap stays scheduled for a later access. Runs at most every five minutes
 * per organization (the first caller claims the run); never throws. Returns how many messages it wrote.
 */
export async function deliverScheduled(db: Database, notifier: Notifier, organizationId: string, now = new Date()): Promise<number> {
  try {
    const stamp = now.toISOString();
    const claimed = await db.prepare("INSERT INTO mail_schedule_runs(organization_id,ran_at) VALUES (?,?) ON CONFLICT(organization_id) DO UPDATE SET ran_at=excluded.ran_at WHERE mail_schedule_runs.ran_at<=? RETURNING ran_at")
      .bind(organizationId, stamp, new Date(now.getTime() - scheduleIntervalMs).toISOString()).first<{ ran_at: string }>();
    if (!claimed) return 0;
    await db.prepare("DELETE FROM notification_inbox WHERE organization_id=? AND created_at<?").bind(organizationId, new Date(now.getTime() - inboxDays * 86_400_000).toISOString()).run();
    const due = (await db.prepare("SELECT id,user_id AS userId,notification_type AS type,reason,path,created_at AS createdAt FROM mail_outbox WHERE organization_id=? AND kind='notification' AND status='scheduled' AND deliver_after<=? ORDER BY user_id,created_at,rowid LIMIT 500")
      .bind(organizationId, stamp).all<Due>()).results;
    if (!due.length) return 0;
    const byPerson = new Map<string, Due[]>();
    for (const item of due) byPerson.set(item.userId, [...(byPerson.get(item.userId) || []), item]);
    const people = await recipients(db, organizationId, [...byPerson.keys()]);
    const organization = await organizationName(db, organizationId);
    let sentToday = await sentSince(db, organizationId, now), written = 0;
    const link = (path: string | null) => `${notifier.origin}${path || "/inicio"}`, preferencesLink = `${notifier.origin}${preferencesPath}`;
    const mark = (items: Due[], status: string, error: string | null) => db.batch(items.map(item => db.prepare("UPDATE mail_outbox SET status=?,last_error=?,deliver_after=NULL WHERE id=? AND status='scheduled'").bind(status, error, item.id)));
    for (const [userId, items] of byPerson) {
      const person = people.get(userId);
      if (!person) { await mark(items, "deferred", "La persona ya no está activa en la organización."); continue; }
      const decision = notificationDecision({ address: person.email, configured: notifier.sender.configured, sentToday, mandatory: false, sentInRequest: written });
      if (decision === "deferred") { if (written >= maxNotificationsPerRequest) break; continue; }
      if (decision !== "send") { await mark(items, decision, errorOf(decision, false, written)); continue; }
      written++;
      if (items.length === 1) {
        const [item] = items;
        const message = notificationMessage(person.email!, { type: item.type, organization, recipientName: person.name, reason: item.reason, link: link(item.path), mandatory: false, preferencesLink });
        await db.prepare("UPDATE mail_outbox SET status='queued',recipient=?,deliver_after=NULL WHERE id=?").bind(person.email!, item.id).run();
        const { result, attempts } = await attempt(notifier.sender, message);
        await db.prepare("UPDATE mail_outbox SET status=?,attempts=?,last_error=?,sent_at=?,provider_id=? WHERE id=?")
          .bind(result.ok ? "sent" : "failed", attempts, result.ok ? null : result.error, result.ok ? new Date().toISOString() : null, result.ok ? result.id || null : null, item.id).run();
        if (result.ok) sentToday++;
        continue;
      }
      const frequency = deliveryOf(person).frequency;
      const message = digestMessage(person.email!, { organization, recipientName: person.name, frequency, items: items.map(item => ({ type: item.type, reason: item.reason, link: link(item.path), createdAt: item.createdAt })), preferencesLink, locale: person.locale || undefined, timezone: zoneOf(person) });
      const id = `mail-${crypto.randomUUID()}`;
      await db.batch([
        db.prepare("INSERT INTO mail_outbox(id,organization_id,kind,reference_id,recipient,subject,status,attempts,created_at,user_id,reason,mandatory) VALUES (?,?,'digest',?,?,?,'queued',0,?,?,?,0)")
          .bind(id, organizationId, `digest:${userId}`.slice(0, 200), person.email!, message.subject, stamp, userId, digestReason(frequency, items.length)),
        ...items.map(item => db.prepare("UPDATE mail_outbox SET status='digested',digest_id=?,recipient=?,deliver_after=NULL WHERE id=? AND status='scheduled'").bind(id, person.email!, item.id)),
      ]);
      const { result, attempts } = await attempt(notifier.sender, message);
      await db.prepare("UPDATE mail_outbox SET status=?,attempts=?,last_error=?,sent_at=?,provider_id=? WHERE id=?")
        .bind(result.ok ? "sent" : "failed", attempts, result.ok ? null : result.error, result.ok ? new Date().toISOString() : null, result.ok ? result.id || null : null, id).run();
      if (result.ok) sentToday++;
    }
    return written;
  } catch (error) {
    console.error(JSON.stringify({ event: "scheduled_mail_failed", cause: error instanceof Error ? `${error.name}: ${error.message}`.slice(0, 240) : "Unknown error" }));
    return 0;
  }
}
