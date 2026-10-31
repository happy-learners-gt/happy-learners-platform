import type { ClassGroup, CourseAccess, GroupLearner, Member, SectionEducator } from "@happy-learners/contracts";
import { maxSectionEducators, newGroupCode, seesSection, teachesSection } from "@happy-learners/domain";
import type { Database } from "./storage";
import { configurationOf } from "./courses";
import { event } from "./activity";
import { accessTo, forbidden } from "./access";
import { fillLessons, saveSchedule, scheduleOf, sessions, todayFor } from "./classes";
import { educatorConflicts } from "./conflicts";
import { workGroups } from "./workgroups";
import { notify, type Notifier } from "./notify";

const reply = (data: unknown, status = 200) => Response.json(data, { status });
const unavailable = () => reply({ error: "La sección no está disponible en este curso." }, 404);
const configuresOnly = () => forbidden("Administración crea las secciones, inscribe a sus estudiantes, asigna sus educadores y configura su horario.");
const validName = (value: unknown, limit: number) => typeof value === "string" && value.trim().length > 0 && value.trim().length <= limit && !/[<>\x00-\x1f]/.test(value);

export async function classroom(path: string, method: string, input: unknown, current: Member, db: Database, query?: URLSearchParams, notifier?: Notifier) {
  const parts = path.split("/");
  const courseId = parts[3];
  const course = await db.prepare("SELECT id FROM courses WHERE id=? AND organization_id=? AND status='active'").bind(courseId, current.organizationId).first();
  if (!course) return reply({ error: "La sección o la clase no está disponible en este curso." }, 404);
  // Sections list minors by name: administration and the course's teaching team only, each educator in their own sections.
  const access = await accessTo(db, current, courseId);
  if (!access) return forbidden("Solo administración y el equipo docente del curso consultan sus secciones, clases y asistencia.");
  // Records stay readable when attendance is turned off; new sections, students, classes and marks are not accepted.
  const configuration = method === "GET" ? null : (await configurationOf(db, current.organizationId, courseId))!;
  if (configuration && !configuration.settings.attendance) return reply({ error: "La asistencia está desactivada en la configuración de este curso." }, 409);
  // A tu ritmo (DEC-027): sections have no schedule and no classes; each student works through the published course.
  if (configuration?.pacing === "self-paced" && (parts[4] === "sessions" || ["schedule", "lessons"].includes(parts[6]))) return reply({ error: "En un curso a tu ritmo las secciones no tienen horario ni clases: cada estudiante avanza por las lecciones publicadas. Cambia el ritmo del curso a «Con calendario» para programar clases." }, 409);
  if (parts[4] === "sessions") return sessions(parts, method, input, current, db, courseId, access, query, notifier);
  const now = new Date().toISOString();
  const value = input as Record<string, unknown> | null;
  const [groupId, sub, learnerId] = [parts[5], parts[6], parts[7]];
  if (!groupId) {
    if (method === "GET") return reply({ groups: await groupsOf(db, courseId, current.organizationId, access) });
    if (!access.configure) return configuresOnly();
    if (!validName(value?.name, 100)) return reply({ error: "Escribe un nombre de sección de hasta 100 caracteres." }, 400);
    const name = String(value!.name).trim();
    const id = `group-${crypto.randomUUID()}`;
    await db.batch([db.prepare("INSERT INTO course_groups(id,course_id,organization_id,name,created_at) VALUES (?,?,?,?,?)").bind(id, courseId, current.organizationId, name, now), event(db, current, { action: "created", targetType: "group", targetId: id, courseId, summary: `Creó la sección «${name}»` })]);
    return reply({ id }, 201);
  }
  const group = await db.prepare("SELECT id,name,status,access_code AS accessCode FROM course_groups WHERE id=? AND course_id=? AND organization_id=?").bind(groupId, courseId, current.organizationId).first<{ id: string; name: string; status: "active" | "archived"; accessCode: string | null }>();
  if (!group || !seesSection(access, group.id)) return unavailable();
  if (!sub && method === "GET") return reply({ group: (await groupsOf(db, courseId, current.organizationId, access, group.id))[0] });
  if (sub === "work-groups" || sub === "activity-groups") return workGroups(sub, learnerId, method, input, current, db, courseId, group, access, !!configuration?.settings.workGroups);
  // What the section's educators do: plan its classes in content order. Everything else configures the section.
  if (sub === "lessons" && method === "POST") {
    if (!teachesSection(access, group.id)) return forbidden("Solo quienes imparten la sección planifican sus clases.");
    if (group.status !== "active") return reply({ error: "La sección está cerrada. Reactívala para hacer cambios." }, 409);
    return fillLessons(input, current, db, courseId, group);
  }
  // DEC-041: coordination assigns who teaches each section of the courses in its scope, without configuring the rest.
  if (sub === "educators" && method === "PUT") {
    if (!access.educators) return configuresOnly();
    if (group.status !== "active") return reply({ error: "La sección está cerrada. Reactívala para hacer cambios." }, 409);
    return assignEducators(input, current, db, courseId, group, notifier);
  }
  if (!access.configure) return configuresOnly();
  if (!sub && method === "PUT") {
    // ST-070: rename, close and reopen. A closed section keeps its history but takes no new classes or students.
    const name = value?.name === undefined ? group.name : validName(value.name, 100) ? String(value.name).trim() : null;
    const status = value?.status === undefined ? group.status : ["active", "archived"].includes(String(value.status)) ? String(value.status) as "active" | "archived" : null;
    if (!name || !status) return reply({ error: "Revisa el nombre (hasta 100 caracteres) y el estado de la sección." }, 400);
    const summary = status !== group.status ? `${status === "archived" ? "Cerró" : "Reactivó"} la sección «${name}»` : `Renombró la sección «${group.name}» como «${name}»`;
    await db.batch([
      db.prepare("UPDATE course_groups SET name=?,status=? WHERE id=?").bind(name, status, groupId),
      ...(status === "archived" ? [db.prepare("DELETE FROM group_access_sessions WHERE group_id=?").bind(groupId)] : []),
      event(db, current, { action: status !== group.status ? (status === "archived" ? "archived" : "restored") : "updated", targetType: "group", targetId: groupId, courseId, summary }),
    ]);
    return reply({ ok: true });
  }
  if (group.status !== "active") return reply({ error: "La sección está cerrada. Reactívala para hacer cambios." }, 409);
  if (sub === "schedule" && (method === "PUT" || method === "DELETE")) return saveSchedule(method, input, current, db, courseId, group);
  if (sub === "code") {
    // A new code replaces the previous one at once: whoever entered with it loses access on the next request.
    if (method === "DELETE") {
      await db.batch([db.prepare("UPDATE course_groups SET access_code=NULL WHERE id=?").bind(groupId), db.prepare("DELETE FROM group_access_sessions WHERE group_id=?").bind(groupId),
        event(db, current, { action: "updated", targetType: "group", targetId: groupId, courseId, summary: `Desactivó el código de acceso de «${group.name}»` })]);
      return reply({ accessCode: null });
    }
    for (let attempt = 0; attempt < 5; attempt++) {
      const code = newGroupCode(current.organizationId, size => crypto.getRandomValues(new Uint8Array(size)));
      if (await db.prepare("SELECT 1 AS taken FROM course_groups WHERE access_code=?").bind(code).first()) continue;
      await db.batch([db.prepare("UPDATE course_groups SET access_code=? WHERE id=?").bind(code, groupId), db.prepare("DELETE FROM group_access_sessions WHERE group_id=?").bind(groupId),
        event(db, current, { action: "updated", targetType: "group", targetId: groupId, courseId, summary: `${group.accessCode ? "Cambió" : "Creó"} el código de acceso de «${group.name}»` })]);
      return reply({ accessCode: code });
    }
    return reply({ error: "No se pudo generar un código. Vuelve a intentar." }, 503);
  }
  if (sub === "learners" && !learnerId && method === "POST") {
    if (!validName(value?.displayName, 80)) return reply({ error: "Escribe un nombre o identificador de lista de hasta 80 caracteres." }, 400);
    const id = `learner-${crypto.randomUUID()}`;
    await db.prepare("INSERT INTO group_learners(id,group_id,course_id,organization_id,display_name,created_at) VALUES (?,?,?,?,?,?)").bind(id, groupId, courseId, current.organizationId, String(value!.displayName).trim(), now).run();
    return reply({ id }, 201);
  }
  if (sub === "learners" && learnerId && method === "PUT") {
    const learner = await db.prepare("SELECT id,display_name AS displayName,status FROM group_learners WHERE id=? AND group_id=?").bind(learnerId, groupId).first<GroupLearner>();
    if (!learner) return reply({ error: "El estudiante ya no está en esta sección." }, 404);
    const displayName = value?.displayName === undefined ? learner.displayName : validName(value.displayName, 80) ? String(value.displayName).trim() : null;
    const status = value?.status === undefined ? learner.status : ["active", "archived"].includes(String(value.status)) ? String(value.status) : null;
    if (!displayName || !status) return reply({ error: "Escribe un nombre o identificador de lista de hasta 80 caracteres." }, 400);
    // Withdrawing keeps the attendance already recorded; the student leaves the roll of later classes.
    await db.batch([db.prepare("UPDATE group_learners SET display_name=?,status=? WHERE id=?").bind(displayName, status, learnerId),
      ...(status !== learner.status ? [event(db, current, { action: status === "archived" ? "archived" : "restored", targetType: "group", targetId: groupId, courseId, summary: `${status === "archived" ? "Retiró a un estudiante de" : "Reincorporó a un estudiante en"} «${group.name}»` })] : [])]);
    return reply({ ok: true });
  }
  return reply({ error: "Ruta no disponible." }, 404);
}

