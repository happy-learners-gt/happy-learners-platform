import type { AssessmentKind, CourseAccess, GradingActivity, GradingScheme, Member, Rubric } from "@happy-learners/contracts";
import { assessmentPeriodStatus, assessmentTemplates, isAssessmentKind, maxAssessmentActivities, planTotal, pointsInput, resolveSettings, rubricInput, schemeExplanation, schemeFromSettings } from "@happy-learners/domain";
import type { Database } from "./storage";
import { accessTo, forbidden, outsider } from "./access";
import { configurationOf, gradingSchemeError } from "./courses";
import { freedomPolicyOf } from "./freedom-plan";
import { event } from "./activity";

/**
 * The course's evaluation (lote 3c). One activity at a time, shared by every section.
 * GET  /api/courses/:id/assessment?year=
 * PUT  …/assessment/scheme { gradingSchemeId }
 * POST|PUT|DELETE …/assessment/activities[/:activityId]
 * POST …/assessment/periods/:periodId/template { templateId? }
 * POST …/assessment/periods/:periodId/copy-from/:sourceId
 * Who can edit: administration and the course team (lead or co-teacher). Who can read: whoever can see the course.
 * The section chooses the set on its Grupos page; this API does not store one.
 */
const reply = (value: unknown, status = 200) => Response.json(value, { status });
const rootPath = /^\/api\/courses\/([a-z0-9-]+)\/assessment$/;
const schemePath = /^\/api\/courses\/([a-z0-9-]+)\/assessment\/scheme$/;
const activityPath = /^\/api\/courses\/([a-z0-9-]+)\/assessment\/activities(?:\/(assessment-[a-f0-9-]{36}))?$/;
const templatePath = /^\/api\/courses\/([a-z0-9-]+)\/assessment\/periods\/([a-z0-9-]+)\/template$/;
const copyPath = /^\/api\/courses\/([a-z0-9-]+)\/assessment\/periods\/([a-z0-9-]+)\/copy-from\/([a-z0-9-]+)$/;
const gradedNote = (title: string) => `«${title}» ya tiene notas: puedes cambiar su nombre y su fecha, no su forma de calificar ni sus puntos por debajo de una nota dada.`;

/** Methods the router allows before the handler runs. POST and PUT bodies travel with the other course routes. */
export function assessmentMethods(path: string): string[] | null {
  if (rootPath.test(path)) return ["GET"];
  if (schemePath.test(path)) return ["PUT"];
  if (templatePath.test(path) || copyPath.test(path)) return ["POST"];
  const activity = activityPath.exec(path);
  if (!activity) return null;
  return activity[2] ? ["PUT", "DELETE"] : ["POST"];
}
const canWrite = (current: Member, access: CourseAccess) => current.role === "admin" || access.edit;

type CourseRow = { id: string; title: string; status: "active" | "archived" };
type PeriodRow = { id: string; name: string; position: number; weight: number };
type Stored = {
  id: string; periodId: string; position: number; title: string; kind: AssessmentKind; points: number; dueOn: string | null;
  categoryId: string; grading: GradingActivity["grading"]; extra: number; retakeOf: string | null;
  rubric: string | null; panel: string | null; groupMode: "individual" | "group"; peerMin: number; peerMax: number;
};
type Draft = {
  title: string; kind: AssessmentKind; points: number; dueOn: string | null; categoryId: string;
  grading: GradingActivity["grading"]; extra: boolean; retakeOf: string | null;
  rubric: Rubric | null; panel: GradingActivity["panel"] | null;
  groupMode: "individual" | "group"; peerMin: number; peerMax: number;
  evaluators: { userId: string; chair: boolean }[] | null;
};

