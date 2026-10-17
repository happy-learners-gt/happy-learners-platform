/**
 * Regional, appearance and accessibility preferences (ST-160, DEC-045). Every value follows an international standard
 * instead of a local list: interface languages are ISO 639-1 codes, formats are BCP 47 locales the runtime knows, zones
 * are IANA zones and the first day of the week is ISO 8601 (1 Monday … 7 Sunday). A value left empty follows the
 * organization (locale and zone) or the regional format (first day of the week and hour cycle), so nothing is
 * Guatemala-centric except the organization's own default.
 */
import { isTimezone } from "./timezones";
import { zonedInstant } from "./calendar-feed";

/** Languages the interface is written in. Only Spanish today; adding one means translating the app, not this list. */
export const interfaceLanguages = [{ code: "es", label: "Español" }] as const;
export type InterfaceLanguage = typeof interfaceLanguages[number]["code"];

export const homePages = [
  { value: "inicio", label: "Inicio", path: "/inicio" }, { value: "agenda", label: "Agenda", path: "/agenda" },
  { value: "cursos", label: "Cursos", path: "/cursos" }, { value: "biblioteca", label: "Biblioteca", path: "/biblioteca" },
  { value: "horas", label: "Horas", path: "/horas" },
] as const;
export type HomePage = typeof homePages[number]["value"];
export const themes = ["system", "light", "dark"] as const;
export type Theme = typeof themes[number];
export const motions = ["system", "reduce"] as const;
export const densities = ["comfortable", "compact"] as const;
export const hourCycles = ["h12", "h23"] as const;
export type HourCycle = typeof hourCycles[number];
/** Text size, as a percentage of the base size; the screen offers steps of 10. */
export const minTextScale = 100, maxTextScale = 150, textScaleStep = 10;

export interface UserPreferences {
  language: InterfaceLanguage;
  /** BCP 47 locale for dates and numbers; null follows the organization. */
  locale: string | null;
  /** IANA zone; null follows the organization. */
  timezone: string | null;
  /** ISO weekday (1 Monday … 7 Sunday); null follows the regional format. */
  weekStart: number | null;
  /** null follows the regional format. */
  hourCycle: HourCycle | null;
  homePage: HomePage;
  theme: Theme;
  textScale: number;
  highContrast: boolean;
  motion: typeof motions[number];
  density: typeof densities[number];
}
export const defaultPreferences: UserPreferences = {
  language: "es", locale: null, timezone: null, weekStart: null, hourCycle: null, homePage: "inicio",
  theme: "system", textScale: 100, highContrast: false, motion: "system", density: "comfortable",
};

/** A well-formed BCP 47 tag that the runtime can format with; returns its canonical spelling or null. */
export function canonicalLocale(value: unknown): string | null {
  if (typeof value !== "string" || !value.trim() || value.length > 35 || /[^A-Za-z0-9-]/.test(value)) return null;
  try {
    const [tag] = Intl.getCanonicalLocales(value.trim());
    return tag && Intl.DateTimeFormat.supportedLocalesOf([tag]).length ? tag : null;
  } catch { return null; }
}

type LocaleWithWeek = Intl.Locale & { getWeekInfo?: () => { firstDay: number }; weekInfo?: { firstDay: number }; getHourCycles?: () => string[]; hourCycles?: string[] };
/** The first day of the week the locale uses (ISO weekday); Monday when the runtime cannot tell. */
export function localeWeekStart(locale: string): number {
  try {
    const info = new Intl.Locale(locale) as LocaleWithWeek;
    const day = (info.getWeekInfo?.() || info.weekInfo)?.firstDay;
    return Number.isInteger(day) && day! >= 1 && day! <= 7 ? day! : 1;
  } catch { return 1; }
}
/** Whether the locale writes times with a 12-hour clock. */
export function localeHourCycle(locale: string): HourCycle {
  try {
    const cycle = new Intl.DateTimeFormat(locale, { hour: "numeric" }).resolvedOptions().hourCycle;
    return cycle === "h11" || cycle === "h12" ? "h12" : "h23";
  } catch { return "h23"; }
}

export interface EffectivePreferences extends Omit<UserPreferences, "locale" | "timezone" | "weekStart" | "hourCycle"> {
  locale: string; timezone: string; weekStart: number; hourCycle: HourCycle;
  /** What the person chose, so the screen can show «Como la organización». */
  chosen: Pick<UserPreferences, "locale" | "timezone" | "weekStart" | "hourCycle">;
  organization: { locale: string; timezone: string };
}
/** The preferences in force: the person's choices, and for each empty one the organization's or the format's. */
export function effectivePreferences(stored: Partial<UserPreferences> | null | undefined, organization: { locale?: string | null; timezone?: string | null }): EffectivePreferences {
  const own = { ...defaultPreferences, ...Object.fromEntries(Object.entries(stored || {}).filter(([, value]) => value !== undefined)) } as UserPreferences;
  const orgLocale = canonicalLocale(organization.locale) || "es";
  const orgZone = organization.timezone && isTimezone(organization.timezone) ? organization.timezone : "UTC";
  const locale = canonicalLocale(own.locale) || orgLocale;
  const timezone = own.timezone && isTimezone(own.timezone) ? own.timezone : orgZone;
  return {
    ...own, locale, timezone,
    weekStart: own.weekStart && own.weekStart >= 1 && own.weekStart <= 7 ? own.weekStart : localeWeekStart(locale),
    hourCycle: own.hourCycle || localeHourCycle(locale),
    chosen: { locale: own.locale, timezone: own.timezone, weekStart: own.weekStart, hourCycle: own.hourCycle },
    organization: { locale: orgLocale, timezone: orgZone },
  };
}

