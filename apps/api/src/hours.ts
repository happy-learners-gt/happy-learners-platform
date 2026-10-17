import type { HoursReport, HoursRow, Member } from "@happy-learners/contracts";
import { effectiveDuration, formatMinutes, hoursAdjustmentInput, hoursCsv, hoursDay, hoursFilterInput, hoursTotals, inHoursFilter } from "@happy-learners/domain";
import type { Database } from "./storage";
import { personalZone } from "./preferences";
import { event } from "./team";

const reply = (data: unknown, status = 200, headers: Record<string, string> = {}) => Response.json(data, { status, headers });

type Stored = {
  sessionId: string; courseId: string; courseTitle: string; sectionId: string; sectionName: string; sessionDate: string; startedAt: string | null; completedAt: string;
  taughtBy: string | null; taughtByName: string | null; adjustments: number;
  minutesBefore: number | null; minutesAfter: number | null; educatorBefore: string | null; educatorAfter: string | null; educatorAfterName: string | null; reason: string | null; adjustedBy: string | null; adjustedAt: string | null;
};
/**
 * The completed classes of the organization with the correction in force (the latest one). Cancelled, planned and
 * running classes never appear: they add no hours (ST-152 CA3). `own` keeps the classes attributed to that person.
 */
async function storedRows(db: Database, organizationId: string, own: string | null, sessionId?: string) {
  return (await db.prepare(`SELECT s.id AS sessionId,s.course_id AS courseId,c.title AS courseTitle,s.group_id AS sectionId,g.name AS sectionName,s.session_date AS sessionDate,
      s.started_at AS startedAt,s.completed_at AS completedAt,s.taught_by AS taughtBy,COALESCE(u.display_name,u.username) AS taughtByName,
      (SELECT count(*) FROM class_hour_adjustments x WHERE x.session_id=s.id) AS adjustments,
      a.minutes_before AS minutesBefore,a.minutes_after AS minutesAfter,a.educator_before AS educatorBefore,a.educator_after AS educatorAfter,COALESCE(ae.display_name,ae.username) AS educatorAfterName,
      a.reason,COALESCE(ab.display_name,ab.username) AS adjustedBy,a.adjusted_at AS adjustedAt
    FROM class_sessions s JOIN courses c ON c.id=s.course_id JOIN course_groups g ON g.id=s.group_id LEFT JOIN users u ON u.id=s.taught_by
    LEFT JOIN class_hour_adjustments a ON a.id=(SELECT x.id FROM class_hour_adjustments x WHERE x.session_id=s.id ORDER BY x.adjusted_at DESC,x.rowid DESC LIMIT 1)
    LEFT JOIN users ae ON ae.id=a.educator_after LEFT JOIN users ab ON ab.id=a.adjusted_by
    WHERE s.organization_id=? AND s.status='completed' AND s.completed_at IS NOT NULL${own ? " AND COALESCE(a.educator_after,s.taught_by)=?" : ""}${sessionId ? " AND s.id=?" : ""}
    ORDER BY s.completed_at DESC,s.id LIMIT 5000`).bind(organizationId, ...(own ? [own] : []), ...(sessionId ? [sessionId] : [])).all<Stored>()).results;
}
function hoursRow(row: Stored, timezone: string): HoursRow {
  const computed = effectiveDuration(row.startedAt, row.completedAt);
  const adjusted = row.minutesAfter !== null && row.educatorAfter !== null;
  return {
    sessionId: row.sessionId, courseId: row.courseId, courseTitle: row.courseTitle, sectionId: row.sectionId, sectionName: row.sectionName, sessionDate: row.sessionDate,
    day: hoursDay(row.startedAt && computed.state !== "no_start" ? row.startedAt : null, row.sessionDate, timezone), startedAt: computed.state === "no_start" ? null : row.startedAt, completedAt: row.completedAt,
    educatorId: adjusted ? row.educatorAfter : row.taughtBy, educatorName: adjusted ? row.educatorAfterName : row.taughtByName,
    computedMinutes: computed.computed, minutes: adjusted ? Number(row.minutesAfter) : computed.minutes, state: adjusted ? "adjusted" : computed.state,
    adjustment: adjusted ? { minutesBefore: Number(row.minutesBefore), minutesAfter: Number(row.minutesAfter), educatorBefore: row.educatorBefore, educatorAfter: row.educatorAfter!, reason: row.reason || "", adjustedBy: row.adjustedBy || "", adjustedAt: row.adjustedAt || "" } : null,
    adjustments: Number(row.adjustments) || 0,
  };
}
const byName = <T extends { name: string }>(a: T, b: T) => a.name.localeCompare(b.name, "es", { numeric: true });

