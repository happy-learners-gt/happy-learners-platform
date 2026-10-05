import type { ClassResource, ClassSession, ClassStatus, Lesson, Material, Member, Resource, StudentClass, StudentSpace } from "@happy-learners/contracts";
import { acceptsAttendance, classActions, classPlanInput, classStatusLabels, groupCodePattern, lessonsInOrder, localDay, nextClassStatus, normalizeGroupCode, resourceIdsOf, scheduleDates, scheduleInput, scheduleSummary, upcomingClasses } from "@happy-learners/domain";
import type { ClassAction } from "@happy-learners/domain";
import type { Database } from "./storage";
import { materialsFor } from "./courses";
import { resources } from "./content";
import { deliverFile, filesFor } from "./files";
import { event } from "./team";
import { digest, newToken } from "./auth";

const reply = (data: unknown, status = 200, headers: Record<string, string> = {}) => Response.json(data, { status, headers });
const unavailable = () => reply({ error: "La clase no está disponible en este curso." }, 404);
const marks = new Set(["present", "late", "absent", "excused"]);

const sessionColumns = `s.id,s.group_id AS groupId,s.course_id AS courseId,s.lesson_id AS lessonId,s.session_date AS sessionDate,s.starts_at AS startsAt,
  s.duration_minutes AS durationMinutes,s.status,s.version,s.origin,s.lesson_revision AS lessonRevision,s.started_at AS startedAt,s.completed_at AS completedAt,
  g.name AS groupName,json_extract(l.content,'$.title') AS lessonTitle,CASE WHEN l.id IS NOT NULL THEN l.archived=0 AND l.revision>0 END AS lessonAvailable,COALESCE(u.display_name,u.username) AS taughtByName,
  (SELECT count(*) FROM group_learners gl WHERE gl.group_id=s.group_id AND gl.status='active') AS learnerCount,
  (SELECT count(*) FROM attendance_marks m WHERE m.session_id=s.id) AS marked,
  (SELECT count(*) FROM attendance_marks m WHERE m.session_id=s.id AND m.status IN ('present','late')) AS attended`;
const sessionJoins = "FROM class_sessions s JOIN course_groups g ON g.id=s.group_id LEFT JOIN lessons l ON l.id=s.lesson_id LEFT JOIN users u ON u.id=s.taught_by";

async function timezoneOf(db: Database, organizationId: string) {
  return (await db.prepare("SELECT timezone FROM organizations WHERE id=?").bind(organizationId).first<{ timezone: string | null }>())?.timezone || "America/Guatemala";
}
export const todayFor = async (db: Database, organizationId: string) => localDay(await timezoneOf(db, organizationId));

/** Every resource of the organization's library, by id: course materials, course files and general resources. */
async function library(db: Database, organizationId: string) {
  const items: (Material | (Resource & { courseId?: string }))[] = [...await materialsFor(db, organizationId), ...await filesFor(db, organizationId), ...await resources(db, organizationId)];
  return new Map(items.map(item => [item.id, item]));
}
function classResource(item: Material | Resource, forStudents: boolean): ClassResource {
  const kind = item.kind === "file" ? "file" : item.kind === "link" ? "link" : "text";
  const available = item.status === "published";
  return { id: item.id, ...(!forStudents && "courseId" in item && item.courseId ? { courseId: item.courseId } : {}), title: item.title, description: kind === "file" ? "" : item.description, kind, ...(kind !== "file" && (!forStudents || available) ? { content: item.content } : {}), ...("fileName" in item && item.fileName ? { fileName: item.fileName } : {}), available };
}
/** A class uses its lesson's resources: the team sees the lesson as it is edited now. */
async function lessonResources(db: Database, organizationId: string, lessonId: string) {
  const row = await db.prepare("SELECT content FROM lessons WHERE id=?").bind(lessonId).first<{ content: string }>();
  if (!row) return [];
  const items = await library(db, organizationId);
  return resourceIdsOf((JSON.parse(row.content) as Lesson).activities || []).flatMap(id => { const item = items.get(id); return item ? [classResource(item, false)] : []; });
}
/** Students receive the resources of the lesson's current publication, by lesson id. */
async function publishedResources(db: Database, lessonIds: string[]) {
  const ids = [...new Set(lessonIds)];
  if (!ids.length) return new Map<string, ClassResource[]>();
  const rows = (await db.prepare(`SELECT id,json_extract(published_content,'$.resources') AS resources FROM lessons WHERE id IN (${ids.map(() => "?").join(",")}) AND archived=0 AND revision>0`).bind(...ids).all<{ id: string; resources: string | null }>()).results;
  return new Map(rows.map(row => [row.id, (JSON.parse(row.resources || "[]") as (Material | Resource)[]).filter(Boolean).map(item => classResource(item, true)).filter(item => item.available)]));
}

