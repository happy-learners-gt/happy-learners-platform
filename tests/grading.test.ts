import { describe, expect, it } from "vitest";
import type { GradingActivity, GradingPeriod, GradingScheme, Mark, Rubric } from "../packages/contracts/src/index";
import {
  displayOf,
  learnerResult,
  markValue,
  pointsScheme,
  rubricInput,
  schemeFromSettings,
  schemeInput,
  schemeTemplates,
} from "../packages/domain/src/index";

const periods: GradingPeriod[] = [{ id: "p1", weight: 1 }, { id: "p2", weight: 3 }];
const activity = (id: string, periodId: string, points: number, categoryId = "general", extra = false): GradingActivity => ({
  id, periodId, categoryId, title: id, points, grading: "points", ...(extra ? { extra: true } : {}),
});
const marks = (entries: [string, Mark][]) => new Map(entries);
const result = (scheme: GradingScheme, activities: GradingActivity[], entries: [string, Mark][], usePeriods = periods) =>
  learnerResult(scheme, activities, marks(entries), usePeriods);

describe("the data-driven grading engine", () => {
  it("translates the current gradebook settings without changing its results", () => {
    const numeric = schemeFromSettings({ gradeScale: "numeric_100", passingGrade: 60, letterThresholds: [90, 80, 70, 60], gradeAverage: "simple" });
    const letters = schemeFromSettings({ gradeScale: "letters_af", passingGrade: 65, letterThresholds: [93, 85, 77, 70], gradeAverage: "weighted" });
    const activities = [activity("first", "p1", 100), activity("second", "p2", 100)];
    const recorded: [string, Mark][] = [["first", { kind: "points", value: 90 }], ["second", { kind: "points", value: 60 }]];
    expect(result(numeric, activities, recorded).final).toMatchObject({ score: 75, display: "75,0", passed: true, complete: true });
    expect(result(letters, activities, recorded).final).toMatchObject({ score: 67.5, display: "F", passed: true, complete: true });
  });

  it("reproduces the points plan, partial periods, missing scores, weighted periods and letters", () => {
    const plan = [activity("zona-a", "p1", 20), activity("zona-b", "p1", 40), activity("examen", "p1", 40)];
    expect(result(pointsScheme, plan, []).periods[0]).toMatchObject({ score: null, graded: 0, complete: false });
    expect(result(pointsScheme, plan, [["zona-a", { kind: "points", value: 18 }], ["zona-b", { kind: "points", value: 35.5 }]]).periods[0])
      .toMatchObject({ score: 53.5, graded: 60, complete: false });
    expect(result(pointsScheme, plan, [["zona-a", { kind: "points", value: 18 }], ["zona-b", { kind: "points", value: 35.5 }], ["examen", { kind: "points", value: 32 }]]).periods[0])
      .toMatchObject({ score: 85.5, graded: 100, complete: true });

    const across = [activity("first", "p1", 100), activity("second", "p2", 100)];
    const recorded: [string, Mark][] = [["first", { kind: "points", value: 90 }], ["second", { kind: "points", value: 60 }]];
    expect(result(pointsScheme, across, [["first", { kind: "points", value: 90 }]]).final.score).toBe(90);
    expect(result(pointsScheme, across, recorded).final.score).toBe(75);
    const weighted = { ...pointsScheme, periods: "weighted" as const };
    expect(result(weighted, across, recorded).final.score).toBe(67.5);
    const letters = { ...pointsScheme, display: { kind: "letters" as const, thresholds: [{ letter: "A", min: 90 }, { letter: "B", min: 80 }, { letter: "C", min: 70 }, { letter: "D", min: 60 }, { letter: "F", min: 0 }] } };
    expect(result(letters, across, recorded).final.display).toBe("C");
  });

  it("weights categories, drops the lowest mark, enforces category minimums and caps extra credit", () => {
    const scheme: GradingScheme = {
      id: "weighted", name: "Ponderado", method: "weighted-categories",
      categories: [{ id: "work", label: "Trabajo", weight: 60, dropLowest: 1 }, { id: "exam", label: "Examen", weight: 40, minimum: 60 }],
      display: { kind: "numeric", max: 100, decimals: 1 }, passing: { min: 60 }, periods: "simple", extraCreditCap: 3, retakes: "replace",
    };
    const activities = [
      activity("bad", "p1", 10, "work"), activity("good", "p1", 20, "work"),
      activity("exam", "p1", 40, "exam"), activity("bonus", "p1", 10, "work", true),
    ];
    const calculated = result(scheme, activities, [
      ["bad", { kind: "points", value: 2 }], ["good", { kind: "points", value: 18 }],
      ["exam", { kind: "points", value: 20 }], ["bonus", { kind: "points", value: 8 }],
    ]).periods[0];
    expect(calculated).toEqual({
      periodId: "p1", score: 77, display: "77,0", level: null, graded: 70, complete: true, passed: false,
      reasons: ["No alcanzó el mínimo de 60 en «Examen»."],
    });
    expect(result(scheme, [activity("only", "p1", 20, "work")], [["only", { kind: "points", value: 16 }]]).periods[0].score).toBe(80);
  });

  it("applies every retake mode and excludes exemptions and missing activities", () => {
    const base = activity("original", "p1", 100);
    const retake = { ...activity("retake", "p1", 100), retakeOf: "original" };
    const attempts: [string, Mark][] = [["original", { kind: "points", value: 40 }], ["retake", { kind: "points", value: 80 }]];
    expect(result({ ...pointsScheme, retakes: "replace" }, [base, retake], attempts).periods[0].score).toBe(80);
    expect(result({ ...pointsScheme, retakes: "highest" }, [base, retake], attempts).periods[0].score).toBe(80);
    expect(result({ ...pointsScheme, retakes: "average" }, [base, retake], attempts).periods[0].score).toBe(60);
    expect(result(pointsScheme, [base], [["original", { kind: "exempt" }]]).periods[0]).toMatchObject({ score: null, graded: 0, complete: true });
    expect(result(pointsScheme, [base], []).periods[0]).toMatchObject({ score: null, graded: 0, complete: false });
  });

  it("calculates a weighted rubric exactly", () => {
    const rubric: Rubric = {
      criteria: [
        { id: "technique", label: "Técnica", weight: 50, levels: [{ id: "great", label: "Bien", points: 4 }, { id: "start", label: "Inicio", points: 1 }] },
        { id: "expression", label: "Expresión", weight: 30, levels: [{ id: "great", label: "Bien", points: 10 }, { id: "start", label: "Inicio", points: 5 }] },
        { id: "presence", label: "Presencia", weight: 20, levels: [{ id: "great", label: "Bien", points: 2 }, { id: "start", label: "Inicio", points: 0 }] },
      ],
    };
    const item: GradingActivity = { ...activity("rubric", "p1", 40), grading: "rubric", rubric };
    expect(markValue(item, { kind: "rubric", choices: { technique: "great", expression: "start", presence: "great" } })).toBe(34);
  });

  it("combines a panel by average, median, majority or its chair and ignores an exempt evaluator", () => {
    const panel = (combine: "average" | "median" | "majority" | "chair", chair?: string): GradingActivity => ({
      ...activity(combine, "p1", 100), grading: "panel", panel: { combine, ...(chair ? { chair } : {}) },
    });
    const vote = (...values: [string, number | null][]): Mark => ({
      kind: "panel",
      marks: values.map(([evaluator, value]) => ({ evaluator, mark: value === null ? { kind: "exempt" } : { kind: "points", value } })),
    });
    expect(markValue(panel("average"), vote(["a", 80], ["b", 70], ["c", null]))).toBe(75);
    expect(markValue(panel("median"), vote(["a", 40], ["b", 80], ["c", 90]))).toBe(80);
    expect(markValue(panel("majority"), vote(["a", 80], ["b", 80], ["c", 60]))).toBe(80);
    expect(markValue(panel("majority", "b"), vote(["a", 80], ["b", 60]))).toBe(60);
    expect(markValue(panel("majority"), vote(["a", 80], ["b", 60]))).toBe(70);
    expect(markValue(panel("majority"), vote(["a", 70], ["b", 70], ["c", 80], ["d", 100]))).toBe(80);
    expect(markValue(panel("chair", "b"), vote(["a", 80], ["b", 60]))).toBe(60);
    expect(markValue(panel("average"), vote(["a", 80], ["a", 60]))).toBeNull();
  });

  it("calculates levels and pass/fail end to end and formats GPA with two decimals", () => {
    const levelScheme = schemeTemplates.find(template => template.id === "idiomas")!;
    const levelActivity: GradingActivity = { ...activity("oral", "p1", 100, "expresion"), grading: "level" };
    const levelResult = result(levelScheme, [levelActivity], [["oral", { kind: "level", value: "b2" }]]).periods[0];
    expect(levelResult).toMatchObject({ score: 80, level: "b2", display: "B2", passed: true });

    const technical = schemeTemplates.find(template => template.id === "tecnica")!;
    const competencies = [
      { ...activity("safe", "p1", 50, "competencias"), grading: "pass-fail" as const },
      { ...activity("quality", "p1", 50, "competencias"), grading: "pass-fail" as const },
    ];
    expect(result(technical, competencies, [["safe", { kind: "pass", value: true }], ["quality", { kind: "pass", value: false }]]).final)
      .toMatchObject({ score: 50, display: "No aprobado", passed: false });
    const university = schemeTemplates.find(template => template.id === "universidad")!;
    expect(displayOf(university, 84)).toBe("3,00");
  });

  it("combines periods as simple, weighted, cumulative, last or none", () => {
    const activities = [activity("one", "p1", 100), activity("two", "p2", 50)];
    const recorded: [string, Mark][] = [["one", { kind: "points", value: 50 }], ["two", { kind: "points", value: 50 }]];
    expect(result({ ...pointsScheme, periods: "simple" }, activities, recorded).final.score).toBe(50);
    expect(result({ ...pointsScheme, periods: "weighted" }, activities, recorded).final.score).toBe(50);
    expect(result({ ...pointsScheme, periods: "cumulative" }, activities, recorded).final.score).toBe(100);
    expect(result({ ...pointsScheme, periods: "last" }, activities, recorded).final.score).toBe(50);
    expect(result({ ...pointsScheme, periods: "none" }, activities, recorded).final).toEqual({ score: null, display: null, passed: null, complete: true, reasons: [] });
    const ordered = result({ ...pointsScheme, periods: "last" }, activities, [["one", { kind: "points", value: 50 }]], [
      { id: "p2", position: 1, weight: 1 }, { id: "p1", position: 0, weight: 1 },
    ]);
    expect(ordered.periods.map(period => period.periodId)).toEqual(["p1", "p2"]);
    expect(ordered.final).toMatchObject({ score: 50, complete: false });
  });

  it("keeps every starting template valid and produces an exact example result", () => {
    const expected: Record<string, { period: number | null; final: number | null; display: string | null }> = {
      colegio: { period: 80, final: 80, display: "80,0" },
      universidad: { period: 80, final: 80, display: "3,00" },
      idiomas: { period: 60, final: 60, display: "B1" },
      tecnica: { period: 100, final: 100, display: "Aprobado" },
      artes: { period: 80, final: 80, display: "80,0" },
      seminario: { period: 100, final: null, display: null },
      doctorado: { period: 100, final: 100, display: "Aprobado" },
    };
    for (const template of schemeTemplates) {
      expect(schemeInput(template), template.id).toEqual(template);
      const firstCategory = (template.categories.find(category => !category.dropLowest) || template.categories[0]).id;
      const item: GradingActivity = {
        ...activity(`activity-${template.id}`, "p1", 100, firstCategory),
        grading: template.method === "levels" ? "level" : template.method === "pass-fail" ? "pass-fail" : "points",
      };
      const mark: Mark = template.method === "levels" ? { kind: "level", value: "b1" } : template.method === "pass-fail" ? { kind: "pass", value: true } : { kind: "points", value: 80 };
      const calculated = result(template, [item], [[item.id, mark]]);
      expect({ period: calculated.periods[0].score, final: calculated.final.score, display: calculated.final.display }, template.id).toEqual(expected[template.id]);
    }
  });

  it("rejects malformed schemes, rubrics and panels with a precise Spanish message", () => {
    const valid: GradingScheme = {
      id: "valid", name: "Válido", method: "weighted-categories",
      categories: [{ id: "work", label: "Trabajo", weight: 60 }, { id: "exam", label: "Examen", weight: 40 }],
      display: { kind: "letters", thresholds: [{ letter: "A", min: 90 }, { letter: "B", min: 80 }, { letter: "F", min: 0 }] },
      passing: { min: 60 }, periods: "simple", retakes: "replace",
    };
    const badSchemes: [unknown, string][] = [
      [{ ...valid, id: "" }, "El esquema necesita un identificador válido."],
      [{ ...valid, name: "" }, "El esquema necesita un nombre."],
      [{ ...valid, method: "median" }, "Elige cómo se calcula la evaluación."],
      [{ ...valid, categories: [] }, "Agrega al menos una categoría."],
      [{ ...valid, categories: [{ id: "same", label: "Uno", weight: 50 }, { id: "same", label: "Dos", weight: 50 }] }, "Las categorías no pueden repetirse."],
      [{ ...valid, categories: [{ id: "work", label: "Trabajo", weight: 70 }, { id: "exam", label: "Examen", weight: 40 }] }, "Los pesos de las categorías deben sumar 100."],
      [{ ...valid, display: { kind: "letters", thresholds: [{ letter: "B", min: 80 }, { letter: "A", min: 90 }] } }, "Ordena los umbrales de mayor a menor."],
      [{ ...valid, display: { kind: "numeric", max: 100, decimals: 3 } }, "Elige cero, uno o dos decimales."],
      [{ ...valid, passing: { min: 101 } }, "La nota mínima debe estar entre 0 y 100."],
      [{ ...valid, levels: [{ id: "b1", label: "B1", value: 100 }, { id: "a2", label: "A2", value: 0 }], passing: { min: 60, level: "b1" } }, "Define una nota o un nivel mínimo, no ambos."],
      [{ ...valid, periods: "median" }, "Elige cómo se combinan los periodos."],
      [{ ...valid, retakes: "latest" }, "Elige cómo cuentan las reposiciones."],
      [{ ...valid, extraCreditCap: -1 }, "El tope de puntos extra debe estar entre 0 y 100."],
      [{ ...valid, method: "levels", display: { kind: "levels" }, passing: { level: "b1" } }, "Este esquema necesita niveles."],
    ];
    for (const [input, message] of badSchemes) expect(schemeInput(input)).toEqual({ error: message });

    expect(rubricInput({ criteria: [] })).toEqual({ error: "Agrega al menos un criterio a la rúbrica." });
    expect(rubricInput({ criteria: [{ id: "a", label: "A", weight: 90, levels: [{ id: "yes", label: "Sí", points: 1 }, { id: "no", label: "No", points: 0 }] }] }))
      .toEqual({ error: "Los pesos de la rúbrica deben sumar 100." });
    const invalidPanel = { ...activity("panel", "p1", 100), grading: "panel" as const, panel: {} as GradingActivity["panel"] };
    expect(markValue(invalidPanel, { kind: "panel", marks: [{ evaluator: "a", mark: { kind: "points", value: 80 } }] })).toBeNull();
  });
});
