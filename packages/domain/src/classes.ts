import type { ClassStatus } from "@happy-learners/contracts";
import { isCalendarDay } from "./schedule";

export const classStatusLabels: Record<ClassStatus, string> = { planned: "Planificada", in_progress: "En curso", completed: "Impartida", cancelled: "Cancelada" };
export type ClassAction = "start" | "complete" | "cancel" | "restore";
const transitions: Record<ClassAction, { from: ClassStatus[]; to: ClassStatus }> = {
  start: { from: ["planned"], to: "in_progress" },
  complete: { from: ["planned", "in_progress"], to: "completed" },
  cancel: { from: ["planned"], to: "cancelled" },
  restore: { from: ["cancelled"], to: "planned" },
};
export const classActions = Object.keys(transitions) as ClassAction[];

/** The status a class moves to, or null when the action does not apply to its current status. */
export function nextClassStatus(current: ClassStatus, action: ClassAction): ClassStatus | null {
  const rule = transitions[action];
  return rule && rule.from.includes(current) ? rule.to : null;
}

/** Attendance is taken once a class is open and stays correctable after it ends; a cancelled class has none. */
export const acceptsAttendance = (status: ClassStatus) => status !== "cancelled";

export type ClassPlan = { sessionDate: string; startsAt: string | null; durationMinutes: number | null; lessonId: string | null; notes: string };
const idPattern = /^[a-z0-9-]{1,100}$/;

/** Validates what an educator plans for a class. Returns the clean plan or a message that says what to fix. */
export function classPlanInput(input: unknown): ClassPlan | { error: string } {
  const value = input && typeof input === "object" ? input as Record<string, unknown> : {};
  if (!isCalendarDay(value.sessionDate)) return { error: "Selecciona una fecha válida." };
  const startsAt = typeof value.startsAt === "string" && value.startsAt ? value.startsAt : null;
  if (startsAt !== null && !/^([01]\d|2[0-3]):[0-5]\d$/.test(startsAt)) return { error: "Escribe la hora con el formato HH:MM." };
  const duration = value.durationMinutes === null || value.durationMinutes === undefined || value.durationMinutes === "" ? null : Number(value.durationMinutes);
  if (duration !== null && (!Number.isInteger(duration) || duration < 5 || duration > 480)) return { error: "La duración debe estar entre 5 y 480 minutos." };
  const lessonId = typeof value.lessonId === "string" && value.lessonId ? value.lessonId : null;
  if (lessonId !== null && !idPattern.test(lessonId)) return { error: "La lección seleccionada no es válida." };
  const notes = typeof value.notes === "string" ? value.notes.trim() : "";
  if (notes.length > 2000 || /[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(notes)) return { error: "Las notas admiten hasta 2000 caracteres." };
  return { sessionDate: value.sessionDate, startsAt, durationMinutes: duration, lessonId, notes };
}

/** Group codes: a prefix for the organization's storage, then characters that cannot be confused when read aloud. */
export const groupCodePattern = /^[DO]G-[A-Z0-9]{4}-?[A-Z0-9]{2,8}$/;
const alphabet = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
export function newGroupCode(organizationId: string, random: (size: number) => Uint8Array) {
  const bytes = random(8);
  const body = Array.from(bytes, byte => alphabet[byte % alphabet.length]).join("");
  return `${organizationId === "org-other" ? "OG" : "DG"}-${body.slice(0, 4)}-${body.slice(4)}`;
}
export const normalizeGroupCode = (value: unknown) => typeof value === "string" ? value.trim().toUpperCase().replace(/\s+/g, "") : "";

/** The calendar day in the organization's time zone, as YYYY-MM-DD. */
export function localDay(timezone: string, now = new Date()) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

/** Classes still ahead, soonest first: today's or later, not cancelled and not yet taught. */
export function upcomingClasses<T extends { sessionDate: string; startsAt?: string | null; status: ClassStatus }>(classes: T[], today: string) {
  return classes.filter(item => item.sessionDate >= today && (item.status === "planned" || item.status === "in_progress"))
    .sort((a, b) => a.sessionDate.localeCompare(b.sessionDate) || (a.startsAt || "99:99").localeCompare(b.startsAt || "99:99"));
}
