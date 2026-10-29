import { describe, expect, it } from "vitest";
import { formGroups, groupRulesInput, groupToIndividual } from "../packages/domain/src/group-formation";

const rules = (input: unknown) => {
  const parsed = groupRulesInput(input);
  if ("error" in parsed) throw new Error(parsed.error);
  return parsed;
};

const ids = (count: number) => Array.from({ length: count }, (_, index) => ({ id: `s${index}` }));
const lengths = (formed: { groups: { learnerIds: string[] }[] }) => formed.groups.map(group => group.learnerIds.length).sort((a, b) => a - b);
const flat = (formed: { groups: { learnerIds: string[] }[] }) => formed.groups.flatMap(group => group.learnerIds).sort();

describe("group formation", () => {
  it("splits a remainder evenly", () => {
    const formed = formGroups(ids(10), rules({ by: "size", size: 3, how: "random", seed: "parejo" }), "parejo");
    expect(formed.unmet).toEqual([]);
    expect(lengths(formed)).toEqual([3, 3, 4]);
    expect(flat(formed)).toEqual(ids(10).map(learner => learner.id));
    expect(formed.groups.map(group => group.name)).toEqual(["Grupo 1", "Grupo 2", "Grupo 3"]);
  });

  it("repeats a seed and changes with another one", () => {
    const learners = ids(12);
    const parsed = rules({ by: "size", size: 3, how: "random", seed: "clase" });
    expect(formGroups(learners, parsed, "clase")).toEqual(formGroups(learners, parsed, "clase"));
    expect(formGroups(learners, parsed, "clase")).not.toEqual(formGroups(learners, parsed, "otra-clase"));
  });

  it("receives only the learners the caller kept", () => {
    const formed = formGroups(
      [{ id: "ana", present: true }, { id: "leo", present: false }, { id: "noa", present: true }, { id: "iva", present: false }],
      rules({ by: "count", count: 1, how: "random", seed: "lista" }),
      "lista",
    );
    expect(flat(formed)).toEqual(["ana", "noa"]);
  });

  it("spreads scores across groups", () => {
    const learners = [6, 5, 4, 3, 2, 1].map(score => ({ id: `p${score}`, score }));
    const formed = formGroups(learners, rules({ by: "count", count: 2, how: "balanced", seed: "notas" }), "notas");
    expect(formed.unmet).toEqual([]);
    expect(lengths(formed)).toEqual([3, 3]);
    const high = formed.groups.filter(group => group.learnerIds.includes("p6") || group.learnerIds.includes("p5"));
    expect(new Set(high.flatMap(group => group.learnerIds.filter(id => id === "p6" || id === "p5"))).size).toBe(2);
    expect(formed.groups.find(group => group.learnerIds.includes("p6"))!.learnerIds).not.toContain("p5");
  });

  it("mixes a nominal attribute so nobody keeps the same teammates", () => {
    const learners = ["A", "A", "A", "B", "B", "B"].map((attribute, index) => ({ id: `m${index}`, attribute }));
    const formed = formGroups(learners, rules({ by: "count", count: 3, how: "mixed", seed: "previo" }), "previo");
    expect(formed.unmet).toEqual([]);
    expect(formed.groups).toHaveLength(3);
    for (const group of formed.groups) {
      const attributes = group.learnerIds.map(id => learners.find(learner => learner.id === id)!.attribute);
      expect(new Set(attributes).size).toBe(attributes.length);
    }
  });

  it("keeps a pair together and another pair apart", () => {
    const learners = ["a", "b", "c", "d"].map(id => ({ id }));
    const together = formGroups(learners, rules({ by: "size", size: 2, how: "random", seed: "juntos", together: [["a", "b"]] }), "juntos");
    expect(together.unmet).toEqual([]);
    expect(together.groups.some(group => group.learnerIds.includes("a") && group.learnerIds.includes("b"))).toBe(true);
    const apart = formGroups(learners, rules({ by: "count", count: 2, how: "random", seed: "lejos", apart: [["a", "b"]] }), "lejos");
    expect(apart.unmet).toEqual([]);
    expect(apart.groups.some(group => group.learnerIds.includes("a") && group.learnerIds.includes("b"))).toBe(false);
  });

  it("reports a constraint it cannot meet and still returns the split", () => {
    const learners = ["a", "b", "c"].map(id => ({ id }));
    const formed = formGroups(learners, rules({ by: "count", count: 1, how: "random", seed: "imposible", apart: [["a", "b"]], minimum: 1 }), "imposible");
    expect(formed.groups).toHaveLength(1);
    expect(formed.groups[0].learnerIds).toHaveLength(3);
    expect(formed.unmet.some(item => item.kind === "apart" && item.learners.includes("a") && item.learners.includes("b"))).toBe(true);
  });

  it("uses a name prefix", () => {
    const formed = formGroups(ids(2), rules({ by: "count", count: 2, how: "random", seed: "n", prefix: "Equipo" }), "n");
    expect(formed.groups.map(group => group.name)).toEqual(["Equipo 1", "Equipo 2"]);
  });

  it("rejects incomplete rules", () => {
    const rejected = [
      null,
      {},
      { by: "people", how: "random", seed: "a" },
      { by: "size", how: "random", seed: "a" },
      { by: "size", size: 1, how: "random", seed: "a" },
      { by: "count", how: "random", seed: "a" },
      { by: "count", count: 0, how: "random", seed: "a" },
      { by: "size", size: 3, how: "magic", seed: "a" },
      { by: "size", size: 3, how: "random", seed: "a", minimum: 4, maximum: 2 },
      { by: "size", size: 3, how: "random", seed: "a", minimum: 0 },
      { by: "size", size: 3, how: "random", seed: "a", together: [["a"]] },
      { by: "size", size: 3, how: "random", seed: "a", apart: [["a", "a"]] },
      { by: "size", size: 3, how: "random", seed: "  " },
      { by: "size", size: 3, how: "random", seed: "a", prefix: " " },
    ].map(input => groupRulesInput(input));
    expect(rejected.filter(item => "error" in item).length).toBeGreaterThanOrEqual(8);
    for (const item of rejected) {
      expect(item).toHaveProperty("error");
      expect((item as { error: string }).error.length).toBeGreaterThan(8);
    }
    expect(rules({ by: "size", size: 3, how: "balanced", seed: "ok", minimum: 2, maximum: 4 })).toMatchObject({ size: 3, minimum: 2, maximum: 4 });
  });
});

