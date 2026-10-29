import type { AcademicYear, AssessmentActivity, AssessmentEvaluator, AssessmentKind, AssessmentMark, AssessmentScore, AtomicMark, GradeChange, GradeComment, Gradebook, GradebookPeriod, GradeEntry, GradingActivity, GradingScheme, Mark, Member, PeriodReview } from "@happy-learners/contracts";
import { assessmentKindLabel, csvFile, displayOf, gradeResult, isAssessmentKind, learnerResult, maxAssessmentActivities, maxCommentLength, maxGradeChanges, pdfFile, planTotal, pointsInput, rubricInput, schemeFromSettings, schemeInput, scoreInput } from "@happy-learners/domain";
import type { GradingPolicy, PdfBlock } from "@happy-learners/domain";
import type { Database, Prepared } from "./storage";
import { configurationOf } from "./courses";
import { scopedCourses } from "./permissions";
import { event } from "./team";
import { gradingSchemesFor } from "./grading-schemes";

/**
 * The section's gradebook (libreta) and the course's assessment plan:
 * - GET /api/sections/:id/grades[?year=] reads it; PUT the same path saves, in one go, period scores
 *   ({ grades: [{ learnerId, periodId, score|null }] }) for periods without a plan, activity points
 *   ({ scores: [{ activityId, learnerId, points|null }] }) and comments ({ comments: [{ learnerId, periodId, body }] }).
 * - PUT /api/sections/:id/grades/periods/:periodId/plan { activities } replaces the course's plan for that period.
 * - POST …/periods/:periodId/submit hands the period in; POST …/return { note } returns it; POST …/lock approves and
 *   closes it; DELETE …/lock reopens it.
 * - GET /api/sections/:id/grades/history?learner= lists a student's score changes; GET …/grades/report.pdf[?year=&learner=]
 *   is the report card (boleta) of the section or of one student.
 * Whoever sees the section reads it. Administration and the section's educators write the open periods of the current
 * year and hand them in; administration and coordination approve (close) or return them; only administration reopens.
 */
const reply = (value: unknown, status = 200) => Response.json(value, { status });
const gradesPath = /^\/api\/sections\/([a-z0-9-]+)\/grades$/;
const historyPath = /^\/api\/sections\/([a-z0-9-]+)\/grades\/history$/;
const reportPath = /^\/api\/sections\/([a-z0-9-]+)\/grades\/report\.pdf$/;
const csvPath = /^\/api\/sections\/([a-z0-9-]+)\/grades\/report\.csv$/;
const periodPath = /^\/api\/sections\/([a-z0-9-]+)\/grades\/periods\/(period-[a-f0-9-]{36})\/(lock|submit|return|plan)$/;
const panelPath = /^\/api\/sections\/([a-z0-9-]+)\/grades\/activities\/(assessment-[a-f0-9-]{36})\/(panel|evaluators)$/;

export function gradebookMethods(path: string): string[] | null {
  if (gradesPath.test(path)) return ["GET", "PUT"];
  if (historyPath.test(path) || reportPath.test(path) || csvPath.test(path)) return ["GET"];
  const period = periodPath.exec(path);
  if (period) return period[3] === "lock" ? ["POST", "DELETE"] : period[3] === "plan" ? ["PUT"] : ["POST"];
  if (panelPath.test(path)) return ["PUT"];
  return null;
}

type SectionRow = Gradebook["section"] & { courseStatus: "active" | "archived"; teaches: number; evaluates: number };
type Access = { section: SectionRow; write: boolean; approve: boolean };

/** The section and what the person may do with its scores, or the response that refuses it. */
async function access(db: Database, current: Member, groupId: string): Promise<Access | Response> {
  const section = await db.prepare(`SELECT g.id,g.name,g.course_id AS courseId,c.title AS courseTitle,g.status,c.status AS courseStatus,
    EXISTS(SELECT 1 FROM section_educators e WHERE e.group_id=g.id AND e.user_id=?) AS teaches,
    EXISTS(SELECT 1 FROM assessment_evaluators e JOIN assessment_activities a ON a.id=e.activity_id WHERE a.course_id=g.course_id AND e.user_id=?) AS evaluates
    FROM course_groups g JOIN courses c ON c.id=g.course_id AND c.organization_id=g.organization_id WHERE g.id=? AND g.organization_id=?`).bind(current.id, current.id, groupId, current.organizationId).first<SectionRow>();
  if (!section) return reply({ error: "La sección no está disponible." }, 404);
  const admin = current.role === "admin", teaches = !!section.teaches;
  const scoped = admin ? [] : await scopedCourses(db, current, ["classes.view", "sections.assign"]);
  if (!admin && !teaches && !section.evaluates && !scoped.includes(section.courseId)) return reply({ error: "Esta sección no está asignada a tu cuenta. Administración asigna quién imparte cada sección." }, 403);
  const coordinates = !admin && (await scopedCourses(db, current, ["sections.assign"])).includes(section.courseId);
  const active = section.status === "active" && section.courseStatus === "active";
  return { section, write: (admin || teaches) && active, approve: (admin || coordinates) && active };
}

type Year = Pick<AcademicYear, "id" | "name" | "status" | "from" | "until">;
async function yearsOf(db: Database, organizationId: string, courseId: string) {
  return (await db.prepare(`SELECT y.id,y.name,y.status,y.starts_on AS "from",y.ends_on AS until FROM academic_years y
    JOIN courses c ON c.id=? AND c.organization_id=y.organization_id
    WHERE y.organization_id=? AND y.status IN ('current','closed') AND (y.program_id IS NULL OR y.program_id=c.program_id)
    ORDER BY CASE WHEN y.status='current' THEN 0 ELSE 1 END,CASE WHEN y.program_id IS NULL THEN 1 ELSE 0 END,y.starts_on DESC,y.rowid DESC`)
    .bind(courseId, organizationId).all<Year>()).results;
}
async function policyOf(db: Database, organizationId: string, courseId: string): Promise<{ policy: GradingPolicy; scheme: GradingScheme }> {
  const settings = (await configurationOf(db, organizationId, courseId))!.settings;
  const policy = { scale: settings.gradeScale, passingGrade: settings.passingGrade, letterThresholds: settings.letterThresholds, average: settings.gradeAverage };
  const selected = settings.gradingSchemeId ? (await gradingSchemesFor(db, organizationId)).find(item => item.id === settings.gradingSchemeId) : null;
  return { policy, scheme: selected || schemeFromSettings(settings) };
}

