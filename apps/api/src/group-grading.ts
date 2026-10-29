import type { AtomicMark, Member } from "@happy-learners/contracts";
import { groupToIndividual, pointsInput, rubricInput, schemeFromSettings } from "@happy-learners/domain";
import type { Database, Prepared } from "./storage";
import { configurationOf } from "./courses";
import { gradingSchemesFor } from "./grading-schemes";
import { event } from "./team";

/**
 * Group marks for one activity. The group mark is copied onto each member, with that student's
 * adjustment, and stored as an ordinary score or mark (source "group"). A hand-written mark
 * (source "individual") and an exemption stay as they are. A student in no group gets nothing.
 */
const reply = (value: unknown, status = 200) => Response.json(value, { status });
type Section = { id: string; name: string; courseId: string; status: "active" | "archived"; courseStatus: "active" | "archived" };
type Allowed = { section: Section; write: boolean };
type Activity = {
  id: string; title: string; points: number; grading: "points" | "rubric" | "pass-fail" | "level" | "panel";
  rubric: string | null; groupMode: string; setId: string | null; periodId: string;
  peerMin: number; peerMax: number; lockedAt: string | null; review: string | null; yearStatus: string;
};

const closed = "Las notas de este periodo están cerradas o entregadas a revisión.";

async function activityOf(db: Database, current: Member, section: Section, activityId: string) {
  return db.prepare(`SELECT a.id,a.title,a.points,a.grading,a.rubric,a.group_mode AS groupMode,a.work_group_set_id AS setId,a.period_id AS periodId,
    a.peer_min AS peerMin,a.peer_max AS peerMax,l.locked_at AS lockedAt,r.status AS review,y.status AS yearStatus
    FROM assessment_activities a JOIN academic_periods p ON p.id=a.period_id JOIN academic_years y ON y.id=p.year_id
    LEFT JOIN section_period_locks l ON l.period_id=a.period_id AND l.group_id=?
    LEFT JOIN section_period_reviews r ON r.period_id=a.period_id AND r.group_id=?
    WHERE a.id=? AND a.course_id=? AND a.organization_id=?`).bind(section.id, section.id, activityId, section.courseId, current.organizationId).first<Activity>();
}

function groupMarkInput(input: unknown, activity: Activity): AtomicMark | { error: string } {
  const value = input && typeof input === "object" ? input as Record<string, unknown> : null;
  if (!value) return { error: `Revisa la marca de «${activity.title}».` };
  if (activity.grading === "points" && value.kind === "points") {
    const points = pointsInput(value.value, activity.points);
    if (typeof points !== "number") return { error: `El punteo de «${activity.title}» va de 0 a ${activity.points}, con un decimal como máximo.` };
    return { kind: "points", value: points };
  }
  if (activity.grading === "pass-fail" && value.kind === "pass" && typeof value.value === "boolean") return { kind: "pass", value: value.value };
  if (activity.grading === "level" && value.kind === "level" && typeof value.value === "string" && value.value.trim()) return { kind: "level", value: value.value.trim() };
  if (activity.grading === "rubric" && value.kind === "rubric" && value.choices && typeof value.choices === "object" && !Array.isArray(value.choices)) {
    const rubric = activity.rubric ? JSON.parse(activity.rubric) as NonNullable<Activity["rubric"]> : null;
    const checked = rubricInput(rubric);
    if (!rubric || "error" in checked) return { error: `«${activity.title}» no tiene una rúbrica válida.` };
    const choices = value.choices as Record<string, unknown>;
    if (Object.keys(choices).length !== checked.criteria.length || checked.criteria.some(criterion => !criterion.levels.some(level => level.id === choices[criterion.id])) || Object.values(choices).some(choice => typeof choice !== "string")) {
      return { error: `Completa todos los criterios de «${activity.title}».` };
    }
    return { kind: "rubric", choices: choices as Record<string, string> };
  }
  return { error: `Revisa la marca de «${activity.title}».` };
}

