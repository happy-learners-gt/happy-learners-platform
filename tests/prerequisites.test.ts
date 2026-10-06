import { describe, expect, it } from "vitest";
import { createsCycle, dependents, prerequisiteInput, prerequisiteStages } from "@happy-learners/domain";

const path = [{ courseId: "b", requiredId: "a" }, { courseId: "c", requiredId: "b" }, { courseId: "d", requiredId: "a" }];

describe("program prerequisites (DEC-029)", () => {
  it("detects cycles, including through other courses", () => {
    expect(createsCycle(path, "a", ["c"])).toBe(true);
    expect(createsCycle(path, "a", ["b"])).toBe(true);
    expect(createsCycle(path, "c", ["d"])).toBe(false);
    expect(createsCycle(path, "b", [])).toBe(false);
  });
  it("lists the courses that depend on a course", () => {
    expect([...dependents(path, "a")].sort()).toEqual(["a", "b", "c", "d"]);
    expect([...dependents(path, "b")].sort()).toEqual(["b", "c"]);
  });
  it("orders the program in stages", () => {
    expect(prerequisiteStages(["c", "b", "a", "d", "e"], path)).toEqual([["a", "e"], ["b", "d"], ["c"]]);
  });
  it("validates the input", () => {
    expect(prerequisiteInput({ courseId: "b", requiredIds: ["a"] })).toEqual({ courseId: "b", requiredIds: ["a"] });
    expect(prerequisiteInput({ courseId: "b", requiredIds: ["b"] })).toBeNull();
    expect(prerequisiteInput({ courseId: "b", requiredIds: ["a", "a"] })).toBeNull();
    expect(prerequisiteInput({ courseId: "b", requiredIds: Array.from({ length: 11 }, (_, i) => `c${i}`) })).toBeNull();
  });
});
