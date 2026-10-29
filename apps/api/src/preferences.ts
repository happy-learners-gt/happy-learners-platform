import type { EffectivePreferences, Inbox, InboxItem, Member, NotificationMatrixRow, NotificationPreferences } from "@happy-learners/contracts";
import type { DeliverySettings, NotificationType, UserPreferences } from "@happy-learners/domain";
import { effectivePreferences, emailPlan, isConfigurableType, localeWeekStart, lockedBy, notificationCatalog, notificationChannels, notificationPreferencesInput, receivesOn, userPreferencesInput } from "@happy-learners/domain";
import type { Database } from "./storage";
import { deliveryOf, mandatoryTypes, preferencesOf } from "./notify";
import { myPanels } from "./gradebook";
import { hasAddress, historyOf } from "./notifications";

/**
 * The person's own preferences (ST-160, ST-161, DEC-045), under /api/me:
 * - /api/me/preferences: language, regional format, zone, first day, hour cycle, home page and appearance.
 * - /api/me/notification-preferences: the event × channel matrix, e-mail frequency, digest time and quiet hours.
 * - /api/me/inbox and /api/me/inbox/read: the bell (in-app notices).
 * Nothing here is visible to anyone else, so it is not audited in `activity_events`.
 */
const reply = (value: unknown, status = 200) => Response.json(value, { status });

export function meMethods(path: string): string[] | null {
  if (path === "/api/me/preferences" || path === "/api/me/notification-preferences") return ["GET", "PUT"];
  if (path === "/api/me/inbox" || path === "/api/me/panels") return ["GET"];
  if (path === "/api/me/inbox/read") return ["POST"];
  return null;
}

type StoredPreferences = { language: "es"; locale: string | null; timezone: string | null; weekStart: number | null; hourCycle: "h12" | "h23" | null; homePage: UserPreferences["homePage"]; theme: UserPreferences["theme"]; textScale: number; highContrast: number; motion: UserPreferences["motion"]; density: UserPreferences["density"] };
/** The preferences in force for a person: their row, and the organization's locale and zone for what they left empty. */
export async function preferencesFor(db: Database, userId: string, organizationId: string): Promise<EffectivePreferences> {
  const row = await db.prepare(`SELECT o.locale AS orgLocale,o.timezone AS orgZone,p.language,p.locale,p.timezone,p.week_start AS weekStart,p.hour_cycle AS hourCycle,p.home_page AS homePage,p.theme,p.text_scale AS textScale,p.high_contrast AS highContrast,p.motion,p.density
    FROM organizations o LEFT JOIN user_preferences p ON p.user_id=? AND p.organization_id=o.id WHERE o.id=?`).bind(userId, organizationId).first<Partial<StoredPreferences> & { orgLocale: string | null; orgZone: string | null }>();
  const { orgLocale, orgZone, ...own } = row || { orgLocale: null, orgZone: null };
  const stored = own.theme ? { ...own, highContrast: !!own.highContrast } as Partial<UserPreferences> : null;
  return effectivePreferences(stored, { locale: orgLocale, timezone: orgZone || "America/Guatemala" }) as EffectivePreferences;
}
/** The zone a person reads times in: theirs, or the organization's. */
export const personalZone = async (db: Database, current: Member) => (await preferencesFor(db, current.id, current.organizationId)).timezone;

const columnOf: Record<keyof UserPreferences, string> = {
  language: "language", locale: "locale", timezone: "timezone", weekStart: "week_start", hourCycle: "hour_cycle", homePage: "home_page",
  theme: "theme", textScale: "text_scale", highContrast: "high_contrast", motion: "motion", density: "density",
};