export async function courseAssessment(path: string, method: string, input: unknown, url: URL, current: Member, db: Database): Promise<Response> {
  const courseId = (rootPath.exec(path) || schemePath.exec(path) || activityPath.exec(path) || templatePath.exec(path) || copyPath.exec(path))?.[1];
  if (!courseId) return reply({ error: "Ruta no disponible." }, 404);
  const opened = await openCourse(db, current, courseId);
  if (opened instanceof Response) return opened;
  const { course, access } = opened;
  if (method === "GET" && rootPath.test(path)) return view(db, current, course, canWrite(current, access), url.searchParams.get("year"));
  if (!canWrite(current, access)) return forbidden("Solo administración y el equipo docente con permiso de edición cambian la evaluación del curso.");
  if (course.status !== "active") return reply({ error: "Restaura el curso antes de modificarlo. Sus enlaces publicados se conservan." }, 409);
  if (method === "PUT" && schemePath.test(path)) return saveScheme(db, current, course, input);
  const activity = activityPath.exec(path);
  if (activity && !activity[2] && method === "POST") return saveActivity(db, current, course, null, input);
  if (activity?.[2] && method === "PUT") return saveActivity(db, current, course, activity[2], input);
  if (activity?.[2] && method === "DELETE") return removeActivity(db, current, course, activity[2]);
  const template = templatePath.exec(path);
  if (template && method === "POST") return applyTemplate(db, current, course, template[2], input);
  const copy = copyPath.exec(path);
  if (copy && method === "POST") return copyPeriod(db, current, course, copy[2], copy[3]);
  return reply({ error: "Ruta no disponible." }, 404);
}

async function openCourse(db: Database, current: Member, courseId: string): Promise<{ course: CourseRow; access: CourseAccess } | Response> {
  const course = await db.prepare("SELECT id,title,status FROM courses WHERE id=? AND organization_id=?").bind(courseId, current.organizationId).first<CourseRow>();
  if (!course) return reply({ error: "El elemento no está disponible en tu organización." }, 404);
  const access = await accessTo(db, current, courseId);
  if (!access) return outsider();
  return { course, access };
}

async function schemeOf(db: Database, organizationId: string, courseId: string): Promise<GradingScheme> {
  const configured = await configurationOf(db, organizationId, courseId);
  const settings = configured!.settings;
  const selected = settings.gradingSchemeId ? (await db.prepare("SELECT id,name,config,status FROM grading_schemes WHERE id=? AND organization_id=?").bind(settings.gradingSchemeId, organizationId).first<{ id: string; name: string; config: string; status: string }>()) : null;
  if (!selected || selected.status !== "active") return schemeFromSettings(settings);
  const parsed = JSON.parse(selected.config) as GradingScheme;
  return { ...parsed, id: selected.id, name: selected.name };
}

async function yearsOf(db: Database, organizationId: string, courseId: string) {
  return (await db.prepare(`SELECT y.id,y.name,y.status FROM academic_years y JOIN courses c ON c.id=? AND c.organization_id=y.organization_id
    WHERE y.organization_id=? AND y.status IN ('current','closed') AND (y.program_id IS NULL OR y.program_id=c.program_id)
    ORDER BY CASE WHEN y.status='current' THEN 0 ELSE 1 END,CASE WHEN y.program_id IS NULL THEN 1 ELSE 0 END,y.starts_on DESC`).bind(courseId, organizationId).all<{ id: string; name: string; status: string }>()).results;
}

function periodStatus(scheme: GradingScheme, activities: { categoryId: string; points: number; extra: boolean; retakeOf: string | null }[]) {
  const counted = activities.filter(item => !item.extra && !item.retakeOf);
  const status = assessmentPeriodStatus(scheme, activities);
  const points = scheme.method === "points" || scheme.method === "weighted-categories" ? planTotal(counted) : counted.length;
  return { state: status.state, label: status.tab, line: status.line, points, maximum: scheme.method === "points" ? 100 : null };
}

