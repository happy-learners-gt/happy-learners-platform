import type { HoursFilter, HoursRow, HoursState, HoursTotal } from "@happy-learners/contracts";
import { isCalendarDay } from "./schedule";
import { localDay } from "./classes";

/**
 * ST-152 (DEC-043): effective hours teaching classes. The volunteer work is ad honorem: the hours recognize it and
 * help balance the load; they are not payroll.
 */

/** A class longer than this (8 hours, the longest class a schedule admits) is not counted until administration reviews it. */
export const reviewAfterMinutes = 480;
/** The most minutes a correction may give one class. */
export const maxAdjustedMinutes = 720;
export const minAdjustmentReason = 5, maxAdjustmentReason = 300;

export const hoursStateLabels: Record<HoursState, string> = { counted: "Cuenta", no_start: "Sin registro de inicio", review: "Revisar: más de 8 h", adjusted: "Corregida" };

/**
 * The effective duration of a completed class: from its start to its completion, in whole minutes (rounded).
 * Without a real start (none recorded, or the same instant as the completion, as classes completed straight from
 * planned or before 0018 have) it counts 0 and says so; longer than 8 hours it counts 0 and asks for a review.
 */
export function effectiveDuration(startedAt: string | null | undefined, completedAt: string | null | undefined): { computed: number; minutes: number; state: Exclude<HoursState, "adjusted"> } {
  const start = startedAt ? Date.parse(startedAt) : Number.NaN, end = completedAt ? Date.parse(completedAt) : Number.NaN;
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return { computed: 0, minutes: 0, state: "no_start" };
  const computed = Math.round((end - start) / 60000);
  if (computed > reviewAfterMinutes) return { computed, minutes: 0, state: "review" };
  return { computed, minutes: computed, state: "counted" };
}

/** The day a class counts in: the calendar day of its start in the organization's time zone, or its class day without a start. */
export function hoursDay(startedAt: string | null | undefined, sessionDate: string, timezone: string) {
  const start = startedAt ? new Date(startedAt) : null;
  return start && Number.isFinite(start.getTime()) ? localDay(timezone, start) : sessionDate;
}

/** «2026-10-15 08:05», the local date and time of an instant in the organization's time zone. */
export function localDateTime(value: string | null | undefined, timezone: string) {
  if (!value || !Number.isFinite(Date.parse(value))) return "";
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(new Date(value)).map(part => [part.type, part.value]));
  return `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}`;
}

const idPattern = /^[a-z0-9-]{1,100}$/;
/** ?from=&to=&course=&section=&person=: calendar days (both included) and ids, each optional and combinable. */
export function hoursFilterInput(params: { get(name: string): string | null }): HoursFilter | { error: string } {
  const [from, to, course, section, person] = ["from", "to", "course", "section", "person"].map(name => params.get(name)?.trim() || null);
  if ((from !== null && !isCalendarDay(from)) || (to !== null && !isCalendarDay(to))) return { error: "Indica las fechas del periodo como AAAA-MM-DD." };
  if (from && to && to < from) return { error: "La fecha final del periodo debe ser igual o posterior a la inicial." };
  if ([course, section, person].some(value => value !== null && !idPattern.test(value))) return { error: "Revisa el curso, la sección o la persona del filtro." };
  return { from, to, course, section, person };
}
/** Whether a class row falls within the filters. */
export const inHoursFilter = (row: Pick<HoursRow, "day" | "courseId" | "sectionId" | "educatorId">, filter: HoursFilter) =>
  (!filter.from || row.day >= filter.from) && (!filter.to || row.day <= filter.to) && (!filter.course || row.courseId === filter.course)
  && (!filter.section || row.sectionId === filter.section) && (!filter.person || row.educatorId === filter.person);

