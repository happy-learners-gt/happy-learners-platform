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
