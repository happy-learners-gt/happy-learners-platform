import type { AssignmentAvailability, AssignmentPeriod } from "@happy-learners/contracts";

/** Facts the server knows about the lesson behind an assignment. */
export interface AssignedLessonFacts { archived: boolean; published: boolean; revision: number }

/**
 * An assignment keeps the publication it was made with. A newer publication is identified ("updated") and students
 * already receive it; an archived or unpublished lesson leaves the group without content and requires substitution.
 */
export function assignmentAvailability(lesson: AssignedLessonFacts, assignedRevision: number): AssignmentAvailability {
  if (lesson.archived || !lesson.published || lesson.revision < 1) return "unavailable";
  return lesson.revision > assignedRevision ? "updated" : "current";
}

/** Where today falls in the assignment's period; dates are calendar days (YYYY-MM-DD). */
export function assignmentPeriod(startsOn: string, endsOn: string | null | undefined, today: string): AssignmentPeriod {
  if (today < startsOn) return "upcoming";
  return endsOn && today > endsOn ? "ended" : "active";
}

const DAY = /^\d{4}-\d{2}-\d{2}$/;
export function isCalendarDay(value: unknown): value is string {
  if (typeof value !== "string" || !DAY.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

/** Validates the period of an assignment; returns an error message or null. */
export function assignmentPeriodError(startsOn: unknown, endsOn: unknown): string | null {
  if (!isCalendarDay(startsOn)) return "Indica desde qué fecha aplica la lección programada.";
  if (endsOn !== null && endsOn !== undefined && endsOn !== "") {
    if (!isCalendarDay(endsOn)) return "La fecha de término no es válida.";
    if (endsOn < startsOn) return "La fecha de término debe ser igual o posterior a la de inicio.";
  }
  return null;
}

/** The publication an assignment delivers today: the lesson's current, non-archived publication, never a draft. */
export interface EffectivePublication { revision: number; shareCode: string }
export function effectivePublication(lesson: AssignedLessonFacts & { shareCode?: string | null }): EffectivePublication | null {
  if (lesson.archived || !lesson.published || lesson.revision < 1 || !lesson.shareCode) return null;
  return { revision: lesson.revision, shareCode: lesson.shareCode };
}
