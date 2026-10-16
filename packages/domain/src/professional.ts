import type {
  CredentialState, CredentialStatus, CredentialType, IscedLevel, LanguageProficiency, LearnerAudience, ProfessionalProfile, ProfileCompleteness,
  ProfileLink, ProfileLinkKind, ProfileSection, ProfileStatus, ProfileVisibility, ProfileVisibilityLevel, TeachingArea,
  TeachingFormat, TeachingModality,
} from "@happy-learners/contracts";
import { isTimezone } from "./timezones";

/**
 * Professional profile (ST-154), credentials (ST-155), publication (ST-156) and who sees what (ST-157), DEC-045.
 * Pure rules: what a profile and a credential may hold, how complete a profile is, which transitions each state allows
 * and which sections reach each audience. International standards instead of local lists, so the same model serves any
 * subject, any level and any country.
 */

/** ISCED 2011 levels, plus adult and continuing education and vocational training, which cut across them. */
export const iscedLevels: { value: IscedLevel; label: string; short: string }[] = [
  { value: "0", short: "Primera infancia", label: "CINE 0 · Educación de la primera infancia" },
  { value: "1", short: "Primaria", label: "CINE 1 · Educación primaria" },
  { value: "2", short: "Secundaria baja", label: "CINE 2 · Educación secundaria baja" },
  { value: "3", short: "Secundaria alta", label: "CINE 3 · Educación secundaria alta" },
  { value: "4", short: "Postsecundaria", label: "CINE 4 · Postsecundaria no terciaria" },
  { value: "5", short: "Terciaria de ciclo corto", label: "CINE 5 · Terciaria de ciclo corto" },
  { value: "6", short: "Grado", label: "CINE 6 · Grado o nivel equivalente" },
  { value: "7", short: "Maestría", label: "CINE 7 · Maestría o nivel equivalente" },
  { value: "8", short: "Doctorado", label: "CINE 8 · Doctorado o nivel equivalente" },
  { value: "adult", short: "Adultos", label: "Personas adultas y formación continua" },
  { value: "vocational", short: "Formación profesional", label: "Formación profesional y técnica" },
];
/** ISCED-F 2013 broad fields: suggestions to classify an open teaching area, never a closed list of subjects. */
export const iscedFields: { value: string; label: string }[] = [
  { value: "00", label: "Programas y certificaciones genéricos" },
  { value: "01", label: "Educación" },
  { value: "02", label: "Artes y humanidades" },
  { value: "03", label: "Ciencias sociales, periodismo e información" },
  { value: "04", label: "Administración de empresas y derecho" },
  { value: "05", label: "Ciencias naturales, matemáticas y estadística" },
  { value: "06", label: "Tecnologías de la información y la comunicación" },
  { value: "07", label: "Ingeniería, industria y construcción" },
  { value: "08", label: "Agricultura, silvicultura, pesca y veterinaria" },
  { value: "09", label: "Salud y bienestar" },
  { value: "10", label: "Servicios" },
];
/** Language proficiency on a CEFR-like scale; for languages without CEFR the descriptor is the equivalent. */
export const proficiencyLevels: { value: LanguageProficiency; label: string; descriptor: string }[] = [
  { value: "native", label: "Nativo o bilingüe", descriptor: "Lengua materna o dominio equivalente" },
  { value: "C2", label: "C2 · Maestría", descriptor: "Comprende y se expresa con precisión en cualquier situación" },
  { value: "C1", label: "C1 · Dominio operativo eficaz", descriptor: "Se expresa con fluidez en contextos académicos y profesionales" },
  { value: "B2", label: "B2 · Avanzado", descriptor: "Conversa con soltura sobre temas generales y de su campo" },
  { value: "B1", label: "B1 · Umbral", descriptor: "Se desenvuelve en situaciones habituales" },
  { value: "A2", label: "A2 · Plataforma", descriptor: "Comunica lo básico en situaciones conocidas" },
  { value: "A1", label: "A1 · Acceso", descriptor: "Usa expresiones sencillas y cotidianas" },
];
export const teachingModalities: { value: TeachingModality; label: string }[] = [
  { value: "in_person", label: "Presencial" }, { value: "online", label: "En línea" }, { value: "hybrid", label: "Híbrida" },
];
export const teachingFormats: { value: TeachingFormat; label: string }[] = [
  { value: "one_to_one", label: "Individual" }, { value: "group", label: "Grupal" }, { value: "self_paced", label: "A tu ritmo" },
];
export const learnerAudiences: { value: LearnerAudience; label: string }[] = [
  { value: "children", label: "Niñez" }, { value: "adolescents", label: "Adolescencia" }, { value: "adults", label: "Personas adultas" },
  { value: "special_needs", label: "Necesidades educativas específicas" },
];
export const profileLinkKinds: { value: ProfileLinkKind; label: string }[] = [
  { value: "website", label: "Sitio web" }, { value: "linkedin", label: "LinkedIn" }, { value: "orcid", label: "ORCID" }, { value: "other", label: "Otro enlace" },
];
export const credentialTypes: { value: CredentialType; label: string }[] = [
  { value: "degree", label: "Título académico" },
  { value: "certification", label: "Certificación" },
  { value: "teaching_license", label: "Licencia o colegiatura docente" },
  { value: "language_certificate", label: "Acreditación de idioma" },
  { value: "other", label: "Otra credencial" },
];
export const credentialTypeLabel = (type: string) => credentialTypes.find(item => item.value === type)?.label || "Credencial";
export const credentialStatusLabels: Record<CredentialStatus, string> = { draft: "Borrador", submitted: "En verificación", verified: "Verificada", rejected: "Rechazada", withdrawn: "Retirada", expired: "Vencida" };
export const profileStatusLabels: Record<ProfileStatus, string> = { draft: "Borrador", in_review: "En revisión", changes_requested: "Cambios solicitados", published: "Publicado", hidden: "Oculto" };

