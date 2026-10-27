import { describe, expect, it } from "vitest";
import { openAiGenerator, openAiSettings } from "../apps/api/src/openai";
import { draftFromOutput, packageOf, proposalProblem, sequenceOf, validActivities } from "../packages/domain/src/index";
import type { ProposalInput } from "../packages/domain/src/index";

// Opt-in smoke test against the real OpenAI API: `./scripts/openai smoke <env-file>`. Never part of ./scripts/verify.
const settings = openAiSettings({ OPENAI_API_KEY: process.env.OPENAI_API_KEY, OPENAI_MODEL: process.env.OPENAI_MODEL, LESSON_MAX_OUTPUT_TOKENS: process.env.LESSON_MAX_OUTPUT_TOKENS });
const indicator = packageOf("cnb-matematicas-primaria-6")!.competencies[0].indicators[1];
const sequence = sequenceOf("start-develop-close");
const input: ProposalInput = {
  course: "Matemáticas 6.º", grade: "Primaria", minutes: 45, sequence: { label: sequence.label, phases: sequence.phases.map(({ id, label, hint }) => ({ id, label, hint })) },
  outcome: { id: "outcome-1", statement: indicator.statement, code: indicator.code, competency: null, contents: indicator.contents },
  book: { title: "Matemáticas 6 (libro de prueba)", fileId: "course-file-1", pages: [2], excerpt: "[p. 2] Perímetro y área. El perímetro de un polígono es la suma de las longitudes de sus lados. El área de un triángulo se calcula con la fórmula base por altura entre dos. La circunferencia mide dos por pi por el radio y el área del círculo es pi por el radio al cuadrado. Ejercicio: calcula el perímetro y el área del patio de la escuela." },
};

describe.skipIf(!settings)("OpenAI lesson generator (real network)", () => {
  it("proposes a lesson that fits the platform's lesson model", async () => {
    const started = Date.now();
    const draft = draftFromOutput(await openAiGenerator(settings!).generate(input), input);
    console.log(JSON.stringify({ model: settings!.model, seconds: Math.round((Date.now() - started) / 1000), title: draft.title, activities: draft.activities.map(activity => `${activity.phase} · ${activity.minutes} min · ${activity.title}`) }, null, 1));
    expect(proposalProblem(draft, input)).toBeNull();
    expect(validActivities(draft.activities)).toBe(true);
  }, 180_000);
});
