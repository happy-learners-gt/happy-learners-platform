import type { Activity, Course, LearningUnit, Lesson, Material, RichTextDocument, RichTextNode } from "@happy-learners/contracts";
import { api, uploadCourseFile } from "./api";

export type LessonState = "draft" | "published" | "changes" | "archived";
export function lessonState(lesson: Pick<Lesson, "status" | "revision" | "hasDraft">): LessonState {
  if (lesson.status === "archived") return "archived";
  if (!lesson.revision) return "draft";
  return lesson.hasDraft ? "changes" : "published";
}
export const lessonStateLabel: Record<LessonState, string> = { draft: "Borrador", published: "Publicada", changes: "Cambios sin publicar", archived: "Archivada" };

export const resourceKindLabel: Record<Material["kind"] | "legacy", string> = { text: "Texto", link: "Enlace", file: "Documento", legacy: "Texto" };
export function resourceStatusLabel(status: Material["status"]) { return status === "archived" ? "Archivado" : status === "draft" ? "Borrador" : "Disponible"; }
export const activityTypeLabel: Record<NonNullable<Activity["type"]>, string> = { text: "Contenido", resource: "Recurso", question: "Pregunta" };

/** Colour families from theme.css. Colour always accompanies text or an icon; it never carries meaning alone. */
export type Hue = "violet" | "coral" | "amber" | "teal" | "sky" | "pink" | "green";
const hues: Hue[] = ["violet", "sky", "coral", "teal", "pink", "amber"];
/** Stable colour for a course, unit or person: the same key always gets the same hue. */
export function hueFor(key: string): Hue {
  let hash = 0;
  for (const char of key) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return hues[hash % hues.length];
}
export const hueAt = (index: number): Hue => hues[index % hues.length];
export const activityHue: Record<NonNullable<Activity["type"]>, Hue> = { text: "sky", resource: "teal", question: "pink" };
export const resourceHue: Record<Material["kind"], Hue> = { text: "sky", link: "coral", file: "amber" };

const relative = new Intl.RelativeTimeFormat("es", { numeric: "auto" });
/** "hace 5 minutos", "ayer", "el 12 sept 2026". */
export function timeAgo(value?: string, now = Date.now()) {
  if (!value) return "";
  const time = new Date(value).getTime();
  if (Number.isNaN(time)) return "";
  const seconds = Math.round((time - now) / 1000);
  if (Math.abs(seconds) < 60) return "hace un momento";
  const minutes = Math.round(seconds / 60);
  if (Math.abs(minutes) < 60) return relative.format(minutes, "minute");
  const hours = Math.round(minutes / 60);
  if (Math.abs(hours) < 24) return relative.format(hours, "hour");
  const days = Math.round(hours / 24);
  if (Math.abs(days) < 7) return relative.format(days, "day");
  return `el ${new Date(value).toLocaleDateString("es-GT", { day: "numeric", month: "short", year: "numeric" })}`;
}
export function fullDate(value?: string) { return value ? new Date(value).toLocaleString("es-GT", { dateStyle: "long", timeStyle: "short" }) : ""; }
/** Session dates are calendar days (YYYY-MM-DD); format them without a timezone shift. */
export function sessionDay(value: string, style: "long" | "short" = "long") {
  const [year, month, day] = value.split("-").map(Number);
  const text = new Date(year, month - 1, day).toLocaleDateString("es-GT", style === "long" ? { weekday: "long", day: "numeric", month: "long" } : { day: "numeric", month: "short" });
  return text.charAt(0).toLocaleUpperCase("es") + text.slice(1);
}
export function today() { return new Date().toLocaleDateString("en-CA"); }

export const normalize = (value: string) => value.normalize("NFD").replace(/[̀-ͯ]/g, "").toLocaleLowerCase("es").trim();
export const matches = (query: string, ...values: (string | undefined)[]) => !query.trim() || normalize(values.filter(Boolean).join(" ")).includes(normalize(query));
export function plural(count: number, one: string, many: string) { return `${count} ${count === 1 ? one : many}`; }

export function richTextLength(node?: RichTextDocument | RichTextNode): number {
  if (!node) return 0;
  return (node.type === "text" ? (("text" in node && node.text) || "").trim().length : 0) + (node.content || []).reduce((sum, child) => sum + richTextLength(child), 0);
}
export function plainText(node?: RichTextDocument | RichTextNode): string {
  if (!node) return "";
  if (node.type === "text") return ("text" in node && node.text) || "";
  return (node.content || []).map(plainText).join(node.type === "doc" ? "\n" : "");
}

/**
 * Older lessons stored activities without IDs or types; the editor and the API require both.
 * Missing IDs are derived from the position so every editor and every visit uses the same collaborative field.
 */
export function normalizeActivities(activities: Activity[]): Activity[] {
  return activities.map((activity, position) => ({ ...activity, id: activity.id || `activity-${position + 1}`, type: activity.type || "text", position }));
}

export type LessonDraft = { title: string; objective: string; duration: number; unitId: string; archived: boolean; activities: Activity[] };
export function draftOf(lesson: Lesson): LessonDraft {
  return { title: lesson.title, objective: lesson.objective, duration: lesson.duration || 20, unitId: lesson.courseUnitId || "", archived: lesson.status === "archived", activities: normalizeActivities(lesson.activities || []) };
}
export function lessonBody(courseId: string, draft: LessonDraft, draftVersion?: number) {
  const activities = draft.activities.map((activity, position) => ({ ...activity, position }));
  return { title: draft.title, objective: draft.objective, courseId, courseUnitId: draft.unitId, duration: draft.duration, draftVersion, status: draft.archived ? "archived" : "draft", instructions: activities[0]?.instructions || "", activities };
}