/** A class receives a published lesson of its course (ST-027); the lesson it already has may stay while it is replaced. */
async function checkLesson(db: Database, courseId: string, lessonId: string | null, current?: string | null) {
  if (!lessonId || lessonId === current) return null;
  if (!await db.prepare("SELECT l.id FROM lessons l JOIN learning_units u ON u.id=l.course_unit_id WHERE l.id=? AND u.course_id=? AND l.archived=0 AND l.revision>0").bind(lessonId, courseId).first()) return "Elige una lección publicada de este curso.";
  return null;
}
/** Published lessons of the course in content order: module position, then lesson position. */
async function courseLessons(db: Database, courseId: string) {
  return (await db.prepare("SELECT l.id FROM lessons l JOIN learning_units u ON u.id=l.course_unit_id WHERE u.course_id=? AND u.status='active' AND l.archived=0 AND l.revision>0 ORDER BY u.position,l.position,l.id").bind(courseId).all<{ id: string }>()).results.map(row => row.id);
}

const actionSummary: Record<ClassAction, string> = { start: "Comenzó", complete: "Finalizó", cancel: "Canceló", restore: "Reprogramó" };

/** /api/courses/:id/sessions[/:sid[/attendance|/start|/complete|/cancel|/restore]] — the course team plans, teaches and records its classes. */
export async function sessions(parts: string[], method: string, input: unknown, current: Member, db: Database, courseId: string) {
  const now = new Date().toISOString();
  const [sessionId, sub] = [parts[5], parts[6]];
  if (!sessionId) {
    if (method === "GET") {
      const rows = (await db.prepare(`SELECT ${sessionColumns} ${sessionJoins} WHERE s.course_id=? AND s.organization_id=? ORDER BY s.session_date DESC,s.starts_at DESC,s.created_at DESC LIMIT 400`).bind(courseId, current.organizationId).all<ClassSession>()).results;
      return reply({ sessions: rows, today: await todayFor(db, current.organizationId) });
    }
    const plan = classPlanInput(input);
    if ("error" in plan) return reply(plan, 400);
    const groupId = typeof (input as Record<string, unknown>)?.groupId === "string" ? String((input as Record<string, unknown>).groupId) : "";
    const group = await db.prepare("SELECT id,name FROM course_groups WHERE id=? AND course_id=? AND organization_id=? AND status='active'").bind(groupId, courseId, current.organizationId).first<{ id: string; name: string }>();
    if (!group) return reply({ error: "Elige una sección activa de este curso." }, 400);
    const problem = await checkLesson(db, courseId, plan.lessonId);
    if (problem) return reply({ error: problem }, 400);
    const id = `class-${crypto.randomUUID()}`;
    await db.batch([
      db.prepare("INSERT INTO class_sessions(id,group_id,course_id,organization_id,lesson_id,session_date,starts_at,duration_minutes,notes,status,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,'planned',?,?)")
        .bind(id, group.id, courseId, current.organizationId, plan.lessonId, plan.sessionDate, plan.startsAt, plan.durationMinutes, plan.notes, now, now),
      event(db, current, { action: "planned", targetType: "session", targetId: id, courseId, summary: `Agregó la clase del ${plan.sessionDate} en «${group.name}»` }),
    ]);
    return reply({ id }, 201);
  }
  const session = await db.prepare(`SELECT ${sessionColumns},s.notes ${sessionJoins} WHERE s.id=? AND s.course_id=? AND s.organization_id=?`).bind(sessionId, courseId, current.organizationId).first<ClassSession>();
  if (!session) return unavailable();
  if (!sub) {
    if (method === "GET") {
      const [resourcesList, lesson, learners, groupActive] = await Promise.all([
        session.lessonId ? lessonResources(db, current.organizationId, session.lessonId) : [],
        session.lessonId ? db.prepare("SELECT l.id,json_extract(l.content,'$.title') AS title,l.revision,l.archived,json_extract(l.published_content,'$.shareCode') AS shareCode FROM lessons l WHERE l.id=?").bind(session.lessonId).first<{ id: string; title: string; revision: number; archived: number; shareCode: string | null }>() : null,
        attendanceRows(db, sessionId, session.groupId),
        db.prepare("SELECT status FROM course_groups WHERE id=?").bind(session.groupId).first<{ status: string }>(),
      ]);
      return reply({ session, lesson: lesson ? { id: lesson.id, title: lesson.title, revision: lesson.revision, archived: !!lesson.archived, shareCode: lesson.revision > 0 && !lesson.archived ? lesson.shareCode : null } : null, resources: resourcesList, learners, groupActive: groupActive?.status === "active" });
    }
    const plan = classPlanInput(input);
    if ("error" in plan) return reply(plan, 400);
    if (session.status === "cancelled") return reply({ error: "Reprograma la clase antes de editarla." }, 409);
    const problem = await checkLesson(db, courseId, plan.lessonId, session.lessonId);
    if (problem) return reply({ error: problem }, 400);
    const version = Number((input as Record<string, unknown>).version);
    const ok = await db.guardedBatch(
      db.prepare("UPDATE class_sessions SET session_date=?,starts_at=?,duration_minutes=?,lesson_id=?,notes=?,version=version+1,updated_at=? WHERE id=? AND organization_id=? AND version=? AND status<>'cancelled' RETURNING id")
        .bind(plan.sessionDate, plan.startsAt, plan.durationMinutes, plan.lessonId, plan.notes, now, sessionId, current.organizationId, Number.isInteger(version) ? version : -1),
      [event(db, current, { action: "updated", targetType: "session", targetId: sessionId, courseId, summary: `Actualizó la clase del ${plan.sessionDate} en «${session.groupName}»` })]);
    return ok ? reply({ ok: true }) : reply({ error: "La clase cambió mientras la editabas. Recarga para ver la versión actual." }, 409);
  }
  if (sub === "lesson" && method === "PUT") {
    // Changing only the lesson keeps the date, time and notes of the class.
    const value = input as Record<string, unknown> | null;
    const lessonId = value?.lessonId === null || value?.lessonId === "" ? null : typeof value?.lessonId === "string" ? value.lessonId : undefined;
    if (lessonId === undefined) return reply({ error: "Elige una lección del curso." }, 400);
    if (session.status === "cancelled" || session.status === "completed") return reply({ error: "Solo se cambia la lección de una clase pendiente o en curso." }, 409);
    const problem = await checkLesson(db, courseId, lessonId, session.lessonId);
    if (problem) return reply({ error: problem }, 400);
    const version = Number(value?.version);
    const ok = await db.guardedBatch(
      db.prepare("UPDATE class_sessions SET lesson_id=?,version=version+1,updated_at=? WHERE id=? AND organization_id=? AND version=? AND status IN ('planned','in_progress') RETURNING id").bind(lessonId, now, sessionId, current.organizationId, Number.isInteger(version) ? version : -1),
      [event(db, current, { action: "updated", targetType: "session", targetId: sessionId, courseId, summary: `Cambió la lección de la clase del ${session.sessionDate} en «${session.groupName}»` })]);
    return ok ? reply({ ok: true }) : reply({ error: "La clase cambió mientras la editabas. Recarga para ver la versión actual." }, 409);
  }
  if (sub === "attendance") {
    if (method === "GET") return reply({ session, learners: await attendanceRows(db, sessionId, session.groupId) });
    if (!acceptsAttendance(session.status)) return reply({ error: "Una clase cancelada no registra asistencia. Reprográmala primero." }, 409);
    const value = input as { marks?: unknown } | null;
    if (!Array.isArray(value?.marks) || value.marks.length > 500) return reply({ error: "Revisa la lista de asistencia." }, 400);
    const list = value.marks as { learnerId?: unknown; status?: unknown }[];
    if (new Set(list.map(mark => mark.learnerId)).size !== list.length || list.some(mark => typeof mark.learnerId !== "string" || typeof mark.status !== "string" || !marks.has(mark.status))) return reply({ error: "Cada estudiante debe tener un único estado válido." }, 400);
    const roster = (await db.prepare("SELECT id FROM group_learners WHERE group_id=? AND status='active'").bind(session.groupId).all<{ id: string }>()).results;
    if (list.length !== roster.length || list.some(mark => !roster.some(learner => learner.id === mark.learnerId))) return reply({ error: "La lista cambió. Recárgala antes de guardar." }, 409);
    const present = list.filter(mark => mark.status === "present" || mark.status === "late").length;
    await db.batch([
      ...list.map(mark => db.prepare("INSERT INTO attendance_marks(session_id,learner_id,status,updated_at) VALUES (?,?,?,?) ON CONFLICT(session_id,learner_id) DO UPDATE SET status=excluded.status,updated_at=excluded.updated_at").bind(sessionId, String(mark.learnerId), String(mark.status), now)),
      // Taking the roll opens a planned class: it is being taught now, by this educator, with the lesson's current publication.
      ...(session.status === "planned" ? [start(db, sessionId, current, now)] : []),
      event(db, current, { action: "recorded", targetType: "session", targetId: sessionId, courseId, summary: `Pasó lista del ${session.sessionDate} en «${session.groupName}»: ${present} de ${list.length} presentes` }),
    ]);
    return reply({ saved: list.length, status: session.status === "planned" ? "in_progress" : session.status });
  }
  if (!classActions.includes(sub as ClassAction) || method !== "POST") return reply({ error: "Ruta no disponible." }, 404);
  const action = sub as ClassAction;
  const target = nextClassStatus(session.status, action);
  if (!target) return reply({ error: `Una clase ${classStatusLabels[session.status].toLowerCase()} no se puede ${{ start: "comenzar", complete: "finalizar", cancel: "cancelar", restore: "reprogramar" }[action]}.` }, 409);
  if (action === "complete" && Number(session.learnerCount) > Number(session.marked)) {
    const missing = Number(session.learnerCount) - Number(session.marked);
    return reply({ error: `Pasa lista antes de finalizar: ${missing === 1 ? "falta 1 estudiante" : `faltan ${missing} estudiantes`}.` }, 409);
  }
  if (action === "restore" && !await db.prepare("SELECT id FROM course_groups WHERE id=? AND status='active'").bind(session.groupId).first()) return reply({ error: "La sección está cerrada. Reactívala para reprogramar sus clases." }, 409);
  const statement = action === "start" ? start(db, sessionId, current, now)
    : action === "complete" ? db.prepare("UPDATE class_sessions SET status='completed',completed_at=?,started_at=COALESCE(started_at,?),taught_by=COALESCE(taught_by,?),lesson_revision=COALESCE(lesson_revision,(SELECT CASE WHEN l.revision>0 THEN l.revision END FROM lessons l WHERE l.id=class_sessions.lesson_id)),version=version+1,updated_at=? WHERE id=?").bind(now, now, current.id, now, sessionId)
    : db.prepare("UPDATE class_sessions SET status=?,version=version+1,updated_at=? WHERE id=?").bind(target, now, sessionId);
  const ok = await db.guardedBatch(db.prepare("SELECT id FROM class_sessions WHERE id=? AND status=?").bind(sessionId, session.status), [statement,
    event(db, current, { action: action === "cancel" ? "archived" : action === "restore" ? "restored" : "recorded", targetType: "session", targetId: sessionId, courseId, summary: `${actionSummary[action]} la clase del ${session.sessionDate} en «${session.groupName}»` })]);
  return ok ? reply({ status: target as ClassStatus }) : reply({ error: "La clase cambió mientras tanto. Recarga para ver su estado." }, 409);
}
function start(db: Database, sessionId: string, current: Member, now: string) {
  return db.prepare("UPDATE class_sessions SET status='in_progress',started_at=?,taught_by=?,lesson_revision=(SELECT CASE WHEN l.revision>0 THEN l.revision END FROM lessons l WHERE l.id=class_sessions.lesson_id),version=version+1,updated_at=? WHERE id=? AND status='planned'").bind(now, current.id, now, sessionId);
}
async function attendanceRows(db: Database, sessionId: string, groupId: string) {
  return (await db.prepare("SELECT l.id AS learnerId,l.display_name AS displayName,COALESCE(a.status,'unmarked') AS status FROM group_learners l LEFT JOIN attendance_marks a ON a.learner_id=l.id AND a.session_id=? WHERE l.group_id=? AND (l.status='active' OR a.status IS NOT NULL) ORDER BY l.display_name,l.id").bind(sessionId, groupId).all()).results;
}

