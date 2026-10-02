import type { Material } from "@happy-learners/contracts";

export function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}
export function cleanText(value: unknown, limit: number, required = true): string | null {
  if (typeof value !== "string") return null;
  const text = value.trim().normalize("NFC");
  return (required && !text) || text.length > limit || /[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(text) ? null : text;
}
export function validTermIds(value: unknown): value is string[] {
  return Array.isArray(value) && value.length <= 24 && new Set(value).size === value.length && value.every(id => typeof id === "string" && /^[a-z0-9-]{1,160}$/.test(id));
}
export function materialInput(input: unknown): Pick<Material, "title" | "description" | "content" | "kind" | "status" | "termIds"> | null {
  const v = record(input); if (!v) return null;
  const title = cleanText(v.title, 160), description = cleanText(v.description, 1000), content = cleanText(v.content, 8000);
  if (!title || !description || !content || !["text", "link"].includes(String(v.kind)) || !["draft", "published", "archived"].includes(String(v.status)) || !validTermIds(v.termIds)) return null;
  if (v.kind === "link" && !/^https?:\/\/[^/\s?#@]+(?:[/?#][^\s]*)?$/.test(content)) return null;
  return { title, description, content, kind: v.kind as Material["kind"], status: v.status as Material["status"], termIds: v.termIds };
}
export function completeOrder(value: unknown, ids: string[]): value is string[] {
  return Array.isArray(value) && value.length === ids.length && new Set(value).size === ids.length && value.every(id => ids.includes(id));
}
