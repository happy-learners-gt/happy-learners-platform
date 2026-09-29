import { describe, expect, it } from "vitest";
import { courseInput, materialInput, completeOrder, validTermIds } from "../packages/domain/src/courses";

const course = { title: "Fotografía cotidiana", objective: "Componer una imagen con luz natural.", profile: "free", unitLabel: "Temas", status: "active", termIds: [] };
const material = { title: "Observar la luz", description: "Una guía breve para comparar sombras.", kind: "text", content: "Observa un objeto iluminado desde dos posiciones. Describe la sombra.", status: "draft", termIds: [] };
describe("generic learning content", () => {
  it("creates courses and materials without language-specific fields", () => {
    expect(courseInput(course)).toEqual(course);
    expect(materialInput(material)).toEqual(material);
  });
  it("normalizes titles and accepts independent institutional vocabulary", () => {
    expect(courseInput({ ...course, title: "  Ciencias  ", profile: "laboratory", unitLabel: "Prácticas", termIds: ["term-science"] })?.title).toBe("Ciencias");
    expect(courseInput({ ...course, profile: "university", unitLabel: "Semanas" })?.termIds).toEqual([]);
  });
  it("rejects invalid profiles, labels and uncontrolled term identities", () => {
    expect(courseInput({ ...course, profile: "run-code" })).toBeNull();
    expect(courseInput({ ...course, unitLabel: "<script>" })).toBeNull();
    expect(courseInput({ ...course, termIds: ["x", "x"] })).toBeNull();
    expect(validTermIds(["../org-other"])).toBe(false);
    expect(validTermIds(Array.from({ length: 25 }, (_, i) => `t-${i}`))).toBe(false);
  });
  it("validates sizes, kinds, statuses and safe link schemes", () => {
    expect(materialInput({ ...material, content: "x".repeat(8001) })).toBeNull();
    expect(materialInput({ ...material, kind: "image" })).toBeNull();
    expect(materialInput({ ...material, status: "deleted" })).toBeNull();
    for (const content of ["javascript:alert(1)", "data:text/html,hello", "https://user:password@example.com", "https://"]) expect(materialInput({ ...material, kind: "link", content })).toBeNull();
    expect(materialInput({ ...material, kind: "link", content: "https://example.com/guia?q=luz#uno" })).not.toBeNull();
  });
  it("requires a complete permutation for ordering", () => {
    expect(completeOrder(["b", "a"], ["a", "b"])).toBe(true);
    expect(completeOrder(["a", "a"], ["a", "b"])).toBe(false);
    expect(completeOrder(["a", "foreign"], ["a", "b"])).toBe(false);
    expect(completeOrder(["a"], ["a", "b"])).toBe(false);
  });
});