/** GET /api/classes — the next classes of the courses the educator teaches, for the home page. */
export async function myClasses(current: Member, db: Database) {
  if (current.role !== "educator") return reply({ classes: [], today: await todayFor(db, current.organizationId) });
  const today = await todayFor(db, current.organizationId);
  const rows = (await db.prepare(`SELECT ${sessionColumns},c.title AS courseTitle ${sessionJoins} JOIN courses c ON c.id=s.course_id AND c.status='active'
    JOIN course_members cm ON cm.course_id=s.course_id AND cm.organization_id=s.organization_id AND cm.user_id=?
    WHERE s.organization_id=? AND g.status='active' AND ((s.session_date>=? AND s.status='planned') OR s.status='in_progress') ORDER BY s.session_date,s.starts_at LIMIT 40`).bind(current.id, current.organizationId, today).all<ClassSession>()).results;
  // A class left open on an earlier day still needs to be finished, so it stays first.
  const open = rows.filter(row => row.status === "in_progress" && row.sessionDate < today);
  return reply({ today, classes: [...open, ...upcomingClasses(rows.filter(row => !open.includes(row)), today)].slice(0, 8) });
}

type Group = { id: string; name: string };
const scheduleColumns = "schedule_weekdays AS weekdays,schedule_starts_at AS startsAt,schedule_duration AS durationMinutes,schedule_from AS \"from\",schedule_until AS until";
type StoredSchedule = { weekdays: string | null; startsAt: string | null; durationMinutes: number | null; from: string | null; until: string | null };
export const scheduleOf = (row: StoredSchedule) => row.weekdays && row.startsAt && row.durationMinutes && row.from && row.until ? { weekdays: row.weekdays.split(",").map(Number), startsAt: row.startsAt, durationMinutes: row.durationMinutes, from: row.from, until: row.until } : null;