async function educatorsOf(db: Database, courseId: string, organizationId: string) {
  return (await db.prepare("SELECT e.group_id AS groupId,e.user_id AS userId,COALESCE(u.display_name,u.username) AS name,u.username FROM section_educators e JOIN users u ON u.id=e.user_id WHERE e.course_id=? AND e.organization_id=? ORDER BY name").bind(courseId, organizationId).all<SectionEducator & { groupId: string }>()).results;
}

/** The sections of a course the person sees, with their educators, students and schedule; one of them when an id is given. */
async function groupsOf(db: Database, courseId: string, organizationId: string, access: CourseAccess, only?: string) {
  const groups = await db.prepare(`SELECT g.id,g.course_id AS courseId,g.name,g.status,g.access_code AS accessCode,g.schedule_weekdays AS weekdays,g.schedule_starts_at AS startsAt,g.schedule_duration AS durationMinutes,g.schedule_from AS "from",g.schedule_until AS until,g.schedule_meetings AS meetings,g.schedule_period_id AS periodId,count(l.id) AS learnerCount FROM course_groups g LEFT JOIN group_learners l ON l.group_id=g.id AND l.status='active' WHERE g.course_id=? AND g.organization_id=?${only ? " AND g.id=?" : ""} GROUP BY g.id ORDER BY g.status,g.name,g.created_at`).bind(courseId, organizationId, ...(only ? [only] : [])).all<Omit<ClassGroup, "educators"> & Parameters<typeof scheduleOf>[0]>();
  const learners = await db.prepare(`SELECT id,group_id AS groupId,display_name AS displayName,status FROM group_learners WHERE course_id=? AND organization_id=? AND status='active'${only ? " AND group_id=?" : ""} ORDER BY display_name,id`).bind(courseId, organizationId, ...(only ? [only] : [])).all<GroupLearner>();
  const educators = await educatorsOf(db, courseId, organizationId);
  const seen = groups.results.filter(group => seesSection(access, group.id));
  // Schedule conflicts name other courses' sections: only those who configure sections see them.
  const conflicts = access.configure || access.educators ? await educatorConflicts(db, organizationId, seen.filter(group => group.status === "active").map(group => group.id), await todayFor(db, organizationId)) : [];
  return seen.map(({ weekdays, startsAt, durationMinutes, from, until, meetings, periodId, ...group }) => ({ ...group, schedule: scheduleOf({ weekdays, startsAt, durationMinutes, from, until, meetings, periodId }),
    educators: educators.filter(item => item.groupId === group.id).map(({ groupId: _, ...item }) => {
      const own = conflicts.filter(conflict => conflict.groupId === group.id && conflict.userId === item.userId);
      return own.length ? { ...item, conflicts: own } : item;
    }),
    learners: learners.results.filter(learner => learner.groupId === group.id) }));
}

