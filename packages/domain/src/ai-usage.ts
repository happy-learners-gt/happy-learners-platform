/**
 * AI usage (1.4.0, docs/design/asistente-ia.md §6a): what each run cost, from the price administration set for its
 * model and date, and the month's totals by task, course and person. Prices are never fixed in code: they change.
 */
export type AiTask = "lesson-proposal" | "book-map" | "lesson-review-explain" | "lesson-improve" | "write" | "rules-to-constraints" | "suggest-fields";
/** Tokens a model reports for one answer. */
export interface AiTokenUsage { inputTokens: number; outputTokens: number }
export type AiRunStatus = "ok" | "error" | "transient" | "refused" | "incomplete";
export interface AiRun {
  id: string; userId: string | null; userName?: string | null; courseId: string | null; courseTitle?: string | null;
  task: AiTask; promptVersion: string; generator: "openai" | "fixture"; model: string;
  inputChars: number; inputTokens: number | null; outputTokens: number | null; durationMs: number; status: AiRunStatus; createdAt: string;
  /** AIG-4: how many items the answer proposed and how many the person used; null until they decide. */
  proposedItems?: number | null; acceptedItems?: number | null;
}
export interface AiPrice { model: string; effectiveFrom: string; inputPerMillion: number; outputPerMillion: number }
/** `decided` runs proposed `proposedItems` in all, of which `acceptedItems` were used; acceptance is null with none decided. */
export interface AiTotals { runs: number; errors: number; inputTokens: number; outputTokens: number; cost: number | null; averageMs: number; decided: number; proposedItems: number; acceptedItems: number; acceptance: number | null }
export interface AiUsageSummary { total: AiTotals; byTask: (AiTotals & { task: AiTask; label: string })[]; byCourse: (AiTotals & { courseId: string | null; label: string })[]; byPerson: (AiTotals & { userId: string | null; label: string })[] }

export const aiTasks: AiTask[] = ["lesson-proposal", "book-map", "lesson-review-explain", "lesson-improve", "write", "rules-to-constraints", "suggest-fields"];
/**
 * AIG-4: the tasks whose answer the person decides on item by item where it is shown. Lesson proposals and the book
 * map are decided later, in the lesson and the map themselves, and are not measured yet.
 */
export const aiDecidedTasks: AiTask[] = ["lesson-improve", "write", "rules-to-constraints", "suggest-fields"];
export const aiTaskLabels: Record<AiTask, string> = {
  "lesson-proposal": "Propuestas de lecciones", "book-map": "Mapa al plan", "lesson-review-explain": "Explicación de la revisión",
  "lesson-improve": "Mejora de lecciones", write: "Redacción", "rules-to-constraints": "Reglas de horario", "suggest-fields": "Campos de documentos",
};

/**
 * AIG-5 (docs/transformacion/ia.md): what each capability does for the institution, where it appears and who decides
 * on what it proposes. The AI proposes; a person decides; nothing is written on its own.
 */
export const aiCapabilities: Record<AiTask, { does: string; where: string; decides: string }> = {
  "lesson-proposal": { does: "Propone borradores de lecciones a partir de los indicadores y del libro confirmado.", where: "Curso › Planificar con IA", decides: "El equipo del curso revisa y publica cada lección." },
  "book-map": { does: "Ubica en el libro las páginas de cada indicador, con la cita que lo respalda.", where: "Curso › Mapa del libro", decides: "El equipo confirma el mapa." },
  "lesson-review-explain": { does: "Explica en palabras la revisión de una lección.", where: "Editor de lecciones › Revisar", decides: "Solo informa: no cambia nada." },
  "lesson-improve": { does: "Propone cambios para lo que la revisión marca como pendiente.", where: "Editor de lecciones › Mejorar con IA", decides: "Quien edita acepta o descarta cada cambio." },
  write: { does: "Redacta, mejora o acorta un texto largo.", where: "«Redactar con IA» bajo los campos de texto", decides: "Quien escribe usa o descarta la propuesta." },
  "rules-to-constraints": { does: "Convierte una regla escrita en una restricción del horario.", where: "Organización › Horarios", decides: "Administración confirma cada regla." },
  "suggest-fields": { does: "Reconoce en un texto los datos que deben ser campos del documento.", where: "Organización › Documentos", decides: "Administración usa o descarta cada campo." },
};

/** The price in force for a model on a day: the latest one that started on or before it. */
export function priceOn(prices: AiPrice[], model: string, day: string): AiPrice | null {
  return prices.filter(price => price.model === model && price.effectiveFrom <= day).sort((a, b) => b.effectiveFrom.localeCompare(a.effectiveFrom))[0] || null;
}

/** A run's cost in USD; 0 for the local fixture, null when its model has no price or its tokens are unknown. */
export function runCost(run: AiRun, prices: AiPrice[]): number | null {
  if (run.generator === "fixture") return 0;
  const price = priceOn(prices, run.model, run.createdAt.slice(0, 10));
  if (!price || run.inputTokens === null || run.outputTokens === null) return null;
  return (run.inputTokens * price.inputPerMillion + run.outputTokens * price.outputPerMillion) / 1_000_000;
}

