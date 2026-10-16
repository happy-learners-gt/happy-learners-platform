import type { CourseRole, DeparturePerson, DeparturePreview, Member } from "@happy-learners/contracts";
import { departureDate, departureReason, record } from "@happy-learners/domain";
import type { Database } from "./storage";
import { todayFor } from "./classes";
import { educatorConflicts } from "./conflicts";
import { event } from "./team";

const reply = (value: unknown, status = 200) => Response.json(value, { status });
const maxTeam = 20;

type Responsibility = Omit<DeparturePreview, "today" | "lastDeparture"> & { roles: { courseId: string; id: string; role: CourseRole }[] };

/**
 * What the person is responsible for, read in one batch: active courses where they lead or co-teach, with their team,
 * and the active sections of those courses they teach, with who else teaches them. Archived courses keep their team
 * as it was: they are history, not responsibility.
 */
async function responsibilities(db: Database, id: string, organizationId: string): Promise<Responsibility | null> {
  const [member, courses, team, sections, others, people] = await db.batch([
    db.prepare("SELECT u.id,COALESCE(u.display_name,u.username) AS name,u.username,m.active FROM users u JOIN memberships m ON m.user_id=u.id WHERE u.id=? AND m.organization_id=?").bind(id, organizationId),
    db.prepare("SELECT c.id,c.title,cm.role FROM course_members cm JOIN courses c ON c.id=cm.course_id AND c.organization_id=cm.organization_id WHERE cm.user_id=? AND cm.organization_id=? AND c.status='active' ORDER BY CASE cm.role WHEN 'lead' THEN 0 ELSE 1 END,c.title").bind(id, organizationId),
    // Everyone else on those teams, with access or not: all of them count toward the team's limit.
    db.prepare("SELECT cm.course_id AS courseId,cm.role,u.id,COALESCE(u.display_name,u.username) AS name,u.username FROM course_members cm JOIN users u ON u.id=cm.user_id WHERE cm.organization_id=? AND cm.user_id<>? AND cm.course_id IN (SELECT course_id FROM course_members WHERE user_id=?) ORDER BY name").bind(organizationId, id, id),
    db.prepare("SELECT g.id,g.name,g.course_id AS courseId,c.title AS courseTitle FROM section_educators e JOIN course_groups g ON g.id=e.group_id JOIN courses c ON c.id=g.course_id AND c.organization_id=g.organization_id WHERE e.user_id=? AND e.organization_id=? AND g.status='active' AND c.status='active' ORDER BY c.title,g.name").bind(id, organizationId),
    db.prepare("SELECT e.group_id AS groupId,u.id,COALESCE(u.display_name,u.username) AS name,u.username FROM section_educators e JOIN users u ON u.id=e.user_id WHERE e.organization_id=? AND e.user_id<>? AND e.group_id IN (SELECT group_id FROM section_educators WHERE user_id=?) ORDER BY name").bind(organizationId, id, id),
    db.prepare("SELECT u.id,COALESCE(u.display_name,u.username) AS name,u.username FROM users u JOIN memberships m ON m.user_id=u.id WHERE m.organization_id=? AND m.active=1 AND u.id<>? ORDER BY name").bind(organizationId, id),
  ]) as unknown as [(DeparturePerson & { active: number })[], { id: string; title: string; role: CourseRole }[], (DeparturePerson & { courseId: string; role: CourseRole })[], { id: string; name: string; courseId: string; courseTitle: string }[], (DeparturePerson & { groupId: string })[], DeparturePerson[]];
  if (!member.length) return null;
  const strip = <T extends DeparturePerson>({ id, name, username }: T): DeparturePerson => ({ id, name, username });
  return {
    member: { ...strip(member[0]), active: !!member[0].active },
    courses: courses.map(course => ({ ...course, team: team.filter(row => row.courseId === course.id).map(strip) })),
    sections: sections.map(section => {
      const rest = others.filter(row => row.groupId === section.id).map(strip);
      return { ...section, others: rest, required: rest.length === 0 };
    }),
    people,
    roles: team.map(({ courseId, id, role }) => ({ courseId, id, role })),
  };
}

