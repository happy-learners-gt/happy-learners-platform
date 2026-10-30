import type { Activity, CourseAccess, GroupActivity, Member, SectionWorkGroups, StudentActivityGroups } from "@happy-learners/contracts";
import { maxWorkGroups, teachesSection, workGroupInput } from "@happy-learners/domain";
import type { Database } from "./storage";
import { event } from "./team";
import { effectiveLessonIds } from "./freedom-plan";
import { forbidden } from "./access";

const reply = (data: unknown, status = 200) => Response.json(data, { status });
export const sectionSetName = "Grupos de la sección";
const sectionSetSql = "SELECT id FROM work_group_sets WHERE group_id=? AND organization_id=? AND archived=0 AND name=? COLLATE NOCASE";

/** The set that holds the section's usual groups. Created the first time one of them is added. */
export async function ensureSectionSet(db: Database, current: Member, courseId: string, groupId: string) {
  const existing = await db.prepare(sectionSetSql).bind(groupId, current.organizationId, sectionSetName).first<{ id: string }>();
  if (existing) return existing.id;
  const id = `groupset-${crypto.randomUUID()}`;
  const now = new Date().toISOString();
  await db.prepare("INSERT INTO work_group_sets(id,organization_id,group_id,name,rules,source,created_by,created_at,updated_at) VALUES (?,?,?,?,?,'manual',?,?,?)")
    .bind(id, current.organizationId, groupId, sectionSetName, JSON.stringify({ by: "size", size: 4, how: "random", seed: "seccion" }), current.id, now, now).run();
  await db.prepare("UPDATE work_groups SET set_id=? WHERE group_id=? AND organization_id=? AND set_id IS NULL").bind(id, groupId, current.organizationId).run();
  return id;
}
type Section = { id: string; name: string; status: "active" | "archived" };
const ids = (json: string | null) => (JSON.parse(json || "[]") as (string | null)[]).filter((id): id is string => !!id);

/** The groups of a section and the activities of the course's published lessons done in pairs or teams, with who does each. */
export async function sectionWorkGroups(db: Database, courseId: string, groupId: string): Promise<SectionWorkGroups> {
  const [groups, lessons, assigned] = await db.batch([
    db.prepare(`SELECT w.id,w.name,(SELECT json_group_array(m.learner_id) FROM work_group_members m JOIN group_learners l ON l.id=m.learner_id AND l.status='active' WHERE m.work_group_id=w.id) AS learners FROM work_groups w WHERE w.group_id=? AND (w.set_id IS NULL OR w.set_id=(SELECT id FROM work_group_sets WHERE group_id=w.group_id AND archived=0 AND name=? COLLATE NOCASE LIMIT 1)) ORDER BY w.name COLLATE NOCASE,w.created_at`).bind(groupId, sectionSetName),
    db.prepare("SELECT l.id,l.group_id AS groupId,COALESCE(json_extract(l.published_content,'$.title'),'Lección') AS title,json_extract(l.published_content,'$.activities') AS activities,u.name AS unitName FROM lessons l JOIN learning_units u ON u.id=l.course_unit_id AND u.status='active' WHERE u.course_id=? AND l.archived=0 AND l.revision>0 AND l.published_content IS NOT NULL AND (l.group_id IS NULL OR l.group_id=?) ORDER BY u.position,l.position,l.id").bind(courseId, groupId),
    db.prepare("SELECT lesson_id AS lessonId,activity_id AS activityId,work_group_id AS workGroupId FROM activity_work_groups WHERE group_id=?").bind(groupId),
  ]) as unknown as [{ id: string; name: string; learners: string | null }[], { id: string; groupId: string | null; title: string; activities: string | null; unitName: string }[], { lessonId: string; activityId: string; workGroupId: string }[]];
  const organization = await db.prepare("SELECT organization_id AS id FROM courses WHERE id=?").bind(courseId).first<{ id: string }>();
  const allowed = organization ? await effectiveLessonIds(db, organization.id, courseId, groupId) : null;
  const shown = allowed ? lessons.filter(lesson => allowed.includes(lesson.id)) : lessons.filter(lesson => !lesson.groupId);
  const activities: GroupActivity[] = shown.flatMap(lesson => (JSON.parse(lesson.activities || "[]") as Activity[])
    .filter((activity): activity is Activity & { id: string; grouping: "pairs" | "teams" } => !!activity.id && (activity.grouping === "pairs" || activity.grouping === "teams"))
    .map(activity => ({ lessonId: lesson.id, lessonTitle: lesson.title, unitName: lesson.unitName, activityId: activity.id, title: activity.title, grouping: activity.grouping,
      ...(lesson.groupId ? { own: true } : {}),
      workGroupIds: assigned.filter(row => row.lessonId === lesson.id && row.activityId === activity.id).map(row => row.workGroupId) })));
  return { workGroups: groups.map(group => ({ id: group.id, name: group.name, learnerIds: ids(group.learners) })), activities };
}

