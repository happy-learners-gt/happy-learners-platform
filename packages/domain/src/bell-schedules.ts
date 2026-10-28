/**
 * The organization's bell schedules (jornadas, 1.2.4): the class periods and breaks of a school day, generated from the
 * start time, the length of each period, the passing time between periods and where the breaks go. Sections take their
 * meetings from these blocks; a double period is one meeting that spans consecutive blocks.
 */
export type BellBreak = { after: number; minutes: number; label: string };
export type BellConfig = { startsAt: string; periodMinutes: number; passingMinutes: number; periods: number; breaks: BellBreak[] };
export type BellBlock = { key: string; kind: "class" | "break"; label: string; startsAt: string; endsAt: string };
export type BellScheduleDraft = { name: string; weekdays: number[]; config: BellConfig };
export const maxBellPeriods = 14, maxBellSchedules = 12;

const time = /^([01]\d|2[0-3]):[0-5]\d$/;
export const minutesOf = (clock: string) => Number(clock.slice(0, 2)) * 60 + Number(clock.slice(3, 5));
export const clockOf = (minutes: number) => `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;

/**
 * The blocks of a day: period 1 starts at the entry time; after each period comes either a break (which leads straight
 * into the next period) or the passing time.
 */
export function bellBlocks(config: BellConfig): BellBlock[] {
  const blocks: BellBlock[] = [];
  let at = minutesOf(config.startsAt);
  for (let period = 1; period <= config.periods; period++) {
    blocks.push({ key: `p${period}`, kind: "class", label: `Periodo ${period}`, startsAt: clockOf(at), endsAt: clockOf(at + config.periodMinutes) });
    at += config.periodMinutes;
    if (period === config.periods) break;
    const pause = config.breaks.find(item => item.after === period);
    if (pause) {
      blocks.push({ key: `r${period}`, kind: "break", label: pause.label, startsAt: clockOf(at), endsAt: clockOf(at + pause.minutes) });
      at += pause.minutes;
    } else at += config.passingMinutes;
  }
  return blocks;
}

/** Validates a bell schedule. Returns the clean draft or a message that says what to fix. */
export function bellScheduleInput(input: unknown): BellScheduleDraft | { error: string } {
  const value = input && typeof input === "object" ? input as Record<string, unknown> : {};
  const name = typeof value.name === "string" ? value.name.trim().replace(/\s+/g, " ") : "";
  if (!name || name.length > 80) return { error: "Escribe el nombre de la jornada, por ejemplo «Jornada matutina»." };
  const days = value.weekdays;
  if (!Array.isArray(days) || !days.length || days.some(day => !Number.isInteger(day) || day < 0 || day > 6) || new Set(days).size !== days.length) return { error: "Elige los días en que aplica la jornada." };
  const config = value.config && typeof value.config === "object" ? value.config as Record<string, unknown> : {};
  if (typeof config.startsAt !== "string" || !time.test(config.startsAt)) return { error: "Escribe la hora de entrada con el formato HH:MM." };
  const periodMinutes = Number(config.periodMinutes), passingMinutes = Number(config.passingMinutes), periods = Number(config.periods);
  if (!Number.isInteger(periodMinutes) || periodMinutes < 20 || periodMinutes > 180) return { error: "Cada periodo dura entre 20 y 180 minutos." };
  if (!Number.isInteger(passingMinutes) || passingMinutes < 0 || passingMinutes > 30) return { error: "El tiempo entre periodos va de 0 a 30 minutos." };
  if (!Number.isInteger(periods) || periods < 1 || periods > maxBellPeriods) return { error: `La jornada tiene de 1 a ${maxBellPeriods} periodos.` };
  const rawBreaks = Array.isArray(config.breaks) ? config.breaks : config.breaks === undefined ? [] : null;
  if (!rawBreaks) return { error: "Revisa los recesos." };
  const breaks: BellBreak[] = [];
  for (const raw of rawBreaks) {
    const item = raw && typeof raw === "object" ? raw as Record<string, unknown> : {};
    const after = Number(item.after), minutes = Number(item.minutes), label = typeof item.label === "string" ? item.label.trim().replace(/\s+/g, " ") : "";
    if (!Number.isInteger(after) || after < 1 || after >= periods) return { error: "Cada receso va después de un periodo y antes del último." };
    if (!Number.isInteger(minutes) || minutes < 5 || minutes > 120) return { error: "Un receso dura entre 5 y 120 minutos." };
    if (!label || label.length > 40) return { error: "Ponle nombre a cada receso, por ejemplo «Recreo» o «Almuerzo»." };
    breaks.push({ after, minutes, label });
  }
  if (new Set(breaks.map(item => item.after)).size !== breaks.length) return { error: "Hay dos recesos después del mismo periodo." };
  breaks.sort((a, b) => a.after - b.after);
  const clean: BellConfig = { startsAt: config.startsAt, periodMinutes, passingMinutes, periods, breaks };
  const blocks = bellBlocks(clean);
  if (minutesOf(blocks[blocks.length - 1].endsAt) <= minutesOf(clean.startsAt) || minutesOf(clean.startsAt) + bellLength(clean) >= 24 * 60) return { error: "La jornada debe terminar antes de la medianoche." };
  return { name, weekdays: [...days].sort((a, b) => a - b), config: clean };
}
/** Minutes from the entry to the end of the last period. */
export const bellLength = (config: BellConfig) => config.periods * config.periodMinutes + config.breaks.reduce((sum, item) => sum + item.minutes, 0) + (config.periods - 1 - config.breaks.length) * config.passingMinutes;

/** The meeting that consecutive class blocks make: from the first one's start to the last one's end. */
export function meetingFromBlocks(blocks: BellBlock[], fromKey: string, toKey: string) {
  const start = blocks.findIndex(block => block.key === fromKey), end = blocks.findIndex(block => block.key === toKey);
  if (start === -1 || end === -1 || end < start || blocks[start].kind !== "class" || blocks[end].kind !== "class") return null;
  return { startsAt: blocks[start].startsAt, durationMinutes: minutesOf(blocks[end].endsAt) - minutesOf(blocks[start].startsAt) };
}

/** Starting jornadas a school can adjust. */
export const bellTemplates: { id: string; label: string; draft: BellScheduleDraft }[] = [
  { id: "matutina", label: "Matutina (7:30, periodos de 40 min)", draft: { name: "Jornada matutina", weekdays: [1, 2, 3, 4, 5], config: { startsAt: "07:30", periodMinutes: 40, passingMinutes: 5, periods: 8, breaks: [{ after: 3, minutes: 30, label: "Recreo" }, { after: 6, minutes: 15, label: "Refacción" }] } } },
  { id: "vespertina", label: "Vespertina (13:00, periodos de 40 min)", draft: { name: "Jornada vespertina", weekdays: [1, 2, 3, 4, 5], config: { startsAt: "13:00", periodMinutes: 40, passingMinutes: 5, periods: 7, breaks: [{ after: 4, minutes: 20, label: "Recreo" }] } } },
  { id: "universitaria", label: "Universitaria (bloques de 90 min)", draft: { name: "Bloques universitarios", weekdays: [1, 2, 3, 4, 5, 6], config: { startsAt: "07:00", periodMinutes: 90, passingMinutes: 10, periods: 6, breaks: [{ after: 3, minutes: 60, label: "Almuerzo" }] } } },
];
/** "lun a vie" or "lun, mié y vie". */
export function daysText(days: number[]) {
  // Self-contained (the seed scripts load this file directly): Monday first, 0 is Sunday.
  const names = [[1, "lun"], [2, "mar"], [3, "mié"], [4, "jue"], [5, "vie"], [6, "sáb"], [0, "dom"]].filter(([day]) => days.includes(day as number)).map(([, short]) => short as string);
  const workweek = [1, 2, 3, 4, 5];
  if (days.length === 5 && workweek.every(day => days.includes(day))) return "lun a vie";
  if (days.length === 6 && [...workweek, 6].every(day => days.includes(day))) return "lun a sáb";
  return names.length > 1 ? `${names.slice(0, -1).join(", ")} y ${names[names.length - 1]}` : names[0] || "";
}
