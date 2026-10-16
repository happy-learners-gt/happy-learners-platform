import type { LegalDocument, LegalKind, PendingDocument } from "@happy-learners/contracts";
import { cleanText, record } from "./courses";

/** The documents each person accepts (ST-126) or consents to (ST-127) before using the platform. */
export const legalKinds: readonly LegalKind[] = ["terms", "privacy"];
export const legalLabels: Record<LegalKind, string> = { terms: "Términos y condiciones", privacy: "Política de privacidad" };
export const isLegalKind = (value: unknown): value is LegalKind => legalKinds.includes(value as LegalKind);

/**
 * A draft as administration writes it: plain text, read as paragraphs, never markup. The privacy policy also needs the
 * consent text each person agrees to; the terms have none.
 */
export function legalDraftInput(kind: LegalKind, value: unknown): Pick<LegalDocument, "title" | "body" | "consent"> | null {
  const v = record(value); if (!v) return null;
  const title = cleanText(v.title, 120), body = typeof v.body === "string" ? v.body.replace(/\r\n?/g, "\n") : null;
  const text = body === null ? null : cleanText(body, 60000);
  if (!title || title.length < 3 || /[<>\n\t]/.test(title) || !text || text.length < 20) return null;
  if (kind === "terms") return v.consent === undefined || v.consent === null || v.consent === "" ? { title, body: text, consent: null } : null;
  const consent = cleanText(v.consent, 1000);
  return consent && consent.length >= 10 && !/[\n<>]/.test(consent) ? { title, body: text, consent } : null;
}

/**
 * What a person still has to accept: the latest published version of each kind, unless they accepted it and have not
 * withdrawn that acceptance. An organization without published versions asks for nothing.
 */
export function pendingDocuments(published: PendingDocument[], inForce: readonly string[]): PendingDocument[] {
  const accepted = new Set(inForce);
  return legalKinds.flatMap(kind => {
    const latest = published.filter(item => item.kind === kind).sort((a, b) => (b.version || 0) - (a.version || 0))[0];
    return latest && !accepted.has(latest.id) ? [latest] : [];
  });
}
