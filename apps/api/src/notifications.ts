import type { Member, NotificationRecord, NotificationSetting } from "@happy-learners/contracts";
import type { NotificationType } from "@happy-learners/domain";
import { isNotificationType, notificationCatalog, notificationTypes, policyInput, preferencesInput, receives } from "@happy-learners/domain";
import type { Database } from "./storage";
import { event } from "./team";
import { mandatoryTypes, preferencesOf } from "./notify";
export { notify, type Notice, type Notifier } from "./notify";

/** E-mail notifications (ST-124, DEC-042): recipients of reviews, preferences, mandatory policy and the sent log. */
const reply = (value: unknown, status = 200) => Response.json(value, { status });
/** Who reviews a course's lessons: its lead, and coordination or a security group granting the review in its program. */
export async function reviewersOf(db: Database, organizationId: string, courseId: string): Promise<string[]> {
  const rows = (await db.prepare(`SELECT cm.user_id AS id FROM course_members cm WHERE cm.course_id=? AND cm.organization_id=? AND cm.role='lead'
    UNION SELECT cs.user_id FROM coordination_scopes cs JOIN courses c ON c.id=? AND c.organization_id=cs.organization_id WHERE cs.organization_id=? AND (cs.program_id='*' OR cs.program_id=c.program_id)
    UNION SELECT sm.user_id FROM security_group_members sm JOIN security_group_grants g ON g.group_id=sm.group_id JOIN courses c ON c.id=? AND c.organization_id=sm.organization_id WHERE sm.organization_id=? AND g.permission='lessons.review' AND (g.program_id='*' OR g.program_id=c.program_id)`)
    .bind(courseId, organizationId, courseId, organizationId, courseId, organizationId).all<{ id: string }>()).results;
  return rows.map(row => row.id);
}

const columns = `SELECT o.id,o.notification_type AS type,o.user_id AS userId,COALESCE(u.display_name,u.username,'Cuenta eliminada') AS personName,NULLIF(o.recipient,'') AS recipient,o.reason,
  substr(o.reference_id,instr(o.reference_id,':')+1) AS targetId,o.status,o.mandatory,o.attempts,o.last_error AS error,o.created_at AS createdAt,o.sent_at AS sentAt
  FROM mail_outbox o LEFT JOIN users u ON u.id=o.user_id WHERE o.organization_id=? AND o.kind='notification'`;
const record = (row: Omit<NotificationRecord, "mandatory"> & { mandatory: number }): NotificationRecord => ({ ...row, mandatory: !!row.mandatory });

async function settingsOf(db: Database, current: Member): Promise<NotificationSetting[]> {
  const [mandatory, preferences] = await Promise.all([mandatoryTypes(db, current.organizationId), preferencesOf(db, current.organizationId, [current.id])]);
  const mine = preferences.get(current.id) || {};
  return notificationCatalog.map(item => ({ ...item, mandatory: mandatory.has(item.type), enabled: receives(item.type, mine, mandatory) }));
}

export function notificationMethods(path: string): string[] | null {
  if (path === "/api/notifications/preferences" || path === "/api/notifications/policy") return ["GET", "PUT"];
  if (path === "/api/notifications/log") return ["GET"];
  return null;
}

/**
 * /api/notifications/preferences (each person: their choices and their own history), /policy (administration: the
 * mandatory types) and /log (administration: every notification, filtered by person, type and status).
 */