const refused = (id: string, current: Member) =>
  id === current.id ? reply({ error: "Tu propia salida la registra otra persona de administración." }, 409)
    : id === "user-0" ? reply({ error: "La cuenta administradora inicial conserva su acceso." }, 409) : null;

/** GET /api/members/:id/departure — the preview administration confirms: what must be reassigned and to whom. */
export async function departurePreview(id: string, current: Member, db: Database) {
  const blocked = refused(id, current);
  if (blocked) return blocked;
  const found = await responsibilities(db, id, current.organizationId);
  if (!found) return reply({ error: "Miembro no disponible." }, 404);
  const last = await db.prepare("SELECT d.departed_on AS departedOn,d.reason,d.recorded_at AS recordedAt,COALESCE(u.display_name,u.username) AS recordedBy FROM departures d JOIN users u ON u.id=d.recorded_by WHERE d.user_id=? AND d.organization_id=? ORDER BY d.recorded_at DESC LIMIT 1").bind(id, current.organizationId).first<NonNullable<DeparturePreview["lastDeparture"]>>();
  const { roles: _, ...shown } = found;
  const preview: DeparturePreview = { ...shown, today: await todayFor(db, current.organizationId), lastDeparture: last };
  return reply(preview);
}

type Missing = { courses: { id: string; title: string }[]; sections: { id: string; name: string; courseTitle: string }[] };

/**
 * POST /api/members/:id/departure {date, reason?, reassignments: {courses: {courseId: newLeadId}, sections: {sectionId: userId}}, conflictReason?}
 * Every course the person leads gets a new lead and every section only they teach gets a replacement; then, in one
 * transaction, the person leaves every active team and section, loses access (sessions and calendar link end) and the
 * departure is recorded. Nothing they did is deleted. Missing reassignments answer 409 with the list.
 */