type Book = Omit<Gradebook, "section" | "years" | "policy" | "canEdit" | "canLock" | "canUnlock" | "canSubmit" | "year"> & { year: Year | null };
const gradingActivity = (activity: AssessmentActivity): GradingActivity => ({
  id: activity.id,
  periodId: activity.periodId,
  categoryId: activity.categoryId || "general",
  title: activity.title,
  points: activity.points,
  grading: activity.grading || "points",
  ...(activity.extra ? { extra: true } : {}),
  ...(activity.retakeOf ? { retakeOf: activity.retakeOf } : {}),
  ...(activity.rubric ? { rubric: activity.rubric } : {}),
  ...(activity.panel ? { panel: activity.panel } : {}),
});
type StoredActivity = {
  id: string; periodId: string; title: string; points: number; categoryId: string; grading: GradingActivity["grading"];
  extra: number; retakeOf: string | null; rubric: string | null; panel: string | null;
};
type StoredMark = { activityId: string; learnerId: string; evaluatorId: string | null; mark: string };
const storedActivity = (activity: StoredActivity): GradingActivity => ({
  id: activity.id,
  periodId: activity.periodId,
  categoryId: activity.categoryId,
  title: activity.title,
  points: activity.points,
  grading: activity.grading,
  ...(activity.extra ? { extra: true } : {}),
  ...(activity.retakeOf ? { retakeOf: activity.retakeOf } : {}),
  ...(activity.rubric ? { rubric: JSON.parse(activity.rubric) } : {}),
  ...(activity.panel ? { panel: JSON.parse(activity.panel) } : {}),
});
function marksFor(learnerId: string, activities: StoredActivity[], scores: Map<string, number>, marks: StoredMark[], evaluators: { activityId: string; userId: string }[]) {
  const out = new Map<string, Mark>();
  for (const activity of activities) {
    const score = scores.get(`${learnerId}:${activity.id}`);
    if (activity.grading === "points" && score !== undefined) out.set(activity.id, { kind: "points", value: score });
    else if (activity.grading === "panel") {
      const assigned = evaluators.filter(item => item.activityId === activity.id);
      const panelMarks = marks.filter(item => item.activityId === activity.id && item.learnerId === learnerId && item.evaluatorId);
      if (assigned.length && assigned.every(item => panelMarks.some(mark => mark.evaluatorId === item.userId))) {
        out.set(activity.id, { kind: "panel", marks: panelMarks.map(mark => ({ evaluator: mark.evaluatorId!, mark: JSON.parse(mark.mark) as AtomicMark })) });
      }
    } else {
      const mark = marks.find(item => item.activityId === activity.id && item.learnerId === learnerId && item.evaluatorId === null);
      if (mark) out.set(activity.id, JSON.parse(mark.mark) as AtomicMark);
    }
  }
  return out;
}
/** Everything a year of the section holds: periods with their lock, roster, scores, plan, comments and reviews. */
async function contents(db: Database, current: Member, section: { id: string; courseId: string }, year: Year | null, policy: GradingPolicy, scheme: GradingScheme, privileged: boolean): Promise<Book> {
  if (!year) return { year: null, periods: [], learners: [], grades: [], results: [], activities: [], scores: [], marks: [], evaluators: [], comments: [], reviews: [], scheme };
  const organizationId = current.organizationId;
  const [periods, learners, grades, activityRows, scores, markRows, evaluatorRows, comments, reviews] = await db.batch([
    db.prepare(`SELECT p.id,p.position,p.name,p.starts_on AS "from",p.ends_on AS until,p.weight,l.locked_at AS lockedAt,COALESCE(u.display_name,u.username) AS lockedBy
      FROM academic_periods p LEFT JOIN section_period_locks l ON l.period_id=p.id AND l.group_id=? LEFT JOIN users u ON u.id=l.locked_by WHERE p.year_id=? AND p.organization_id=? ORDER BY p.starts_on`).bind(section.id, year.id, organizationId),
    db.prepare("SELECT id,display_name AS name FROM group_learners WHERE group_id=? AND organization_id=? AND status='active' ORDER BY display_name COLLATE NOCASE,created_at,id").bind(section.id, organizationId),
    db.prepare("SELECT g.learner_id AS learnerId,g.period_id AS periodId,g.score FROM section_grades g JOIN academic_periods p ON p.id=g.period_id WHERE g.group_id=? AND g.organization_id=? AND p.year_id=?").bind(section.id, organizationId, year.id),
    db.prepare(`SELECT a.id,a.period_id AS periodId,a.position,a.title,a.kind,a.points,a.due_on AS dueOn,a.category_id AS categoryId,a.grading,a.extra,a.retake_of AS retakeOf,a.rubric,a.panel FROM assessment_activities a JOIN academic_periods p ON p.id=a.period_id
      WHERE a.course_id=? AND a.organization_id=? AND p.year_id=? ORDER BY p.starts_on,a.position,a.id`).bind(section.courseId, organizationId, year.id),
    db.prepare(`SELECT s.activity_id AS activityId,s.learner_id AS learnerId,s.points FROM assessment_scores s JOIN assessment_activities a ON a.id=s.activity_id JOIN academic_periods p ON p.id=a.period_id
      WHERE s.group_id=? AND s.organization_id=? AND p.year_id=?`).bind(section.id, organizationId, year.id),
    db.prepare(`SELECT m.activity_id AS activityId,m.learner_id AS learnerId,m.evaluator_id AS evaluatorId,m.mark,m.updated_at AS updatedAt,COALESCE(u.display_name,u.username) AS updatedBy
      FROM assessment_marks m JOIN assessment_activities a ON a.id=m.activity_id JOIN academic_periods p ON p.id=a.period_id
      LEFT JOIN users u ON u.id=m.updated_by WHERE m.group_id=? AND m.organization_id=? AND p.year_id=?`).bind(section.id, organizationId, year.id),
    db.prepare(`SELECT e.activity_id AS activityId,e.user_id AS userId,COALESCE(u.display_name,u.username) AS name,e.chair
      FROM assessment_evaluators e JOIN assessment_activities a ON a.id=e.activity_id JOIN academic_periods p ON p.id=a.period_id
      JOIN users u ON u.id=e.user_id WHERE a.course_id=? AND a.organization_id=? AND p.year_id=? ORDER BY e.activity_id,e.chair DESC,name`).bind(section.courseId, organizationId, year.id),
    db.prepare(`SELECT c.learner_id AS learnerId,c.period_id AS periodId,c.body,c.updated_at AS updatedAt,COALESCE(u.display_name,u.username) AS updatedBy FROM section_grade_comments c
      JOIN academic_periods p ON p.id=c.period_id LEFT JOIN users u ON u.id=c.updated_by WHERE c.group_id=? AND c.organization_id=? AND p.year_id=?`).bind(section.id, organizationId, year.id),
    db.prepare(`SELECT r.period_id AS periodId,r.status,r.note,COALESCE(s.display_name,s.username) AS submittedBy,r.submitted_at AS submittedAt,COALESCE(v.display_name,v.username) AS reviewedBy,r.reviewed_at AS reviewedAt
      FROM section_period_reviews r JOIN academic_periods p ON p.id=r.period_id LEFT JOIN users s ON s.id=r.submitted_by LEFT JOIN users v ON v.id=r.reviewed_by WHERE r.group_id=? AND r.organization_id=? AND p.year_id=?`).bind(section.id, organizationId, year.id),
  ]) as unknown as [
    Omit<GradebookPeriod, "locked">[], { id: string; name: string }[], GradeEntry[],
    (Omit<AssessmentActivity, "rubric" | "panel" | "extra"> & { rubric: string | null; panel: string | null; extra: number })[],
    AssessmentScore[], (Omit<AssessmentMark, "mark"> & { mark: string })[], (Omit<AssessmentEvaluator, "chair"> & { chair: number })[],
    GradeComment[], PeriodReview[],
  ];
  const activities: AssessmentActivity[] = activityRows.map(row => ({
    ...row, extra: !!row.extra, retakeOf: row.retakeOf || null,
    ...(row.rubric ? { rubric: JSON.parse(row.rubric) } : {}),
    ...(row.panel ? { panel: JSON.parse(row.panel) } : {}),
  }));
  const evaluators: AssessmentEvaluator[] = evaluatorRows.map(row => ({ ...row, chair: !!row.chair }));
  const parsedMarks: AssessmentMark[] = markRows.map(row => ({ ...row, mark: JSON.parse(row.mark) as AtomicMark }));
  const listed = periods.map(period => ({ ...period, locked: !!period.lockedAt || year.status === "closed" }));
  const roster = new Set(learners.map(learner => learner.id));
  const shownGrades = grades.filter(grade => roster.has(grade.learnerId));
  const shownScores = scores.filter(score => roster.has(score.learnerId));
  const completePanel = (activityId: string, learnerId: string) => {
    const assigned = evaluators.filter(item => item.activityId === activityId);
    return assigned.length > 0 && assigned.every(item => parsedMarks.some(mark => mark.activityId === activityId && mark.learnerId === learnerId && mark.evaluatorId === item.userId));
  };
  const resultOf = (learnerId: string) => {
    const mine = new Map<string, Mark>();
    for (const activity of activities) {
      if ((activity.grading || "points") === "points") {
        const score = shownScores.find(item => item.activityId === activity.id && item.learnerId === learnerId);
        if (score) mine.set(activity.id, { kind: "points", value: score.points });
      } else if ((activity.grading || "points") === "panel") {
        if (completePanel(activity.id, learnerId)) mine.set(activity.id, {
          kind: "panel",
          marks: parsedMarks.filter(item => item.activityId === activity.id && item.learnerId === learnerId && item.evaluatorId)
            .map(item => ({ evaluator: item.evaluatorId!, mark: item.mark })),
        });
      } else {
        const mark = parsedMarks.find(item => item.activityId === activity.id && item.learnerId === learnerId && item.evaluatorId === null);
        if (mark) mine.set(activity.id, mark.mark);
      }
    }
    return learnerResult(scheme, activities.map(gradingActivity), mine, listed.map(({ id, position, weight }) => ({ id, position, weight })));
  };
  const results = learners.map(learner => {
    if (scheme.id === "points") return {
      learnerId: learner.id,
      ...gradeResult(listed.map(period => ({ score: shownGrades.find(grade => grade.learnerId === learner.id && grade.periodId === period.id)?.score ?? null, weight: period.weight })), policy),
    };
    const calculated = resultOf(learner.id);
    return {
      learnerId: learner.id,
      average: calculated.final.score,
      letter: scheme.display.kind === "letters" ? calculated.final.display : null,
      passed: calculated.final.passed,
      complete: calculated.final.complete,
      display: calculated.final.display,
      level: calculated.periods.find(item => item.level)?.level || null,
      reasons: calculated.final.reasons,
      final: calculated.final,
    };
  });
  const visibleMarks = parsedMarks.filter(mark => {
    const activity = activities.find(item => item.id === mark.activityId);
    return activity?.grading !== "panel" || privileged || completePanel(mark.activityId, mark.learnerId) || mark.evaluatorId === current.id;
  });
  return { year, periods: listed, learners, grades: shownGrades, results, activities, scores: shownScores, marks: visibleMarks, evaluators, comments: comments.filter(comment => roster.has(comment.learnerId)), reviews, scheme };
}

async function gradebook(db: Database, current: Member, { section, write, approve }: Access, yearId?: string | null): Promise<Gradebook> {
  const years = await yearsOf(db, current.organizationId, section.courseId);
  const year = years.find(item => item.id === yearId) || years.find(item => item.status === "current") || years[0] || null;
  const { policy, scheme } = await policyOf(db, current.organizationId, section.courseId);
  const { teaches: _, evaluates: __, courseStatus: ___, ...shown } = section;
  const open = !!year && year.status === "current";
  const book = await contents(db, current, section, year, policy, scheme, write);
  return {
    ...book, year: book.year && { id: book.year.id, name: book.year.name, from: book.year.from, until: book.year.until, status: book.year.status },
    section: shown, years: years.map(({ id, name, status }) => ({ id, name, status })), policy,
    canEdit: write && open, canSubmit: write && open, canLock: approve && open, canUnlock: current.role === "admin" && open,
  };
}