async function view(db: Database, current: Member, course: CourseRow, editable: boolean, yearId: string | null) {
  const scheme = await schemeOf(db, current.organizationId, course.id);
  const years = await yearsOf(db, current.organizationId, course.id);
  const year = years.find(item => item.id === yearId) || years.find(item => item.status === "current") || years[0] || null;
  const periods = year ? (await db.prepare("SELECT id,name,position,weight FROM academic_periods WHERE year_id=? AND organization_id=? ORDER BY starts_on,position").bind(year.id, current.organizationId).all<PeriodRow>()).results : [];
  const adapt = (await freedomPolicyOf(db, current.organizationId, course.id)) !== "shared";
  const activities = periods.length ? (await db.prepare(`SELECT a.id,a.period_id AS periodId,a.position,a.title,a.kind,a.points,a.due_on AS dueOn,a.category_id AS categoryId,a.grading,a.extra,a.retake_of AS retakeOf,a.rubric,a.panel,a.group_mode AS groupMode,a.peer_min AS peerMin,a.peer_max AS peerMax,
    (SELECT MAX(points) FROM assessment_scores WHERE activity_id=a.id) AS maxScore,
    (EXISTS(SELECT 1 FROM assessment_scores WHERE activity_id=a.id) OR EXISTS(SELECT 1 FROM assessment_marks WHERE activity_id=a.id) OR EXISTS(SELECT 1 FROM assessment_group_marks WHERE activity_id=a.id)) AS graded,
    a.is_core AS isCore
    FROM assessment_activities a WHERE a.course_id=? AND a.organization_id=? AND a.group_id IS NULL AND a.period_id IN (${periods.map(() => "?").join(",")}) ORDER BY a.position,a.id`)
    .bind(course.id, current.organizationId, ...periods.map(period => period.id)).all<Stored & { maxScore: number | null; graded: number; isCore: number }>()).results : [];
  const evaluators = activities.length ? (await db.prepare(`SELECT e.activity_id AS activityId,e.user_id AS userId,COALESCE(u.display_name,u.username) AS name,e.chair
    FROM assessment_evaluators e JOIN users u ON u.id=e.user_id WHERE e.activity_id IN (${activities.map(() => "?").join(",")}) ORDER BY e.chair DESC,name`).bind(...activities.map(item => item.id)).all<{ activityId: string; userId: string; name: string; chair: number }>()).results : [];
  const team = (await db.prepare("SELECT u.id,COALESCE(u.display_name,u.username) AS name FROM course_members m JOIN users u ON u.id=m.user_id WHERE m.course_id=? AND m.organization_id=? ORDER BY name").bind(course.id, current.organizationId).all<{ id: string; name: string }>()).results;
  return reply({
    scheme, explanation: schemeExplanation(scheme), canEdit: editable && course.status === "active", year, years: years.map(({ id, name, status }) => ({ id, name, status })), team,
    periods: periods.map(period => {
      const own = activities.filter(item => item.periodId === period.id);
      return {
        ...period,
        status: periodStatus(scheme, own.map(item => ({ categoryId: item.categoryId, points: item.points, extra: !!item.extra, retakeOf: item.retakeOf }))),
        activities: own.map(item => ({
          id: item.id, periodId: item.periodId, position: item.position, title: item.title, kind: item.kind, points: item.points, dueOn: item.dueOn,
          categoryId: item.categoryId, grading: item.grading, extra: !!item.extra, retakeOf: item.retakeOf,
          ...(item.rubric ? { rubric: JSON.parse(item.rubric) as Rubric } : {}),
          ...(item.panel ? { panel: JSON.parse(item.panel) as GradingActivity["panel"] } : {}),
          groupMode: item.groupMode, peerMin: item.peerMin, peerMax: item.peerMax,
          graded: !!item.graded, maxScore: item.maxScore, ...(adapt ? { isCore: item.isCore !== 0 } : {}),
          evaluators: evaluators.filter(person => person.activityId === item.id).map(person => ({ userId: person.userId, name: person.name, chair: !!person.chair })),
        })),
      };
    }),
  });
}

async function saveScheme(db: Database, current: Member, course: CourseRow, input: unknown) {
  const body = input && typeof input === "object" ? input as Record<string, unknown> : null;
  if (!body || !("gradingSchemeId" in body)) return reply({ error: "Elige un esquema de evaluación." }, 400);
  const schemeId = body.gradingSchemeId === null || body.gradingSchemeId === "" ? null : body.gradingSchemeId;
  if (schemeId !== null && (typeof schemeId !== "string" || !/^scheme-[a-f0-9-]{36}$/.test(schemeId))) return reply({ error: "Elige un esquema de evaluación activo de tu organización." }, 400);
  const configured = await configurationOf(db, current.organizationId, course.id);
  if (resolveSettings(configured!.course, configured!.program).source.gradingSchemeId === "program-locked") return reply({ error: "El programa fija el esquema de evaluación de este curso." }, 409);
  const invalid = await gradingSchemeError(db, current.organizationId, schemeId);
  if (invalid) return invalid;
  const row = await db.prepare("SELECT settings,version FROM courses WHERE id=? AND organization_id=?").bind(course.id, current.organizationId).first<{ settings: string; version: number }>();
  const settings = JSON.parse(row?.settings || "{}") as Record<string, unknown>;
  if (schemeId) settings.gradingSchemeId = schemeId; else delete settings.gradingSchemeId;
  const now = new Date().toISOString();
  await db.batch([
    db.prepare("UPDATE courses SET settings=?,updated_at=?,version=version+1 WHERE id=? AND organization_id=?").bind(JSON.stringify(settings), now, course.id, current.organizationId),
    event(db, current, { action: "updated", targetType: "course", targetId: course.id, courseId: course.id, summary: `Cambió el esquema de evaluación de «${course.title}»` }),
  ]);
  return view(db, current, course, true, null);
}