export const profileSections: { value: ProfileSection; label: string; levels: ProfileVisibilityLevel[] }[] = [
  { value: "identity", label: "Identidad", levels: ["organization", "learners"] },
  { value: "about", label: "Sobre mí", levels: ["private", "organization", "learners"] },
  { value: "languages", label: "Idiomas", levels: ["private", "organization", "learners"] },
  { value: "teaching", label: "Enseñanza", levels: ["private", "organization", "learners"] },
  { value: "career", label: "Trayectoria", levels: ["private", "organization", "learners"] },
  { value: "links", label: "Enlaces profesionales", levels: ["private", "organization", "learners"] },
  { value: "credentials", label: "Credenciales verificadas", levels: ["private", "organization", "learners"] },
  // Availability and contact data never reach students (DEC-043).
  { value: "availability", label: "Disponibilidad", levels: ["private", "organization"] },
  { value: "contact", label: "Teléfono y correo de contacto", levels: ["private", "organization"] },
];
export const visibilityLabels: Record<ProfileVisibilityLevel, string> = { private: "Solo administración y yo", organization: "Equipo de la organización", learners: "Equipo y estudiantes de mis secciones" };
export const defaultVisibility: ProfileVisibility = {
  identity: "learners", about: "learners", languages: "learners", teaching: "learners", career: "organization", links: "organization",
  credentials: "learners", availability: "organization", contact: "private",
};

/** ISO 3166-1 alpha-2: every officially assigned code. Names come from the runtime (Intl.DisplayNames) in the interface. */
export const countryCodes: readonly string[] = ("AD AE AF AG AI AL AM AO AQ AR AS AT AU AW AX AZ BA BB BD BE BF BG BH BI BJ BL BM BN BO BQ BR BS BT BV BW BY BZ CA CC CD CF CG CH CI CK CL CM CN CO CR CU CV CW CX CY CZ " +
  "DE DJ DK DM DO DZ EC EE EG EH ER ES ET FI FJ FK FM FO FR GA GB GD GE GF GG GH GI GL GM GN GP GQ GR GS GT GU GW GY HK HM HN HR HT HU ID IE IL IM IN IO IQ IR IS IT JE JM JO JP KE KG KH KI KM KN KP KR KW KY KZ " +
  "LA LB LC LI LK LR LS LT LU LV LY MA MC MD ME MF MG MH MK ML MM MN MO MP MQ MR MS MT MU MV MW MX MY MZ NA NC NE NF NG NI NL NO NP NR NU NZ OM PA PE PF PG PH PK PL PM PN PR PS PT PW PY QA RE RO RS RU RW " +
  "SA SB SC SD SE SG SH SI SJ SK SL SM SN SO SR SS ST SV SX SY SZ TC TD TF TG TH TJ TK TL TM TN TO TR TT TV TW TZ UA UG UM US UY UZ VA VC VE VG VI VN VU WF WS YE YT ZA ZM ZW").split(" ");
const countrySet = new Set(countryCodes);
export const isCountry = (value: unknown): value is string => typeof value === "string" && countrySet.has(value);
/**
 * A BCP 47 language tag in its canonical casing: a 2-3 letter ISO 639 language, an optional script (Latn) and an
 * optional region (GT, 419). Enough for "es", "es-419", "pt-BR", "zh-Hant", "quc" or "sgn-GT".
 */
export const languageTagPattern = /^[a-z]{2,3}(-[A-Z][a-z]{3})?(-([A-Z]{2}|[0-9]{3}))?$/;
export function languageTag(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const parts = value.trim().replace(/_/g, "-").split("-");
  if (!parts[0] || parts.length > 3) return null;
  const tag = parts.map((part, index) => index === 0 ? part.toLowerCase() : part.length === 4 ? part[0].toUpperCase() + part.slice(1).toLowerCase() : part.toUpperCase()).join("-");
  return languageTagPattern.test(tag) ? tag : null;
}

export const profileLimits = {
  preferredName: 80, pronouns: 30, headline: 120, city: 80, bio: 2000, approach: 1500, languages: 10, areas: 12, areaLabel: 60,
  experience: 20, education: 15, links: 8, description: 600, institution: 160, role: 120, degree: 160, field: 120, url: 500, experienceYears: 70,
} as const;

