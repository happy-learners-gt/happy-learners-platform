import type { Member } from "@happy-learners/contracts";
import { aiPriceInput, aiUsageSummary, runCost } from "@happy-learners/domain";
import type { AiPrice, AiRun } from "@happy-learners/domain";
import type { Database } from "./storage";
import { openAiSettings } from "./openai";
import { aiBudgetOf } from "./ai-runs";

/**
 * Organización › Uso de IA (1.4.0): GET /api/organization/ai-usage?mes=YYYY-MM gives the month's and the previous
 * month's totals by task, course and person, the latest runs and the prices; POST /api/organization/ai-prices records
 * a model's price from a date (replacing the one of that model and date; ai_prices keeps who and when). Administration only.
 */
const reply = (value: unknown, status = 200) => Response.json(value, { status });
export const aiUsageMethods = (path: string) => path === "/api/organization/ai-usage" ? ["GET"] : path === "/api/organization/ai-prices" ? ["POST"] : null;

const monthOf = (value: string | null) => value && /^\d{4}-(0[1-9]|1[0-2])$/.test(value) ? value : new Date().toISOString().slice(0, 7);
const previous = (month: string) => { const [year, number] = month.split("-").map(Number); return number === 1 ? `${year - 1}-12` : `${year}-${String(number - 1).padStart(2, "0")}`; };
const next = (month: string) => { const [year, number] = month.split("-").map(Number); return number === 12 ? `${year + 1}-01` : `${year}-${String(number + 1).padStart(2, "0")}`; };

async function pricesOf(db: Database, organizationId: string) {
  return (await db.prepare("SELECT model,effective_from AS effectiveFrom,input_per_million AS inputPerMillion,output_per_million AS outputPerMillion FROM ai_prices WHERE organization_id=? ORDER BY model,effective_from DESC")
    .bind(organizationId).all<AiPrice>()).results;
}
async function runsOf(db: Database, organizationId: string, from: string, until: string) {
  return (await db.prepare(`SELECT r.id,r.user_id AS userId,u.display_name AS userName,r.course_id AS courseId,c.title AS courseTitle,r.task,r.prompt_version AS promptVersion,
      r.generator,r.model,r.input_chars AS inputChars,r.input_tokens AS inputTokens,r.output_tokens AS outputTokens,r.duration_ms AS durationMs,r.status,r.created_at AS createdAt,
      r.proposed_items AS proposedItems,r.accepted_items AS acceptedItems
    FROM ai_runs r LEFT JOIN users u ON u.id=r.user_id LEFT JOIN courses c ON c.id=r.course_id AND c.organization_id=r.organization_id
    WHERE r.organization_id=? AND r.created_at>=? AND r.created_at<? ORDER BY r.created_at DESC`).bind(organizationId, `${from}-01`, `${until}-01`).all<AiRun>()).results;
}

/**
 * AIG-4b: lesson proposals and the book map are decided later, where they live, so their acceptance is read from the
 * data instead of being reported: a proposed lesson is used once published and discarded if archived unpublished; a
 * map the AI reviewed is kept when the team confirmed the AI's pages, changed when the team edited them.
 */
async function laterDecisions(db: Database, organizationId: string, from: string, until: string) {
  const [proposals, maps] = await db.batch([
    db.prepare(`SELECT count(*) AS proposed,COALESCE(sum(l.revision>0),0) AS used,COALESCE(sum(l.revision=0 AND l.archived=1),0) AS discarded
      FROM proposal_items i JOIN proposal_jobs j ON j.id=i.job_id LEFT JOIN lessons l ON l.id=i.lesson_id
      WHERE j.organization_id=? AND i.status='done' AND i.finished_at>=? AND i.finished_at<?`).bind(organizationId, `${from}-01`, `${until}-01`),
    db.prepare(`SELECT count(*) AS reviewed,COALESCE(sum(status='confirmed' AND source='ai'),0) AS kept,COALESCE(sum(status='confirmed' AND source<>'ai'),0) AS changed
      FROM book_maps WHERE organization_id=? AND ai_status='done' AND updated_at>=? AND updated_at<?`).bind(organizationId, `${from}-01`, `${until}-01`),
  ]) as unknown as [{ proposed: number; used: number; discarded: number }[], { reviewed: number; kept: number; changed: number }[]];
  const counts = <T extends object>(row: T | undefined) => Object.fromEntries(Object.entries(row || {}).map(([key, value]) => [key, Number(value) || 0])) as { [K in keyof T]: number };
  return { proposals: counts(proposals[0]), bookMap: counts(maps[0]) };
}

export async function aiUsage(path: string, method: string, input: unknown, url: URL, current: Member, db: Database, env: Env): Promise<Response> {
  if (current.role !== "admin") return reply({ error: "Solo administración ve el uso de IA de la organización." }, 403);
  if (path === "/api/organization/ai-prices") {
    const price = aiPriceInput(input);
    if ("error" in price) return reply(price, 400);
    await db.prepare(`INSERT INTO ai_prices(id,organization_id,model,effective_from,input_per_million,output_per_million,updated_by,updated_at) VALUES (?,?,?,?,?,?,?,?)
      ON CONFLICT(organization_id,model,effective_from) DO UPDATE SET input_per_million=excluded.input_per_million,output_per_million=excluded.output_per_million,updated_by=excluded.updated_by,updated_at=excluded.updated_at`)
      .bind(`ai-price-${crypto.randomUUID()}`, current.organizationId, price.model, price.effectiveFrom, price.inputPerMillion, price.outputPerMillion, current.id, new Date().toISOString()).run();
    return reply({ prices: await pricesOf(db, current.organizationId) });
  }
  const month = monthOf(url.searchParams.get("mes")), before = previous(month);
  const [prices, runs, earlier] = await Promise.all([pricesOf(db, current.organizationId), runsOf(db, current.organizationId, month, next(month)), runsOf(db, current.organizationId, before, month)]);
  const models = [...new Set([...runs, ...earlier].filter(run => run.generator === "openai").map(run => run.model))];
  return reply({
    // AIG-5: whether the AI answers here at all; the local generator is for tests and demos.
    engine: openAiSettings(env) ? "openai" : env.LESSON_GENERATOR === "fixture" ? "fixture" : null,
    // AIG-6: the budget is always this month's, whatever month is being read.
    budget: await aiBudgetOf(db, current.organizationId, env),
    later: await laterDecisions(db, current.organizationId, month, next(month)),
    month, previousMonth: before, summary: aiUsageSummary(runs, prices), previous: aiUsageSummary(earlier, prices).total, prices,
    unpriced: models.filter(model => !prices.some(price => price.model === model)),
    recent: runs.slice(0, 50).map(run => ({ ...run, cost: runCost(run, prices) })),
  });
}
