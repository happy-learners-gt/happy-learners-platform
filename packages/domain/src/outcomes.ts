import type { Activity, CognitiveLevel, Competency, Curriculum, LearningOutcome, LearningUnit, Lesson } from "@happy-learners/contracts";
import { cleanText, record } from "./courses";
import { blocksOf, sequenceOf, phaseOf } from "./sequences";

/**
 * Curricular framework. A course develops competencies; each competency is evidenced by learning outcomes
 * (what learners can show at the end). Units plan outcomes, lessons and activities work on them, and an
 * activity that checks learning (purpose "assess" or a question) evidences them. Coverage follows from that.
 */
export const cognitiveLevels: { value: CognitiveLevel; label: string; verbs: string }[] = [
  { value: "remember", label: "Recordar", verbs: "nombra, identifica, reconoce" },
  { value: "understand", label: "Comprender", verbs: "explica, describe, clasifica" },
  { value: "apply", label: "Aplicar", verbs: "usa, resuelve, demuestra" },
  { value: "analyze", label: "Analizar", verbs: "compara, distingue, organiza" },
  { value: "evaluate", label: "Evaluar", verbs: "justifica, valora, argumenta" },
  { value: "create", label: "Crear", verbs: "diseña, produce, propone" },
];
export const outcomeLimit = 40, competencyLimit = 12;
const id = /^[a-z0-9-]{1,120}$/;

export function competencyInput(input: unknown): Pick<Competency, "name" | "description" | "status"> | null {
  const v = record(input); if (!v) return null;
  const name = cleanText(v.name, 120), description = cleanText(v.description ?? "", 600, false);
  if (!name || description === null || !["active", "archived"].includes(String(v.status))) return null;
  return { name, description, status: v.status as Competency["status"] };
}
export function outcomeInput(input: unknown): Pick<LearningOutcome, "statement" | "level" | "evidence" | "status"> & { competencyId: string | null } | null {
  const v = record(input); if (!v) return null;
  const statement = cleanText(v.statement, 400), evidence = cleanText(v.evidence ?? "", 400, false);
  const competencyId = v.competencyId === undefined || v.competencyId === null || v.competencyId === "" ? null : v.competencyId;
  if (!statement || evidence === null || !cognitiveLevels.some(level => level.value === v.level) || !["active", "archived"].includes(String(v.status))) return null;
  if (competencyId !== null && (typeof competencyId !== "string" || !id.test(competencyId))) return null;
  return { statement, evidence, level: v.level as CognitiveLevel, status: v.status as LearningOutcome["status"], competencyId };
}
export function validOutcomeIds(value: unknown): value is string[] {
  return Array.isArray(value) && value.length <= 12 && new Set(value).size === value.length && value.every(item => typeof item === "string" && id.test(item));
}

/** Codes follow the order of active outcomes: RA1, RA2… Archived ones keep no code. */
export function outcomeCodes(outcomes: LearningOutcome[]): Map<string, string> {
  return new Map(outcomes.filter(o => o.status === "active").sort((a, b) => a.position - b.position).map((o, index) => [o.id, `RA${index + 1}`]));
}

/** The outcomes an activity works on: its own, or those of its lesson when it names none. */
export const activityOutcomes = (activity: Activity, lesson: Lesson) => activity.outcomeIds?.length ? activity.outcomeIds : lesson.outcomeIds || [];
/** An activity checks learning when its purpose is to assess or it asks a question. */
export const assesses = (activity: Activity) => activity.purpose === "assess" || blocksOf(activity).some(block => block.kind === "question");
/** Everything a lesson works on, at lesson or activity level. */
export const lessonOutcomes = (lesson: Lesson) => [...new Set([...(lesson.outcomeIds || []), ...lesson.activities.flatMap(activity => activity.outcomeIds || [])])];

export type Gap = "no-unit" | "no-lesson" | "no-assessment";
export type OutcomeCoverage = { outcome: LearningOutcome; code: string; units: string[]; lessons: string[]; assessedIn: string[]; deliveredIn: string[]; published: boolean; gaps: Gap[] };
export type UnitCoverage = { unit: LearningUnit; planned: string[]; taught: string[]; missing: string[] };
/**
 * Where each active outcome is planned (units), worked on (lessons), evidenced (assessing activities) and
 * delivered (lessons given in completed classes), and what is missing. Archived units and lessons do not count.
 */
