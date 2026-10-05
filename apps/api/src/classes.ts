import type { ClassResource, ClassSession, ClassStatus, Material, Member, Resource, StudentClass, StudentSpace } from "@happy-learners/contracts";
import { acceptsAttendance, classActions, classPlanInput, classStatusLabels, groupCodePattern, localDay, nextClassStatus, normalizeGroupCode, upcomingClasses } from "@happy-learners/domain";
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
  s.duration_minutes AS durationMinutes,s.status,s.version,s.lesson_revision AS lessonRevision,s.started_at AS startedAt,s.completed_at AS completedAt,
  g.name AS groupName,json_extract(l.content,'$.title') AS lessonTitle,COALESCE(u.display_name,u.username) AS taughtByName,
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
async function resourcesOf(db: Database, organizationId: string, sessionIds: string[], forStudents: boolean) {
  if (!sessionIds.length) return new Map<string, ClassResource[]>();
  const links = (await db.prepare(`SELECT session_id AS sessionId,resource_id AS resourceId FROM class_session_resources WHERE organization_id=? AND session_id IN (${sessionIds.map(() => "?").join(",")}) ORDER BY position`).bind(organizationId, ...sessionIds).all<{ sessionId: string; resourceId: string }>()).results;
  const items = await library(db, organizationId);
  const result = new Map<string, ClassResource[]>();
  for (const link of links) {
    const item = items.get(link.resourceId);
    if (!item) continue;
    const view = classResource(item, forStudents);
    if (forStudents && !view.available) continue;
    result.set(link.sessionId, [...result.get(link.sessionId) || [], view]);
  }
  return result;
}

/** Checks the lesson and resources a plan points to, so a class never links something outside the course or library. */
async function checkPlan(db: Database, organizationId: string, courseId: string, lessonId: string | null, resourceIds: string[], previous: string[] = []) {
  if (lessonId && !await db.prepare("SELECT l.id FROM lessons l JOIN learning_units u ON u.id=l.course_unit_id WHERE l.id=? AND u.course_id=? AND l.archived=0").bind(lessonId, courseId).first()) return "La lección seleccionada no pertenece a este curso.";
  if (resourceIds.length) {
    const items = await library(db, organizationId);
    if (resourceIds.some(id => { const item = items.get(id); return !item || (item.status === "archived" && !previous.includes(id)); })) return "Elige recursos disponibles de la biblioteca.";
  }
  return null;
}
const linkResources = (db: Database, organizationId: string, sessionId: string, resourceIds: string[]) => [
  db.prepare("DELETE FROM class_session_resources WHERE session_id=? AND organization_id=?").bind(sessionId, organizationId),
  ...resourceIds.map((id, position) => db.prepare("INSERT INTO class_session_resources(session_id,resource_id,organization_id,position) VALUES (?,?,?,?)").bind(sessionId, id, organizationId, position)),
];

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
    if (!group) return reply({ error: "Elige un grupo activo de este curso." }, 400);
    const problem = await checkPlan(db, current.organizationId, courseId, plan.lessonId, plan.resourceIds);
    if (problem) return reply({ error: problem }, 400);
    const id = `class-${crypto.randomUUID()}`;
    await db.batch([
      db.prepare("INSERT INTO class_sessions(id,group_id,course_id,organization_id,lesson_id,session_date,starts_at,duration_minutes,notes,status,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,'planned',?,?)")
        .bind(id, group.id, courseId, current.organizationId, plan.lessonId, plan.sessionDate, plan.startsAt, plan.durationMinutes, plan.notes, now, now),
      ...linkResources(db, current.organizationId, id, plan.resourceIds),
      event(db, current, { action: "planned", targetType: "session", targetId: id, courseId, summary: `Planificó la clase del ${plan.sessionDate} en «${group.name}»` }),
    ]);
    return reply({ id }, 201);
  }
  const session = await db.prepare(`SELECT ${sessionColumns},s.notes ${sessionJoins} WHERE s.id=? AND s.course_id=? AND s.organization_id=?`).bind(sessionId, courseId, current.organizationId).first<ClassSession>();
  if (!session) return unavailable();
  if (!sub) {
    if (method === "GET") {
      const [resourceMap, lesson, learners, groupActive] = await Promise.all([
        resourcesOf(db, current.organizationId, [sessionId], false),
        session.lessonId ? db.prepare("SELECT l.id,json_extract(l.content,'$.title') AS title,l.revision,l.archived,json_extract(l.published_content,'$.shareCode') AS shareCode FROM lessons l WHERE l.id=?").bind(session.lessonId).first<{ id: string; title: string; revision: number; archived: number; shareCode: string | null }>() : null,
        attendanceRows(db, sessionId, session.groupId),
        db.prepare("SELECT status FROM course_groups WHERE id=?").bind(session.groupId).first<{ status: string }>(),
      ]);
      const resourcesList = resourceMap.get(sessionId) || [];
      return reply({ session: { ...session, resourceIds: resourcesList.map(item => item.id) }, lesson: lesson ? { id: lesson.id, title: lesson.title, revision: lesson.revision, archived: !!lesson.archived, shareCode: lesson.revision > 0 && !lesson.archived ? lesson.shareCode : null } : null, resources: resourcesList, learners, groupActive: groupActive?.status === "active" });
    }
    const plan = classPlanInput(input);
    if ("error" in plan) return reply(plan, 400);
    if (session.status === "cancelled") return reply({ error: "Reprograma la clase antes de editarla." }, 409);
    const previous = (await db.prepare("SELECT resource_id AS id FROM class_session_resources WHERE session_id=?").bind(sessionId).all<{ id: string }>()).results.map(row => row.id);
    const problem = await checkPlan(db, current.organizationId, courseId, plan.lessonId, plan.resourceIds, previous);
    if (problem) return reply({ error: problem }, 400);
    const version = Number((input as Record<string, unknown>).version);
    const ok = await db.guardedBatch(
      db.prepare("UPDATE class_sessions SET session_date=?,starts_at=?,duration_minutes=?,lesson_id=?,notes=?,version=version+1,updated_at=? WHERE id=? AND organization_id=? AND version=? AND status<>'cancelled' RETURNING id")
        .bind(plan.sessionDate, plan.startsAt, plan.durationMinutes, plan.lessonId, plan.notes, now, sessionId, current.organizationId, Number.isInteger(version) ? version : -1),
      [...linkResources(db, current.organizationId, sessionId, plan.resourceIds), event(db, current, { action: "updated", targetType: "session", targetId: sessionId, courseId, summary: `Actualizó la clase del ${plan.sessionDate} en «${session.groupName}»` })]);
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
    return reply({ error: `Pasa lista antes de finalizar: ${missing === 1 ? "falta 1 participante" : `faltan ${missing} participantes`}.` }, 409);
  }
  if (action === "restore" && !await db.prepare("SELECT id FROM course_groups WHERE id=? AND status='active'").bind(session.groupId).first()) return reply({ error: "El grupo está cerrado. Reactívalo para reprogramar sus clases." }, 409);
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