export async function notifications(path: string, method: string, input: unknown, url: URL, current: Member, db: Database, mailConfigured = false) {
  const now = new Date().toISOString();
  if (path === "/api/notifications/preferences") {
    if (method === "PUT") {
      const chosen = preferencesInput(input);
      if (!chosen) return reply({ error: "Indica, para cada tipo de aviso, si quieres recibirlo." }, 400);
      const mandatory = await mandatoryTypes(db, current.organizationId);
      const locked = Object.entries(chosen).filter(([type, enabled]) => !enabled && mandatory.has(type as NotificationType));
      if (locked.length) return reply({ error: "Administración marcó ese aviso como obligatorio: no se puede desactivar." }, 409);
      await db.batch(Object.entries(chosen).map(([type, enabled]) => db.prepare("INSERT INTO notification_preferences(user_id,organization_id,type,enabled,updated_at) VALUES (?,?,?,?,?) ON CONFLICT(user_id,type) DO UPDATE SET enabled=excluded.enabled,updated_at=excluded.updated_at")
        .bind(current.id, current.organizationId, type, enabled ? 1 : 0, now)));
    }
    const [settings, history, address] = await Promise.all([
      settingsOf(db, current),
      db.prepare(`${columns} AND o.user_id=? ORDER BY o.created_at DESC,o.rowid DESC LIMIT 20`).bind(current.organizationId, current.id).all<Parameters<typeof record>[0]>(),
      db.prepare("SELECT COALESCE(u.email,p.contact_email) AS email FROM users u LEFT JOIN staff_profiles p ON p.user_id=u.id WHERE u.id=?").bind(current.id).first<{ email: string | null }>(),
    ]);
    return reply({ settings, history: history.results.map(record), hasAddress: !!address?.email });
  }
  if (current.role !== "admin") return reply({ error: "Solo administración define los avisos obligatorios y consulta los envíos." }, 403);
  if (path === "/api/notifications/policy") {
    if (method === "PUT") {
      const chosen = policyInput(input);
      if (!chosen) return reply({ error: "Elige los avisos obligatorios del catálogo, sin repetir." }, 400);
      const before = await mandatoryTypes(db, current.organizationId);
      const changed = notificationTypes.filter(type => before.has(type) !== chosen.includes(type));
      if (changed.length) {
        const labels = (types: NotificationType[]) => types.map(type => notificationCatalog.find(item => item.type === type)!.label).join(", ") || "ninguno";
        await db.batch([
          ...notificationTypes.map(type => db.prepare("INSERT INTO notification_policies(organization_id,type,mandatory,updated_by,updated_at) VALUES (?,?,?,?,?) ON CONFLICT(organization_id,type) DO UPDATE SET mandatory=excluded.mandatory,updated_by=excluded.updated_by,updated_at=excluded.updated_at")
            .bind(current.organizationId, type, chosen.includes(type) ? 1 : 0, current.id, now)),
          event(db, current, { action: "updated", targetType: "account", targetId: current.organizationId, summary: `Cambió los avisos por correo obligatorios: ${labels(chosen)}` }),
        ]);
      }
    }
    return reply({ settings: (await settingsOf(db, current)).map(({ enabled: _, ...item }) => item) });
  }
  const person = url.searchParams.get("person"), type = url.searchParams.get("type"), status = url.searchParams.get("status");
  if (type && !isNotificationType(type)) return reply({ error: "Tipo de aviso desconocido." }, 400);
  if (status && !["queued", "sent", "failed", "not_configured", "deferred", "no_address"].includes(status)) return reply({ error: "Estado desconocido." }, 400);
  const limit = Math.min(200, Math.max(1, Number(url.searchParams.get("limit")) || 100));
  const filters = [person && ["o.user_id=?", person], type && ["o.notification_type=?", type], status && ["o.status=?", status]].filter(Boolean) as [string, string][];
  const rows = (await db.prepare(`${columns}${filters.map(([clause]) => ` AND ${clause}`).join("")} ORDER BY o.created_at DESC,o.rowid DESC LIMIT ?`).bind(current.organizationId, ...filters.map(([, value]) => value), limit).all<Parameters<typeof record>[0]>()).results;
  const people = (await db.prepare("SELECT u.id,COALESCE(u.display_name,u.username) AS name FROM users u JOIN memberships m ON m.user_id=u.id WHERE m.organization_id=? ORDER BY name").bind(current.organizationId).all<{ id: string; name: string }>()).results;
  return reply({ notifications: rows.map(record), people, mailConfigured });
}
