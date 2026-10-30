import type { CourseAccess, Member } from "@happy-learners/contracts";
import { isAssessmentKind, pointsInput, schemeFromSettings, sectionContent, teachesSection, type FreedomOverride, type FreedomPolicy } from "@happy-learners/domain";
import type { Database } from "./storage";
import { accessTo, forbidden } from "./access";
import { configurationOf } from "./courses";
import { content } from "./content";
import { recordEvent } from "./team";
import { courseDifferences, effectiveActivityIds, freedomPolicyOf, loadSection, policyLabel, sectionCoverage } from "./freedom-plan";

const reply = (value: unknown, status = 200) => Response.json(value, { status });
const missing = () => reply({ error: "El elemento no está disponible en tu organización." }, 404);

type SectionRow = { id: string; name: string; courseId: string; status: string };

async function openSection(db: Database, current: Member, groupId: string) {
  const section = await db.prepare("SELECT id,name,course_id AS courseId,status FROM course_groups WHERE id=? AND organization_id=?").bind(groupId, current.organizationId).first<SectionRow>();
  if (!section) return missing();
  const access = await accessTo(db, current, section.courseId);
  if (!access) return forbidden("Esta sección no está asignada a tu cuenta.");
  return { section, access };
}

function canRead(current: Member, access: CourseAccess, groupId: string) {
  return current.role === "admin" || access.publish || access.review || access.sections === "all" || teachesSection(access, groupId);
}

/** GET/POST/PUT/DELETE of a section's own plan, and the course core and the differences between sections. */
export async function sectionFreedom(path: string, method: string, input: unknown, current: Member, db: Database): Promise<Response> {
  const sectionPath = path.match(/^\/api\/sections\/([a-z0-9-]+)\/(plan|lessons|activities|content-overrides)$/);
  if (sectionPath) return sectionRoute(sectionPath[1], sectionPath[2], method, input, current, db);
  const coursePath = path.match(/^\/api\/courses\/([a-z0-9-]+)\/(core|sections\/differences)$/);
  if (!coursePath) return missing();
  const courseId = coursePath[1];
  const access = await accessTo(db, current, courseId);
  if (access === undefined) return missing();
  if (!access) return forbidden("Este curso no está asignado a tu cuenta.");
  if (coursePath[2] === "sections/differences") return differences(db, current, courseId, access);
  return markCore(db, current, courseId, access, input);
}

async function sectionRoute(groupId: string, area: string, method: string, input: unknown, current: Member, db: Database) {
  const opened = await openSection(db, current, groupId);
  if (opened instanceof Response) return opened;
  const { section, access } = opened;
  if (!canRead(current, access, groupId)) return forbidden("Esta sección no está asignada a tu cuenta.");
  const policy = await freedomPolicyOf(db, current.organizationId, section.courseId);
  if (policy === "shared") return reply({ error: "Esta sección sigue el contenido del curso." }, 404);
  if (area !== "plan" && !teachesSection(access, groupId)) return forbidden("Solo quienes imparten la sección adaptan su plan.");
  if (section.status !== "active") return reply({ error: "La sección está cerrada. Reactívala para hacer cambios." }, 409);
  if (area === "plan") return planOf(db, current, section, policy, teachesSection(access, groupId));
  if (area === "lessons") return ownLesson(db, current, section, input);
  if (area === "activities") return ownActivity(db, current, section, policy, input);
  return saveOverride(db, current, section, policy, method, input);
}

async function planOf(db: Database, current: Member, section: SectionRow, policy: FreedomPolicy, canEdit: boolean) {
  const loaded = await loadSection(db, current.organizationId, section.courseId, section.id);
  if (!("plan" in loaded)) return reply({ error: "Esta sección sigue el contenido del curso." }, 404);
  const coverage = await sectionCoverage(db, current.organizationId, section.courseId, section.id, loaded.plan);
  return reply({ policy, policyLabel: policyLabel(policy), section: { id: section.id, name: section.name }, canEdit, ...loaded.plan, coverage });
}