/**
 * PUT|DELETE /api/courses/:id/groups/:gid/schedule — saving the section's schedule generates its classes for the
 * period. A change rebuilds only the generated classes that have not started; past classes, classes added by hand
 * and their attendance stay. The lessons already planned keep their order on the new days.
 */
export async function saveSchedule(method: string, input: unknown, current: Member, db: Database, courseId: string, group: Group) {
  const now = new Date().toISOString();
  const today = await todayFor(db, current.organizationId);
  const schedule = method === "DELETE" ? null : scheduleInput(input);
  if (schedule && "error" in schedule) return reply(schedule, 400);
  const before = await db.prepare(`SELECT ${scheduleColumns} FROM course_groups WHERE id=?`).bind(group.id).first<StoredSchedule>();
  const pending = (await db.prepare("SELECT id,session_date AS sessionDate,lesson_id AS lessonId FROM class_sessions WHERE group_id=? AND origin='schedule' AND status='planned' AND session_date>=? ORDER BY session_date,starts_at").bind(group.id, today).all<{ id: string; sessionDate: string; lessonId: string | null }>()).results;
  const taken = new Set((await db.prepare("SELECT session_date AS sessionDate FROM class_sessions WHERE group_id=? AND session_date>=? AND NOT (origin='schedule' AND status='planned')").bind(group.id, today).all<{ sessionDate: string }>()).results.map(row => row.sessionDate));
  const dates = schedule ? scheduleDates(schedule, today).filter(day => !taken.has(day)) : [];
  const kept = pending.filter(row => dates.includes(row.sessionDate));
  const removed = pending.filter(row => !dates.includes(row.sessionDate));
  const added = dates.filter(day => !kept.some(row => row.sessionDate === day)).map(day => ({ id: `class-${crypto.randomUUID()}`, sessionDate: day }));
  const lessons = pending.flatMap(row => row.lessonId ? [row.lessonId] : []);
  const ordered = [...kept, ...added].sort((a, b) => a.sessionDate.localeCompare(b.sessionDate));
  const lessonFor = (id: string) => lessons[ordered.findIndex(row => row.id === id)] ?? null;
  const same = (column: string) => `${column} IS ?`;
  const ok = await db.guardedBatch(
    db.prepare(`SELECT id FROM course_groups WHERE id=? AND status='active' AND ${["schedule_weekdays", "schedule_starts_at", "schedule_duration", "schedule_from", "schedule_until"].map(same).join(" AND ")}`).bind(group.id, before?.weekdays ?? null, before?.startsAt ?? null, before?.durationMinutes ?? null, before?.from ?? null, before?.until ?? null), [
      db.prepare("UPDATE course_groups SET schedule_weekdays=?,schedule_starts_at=?,schedule_duration=?,schedule_from=?,schedule_until=? WHERE id=?").bind(schedule ? schedule.weekdays.join(",") : null, schedule?.startsAt ?? null, schedule?.durationMinutes ?? null, schedule?.from ?? null, schedule?.until ?? null, group.id),
      ...removed.flatMap(row => [db.prepare("DELETE FROM class_session_resources WHERE session_id=?").bind(row.id), db.prepare("DELETE FROM class_sessions WHERE id=? AND status='planned'").bind(row.id)]),
      ...kept.map(row => db.prepare("UPDATE class_sessions SET starts_at=?,duration_minutes=?,lesson_id=?,version=version+1,updated_at=? WHERE id=? AND status='planned'").bind(schedule!.startsAt, schedule!.durationMinutes, lessonFor(row.id), now, row.id)),
      ...added.map(row => db.prepare("INSERT INTO class_sessions(id,group_id,course_id,organization_id,lesson_id,session_date,starts_at,duration_minutes,notes,status,origin,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,'','planned','schedule',?,?)")
        .bind(row.id, group.id, courseId, current.organizationId, lessonFor(row.id), row.sessionDate, schedule!.startsAt, schedule!.durationMinutes, now, now)),
      event(db, current, { action: "updated", targetType: "group", targetId: group.id, courseId, summary: schedule ? `Configuró el horario de «${group.name}»: ${scheduleSummary(schedule)}, ${ordered.length} clases pendientes` : `Quitó el horario de «${group.name}» y sus ${removed.length} clases pendientes` }),
    ]);
  return ok ? reply({ schedule: schedule || null, classes: ordered.length, added: added.length, removed: removed.length }) : reply({ error: "La sección cambió mientras tanto. Recarga para ver su horario actual." }, 409);
}

