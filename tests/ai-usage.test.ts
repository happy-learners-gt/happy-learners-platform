import { describe, expect, it } from "vitest";
import { aiPriceInput, aiUsageSummary, priceOn, runCost } from "../packages/domain/src/index";
import type { AiPrice, AiRun } from "../packages/domain/src/index";

// 1.4.0 (docs/design/asistente-ia.md §6a): costs come from administration's prices, by model and date.
const prices: AiPrice[] = [
  { model: "modelo-a", effectiveFrom: "2026-09-01", inputPerMillion: 2, outputPerMillion: 8 },
  { model: "modelo-a", effectiveFrom: "2026-10-15", inputPerMillion: 1, outputPerMillion: 4 },
];
const run = (partial: Partial<AiRun>): AiRun => ({
  id: "r", userId: "u-1", userName: "Lucía", courseId: "c-1", courseTitle: "Matemáticas", task: "lesson-proposal", promptVersion: "v3",
  generator: "openai", model: "modelo-a", inputChars: 1000, inputTokens: 1_000_000, outputTokens: 100_000, durationMs: 1000, status: "ok", createdAt: "2026-10-20T10:00:00Z", ...partial,
});

describe("1.4.0 AI usage and cost", () => {
  it("uses the price in force on the day of each run", () => {
    expect(priceOn(prices, "modelo-a", "2026-10-14")!.inputPerMillion).toBe(2);
    expect(priceOn(prices, "modelo-a", "2026-10-15")!.inputPerMillion).toBe(1);
    expect(priceOn(prices, "modelo-a", "2026-08-31")).toBeNull();
    expect(runCost(run({}), prices)).toBe(1.4); // 1 M × 1 + 0.1 M × 4
    expect(runCost(run({ createdAt: "2026-10-01T00:00:00Z" }), prices)).toBe(2.8); // 1 M × 2 + 0.1 M × 8
  });

  it("costs nothing for the local fixture and is unknown without a price or tokens", () => {
    expect(runCost(run({ generator: "fixture", model: "fixture", inputTokens: null, outputTokens: null }), prices)).toBe(0);
    expect(runCost(run({ model: "modelo-sin-precio" }), prices)).toBeNull();
    expect(runCost(run({ outputTokens: null }), prices)).toBeNull();
  });

  it("adds up the month by task, course and person, and an unknown cost makes the total unknown", () => {
    const runs = [
      run({ id: "1" }),
      run({ id: "2", task: "book-map", status: "transient", durationMs: 3000, inputTokens: 500_000, outputTokens: 0 }),
      run({ id: "3", userId: null, userName: null, courseId: null, courseTitle: null, generator: "fixture", model: "fixture", inputTokens: null, outputTokens: null, durationMs: 2000 }),
    ];
    const summary = aiUsageSummary(runs, prices);
    expect(summary.total).toEqual({ runs: 3, errors: 1, inputTokens: 1_500_000, outputTokens: 100_000, cost: 1.9, averageMs: 2000 });
    expect(summary.byTask.map(item => [item.label, item.runs, item.cost])).toEqual([["Propuestas de lecciones", 2, 1.4], ["Mapa al plan", 1, 0.5]]);
    expect(summary.byCourse.map(item => [item.label, item.runs])).toEqual([["Matemáticas", 2], ["Sin curso", 1]]);
    expect(summary.byPerson.map(item => [item.label, item.runs])).toEqual([["Lucía", 2], ["Proceso automático", 1]]);
    expect(aiUsageSummary([...runs, run({ id: "4", model: "modelo-sin-precio" })], prices).total.cost).toBeNull();
    expect(aiUsageSummary([], prices).total).toEqual({ runs: 0, errors: 0, inputTokens: 0, outputTokens: 0, cost: 0, averageMs: 0 });
  });

  it("validates a price as administration writes it", () => {
    expect(aiPriceInput({ model: " modelo-a ", effectiveFrom: "2026-11-01", inputPerMillion: "1,25", outputPerMillion: 10 })).toEqual({ model: "modelo-a", effectiveFrom: "2026-11-01", inputPerMillion: 1.25, outputPerMillion: 10 });
    expect(aiPriceInput({ model: "", effectiveFrom: "2026-11-01", inputPerMillion: 1, outputPerMillion: 1 })).toEqual({ error: "Escribe el nombre del modelo, de 1 a 80 caracteres." });
    expect(aiPriceInput({ model: "m", effectiveFrom: "1 de noviembre", inputPerMillion: 1, outputPerMillion: 1 })).toEqual({ error: "Indica desde qué fecha rige el precio." });
    expect(aiPriceInput({ model: "m", effectiveFrom: "2026-11-01", inputPerMillion: -1, outputPerMillion: 1 })).toEqual({ error: "Los precios son montos en USD por millón de tokens, de 0 a 1000." });
  });
});
