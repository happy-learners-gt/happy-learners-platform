import type { Activity, ActivityGrouping, ActivityPurpose, SequenceTemplate } from "@happy-learners/contracts";
import type { AiTokenUsage } from "./ai-usage";
import type { LessonReview, ReviewCheckId } from "./lesson-review";
import { blocksOf, hasText, phaseOf, sequenceOf } from "./sequences";

/**
 * Assisted improvement (1.4.1, docs/design/asistente-ia.md §6c). From a lesson and the checks its review failed, a
 * model proposes changes: a field of an activity, a new activity or the objective. They are checked here (nothing that
 * names a missing activity or an impossible value survives) and shown as a draft; only what the person accepts is
 * applied, to the lesson's draft. The fixture improver fixes exactly what the review found, deterministically.
 */
export const improvePromptVersion = "2026-10-30.1";
const purposeValues: ActivityPurpose[] = ["explain", "explore", "practice", "assess", "reflect"];
const groupingValues: ActivityGrouping[] = ["individual", "pairs", "teams", "whole-class"];
export type ImproveField = "objective" | "title" | "instructions" | "minutes" | "purpose" | "grouping" | "phase";
export interface ImproveActivity { id: string; title: string; phase: string; purpose: ActivityPurpose | null; grouping: ActivityGrouping | null; minutes: number; instructions: string }
export interface ImproveInput {
  course: string; grade: string; classMinutes: number | null;
  sequence: { value: string; label: string; phases: { id: string; label: string; hint: string }[] };
  objective: string; activities: ImproveActivity[];
  failing: { id: ReviewCheckId; label: string; suggestion: string; evidence: string[] }[];
}
export interface NewActivity { title: string; phase: string; purpose: ActivityPurpose; grouping: ActivityGrouping; minutes: number; instructions: string }
/** One proposed change as a model writes it: `field` and `value` for an existing activity or the objective, `activity` for a new one. */
export interface ImproveOutputChange { kind: "objective" | "activity" | "new-activity"; activityId: string | null; field: ImproveField | null; value: string | null; activity: NewActivity | null; reason: string }
export interface ImproveOutput { changes: ImproveOutputChange[] }
/** A checked change, with what it replaces so the person sees the difference. */
export interface ImproveChange { id: string; kind: ImproveOutputChange["kind"]; activityId: string | null; activityTitle: string | null; field: ImproveField | null; before: string; after: string; activity: NewActivity | null; reason: string }
export interface LessonImprover { readonly kind: "fixture" | "openai"; improve(input: ImproveInput, observe?: (usage: AiTokenUsage) => void): Promise<ImproveOutput> }

const plain = (activity: Activity) => blocksOf(activity).map(block => (block.instructions || "").trim()).filter(Boolean).join("\n");
const filled = (activity: Activity) => blocksOf(activity).some(block => (block.instructions || "").trim() || hasText(block.richContent) || (block.kind === "resource" && block.resourceId) || (block.kind === "question" && (block.options || []).length));

/** What the model reads: the lesson in plain fields, and what failed with its evidence. Nothing about the students. */
export function improveInput(lesson: { objective: string; activities: Activity[]; sequence?: string }, review: LessonReview, context: { course: string; grade: string; classMinutes: number | null }): ImproveInput {
  const template = sequenceOf(lesson.sequence);
  return {
    ...context,
    sequence: { value: template.value, label: template.label, phases: template.phases.map(({ id, label, hint }) => ({ id, label, hint })) },
    objective: lesson.objective,
    activities: lesson.activities.map((activity, index) => ({
      id: activity.id || `activity-${index + 1}`, title: activity.title || "", phase: phaseOf(activity, template.value), purpose: activity.purpose || null,
      grouping: activity.grouping || null, minutes: Number(activity.minutes) || 0,
      // Formatted content counts as content: the model is told it is there, not given an empty activity to fill.
      instructions: plain(activity) || (filled(activity) ? "(contenido con formato o recursos)" : ""),
    })),
    failing: review.checks.filter(check => check.status === "fail" || check.status === "partial").map(check => ({ id: check.id, label: check.label, suggestion: check.suggestion, evidence: check.evidence.map(item => item.text) })),
  };
}

