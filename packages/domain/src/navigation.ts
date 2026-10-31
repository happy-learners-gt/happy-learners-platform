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

/** The menu never lists more courses than this without a link to all of them. */
export const menuCourseLimit = 8;

/** What the menu needs of a course to rank it; a subset of `Course`. */
export interface MenuCourse { id: string; title: string; status: "active" | "archived"; updatedAt: string; team?: { userId: string }[] }

/**
 * The courses the menu lists, in alphabetical order, and how many active ones it leaves for «Todos los cursos».
 * Which ones: the open course; then those the person opened recently (most recent first); then those whose team they
 * are in; then the most recently changed. Up to `limit + 2` active courses are all listed: hiding one or two saves no
 * space and makes them harder to find.
 */
export function menuCourses<T extends MenuCourse>(courses: readonly T[], person: { id: string; current?: string; recent?: readonly string[] }, limit = menuCourseLimit): { listed: T[]; hidden: number } {
  const active = courses.filter(course => course.status === "active" || course.id === person.current);
  const byTitle = (a: T, b: T) => a.title.localeCompare(b.title, "es", { numeric: true });
  if (active.length <= limit + 2) return { listed: [...active].sort(byTitle), hidden: 0 };
  const recent = person.recent || [];
  const rank = (course: T) => course.id === person.current ? [0, 0]
    : recent.includes(course.id) ? [1, recent.indexOf(course.id)]
    : course.team?.some(member => member.userId === person.id) ? [2, 0] : [3, 0];
  const listed = [...active].sort((a, b) => {
    const [ra, ia] = rank(a), [rb, ib] = rank(b);
    return ra - rb || ia - ib || b.updatedAt.localeCompare(a.updatedAt) || byTitle(a, b);
  }).slice(0, limit);
  return { listed: listed.sort(byTitle), hidden: active.filter(course => course.status === "active").length - listed.filter(course => course.status === "active").length };
}

/** Records a course as recently opened, most recent first, without repeats; returns the new list. */
export function rememberCourse(recent: readonly string[], id: string, limit = menuCourseLimit): string[] {
  return [id, ...recent.filter(item => item !== id)].slice(0, limit);
}
