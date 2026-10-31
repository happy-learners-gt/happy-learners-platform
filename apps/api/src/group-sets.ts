import type { Member } from "@happy-learners/contracts";
import { formGroups, groupRulesInput, type FormedGroups, type GroupRules } from "@happy-learners/domain";
import type { Database } from "./storage";
import { scopedCourses } from "./permissions";
import { event } from "./activity";
import { sectionSetName, sectionWorkGroups } from "./workgroups";
import { effectiveActivityIds } from "./freedom-plan";

/**
 * Group sets of a section (lote 3a):
 * - GET /api/sections/:id/group-sets lists the section's active sets.
 * - POST /api/sections/:id/group-sets[?preview=1] { name, rules, sessionId? } previews or stores a split.
 * - PUT …/group-sets/:setId renames it, replaces its members or archives it.
 * - DELETE …/group-sets/:setId archives it.
 * - POST …/group-sets/:setId/regenerate { seed } builds it again, until a graded activity uses it.
 * Administration and the section's educators. The activity log never includes a grade.
 */
const reply = (value: unknown, status = 200) => Response.json(value, { status });
const listPath = /^\/api\/sections\/([a-z0-9-]+)\/group-sets$/;
const assignPath = /^\/api\/sections\/([a-z0-9-]+)\/group-sets\/assignments$/;
const onePath = /^\/api\/sections\/([a-z0-9-]+)\/group-sets\/(groupset-[a-f0-9-]{36})$/;
const regenPath = /^\/api\/sections\/([a-z0-9-]+)\/group-sets\/(groupset-[a-f0-9-]{36})\/regenerate$/;

export function groupSetMethods(path: string): string[] | null {
  if (listPath.test(path)) return ["GET", "POST"];
  if (assignPath.test(path)) return ["PUT"];
  if (regenPath.test(path)) return ["POST"];
  if (onePath.test(path)) return ["PUT", "DELETE"];
  return null;
}

type Section = { id: string; name: string; courseId: string; status: "active" | "archived"; courseStatus: "active" | "archived" };
type SetRow = { id: string; name: string; source: "manual" | "generated"; sessionId: string | null; archived: number; rules: string };
type GroupRow = { id: string; name: string; learnerIds: string | null };

const learnerIds = (json: string | null) => (JSON.parse(json || "[]") as (string | null)[]).filter((id): id is string => !!id);

async function openSection(db: Database, current: Member, groupId: string): Promise<Section | Response> {
  const section = await db.prepare(`SELECT g.id,g.name,g.course_id AS courseId,g.status,c.status AS courseStatus,
    EXISTS(SELECT 1 FROM section_educators e WHERE e.group_id=g.id AND e.user_id=?) AS teaches
    FROM course_groups g JOIN courses c ON c.id=g.course_id AND c.organization_id=g.organization_id
    WHERE g.id=? AND g.organization_id=?`).bind(current.id, groupId, current.organizationId).first<Section & { teaches: number }>();
  if (!section) return reply({ error: "La sección no está disponible." }, 404);
  const admin = current.role === "admin";
  const teaches = !!section.teaches;
  if (!admin && !teaches) {
    const scoped = await scopedCourses(db, current, ["classes.view", "sections.assign"]);
    if (!scoped.includes(section.courseId)) return reply({ error: "Esta sección no está asignada a tu cuenta. Administración asigna quién imparte cada sección." }, 403);
    return reply({ error: "Solo administración y quienes imparten la sección forman sus grupos." }, 403);
  }
  if (section.status !== "active" || section.courseStatus !== "active") return reply({ error: "La sección está cerrada. Reactívala para hacer cambios." }, 409);
  return section;
}

async function graded(db: Database, setId: string) {
  return !!(await db.prepare(`SELECT 1 AS found FROM section_activity_sets s JOIN assessment_activities a ON a.id=s.activity_id AND s.kind='assessment' WHERE s.set_id=? AND (
    EXISTS (SELECT 1 FROM assessment_group_marks m WHERE m.activity_id=a.id)
    OR EXISTS (SELECT 1 FROM assessment_group_adjustments d WHERE d.activity_id=a.id)
    OR EXISTS (SELECT 1 FROM assessment_peer_ratings p WHERE p.activity_id=a.id)
    OR EXISTS (SELECT 1 FROM assessment_scores s WHERE s.activity_id=a.id AND s.source='group')
    OR EXISTS (SELECT 1 FROM assessment_marks k WHERE k.activity_id=a.id AND k.source='group')
  ) LIMIT 1`).bind(setId).first());
}