async function propagate(db: Database, current: Member, section: Section, activity: Activity, summary: string, recompute: (learnerId: string, periodId: string) => Promise<void>) {
  const setId = activity.setId!;
  const [groups, markRows, adjustmentRows, ratingRows, scoreRows, storedMarks, roster] = await db.batch([
    db.prepare("SELECT id,(SELECT json_group_array(learner_id) FROM work_group_members WHERE work_group_id=work_groups.id) AS learnerIds FROM work_groups WHERE set_id=?").bind(setId),
    db.prepare("SELECT work_group_id AS workGroupId,mark FROM assessment_group_marks WHERE activity_id=?").bind(activity.id),
    db.prepare("SELECT learner_id AS learnerId,kind,value FROM assessment_group_adjustments WHERE activity_id=?").bind(activity.id),
    db.prepare("SELECT rater_id AS raterId,ratee_id AS rateeId,score FROM assessment_peer_ratings WHERE activity_id=?").bind(activity.id),
    db.prepare("SELECT learner_id AS learnerId,source FROM assessment_scores WHERE activity_id=? AND group_id=?").bind(activity.id, section.id),
    db.prepare("SELECT id,learner_id AS learnerId,evaluator_id AS evaluatorId,mark,source FROM assessment_marks WHERE activity_id=? AND group_id=?").bind(activity.id, section.id),
    db.prepare("SELECT id FROM group_learners WHERE group_id=? AND organization_id=? AND status='active'").bind(section.id, current.organizationId),
  ]) as unknown as [
    { id: string; learnerIds: string | null }[], { workGroupId: string; mark: string }[],
    { learnerId: string; kind: "factor" | "override" | "peer"; value: number }[],
    { raterId: string; rateeId: string; score: number }[], { learnerId: string; source: string }[],
    { id: string; learnerId: string; evaluatorId: string | null; mark: string; source: string }[], { id: string }[],
  ];
  const exempt = new Set<string>();
  const manual = new Set<string>();
  for (const row of scoreRows) if (row.source === "individual") manual.add(row.learnerId);
  for (const row of storedMarks) {
    if (row.evaluatorId) continue;
    const mark = JSON.parse(row.mark) as AtomicMark;
    if (mark.kind === "exempt") exempt.add(row.learnerId);
    else if (row.source === "individual") manual.add(row.learnerId);
  }
  const rubric = activity.rubric ? JSON.parse(activity.rubric) : undefined;
  const assignments = groupToIndividual({
    points: activity.points, grading: activity.grading, ...(rubric ? { rubric } : {}),
    peerMin: activity.peerMin, peerMax: activity.peerMax,
    groups: groups.map(group => ({ id: group.id, learnerIds: (JSON.parse(group.learnerIds || "[]") as (string | null)[]).filter((id): id is string => !!id) })),
    marks: markRows.map(row => ({ workGroupId: row.workGroupId, mark: JSON.parse(row.mark) as AtomicMark })),
    adjustments: adjustmentRows, peerRatings: ratingRows, exemptLearnerIds: [...exempt], manualLearnerIds: [...manual],
    roster: roster.map(learner => learner.id),
  });
  const now = new Date().toISOString();
  const writes: Prepared[] = [];
  const touched = new Set<string>();
  for (const assignment of assignments) {
    const markRow = storedMarks.find(row => row.learnerId === assignment.learnerId && row.evaluatorId === null);
    const scoreRow = scoreRows.find(row => row.learnerId === assignment.learnerId);
    if (assignment.source !== "group" || !assignment.mark) {
      if (scoreRow?.source === "group") writes.push(db.prepare("DELETE FROM assessment_scores WHERE activity_id=? AND learner_id=? AND group_id=? AND source='group'").bind(activity.id, assignment.learnerId, section.id));
      if (markRow?.source === "group") writes.push(db.prepare("DELETE FROM assessment_marks WHERE id=? AND source='group'").bind(markRow.id));
      if (scoreRow?.source === "group" || markRow?.source === "group") touched.add(assignment.learnerId);
      continue;
    }
    const useScore = activity.grading === "points" && assignment.mark.kind === "points";
    if (useScore && assignment.mark.kind === "points") {
      if (scoreRow?.source === "individual") continue;
      writes.push(db.prepare(`INSERT INTO assessment_scores(activity_id,organization_id,group_id,learner_id,points,updated_by,updated_at,source) VALUES (?,?,?,?,?,?,?,'group')
        ON CONFLICT(activity_id,learner_id) DO UPDATE SET points=excluded.points,updated_by=excluded.updated_by,updated_at=excluded.updated_at,source='group' WHERE assessment_scores.source='group'`)
        .bind(activity.id, current.organizationId, section.id, assignment.learnerId, assignment.mark.value, current.id, now));
      if (markRow?.source === "group") writes.push(db.prepare("DELETE FROM assessment_marks WHERE id=? AND source='group'").bind(markRow.id));
    } else {
      const after = JSON.stringify(assignment.mark);
      if (markRow?.source === "individual") continue;
      writes.push(markRow
        ? db.prepare("UPDATE assessment_marks SET mark=?,updated_by=?,updated_at=?,source='group' WHERE id=? AND source='group'").bind(after, current.id, now, markRow.id)
        : db.prepare("INSERT INTO assessment_marks(id,activity_id,organization_id,group_id,learner_id,evaluator_id,mark,updated_by,updated_at,source) VALUES (?,?,?,?,?,NULL,?,?,?,'group')")
          .bind(`mark-${crypto.randomUUID()}`, activity.id, current.organizationId, section.id, assignment.learnerId, after, current.id, now));
      if (scoreRow?.source === "group") writes.push(db.prepare("DELETE FROM assessment_scores WHERE activity_id=? AND learner_id=? AND group_id=? AND source='group'").bind(activity.id, assignment.learnerId, section.id));
    }
    touched.add(assignment.learnerId);
  }
  writes.push(event(db, current, { action: "recorded", targetType: "group", targetId: section.id, courseId: section.courseId, summary }));
  await db.batch(writes);
  for (const learnerId of touched) await recompute(learnerId, activity.periodId);
}

