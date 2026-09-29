export const timezones = ["America/Guatemala", "America/Mexico_City", "America/Bogota"] as const;
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
    if (!["text", "resource", "question"].includes(item.type) || typeof item.title !== "string" || !item.title.trim() || item.title.length > 160 || typeof item.instructions !== "string" || !item.instructions.trim() || item.instructions.length > 4000 || !Number.isInteger(item.minutes) || item.minutes < 1 || item.minutes > 120) return false;
    if (item.type === "resource" && (typeof item.resourceId !== "string" || !item.resourceId)) return false;
    if (item.type === "question" && (!Array.isArray(item.options) || item.options.length < 2 || item.options.length > 6 || item.options.some((o: unknown) => typeof o !== "string" || !o.trim() || o.length > 200) || new Set(item.options).size !== item.options.length || !Number.isInteger(item.answer) || item.answer < 0 || item.answer >= item.options.length)) return false;
    return true;
  });
}