async function view(db: Database, setId: string, organizationId: string, unmet?: FormedGroups["unmet"]) {
  const row = await db.prepare("SELECT id,name,source,session_id AS sessionId,archived,rules FROM work_group_sets WHERE id=? AND organization_id=?").bind(setId, organizationId).first<SetRow>();
  if (!row) return null;
  const groups = (await db.prepare("SELECT id,name,(SELECT json_group_array(learner_id) FROM work_group_members WHERE work_group_id=work_groups.id) AS learnerIds FROM work_groups WHERE set_id=? ORDER BY rowid").bind(setId).all<GroupRow>()).results;
  return {
    id: row.id, name: row.name, source: row.source, sessionId: row.sessionId, archived: !!row.archived,
    rules: JSON.parse(row.rules) as GroupRules,
    groups: groups.map(group => ({ id: group.id, name: group.name, learnerIds: learnerIds(group.learnerIds) })),
    ...(unmet ? { unmet } : {}),
  };
}

async function pool(db: Database, section: Section, organizationId: string, sessionId: string | null, rules: GroupRules) {
  const active = (await db.prepare("SELECT id FROM group_learners WHERE group_id=? AND organization_id=? AND status='active' ORDER BY display_name COLLATE NOCASE,id").bind(section.id, organizationId).all<{ id: string }>()).results;
  if (!active.length) return "La sección no tiene estudiantes activos.";
  if (!sessionId) return active.map(learner => ({ id: learner.id, score: rules.scores?.[learner.id] ?? null, attribute: rules.attributes?.[learner.id] ?? null }));
  const session = await db.prepare("SELECT id FROM class_sessions WHERE id=? AND group_id=? AND organization_id=?").bind(sessionId, section.id, organizationId).first();
  if (!session) return "Esa clase no es de esta sección.";
  const present = new Set((await db.prepare(`SELECT a.learner_id AS id FROM attendance_marks a JOIN group_learners l ON l.id=a.learner_id
    WHERE a.session_id=? AND l.group_id=? AND l.organization_id=? AND l.status='active' AND a.status IN ('present','late')`).bind(sessionId, section.id, organizationId).all<{ id: string }>()).results.map(row => row.id));
  const kept = active.filter(learner => present.has(learner.id));
  if (!kept.length) return "Pasa lista de esa clase: no hay estudiantes presentes para formar grupos.";
  return kept.map(learner => ({ id: learner.id, score: rules.scores?.[learner.id] ?? null, attribute: rules.attributes?.[learner.id] ?? null }));
}

function statementsFor(db: Database, current: Member, section: Section, setId: string, formed: FormedGroups, now: string) {
  return formed.groups.flatMap(group => {
    const id = `work-group-${crypto.randomUUID()}`;
    return [
      db.prepare("INSERT INTO work_groups(id,organization_id,course_id,group_id,name,created_at,set_id) VALUES (?,?,?,?,?,?,?)").bind(id, current.organizationId, section.courseId, section.id, group.name, now, setId),
      ...group.learnerIds.map(learnerId => db.prepare("INSERT INTO work_group_members(work_group_id,learner_id) VALUES (?,?)").bind(id, learnerId)),
    ];
  });
}

async function clearGroups(db: Database, setId: string) {
  const ids = (await db.prepare("SELECT id FROM work_groups WHERE set_id=?").bind(setId).all<{ id: string }>()).results.map(row => row.id);
  if (!ids.length) return [];
  const marks = ids.map(() => "?").join(",");
  return [
    db.prepare(`DELETE FROM activity_work_groups WHERE work_group_id IN (${marks})`).bind(...ids),
    db.prepare(`DELETE FROM work_group_members WHERE work_group_id IN (${marks})`).bind(...ids),
    db.prepare(`DELETE FROM work_groups WHERE id IN (${marks})`).bind(...ids),
  ];
}

