import { improvePrompt, improveSchema, mapPrompt, mapSchema, proposalPrompt, proposalSchema, rulesPrompt, rulesSchema, suggestPrompt, suggestSchema, writePrompt, writeSchema } from "@happy-learners/domain";
import type { AiRunStatus, AiTokenUsage, AiWriter, BookMapper, FieldSuggester, ImproveOutput, LessonDraftGenerator, LessonImprover, MapOutput, ProposalOutput, RulesOutput, RulesTranslator, SuggestOutput, WriteOutput } from "@happy-learners/domain";

declare global { interface Env { OPENAI_API_KEY?: string; OPENAI_MODEL?: string; LESSON_MAX_OUTPUT_TOKENS?: string; LESSON_REQUEST_TIMEOUT_MS?: string } }

/** A failure worth trying again later: rate limits, outages, timeouts, network errors. */
export class TransientError extends Error {}

/** How a failed call ended, for the AI harness: this adapter's messages are «refusal», «incomplete …» or a status. */
export function failureOf(error: unknown): AiRunStatus {
  if (error instanceof TransientError) return "transient";
  const message = error instanceof Error ? error.message : "";
  return message === "refusal" ? "refused" : message.startsWith("incomplete") ? "incomplete" : "error";
}

type Settings = { key: string; model: string; maxOutputTokens?: number; timeoutMs?: number };
/** The settings an environment gives, or null when OpenAI is not configured (both the secret and the model are needed). */
export function openAiSettings(env: Pick<Env, "OPENAI_API_KEY" | "OPENAI_MODEL" | "LESSON_MAX_OUTPUT_TOKENS" | "LESSON_REQUEST_TIMEOUT_MS">): Settings | null {
  if (!env.OPENAI_API_KEY || !env.OPENAI_MODEL) return null;
  const number = (value: string | undefined, min: number, max: number) => { const parsed = Number(value); return Number.isInteger(parsed) && parsed >= min && parsed <= max ? parsed : undefined; };
  return { key: env.OPENAI_API_KEY, model: env.OPENAI_MODEL, maxOutputTokens: number(env.LESSON_MAX_OUTPUT_TOKENS, 500, 32000), timeoutMs: number(env.LESSON_REQUEST_TIMEOUT_MS, 5000, 300000) };
}

/** One request to OpenAI's Responses API with structured output (strict JSON Schema), unstored; the parsed answer. */
async function structured<T>({ key, model, maxOutputTokens = 16000, timeoutMs = 120_000 }: Settings, request: typeof fetch, name: string, schema: object, prompt: { system: string; user: string }, observe?: (usage: AiTokenUsage) => void): Promise<T> {
  const response = await request("https://api.openai.com/v1/responses", {
    method: "POST", signal: AbortSignal.timeout(timeoutMs),
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model, instructions: prompt.system, input: prompt.user, store: false, max_output_tokens: maxOutputTokens, text: { format: { type: "json_schema", name, schema, strict: true } } }),
  }).catch(() => { throw new TransientError("transport"); });
  if (response.status === 429 || response.status >= 500) throw new TransientError(`status ${response.status}`);
  if (!response.ok) throw new Error(`status ${response.status}`);
  const data = await response.json() as { status?: string; incomplete_details?: { reason?: string }; usage?: { input_tokens?: number; output_tokens?: number }; output?: { type: string; content?: { type: string; text?: string; refusal?: string }[] }[] };
  // Tokens are billed even when the answer is not usable: report them before judging it.
  if (observe && typeof data.usage?.input_tokens === "number" && typeof data.usage.output_tokens === "number") observe({ inputTokens: data.usage.input_tokens, outputTokens: data.usage.output_tokens });
  // A truncated answer is not JSON yet; a refusal is not an answer.
  if (data.status === "incomplete") throw new Error(`incomplete ${data.incomplete_details?.reason || ""}`.trim());
  const parts = data.output?.find(item => item.type === "message")?.content || [];
  if (parts.some(part => part.type === "refusal")) throw new Error("refusal");
  const text = parts.find(part => part.type === "output_text")?.text;
  if (!text) throw new Error("empty");
  return JSON.parse(text) as T;
}

/**
 * Lesson proposals from a language model. A lesson is a few thousand tokens of JSON: the default output cap leaves
 * room for a reasoning model's thinking too.
 */
export function openAiGenerator(settings: Settings, request: typeof fetch = fetch): LessonDraftGenerator {
  return { kind: "openai", generate: (input, observe) => structured<ProposalOutput>(settings, request, "lesson_proposal", proposalSchema, proposalPrompt(input), observe) };
}
/** The book map's check from a language model: which candidate pages work on an indicator, each with a quote. */
export function openAiMapper(settings: Settings, request: typeof fetch = fetch): BookMapper {
  return { kind: "openai", map: (input, observe) => structured<MapOutput>(settings, request, "book_map", mapSchema, mapPrompt(input), observe) };
}
/** Assisted improvement (1.4.1): changes to a lesson, as a checked draft. */
export function openAiImprover(settings: Settings, request: typeof fetch = fetch): LessonImprover {
  return { kind: "openai", improve: (input, observe) => structured<ImproveOutput>({ ...settings, maxOutputTokens: Math.min(settings.maxOutputTokens || 8000, 8000), timeoutMs: Math.min(settings.timeoutMs || 60_000, 60_000) }, request, "lesson_improve", improveSchema, improvePrompt(input), observe) };
}
/** «Redactar con IA» (1.4.1): a short text, so a short answer and a short wait. */
export function openAiWriter(settings: Settings, request: typeof fetch = fetch): AiWriter {
  return { kind: "openai", write: (input, observe) => structured<WriteOutput>({ ...settings, maxOutputTokens: 2000, timeoutMs: Math.min(settings.timeoutMs || 30_000, 30_000) }, request, "write", writeSchema, writePrompt(input), observe) };
}
/** Fields for a document's text (1.5.2): parts of the text and the field that replaces each, shown one by one. */
export function openAiSuggester(settings: Settings, request: typeof fetch = fetch): FieldSuggester {
  return { kind: "openai", suggest: (input, observe) => structured<SuggestOutput>({ ...settings, maxOutputTokens: 2000, timeoutMs: Math.min(settings.timeoutMs || 30_000, 30_000) }, request, "suggest_fields", suggestSchema, suggestPrompt(input), observe) };
}
/** Timetable rules in words (1.4.3): structured rules a person confirms. */
export function openAiRulesTranslator(settings: Settings, request: typeof fetch = fetch): RulesTranslator {
  return { kind: "openai", translate: (input, observe) => structured<RulesOutput>({ ...settings, maxOutputTokens: 4000, timeoutMs: Math.min(settings.timeoutMs || 45_000, 45_000) }, request, "timetable_rules", rulesSchema, rulesPrompt(input), observe) };
}
