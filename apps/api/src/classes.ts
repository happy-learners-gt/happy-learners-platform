import type { CalendarBreak, ClassLesson, ClassLessonPlan, ClassResource, ClassSession, ClassStatus, CourseAccess, InstitutionalCalendarEvent, Lesson, Material, Member, Pacing, Resource, ScheduleMeeting, SectionSchedule, StudentClass, StudentPathModule, StudentSpace } from "@happy-learners/contracts";
import { acceptsAttendance, breakInput, cancelPlanInput, carryOver, classActions, classPlanInput, classStatusLabels, completionInput, groupCodePattern, inSessionFilter, lessonsInOrder, meetingOn, maxClassLessons, localDay, nextClassStatus, noClassDays, normalizeGroupCode, resourceIdsOf, scheduleDates, scheduleInput, scheduleSummary, seesSection, sessionFilterAllowed, sessionFilterInput, teachesSection, upcomingClasses } from "@happy-learners/domain";
import { tokenPattern, tokenPrefix } from "@happy-learners/domain";
import type { ClassAction } from "@happy-learners/domain";
import type { Database, Prepared } from "./storage";
import { learnerEducatorPhoto, learnerEducators } from "./professional";
import { materialsFor } from "./courses";
import { resources } from "./content";
import { deliverFile, filesFor } from "./files";
import { event } from "./team";
import { digest, newToken } from "./auth";
import { contractBlock } from "./contracts";
import { notify, type Notifier } from "./notify";

const reply = (data: unknown, status = 200, headers: Record<string, string> = {}) => Response.json(data, { status, headers });
const unavailable = () => reply({ error: "La clase no está disponible en este curso." }, 404);
const notTeaching = () => reply({ error: "Solo quienes imparten la sección planifican y registran sus clases." }, 403);
const marks = new Set(["present", "late", "absent", "excused"]);

/** The lessons of each class, in order, with their module and whether students can open them. */
const lessonsColumn = `(SELECT json_group_array(json_object('id',x.id,'title',x.title,'position',x.position,'unitTitle',x.unitTitle,'available',x.available,'revision',x.revision,'outcome',x.outcome)) FROM (
    SELECT l.id,json_extract(l.content,'$.title') AS title,p.position,u.name AS unitTitle,CASE WHEN l.archived=0 AND l.revision>0 THEN 1 ELSE 0 END AS available,p.revision,p.outcome
    FROM class_session_lessons p JOIN lessons l ON l.id=p.lesson_id LEFT JOIN learning_units u ON u.id=l.course_unit_id WHERE p.session_id=s.id ORDER BY p.position) x) AS lessons`;
const sessionColumns = `s.id,s.group_id AS groupId,s.course_id AS courseId,s.session_date AS sessionDate,s.starts_at AS startsAt,
  s.duration_minutes AS durationMinutes,s.status,s.version,s.origin,s.notes,s.started_at AS startedAt,s.completed_at AS completedAt,
  g.name AS groupName,COALESCE(u.display_name,u.username) AS taughtByName,${lessonsColumn},
  (SELECT count(*) FROM group_learners gl WHERE gl.group_id=s.group_id AND gl.status='active') AS learnerCount,
  (SELECT count(*) FROM attendance_marks m WHERE m.session_id=s.id) AS marked,
  (SELECT count(*) FROM attendance_marks m WHERE m.session_id=s.id AND m.status IN ('present','late')) AS attended`;
const sessionJoins = "FROM class_sessions s JOIN course_groups g ON g.id=s.group_id LEFT JOIN users u ON u.id=s.taught_by";
type StoredSession = Omit<ClassSession, "lessons"> & { lessons: string | null };
const withLessons = (row: StoredSession): ClassSession => ({ ...row, lessons: (JSON.parse(row.lessons || "[]") as (ClassLesson & { available: number | boolean })[]).map(lesson => ({ ...lesson, available: !!lesson.available })) });