type Change = { learnerId: string; periodId: string; score: number | null };
type ScoreChange = { activityId: string; learnerId: string; points: number | null };
type MarkChange = { activityId: string; learnerId: string; mark: unknown };
type CommentChange = { learnerId: string; periodId: string; body: string };
const objects = (value: unknown) => Array.isArray(value) ? value.map(item => item && typeof item === "object" ? item as Record<string, unknown> : {}) : value === undefined ? [] : null;
/** The changes as they arrive: period scores, activity points (checked against each activity later) and comments. */
function changesInput(input: unknown): { grades: Change[]; scores: (Omit<ScoreChange, "points"> & { raw: unknown })[]; marks: MarkChange[]; comments: CommentChange[] } | string {
  const body = input && typeof input === "object" ? input as Record<string, unknown> : {};
  const grades = objects(body.grades), scores = objects(body.scores), markRows = objects(body.marks), comments = objects(body.comments);
  if (!grades || !scores || !markRows || !comments) return "Revisa los cambios: deben ser listas.";
  if (!grades.length && !scores.length && !markRows.length && !comments.length) return "Escribe al menos una nota.";
  if (grades.length + scores.length + markRows.length + comments.length > maxGradeChanges) return `Guarda hasta ${maxGradeChanges} cambios a la vez.`;
  const out = { grades: [] as Change[], scores: [] as (Omit<ScoreChange, "points"> & { raw: unknown })[], marks: [] as MarkChange[], comments: [] as CommentChange[] };
  for (const item of grades) {
    if (typeof item.learnerId !== "string" || typeof item.periodId !== "string") return "Revisa las notas: falta el estudiante o el periodo.";
    const score = scoreInput(item.score);
    if (score === undefined) return "Las notas van de 0 a 100, con un decimal como máximo.";
    out.grades.push({ learnerId: item.learnerId, periodId: item.periodId, score });
  }
  for (const item of scores) {
    if (typeof item.learnerId !== "string" || typeof item.activityId !== "string") return "Revisa los punteos: falta el estudiante o la actividad.";
    out.scores.push({ learnerId: item.learnerId, activityId: item.activityId, raw: item.points });
  }
  for (const item of markRows) {
    if (typeof item.learnerId !== "string" || typeof item.activityId !== "string") return "Revisa las marcas: falta el estudiante o la actividad.";
    out.marks.push({ learnerId: item.learnerId, activityId: item.activityId, mark: item.mark });
  }
  for (const item of comments) {
    if (typeof item.learnerId !== "string" || typeof item.periodId !== "string" || typeof item.body !== "string") return "Revisa los comentarios: falta el estudiante, el periodo o el texto.";
    const text = item.body.trim();
    if (text.length > maxCommentLength) return `Un comentario tiene hasta ${maxCommentLength} caracteres.`;
    out.comments.push({ learnerId: item.learnerId, periodId: item.periodId, body: text });
  }
  const unique = (keys: string[]) => new Set(keys).size === keys.length;
  if (!unique(out.grades.map(change => `${change.learnerId}:${change.periodId}`)) || !unique(out.scores.map(change => `${change.learnerId}:${change.activityId}`)) || !unique(out.marks.map(change => `${change.learnerId}:${change.activityId}`)) || !unique(out.comments.map(change => `${change.learnerId}:${change.periodId}`))) return "Revisa los cambios: hay uno repetido.";
  return out;
}

function atomicMarkInput(input: unknown, activity: Pick<AssessmentActivity, "grading" | "rubric">, panel = false): AtomicMark | null {
  if (!input || typeof input !== "object") return null;
  const value = input as Record<string, unknown>;
  if (value.kind === "exempt") return { kind: "exempt" };
  const grading = activity.grading || "points";
  if ((grading === "pass-fail" || panel) && value.kind === "pass" && typeof value.value === "boolean") return { kind: "pass", value: value.value };
  if ((grading === "level" || panel) && value.kind === "level" && typeof value.value === "string") return { kind: "level", value: value.value };
  if ((grading === "rubric" || panel) && value.kind === "rubric" && value.choices && typeof value.choices === "object" && !Array.isArray(value.choices)
    && Object.values(value.choices).every(choice => typeof choice === "string")) return { kind: "rubric", choices: value.choices as Record<string, string> };
  if (panel && value.kind === "points" && typeof value.value === "number" && Number.isFinite(value.value)) return { kind: "points", value: value.value };
  return null;
}

type PlanItem = {
  id: string | null; title: string; kind: AssessmentKind; points: number; dueOn: string | null;
  categoryId: string; grading: GradingActivity["grading"]; extra: boolean; retakeOf: string | null;
  rubric: GradingActivity["rubric"] | null; panel: GradingActivity["panel"] | null;
};
function planInput(input: unknown): PlanItem[] | string {
  const list = objects(input && typeof input === "object" ? (input as Record<string, unknown>).activities : undefined);
  if (!list) return "Envía la lista de actividades del plan.";
  if (list.length > maxAssessmentActivities) return `El plan tiene hasta ${maxAssessmentActivities} actividades.`;
  const items: PlanItem[] = [];
  for (const item of list) {
    const title = typeof item.title === "string" ? item.title.trim() : "";
    if (!title || title.length > 120) return "Cada actividad necesita un nombre de hasta 120 caracteres.";
    if (!isAssessmentKind(item.kind)) return `Elige el tipo de «${title}».`;
    const points = pointsInput(item.points, 100);
    if (points === undefined || points === null || points === 0) return `Los puntos de «${title}» van de 0,1 a 100, con un decimal como máximo.`;
    const dueOn = item.dueOn === null || item.dueOn === undefined || item.dueOn === "" ? null : typeof item.dueOn === "string" && /^\d{4}-\d{2}-\d{2}$/.test(item.dueOn) ? item.dueOn : undefined;
    if (dueOn === undefined) return `Revisa la fecha de «${title}».`;
    if (item.id !== undefined && item.id !== null && (typeof item.id !== "string" || !/^assessment-[a-f0-9-]{36}$/.test(item.id))) return "Revisa las actividades: una no es de este plan.";
    const categoryId = item.categoryId === undefined ? "general" : typeof item.categoryId === "string" && /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,79}$/.test(item.categoryId) ? item.categoryId : null;
    const grading = item.grading === undefined ? "points" : ["points", "rubric", "pass-fail", "level", "panel"].includes(String(item.grading)) ? item.grading as GradingActivity["grading"] : null;
    if (!categoryId || !grading || (item.extra !== undefined && typeof item.extra !== "boolean")) return `Revisa la forma de evaluar «${title}».`;
    const retakeOf = item.retakeOf === undefined || item.retakeOf === null || item.retakeOf === "" ? null : typeof item.retakeOf === "string" && /^assessment-[a-f0-9-]{36}$/.test(item.retakeOf) ? item.retakeOf : undefined;
    if (retakeOf === undefined) return `Revisa la reposición de «${title}».`;
    let rubric: GradingActivity["rubric"] | null = null;
    if (grading === "rubric" || (grading === "panel" && item.rubric !== undefined && item.rubric !== null)) {
      const checked = rubricInput(item.rubric);
      if ("error" in checked) return checked.error;
      rubric = checked;
    } else if (item.rubric !== undefined && item.rubric !== null) return `«${title}» no usa una rúbrica.`;
    let panel: GradingActivity["panel"] | null = null;
    if (grading === "panel") {
      const raw = item.panel && typeof item.panel === "object" ? item.panel as Record<string, unknown> : {};
      if (!["average", "median", "majority", "chair"].includes(String(raw.combine)) || (raw.chair !== undefined && typeof raw.chair !== "string")) return `Elige cómo combina sus marcas el tribunal de «${title}».`;
      panel = { combine: raw.combine as NonNullable<GradingActivity["panel"]>["combine"], ...(raw.chair ? { chair: raw.chair as string } : {}) };
    } else if (item.panel !== undefined && item.panel !== null) return `«${title}» no usa un tribunal.`;
    items.push({ id: (item.id as string | undefined) || null, title, kind: item.kind, points, dueOn, categoryId, grading, extra: item.extra === true, retakeOf, rubric, panel });
  }
  if (new Set(items.filter(item => item.id).map(item => item.id)).size !== items.filter(item => item.id).length) return "Revisa las actividades: hay una repetida.";
  return items;
}

const writeClosed = (section: SectionRow) => reply({ error: section.status !== "active" || section.courseStatus !== "active" ? "La sección está cerrada: sus notas ya no cambian." : "Solo administración y quienes imparten la sección registran sus notas." }, 403);
type OpenPeriod = { id: string; name: string; position: number; weight: number; lockedAt: string | null; review: PeriodReview["status"] | null };

