import type { AiRunStatus, AiTask, AiTokenUsage } from "@happy-learners/domain";
import type { Database } from "./storage";
import { failureOf } from "./openai";

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