/** POST /api/courses/:id/groups/:gid/lessons — gives the upcoming classes without a lesson the next published lessons in content order. */
export async function fillLessons(current: Member, db: Database, courseId: string, group: Group) {
  const now = new Date().toISOString();
  const today = await todayFor(db, current.organizationId);
  const [ordered, classes] = await Promise.all([
    courseLessons(db, courseId),
    db.prepare("SELECT id,session_date AS sessionDate,lesson_id AS lessonId,status FROM class_sessions WHERE group_id=? AND status<>'cancelled' ORDER BY session_date,starts_at").bind(group.id).all<{ id: string; sessionDate: string; lessonId: string | null; status: ClassStatus }>(),
  ]);
  const used = classes.results.flatMap(row => row.lessonId ? [row.lessonId] : []);
  const plan = lessonsInOrder(classes.results.filter(row => row.status === "planned" && row.sessionDate >= today), ordered, used);
  if (!plan.length) return reply({ assigned: 0 });
  await db.batch([
    ...plan.map(item => db.prepare("UPDATE class_sessions SET lesson_id=?,version=version+1,updated_at=? WHERE id=? AND status='planned' AND lesson_id IS NULL").bind(item.lessonId, now, item.sessionId)),
    event(db, current, { action: "planned", targetType: "group", targetId: group.id, courseId, summary: `Asignó ${plan.length === 1 ? "1 lección" : `${plan.length} lecciones`} en orden a las clases de «${group.name}»` }),
  ]);
  return reply({ assigned: plan.length });
}

