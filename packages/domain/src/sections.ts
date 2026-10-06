import type { ClassStatus, SectionIndicators } from "@happy-learners/contracts";

/** `completedIds` are the lessons a finished class confirmed as completed (DEC-026); without it, every lesson of the class counts. */
export type SectionClass = { status: ClassStatus; sessionDate: string; lessonIds: string[]; completedIds?: string[]; marked: number; attended: number };

/**
 * How far a section has come with its course (DEC-024), from the section's own records only: its students, its
 * classes and their attendance, and how many of the course's published lessons it has taught or planned.
 * Lessons taught that are no longer published do not count, so the progress never goes over the course.
 */
export function sectionIndicators(classes: SectionClass[], publishedLessonIds: string[], learners: number, today: string): Omit<SectionIndicators, "openings" | "started" | "finished" | "pathAverage"> {
  const held = classes.filter(item => item.status !== "cancelled");
  const taught = held.filter(item => item.status === "completed");
  const recorded = held.filter(item => item.status === "completed" || item.status === "in_progress");
  const marked = recorded.reduce((sum, item) => sum + item.marked, 0), attended = recorded.reduce((sum, item) => sum + item.attended, 0);
  const published = new Set(publishedLessonIds);
  const reached = (list: SectionClass[], done = false) => new Set(list.flatMap(item => done ? item.completedIds ?? item.lessonIds : item.lessonIds).filter(id => published.has(id))).size;
  return {
    learners,
    classes: held.length,
    taught: taught.length,
    upcoming: held.filter(item => item.status === "in_progress" || (item.status === "planned" && item.sessionDate >= today)).length,
    unrecorded: held.filter(item => item.status === "planned" && item.sessionDate < today).length,
    attendanceRate: marked ? Math.round(100 * attended / marked) : null,
    lessonsPublished: published.size,
    lessonsTaught: reached(taught, true),
    lessonsPlanned: reached(held),
  };
}

/**
 * A tu ritmo (DEC-027): how far a section's students got in the course's published lessons. A student began when
 * they opened a lesson and finished when they completed all of them; the average counts every student of the list.
 */
export function pathIndicators(publishedLessonIds: string[], completedByLearner: Map<string, Set<string>>, startedLearners: Set<string>, learnerIds: string[]): Pick<SectionIndicators, "started" | "finished" | "pathAverage"> {
  const total = publishedLessonIds.length;
  const share = (id: string) => total ? publishedLessonIds.filter(lesson => completedByLearner.get(id)?.has(lesson)).length / total : 0;
  return {
    started: learnerIds.filter(id => startedLearners.has(id)).length,
    finished: total ? learnerIds.filter(id => share(id) === 1).length : 0,
    pathAverage: learnerIds.length && total ? Math.round(100 * learnerIds.reduce((sum, id) => sum + share(id), 0) / learnerIds.length) : null,
  };
}
/** The first published lesson, in content order, that the student has not completed yet. */
export const nextInPath = (lessonIds: string[], completed: Set<string>) => lessonIds.find(id => !completed.has(id)) ?? null;

/** The default group of a section (DEC-028): every active student of its list. */
export const wholeSection = "Toda la sección";
export const maxWorkGroups = 30;
/** A work group as written: a name of up to 60 characters and distinct students of the section. */
export function workGroupInput(value: unknown): { name: string; learnerIds: string[] } | null {
  const v = value && typeof value === "object" ? value as Record<string, unknown> : null;
  const name = typeof v?.name === "string" ? v.name.trim() : "";
  if (!name || name.length > 60 || /[<>\x00-\x1f]/.test(name) || name.toLocaleLowerCase("es") === wholeSection.toLocaleLowerCase("es")) return null;
  const ids = v!.learnerIds;
  if (!Array.isArray(ids) || ids.length > 200 || ids.some(id => typeof id !== "string") || new Set(ids).size !== ids.length) return null;
  return { name, learnerIds: ids as string[] };
}
