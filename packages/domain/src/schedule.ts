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

export type SectionSchedule = { weekdays: number[]; startsAt: string; durationMinutes: number; from: string; until: string };

/** Validates a section's weekly schedule. Returns the clean schedule or a message that says what to fix. */
export function scheduleInput(input: unknown): SectionSchedule | { error: string } {
  const value = input && typeof input === "object" ? input as Record<string, unknown> : {};
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

/** The class days of a schedule from `today` on: past days are history and are never generated again. */
export function scheduleDates(schedule: Pick<SectionSchedule, "weekdays" | "from" | "until">, today: string) {
  const dates: string[] = [];
  const day = new Date(`${schedule.from > today ? schedule.from : today}T00:00:00Z`);
  for (; day.toISOString().slice(0, 10) <= schedule.until && dates.length < maxScheduledClasses; day.setUTCDate(day.getUTCDate() + 1)) {
    if (schedule.weekdays.includes(day.getUTCDay())) dates.push(day.toISOString().slice(0, 10));
  }
  return dates;
}

/** "lun y mié, 08:00 · 45 min" */
export function scheduleSummary(schedule: Pick<SectionSchedule, "weekdays" | "startsAt" | "durationMinutes">) {
  const names = weekdays.filter(([day]) => schedule.weekdays.includes(day)).map(([, , short]) => short);
  const list = names.length > 1 ? `${names.slice(0, -1).join(", ")} y ${names[names.length - 1]}` : names[0];
  return `${list}, ${schedule.startsAt} · ${schedule.durationMinutes} min`;
}

/**
 * Lessons for the classes still without one, in content order: lessons the section already has in a class are
 * skipped, and classes beyond the last lesson stay empty.
 */
export function lessonsInOrder(classes: { id: string; lessonId?: string | null }[], ordered: string[], used: string[]) {
  const queue = ordered.filter(id => !used.includes(id));
  return classes.filter(item => !item.lessonId).slice(0, queue.length).map((item, index) => ({ sessionId: item.id, lessonId: queue[index] }));
}