const controls = /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/;
const unsafeLine = /[<>\x00-\x1f\x7f]/;
const line = (value: string) => value.trim().replace(/\s+/g, " ").normalize("NFC");
const block = (value: string) => value.replace(/\r\n?/g, "\n").trim().replace(/\n{3,}/g, "\n\n").normalize("NFC");
const month = /^(\d{4})-(0[1-9]|1[0-2])$/;

export function emptyProfessionalProfile(): ProfessionalProfile {
  return { preferredName: "", pronouns: "", headline: "", country: null, city: "", timezone: null, bio: "", approach: "", videoUrl: null, languages: [], areas: [], levels: [], modalities: [], formats: [], audiences: [], experienceYears: null, experience: [], education: [], links: [] };
}
/** A stored working copy or publication, with every field present (older copies may lack the newer ones). */
export function storedProfile(value: unknown): ProfessionalProfile {
  const base = emptyProfessionalProfile();
  if (!value || typeof value !== "object" || Array.isArray(value)) return base;
  const out = { ...base } as Record<string, unknown>;
  for (const [key, empty] of Object.entries(base)) {
    const stored = (value as Record<string, unknown>)[key];
    if (stored !== undefined && (Array.isArray(empty) ? Array.isArray(stored) : true)) out[key] = stored;
  }
  return out as unknown as ProfessionalProfile;
}
export function storedVisibility(value: unknown): ProfileVisibility {
  const out = { ...defaultVisibility };
  if (!value || typeof value !== "object") return out;
  for (const section of profileSections) {
    const level = (value as Record<string, unknown>)[section.value];
    if (typeof level === "string" && (section.levels as string[]).includes(level)) out[section.value] = level as ProfileVisibilityLevel;
  }
  return out;
}

/**
 * An https address with a host name, no credentials and no spaces, of at most 500 characters; the host is written in
 * lowercase. Parsed with a pattern so the rule is the same in the Worker, the browser and the tests.
 */