async function blockedPeriod(db: Database, current: Member, courseId: string, periodId: string) {
  const period = await db.prepare(`SELECT p.id,p.name,y.status AS yearStatus FROM academic_periods p JOIN academic_years y ON y.id=p.year_id
    WHERE p.id=? AND p.organization_id=? AND (y.program_id IS NULL OR y.program_id=(SELECT program_id FROM courses WHERE id=?))`).bind(periodId, current.organizationId, courseId).first<{ id: string; name: string; yearStatus: string }>();
  if (!period || period.yearStatus === "closed") return { error: reply({ error: period ? `«${period.name}» pertenece a un ciclo cerrado.` : "Ese periodo no está en el ciclo del curso." }, 409) };
  const blocked = await db.prepare(`SELECT g.name FROM course_groups g WHERE g.course_id=? AND g.organization_id=? AND (EXISTS (SELECT 1 FROM section_period_locks l WHERE l.group_id=g.id AND l.period_id=?)
    OR EXISTS (SELECT 1 FROM section_period_reviews r WHERE r.group_id=g.id AND r.period_id=? AND r.status='submitted')) ORDER BY g.name LIMIT 1`).bind(courseId, current.organizationId, periodId, periodId).first<{ name: string }>();
  if (blocked) return { error: reply({ error: `«${period.name}» está cerrado o entregado en «${blocked.name}»: su plan de evaluación ya no cambia.` }, 409) };
  return { period };
}

function activityInput(input: unknown, titleFallback?: string): Draft | string {
  const item = input && typeof input === "object" ? input as Record<string, unknown> : null;
  if (!item) return "Revisa la actividad.";
  const title = typeof item.title === "string" ? item.title.trim() : titleFallback || "";
  if (!title || title.length > 120) return "Cada actividad necesita un nombre de hasta 120 caracteres.";
  if (!isAssessmentKind(item.kind)) return `Elige el tipo de «${title}».`;
  const points = pointsInput(item.points, 100);
  if (points === undefined || points === null || points === 0) return `Los puntos de «${title}» van de 0,1 a 100, con un decimal como máximo.`;
  const dueOn = item.dueOn === null || item.dueOn === undefined || item.dueOn === "" ? null : typeof item.dueOn === "string" && /^\d{4}-\d{2}-\d{2}$/.test(item.dueOn) ? item.dueOn : undefined;
  if (dueOn === undefined) return `Revisa la fecha de «${title}».`;
  const categoryId = typeof item.categoryId === "string" && /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,79}$/.test(item.categoryId) ? item.categoryId : "";
  const grading = ["points", "rubric", "pass-fail", "level", "panel"].includes(String(item.grading)) ? item.grading as Draft["grading"] : null;
  if (!categoryId || !grading || (item.extra !== undefined && typeof item.extra !== "boolean")) return `Revisa la forma de evaluar «${title}».`;
  const retakeOf = item.retakeOf === undefined || item.retakeOf === null || item.retakeOf === "" ? null : typeof item.retakeOf === "string" && /^assessment-[a-f0-9-]{36}$/.test(item.retakeOf) ? item.retakeOf : undefined;
  if (retakeOf === undefined) return `Revisa la reposición de «${title}».`;
  let rubric: Rubric | null = null;
  if (grading === "rubric" || (grading === "panel" && item.rubric !== undefined && item.rubric !== null)) {
    const checked = rubricInput(item.rubric);
    if ("error" in checked) return checked.error;
    rubric = checked;
  } else if (item.rubric !== undefined && item.rubric !== null) return `«${title}» no usa una rúbrica.`;
  if (grading === "rubric" && !rubric) return `Agrega la rúbrica de «${title}».`;
  let panel: Draft["panel"] = null;
  if (grading === "panel") {
    const raw = item.panel && typeof item.panel === "object" ? item.panel as Record<string, unknown> : {};
    if (!["average", "median", "majority", "chair"].includes(String(raw.combine))) return `Elige cómo combina sus marcas el tribunal de «${title}».`;
    panel = { combine: raw.combine as NonNullable<Draft["panel"]>["combine"] };
  } else if (item.panel !== undefined && item.panel !== null) return `«${title}» no usa un tribunal.`;
  const groupMode = item.groupMode === undefined ? "individual" : item.groupMode === "individual" || item.groupMode === "group" ? item.groupMode : null;
  if (!groupMode) return `Elige si «${title}» la hace cada estudiante o un grupo.`;
  let peerMin = 0.5, peerMax = 1.5;
  if (groupMode === "group" && (item.peerMin !== undefined || item.peerMax !== undefined)) {
    const minimum = item.peerMin === undefined ? 0.5 : pointsInput(item.peerMin, 2);
    const maximum = item.peerMax === undefined ? 1.5 : pointsInput(item.peerMax, 2);
    if (typeof minimum !== "number" || typeof maximum !== "number") return `El rango del factor de «${title}» va de 0 a 2, con un decimal.`;
    if (minimum > maximum) return `El factor mínimo de «${title}» no puede ser mayor que el máximo.`;
    peerMin = minimum; peerMax = maximum;
  }
  let evaluators: Draft["evaluators"] = null;
  if (item.evaluators !== undefined) {
    if (grading !== "panel" || !Array.isArray(item.evaluators)) return `Revisa los integrantes del tribunal de «${title}».`;
    evaluators = [];
    for (const row of item.evaluators) {
      if (!row || typeof row !== "object") return `Revisa los integrantes del tribunal de «${title}».`;
      const person = row as Record<string, unknown>;
      if (typeof person.userId !== "string" || (person.chair !== undefined && typeof person.chair !== "boolean")) return `Revisa los integrantes del tribunal de «${title}».`;
      evaluators.push({ userId: person.userId, chair: person.chair === true });
    }
    if (!evaluators.length || evaluators.length > 20 || new Set(evaluators.map(person => person.userId)).size !== evaluators.length || evaluators.filter(person => person.chair).length !== 1) return "El tribunal necesita integrantes distintos y una sola presidencia.";
  }
  return { title, kind: item.kind, points, dueOn, categoryId, grading, extra: item.extra === true, retakeOf, rubric, panel, groupMode, peerMin, peerMax, evaluators };
}