export async function grades(path: string, method: string, input: unknown, url: URL, current: Member, db: Database): Promise<Response> {
  const period = periodPath.exec(path), panelAction = panelPath.exec(path);
  const groupId = (period || panelAction || gradesPath.exec(path) || historyPath.exec(path) || reportPath.exec(path) || csvPath.exec(path))![1];
  const allowed = await access(db, current, groupId);
  if (allowed instanceof Response) return allowed;
  const { section } = allowed;
  if (panelAction) return panelAction[3] === "evaluators"
    ? saveEvaluators(db, current, allowed, panelAction[2], input)
    : savePanelMark(db, current, allowed, panelAction[2], input);
  if (historyPath.test(path)) return changesOf(db, current, section, url.searchParams.get("learner") || "");
  if (reportPath.test(path)) return report(db, current, section, url);
  if (csvPath.test(path)) return reportCsv(db, current, section, url);
  if (method === "GET") return reply({ gradebook: await gradebook(db, current, allowed, url.searchParams.get("year")) });
  const year = await db.prepare(`SELECT y.id,y.name FROM academic_years y JOIN courses c ON c.id=? AND c.organization_id=y.organization_id
    WHERE y.organization_id=? AND y.status='current' AND (y.program_id IS NULL OR y.program_id=c.program_id)
    ORDER BY CASE WHEN y.program_id IS NULL THEN 1 ELSE 0 END LIMIT 1`).bind(section.courseId, current.organizationId).first<{ id: string; name: string }>();
  const periods = year ? (await db.prepare(`SELECT p.id,p.name,p.position,p.weight,l.locked_at AS lockedAt,r.status AS review FROM academic_periods p LEFT JOIN section_period_locks l ON l.period_id=p.id AND l.group_id=?
    LEFT JOIN section_period_reviews r ON r.period_id=p.id AND r.group_id=? WHERE p.year_id=? AND p.organization_id=?`).bind(groupId, groupId, year.id, current.organizationId).all<OpenPeriod>()).results : [];
  const now = new Date().toISOString();

  if (period) {
    const action = period[3];
    if (action === "lock" && method === "DELETE" && current.role !== "admin") return reply({ error: "Solo administración reabre las notas de un periodo." }, 403);
    if (action === "lock" || action === "return" ? !allowed.approve : !allowed.write) {
      if (action === "lock" && method === "POST" && allowed.write) return reply({ error: "Coordinación o administración aprueba y cierra el periodo. Entrégalo para revisión." }, 403);
      return action === "lock" || action === "return" ? reply({ error: "Solo coordinación y administración aprueban o devuelven las notas de un periodo." }, 403) : writeClosed(section);
    }
    if (!year) return reply({ error: "No hay un ciclo lectivo vigente. Administración lo activa en Organización." }, 409);
    const found = periods.find(item => item.id === period[2]);
    if (!found) return reply({ error: "Ese periodo no es del ciclo vigente." }, 404);
    if (action === "plan") return savePlan(db, current, section, found, input, now);
    if (action === "submit") return submit(db, current, allowed, found, now);
    if (action === "return") return giveBack(db, current, allowed, found, input, now);
    if (method === "POST") {
      if (found.lockedAt) return reply({ error: `Las notas de «${found.name}» ya están cerradas.` }, 409);
      await db.batch([
        db.prepare("INSERT INTO section_period_locks(group_id,organization_id,period_id,locked_by,locked_at) VALUES (?,?,?,?,?) ON CONFLICT(group_id,period_id) DO NOTHING").bind(groupId, current.organizationId, found.id, current.id, now),
        reviewUpsert(db, current, groupId, found.id, "approved", null, now),
        event(db, current, { action: "updated", targetType: "group", targetId: groupId, courseId: section.courseId, summary: `Aprobó y cerró las notas de «${found.name}» en «${section.name}»` }),
      ]);
    } else {
      if (current.role !== "admin") return reply({ error: "Solo administración reabre las notas de un periodo." }, 403);
      if (!found.lockedAt) return reply({ error: `Las notas de «${found.name}» están abiertas.` }, 409);
      await db.batch([
        db.prepare("DELETE FROM section_period_locks WHERE group_id=? AND period_id=? AND organization_id=?").bind(groupId, found.id, current.organizationId),
        db.prepare("DELETE FROM section_period_reviews WHERE group_id=? AND period_id=? AND organization_id=?").bind(groupId, found.id, current.organizationId),
        event(db, current, { action: "restored", targetType: "group", targetId: groupId, courseId: section.courseId, summary: `Reabrió las notas de «${found.name}» en «${section.name}»` }),
      ]);
    }
    return reply({ gradebook: await gradebook(db, current, allowed) });
  }

  if (!allowed.write) return writeClosed(section);
  if (!year) return reply({ error: "No hay un ciclo lectivo vigente. Administración lo activa en Organización." }, 409);
  const changes = changesInput(input);
  if (typeof changes === "string") return reply({ error: changes }, 400);
  const [learnerRows, activityRows, gradeRows, scoreRows, storedMarkRows, evaluatorIds] = await db.batch([
    db.prepare("SELECT id FROM group_learners WHERE group_id=? AND organization_id=? AND status='active'").bind(groupId, current.organizationId),
    db.prepare("SELECT a.id,a.period_id AS periodId,a.title,a.points,a.category_id AS categoryId,a.grading,a.extra,a.retake_of AS retakeOf,a.rubric,a.panel FROM assessment_activities a JOIN academic_periods p ON p.id=a.period_id WHERE a.course_id=? AND a.organization_id=? AND p.year_id=?").bind(section.courseId, current.organizationId, year.id),
    db.prepare("SELECT g.learner_id AS learnerId,g.period_id AS periodId,g.score FROM section_grades g JOIN academic_periods p ON p.id=g.period_id WHERE g.group_id=? AND g.organization_id=? AND p.year_id=?").bind(groupId, current.organizationId, year.id),
    db.prepare("SELECT s.activity_id AS activityId,s.learner_id AS learnerId,s.points FROM assessment_scores s WHERE s.group_id=? AND s.organization_id=?").bind(groupId, current.organizationId),
    db.prepare("SELECT activity_id AS activityId,learner_id AS learnerId,evaluator_id AS evaluatorId,mark FROM assessment_marks WHERE group_id=? AND organization_id=?").bind(groupId, current.organizationId),
    db.prepare("SELECT e.activity_id AS activityId,e.user_id AS userId FROM assessment_evaluators e JOIN assessment_activities a ON a.id=e.activity_id WHERE a.course_id=? AND a.organization_id=?").bind(section.courseId, current.organizationId),
  ]) as unknown as [
    { id: string }[], StoredActivity[], GradeEntry[], AssessmentScore[], StoredMark[], { activityId: string; userId: string }[],
  ];
  const learners = new Set(learnerRows.map(row => row.id));
  const activities = new Map(activityRows.map(row => [row.id, row]));
  const planned = new Set(activityRows.map(row => row.periodId));
  const { scheme } = await policyOf(db, current.organizationId, section.courseId);
  const all = [...changes.grades, ...changes.scores, ...changes.marks, ...changes.comments];
  if (all.some(change => !learners.has(change.learnerId))) return reply({ error: "Revisa las notas: un estudiante no está en la lista de la sección." }, 400);
  const scores: ScoreChange[] = [];
  for (const change of changes.scores) {
    const activity = activities.get(change.activityId);
    if (!activity) return reply({ error: "Revisa los punteos: una actividad no es del plan de este ciclo." }, 400);
    if (activity.grading !== "points") return reply({ error: `«${activity.title}» no se evalúa con puntos.` }, 400);
    const points = pointsInput(change.raw, activity.points);
    if (points === undefined) return reply({ error: `Los punteos de «${activity.title}» van de 0 a ${activity.points}, con un decimal como máximo.` }, 400);
    scores.push({ activityId: activity.id, learnerId: change.learnerId, points });
  }
  const checkedMarks: (Omit<MarkChange, "mark"> & { mark: AtomicMark })[] = [];
  for (const change of changes.marks) {
    const activity = activities.get(change.activityId);
    if (!activity) return reply({ error: "Revisa las marcas: una actividad no es del plan de este ciclo." }, 400);
    if (activity.grading === "points" || activity.grading === "panel") return reply({ error: `«${activity.title}» se registra ${activity.grading === "panel" ? "desde su tribunal" : "como punteo"}.` }, 400);
    const mark = atomicMarkInput(change.mark, { grading: activity.grading, ...(activity.rubric ? { rubric: JSON.parse(activity.rubric) } : {}) });
    if (!mark) return reply({ error: `Revisa la marca de «${activity.title}».` }, 400);
    if (mark.kind === "level" && !scheme.levels?.some(level => level.id === mark.value)) return reply({ error: `El nivel de «${activity.title}» no existe en el esquema.` }, 400);
    if (mark.kind === "rubric") {
      const rubric = activity.rubric ? JSON.parse(activity.rubric) as NonNullable<GradingActivity["rubric"]> : null;
      if (!rubric || Object.keys(mark.choices).length !== rubric.criteria.length || rubric.criteria.some(criterion => !criterion.levels.some(level => level.id === mark.choices[criterion.id]))) return reply({ error: `Completa todos los criterios de «${activity.title}».` }, 400);
    }
    checkedMarks.push({ ...change, mark });
  }
  const touched = [...new Set([...changes.grades.map(change => change.periodId), ...scores.map(change => activities.get(change.activityId)!.periodId), ...checkedMarks.map(change => activities.get(change.activityId)!.periodId), ...changes.comments.map(change => change.periodId)])].map(id => periods.find(item => item.id === id));
  if (touched.some(item => !item)) return reply({ error: "Revisa las notas: un periodo no es del ciclo vigente." }, 400);
  const closed = touched.find(item => item!.lockedAt);
  if (closed) return reply({ error: `Las notas de «${closed.name}» están cerradas. Administración puede reabrirlas.` }, 409);
  const handed = touched.find(item => item!.review === "submitted");
  if (handed) return reply({ error: `«${handed.name}» está entregado a revisión: espera a que coordinación lo apruebe o lo devuelva.` }, 409);
  const derived = changes.grades.find(change => planned.has(change.periodId));
  if (derived) return reply({ error: `La nota de «${periods.find(item => item.id === derived.periodId)!.name}» se calcula con su plan de evaluación: registra los punteos de sus actividades.` }, 400);

  const stored = new Map(gradeRows.map(row => [`${row.learnerId}:${row.periodId}`, row.score]));
  const earned = new Map(scoreRows.map(row => [`${row.learnerId}:${row.activityId}`, row.points]));
  const history: Prepared[] = [];
  const log = (learnerId: string, periodId: string, activityId: string | null, before: number | null, after: number | null) => history.push(db.prepare("INSERT INTO section_grade_history(id,organization_id,group_id,learner_id,period_id,activity_id,before,after,changed_by,changed_at) VALUES (?,?,?,?,?,?,?,?,?,?)")
    .bind(`history-${crypto.randomUUID()}`, current.organizationId, groupId, learnerId, periodId, activityId, before, after, current.id, now));
  const writes: Prepared[] = [];
  const writeGrade = (learnerId: string, periodId: string, score: number | null) => writes.push(score === null
    ? db.prepare("DELETE FROM section_grades WHERE learner_id=? AND period_id=? AND group_id=? AND organization_id=?").bind(learnerId, periodId, groupId, current.organizationId)
    : db.prepare("INSERT INTO section_grades(id,organization_id,group_id,learner_id,period_id,score,updated_by,updated_at) VALUES (?,?,?,?,?,?,?,?) ON CONFLICT(learner_id,period_id) DO UPDATE SET score=excluded.score,updated_by=excluded.updated_by,updated_at=excluded.updated_at")
      .bind(`grade-${crypto.randomUUID()}`, current.organizationId, groupId, learnerId, periodId, score, current.id, now));
  let counted = 0;
  for (const change of changes.grades) {
    const before = stored.get(`${change.learnerId}:${change.periodId}`) ?? null;
    if (before === change.score) continue;
    writeGrade(change.learnerId, change.periodId, change.score); log(change.learnerId, change.periodId, null, before, change.score); counted++;
  }
  // Activity points, then each touched student's period score from the plan: the sum earned so far.
  const recompute = new Set<string>();
  for (const change of scores) {
    const id = `${change.learnerId}:${change.activityId}`, before = earned.get(id) ?? null, activity = activities.get(change.activityId)!;
    if (before === change.points) continue;
    writes.push(change.points === null
      ? db.prepare("DELETE FROM assessment_scores WHERE activity_id=? AND learner_id=? AND group_id=? AND organization_id=?").bind(change.activityId, change.learnerId, groupId, current.organizationId)
      : db.prepare("INSERT INTO assessment_scores(activity_id,organization_id,group_id,learner_id,points,updated_by,updated_at) VALUES (?,?,?,?,?,?,?) ON CONFLICT(activity_id,learner_id) DO UPDATE SET points=excluded.points,updated_by=excluded.updated_by,updated_at=excluded.updated_at")
        .bind(change.activityId, current.organizationId, groupId, change.learnerId, change.points, current.id, now));
    if (change.points === null) earned.delete(id); else earned.set(id, change.points);
    log(change.learnerId, activity.periodId, activity.id, before, change.points); counted++;
    recompute.add(`${change.learnerId}:${activity.periodId}`);
  }
  for (const change of checkedMarks) {
    const activity = activities.get(change.activityId)!;
    const beforeRow = storedMarkRows.find(row => row.activityId === change.activityId && row.learnerId === change.learnerId && row.evaluatorId === null);
    const before = beforeRow?.mark || null;
    const after = JSON.stringify(change.mark);
    if (before === after) continue;
    if (beforeRow) {
      writes.push(db.prepare("UPDATE assessment_marks SET mark=?,updated_by=?,updated_at=? WHERE activity_id=? AND learner_id=? AND group_id=? AND organization_id=? AND evaluator_id IS NULL")
        .bind(after, current.id, now, change.activityId, change.learnerId, groupId, current.organizationId));
      beforeRow.mark = after;
    } else {
      writes.push(db.prepare("INSERT INTO assessment_marks(id,activity_id,organization_id,group_id,learner_id,evaluator_id,mark,updated_by,updated_at) VALUES (?,?,?,?,?,NULL,?,?,?)")
        .bind(`mark-${crypto.randomUUID()}`, change.activityId, current.organizationId, groupId, change.learnerId, after, current.id, now));
      storedMarkRows.push({ activityId: change.activityId, learnerId: change.learnerId, evaluatorId: null, mark: after });
    }
    history.push(db.prepare("INSERT INTO assessment_mark_history(id,organization_id,group_id,learner_id,activity_id,evaluator_id,before_mark,after_mark,changed_by,changed_at) VALUES (?,?,?,?,?,NULL,?,?,?,?)")
      .bind(`mark-history-${crypto.randomUUID()}`, current.organizationId, groupId, change.learnerId, change.activityId, before, after, current.id, now));
    counted++;
    recompute.add(`${change.learnerId}:${activity.periodId}`);
  }
  for (const key of recompute) {
    const [learnerId, periodId] = key.split(":");
    const calculated = learnerResult(scheme, activityRows.map(storedActivity), marksFor(learnerId, activityRows, earned, storedMarkRows, evaluatorIds), periods.map(({ id, position, weight }) => ({ id, position, weight })));
    const raw = calculated.periods.find(item => item.periodId === periodId)?.score ?? null;
    const score = raw === null ? null : Math.min(100, Math.round((raw + Number.EPSILON) * 10) / 10);
    if ((stored.get(key) ?? null) !== score) writeGrade(learnerId, periodId, score);
  }
  for (const change of changes.comments) writes.push(change.body
    ? db.prepare("INSERT INTO section_grade_comments(learner_id,period_id,group_id,organization_id,body,updated_by,updated_at) VALUES (?,?,?,?,?,?,?) ON CONFLICT(learner_id,period_id) DO UPDATE SET body=excluded.body,updated_by=excluded.updated_by,updated_at=excluded.updated_at")
      .bind(change.learnerId, change.periodId, groupId, current.organizationId, change.body, current.id, now)
    : db.prepare("DELETE FROM section_grade_comments WHERE learner_id=? AND period_id=? AND group_id=? AND organization_id=?").bind(change.learnerId, change.periodId, groupId, current.organizationId));
  const ids = touched.map(item => item!.id), marks = ids.map(() => "?").join(",");
  const parts = [counted ? (counted === 1 ? "1 cambio" : `${counted} cambios`) : "", changes.comments.length ? (changes.comments.length === 1 ? "1 comentario" : `${changes.comments.length} comentarios`) : ""].filter(Boolean);
  // Compare-and-write: the year is still current and none of the periods was locked or handed in meanwhile.
  const ok = await db.guardedBatch(db.prepare(`SELECT 1 FROM academic_years WHERE id=? AND status='current' AND NOT EXISTS (SELECT 1 FROM section_period_locks WHERE group_id=? AND period_id IN (${marks}))
    AND NOT EXISTS (SELECT 1 FROM section_period_reviews WHERE group_id=? AND status='submitted' AND period_id IN (${marks}))`).bind(year.id, groupId, ...ids, groupId, ...ids), [
    ...writes, ...history,
    // The activity says that scores changed, never which ones.
    event(db, current, { action: "recorded", targetType: "group", targetId: groupId, courseId: section.courseId, summary: `Registró notas en «${section.name}» (${parts.join(" y ") || "sin cambios"})` }),
  ]);
  if (!ok) return reply({ error: "Las notas cambiaron de estado mientras las editabas. Recarga y vuelve a intentar." }, 409);
  return reply({ gradebook: await gradebook(db, current, allowed) });
}

