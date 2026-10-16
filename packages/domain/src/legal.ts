import type { LegalDocument, LegalKind, PendingDocument, SignatureRecord } from "@happy-learners/contracts";
import { cleanText, record } from "./courses";

/**
 * Every kind of legal document: the terms (ST-126) and the privacy policy (ST-127), which each person accepts before
 * using the platform, and the volunteer agreement (ST-151), which whoever teaches signs before teaching a class.
 */
export const legalKinds: readonly LegalKind[] = ["terms", "privacy", "volunteer"];
/** The kinds that close the whole platform until they are accepted. */
export const gatedKinds: readonly LegalKind[] = ["terms", "privacy"];
/** The kinds accepted with an electronic signature (ST-153); the privacy consent stays a simple consent. */
export const signedKinds: readonly LegalKind[] = ["terms", "volunteer"];
export const legalLabels: Record<LegalKind, string> = { terms: "Términos y condiciones", privacy: "Política de privacidad", volunteer: "Acuerdo de voluntariado ad honorem" };
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
  if (kind !== "privacy") return v.consent === undefined || v.consent === null || v.consent === "" ? { title, body: text, consent: null } : null;
  const consent = cleanText(v.consent, 1000);
  return consent && consent.length >= 10 && !/[\n<>]/.test(consent) ? { title, body: text, consent } : null;
}

/**
 * What a person still has to accept: the latest published version of each kind, unless they accepted it and have not
 * withdrawn that acceptance. An organization without published versions asks for nothing.
 */
export function pendingDocuments(published: PendingDocument[], inForce: readonly string[]): PendingDocument[] {
  const accepted = new Set(inForce);
  return gatedKinds.flatMap(kind => latestPending(published, accepted, kind));
}
/** The volunteer agreement in force while the person has not signed it (ST-151); null without a published version. */
export function pendingAgreement(published: PendingDocument[], inForce: readonly string[]): PendingDocument | null {
  return latestPending(published, new Set(inForce), "volunteer")[0] || null;
}
function latestPending(published: PendingDocument[], accepted: Set<string>, kind: LegalKind): PendingDocument[] {
  const latest = published.filter(item => item.kind === kind).sort((a, b) => (b.version || 0) - (a.version || 0))[0];
  return latest && !accepted.has(latest.id) ? [latest] : [];
}

/** The full name a person types to sign (ST-153): kept as typed, once trimmed; 3 to 120 characters, one line, no markup. */
export function signedNameInput(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const name = value.trim();
  return name.length >= 3 && name.length <= 120 && !/[<>\n\r\t]/.test(name) && /\p{L}/u.test(name) ? name : null;
}

/**
 * Canonical JSON: object keys sorted at every level, no spaces, strings escaped as JSON does. The same data gives the
 * same text whatever the order of its keys, so its SHA-256 is a stable fingerprint; any changed character changes it.
 */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") {
    if (typeof value === "number" && !Number.isFinite(value)) throw new Error("Only finite numbers have a canonical form");
    if (value === undefined || typeof value === "function" || typeof value === "symbol" || typeof value === "bigint") throw new Error("Unsupported value");
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>).filter(([, item]) => item !== undefined).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0);
  return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`).join(",")}}`;
}

/** What the document fingerprint covers: the exact published version, as stored. */
export function documentCanonical(document: { kind: LegalKind; version: number; title: string; body: string; publishedAt: string }): string {
  return canonicalJson({ kind: document.kind, version: document.version, title: document.title, body: document.body, publishedAt: document.publishedAt });
}
/** What the signature fingerprint covers: who signed, as whom, which version with which fingerprint, and when. */
export function signatureCanonical(record: SignatureRecord): string {
  return canonicalJson({
    signatureId: record.signatureId, organizationId: record.organizationId, userId: record.userId, username: record.username, signedName: record.signedName,
    documentId: record.documentId, kind: record.kind, version: record.version, documentSha256: record.documentSha256, signedAt: record.signedAt,
  });
}