const oneOf = <T extends string>(list: readonly T[], value: unknown): value is T => typeof value === "string" && (list as readonly string[]).includes(value);
const messages: Record<string, string> = {
  language: "Elige un idioma de la interfaz disponible.", locale: "Elige un formato regional válido (por ejemplo, es-MX o pt-BR).",
  timezone: "Elige una zona horaria válida de la lista.", weekStart: "Elige el primer día de la semana.", hourCycle: "Elige el formato de 12 o 24 horas.",
  homePage: "Elige una página de inicio de la lista.", theme: "Elige el tema claro, oscuro o el del sistema.",
  textScale: `El tamaño del texto va de ${minTextScale} % a ${maxTextScale} %.`, highContrast: "Indica si quieres alto contraste.",
  motion: "Indica si quieres reducir el movimiento.", density: "Elige la densidad cómoda o compacta.",
};
/**
 * A change to some preferences: only the keys sent are validated and returned. `null` resets locale, zone, first day
 * and hour cycle to «automatic». Unknown keys are refused, so a typo never passes silently.
 */
export function userPreferencesInput(value: unknown): { preferences: Partial<UserPreferences> } | { error: string } {
  if (!value || typeof value !== "object" || Array.isArray(value)) return { error: "Envía las preferencias que quieres cambiar." };
  const entries = Object.entries(value as Record<string, unknown>);
  if (!entries.length) return { error: "Envía las preferencias que quieres cambiar." };
  const out: Partial<UserPreferences> = {};
  for (const [key, raw] of entries) {
    switch (key) {
      case "language": if (!interfaceLanguages.some(item => item.code === raw)) return { error: messages[key] }; out.language = raw as InterfaceLanguage; break;
      case "locale": { if (raw === null) { out.locale = null; break; } const tag = canonicalLocale(raw); if (!tag) return { error: messages[key] }; out.locale = tag; break; }
      case "timezone": if (raw !== null && (typeof raw !== "string" || !isTimezone(raw))) return { error: messages[key] }; out.timezone = raw as string | null; break;
      case "weekStart": if (raw !== null && (!Number.isInteger(raw) || (raw as number) < 1 || (raw as number) > 7)) return { error: messages[key] }; out.weekStart = raw as number | null; break;
      case "hourCycle": if (raw !== null && !oneOf(hourCycles, raw)) return { error: messages[key] }; out.hourCycle = raw as HourCycle | null; break;
      case "homePage": if (!homePages.some(item => item.value === raw)) return { error: messages[key] }; out.homePage = raw as HomePage; break;
      case "theme": if (!oneOf(themes, raw)) return { error: messages[key] }; out.theme = raw; break;
      case "textScale": if (!Number.isInteger(raw) || (raw as number) < minTextScale || (raw as number) > maxTextScale) return { error: messages[key] }; out.textScale = raw as number; break;
      case "highContrast": if (typeof raw !== "boolean") return { error: messages[key] }; out.highContrast = raw; break;
      case "motion": if (!oneOf(motions, raw)) return { error: messages[key] }; out.motion = raw; break;
      case "density": if (!oneOf(densities, raw)) return { error: messages[key] }; out.density = raw; break;
      default: return { error: `«${key.slice(0, 40)}» no es una preferencia.` };
    }
  }
  return { preferences: out };
}

/** The organization's regional format: optional in its settings, so older clients that only send name and zone still work. */
export const organizationLocaleInput = (value: unknown) => value === undefined ? undefined : canonicalLocale(value);

/** Calendar day (YYYY-MM-DD) and wall-clock time (HH:MM) of an instant in a zone. */
export function wallClock(instant: Date, zone: string): { day: string; time: string } {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-CA", { timeZone: zone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" })
    .formatToParts(instant).map(part => [part.type, part.value]));
  return { day: `${parts.year}-${parts.month}-${parts.day}`, time: `${parts.hour}:${parts.minute}` };
}
/**
 * A class is stored as a day and a time of the organization's zone (DEC-035); the person sees it in theirs. A class
 * without a time keeps its day.
 */
export function wallTimeIn(day: string, time: string | null | undefined, fromZone: string, toZone: string): { day: string; time: string | null; shifted: boolean } {
  if (!time || fromZone === toZone) return { day, time: time || null, shifted: false };
  const moved = wallClock(zonedInstant(day, time, fromZone), toZone);
  return { ...moved, shifted: moved.day !== day || moved.time !== time };
}

/** The seven weekdays (JavaScript numbering, 0 Sunday) in the order a week shows them, from the person's first day. */
export function orderedWeekdays<T extends readonly [number, ...unknown[]]>(days: readonly T[], weekStart: number): T[] {
  const first = weekStart % 7;
  return [...days].sort((a, b) => ((a[0] - first + 7) % 7) - ((b[0] - first + 7) % 7));
}

/**
 * Formats the screen suggests, written as BCP 47 tags: the Spanish-speaking regions first, then other widely used
 * ones. Any other valid tag the runtime knows is accepted too.
 */
export const suggestedLocales = [
  "es", "es-419", "es-AR", "es-BO", "es-CL", "es-CO", "es-CR", "es-CU", "es-DO", "es-EC", "es-ES", "es-GQ", "es-GT", "es-HN", "es-MX", "es-NI", "es-PA",
  "es-PE", "es-PR", "es-PY", "es-SV", "es-US", "es-UY", "es-VE", "en-US", "en-GB", "en-CA", "en-AU", "en-IN", "pt-BR", "pt-PT", "fr-FR", "fr-CA",
  "de-DE", "it-IT", "nl-NL", "ca-ES", "gl-ES", "eu-ES", "qu-PE", "ja-JP", "ko-KR", "zh-CN", "ar-EG", "hi-IN",
] as const;
