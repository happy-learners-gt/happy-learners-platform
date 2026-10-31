/**
 * Panel minutes (1.5.1, docs/design/constructor-de-reportes.md §4): when a panel has marked a student, its members sign
 * the minutes with their name and password (ST-153). The minutes freeze what each member marked and the combined
 * result; the document's fingerprint covers that, and each signature covers the fingerprint. The chair signs last.
 */
export interface MinuteEvaluator { userId: string; name: string; chair: boolean; mark: string }
export interface MinuteContent {
  minuteId: string; organizationId: string; activityId: string; activityTitle: string; points: number;
  courseTitle: string; sectionName: string; periodName: string; learnerId: string; learnerName: string;
  combine: string; result: string; evaluators: MinuteEvaluator[];
}
export interface MinuteSignature { minuteId: string; userId: string; username: string; signedName: string; documentSha256: string; signedAt: string }

/** Keys in a fixed order at every level, so the same content always gives the same text and the same fingerprint. */
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.keys(value as Record<string, unknown>).sort().map(key => `${JSON.stringify(key)}:${canonical((value as Record<string, unknown>)[key])}`).join(",")}}`;
  return JSON.stringify(value);
}
/** What the minutes' fingerprint covers: the activity, the student, each member's mark (in a fixed order) and the result. */
export const minuteCanonical = (content: MinuteContent) => canonical({ ...content, evaluators: [...content.evaluators].sort((a, b) => a.userId.localeCompare(b.userId)) });
export const minuteSignatureCanonical = (signature: MinuteSignature) => canonical(signature);

export const combineLabels: Record<string, string> = { average: "Promedio de los integrantes", majority: "Mayoría", chair: "Decide quien preside" };

/**
 * Whether this member may sign now: members sign in any order; the chair signs when every other member has signed.
 * Returns the reason when not.
 */
export function signingProblem(content: MinuteContent, signed: string[], userId: string): string | null {
  const member = content.evaluators.find(item => item.userId === userId);
  if (!member) return "Solo los integrantes del tribunal firman su acta.";
  if (signed.includes(userId)) return "Ya firmaste esta acta.";
  const others = content.evaluators.filter(item => !item.chair && !signed.includes(item.userId));
  if (member.chair && others.length) return `Quien preside firma al final: faltan ${others.length === 1 ? "1 integrante" : `${others.length} integrantes`}.`;
  return null;
}
/** The minutes are closed when every member has signed. */
export const minuteClosed = (content: MinuteContent, signed: string[]) => content.evaluators.every(item => signed.includes(item.userId));
