import type { CompensationKind, CompensationPeriod, Contract, ContractEngagement, ContractPhase, ContractSignatureRecord, ContractStatus, ContractTermField, ContractTerms, RichTextDocument, RichTextNode, WorkLocation } from "@happy-learners/contracts";
import { cleanText, record } from "./courses";
import { canonicalJson, signedNameInput } from "./legal";
import { calendarDate } from "./profiles";
import { validRichText } from "./index";

/**
 * DEC-046: contracts agnostic to the kind of engagement. A template fixes the engagement and the clauses; its terms
 * (role, compensation, term, hours, notice…) have defaults and administration may change the editable ones in each
 * contract. Volunteer work is never paid; employment and services always are. Everything else is the organization's
 * choice, so the same model serves a school in Guatemala, a tutoring network or an NGO anywhere.
 */
export const contractEngagements: readonly ContractEngagement[] = ["employment", "services", "volunteer", "internship", "other"];
export const engagementLabels: Record<ContractEngagement, string> = {
  employment: "Relación laboral", services: "Prestación de servicios", volunteer: "Voluntariado ad honorem", internship: "Prácticas", other: "Otro acuerdo",
};
export const compensationKinds: readonly CompensationKind[] = ["none", "fixed", "hourly", "per-session"];
export const compensationLabels: Record<CompensationKind, string> = { none: "Sin remuneración", fixed: "Monto fijo por periodo", hourly: "Por hora", "per-session": "Por clase impartida" };
export const compensationPeriods: readonly CompensationPeriod[] = ["month", "biweekly", "week"];
export const periodLabels: Record<CompensationPeriod, string> = { month: "mensual", biweekly: "quincenal", week: "semanal" };
export const workLocations: readonly WorkLocation[] = ["onsite", "remote", "hybrid"];
export const locationLabels: Record<WorkLocation, string> = { onsite: "Presencial", remote: "En línea", hybrid: "Híbrida" };
export const contractTermFields: readonly ContractTermField[] = ["role", "compensation", "term", "weeklyHours", "noticeDays", "probationDays", "location", "notes"];
export const contractStatusLabels: Record<ContractStatus, string> = {
  draft: "Borrador", sent: "Enviado", active: "Firmado", declined: "Rechazado", voided: "Anulado", terminated: "Terminado", superseded: "Reemplazado",
};
export const contractPhaseLabels: Record<ContractPhase, string> = {
  draft: "Borrador", "awaiting-signature": "Pendiente de firma", scheduled: "Firmado, empieza después", "in-force": "Vigente", ending: "Vigente hasta su terminación",
  expired: "Vencido", declined: "Rechazado", voided: "Anulado", terminated: "Terminado", superseded: "Reemplazado",
};
export const isEngagement = (value: unknown): value is ContractEngagement => contractEngagements.includes(value as ContractEngagement);
/** Contracts are long: up to 100,000 characters and 6,000 nodes of rich text. */
export const contractTextLimits = { text: 100000, nodes: 6000 };
export const maxCloseReason = 500;
const currencyPattern = /^[A-Z]{3}$/, amountPattern = /^(?:0|[1-9]\d{0,8})(?:\.\d{1,2})?$/;

/** Engagement rules: who is paid follows from the engagement, not from a free choice that could contradict it. */
export function compensationAllowed(engagement: ContractEngagement, kind: CompensationKind): boolean {
  if (engagement === "volunteer") return kind === "none";
  if (engagement === "employment" || engagement === "services") return kind !== "none";
  return true;
}

export function contractTemplateInput(value: unknown): { name: string; engagement: ContractEngagement; description: string } | null {
  const v = record(value); if (!v) return null;
  const name = cleanText(v.name, 120), description = v.description === undefined ? "" : cleanText(v.description, 500, false);
  if (!name || name.length < 3 || /[<>\n\t]/.test(name) || description === null || !isEngagement(v.engagement)) return null;
  return { name, engagement: v.engagement, description };
}

/** Validates complete terms for an engagement; optional fields left out stay out. */
export function contractTermsInput(engagement: ContractEngagement, value: unknown): ContractTerms | null {
  const v = record(value); if (!v) return null;
  const role = cleanText(v.role, 120);
  const pay = record(v.compensation), term = record(v.term);
  if (!role || /[<>\n\t]/.test(role) || !pay || !term) return null;
  const kind = pay.kind as CompensationKind;
  if (!compensationKinds.includes(kind) || !compensationAllowed(engagement, kind)) return null;
  const compensation: ContractTerms["compensation"] = { kind };
  if (kind !== "none") {
    if (typeof pay.amount !== "string" || !amountPattern.test(pay.amount) || Number(pay.amount) <= 0) return null;
    if (typeof pay.currency !== "string" || !currencyPattern.test(pay.currency)) return null;
    compensation.amount = pay.amount; compensation.currency = pay.currency;
    if (kind === "fixed") { if (!compensationPeriods.includes(pay.period as CompensationPeriod)) return null; compensation.period = pay.period as CompensationPeriod; }
  }
  if (term.kind !== "indefinite" && term.kind !== "fixed") return null;
  const terms: ContractTerms = { role, compensation, term: { kind: term.kind } };
  if (term.kind === "fixed" && term.months !== undefined) { if (!Number.isInteger(term.months) || Number(term.months) < 1 || Number(term.months) > 120) return null; terms.term.months = Number(term.months); }
  const whole = (key: "weeklyHours" | "noticeDays" | "probationDays", max: number) => {
    if (v[key] === undefined || v[key] === null) return true;
    if (!Number.isInteger(v[key]) || Number(v[key]) < 0 || Number(v[key]) > max) return false;
    terms[key] = Number(v[key]); return true;
  };
  if (!whole("weeklyHours", 80) || !whole("noticeDays", 365) || !whole("probationDays", 365)) return null;
  if (v.location !== undefined && v.location !== null) { if (!workLocations.includes(v.location as WorkLocation)) return null; terms.location = v.location as WorkLocation; }
  if (v.notes !== undefined && v.notes !== null && v.notes !== "") { const notes = cleanText(v.notes, 1000); if (!notes) return null; terms.notes = notes; }
  return terms;
}