export async function timezoneOf(db: Database, organizationId: string) {
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
/** The lessons as the team edits them now, by id: their activities and the library resources those use. */
async function lessonContents(db: Database, lessonIds: string[]) {
  const ids = [...new Set(lessonIds)];
  if (!ids.length) return new Map<string, Lesson>();
  const rows = (await db.prepare(`SELECT id,content FROM lessons WHERE id IN (${ids.map(() => "?").join(",")})`).bind(...ids).all<{ id: string; content: string }>()).results;
  return new Map(rows.map(row => [row.id, JSON.parse(row.content) as Lesson]));
}
/** What each planned lesson brings to the schedule of classes: activities and resources, for the course team. */
async function lessonPlans(db: Database, organizationId: string, lessonIds: string[]) {
  const contents = await lessonContents(db, lessonIds);
  if (!contents.size) return {};
  const items = await library(db, organizationId);
  return Object.fromEntries([...contents].map(([id, lesson]): [string, ClassLessonPlan] => [id, {
    activities: (lesson.activities || []).map(activity => ({ id: activity.id || "", title: activity.title, minutes: Number(activity.minutes) || 0, ...(activity.grouping ? { grouping: activity.grouping } : {}) })),
    resources: resourceIdsOf(lesson.activities || []).flatMap(resourceId => { const item = items.get(resourceId); return item ? [{ id: item.id, title: item.title, kind: item.kind === "file" ? "file" as const : item.kind === "link" ? "link" as const : "text" as const }] : []; }),
  }]));
}
/** Students receive the resources of each lesson's current publication, by lesson id. */
async function publishedResources(db: Database, lessonIds: string[]) {
  const ids = [...new Set(lessonIds)];
  if (!ids.length) return new Map<string, ClassResource[]>();
  const rows = (await db.prepare(`SELECT id,json_extract(published_content,'$.resources') AS resources FROM lessons WHERE id IN (${ids.map(() => "?").join(",")}) AND archived=0 AND revision>0`).bind(...ids).all<{ id: string; resources: string | null }>()).results;
  return new Map(rows.map(row => [row.id, (JSON.parse(row.resources || "[]") as (Material | Resource)[]).filter(Boolean).map(item => classResource(item, true)).filter(item => item.available)]));
}
const unique = <T extends { id: string }>(items: T[]) => items.filter((item, index) => items.findIndex(other => other.id === item.id) === index);

/** A class receives published lessons of its course (ST-027); lessons it already has may stay while they are replaced. */
async function checkLessons(db: Database, courseId: string, lessonIds: string[], current: string[] = []) {
  const fresh = lessonIds.filter(id => !current.includes(id));
  if (!fresh.length) return null;
  const found = (await db.prepare(`SELECT l.id FROM lessons l JOIN learning_units u ON u.id=l.course_unit_id WHERE l.id IN (${fresh.map(() => "?").join(",")}) AND u.course_id=? AND l.archived=0 AND l.revision>0`).bind(...fresh, courseId).all()).results;
  return found.length === fresh.length ? null : "Elige lecciones publicadas de este curso.";
}
/**
 * Replaces the lessons of a class in the given order. Lessons it keeps keep the publication they were taught with;
 * a class already in progress records the current publication of the lessons added to it.
 */
function planLessons(db: Database, sessionId: string, lessonIds: string[], kept = new Map<string, number | null | undefined>(), running = false): Prepared[] {
  return [
    db.prepare("DELETE FROM class_session_lessons WHERE session_id=?").bind(sessionId),
    ...lessonIds.map((lessonId, position) => db.prepare("INSERT INTO class_session_lessons(session_id,lesson_id,position,revision) VALUES (?,?,?,COALESCE(?,CASE WHEN ?=1 THEN (SELECT CASE WHEN revision>0 THEN revision END FROM lessons WHERE id=?) END))")
      .bind(sessionId, lessonId, position, kept.get(lessonId) ?? null, running ? 1 : 0, lessonId)),
  ];
}
/** Published lessons of the course in content order: module position, then lesson position. */
async function courseLessons(db: Database, courseId: string) {
  return (await db.prepare("SELECT l.id FROM lessons l JOIN learning_units u ON u.id=l.course_unit_id WHERE u.course_id=? AND u.status='active' AND l.archived=0 AND l.revision>0 ORDER BY u.position,l.position,l.id").bind(courseId).all<{ id: string }>()).results.map(row => row.id);
}
const sameList = (a: string[], b: string[]) => a.length === b.length && a.every((id, index) => id === b[index]);

const actionSummary: Record<ClassAction, string> = { start: "Comenzó", complete: "Finalizó", cancel: "Canceló", restore: "Reprogramó" };
const stale = () => reply({ error: "La clase cambió mientras la editabas. Recarga para ver la versión actual." }, 409);

/**
 * /api/courses/:id/sessions[/:sid[/attendance|/start|/complete|/cancel|/restore]] — the course team plans the schedule
 * of classes (lessons and comments), then teaches each class: it starts it, takes the roll and finishes it.
 * GET accepts ?section=&from=&to= (ST-065): one section and a period of calendar days, inclusive and combinable.
 */
export async function sessions(parts: string[], method: string, input: unknown, current: Member, db: Database, courseId: string, access: CourseAccess, query = new URLSearchParams(), notifier?: Notifier) {
  const now = new Date().toISOString();
  const [sessionId, sub] = [parts[5], parts[6]];
  if (!sessionId) {
    if (method === "GET") {
      const filter = sessionFilterInput(query);
      if ("error" in filter) return reply(filter, 400);
      // A section outside the course, or one the person does not see, is not there for them: nothing about it leaks.
      if (!sessionFilterAllowed(access, filter) || (filter.section && !await db.prepare("SELECT id FROM course_groups WHERE id=? AND course_id=? AND organization_id=?").bind(filter.section, courseId, current.organizationId).first()))
        return reply({ error: "La sección no está disponible en este curso." }, 404);
      // Class days are calendar days of the organization's time zone, so the period compares them as they are stored.
      const narrowed = [filter.section && ["s.group_id=?", filter.section], filter.from && ["s.session_date>=?", filter.from], filter.to && ["s.session_date<=?", filter.to]].filter(Boolean) as [string, string][];
      const rows = (await db.prepare(`SELECT ${sessionColumns} ${sessionJoins} WHERE s.course_id=? AND s.organization_id=?${narrowed.map(([clause]) => ` AND ${clause}`).join("")} ORDER BY s.session_date DESC,s.starts_at DESC,s.created_at DESC LIMIT 400`).bind(courseId, current.organizationId, ...narrowed.map(([, value]) => value)).all<StoredSession>()).results.map(withLessons).filter(row => seesSection(access, row.groupId) && inSessionFilter(row, filter));
      const breaks = (await db.prepare(`SELECT ${breakColumns} FROM calendar_events e JOIN calendars c ON c.id=e.calendar_id
        JOIN courses co ON co.id=? AND co.organization_id=e.organization_id
        WHERE e.organization_id=? AND e.no_class=1 AND e.status='active' AND (c.scope='organization'
          OR (c.scope='program' AND c.scope_id=co.program_id)
          OR (c.scope='section' AND c.scope_id IN (SELECT id FROM course_groups WHERE course_id=co.id)))
        ORDER BY e.starts_on,e.ends_on`).bind(courseId, current.organizationId).all<CalendarBreak & { part: string }>()).results
        .filter(row => (!row.groupId || seesSection(access, row.groupId)) && (!filter.section || !row.groupId || row.groupId === filter.section) && (!filter.from || row.until >= filter.from) && (!filter.to || row.from <= filter.to))
        .map(({ id, groupId, title, from, until }) => ({ id, groupId, title, from, until }));
      return reply({ sessions: rows, lessonPlans: await lessonPlans(db, current.organizationId, rows.flatMap(row => row.lessons.map(lesson => lesson.id))), today: await todayFor(db, current.organizationId), breaks, filter });
    }
    if (!access.assigned.length) return notTeaching();
    // An extra class (a make-up, a review) takes the time of its section's schedule unless another one is given.
    const plan = classPlanInput(input);
    if ("error" in plan) return reply(plan, 400);
    const groupId = typeof (input as Record<string, unknown>)?.groupId === "string" ? String((input as Record<string, unknown>).groupId) : "";
    const group = await db.prepare("SELECT id,name,schedule_starts_at AS startsAt,schedule_duration AS durationMinutes FROM course_groups WHERE id=? AND course_id=? AND organization_id=? AND status='active'").bind(groupId, courseId, current.organizationId).first<{ id: string; name: string; startsAt: string | null; durationMinutes: number | null }>();
    if (!group || !seesSection(access, group.id)) return reply({ error: "Elige una sección activa de este curso." }, 400);
    if (!teachesSection(access, group.id)) return notTeaching();
    const problem = await checkLessons(db, courseId, plan.lessonIds);
    if (problem) return reply({ error: problem }, 400);
    const id = `class-${crypto.randomUUID()}`;
    await db.batch([
      db.prepare("INSERT INTO class_sessions(id,group_id,course_id,organization_id,lesson_id,session_date,starts_at,duration_minutes,notes,status,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,'planned',?,?)")
        .bind(id, group.id, courseId, current.organizationId, plan.lessonIds[0] ?? null, plan.sessionDate, plan.startsAt ?? group.startsAt, plan.durationMinutes ?? group.durationMinutes, plan.notes, now, now),
      ...planLessons(db, id, plan.lessonIds),
      event(db, current, { action: "planned", targetType: "session", targetId: id, courseId, groupId: group.id, summary: `Agregó una clase el ${plan.sessionDate} en «${group.name}»` }),
    ]);
    return reply({ id }, 201);
  }
  const stored = await db.prepare(`SELECT ${sessionColumns} ${sessionJoins} WHERE s.id=? AND s.course_id=? AND s.organization_id=?`).bind(sessionId, courseId, current.organizationId).first<StoredSession>();
  if (!stored || !seesSection(access, stored.groupId)) return unavailable();
  const session = withLessons(stored);
  // Planning and teaching a class belong to whoever teaches its section; administration and the rest of the team read it.
  if (method !== "GET" && !teachesSection(access, session.groupId)) return notTeaching();
  // DEC-046 (ST-151): teaching a class (starting it, taking its roll, completing it) waits for a contract in force.
  if (method !== "GET" && (sub === "start" || sub === "attendance" || sub === "complete")) { const blocked = await contractBlock(db, current); if (blocked) return blocked; }
  if (!sub) {
    if (method === "GET") {
      const ids = session.lessons.map(lesson => lesson.id);
      const [contents, items, details, learners, groupActive] = await Promise.all([
        lessonContents(db, ids),
        ids.length ? library(db, current.organizationId) : new Map<string, Material | Resource>(),
        ids.length ? db.prepare(`SELECT id,revision,archived,json_extract(published_content,'$.shareCode') AS shareCode FROM lessons WHERE id IN (${ids.map(() => "?").join(",")})`).bind(...ids).all<{ id: string; revision: number; archived: number; shareCode: string | null }>() : { results: [] },
        attendanceRows(db, sessionId, session.groupId),
        db.prepare("SELECT status FROM course_groups WHERE id=?").bind(session.groupId).first<{ status: string }>(),
      ]);
      const lessons = session.lessons.map(lesson => {
        const row = details.results.find(item => item.id === lesson.id);
        const content = contents.get(lesson.id);
        return { ...lesson, currentRevision: row?.revision || null, archived: !!row?.archived, shareCode: row && row.revision > 0 && !row.archived ? row.shareCode : null,
          activities: (content?.activities || []).map(activity => ({ id: activity.id || "", title: activity.title, minutes: Number(activity.minutes) || 0, ...(activity.grouping ? { grouping: activity.grouping } : {}) })),
          resources: resourceIdsOf(content?.activities || []).flatMap(id => { const item = items.get(id); return item ? [classResource(item, false)] : []; }) };
      });
      return reply({ session, lessons, resources: unique(lessons.flatMap(lesson => lesson.resources)), learners, groupActive: groupActive?.status === "active" });
    }
    const plan = classPlanInput(input);
    if ("error" in plan) return reply(plan, 400);
    if (session.status === "cancelled") return reply({ error: "Reprograma la clase antes de editarla." }, 409);
    const currentIds = session.lessons.map(lesson => lesson.id);
    const moved = plan.sessionDate !== session.sessionDate || plan.startsAt !== (session.startsAt ?? null) || plan.durationMinutes !== (session.durationMinutes ?? null);
    if (moved && session.status !== "planned") return reply({ error: "Solo una clase pendiente cambia de fecha u hora." }, 409);
    if (session.status === "completed" && !sameList(plan.lessonIds, currentIds)) return reply({ error: "Una clase impartida conserva las lecciones que trabajó; solo cambian sus comentarios." }, 409);
    const problem = await checkLessons(db, courseId, plan.lessonIds, currentIds);
    if (problem) return reply({ error: problem }, 400);
    const version = Number((input as Record<string, unknown>).version);
    const ok = await db.guardedBatch(
      db.prepare("UPDATE class_sessions SET session_date=?,starts_at=?,duration_minutes=?,lesson_id=?,notes=?,version=version+1,updated_at=? WHERE id=? AND organization_id=? AND version=? AND status<>'cancelled' RETURNING id")
        .bind(plan.sessionDate, plan.startsAt, plan.durationMinutes, plan.lessonIds[0] ?? null, plan.notes, now, sessionId, current.organizationId, Number.isInteger(version) ? version : -1),
      [...(sameList(plan.lessonIds, currentIds) ? [] : planLessons(db, sessionId, plan.lessonIds, new Map(session.lessons.map(lesson => [lesson.id, lesson.revision])), session.status === "in_progress")),
        event(db, current, { action: "updated", targetType: "session", targetId: sessionId, courseId, groupId: session.groupId, summary: `Actualizó la planificación de la clase del ${plan.sessionDate} en «${session.groupName}»` })]);
    if (!ok) return stale();
    // ST-124: a new date, time or length is told to the section's other educators; a change of plan alone is not.
    if (moved) await notifyClass(db, notifier, current, courseId, session, { type: "class_changed", next: { date: plan.sessionDate, startsAt: plan.startsAt } });
    return reply({ ok: true });
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
      // Taking the roll opens a planned class: it is being taught now, by this educator, with the lessons' current publications.
      ...(session.status === "planned" ? start(db, sessionId, current, now) : []),
      event(db, current, { action: "recorded", targetType: "session", targetId: sessionId, courseId, groupId: session.groupId, summary: `Pasó lista del ${session.sessionDate} en «${session.groupName}»: ${present} de ${list.length} presentes` }),
    ]);
    return reply({ saved: list.length, status: session.status === "planned" ? "in_progress" : session.status });
  }
  if (sub === "outcomes") {
    // A finished class can correct what it covered; nothing moves to other classes.
    if (session.status !== "completed") return reply({ error: "Solo una clase impartida registra lo trabajado en cada lección." }, 409);
    const done = completionInput(input, session.lessons.map(lesson => lesson.id));
    if ("error" in done) return reply(done, 400);
    await db.batch([...[...done.outcomes].map(([lessonId, outcome]) => db.prepare("UPDATE class_session_lessons SET outcome=? WHERE session_id=? AND lesson_id=?").bind(outcome, sessionId, lessonId)),
      db.prepare("UPDATE class_sessions SET version=version+1,updated_at=? WHERE id=?").bind(now, sessionId),
      event(db, current, { action: "updated", targetType: "session", targetId: sessionId, courseId, groupId: session.groupId, summary: `Corrigió lo trabajado en la clase del ${session.sessionDate} en «${session.groupName}»` })]);
    return reply({ ok: true });
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
  const lessonIds = session.lessons.map(lesson => lesson.id);
  let statements: Prepared[], summary = `${actionSummary[action]} la clase del ${session.sessionDate} en «${session.groupName}»`, result: Record<string, unknown> = {};
  if (action === "complete") {
    const done = completionInput(input, lessonIds);
    if ("error" in done) return reply(done, 400);
    statements = [
      db.prepare("UPDATE class_sessions SET status='completed',completed_at=?,started_at=COALESCE(started_at,?),taught_by=COALESCE(taught_by,?),lesson_revision=COALESCE(lesson_revision,(SELECT CASE WHEN l.revision>0 THEN l.revision END FROM lessons l WHERE l.id=class_sessions.lesson_id)),version=version+1,updated_at=? WHERE id=?").bind(now, now, current.id, now, sessionId),
      db.prepare(`UPDATE class_session_lessons SET revision=COALESCE(revision,${currentRevision}) WHERE session_id=?`).bind(sessionId),
      ...[...done.outcomes].map(([lessonId, outcome]) => db.prepare("UPDATE class_session_lessons SET outcome=? WHERE session_id=? AND lesson_id=?").bind(outcome, sessionId, lessonId)),
    ];
    // What was not completed is worked on first in the section's next class, unless it is already planned later.
    const unfinished = lessonIds.filter(id => done.outcomes.get(id) !== "completed");
    if (done.carryOver && unfinished.length) {
      const [next, ...later] = await pendingAfter(db, session);
      if (next) {
        const moved = carryOver(next.lessonIds, unfinished, later.flatMap(row => row.lessonIds), maxClassLessons);
        statements.push(db.prepare("UPDATE class_sessions SET lesson_id=?,version=version+1,updated_at=? WHERE id=? AND status='planned'").bind(moved.lessons[0] ?? null, now, next.id), ...planLessons(db, next.id, moved.lessons));
        const carried = moved.lessons.filter(id => !next.lessonIds.includes(id)).length;
        result = { carried, carriedTo: next.sessionDate, left: moved.left.length };
        if (carried) summary += `; ${carried === 1 ? "1 lección pasa" : `${carried} lecciones pasan`} a la clase del ${next.sessionDate}`;
      } else result = { carried: 0, left: unfinished.length };
    }
  } else if (action === "cancel" && cancelPlanInput(input) === "shift" && (lessonIds.length || session.notes)) {
    // Recorrer: the plan of the cancelled class goes to the next one and each later plan moves one class forward.
    const later = await pendingAfter(db, session);
    const plans = [{ lessonIds, notes: session.notes || "" }, ...later.map(row => ({ lessonIds: row.lessonIds, notes: row.notes }))];
    statements = [
      db.prepare("UPDATE class_sessions SET status='cancelled',lesson_id=NULL,notes='',version=version+1,updated_at=? WHERE id=?").bind(now, sessionId),
      ...planLessons(db, sessionId, []),
      ...later.flatMap((row, index) => [db.prepare("UPDATE class_sessions SET lesson_id=?,notes=?,version=version+1,updated_at=? WHERE id=? AND status='planned'").bind(plans[index].lessonIds[0] ?? null, plans[index].notes, now, row.id), ...planLessons(db, row.id, plans[index].lessonIds)]),
    ];
    const left = plans[later.length].lessonIds.length;
    result = { shifted: later.length, left };
    summary += later.length ? ` y recorrió su planificación a las ${later.length === 1 ? "clase siguiente" : `${later.length} clases siguientes`}` : " y su planificación quedó sin clase";
  } else statements = action === "start" ? start(db, sessionId, current, now) : [db.prepare("UPDATE class_sessions SET status=?,version=version+1,updated_at=? WHERE id=?").bind(target, now, sessionId)];
  const ok = await db.guardedBatch(db.prepare("SELECT id FROM class_sessions WHERE id=? AND status=?").bind(sessionId, session.status), [...statements,
    event(db, current, { action: action === "cancel" ? "archived" : action === "restore" ? "restored" : "recorded", targetType: "session", targetId: sessionId, courseId, groupId: session.groupId, summary })]);
  if (!ok) return reply({ error: "La clase cambió mientras tanto. Recarga para ver su estado." }, 409);
  if (action === "cancel") await notifyClass(db, notifier, current, courseId, session, { type: "class_cancelled" });
  if (action === "restore") await notifyClass(db, notifier, current, courseId, session, { type: "class_changed", restored: true });
  return reply({ status: target as ClassStatus, ...result });
}
/** ST-124: tells the section's educators (except whoever acted) that one of its classes changed or was cancelled. */
async function notifyClass(db: Database, notifier: Notifier | undefined, current: Member, courseId: string, session: { id: string; groupId: string; groupName?: string; sessionDate: string },
  change: { type: "class_changed"; next?: { date: string; startsAt: string | null }; restored?: boolean } | { type: "class_cancelled" }) {
  if (!notifier) return;
  const [educators, course] = await Promise.all([
    db.prepare("SELECT user_id AS id FROM section_educators WHERE group_id=?").bind(session.groupId).all<{ id: string }>(),
    db.prepare("SELECT title FROM courses WHERE id=?").bind(courseId).first<{ title: string }>(),
  ]);
  const base = { course: course?.title || "", section: session.groupName || "", date: session.sessionDate };
  await notify(db, notifier, current, educators.results.map(row => ({ userId: row.id, targetId: session.id, path: `/secciones/${session.groupId}/clases/${session.id}`, facts: { ...base, ...change } })));
}
/** The section's pending classes after the given one, in order, with what each has planned. */
async function pendingAfter(db: Database, session: ClassSession) {
  const rows = (await db.prepare("SELECT id,session_date AS sessionDate,notes FROM class_sessions WHERE group_id=? AND status='planned' AND id<>? AND (session_date>? OR (session_date=? AND COALESCE(starts_at,'')>COALESCE(?,''))) ORDER BY session_date,starts_at")
    .bind(session.groupId, session.id, session.sessionDate, session.sessionDate, session.startsAt ?? null).all<{ id: string; sessionDate: string; notes: string | null }>()).results;
  if (!rows.length) return [];
  const planned = (await db.prepare(`SELECT session_id AS sessionId,lesson_id AS lessonId FROM class_session_lessons WHERE session_id IN (${rows.map(() => "?").join(",")}) ORDER BY position`).bind(...rows.map(row => row.id)).all<{ sessionId: string; lessonId: string }>()).results;
  return rows.map(row => ({ id: row.id, sessionDate: row.sessionDate, notes: row.notes || "", lessonIds: planned.filter(item => item.sessionId === row.id).map(item => item.lessonId) }));
}
const currentRevision = "(SELECT CASE WHEN l.revision>0 THEN l.revision END FROM lessons l WHERE l.id=class_session_lessons.lesson_id)";
/** Starting a class records who teaches it and the publication of each of its lessons at that moment. */
function start(db: Database, sessionId: string, current: Member, now: string) {
  return [
    db.prepare("UPDATE class_sessions SET status='in_progress',started_at=?,taught_by=?,lesson_revision=(SELECT CASE WHEN l.revision>0 THEN l.revision END FROM lessons l WHERE l.id=class_sessions.lesson_id),version=version+1,updated_at=? WHERE id=? AND status='planned'").bind(now, current.id, now, sessionId),
    db.prepare(`UPDATE class_session_lessons SET revision=${currentRevision} WHERE session_id=?`).bind(sessionId),
  ];
}
async function attendanceRows(db: Database, sessionId: string, groupId: string) {
  return (await db.prepare("SELECT l.id AS learnerId,l.display_name AS displayName,COALESCE(a.status,'unmarked') AS status FROM group_learners l LEFT JOIN attendance_marks a ON a.learner_id=l.id AND a.session_id=? WHERE l.group_id=? AND (l.status='active' OR a.status IS NOT NULL) ORDER BY l.display_name,l.id").bind(sessionId, groupId).all()).results;
}