/**
 * PUT /api/courses/:id/groups/:gid/educators {userIds} — who teaches the section, chosen from the course's team
 * (DEC-024): the team decides who works on the course, and each section picks its educators among them.
 */
async function assignEducators(input: unknown, current: Member, db: Database, courseId: string, group: { id: string; name: string }, notifier?: Notifier) {
  const ids = (input as Record<string, unknown> | null)?.userIds;
  if (!Array.isArray(ids) || ids.length > maxSectionEducators || ids.some(id => typeof id !== "string") || new Set(ids).size !== ids.length) return reply({ error: `Elige hasta ${maxSectionEducators} educadores distintos para la sección.` }, 400);
  const team = (await db.prepare("SELECT cm.user_id AS id FROM course_members cm JOIN memberships m ON m.user_id=cm.user_id AND m.organization_id=cm.organization_id AND m.active=1 WHERE cm.course_id=? AND cm.organization_id=?").bind(courseId, current.organizationId).all<{ id: string }>()).results.map(row => row.id);
  if (ids.some(id => !team.includes(id))) return reply({ error: "Elige educadores del equipo docente del curso. Para sumar a alguien, agrégalo primero al equipo en Configuración." }, 400);
  // Someone who joins the section while teaching another one at the same time needs an explicit, recorded confirmation.
  const before = (await db.prepare("SELECT user_id AS id FROM section_educators WHERE group_id=?").bind(group.id).all<{ id: string }>()).results.map(row => row.id);
  const added = (ids as string[]).filter(id => !before.includes(id));
  const conflicts = (await educatorConflicts(db, current.organizationId, [group.id], await todayFor(db, current.organizationId), added)).filter(conflict => !conflict.confirmation);
  const raw = (input as Record<string, unknown>).conflictReason;
  const reason = typeof raw === "string" ? raw.trim().replace(/\s+/g, " ") : "";
  if (conflicts.length && !reason) {
    const names = (kind: string) => [...new Set(conflicts.filter(conflict => (conflict.kind || "overlap") === kind).map(conflict => conflict.name))].join(" y ");
    const overlap = names("overlap"), outside = names("availability");
    const facts = [overlap && `${overlap} ya imparte otra sección a la misma hora`, outside && `${outside} tiene clases fuera de la disponibilidad que declaró`].filter(Boolean).join("; ");
    return reply({ error: `${facts}. Confirma con un motivo para asignar igualmente.`, conflicts }, 409);
  }
  if (conflicts.length && (reason.length < 3 || reason.length > 300 || /[<>\x00-\x1f]/.test(reason))) return reply({ error: "Escribe en 3 a 300 caracteres por qué se acepta la asignación." }, 400);
  const now = new Date().toISOString();
  await db.batch([
    db.prepare("DELETE FROM section_educators WHERE group_id=?").bind(group.id),
    ...(ids as string[]).map(id => db.prepare("INSERT INTO section_educators(group_id,user_id,course_id,organization_id,added_at) VALUES (?,?,?,?,?)").bind(group.id, id, courseId, current.organizationId, now)),
    event(db, current, { action: "assigned", targetType: "group", targetId: group.id, courseId, summary: `Asignó ${ids.length === 1 ? "1 educador" : `${ids.length} educadores`} a «${group.name}»` }),
    ...conflicts.flatMap(conflict => [
      db.prepare("INSERT INTO educator_conflict_overrides(id,organization_id,group_id,user_id,other_group_id,overlaps,first_date,reason,confirmed_by,confirmed_at) VALUES (?,?,?,?,?,?,?,?,?,?)")
        .bind(`conflict-${crypto.randomUUID()}`, current.organizationId, group.id, conflict.userId, conflict.otherGroupId, conflict.overlaps, conflict.firstDate, reason, current.id, now),
      event(db, current, { action: "assigned", targetType: "group", targetId: group.id, courseId, summary: conflict.kind === "availability" ? `Confirmó que ${conflict.name} imparte fuera de su disponibilidad en «${group.name}» (${conflict.overlaps === 1 ? "1 clase" : `${conflict.overlaps} clases`})` : `Confirmó el choque de horario de ${conflict.name} con «${conflict.otherCourse} · ${conflict.otherGroup}» (${conflict.overlaps === 1 ? "1 clase" : `${conflict.overlaps} clases`}). Motivo: ${reason}`.slice(0, 240) }),
    ]),
  ]);
  // ST-124: whoever starts teaching the section is told by e-mail.
  const course = (await db.prepare("SELECT title FROM courses WHERE id=?").bind(courseId).first<{ title: string }>())?.title || "";
  await notify(db, notifier, current, added.map(userId => ({ userId, targetId: group.id, path: `/secciones/${group.id}`, facts: { type: "section_assignment", course, section: group.name } })));
  return reply({ educators: (await educatorsOf(db, courseId, current.organizationId)).filter(item => item.groupId === group.id).map(({ groupId: _, ...item }) => item) });
}