async function recomputeOne(db: Database, current: Member, section: SectionRow, learnerId: string, periodId: string, now: string) {
  const [periodRows, activityRows, scoreRows, markRows, evaluatorRows] = await db.batch([
    db.prepare(`SELECT p.id,p.position,p.weight FROM academic_periods p JOIN academic_years y ON y.id=p.year_id
      WHERE y.status='current' AND p.organization_id=? AND p.year_id=(SELECT year_id FROM academic_periods WHERE id=?) ORDER BY p.position`).bind(current.organizationId, periodId),
    db.prepare(`SELECT a.id,a.period_id AS periodId,a.title,a.points,a.category_id AS categoryId,a.grading,a.extra,a.retake_of AS retakeOf,a.rubric,a.panel
      FROM assessment_activities a JOIN academic_periods p ON p.id=a.period_id WHERE a.course_id=? AND p.year_id=(SELECT year_id FROM academic_periods WHERE id=?)`).bind(section.courseId, periodId),
    db.prepare("SELECT activity_id AS activityId,learner_id AS learnerId,points FROM assessment_scores WHERE group_id=? AND learner_id=? AND organization_id=?").bind(section.id, learnerId, current.organizationId),
    db.prepare("SELECT activity_id AS activityId,learner_id AS learnerId,evaluator_id AS evaluatorId,mark FROM assessment_marks WHERE group_id=? AND learner_id=? AND organization_id=?").bind(section.id, learnerId, current.organizationId),
    db.prepare("SELECT e.activity_id AS activityId,e.user_id AS userId FROM assessment_evaluators e JOIN assessment_activities a ON a.id=e.activity_id WHERE a.course_id=?").bind(section.courseId),
  ]) as unknown as [
    { id: string; position: number; weight: number }[], StoredActivity[], AssessmentScore[], StoredMark[], { activityId: string; userId: string }[],
  ];
  const { scheme } = await policyOf(db, current.organizationId, section.courseId);
  const scoreMap = new Map(scoreRows.map(row => [`${row.learnerId}:${row.activityId}`, row.points]));
  const calculated = learnerResult(scheme, activityRows.map(storedActivity), marksFor(learnerId, activityRows, scoreMap, markRows, evaluatorRows), periodRows);
  const raw = calculated.periods.find(item => item.periodId === periodId)?.score ?? null;
  const score = raw === null ? null : Math.min(100, Math.round((raw + Number.EPSILON) * 10) / 10);
  if (score === null) await db.prepare("DELETE FROM section_grades WHERE learner_id=? AND period_id=? AND group_id=? AND organization_id=?").bind(learnerId, periodId, section.id, current.organizationId).run();
  else await db.prepare("INSERT INTO section_grades(id,organization_id,group_id,learner_id,period_id,score,updated_by,updated_at) VALUES (?,?,?,?,?,?,?,?) ON CONFLICT(learner_id,period_id) DO UPDATE SET score=excluded.score,updated_by=excluded.updated_by,updated_at=excluded.updated_at")
    .bind(`grade-${crypto.randomUUID()}`, current.organizationId, section.id, learnerId, periodId, score, current.id, now).run();
}

