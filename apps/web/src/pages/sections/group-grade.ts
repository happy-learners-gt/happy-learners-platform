import type { AssessmentActivity, AtomicMark, Gradebook } from "@happy-learners/contracts";
import { groupToIndividual } from "@happy-learners/domain";
import { formatNumber } from "../../regional";

const points = (value: number) => formatNumber(value, { maximumFractionDigits: 1 });
const factorText = (value: number) => formatNumber(value, { minimumFractionDigits: 1, maximumFractionDigits: 1 });

/** Where a student's mark came from: the group, an adjustment, or a grade written by hand. */
export function originLabel(book: Gradebook, activity: AssessmentActivity, learnerId: string): string | null {
  const mark = storedMark(book, activity.id, learnerId);
  if (mark?.kind === "exempt") return null;
  const source = storedSource(book, activity.id, learnerId);
  if (source === "individual") return "propia";
  const adjustment = book.groupAdjustments?.find(item => item.activityId === activity.id && item.learnerId === learnerId);
  if (adjustment?.kind === "override") return "propia";
  if (adjustment?.kind === "factor") return `ajustada ×${factorText(adjustment.value)}`;
  if (source !== "group") return null;
  const peer = peerFactor(book, activity, learnerId);
  if (peer !== null && Math.abs(peer - 1) > 0.001) return `ajustada ×${factorText(peer)}`;
  return "del grupo";
}

/** The mark a student shows for a group activity, after the copy and any adjustment. */
export function resultText(book: Gradebook, activity: AssessmentActivity, learnerId: string, levels?: { id: string; label: string }[]): string | null {
  const mark = storedMark(book, activity.id, learnerId);
  if (mark?.kind === "exempt") return "Exonerado";
  const score = book.scores.find(item => item.activityId === activity.id && item.learnerId === learnerId);
  if (score && (activity.grading || "points") === "points") return points(score.points);
  if (!mark) return score ? points(score.points) : null;
  if (mark.kind === "points") return points(mark.value);
  if (mark.kind === "pass") return mark.value ? "Aprobado" : "No aprobado";
  if (mark.kind === "level") return levels?.find(level => level.id === mark.value)?.label || mark.value;
  if (mark.kind === "rubric" && activity.rubric) return String(rubricTotal(activity.rubric, mark.choices));
  return null;
}

/** Factors of one group from the ratings on screen, before they are saved. */
export function liveFactors(activity: AssessmentActivity, learnerIds: string[], ratings: { raterId: string; rateeId: string; score: number }[], mark: AtomicMark | null) {
  const assignments = groupToIndividual({
    points: activity.points,
    grading: activity.grading || "points",
    ...(activity.rubric ? { rubric: activity.rubric } : {}),
    peerMin: activity.peerMin,
    peerMax: activity.peerMax,
    groups: [{ id: "grupo", learnerIds }],
    marks: mark ? [{ workGroupId: "grupo", mark }] : [],
    adjustments: [],
    peerRatings: ratings,
    roster: learnerIds,
  });
  return new Map(assignments.map(item => [item.learnerId, item.factor ?? 1]));
}

export { factorText };

function storedMark(book: Gradebook, activityId: string, learnerId: string) {
  return book.marks?.find(item => item.activityId === activityId && item.learnerId === learnerId && item.evaluatorId === null)?.mark;
}

function storedSource(book: Gradebook, activityId: string, learnerId: string) {
  return book.scores.find(item => item.activityId === activityId && item.learnerId === learnerId)?.source
    || book.marks?.find(item => item.activityId === activityId && item.learnerId === learnerId && item.evaluatorId === null)?.source;
}

function peerFactor(book: Gradebook, activity: AssessmentActivity, learnerId: string) {
  const ratings = (book.peerRatings || []).filter(item => item.activityId === activity.id);
  const peer = book.groupAdjustments?.find(item => item.activityId === activity.id && item.learnerId === learnerId && item.kind === "peer");
  if (!ratings.length && !peer) return null;
  const groups = (book.workGroups || []).filter(group => group.setId === activity.workGroupSetId).map(group => ({ id: group.id, learnerIds: group.learnerIds }));
  const assignment = groupToIndividual({
    points: activity.points,
    grading: activity.grading || "points",
    ...(activity.rubric ? { rubric: activity.rubric } : {}),
    peerMin: activity.peerMin,
    peerMax: activity.peerMax,
    groups,
    marks: (book.groupMarks || []).filter(item => item.activityId === activity.id),
    adjustments: peer ? [peer] : [],
    peerRatings: ratings,
    roster: [learnerId],
  }).find(item => item.learnerId === learnerId);
  return assignment?.factor ?? null;
}

function rubricTotal(rubric: NonNullable<AssessmentActivity["rubric"]>, choices: Record<string, string>) {
  const weight = rubric.criteria.reduce((sum, criterion) => sum + criterion.weight, 0) || 1;
  return Math.round(rubric.criteria.reduce((sum, criterion) => {
    const level = criterion.levels.find(item => item.id === choices[criterion.id]);
    return sum + (level ? level.points * criterion.weight : 0);
  }, 0) / weight);
}
