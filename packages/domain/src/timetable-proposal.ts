import type { ClassStatus } from "@happy-learners/contracts";

/**
 * Proposed timetable (1.4.2, docs/design/asistente-ia.md §6d): the section's pending lessons, in the order of its
 * content, spread over its next classes without a plan. Deterministic: rules decide, no model. Classes that already have
 * lessons keep them; lessons already planned or taught are not proposed again; a lesson longer than a class goes alone
 * and is flagged.
 */
export interface ProposalLesson { id: string; title: string; minutes: number }
export interface ProposalSession { id: string; sessionDate: string; startsAt: string | null; durationMinutes: number | null; status: ClassStatus; lessonIds: string[]; completedLessonIds?: string[] }
export interface TimetableAssignment { sessionId: string; sessionDate: string; startsAt: string | null; capacity: number; minutes: number; lessons: ProposalLesson[]; overflow: boolean }
export interface TimetableProposal { assignments: TimetableAssignment[]; unplanned: ProposalLesson[]; keptSessions: number; freeSessions: number }

export const defaultClassMinutes = 45;

export function proposeTimetable(lessons: ProposalLesson[], sessions: ProposalSession[], today: string, maxPerClass = 6): TimetableProposal {
  const active = sessions.filter(session => session.status !== "cancelled");
  const done = new Set(active.flatMap(session => [...session.lessonIds, ...(session.completedLessonIds || [])]));
  const pending = lessons.filter(lesson => !done.has(lesson.id));
  const open = active.filter(session => session.status === "planned" && session.sessionDate >= today && !session.lessonIds.length)
    .sort((a, b) => a.sessionDate.localeCompare(b.sessionDate) || (a.startsAt || "").localeCompare(b.startsAt || ""));
  const assignments: TimetableAssignment[] = [];
  let next = 0;
  for (const session of open) {
    if (next >= pending.length) break;
    const capacity = session.durationMinutes || defaultClassMinutes;
    const chosen: ProposalLesson[] = [];
    let minutes = 0;
    // A lesson longer than the class goes alone; otherwise lessons are added while they fit.
    while (next < pending.length && chosen.length < maxPerClass && (chosen.length === 0 || minutes + pending[next].minutes <= capacity)) {
      chosen.push(pending[next]); minutes += pending[next].minutes; next++;
      if (minutes > capacity) break;
    }
    assignments.push({ sessionId: session.id, sessionDate: session.sessionDate, startsAt: session.startsAt, capacity, minutes, lessons: chosen, overflow: minutes > capacity });
  }
  return {
    assignments, unplanned: pending.slice(next),
    keptSessions: active.filter(session => session.lessonIds.length && session.status === "planned" && session.sessionDate >= today).length,
    freeSessions: open.length - assignments.length,
  };
}
