export const timezones = ["America/Guatemala", "America/Mexico_City", "America/Bogota"] as const;
export { courseInput, materialInput, courseProfiles, unitLabels, record, cleanText, validTermIds, completeOrder } from "./courses";
export function organizationInput(value: unknown): { name: string; timezone: string } | null {
  if (!value || typeof value !== "object") return null;
  const { name, timezone } = value as Record<string, unknown>;
  if (typeof name !== "string" || typeof timezone !== "string") return null;
  const clean = name.trim().normalize("NFC");
  if (clean.length < 3 || clean.length > 80 || /[<>\x00-\x1f]/.test(clean)) return null;
  if (!timezones.some(item => item === timezone)) return null;
  return { name: clean, timezone };
}
export function validActivities(input: unknown): boolean {
  if (!Array.isArray(input) || input.length > 30) return false;
  const ids = new Set();
  return input.every((item, position) => {
    if (!item || typeof item !== "object" || typeof item.id !== "string" || !/^[a-zA-Z0-9-]{1,80}$/.test(item.id) || ids.has(item.id) || item.position !== position) return false;
    ids.add(item.id);
    if (!["text", "resource", "question"].includes(item.type) || typeof item.title !== "string" || !item.title.trim() || item.title.length > 160 || typeof item.instructions !== "string" || item.instructions.length > 4000 || (!item.instructions.trim() && !validRichText(item.richContent)) || (item.richContent !== undefined && !validRichText(item.richContent)) || !Number.isInteger(item.minutes) || item.minutes < 1 || item.minutes > 120) return false;
    if (item.type === "resource" && (typeof item.resourceId !== "string" || !item.resourceId)) return false;
    if (item.type === "question" && (!Array.isArray(item.options) || item.options.length < 2 || item.options.length > 6 || item.options.some((o: unknown) => typeof o !== "string" || !o.trim() || o.length > 200) || new Set(item.options).size !== item.options.length || !Number.isInteger(item.answer) || item.answer < 0 || item.answer >= item.options.length)) return false;
    return true;
  });
}
const richNodes = new Set(["doc", "paragraph", "heading", "text", "hardBreak", "bulletList", "orderedList", "listItem", "blockquote"]);
const richMarks = new Set(["bold", "italic", "underline", "strike", "code", "link"]);
export function validRichText(value: unknown): boolean {
  if (!value || typeof value !== "object") return false;
  let textLength = 0, count = 0;
  function visit(item: unknown, depth: number): boolean {
    if (!item || typeof item !== "object" || depth > 8 || ++count > 500) return false;
    const n = item as Record<string, unknown>;
    if (typeof n.type !== "string" || !richNodes.has(n.type)) return false;
    if (n.type === "text") { if (typeof n.text !== "string" || n.content !== undefined) return false; textLength += n.text.length; if (textLength > 12000) return false; }
    if (n.type === "heading" && (!n.attrs || ![2, 3].includes(Number((n.attrs as Record<string, unknown>).level)))) return false;
    if (n.marks !== undefined && (!Array.isArray(n.marks) || n.marks.length > 6 || !n.marks.every(mark => {
      if (!mark || typeof mark !== "object" || !richMarks.has(String((mark as Record<string, unknown>).type))) return false;
      const m = mark as Record<string, unknown>;
      if (m.type !== "link") return true;
      const href = String((m.attrs as Record<string, unknown> | undefined)?.href || "");
      return /^https?:\/\/[^\s/?#@]+(?::\d+)?(?:[/?#]|$)/i.test(href);
    }))) return false;
    return n.content === undefined || (Array.isArray(n.content) && n.content.every(child => visit(child, depth + 1)));
  }
  const root = value as Record<string, unknown>;
  return root.type === "doc" && Array.isArray(root.content) && root.content.every(child => visit(child, 1)) && textLength > 0;
}