const studentCookie = (token: string, request: Request, remove = false) => `hl_group=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${remove ? 0 : 28800}${new URL(request.url).protocol === "https:" ? "; Secure" : ""}`;
export const studentToken = (request: Request) => /(?:^|;\s*)hl_group=([do]_[a-f0-9]{64})(?:;|$)/.exec(request.headers.get("Cookie") || "")?.[1] || null;
export const studentScope = (code: string) => code.startsWith("OG-") ? "org-other" : "org-demo";

/** /api/student/* — a learner enters a section code and reads that section's classes, lessons and resources. Read-only. */
export async function student(path: string, method: string, input: unknown, request: Request, scope: string, db: Database, bucket: R2Bucket) {
  if (path === "/api/student/login") {
    const code = normalizeGroupCode((input as Record<string, unknown> | null)?.code);
    if (!groupCodePattern.test(code)) return reply({ error: "Escribe el código de la sección tal como te lo dieron, por ejemplo DG-MATE-3A." }, 400);
    const now = Date.now();
    const bucketKey = await digest(`group:${new Date().toISOString().slice(0, 10)}:${request.headers.get("CF-Connecting-IP") || "local"}`);
    const limit = await db.prepare("INSERT INTO login_limits (bucket, attempts, expires_at) VALUES (?,1,?) ON CONFLICT(bucket) DO UPDATE SET attempts=CASE WHEN expires_at<? THEN 1 ELSE attempts+1 END, expires_at=CASE WHEN expires_at<? THEN excluded.expires_at ELSE expires_at END RETURNING attempts")
      .bind(bucketKey, now + 900000, now, now).first<{ attempts: number }>();
    if (!limit || limit.attempts > 30) return reply({ error: "Demasiados intentos. Espera 15 minutos y vuelve a intentar." }, 429, { "Retry-After": "900" });
    const group = await db.prepare("SELECT g.id,g.organization_id AS organizationId FROM course_groups g JOIN courses c ON c.id=g.course_id AND c.status='active' WHERE g.access_code=? AND g.status='active'").bind(code).first<{ id: string; organizationId: string }>();
    if (!group) return reply({ error: "Ese código no corresponde a una sección activa. Revísalo con tu educador." }, 404);
    const token = (scope === "org-other" ? "o_" : "d_") + newToken();
    await db.batch([
      db.prepare("DELETE FROM group_access_sessions WHERE expires_at<=?").bind(now),
      db.prepare("INSERT INTO group_access_sessions(token_hash,group_id,organization_id,expires_at) VALUES (?,?,?,?)").bind(await digest(token), group.id, group.organizationId, now + 28800000),
    ]);
    return reply({ ok: true }, 200, { "Set-Cookie": studentCookie(token, request) });
  }
  const token = studentToken(request);
  if (path === "/api/student/logout") {
    if (token) await db.prepare("DELETE FROM group_access_sessions WHERE token_hash=?").bind(await digest(token)).run();
    return reply({ ok: true }, 200, { "Set-Cookie": studentCookie("", request, true) });
  }
  // The code stops working as soon as it is changed or the section is closed: the session follows the section's current code.
  const access = token ? await db.prepare("SELECT a.group_id AS groupId,a.organization_id AS organizationId,g.name AS groupName,c.id AS courseId,c.title AS courseTitle,o.name AS organizationName,o.timezone FROM group_access_sessions a JOIN course_groups g ON g.id=a.group_id AND g.status='active' AND g.access_code IS NOT NULL JOIN courses c ON c.id=g.course_id AND c.status='active' JOIN organizations o ON o.id=a.organization_id WHERE a.token_hash=? AND a.expires_at>?").bind(await digest(token), Date.now()).first<{ groupId: string; organizationId: string; groupName: string; courseId: string; courseTitle: string; organizationName: string; timezone: string | null }>() : null;
  if (!access) return reply({ error: "Escribe el código de tu sección para continuar." }, 401, token ? { "Set-Cookie": studentCookie("", request, true) } : {});
  const fileMatch = path.match(/^\/api\/student\/files\/([a-z0-9-]+)$/);
  if (fileMatch) {
    // Only files published in a lesson of one of the section's classes.
    const linked = await db.prepare("SELECT 1 AS ok FROM class_sessions s JOIN lessons l ON l.id=s.lesson_id AND l.archived=0 AND l.revision>0, json_each(l.published_content,'$.resources') r WHERE s.group_id=? AND s.status<>'cancelled' AND json_extract(r.value,'$.id')=? AND json_extract(r.value,'$.status')='published' LIMIT 1").bind(access.groupId, fileMatch[1]).first();
    if (!linked) return reply({ error: "Este archivo no forma parte de las clases de tu sección." }, 404);
    return deliverFile(fileMatch[1], access.organizationId, db, bucket);
  }
  if (path !== "/api/student/space" || method !== "GET") return reply({ error: "Ruta no disponible." }, 404);
  const today = localDay(access.timezone || "America/Guatemala");
  const rows = (await db.prepare("SELECT s.id,s.lesson_id AS lessonId,s.session_date AS sessionDate,s.starts_at AS startsAt,s.duration_minutes AS durationMinutes,s.status,json_extract(l.content,'$.title') AS lessonTitle,CASE WHEN l.revision>0 AND l.archived=0 THEN json_extract(l.published_content,'$.shareCode') END AS shareCode,CASE WHEN l.revision>0 AND l.archived=0 THEN json_extract(l.published_content,'$.title') END AS publishedTitle FROM class_sessions s LEFT JOIN lessons l ON l.id=s.lesson_id WHERE s.group_id=? AND s.status<>'cancelled' ORDER BY s.session_date,s.starts_at").bind(access.groupId).all<{ id: string; lessonId: string | null; sessionDate: string; startsAt: string | null; durationMinutes: number | null; status: ClassStatus; lessonTitle: string | null; shareCode: string | null; publishedTitle: string | null }>()).results;
  const upcoming = upcomingClasses(rows, today).slice(0, 6);
  const recent = rows.filter(row => row.status === "completed").slice(-5).reverse();
  const resourceMap = await publishedResources(db, [...upcoming, ...recent].flatMap(row => row.lessonId ? [row.lessonId] : []));
  // Students see a lesson only once it is published, under its published title.
  const view = (row: typeof rows[number]): StudentClass => ({ id: row.id, sessionDate: row.sessionDate, startsAt: row.startsAt, durationMinutes: row.durationMinutes, status: row.status, lesson: row.shareCode ? { title: row.publishedTitle || row.lessonTitle || "Lección", shareCode: row.shareCode } : null, resources: row.lessonId ? resourceMap.get(row.lessonId) || [] : [] });
  // The lessons of the section's classes, once each, in the order the classes give them.
  const lessons = rows.filter(row => row.shareCode).filter((row, index, list) => list.findIndex(other => other.shareCode === row.shareCode) === index).map(row => ({ title: row.publishedTitle || row.lessonTitle || "Lección", shareCode: row.shareCode! }));
  const space: StudentSpace = { group: { name: access.groupName }, course: { title: access.courseTitle }, organization: access.organizationName, today, next: upcoming[0] ? view(upcoming[0]) : null, upcoming: upcoming.slice(1).map(view), recent: recent.map(view), lessons };
  return reply(space);
}
