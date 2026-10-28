import type { DateRule, DateRuleOccurrence } from "@happy-learners/contracts";

type Weekday = 0 | 1 | 2 | 3 | 4 | 5 | 6;
type DateAnchor = DateRule["anchor"];

const DAY_MS = 86_400_000;
const weekdays = ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"];
const months = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];
const ordinals = ["", "Primer", "Segundo", "Tercer", "Cuarto", "Quinto"];
const validParts = new Set(["full", "morning", "afternoon"]);
const validShiftDirections = new Set(["previous", "next", "nearest"]);
const yearInRange = (value: unknown): value is number => Number.isInteger(value) && (value as number) >= 1583 && (value as number) <= 4099;
const weekdayInRange = (value: unknown): value is Weekday => Number.isInteger(value) && (value as number) >= 0 && (value as number) <= 6;
const pad = (value: number) => String(value).padStart(2, "0");
const dateString = (year: number, month: number, day: number) => `${String(year).padStart(4, "0")}-${pad(month)}-${pad(day)}`;
const dateOf = (day: string) => new Date(`${day}T00:00:00.000Z`);
const dayString = (date: Date) => date.toISOString().slice(0, 10);
const addDays = (day: string, amount: number) => {
  const date = dateOf(day);
  date.setUTCDate(date.getUTCDate() + amount);
  return dayString(date);
};
const weekdayOf = (day: string) => dateOf(day).getUTCDay() as Weekday;
const daysInMonth = (year: number, month: number) => new Date(Date.UTC(year, month, 0)).getUTCDate();
const isCalendarDay = (value: unknown): value is string => {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = dateOf(value);
  return !Number.isNaN(parsed.getTime()) && dayString(parsed) === value;
};

/** Gregorian Easter Sunday, using the Meeus/Jones/Butcher algorithm. */
export function easterSunday(year: number) {
  if (!yearInRange(year)) throw new RangeError("El año debe estar entre 1583 y 4099.");
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = (h + l - 7 * m + 114) % 31 + 1;
  return dateString(year, month, day);
}

const cleanYear = (value: unknown, label: string) => value === undefined ? undefined
  : yearInRange(value) ? value
    : { error: `${label} debe ser un año entre 1583 y 4099.` };