async function ownLesson(db: Database, current: Member, section: SectionRow, input: unknown) {
  const body = input && typeof input === "object" ? input as Record<string, unknown> : null;
  const unitId = typeof body?.courseUnitId === "string" ? body.courseUnitId : "";
  const unit = await db.prepare("SELECT id FROM learning_units WHERE id=? AND course_id=? AND status='active'").bind(unitId, section.courseId).first();
  if (!unit) return reply({ error: "Selecciona una unidad activa de este curso." }, 400);
  const created = await content(new URL("https://local/api/lessons"), "POST", input, current, db);
  if (!created.ok) return created;
  const payload = await created.json() as { lesson: { id: string; title: string } };
  await db.prepare("UPDATE lessons SET group_id=?,is_core=0 WHERE id=?").bind(section.id, payload.lesson.id).run();
  await recordEvent(db, current, { action: "created", targetType: "lesson", targetId: payload.lesson.id, courseId: section.courseId, groupId: section.id, summary: `Agregó la lección propia «${payload.lesson.title}» en «${section.name}»` });
  return reply({ lesson: { ...payload.lesson, groupId: section.id, core: false } }, 201);
}

async function ownActivity(db: Database, current: Member, section: SectionRow, policy: FreedomPolicy, input: unknown) {
  const body = input && typeof input === "object" ? input as Record<string, unknown> : null;
  if (!body) return reply({ error: "Revisa la actividad." }, 400);
  const title = typeof body.title === "string" ? body.title.trim() : "";
  if (!title || title.length > 120) return reply({ error: "Cada actividad necesita un nombre de hasta 120 caracteres." }, 400);
  if (!isAssessmentKind(body.kind)) return reply({ error: `Elige el tipo de «${title}».` }, 400);
  const points = pointsInput(body.points, 100);
  if (points === undefined || points === null || points === 0) return reply({ error: `Los puntos de «${title}» van de 0,1 a 100, con un decimal como máximo.` }, 400);
  const configured = await configurationOf(db, current.organizationId, section.courseId);
  if (!configured) return missing();
  let scheme = schemeFromSettings(configured.settings);
  if (configured.settings.gradingSchemeId) {
    const stored = await db.prepare("SELECT id,name,config,status FROM grading_schemes WHERE id=? AND organization_id=?").bind(configured.settings.gradingSchemeId, current.organizationId).first<{ id: string; name: string; config: string; status: string }>();
    if (stored?.status === "active") { const parsed = JSON.parse(stored.config) as typeof scheme; scheme = { ...parsed, id: stored.id, name: stored.name }; }
  }
  const categoryId = typeof body.categoryId === "string" ? body.categoryId : "";
  if (!scheme.categories.some(category => category.id === categoryId)) return reply({ error: "Una actividad usa una categoría que no existe en el esquema efectivo." }, 400);
  const periodId = typeof body.periodId === "string" ? body.periodId : "";
  const period = await db.prepare("SELECT p.id,p.name FROM academic_periods p JOIN academic_years y ON y.id=p.year_id WHERE p.id=? AND p.organization_id=? AND y.status='current'").bind(periodId, current.organizationId).first<{ id: string; name: string }>();
  if (!period) return reply({ error: "Ese periodo no está en el ciclo del curso." }, 400);
  const groupMode = body.groupMode === "group" ? "group" : "individual";
  const setId = typeof body.workGroupSetId === "string" ? body.workGroupSetId : "";
  if (groupMode === "group") {
    const set = setId ? await db.prepare("SELECT id FROM work_group_sets WHERE id=? AND group_id=? AND organization_id=? AND archived=0").bind(setId, section.id, current.organizationId).first() : null;
    if (!set) return reply({ error: "Elige un conjunto de grupos activo de esta sección." }, 400);
  }
  const replaces = typeof body.replaces === "string" ? body.replaces : null;
  const id = `assessment-${crypto.randomUUID()}`;
  const position = ((await db.prepare("SELECT COALESCE(MAX(position),-1) AS position FROM assessment_activities WHERE course_id=? AND period_id=? AND (group_id IS NULL OR group_id=?)").bind(section.courseId, period.id, section.id).first<{ position: number }>())?.position ?? -1) + 1;
  const now = new Date().toISOString();
  await db.prepare(`INSERT INTO assessment_activities(position,title,kind,points,due_on,category_id,grading,extra,retake_of,rubric,panel,group_mode,peer_min,peer_max,updated_at,id,organization_id,course_id,period_id,created_by,created_at,group_id,is_core)
    VALUES (?,?,?,?,?,?,'points',0,NULL,NULL,NULL,?,?,?,?,?,?,?,?,?,?,?,0)`).bind(position, title, body.kind, points, null, categoryId, groupMode, 0.5, 1.5, now, id, current.organizationId, section.courseId, period.id, current.id, now, section.id).run();
  if (groupMode === "group") await db.prepare("INSERT INTO section_activity_sets(group_id,activity_id,kind,set_id) VALUES (?,?,'assessment',?)").bind(section.id, id, setId).run();
  if (replaces) {
    const saved = await saveOverride(db, current, section, policy, "PUT", { itemType: "activity", itemId: id, position: null, hidden: false, replaces });
    if (!saved.ok) {
      await db.batch([db.prepare("DELETE FROM section_activity_sets WHERE activity_id=?").bind(id), db.prepare("DELETE FROM assessment_activities WHERE id=?").bind(id)]);
      return saved;
    }
  }
  await recordEvent(db, current, { action: "created", targetType: "course", targetId: section.courseId, courseId: section.courseId, groupId: section.id, summary: `Agregó la actividad propia «${title}» en «${section.name}»` });
  return reply({ id }, 201);
}