/**
 * The classes of the sections a person teaches (binds: user id, organization id), in active sections of active courses
 * with a schedule. «Mis clases», the Agenda and the calendar subscription (ST-125) all read them from here.
 */
export const taughtClasses = `JOIN courses c ON c.id=s.course_id AND c.status='active' LEFT JOIN study_programs sp ON sp.id=c.program_id
    JOIN section_educators se ON se.group_id=s.group_id AND se.organization_id=s.organization_id AND se.user_id=?
    WHERE s.organization_id=? AND g.status='active' AND COALESCE(sp.pacing,c.pacing)='scheduled'`;
/** GET /api/classes — the next classes of the sections the person teaches, for the home page. */
export async function myClasses(current: Member, db: Database) {
  const today = await todayFor(db, current.organizationId);
  const rows = (await db.prepare(`SELECT ${sessionColumns},c.title AS courseTitle ${sessionJoins} ${taughtClasses} AND ((s.session_date>=? AND s.status='planned') OR s.status='in_progress') ORDER BY s.session_date,s.starts_at LIMIT 40`).bind(current.id, current.organizationId, today).all<StoredSession>()).results.map(withLessons);
  // A class left open on an earlier day still needs to be finished, so it stays first.
  const open = rows.filter(row => row.status === "in_progress" && row.sessionDate < today);
  return reply({ today, classes: [...open, ...upcomingClasses(rows.filter(row => !open.includes(row)), today)].slice(0, 8) });
}

