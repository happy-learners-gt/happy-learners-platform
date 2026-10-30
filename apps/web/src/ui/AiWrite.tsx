import { useState } from "react";
import type { WriteAction, WriteField } from "@happy-learners/domain";
import { writeActionLabels } from "@happy-learners/domain";
import { api, message } from "../api";
import { useFeedback } from "./feedback";
import { Icon } from "./icons";

/**
 * «Redactar con IA» (1.4.1, docs/design/asistente-ia.md §6e), under a long text field. It finds the field by its
 * `data-ai-write` attribute (Field gives fields their own ids), reads it and, only when the person chooses «Usar»,
 * writes the proposal into it as typing would (controlled or not), so the form knows it changed. It never replaces
 * the text on its own.
 */
type Context = { course?: string; unit?: string; level?: string; lesson?: string; learner?: string };

function fieldOf(target: string) { return document.querySelector<HTMLInputElement | HTMLTextAreaElement>(`[data-ai-write="${target}"]`); }
function typeInto(element: HTMLInputElement | HTMLTextAreaElement, text: string) {
  const prototype = element instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(prototype, "value")!.set!.call(element, text);
  element.dispatchEvent(new Event("input", { bubbles: true }));
  element.focus();
}

export function AiWrite({ field, target, context = {}, courseId, label }: { field: WriteField; target: string; context?: Context; courseId?: string; label: string }) {
  const { toast } = useFeedback();
  const [proposal, setProposal] = useState<string | null>(null), [busy, setBusy] = useState<WriteAction | null>(null);
  async function ask(action: WriteAction) {
    const text = fieldOf(target)?.value.trim() || "";
    if (action !== "draft" && !text) { toast({ tone: "info", message: "Escribe un texto para mejorarlo o acortarlo." }); return; }
    setBusy(action);
    try { setProposal((await api<{ text: string }>("/ai/write", "POST", { field, action, text, context, ...(courseId ? { courseId } : {}) })).text); }
    catch (cause) { toast({ tone: "error", message: message(cause) }); }
    finally { setBusy(null); }
  }
  return <div className="ai-write">
    <div className="ai-write-actions" role="group" aria-label={`Redactar con IA: ${label}`}>
      <Icon name="sparkles" size={16}/>
      {(Object.keys(writeActionLabels) as WriteAction[]).map(action => <button key={action} type="button" className="button ghost small" disabled={!!busy}
        onClick={() => void ask(action)}>{busy === action ? "Redactando…" : writeActionLabels[action]}</button>)}
    </div>
    {proposal !== null && <div className="ai-write-proposal" role="region" aria-label={`Propuesta para ${label}`}>
      <p>{proposal}</p>
      <div className="ai-write-actions">
        <button type="button" className="button primary small" onClick={() => { const element = fieldOf(target); if (element) typeInto(element, proposal); setProposal(null); }}>Usar</button>
        <button type="button" className="button ghost small" onClick={() => setProposal(null)}>Descartar</button>
      </div>
    </div>}
  </div>;
}
