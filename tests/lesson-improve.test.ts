import { describe, expect, it } from "vitest";
import type { Activity } from "@happy-learners/contracts";
import { applyChanges, checkedChanges, fixtureImprover, improveInput, improvePrompt, lessonReview } from "../packages/domain/src/index";
import type { ImproveInput, ReviewContext } from "../packages/domain/src/index";

// 1.4.1 (docs/design/asistente-ia.md §6c): proposed changes are checked, shown as a draft and applied only when accepted.
const context: ReviewContext = { sequence: "start-develop-close", courseOutcomes: 3, indexedResources: false, classMinutes: 45 };
const weak = {
  objective: "Fracciones", sequence: "start-develop-close" as const, outcomeIds: ["o-1"], materials: ["Regletas"],
  activities: [
    { id: "a1", title: "Pregunta", phase: "start", purpose: "explore", grouping: "whole-class", minutes: 10, instructions: "¿Qué es la mitad de una pizza?" },
    { id: "a2", title: "Regletas", phase: "develop", purpose: "practice", grouping: "whole-class", minutes: 15, instructions: "" },
  ] as Activity[],
};
const inputOf = (lesson: typeof weak) => improveInput(lesson, lessonReview(lesson, context), { course: "Matemáticas 3.º", grade: "Primaria", classMinutes: 45 });

describe("1.4.1 assisted improvement", () => {
  it("the fixture fixes what the review found: applying every change raises the score to 90 or more", async () => {
    const before = lessonReview(weak, context);
    expect(before.score).toBeLessThan(60);
    const input = inputOf(weak);
    // 25 minutes: grouping does not apply yet (it does once the lesson fills the class, and the new activities vary it).
    expect(input.failing.map(check => check.id)).toEqual(["objective", "sequence", "time", "assessment", "instructions"]);
    const changes = checkedChanges(await fixtureImprover.improve(input), input);
    expect(changes.map(change => [change.kind, change.field, change.activityId])).toEqual([
      ["objective", "objective", null], ["activity", "instructions", "a2"], ["new-activity", null, null], ["new-activity", null, null], ["activity", "minutes", "a2"],
    ]);
    let next = 0;
    const improved = applyChanges(weak, changes, kind => `${kind}-${++next}`);
    const after = lessonReview(improved, context);
    expect(after.score).toBeGreaterThanOrEqual(90);
    expect(after.checks.filter(check => check.status === "fail").map(check => check.id)).toEqual([]);
    // New activities go at the end of their moment, and positions are renumbered.
    expect(improved.activities.map(activity => [activity.id, activity.phase, activity.position])).toEqual([["a1", "start", 0], ["a2", "develop", 1], ["activity-1", "close", 2], ["activity-3", "close", 3]]);
    // Made of one text block, as the editor makes a new activity.
    expect(improved.activities[2].blocks).toEqual([{ id: "block-2", kind: "text", instructions: "Comprueba lo aprendido y reflexiona." }]);
  });

  it("applies only the accepted changes, and keeps the other blocks of an activity", async () => {
    const lesson = { ...weak, activities: [weak.activities[0], { ...weak.activities[1], blocks: [{ id: "b1", kind: "resource" as const, resourceId: "r-1" }, { id: "b2", kind: "text" as const, instructions: "" }] }] };
    const input = inputOf(lesson);
    const changes = checkedChanges(await fixtureImprover.improve(input), input);
    const instructions = changes.find(change => change.field === "instructions");
    // The resource counts as content: that activity is not empty, so no instructions are proposed for it.
    expect(instructions).toBeUndefined();
    const objective = changes.find(change => change.kind === "objective")!;
    const applied = applyChanges(lesson, [objective], () => "x");
    expect(applied.objective).toBe(objective.after);
    expect(applied.activities.map(activity => [activity.id, activity.grouping, activity.minutes])).toEqual([["a1", "whole-class", 10], ["a2", "whole-class", 15]]);
    const text = { id: "c", kind: "activity" as const, activityId: "a2", activityTitle: "Regletas", field: "instructions" as const, before: "", after: "Comparan regletas.", activity: null, reason: "" };
    expect(applyChanges(lesson, [text], () => "x").activities[1].blocks).toEqual([{ id: "b1", kind: "resource", resourceId: "r-1" }, { id: "b2", kind: "text", instructions: "Comparan regletas.", richContent: undefined }]);
  });

  it("drops what a model may get wrong: missing activities, impossible values, no change, empty text", () => {
    const input: ImproveInput = inputOf(weak);
    const change = (partial: object) => ({ kind: "activity", activityId: "a1", field: "minutes", value: "12", activity: null, reason: "r", ...partial });
    const kept = checkedChanges({ changes: [
      change({ activityId: "a9" }), change({ value: "0" }), change({ value: "500" }), change({ value: "doce" }), change({ field: "purpose", value: "sing" }),
      change({ field: "phase", value: "engage" }), change({ field: "grouping", value: "whole-class" }), change({ field: "title", value: "   " }), change({ field: "objective", value: "x" }),
      { kind: "new-activity", activityId: null, field: null, value: null, activity: { title: "Cierre", phase: "close", purpose: "assess", grouping: "everyone", minutes: 5, instructions: "Responde." }, reason: "r" },
      { kind: "objective", activityId: null, field: "objective", value: "x".repeat(301), activity: null, reason: "r" },
      change({}),
    ] } as never, input);
    expect(kept.map(item => [item.field, item.before, item.after])).toEqual([["minutes", "10", "12"]]);
  });

  it("asks the model with the lesson and what failed, and nothing about the students", () => {
    const { system, user } = improvePrompt(inputOf(weak));
    expect(system).toContain("Solo propones cambios");
    expect(user).toContain("[a2] develop · practice · whole-class · 15 min · «Regletas»: (sin instrucciones)");
    expect(user).toContain("Instrucciones: Escribe qué hacen las y los estudiantes en cada actividad.");
    expect(user).toContain("Las clases duran 45 minutos.");
  });
});
