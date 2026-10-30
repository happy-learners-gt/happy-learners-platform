import type { Activity, ActivityGrouping, SequenceTemplate } from "@happy-learners/contracts";
import { blocksOf, hasText, phaseOf, sequenceOf } from "./sequences";

/**
 * Lesson review with a fact-based score (1.4.0, docs/design/asistente-ia.md §6b). Every check is deterministic: the
 * same lesson always gets the same score. A language model may explain the result, never change it.
 */
export type ReviewStatus = "pass" | "partial" | "fail" | "n/a";
export type ReviewCheckId = "objective" | "alignment" | "sequence" | "time" | "assessment" | "grouping" | "resources" | "instructions";
export interface ReviewEvidence { activityId?: string; text: string }
export interface ReviewCheck { id: ReviewCheckId; label: string; weight: number; status: ReviewStatus; evidence: ReviewEvidence[]; suggestion: string }
export interface LessonReview { score: number; level: "good" | "fair" | "poor"; checks: ReviewCheck[] }
export interface ReviewLesson { objective: string; outcomeIds?: string[]; materials?: string[]; activities: Activity[] }
export interface ReviewContext {
  sequence?: SequenceTemplate;
  /** How many learning outcomes the course plan has: without any, alignment does not apply. */
  courseOutcomes: number;
  /** Whether the course has indexed resources: then a lesson should cite one with its pages. */
  indexedResources: boolean;
  /** How long the course's classes last (the most common duration of its sections' schedules), or null. */
  classMinutes: number | null;
}

const weights: Record<ReviewCheckId, number> = { objective: 10, alignment: 20, sequence: 15, time: 15, assessment: 15, grouping: 10, resources: 10, instructions: 5 };
const labels: Record<ReviewCheckId, string> = {
  objective: "Objetivo", alignment: "Alineación con el plan", sequence: "Secuencia didáctica", time: "Tiempo",
  assessment: "Evaluación", grouping: "Agrupación", resources: "Recursos", instructions: "Instrucciones",
};
const value: Record<ReviewStatus, number> = { pass: 1, partial: 0.5, fail: 0, "n/a": 0 };
const named = (activity: Activity, index: number) => activity.title?.trim() || `Actividad ${index + 1}`;
const minutesOf = (lesson: ReviewLesson) => lesson.activities.reduce((sum, activity) => sum + (Number(activity.minutes) || 0), 0);
const evidenceOf = (activity: Activity, index: number, text: string): ReviewEvidence => ({ ...(activity.id ? { activityId: activity.id } : {}), text: `${named(activity, index)}: ${text}` });

function check(id: ReviewCheckId, status: ReviewStatus, evidence: ReviewEvidence[], suggestion: string): ReviewCheck {
  return { id, label: labels[id], weight: weights[id], status, evidence, suggestion: status === "pass" || status === "n/a" ? "" : suggestion };
}

function objective(lesson: ReviewLesson): ReviewCheck {
  const text = lesson.objective.trim();
  if (!text) return check("objective", "fail", [{ text: "La lección no tiene objetivo." }], "Escribe qué podrán hacer las y los estudiantes al terminar la clase.");
  if (text.length < 15) return check("objective", "partial", [{ text: `El objetivo tiene ${text.length} caracteres.` }], "Precisa el objetivo: qué harán, con qué y para qué.");
  if (text.length > 300) return check("objective", "partial", [{ text: `El objetivo tiene ${text.length} caracteres.` }], "Acorta el objetivo a una o dos oraciones.");
  return check("objective", "pass", [{ text: `«${text}»` }], "");
}

