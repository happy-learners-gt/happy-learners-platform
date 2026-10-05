import type { ActivityEvent, CourseMember, CourseProgress, Lesson, Member } from "@happy-learners/contracts";
import { coverage, record } from "@happy-learners/domain";
import type { Database } from "./storage";
import { coursesFor, curriculumFor, unitsFor } from "./courses";
import { reachableCourses } from "./access";

const reply = (value: unknown, status = 200) => Response.json(value, { status });
type EventInput = Pick<ActivityEvent, "action" | "targetType" | "targetId" | "summary"> & { courseId?: string | null };

/** One audit entry: who did what, on which course. Written after the operation succeeds. */
export function event(db: Database, current: Member, entry: EventInput) {
  return db.prepare("INSERT INTO activity_events(id,organization_id,actor_id,action,target_type,target_id,course_id,summary,occurred_at) VALUES (?,?,?,?,?,?,?,?,?)")
    .bind(`event-${crypto.randomUUID()}`, current.organizationId, current.id, entry.action, entry.targetType, entry.targetId, entry.courseId || null, entry.summary.slice(0, 240), new Date().toISOString());
}
export const recordEvent = (db: Database, current: Member, entry: EventInput) => event(db, current, entry).run();

export async function teamsFor(db: Database, organization: string): Promise<Map<string, CourseMember[]>> {
  const rows = (await db.prepare("SELECT cm.course_id AS courseId,cm.user_id AS userId,cm.role,COALESCE(u.display_name,u.username) AS name,u.username FROM course_members cm JOIN users u ON u.id=cm.user_id WHERE cm.organization_id=? ORDER BY CASE cm.role WHEN 'lead' THEN 0 ELSE 1 END,name").bind(organization).all<CourseMember & { courseId: string }>()).results;
  const map = new Map<string, CourseMember[]>();
  for (const { courseId, ...member } of rows) map.set(courseId, [...map.get(courseId) || [], member]);
  return map;
}

/** GET /api/activity?course=&actor=&mine=1&limit= — newest first, with the author's name; mine: courses I teach. Educators only see their courses. */
export async function activity(url: URL, current: Member, db: Database) {
  const course = url.searchParams.get("course"), actor = url.searchParams.get("actor"), mine = url.searchParams.get("mine") === "1" || current.role !== "admin";
  const limit = Math.min(100, Math.max(1, Number(url.searchParams.get("limit")) || 20));
  const rows = (await db.prepare(`SELECT e.id,e.action,e.target_type AS targetType,e.target_id AS targetId,e.course_id AS courseId,e.summary,e.occurred_at AS occurredAt,e.actor_id AS actorId,COALESCE(u.display_name,u.username) AS actorName
    FROM activity_events e JOIN users u ON u.id=e.actor_id WHERE e.organization_id=?${course ? " AND e.course_id=?" : ""}${actor ? " AND e.actor_id=?" : ""}${mine ? " AND e.course_id IN (SELECT course_id FROM course_members WHERE user_id=?)" : ""} ORDER BY e.occurred_at DESC,e.id LIMIT ?`)
    .bind(current.organizationId, ...(course ? [course] : []), ...(actor ? [actor] : []), ...(mine ? [current.id] : []), limit).all<ActivityEvent>()).results;
  return reply({ events: rows });
}

/** PUT /api/courses/:id/team — one lead at most, members must be active people of the organization. */
export async function updateTeam(courseId: string, version: number, input: unknown, current: Member, db: Database) {
  const v = record(input);
  const list = Array.isArray(v?.members) ? v!.members as Record<string, unknown>[] : null;
  if (!list || list.length > 20 || list.some(item => typeof item?.userId !== "string" || !["lead", "co-teacher"].includes(String(item.role))) || new Set(list.map(item => item.userId)).size !== list.length || list.filter(item => item.role === "lead").length > 1)
    return reply({ error: "El equipo admite una persona responsable y hasta 19 colaboradores, sin repetir." }, 400);
  if (!list.some(item => item.role === "lead")) return reply({ error: "El curso necesita una persona responsable: es quien publica su contenido y aprueba las revisiones." }, 400);
  const people = (await db.prepare("SELECT user_id AS id FROM memberships WHERE organization_id=? AND active=1").bind(current.organizationId).all<{ id: string }>()).results.map(row => row.id);
  if (list.some(item => !people.includes(String(item.userId)))) return reply({ error: "Elige personas activas de tu organización." }, 400);
  const now = new Date().toISOString();
  const kept = list.map(item => String(item.userId));
  const ok = await db.guardedBatch(
    db.prepare("UPDATE courses SET version=version+1,updated_at=? WHERE id=? AND organization_id=? AND version=? AND status='active' RETURNING id").bind(now, courseId, current.organizationId, version),
    [db.prepare("DELETE FROM course_members WHERE course_id=? AND organization_id=?").bind(courseId, current.organizationId),
      ...list.map(item => db.prepare("INSERT INTO course_members(course_id,organization_id,user_id,role,added_at) VALUES (?,?,?,?,?)").bind(courseId, current.organizationId, String(item.userId), String(item.role), now)),
      // Leaving the team also leaves its sections.
      db.prepare(`DELETE FROM section_educators WHERE course_id=? AND organization_id=? AND user_id NOT IN (${kept.map(() => "?").join(",")})`).bind(courseId, current.organizationId, ...kept),
      event(db, current, { action: "assigned", targetType: "team", targetId: courseId, courseId, summary: `Actualizó el equipo docente (${list.length} ${list.length === 1 ? "persona" : "personas"})` })]);
  return ok ? reply({ ok: true }) : reply({ error: "Hay cambios más recientes. Recarga antes de guardar." }, 409);
}