/** Validates and normalizes one reusable calendar rule. */
export function ruleInput(input: unknown): DateRule | { error: string } {
  const value = input && typeof input === "object" ? input as Record<string, unknown> : {};
  const id = typeof value.id === "string" ? value.id.trim() : "";
  const title = typeof value.title === "string" ? value.title.trim().replace(/\s+/g, " ") : "";
  if (!id || id.length > 80 || !/^[a-zA-Z0-9-]+$/.test(id)) return { error: "Escribe un identificador con letras, números o guiones." };
  if (!title || title.length > 120) return { error: "Escribe un título de hasta 120 caracteres." };
  if (!value.anchor || typeof value.anchor !== "object") return { error: "Elige cómo se calcula la fecha." };
  const rawAnchor = value.anchor as Record<string, unknown>;
  let anchor: DateAnchor;
  if (rawAnchor.kind === "fixed") {
    if (!Number.isInteger(rawAnchor.month) || (rawAnchor.month as number) < 1 || (rawAnchor.month as number) > 12)
      return { error: "El mes debe estar entre 1 y 12." };
    const maximum = daysInMonth(2000, rawAnchor.month as number);
    if (!Number.isInteger(rawAnchor.day) || (rawAnchor.day as number) < 1 || (rawAnchor.day as number) > maximum)
      return { error: "Ese día no existe en el mes indicado." };
    anchor = { kind: "fixed", month: rawAnchor.month as number, day: rawAnchor.day as number };
  } else if (rawAnchor.kind === "nth-weekday") {
    if (!Number.isInteger(rawAnchor.month) || (rawAnchor.month as number) < 1 || (rawAnchor.month as number) > 12)
      return { error: "El mes debe estar entre 1 y 12." };
    if (!weekdayInRange(rawAnchor.weekday)) return { error: "El día de la semana debe estar entre 0 y 6." };
    if (![1, 2, 3, 4, 5, -1].includes(rawAnchor.n as number)) return { error: "La posición debe ser de 1 a 5 o -1 para el último día." };
    anchor = { kind: "nth-weekday", month: rawAnchor.month as number, weekday: rawAnchor.weekday, n: rawAnchor.n as 1 | 2 | 3 | 4 | 5 | -1 };
  } else if (rawAnchor.kind === "easter") {
    if (!Number.isInteger(rawAnchor.offset) || Math.abs(rawAnchor.offset as number) > 366) return { error: "El desplazamiento de Pascua debe ser un número entero entre -366 y 366." };
    anchor = { kind: "easter", offset: rawAnchor.offset as number };
  } else if (rawAnchor.kind === "relative") {
    const to = typeof rawAnchor.to === "string" ? rawAnchor.to.trim() : "";
    if (!to) return { error: "Indica la regla de referencia." };
    if (to === id) return { error: "Una regla no puede ser relativa a sí misma." };
    if (!Number.isInteger(rawAnchor.offset) || Math.abs(rawAnchor.offset as number) > 366) return { error: "El desplazamiento relativo debe ser un número entero entre -366 y 366." };
    if (rawAnchor.weekday !== undefined && !weekdayInRange(rawAnchor.weekday)) return { error: "El día de la semana debe estar entre 0 y 6." };
    anchor = { kind: "relative", to, offset: rawAnchor.offset as number, ...(rawAnchor.weekday === undefined ? {} : { weekday: rawAnchor.weekday as Weekday }) };
  } else if (rawAnchor.kind === "once") {
    if (!isCalendarDay(rawAnchor.date) || !yearInRange(Number(String(rawAnchor.date).slice(0, 4)))) return { error: "Escribe la fecha única con el formato YYYY-MM-DD." };
    anchor = { kind: "once", date: rawAnchor.date };
  } else return { error: "Elige un tipo de fecha válido." };

  const days = value.days === undefined ? undefined : Number(value.days);
  if (days !== undefined && (!Number.isInteger(days) || days < 1 || days > 366)) return { error: "La duración debe ser de 1 a 366 días." };
  if (value.part !== undefined && !validParts.has(String(value.part))) return { error: "Elige día completo, mañana o tarde." };

  let shift: DateRule["shift"];
  if (value.shift !== undefined) {
    if (!value.shift || typeof value.shift !== "object") return { error: "Configura correctamente el traslado de fecha." };
    const raw = value.shift as Record<string, unknown>;
    if (!Array.isArray(raw.when) || !raw.when.length || raw.when.some(day => !weekdayInRange(day)) || new Set(raw.when).size !== raw.when.length)
      return { error: "Elige al menos un día válido en que se traslada la fecha." };
    if (!Array.isArray(raw.onto) || !raw.onto.length || raw.onto.some(day => !weekdayInRange(day)) || new Set(raw.onto).size !== raw.onto.length)
      return { error: "Elige al menos un día válido al que se puede trasladar." };
    if (raw.onto.some(day => (raw.when as unknown[]).includes(day))) return { error: "Un día de destino no puede ser también un día que se traslada." };
    if (!validShiftDirections.has(String(raw.to))) return { error: "Elige si el traslado va antes, después o al día más cercano." };
    shift = { when: raw.when as Weekday[], to: raw.to as "previous" | "next" | "nearest", onto: raw.onto as Weekday[] };
  }

  const fromYear = cleanYear(value.fromYear, "El año inicial");
  if (fromYear && typeof fromYear === "object") return fromYear;
  const untilYear = cleanYear(value.untilYear, "El año final");
  if (untilYear && typeof untilYear === "object") return untilYear;
  const onlyYear = cleanYear(value.onlyYear, "El único año");
  if (onlyYear && typeof onlyYear === "object") return onlyYear;
  if (fromYear !== undefined && untilYear !== undefined && untilYear < fromYear) return { error: "El año final debe ser igual o posterior al inicial." };
  if (onlyYear !== undefined && (fromYear !== undefined || untilYear !== undefined)) return { error: "Usa un único año o un rango de vigencia, no ambos." };
  let exceptYears: number[] | undefined;
  if (value.exceptYears !== undefined) {
    if (!Array.isArray(value.exceptYears) || value.exceptYears.some(year => !yearInRange(year)) || new Set(value.exceptYears).size !== value.exceptYears.length)
      return { error: "Los años excluidos deben ser años distintos entre 1583 y 4099." };
    exceptYears = [...value.exceptYears].sort((a, b) => a - b);
  }
  return {
    id, title, anchor,
    ...(days === undefined ? {} : { days }),
    ...(value.part === undefined ? {} : { part: value.part as DateRule["part"] }),
    ...(shift ? { shift } : {}),
    ...(fromYear === undefined ? {} : { fromYear }),
    ...(untilYear === undefined ? {} : { untilYear }),
    ...(exceptYears === undefined ? {} : { exceptYears }),
    ...(onlyYear === undefined ? {} : { onlyYear }),
  };
}