/** A correction: whole minutes from 0 to 720, an optional person to attribute the class to, and a reason of 5 to 300 characters. */
export function hoursAdjustmentInput(value: unknown): { minutes: number; educatorId: string | null; reason: string } | { error: string } {
  if (!value || typeof value !== "object") return { error: "Indica los minutos efectivos y el motivo de la corrección." };
  const { minutes, educatorId, reason } = value as Record<string, unknown>;
  if (typeof reason !== "string" || reason.trim().length < minAdjustmentReason || reason.trim().length > maxAdjustmentReason || /[<>\x00-\x08\x0b-\x1f]/.test(reason))
    return { error: `Escribe el motivo de la corrección, de ${minAdjustmentReason} a ${maxAdjustmentReason} caracteres.` };
  if (typeof minutes !== "number" || !Number.isInteger(minutes) || minutes < 0 || minutes > maxAdjustedMinutes) return { error: `Los minutos efectivos son un número entero de 0 a ${maxAdjustedMinutes}.` };
  if (educatorId !== undefined && educatorId !== null && (typeof educatorId !== "string" || !idPattern.test(educatorId))) return { error: "Elige a la persona que impartió la clase." };
  return { minutes, educatorId: typeof educatorId === "string" ? educatorId : null, reason: reason.trim().replace(/\s+/g, " ").normalize("NFC") };
}

/** Totals per person, course and section, the largest first. Rows without a person are left out of the people. */
export function hoursTotals(rows: HoursRow[]) {
  const group = (key: (row: HoursRow) => [string, string] | null) => {
    const map = new Map<string, HoursTotal>();
    for (const row of rows) {
      const found = key(row); if (!found) continue;
      const total = map.get(found[0]) || { id: found[0], name: found[1], minutes: 0, classes: 0 };
      total.minutes += row.minutes; total.classes += 1; map.set(found[0], total);
    }
    return [...map.values()].sort((a, b) => b.minutes - a.minutes || a.name.localeCompare(b.name, "es"));
  };
  return {
    people: group(row => row.educatorId ? [row.educatorId, row.educatorName || row.educatorId] : null),
    courses: group(row => [row.courseId, row.courseTitle]),
    sections: group(row => [row.sectionId, `${row.sectionName} (${row.courseTitle})`]),
  };
}

/** 90 → «1.50»: hours with two decimals, for the export. */
export const decimalHours = (minutes: number) => (minutes / 60).toFixed(2);

/**
 * One CSV cell (RFC 4180): quoted when it holds a comma, quote or line break, quotes doubled. A cell that a
 * spreadsheet would read as a formula (=, +, -, @, tab, carriage return) is prefixed with an apostrophe.
 */
export function csvCell(value: string | number | null | undefined) {
  let text = value === null || value === undefined ? "" : String(value);
  if (typeof value === "string" && /^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}
export const hoursCsvHeader = ["Fecha", "Curso", "Sección", "Educador", "Inicio", "Finalización", "Minutos calculados", "Minutos efectivos", "Horas efectivas", "Estado", "Motivo de la corrección"];
/** The export: UTF-8 with BOM (Excel opens it with its accents), Spanish headers, CRLF lines, times in the organization's zone. */
export function hoursCsv(rows: HoursRow[], timezone: string) {
  const lines = [hoursCsvHeader, ...rows.map(row => [row.day, row.courseTitle, row.sectionName, row.educatorName || "", localDateTime(row.startedAt, timezone), localDateTime(row.completedAt, timezone),
    row.computedMinutes, row.minutes, decimalHours(row.minutes), hoursStateLabels[row.state], row.adjustment?.reason || ""])];
  const total = rows.reduce((sum, row) => sum + row.minutes, 0);
  lines.push(["Total", "", "", "", "", "", "", total, decimalHours(total), "", ""]);
  return "﻿" + lines.map(line => line.map(csvCell).join(",")).join("\r\n") + "\r\n";
}

/** The preset periods of «Horas efectivas» (HRS-01); «todo» has no range. */
export type HoursPeriod = "30-dias" | "mes" | "mes-anterior" | "todo";
const shiftDay = (day: string, days: number) => { const date = new Date(`${day}T00:00:00Z`); date.setUTCDate(date.getUTCDate() + days); return date.toISOString().slice(0, 10); };
/** The days a preset covers, both included, counted from the person's own today (YYYY-MM-DD). */
export function hoursPeriodRange(period: HoursPeriod | "personalizado", today: string): { from: string; to: string } | null {
  const month = today.slice(0, 8);
  if (period === "30-dias") return { from: shiftDay(today, -29), to: today };
  if (period === "mes") return { from: `${month}01`, to: today };
  if (period === "mes-anterior") { const last = shiftDay(`${month}01`, -1); return { from: `${last.slice(0, 8)}01`, to: last }; }
  return null;
}
