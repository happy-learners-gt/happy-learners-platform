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