function totals(runs: AiRun[], prices: AiPrice[]): AiTotals {
  const costs = runs.map(run => runCost(run, prices));
  const decided = runs.filter(run => !!run.proposedItems);
  const proposedItems = decided.reduce((sum, run) => sum + (run.proposedItems || 0), 0), acceptedItems = decided.reduce((sum, run) => sum + (run.acceptedItems || 0), 0);
  return {
    runs: runs.length,
    errors: runs.filter(run => run.status !== "ok").length,
    inputTokens: runs.reduce((sum, run) => sum + (run.inputTokens || 0), 0),
    outputTokens: runs.reduce((sum, run) => sum + (run.outputTokens || 0), 0),
    // A cost that cannot be known makes the total unknown too, rather than silently smaller.
    cost: costs.some(cost => cost === null) ? null : Math.round(costs.reduce<number>((sum, cost) => sum + (cost || 0), 0) * 1_000_000) / 1_000_000,
    averageMs: runs.length ? Math.round(runs.reduce((sum, run) => sum + run.durationMs, 0) / runs.length) : 0,
    decided: decided.length, proposedItems, acceptedItems, acceptance: proposedItems ? Math.round(acceptedItems / proposedItems * 100) / 100 : null,
  };
}
function grouped<K extends string | null>(runs: AiRun[], key: (run: AiRun) => K, label: (run: AiRun) => string, prices: AiPrice[]) {
  const groups = new Map<K, AiRun[]>();
  for (const run of runs) groups.set(key(run), [...(groups.get(key(run)) || []), run]);
  return [...groups.entries()].map(([value, list]) => ({ value, label: label(list[0]), ...totals(list, prices) })).sort((a, b) => b.runs - a.runs || a.label.localeCompare(b.label));
}

/** The month's usage: the total and the same totals by task, by course and by person. */
export function aiUsageSummary(runs: AiRun[], prices: AiPrice[]): AiUsageSummary {
  return {
    total: totals(runs, prices),
    byTask: grouped(runs, run => run.task, run => aiTaskLabels[run.task], prices).map(({ value, ...rest }) => ({ task: value, ...rest })),
    byCourse: grouped(runs, run => run.courseId, run => run.courseTitle || "Sin curso", prices).map(({ value, ...rest }) => ({ courseId: value, ...rest })),
    byPerson: grouped(runs, run => run.userId, run => run.userName || "Proceso automático", prices).map(({ value, ...rest }) => ({ userId: value, ...rest })),
  };
}

/** A price as administration writes it: a model, a date and two amounts in USD per million tokens. */
export function aiPriceInput(value: unknown): AiPrice | { error: string } {
  const input = value && typeof value === "object" ? value as Record<string, unknown> : {};
  const model = typeof input.model === "string" ? input.model.trim() : "";
  if (!model || model.length > 80) return { error: "Escribe el nombre del modelo, de 1 a 80 caracteres." };
  const effectiveFrom = typeof input.effectiveFrom === "string" ? input.effectiveFrom : "";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(effectiveFrom) || Number.isNaN(Date.parse(`${effectiveFrom}T00:00:00Z`))) return { error: "Indica desde qué fecha rige el precio." };
  const amount = (raw: unknown) => typeof raw === "number" ? raw : typeof raw === "string" && raw.trim() ? Number(raw.replace(",", ".")) : NaN;
  const inputPerMillion = amount(input.inputPerMillion), outputPerMillion = amount(input.outputPerMillion);
  if (![inputPerMillion, outputPerMillion].every(price => Number.isFinite(price) && price >= 0 && price <= 1000)) return { error: "Los precios son montos en USD por millón de tokens, de 0 a 1000." };
  return { model, effectiveFrom, inputPerMillion, outputPerMillion };
}

/**
 * AIG-6 (AP-07, docs/transformacion/aprobaciones.md): the organization's AI budget for a month, in USD: so much per
 * active person, never less than a minimum. Past 80 % administration is warned; at 100 % the AI waits for next month.
 * Runs whose cost cannot be known (a model without a price) do not count, and the page says so.
 */
export const aiBudgetPerPersonUsd = 2, aiBudgetMinimumUsd = 20, aiBudgetWarningShare = 0.8;
export interface AiBudget { budget: number; spent: number; unpriced: boolean; level: "ok" | "warning" | "exhausted" }
export function aiBudget(activePeople: number, spent: number, unpriced: boolean, perPerson = aiBudgetPerPersonUsd, minimum = aiBudgetMinimumUsd): AiBudget {
  const budget = Math.max(minimum, perPerson * activePeople);
  return { budget, spent, unpriced, level: spent >= budget ? "exhausted" : spent >= budget * aiBudgetWarningShare ? "warning" : "ok" };
}
