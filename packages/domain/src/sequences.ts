import type { Activity, ActivityBlock, ActivityGrouping, ActivityPurpose, CourseProfile, RichTextDocument, SequenceTemplate } from "@happy-learners/contracts";

/**
 * Didactic sequences. A lesson follows one template; its moments order the activities and say what each
 * part of the class is for. "free" has a single unnamed moment for lessons that need no structure.
 */
export type Phase = { id: string; label: string; hint: string };
export const sequenceTemplates: { value: SequenceTemplate; label: string; description: string; phases: Phase[] }[] = [
  { value: "start-develop-close", label: "Inicio · Desarrollo · Cierre", description: "Estructura general para cualquier clase.", phases: [
    { id: "start", label: "Inicio", hint: "Activa saberes previos y presenta el objetivo." },
    { id: "develop", label: "Desarrollo", hint: "Explica, modela y practica." },
    { id: "close", label: "Cierre", hint: "Comprueba lo aprendido y reflexiona." },
  ] },
  { value: "five-e", label: "5E · Indagación", description: "Para ciencias y aprendizaje por descubrimiento.", phases: [
    { id: "engage", label: "Involucrar", hint: "Despierta la curiosidad con una pregunta o fenómeno." },
    { id: "explore", label: "Explorar", hint: "Investigan y prueban ideas por su cuenta." },
    { id: "explain", label: "Explicar", hint: "Ponen en palabras lo descubierto; el docente formaliza." },
    { id: "elaborate", label: "Elaborar", hint: "Aplican la idea a una situación nueva." },
    { id: "evaluate", label: "Evaluar", hint: "Comprueban su comprensión." },
  ] },
  { value: "ppp", label: "Presentación · Práctica · Producción", description: "Para idiomas y habilidades comunicativas.", phases: [
    { id: "presentation", label: "Presentación", hint: "Introduce el lenguaje o la habilidad en contexto." },
    { id: "practice", label: "Práctica", hint: "Práctica controlada y guiada." },
    { id: "production", label: "Producción", hint: "Uso libre en una tarea con sentido." },
  ] },
  { value: "workshop", label: "Demostración · Práctica guiada · Práctica independiente", description: "Para talleres y laboratorios.", phases: [
    { id: "demonstration", label: "Demostración", hint: "Muestra el procedimiento paso a paso." },
    { id: "guided", label: "Práctica guiada", hint: "Lo hacen juntos con apoyo." },
    { id: "independent", label: "Práctica independiente", hint: "Lo hacen solos y entregan evidencia." },
  ] },
  { value: "free", label: "Libre", description: "Actividades en orden, sin momentos.", phases: [{ id: "main", label: "Actividades", hint: "" }] },
];
export const defaultSequence: Record<CourseProfile, SequenceTemplate> = { free: "start-develop-close", preschool: "start-develop-close", school: "start-develop-close", university: "start-develop-close", workshop: "workshop", laboratory: "five-e" };
export function sequenceOf(value?: string) { return sequenceTemplates.find(template => template.value === value) || sequenceTemplates.find(template => template.value === "free")!; }

export const purposes: { value: ActivityPurpose; label: string }[] = [
  { value: "explain", label: "Explicar" }, { value: "explore", label: "Explorar" }, { value: "practice", label: "Practicar" },
  { value: "assess", label: "Evaluar" }, { value: "reflect", label: "Reflexionar" },
];
export const groupings: { value: ActivityGrouping; label: string }[] = [
  { value: "individual", label: "Individual" }, { value: "pairs", label: "En parejas" }, { value: "teams", label: "En equipos" }, { value: "whole-class", label: "Toda la clase" },
];
export const blockKinds: { value: ActivityBlock["kind"]; label: string }[] = [
  { value: "text", label: "Texto" }, { value: "resource", label: "Recurso" }, { value: "question", label: "Pregunta" }, { value: "teacher-note", label: "Nota para el docente" },
];

/** Blocks of an activity, reading older single-type activities as one block that keeps the activity id. */
export function blocksOf(activity: Activity): ActivityBlock[] {
  if (activity.blocks?.length) return activity.blocks;
  const kind = activity.type || "text";
  return [{
    id: activity.id || "block-1", kind,
    ...(activity.instructions ? { instructions: activity.instructions } : {}),
    ...(activity.richContent ? { richContent: activity.richContent } : {}),
    ...(kind === "resource" && activity.resourceId ? { resourceId: activity.resourceId } : {}),
    ...(kind === "question" ? { options: activity.options || [], answer: activity.answer ?? 0 } : {}),
  }];
}

/** Places an activity in a moment of the template; activities from another template go to the first moment. */
export function phaseOf(activity: Activity, template: SequenceTemplate | undefined) {
  const phases = sequenceOf(template).phases;
  return phases.some(phase => phase.id === activity.phase) ? activity.phase! : phases[0].id;
}

/** What students receive: teacher notes are removed before a lesson is published or shared. */
export function studentActivities(activities: Activity[]): Activity[] {
  return activities.map(activity => activity.blocks ? { ...activity, blocks: activity.blocks.filter(block => block.kind !== "teacher-note") } : activity);
}

/** Every library resource an activity points to, in old or new form. */
export function resourceIdsOf(activities: Activity[]): string[] {
  return [...new Set(activities.flatMap(activity => blocksOf(activity).flatMap(block => block.kind === "resource" && block.resourceId ? [block.resourceId] : [])))];
}

/** IDs of the collaborative rich-text fields of a lesson: one per block (older activities: the activity id). */
export function richTextFieldsOf(activities: Activity[]): string[] {
  return activities.flatMap(activity => blocksOf(activity).map(block => block.id)).filter(id => /^[a-zA-Z0-9_-]{1,100}$/.test(id));
}

export function hasText(document: RichTextDocument | undefined, plain = ""): boolean {
  if (plain.trim()) return true;
  let found = false;
  const visit = (node: { text?: string; content?: unknown[] }) => { if (found) return; if (typeof node.text === "string" && node.text.trim()) found = true; (node.content as typeof node[] | undefined)?.forEach(visit); };
  if (document) visit(document as unknown as { content?: unknown[] });
  return found;
}
