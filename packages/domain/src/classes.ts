import type { CancelPlan, ClassStatus, CourseAccess, LessonOutcome } from "@happy-learners/contracts";
import { seesSection } from "./access";
import { isCalendarDay } from "./schedule";
import { organizations, sectionPrefix } from "./organizations";

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

/** A class may work on no lesson (an assessment, an outing) or on several when its time allows. */
export const maxClassLessons = 6;
/** What a class of the schedule plans: its lessons in order and comments for the team. Time and duration come from the section's schedule unless the class is moved. */
export type ClassPlan = { sessionDate: string; startsAt: string | null; durationMinutes: number | null; lessonIds: string[]; notes: string };
const idPattern = /^[a-z0-9-]{1,100}$/;

/** Validates what an educator plans for a class. Returns the clean plan or a message that says what to fix. */
export function classPlanInput(input: unknown): ClassPlan | { error: string } {
  const value = input && typeof input === "object" ? input as Record<string, unknown> : {};
  if (!isCalendarDay(value.sessionDate)) return { error: "Selecciona una fecha válida." };
  const startsAt = typeof value.startsAt === "string" && value.startsAt ? value.startsAt : null;
  if (startsAt !== null && !/^([01]\d|2[0-3]):[0-5]\d$/.test(startsAt)) return { error: "Escribe la hora con el formato HH:MM." };
  const duration = value.durationMinutes === null || value.durationMinutes === undefined || value.durationMinutes === "" ? null : Number(value.durationMinutes);
  if (duration !== null && (!Number.isInteger(duration) || duration < 5 || duration > 480)) return { error: "La duración debe estar entre 5 y 480 minutos." };
  const lessonIds = value.lessonIds === undefined || value.lessonIds === null ? [] : value.lessonIds;
  if (!Array.isArray(lessonIds) || lessonIds.some(id => typeof id !== "string" || !idPattern.test(id))) return { error: "Las lecciones seleccionadas no son válidas." };
  if (new Set(lessonIds).size !== lessonIds.length) return { error: "Cada lección se planifica una sola vez en la clase." };
  if (lessonIds.length > maxClassLessons) return { error: `Una clase admite hasta ${maxClassLessons} lecciones.` };
  const notes = typeof value.notes === "string" ? value.notes.trim() : "";
  if (notes.length > 2000 || /[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(notes)) return { error: "Los comentarios admiten hasta 2000 caracteres." };
  return { sessionDate: value.sessionDate, startsAt, durationMinutes: duration, lessonIds: lessonIds as string[], notes };
}

/** Group codes: a prefix for the organization's storage, then characters that cannot be confused when read aloud. */
export const groupCodePattern = new RegExp(`^[${organizations.map(item => item.letter.toUpperCase()).join("")}]G-[A-Z0-9]{4}-?[A-Z0-9]{2,8}$`);
const alphabet = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
export function newGroupCode(organizationId: string, random: (size: number) => Uint8Array) {
  const bytes = random(8);
  const body = Array.from(bytes, byte => alphabet[byte % alphabet.length]).join("");
  return `${sectionPrefix(organizationId)}-${body.slice(0, 4)}-${body.slice(4)}`;
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

export const lessonOutcomeLabels: Record<LessonOutcome, string> = { completed: "Completada", partial: "Parcial", not_reached: "No se alcanzó" };
/**
 * What an educator confirms when finishing a class (DEC-026): how far each planned lesson got and whether what was not
 * completed moves to the next class. A lesson left out counts as completed, as classes finished before v0.8.9 did.
 */
export function completionInput(input: unknown, lessonIds: string[]): { outcomes: Map<string, LessonOutcome>; carryOver: boolean } | { error: string } {
  const value = input && typeof input === "object" ? input as Record<string, unknown> : {};
  const list = value.lessons === undefined || value.lessons === null ? [] : value.lessons;
  if (!Array.isArray(list) || list.length > maxClassLessons) return { error: "Revisa lo trabajado en cada lección." };
  const outcomes = new Map<string, LessonOutcome>(lessonIds.map(id => [id, "completed"]));
  for (const item of list as Record<string, unknown>[]) {
    if (!item || typeof item.id !== "string" || !outcomes.has(item.id) || !Object.hasOwn(lessonOutcomeLabels, String(item.outcome))) return { error: "Revisa lo trabajado en cada lección: alguna ya no está en la clase." };
    outcomes.set(item.id, item.outcome as LessonOutcome);
  }
  return { outcomes, carryOver: value.carryOver !== false };
}
/** A cancelled class with something planned either passes it on to the next class or skips it; skipping is the default. */
export const cancelPlanInput = (input: unknown): CancelPlan => (input && typeof input === "object" && (input as Record<string, unknown>).plan === "shift") ? "shift" : "skip";

/**
 * ST-065: the filters of a course's class history. A section (the "grupo") and a period of calendar days in the
 * organization's time zone, both inclusive and combinable; empty values leave that filter out.
 */
export type SessionFilter = { section: string | null; from: string | null; to: string | null };
const sectionIdPattern = /^[a-z0-9-]{1,100}$/;
export function sessionFilterInput(params: { get(name: string): string | null }): SessionFilter | { error: string } {
  const [section, from, to] = ["section", "from", "to"].map(name => params.get(name)?.trim() || null);
  if (section !== null && !sectionIdPattern.test(section)) return { error: "La sección del filtro no es válida." };
  if ((from !== null && !isCalendarDay(from)) || (to !== null && !isCalendarDay(to))) return { error: "Indica las fechas del periodo como AAAA-MM-DD." };
  if (from && to && to < from) return { error: "La fecha final del periodo debe ser igual o posterior a la inicial." };
  return { section, from, to };
}
/** Whether a class falls within the filters: its section and its calendar day, both limits included. */
export const inSessionFilter = (session: { groupId: string; sessionDate: string }, filter: SessionFilter) =>
  (!filter.section || session.groupId === filter.section) && (!filter.from || session.sessionDate >= filter.from) && (!filter.to || session.sessionDate <= filter.to);
/** The course team filters only by the sections it sees (DEC-012): administration every section, educators their own. */
export const sessionFilterAllowed = (access: CourseAccess | null, filter: SessionFilter) => !!access && (!filter.section || seesSection(access, filter.section));
