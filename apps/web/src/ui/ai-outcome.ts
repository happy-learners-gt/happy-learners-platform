import { api } from "../api";

/**
 * AIG-4 (docs/transformacion/ia.md): once the person has decided on every item of an AI answer, the harness learns how
 * many it proposed and how many were used. Counts only; it never blocks nor reports an error to the person.
 */
export function reportAiOutcome(runId: string | undefined, proposed: number, accepted: number) {
  if (!runId || proposed < 1) return;
  void api(`/ai/runs/${runId}/outcome`, "POST", { proposed, accepted: Math.min(accepted, proposed) }).catch(() => undefined);
}
