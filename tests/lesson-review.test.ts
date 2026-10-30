import { describe, expect, it } from "vitest";
import type { Activity } from "@happy-learners/contracts";
import { classMinutesOf, lessonReview } from "../packages/domain/src/index";
import type { ReviewContext, ReviewLesson } from "../packages/domain/src/index";

// 1.4.0 (docs/design/asistente-ia.md §6b): the review is deterministic, so every expected score below is exact.
const activity = (partial: Partial<Activity>): Activity => ({ title: "Actividad", minutes: 10, instructions: "Hacen algo.", ...partial });
const complete: ReviewLesson = {
  objective: "Identificar fracciones equivalentes con regletas y explicarlas a un compañero.",
  outcomeIds: ["o-1"], materials: [],
  activities: [
    activity({ id: "a1", title: "Pregunta inicial", phase: "start", purpose: "explore", grouping: "whole-class", minutes: 10 }),
    activity({ id: "a2", title: "Regletas", phase: "develop", purpose: "practice", grouping: "pairs", minutes: 25,
      blocks: [{ id: "b1", kind: "resource", resourceId: "r-1", pages: "41-43" }, { id: "b2", kind: "text", instructions: "Comparan regletas." }] }),
    activity({ id: "a3", title: "Salida", phase: "close", purpose: "assess", grouping: "individual", minutes: 10 }),
  ],
};
const context: ReviewContext = { sequence: "start-develop-close", courseOutcomes: 5, indexedResources: true, classMinutes: 45 };
const statusOf = (lesson: ReviewLesson, ctx = context) => Object.fromEntries(lessonReview(lesson, ctx).checks.map(item => [item.id, item.status]));

