import type { AcademicYearStatus, PeriodKind } from "@happy-learners/contracts";
import { isCalendarDay, maxScheduleDays } from "./schedule";

/**
 * The organization's school year (ciclo lectivo) and its periods. Administration prepares a year as a draft, makes it
 * the current one (at most one per organization) and closes it; a closed year is history and never changes. The next
 * year starts empty: only its name, dates and pattern of periods come from the previous one, never students or grades.
 *
 *   draft ──activate──▶ current ──close──▶ closed
 *
 * The year does not replace a section's schedule (its from/until stays its own) nor the days without class (DEC-026).
 */
export const academicYearStatuses = ["draft", "current", "closed"] as const satisfies readonly AcademicYearStatus[];
export const academicYearLabels: Record<AcademicYearStatus, string> = { draft: "Borrador", current: "Vigente", closed: "Cerrado" };
export type AcademicYearAction = "activate" | "close";

export const periodKinds: { key: PeriodKind; label: string; plural: string; count: number; feminine: boolean }[] = [
  { key: "bimester", label: "Bimestre", plural: "bimestres", count: 4, feminine: false },
  { key: "trimester", label: "Trimestre", plural: "trimestres", count: 3, feminine: false },
  { key: "semester", label: "Semestre", plural: "semestres", count: 2, feminine: false },
  { key: "unit", label: "Unidad", plural: "unidades", count: 4, feminine: true },
];
export const isPeriodKind = (value: unknown): value is PeriodKind => periodKinds.some(kind => kind.key === value);
export const periodKindOf = (key: PeriodKind) => periodKinds.find(kind => kind.key === key)!;
export const maxPeriods = 12;

const ordinals = ["Primer", "Segundo", "Tercer", "Cuarto", "Quinto", "Sexto", "Séptimo", "Octavo", "Noveno", "Décimo", "Undécimo", "Duodécimo"];
/** «Primer bimestre», «Tercera unidad»: the name a period gets when the year is divided automatically. */
export function periodName(kind: PeriodKind, position: number) {
  const { label, feminine } = periodKindOf(kind), ordinal = ordinals[position - 1] || `${position}.º`;
  const word = feminine && ordinal.endsWith("r") ? `${ordinal}a` : feminine && ordinal.endsWith("o") ? `${ordinal.slice(0, -1)}a` : ordinal;
  return `${word} ${label.toLocaleLowerCase("es")}`;
}

const dayNumber = (day: string) => Date.parse(`${day}T00:00:00Z`) / 86400000;
const dayOf = (number: number) => new Date(number * 86400000).toISOString().slice(0, 10);
const cleanName = (value: unknown) => typeof value === "string" ? value.trim().replace(/\s+/g, " ").normalize("NFC") : "";

export type PeriodDraft = { id: string | null; name: string; from: string; until: string; weight: number };
export type AcademicYearDraft = { name: string; from: string; until: string; periodKind: PeriodKind; periods: PeriodDraft[] };

/**
 * Validates a whole year with its periods. Periods come back ordered by their start; they must lie within the year
 * and must not overlap. A period keeps its id when it is edited, so what refers to it (grades) stays attached.
 */
export function academicYearInput(input: unknown): AcademicYearDraft | { error: string } {
  const value = input && typeof input === "object" ? input as Record<string, unknown> : {};
  const name = cleanName(value.name);
  if (name.length < 3 || name.length > 80 || /[<>]/.test(name)) return { error: "Escribe el nombre del ciclo, por ejemplo «Ciclo 2027» (de 3 a 80 caracteres)." };
  if (!isCalendarDay(value.from) || !isCalendarDay(value.until)) return { error: "Indica las fechas de inicio y de fin del ciclo." };
  if (value.until <= value.from) return { error: "La fecha de fin del ciclo debe ser posterior a la de inicio." };
  if (dayNumber(value.until) - dayNumber(value.from) >= maxScheduleDays) return { error: "Un ciclo lectivo puede durar hasta un año." };
  if (!isPeriodKind(value.periodKind)) return { error: "Elige cómo se divide el ciclo: bimestres, trimestres, semestres o unidades." };
  if (!Array.isArray(value.periods)) return { error: "Agrega los periodos del ciclo." };
  if (value.periods.length > maxPeriods) return { error: `Un ciclo puede tener hasta ${maxPeriods} periodos.` };
  const periods: PeriodDraft[] = [];
  for (const raw of value.periods) {
    const item = raw && typeof raw === "object" ? raw as Record<string, unknown> : {};
    const periodName = cleanName(item.name);
    if (!periodName || periodName.length > 60 || /[<>]/.test(periodName)) return { error: "Cada periodo necesita un nombre de hasta 60 caracteres." };
    if (item.id !== undefined && item.id !== null && (typeof item.id !== "string" || !/^period-[a-f0-9-]{36}$/.test(item.id))) return { error: "Revisa los periodos: uno no es válido." };
    if (!isCalendarDay(item.from) || !isCalendarDay(item.until)) return { error: `Indica las fechas de «${periodName}».` };
    if (item.until < item.from) return { error: `En «${periodName}», la fecha de fin debe ser igual o posterior a la de inicio.` };
    if (item.from < value.from || item.until > value.until) return { error: `«${periodName}» debe quedar dentro de las fechas del ciclo.` };
    const weight = item.weight === undefined || item.weight === null || item.weight === "" ? 1 : Number(item.weight);
    if (!Number.isInteger(weight) || weight < 1 || weight > 100) return { error: `El peso de «${periodName}» debe ser un número entero de 1 a 100.` };
    periods.push({ id: typeof item.id === "string" ? item.id : null, name: periodName, from: item.from, until: item.until, weight });
  }
  const ids = periods.map(period => period.id).filter(Boolean);
  if (new Set(ids).size !== ids.length) return { error: "Revisa los periodos: hay uno repetido." };
  if (new Set(periods.map(period => period.name.toLocaleLowerCase("es"))).size !== periods.length) return { error: "Cada periodo del ciclo necesita un nombre distinto." };
  periods.sort((a, b) => a.from.localeCompare(b.from));
  for (let index = 1; index < periods.length; index++) {
    if (periods[index].from <= periods[index - 1].until) return { error: `«${periods[index - 1].name}» y «${periods[index].name}» se traslapan. Cada periodo debe empezar después de que termine el anterior.` };
  }
  return { name, from: value.from, until: value.until, periodKind: value.periodKind, periods };
}