const urlPattern = /^https:\/\/([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+)(:\d{1,5})?([/?#][^\s]*)?$/i;
type ParsedUrl = { host: string; path: string; query: Record<string, string>; href: string };
function parseUrl(value: unknown): ParsedUrl | null {
  if (typeof value !== "string") return null;
  const text = value.trim(), match = urlPattern.exec(text);
  if (!match || text.length > profileLimits.url || /[<>"\\^`{|}]/.test(text)) return null;
  const host = match[1].toLowerCase(), rest = match[3] || "", [beforeHash] = rest.split("#"), [path = "", search = ""] = beforeHash.split("?");
  const query: Record<string, string> = {};
  for (const pair of search.split("&").filter(Boolean)) { const [key, item = ""] = pair.split("="); query[key] = item; }
  return { host, path: path || "/", query, href: `https://${host}${match[2] || ""}${rest || "/"}` };
}
export function httpsUrl(value: unknown): string | null {
  return parseUrl(value)?.href || null;
}
const hostIs = (url: string, domain: string) => { const host = parseUrl(url)?.host || ""; return host === domain || host.endsWith(`.${domain}`); };
/** ORCID iD check digit (ISO 7064 MOD 11-2). */
export function validOrcid(id: string) {
  if (!/^\d{4}-\d{4}-\d{4}-\d{3}[\dX]$/.test(id)) return false;
  const digits = id.replace(/-/g, "");
  let total = 0;
  for (const digit of digits.slice(0, 15)) total = (total + Number(digit)) * 2;
  const result = (12 - (total % 11)) % 11;
  return digits[15] === (result === 10 ? "X" : String(result));
}
/** A professional link, checked by kind: LinkedIn addresses on linkedin.com and ORCID iDs with a valid check digit. */
export function profileLinkInput(value: unknown): ProfileLink | null {
  if (!value || typeof value !== "object") return null;
  const { kind, url } = value as Record<string, unknown>;
  if (!profileLinkKinds.some(item => item.value === kind)) return null;
  if (kind === "orcid" && typeof url === "string" && /^\d{4}-\d{4}-\d{4}-\d{3}[\dXx]$/.test(url.trim())) return validOrcid(url.trim().toUpperCase()) ? { kind, url: `https://orcid.org/${url.trim().toUpperCase()}` } : null;
  const clean = httpsUrl(url);
  if (!clean) return null;
  if (kind === "linkedin" && !hostIs(clean, "linkedin.com")) return null;
  if (kind === "orcid") {
    const match = /^https:\/\/orcid\.org\/(\d{4}-\d{4}-\d{4}-\d{3}[\dX])\/?$/.exec(clean);
    if (!match || !validOrcid(match[1])) return null;
    return { kind, url: `https://orcid.org/${match[1]}` };
  }
  return { kind: kind as ProfileLinkKind, url: clean };
}
/**
 * The presentation video: a YouTube or Vimeo address, written as the canonical watch link. Videos are never hosted
 * by the platform; the interface opens them on their site.
 */
export function videoUrlInput(value: unknown): string | null | undefined {
  if (value === undefined || value === null || value === "") return null;
  const url = parseUrl(value);
  if (!url) return undefined;
  const host = url.host.replace(/^(www\.|m\.)/, ""), segments = url.path.split("/").filter(Boolean);
  const youtube = /^[A-Za-z0-9_-]{11}$/;
  if (host === "youtube.com" || host === "youtube-nocookie.com") {
    const id = url.path === "/watch" ? url.query.v : ["embed", "shorts", "live"].includes(segments[0]) ? segments[1] : undefined;
    return id && youtube.test(id) ? `https://www.youtube.com/watch?v=${id}` : undefined;
  }
  if (host === "youtu.be") return segments[0] && youtube.test(segments[0]) ? `https://www.youtube.com/watch?v=${segments[0]}` : undefined;
  if (host === "vimeo.com" || host === "player.vimeo.com") {
    const match = /^\/(?:video\/)?(\d{6,12})\/?$/.exec(url.path);
    return match ? `https://vimeo.com/${match[1]}` : undefined;
  }
  return undefined;
}

type Errors = Record<string, string>;
function text(errors: Errors, key: string, value: unknown, max: number, label: string, multiline = false): string {
  if (value === undefined || value === null) return "";
  if (typeof value !== "string") { errors[key] = `${label}: escribe un texto.`; return ""; }
  const clean = multiline ? block(value) : line(value);
  if (clean.length > max) errors[key] = `${label}: hasta ${max.toLocaleString("es")} caracteres.`;
  else if ((multiline ? controls : unsafeLine).test(clean)) errors[key] = `${label}: quita los caracteres especiales${multiline ? "" : " como < y >"}.`;
  return clean;
}
function subset<T extends string>(errors: Errors, key: string, value: unknown, allowed: { value: T }[], label: string): T[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value) || value.some(item => !allowed.some(option => option.value === item))) { errors[key] = `${label}: elige opciones de la lista.`; return []; }
  // Kept in the catalog's order, once each.
  return allowed.map(option => option.value).filter(option => (value as unknown[]).includes(option));
}
function country(errors: Errors, key: string, value: unknown): string | null {
  if (value === undefined || value === null || value === "") return null;
  const code = typeof value === "string" ? value.trim().toUpperCase() : "";
  if (!isCountry(code)) { errors[key] = "Elige un país de la lista."; return null; }
  return code;
}

/**
 * The professional profile a person saves (ST-154): each field normalized, or the errors by field path
 * ("headline", "languages.1.code", …) so the form can show them next to each control.
 */
export function professionalProfileInput(value: unknown, now = new Date()): { value: ProfessionalProfile } | { errors: Errors } {
  const errors: Errors = {};
  if (!value || typeof value !== "object" || Array.isArray(value)) return { errors: { profile: "Envía el perfil completo." } };
  const v = value as Record<string, unknown>;
  const profile = emptyProfessionalProfile();
  profile.preferredName = text(errors, "preferredName", v.preferredName, profileLimits.preferredName, "Nombre preferido");
  profile.pronouns = text(errors, "pronouns", v.pronouns, profileLimits.pronouns, "Pronombres");
  profile.headline = text(errors, "headline", v.headline, profileLimits.headline, "Titular");
  profile.country = country(errors, "country", v.country);
  profile.city = text(errors, "city", v.city, profileLimits.city, "Ciudad");
  if (v.timezone !== undefined && v.timezone !== null && v.timezone !== "") {
    if (typeof v.timezone !== "string" || !isTimezone(v.timezone)) errors.timezone = "Elige una zona horaria de la lista.";
    else profile.timezone = v.timezone;
  }
  profile.bio = text(errors, "bio", v.bio, profileLimits.bio, "Biografía", true);
  profile.approach = text(errors, "approach", v.approach, profileLimits.approach, "Enfoque de enseñanza", true);
  const video = videoUrlInput(v.videoUrl);
  if (video === undefined) errors.videoUrl = "Pega el enlace de un video de YouTube o Vimeo (https).";
  else profile.videoUrl = video;

  if (v.languages !== undefined && v.languages !== null) {
    if (!Array.isArray(v.languages) || v.languages.length > profileLimits.languages) errors.languages = `Indica hasta ${profileLimits.languages} idiomas.`;
    else v.languages.forEach((item, index) => {
      const entry = (item || {}) as Record<string, unknown>, code = languageTag(entry.code);
      if (!code) { errors[`languages.${index}.code`] = "Elige un idioma de la lista o escribe su código (por ejemplo es, en, quc o pt-BR)."; return; }
      if (profile.languages.some(other => other.code === code)) { errors[`languages.${index}.code`] = "Este idioma ya está en la lista."; return; }
      if (!proficiencyLevels.some(level => level.value === entry.proficiency)) { errors[`languages.${index}.proficiency`] = "Elige tu dominio del idioma."; return; }
      profile.languages.push({ code, proficiency: entry.proficiency as LanguageProficiency, teaches: entry.teaches === true });
    });
  }
  if (v.areas !== undefined && v.areas !== null) {
    if (!Array.isArray(v.areas) || v.areas.length > profileLimits.areas) errors.areas = `Indica hasta ${profileLimits.areas} áreas.`;
    else v.areas.forEach((item, index) => {
      const entry = (typeof item === "string" ? { label: item } : item || {}) as Record<string, unknown>;
      const label = typeof entry.label === "string" ? line(entry.label) : "";
      if (label.length < 2 || label.length > profileLimits.areaLabel || unsafeLine.test(label)) { errors[`areas.${index}.label`] = `Cada área tiene de 2 a ${profileLimits.areaLabel} caracteres.`; return; }
      if (profile.areas.some(other => other.label.toLocaleLowerCase("es") === label.toLocaleLowerCase("es"))) { errors[`areas.${index}.label`] = `«${label}» ya está en tus áreas.`; return; }
      const field = entry.field === undefined || entry.field === null || entry.field === "" ? null : String(entry.field);
      if (field !== null && !iscedFields.some(option => option.value === field)) { errors[`areas.${index}.field`] = "Elige un campo de la lista."; return; }
      profile.areas.push({ label, field });
    });
  }
  profile.levels = subset(errors, "levels", v.levels, iscedLevels, "Niveles");
  profile.modalities = subset(errors, "modalities", v.modalities, teachingModalities, "Modalidades");
  profile.formats = subset(errors, "formats", v.formats, teachingFormats, "Formatos");
  profile.audiences = subset(errors, "audiences", v.audiences, learnerAudiences, "Públicos");
  if (v.experienceYears !== undefined && v.experienceYears !== null && v.experienceYears !== "") {
    const years = Number(v.experienceYears);
    if (!Number.isInteger(years) || years < 0 || years > profileLimits.experienceYears) errors.experienceYears = `Escribe los años completos, de 0 a ${profileLimits.experienceYears}.`;
    else profile.experienceYears = years;
  }

  const thisMonth = now.toISOString().slice(0, 7), thisYear = now.getUTCFullYear();
  if (v.experience !== undefined && v.experience !== null) {
    if (!Array.isArray(v.experience) || v.experience.length > profileLimits.experience) errors.experience = `Agrega hasta ${profileLimits.experience} experiencias.`;
    else v.experience.forEach((item, index) => {
      const entry = (item || {}) as Record<string, unknown>, key = `experience.${index}`, before = Object.keys(errors).length;
      const role = text(errors, `${key}.role`, entry.role, profileLimits.role, "Cargo"), institution = text(errors, `${key}.institution`, entry.institution, profileLimits.institution, "Institución");
      if (role.length < 2) errors[`${key}.role`] ||= "Escribe el cargo.";
      if (institution.length < 2) errors[`${key}.institution`] ||= "Escribe la institución.";
      const from = typeof entry.from === "string" && month.test(entry.from) && entry.from <= thisMonth ? entry.from : null;
      if (!from) errors[`${key}.from`] = "Indica el mes de inicio, que no sea futuro.";
      const to = entry.to === undefined || entry.to === null || entry.to === "" ? null : typeof entry.to === "string" && month.test(entry.to) ? entry.to : undefined;
      if (to === undefined || (to && from && (to < from || to > thisMonth))) errors[`${key}.to`] = "El fin va después del inicio y no es futuro; déjalo vacío si es tu cargo actual.";
      const description = text(errors, `${key}.description`, entry.description, profileLimits.description, "Descripción", true);
      const place = country(errors, `${key}.country`, entry.country);
      if (Object.keys(errors).length === before) profile.experience.push({ role, institution, country: place, from: from!, to: to ?? null, description });
    });
    // Current positions first, then the most recent.
    profile.experience.sort((a, b) => (a.to === null ? 0 : 1) - (b.to === null ? 0 : 1) || (b.to || "").localeCompare(a.to || "") || b.from.localeCompare(a.from));
  }
  if (v.education !== undefined && v.education !== null) {
    if (!Array.isArray(v.education) || v.education.length > profileLimits.education) errors.education = `Agrega hasta ${profileLimits.education} estudios.`;
    else v.education.forEach((item, index) => {
      const entry = (item || {}) as Record<string, unknown>, key = `education.${index}`, before = Object.keys(errors).length;
      const degree = text(errors, `${key}.degree`, entry.degree, profileLimits.degree, "Título"), institution = text(errors, `${key}.institution`, entry.institution, profileLimits.institution, "Institución");
      if (degree.length < 2) errors[`${key}.degree`] ||= "Escribe el título o programa.";
      if (institution.length < 2) errors[`${key}.institution`] ||= "Escribe la institución.";
      const field = text(errors, `${key}.field`, entry.field, profileLimits.field, "Campo de estudio");
      let year: number | null = null;
      if (entry.year !== undefined && entry.year !== null && entry.year !== "") {
        year = Number(entry.year);
        // Up to six years ahead: a programme in progress shows its expected year.
        if (!Number.isInteger(year) || year < 1940 || year > thisYear + 6) errors[`${key}.year`] = `Escribe un año entre 1940 y ${thisYear + 6}.`;
      }
      const place = country(errors, `${key}.country`, entry.country);
      if (Object.keys(errors).length === before) profile.education.push({ degree, institution, country: place, year, field });
    });
    profile.education.sort((a, b) => (b.year ?? 9999) - (a.year ?? 9999));
  }
  if (v.links !== undefined && v.links !== null) {
    if (!Array.isArray(v.links) || v.links.length > profileLimits.links) errors.links = `Agrega hasta ${profileLimits.links} enlaces.`;
    else v.links.forEach((item, index) => {
      const link = profileLinkInput(item);
      if (!link) { errors[`links.${index}.url`] = (item as Record<string, unknown> | null)?.kind === "orcid" ? "Escribe tu iD de ORCID (0000-0000-0000-0000) o su dirección https://orcid.org/…" : (item as Record<string, unknown> | null)?.kind === "linkedin" ? "Pega la dirección https de tu perfil en linkedin.com." : "Escribe una dirección que empiece con https://"; return; }
      if (profile.links.some(other => other.url === link.url)) { errors[`links.${index}.url`] = "Este enlace ya está en la lista."; return; }
      profile.links.push(link);
    });
  }
  return Object.keys(errors).length ? { errors } : { value: profile };
}

/** The visibility a person chooses for each section; anything not given keeps its default. */
export function visibilityInput(value: unknown): ProfileVisibility | null {
  if (value === undefined || value === null) return { ...defaultVisibility };
  if (typeof value !== "object" || Array.isArray(value)) return null;
  const out = { ...defaultVisibility };
  for (const [key, level] of Object.entries(value as Record<string, unknown>)) {
    const section = profileSections.find(item => item.value === key);
    if (!section || typeof level !== "string" || !(section.levels as string[]).includes(level)) return null;
    out[section.value] = level as ProfileVisibilityLevel;
  }
  return out;
}

/** What a profile must hold before it is sent for review (ST-156): a headline, a biography, a language, an area and a level. */
export function submissionGaps(profile: ProfessionalProfile): string[] {
  const gaps: string[] = [];
  if (!profile.headline) gaps.push("un titular");
  if (!profile.bio) gaps.push("una biografía");
  if (!profile.languages.length) gaps.push("al menos un idioma");
  if (!profile.areas.length) gaps.push("al menos un área de enseñanza");
  if (!profile.levels.length) gaps.push("al menos un nivel educativo");
  return gaps;
}
/**
 * How complete a profile is, LinkedIn/italki style: the share of steps done and the list of what is missing,
 * each step pointing to the section where it is done.
 */
export function profileCompleteness(profile: ProfessionalProfile, facts: { photo: boolean; credentials: number }): ProfileCompleteness {
  const steps: ProfileCompleteness["steps"] = [
    { key: "photo", label: "Sube una foto", section: "photo", done: facts.photo },
    { key: "headline", label: "Escribe tu titular", section: "identity", done: !!profile.headline },
    { key: "location", label: "Indica tu país y tu zona horaria", section: "identity", done: !!profile.country && !!profile.timezone },
    { key: "bio", label: "Cuenta quién eres en tu biografía (50 caracteres o más)", section: "about", done: profile.bio.length >= 50 },
    { key: "approach", label: "Describe tu enfoque de enseñanza", section: "about", done: !!profile.approach },
    { key: "languages", label: "Agrega un idioma en el que enseñas", section: "languages", done: profile.languages.some(item => item.teaches) },
    { key: "areas", label: "Indica qué áreas enseñas", section: "teaching", done: profile.areas.length > 0 },
    { key: "levels", label: "Indica los niveles educativos que atiendes", section: "teaching", done: profile.levels.length > 0 },
    { key: "modalities", label: "Indica tus modalidades y formatos", section: "teaching", done: profile.modalities.length > 0 && profile.formats.length > 0 },
    { key: "experience", label: "Agrega tu experiencia docente", section: "career", done: profile.experience.length > 0 || profile.experienceYears !== null },
    { key: "education", label: "Agrega tu formación", section: "career", done: profile.education.length > 0 },
    { key: "credentials", label: "Envía una credencial a verificación", section: "credentials", done: facts.credentials > 0 },
  ];
  return { percent: Math.round(100 * steps.filter(step => step.done).length / steps.length), steps };
}

/** Fields of each section, to say which sections a new version changes. */
const sectionFields: [ProfileSection, (keyof ProfessionalProfile)[]][] = [
  ["identity", ["preferredName", "pronouns", "headline", "country", "city", "timezone"]],
  ["about", ["bio", "approach", "videoUrl"]],
  ["languages", ["languages"]],
  ["teaching", ["areas", "levels", "modalities", "formats", "audiences", "experienceYears"]],
  ["career", ["experience", "education"]],
  ["links", ["links"]],
];
export const sectionLabel = (section: string) => profileSections.find(item => item.value === section)?.label || section;
/** The sections where two versions differ, by their labels (activity summaries and the review queue never carry values). */
export function profileChanges(before: ProfessionalProfile | null, after: ProfessionalProfile): string[] {
  const empty = emptyProfessionalProfile(), a = before || empty;
  return sectionFields.filter(([, fields]) => fields.some(field => JSON.stringify(a[field] ?? empty[field]) !== JSON.stringify(after[field] ?? empty[field]))).map(([section]) => sectionLabel(section));
}
export const sameProfile = (a: ProfessionalProfile, b: ProfessionalProfile) => profileChanges(a, b).length === 0;

/** Whether a section reaches an audience: the team sees `organization` and `learners`; students only `learners`. */
export function reaches(visibility: ProfileVisibility, section: ProfileSection, audience: "organization" | "learners") {
  const level = visibility[section];
  return audience === "organization" ? level !== "private" : level === "learners";
}
/** The sections an audience sees, and the profile with every other section emptied: nothing else leaves the server. */
export function audienceView(profile: ProfessionalProfile, visibility: ProfileVisibility, audience: "organization" | "learners"): { sections: ProfileSection[]; content: ProfessionalProfile } {
  const sections = profileSections.map(item => item.value).filter(section => reaches(visibility, section, audience));
  const empty = emptyProfessionalProfile(), content = { ...empty } as Record<string, unknown>;
  for (const [section, fields] of sectionFields) if (sections.includes(section)) for (const field of fields) content[field] = profile[field];
  return { sections, content: content as unknown as ProfessionalProfile };
}

export type ProfileAction = "submit" | "approve" | "request_changes" | "hide" | "show" | "leave";
export type ProfileActor = "self" | "admin" | "system";
export interface ProfileState { status: ProfileStatus; hiddenBy: ProfileActor | null; openReview: boolean }
/**
 * The publication state machine of ST-156. Sending a published (or hidden) profile keeps it as it is: the new
 * version waits for approval while the published one stays visible. Without required review, sending publishes.
 * `publishes` says when the transition makes the sent version the published one.
 */
export function profileTransition(state: ProfileState, action: ProfileAction, context: { actor: ProfileActor; reviewRequired: boolean }):
  { status: ProfileStatus; hiddenBy: ProfileActor | null; publishes: boolean } | { error: string } {
  const { status, hiddenBy } = state, published = status === "published" || status === "hidden";
  switch (action) {
    case "submit":
      if (context.actor !== "self") return { error: "Solo la propia persona envía su perfil." };
      if (!context.reviewRequired) return { status: status === "hidden" ? "hidden" : "published", hiddenBy: status === "hidden" ? hiddenBy : null, publishes: true };
      return { status: published ? status : "in_review", hiddenBy, publishes: false };
    case "approve":
      if (context.actor !== "admin") return { error: "Solo administración aprueba perfiles." };
      if (!state.openReview) return { error: "Este perfil no tiene una versión en revisión." };
      return { status: status === "hidden" ? "hidden" : "published", hiddenBy: status === "hidden" ? hiddenBy : null, publishes: true };
    case "request_changes":
      if (context.actor !== "admin") return { error: "Solo administración pide cambios en los perfiles." };
      if (!state.openReview) return { error: "Este perfil no tiene una versión en revisión." };
      return { status: published ? status : "changes_requested", hiddenBy, publishes: false };
    case "hide":
      if (status !== "published") return { error: status === "hidden" ? "El perfil ya está oculto." : "Solo se oculta un perfil publicado." };
      return { status: "hidden", hiddenBy: context.actor, publishes: false };
    case "show":
      if (status !== "hidden") return { error: "El perfil no está oculto." };
      if (hiddenBy === "admin" && context.actor !== "admin") return { error: "Administración ocultó tu perfil; pídele que lo vuelva a mostrar." };
      return { status: "published", hiddenBy: null, publishes: false };
    case "leave":
      // Leaving (ST-123) or losing access hides a published profile and closes a first review.
      return status === "published" ? { status: "hidden", hiddenBy: "system", publishes: false } : { status: published ? status : "draft", hiddenBy, publishes: false };
  }
}

/** ST-155: a credential as the person writes it; null fields are optional. */
export interface CredentialInput { type: CredentialType; name: string; issuer: string; country: string | null; issuedOn: string; expiresOn: string | null; credentialCode: string | null; verificationUrl: string | null; documentId: string | null }
const day = /^(\d{4})-(\d{2})-(\d{2})$/;
function date(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const match = day.exec(value);
  if (!match) return null;
  const [y, m, d] = match.slice(1).map(Number), check = new Date(Date.UTC(y, m - 1, d));
  return y >= 1940 && y <= 2200 && check.getUTCMonth() === m - 1 && check.getUTCDate() === d ? value : null;
}
export function credentialInput(value: unknown, today: string): { value: CredentialInput } | { errors: Errors } {
  const errors: Errors = {};
  if (!value || typeof value !== "object" || Array.isArray(value)) return { errors: { credential: "Envía los datos de la credencial." } };
  const v = value as Record<string, unknown>;
  const type = credentialTypes.find(item => item.value === v.type)?.value;
  if (!type) errors.type = "Elige el tipo de credencial.";
  const name = text(errors, "name", v.name, 160, "Nombre"), issuer = text(errors, "issuer", v.issuer, 160, "Emisor");
  if (name.length < 2) errors.name ||= "Escribe el nombre de la credencial.";
  if (issuer.length < 2) errors.issuer ||= "Escribe quién la emitió.";
  const place = country(errors, "country", v.country);
  const issuedOn = date(v.issuedOn);
  if (!issuedOn || issuedOn > today) errors.issuedOn = "Indica la fecha de emisión; no puede ser futura.";
  const expiresOn = v.expiresOn === undefined || v.expiresOn === null || v.expiresOn === "" ? null : date(v.expiresOn);
  if (expiresOn === null && v.expiresOn !== undefined && v.expiresOn !== null && v.expiresOn !== "") errors.expiresOn = "Escribe una fecha válida.";
  else if (expiresOn && issuedOn && expiresOn < issuedOn) errors.expiresOn = "El vencimiento va después de la emisión.";
  const credentialCode = text(errors, "credentialCode", v.credentialCode, 100, "Identificador") || null;
  let verificationUrl: string | null = null;
  if (v.verificationUrl !== undefined && v.verificationUrl !== null && v.verificationUrl !== "") {
    verificationUrl = httpsUrl(v.verificationUrl);
    if (!verificationUrl) errors.verificationUrl = "Escribe una dirección que empiece con https://";
  }
  const documentId = v.documentId === undefined || v.documentId === null || v.documentId === "" ? null : typeof v.documentId === "string" && /^[a-z0-9-]{1,100}$/.test(v.documentId) ? v.documentId : undefined;
  if (documentId === undefined) errors.documentId = "Elige un documento de tu expediente.";
  if (Object.keys(errors).length) return { errors };
  return { value: { type: type!, name, issuer, country: place, issuedOn: issuedOn!, expiresOn, credentialCode, verificationUrl, documentId: documentId ?? null } };
}
/** The status shown: a verified credential counts as expired from the day after its expiry date. */
export function credentialStatus(state: CredentialState, expiresOn: string | null, today: string): CredentialStatus {
  return state === "verified" && expiresOn && expiresOn < today ? "expired" : state;
}
export type CredentialAction = "edit" | "submit" | "verify" | "reject" | "withdraw";
/** ST-155 transitions; editing what was sent, verified or rejected returns it to draft. */
export function credentialTransition(state: CredentialState, action: CredentialAction, actor: "self" | "admin"): CredentialState | { error: string } {
  if (state === "withdrawn") return { error: "La credencial está retirada." };
  switch (action) {
    case "edit": return actor === "self" ? "draft" : { error: "Solo la propia persona edita sus credenciales." };
    case "submit": return actor !== "self" ? { error: "Solo la propia persona envía sus credenciales." } : state === "draft" ? "submitted" : { error: state === "submitted" ? "La credencial ya está en verificación." : "Edita la credencial antes de enviarla de nuevo." };
    case "verify": case "reject":
      if (actor !== "admin") return { error: "Solo administración verifica credenciales." };
      return state === "submitted" ? (action === "verify" ? "verified" : "rejected") : { error: "Solo se verifica o rechaza una credencial enviada." };
    case "withdraw": return actor === "self" ? "withdrawn" : { error: "Solo la propia persona retira sus credenciales." };
  }
}
/** A reason of 5 to 500 characters, for asking for changes or rejecting a credential. */
export function decisionNote(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const clean = block(value);
  return clean.length >= 5 && clean.length <= 500 && !controls.test(clean) ? clean : null;
}

/** Display helpers shared by the interface: names in Spanish from the runtime, codes when it does not know them. */
export function languageName(code: string, locale = "es") {
  try { const name = new Intl.DisplayNames([locale], { type: "language" }).of(code); return name && name !== code ? name[0].toLocaleUpperCase(locale) + name.slice(1) : code; } catch { return code; }
}
export function countryName(code: string | null | undefined, locale = "es") {
  if (!code) return "";
  try { return new Intl.DisplayNames([locale], { type: "region" }).of(code) || code; } catch { return code; }
}
export const levelLabel = (value: string) => iscedLevels.find(item => item.value === value)?.short || value;
export const fieldLabel = (value: string | null) => iscedFields.find(item => item.value === value)?.label || "";
export const proficiencyLabel = (value: string) => proficiencyLevels.find(item => item.value === value)?.label || value;
export const modalityLabel = (value: string) => teachingModalities.find(item => item.value === value)?.label || value;
export const formatLabel = (value: string) => teachingFormats.find(item => item.value === value)?.label || value;
export const audienceLabel = (value: string) => learnerAudiences.find(item => item.value === value)?.label || value;
export const linkKindLabel = (value: string) => profileLinkKinds.find(item => item.value === value)?.label || value;

/** Areas of ST-149 specialties and back: the specialty list is the labels of the areas. */
export function areasFromSpecialties(specialties: string[], current: TeachingArea[]): TeachingArea[] {
  return specialties.map(label => current.find(area => area.label.toLocaleLowerCase("es") === label.toLocaleLowerCase("es")) || { label, field: null });
}
