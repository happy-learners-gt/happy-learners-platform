/**
 * Educator profile (ST-149) and staff file (ST-150). Pure rules: what a profile may hold, how availability is written,
 * which document types the staff file accepts and when a document counts as expired or about to expire.
 */
export type Weekday = 1 | 2 | 3 | 4 | 5 | 6 | 7;
export interface AvailabilitySlot { day: Weekday; start: string; end: string }
export interface ProfileInput {
  displayName: string; phone: string | null; contactEmail: string | null; education: string; specialties: string[]; availability: AvailabilitySlot[];
}

export const availabilityDays: { value: Weekday; label: string }[] = [
  { value: 1, label: "Lunes" }, { value: 2, label: "Martes" }, { value: 3, label: "Miércoles" }, { value: 4, label: "Jueves" },
  { value: 5, label: "Viernes" }, { value: 6, label: "Sábado" }, { value: 7, label: "Domingo" },
];
export const maxSpecialties = 12;
export const maxSpecialtyLength = 60;
export const maxEducationLength = 1000;
export const maxAvailabilitySlots = 21;
const time = /^([01][0-9]|2[0-3]):([0-5][0-9])$/;
const emailPattern = /^[a-z0-9._%+-]+@[a-z0-9-]+(\.[a-z0-9-]+)*\.[a-z]{2,}$/;
const unsafe = /[<>\x00-\x08\x0b\x0c\x0e-\x1f]/;

const line = (value: string) => value.trim().replace(/\s+/g, " ").normalize("NFC");

/** A phone number as people write it: digits, spaces, hyphens, parentheses and an optional leading +; 7 to 15 digits. */
export function phoneInput(value: unknown): string | null | undefined {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string") return undefined;
  const text = line(value);
  if (!text) return null;
  const digits = text.replace(/\D/g, "").length;
  return text.length <= 25 && /^\+?[0-9 ()-]+$/.test(text) && digits >= 7 && digits <= 15 ? text : undefined;
}
/** A contact address, which may differ from the sign-in one; stored in lowercase. */
export function contactEmailInput(value: unknown): string | null | undefined {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string") return undefined;
  const text = value.trim().toLowerCase();
  if (!text) return null;
  return text.length <= 254 && emailPattern.test(text) ? text : undefined;
}
/** Weekday time ranges, sorted by day and start; on the same day they may not overlap. */
export function availabilityInput(value: unknown): AvailabilitySlot[] | null {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value) || value.length > maxAvailabilitySlots) return null;
  const slots: AvailabilitySlot[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object") return null;
    const { day, start, end } = item as Record<string, unknown>;
    if (typeof day !== "number" || !Number.isInteger(day) || day < 1 || day > 7 || typeof start !== "string" || typeof end !== "string" || !time.test(start) || !time.test(end) || start >= end) return null;
    slots.push({ day: day as Weekday, start, end });
  }
  slots.sort((a, b) => a.day - b.day || a.start.localeCompare(b.start));
  for (let i = 1; i < slots.length; i++) if (slots[i].day === slots[i - 1].day && slots[i].start < slots[i - 1].end) return null;
  return slots;
}
export function specialtiesInput(value: unknown): string[] | null {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value) || value.length > maxSpecialties) return null;
  const list: string[] = [], seen = new Set<string>();
  for (const item of value) {
    if (typeof item !== "string") return null;
    const text = line(item);
    if (text.length < 2 || text.length > maxSpecialtyLength || unsafe.test(text)) return null;
    const key = text.toLocaleLowerCase("es");
    if (seen.has(key)) return null;
    seen.add(key); list.push(text);
  }
  return list;
}
/** The whole profile a person saves; null when any field is invalid. */
export function staffProfileInput(value: unknown): ProfileInput | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const v = value as Record<string, unknown>;
  if (typeof v.displayName !== "string") return null;
  const displayName = line(v.displayName);
  if (displayName.length < 2 || displayName.length > 80 || unsafe.test(displayName)) return null;
  const phone = phoneInput(v.phone), contactEmail = contactEmailInput(v.contactEmail);
  if (phone === undefined || contactEmail === undefined) return null;
  if (v.education !== undefined && v.education !== null && typeof v.education !== "string") return null;
  const education = typeof v.education === "string" ? v.education.trim().normalize("NFC") : "";
  if (education.length > maxEducationLength || /[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(education)) return null;
  const specialties = specialtiesInput(v.specialties), availability = availabilityInput(v.availability);
  if (!specialties || !availability) return null;
  return { displayName, phone, contactEmail, education, specialties, availability };
}

/** Document types of the staff file, in the order administration sees them. */
export const staffDocumentTypes = [
  { value: "dpi", label: "Identificación (DPI)" },
  { value: "cv", label: "Hoja de vida" },
  { value: "criminal-record", label: "Antecedentes penales" },
  { value: "police-record", label: "Antecedentes policíacos" },
  { value: "studies", label: "Constancia de estudios" },
  { value: "certificate", label: "Certificado" },
  { value: "other", label: "Otro" },
] as const;
export type StaffDocumentType = typeof staffDocumentTypes[number]["value"];
export const staffDocumentLabel = (type: string) => staffDocumentTypes.find(item => item.value === type)?.label || "Documento";
/** Days before its expiry date in which a document counts as "por vencer". */
export const expiringWindowDays = 30;
export type StaffDocumentStatus = "valid" | "expiring" | "expired";

const day = /^(\d{4})-(\d{2})-(\d{2})$/;
export function calendarDate(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const match = day.exec(value);
  if (!match) return null;
  const [year, month, date] = match.slice(1).map(Number), check = new Date(Date.UTC(year, month - 1, date));
  return year >= 1950 && year <= 2200 && check.getUTCFullYear() === year && check.getUTCMonth() === month - 1 && check.getUTCDate() === date ? value : null;
}
const addDays = (value: string, days: number) => new Date(Date.parse(`${value}T00:00:00Z`) + days * 86400000).toISOString().slice(0, 10);
/** Expired the day after its expiry date; "por vencer" from 30 days before it; without expiry it stays valid. */
export function documentStatus(expiresOn: string | null | undefined, today: string): StaffDocumentStatus {
  if (!expiresOn) return "valid";
  if (expiresOn < today) return "expired";
  return expiresOn <= addDays(today, expiringWindowDays) ? "expiring" : "valid";
}
/** Metadata administration (or the person) gives a document: type, title, issue date and optional expiry date. */
export function staffDocumentInput(value: { type?: unknown; title?: unknown; issuedOn?: unknown; expiresOn?: unknown }, today: string): { type: StaffDocumentType; title: string; issuedOn: string; expiresOn: string | null } | null {
  const type = staffDocumentTypes.find(item => item.value === value.type)?.value;
  if (!type) return null;
  const title = typeof value.title === "string" && value.title.trim() ? line(value.title) : staffDocumentLabel(type);
  if (title.length < 1 || title.length > 120 || unsafe.test(title)) return null;
  const issuedOn = calendarDate(value.issuedOn);
  if (!issuedOn || issuedOn > today) return null;
  const expiresOn = value.expiresOn === undefined || value.expiresOn === null || value.expiresOn === "" ? null : calendarDate(value.expiresOn);
  if (expiresOn === null && value.expiresOn !== undefined && value.expiresOn !== null && value.expiresOn !== "") return null;
  if (expiresOn && expiresOn < issuedOn) return null;
  return { type, title, issuedOn, expiresOn };
}