describe("1.4.0 lesson review with a fact-based score", () => {
  it("gives 100 to a lesson that meets every check, with evidence and no suggestions", () => {
    const review = lessonReview(complete, context);
    expect(review).toMatchObject({ score: 100, level: "good" });
    expect(review.checks.every(item => item.status === "pass" && item.suggestion === "" && item.evidence.length > 0)).toBe(true);
    expect(review.checks.find(item => item.id === "resources")!.evidence[0]).toEqual({ activityId: "a2", text: "Regletas: págs. 41-43" });
    expect(review.checks.map(item => item.weight).reduce((a, b) => a + b, 0)).toBe(100);
  });

  it("is reproducible: the same lesson always gets the same review", () => {
    expect(lessonReview(structuredClone(complete), context)).toEqual(lessonReview(complete, context));
  });

  it("scores an empty lesson with each failure explained", () => {
    const review = lessonReview({ objective: "", outcomeIds: [], activities: [] }, context);
    // Sequence fails (no moment covered) and time fails (0 of 45 min); grouping does not apply to 0 minutes.
    expect(review).toMatchObject({ score: 0, level: "poor" });
    expect(review.checks.find(item => item.id === "objective")).toMatchObject({ status: "fail", suggestion: "Escribe qué podrán hacer las y los estudiantes al terminar la clase." });
    expect(review.checks.find(item => item.id === "instructions")!.evidence).toEqual([{ text: "La lección no tiene actividades." }]);
  });

  it("weighs partial results by half and leaves out what does not apply", () => {
    // Time: 35 of 45 minutes is 78 %, partial (7.5 of 15). Resources without pages in a course with indexed ones: partial (5 of 10).
    const lesson = { ...complete, activities: complete.activities.map(item => item.id === "a2" ? { ...item, minutes: 15, blocks: [{ id: "b1", kind: "resource" as const, resourceId: "r-1" }] } : item) };
    const review = lessonReview(lesson, context);
    expect(statusOf(lesson)).toMatchObject({ time: "partial", resources: "partial" });
    expect(review.score).toBe(88); // 100 - 7.5 - 5 = 87.5, rounded
    expect(review.checks.find(item => item.id === "time")!.suggestion).toBe("Faltan 10 min: amplía una actividad o agrega otra.");
    // Without outcomes in the course and with the free sequence, alignment and sequence do not apply (35 points out).
    const free = lessonReview(lesson, { sequence: "free", courseOutcomes: 0, indexedResources: true, classMinutes: 45 });
    expect(free.checks.filter(item => item.status === "n/a").map(item => item.id)).toEqual(["alignment", "sequence"]);
    expect(free.score).toBe(81); // (65 - 7.5 - 5) / 65 = 80.8 %
  });

  it("names the missing moments of the sequence and activities out of order", () => {
    const missing = { ...complete, activities: complete.activities.filter(item => item.id !== "a3").concat(activity({ id: "a4", phase: "develop", purpose: "assess", grouping: "individual", minutes: 10 })) };
    const sequence = lessonReview(missing, context).checks.find(item => item.id === "sequence")!;
    expect(sequence).toMatchObject({ status: "partial", evidence: [{ text: "Falta el momento «Cierre»." }] });
    expect(sequence.suggestion).toBe("Agrega una actividad para «Cierre» (comprueba lo aprendido y reflexiona).");
    const shuffled = { ...complete, activities: [complete.activities[2], complete.activities[0], complete.activities[1]] };
    expect(lessonReview(shuffled, context).checks.find(item => item.id === "sequence")).toMatchObject({ status: "partial", suggestion: "Ordena las actividades según los momentos de la secuencia." });
  });

  it("finds alignment, assessment, grouping and empty activities", () => {
    const stray = { ...complete, activities: complete.activities.map(item => item.id === "a1" ? { ...item, outcomeIds: ["o-9"] } : item) };
    expect(lessonReview(stray, context).checks.find(item => item.id === "alignment")).toMatchObject({ status: "partial", evidence: [{ activityId: "a1", text: "Pregunta inicial: trabaja un resultado que la lección no declara" }] });
    const noAssessment = { ...complete, activities: complete.activities.map(item => ({ ...item, purpose: "practice" as const })) };
    expect(statusOf(noAssessment).assessment).toBe("fail");
    const question = { ...noAssessment, activities: [...noAssessment.activities.slice(0, 2), { ...noAssessment.activities[2], blocks: [{ id: "q", kind: "question" as const, instructions: "¿Cuál?", options: ["1/2", "2/4"], answer: 0 }] }] };
    expect(statusOf(question).assessment).toBe("pass");
    const single = { ...complete, activities: complete.activities.map(item => ({ ...item, grouping: "individual" as const })) };
    expect(statusOf(single).grouping).toBe("fail");
    expect(statusOf({ ...single, activities: single.activities.map(item => ({ ...item, minutes: 10 })) }).grouping).toBe("n/a");
    // Without a schedule in any section, time does not apply.
    expect(statusOf(complete, { ...context, classMinutes: null }).time).toBe("n/a");
    expect(lessonReview(complete, context).checks.find(item => item.id === "time")!.evidence).toEqual([{ text: "Las actividades suman 45 min; las clases del curso duran 45 min." }]);
    const empty = { ...complete, activities: complete.activities.map(item => item.id === "a3" ? { ...item, instructions: "", blocks: [{ id: "e", kind: "text" as const }] } : item) };
    expect(lessonReview(empty, context).checks.find(item => item.id === "instructions")).toMatchObject({ status: "fail", evidence: [{ activityId: "a3", text: "Salida: no tiene instrucciones ni contenido" }] });
  });
});

describe("1.4.0 class duration of a course", () => {
  it("is the most common duration among active sections with a schedule", () => {
    const schedule = (durationMinutes: number, meetings?: number[]) => ({ durationMinutes, ...(meetings ? { meetings: meetings.map(minutes => ({ durationMinutes: minutes })) } : {}) });
    expect(classMinutesOf([{ schedule: schedule(45) }, { schedule: schedule(45) }, { schedule: schedule(90) }, { status: "archived", schedule: schedule(90) }, { schedule: null }])).toBe(45);
    // Meetings of different lengths count one by one; a tie goes to the longest.
    expect(classMinutesOf([{ schedule: schedule(45, [45, 90]) }])).toBe(90);
    expect(classMinutesOf([])).toBeNull();
  });
});