async function gradeFacts(db: Database, activityId: string) {
  const row = await db.prepare(`SELECT (SELECT MAX(points) FROM assessment_scores WHERE activity_id=?) AS maxScore,
    (EXISTS(SELECT 1 FROM assessment_scores WHERE activity_id=?) OR EXISTS(SELECT 1 FROM assessment_marks WHERE activity_id=?) OR EXISTS(SELECT 1 FROM assessment_group_marks WHERE activity_id=?)) AS graded,
    EXISTS(SELECT 1 FROM assessment_scores WHERE activity_id=?) AS scored`).bind(activityId, activityId, activityId, activityId, activityId).first<{ maxScore: number | null; graded: number; scored: number }>();
  return { graded: !!row?.graded, maxScore: row?.maxScore ?? null, scored: !!row?.scored };
}

function sameJson(left: unknown, right: unknown) { return JSON.stringify(left ?? null) === JSON.stringify(right ?? null); }

async function saveActivity(db: Database, current: Member, course: CourseRow, activityId: string | null, input: unknown) {
  const body = input && typeof input === "object" ? input as Record<string, unknown> : null;
  const periodId = typeof body?.periodId === "string" ? body.periodId : "";
  const draft = activityInput(input);
  if (typeof draft === "string") return reply({ error: draft }, 400);
  const scheme = await schemeOf(db, current.organizationId, course.id);
  if (!scheme.categories.some(category => category.id === draft.categoryId)) return reply({ error: "Una actividad usa una categoría que no existe en el esquema efectivo." }, 400);
  const stored = activityId ? await db.prepare("SELECT id,period_id AS periodId,position,title,kind,points,due_on AS dueOn,category_id AS categoryId,grading,extra,retake_of AS retakeOf,rubric,panel,group_mode AS groupMode,peer_min AS peerMin,peer_max AS peerMax FROM assessment_activities WHERE id=? AND course_id=? AND organization_id=? AND group_id IS NULL").bind(activityId, course.id, current.organizationId).first<Stored>() : null;
  if (activityId && !stored) return reply({ error: "La actividad ya no está en este curso." }, 404);
  const period = await blockedPeriod(db, current, course.id, stored?.periodId || periodId);
  if ("error" in period && period.error) return period.error;
  if (stored && periodId && periodId !== stored.periodId) return reply({ error: "La actividad se queda en su periodo." }, 400);
  const facts = stored ? await gradeFacts(db, stored.id) : { graded: false, maxScore: null, scored: false };
  if (facts.graded && stored) {
    const rubric = stored.rubric ? JSON.parse(stored.rubric) as Rubric : null;
    const panel = stored.panel ? JSON.parse(stored.panel) as GradingActivity["panel"] : null;
    const structural = stored.kind !== draft.kind || stored.categoryId !== draft.categoryId || stored.grading !== draft.grading || !!stored.extra !== draft.extra
      || (stored.retakeOf || null) !== draft.retakeOf || stored.groupMode !== draft.groupMode || stored.peerMin !== draft.peerMin || stored.peerMax !== draft.peerMax
      || !sameJson(rubric, draft.rubric) || !sameJson(panel, draft.panel);
    if (structural || draft.evaluators) return reply({ error: gradedNote(stored.title) }, 409);
    if (facts.maxScore !== null && draft.points < facts.maxScore) return reply({ error: `«${stored.title}» ya tiene un punteo de ${facts.maxScore}: sus puntos no pueden ser menos.` }, 409);
  }
  const siblings = (await db.prepare("SELECT id,title,points,extra,retake_of AS retakeOf,category_id AS categoryId FROM assessment_activities WHERE course_id=? AND period_id=? AND organization_id=? AND group_id IS NULL AND id IS NOT ?").bind(course.id, period.period.id, current.organizationId, activityId || "").all<{ id: string; title: string; points: number; extra: number; retakeOf: string | null; categoryId: string }>()).results;
  if (!stored && !siblings.length) {
    const manual = await db.prepare("SELECT 1 AS found FROM section_grades s JOIN course_groups g ON g.id=s.group_id WHERE g.course_id=? AND s.period_id=? AND s.organization_id=? LIMIT 1").bind(course.id, period.period.id, current.organizationId).first();
    if (manual) return reply({ error: `«${period.period.name}» ya tiene notas registradas sin plan en alguna sección del curso. Bórralas para calcular el periodo con un plan de evaluación.` }, 409);
  }
  if (draft.retakeOf && (draft.retakeOf === activityId || !siblings.some(item => item.id === draft.retakeOf))) return reply({ error: `La reposición «${draft.title}» debe señalar otra actividad de este plan.` }, 400);
  if (scheme.method === "points") {
    const total = planTotal([...siblings.filter(item => !item.extra && !item.retakeOf), ...(!draft.extra && !draft.retakeOf ? [{ points: draft.points }] : [])]);
    if (total > 100) return reply({ error: `El plan suma ${total} puntos: no puede pasar de 100.` }, 400);
  }
  if (draft.evaluators) {
    const members = (await db.prepare(`SELECT user_id AS userId FROM memberships WHERE organization_id=? AND active=1 AND user_id IN (${draft.evaluators.map(() => "?").join(",")})`).bind(current.organizationId, ...draft.evaluators.map(person => person.userId)).all<{ userId: string }>()).results;
    if (members.length !== draft.evaluators.length) return reply({ error: "Una persona del tribunal no pertenece a la organización." }, 400);
    if (stored && await db.prepare("SELECT 1 AS found FROM assessment_marks WHERE activity_id=? LIMIT 1").bind(stored.id).first()) return reply({ error: "El tribunal ya tiene marcas: no puedes cambiar sus integrantes." }, 409);
  }
  const now = new Date().toISOString();
  const id = stored?.id || `assessment-${crypto.randomUUID()}`;
  const position = stored?.position ?? ((await db.prepare("SELECT COALESCE(MAX(position),-1) AS position FROM assessment_activities WHERE course_id=? AND period_id=? AND group_id IS NULL").bind(course.id, period.period.id).first<{ position: number }>())?.position ?? -1) + 1;
  const panel = draft.panel ? { ...draft.panel, ...(draft.evaluators?.find(person => person.chair) ? { chair: draft.evaluators.find(person => person.chair)!.userId } : {}) } : null;
  const values = [position, draft.title, draft.kind, draft.points, draft.dueOn, draft.categoryId, draft.grading, draft.extra ? 1 : 0, draft.retakeOf, draft.rubric ? JSON.stringify(draft.rubric) : null, panel ? JSON.stringify(panel) : null, draft.groupMode, draft.peerMin, draft.peerMax, now];
  await db.batch([
    stored
      ? db.prepare("UPDATE assessment_activities SET position=?,title=?,kind=?,points=?,due_on=?,category_id=?,grading=?,extra=?,retake_of=?,rubric=?,panel=?,group_mode=?,peer_min=?,peer_max=?,updated_at=? WHERE id=? AND organization_id=?").bind(...values, id, current.organizationId)
      : db.prepare("INSERT INTO assessment_activities(position,title,kind,points,due_on,category_id,grading,extra,retake_of,rubric,panel,group_mode,peer_min,peer_max,updated_at,id,organization_id,course_id,period_id,created_by,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)").bind(...values, id, current.organizationId, course.id, period.period.id, current.id, now),
    ...(draft.evaluators ? [
      db.prepare("DELETE FROM assessment_evaluators WHERE activity_id=?").bind(id),
      ...draft.evaluators.map(person => db.prepare("INSERT INTO assessment_evaluators(activity_id,user_id,chair) VALUES (?,?,?)").bind(id, person.userId, person.chair ? 1 : 0)),
    ] : []),
    event(db, current, { action: stored ? "updated" : "created", targetType: "course", targetId: course.id, courseId: course.id, summary: stored ? `Actualizó «${draft.title}» en «${period.period.name}»` : `Agregó «${draft.title}» a «${period.period.name}»` }),
  ]);
  return reply({ id }, stored ? 200 : 201);
}