const activeIn = (rule: DateRule, year: number) =>
  (rule.fromYear === undefined || year >= rule.fromYear)
  && (rule.untilYear === undefined || year <= rule.untilYear)
  && (rule.onlyYear === undefined || year === rule.onlyYear)
  && !rule.exceptYears?.includes(year);

function anchorDay(anchor: Exclude<DateAnchor, { kind: "relative" }>, year: number): string | null {
  if (anchor.kind === "fixed") return anchor.day <= daysInMonth(year, anchor.month) ? dateString(year, anchor.month, anchor.day) : null;
  if (anchor.kind === "easter") return addDays(easterSunday(year), anchor.offset);
  if (anchor.kind === "once") return Number(anchor.date.slice(0, 4)) === year ? anchor.date : null;
  if (anchor.n === -1) {
    const last = dateString(year, anchor.month, daysInMonth(year, anchor.month));
    return addDays(last, -((weekdayOf(last) - anchor.weekday + 7) % 7));
  }
  const first = dateString(year, anchor.month, 1);
  const day = 1 + ((anchor.weekday - weekdayOf(first) + 7) % 7) + 7 * (anchor.n - 1);
  return day <= daysInMonth(year, anchor.month) ? dateString(year, anchor.month, day) : null;
}

function shifted(day: string, shift: NonNullable<DateRule["shift"]>) {
  if (!shift.when.includes(weekdayOf(day))) return day;
  if (shift.to === "previous" || shift.to === "next") {
    const step = shift.to === "previous" ? -1 : 1;
    for (let distance = 1; distance <= 7; distance++) {
      const candidate = addDays(day, distance * step);
      if (shift.onto.includes(weekdayOf(candidate))) return candidate;
    }
  }
  // Equal distances choose the following day, so Wednesday is shifted to Friday when Monday and Friday are allowed.
  for (let distance = 1; distance <= 7; distance++) {
    const after = addDays(day, distance);
    if (shift.onto.includes(weekdayOf(after))) return after;
    const before = addDays(day, -distance);
    if (shift.onto.includes(weekdayOf(before))) return before;
  }
  return day;
}

/** Resolves active rules for a year. Relative rules use the referenced rule's final, shifted start date. */
export function occurrences(rules: DateRule[], year: number): DateRuleOccurrence[] {
  if (!yearInRange(year)) throw new RangeError("El año debe estar entre 1583 y 4099.");
  const byId = new Map<string, DateRule>();
  for (const rule of rules) {
    if (byId.has(rule.id)) throw new Error(`Hay más de una regla con el identificador «${rule.id}».`);
    byId.set(rule.id, rule);
  }
  const resolved = new Map<string, DateRuleOccurrence | null>();
  const resolving: string[] = [];
  const resolve = (rule: DateRule): DateRuleOccurrence | null => {
    if (resolved.has(rule.id)) return resolved.get(rule.id)!;
    const cycleAt = resolving.indexOf(rule.id);
    if (cycleAt !== -1) throw new Error(`Hay un ciclo entre las reglas de fecha: ${[...resolving.slice(cycleAt), rule.id].join(" → ")}.`);
    if (!activeIn(rule, year)) { resolved.set(rule.id, null); return null; }
    resolving.push(rule.id);
    let from: string | null;
    if (rule.anchor.kind === "relative") {
      const target = byId.get(rule.anchor.to);
      if (!target) throw new Error(`La regla «${rule.id}» se refiere a «${rule.anchor.to}», que no existe.`);
      const base = resolve(target);
      from = base ? addDays(base.from, rule.anchor.offset) : null;
      if (from && rule.anchor.weekday !== undefined) {
        from = addDays(from, (rule.anchor.weekday - weekdayOf(from) + 7) % 7);
      }
    } else from = anchorDay(rule.anchor, year);
    resolving.pop();
    if (!from) { resolved.set(rule.id, null); return null; }
    const shiftedFrom = rule.shift && rule.shift.when.includes(weekdayOf(from)) ? from : null;
    if (rule.shift) from = shifted(from, rule.shift);
    const result: DateRuleOccurrence = {
      ruleId: rule.id,
      title: rule.title,
      from,
      until: addDays(from, (rule.days ?? 1) - 1),
      part: rule.part ?? "full",
      shiftedFrom,
    };
    resolved.set(rule.id, result);
    return result;
  };
  return rules.map(resolve).filter((item): item is DateRuleOccurrence => item !== null)
    .sort((a, b) => a.from.localeCompare(b.from) || a.ruleId.localeCompare(b.ruleId));
}