/**
 * A template version as administration writes it: title, rich-text clauses, default terms that fit the engagement,
 * the editable fields and, optionally, the date from which it applies to new contracts.
 */
export function contractVersionInput(engagement: ContractEngagement, value: unknown) {
  const v = record(value); if (!v) return null;
  const title = cleanText(v.title, 160);
  if (!title || title.length < 3 || /[<>\n\t]/.test(title) || !validRichText(v.body, contractTextLimits)) return null;
  const body = v.body as RichTextDocument, text = richPlainText(body);
  if (text.length < 20) return null;
  const defaults = contractTermsInput(engagement, v.defaults);
  if (!defaults || !Array.isArray(v.editable) || v.editable.length > contractTermFields.length || !v.editable.every(field => contractTermFields.includes(field as ContractTermField))) return null;
  const effectiveFrom = v.effectiveFrom === undefined || v.effectiveFrom === null || v.effectiveFrom === "" ? null : calendarDate(v.effectiveFrom);
  if (effectiveFrom === null && v.effectiveFrom) return null;
  return { title, body, bodyText: text, defaults, editable: [...new Set(v.editable as ContractTermField[])], effectiveFrom };
}

/** The terms of one contract: the template's defaults, changed only where the template allows, then validated whole. */
export function contractTermsFor(engagement: ContractEngagement, defaults: ContractTerms, editable: readonly ContractTermField[], changes: unknown): ContractTerms | null {
  const c = changes === undefined || changes === null ? {} : record(changes);
  if (!c) return null;
  if (Object.keys(c).some(key => !editable.includes(key as ContractTermField))) return null;
  return contractTermsInput(engagement, { ...defaults, ...c });
}

/** Start and end dates: a fixed term needs its end; an indefinite one has none. */
export function contractDatesInput(terms: ContractTerms, value: unknown): { startDate: string; endDate: string | null } | null {
  const v = record(value); if (!v) return null;
  const startDate = calendarDate(v.startDate);
  if (!startDate) return null;
  if (terms.term.kind === "indefinite") return v.endDate === undefined || v.endDate === null || v.endDate === "" ? { startDate, endDate: null } : null;
  const endDate = v.endDate ? calendarDate(v.endDate) : terms.term.months ? addMonths(startDate, terms.term.months) : null;
  return endDate && endDate >= startDate ? { startDate, endDate } : null;
}
function addMonths(date: string, months: number): string {
  const [y, m, d] = date.split("-").map(Number);
  const target = new Date(Date.UTC(y, m - 1 + months, 1));
  const last = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(d, last)); target.setUTCDate(target.getUTCDate() - 1);
  return target.toISOString().slice(0, 10);
}

/** «$ 1,500.00 GTQ mensual», «Sin remuneración (ad honorem)»: the compensation as people read it. */
export function compensationSummary(terms: ContractTerms, locale = "es"): string {
  const pay = terms.compensation;
  if (pay.kind === "none") return "Sin remuneración (ad honorem)";
  const amount = new Intl.NumberFormat(locale, { style: "currency", currency: pay.currency!, currencyDisplay: "code" }).format(Number(pay.amount));
  return pay.kind === "fixed" ? `${amount} ${periodLabels[pay.period!]}` : pay.kind === "hourly" ? `${amount} por hora` : `${amount} por clase impartida`;
}

/**
 * Placeholders the clauses may use, such as {{persona.nombre}}. Sending a contract writes their values into its own
 * copy, so the signed text is exactly what the person read.
 */