async function saveOverride(db: Database, current: Member, section: SectionRow, policy: FreedomPolicy, method: string, input: unknown) {
  const body = input && typeof input === "object" ? input as Record<string, unknown> : null;
  const itemType = body?.itemType === "lesson" || body?.itemType === "activity" ? body.itemType : null;
  const itemId = typeof body?.itemId === "string" ? body.itemId : "";
  if (!itemType || !itemId) return reply({ error: "Elige la lección o la actividad." }, 400);
  if (method === "DELETE") {
    await db.prepare("DELETE FROM section_content_overrides WHERE group_id=? AND item_type=? AND item_id=?").bind(section.id, itemType, itemId).run();
    await recordEvent(db, current, { action: "updated", targetType: "group", targetId: section.id, courseId: section.courseId, groupId: section.id, summary: `Quitó un ajuste del plan de «${section.name}»` });
    return reply({ ok: true });
  }
  const hidden = body?.hidden === true;
  const position = body?.position === null || body?.position === undefined ? null : Number.isInteger(body?.position) && Number(body?.position) >= 0 ? Number(body.position) : undefined;
  if (position === undefined) return reply({ error: "La posición tiene que ser un número desde cero, o vacía." }, 400);
  const replaces = body?.replaces === null || body?.replaces === undefined || body?.replaces === "" ? null : typeof body?.replaces === "string" ? body.replaces : undefined;
  if (replaces === undefined) return reply({ error: "El reemplazo tiene que señalar una actividad del núcleo." }, 400);
  const next: FreedomOverride = { itemType, itemId, position, hidden, replaces };
  const loaded = await loadSection(db, current.organizationId, section.courseId, section.id);
  if (!("plan" in loaded)) return reply({ error: "Esta sección sigue el contenido del curso." }, 404);
  const rows = await db.batch([
    db.prepare(`SELECT l.id,l.course_unit_id AS unitId,l.position,l.is_core AS core,l.group_id AS groupId,json_extract(l.content,'$.title') AS title,json_extract(l.content,'$.outcomeIds') AS outcomes
      FROM lessons l JOIN learning_units u ON u.id=l.course_unit_id WHERE u.course_id=? AND l.archived=0 AND (l.group_id IS NULL OR l.group_id=?)`).bind(section.courseId, section.id),
    db.prepare("SELECT id,period_id AS periodId,category_id AS categoryId,points,position,is_core AS core,group_id AS groupId,title FROM assessment_activities WHERE course_id=? AND organization_id=? AND (group_id IS NULL OR group_id=?)").bind(section.courseId, current.organizationId, section.id),
    db.prepare("SELECT item_type AS itemType,item_id AS itemId,position,hidden,replaces FROM section_content_overrides WHERE group_id=? AND NOT (item_type=? AND item_id=?)").bind(section.id, itemType, itemId),
  ]) as unknown as [
    { id: string; unitId: string; position: number; core: number; groupId: string | null; title: string | null; outcomes: string | null }[],
    { id: string; periodId: string; categoryId: string; points: number; position: number; core: number; groupId: string | null; title: string }[],
    { itemType: FreedomOverride["itemType"]; itemId: string; position: number | null; hidden: number; replaces: string | null }[],
  ];
  const lessonOf = (row: (typeof rows)[0][number]) => ({ id: row.id, unitId: row.unitId, position: row.position, core: row.core === 1, groupId: row.groupId, title: row.title || "Lección", outcomeIds: [] as string[] });
  const activityOf = (row: (typeof rows)[1][number]) => ({ ...row, core: row.core === 1 });
  const checked = sectionContent({
    policy,
    lessons: rows[0].filter(row => row.groupId === null).map(lessonOf),
    sectionLessons: rows[0].filter(row => row.groupId === section.id).map(lessonOf),
    activities: rows[1].filter(row => row.groupId === null).map(activityOf),
    sectionActivities: rows[1].filter(row => row.groupId === section.id).map(activityOf),
    overrides: [...rows[2].map(row => ({ itemType: row.itemType, itemId: row.itemId, position: row.position, hidden: row.hidden === 1, replaces: row.replaces })), next],
  });
  if (!checked.ok) return reply({ error: checked.errors[0], errors: checked.errors }, 409);
  if (hidden && itemType === "lesson" && await db.prepare("SELECT 1 AS ok FROM class_session_lessons p JOIN class_sessions s ON s.id=p.session_id WHERE p.lesson_id=? AND s.group_id=? AND s.status='completed'").bind(itemId, section.id).first())
    return reply({ error: "No se oculta una lección ya impartida en esta sección." }, 409);
  if (hidden && itemType === "activity" && await db.prepare("SELECT 1 AS ok FROM assessment_scores WHERE activity_id=? AND group_id=?").bind(itemId, section.id).first())
    return reply({ error: "No se oculta una actividad que ya tiene notas en esta sección." }, 409);
  const now = new Date().toISOString();
  try {
    await db.prepare("INSERT OR REPLACE INTO section_content_overrides(group_id,item_type,item_id,position,hidden,replaces,updated_by,updated_at) VALUES (?,?,?,?,?,?,?,?)")
      .bind(section.id, itemType, itemId, position, hidden ? 1 : 0, replaces, current.id, now).run();
  } catch (error) {
    const message = error instanceof Error ? error.message : "No se pudo guardar el ajuste.";
    return reply({ error: message }, 409);
  }
  await recordEvent(db, current, { action: "updated", targetType: "group", targetId: section.id, courseId: section.courseId, groupId: section.id, summary: hidden ? `Ocultó un elemento del plan de «${section.name}»` : replaces ? `Reemplazó una actividad del núcleo en «${section.name}»` : `Reordenó el plan de «${section.name}»` });
  return reply({ ok: true });
}

