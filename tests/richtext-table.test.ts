import { expect, it } from "vitest";
import { validActivities, validRichText } from "../packages/domain/src/index";

const cell = (type: "tableHeader" | "tableCell", text: string) => ({ type, attrs: { colspan: 1, rowspan: 1, colwidth: null }, content: [{ type: "paragraph", content: [{ type: "text", text }] }] });
const table = { type: "table", content: [
  { type: "tableRow", content: [cell("tableHeader", "Inglés"), cell("tableHeader", "Español")] },
  { type: "tableRow", content: [cell("tableCell", "Hello"), cell("tableCell", "Hola")] },
] };

it("ST-069 a table with header and data cells is stored and published", () => {
  const doc = { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "Vocabulario" }] }, table] };
  expect(validRichText(doc)).toBe(true);
  expect(validActivities([{ id: "activity-1", position: 0, type: "text", title: "Vocabulario", minutes: 5, instructions: "", richContent: doc }])).toBe(true);
});

it("ST-069 rejects malformed tables: rows outside a table, nested tables and cells outside rows", () => {
  expect(validRichText({ type: "doc", content: [{ type: "tableRow", content: [cell("tableCell", "x")] }] })).toBe(false);
  expect(validRichText({ type: "doc", content: [{ type: "table", content: [{ type: "tableRow", content: [{ ...cell("tableCell", "x"), content: [table] }] }] }] })).toBe(false);
  expect(validRichText({ type: "doc", content: [{ type: "table", content: [cell("tableCell", "x")] }] })).toBe(false);
  expect(validRichText({ type: "doc", content: [{ type: "table", content: [] }] })).toBe(false);
});