async function removeActivity(db: Database, current: Member, course: CourseRow, activityId: string) {
  const stored = await db.prepare("SELECT id,title,period_id AS periodId FROM assessment_activities WHERE id=? AND course_id=? AND organization_id=? AND group_id IS NULL").bind(activityId, course.id, current.organizationId).first<{ id: string; title: string; periodId: string }>();
  if (!stored) return reply({ error: "La actividad ya no está en este curso." }, 404);
  const period = await blockedPeriod(db, current, course.id, stored.periodId);
  if ("error" in period && period.error) return period.error;
  const facts = await gradeFacts(db, stored.id);
  if (facts.graded) return reply({ error: `«${stored.title}» ya tiene ${facts.scored ? "punteos" : "marcas"} registrados: no se puede quitar del plan.` }, 409);
  await db.batch([
    db.prepare("DELETE FROM assessment_evaluators WHERE activity_id=?").bind(stored.id),
    db.prepare("DELETE FROM section_activity_sets WHERE activity_id=? AND kind='assessment'").bind(stored.id),
    db.prepare("DELETE FROM assessment_activities WHERE id=? AND organization_id=?").bind(stored.id, current.organizationId),
    event(db, current, { action: "archived", targetType: "course", targetId: course.id, courseId: course.id, summary: `Quitó «${stored.title}» de «${period.period.name}»` }),
  ]);
  return reply({ ok: true });
}

