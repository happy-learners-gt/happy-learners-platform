/**
 * Departures (ST-123). The date a person left is a real calendar day (AAAA-MM-DD), not after the organization's
 * today; the reason is an optional short note for administration.
 */
export const maxDepartureReason = 300;
const day = /^(\d{4})-(\d{2})-(\d{2})$/;

export function departureDate(value: unknown, today: string): string | null {
  if (typeof value !== "string") return null;
  const match = day.exec(value);
  if (!match) return null;
  const [year, month, date] = match.slice(1).map(Number), check = new Date(Date.UTC(year, month - 1, date));
  if (year < 2000 || check.getUTCFullYear() !== year || check.getUTCMonth() !== month - 1 || check.getUTCDate() !== date) return null;
  return value <= today ? value : null;
}

/** The trimmed reason ("" when there is none), or null when it is too long or has markup or control characters. */
export function departureReason(value: unknown): string | null {
  if (value === undefined || value === null) return "";
  if (typeof value !== "string") return null;
  const text = value.trim().replace(/\s+/g, " ").normalize("NFC");
  return text.length <= maxDepartureReason && !/[<>\x00-\x1f]/.test(text) ? text : null;
}