async function saveEvaluators(db: Database, current: Member, allowed: Access, activityId: string, input: unknown) {
  if (!allowed.write) return writeClosed(allowed.section);
  const activity = await db.prepare(`SELECT a.id,a.panel FROM assessment_activities a JOIN academic_periods p ON p.id=a.period_id JOIN academic_years y ON y.id=p.year_id
    WHERE a.id=? AND a.course_id=? AND a.organization_id=? AND a.grading='panel' AND y.status='current'`)
    .bind(activityId, allowed.section.courseId, current.organizationId).first<{ id: string; panel: string }>();
  if (!activity) return reply({ error: "La actividad de tribunal no está disponible." }, 404);
  const body = input && typeof input === "object" ? input as Record<string, unknown> : {};
  const rows = objects(body.evaluators);
  if (!rows || !rows.length || rows.length > 20) return reply({ error: "Elige entre 1 y 20 integrantes del tribunal." }, 400);
  const evaluators: { userId: string; chair: boolean }[] = [];
  for (const row of rows) {
    if (typeof row.userId !== "string" || (row.chair !== undefined && typeof row.chair !== "boolean")) return reply({ error: "Revisa los integrantes del tribunal." }, 400);
    evaluators.push({ userId: row.userId, chair: row.chair === true });
  }
  if (new Set(evaluators.map(item => item.userId)).size !== evaluators.length || evaluators.filter(item => item.chair).length !== 1) return reply({ error: "El tribunal necesita integrantes distintos y una sola presidencia." }, 400);
  const members = (await db.prepare(`SELECT m.user_id AS userId FROM memberships m WHERE m.organization_id=? AND m.active=1
    AND m.user_id IN (${evaluators.map(() => "?").join(",")})`).bind(current.organizationId, ...evaluators.map(item => item.userId)).all<{ userId: string }>()).results;
  if (members.length !== evaluators.length) return reply({ error: "Una persona del tribunal no pertenece a la organización." }, 400);
  if (await db.prepare("SELECT 1 AS found FROM assessment_marks WHERE activity_id=? LIMIT 1").bind(activityId).first()) return reply({ error: "El tribunal ya tiene marcas: no puedes cambiar sus integrantes." }, 409);
  const now = new Date().toISOString(), panel = JSON.parse(activity.panel) as NonNullable<GradingActivity["panel"]>;
  const chair = evaluators.find(item => item.chair)!.userId;
  await db.batch([
    db.prepare("DELETE FROM assessment_evaluators WHERE activity_id=?").bind(activityId),
    ...evaluators.map(item => db.prepare("INSERT INTO assessment_evaluators(activity_id,user_id,chair) VALUES (?,?,?)").bind(activityId, item.userId, item.chair ? 1 : 0)),
    db.prepare("UPDATE assessment_activities SET panel=?,updated_at=? WHERE id=? AND organization_id=?").bind(JSON.stringify({ ...panel, chair }), now, activityId, current.organizationId),
  ]);
  return reply({ gradebook: await gradebook(db, current, allowed) });
}

async function savePanelMark(db: Database, current: Member, allowed: Access, activityId: string, input: unknown) {
  const activity = await db.prepare(`SELECT a.id,a.period_id AS periodId,a.title,a.points,a.rubric,e.user_id AS evaluatorId,l.locked_at AS lockedAt,r.status AS review
    FROM assessment_activities a JOIN academic_periods p ON p.id=a.period_id JOIN academic_years y ON y.id=p.year_id
    JOIN assessment_evaluators e ON e.activity_id=a.id AND e.user_id=?
    LEFT JOIN section_period_locks l ON l.period_id=a.period_id AND l.group_id=?
    LEFT JOIN section_period_reviews r ON r.period_id=a.period_id AND r.group_id=?
    WHERE a.id=? AND a.course_id=? AND a.organization_id=? AND a.grading='panel' AND y.status='current'`)
    .bind(current.id, allowed.section.id, allowed.section.id, activityId, allowed.section.courseId, current.organizationId)
    .first<{ id: string; periodId: string; title: string; points: number; rubric: string | null; evaluatorId: string; lockedAt: string | null; review: string | null }>();
  if (!activity) return reply({ error: "No formas parte del tribunal de esta actividad." }, 403);
  if (activity.lockedAt || activity.review === "submitted") return reply({ error: "Las notas de este periodo están cerradas o entregadas a revisión." }, 409);
  const body = input && typeof input === "object" ? input as Record<string, unknown> : {};
  if (typeof body.learnerId !== "string") return reply({ error: "Elige al estudiante del tribunal." }, 400);
  const learner = await db.prepare("SELECT id FROM group_learners WHERE id=? AND group_id=? AND organization_id=? AND status='active'").bind(body.learnerId, allowed.section.id, current.organizationId).first();
  if (!learner) return reply({ error: "Ese estudiante no está en la lista de la sección." }, 404);
  const mark = atomicMarkInput(body.mark, { grading: "panel", ...(activity.rubric ? { rubric: JSON.parse(activity.rubric) } : {}) }, true);
  if (!mark || (mark.kind === "points" && (mark.value < 0 || mark.value > activity.points))) return reply({ error: `Revisa tu marca de «${activity.title}».` }, 400);
  const { scheme } = await policyOf(db, current.organizationId, allowed.section.courseId);
  if (mark.kind === "level" && !scheme.levels?.some(level => level.id === mark.value)) return reply({ error: `Ese nivel no existe en el esquema.` }, 400);
  if (mark.kind === "rubric") {
    const rubric = activity.rubric ? JSON.parse(activity.rubric) as NonNullable<GradingActivity["rubric"]> : null;
    if (!rubric || Object.keys(mark.choices).length !== rubric.criteria.length || rubric.criteria.some(criterion => !criterion.levels.some(level => level.id === mark.choices[criterion.id]))) return reply({ error: `Completa todos los criterios de «${activity.title}».` }, 400);
  }
  const now = new Date().toISOString(), after = JSON.stringify(mark);
  const previous = await db.prepare("SELECT id,mark FROM assessment_marks WHERE activity_id=? AND learner_id=? AND evaluator_id=?").bind(activityId, body.learnerId, current.id).first<{ id: string; mark: string }>();
  if (previous?.mark !== after) await db.batch([
    previous
      ? db.prepare("UPDATE assessment_marks SET mark=?,updated_by=?,updated_at=? WHERE id=?").bind(after, current.id, now, previous.id)
      : db.prepare("INSERT INTO assessment_marks(id,activity_id,organization_id,group_id,learner_id,evaluator_id,mark,updated_by,updated_at) VALUES (?,?,?,?,?,?,?,?,?)")
        .bind(`mark-${crypto.randomUUID()}`, activityId, current.organizationId, allowed.section.id, body.learnerId, current.id, after, current.id, now),
    db.prepare("INSERT INTO assessment_mark_history(id,organization_id,group_id,learner_id,activity_id,evaluator_id,before_mark,after_mark,changed_by,changed_at) VALUES (?,?,?,?,?,?,?,?,?,?)")
      .bind(`mark-history-${crypto.randomUUID()}`, current.organizationId, allowed.section.id, body.learnerId, activityId, current.id, previous?.mark || null, after, current.id, now),
  ]);
  await recomputeOne(db, current, allowed.section, body.learnerId, activity.periodId, now);
  return reply({ gradebook: await gradebook(db, current, allowed) });
}