describe("group mark propagation", () => {
  const group = { id: "g", learnerIds: ["a", "b", "c"] };
  const base = { points: 100, grading: "points" as const, groups: [group], adjustments: [], peerRatings: [], exemptLearnerIds: [], manualLearnerIds: [] };

  it("applies a factor and an override", () => {
    const factored = groupToIndividual({ ...base, points: 80, marks: [{ workGroupId: "g", mark: { kind: "points", value: 80 } }], adjustments: [{ learnerId: "a", kind: "factor", value: 0.5 }] });
    expect(factored.find(item => item.learnerId === "a")).toMatchObject({ mark: { kind: "points", value: 40 }, factor: 0.5, source: "group" });
    expect(factored.find(item => item.learnerId === "b")!.mark).toEqual({ kind: "points", value: 80 });
    const replaced = groupToIndividual({ ...base, marks: [{ workGroupId: "g", mark: { kind: "points", value: 80 } }], adjustments: [{ learnerId: "a", kind: "override", value: 70 }] });
    expect(replaced.find(item => item.learnerId === "a")!.mark).toEqual({ kind: "points", value: 70 });
  });

  it("computes WebPA and clamps it", () => {
    const ratings = [
      { raterId: "b", rateeId: "a", score: 5 }, { raterId: "c", rateeId: "a", score: 5 },
      { raterId: "a", rateeId: "b", score: 3 }, { raterId: "c", rateeId: "b", score: 3 },
      { raterId: "a", rateeId: "c", score: 1 }, { raterId: "b", rateeId: "c", score: 1 },
    ];
    const result = groupToIndividual({ ...base, marks: [{ workGroupId: "g", mark: { kind: "points", value: 60 } }], peerRatings: ratings });
    expect(result.map(item => item.factor)).toEqual([1.5, 1, 0.5]);
    expect(result.map(item => item.mark)).toEqual([
      { kind: "points", value: 90 }, { kind: "points", value: 60 }, { kind: "points", value: 30 },
    ]);
    const capped = groupToIndividual({ ...base, marks: [{ workGroupId: "g", mark: { kind: "points", value: 80 } }], peerRatings: ratings });
    expect(capped.find(item => item.learnerId === "a")).toMatchObject({ factor: 1.5, mark: { kind: "points", value: 100 } });
  });

  it("leaves out a student without a group, keeps an exemption and lets a hand-written mark win", () => {
    const result = groupToIndividual({
      ...base,
      marks: [{ workGroupId: "g", mark: { kind: "points", value: 40 } }],
      exemptLearnerIds: ["b"],
      manualLearnerIds: ["c"],
      roster: ["a", "b", "c", "z"],
    });
    expect(result).toEqual([
      { learnerId: "a", mark: { kind: "points", value: 40 }, source: "group" },
      { learnerId: "b", mark: { kind: "exempt" }, source: "exempt" },
      { learnerId: "c", mark: null, source: "individual" },
      { learnerId: "z", mark: null, source: "none" },
    ]);
  });

  it("copies a rubric until a factor turns it into points", () => {
    const rubric = { criteria: [{ id: "ideas", label: "Ideas", weight: 100, levels: [{ id: "alto", label: "Alto", points: 4 }, { id: "bajo", label: "Bajo", points: 1 }] }] };
    const mark = { kind: "rubric" as const, choices: { ideas: "alto" } };
    const copied = groupToIndividual({ ...base, grading: "rubric", rubric, marks: [{ workGroupId: "g", mark }] });
    expect(copied.find(item => item.learnerId === "a")!.mark).toEqual(mark);
    const scaled = groupToIndividual({ ...base, grading: "rubric", rubric, marks: [{ workGroupId: "g", mark }], adjustments: [{ learnerId: "a", kind: "factor", value: 0.5 }] });
    expect(scaled.find(item => item.learnerId === "a")!.mark).toEqual({ kind: "points", value: 50 });
  });
});