/** The report the person may see: administration every class, anyone else only the classes attributed to them. */
async function report(url: URL, current: Member, db: Database): Promise<HoursReport | { error: string }> {
  const filter = hoursFilterInput(url.searchParams);
  if ("error" in filter) return filter;
  const timezone = await personalZone(db, current), admin = current.role === "admin";
  const visible = (await storedRows(db, current.organizationId, admin ? null : current.id)).map(row => hoursRow(row, timezone));
  const rows = visible.filter(row => inHoursFilter(row, filter)).sort((a, b) => b.day.localeCompare(a.day) || (b.startedAt || b.completedAt).localeCompare(a.startedAt || a.completedAt));
  const unique = <T extends { id: string }>(items: T[]) => [...new Map(items.map(item => [item.id, item])).values()];
  return {
    filter, timezone, scope: admin ? "all" : "own", rows, minutes: rows.reduce((sum, row) => sum + row.minutes, 0), totals: hoursTotals(rows),
    options: {
      courses: unique(visible.map(row => ({ id: row.courseId, name: row.courseTitle }))).sort(byName),
      sections: unique(visible.map(row => ({ id: row.sectionId, name: row.sectionName, courseId: row.courseId }))).sort(byName),
      people: unique(visible.flatMap(row => row.educatorId ? [{ id: row.educatorId, name: row.educatorName || row.educatorId }] : [])).sort(byName),
    },
  };
}

/**
 * ST-152: GET /api/hours?from=&to=&course=&section=&person= (report), GET /api/hours/export (CSV, same filters) and
 * POST /api/hours/:sessionId/adjustment {minutes, educatorId?, reason} (administration).
 */
export async function hours(path: string, method: string, input: unknown, url: URL, current: Member, db: Database) {
  if (path === "/api/hours" || path === "/api/hours/export") {
    const result = await report(url, current, db);
    if ("error" in result) return reply(result, 400);
    if (path === "/api/hours") return reply(result);
    const period = [result.filter.from, result.filter.to].filter(Boolean).join("_a_") || "todo";
    return new Response(hoursCsv(result.rows, result.timezone), { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="horas-efectivas-${period}.csv"` } });
  }
  const sessionId = /^\/api\/hours\/([a-z0-9-]+)\/adjustment$/.exec(path)?.[1];
  if (!sessionId || method !== "POST") return reply({ error: "Ruta no disponible." }, 404);
  if (current.role !== "admin") return reply({ error: "Solo administración corrige las horas efectivas." }, 403);
  const value = hoursAdjustmentInput(input);
  if ("error" in value) return reply(value, 400);
  const stored = (await storedRows(db, current.organizationId, null, sessionId))[0];
  if (!stored) {
    const exists = await db.prepare("SELECT status FROM class_sessions WHERE id=? AND organization_id=?").bind(sessionId, current.organizationId).first<{ status: string }>();
    return exists ? reply({ error: "Solo una clase finalizada tiene horas efectivas: una clase cancelada o sin finalizar no suma horas." }, 409) : reply({ error: "La clase no está disponible." }, 404);
  }
  const timezone = await personalZone(db, current), before = hoursRow(stored, timezone);
  const educatorId = value.educatorId || before.educatorId;
  if (!educatorId) return reply({ error: "Elige a la persona que impartió la clase." }, 400);
  const educator = await db.prepare("SELECT u.id,COALESCE(u.display_name,u.username) AS name FROM users u JOIN memberships m ON m.user_id=u.id WHERE u.id=? AND m.organization_id=?").bind(educatorId, current.organizationId).first<{ id: string; name: string }>();
  if (!educator) return reply({ error: "Elige a una persona de tu organización." }, 400);
  if (value.minutes === before.minutes && educator.id === before.educatorId) return reply({ error: "La corrección no cambia los minutos ni la persona." }, 400);
  const now = new Date().toISOString(), moved = educator.id !== before.educatorId;
  const summary = `Corrigió las horas efectivas de la clase del ${stored.sessionDate} en «${stored.sectionName}»: ${formatMinutes(before.minutes)} → ${formatMinutes(value.minutes)}${moved ? `, atribuidas a ${educator.name}` : ""}. Motivo: ${value.reason}`;
  await db.batch([
    db.prepare("INSERT INTO class_hour_adjustments(id,organization_id,session_id,minutes_before,minutes_after,educator_before,educator_after,reason,adjusted_by,adjusted_at) VALUES (?,?,?,?,?,?,?,?,?,?)")
      .bind(`hours-${crypto.randomUUID()}`, current.organizationId, sessionId, before.minutes, value.minutes, before.educatorId, educator.id, value.reason, current.id, now),
    event(db, current, { action: "updated", targetType: "session", targetId: sessionId, courseId: stored.courseId, groupId: stored.sectionId, summary }),
  ]);
  const after = (await storedRows(db, current.organizationId, null, sessionId))[0];
  return reply({ row: hoursRow(after, timezone) });
}

/** ST-159: the classes attributed to the person, with their effective hours, for «Exportar mis datos». */
export async function ownHours(db: Database, current: Member): Promise<{ timezone: string; rows: HoursRow[] }> {
  // ST-160: in the person's own zone, like «Horas».
  const timezone = await personalZone(db, current);
  return { timezone, rows: (await storedRows(db, current.organizationId, current.id)).map(row => hoursRow(row, timezone)) };
}