type Group = { id: string; name: string };
const scheduleColumns = "schedule_weekdays AS weekdays,schedule_starts_at AS startsAt,schedule_duration AS durationMinutes,schedule_from AS \"from\",schedule_until AS until,schedule_meetings AS meetings,schedule_period_id AS periodId";
type StoredSchedule = { weekdays: string | null; startsAt: string | null; durationMinutes: number | null; from: string | null; until: string | null; meetings?: string | null; periodId?: string | null };
/** The stored schedule, with each day's own time when the section has them (1.2.4). */
export const scheduleOf = (row: StoredSchedule): SectionSchedule | null => row.weekdays && row.startsAt && row.durationMinutes && row.from && row.until
  ? { weekdays: row.weekdays.split(",").map(Number), startsAt: row.startsAt, durationMinutes: row.durationMinutes, from: row.from, until: row.until, ...(row.meetings ? { meetings: JSON.parse(row.meetings) as ScheduleMeeting[] } : {}), ...(row.periodId ? { periodId: row.periodId } : {}) } : null;

/**
 * PUT|DELETE /api/courses/:id/groups/:gid/schedule — saving the section's schedule generates its classes for the
 * period. A change rebuilds only the generated classes that have not started; past classes, classes added by hand
 * and their attendance stay. What was already planned (lessons and comments) keeps its order on the new days.
 */