function alignment(lesson: ReviewLesson, context: ReviewContext): ReviewCheck {
  if (!context.courseOutcomes) return check("alignment", "n/a", [{ text: "El curso aún no tiene resultados de aprendizaje." }], "");
  const own = lesson.outcomeIds || [];
  if (!own.length) return check("alignment", "fail", [{ text: "La lección no trabaja ningún resultado del plan." }], "Elige en la lección los resultados del plan que trabaja.");
  const stray = lesson.activities.flatMap((activity, index) => (activity.outcomeIds || []).some(id => !own.includes(id)) ? [evidenceOf(activity, index, "trabaja un resultado que la lección no declara")] : []);
  if (stray.length) return check("alignment", "partial", stray, "Agrega esos resultados a la lección o quítalos de la actividad.");
  return check("alignment", "pass", [{ text: `Trabaja ${own.length} ${own.length === 1 ? "resultado" : "resultados"} del plan.` }], "");
}

function sequence(lesson: ReviewLesson, context: ReviewContext): ReviewCheck {
  const template = sequenceOf(context.sequence);
  if (template.value === "free") return check("sequence", "n/a", [{ text: "El curso usa la secuencia libre." }], "");
  const order = template.phases.map(phase => phase.id);
  const placed = lesson.activities.map(activity => order.indexOf(phaseOf(activity, template.value)));
  const missing = template.phases.filter((_, index) => !placed.includes(index));
  const ordered = placed.every((position, index) => index === 0 || position >= placed[index - 1]);
  const evidence = [
    ...missing.map(phase => ({ text: `Falta el momento «${phase.label}».` })),
    ...(ordered ? [] : [{ text: "Hay actividades fuera del orden de los momentos." }]),
  ];
  if (!missing.length && ordered) return check("sequence", "pass", [{ text: `Cubre los ${order.length} momentos de «${template.label}» en orden.` }], "");
  const partial = (!missing.length && !ordered) || (missing.length === 1 && order.length >= 3 && ordered);
  return check("sequence", partial ? "partial" : "fail", evidence, missing.length
    ? `Agrega una actividad para ${missing.map(phase => `«${phase.label}» (${phase.hint.charAt(0).toLowerCase()}${phase.hint.slice(1, -1)})`).join(" y ")}.`
    : "Ordena las actividades según los momentos de la secuencia.");
}

// A lesson's duration is the sum of its activities: it is measured against how long the course's classes last.
function time(lesson: ReviewLesson, context: ReviewContext): ReviewCheck {
  if (!context.classMinutes) return check("time", "n/a", [{ text: "Las secciones del curso aún no tienen horario." }], "");
  const total = minutesOf(lesson), target = context.classMinutes, ratio = total / target;
  const evidence = [{ text: `Las actividades suman ${total} min; las clases del curso duran ${target} min.` }];
  if (ratio >= 0.9 && ratio <= 1.1) return check("time", "pass", evidence, "");
  const suggestion = total < target ? `Faltan ${target - total} min: amplía una actividad o agrega otra.` : `Sobran ${total - target} min: acorta o quita una actividad.`;
  return check("time", ratio >= 0.75 && ratio <= 1.25 ? "partial" : "fail", evidence, suggestion);
}

function assessment(lesson: ReviewLesson): ReviewCheck {
  const found = lesson.activities.flatMap((activity, index) =>
    activity.purpose === "assess" ? [evidenceOf(activity, index, "su propósito es evaluar")]
      : blocksOf(activity).some(block => block.kind === "question" && (block.options || []).length > 1) ? [evidenceOf(activity, index, "tiene una pregunta con respuesta")] : []);
  if (found.length) return check("assessment", "pass", found, "");
  return check("assessment", "fail", [{ text: "Ninguna actividad comprueba lo aprendido." }], "Agrega una actividad con propósito «Evaluar» o una pregunta con su respuesta al cierre.");
}

