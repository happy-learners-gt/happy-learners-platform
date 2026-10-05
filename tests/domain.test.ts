import { expect, it } from "vitest";
import { organizationInput, validActivities, validRichText } from "../packages/domain/src/index";
it("accepts only minimal valid organization settings", () => {
  expect(organizationInput({ name: " Jardín de Colores ", timezone: "America/Guatemala", childName: "discarded" })).toEqual({ name: "Jardín de Colores", timezone: "America/Guatemala" });
  for (const value of [null, {}, { name: "ab", timezone: "America/Guatemala" }, { name: "<script>", timezone: "America/Guatemala" }, { name: "Nombre", timezone: "Europe/Invalid" }]) expect(organizationInput(value)).toBeNull();
});
it("accepts structured classroom content and rejects executable or oversized documents", () => {
  const doc = { type: "doc", content: [{ type: "heading", attrs: { level: 2 }, content: [{ type: "text", text: "Idea principal", marks: [{ type: "bold" }] }] }, { type: "bulletList", content: [{ type: "listItem", content: [{ type: "paragraph", content: [{ type: "text", text: "Primer paso" }] }] }] }] };
  expect(validRichText(doc)).toBe(true);
  expect(validActivities([{ id: "activity-1", position: 0, type: "text", title: "Lee", minutes: 5, instructions: "", richContent: doc }])).toBe(true);
  expect(validRichText({ type: "doc", content: [{ type: "script", text: "alert(1)" }] })).toBe(false);
  expect(validRichText({ type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "enlace", marks: [{ type: "link", attrs: { href: "javascript:alert(1)" } }] }] }] })).toBe(false);
  expect(validActivities([{ id: "activity-1", position: 0, type: "text", title: "Vacía", minutes: 5, instructions: "" }])).toBe(false);
});
import type { Activity } from "../packages/contracts/src/index";
import { blocksOf, phaseOf, resourceIdsOf, richTextFieldsOf, sequenceOf, studentActivities } from "../packages/domain/src/index";
const text = (value: string) => ({ type: "doc" as const, content: [{ type: "paragraph", content: [{ type: "text", text: value }] }] });
it("reads older single-body activities as one block that keeps the activity id", () => {
  const legacy = { id: "greet-question", type: "question" as const, title: "Elige", minutes: 5, instructions: "¿Qué dices?", options: ["Hello!", "Bye"], answer: 0 };
  expect(blocksOf(legacy)).toEqual([{ id: "greet-question", kind: "question", instructions: "¿Qué dices?", options: ["Hello!", "Bye"], answer: 0 }]);
  expect(richTextFieldsOf([legacy])).toEqual(["greet-question"]);
});
it("validates composite activities: blocks, moments, purpose and grouping", () => {
  const activity: Activity & { blocks: NonNullable<Activity["blocks"]> } = { id: "a1", position: 0, title: "Creamos juntos", minutes: 15, instructions: "", phase: "develop", purpose: "practice", grouping: "teams", blocks: [
    { id: "a1", kind: "text", richContent: text("Formen equipos") },
    { id: "b2", kind: "resource", resourceId: "resource-colors" },
    { id: "b3", kind: "question", richContent: text("¿Qué color ves?"), options: ["Red", "Blue"], answer: 1 },
    { id: "b4", kind: "teacher-note", instructions: "Equipos de tres." },
  ] };
  expect(validActivities([activity])).toBe(true);
  expect(validActivities([{ ...activity, purpose: "entertain" as never }])).toBe(false);
  expect(validActivities([{ ...activity, blocks: [{ id: "n", kind: "teacher-note", instructions: "Solo nota" }] }])).toBe(false);
  expect(validActivities([{ ...activity, blocks: [...activity.blocks, { ...activity.blocks[1] }] }])).toBe(false);
  expect(validActivities([{ ...activity, blocks: [{ id: "q", kind: "question", richContent: text("¿?"), options: ["Sí", "Sí"], answer: 0 }] }])).toBe(false);
  expect(validActivities([{ ...activity, blocks: [{ id: "t", kind: "text", instructions: "" }] }])).toBe(false);
  expect(resourceIdsOf([activity])).toEqual(["resource-colors"]);
});
it("never publishes teacher notes and falls back to the first moment of a template", () => {
  const activity = { id: "a1", title: "Inicio", minutes: 5, instructions: "", phase: "engage", blocks: [{ id: "t", kind: "text" as const, instructions: "Hola" }, { id: "n", kind: "teacher-note" as const, instructions: "Privado" }] };
  expect(studentActivities([activity])[0].blocks!.map(block => block.kind)).toEqual(["text"]);
  expect(phaseOf(activity, "five-e")).toBe("engage");
  expect(phaseOf(activity, "start-develop-close")).toBe("start");
  expect(sequenceOf(undefined).value).toBe("free");
});