export async function saveSchedule(method: string, input: unknown, current: Member, db: Database, courseId: string, group: Group) {
  const raw = input && typeof input === "object" ? input as Record<string, unknown> : {};
  const periodId = typeof raw.periodId === "string" ? raw.periodId : null;
  const period = periodId ? await db.prepare(`SELECT p.starts_on AS "from",p.ends_on AS until FROM academic_periods p
    JOIN academic_years y ON y.id=p.year_id AND y.organization_id=p.organization_id AND y.status='current'
    JOIN courses c ON c.id=? AND c.organization_id=p.organization_id
    WHERE p.id=? AND (y.program_id IS NULL OR y.program_id=c.program_id)`).bind(courseId, periodId).first<{ from: string; until: string }>() : null;
  if (periodId && !period) return reply({ error: "El periodo debe pertenecer al ciclo vigente de la organización o del programa del curso." }, 400);
  const value = period ? { ...raw, from: period.from, until: period.until } : raw;
  const checked = method === "DELETE" ? null : scheduleInput(value);
  const schedule = checked && !("error" in checked) ? { ...checked, ...(periodId ? { periodId } : {}) } : checked;
  if (schedule && "error" in schedule) return reply(schedule, 400);
  const before = await db.prepare(`SELECT ${scheduleColumns} FROM course_groups WHERE id=?`).bind(group.id).first<StoredSchedule>();
  const result = await applySchedule(current, db, courseId, group, schedule, before);
  return result ? reply({ schedule: schedule || null, ...result }) : reply({ error: "La sección cambió mientras tanto. Recarga para ver su horario actual." }, 409);
}

/**
 * Generates the section's pending classes for its schedule, skipping its days without class (DEC-026). Pending
 * generated classes on days that are no longer class days go away and their plans move, in order, to the next ones.
 * Returns null when the section changed meanwhile.
 */
export async function applySchedule(current: Member, db: Database, courseId: string, group: Group, schedule: SectionSchedule | null, before: StoredSchedule | null, reason?: string) {
  const now = new Date().toISOString();
  const today = await todayFor(db, current.organizationId);
  const breaks = schedule ? await breaksOf(db, current.organizationId, group.id, schedule) : [];
  const pending = (await db.prepare("SELECT id,session_date AS sessionDate,notes FROM class_sessions WHERE group_id=? AND origin='schedule' AND status='planned' AND session_date>=? ORDER BY session_date,starts_at").bind(group.id, today).all<{ id: string; sessionDate: string; notes: string }>()).results;
  const planned = (await db.prepare("SELECT p.session_id AS sessionId,p.lesson_id AS lessonId FROM class_session_lessons p JOIN class_sessions s ON s.id=p.session_id WHERE s.group_id=? AND s.origin='schedule' AND s.status='planned' AND s.session_date>=? ORDER BY p.position").bind(group.id, today).all<{ sessionId: string; lessonId: string }>()).results;
  const taken = new Set((await db.prepare("SELECT session_date AS sessionDate FROM class_sessions WHERE group_id=? AND session_date>=? AND NOT (origin='schedule' AND status='planned')").bind(group.id, today).all<{ sessionDate: string }>()).results.map(row => row.sessionDate));
  const dates = schedule ? scheduleDates(schedule, today, breaks).filter(day => !taken.has(day)) : [];
  const kept = pending.filter(row => dates.includes(row.sessionDate));
  const removed = pending.filter(row => !dates.includes(row.sessionDate));
  const added = dates.filter(day => !kept.some(row => row.sessionDate === day)).map(day => ({ id: `class-${crypto.randomUUID()}`, sessionDate: day }));
  const plans = pending.map(row => ({ lessonIds: planned.filter(item => item.sessionId === row.id).map(item => item.lessonId), notes: row.notes || "" })).filter(plan => plan.lessonIds.length || plan.notes);
  const ordered = [...kept, ...added].sort((a, b) => a.sessionDate.localeCompare(b.sessionDate));
  const planFor = (id: string) => plans[ordered.findIndex(row => row.id === id)] ?? { lessonIds: [], notes: "" };
  const same = (column: string) => `${column} IS ?`;
  const ok = await db.guardedBatch(
    db.prepare(`SELECT id FROM course_groups WHERE id=? AND status='active' AND ${["schedule_weekdays", "schedule_starts_at", "schedule_duration", "schedule_from", "schedule_until", "schedule_meetings", "schedule_period_id"].map(same).join(" AND ")}`).bind(group.id, before?.weekdays ?? null, before?.startsAt ?? null, before?.durationMinutes ?? null, before?.from ?? null, before?.until ?? null, before?.meetings ?? null, before?.periodId ?? null), [
      db.prepare("UPDATE course_groups SET schedule_weekdays=?,schedule_starts_at=?,schedule_duration=?,schedule_from=?,schedule_until=?,schedule_meetings=?,schedule_period_id=? WHERE id=?").bind(schedule ? schedule.weekdays.join(",") : null, schedule?.startsAt ?? null, schedule?.durationMinutes ?? null, schedule?.from ?? null, schedule?.until ?? null, schedule?.meetings ? JSON.stringify(schedule.meetings) : null, schedule?.periodId ?? null, group.id),
      ...removed.flatMap(row => [db.prepare("DELETE FROM class_session_lessons WHERE session_id=?").bind(row.id), db.prepare("DELETE FROM class_session_resources WHERE session_id=?").bind(row.id), db.prepare("DELETE FROM class_sessions WHERE id=? AND status='planned'").bind(row.id)]),
      ...kept.flatMap(row => [db.prepare("UPDATE class_sessions SET starts_at=?,duration_minutes=?,lesson_id=?,notes=?,version=version+1,updated_at=? WHERE id=? AND status='planned'").bind(meetingOn(schedule!, row.sessionDate).startsAt, meetingOn(schedule!, row.sessionDate).durationMinutes, planFor(row.id).lessonIds[0] ?? null, planFor(row.id).notes, now, row.id), ...planLessons(db, row.id, planFor(row.id).lessonIds)]),
      ...added.flatMap(row => [db.prepare("INSERT INTO class_sessions(id,group_id,course_id,organization_id,lesson_id,session_date,starts_at,duration_minutes,notes,status,origin,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,'planned','schedule',?,?)")
        .bind(row.id, group.id, courseId, current.organizationId, planFor(row.id).lessonIds[0] ?? null, row.sessionDate, meetingOn(schedule!, row.sessionDate).startsAt, meetingOn(schedule!, row.sessionDate).durationMinutes, planFor(row.id).notes, now, now), ...planLessons(db, row.id, planFor(row.id).lessonIds)]),
      event(db, current, { action: "updated", targetType: "group", targetId: group.id, courseId, summary: reason ? `${reason} en «${group.name}»: ${ordered.length} clases pendientes` : schedule ? `Configuró el horario de «${group.name}»: ${scheduleSummary(schedule)}, ${ordered.length} clases pendientes` : `Quitó el horario de «${group.name}» y sus ${removed.length} clases pendientes` }),
    ]);
  return ok ? { classes: ordered.length, added: added.length, removed: removed.length } : null;
}

