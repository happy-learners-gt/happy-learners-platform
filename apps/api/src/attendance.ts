import type { ClassGroup, GroupLearner, Member, SectionEducator } from "@happy-learners/contracts";
import { maxSectionEducators, newGroupCode, seesSection, teachesSection } from "@happy-learners/domain";
import type { Database } from "./storage";
import { configurationOf } from "./courses";
import { event } from "./team";
import { accessTo, forbidden } from "./access";
import { fillLessons, saveSchedule, scheduleOf, sessions } from "./classes";

const reply = (data: unknown, status = 200) => Response.json(data, { status });
const unavailable = () => reply({ error: "La sección no está disponible en este curso." }, 404);
const configuresOnly = () => forbidden("Administración crea las secciones, inscribe a sus estudiantes, asigna sus educadores y configura su horario.");
const validName = (value: unknown, limit: number) => typeof value === "string" && value.trim().length > 0 && value.trim().length <= limit && !/[<>\x00-\x1f]/.test(value);

export async function classroom(path: string, method: string, input: unknown, current: Member, db: Database) {
  const parts = path.split("/");
  const courseId = parts[3];
  const course = await db.prepare("SELECT id FROM courses WHERE id=? AND organization_id=? AND status='active'").bind(courseId, current.organizationId).first();
  if (!course) return reply({ error: "La sección o la clase no está disponible en este curso." }, 404);
  // Sections list minors by name: administration and the course's teaching team only, each educator in their own sections.
  const access = await accessTo(db, current, courseId);
  if (!access) return forbidden("Solo administración y el equipo docente del curso consultan sus secciones, clases y asistencia.");
  // Records stay readable when attendance is turned off; new sections, students, classes and marks are not accepted.
  if (method !== "GET" && !(await configurationOf(db, current.organizationId, courseId))!.settings.attendance) return reply({ error: "La asistencia está desactivada en la configuración de este curso." }, 409);
  if (parts[4] === "sessions") return sessions(parts, method, input, current, db, courseId, access);
  const now = new Date().toISOString();
  const value = input as Record<string, unknown> | null;
  const [groupId, sub, learnerId] = [parts[5], parts[6], parts[7]];
  if (!groupId) {
    if (method === "GET") {
      const groups = await db.prepare("SELECT g.id,g.course_id AS courseId,g.name,g.status,g.access_code AS accessCode,g.schedule_weekdays AS weekdays,g.schedule_starts_at AS startsAt,g.schedule_duration AS durationMinutes,g.schedule_from AS \"from\",g.schedule_until AS until,count(l.id) AS learnerCount FROM course_groups g LEFT JOIN group_learners l ON l.group_id=g.id AND l.status='active' WHERE g.course_id=? AND g.organization_id=? GROUP BY g.id ORDER BY g.status,g.name,g.created_at").bind(courseId, current.organizationId).all<Omit<ClassGroup, "educators"> & Parameters<typeof scheduleOf>[0]>();
      const learners = await db.prepare("SELECT id,group_id AS groupId,display_name AS displayName,status FROM group_learners WHERE course_id=? AND organization_id=? AND status='active' ORDER BY display_name,id").bind(courseId, current.organizationId).all<GroupLearner>();
      const educators = await educatorsOf(db, courseId, current.organizationId);
      return reply({ groups: groups.results.filter(group => seesSection(access, group.id)).map(({ weekdays, startsAt, durationMinutes, from, until, ...group }) => ({ ...group, schedule: scheduleOf({ weekdays, startsAt, durationMinutes, from, until }), educators: educators.filter(item => item.groupId === group.id).map(({ groupId: _, ...item }) => item), learners: learners.results.filter(learner => learner.groupId === group.id) })) });
    }
    if (!access.configure) return configuresOnly();
    if (!validName(value?.name, 100)) return reply({ error: "Escribe un nombre de sección de hasta 100 caracteres." }, 400);
    const name = String(value!.name).trim();
    const id = `group-${crypto.randomUUID()}`;
    await db.batch([db.prepare("INSERT INTO course_groups(id,course_id,organization_id,name,created_at) VALUES (?,?,?,?,?)").bind(id, courseId, current.organizationId, name, now), event(db, current, { action: "created", targetType: "group", targetId: id, courseId, summary: `Creó la sección «${name}»` })]);
    return reply({ id }, 201);
  }
  const group = await db.prepare("SELECT id,name,status,access_code AS accessCode FROM course_groups WHERE id=? AND course_id=? AND organization_id=?").bind(groupId, courseId, current.organizationId).first<{ id: string; name: string; status: "active" | "archived"; accessCode: string | null }>();
  if (!group || !seesSection(access, group.id)) return unavailable();
  // What the section's educators do: plan its classes in content order. Everything else configures the section.
  if (sub === "lessons" && method === "POST") {
    if (!teachesSection(access, group.id)) return forbidden("Solo quienes imparten la sección planifican sus clases.");
    if (group.status !== "active") return reply({ error: "La sección está cerrada. Reactívala para hacer cambios." }, 409);
    return fillLessons(input, current, db, courseId, group);
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
  if (sub === "educators" && method === "PUT") return assignEducators(input, current, db, courseId, group);
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

/**
 * PUT /api/courses/:id/groups/:gid/educators {userIds} — who teaches the section. Anyone assigned joins the course's
 * team as a co-teacher if they were not on it, so their access follows from one place.
 */
async function assignEducators(input: unknown, current: Member, db: Database, courseId: string, group: { id: string; name: string }) {
  const ids = (input as Record<string, unknown> | null)?.userIds;
  if (!Array.isArray(ids) || ids.length > maxSectionEducators || ids.some(id => typeof id !== "string") || new Set(ids).size !== ids.length) return reply({ error: `Elige hasta ${maxSectionEducators} educadores distintos para la sección.` }, 400);
  const people = (await db.prepare("SELECT user_id AS id FROM memberships WHERE organization_id=? AND active=1").bind(current.organizationId).all<{ id: string }>()).results.map(row => row.id);
  if (ids.some(id => !people.includes(id))) return reply({ error: "Elige personas activas de tu organización." }, 400);
  const team = (await db.prepare("SELECT user_id AS id FROM course_members WHERE course_id=? AND organization_id=?").bind(courseId, current.organizationId).all<{ id: string }>()).results.map(row => row.id);
  const now = new Date().toISOString();
  const joining = (ids as string[]).filter(id => !team.includes(id));
  await db.batch([
    ...joining.map(id => db.prepare("INSERT INTO course_members(course_id,organization_id,user_id,role,added_at) VALUES (?,?,?,'co-teacher',?)").bind(courseId, current.organizationId, id, now)),
    db.prepare("DELETE FROM section_educators WHERE group_id=?").bind(group.id),
    ...(ids as string[]).map(id => db.prepare("INSERT INTO section_educators(group_id,user_id,course_id,organization_id,added_at) VALUES (?,?,?,?,?)").bind(group.id, id, courseId, current.organizationId, now)),
    event(db, current, { action: "assigned", targetType: "group", targetId: group.id, courseId, summary: `Asignó ${ids.length === 1 ? "1 educador" : `${ids.length} educadores`} a «${group.name}»` }),
  ]);
  return reply({ educators: (await educatorsOf(db, courseId, current.organizationId)).filter(item => item.groupId === group.id).map(({ groupId: _, ...item }) => item) });
}