export async function groupSets(path: string, method: string, input: unknown, url: URL, current: Member, db: Database): Promise<Response> {
  const assigning = assignPath.exec(path);
  if (assigning) {
    if (method !== "PUT") return reply({ error: "Ruta no disponible." }, 404);
    const section = await openSection(db, current, assigning[1]);
    if (section instanceof Response) return section;
    return assignActivity(db, current, section, input);
  }
  const match = regenPath.exec(path) || onePath.exec(path) || listPath.exec(path);
  if (!match) return reply({ error: "Ruta no disponible." }, 404);
  const section = await openSection(db, current, match[1]);
  if (section instanceof Response) return section;
  const setId = match[2];
  if (regenPath.test(path)) return regenerate(db, current, section, setId, input);
  if (setId && method === "DELETE") return archive(db, current, section, setId);
  if (setId && method === "PUT") return update(db, current, section, setId, input);
  if (!setId && method === "GET") return list(db, current, section);
  if (!setId && method === "POST") return create(db, current, section, input, url.searchParams.get("preview") === "1");
  return reply({ error: "Ruta no disponible." }, 404);
}

async function list(db: Database, current: Member, section: Section) {
  const rows = (await db.prepare("SELECT id FROM work_group_sets WHERE group_id=? AND organization_id=? AND archived=0 ORDER BY CASE WHEN name=? COLLATE NOCASE THEN 0 ELSE 1 END, created_at, id").bind(section.id, current.organizationId, sectionSetName).all<{ id: string }>()).results;
  const sets = [];
  for (const row of rows) {
    const set = await view(db, row.id, current.organizationId);
    if (set) sets.push({ ...set, graded: await graded(db, row.id) });
  }
  const lessons = await sectionWorkGroups(db, section.courseId, section.id);
  const links = (await db.prepare("SELECT activity_id AS activityId, kind, set_id AS setId FROM section_activity_sets WHERE group_id=?").bind(section.id).all<{ activityId: string; kind: string; setId: string }>()).results;
  const groupSet = new Map((await db.prepare("SELECT id, set_id AS setId FROM work_groups WHERE group_id=?").bind(section.id).all<{ id: string; setId: string | null }>()).results.map(row => [row.id, row.setId]));
  const assessments = (await db.prepare(`SELECT a.id, a.title, a.group_id AS groupId, p.name AS periodName FROM assessment_activities a JOIN academic_periods p ON p.id=a.period_id JOIN academic_years y ON y.id=p.year_id
    WHERE a.course_id=? AND a.organization_id=? AND a.group_mode='group' AND (a.group_id IS NULL OR a.group_id=?) AND y.status IN ('current','closed') ORDER BY p.starts_on, a.position`).bind(section.courseId, current.organizationId, section.id).all<{ id: string; title: string; periodName: string; groupId: string | null }>()).results;
  const visible = await effectiveActivityIds(db, current.organizationId, section.courseId, section.id);
  const shownAssessments = assessments.filter(item => visible ? visible.has(item.id) : !item.groupId);
  const activities = [
    ...lessons.activities.map(item => ({
      kind: "lesson" as const, activityId: item.activityId, lessonId: item.lessonId, title: item.title, detail: `${item.lessonTitle} · ${item.unitName}`, grouping: item.grouping, workGroupIds: item.workGroupIds, ...(item.own ? { own: true } : {}),
      setId: links.find(link => link.kind === "lesson" && link.activityId === item.activityId)?.setId || item.workGroupIds.map(id => groupSet.get(id)).find(Boolean) || null,
    })),
    ...shownAssessments.map(item => ({
      kind: "assessment" as const, activityId: item.id, title: item.title, detail: item.periodName, workGroupIds: [] as string[], ...(item.groupId ? { own: true } : {}),
      setId: links.find(link => link.kind === "assessment" && link.activityId === item.id)?.setId || null,
    })),
  ];
  return reply({
    sets: sets.map(set => ({ ...set, usedIn: activities.filter(item => item.setId === set.id).map(item => ({ kind: item.kind, activityId: item.activityId, title: item.title })) })),
    activities,
  });
}