/** Rebuilds pending classes touched by a no-class event at an organization, program or section level. */
export async function reapplyCalendar(
  current: Member,
  db: Database,
  scope: "organization" | "program" | "section",
  scopeId: string | null,
  from: string,
  until: string,
  reason: string,
) {
  const restriction = scope === "program" ? " AND c.program_id=?" : scope === "section" ? " AND g.id=?" : "";
  const rows = (await db.prepare(`SELECT g.id,g.name,g.course_id AS courseId,${scheduleColumns.replace(/schedule_/g, "g.schedule_")}
    FROM course_groups g JOIN courses c ON c.id=g.course_id LEFT JOIN study_programs p ON p.id=c.program_id
    WHERE g.organization_id=? AND g.status='active' AND COALESCE(p.pacing,c.pacing)='scheduled'
      AND g.schedule_weekdays IS NOT NULL AND g.schedule_from<=? AND g.schedule_until>=?${restriction}`)
    .bind(current.organizationId, until, from, ...(scopeId ? [scopeId] : [])).all<Group & StoredSchedule & { courseId: string }>()).results;
  let sections = 0, removed = 0, added = 0;
  for (const row of rows) {
    const schedule = scheduleOf(row);
    const result = schedule && await applySchedule(current, db, row.courseId, row, schedule, row, reason);
    if (result && (result.removed || result.added)) { sections++; removed += result.removed; added += result.added; }
  }
  return { sections, removed, added };
}

const breakColumns = "e.id,CASE WHEN c.scope='section' THEN c.scope_id END AS groupId,e.title,e.starts_on AS \"from\",e.ends_on AS until,e.part,e.no_class AS noClass,e.rule_id AS ruleId,e.year,e.status,e.calendar_id AS calendarId,e.category_id AS categoryId";
/** Effective no-class dates for a section: organization, its program and the section itself. */
export async function breaksOf(db: Database, organizationId: string, groupId: string, schedule?: SectionSchedule) {
  const rows = (await db.prepare(`SELECT ${breakColumns} FROM calendar_events e JOIN calendars c ON c.id=e.calendar_id
    JOIN course_groups g ON g.id=? AND g.organization_id=e.organization_id JOIN courses co ON co.id=g.course_id
    WHERE e.organization_id=? AND (c.scope='organization' OR (c.scope='program' AND c.scope_id=co.program_id) OR (c.scope='section' AND c.scope_id=g.id))
    ORDER BY e.starts_on,e.ends_on`).bind(groupId, organizationId).all<InstitutionalCalendarEvent & { groupId: string | null }>()).results
    .map(row => ({ ...row, noClass: !!row.noClass }));
  if (!schedule) return rows.filter(row => row.noClass && row.status === "active").map(row => ({ id: row.id, groupId: row.groupId, title: row.title, from: row.from, until: row.until, part: row.part }));
  return noClassDays(rows, { from: schedule.from, until: schedule.until, schedule });
}

/**
 * /api/calendar[/:id] — days without class (DEC-026): holidays and breaks of the whole organization, or of one section
 * with ?section=. Everyone reads them; administration adds and removes them, and each change rebuilds the pending
 * classes of the sections it touches, moving what they had planned to their next class days.
 */
export async function calendar(path: string, method: string, input: unknown, url: URL, current: Member, db: Database) {
  const id = path.split("/")[3];
  if (method === "GET") {
    const section = url.searchParams.get("section");
    const source = section ? await breaksOf(db, current.organizationId, section) : (await db.prepare(`SELECT ${breakColumns} FROM calendar_events e JOIN calendars c ON c.id=e.calendar_id
      WHERE e.organization_id=? AND c.scope='organization' AND e.no_class=1 AND e.status='active' ORDER BY e.starts_on,e.ends_on`).bind(current.organizationId).all<CalendarBreak>()).results;
    const rows = source.map(row => ({ id: row.id, groupId: "groupId" in row ? row.groupId : null, title: row.title, from: row.from, until: row.until }));
    return reply({ breaks: rows, today: await todayFor(db, current.organizationId) });
  }
  if (current.role !== "admin") return reply({ error: "Solo administración define los días sin clase." }, 403);
  let item: CalendarBreak & { calendarId?: string };
  if (method === "POST") {
    const value = breakInput(input);
    if ("error" in value) return reply(value, 400);
    const groupId = typeof (input as Record<string, unknown>)?.groupId === "string" ? String((input as Record<string, unknown>).groupId) : null;
    const group = groupId ? await db.prepare("SELECT id,name FROM course_groups WHERE id=? AND organization_id=? AND status='active'").bind(groupId, current.organizationId).first<{ id: string; name: string }>() : null;
    if (groupId && !group) return reply({ error: "Elige una sección activa." }, 400);
    const scope = groupId ? "section" : "organization", now = new Date().toISOString();
    let own = await db.prepare("SELECT id FROM calendars WHERE organization_id=? AND scope=? AND scope_id IS ?").bind(current.organizationId, scope, groupId).first<{ id: string }>();
    if (!own) {
      own = { id: `calendar-${crypto.randomUUID()}` };
      await db.prepare("INSERT INTO calendars(id,organization_id,scope,scope_id,name,created_at,updated_at) VALUES (?,?,?,?,?,?,?)")
        .bind(own.id, current.organizationId, scope, groupId, group ? `Calendario de ${group.name}` : "Calendario institucional", now, now).run();
    }
    const category = await db.prepare("SELECT id FROM calendar_categories WHERE organization_id=? AND key='no-class'").bind(current.organizationId).first<{ id: string }>();
    item = { id: `event-${crypto.randomUUID()}`, groupId, calendarId: own.id, ...value };
    await db.prepare("INSERT INTO calendar_events(id,calendar_id,organization_id,category_id,title,starts_on,ends_on,part,no_class,rule_id,year,status,created_by,created_at,updated_at) VALUES (?,?,?,?,?,?,?,'full',1,NULL,NULL,'active',?,?,?)")
      .bind(item.id, own.id, current.organizationId, category!.id, item.title, item.from, item.until, current.id, now, now).run();
  } else {
    const found = await db.prepare(`SELECT ${breakColumns} FROM calendar_events e JOIN calendars c ON c.id=e.calendar_id WHERE e.id=? AND e.organization_id=? AND e.no_class=1`).bind(id, current.organizationId).first<CalendarBreak & { calendarId: string }>();
    if (!found) return reply({ error: "Ese periodo sin clase ya no existe." }, 404);
    item = found;
    await db.prepare("DELETE FROM calendar_events WHERE id=?").bind(id).run();
  }
  const span = item.from === item.until ? `el ${item.from}` : `del ${item.from} al ${item.until}`;
  const reason = method === "POST" ? `Sin clase ${span} (${item.title})` : `Volvió a haber clase ${span} (${item.title})`;
  // Only sections with a schedule whose period touches the days change.
  const touched = (await db.prepare(`SELECT g.id,g.name,g.course_id AS courseId,${scheduleColumns.replace(/schedule_/g, "g.schedule_")} FROM course_groups g JOIN courses c ON c.id=g.course_id LEFT JOIN study_programs p ON p.id=c.program_id
    WHERE g.organization_id=? AND g.status='active' AND COALESCE(p.pacing,c.pacing)='scheduled' AND g.schedule_weekdays IS NOT NULL AND g.schedule_from<=? AND g.schedule_until>=?${item.groupId ? " AND g.id=?" : ""}`)
    .bind(current.organizationId, item.until, item.from, ...(item.groupId ? [item.groupId] : [])).all<Group & StoredSchedule & { courseId: string }>()).results;
  let sections = 0, removed = 0, added = 0;
  for (const row of touched) {
    const schedule = scheduleOf(row);
    const result = schedule && await applySchedule(current, db, row.courseId, row, schedule, row, reason);
    if (result && (result.removed || result.added)) { sections++; removed += result.removed; added += result.added; }
  }
  return reply({ break: item, sections, removed, added }, method === "POST" ? 201 : 200);
}

