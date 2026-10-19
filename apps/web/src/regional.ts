import type { EffectivePreferences } from "@happy-learners/contracts";
import { orderedWeekdays, wallClock, wallTimeIn, weekdays } from "@happy-learners/domain";

/**
 * ST-160: dates, times and numbers in the person's regional format, hour cycle and zone. The session sets these once
 * (and again when the person changes them); every screen formats through these helpers instead of a fixed locale.
 * Classes are stored as days and times of the organization's zone (DEC-035): `classMoment` shows them in the person's.
 */
type Regional = { locale: string; timezone: string; hourCycle: "h12" | "h23"; weekStart: number; organizationTimezone: string };
const browserZone = (() => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC"; } catch { return "UTC"; } })();
let regional: Regional = { locale: "es", timezone: browserZone, hourCycle: "h23", weekStart: 1, organizationTimezone: browserZone };
let version = 0;

export function setRegional(preferences: Pick<EffectivePreferences, "locale" | "timezone" | "hourCycle" | "weekStart" | "organization">) {
  regional = { locale: preferences.locale, timezone: preferences.timezone, hourCycle: preferences.hourCycle, weekStart: preferences.weekStart, organizationTimezone: preferences.organization.timezone };
  version++;
}
/** Changes whenever the format changes, so memoized views can depend on it. */
export const regionalVersion = () => version;
export const currentRegional = () => regional;
/** Whether the person reads times in a zone other than the organization's (screens then say which zone they show). */
export const differentZone = () => regional.timezone !== regional.organizationTimezone;

const formatters = new Map<string, Intl.DateTimeFormat>();
function formatter(options: Intl.DateTimeFormatOptions, zone: string | null = regional.timezone) {
  const key = `${version}|${zone}|${JSON.stringify(options)}`;
  let found = formatters.get(key);
  if (!found) {
    // A 24-hour clock writes two digits (08:30), as the screens always did; a 12-hour one does not (8:30 a. m.).
    const hour: Intl.DateTimeFormatOptions = options.hour ? { hour: regional.hourCycle === "h23" ? "2-digit" : "numeric", hourCycle: regional.hourCycle } : {};
    try { found = new Intl.DateTimeFormat(regional.locale, { ...options, ...hour, ...(zone ? { timeZone: zone } : {}) }); }
    catch { found = new Intl.DateTimeFormat("es", { ...options, ...(zone ? { timeZone: zone } : {}) }); }
    formatters.set(key, found);
  }
  return found;
}
const capital = (text: string) => text.charAt(0).toLocaleUpperCase(regional.locale) + text.slice(1);

/** An instant (ISO) as date and time in the person's zone. */
export function formatInstant(value: string | null | undefined, style: "long" | "medium" | "short" = "medium") {
  if (!value || Number.isNaN(Date.parse(value))) return "";
  const options: Intl.DateTimeFormatOptions = style === "long" ? { day: "numeric", month: "long", year: "numeric", hour: "numeric", minute: "2-digit" }
    : style === "medium" ? { day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit" } : { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" };
  return formatter(options).format(new Date(value));
}
/** The date of an instant in the person's zone. */
export function formatInstantDate(value: string | null | undefined, style: "long" | "short" = "short") {
  if (!value || Number.isNaN(Date.parse(value))) return "";
  return formatter(style === "long" ? { day: "numeric", month: "long", year: "numeric" } : { day: "numeric", month: "short", year: "numeric" }).format(new Date(value));
}
/** The time of an instant in the person's zone. */
export function formatInstantTime(value: string | null | undefined) {
  if (!value || Number.isNaN(Date.parse(value))) return "";
  return formatter({ hour: "numeric", minute: "2-digit" }).format(new Date(value));
}
/** A calendar day (YYYY-MM-DD) without any zone shift: «Lunes, 12 de octubre» or «12 oct». */
export function formatDay(day: string, style: "long" | "short" | "full" | "month" = "long") {
  const [year, month, date] = day.split("-").map(Number);
  if (!year || !month || !date) return day;
  const options: Intl.DateTimeFormatOptions = style === "long" ? { weekday: "long", day: "numeric", month: "long" } : style === "full" ? { day: "numeric", month: "long", year: "numeric" }
    : style === "month" ? { month: "short" } : { day: "numeric", month: "short" };
  return capital(formatter(options, "UTC").format(new Date(Date.UTC(year, month - 1, date, 12))));
}
/** A wall-clock time (HH:MM) in the person's hour cycle: «08:30» or «8:30 a. m.». */
export function formatClock(time: string | null | undefined) {
  if (!time || !/^\d{2}:\d{2}$/.test(time)) return time || "";
  const [hours, minutes] = time.split(":").map(Number);
  return formatter({ hour: "numeric", minute: "2-digit" }, "UTC").format(new Date(Date.UTC(2000, 0, 3, hours, minutes)));
}
/** A range of wall-clock times: «08:00–08:45». */
export const formatClockRange = (start: string, end: string) => `${formatClock(start)}–${formatClock(end)}`;
/** Today in the person's zone. */
export const personalToday = (now = new Date()) => wallClock(now, regional.timezone).day;

/** A class (day and time of the organization's zone) as the person reads it: their day, their time, their format. */
export function classMoment(day: string, time: string | null | undefined) {
  const moved = wallTimeIn(day, time, regional.organizationTimezone, regional.timezone);
  return { day: moved.day, time: moved.time, clock: moved.time ? formatClock(moved.time) : "", shifted: moved.shifted };
}
/** The zone's short name for a note: «hora de Ciudad de México (UTC−06:00)». */
export function zoneName(zone = regional.timezone) {
  try {
    const name = new Intl.DateTimeFormat(regional.locale, { timeZone: zone, timeZoneName: "longGeneric" }).formatToParts(new Date()).find(part => part.type === "timeZoneName")?.value;
    return name || zone.replaceAll("_", " ");
  } catch { return zone.replaceAll("_", " "); }
}

/** Monday to Sunday, or from whichever day the person's week starts. */
export const weekOrder = () => orderedWeekdays(weekdays, regional.weekStart);
/** A number in the person's format (decimal separator, grouping). */
export const formatNumber = (value: number, options: Intl.NumberFormatOptions = {}) => { try { return new Intl.NumberFormat(regional.locale, options).format(value); } catch { return String(value); } };