/**
 * /api/courses/:id/groups/:gid/work-groups[/:wid] and …/activity-groups (DEC-028): the section's educators and
 * administration form groups from the section's list and choose which of them do each activity in pairs or teams.
 */
export async function workGroups(sub: string, workGroupId: string | undefined, method: string, input: unknown, current: Member, db: Database, courseId: string, section: Section, access: CourseAccess, enabled: boolean) {
  if (sub === "work-groups" && !workGroupId && method === "GET") return reply(await sectionWorkGroups(db, courseId, section.id));
  if (!access.configure && !teachesSection(access, section.id)) return forbidden("Solo administración y quienes imparten la sección forman sus grupos de trabajo.");
  if (!enabled) return reply({ error: "Los grupos de trabajo están desactivados en la configuración de este curso." }, 409);
  if (section.status !== "active") return reply({ error: "La sección está cerrada. Reactívala para hacer cambios." }, 409);
  if (sub === "activity-groups" && method === "PUT") return assign(input, current, db, courseId, section);
  const existing = workGroupId ? await db.prepare("SELECT id,name FROM work_groups WHERE id=? AND group_id=? AND (set_id IS NULL OR set_id=(SELECT id FROM work_group_sets WHERE group_id=? AND archived=0 AND name=? COLLATE NOCASE LIMIT 1))").bind(workGroupId, section.id, section.id, sectionSetName).first<{ id: string; name: string }>() : null;
  if (workGroupId && !existing) return reply({ error: "El grupo ya no existe en esta sección." }, 404);
  if (existing && method === "DELETE") {
    await db.batch([
      db.prepare("DELETE FROM activity_work_groups WHERE work_group_id=?").bind(existing.id),
      db.prepare("DELETE FROM work_group_members WHERE work_group_id=?").bind(existing.id),
      db.prepare("DELETE FROM work_groups WHERE id=?").bind(existing.id),
      event(db, current, { action: "archived", targetType: "group", targetId: section.id, courseId, summary: `Eliminó el grupo «${existing.name}» de «${section.name}»` }),
    ]);
    return reply({ ok: true });
  }
  if (!(method === "POST" && !workGroupId) && !(method === "PUT" && existing)) return reply({ error: "Ruta no disponible." }, 404);
  const value = workGroupInput(input);
  if (!value) return reply({ error: "Escribe un nombre de grupo de hasta 60 caracteres, distinto de «Toda la sección», y elige estudiantes distintos." }, 400);
  const roster = new Set((await db.prepare("SELECT id FROM group_learners WHERE group_id=? AND status='active'").bind(section.id).all<{ id: string }>()).results.map(row => row.id));
  if (value.learnerIds.some(id => !roster.has(id))) return reply({ error: "Elige estudiantes de la lista de esta sección." }, 400);
  const setId = await ensureSectionSet(db, current, courseId, section.id);
  const taken = await db.prepare("SELECT id FROM work_groups WHERE group_id=? AND (set_id IS NULL OR set_id=?) AND name=? COLLATE NOCASE").bind(section.id, setId, value.name).first<{ id: string }>();
  if (taken && taken.id !== existing?.id) return reply({ error: `Ya hay un grupo llamado «${value.name}» en esta sección.` }, 409);
  const id = existing?.id || `work-group-${crypto.randomUUID()}`;
  if (!existing && ((await db.prepare("SELECT count(*) AS total FROM work_groups WHERE group_id=? AND (set_id IS NULL OR set_id=?)").bind(section.id, setId).first<{ total: number }>())?.total || 0) >= maxWorkGroups) return reply({ error: `Una sección tiene hasta ${maxWorkGroups} grupos de trabajo.` }, 409);
  await db.batch([
    existing ? db.prepare("UPDATE work_groups SET name=?,set_id=? WHERE id=?").bind(value.name, setId, id)
      : db.prepare("INSERT INTO work_groups(id,organization_id,course_id,group_id,name,created_at,set_id) VALUES (?,?,?,?,?,?,?)").bind(id, current.organizationId, courseId, section.id, value.name, new Date().toISOString(), setId),
    db.prepare("DELETE FROM work_group_members WHERE work_group_id=?").bind(id),
    ...value.learnerIds.map(learnerId => db.prepare("INSERT INTO work_group_members(work_group_id,learner_id) VALUES (?,?)").bind(id, learnerId)),
    event(db, current, { action: existing ? "updated" : "created", targetType: "group", targetId: section.id, courseId, summary: existing ? `Actualizó el grupo «${value.name}» de «${section.name}»` : `Formó el grupo «${value.name}» en «${section.name}»` }),
  ]);
  return reply({ id }, existing ? 200 : 201);
}

