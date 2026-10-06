import type { Activity, ActivityBlock, Course, LearningUnit, Lesson, Material, RichTextDocument, RichTextNode, SequenceTemplate } from "@happy-learners/contracts";
import { blocksOf, phaseOf, resourceIdsOf, sequenceOf } from "@happy-learners/domain";

export type LessonState = "draft" | "published" | "changes" | "archived";
export function lessonState(lesson: Pick<Lesson, "status" | "revision" | "hasDraft">): LessonState {
  if (lesson.status === "archived") return "archived";
  if (!lesson.revision) return "draft";
  return lesson.hasDraft ? "changes" : "published";
}
export const lessonStateLabel: Record<LessonState, string> = { draft: "Borrador", published: "Publicada", changes: "Cambios sin publicar", archived: "Archivada" };

export const resourceKindLabel: Record<Material["kind"] | "legacy", string> = { text: "Texto", link: "Enlace", file: "Documento", legacy: "Texto" };
export function resourceStatusLabel(status: Material["status"]) { return status === "archived" ? "Archivado" : status === "draft" ? "Borrador" : "Disponible"; }
export const blockKindLabel: Record<ActivityBlock["kind"], string> = { text: "Texto", resource: "Recurso", question: "Pregunta", "teacher-note": "Nota para el docente" };

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
export const blockHue: Record<ActivityBlock["kind"], Hue> = { text: "sky", resource: "teal", question: "pink", "teacher-note": "amber" };
/** Moments of a sequence take colours in order, so the editor, outline and player show the same moment alike. */
export const phaseHue = (index: number): Hue => (["violet", "sky", "teal", "coral", "green"] as const)[index % 5];
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
 * The editor always works with composite activities: an ID, a moment of the sequence and ordered blocks.
 * Older activities (one typed body, sometimes without ID) become one block that keeps the activity ID, so
 * their collaborative text and public links are preserved. Missing IDs come from the position.
 */
export function normalizeActivities(activities: Activity[], sequence?: SequenceTemplate): Activity[] {
  return orderByPhase(activities.map((activity, position) => {
    const id = activity.id || `activity-${position + 1}`;
    const { type: _type, richContent: _rich, resourceId: _resource, options: _options, answer: _answer, ...rest } = activity;
    return { ...rest, id, position, instructions: "", phase: phaseOf(activity, sequence), blocks: blocksOf({ ...activity, id }) };
  }), sequence);
}
/** Activities in the order of the moments; inside a moment they keep their order. */
export function orderByPhase(activities: Activity[], sequence?: SequenceTemplate) {
  const ids = sequenceOf(sequence).phases.map(phase => phase.id);
  return activities.map((activity, index) => ({ activity, index })).sort((a, b) => ids.indexOf(phaseOf(a.activity, sequence)) - ids.indexOf(phaseOf(b.activity, sequence)) || a.index - b.index).map(item => item.activity);
}
/** Switching templates keeps each activity in the moment at the same position (or the last one), so order survives. */
export function changeSequence(activities: Activity[], from: SequenceTemplate, to: SequenceTemplate) {
  const before = sequenceOf(from).phases.map(phase => phase.id), after = sequenceOf(to).phases.map(phase => phase.id);
  return orderByPhase(activities.map(activity => ({ ...activity, phase: after[Math.min(Math.max(0, before.indexOf(phaseOf(activity, from))), after.length - 1)] })), to);
}
export const newBlock = (kind: ActivityBlock["kind"]): ActivityBlock => ({ id: `block-${crypto.randomUUID()}`, kind, ...(kind === "question" ? { options: ["", ""], answer: 0 } : {}) });

export type LessonDraft = { title: string; objective: string; duration: number; unitId: string; archived: boolean; sequence: SequenceTemplate; outcomeIds: string[]; activities: Activity[] };
export function draftOf(lesson: Lesson, fallback: SequenceTemplate = "free"): LessonDraft {
  const sequence = lesson.sequence || fallback;
  return { title: lesson.title, objective: lesson.objective, duration: lesson.duration || 20, unitId: lesson.courseUnitId || "", archived: lesson.status === "archived", sequence, outcomeIds: lesson.outcomeIds || [], activities: normalizeActivities(lesson.activities || [], sequence) };
}
export function lessonBody(courseId: string, draft: LessonDraft, draftVersion?: number) {
  const activities = draft.activities.map((activity, position) => ({ ...activity, position }));
  return { title: draft.title, objective: draft.objective, courseId, courseUnitId: draft.unitId, duration: draft.duration, draftVersion, status: draft.archived ? "archived" : "draft", sequence: draft.sequence, outcomeIds: draft.outcomeIds, instructions: "", activities };
}
const blockLabel: Record<ActivityBlock["kind"], string> = { text: "el texto", resource: "el recurso", question: "la pregunta", "teacher-note": "la nota para el docente" };

