import type { ActivityEvent, CourseMember, Member } from "@happy-learners/contracts";
import { record } from "@happy-learners/domain";
import type { Database } from "./storage";
import { scopedCourses } from "./permissions";
import { notify, type Notifier } from "./notify";
import { event } from "./activity";

const reply = (value: unknown, status = 200) => Response.json(value, { status });
export async function teamsFor(db: Database, organization: string): Promise<Map<string, CourseMember[]>> {
  const rows = (await db.prepare("SELECT cm.course_id AS courseId,cm.user_id AS userId,cm.role,COALESCE(u.display_name,u.username) AS name,u.username FROM course_members cm JOIN users u ON u.id=cm.user_id WHERE cm.organization_id=? ORDER BY CASE cm.role WHEN 'lead' THEN 0 ELSE 1 END,name").bind(organization).all<CourseMember & { courseId: string }>()).results;
  const map = new Map<string, CourseMember[]>();
  for (const { courseId, ...member } of rows) map.set(courseId, [...map.get(courseId) || [], member]);
  return map;
}

/**
 * GET /api/activity?course=&section=&actor=&mine=1&limit= — newest first, with the author's name; mine: courses I teach.
 * Educators see the activity of their courses, and of sections and classes only when they teach that section (DEC-024).
 * The «Consultar la actividad» permission (ST-135) adds every course and section of its scope.
 */
export async function activity(url: URL, current: Member, db: Database) {
  const course = url.searchParams.get("course"), section = url.searchParams.get("section"), actor = url.searchParams.get("actor");
  const educator = current.role !== "admin", mine = url.searchParams.get("mine") === "1" || educator;
  const limit = Math.min(100, Math.max(1, Number(url.searchParams.get("limit")) || 20));
  const scoped = educator ? JSON.stringify(await scopedCourses(db, current, ["activity.view"])) : "[]";
  const rows = (await db.prepare(`SELECT e.id,e.action,e.target_type AS targetType,e.target_id AS targetId,e.course_id AS courseId,e.summary,e.occurred_at AS occurredAt,e.actor_id AS actorId,COALESCE(u.display_name,u.username) AS actorName
    FROM activity_events e JOIN users u ON u.id=e.actor_id WHERE e.organization_id=?${course ? " AND e.course_id=?" : ""}${section ? " AND e.group_id=?" : ""}${actor ? " AND e.actor_id=?" : ""}${mine ? " AND (e.course_id IN (SELECT course_id FROM course_members WHERE user_id=?) OR e.course_id IN (SELECT value FROM json_each(?)))" : ""}
    ${educator ? " AND (e.target_type NOT IN ('group','session') OR e.group_id IN (SELECT group_id FROM section_educators WHERE user_id=?) OR e.course_id IN (SELECT value FROM json_each(?)))" : ""} ORDER BY e.occurred_at DESC,e.id LIMIT ?`)
    .bind(current.organizationId, ...(course ? [course] : []), ...(section ? [section] : []), ...(actor ? [actor] : []), ...(mine ? [current.id, scoped] : []), ...(educator ? [current.id, scoped] : []), limit).all<ActivityEvent>()).results;
  return reply({ events: rows });
}

/** PUT /api/courses/:id/team — one lead at most, members must be active people of the organization. */
export async function updateTeam(courseId: string, version: number, input: unknown, current: Member, db: Database, notifier?: Notifier) {
  const v = record(input);
  const list = Array.isArray(v?.members) ? v!.members as Record<string, unknown>[] : null;
  if (!list || list.length > 20 || list.some(item => typeof item?.userId !== "string" || !["lead", "co-teacher"].includes(String(item.role))) || new Set(list.map(item => item.userId)).size !== list.length || list.filter(item => item.role === "lead").length > 1)
    return reply({ error: "El equipo admite una persona responsable y hasta 19 colaboradores, sin repetir." }, 400);
  if (!list.some(item => item.role === "lead")) return reply({ error: "El curso necesita una persona responsable: es quien publica su contenido y aprueba las revisiones." }, 400);
  const people = (await db.prepare("SELECT user_id AS id FROM memberships WHERE organization_id=? AND active=1").bind(current.organizationId).all<{ id: string }>()).results.map(row => row.id);
  if (list.some(item => !people.includes(String(item.userId)))) return reply({ error: "Elige personas activas de tu organización." }, 400);
  const now = new Date().toISOString();
  const kept = list.map(item => String(item.userId));
  const before = new Map((await db.prepare("SELECT user_id AS id,role FROM course_members WHERE course_id=? AND organization_id=?").bind(courseId, current.organizationId).all<{ id: string; role: string }>()).results.map(row => [row.id, row.role]));
  const ok = await db.guardedBatch(
    db.prepare("UPDATE courses SET version=version+1,updated_at=? WHERE id=? AND organization_id=? AND version=? AND status='active' RETURNING id").bind(now, courseId, current.organizationId, version),
    [db.prepare("DELETE FROM course_members WHERE course_id=? AND organization_id=?").bind(courseId, current.organizationId),
      ...list.map(item => db.prepare("INSERT INTO course_members(course_id,organization_id,user_id,role,added_at) VALUES (?,?,?,?,?)").bind(courseId, current.organizationId, String(item.userId), String(item.role), now)),
      // Leaving the team also leaves its sections.
      db.prepare(`DELETE FROM section_educators WHERE course_id=? AND organization_id=? AND user_id NOT IN (${kept.map(() => "?").join(",")})`).bind(courseId, current.organizationId, ...kept),
      event(db, current, { action: "assigned", targetType: "team", targetId: courseId, courseId, summary: `Actualizó el equipo docente (${list.length} ${list.length === 1 ? "persona" : "personas"})` })]);
  if (!ok) return reply({ error: "Hay cambios más recientes. Recarga antes de guardar." }, 409);
  // ST-124: whoever joins the team, or changes role in it, is told by e-mail.
  const course = (await db.prepare("SELECT title FROM courses WHERE id=?").bind(courseId).first<{ title: string }>())?.title || "";
  await notify(db, notifier, current, list.filter(item => before.get(String(item.userId)) !== item.role)
    .map(item => ({ userId: String(item.userId), targetId: courseId, path: `/cursos/${courseId}`, facts: { type: "course_assignment", course, role: item.role as "lead" | "co-teacher" } })));
  return reply({ ok: true });
}

/** GET /api/people — active people of the organization, for choosing a course team. Names and roles only. */
export async function people(current: Member, db: Database) {
  const rows = (await db.prepare("SELECT u.id,u.username,COALESCE(u.display_name,u.username) AS name,CASE m.role WHEN 'instructor' THEN 'educator' ELSE m.role END AS role FROM users u JOIN memberships m ON m.user_id=u.id WHERE m.organization_id=? AND m.active=1 ORDER BY name").bind(current.organizationId).all<{ id: string; username: string; name: string; role: string }>()).results;
  return reply({ people: rows });
}