import { competencyInput, coverage, outcomeCodes, outcomeInput, publishChecklist, suggestedResources } from "../packages/domain/src/index";
import type { Curriculum, LearningOutcome, LearningUnit, Lesson } from "../packages/contracts/src/index";
const outcome = (id: string, position: number, status: LearningOutcome["status"] = "active"): LearningOutcome => ({ id, courseId: "c", statement: `Resultado ${id}`, level: "apply", evidence: "", position, status, updatedAt: "t" });
const unit = (id: string, position: number): LearningUnit => ({ id, courseId: "c", name: id, objective: "", position, status: "active", updatedAt: "t" });
const lesson = (id: string, unitId: string, extra: Partial<Lesson> = {}): Lesson => ({ id, title: id, program: "", duration: 20, objective: "o", materials: [], reflection: "", publishedAt: "", courseUnitId: unitId, status: "draft", activities: [], ...extra });
const curriculum: Curriculum = { competencies: [], outcomes: [outcome("a", 0), outcome("old", 1, "archived"), outcome("b", 2), outcome("c", 3)], unitOutcomes: [{ unitId: "u1", outcomeId: "a" }, { unitId: "u1", outcomeId: "b" }] };

it("validates competencies and outcomes and codes active outcomes in order", () => {
  expect(competencyInput({ name: " Comunicación ", status: "active" })).toEqual({ name: "Comunicación", description: "", status: "active" });
  expect(competencyInput({ name: "", status: "active" })).toBeNull();
  expect(outcomeInput({ statement: "Saluda", level: "apply", status: "active" })).toEqual({ statement: "Saluda", evidence: "", level: "apply", status: "active", competencyId: null });
  expect(outcomeInput({ statement: "Saluda", level: "memorize", status: "active" })).toBeNull();
  expect([...outcomeCodes(curriculum.outcomes)]).toEqual([["a", "RA1"], ["b", "RA2"], ["c", "RA3"]]);
});
it("ST-100 maps coverage: planned, taught, assessed and delivered in completed classes, with the gaps to close", () => {
  const lessons = [
    lesson("l1", "u1", { outcomeIds: ["a"], activities: [{ id: "x", title: "Quiz", minutes: 5, instructions: "", outcomeIds: ["a"], blocks: [{ id: "q", kind: "question", instructions: "¿?", options: ["1", "2"], answer: 0 }] }] }),
    lesson("l2", "u2", { outcomeIds: ["b"], activities: [{ id: "y", title: "Leer", minutes: 5, instructions: "", purpose: "explain", blocks: [{ id: "t", kind: "text", instructions: "Hola" }] }] }),
    lesson("gone", "u1", { status: "archived", outcomeIds: ["c"] }),
  ];
  const map = coverage(curriculum, [unit("u1", 0), unit("u2", 1)], lessons);
  expect(map.outcomes.map(item => [item.code, item.units, item.lessons, item.assessedIn, item.gaps])).toEqual([
    ["RA1", ["u1"], ["l1"], ["l1"], []],
    ["RA2", ["u1"], ["l2"], [], ["no-assessment"]],
    ["RA3", [], [], [], ["no-unit", "no-lesson"]],
  ]);
  expect(map.units.map(item => [item.unit.id, item.missing])).toEqual([["u1", ["b"]], ["u2", []]]);
  expect(map.summary).toEqual({ total: 3, taught: 2, assessed: 1, delivered: 0, gaps: 2 });
  const delivered = coverage(curriculum, [unit("u1", 0), unit("u2", 1)], lessons, ["l2", "gone"]);
  expect(delivered.outcomes.map(item => [item.code, item.deliveredIn])).toEqual([["RA1", []], ["RA2", ["l2"]], ["RA3", []]]);
  expect(delivered.summary.delivered).toBe(1);
});
it("recommends before publishing and suggests resources from lessons with the same outcomes", () => {
  const draft = lesson("l1", "u1", { sequence: "start-develop-close", duration: 20, activities: [{ id: "x", title: "Inicio", minutes: 5, instructions: "", phase: "start", blocks: [{ id: "t", kind: "text", instructions: "Hola" }] }] });
  expect(publishChecklist(draft, curriculum).map(item => [item.id, item.ok])).toEqual([["outcomes", false], ["moments", false], ["assessment", false], ["time", false]]);
  const ready = { ...draft, outcomeIds: ["a"], activities: ["start", "develop", "close"].map((phase, i) => ({ id: `a${i}`, title: phase, minutes: 6, instructions: "", phase, purpose: i === 2 ? "assess" as const : undefined, blocks: [{ id: `b${i}`, kind: "text" as const, instructions: "x" }] })) };
  expect(publishChecklist(ready, curriculum).every(item => item.ok)).toBe(true);
  const other = lesson("l2", "u1", { outcomeIds: ["a"], activities: [{ id: "r", title: "Video", minutes: 5, instructions: "", blocks: [{ id: "rb", kind: "resource", resourceId: "video-1" }] }] });
  expect(suggestedResources(ready, [ready, other], resourceIdsOf)).toEqual(["video-1"]);
  expect(suggestedResources({ ...ready, outcomeIds: [] , activities: [] }, [other], resourceIdsOf)).toEqual([]);
});