export const contractVariables = [
  "persona.nombre", "persona.correo", "organizacion.nombre", "contrato.tipo", "contrato.puesto", "contrato.inicio", "contrato.fin",
  "contrato.remuneracion", "contrato.horas_semanales", "contrato.preaviso", "contrato.periodo_prueba", "contrato.modalidad",
] as const;
export type ContractVariable = typeof contractVariables[number];
export function contractValues(input: { partyName: string; partyEmail: string | null; organization: string; engagement: ContractEngagement; terms: ContractTerms; startDate: string; endDate: string | null; formatDate: (date: string) => string }): Record<ContractVariable, string> {
  const { terms } = input;
  return {
    "persona.nombre": input.partyName, "persona.correo": input.partyEmail || "—", "organizacion.nombre": input.organization,
    "contrato.tipo": engagementLabels[input.engagement], "contrato.puesto": terms.role,
    "contrato.inicio": input.formatDate(input.startDate), "contrato.fin": input.endDate ? input.formatDate(input.endDate) : "plazo indefinido",
    "contrato.remuneracion": compensationSummary(terms), "contrato.horas_semanales": terms.weeklyHours === undefined ? "—" : `${terms.weeklyHours} horas`,
    "contrato.preaviso": terms.noticeDays === undefined ? "—" : `${terms.noticeDays} días`, "contrato.periodo_prueba": terms.probationDays === undefined ? "—" : `${terms.probationDays} días`,
    "contrato.modalidad": terms.location ? locationLabels[terms.location] : "—",
  };
}
export function mergeContract(body: RichTextDocument, values: Record<string, string>): RichTextDocument {
  const fill = (text: string) => text.replace(/\{\{\s*([a-z_.]+)\s*\}\}/g, (match, key: string) => key in values ? values[key] : match);
  const visit = (node: RichTextNode): RichTextNode => ({ ...node, ...(typeof node.text === "string" ? { text: fill(node.text) } : {}), ...(node.content ? { content: node.content.map(visit) } : {}) });
  return { type: "doc", content: body.content.map(visit) };
}
/** The text of a rich-text document: blocks separated by a blank line, table cells by a tab. */
export function richPlainText(body: RichTextDocument): string {
  const block = (node: RichTextNode): string => {
    if (typeof node.text === "string") return node.text;
    if (node.type === "hardBreak") return "\n";
    const children = node.content || [];
    if (node.type === "tableRow") return children.map(block).join("\t");
    if (["bulletList", "orderedList", "table", "blockquote", "listItem"].includes(node.type)) return children.map(block).join("\n");
    return children.map(block).join("");
  };
  return body.content.map(block).map(text => text.trim()).filter(Boolean).join("\n\n");
}

/** What the document fingerprint covers: who agrees with whom, on which text and terms, from when until when. */
export function contractCanonical(contract: { id: string; organizationId: string; templateVersionId: string; engagement: ContractEngagement; title: string; bodyText: string; terms: ContractTerms; partyName: string; partyEmail: string | null; startDate: string; endDate: string | null }): string {
  return canonicalJson({ ...contract, endDate: contract.endDate ?? "indefinite", partyEmail: contract.partyEmail ?? "" });
}
export function contractSignatureCanonical(signature: ContractSignatureRecord): string {
  return canonicalJson(signature);
}
export { signedNameInput as contractSignedNameInput };
export function closeReasonInput(value: unknown, required: boolean): string | null | undefined {
  if (value === undefined || value === null || value === "") return required ? undefined : null;
  const reason = cleanText(value, maxCloseReason);
  return reason || undefined;
}

/** Where a contract stands on a given day, from its stored status and its dates. */
export function contractPhase(contract: Pick<Contract, "status" | "startDate" | "endDate" | "terminationDate">, today: string): ContractPhase {
  switch (contract.status) {
    case "draft": return "draft";
    case "sent": return "awaiting-signature";
    case "active":
      if (contract.endDate && contract.endDate < today) return "expired";
      return contract.startDate > today ? "scheduled" : "in-force";
    case "terminated": return contract.terminationDate && contract.terminationDate >= today && contract.startDate <= today ? "ending" : "terminated";
    default: return contract.status;
  }
}
/** In force on a day: signed by both, started, and not yet ended, expired nor superseded. */
export const contractInForce = (contract: Pick<Contract, "status" | "startDate" | "endDate" | "terminationDate">, today: string) =>
  ["in-force", "ending"].includes(contractPhase(contract, today));

/**
 * CON-01 (docs/transformacion/auditoria.md): Contratos opens on what waits for administration. These phases are
 * counted above the list and come first in it, in this order; the rest follow by how current they are.
 */
export const contractAttentionPhases = ["awaiting-signature", "ending", "draft"] as const satisfies readonly ContractPhase[];
export const contractAttentionLabels: Record<(typeof contractAttentionPhases)[number], string> = { "awaiting-signature": "Esperan firma", ending: "Por terminar", draft: "Por enviar" };
const attentionRank: Record<ContractPhase, number> = {
  "awaiting-signature": 0, ending: 1, draft: 2, scheduled: 3, "in-force": 4, expired: 5, terminated: 6, declined: 7, voided: 8, superseded: 9,
};
/** The contracts in the order administration works on them: waiting first, then the newest, then by name. */
export function contractsByAttention<T extends Pick<Contract, "phase" | "startDate" | "partyName">>(contracts: T[]): T[] {
  return [...contracts].sort((a, b) => attentionRank[a.phase] - attentionRank[b.phase] || b.startDate.localeCompare(a.startDate) || a.partyName.localeCompare(b.partyName, "es"));
}
