import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { SequenceTemplate } from "@happy-learners/contracts";
import { draftFromOutput, fixtureGenerator, lessonReview, proposalProblem, sequenceOf, validActivities } from "../packages/domain/src/index";
import type { LessonDraftGenerator, ProposalInput } from "../packages/domain/src/index";
import { openAiGenerator, openAiSettings } from "../apps/api/src/openai";

/**
 * Harness evaluations (1.4.0, docs/design/asistente-ia.md §6a). Each case asks the generator for a lesson and grades
 * the answer: valid, citing only the pages it was given, and good enough by the deterministic review. With the local
 * fixture this runs in ./scripts/verify; `npm run ai:eval` runs it against the configured model (manual, never in CI)
 * and leaves a report to compare models or prompt versions.
 */
type Case = Omit<ProposalInput, "sequence"> & { name: string; sequence: SequenceTemplate };
const cases = JSON.parse(readFileSync("tests/ai-evals/lesson-proposal.cases.json", "utf8")) as Case[];
const live = process.env.AI_EVAL_LIVE === "1";
const settings = live ? openAiSettings(process.env as unknown as Env) : null;
const generator: LessonDraftGenerator = settings ? openAiGenerator(settings) : fixtureGenerator;
const minimum = 70;

describe(`AI harness evaluations (${generator.kind})`, () => {
  if (live && !settings) it.skip("needs OPENAI_API_KEY and OPENAI_MODEL in the environment", () => {});
  const report: Record<string, unknown>[] = [];
  for (const item of cases) it(`lesson proposal: ${item.name}`, async () => {
    const sequence = sequenceOf(item.sequence);
    const input: ProposalInput = { ...item, sequence: { label: sequence.label, phases: sequence.phases.map(({ id, label, hint }) => ({ id, label, hint })) } };
    let tokens: { inputTokens: number; outputTokens: number } | null = null;
    const started = Date.now();
    const draft = draftFromOutput(await generator.generate(input, usage => { tokens = usage; }), input);
    const review = lessonReview({ objective: draft.objective, outcomeIds: [item.outcome.id], activities: draft.activities }, { sequence: item.sequence, courseOutcomes: 1, indexedResources: false, classMinutes: item.minutes });
    const cited = draft.activities.flatMap(activity => [...(activity.instructions || "").matchAll(/p(?:ág(?:s)?|\.)\.?\s*(\d+)/gi)].map(match => Number(match[1])));
    report.push({ case: item.name, generator: generator.kind, model: settings?.model || "fixture", score: review.score, failing: review.checks.filter(check => check.status === "fail" || check.status === "partial").map(check => check.id), tokens, ms: Date.now() - started });
    expect(proposalProblem(draft, input)).toBeNull();
    expect(validActivities(draft.activities)).toBe(true);
    expect(cited.every(page => item.book.pages.includes(page)), `cita páginas ${cited.join(", ")} fuera de ${item.book.pages.join(", ")}`).toBe(true);
    expect(review.score, JSON.stringify(review.checks.filter(check => check.status !== "pass" && check.status !== "n/a").map(check => [check.id, check.evidence]))).toBeGreaterThanOrEqual(minimum);
  }, live ? 180_000 : 5_000);
  if (live) it("writes the report", () => {
    mkdirSync(".release-evidence/ai-evals", { recursive: true });
    writeFileSync(`.release-evidence/ai-evals/${new Date().toISOString().slice(0, 19).replace(/:/g, "-")}-${settings?.model || "fixture"}.json`, JSON.stringify(report, null, 2) + "\n");
    expect(report.length).toBe(cases.length);
  });
});