/**
 * GET /api/progress — for every active course: content, curriculum coverage, attendance and last activity.
 * Feeds "Mis cursos" on the home page and the educators overview for administration.
 */
export async function progress(current: Member, db: Database) {
  const reachable = await reachableCourses(db, current);
  const courses = (await coursesFor(db, current.organizationId)).filter(course => course.status === "active" && (!reachable || reachable.has(course.id)));
  const teams = await teamsFor(db, current.organizationId);
  const lessonRows = (await db.prepare("SELECT l.id,l.content,l.course_unit_id AS unitId,l.archived,l.revision,l.draft_version AS draftVersion,l.published_version AS publishedVersion,c.id AS courseId FROM lessons l JOIN courses c ON c.legacy_program_id=l.program_id WHERE c.organization_id=?").bind(current.organizationId).all<{ id: string; content: string; unitId: string; archived: number; revision: number; draftVersion: number; publishedVersion: number; courseId: string }>()).results;
  const attendance = (await db.prepare("SELECT s.course_id AS courseId,count(DISTINCT s.id) AS sessions,sum(CASE WHEN m.status IN ('present','late') THEN 1 ELSE 0 END) AS attended,count(m.learner_id) AS marks FROM class_sessions s LEFT JOIN attendance_marks m ON m.session_id=s.id WHERE s.organization_id=? AND s.status IN ('in_progress','completed') GROUP BY s.course_id").bind(current.organizationId).all<{ courseId: string; sessions: number; attended: number; marks: number }>()).results;
  const learners = (await db.prepare("SELECT course_id AS courseId,count(*) AS total FROM group_learners WHERE organization_id=? AND status='active' GROUP BY course_id").bind(current.organizationId).all<{ courseId: string; total: number }>()).results;
  const last = (await db.prepare("SELECT course_id AS courseId,max(occurred_at) AS at FROM activity_events WHERE organization_id=? AND course_id IS NOT NULL GROUP BY course_id").bind(current.organizationId).all<{ courseId: string; at: string }>()).results;
  const result: CourseProgress[] = [];
  for (const course of courses) {
    const rows = lessonRows.filter(row => row.courseId === course.id && !row.archived);
    const lessons = rows.map(row => ({ ...JSON.parse(row.content), id: row.id, courseUnitId: row.unitId, status: row.revision ? "published" : "draft", revision: row.revision }) as Lesson);
    const [units, curriculum] = await Promise.all([unitsFor(db, course.id), curriculumFor(db, course.id)]);
    const plan = coverage(curriculum, units, lessons);
    const marks = attendance.find(row => row.courseId === course.id);
    result.push({
      courseId: course.id, title: course.title, team: teams.get(course.id) || [],
      lessons: rows.length, published: rows.filter(row => row.revision > 0).length, changes: rows.filter(row => row.revision > 0 && row.draftVersion !== row.publishedVersion).length,
      outcomes: plan.summary.total, taught: plan.summary.taught, assessed: plan.summary.assessed,
      sessions: marks?.sessions || 0, attendanceRate: marks?.marks ? Math.round(100 * marks.attended / marks.marks) : null,
      learners: learners.find(row => row.courseId === course.id)?.total || 0, lastActivity: last.find(row => row.courseId === course.id)?.at || null,
    });
  }
  return reply({ courses: result });
}

/** GET /api/people — active people of the organization, for choosing a course team. Names and roles only. */
export async function people(current: Member, db: Database) {
  const rows = (await db.prepare("SELECT u.id,u.username,COALESCE(u.display_name,u.username) AS name,CASE m.role WHEN 'instructor' THEN 'educator' ELSE m.role END AS role FROM users u JOIN memberships m ON m.user_id=u.id WHERE m.organization_id=? AND m.active=1 ORDER BY name").bind(current.organizationId).all<{ id: string; username: string; name: string; role: string }>()).results;
  return reply({ people: rows });
}