function grouping(lesson: ReviewLesson): ReviewCheck {
  if (minutesOf(lesson) <= 30) return check("grouping", "n/a", [{ text: "La lección dura 30 minutos o menos." }], "");
  const kinds = new Set<ActivityGrouping>(lesson.activities.flatMap(activity => activity.grouping ? [activity.grouping] : []));
  const evidence = [{ text: kinds.size ? `Formas de trabajo: ${[...kinds].map(kind => ({ individual: "individual", pairs: "en parejas", teams: "en equipos", "whole-class": "toda la clase" })[kind]).join(", ")}.` : "Ninguna actividad indica cómo se agrupan." }];
  if (kinds.size >= 2) return check("grouping", "pass", evidence, "");
  return check("grouping", "fail", evidence, "Alterna al menos dos formas de trabajo (por ejemplo, individual y en parejas).");
}

function resources(lesson: ReviewLesson, context: ReviewContext): ReviewCheck {
  const blocks = lesson.activities.flatMap((activity, index) => blocksOf(activity).filter(block => block.kind === "resource" && block.resourceId).map(block => ({ activity, index, block })));
  const cited = blocks.filter(item => item.block.pages || item.block.chapter);
  if (!blocks.length && !(lesson.materials || []).length) return check("resources", "fail", [{ text: "La lección no usa ningún recurso ni material." }], "Agrega un recurso del curso a la actividad que lo usa.");
  if (context.indexedResources && !cited.length) return check("resources", "partial", [{ text: "Usa recursos, pero ninguno con capítulo o páginas." }], "Indica el capítulo o las páginas del recurso indexado que se lee o trabaja.");
  return check("resources", "pass", (cited.length ? cited : blocks).map(item => evidenceOf(item.activity, item.index, item.block.pages ? `págs. ${item.block.pages}` : item.block.chapter || "usa un recurso")).slice(0, 5)
    .concat(!blocks.length ? [{ text: `${(lesson.materials || []).length} materiales.` }] : []), "");
}

function instructions(lesson: ReviewLesson): ReviewCheck {
  const empty = lesson.activities.flatMap((activity, index) => blocksOf(activity).some(block =>
    (block.instructions || "").trim() || hasText(block.richContent) || (block.kind === "resource" && block.resourceId) || (block.kind === "question" && (block.options || []).length)) ? [] : [evidenceOf(activity, index, "no tiene instrucciones ni contenido")]);
  if (!lesson.activities.length) return check("instructions", "fail", [{ text: "La lección no tiene actividades." }], "Agrega las actividades de la clase.");
  if (empty.length) return check("instructions", "fail", empty, "Escribe qué hacen las y los estudiantes en cada actividad.");
  return check("instructions", "pass", [{ text: `Las ${lesson.activities.length} actividades tienen instrucciones o contenido.` }], "");
}

/** The review of a lesson: each check with its evidence, and a 0–100 score over the checks that apply. */
export function lessonReview(lesson: ReviewLesson, context: ReviewContext): LessonReview {
  const checks = [objective(lesson), alignment(lesson, context), sequence(lesson, context), time(lesson, context), assessment(lesson), grouping(lesson), resources(lesson, context), instructions(lesson)];
  const applicable = checks.filter(item => item.status !== "n/a");
  const total = applicable.reduce((sum, item) => sum + item.weight, 0);
  const score = total ? Math.round(applicable.reduce((sum, item) => sum + item.weight * value[item.status], 0) / total * 100) : 0;
  return { score, level: score >= 80 ? "good" : score >= 60 ? "fair" : "poor", checks };
}

/** How long a course's classes last: the most common duration among its active sections' schedules (the longest on a tie). */
export function classMinutesOf(groups: { status?: string; schedule?: { durationMinutes: number; meetings?: { durationMinutes: number }[] } | null }[]): number | null {
  const counts = new Map<number, number>();
  for (const group of groups) {
    if (group.status === "archived" || !group.schedule) continue;
    const durations = group.schedule.meetings?.length ? group.schedule.meetings.map(meeting => meeting.durationMinutes) : [group.schedule.durationMinutes];
    for (const minutes of durations) if (minutes > 0) counts.set(minutes, (counts.get(minutes) || 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || b[0] - a[0])[0]?.[0] ?? null;
}