const newActivitySchema = { type: "object", additionalProperties: false, required: ["title", "phase", "purpose", "grouping", "minutes", "instructions"], properties: {
  title: { type: "string" }, phase: { type: "string" }, purpose: { type: "string", enum: purposeValues }, grouping: { type: "string", enum: groupingValues },
  minutes: { type: "integer" }, instructions: { type: "string" },
} } as const;
export const improveSchema = {
  type: "object", additionalProperties: false, required: ["changes"],
  properties: { changes: { type: "array", items: { type: "object", additionalProperties: false, required: ["kind", "activityId", "field", "value", "activity", "reason"], properties: {
    kind: { type: "string", enum: ["objective", "activity", "new-activity"] },
    activityId: { anyOf: [{ type: "string" }, { type: "null" }] },
    field: { anyOf: [{ type: "string", enum: ["objective", "title", "instructions", "minutes", "purpose", "grouping", "phase"] }, { type: "null" }] },
    value: { anyOf: [{ type: "string" }, { type: "null" }] },
    activity: { anyOf: [newActivitySchema, { type: "null" }] },
    reason: { type: "string" },
  } } } },
} as const;

export function improvePrompt(input: ImproveInput) {
  const system = [
    "Eres asesor pedagógico y mejoras lecciones que ya escribió una persona docente. Solo propones cambios: ella decide cuáles acepta.",
    "Escribe en español claro y concreto (o en el idioma de la lección si es de idiomas), tuteando a quien imparte. No inventes páginas, datos ni recursos.",
    "Cambia solo lo necesario para resolver los criterios que fallan; conserva el estilo y las ideas de la lección. Devuelve solo el objeto JSON pedido.",
  ].join(" ");
  const user = [
    `Curso: ${input.course}. Grado: ${input.grade}.${input.classMinutes ? ` Las clases duran ${input.classMinutes} minutos.` : ""}`,
    `Secuencia «${input.sequence.label}»; momentos (usa su id en "phase"):\n${input.sequence.phases.map(phase => `- ${phase.id}: ${phase.label}. ${phase.hint}`).join("\n")}`,
    `Objetivo: ${input.objective || "(vacío)"}`,
    `Actividades (id, momento, propósito, agrupación, minutos, título e instrucciones):\n${input.activities.map(activity => `- [${activity.id}] ${activity.phase} · ${activity.purpose || "sin propósito"} · ${activity.grouping || "sin agrupación"} · ${activity.minutes} min · «${activity.title}»: ${activity.instructions || "(sin instrucciones)"}`).join("\n") || "(ninguna)"}`,
    `Criterios de la revisión que fallan:\n${input.failing.map(check => `- ${check.label}: ${check.suggestion} Evidencia: ${check.evidence.join("; ")}`).join("\n")}`,
    "Propón de 1 a 8 cambios. Para cambiar el objetivo usa kind \"objective\", field \"objective\" y value. Para cambiar una actividad existente usa kind \"activity\", su activityId, un field (title, instructions, minutes, purpose, grouping o phase) y value como texto (minutos como número en texto). Para agregar una actividad usa kind \"new-activity\" y activity. Cada cambio lleva reason: qué criterio resuelve, en una oración.",
  ].join("\n\n");
  return { system, user };
}

const limits: Record<ImproveField, number> = { objective: 300, title: 160, instructions: 2000, minutes: 3, purpose: 20, grouping: 20, phase: 40 };
const purposeVerb: Record<ActivityPurpose, string> = { explain: "escuchan la explicación y toman nota de las ideas clave", explore: "exploran el tema con una pregunta o un material concreto", practice: "practican con ejercicios guiados", assess: "responden una pregunta para comprobar lo aprendido", reflect: "comentan qué aprendieron y cómo lo aplicarían" };