async function replacePeriod(db: Database, current: Member, course: CourseRow, periodId: string, drafts: Draft[]) {
  const period = await blockedPeriod(db, current, course.id, periodId);
  if ("error" in period && period.error) return period.error;
  const existing = (await db.prepare("SELECT id,title FROM assessment_activities WHERE course_id=? AND period_id=? AND organization_id=?").bind(course.id, periodId, current.organizationId).all<{ id: string; title: string }>()).results;
  for (const row of existing) {
    const facts = await gradeFacts(db, row.id);
    if (facts.graded) return reply({ error: gradedNote(row.title) }, 409);
  }
  if (existing.length) return reply({ error: `«${period.period.name}» ya tiene actividades. Quítalas antes de usar una plantilla o de copiar otro periodo.` }, 409);
  const scheme = await schemeOf(db, current.organizationId, course.id);
  if (drafts.some(item => !scheme.categories.some(category => category.id === item.categoryId))) return reply({ error: "Una actividad usa una categoría que no existe en el esquema efectivo." }, 400);
  if (scheme.method === "points" && planTotal(drafts.filter(item => !item.extra && !item.retakeOf)) > 100) return reply({ error: "La plantilla suma más de 100 puntos." }, 400);
  if (drafts.length > maxAssessmentActivities) return reply({ error: `El plan tiene hasta ${maxAssessmentActivities} actividades.` }, 400);
  const now = new Date().toISOString();
  const ids = drafts.map(() => `assessment-${crypto.randomUUID()}`);
  await db.batch([
    ...drafts.map((draft, position) => db.prepare("INSERT INTO assessment_activities(id,organization_id,course_id,period_id,position,title,kind,points,due_on,category_id,grading,extra,retake_of,rubric,panel,group_mode,peer_min,peer_max,created_by,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)")
      .bind(ids[position], current.organizationId, course.id, periodId, position, draft.title, draft.kind, draft.points, draft.dueOn, draft.categoryId, draft.grading, draft.extra ? 1 : 0, draft.retakeOf, draft.rubric ? JSON.stringify(draft.rubric) : null, draft.panel ? JSON.stringify(draft.panel) : null, draft.groupMode, draft.peerMin, draft.peerMax, current.id, now, now)),
    event(db, current, { action: "updated", targetType: "course", targetId: course.id, courseId: course.id, summary: `Preparó las actividades de «${period.period.name}» (${drafts.length === 1 ? "1 actividad" : `${drafts.length} actividades`})` }),
  ]);
  return reply({ ids });
}

