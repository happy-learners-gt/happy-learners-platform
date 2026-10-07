import type { Activity } from "@happy-learners/contracts";

/** A lesson lasts what its activities add up to; a lesson without activities keeps the duration it was given. */
export function lessonMinutes(lesson: { duration?: number; activities?: Pick<Activity, "minutes">[] }) {
  const total = (lesson.activities || []).reduce((sum, activity) => sum + (Number(activity.minutes) || 0), 0);
  return total || Number(lesson.duration) || 0;
}

/** 80 → «1 h 20 min»; 45 → «45 min». */
export function formatMinutes(minutes: number) {
  const hours = Math.floor(minutes / 60), rest = minutes % 60;
  return hours ? `${hours} h${rest ? ` ${rest} min` : ""}` : `${rest} min`;
}

export type ClassLoad = { planned: number; available: number | null; excess: number; state: "empty" | "unknown" | "fits" | "full" | "over" };
/**
 * How the lessons planned for a class compare with its duration. Exceeding it is allowed (a long lesson may
 * continue in the next class) but is reported; «full» means the plan uses at least 90 % of the class.
 */
export function classLoad(available: number | null | undefined, lessonMinutes: number[]): ClassLoad {
  const planned = lessonMinutes.reduce((sum, minutes) => sum + minutes, 0);
  const duration = available && available > 0 ? available : null;
  if (!lessonMinutes.length) return { planned, available: duration, excess: 0, state: "empty" };
  if (!duration) return { planned, available: null, excess: 0, state: "unknown" };
  const excess = Math.max(0, planned - duration);
  return { planned, available: duration, excess, state: excess ? "over" : planned >= duration * 0.9 ? "full" : "fits" };
}