/** The local improver: deterministic changes for exactly what the review found. */
export const fixtureImprover: LessonImprover = {
  kind: "fixture",
  async improve(input) {
    const changes: ImproveOutputChange[] = [];
    const failing = new Set(input.failing.map(check => check.id));
    const last = input.sequence.phases.at(-1)!.id;
    if (failing.has("objective")) changes.push({ kind: "objective", activityId: null, field: "objective", value: `Al terminar la clase, cada estudiante ${input.objective.trim() ? input.objective.trim().replace(/\.$/, "").toLowerCase() : "explica con sus palabras lo que aprendió"} y lo demuestra en una actividad.`, activity: null, reason: "Objetivo: dice qué podrá hacer cada estudiante." });
    if (failing.has("instructions")) for (const activity of input.activities.filter(item => !item.instructions)) changes.push({ kind: "activity", activityId: activity.id, field: "instructions", value: `Los estudiantes ${purposeVerb[activity.purpose || "practice"]}.`, activity: null, reason: "Instrucciones: la actividad dice qué hacen los estudiantes." });
    if (failing.has("sequence")) for (const phase of input.sequence.phases.filter(phase => !input.activities.some(activity => activity.phase === phase.id)))
      changes.push({ kind: "new-activity", activityId: null, field: null, value: null, activity: { title: phase.label, phase: phase.id, purpose: phase.id === last ? "reflect" : "practice", grouping: "pairs", minutes: 10, instructions: phase.hint }, reason: `Secuencia: agrega el momento «${phase.label}».` });
    if (failing.has("assessment")) changes.push({ kind: "new-activity", activityId: null, field: null, value: null, activity: { title: "Comprobamos lo aprendido", phase: last, purpose: "assess", grouping: "individual", minutes: 5, instructions: "Cada estudiante responde una pregunta sobre el objetivo de la clase." }, reason: "Evaluación: una actividad comprueba lo aprendido." });
    if (failing.has("grouping")) {
      const target = input.activities.find(activity => activity.grouping !== "pairs");
      if (target) changes.push({ kind: "activity", activityId: target.id, field: "grouping", value: "pairs", activity: null, reason: "Agrupación: alterna el trabajo individual con el trabajo en parejas." });
    }
    if (failing.has("time") && input.classMinutes) {
      const added = changes.reduce((sum, change) => sum + (change.activity?.minutes || 0), 0);
      const total = input.activities.reduce((sum, activity) => sum + activity.minutes, 0) + added, gap = input.classMinutes - total;
      const longest = [...input.activities].sort((a, b) => b.minutes - a.minutes)[0];
      if (longest && gap && longest.minutes + gap >= 5) changes.push({ kind: "activity", activityId: longest.id, field: "minutes", value: String(longest.minutes + gap), activity: null, reason: `Tiempo: la lección dura lo mismo que la clase (${input.classMinutes} min).` });
    }
    return { changes };
  },
};