/**
 * POST /api/courses/:id/groups/:gid/lessons {perClass} — gives the upcoming classes without lessons the next published
 * lessons in content order, one to three per class.
 */
export async function fillLessons(input: unknown, current: Member, db: Database, courseId: string, group: Group) {
  const now = new Date().toISOString();
  const today = await todayFor(db, current.organizationId);
  const perClass = Number((input as Record<string, unknown> | null)?.perClass ?? 1);
  if (![1, 2, 3].includes(perClass)) return reply({ error: "Elige de 1 a 3 lecciones por clase." }, 400);
  const [ordered, classes, planned] = await Promise.all([
    courseLessons(db, courseId),
    db.prepare("SELECT id,session_date AS sessionDate,status FROM class_sessions WHERE group_id=? AND status<>'cancelled' ORDER BY session_date,starts_at").bind(group.id).all<{ id: string; sessionDate: string; status: ClassStatus }>(),
    db.prepare("SELECT p.session_id AS sessionId,p.lesson_id AS lessonId FROM class_session_lessons p JOIN class_sessions s ON s.id=p.session_id WHERE s.group_id=? AND s.status<>'cancelled'").bind(group.id).all<{ sessionId: string; lessonId: string }>(),
  ]);
  const lessonsOf = (id: string) => planned.results.filter(row => row.sessionId === id).map(row => row.lessonId);
  const plan = lessonsInOrder(classes.results.filter(row => row.status === "planned" && row.sessionDate >= today).map(row => ({ id: row.id, lessonIds: lessonsOf(row.id) })), ordered, planned.results.map(row => row.lessonId), perClass);
  if (!plan.length) return reply({ assigned: 0, classes: 0 });
  await db.batch([
    ...plan.flatMap(item => [
      ...item.lessonIds.map((lessonId, position) => db.prepare("INSERT INTO class_session_lessons(session_id,lesson_id,position) SELECT ?,?,? WHERE EXISTS(SELECT 1 FROM class_sessions WHERE id=? AND status='planned')").bind(item.sessionId, lessonId, position, item.sessionId)),
      db.prepare("UPDATE class_sessions SET lesson_id=?,version=version+1,updated_at=? WHERE id=? AND status='planned'").bind(item.lessonIds[0], now, item.sessionId),
    ]),
    event(db, current, { action: "planned", targetType: "group", targetId: group.id, courseId, summary: `Planificó en orden ${plan.length === 1 ? "1 clase" : `${plan.length} clases`} de «${group.name}»` }),
  ]);
  return reply({ assigned: plan.reduce((sum, item) => sum + item.lessonIds.length, 0), classes: plan.length });
}