async function assignActivity(db: Database, current: Member, section: Section, input: unknown) {
  const body = input && typeof input === "object" ? input as Record<string, unknown> : null;
  const kind = body?.kind, activityId = body?.activityId, setId = body?.setId;
  if ((kind !== "lesson" && kind !== "assessment") || typeof activityId !== "string" || typeof setId !== "string") return reply({ error: "Elige la actividad y el conjunto de grupos." }, 400);
  const set = await db.prepare("SELECT id,name FROM work_group_sets WHERE id=? AND group_id=? AND organization_id=? AND archived=0").bind(setId, section.id, current.organizationId).first<{ id: string; name: string }>();
  if (!set) return reply({ error: "Elige un conjunto de grupos activo de esta sección." }, 400);
  if (kind === "assessment") {
    const activity = await db.prepare("SELECT id,title,group_mode AS groupMode FROM assessment_activities WHERE id=? AND course_id=? AND organization_id=?").bind(activityId, section.courseId, current.organizationId).first<{ id: string; title: string; groupMode: string }>();
    if (!activity || activity.groupMode !== "group") return reply({ error: "Solo una actividad en grupos de la evaluación elige su conjunto en la sección." }, 400);
    await db.batch([
      db.prepare("INSERT INTO section_activity_sets(group_id, activity_id, kind, set_id) VALUES (?,?,'assessment',?) ON CONFLICT(group_id, activity_id, kind) DO UPDATE SET set_id=excluded.set_id").bind(section.id, activity.id, set.id),
      event(db, current, { action: "assigned", targetType: "group", targetId: section.id, courseId: section.courseId, summary: `Eligió «${set.name}» para «${activity.title}» en «${section.name}»` }),
    ]);
    return reply({ ok: true });
  }
  const lessonId = body?.lessonId;
  const chosen = body?.workGroupIds;
  if (typeof lessonId !== "string" || !Array.isArray(chosen) || chosen.some(id => typeof id !== "string")) return reply({ error: "Elige la actividad y los grupos que la trabajan." }, 400);
  const lessons = await sectionWorkGroups(db, section.courseId, section.id);
  const activity = lessons.activities.find(item => item.lessonId === lessonId && item.activityId === activityId);
  if (!activity) return reply({ error: "Solo las actividades en parejas o en equipos de las lecciones publicadas del curso se asignan a grupos." }, 400);
  const groups = (await db.prepare("SELECT id FROM work_groups WHERE set_id=?").bind(set.id).all<{ id: string }>()).results.map(row => row.id);
  if ((chosen as string[]).some(id => !groups.includes(id))) return reply({ error: "Elige grupos de ese conjunto." }, 400);
  await db.batch([
    db.prepare("DELETE FROM activity_work_groups WHERE group_id=? AND lesson_id=? AND activity_id=?").bind(section.id, lessonId, activityId),
    ...(chosen as string[]).map(id => db.prepare("INSERT INTO activity_work_groups(organization_id,group_id,lesson_id,activity_id,work_group_id) VALUES (?,?,?,?,?)").bind(current.organizationId, section.id, lessonId, activityId, id)),
    db.prepare("INSERT INTO section_activity_sets(group_id, activity_id, kind, set_id) VALUES (?,?,'lesson',?) ON CONFLICT(group_id, activity_id, kind) DO UPDATE SET set_id=excluded.set_id").bind(section.id, activityId, set.id),
    event(db, current, { action: "assigned", targetType: "group", targetId: section.id, courseId: section.courseId, summary: `Asignó «${activity.title}» a «${set.name}» en «${section.name}»` }),
  ]);
  return reply({ ok: true });
}