/** Mirrors the server rules so autosave only sends drafts it can accept, and explains what is missing. */
export function draftProblem(draft: LessonDraft): { message: string; target: string } | null {
  if (!draft.title.trim()) return { message: "Escribe un título para guardar.", target: "title" };
  if (draft.title.length > 160) return { message: "Acorta el título a 160 caracteres.", target: "title" };
  if (!draft.objective.trim()) return { message: "Escribe el objetivo de la lección para guardar.", target: "details" };
  if (draft.activities.length > 30) return { message: "Una lección admite hasta 30 actividades.", target: "details" };
  for (const [index, activity] of draft.activities.entries()) {
    const target = activity.id || String(index), name = `la actividad ${index + 1}`;
    if (!activity.title.trim()) return { message: `Escribe el título de ${name} para guardar.`, target };
    if (!activity.instructions.trim() && !richTextLength(activity.richContent)) return { message: `Escribe el contenido de ${name} para guardar.`, target };
    if (!Number.isInteger(activity.minutes) || activity.minutes < 1 || activity.minutes > 120) return { message: `Indica entre 1 y 120 minutos para ${name}.`, target };
    if (activity.type === "resource" && !activity.resourceId) return { message: `Elige el recurso de ${name} para guardar.`, target };
    if (activity.type === "question") {
      const options = activity.options || [];
      if (options.length < 2 || options.some(option => !option.trim())) return { message: `Completa al menos dos opciones en ${name}.`, target };
      if (new Set(options.map(option => option.trim())).size !== options.length) return { message: `Las opciones de ${name} deben ser distintas.`, target };
      if (!Number.isInteger(activity.answer) || activity.answer! < 0 || activity.answer! >= options.length) return { message: `Marca la respuesta correcta de ${name}.`, target };
    }
  }
  return null;
}

export function courseBody(course: Course, patch: Partial<Course> = {}) {
  const next = { ...course, ...patch };
  return { title: next.title, objective: next.objective, profile: next.profile, unitLabel: next.unitLabel, status: next.status, termIds: next.termIds, version: course.version };
}

export type CourseStats = { units: number; lessons: number; published: number; drafts: number; changes: number };
export function courseStats(units: LearningUnit[], lessons: Lesson[]): CourseStats {
  const active = lessons.filter(lesson => lesson.status !== "archived");
  const states = active.map(lessonState);
  return { units: units.filter(unit => unit.status === "active").length, lessons: active.length, published: states.filter(state => state !== "draft").length, drafts: states.filter(state => state === "draft").length, changes: states.filter(state => state === "changes").length };
}
export function usage(resourceId: string, lessons: Lesson[]) {
  return lessons.filter(lesson => lesson.status !== "archived" && lesson.activities.some(activity => activity.type === "resource" && activity.resourceId === resourceId));
}
export function newest<T extends { updatedAt?: string }>(rows: T[]) { return [...rows].sort((a, b) => (b.updatedAt || "").localeCompare(a.updatedAt || "")); }

/**
 * Copies a course as drafts through the public API: units, text and link resources, documents and lessons.
 * Returns the new course ID; if a step fails the partial copy remains and the error explains it.
 */
export async function duplicateCourse(course: Course, onProgress?: (step: string) => void) {
  const [{ units }, { lessons }, { materials }] = await Promise.all([
    api<{ units: LearningUnit[] }>(`/courses/${course.id}`),
    api<{ lessons: Lesson[] }>(`/lessons?drafts=1&course=${course.id}`),
    api<{ materials: Material[] }>(`/courses/${course.id}/materials`),
  ]);
  onProgress?.("Creando el curso…");
  const { id } = await api<{ id: string }>("/courses", "POST", { ...courseBody(course, { title: `${course.title} (copia)`.slice(0, 160), status: "active" }), version: undefined });
  let version = 1;
  const unitMap = new Map<string, string>();
  for (const unit of units.filter(unit => unit.status === "active")) {
    const created = await api<{ id: string }>(`/courses/${id}/units`, "POST", { name: unit.name, objective: unit.objective, status: "active", version });
    unitMap.set(unit.id, created.id); version++;
  }
  onProgress?.("Copiando recursos…");
  const resourceMap = new Map<string, string>();
  for (const material of materials.filter(item => item.status !== "archived")) {
    if (material.kind === "file" && material.fileId) {
      const blob = await (await fetch(`/api/courses/${course.id}/files/${material.fileId}/content`, { credentials: "same-origin" })).blob();
      const { file } = await uploadCourseFile<{ file: Material }>(id, blob, material.fileName || `${material.title}.docx`);
      resourceMap.set(material.id, file.id);
    } else if (material.kind !== "file") {
      const { material: copy } = await api<{ material: Material }>(`/courses/${id}/materials`, "POST", { title: material.title, description: material.description, kind: material.kind, content: material.content, status: material.status, termIds: material.termIds });
      resourceMap.set(material.id, copy.id);
    }
  }
  onProgress?.("Copiando lecciones…");
  for (const lesson of lessons.filter(item => item.status !== "archived" && item.courseUnitId && unitMap.has(item.courseUnitId))) {
    const activities = normalizeActivities(lesson.activities).map(activity => {
      if (activity.type !== "resource" || !activity.resourceId) return activity;
      const mapped = resourceMap.get(activity.resourceId);
      if (mapped) return { ...activity, resourceId: mapped };
      return materials.some(item => item.id === activity.resourceId) ? { ...activity, type: "text" as const, resourceId: undefined } : activity;
    });
    await api("/lessons", "POST", lessonBody(id, { ...draftOf(lesson), unitId: unitMap.get(lesson.courseUnitId!)!, archived: false, activities }));
  }
  return id;
}