export function coverage(curriculum: Curriculum, units: LearningUnit[], lessons: Lesson[], delivered: string[] = []) {
  const codes = outcomeCodes(curriculum.outcomes);
  const activeUnits = units.filter(unit => unit.status === "active").sort((a, b) => a.position - b.position);
  const live = lessons.filter(lesson => lesson.status !== "archived" && activeUnits.some(unit => unit.id === lesson.courseUnitId));
  const outcomes: OutcomeCoverage[] = curriculum.outcomes.filter(o => codes.has(o.id)).sort((a, b) => a.position - b.position).map(outcome => {
    const planned = activeUnits.filter(unit => curriculum.unitOutcomes.some(link => link.unitId === unit.id && link.outcomeId === outcome.id)).map(unit => unit.id);
    const teaching = live.filter(lesson => lessonOutcomes(lesson).includes(outcome.id));
    const assessedIn = teaching.filter(lesson => lesson.activities.some(activity => assesses(activity) && activityOutcomes(activity, lesson).includes(outcome.id))).map(lesson => lesson.id);
    const gaps: Gap[] = [];
    if (!planned.length && !teaching.length) gaps.push("no-unit");
    if (!teaching.length) gaps.push("no-lesson");
    else if (!assessedIn.length) gaps.push("no-assessment");
    return { outcome, code: codes.get(outcome.id)!, units: planned, lessons: teaching.map(lesson => lesson.id), assessedIn, deliveredIn: teaching.filter(lesson => delivered.includes(lesson.id)).map(lesson => lesson.id), published: teaching.some(lesson => !!lesson.revision), gaps };
  });
  const unitCoverage: UnitCoverage[] = activeUnits.map(unit => {
    const planned = outcomes.filter(item => item.units.includes(unit.id)).map(item => item.outcome.id);
    const taught = [...new Set(live.filter(lesson => lesson.courseUnitId === unit.id).flatMap(lessonOutcomes))].filter(o => codes.has(o));
    return { unit, planned, taught, missing: planned.filter(o => !taught.includes(o)) };
  });
  // Outcomes that still need something (a unit, a lesson or an assessment); each counts once.
  const gaps = outcomes.filter(item => item.gaps.length).length;
  return { outcomes, units: unitCoverage, summary: { total: outcomes.length, taught: outcomes.filter(item => item.lessons.length).length, assessed: outcomes.filter(item => item.assessedIn.length).length, delivered: outcomes.filter(item => item.deliveredIn.length).length, gaps } };
}

/** Resources used by other lessons that work on the same outcomes, most used first. */
export function suggestedResources(lesson: Lesson, lessons: Lesson[], resourceIds: (activities: Activity[]) => string[]) {
  const mine = new Set(lessonOutcomes(lesson)), used = new Set(resourceIds(lesson.activities)), count = new Map<string, number>();
  if (!mine.size) return [];
  for (const other of lessons) {
    if (other.id === lesson.id || other.status === "archived" || !lessonOutcomes(other).some(o => mine.has(o))) continue;
    for (const resource of resourceIds(other.activities)) if (!used.has(resource)) count.set(resource, (count.get(resource) || 0) + 1);
  }
  return [...count.entries()].sort((a, b) => b[1] - a[1]).map(([resource]) => resource);
}

export type CheckItem = { id: "outcomes" | "moments" | "assessment" | "time"; label: string; ok: boolean; hint: string };
/**
 * Before publishing: recommendations, not rules. Publishing is still allowed when an item is open,
 * because some lessons (a review, a visit) legitimately skip one.
 */
export function publishChecklist(lesson: Lesson, curriculum: Curriculum): CheckItem[] {
  const active = curriculum.outcomes.filter(o => o.status === "active");
  const aligned = lessonOutcomes(lesson).filter(o => active.some(item => item.id === o));
  const template = sequenceOf(lesson.sequence);
  const empty = template.value === "free" ? [] : template.phases.filter(phase => !lesson.activities.some(activity => phaseOf(activity, lesson.sequence) === phase.id));
  const checking = lesson.activities.filter(assesses);
  const minutes = lesson.activities.reduce((sum, activity) => sum + activity.minutes, 0);
  const fits = minutes <= lesson.duration && minutes >= Math.floor(lesson.duration * 0.75);
  return [
    { id: "outcomes", label: "Alineada a resultados de aprendizaje", ok: aligned.length > 0, hint: aligned.length ? `Trabaja ${aligned.length === 1 ? "1 resultado" : `${aligned.length} resultados`} del curso.` : active.length ? "Elige qué resultados del curso desarrolla." : "El curso aún no tiene resultados de aprendizaje: defínelos en el plan curricular." },
    { id: "moments", label: "Cada momento tiene actividades", ok: !empty.length, hint: empty.length ? `Sin actividades: ${empty.map(phase => phase.label).join(", ")}.` : template.value === "free" ? "Secuencia libre." : `${template.phases.length} momentos con actividades.` },
    { id: "assessment", label: "Comprueba lo aprendido", ok: checking.length > 0, hint: checking.length ? `${checking.length === 1 ? "1 actividad comprueba" : `${checking.length} actividades comprueban`} el aprendizaje.` : "Agrega una pregunta o una actividad con propósito Evaluar." },
    { id: "time", label: "El tiempo cuadra con la duración", ok: fits, hint: `Las actividades suman ${minutes} de ${lesson.duration} min.` },
  ];
}
