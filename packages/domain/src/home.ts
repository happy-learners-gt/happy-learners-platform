import type { CourseProgress } from "@happy-learners/contracts";

/** Why a course needs someone's attention on Inicio (HOME-01), from the progress Inicio already reads. */
export type AttentionReason = "low-attendance" | "no-plan" | "unassessed" | "unpublished-changes" | "inactive" | "drafts";
export const attentionLabels: Record<AttentionReason, string> = {
  "low-attendance": "Asistencia baja", "no-plan": "Sin plan curricular", unassessed: "Resultados sin evaluar",
  "unpublished-changes": "Cambios sin publicar", inactive: "Sin actividad en 30 días", drafts: "Lecciones sin publicar",
};
/** Heavier first: what affects students now outweighs what affects the team's work. */
const weight: Record<AttentionReason, number> = { "low-attendance": 3, "no-plan": 3, unassessed: 2, "unpublished-changes": 2, inactive: 1, drafts: 1 };
/** Below this attendance (percent), a course with classes needs attention. */
export const lowAttendance = 85;

/** The reasons a course needs attention, heaviest first; a course without students only counts its content. */
export function courseAttention(course: CourseProgress, today: string): AttentionReason[] {
  const taught = course.learners > 0, reasons: AttentionReason[] = [];
  if (taught && course.attendanceRate !== null && course.attendanceRate < lowAttendance) reasons.push("low-attendance");
  if (taught && !course.outcomes) reasons.push("no-plan");
  if (taught && course.outcomes > 0 && course.assessed < course.outcomes) reasons.push("unassessed");
  if (course.changes > 0) reasons.push("unpublished-changes");
  if (taught && (!course.lastActivity || daysBetween(course.lastActivity.slice(0, 10), today) > 30)) reasons.push("inactive");
  if (course.published < course.lessons) reasons.push("drafts");
  return reasons.sort((a, b) => weight[b] - weight[a]);
}
const daysBetween = (from: string, to: string) => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);

/**
 * The courses Inicio lists, at most `limit`: those that need attention, the heaviest first; if none do, the most recently
 * active. Up to `limit + 2` courses are all listed, as in the menu. `hidden` is how many «Ver todos» leads to.
 */
export function homeCourses(courses: readonly CourseProgress[], today: string, limit = 6): { listed: { course: CourseProgress; reasons: AttentionReason[] }[]; attention: boolean; hidden: number } {
  const ranked = courses.map(course => ({ course, reasons: courseAttention(course, today) }));
  const score = (item: typeof ranked[number]) => item.reasons.reduce((sum, reason) => sum + weight[reason], 0);
  const recent = (a: typeof ranked[number], b: typeof ranked[number]) => (b.course.lastActivity || "").localeCompare(a.course.lastActivity || "") || a.course.title.localeCompare(b.course.title, "es", { numeric: true });
  if (courses.length <= limit + 2) return { listed: ranked, attention: ranked.some(item => item.reasons.length > 0), hidden: 0 };
  const flagged = ranked.filter(item => item.reasons.length).sort((a, b) => score(b) - score(a) || recent(a, b));
  const listed = (flagged.length ? flagged : [...ranked].sort(recent)).slice(0, limit);
  return { listed, attention: flagged.length > 0, hidden: courses.length - listed.length };
}