/** Keeps the changes that make sense for this lesson, with what each one replaces; drops the rest. */
export function checkedChanges(output: ImproveOutput, input: ImproveInput): ImproveChange[] {
  const phases = new Set(input.sequence.phases.map(phase => phase.id));
  const text = (value: unknown, max: number) => typeof value === "string" && value.trim() && value.trim().length <= max ? value.trim() : null;
  const kept: ImproveChange[] = [];
  for (const change of (output?.changes || []).slice(0, 12)) {
    const reason = text(change?.reason, 300) || "";
    if (change?.kind === "objective") {
      const value = text(change.value, limits.objective);
      if (value && value !== input.objective) kept.push({ id: `change-${kept.length + 1}`, kind: "objective", activityId: null, activityTitle: null, field: "objective", before: input.objective, after: value, activity: null, reason });
    } else if (change?.kind === "activity") {
      const activity = input.activities.find(item => item.id === change.activityId), field = change.field;
      if (!activity || !field || field === "objective" || !(field in limits)) continue;
      const value = text(change.value, limits[field]);
      if (!value) continue;
      if (field === "minutes" && !(/^\d+$/.test(value) && Number(value) >= 1 && Number(value) <= 240)) continue;
      if (field === "purpose" && !purposeValues.includes(value as ActivityPurpose)) continue;
      if (field === "grouping" && !groupingValues.includes(value as ActivityGrouping)) continue;
      if (field === "phase" && !phases.has(value)) continue;
      const before = String(activity[field] ?? "");
      if (before === value) continue;
      kept.push({ id: `change-${kept.length + 1}`, kind: "activity", activityId: activity.id, activityTitle: activity.title, field, before, after: value, activity: null, reason });
    } else if (change?.kind === "new-activity" && change.activity) {
      const item = change.activity, title = text(item.title, 160), instructions = text(item.instructions, 2000);
      if (!title || !instructions || !phases.has(item.phase) || !purposeValues.includes(item.purpose) || !groupingValues.includes(item.grouping) || !Number.isInteger(item.minutes) || item.minutes < 1 || item.minutes > 240) continue;
      kept.push({ id: `change-${kept.length + 1}`, kind: "new-activity", activityId: null, activityTitle: null, field: null, before: "", after: `${title} · ${item.minutes} min`, activity: { title, phase: item.phase, purpose: item.purpose, grouping: item.grouping, minutes: item.minutes, instructions }, reason });
    }
  }
  return kept;
}

/**
 * The lesson after the accepted changes. New activities go at the end of their moment, made of one text block as the
 * editor makes them; their ids come from `newId` (one for the activity, one for its block).
 */
export function applyChanges<T extends { objective: string; activities: Activity[]; sequence?: SequenceTemplate }>(lesson: T, accepted: ImproveChange[], newId: (kind: "activity" | "block") => string): T {
  let objective = lesson.objective;
  let activities = lesson.activities.map(activity => ({ ...activity }));
  for (const change of accepted) {
    if (change.kind === "objective") objective = change.after;
    else if (change.kind === "activity") activities = activities.map((activity, index) => {
      if ((activity.id || `activity-${index + 1}`) !== change.activityId) return activity;
      if (change.field === "minutes") return { ...activity, minutes: Number(change.after) };
      if (change.field === "instructions") {
        // The text goes in the first text block; an activity made of blocks keeps the others.
        if (!activity.blocks?.length) return { ...activity, instructions: change.after, type: activity.type || "text" };
        const at = activity.blocks.findIndex(block => block.kind === "text");
        const blocks = at >= 0 ? activity.blocks.map((block, position) => position === at ? { ...block, instructions: change.after, richContent: undefined } : block) : [{ id: `${activity.id || "activity"}-text`, kind: "text" as const, instructions: change.after }, ...activity.blocks];
        return { ...activity, blocks };
      }
      return { ...activity, [change.field!]: change.after };
    });
    else if (change.kind === "new-activity" && change.activity) {
      const added: Activity = { id: newId("activity"), title: change.activity.title, phase: change.activity.phase, purpose: change.activity.purpose, grouping: change.activity.grouping, minutes: change.activity.minutes,
        instructions: "", blocks: [{ id: newId("block"), kind: "text", instructions: change.activity.instructions }] };
      const order = sequenceOf(lesson.sequence).phases.map(phase => phase.id), rank = order.indexOf(change.activity.phase);
      const after = activities.reduce((last, activity, index) => order.indexOf(phaseOf(activity, lesson.sequence)) <= rank ? index : last, -1);
      activities = [...activities.slice(0, after + 1), added, ...activities.slice(after + 1)];
    }
  }
  return { ...lesson, objective, activities: activities.map((activity, position) => ({ ...activity, position })) };
}
