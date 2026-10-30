import { describe, expect, it } from "vitest";
import { coreCoverage, policyChange, sectionContent, sectionDifferences, type FreedomActivity, type FreedomLesson, type FreedomOverride } from "../packages/domain/src/section-freedom";

const lesson = (id: string, position: number, core: boolean, groupId: string | null = null, outcomeIds: string[] = []): FreedomLesson => ({ id, unitId: "u", position, core, groupId, title: id, outcomeIds });
const activity = (id: string, categoryId: string, points: number, core: boolean, groupId: string | null = null): FreedomActivity => ({ id, periodId: "p", categoryId, points, position: 0, core, groupId, title: id });
const hide = (itemId: string, itemType: FreedomOverride["itemType"] = "lesson"): FreedomOverride => ({ itemType, itemId, position: null, hidden: true, replaces: null });

describe("section freedom", () => {
  const courseLessons = [lesson("a", 0, true, null, ["o1"]), lesson("b", 1, false), lesson("c", 2, true)];
  const courseActivities = [activity("exam", "exams", 40, true), activity("task", "tasks", 20, false)];

  it("shared returns exactly the course and ignores section items and adjustments", () => {
    const result = sectionContent({ policy: "shared", lessons: courseLessons, sectionLessons: [lesson("own", 3, false, "g")], activities: courseActivities, sectionActivities: [activity("mine", "tasks", 10, false, "g")], overrides: [hide("b")] });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.lessons.map(item => item.id)).toEqual(["a", "b", "c"]);
    expect(result.hiddenLessons).toEqual([]);
    expect(result.activities.map(item => item.id)).toEqual(["exam", "task"]);
    expect(result.reordered).toBe(false);
  });

  it("flexible rejects hiding or replacing the core and keeps a section lesson", () => {
    const hidden = sectionContent({ policy: "flexible", lessons: courseLessons, sectionLessons: [], activities: courseActivities, sectionActivities: [], overrides: [hide("a")] });
    expect(hidden).toMatchObject({ ok: false, errors: [expect.stringContaining("No se oculta la lección del núcleo «a»")] });
    const replaced = sectionContent({ policy: "flexible", lessons: courseLessons, sectionLessons: [], activities: courseActivities, sectionActivities: [activity("mine", "exams", 40, false, "g")], overrides: [{ itemType: "activity", itemId: "mine", position: null, hidden: false, replaces: "exam" }] });
    expect(replaced.ok).toBe(false);
    if (replaced.ok) return;
    expect(replaced.errors.some(error => error.includes("no se reemplazan"))).toBe(true);
    const adapted = sectionContent({ policy: "flexible", lessons: courseLessons, sectionLessons: [lesson("own", 1, false, "g")], activities: courseActivities, sectionActivities: [], overrides: [hide("b")] });
    expect(adapted.ok).toBe(true);
    if (!adapted.ok) return;
    expect(adapted.lessons.map(item => item.id)).toEqual(["a", "own", "c"]);
    expect(adapted.hiddenLessons.map(item => item.id)).toEqual(["b"]);
  });

  it("free accepts a replacement of the same category and points and rejects a different one", () => {
    const valid = sectionContent({ policy: "free", lessons: [], sectionLessons: [], activities: [{ ...activity("exam", "exams", 40, true), position: 0 }, { ...activity("task", "tasks", 20, false), position: 1 }], sectionActivities: [activity("mine", "exams", 40, false, "g")], overrides: [{ itemType: "activity", itemId: "mine", position: null, hidden: false, replaces: "exam" }] });
    expect(valid.ok).toBe(true);
    if (!valid.ok) return;
    expect(valid.activities.map(item => [item.id, item.replaces])).toEqual([["mine", "exam"], ["task", null]]);
    const invalid = sectionContent({ policy: "free", lessons: [], sectionLessons: [], activities: courseActivities, sectionActivities: [activity("mine", "tasks", 20, false, "g")], overrides: [{ itemType: "activity", itemId: "mine", position: null, hidden: false, replaces: "exam" }] });
    expect(invalid.ok).toBe(false);
    if (invalid.ok) return;
    expect(invalid.errors.some(error => error.includes("misma categoría") && error.includes("mismos puntos"))).toBe(true);
  });

  it("puts a new course lesson at the end of a unit the section reordered, and in its place otherwise", () => {
    const fresh = lesson("d", 3, false);
    const reordered = sectionContent({
      policy: "flexible", lessons: [...courseLessons, fresh], sectionLessons: [], activities: [], sectionActivities: [],
      overrides: [
        { itemType: "lesson", itemId: "b", position: 0, hidden: false, replaces: null },
        { itemType: "lesson", itemId: "a", position: 1, hidden: false, replaces: null },
      ],
    });
    expect(reordered.ok).toBe(true);
    if (!reordered.ok) return;
    expect(reordered.lessons.map(item => item.id)).toEqual(["b", "a", "c", "d"]);
    expect(reordered.reordered).toBe(true);
    const untouched = sectionContent({ policy: "flexible", lessons: [...courseLessons, fresh], sectionLessons: [], activities: [], sectionActivities: [], overrides: [] });
    expect(untouched.ok && untouched.lessons.map(item => item.id)).toEqual(["a", "b", "c", "d"]);
  });

  it("reports exact core coverage, including a section that is behind", () => {
    const coverage = coreCoverage(
      [{ id: "a", outcomeIds: ["o1"] }, { id: "c", outcomeIds: ["o2"] }, { id: "e", outcomeIds: ["o1"] }],
      [{ id: "o1" }, { id: "o2" }, { id: "o3" }],
      [{ date: "2026-10-28", lessonIds: ["b"] }, { date: "2026-10-30", lessonIds: ["c"] }],
      ["a"],
      "2026-10-29",
    );
    expect(coverage).toEqual({
      lessons: { total: 3, taught: 1, planned: 1, unplanned: 1, unplannedIds: ["e"] },
      outcomes: { total: 3, covered: 2, withoutLessons: 1, withoutLessonIds: ["o3"] },
      behind: true,
    });
    expect(coreCoverage([{ id: "a", outcomeIds: ["o1"] }], [{ id: "o1" }], [{ date: "2026-10-28", lessonIds: ["a"] }], ["a"], "2026-10-29").behind).toBe(false);
  });

  it("summarises what each section changed", () => {
    const adapted = sectionContent({ policy: "flexible", lessons: courseLessons, sectionLessons: [lesson("own", 4, false, "g")], activities: courseActivities, sectionActivities: [], overrides: [hide("b"), { itemType: "lesson", itemId: "c", position: 0, hidden: false, replaces: null }] });
    expect(adapted.ok).toBe(true);
    if (!adapted.ok) return;
    const coverage = coreCoverage(courseLessons.filter(item => item.core), [{ id: "o1" }], [{ date: "2026-10-28", lessonIds: [] }], [], "2026-10-29");
    const [row] = sectionDifferences([{ id: "g", name: "3.º B", educator: "M. Castillo", ...adapted, coverage }]);
    expect(row).toMatchObject({ added: 1, hidden: 1, reordered: true, replacements: 0, coreTaught: "0 de 2", behind: true });
    expect(row.detail.added).toEqual([{ id: "own", title: "own", type: "lesson" }]);
    expect(row.detail.hidden).toEqual([{ id: "b", title: "b", type: "lesson" }]);
  });

  it("blocks a policy change that would drop graded work and explains the others", () => {
    expect(policyChange("shared", "flexible", [])).toMatchObject({ ok: true, message: expect.stringContaining("quedan como núcleo") });
    const graded = [{ section: "3.º B", activity: "Ensayo propio", kind: "own" as const }, { section: "3.º A", activity: "Examen oral", kind: "replacement" as const }];
    expect(policyChange("free", "flexible", graded)).toMatchObject({ ok: false, affected: [graded[1]] });
    expect(policyChange("flexible", "shared", graded).ok).toBe(false);
    expect(policyChange("free", "shared", []).message).toContain("deja de mostrarse");
  });

  it("hides a course unit that has no core lesson, rejects one that does, and drops a replacement still in review", () => {
    const blocked = sectionContent({
      policy: "flexible", lessons: courseLessons, sectionLessons: [], activities: [], sectionActivities: [],
      overrides: [hide("u", "unit")], units: [{ id: "u", position: 0, groupId: null, title: "Fracciones", core: false }],
    });
    expect(blocked.ok).toBe(false);
    if (blocked.ok) return;
    expect(blocked.errors.some(error => error.includes("contiene lecciones del núcleo"))).toBe(true);
    const ownUnit = { id: "own-unit", position: 1, groupId: "g", title: "De la sección", core: false };
    const plain = sectionContent({
      policy: "flexible",
      lessons: [{ ...lesson("b", 0, false), unitId: "plain" }],
      sectionLessons: [{ ...lesson("own", 0, false, "g"), unitId: "own-unit" }],
      activities: [], sectionActivities: [],
      overrides: [hide("plain", "unit")],
      units: [{ id: "plain", position: 0, groupId: null, title: "Opcional", core: false }],
      sectionUnits: [ownUnit],
    });
    expect(plain.ok).toBe(true);
    if (!plain.ok) return;
    expect(plain.lessons.map(item => item.id)).toEqual(["own"]);
    expect(plain.hiddenLessons.map(item => item.id)).toEqual(["b"]);
    expect(plain.units.map(item => item.id)).toEqual(["own-unit"]);
    expect(plain.hiddenUnits.map(item => item.id)).toEqual(["plain"]);
    const review = sectionContent({
      policy: "free", lessons: [], sectionLessons: [], activities: [{ ...activity("exam", "exams", 40, true), position: 0 }],
      sectionActivities: [{ ...activity("mine", "exams", 40, false, "g"), position: 1, review: true }],
      overrides: [{ itemType: "activity", itemId: "mine", position: null, hidden: false, replaces: "exam" }],
    });
    expect(review.ok).toBe(true);
    if (!review.ok) return;
    expect(review.activities.map(item => [item.id, item.replaces, !!item.review])).toEqual([["exam", null, false], ["mine", null, true]]);
  });
});