async function markCore(db: Database, current: Member, courseId: string, access: CourseAccess, input: unknown) {
  if (!access.publish) return forbidden("Solo la persona responsable del curso marca el núcleo.");
  const policy = await freedomPolicyOf(db, current.organizationId, courseId);
  if (policy === "shared") return reply({ error: "Con «Igual en todas las secciones» todo el curso es el núcleo. Cambia la libertad de cátedra para marcar lo que cada sección puede omitir." }, 409);
  const body = input && typeof input === "object" ? input as Record<string, unknown> : null;
  const flags = (value: unknown) => Array.isArray(value) ? value.flatMap(item => {
    if (!item || typeof item !== "object") return [];
    const row = item as Record<string, unknown>;
    return typeof row.id === "string" && typeof row.core === "boolean" ? [{ id: row.id, core: row.core }] : [];
  }) : [];
  const lessons = flags(body?.lessons);
  const activities = flags(body?.activities);
  const units = flags(body?.units);
  if (!lessons.length && !activities.length && !units.length) return reply({ error: "Elige lecciones, unidades o actividades del curso." }, 400);
  const unitLessons = units.length ? (await db.prepare(`SELECT id,course_unit_id AS unitId FROM lessons WHERE group_id IS NULL AND course_unit_id IN (${units.map(() => "?").join(",")})`).bind(...units.map(unit => unit.id)).all<{ id: string; unitId: string }>()).results : [];
  for (const unit of units) lessons.push(...unitLessons.filter(lesson => lesson.unitId === unit.id).map(lesson => ({ id: lesson.id, core: unit.core })));
  const courseLessons = new Set((await db.prepare("SELECT l.id FROM lessons l JOIN learning_units u ON u.id=l.course_unit_id WHERE u.course_id=? AND l.group_id IS NULL").bind(courseId).all<{ id: string }>()).results.map(row => row.id));
  const courseActivities = new Set((await db.prepare("SELECT id FROM assessment_activities WHERE course_id=? AND organization_id=? AND group_id IS NULL").bind(courseId, current.organizationId).all<{ id: string }>()).results.map(row => row.id));
  if (lessons.some(item => !courseLessons.has(item.id)) || activities.some(item => !courseActivities.has(item.id))) return reply({ error: "Solo el contenido del curso entra en el núcleo." }, 400);
  let shownAgain = 0;
  const now = new Date().toISOString();
  const writes = [];
  for (const item of lessons) {
    if (item.core) {
      const hidden = await db.prepare("SELECT COUNT(DISTINCT group_id) AS total FROM section_content_overrides WHERE item_type='lesson' AND item_id=? AND hidden=1").bind(item.id).first<{ total: number }>();
      shownAgain += hidden?.total || 0;
      writes.push(db.prepare("DELETE FROM section_content_overrides WHERE item_type='lesson' AND item_id=? AND hidden=1").bind(item.id));
    }
    writes.push(db.prepare("UPDATE lessons SET is_core=?,updated_at=? WHERE id=? AND group_id IS NULL").bind(item.core ? 1 : 0, now, item.id));
  }
  for (const item of activities) {
    if (item.core) {
      const hidden = await db.prepare("SELECT COUNT(DISTINCT group_id) AS total FROM section_content_overrides WHERE item_type='activity' AND item_id=? AND hidden=1").bind(item.id).first<{ total: number }>();
      shownAgain += hidden?.total || 0;
      writes.push(db.prepare("DELETE FROM section_content_overrides WHERE item_type='activity' AND item_id=? AND hidden=1").bind(item.id));
    }
    writes.push(db.prepare("UPDATE assessment_activities SET is_core=?,updated_at=? WHERE id=? AND organization_id=? AND group_id IS NULL").bind(item.core ? 1 : 0, now, item.id, current.organizationId));
  }
  await db.batch(writes);
  await recordEvent(db, current, { action: "updated", targetType: "course", targetId: courseId, courseId, summary: shownAgain ? `Marcó el núcleo: volverá a mostrarse en ${shownAgain} ${shownAgain === 1 ? "sección" : "secciones"}` : "Actualizó el núcleo del curso" });
  return reply({ shownAgain, message: shownAgain ? `Volverá a mostrarse en ${shownAgain} ${shownAgain === 1 ? "sección que la ocultó" : "secciones que la ocultaron"}.` : "El núcleo quedó actualizado." });
}

async function differences(db: Database, current: Member, courseId: string, access: CourseAccess) {
  if (current.role !== "admin" && !access.publish && !access.review && access.sections !== "all") return forbidden("Las diferencias las ven la persona responsable del curso, coordinación y administración.");
  const policy = await freedomPolicyOf(db, current.organizationId, courseId);
  if (policy === "shared") return reply({ error: "Con «Igual en todas las secciones» no hay diferencias que mostrar." }, 404);
  return reply({ policy, policyLabel: policyLabel(policy), sections: await courseDifferences(db, current.organizationId, courseId) });
}

export { effectiveActivityIds };