export async function groupGrades(
  db: Database, current: Member, allowed: Allowed, activityId: string, action: "groups" | "adjustments" | "peer-ratings",
  input: unknown, recompute: (learnerId: string, periodId: string) => Promise<void>,
): Promise<Response | null> {
  if (!allowed.write) return reply({ error: allowed.section.status !== "active" || allowed.section.courseStatus !== "active" ? "La sección está cerrada: sus notas ya no cambian." : "Solo administración y quienes imparten la sección registran sus notas." }, 403);
  const activity = await activityOf(db, current, allowed.section, activityId);
  if (!activity) return reply({ error: "Esa actividad no está en el plan de esta sección." }, 404);
  if (activity.groupMode !== "group" || !activity.setId) return reply({ error: "Esta actividad se califica de forma individual." }, 400);
  if (activity.yearStatus !== "current" || activity.lockedAt || activity.review === "submitted") return reply({ error: closed }, 409);
  const body = input && typeof input === "object" ? input as Record<string, unknown> : {};
  const now = new Date().toISOString();
  if (action === "groups") {
    if (typeof body.workGroupId !== "string") return reply({ error: "Elige el grupo que calificas." }, 400);
    const belongs = await db.prepare("SELECT id,name FROM work_groups WHERE id=? AND set_id=? AND group_id=?").bind(body.workGroupId, activity.setId, allowed.section.id).first<{ id: string; name: string }>();
    if (!belongs) return reply({ error: "Elige un grupo de este conjunto." }, 400);
    const mark = groupMarkInput(body.mark, activity);
    if ("error" in mark) return reply(mark, 400);
    if (mark.kind === "level") {
      const settings = (await configurationOf(db, current.organizationId, allowed.section.courseId))!.settings;
      const scheme = settings.gradingSchemeId ? (await gradingSchemesFor(db, current.organizationId)).find(item => item.id === settings.gradingSchemeId) : null;
      const levels = (scheme || schemeFromSettings(settings)).levels;
      if (!levels?.some(level => level.id === mark.value)) return reply({ error: "Ese nivel no existe en el esquema." }, 400);
    }
    await db.prepare(`INSERT INTO assessment_group_marks(activity_id,work_group_id,organization_id,group_id,mark,updated_by,updated_at) VALUES (?,?,?,?,?,?,?)
      ON CONFLICT(activity_id,work_group_id) DO UPDATE SET mark=excluded.mark,updated_by=excluded.updated_by,updated_at=excluded.updated_at`)
      .bind(activity.id, belongs.id, current.organizationId, allowed.section.id, JSON.stringify(mark), current.id, now).run();
    await propagate(db, current, allowed.section, activity, `Calificó el grupo «${belongs.name}» en «${activity.title}» de «${allowed.section.name}»`, recompute);
    return null;
  }
  if (action === "adjustments") {
    if (typeof body.learnerId !== "string") return reply({ error: "Elige al estudiante del ajuste." }, 400);
    const member = await db.prepare("SELECT m.learner_id AS id FROM work_group_members m JOIN work_groups w ON w.id=m.work_group_id WHERE w.set_id=? AND m.learner_id=?").bind(activity.setId, body.learnerId).first();
    if (!member) return reply({ error: "Ese estudiante no está en un grupo de este conjunto." }, 400);
    if (body.clear === true) {
      await db.prepare("DELETE FROM assessment_group_adjustments WHERE activity_id=? AND learner_id=? AND group_id=?").bind(activity.id, body.learnerId, allowed.section.id).run();
      await propagate(db, current, allowed.section, activity, `Quitó el ajuste grupal de un estudiante en «${activity.title}» de «${allowed.section.name}»`, recompute);
      return null;
    }
    if (body.kind !== "factor" && body.kind !== "override" && body.kind !== "peer") return reply({ error: "Elige un ajuste: factor, nota propia o coevaluación." }, 400);
    const value = body.kind === "override" ? pointsInput(body.value, activity.points) : typeof body.value === "number" && Number.isFinite(body.value) ? body.value : undefined;
    if (typeof value !== "number" || (body.kind !== "override" && (value < 0 || value > 2))) return reply({ error: body.kind === "override" ? `La nota propia va de 0 a ${activity.points}.` : "El factor va de 0 a 2." }, 400);
    const note = body.note === undefined || body.note === null || body.note === "" ? null : typeof body.note === "string" ? body.note.trim() : undefined;
    if (note === undefined || (note && note.length > 200)) return reply({ error: "La nota del ajuste cabe en 200 caracteres." }, 400);
    await db.prepare(`INSERT INTO assessment_group_adjustments(activity_id,learner_id,organization_id,group_id,kind,value,note,updated_by,updated_at) VALUES (?,?,?,?,?,?,?,?,?)
      ON CONFLICT(activity_id,learner_id) DO UPDATE SET kind=excluded.kind,value=excluded.value,note=excluded.note,updated_by=excluded.updated_by,updated_at=excluded.updated_at`)
      .bind(activity.id, body.learnerId, current.organizationId, allowed.section.id, body.kind, value, note, current.id, now).run();
    await propagate(db, current, allowed.section, activity, `Ajustó la nota grupal de un estudiante en «${activity.title}» de «${allowed.section.name}»`, recompute);
    return null;
  }
  if (!Array.isArray(body.ratings) || body.ratings.length > 500) return reply({ error: "Revisa la coevaluación." }, 400);
  const groups = (await db.prepare("SELECT id,(SELECT json_group_array(learner_id) FROM work_group_members WHERE work_group_id=work_groups.id) AS learnerIds FROM work_groups WHERE set_id=?").bind(activity.setId).all<{ id: string; learnerIds: string | null }>()).results;
  const groupOf = new Map<string, string>();
  for (const group of groups) for (const id of (JSON.parse(group.learnerIds || "[]") as (string | null)[]).filter((item): item is string => !!item)) groupOf.set(id, group.id);
  const ratings: { raterId: string; rateeId: string; score: number }[] = [];
  for (const item of body.ratings) {
    if (!item || typeof item !== "object") return reply({ error: "Revisa la coevaluación." }, 400);
    const rating = item as Record<string, unknown>;
    const score = pointsInput(rating.score, 5);
    if (typeof rating.raterId !== "string" || typeof rating.rateeId !== "string" || typeof score !== "number") return reply({ error: "Cada coevaluación va de 0 a 5, con un decimal como máximo." }, 400);
    if (rating.raterId === rating.rateeId || !groupOf.has(rating.raterId) || groupOf.get(rating.raterId) !== groupOf.get(rating.rateeId)) return reply({ error: "La coevaluación es entre dos estudiantes distintos del mismo grupo." }, 400);
    ratings.push({ raterId: rating.raterId, rateeId: rating.rateeId, score });
  }
  if (new Set(ratings.map(rating => `${rating.raterId}:${rating.rateeId}`)).size !== ratings.length) return reply({ error: "Hay una coevaluación repetida." }, 400);
  await db.batch([
    db.prepare("DELETE FROM assessment_peer_ratings WHERE activity_id=?").bind(activity.id),
    ...ratings.map(rating => db.prepare("INSERT INTO assessment_peer_ratings(activity_id,rater_id,ratee_id,score,updated_by,updated_at) VALUES (?,?,?,?,?,?)").bind(activity.id, rating.raterId, rating.rateeId, rating.score, current.id, now)),
  ]);
  await propagate(db, current, allowed.section, activity, `Registró la coevaluación de «${activity.title}» en «${allowed.section.name}»`, recompute);
  return null;
}