function reviewUpsert(db: Database, current: Member, groupId: string, periodId: string, status: PeriodReview["status"], note: string | null, now: string) {
  return status === "submitted"
    ? db.prepare("INSERT INTO section_period_reviews(group_id,organization_id,period_id,status,note,submitted_by,submitted_at) VALUES (?,?,?,'submitted',NULL,?,?) ON CONFLICT(group_id,period_id) DO UPDATE SET status='submitted',note=NULL,submitted_by=excluded.submitted_by,submitted_at=excluded.submitted_at,reviewed_by=NULL,reviewed_at=NULL")
      .bind(groupId, current.organizationId, periodId, current.id, now)
    // Approving a period that was never handed in records the approver as the one who handed it in.
    : db.prepare("INSERT INTO section_period_reviews(group_id,organization_id,period_id,status,note,submitted_by,submitted_at,reviewed_by,reviewed_at) VALUES (?,?,?,?,?,?,?,?,?) ON CONFLICT(group_id,period_id) DO UPDATE SET status=excluded.status,note=excluded.note,reviewed_by=excluded.reviewed_by,reviewed_at=excluded.reviewed_at")
      .bind(groupId, current.organizationId, periodId, status, note, current.id, now, current.id, now);
}

/** Hands the period in for review: the plan (if any) adds up to 100 and the period is neither closed nor already handed in. */
async function submit(db: Database, current: Member, allowed: Access, period: OpenPeriod, now: string) {
  const { section } = allowed;
  if (period.lockedAt) return reply({ error: `Las notas de «${period.name}» ya están cerradas.` }, 409);
  if (period.review === "submitted") return reply({ error: `«${period.name}» ya está entregado a revisión.` }, 409);
  const plan = (await db.prepare("SELECT points FROM assessment_activities WHERE course_id=? AND period_id=? AND extra=0 AND retake_of IS NULL").bind(section.courseId, period.id).all<{ points: number }>()).results;
  const { scheme } = await policyOf(db, current.organizationId, section.courseId);
  if (scheme.method === "points" && plan.length && planTotal(plan) !== 100) return reply({ error: `El plan de evaluación de «${period.name}» suma ${planTotal(plan)} puntos: complétalo a 100 antes de entregarlo.` }, 409);
  const ok = await db.guardedBatch(db.prepare("SELECT 1 FROM academic_periods WHERE id=? AND NOT EXISTS (SELECT 1 FROM section_period_locks WHERE group_id=? AND period_id=?) AND NOT EXISTS (SELECT 1 FROM section_period_reviews WHERE group_id=? AND period_id=? AND status='submitted')").bind(period.id, section.id, period.id, section.id, period.id), [
    reviewUpsert(db, current, section.id, period.id, "submitted", null, now),
    event(db, current, { action: "updated", targetType: "group", targetId: section.id, courseId: section.courseId, summary: `Entregó las notas de «${period.name}» en «${section.name}» para revisión` }),
  ]);
  if (!ok) return reply({ error: "El periodo cambió de estado. Recarga y vuelve a intentar." }, 409);
  return reply({ gradebook: await gradebook(db, current, allowed) });
}

/** Returns a handed-in period to the section with a note: it can be edited again. */
async function giveBack(db: Database, current: Member, allowed: Access, period: OpenPeriod, input: unknown, now: string) {
  const { section } = allowed;
  const note = input && typeof input === "object" && typeof (input as Record<string, unknown>).note === "string" ? ((input as Record<string, unknown>).note as string).trim() : "";
  if (!note || note.length > maxCommentLength) return reply({ error: `Explica qué revisar, en hasta ${maxCommentLength} caracteres.` }, 400);
  if (period.review !== "submitted") return reply({ error: `«${period.name}» no está entregado a revisión.` }, 409);
  await db.batch([
    db.prepare("UPDATE section_period_reviews SET status='returned',note=?,reviewed_by=?,reviewed_at=? WHERE group_id=? AND period_id=? AND organization_id=? AND status='submitted'").bind(note, current.id, now, section.id, period.id, current.organizationId),
    event(db, current, { action: "updated", targetType: "group", targetId: section.id, courseId: section.courseId, summary: `Devolvió las notas de «${period.name}» en «${section.name}» para corregirlas` }),
  ]);
  return reply({ gradebook: await gradebook(db, current, allowed) });
}

/**
 * Replaces the course's plan for a period. It is shared by the course's sections, so it changes only while no section
 * has the period closed or handed in; activities with scores stay, and their points never drop below a score given.
 */
async function savePlan(db: Database, current: Member, section: SectionRow, period: OpenPeriod, input: unknown, now: string) {
  const items = planInput(input);
  if (typeof items === "string") return reply({ error: items }, 400);
  const { scheme } = await policyOf(db, current.organizationId, section.courseId);
  if (items.some(item => !scheme.categories.some(category => category.id === item.categoryId))) return reply({ error: "Una actividad usa una categoría que no existe en el esquema efectivo." }, 400);
  if (scheme.method === "points" && planTotal(items.filter(item => !item.extra && !item.retakeOf)) > 100) return reply({ error: `El plan suma ${planTotal(items.filter(item => !item.extra && !item.retakeOf))} puntos: no puede pasar de 100.` }, 400);
  const [existing, blocked, manual, highest, marked] = await db.batch([
    db.prepare("SELECT id,title,points FROM assessment_activities WHERE course_id=? AND period_id=? AND organization_id=?").bind(section.courseId, period.id, current.organizationId),
    db.prepare(`SELECT g.name FROM course_groups g WHERE g.course_id=? AND g.organization_id=? AND (EXISTS (SELECT 1 FROM section_period_locks l WHERE l.group_id=g.id AND l.period_id=?)
      OR EXISTS (SELECT 1 FROM section_period_reviews r WHERE r.group_id=g.id AND r.period_id=? AND r.status='submitted')) ORDER BY g.name LIMIT 1`).bind(section.courseId, current.organizationId, period.id, period.id),
    db.prepare("SELECT 1 AS found FROM section_grades s JOIN course_groups g ON g.id=s.group_id WHERE g.course_id=? AND s.period_id=? AND s.organization_id=? LIMIT 1").bind(section.courseId, period.id, current.organizationId),
    db.prepare("SELECT s.activity_id AS id,MAX(s.points) AS points FROM assessment_scores s JOIN assessment_activities a ON a.id=s.activity_id WHERE a.course_id=? AND a.period_id=? GROUP BY s.activity_id").bind(section.courseId, period.id),
    db.prepare("SELECT DISTINCT m.activity_id AS id FROM assessment_marks m JOIN assessment_activities a ON a.id=m.activity_id WHERE a.course_id=? AND a.period_id=?").bind(section.courseId, period.id),
  ]) as unknown as [{ id: string; title: string; points: number }[], { name: string }[], { found: number }[], { id: string; points: number }[], { id: string }[]];
  if (blocked[0]) return reply({ error: `«${period.name}» está cerrado o entregado en «${blocked[0].name}»: su plan de evaluación ya no cambia.` }, 409);
  if (!existing.length && items.length && manual.length) return reply({ error: `«${period.name}» ya tiene notas registradas sin plan en alguna sección del curso. Bórralas para calcular el periodo con un plan de evaluación.` }, 409);
  const own = new Map(existing.map(row => [row.id, row]));
  if (items.some(item => item.id && !own.has(item.id))) return reply({ error: "Revisa las actividades: una no es de este plan." }, 400);
  const kept = new Set(items.map(item => item.id).filter(Boolean));
  const scored = new Map(highest.map(row => [row.id, row.points]));
  const markedIds = new Set(marked.map(row => row.id));
  const removed = existing.find(row => !kept.has(row.id) && (scored.has(row.id) || markedIds.has(row.id)));
  if (removed) return reply({ error: `«${removed.title}» ya tiene ${scored.has(removed.id) ? "punteos" : "marcas"} registrados: no se puede quitar del plan.` }, 409);
  const lowered = items.find(item => item.id && (scored.get(item.id) ?? 0) > item.points);
  if (lowered) return reply({ error: `«${lowered.title}» ya tiene un punteo de ${scored.get(lowered.id!)}: sus puntos no pueden ser menos.` }, 409);
  const ids = new Set(items.map(item => item.id).filter((id): id is string => !!id));
  const invalidRetake = items.find(item => item.retakeOf && (!ids.has(item.retakeOf) || item.retakeOf === item.id));
  if (invalidRetake) return reply({ error: `La reposición «${invalidRetake.title}» debe señalar otra actividad de este plan.` }, 400);
  await db.batch([
    ...existing.filter(row => !kept.has(row.id)).map(row => db.prepare("DELETE FROM assessment_activities WHERE id=? AND organization_id=?").bind(row.id, current.organizationId)),
    ...items.map((item, position) => item.id
      ? db.prepare("UPDATE assessment_activities SET position=?,title=?,kind=?,points=?,due_on=?,category_id=?,grading=?,extra=?,retake_of=?,rubric=?,panel=?,updated_at=? WHERE id=? AND organization_id=?")
        .bind(position, item.title, item.kind, item.points, item.dueOn, item.categoryId, item.grading, item.extra ? 1 : 0, item.retakeOf, item.rubric ? JSON.stringify(item.rubric) : null, item.panel ? JSON.stringify(item.panel) : null, now, item.id, current.organizationId)
      : db.prepare("INSERT INTO assessment_activities(id,organization_id,course_id,period_id,position,title,kind,points,due_on,created_by,created_at,updated_at,category_id,grading,extra,retake_of,rubric,panel) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)")
        .bind(`assessment-${crypto.randomUUID()}`, current.organizationId, section.courseId, period.id, position, item.title, item.kind, item.points, item.dueOn, current.id, now, now, item.categoryId, item.grading, item.extra ? 1 : 0, item.retakeOf, item.rubric ? JSON.stringify(item.rubric) : null, item.panel ? JSON.stringify(item.panel) : null)),
    event(db, current, { action: "updated", targetType: "course", targetId: section.courseId, courseId: section.courseId, summary: `Actualizó el plan de evaluación de «${period.name}» (${items.length === 1 ? "1 actividad" : `${items.length} actividades`}, ${planTotal(items)} puntos)` }),
  ]);
  const allowed = await access(db, current, section.id);
  return reply({ gradebook: await gradebook(db, current, allowed as Access) });
}

