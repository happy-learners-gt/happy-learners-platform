import type { LessonNavigation } from "@happy-learners/contracts";

/** A lesson of a module in curriculum order, with what decides whether students can open it. */
export interface ModuleLesson { id: string; title: string; shareCode?: string; published: boolean; archived: boolean }

/**
 * Position, previous and next of a published lesson within its module. Unpublished and archived lessons are
 * skipped, so the count and the links only reach content students can open.
 */
export function moduleNavigation(moduleName: string, lessons: ModuleLesson[], currentId: string): LessonNavigation | null {
  const open = lessons.filter(lesson => lesson.published && !lesson.archived && lesson.shareCode);
  const index = open.findIndex(lesson => lesson.id === currentId);
  if (index < 0) return null;
  const link = (lesson?: ModuleLesson) => lesson ? { title: lesson.title, shareCode: lesson.shareCode! } : null;
  return { moduleName, position: index + 1, total: open.length, previous: link(open[index - 1]), next: link(open[index + 1]) };
}