/**
 * Keeps reusable rules for another year. An explicit one-year rule or one whose end predates the latest explicit
 * year represented by this set has expired; with no represented year, bounded recurring rules remain reusable.
 */
export function nextYearRules(rules: DateRule[]) {
  const representedYears = rules.flatMap(rule => [
    ...(rule.onlyYear === undefined ? [] : [rule.onlyYear]),
    ...(rule.anchor.kind === "once" ? [Number(rule.anchor.date.slice(0, 4))] : []),
  ]);
  const currentYear = representedYears.length ? Math.max(...representedYears) : null;
  return rules.filter(rule => rule.onlyYear === undefined && (currentYear === null || rule.untilYear === undefined || rule.untilYear > currentYear));
}

const list = (items: string[]) => items.length < 2 ? items[0] : `${items.slice(0, -1).join(", ")} o ${items.at(-1)}`;
const amountBeforeAfter = (amount: number, subject: string) => amount === 0 ? subject
  : `${Math.abs(amount)} ${Math.abs(amount) === 1 ? "día" : "días"} ${amount < 0 ? "antes" : "después"} de ${subject}`;

/** A concise Spanish description of a rule. */
export function ruleSummary(rule: DateRule) {
  const anchor = rule.anchor;
  let summary: string;
  if (anchor.kind === "fixed") summary = `${anchor.day} de ${months[anchor.month - 1]}`;
  else if (anchor.kind === "nth-weekday") summary = anchor.n === -1
    ? `Último ${weekdays[anchor.weekday]} de ${months[anchor.month - 1]}`
    : `${ordinals[anchor.n]} ${weekdays[anchor.weekday]} de ${months[anchor.month - 1]}`;
  else if (anchor.kind === "easter") summary = amountBeforeAfter(anchor.offset, "Pascua");
  else if (anchor.kind === "relative") {
    const base = amountBeforeAfter(anchor.offset, anchor.to);
    summary = anchor.weekday === undefined ? base : `Primer ${weekdays[anchor.weekday]} en o después de ${base.toLowerCase()}`;
  } else summary = anchor.date;
  if (rule.shift) {
    const when = list(rule.shift.when.map(day => weekdays[day]));
    const onto = list(rule.shift.onto.map(day => weekdays[day]));
    const direction = rule.shift.to === "previous" ? `${onto} anterior` : rule.shift.to === "next" ? `${onto} siguiente` : `${onto} más cercano`;
    summary += `; si cae ${when}, el ${direction}`;
  }
  return summary;
}

// This reference template does not claim to describe current law; each institution must review and edit it.
export const guatemalaTemplate: DateRule[] = [
  { id: "new-year", title: "Año Nuevo", anchor: { kind: "fixed", month: 1, day: 1 } },
  { id: "holy-wednesday", title: "Miércoles Santo", anchor: { kind: "easter", offset: -4 }, part: "afternoon" },
  { id: "holy-thursday", title: "Jueves Santo", anchor: { kind: "easter", offset: -3 } },
  { id: "good-friday", title: "Viernes Santo", anchor: { kind: "easter", offset: -2 } },
  { id: "holy-saturday", title: "Sábado de Gloria", anchor: { kind: "easter", offset: -1 } },
  { id: "labor-day", title: "Día del Trabajo", anchor: { kind: "fixed", month: 5, day: 1 } },
  { id: "army-day", title: "Día del Ejército", anchor: { kind: "fixed", month: 6, day: 30 } },
  { id: "independence-day", title: "Día de la Independencia", anchor: { kind: "fixed", month: 9, day: 15 } },
  { id: "revolution-day", title: "Día de la Revolución", anchor: { kind: "fixed", month: 10, day: 20 } },
  { id: "all-saints", title: "Día de Todos los Santos", anchor: { kind: "fixed", month: 11, day: 1 } },
  { id: "christmas-eve", title: "Nochebuena", anchor: { kind: "fixed", month: 12, day: 24 }, part: "afternoon" },
  { id: "christmas", title: "Navidad", anchor: { kind: "fixed", month: 12, day: 25 } },
  { id: "new-years-eve", title: "Fin de año", anchor: { kind: "fixed", month: 12, day: 31 }, part: "afternoon" },
];