/** A student's score changes, newest first. */
async function changesOf(db: Database, current: Member, section: SectionRow, learnerId: string) {
  const learner = await db.prepare("SELECT id FROM group_learners WHERE id=? AND group_id=? AND organization_id=?").bind(learnerId, section.id, current.organizationId).first<{ id: string }>();
  if (!learner) return reply({ error: "Ese estudiante no está en la lista de la sección." }, 404);
  const changes = (await db.prepare(`SELECT h.id,h.learner_id AS learnerId,h.period_id AS periodId,h.activity_id AS activityId,a.title AS activity,h.before,h.after,COALESCE(u.display_name,u.username) AS "by",h.changed_at AS "at"
    FROM section_grade_history h LEFT JOIN assessment_activities a ON a.id=h.activity_id LEFT JOIN users u ON u.id=h.changed_by
    WHERE h.group_id=? AND h.learner_id=? AND h.organization_id=? ORDER BY h.changed_at DESC,h.rowid DESC LIMIT 200`).bind(section.id, learnerId, current.organizationId).all<GradeChange>()).results;
  return reply({ changes });
}

const decimal = (value: number) => new Intl.NumberFormat("es-GT", { maximumFractionDigits: 1 }).format(value);
export const reportFooter = "Boleta informativa de Happy Learners. No sustituye el certificado oficial del Ministerio de Educación.";
async function reportCsv(db: Database, current: Member, section: SectionRow, url: URL) {
  const years = await yearsOf(db, current.organizationId, section.courseId);
  const year = years.find(item => item.id === url.searchParams.get("year")) || years.find(item => item.status === "current") || years[0];
  if (!year) return reply({ error: "Aún no hay un ciclo lectivo con notas." }, 409);
  const { policy, scheme } = await policyOf(db, current.organizationId, section.courseId);
  const book = await contents(db, current, section, year, policy, scheme, true);
  const rows: (string | number | null)[][] = [["Estudiante", ...book.periods.map(period => period.name), "Resultado", "Estado", "Razones"]];
  for (const learner of book.learners) {
    const result = book.results.find(item => item.learnerId === learner.id)!;
    rows.push([
      learner.name,
      ...book.periods.map(period => {
        const score = book.grades.find(grade => grade.learnerId === learner.id && grade.periodId === period.id)?.score ?? null;
        return score === null ? null : displayOf(scheme, score);
      }),
      result.display || null,
      result.passed === null ? "Sin notas" : result.passed ? "Aprueba" : "No aprueba",
      result.reasons?.join(" ") || "",
    ]);
  }
  const name = `notas-${`${section.courseTitle}-${section.name}`.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 80)}.csv`;
  return new Response(csvFile(rows), { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="${name}"`, "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" } });
}
/** The report card (boleta) of the section's students, or of one, for a school year: a page per student. */
async function report(db: Database, current: Member, section: SectionRow, url: URL) {
  const years = await yearsOf(db, current.organizationId, section.courseId);
  const year = years.find(item => item.id === url.searchParams.get("year")) || years.find(item => item.status === "current") || years[0];
  if (!year) return reply({ error: "Aún no hay un ciclo lectivo con notas." }, 409);
  const { policy, scheme } = await policyOf(db, current.organizationId, section.courseId);
  const book = await contents(db, current, section, year, policy, scheme, true);
  const only = url.searchParams.get("learner");
  const learners = only ? book.learners.filter(learner => learner.id === only) : book.learners;
  if (!learners.length) return reply({ error: only ? "Ese estudiante no está en la lista de la sección." : "La sección aún no tiene estudiantes." }, only ? 404 : 409);
  const [organization, educators] = await db.batch([
    db.prepare("SELECT name,timezone FROM organizations WHERE id=?").bind(current.organizationId),
    db.prepare("SELECT COALESCE(u.display_name,u.username) AS name FROM section_educators e JOIN users u ON u.id=e.user_id WHERE e.group_id=? ORDER BY name").bind(section.id),
  ]) as unknown as [{ name: string | null; timezone: string }[], { name: string }[]];
  const zone = organization[0]?.timezone || "America/Guatemala", now = new Date();
  const generated = new Intl.DateTimeFormat("es-GT", { timeZone: zone, dateStyle: "long", timeStyle: "short" }).format(now);
  const scoreText = (score: number | null) => score === null ? "—" : displayOf(scheme, score) || decimal(score);
  const blocks: PdfBlock[] = learners.flatMap((learner, index) => {
    const result = book.results.find(item => item.learnerId === learner.id)!;
    const rows: PdfBlock[] = [
      { text: learner.name, bold: true, size: 16, pageBreak: index > 0 },
      { text: `${section.courseTitle} · Sección ${section.name} · ${year.name}${year.status === "closed" ? " (cerrado)" : ""}`, size: 9.5, space: 2 },
      { text: "Periodo\tNota\tEstado", bold: true, size: 10, columns: [0, 300, 380], space: 12 },
    ];
    for (const period of book.periods) {
      const score = book.grades.find(grade => grade.learnerId === learner.id && grade.periodId === period.id)?.score ?? null;
      const review = book.reviews.find(item => item.periodId === period.id);
      const state = period.locked ? "Cerrado" : review?.status === "submitted" ? "En revisión" : "Abierto";
      rows.push({ text: `${period.name}\t${scoreText(score)}\t${state}`, size: 10, columns: [0, 300, 380], space: 3 });
      for (const activity of book.activities.filter(item => item.periodId === period.id)) {
        const earned = book.scores.find(item => item.activityId === activity.id && item.learnerId === learner.id)?.points;
        rows.push({ text: `${activity.title} (${assessmentKindLabel(activity.kind).toLowerCase()})\t${earned === undefined ? "—" : decimal(earned)} de ${decimal(activity.points)}`, size: 8.5, indent: 14, columns: [0, 286] });
      }
      const comment = book.comments.find(item => item.learnerId === learner.id && item.periodId === period.id);
      if (comment) rows.push({ text: `Comentario: ${comment.body}`, size: 8.5, indent: 14, space: 2 });
    }
    rows.push(
      { text: `Resultado del ciclo\t${result.display || scoreText(result.average)}\t${result.passed === null ? "Sin notas" : `${result.passed ? "Aprueba" : "No aprueba"}${result.complete ? "" : " (parcial)"}`}`, bold: true, size: 10.5, columns: [0, 300, 380], space: 12 },
      ...(result.reasons?.length ? [{ text: `Razones: ${result.reasons.join(" ")}`, size: 8.5, space: 3 } as PdfBlock] : []),
      { text: `Esquema: ${scheme.name}. Un periodo o actividad sin marca no cuenta como cero.`, size: 8.5, space: 6 },
      { text: "______________________________\t______________________________", size: 10, columns: [0, 260], space: 48 },
      { text: "Docente\tCoordinación académica", size: 8.5, columns: [0, 260] },
    );
    return rows;
  });
  const file = pdfFile({
    title: `Boleta · ${section.courseTitle} · ${section.name}`, footer: reportFooter,
    header: [organization[0]?.name || "Organización", `Boleta de calificaciones · Docente: ${educators.map(row => row.name).join(", ") || "Sin asignar"}`, `Generada: ${generated} (${zone})`],
    blocks,
  });
  await event(db, current, { action: "recorded", targetType: "group", targetId: section.id, courseId: section.courseId, summary: `Generó ${only ? "la boleta de un estudiante" : "las boletas"} de «${section.name}» (${year.name})` }).run();
  const name = `boleta-${`${section.courseTitle}-${section.name}${only ? `-${learners[0].name}` : ""}`.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 80)}.pdf`;
  return new Response(new TextEncoder().encode(file), { headers: { "Content-Type": "application/pdf", "Content-Disposition": `attachment; filename="${name}"`, "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" } });
}