async function create(db: Database, current: Member, section: Section, input: unknown, preview: boolean) {
  const body = input && typeof input === "object" ? input as Record<string, unknown> : {};
  const name = typeof body.name === "string" ? body.name.trim() : "";
  if (!name || name.length > 80) return reply({ error: "Escribe un nombre de hasta 80 caracteres para el conjunto." }, 400);
  const rules = groupRulesInput(body.rules);
  if ("error" in rules) return reply(rules, 400);
  const sessionId = body.sessionId === undefined || body.sessionId === null || body.sessionId === "" ? null : body.sessionId;
  if (sessionId !== null && (typeof sessionId !== "string" || sessionId.length > 80)) return reply({ error: "Elige la clase de la que tomas los presentes." }, 400);
  const learners = await pool(db, section, current.organizationId, sessionId, rules);
  if (typeof learners === "string") return reply({ error: learners }, 400);
  const formed = formGroups(learners, rules, rules.seed);
  if (preview) return reply({ preview: true, name, sessionId, groups: formed.groups, unmet: formed.unmet });
  const taken = await db.prepare("SELECT id FROM work_group_sets WHERE group_id=? AND organization_id=? AND archived=0 AND name=? COLLATE NOCASE").bind(section.id, current.organizationId, name).first();
  if (taken) return reply({ error: `Ya hay un conjunto llamado «${name}» en esta sección.` }, 409);
  const id = `groupset-${crypto.randomUUID()}`;
  const now = new Date().toISOString();
  await db.batch([
    db.prepare("INSERT INTO work_group_sets(id,organization_id,group_id,name,rules,source,session_id,created_by,created_at,updated_at) VALUES (?,?,?,?,?,'generated',?,?,?,?)")
      .bind(id, current.organizationId, section.id, name, JSON.stringify(rules), sessionId, current.id, now, now),
    ...statementsFor(db, current, section, id, formed, now),
    event(db, current, { action: "created", targetType: "group", targetId: section.id, courseId: section.courseId, summary: `Formó el conjunto «${name}» en «${section.name}» (${formed.groups.length === 1 ? "1 grupo" : `${formed.groups.length} grupos`})` }),
  ]);
  return reply({ set: await view(db, id, current.organizationId, formed.unmet) }, 201);
}

async function regenerate(db: Database, current: Member, section: Section, setId: string, input: unknown) {
  const row = await db.prepare("SELECT id,name,rules,archived,session_id AS sessionId FROM work_group_sets WHERE id=? AND group_id=? AND organization_id=?").bind(setId, section.id, current.organizationId).first<SetRow>();
  if (!row) return reply({ error: "Ese conjunto no está en esta sección." }, 404);
  if (row.archived) return reply({ error: "Este conjunto está archivado." }, 409);
  if (await graded(db, setId)) return reply({ error: "Este conjunto ya tiene notas: no puedes volver a formarlo ni cambiar sus miembros." }, 409);
  const body = input && typeof input === "object" ? input as Record<string, unknown> : {};
  const seed = typeof body.seed === "string" ? body.seed.trim() : "";
  if (!seed || seed.length > 80) return reply({ error: "Indica la semilla nueva del conjunto." }, 400);
  const rules = groupRulesInput({ ...JSON.parse(row.rules), seed });
  if ("error" in rules) return reply(rules, 400);
  const learners = await pool(db, section, current.organizationId, row.sessionId, rules);
  if (typeof learners === "string") return reply({ error: learners }, 400);
  const formed = formGroups(learners, rules, seed);
  const now = new Date().toISOString();
  await db.batch([
    ...await clearGroups(db, setId),
    db.prepare("UPDATE work_group_sets SET rules=?,source='generated',updated_at=? WHERE id=? AND organization_id=?").bind(JSON.stringify(rules), now, setId, current.organizationId),
    ...statementsFor(db, current, section, setId, formed, now),
    event(db, current, { action: "updated", targetType: "group", targetId: section.id, courseId: section.courseId, summary: `Volvió a formar el conjunto «${row.name}» en «${section.name}»` }),
  ]);
  return reply({ set: await view(db, setId, current.organizationId, formed.unmet) });
}

async function archive(db: Database, current: Member, section: Section, setId: string) {
  const row = await db.prepare("SELECT id,name,archived FROM work_group_sets WHERE id=? AND group_id=? AND organization_id=?").bind(setId, section.id, current.organizationId).first<{ id: string; name: string; archived: number }>();
  if (!row) return reply({ error: "Ese conjunto no está en esta sección." }, 404);
  if (!row.archived) {
    const now = new Date().toISOString();
    await db.batch([
      db.prepare("UPDATE work_group_sets SET archived=1,updated_at=? WHERE id=? AND organization_id=?").bind(now, setId, current.organizationId),
      event(db, current, { action: "archived", targetType: "group", targetId: section.id, courseId: section.courseId, summary: `Archivó el conjunto «${row.name}» de «${section.name}»` }),
    ]);
  }
  return reply({ set: await view(db, setId, current.organizationId) });
}

