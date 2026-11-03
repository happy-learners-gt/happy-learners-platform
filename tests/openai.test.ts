import { describe, expect, it } from "vitest";
import { failureOf, openAiGenerator, openAiRulesTranslator, openAiSettings, openAiWriter, TransientError } from "../apps/api/src/openai";
import { draftFromOutput, proposalProblem, sequenceOf, validActivities } from "../packages/domain/src/index";
import type { ProposalInput } from "../packages/domain/src/index";

// The OpenAI adapter of lesson proposals, without network: a fake fetch stands for the Responses API.
const sequence = sequenceOf("start-develop-close");
const input: ProposalInput = {
  course: "Matemáticas 6.º", grade: "Primaria", minutes: 45, sequence: { label: sequence.label, phases: sequence.phases.map(({ id, label, hint }) => ({ id, label, hint })) },
  outcome: { id: "outcome-1", statement: "Calcula perímetro y área de diferentes polígonos y del círculo.", code: "1.2", competency: null, contents: ["1.2.3. Cálculo de circunferencia y área del círculo."] },
  book: { title: "Libro", fileId: "course-file-1", pages: [3], excerpt: "[p. 3] Perímetro y área del círculo." },
};
const lesson = { title: "Área del círculo", objective: "Calcular el área del círculo.", activities: [
  { title: "Inicio", phase: "start", purpose: "explore", grouping: "whole-class", minutes: 10, instructions: "Lee la p. 3.", question: null },
  { title: "Práctica", phase: "develop", purpose: "practice", grouping: "pairs", minutes: 25, instructions: "Resuelve los ejercicios de la p. 3.", question: null },
  { title: "Cierre", phase: "close", purpose: "assess", grouping: "individual", minutes: 10, instructions: "Responde.", question: { prompt: "¿Cuál es el área de un círculo de radio 1?", options: ["π", "2π", "1"], answer: 0 } },
] };
const answer = (body: unknown, status = 200) => async () => new Response(JSON.stringify(body), { status });
const message = (text: string) => ({ status: "completed", output: [{ type: "reasoning" }, { type: "message", content: [{ type: "output_text", text }] }] });
const settings = { key: "sk-test-secreta", model: "modelo-de-prueba" };

describe("OpenAI lesson generator (no network)", () => {
  it("is configured only with both the secret and the model; limits are bounded", () => {
    expect(openAiSettings({})).toBeNull();
    expect(openAiSettings({ OPENAI_API_KEY: "k" })).toBeNull();
    expect(openAiSettings({ OPENAI_API_KEY: "k", OPENAI_MODEL: "m", LESSON_MAX_OUTPUT_TOKENS: "8000", LESSON_REQUEST_TIMEOUT_MS: "1" })).toEqual({ key: "k", model: "m", maxOutputTokens: 8000, timeoutMs: undefined });
  });

  it("AIG-3: short tasks use OPENAI_MODEL_SHORT when it is set, the rest keep OPENAI_MODEL", async () => {
    const both = openAiSettings({ OPENAI_API_KEY: "k", OPENAI_MODEL: "grande", OPENAI_MODEL_SHORT: " pequeno " })!;
    expect(both).toMatchObject({ model: "grande", shortModel: "pequeno" });
    expect(openAiSettings({ OPENAI_API_KEY: "k", OPENAI_MODEL: "grande", OPENAI_MODEL_SHORT: "" })).not.toHaveProperty("shortModel");
    const models: string[] = [];
    const fake = async (_url: unknown, init?: RequestInit) => { models.push(JSON.parse(String(init!.body)).model); return answer(message(JSON.stringify({ text: "Hola." })))(); };
    await openAiWriter(both, fake as typeof fetch).write({ field: "lesson-objective", action: "shorten", text: "Hola a todos.", context: {} } as never).catch(() => undefined);
    await openAiRulesTranslator(both, fake as typeof fetch).translate({ text: "Herrera no da clases los viernes", context: { sections: [], educators: [], classrooms: [] } } as never).catch(() => undefined);
    expect(models).toEqual(["pequeno", "grande"]);
  });

  it("asks the Responses API for strict structured output, unstored, and reads the message after the reasoning", async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    const generator = openAiGenerator(settings, async (url, init) => { calls.push({ url: String(url), init: init! }); return answer(message(JSON.stringify(lesson)))(); });
    const output = await generator.generate(input);
    expect(calls[0].url).toBe("https://api.openai.com/v1/responses");
    expect((calls[0].init.headers as Record<string, string>).Authorization).toBe("Bearer sk-test-secreta");
    const body = JSON.parse(String(calls[0].init.body));
    expect(body).toMatchObject({ model: "modelo-de-prueba", store: false, max_output_tokens: 16000, text: { format: { type: "json_schema", strict: true, name: "lesson_proposal" } } });
    expect(body.input).toContain("indicador 1.2");
    const draft = draftFromOutput(output, input);
    expect(proposalProblem(draft, input)).toBeNull();
    expect(validActivities(draft.activities)).toBe(true);
  });

  it("tells transient failures from final ones, never echoing the secret", async () => {
    for (const status of [429, 500, 503]) await expect(openAiGenerator(settings, answer({}, status)).generate(input)).rejects.toBeInstanceOf(TransientError);
    await expect(openAiGenerator(settings, async () => { throw new TypeError("network"); }).generate(input)).rejects.toBeInstanceOf(TransientError);
    const final = [
      openAiGenerator(settings, answer({ error: { message: "Incorrect API key sk-test-secreta" } }, 401)),
      openAiGenerator(settings, answer({ status: "incomplete", incomplete_details: { reason: "max_output_tokens" }, output: [] })),
      openAiGenerator(settings, answer({ status: "completed", output: [{ type: "message", content: [{ type: "refusal", refusal: "No." }] }] })),
      openAiGenerator(settings, answer({ status: "completed", output: [] })),
    ];
    const errors = await Promise.all(final.map(generator => generator.generate(input).then(() => null, (error: Error) => error)));
    expect(errors.map(error => error?.message)).toEqual(["status 401", "incomplete max_output_tokens", "refusal", "empty"]);
    expect(errors.every(error => !(error instanceof TransientError) && !error!.message.includes("sk-"))).toBe(true);
  });

  it("reports the tokens of an answer, even one that is not usable, and the harness names how a run ended (1.4.0)", async () => {
    const usage = { input_tokens: 1234, output_tokens: 567 };
    const seen: unknown[] = [];
    await openAiGenerator(settings, answer({ ...message(JSON.stringify(lesson)), usage })).generate(input, reported => seen.push(reported));
    await openAiGenerator(settings, answer({ status: "incomplete", incomplete_details: { reason: "max_output_tokens" }, usage, output: [] })).generate(input, reported => seen.push(reported)).catch(() => null);
    await openAiGenerator(settings, answer(message(JSON.stringify(lesson)))).generate(input, reported => seen.push(reported));
    expect(seen).toEqual([{ inputTokens: 1234, outputTokens: 567 }, { inputTokens: 1234, outputTokens: 567 }]);
    expect([new TransientError("status 429"), new Error("refusal"), new Error("incomplete max_output_tokens"), new Error("status 401"), "x"].map(failureOf))
      .toEqual(["transient", "refused", "incomplete", "error", "error"]);
  });
});