const studentCookie = (token: string, request: Request, remove = false) => `hl_group=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${remove ? 0 : 28800}${new URL(request.url).protocol === "https:" ? "; Secure" : ""}`;
export const studentToken = (request: Request) => /(?:^|;\s*)hl_group=([do]_[a-f0-9]{64})(?:;|$)/.exec(request.headers.get("Cookie") || "")?.[1] || null;
export const studentScope = (code: string) => code.startsWith("OG-") ? "org-other" : "org-demo";

/** /api/student/* — a learner enters a group code and reads that group's classes, lessons and resources. Read-only. */
export async function student(path: string, method: string, input: unknown, request: Request, scope: string, db: Database, bucket: R2Bucket) {
  if (path === "/api/student/login") {
    const code = normalizeGroupCode((input as Record<string, unknown> | null)?.code);
    if (!groupCodePattern.test(code)) return reply({ error: "Escribe el código del grupo tal como te lo dieron, por ejemplo DG-MATE-3A." }, 400);
    const now = Date.now();
    const bucketKey = await digest(`group:${new Date().toISOString().slice(0, 10)}:${request.headers.get("CF-Connecting-IP") || "local"}`);
    const limit = await db.prepare("INSERT INTO login_limits (bucket, attempts, expires_at) VALUES (?,1,?) ON CONFLICT(bucket) DO UPDATE SET attempts=CASE WHEN expires_at<? THEN 1 ELSE attempts+1 END, expires_at=CASE WHEN expires_at<? THEN excluded.expires_at ELSE expires_at END RETURNING attempts")
      .bind(bucketKey, now + 900000, now, now).first<{ attempts: number }>();
    if (!limit || limit.attempts > 30) return reply({ error: "Demasiados intentos. Espera 15 minutos y vuelve a intentar." }, 429, { "Retry-After": "900" });
    const group = await db.prepare("SELECT g.id,g.organization_id AS organizationId FROM course_groups g JOIN courses c ON c.id=g.course_id AND c.status='active' WHERE g.access_code=? AND g.status='active'").bind(code).first<{ id: string; organizationId: string }>();
    if (!group) return reply({ error: "Ese código no corresponde a un grupo activo. Revísalo con tu educador." }, 404);
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
  // The code stops working as soon as it is changed or the group is closed: the session follows the group's current code.
  const access = token ? await db.prepare("SELECT a.group_id AS groupId,a.organization_id AS organizationId,g.name AS groupName,c.id AS courseId,c.title AS courseTitle,o.name AS organizationName,o.timezone FROM group_access_sessions a JOIN course_groups g ON g.id=a.group_id AND g.status='active' AND g.access_code IS NOT NULL JOIN courses c ON c.id=g.course_id AND c.status='active' JOIN organizations o ON o.id=a.organization_id WHERE a.token_hash=? AND a.expires_at>?").bind(await digest(token), Date.now()).first<{ groupId: string; organizationId: string; groupName: string; courseId: string; courseTitle: string; organizationName: string; timezone: string | null }>() : null;
  if (!access) return reply({ error: "Escribe el código de tu grupo para continuar." }, 401, token ? { "Set-Cookie": studentCookie("", request, true) } : {});
  const fileMatch = path.match(/^\/api\/student\/files\/([a-z0-9-]+)$/);
  if (fileMatch) {
    const linked = await db.prepare("SELECT 1 AS ok FROM class_session_resources r JOIN class_sessions s ON s.id=r.session_id WHERE r.resource_id=? AND s.group_id=? AND s.status<>'cancelled'").bind(fileMatch[1], access.groupId).first();
    if (!linked) return reply({ error: "Este archivo no forma parte de las clases de tu grupo." }, 404);
    return deliverFile(fileMatch[1], access.organizationId, db, bucket);
  }
  if (path !== "/api/student/space" || method !== "GET") return reply({ error: "Ruta no disponible." }, 404);
  const today = localDay(access.timezone || "America/Guatemala");
  const rows = (await db.prepare("SELECT s.id,s.session_date AS sessionDate,s.starts_at AS startsAt,s.duration_minutes AS durationMinutes,s.status,json_extract(l.content,'$.title') AS lessonTitle,CASE WHEN l.revision>0 AND l.archived=0 THEN json_extract(l.published_content,'$.shareCode') END AS shareCode,CASE WHEN l.revision>0 AND l.archived=0 THEN json_extract(l.published_content,'$.title') END AS publishedTitle FROM class_sessions s LEFT JOIN lessons l ON l.id=s.lesson_id WHERE s.group_id=? AND s.status<>'cancelled' ORDER BY s.session_date,s.starts_at").bind(access.groupId).all<{ id: string; sessionDate: string; startsAt: string | null; durationMinutes: number | null; status: ClassStatus; lessonTitle: string | null; shareCode: string | null; publishedTitle: string | null }>()).results;
  const upcoming = upcomingClasses(rows, today).slice(0, 6);
  const recent = rows.filter(row => row.status === "completed").slice(-5).reverse();
  const resourceMap = await resourcesOf(db, access.organizationId, [...upcoming, ...recent].map(row => row.id), true);
  // Students see a lesson only once it is published, under its published title.
  const view = (row: typeof rows[number]): StudentClass => ({ id: row.id, sessionDate: row.sessionDate, startsAt: row.startsAt, durationMinutes: row.durationMinutes, status: row.status, lesson: row.shareCode ? { title: row.publishedTitle || row.lessonTitle || "Lección", shareCode: row.shareCode } : null, resources: resourceMap.get(row.id) || [] });
  const lessons = (await db.prepare("SELECT json_extract(l.published_content,'$.title') AS title,json_extract(l.published_content,'$.shareCode') AS shareCode FROM lesson_assignments a JOIN lessons l ON l.id=a.lesson_id WHERE a.group_id=? AND a.status='active' AND a.starts_on<=? AND (a.ends_on IS NULL OR a.ends_on>=?) AND l.archived=0 AND l.revision>0 ORDER BY a.starts_on").bind(access.groupId, today, today).all<{ title: string; shareCode: string }>()).results.filter(row => row.shareCode);
  const space: StudentSpace = { group: { name: access.groupName }, course: { title: access.courseTitle }, organization: access.organizationName, today, next: upcoming[0] ? view(upcoming[0]) : null, upcoming: upcoming.slice(1).map(view), recent: recent.map(view), lessons };
  return reply(space);
}