/** Mirrors the server rules so autosave only sends drafts it can accept, and explains what is missing. */
export function draftProblem(draft: LessonDraft): { message: string; target: string } | null {
  if (!draft.title.trim()) return { message: "Escribe un título para guardar.", target: "title" };
  if (draft.title.length > 160) return { message: "Acorta el título a 160 caracteres.", target: "title" };
  if (!draft.objective.trim()) return { message: "Escribe el objetivo de la lección para guardar.", target: "details" };
  if (draft.activities.length > 30) return { message: "Una lección admite hasta 30 actividades.", target: "details" };
  for (const [index, activity] of draft.activities.entries()) {
    const target = activity.id || String(index), name = `la actividad ${index + 1}`;
    if (!activity.title.trim()) return { message: `Escribe el título de ${name} para guardar.`, target };
    if (!Number.isInteger(activity.minutes) || activity.minutes < 1 || activity.minutes > 120) return { message: `Indica entre 1 y 120 minutos para ${name}.`, target };
    const blocks = activity.blocks || [];
    if (!blocks.some(block => block.kind !== "teacher-note")) return { message: `Agrega a ${name} algo para los estudiantes: texto, recurso o pregunta.`, target };
    if (blocks.length > 12) return { message: `${name[0].toUpperCase()}${name.slice(1)} admite hasta 12 bloques.`, target };
    for (const block of blocks) {
      const where = `${blockLabel[block.kind]} de ${name}`;
      if (block.kind === "resource") { if (!block.resourceId) return { message: `Elige ${where} para guardar.`, target }; continue; }
      if (!(block.instructions || "").trim() && !richTextLength(block.richContent)) return { message: `Escribe ${where} para guardar.`, target };
      if (block.kind === "question") {
        const options = block.options || [];
        if (options.length < 2 || options.some(option => !option.trim())) return { message: `Completa al menos dos opciones en ${where}.`, target };
        if (new Set(options.map(option => option.trim())).size !== options.length) return { message: `Las opciones de ${where} deben ser distintas.`, target };
        if (!Number.isInteger(block.answer) || block.answer! < 0 || block.answer! >= options.length) return { message: `Marca la respuesta correcta de ${where}.`, target };
      }
    }
  }
  return null;
}

export function courseBody(course: Course, patch: Partial<Course> = {}) {
  const next = { ...course, ...patch };
  return { title: next.title, objective: next.objective, status: next.status, programId: next.programId || null, educationType: next.educationType, level: next.level, format: next.format, modality: next.modality, pacing: next.pacing, area: next.area || null, settings: next.settings, version: course.version };
}

export type CourseStats = { units: number; lessons: number; published: number; drafts: number; changes: number };
export function courseStats(units: LearningUnit[], lessons: Lesson[]): CourseStats {
  const active = lessons.filter(lesson => lesson.status !== "archived");
  const states = active.map(lessonState);
  return { units: units.filter(unit => unit.status === "active").length, lessons: active.length, published: states.filter(state => state !== "draft").length, drafts: states.filter(state => state === "draft").length, changes: states.filter(state => state === "changes").length };
}
export function usage(resourceId: string, lessons: Lesson[]) {
  return lessons.filter(lesson => lesson.status !== "archived" && resourceIdsOf(lesson.activities).includes(resourceId));
}
export function newest<T extends { updatedAt?: string }>(rows: T[]) { return [...rows].sort((a, b) => (b.updatedAt || "").localeCompare(a.updatedAt || "")); }

/** The lessons a class plans, as one line: «Saludos · Colores». */
export const lessonNames = (session: { lessons: { title: string }[] }) => session.lessons.map(lesson => lesson.title).join(" · ");
