const DAY = /^\d{4}-\d{2}-\d{2}$/;

/** A real calendar day written as YYYY-MM-DD. */
export function isCalendarDay(value: unknown): value is string {
  if (typeof value !== "string" || !DAY.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

/** Days of the week as the schedule stores them: 0 is Sunday. Listed from Monday, the way a school week reads. */
export const weekdays = [[1, "Lunes", "lun"], [2, "Martes", "mar"], [3, "Miércoles", "mié"], [4, "Jueves", "jue"], [5, "Viernes", "vie"], [6, "Sábado", "sáb"], [0, "Domingo", "dom"]] as const;
export const maxScheduleDays = 366, maxScheduledClasses = 400;

/** One weekly meeting of a section (1.2.4): its day, start and length. At most one per day; a double period is one meeting. */
export type ScheduleMeeting = { weekday: number; startsAt: string; durationMinutes: number };
/**
 * A section's weekly schedule. `startsAt` and `durationMinutes` are the same every day unless `meetings` gives each
 * day its own; then they repeat the first meeting of the week, for readers that only know one time.
 */
export type SectionSchedule = { weekdays: number[]; startsAt: string; durationMinutes: number; from: string; until: string; meetings?: ScheduleMeeting[] };
const clock = /^([01]\d|2[0-3]):[0-5]\d$/;
const weekPosition = (day: number) => (day + 6) % 7;

/**
 * Validates a section's weekly schedule: one time for every class day ({ weekdays, startsAt, durationMinutes }) or a
 * time per day ({ meetings }). Returns the clean schedule or a message that says what to fix. Meetings that all share
 * the same time become the single-time form.
 */
export function scheduleInput(input: unknown): SectionSchedule | { error: string } {
  const value = input && typeof input === "object" ? input as Record<string, unknown> : {};
  if (value.meetings !== undefined && value.meetings !== null) {
    if (!Array.isArray(value.meetings) || !value.meetings.length) return { error: "Elige al menos un día de la semana." };
    const meetings: ScheduleMeeting[] = [];
    for (const raw of value.meetings) {
      const item = raw && typeof raw === "object" ? raw as Record<string, unknown> : {};
      const duration = Number(item.durationMinutes);
      if (!Number.isInteger(item.weekday) || (item.weekday as number) < 0 || (item.weekday as number) > 6) return { error: "Elige al menos un día de la semana." };
      if (typeof item.startsAt !== "string" || !clock.test(item.startsAt)) return { error: "Escribe la hora de inicio con el formato HH:MM." };
      if (!Number.isInteger(duration) || duration < 5 || duration > 480) return { error: "La duración debe estar entre 5 y 480 minutos." };
      meetings.push({ weekday: item.weekday as number, startsAt: item.startsAt, durationMinutes: duration });
    }
    if (new Set(meetings.map(item => item.weekday)).size !== meetings.length) return { error: "La sección tiene una sola clase por día: une los bloques seguidos en una clase más larga." };
    meetings.sort((a, b) => weekPosition(a.weekday) - weekPosition(b.weekday));
    const base = scheduleInput({ ...value, meetings: undefined, weekdays: meetings.map(item => item.weekday), startsAt: meetings[0].startsAt, durationMinutes: meetings[0].durationMinutes });
    if ("error" in base) return base;
    const varies = meetings.some(item => item.startsAt !== meetings[0].startsAt || item.durationMinutes !== meetings[0].durationMinutes);
    return varies ? { ...base, meetings } : base;
  }
  const days = value.weekdays;
  if (!Array.isArray(days) || !days.length || days.some(day => !Number.isInteger(day) || day < 0 || day > 6) || new Set(days).size !== days.length) return { error: "Elige al menos un día de la semana." };
  if (typeof value.startsAt !== "string" || !/^([01]\d|2[0-3]):[0-5]\d$/.test(value.startsAt)) return { error: "Escribe la hora de inicio con el formato HH:MM." };
  const duration = Number(value.durationMinutes);
  if (!Number.isInteger(duration) || duration < 5 || duration > 480) return { error: "La duración debe estar entre 5 y 480 minutos." };
  if (!isCalendarDay(value.from) || !isCalendarDay(value.until)) return { error: "Indica las fechas de inicio y de fin del periodo." };
  if (value.until < value.from) return { error: "La fecha de fin debe ser igual o posterior a la de inicio." };
  if (daysBetween(value.from, value.until) >= maxScheduleDays) return { error: "El periodo puede durar hasta un año." };
  return { weekdays: [...days].sort((a, b) => a - b), startsAt: value.startsAt, durationMinutes: duration, from: value.from, until: value.until };
}

const daysBetween = (from: string, until: string) => Math.round((Date.parse(`${until}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86400000);

export type DaysOff = { title: string; from: string; until: string };
/** The break a day falls in, if any. */
export const breakOn = <T extends DaysOff>(day: string, breaks: T[]) => breaks.find(item => item.from <= day && day <= item.until);

/** Validates days without class: a title and one day or a range of up to a year. */
export function breakInput(input: unknown): DaysOff | { error: string } {
  const value = input && typeof input === "object" ? input as Record<string, unknown> : {};
  const title = typeof value.title === "string" ? value.title.trim().replace(/\s+/g, " ") : "";
  if (!title || title.length > 120) return { error: "Escribe el motivo, por ejemplo «Día de la Independencia» o «Vacaciones de medio año»." };
  const until = value.until === undefined || value.until === null || value.until === "" ? value.from : value.until;
  if (!isCalendarDay(value.from) || !isCalendarDay(until)) return { error: "Indica la fecha o el rango de fechas sin clase." };
  if (until < value.from) return { error: "La fecha final debe ser igual o posterior a la inicial." };
  if (daysBetween(value.from, until) >= maxScheduleDays) return { error: "Un periodo sin clase puede durar hasta un año." };
  return { title, from: value.from, until };
}

/** The class days of a schedule from `today` on, skipping days without class: past days are history and are never generated again. */
export function scheduleDates(schedule: Pick<SectionSchedule, "weekdays" | "from" | "until">, today: string, breaks: DaysOff[] = []) {
  const dates: string[] = [];
  const day = new Date(`${schedule.from > today ? schedule.from : today}T00:00:00Z`);
  for (; day.toISOString().slice(0, 10) <= schedule.until && dates.length < maxScheduledClasses; day.setUTCDate(day.getUTCDate() + 1)) {
    const value = day.toISOString().slice(0, 10);
    if (schedule.weekdays.includes(day.getUTCDay()) && !breakOn(value, breaks)) dates.push(value);
  }
  return dates;
}

/**
 * What the next class works on once a class leaves lessons unfinished: those lessons first, then its own, without
 * repeating a lesson already planned later. Lessons beyond the limit of a class are returned apart.
 */
export function carryOver(next: string[], unfinished: string[], later: string[], limit: number) {
  const moving = unfinished.filter(id => !next.includes(id) && !later.includes(id));
  const lessons = [...moving, ...next];
  return { lessons: lessons.slice(0, limit), left: lessons.slice(limit) };
}

/** The time of the class on a day of the schedule. */
export function meetingOn(schedule: Pick<SectionSchedule, "startsAt" | "durationMinutes" | "meetings">, day: string): { startsAt: string; durationMinutes: number } {
  const weekday = new Date(`${day}T00:00:00Z`).getUTCDay();
  const meeting = schedule.meetings?.find(item => item.weekday === weekday);
  return meeting ? { startsAt: meeting.startsAt, durationMinutes: meeting.durationMinutes } : { startsAt: schedule.startsAt, durationMinutes: schedule.durationMinutes };
}
/** Every meeting of the week, from Monday: the per-day ones or the single time on each class day. */
export function meetingsOf(schedule: Pick<SectionSchedule, "weekdays" | "startsAt" | "durationMinutes" | "meetings">): ScheduleMeeting[] {
  return schedule.meetings?.length ? schedule.meetings : [...schedule.weekdays].sort((a, b) => weekPosition(a) - weekPosition(b)).map(weekday => ({ weekday, startsAt: schedule.startsAt, durationMinutes: schedule.durationMinutes }));
}

/** "lun y mié, 08:00 · 45 min", or each day with its time when they differ: "lun 07:30 · 80 min, mié 10:00 · 40 min". */
export function scheduleSummary(schedule: Pick<SectionSchedule, "weekdays" | "startsAt" | "durationMinutes" | "meetings">) {
  if (schedule.meetings?.length) return schedule.meetings.map(item => `${weekdays.find(([day]) => day === item.weekday)![2]} ${item.startsAt} · ${item.durationMinutes} min`).join(", ");
  const names = weekdays.filter(([day]) => schedule.weekdays.includes(day)).map(([, , short]) => short);
  const list = names.length > 1 ? `${names.slice(0, -1).join(", ")} y ${names[names.length - 1]}` : names[0];
  return `${list}, ${schedule.startsAt} · ${schedule.durationMinutes} min`;
}

/**
 * Lessons for the classes still without any, in content order and `perClass` at a time: lessons the section already
 * has in a class are skipped, and classes beyond the last lesson stay empty.
 */
export function lessonsInOrder(classes: { id: string; lessonIds: string[] }[], ordered: string[], used: string[], perClass = 1) {
  const queue = ordered.filter(id => !used.includes(id));
  const size = Math.max(1, Math.min(3, Math.trunc(perClass) || 1));
  return classes.filter(item => !item.lessonIds.length).slice(0, Math.ceil(queue.length / size))
    .map((item, index) => ({ sessionId: item.id, lessonIds: queue.slice(index * size, index * size + size) }));
}

const mondayOf = (day: string) => { const date = new Date(`${day}T00:00:00Z`); date.setUTCDate(date.getUTCDate() - (date.getUTCDay() + 6) % 7); return date.getTime(); };
/** Week of the period a class falls in, counting Monday-to-Sunday weeks from the period's first day: 1, 2, … */
export function periodWeek(day: string, first: string) {
  return Math.floor((mondayOf(day) - mondayOf(first)) / (7 * 86400000)) + 1;
}

/**
 * Where each class sits in its section's schedule of classes: the week of the period and its number among the
 * classes that are held (cancelled ones keep their week but take no number).
 */
export function classSequence<T extends { id: string; sessionDate: string; startsAt?: string | null; status: string }>(classes: T[], first?: string | null) {
  const ordered = [...classes].sort((a, b) => a.sessionDate.localeCompare(b.sessionDate) || (a.startsAt || "").localeCompare(b.startsAt || ""));
  const start = first && ordered[0] && first < ordered[0].sessionDate ? first : ordered[0]?.sessionDate;
  let number = 0;
  return new Map(ordered.map(item => [item.id, { week: start ? periodWeek(item.sessionDate, start) : 1, number: item.status === "cancelled" ? null : ++number }]));
}