/** PUT …/activity-groups {lessonId, activityId, workGroupIds}: who does an activity; no groups means the whole section. */
async function assign(input: unknown, current: Member, db: Database, courseId: string, section: Section) {
  const value = input as Record<string, unknown> | null;
  const chosen = value?.workGroupIds;
  if (typeof value?.lessonId !== "string" || typeof value.activityId !== "string" || !Array.isArray(chosen) || chosen.length > maxWorkGroups || chosen.some(id => typeof id !== "string") || new Set(chosen).size !== chosen.length) return reply({ error: "Elige la actividad y los grupos que la trabajan." }, 400);
  const activity = (await sectionWorkGroups(db, courseId, section.id)).activities.find(item => item.lessonId === value.lessonId && item.activityId === value.activityId);
  if (!activity) return reply({ error: "Solo las actividades en parejas o en equipos de las lecciones publicadas del curso se asignan a grupos." }, 400);
  const groups = (await db.prepare("SELECT id,set_id AS setId FROM work_groups WHERE group_id=? AND (set_id IS NULL OR set_id=(SELECT id FROM work_group_sets WHERE group_id=? AND archived=0 AND name=? COLLATE NOCASE LIMIT 1))").bind(section.id, section.id, sectionSetName).all<{ id: string; setId: string | null }>()).results;
  if (chosen.some(id => !groups.some(group => group.id === id))) return reply({ error: "Elige grupos de esta sección." }, 400);
  const setId = groups.find(group => chosen.includes(group.id) && group.setId)?.setId || null;
  await db.batch([
    db.prepare("DELETE FROM activity_work_groups WHERE group_id=? AND lesson_id=? AND activity_id=?").bind(section.id, activity.lessonId, activity.activityId),
    ...(chosen as string[]).map(id => db.prepare("INSERT INTO activity_work_groups(organization_id,group_id,lesson_id,activity_id,work_group_id) VALUES (?,?,?,?,?)").bind(current.organizationId, section.id, activity.lessonId, activity.activityId, id)),
    ...(setId ? [db.prepare("INSERT INTO section_activity_sets(group_id, activity_id, kind, set_id) VALUES (?,?,'lesson',?) ON CONFLICT(group_id, activity_id, kind) DO UPDATE SET set_id=excluded.set_id").bind(section.id, activity.activityId, setId)] : [db.prepare("DELETE FROM section_activity_sets WHERE group_id=? AND activity_id=? AND kind='lesson'").bind(section.id, activity.activityId)]),
    event(db, current, { action: "assigned", targetType: "group", targetId: section.id, courseId, summary: `Asignó «${activity.title}» a ${chosen.length ? (chosen.length === 1 ? "1 grupo" : `${chosen.length} grupos`) : "toda la sección"} en «${section.name}»` }),
  ]);
  return reply({ ok: true });
}

/** The groups assigned to each activity of a lesson in a student's section; members only of the student's own groups. */
export async function studentActivityGroups(db: Database, groupId: string, lessonId: string, learnerId: string | null): Promise<StudentActivityGroups[]> {
  const rows = (await db.prepare("SELECT a.activity_id AS activityId,w.name,(SELECT json_group_array(l.display_name) FROM work_group_members m JOIN group_learners l ON l.id=m.learner_id AND l.status='active' WHERE m.work_group_id=w.id) AS members,EXISTS(SELECT 1 FROM work_group_members m WHERE m.work_group_id=w.id AND m.learner_id=?) AS mine FROM activity_work_groups a JOIN work_groups w ON w.id=a.work_group_id WHERE a.group_id=? AND a.lesson_id=? ORDER BY w.name COLLATE NOCASE")
    .bind(learnerId || "", groupId, lessonId).all<{ activityId: string; name: string; members: string | null; mine: number }>()).results;
  const out = new Map<string, StudentActivityGroups>();
  for (const row of rows) {
    const item = out.get(row.activityId) || { activityId: row.activityId, groups: [] };
    item.groups.push({ name: row.name, mine: !!row.mine, ...(row.mine ? { members: ids(row.members).sort((a, b) => a.localeCompare(b, "es")) } : {}) });
    out.set(row.activityId, item);
  }
  return [...out.values()];
}