const studentCookie = (token: string, request: Request, remove = false) => `hl_group=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${remove ? 0 : 28800}${new URL(request.url).protocol === "https:" ? "; Secure" : ""}`;
export const studentToken = (request: Request) => { const token = /(?:^|;\s*)hl_group=([a-z]_[a-f0-9]{64})(?:;|$)/.exec(request.headers.get("Cookie") || "")?.[1]; return token && tokenPattern.test(token) ? token : null; };

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
    const token = tokenPrefix(scope) + newToken();
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
  const tokenHash = token ? await digest(token) : "";
  const access = token ? await studentAccess(db, tokenHash) : null;
  if (!access) return reply({ error: "Escribe el código de tu sección para continuar." }, 401, token ? { "Set-Cookie": studentCookie("", request, true) } : {});
  const selfPaced = access.pacing === "self-paced";
  if (path === "/api/student/identity" && method === "POST") {
    // A tu ritmo: the student picks their name from the section's list so the section can follow their progress.
    const learnerId = (input as Record<string, unknown> | null)?.learnerId ?? null;
    if (learnerId !== null && (typeof learnerId !== "string" || !await db.prepare("SELECT id FROM group_learners WHERE id=? AND group_id=? AND status='active'").bind(learnerId, access.groupId).first())) return reply({ error: "Elige tu nombre de la lista de la sección." }, 400);
    await db.prepare("UPDATE group_access_sessions SET learner_id=? WHERE token_hash=?").bind(learnerId, tokenHash).run();
    return reply({ ok: true });
  }
  if (path === "/api/student/progress" && method === "POST") {
    // Opening a lesson of the path; finishing it is recorded when the student completes it in the lesson player.
    if (!selfPaced || !access.learnerId) return reply({ error: "El avance se registra en las secciones a tu ritmo, después de elegir tu nombre." }, 409);
    const lesson = await pathLesson(db, access.courseId, (input as Record<string, unknown> | null)?.shareCode);
    if (!lesson) return reply({ error: "Esa lección no forma parte del curso de tu sección." }, 404);
    await db.prepare("INSERT INTO learner_progress(organization_id,group_id,learner_id,lesson_id,opened_at) VALUES (?,?,?,?,?) ON CONFLICT DO NOTHING").bind(access.organizationId, access.groupId, access.learnerId, lesson.id, new Date().toISOString()).run();
    return reply({ ok: true });
  }
  const fileMatch = path.match(/^\/api\/student\/files\/([a-z0-9-]+)$/);
  if (fileMatch) {
    // Only files published in a lesson of one of the section's classes or, at their own pace, of the course's path.
    const linked = selfPaced
      ? await db.prepare("SELECT 1 AS ok FROM lessons l JOIN learning_units u ON u.id=l.course_unit_id AND u.status='active', json_each(l.published_content,'$.resources') r WHERE u.course_id=? AND l.archived=0 AND l.revision>0 AND json_extract(r.value,'$.id')=? AND json_extract(r.value,'$.status')='published' LIMIT 1").bind(access.courseId, fileMatch[1]).first()
      : await db.prepare("SELECT 1 AS ok FROM class_sessions s JOIN class_session_lessons p ON p.session_id=s.id JOIN lessons l ON l.id=p.lesson_id AND l.archived=0 AND l.revision>0, json_each(l.published_content,'$.resources') r WHERE s.group_id=? AND s.status<>'cancelled' AND json_extract(r.value,'$.id')=? AND json_extract(r.value,'$.status')='published' LIMIT 1").bind(access.groupId, fileMatch[1]).first();
    if (!linked) return reply({ error: "Este archivo no forma parte de las clases de tu sección." }, 404);
    return deliverFile(fileMatch[1], access.organizationId, db, bucket);
  }
  const educatorPhoto = path.match(/^\/api\/student\/educators\/([a-z0-9-]+)\/photo$/);
  if (educatorPhoto) return learnerEducatorPhoto(db, access.groupId, access.organizationId, educatorPhoto[1], bucket);
  if (path !== "/api/student/space" || method !== "GET") return reply({ error: "Ruta no disponible." }, 404);
  // ST-157: «Tu educador», the published profiles of the section's educators.
  const educators = await learnerEducators(db, access.groupId, access.organizationId);
  const today = localDay(access.timezone || "America/Guatemala");
  const base = { group: { name: access.groupName }, course: { title: access.courseTitle }, organization: access.organizationName, today, pacing: access.pacing, learner: access.learnerId ? { id: access.learnerId, name: access.learnerName! } : null };
  if (selfPaced) {
    const [lessons, done, roster] = await db.batch([
      db.prepare(`${pathLessons} ORDER BY u.position,l.position,l.id`).bind(access.courseId),
      db.prepare("SELECT lesson_id AS lessonId,completed_at IS NOT NULL AS completed FROM learner_progress WHERE group_id=? AND learner_id=?").bind(access.groupId, access.learnerId || ""),
      db.prepare("SELECT id,display_name AS name FROM group_learners WHERE group_id=? AND status='active' ORDER BY display_name,id").bind(access.groupId),
    ]) as unknown as [{ id: string; title: string | null; shareCode: string; unitId: string; unitName: string }[], { lessonId: string; completed: number }[], { id: string; name: string }[]];
    const path: StudentPathModule[] = [];
    for (const lesson of lessons) {
      const mark = done.find(row => row.lessonId === lesson.id);
      let unit = path.find(item => item.id === lesson.unitId);
      if (!unit) path.push(unit = { id: lesson.unitId, name: lesson.unitName, lessons: [] });
      unit.lessons.push({ title: lesson.title || "Lección", shareCode: lesson.shareCode, opened: !!mark, completed: !!mark?.completed });
    }
    const space: StudentSpace = { ...base, next: null, upcoming: [], recent: [], lessons: [], roster: access.learnerId ? [] : roster, path, educators };
    return reply(space);
  }
  const rows = (await db.prepare("SELECT s.id,s.session_date AS sessionDate,s.starts_at AS startsAt,s.duration_minutes AS durationMinutes,s.status FROM class_sessions s WHERE s.group_id=? AND s.status<>'cancelled' ORDER BY s.session_date,s.starts_at").bind(access.groupId).all<{ id: string; sessionDate: string; startsAt: string | null; durationMinutes: number | null; status: ClassStatus }>()).results;
  // Students see a lesson only once it is published, under its published title.
  // A finished class lists only the lessons it worked on: one it did not reach waits for the class that takes it.
  const published = (await db.prepare("SELECT p.session_id AS sessionId,l.id AS lessonId,json_extract(l.published_content,'$.title') AS title,json_extract(l.published_content,'$.shareCode') AS shareCode FROM class_session_lessons p JOIN class_sessions s ON s.id=p.session_id JOIN lessons l ON l.id=p.lesson_id AND l.archived=0 AND l.revision>0 WHERE s.group_id=? AND s.status<>'cancelled' AND p.outcome IS NOT 'not_reached' ORDER BY s.session_date,s.starts_at,p.position").bind(access.groupId).all<{ sessionId: string; lessonId: string; title: string | null; shareCode: string | null }>()).results.filter(row => row.shareCode);
  const upcoming = upcomingClasses(rows, today).slice(0, 6);
  const recent = rows.filter(row => row.status === "completed").slice(-5).reverse();
  const shown = new Set([...upcoming, ...recent].map(row => row.id));
  const resourceMap = await publishedResources(db, published.filter(row => shown.has(row.sessionId)).map(row => row.lessonId));
  const view = (row: typeof rows[number]): StudentClass => {
    const lessons = published.filter(item => item.sessionId === row.id);
    return { id: row.id, sessionDate: row.sessionDate, startsAt: row.startsAt, durationMinutes: row.durationMinutes, status: row.status, lessons: lessons.map(item => ({ title: item.title || "Lección", shareCode: item.shareCode! })), resources: unique(lessons.flatMap(item => resourceMap.get(item.lessonId) || [])) };
  };
  // The lessons of the section's classes, once each, in the order the classes give them.
  const lessons = published.filter((row, index, list) => list.findIndex(other => other.shareCode === row.shareCode) === index).map(row => ({ title: row.title || "Lección", shareCode: row.shareCode! }));
  const space: StudentSpace = { ...base, next: upcoming[0] ? view(upcoming[0]) : null, upcoming: upcoming.slice(1).map(view), recent: recent.map(view), lessons, roster: [], path: [], educators };
  return reply(space);
}

/** The student's session with the section code: its section and course, the course's pacing and who chose to study. */
export async function studentAccess(db: Database, tokenHash: string) {
  return db.prepare(`SELECT a.group_id AS groupId,a.organization_id AS organizationId,g.name AS groupName,c.id AS courseId,c.title AS courseTitle,o.name AS organizationName,o.timezone,
      COALESCE(sp.pacing,c.pacing) AS pacing,gl.id AS learnerId,gl.display_name AS learnerName
    FROM group_access_sessions a JOIN course_groups g ON g.id=a.group_id AND g.status='active' AND g.access_code IS NOT NULL JOIN courses c ON c.id=g.course_id AND c.status='active'
    LEFT JOIN study_programs sp ON sp.id=c.program_id JOIN organizations o ON o.id=a.organization_id LEFT JOIN group_learners gl ON gl.id=a.learner_id AND gl.group_id=a.group_id AND gl.status='active'
    WHERE a.token_hash=? AND a.expires_at>?`).bind(tokenHash, Date.now()).first<{ groupId: string; organizationId: string; groupName: string; courseId: string; courseTitle: string; organizationName: string; timezone: string | null; pacing: Pacing; learnerId: string | null; learnerName: string | null }>();
}
/** The course's path: its published lessons in active modules, in content order. */
const pathLessons = "SELECT l.id,json_extract(l.published_content,'$.title') AS title,json_extract(l.published_content,'$.shareCode') AS shareCode,u.id AS unitId,u.name AS unitName FROM lessons l JOIN learning_units u ON u.id=l.course_unit_id AND u.status='active' WHERE u.course_id=? AND l.archived=0 AND l.revision>0 AND json_extract(l.published_content,'$.shareCode') IS NOT NULL";
export async function pathLesson(db: Database, courseId: string, shareCode: unknown) {
  if (typeof shareCode !== "string" || shareCode.length > 64) return null;
  return db.prepare(`${pathLessons} AND json_extract(l.published_content,'$.shareCode')=?`).bind(courseId, shareCode).first<{ id: string }>();
}
