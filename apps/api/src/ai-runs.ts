import type { AiPrice, AiRun, AiRunStatus, AiTask, AiTokenUsage } from "@happy-learners/domain";
import { aiBudget, aiBudgetMinimumUsd, aiBudgetPerPersonUsd, runCost } from "@happy-learners/domain";
import type { Database } from "./storage";
import { failureOf } from "./openai";
import { digest } from "./auth";

/**
 * The AI harness (1.4.0, docs/design/asistente-ia.md §6a): every call to a model, or to the local fixture, goes
 * through `tracked`, which measures it and leaves one row in ai_runs. Never the text of the input or the answer.
 */
export interface AiRunContext {
  organizationId: string; userId: string | null; courseId: string | null;
  task: AiTask; promptVersion: string; generator: "openai" | "fixture"; model: string; inputChars: number;
  /** Given when the answer goes back to a person, so they can later say how much of it they used (AIG-4). */
  id?: string;
}
export const aiRunId = () => `ai-run-${crypto.randomUUID()}`;

/** Runs `call`, records it, and returns its result or throws its error unchanged. */
export async function tracked<T>(db: Database, context: AiRunContext, call: (observe: (usage: AiTokenUsage) => void) => Promise<T>): Promise<T> {
  const started = Date.now();
  let usage: AiTokenUsage | null = null, status: AiRunStatus = "ok";
  try { return await call(reported => { usage = reported; }); }
  catch (error) { status = failureOf(error); throw error; }
  finally {
    const tokens = usage as AiTokenUsage | null;
    // Recording never breaks the work it records.
    await db.prepare("INSERT INTO ai_runs(id,organization_id,user_id,course_id,task,prompt_version,generator,model,input_chars,input_tokens,output_tokens,duration_ms,status,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)")
      .bind(context.id || aiRunId(), context.organizationId, context.userId, context.courseId, context.task, context.promptVersion, context.generator, context.model,
        context.inputChars, tokens?.inputTokens ?? null, tokens?.outputTokens ?? null, Date.now() - started, status, new Date().toISOString())
      .run().catch(error => console.error(JSON.stringify({ event: "ai_run_not_recorded", task: context.task, cause: error instanceof Error ? error.message.slice(0, 120) : "unknown" })));
  }
}

/**
 * AIG-1 (docs/transformacion/ia.md): requests a person makes to the AI while they wait, per hour. Far above real use
 * (a few per lesson or document) and enough to stop a script or a taken account from spending without limit.
 * Queued work (proposals, the book map) is bounded by its own batches and attempts.
 */
export const aiHourlyLimit = 60;
/** Counts one request in the person's bucket for this hour; false once they are over the limit. */
export async function aiAllowed(db: Database, userId: string) {
  const now = Date.now(), bucket = await digest(`ai:${userId}:${new Date(now).toISOString().slice(0, 13)}`);
  const limit = await db.prepare("INSERT INTO login_limits (bucket, attempts, expires_at) VALUES (?,1,?) ON CONFLICT(bucket) DO UPDATE SET attempts=CASE WHEN expires_at<? THEN 1 ELSE attempts+1 END, expires_at=CASE WHEN expires_at<? THEN excluded.expires_at ELSE expires_at END RETURNING attempts")
    .bind(bucket, now + 3600000, now, now).first<{ attempts: number }>();
  return !!limit && limit.attempts <= aiHourlyLimit;
}
export const aiLimited = () => Response.json({ error: "Usaste la IA muchas veces en la última hora. Vuelve a intentar más tarde." }, { status: 429 });

/**
 * AIG-4: how much of an answer the person who asked for it used, said once when they have decided on every item it
 * proposed. Counts only. A run of someone else, failed, already decided or older than a day is left as it is.
 */