async function update(db: Database, current: Member, section: Section, setId: string, input: unknown) {
  const row = await db.prepare("SELECT id,name,archived FROM work_group_sets WHERE id=? AND group_id=? AND organization_id=?").bind(setId, section.id, current.organizationId).first<{ id: string; name: string; archived: number }>();
  if (!row) return reply({ error: "Ese conjunto no está en esta sección." }, 404);
  const body = input && typeof input === "object" ? input as Record<string, unknown> : {};
  const name = body.name === undefined ? row.name : typeof body.name === "string" ? body.name.trim() : "";
  if (!name || name.length > 80) return reply({ error: "Escribe un nombre de hasta 80 caracteres para el conjunto." }, 400);
  if (body.archived !== undefined && typeof body.archived !== "boolean") return reply({ error: "Indica si archivas el conjunto." }, 400);
  if (body.groups !== undefined && !Array.isArray(body.groups)) return reply({ error: "Revisa los grupos del conjunto." }, 400);
  const taken = await db.prepare("SELECT id FROM work_group_sets WHERE group_id=? AND organization_id=? AND archived=0 AND name=? COLLATE NOCASE AND id<>?").bind(section.id, current.organizationId, name, setId).first();
  if (taken && body.archived !== true) return reply({ error: `Ya hay un conjunto llamado «${name}» en esta sección.` }, 409);
  const now = new Date().toISOString();
  const writes = [
    db.prepare("UPDATE work_group_sets SET name=?,archived=?,updated_at=? WHERE id=? AND organization_id=?").bind(name, body.archived === true || (body.archived === undefined && row.archived) ? 1 : 0, now, setId, current.organizationId),
  ];
  if (Array.isArray(body.groups)) {
    if (await graded(db, setId)) return reply({ error: "Este conjunto ya tiene notas: no puedes volver a formarlo ni cambiar sus miembros." }, 409);
    const roster = new Set((await db.prepare("SELECT id FROM group_learners WHERE group_id=? AND organization_id=? AND status='active'").bind(section.id, current.organizationId).all<{ id: string }>()).results.map(learner => learner.id));
    const currentGroups = new Set((await db.prepare("SELECT id FROM work_groups WHERE set_id=?").bind(setId).all<{ id: string }>()).results.map(group => group.id));
    const next: { id: string; name: string; learnerIds: string[] }[] = [];
    const seen = new Set<string>();
    for (const item of body.groups) {
      if (!item || typeof item !== "object") return reply({ error: "Revisa los grupos del conjunto." }, 400);
      const group = item as Record<string, unknown>;
      const groupName = typeof group.name === "string" ? group.name.trim() : "";
      if (!groupName || groupName.length > 60) return reply({ error: "Cada grupo necesita un nombre de hasta 60 caracteres." }, 400);
      if (!Array.isArray(group.learnerIds) || group.learnerIds.some(id => typeof id !== "string" || !roster.has(id)) || new Set(group.learnerIds).size !== group.learnerIds.length) return reply({ error: "Elige estudiantes activos de esta sección, sin repetirlos en el grupo." }, 400);
      const id = typeof group.id === "string" && currentGroups.has(group.id) ? group.id : `work-group-${crypto.randomUUID()}`;
      if (seen.has(groupName.toLocaleLowerCase("es")) || next.some(other => other.learnerIds.some(learnerId => (group.learnerIds as string[]).includes(learnerId)))) return reply({ error: "En un conjunto, los nombres y los estudiantes no se repiten." }, 409);
      seen.add(groupName.toLocaleLowerCase("es"));
      next.push({ id, name: groupName, learnerIds: group.learnerIds as string[] });
    }
    writes.push(...await clearGroups(db, setId));
    for (const group of next) {
      writes.push(db.prepare("INSERT INTO work_groups(id,organization_id,course_id,group_id,name,created_at,set_id) VALUES (?,?,?,?,?,?,?)").bind(group.id, current.organizationId, section.courseId, section.id, group.name, now, setId));
      writes.push(...group.learnerIds.map(learnerId => db.prepare("INSERT INTO work_group_members(work_group_id,learner_id) VALUES (?,?)").bind(group.id, learnerId)));
    }
    writes.push(db.prepare("UPDATE work_group_sets SET source='manual',updated_at=? WHERE id=?").bind(now, setId));
  }
  writes.push(event(db, current, { action: body.archived === true ? "archived" : "updated", targetType: "group", targetId: section.id, courseId: section.courseId, summary: body.archived === true ? `Archivó el conjunto «${name}» de «${section.name}»` : `Actualizó el conjunto «${name}» de «${section.name}»` }));
  await db.batch(writes);
  return reply({ set: await view(db, setId, current.organizationId) });
}
