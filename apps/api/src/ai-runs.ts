import type { AiRunStatus, AiTask, AiTokenUsage } from "@happy-learners/domain";
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
}

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
      .bind(`ai-run-${crypto.randomUUID()}`, context.organizationId, context.userId, context.courseId, context.task, context.promptVersion, context.generator, context.model,
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