async function applyTemplate(db: Database, current: Member, course: CourseRow, periodId: string, input: unknown) {
  const scheme = await schemeOf(db, current.organizationId, course.id);
  const body = input && typeof input === "object" ? input as Record<string, unknown> : {};
  const drafts: Draft[] = [];
  if (scheme.method === "weighted-categories" || scheme.method === "pass-fail" || scheme.method === "levels") {
    for (const category of scheme.categories) drafts.push(starter(category.label, category.weight || 100 / scheme.categories.length, category.id, category.label));
  } else {
    const template = assessmentTemplates.find(item => item.id === (typeof body.templateId === "string" ? body.templateId : "zona-60"));
    if (!template) return reply({ error: "Elige una plantilla del plan." }, 400);
    const exam = scheme.categories.find(category => /examen/i.test(category.label))?.id || scheme.categories.at(-1)!.id;
    const zone = scheme.categories.find(category => category.id !== exam)?.id || scheme.categories[0].id;
    for (const item of template.activities) drafts.push({ ...blank(item.title, item.points, item.kind === "exam" ? exam : zone, item.kind), });
  }
  return replacePeriod(db, current, course, periodId, drafts);
}

async function copyPeriod(db: Database, current: Member, course: CourseRow, periodId: string, sourceId: string) {
  if (periodId === sourceId) return reply({ error: "Elige otro periodo para copiar." }, 400);
  const source = await db.prepare("SELECT id FROM academic_periods WHERE id=? AND organization_id=?").bind(sourceId, current.organizationId).first();
  if (!source) return reply({ error: "Ese periodo no está en el ciclo del curso." }, 404);
  const rows = (await db.prepare("SELECT title,kind,points,category_id AS categoryId,grading,extra,retake_of AS retakeOf,rubric,panel,group_mode AS groupMode,peer_min AS peerMin,peer_max AS peerMax FROM assessment_activities WHERE course_id=? AND period_id=? AND organization_id=? ORDER BY position,id").bind(course.id, sourceId, current.organizationId).all<Omit<Stored, "id" | "periodId" | "position" | "dueOn">>()).results;
  if (!rows.length) return reply({ error: "Ese periodo no tiene actividades." }, 409);
  const drafts: Draft[] = rows.map(row => ({
    title: row.title, kind: row.kind, points: row.points, dueOn: null, categoryId: row.categoryId, grading: row.grading, extra: !!row.extra, retakeOf: null,
    rubric: row.rubric ? JSON.parse(row.rubric) as Rubric : null, panel: row.panel ? JSON.parse(row.panel) as Draft["panel"] : null,
    groupMode: row.groupMode, peerMin: row.peerMin, peerMax: row.peerMax, evaluators: null,
  }));
  return replacePeriod(db, current, course, periodId, drafts);
}

function blank(title: string, points: number, categoryId: string, kind: AssessmentKind): Draft {
  return { title, kind, points, dueOn: null, categoryId, grading: "points", extra: false, retakeOf: null, rubric: null, panel: null, groupMode: "individual", peerMin: 0.5, peerMax: 1.5, evaluators: null };
}
function starter(title: string, points: number, categoryId: string, label: string): Draft {
  const kind: AssessmentKind = /examen/i.test(label) ? "exam" : /proyecto/i.test(label) ? "project" : "task";
  return blank(title, Math.max(0.1, Math.round(points * 10) / 10), categoryId, kind);
}