export async function recordDeparture(id: string, input: unknown, current: Member, db: Database) {
  const blocked = refused(id, current);
  if (blocked) return blocked;
  const value = record(input);
  const today = await todayFor(db, current.organizationId);
  const date = departureDate(value?.date, today), reason = departureReason(value?.reason);
  if (!value || !date) return reply({ error: "Escribe la fecha de salida (AAAA-MM-DD): hoy o un día anterior." }, 400);
  if (reason === null) return reply({ error: "El motivo admite hasta 300 caracteres, sin < ni >." }, 400);
  const given = record(value.reassignments) || {}, courseChoices = record(given.courses) || {}, sectionChoices = record(given.sections) || {};
  if ([...Object.values(courseChoices), ...Object.values(sectionChoices)].some(choice => typeof choice !== "string")) return reply({ error: "Cada reasignación nombra a una persona." }, 400);
  const found = await responsibilities(db, id, current.organizationId);
  if (!found) return reply({ error: "Miembro no disponible." }, 404);
  const { member, courses, sections, people } = found;
  if (!member.active && await db.prepare("SELECT 1 FROM departures WHERE user_id=? AND organization_id=?").bind(id, current.organizationId).first())
    return reply({ error: `La salida de ${member.name} ya está registrada.` }, 409);

  const leads = courses.filter(course => course.role === "lead"), required = sections.filter(section => section.required);
  const missing: Missing = {
    courses: leads.filter(course => !courseChoices[course.id]).map(({ id, title }) => ({ id, title })),
    sections: required.filter(section => !sectionChoices[section.id]).map(({ id, name, courseTitle }) => ({ id, name, courseTitle })),
  };
  if (missing.courses.length || missing.sections.length) {
    const parts = [missing.courses.length ? `${missing.courses.length === 1 ? "1 curso necesita" : `${missing.courses.length} cursos necesitan`} una nueva persona responsable` : "",
      missing.sections.length ? `${missing.sections.length === 1 ? "1 sección necesita" : `${missing.sections.length} secciones necesitan`} quien la imparta` : ""].filter(Boolean);
    return reply({ error: `Antes de confirmar la salida de ${member.name}: ${parts.join(" y ")}.`, missing }, 409);
  }
  const named = (userId: string) => people.find(person => person.id === userId);
  const known = new Set([...leads.map(course => course.id), ...required.map(section => section.id)]);
  if ([...Object.keys(courseChoices), ...Object.keys(sectionChoices)].some(key => !known.has(key)))
    return reply({ error: "Una reasignación no corresponde a los cursos o secciones de esta persona. Recarga y vuelve a intentar." }, 400);
  if ([...Object.values(courseChoices), ...Object.values(sectionChoices)].some(choice => !named(choice as string)))
    return reply({ error: "Elige personas activas de tu organización, distintas de quien sale." }, 400);

  // The team each course will have: without the person, with its new lead, and with whoever joins to teach a section.
  const teams = new Map<string, Map<string, CourseRole>>();
  for (const course of courses) teams.set(course.id, new Map(found.roles.filter(row => row.courseId === course.id).map(row => [row.id, row.role])));
  for (const course of leads) teams.get(course.id)!.set(courseChoices[course.id] as string, "lead");
  const joins: { courseId: string; userId: string }[] = [];
  for (const section of required) {
    const team = teams.get(section.courseId)!, userId = sectionChoices[section.id] as string;
    if (!team.has(userId)) { team.set(userId, "co-teacher"); joins.push({ courseId: section.courseId, userId }); }
  }
  const crowded = courses.find(course => teams.get(course.id)!.size > maxTeam);
  if (crowded) return reply({ error: `El equipo de «${crowded.title}» quedaría con más de ${maxTeam} personas. Elige a alguien que ya forme parte de él.` }, 400);

  // A replacement who already teaches another section at the same time needs a recorded confirmation, as in ST-118.
  const conflicts = (await Promise.all(required.map(async section => (await educatorConflicts(db, current.organizationId, [section.id], today, [sectionChoices[section.id] as string])).filter(conflict => !conflict.confirmation))))
    .flat();
  const rawConflict = typeof value.conflictReason === "string" ? value.conflictReason.trim().replace(/\s+/g, " ") : "";
  if (conflicts.length && !rawConflict) {
    const names = [...new Set(conflicts.map(conflict => conflict.name))].join(" y ");
    return reply({ error: `${names} ya imparte otra sección a la misma hora. Confirma el choque con un motivo o elige a otra persona.`, conflicts }, 409);
  }
  if (conflicts.length && (rawConflict.length < 3 || rawConflict.length > 300 || /[<>\x00-\x1f]/.test(rawConflict))) return reply({ error: "Escribe en 3 a 300 caracteres por qué se acepta el choque de horario." }, 400);

  const now = new Date().toISOString(), org = current.organizationId;
  const role = (await db.prepare("SELECT CASE role WHEN 'instructor' THEN 'educator' ELSE role END AS role FROM memberships WHERE user_id=? AND organization_id=?").bind(id, org).first<{ role: string }>())!.role;
  const counts = await db.prepare("SELECT (SELECT count(*) FROM course_members WHERE user_id=? AND organization_id=?) AS teams,(SELECT count(*) FROM section_educators WHERE user_id=? AND organization_id=?) AS sections").bind(id, org, id, org).first<{ teams: number; sections: number }>();
  const active = "SELECT id FROM courses WHERE organization_id=? AND status='active'";
  const statements = [
    // Old lead out before the new one in: a course has at most one lead at any moment.
    ...courses.flatMap(course => [
      db.prepare("DELETE FROM course_members WHERE course_id=? AND organization_id=? AND user_id=?").bind(course.id, org, id),
      db.prepare("UPDATE courses SET version=version+1,updated_at=? WHERE id=? AND organization_id=?").bind(now, course.id, org),
    ]),
    ...leads.flatMap(course => {
      const lead = courseChoices[course.id] as string, person = named(lead)!;
      return [
        found.roles.some(row => row.courseId === course.id && row.id === lead)
          ? db.prepare("UPDATE course_members SET role='lead' WHERE course_id=? AND organization_id=? AND user_id=?").bind(course.id, org, lead)
          : db.prepare("INSERT INTO course_members(course_id,organization_id,user_id,role,added_at) VALUES (?,?,?,'lead',?)").bind(course.id, org, lead, now),
        event(db, current, { action: "assigned", targetType: "team", targetId: course.id, courseId: course.id, summary: `Nombró a ${person.name} responsable del curso por la salida de ${member.name}` }),
      ];
    }),
    ...courses.filter(course => course.role === "co-teacher").map(course =>
      event(db, current, { action: "assigned", targetType: "team", targetId: course.id, courseId: course.id, summary: `${member.name} dejó el equipo docente por su salida` })),
    ...joins.map(join => db.prepare("INSERT OR IGNORE INTO course_members(course_id,organization_id,user_id,role,added_at) VALUES (?,?,?,'co-teacher',?)").bind(join.courseId, org, join.userId, now)),
    ...required.flatMap(section => {
      const userId = sectionChoices[section.id] as string;
      return [
        db.prepare("INSERT INTO section_educators(group_id,user_id,course_id,organization_id,added_at) VALUES (?,?,?,?,?)").bind(section.id, userId, section.courseId, org, now),
        event(db, current, { action: "assigned", targetType: "group", targetId: section.id, courseId: section.courseId, summary: `Asignó a ${named(userId)!.name} a «${section.name}» por la salida de ${member.name}` }),
      ];
    }),
    ...conflicts.flatMap(conflict => [
      db.prepare("INSERT INTO educator_conflict_overrides(id,organization_id,group_id,user_id,other_group_id,overlaps,first_date,reason,confirmed_by,confirmed_at) VALUES (?,?,?,?,?,?,?,?,?,?)")
        .bind(`conflict-${crypto.randomUUID()}`, org, conflict.groupId, conflict.userId, conflict.otherGroupId, conflict.overlaps, conflict.firstDate, rawConflict, current.id, now),
      event(db, current, { action: "assigned", targetType: "group", targetId: conflict.groupId, courseId: required.find(section => section.id === conflict.groupId)?.courseId, summary: `Confirmó el choque de horario de ${conflict.name} con «${conflict.otherCourse} · ${conflict.otherGroup}» (${conflict.overlaps === 1 ? "1 clase" : `${conflict.overlaps} clases`}). Motivo: ${rawConflict}`.slice(0, 240) }),
    ]),
    // Leaving every active team also leaves its sections, archived ones included.
    db.prepare(`DELETE FROM section_educators WHERE user_id=? AND organization_id=? AND course_id IN (${active})`).bind(id, org, org),
    db.prepare("UPDATE memberships SET active=0 WHERE user_id=? AND organization_id=?").bind(id, org),
    db.prepare("DELETE FROM sessions WHERE user_id=?").bind(id),
    db.prepare("DELETE FROM calendar_feeds WHERE user_id=?").bind(id),
    db.prepare("INSERT INTO role_events VALUES (?,?,?,?,?,?)").bind(crypto.randomUUID(), current.id, id, role, 0, now),
    db.prepare("INSERT INTO departures(id,organization_id,user_id,departed_on,reason,recorded_by,recorded_at) VALUES (?,?,?,?,?,?,?)").bind(`departure-${crypto.randomUUID()}`, org, id, date, reason, current.id, now),
    // The reason stays out of the activity: it is administration's note.
    event(db, current, { action: "archived", targetType: "account", targetId: id, summary: `Registró la salida de ${member.name} el ${date}` }),
  ];
  // Nothing changed since the responsibilities were read: same teams and sections, replacements still active.
  const chosen = [...new Set([...Object.values(courseChoices), ...Object.values(sectionChoices)] as string[])];
  const guard = db.prepare(`SELECT 1 WHERE (SELECT count(*) FROM course_members WHERE user_id=? AND organization_id=?)=? AND (SELECT count(*) FROM section_educators WHERE user_id=? AND organization_id=?)=?
    AND (SELECT count(*) FROM memberships WHERE organization_id=? AND active=1 AND user_id IN (${chosen.map(() => "?").join(",") || "NULL"}))=?`)
    .bind(id, org, counts!.teams, id, org, counts!.sections, org, ...chosen, chosen.length);
  if (!await db.guardedBatch(guard, statements)) return reply({ error: "El equipo cambió mientras confirmabas. Recarga y vuelve a intentar." }, 409);
  return reply({ ok: true, departedOn: date, reassigned: { courses: leads.length, sections: required.length }, removed: { courses: courses.length, sections: sections.length } });
}