async function deliveryFor(db: Database, current: Member): Promise<DeliverySettings> {
  const row = await db.prepare("SELECT email_frequency AS frequency,digest_time AS digestTime,quiet_start AS quietStart,quiet_end AS quietEnd FROM notification_settings WHERE user_id=?").bind(current.id)
    .first<{ frequency: DeliverySettings["frequency"]; digestTime: string; quietStart: string | null; quietEnd: string | null }>();
  return deliveryOf(row || {});
}
async function notificationPreferences(db: Database, current: Member): Promise<NotificationPreferences> {
  const [mandatory, preferences, delivery, preferencesInForce, history, address, scheduled] = await Promise.all([
    mandatoryTypes(db, current.organizationId), preferencesOf(db, current.organizationId, [current.id]), deliveryFor(db, current),
    preferencesFor(db, current.id, current.organizationId), historyOf(db, current), hasAddress(db, current),
    db.prepare("SELECT count(*) AS count,min(deliver_after) AS next FROM mail_outbox WHERE organization_id=? AND user_id=? AND status='scheduled'").bind(current.organizationId, current.id).first<{ count: number; next: string | null }>(),
  ]);
  const mine = preferences.get(current.id) || {};
  const events: NotificationMatrixRow[] = notificationCatalog.map(item => ({
    type: item.type, label: item.label, description: item.description, audience: item.audience, locked: lockedBy(item.type, mandatory),
    channels: { in_app: receivesOn(item.type, "in_app", mine, mandatory), email: receivesOn(item.type, "email", mine, mandatory) },
  }));
  return { events, delivery, timezone: preferencesInForce.timezone, hasAddress: address, scheduled: scheduled?.count || 0, nextDelivery: scheduled?.next || null, history };
}

const inboxColumns = "id,type,reason,path,mandatory,created_at AS createdAt,read_at AS readAt";
async function inbox(db: Database, current: Member): Promise<Inbox> {
  const [items, unread] = await Promise.all([
    db.prepare(`SELECT ${inboxColumns} FROM notification_inbox WHERE organization_id=? AND user_id=? ORDER BY created_at DESC,rowid DESC LIMIT 30`).bind(current.organizationId, current.id).all<Omit<InboxItem, "mandatory"> & { mandatory: number }>(),
    db.prepare("SELECT count(*) AS unread FROM notification_inbox WHERE organization_id=? AND user_id=? AND read_at IS NULL").bind(current.organizationId, current.id).first<{ unread: number }>(),
  ]);
  return { items: items.results.map(item => ({ ...item, mandatory: !!item.mandatory })), unread: unread?.unread || 0 };
}