/** The status a year moves to, or null when the action is not allowed from where it is. */
export function academicYearTransition(from: AcademicYearStatus, action: AcademicYearAction): AcademicYearStatus | null {
  if (action === "activate") return from === "draft" ? "current" : null;
  return from === "current" ? "closed" : null;
}
/** A closed year is history: nothing about it changes. */
export const academicYearEditable = (status: AcademicYearStatus) => status !== "closed";

/** Why a year cannot become the current one yet, or null when it can. */
export function activationBlocker(year: { status: AcademicYearStatus; periods: unknown[] }, anotherCurrent: boolean): string | null {
  if (year.status !== "draft") return year.status === "current" ? "Este ciclo ya es el vigente." : "Un ciclo cerrado no vuelve a estar vigente.";
  if (anotherCurrent) return "Ya hay un ciclo vigente. Ciérralo antes de activar el siguiente.";
  if (!year.periods.length) return "Agrega al menos un periodo antes de activar el ciclo.";
  return null;
}

/** Divides a year into `count` consecutive periods of about the same length, named after the kind. */
export function splitPeriods(from: string, until: string, kind: PeriodKind, count = periodKindOf(kind).count): PeriodDraft[] {
  const start = dayNumber(from), total = dayNumber(until) - start + 1, parts = Math.max(1, Math.min(count, maxPeriods, total));
  return Array.from({ length: parts }, (_, index) => ({
    id: null, name: periodName(kind, index + 1), weight: 1,
    from: dayOf(start + Math.floor(index * total / parts)), until: dayOf(start + Math.floor((index + 1) * total / parts) - 1),
  }));
}

/** The same calendar day a year later; 29 February becomes 28 February. */
export function nextYearDay(day: string) {
  const [year, month, date] = day.split("-").map(Number), next = year + 1;
  const last = new Date(Date.UTC(next, month, 0)).getUTCDate();
  return `${next}-${String(month).padStart(2, "0")}-${String(Math.min(date, last)).padStart(2, "0")}`;
}
/**
 * The next year, empty: «Ciclo 2027» becomes «Ciclo 2028», and the dates and pattern of periods move one year ahead.
 * Nothing else is copied (no sections, students, grades or plans).
 */
export function nextAcademicYear(year: { name: string; from: string; until: string; periodKind: PeriodKind; periods: { name: string; from: string; until: string; weight: number }[] }): AcademicYearDraft {
  const match = /(19|20)\d{2}(?!.*(19|20)\d{2})/.exec(year.name);
  const name = match ? `${year.name.slice(0, match.index)}${Number(match[0]) + 1}${year.name.slice(match.index + 4)}` : `${year.name} (siguiente)`.slice(0, 80);
  return {
    name, from: nextYearDay(year.from), until: nextYearDay(year.until), periodKind: year.periodKind,
    periods: year.periods.map(period => ({ id: null, name: period.name, from: nextYearDay(period.from), until: nextYearDay(period.until), weight: period.weight })),
  };
}

/** The dates a new section schedule suggests from the current year: from today (or its start) to its end. */
export function scheduleSuggestion(year: { from: string; until: string } | null | undefined, today: string): { from: string; until: string } | null {
  if (!year) return null;
  const from = year.from > today ? year.from : today;
  return from <= year.until ? { from, until: year.until } : null;
}