export function aiOutcomeInput(value: unknown): { proposed: number; accepted: number } | null {
  const input = value && typeof value === "object" ? value as { proposed?: unknown; accepted?: unknown } : {};
  const { proposed, accepted } = input;
  return Number.isInteger(proposed) && Number.isInteger(accepted) && (proposed as number) >= 1 && (proposed as number) <= 100 && (accepted as number) >= 0 && (accepted as number) <= (proposed as number)
    ? { proposed: proposed as number, accepted: accepted as number } : null;
}
export async function recordOutcome(db: Database, organizationId: string, userId: string, runId: string, outcome: { proposed: number; accepted: number }) {
  const now = new Date();
  const decided = await db.prepare("UPDATE ai_runs SET proposed_items=?,accepted_items=?,decided_at=? WHERE id=? AND organization_id=? AND user_id=? AND status='ok' AND decided_at IS NULL AND created_at>=? RETURNING id")
    .bind(outcome.proposed, outcome.accepted, now.toISOString(), runId, organizationId, userId, new Date(now.getTime() - 86400000).toISOString()).first<{ id: string }>();
  return !!decided;
}

declare global { interface Env { AI_BUDGET_PER_PERSON_USD?: string; AI_BUDGET_MIN_USD?: string } }
const usd = (value: string | undefined, fallback: number) => { const amount = Number(value); return value !== undefined && value !== "" && Number.isFinite(amount) && amount >= 0 ? amount : fallback; };
/**
 * AIG-6: this month's AI budget of the organization and what it spent at the prices administration registered. The
 * runs are summed by model and day in the query; Acervum sets the amounts per deployment (AI_BUDGET_*).
 */
export async function aiBudgetOf(db: Database, organizationId: string, env: Pick<Env, "AI_BUDGET_PER_PERSON_USD" | "AI_BUDGET_MIN_USD">) {
  const month = `${new Date().toISOString().slice(0, 7)}-01`;
  const [people, groups, prices] = await db.batch([
    db.prepare("SELECT count(*) AS total FROM memberships WHERE organization_id=? AND active=1").bind(organizationId),
    db.prepare(`SELECT model,generator,substr(created_at,1,10) AS day,sum(input_tokens) AS inputTokens,sum(output_tokens) AS outputTokens,sum(input_tokens IS NULL OR output_tokens IS NULL) AS unknown
      FROM ai_runs WHERE organization_id=? AND created_at>=? GROUP BY model,generator,day`).bind(organizationId, month),
    db.prepare("SELECT model,effective_from AS effectiveFrom,input_per_million AS inputPerMillion,output_per_million AS outputPerMillion FROM ai_prices WHERE organization_id=?").bind(organizationId),
  ]) as unknown as [{ total: number }[], { model: string; generator: "openai" | "fixture"; day: string; inputTokens: number | null; outputTokens: number | null; unknown: number }[], AiPrice[]];
  let spent = 0, unpriced = false;
  for (const group of groups) {
    const cost = runCost({ generator: group.generator, model: group.model, createdAt: `${group.day}T00:00:00Z`, inputTokens: group.inputTokens ?? 0, outputTokens: group.outputTokens ?? 0 } as AiRun, prices);
    if (cost === null || (group.generator === "openai" && group.unknown > 0)) unpriced = true;
    spent += cost || 0;
  }
  return aiBudget(Number(people[0]?.total) || 0, Math.round(spent * 1_000_000) / 1_000_000, unpriced, usd(env.AI_BUDGET_PER_PERSON_USD, aiBudgetPerPersonUsd), usd(env.AI_BUDGET_MIN_USD, aiBudgetMinimumUsd));
}
export const aiBudgetSpent = () => Response.json({ error: "La organización usó el presupuesto de IA de este mes. Vuelve a intentar el mes próximo o pide a administración que lo revise en Inteligencia artificial." }, { status: 429 });
/** The checks before a person's request to the AI: the organization's budget, then their hourly limit. */
export async function aiGate(db: Database, current: { id: string; organizationId: string }, env: Pick<Env, "AI_BUDGET_PER_PERSON_USD" | "AI_BUDGET_MIN_USD">): Promise<Response | null> {
  if ((await aiBudgetOf(db, current.organizationId, env)).level === "exhausted") return aiBudgetSpent();
  return await aiAllowed(db, current.id) ? null : aiLimited();
}