export async function me(path: string, method: string, input: unknown, current: Member, db: Database): Promise<Response> {
  if (path === "/api/me/panels") return myPanels(db, current);
  const now = new Date().toISOString();
  if (path === "/api/me/preferences") {
    if (method === "PUT") {
      const parsed = userPreferencesInput(input);
      if ("error" in parsed) return reply({ error: parsed.error }, 400);
      const entries = Object.entries(parsed.preferences) as [keyof UserPreferences, unknown][];
      const columns = entries.map(([key]) => columnOf[key]), values = entries.map(([, value]) => typeof value === "boolean" ? (value ? 1 : 0) : value as string | number | null);
      await db.prepare(`INSERT INTO user_preferences(user_id,organization_id,${columns.join(",")},updated_at) VALUES (?,?,${columns.map(() => "?").join(",")},?)
        ON CONFLICT(user_id) DO UPDATE SET ${columns.map(column => `${column}=excluded.${column}`).join(",")},updated_at=excluded.updated_at`)
        .bind(current.id, current.organizationId, ...values, now).run();
    }
    return reply({ preferences: await preferencesFor(db, current.id, current.organizationId) });
  }
  if (path === "/api/me/notification-preferences") {
    if (method === "PUT") {
      const change = notificationPreferencesInput(input);
      if ("error" in change) return reply({ error: change.error }, 400);
      const mandatory = await mandatoryTypes(db, current.organizationId);
      const offLocked = Object.entries(change.channels || {}).filter(([type, channels]) => lockedBy(type as NotificationType, mandatory) && Object.values(channels).some(on => on === false));
      if (offLocked.length) {
        const system = offLocked.some(([type]) => lockedBy(type as NotificationType, mandatory) === "system");
        return reply({ error: system ? "Los avisos de seguridad de la cuenta, de cambio de correo y de términos son obligatorios: no se pueden desactivar." : "Administración marcó ese aviso como obligatorio: no se puede desactivar." }, 409);
      }
      const statements = Object.entries(change.channels || {}).filter(([type]) => isConfigurableType(type)).flatMap(([type, channels]) =>
        notificationChannels.filter(channel => channels[channel] !== undefined).map(channel => db.prepare("INSERT INTO notification_preferences(user_id,organization_id,type,channel,enabled,updated_at) VALUES (?,?,?,?,?,?) ON CONFLICT(user_id,type,channel) DO UPDATE SET enabled=excluded.enabled,updated_at=excluded.updated_at")
          .bind(current.id, current.organizationId, type, channel, channels[channel] ? 1 : 0, now)));
      const deliveryChanged = change.frequency !== undefined || change.digestTime !== undefined || change.quietHours !== undefined;
      if (deliveryChanged) {
        const before = await deliveryFor(db, current);
        const next: DeliverySettings = { frequency: change.frequency ?? before.frequency, digestTime: change.digestTime ?? before.digestTime, quietHours: change.quietHours !== undefined ? change.quietHours : before.quietHours };
        statements.push(db.prepare(`INSERT INTO notification_settings(user_id,organization_id,email_frequency,digest_time,quiet_start,quiet_end,updated_at) VALUES (?,?,?,?,?,?,?)
          ON CONFLICT(user_id) DO UPDATE SET email_frequency=excluded.email_frequency,digest_time=excluded.digest_time,quiet_start=excluded.quiet_start,quiet_end=excluded.quiet_end,updated_at=excluded.updated_at`)
          .bind(current.id, current.organizationId, next.frequency, next.digestTime, next.quietHours?.start || null, next.quietHours?.end || null, now));
        // E-mail already waiting follows the new rhythm: the next digest, the end of the quiet hours or right away.
        // With «never», what was already waiting still leaves at its time: it was promised under the old choice.
        if (next.frequency !== "never") {
          const regional = await preferencesFor(db, current.id, current.organizationId);
          const plan = emailPlan({ mandatory: false, settings: next, zone: regional.timezone, weekStart: regional.weekStart || localeWeekStart(regional.locale) });
          const at = plan.action === "schedule" ? plan.at.toISOString() : now;
          statements.push(db.prepare("UPDATE mail_outbox SET deliver_after=? WHERE organization_id=? AND user_id=? AND status='scheduled'").bind(at, current.organizationId, current.id));
        }
      }
      if (statements.length) await db.batch(statements);
    }
    return reply(await notificationPreferences(db, current));
  }
  if (path === "/api/me/inbox/read") {
    const value = input && typeof input === "object" ? input as Record<string, unknown> : {};
    const ids = value.ids;
    if (ids !== undefined && (!Array.isArray(ids) || !ids.length || ids.length > 100 || ids.some(id => typeof id !== "string" || !/^inbox-[a-f0-9-]{36}$/.test(id))))
      return reply({ error: "Indica los avisos que leíste." }, 400);
    if (Array.isArray(ids)) await db.prepare(`UPDATE notification_inbox SET read_at=? WHERE organization_id=? AND user_id=? AND read_at IS NULL AND id IN (${ids.map(() => "?").join(",")})`).bind(now, current.organizationId, current.id, ...ids as string[]).run();
    else await db.prepare("UPDATE notification_inbox SET read_at=? WHERE organization_id=? AND user_id=? AND read_at IS NULL").bind(now, current.organizationId, current.id).run();
  }
  return reply(await inbox(db, current));
}
