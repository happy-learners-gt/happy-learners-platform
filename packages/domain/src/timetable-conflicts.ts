/**
 * SCH-01: conflicts in the timetable in force, so Horarios shows them before anyone generates another. Two classes
 * conflict when they overlap on the same weekday and share an educator or a classroom. Weekdays use 0 for Sunday.
 */
export interface ScheduledSection {
  id: string; name: string; educatorIds: string[]; classroomId: string | null;
  meetings: { weekday: number; startsAt: string; durationMinutes: number }[];
}
export interface TimetableConflict { kind: "educator" | "classroom"; resourceId: string; weekday: number; startsAt: string; sectionIds: [string, string] }

const minutes = (clock: string) => { const [hours, mins] = clock.split(":").map(Number); return hours * 60 + mins; };

export function timetableConflicts(sections: readonly ScheduledSection[]): TimetableConflict[] {
  const slots = sections.flatMap(section => section.meetings.map(meeting => ({ section, weekday: meeting.weekday, start: minutes(meeting.startsAt), end: minutes(meeting.startsAt) + meeting.durationMinutes, startsAt: meeting.startsAt })));
  const found: TimetableConflict[] = [];
  for (let i = 0; i < slots.length; i++) for (let j = i + 1; j < slots.length; j++) {
    const a = slots[i], b = slots[j];
    if (a.section.id === b.section.id || a.weekday !== b.weekday || a.start >= b.end || b.start >= a.end) continue;
    const later = a.start >= b.start ? a.startsAt : b.startsAt, pair = [a.section.id, b.section.id].sort() as [string, string];
    for (const educator of a.section.educatorIds.filter(id => b.section.educatorIds.includes(id))) found.push({ kind: "educator", resourceId: educator, weekday: a.weekday, startsAt: later, sectionIds: pair });
    if (a.section.classroomId && a.section.classroomId === b.section.classroomId) found.push({ kind: "classroom", resourceId: a.section.classroomId, weekday: a.weekday, startsAt: later, sectionIds: pair });
  }
  return found.sort((x, y) => x.weekday - y.weekday || x.startsAt.localeCompare(y.startsAt) || x.kind.localeCompare(y.kind));
}
