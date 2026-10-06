import type { ClassStatus, SectionIndicators } from "@happy-learners/contracts";

/** `completedIds` are the lessons a finished class confirmed as completed (DEC-026); without it, every lesson of the class counts. */
export type SectionClass = { status: ClassStatus; sessionDate: string; lessonIds: string[]; completedIds?: string[]; marked: number; attended: number };

/**
 * How far a section has come with its course (DEC-024), from the section's own records only: its students, its
 * classes and their attendance, and how many of the course's published lessons it has taught or planned.
 * Lessons taught that are no longer published do not count, so the progress never goes over the course.
 */
export function sectionIndicators(classes: SectionClass[], publishedLessonIds: string[], learners: number, today: string): Omit<SectionIndicators, "openings"> {
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
