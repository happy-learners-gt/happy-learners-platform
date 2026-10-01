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
