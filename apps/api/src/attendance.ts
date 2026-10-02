import type { ClassGroup, ClassSession, GroupLearner, Member } from "@happy-learners/contracts";
import type { Database } from "./storage";
import { configurationOf } from "./courses";

const reply = (data: unknown, status = 200) => Response.json(data, { status });
const unavailable = () => reply({ error: "El grupo o la clase no está disponible en este curso." }, 404);
const statuses = new Set(["present", "late", "absent", "excused"]);

export async function classroom(path: string, method: string, input: unknown, current: Member, db: Database) {
  const parts = path.split("/");
  const courseId = parts[3];
  const course = await db.prepare("SELECT id FROM courses WHERE id=? AND organization_id=? AND status='active'").bind(courseId, current.organizationId).first();
  if (!course) return unavailable();
  if (current.role !== "educator") return reply({ error: "Solo educadores pueden consultar y administrar grupos y asistencia." }, 403);
  // Records stay readable when attendance is turned off; new groups, learners, classes and marks are not accepted.
  if (method !== "GET" && !(await configurationOf(db, current.organizationId, courseId))!.settings.attendance) return reply({ error: "La asistencia está desactivada en la configuración de este curso." }, 409);
  const now = new Date().toISOString();
  if (parts[4] === "groups" && parts.length === 5) {
    if (method === "GET") {
      const groups = await db.prepare("SELECT g.id,g.course_id AS courseId,g.name,g.status,count(l.id) AS learnerCount FROM course_groups g LEFT JOIN group_learners l ON l.group_id=g.id AND l.status='active' WHERE g.course_id=? AND g.organization_id=? GROUP BY g.id ORDER BY g.created_at DESC").bind(courseId, current.organizationId).all<ClassGroup>();
      const learners = await db.prepare("SELECT id,group_id AS groupId,display_name AS displayName,status FROM group_learners WHERE course_id=? AND organization_id=? AND status='active' ORDER BY display_name,id").bind(courseId, current.organizationId).all<GroupLearner>();
      return reply({ groups: groups.results.map(group => ({ ...group, learners: learners.results.filter(learner => learner.groupId === group.id) })) });
    }
    const value = input as Record<string, unknown> | null;
    const name = typeof value?.name === "string" ? value.name.trim() : "";
    if (!name || name.length > 100) return reply({ error: "Escribe un nombre de grupo de hasta 100 caracteres." }, 400);
    const id = `group-${crypto.randomUUID()}`;
    await db.prepare("INSERT INTO course_groups(id,course_id,organization_id,name,created_at) VALUES (?,?,?,?,?)").bind(id, courseId, current.organizationId, name, now).run();
    return reply({ id }, 201);
  }
  if (parts[4] === "groups" && parts[6] === "learners" && method === "POST") {
    const groupId = parts[5];
    const group = await db.prepare("SELECT id FROM course_groups WHERE id=? AND course_id=? AND organization_id=? AND status='active'").bind(groupId, courseId, current.organizationId).first();
    if (!group) return unavailable();
    const value = input as Record<string, unknown> | null;
    const displayName = typeof value?.displayName === "string" ? value.displayName.trim() : "";
    if (!displayName || displayName.length > 80 || /[<>\x00-\x1f]/.test(displayName)) return reply({ error: "Escribe un nombre o identificador de lista de hasta 80 caracteres." }, 400);
    const id = `learner-${crypto.randomUUID()}`;
    await db.prepare("INSERT INTO group_learners(id,group_id,course_id,organization_id,display_name,created_at) VALUES (?,?,?,?,?,?)").bind(id, groupId, courseId, current.organizationId, displayName, now).run();
    return reply({ id }, 201);
  }
  if (parts[4] === "sessions" && parts.length === 5) {
    if (method === "GET") {
      const sessions = await db.prepare("SELECT s.id,s.group_id AS groupId,s.course_id AS courseId,s.lesson_id AS lessonId,s.session_date AS sessionDate,g.name AS groupName FROM class_sessions s JOIN course_groups g ON g.id=s.group_id WHERE s.course_id=? AND s.organization_id=? ORDER BY s.session_date DESC,s.created_at DESC LIMIT 100").bind(courseId, current.organizationId).all<ClassSession>();
      return reply({ sessions: sessions.results });
    }
    const value = input as Record<string, unknown> | null;
    const groupId = typeof value?.groupId === "string" ? value.groupId : "";
    const date = typeof value?.sessionDate === "string" ? value.sessionDate : "";
    const parsedDate = new Date(`${date}T00:00:00.000Z`);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(parsedDate.getTime()) || parsedDate.toISOString().slice(0, 10) !== date) return reply({ error: "Selecciona una fecha válida." }, 400);
    const group = await db.prepare("SELECT id FROM course_groups WHERE id=? AND course_id=? AND organization_id=? AND status='active'").bind(groupId, courseId, current.organizationId).first();
    if (!group) return unavailable();
    const lessonId = typeof value?.lessonId === "string" && value.lessonId ? value.lessonId : null;
    if (lessonId && !await db.prepare("SELECT l.id FROM lessons l JOIN learning_units u ON u.id=l.course_unit_id WHERE l.id=? AND u.course_id=?").bind(lessonId, courseId).first()) return reply({ error: "La lección seleccionada no pertenece a este curso." }, 400);
    const id = `class-${crypto.randomUUID()}`;
    await db.prepare("INSERT INTO class_sessions(id,group_id,course_id,organization_id,lesson_id,session_date,created_at) VALUES (?,?,?,?,?,?,?)").bind(id, groupId, courseId, current.organizationId, lessonId, date, now).run();
    return reply({ id }, 201);
  }
  if (parts[4] === "sessions" && parts[5]) {
    const sessionId = parts[5];
    const session = await db.prepare("SELECT id,group_id AS groupId,course_id AS courseId,lesson_id AS lessonId,session_date AS sessionDate FROM class_sessions WHERE id=? AND course_id=? AND organization_id=?").bind(sessionId, courseId, current.organizationId).first<ClassSession>();
    if (!session) return unavailable();
    if (parts[6] !== "attendance") return reply({ error: "Ruta no disponible." }, 404);
    if (method === "GET") {
      const rows = await db.prepare("SELECT l.id AS learnerId,l.display_name AS displayName,COALESCE(a.status,'unmarked') AS status FROM group_learners l LEFT JOIN attendance_marks a ON a.learner_id=l.id AND a.session_id=? WHERE l.group_id=? AND l.status='active' ORDER BY l.display_name,l.id").bind(sessionId, session.groupId).all();
      return reply({ session, learners: rows.results });
    }
    const value = input as { marks?: unknown } | null;
    if (!Array.isArray(value?.marks) || value.marks.length > 500) return reply({ error: "Revisa la lista de asistencia." }, 400);
    const marks = value.marks as { learnerId?: unknown; status?: unknown }[];
    if (new Set(marks.map(mark => mark.learnerId)).size !== marks.length || marks.some(mark => typeof mark.learnerId !== "string" || typeof mark.status !== "string" || !statuses.has(mark.status))) return reply({ error: "Cada estudiante debe tener un único estado válido." }, 400);
    const roster = await db.prepare("SELECT id FROM group_learners WHERE group_id=? AND status='active'").bind(session.groupId).all<{ id: string }>();
    if (marks.length !== roster.results.length || marks.some(mark => !roster.results.some(learner => learner.id === mark.learnerId))) return reply({ error: "La lista cambió. Recárgala antes de guardar." }, 409);
    await db.batch(marks.map(mark => db.prepare("INSERT INTO attendance_marks(session_id,learner_id,status,updated_at) VALUES (?,?,?,?) ON CONFLICT(session_id,learner_id) DO UPDATE SET status=excluded.status,updated_at=excluded.updated_at").bind(sessionId, String(mark.learnerId), String(mark.status), now)));
    return reply({ saved: marks.length });
  }
  return reply({ error: "Ruta no disponible." }, 404);
}
