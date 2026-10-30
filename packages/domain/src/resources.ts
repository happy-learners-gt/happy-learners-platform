/**
 * A course resource is one item of the library with a record that fits its type (1.3.7). The bibliography is the
 * resources that have a role. APA 7 is computed; a handwritten citation is the exception and stays marked.
 */

export const resourceTypes = ["book", "chapter", "article", "guide", "standard", "score", "video", "dataset", "case", "template", "rubric", "website", "other"] as const;
export type ResourceType = (typeof resourceTypes)[number];
export const resourceKinds = ["file", "link", "text", "reference"] as const;
export type ResourceKind = (typeof resourceKinds)[number];
export const resourceRoles = ["primary", "required", "recommended", "support"] as const;
export type ResourceRole = (typeof resourceRoles)[number];
export const resourceLicenses = ["reserved", "cc-by", "cc-by-sa", "cc-by-nc", "public-domain", "internal"] as const;
export type ResourceLicense = (typeof resourceLicenses)[number];
export const resourceRoleLabel: Record<ResourceRole, string> = {
  primary: "Texto principal",
  required: "Obligatoria",
  recommended: "Recomendada",
  support: "Apoyo docente",
};
export const resourceTypeLabel: Record<ResourceType, string> = {
  book: "Libro", chapter: "Capítulo de libro", article: "Artículo", guide: "Guía docente", standard: "Norma",
  score: "Partitura", video: "Video", dataset: "Dataset", case: "Caso", template: "Plantilla", rubric: "Rúbrica",
  website: "Sitio web", other: "Otro",
};

export type ResourceAuthor = { kind: "person"; family: string; given: string } | { kind: "institution"; name: string };
export type ResourceMetadata = Record<string, string | number | null>;
export type CitationResource = {
  type: ResourceType;
  title: string;
  authors: ResourceAuthor[];
  year: number | null;
  metadata: ResourceMetadata;
  citationOverride?: string | null;
};

export type ResourceField = { key: string; label: string };
const fields: Record<ResourceType, ResourceField[]> = {
  book: [{ key: "edition", label: "Edición" }, { key: "publisher", label: "Editorial" }, { key: "place", label: "Lugar" }, { key: "isbn", label: "ISBN" }, { key: "pages", label: "Páginas" }],
  chapter: [{ key: "book", label: "Libro" }, { key: "editors", label: "Editores" }, { key: "pages", label: "Páginas del capítulo" }, { key: "publisher", label: "Editorial" }, { key: "isbn", label: "ISBN" }],
  article: [{ key: "journal", label: "Revista" }, { key: "volume", label: "Volumen" }, { key: "issue", label: "Número" }, { key: "pages", label: "Páginas" }, { key: "doi", label: "DOI" }],
  guide: [{ key: "institution", label: "Institución" }, { key: "version", label: "Edición o versión" }, { key: "url", label: "URL" }],
  standard: [{ key: "body", label: "Organismo" }, { key: "code", label: "Código" }, { key: "effective", label: "Fecha de vigencia" }, { key: "url", label: "URL" }],
  score: [{ key: "composer", label: "Compositor" }, { key: "arranger", label: "Arreglista" }, { key: "instrumentation", label: "Instrumentación" }, { key: "publisher", label: "Editorial" }],
  video: [{ key: "performers", label: "Intérpretes" }, { key: "duration", label: "Duración" }, { key: "platform", label: "Plataforma" }, { key: "url", label: "URL" }],
  dataset: [{ key: "publisher", label: "Publicador" }, { key: "version", label: "Versión" }, { key: "format", label: "Formato" }, { key: "doi", label: "DOI" }, { key: "url", label: "URL" }],
  case: [{ key: "version", label: "Versión" }],
  template: [{ key: "version", label: "Versión" }],
  rubric: [{ key: "version", label: "Versión" }],
  website: [{ key: "site", label: "Sitio" }, { key: "retrieved", label: "Fecha de consulta" }, { key: "url", label: "URL" }],
  other: [{ key: "description", label: "Descripción" }],
};
/** The fields a type asks for, besides title, authorship, year, language, license, level and area. */
export function resourceFields(type: ResourceType): ResourceField[] {
  return fields[type];
}

const textOf = (value: unknown, max: number) => {
  if (value === undefined || value === null || value === "") return "";
  if (typeof value !== "string") return null;
  const clean = value.trim().replace(/\s+/g, " ").normalize("NFC");
  return clean.length <= max && !/[<>]/.test(clean) ? clean : null;
};
const yearOf = (value: unknown) => {
  if (value === undefined || value === null || value === "") return null;
  const year = typeof value === "number" ? value : typeof value === "string" && /^\d{4}$/.test(value) ? Number(value) : NaN;
  return Number.isInteger(year) && year >= 1000 && year <= 2100 ? year : undefined;
};

/** The record the form sends, or what to fix. A handwritten citation is optional and stays an exception. */
export function resourceInput(input: unknown): { type: ResourceType; kind: ResourceKind; title: string; authors: ResourceAuthor[]; year: number | null; metadata: ResourceMetadata; language: string; license: ResourceLicense; shareable: boolean; level: string; area: string; role: ResourceRole | null; citationOverride: string | null } | { error: string } {
  const value = input && typeof input === "object" ? input as Record<string, unknown> : {};
  if (!resourceTypes.includes(value.type as ResourceType)) return { error: "Elige el tipo de recurso." };
  if (!resourceKinds.includes(value.kind as ResourceKind)) return { error: "Elige si es un archivo, un enlace, un texto o solo una referencia." };
  const title = textOf(value.title, 200);
  if (!title) return { error: "Escribe el título (hasta 200 caracteres, sin < ni >)." };
  const authors = authorsOf(value.authors);
  if (!authors) return { error: "Escribe la autoría: personas (apellido y nombre) o una institución." };
  if ("error" in authors) return authors;
  const year = yearOf(value.year);
  if (year === undefined) return { error: "El año es un número de cuatro cifras, o se deja vacío (s. f.)." };
  const metadata = metadataOf(value.type as ResourceType, value.metadata);
  if ("error" in metadata) return metadata;
  const language = textOf(value.language, 40);
  if (language === null) return { error: "El idioma admite hasta 40 caracteres." };
  if (value.license !== undefined && !resourceLicenses.includes(value.license as ResourceLicense)) return { error: "Elige la licencia." };
  if (value.shareable !== undefined && typeof value.shareable !== "boolean") return { error: "Indica si se puede compartir con estudiantes." };
  const level = textOf(value.level, 80), area = textOf(value.area, 80);
  if (level === null || area === null) return { error: "El nivel y el área admiten hasta 80 caracteres." };
  if (value.role !== undefined && value.role !== null && !resourceRoles.includes(value.role as ResourceRole)) return { error: "El rol es texto principal, obligatoria, recomendada o apoyo docente." };
  const citationOverride = value.citationOverride === undefined || value.citationOverride === null || value.citationOverride === "" ? null : textOf(value.citationOverride, 500);
  if (citationOverride === null && value.citationOverride) return { error: "La cita escrita a mano admite hasta 500 caracteres, sin < ni >." };
  return {
    type: value.type as ResourceType, kind: value.kind as ResourceKind, title, authors: authors.authors, year, metadata: metadata.metadata,
    language, license: (value.license as ResourceLicense) || "reserved", shareable: value.shareable === true, level, area,
    role: (value.role as ResourceRole) || null, citationOverride,
  };
}
function authorsOf(input: unknown): { authors: ResourceAuthor[] } | { error: string } | null {
  if (!Array.isArray(input) || !input.length || input.length > 25) return null;
  const authors: ResourceAuthor[] = [];
  for (const item of input) {
    if (!item || typeof item !== "object") return null;
    const row = item as Record<string, unknown>;
    if (row.kind === "institution") {
      const name = textOf(row.name, 200);
      if (!name) return null;
      authors.push({ kind: "institution", name });
    } else if (row.kind === "person") {
      const family = textOf(row.family, 80), given = textOf(row.given, 80);
      if (!family || given === null) return null;
      authors.push({ kind: "person", family, given });
    } else return null;
  }
  return { authors };
}
function metadataOf(type: ResourceType, input: unknown): { metadata: ResourceMetadata } | { error: string } {
  const source = input && typeof input === "object" ? input as Record<string, unknown> : {};
  const metadata: ResourceMetadata = {};
  for (const field of fields[type]) {
    if (source[field.key] === undefined || source[field.key] === null || source[field.key] === "") continue;
    if (field.key === "edition" && typeof source.edition === "number" && Number.isInteger(source.edition) && source.edition > 0 && source.edition < 100) { metadata.edition = source.edition; continue; }
    const text = textOf(source[field.key], 300);
    if (text === null) return { error: `Revisa «${field.label}» (hasta 300 caracteres, sin < ni >).` };
    if (text) metadata[field.key] = text;
  }
  return { metadata };
}

const months = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];
const initials = (given: string) => given.trim().split(/\s+/).filter(Boolean).map(part => `${part[0]!.toUpperCase()}.`).join(" ");
const person = (author: Extract<ResourceAuthor, { kind: "person" }>) => author.given ? `${author.family}, ${initials(author.given)}` : author.family;
const editorName = (author: Extract<ResourceAuthor, { kind: "person" }>) => author.given ? `${initials(author.given)} ${author.family}` : author.family;
function joinAuthors(authors: ResourceAuthor[]) {
  const parts = authors.map(author => author.kind === "institution" ? author.name : person(author));
  if (parts.length <= 1) return parts[0] || "";
  if (parts.length === 2) return `${parts[0]} y ${parts[1]}`;
  if (parts.length <= 20) return `${parts.slice(0, -1).join(", ")} y ${parts.at(-1)}`;
  return `${parts.slice(0, 19).join(", ")}, … ${parts.at(-1)}`;
}
const editionOf = (value: string | number | null | undefined) => {
  if (value === undefined || value === null || value === "") return "";
  // A form sends the number as text: «2» is the second edition.
  if (typeof value === "number" || /^\d+$/.test(value.trim())) return `(${String(value).trim()}.ª ed.)`;
  return value.includes("ed") ? `(${value.replace(/^\(|\)$/g, "")})` : `(${value})`;
};
const pagesOf = (value: string | number | null | undefined) => String(value || "").replace(/\s/g, "").replace(/-/g, "–");
const doiOf = (value: string | number | null | undefined) => {
  const doi = String(value || "").replace(/^https?:\/\/(dx\.)?doi\.org\//, "");
  return doi ? `https://doi.org/${doi}` : "";
};
const meta = (resource: CitationResource, key: string) => resource.metadata[key];
const authorsFor = (resource: CitationResource): ResourceAuthor[] => {
  if (resource.authors.length) return resource.authors;
  const body = meta(resource, "body") || meta(resource, "institution") || meta(resource, "composer");
  return body ? [{ kind: "institution", name: String(body) }] : [];
};

/** APA 7 in Spanish. People and institutions, editions, DOI or URL, and «s. f.» when there is no year. */
export function citation(resource: CitationResource, style: "apa7"): string {
  if (style !== "apa7") return "";
  if (resource.citationOverride?.trim()) return resource.citationOverride.trim();
  const authors = authorsFor(resource);
  const written = joinAuthors(authors);
  const head = `${written}${authors.at(-1)?.kind === "institution" && !written.endsWith(".") ? "." : ""} (${resource.year ?? "s. f."}).`;
  const title = resource.title.trim();
  const edition = editionOf(meta(resource, "edition"));
  const publisher = String(meta(resource, "publisher") || "");
  const url = String(meta(resource, "url") || "");
  const doi = doiOf(meta(resource, "doi"));
  const pages = pagesOf(meta(resource, "pages"));
  let body = title;
  if (resource.type === "book") body = `${title}${edition ? ` ${edition}` : ""}.${publisher ? ` ${publisher}.` : ""}`;
  else if (resource.type === "chapter") {
    const editors = String(meta(resource, "editors") || "");
    const editorLabel = editors.includes(";") || editors.includes(" y ") ? "(Eds.)" : "(Ed.)";
    body = `${title}. En ${editors} ${editorLabel}, ${meta(resource, "book") || ""}${edition ? ` ${edition}` : ""}${pages ? ` (pp. ${pages})` : ""}.${publisher ? ` ${publisher}.` : ""}`;
  } else if (resource.type === "article") {
    const volume = meta(resource, "volume"), issue = meta(resource, "issue");
    const locus = [volume ? `${volume}${issue ? `(${issue})` : ""}` : "", pages].filter(Boolean).join(", ");
    body = `${title}. ${meta(resource, "journal") || ""}${locus ? `, ${locus}` : ""}.`;
  } else if (resource.type === "guide") body = `${title}${meta(resource, "version") ? ` (${meta(resource, "version")})` : ""}.`;
  else if (resource.type === "standard") body = `${title}${meta(resource, "code") ? ` (${meta(resource, "code")})` : ""}.`;
  else if (resource.type === "score") body = `${title}${meta(resource, "arranger") ? ` (${meta(resource, "arranger")}, arr.)` : ""} [Partitura].${publisher ? ` ${publisher}.` : ""}`;
  else if (resource.type === "video") body = `${title} [Video].${meta(resource, "platform") ? ` ${meta(resource, "platform")}.` : ""}`;
  else if (resource.type === "dataset") body = `${title}${meta(resource, "version") ? ` (${meta(resource, "version")})` : ""} [Conjunto de datos].${publisher ? ` ${publisher}.` : ""}`;
  else if (resource.type === "case" || resource.type === "template" || resource.type === "rubric") {
    const bracket = resource.type === "case" ? "Caso" : resource.type === "template" ? "Plantilla" : "Rúbrica";
    body = `${title}${meta(resource, "version") ? ` (${meta(resource, "version")})` : ""} [${bracket}].`;
  } else if (resource.type === "website") body = `${title}.${meta(resource, "site") ? ` ${meta(resource, "site")}.` : ""}`;
  else body = `${title}.${meta(resource, "description") ? ` ${meta(resource, "description")}.` : ""}`;
  const retrieved = resource.type === "website" && meta(resource, "retrieved") ? retrievedOf(String(meta(resource, "retrieved"))) : "";
  const link = doi || url;
  // Without authorship the title block (with its edition or bracket) takes the author's place, before the date.
  if (!authors.length) {
    // The title block ends at the first period followed by a space (an edition like «2.ª ed.» has inner periods).
    const end = body.indexOf(". ", title.length);
    const first = end < 0 ? (body.endsWith(".") ? body : `${body}.`) : body.slice(0, end + 1), rest = end < 0 ? "" : body.slice(end + 1);
    return [`${first} (${resource.year ?? "s. f."}).`, rest, retrieved && link ? `${retrieved} ${link}` : retrieved || link]
      .filter(Boolean).join(" ").replace(/\s+/g, " ").replace(/\s+\./g, ".").trim();
  }
  return [head, body, retrieved && link ? `${retrieved} ${link}` : retrieved || link].filter(Boolean).join(" ").replace(/\s+/g, " ").replace(/\s+\./g, ".").trim();
}
function retrievedOf(value: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return "";
  const month = months[Number(match[2]) - 1];
  return month ? `Recuperado el ${Number(match[3])} de ${month} de ${match[1]}, de` : "";
}

export type BibliographyEntry = { role: ResourceRole; citation: string; manual: boolean };
/** The bibliography grouped by role, as plain text and as HTML (titles in emphasis). */
export function apaBibliography(entries: BibliographyEntry[]): { text: string; html: string } {
  const order: ResourceRole[] = ["primary", "required", "recommended", "support"];
  const blocks = order.filter(role => entries.some(entry => entry.role === role)).map(role => {
    const rows = entries.filter(entry => entry.role === role);
    const text = [`${resourceRoleLabel[role]}`, ...rows.map(row => row.manual ? `${row.citation} (cita escrita a mano)` : row.citation)].join("\n");
    const html = `<section><h2>${escapeHtml(resourceRoleLabel[role])}</h2>${rows.map(row => `<p>${escapeHtml(row.manual ? `${row.citation} (cita escrita a mano)` : row.citation)}</p>`).join("")}</section>`;
    return { text, html };
  });
  return { text: blocks.map(block => block.text).join("\n\n"), html: blocks.map(block => block.html).join("") };
}
const escapeHtml = (value: string) => value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

export type IndexEntry = {
  id: string; parentId: string | null; position: number; title: string;
  startPage: number | null; endPage: number | null; startSeconds: number | null; endSeconds: number | null;
  source: "outline" | "detected" | "manual";
};
export type OutlineNode = { title: string; page?: number | null; seconds?: number | null; children?: OutlineNode[] };

/** The PDF outline the browser read with pdf.js, as a tree of chapters and sections. */
export function indexFromOutline(nodes: OutlineNode[]): IndexEntry[] {
  const entries: IndexEntry[] = [];
  const walk = (list: OutlineNode[], parentId: string | null, prefix: string) => {
    list.forEach((node, position) => {
      const id = `${prefix}${position}`;
      entries.push({ id, parentId, position, title: node.title.trim(), startPage: node.page ?? null, endPage: null, startSeconds: node.seconds ?? null, endSeconds: null, source: "outline" });
      if (node.children?.length) walk(node.children, id, `${id}-`);
    });
  };
  walk(nodes, null, "outline-");
  return closeRanges(entries);
}

const headingLine = /^(cap[ií]tulo|unidad|tema|secci[oó]n|parte)\s+\d+\b/i;
/** Headings proposed from the text of each page: a short title line, or one that names a chapter. */
export function detectHeadings(pages: { page: number; text: string }[]): IndexEntry[] {
  const found: IndexEntry[] = [];
  for (const page of pages) {
    const line = page.text.split(/\n/).map(item => item.trim()).find(Boolean) || "";
    if (!isHeading(line)) continue;
    found.push({ id: `detected-${found.length + 1}`, parentId: null, position: found.length, title: line, startPage: page.page, endPage: null, startSeconds: null, endSeconds: null, source: "detected" });
  }
  const last = pages.at(-1)?.page ?? found.at(-1)?.startPage ?? null;
  return closeRanges(found, last);
}
function isHeading(line: string) {
  if (line.length < 3 || line.length > 80 || /[.!?]$/.test(line)) return false;
  if (headingLine.test(line)) return true;
  const words = line.split(/\s+/);
  return words.length <= 10 && words.every(word => /^[\d.°ºn.]+$/.test(word) || word[0] === word[0]?.toUpperCase());
}
function closeRanges(entries: IndexEntry[], lastPage?: number | null): IndexEntry[] {
  const siblings = (parentId: string | null) => entries.filter(entry => entry.parentId === parentId);
  for (const entry of entries) {
    const next = siblings(entry.parentId).find(item => item.position === entry.position + 1);
    if (entry.startPage !== null && entry.endPage === null) entry.endPage = next?.startPage ? next.startPage - 1 : lastPage && lastPage >= entry.startPage ? lastPage : entry.startPage;
    if (entry.startSeconds !== null && entry.endSeconds === null && next?.startSeconds) entry.endSeconds = next.startSeconds;
  }
  return entries;
}

/** Why a tree of ranges is illegal, or null when siblings do not overlap and children stay inside their parent. */
export function indexRanges(entries: IndexEntry[]): string | null {
  const byParent = new Map<string | null, IndexEntry[]>();
  for (const entry of entries) {
    const list = byParent.get(entry.parentId) || [];
    list.push(entry);
    byParent.set(entry.parentId, list);
    if (entry.startPage !== null && entry.endPage !== null && entry.endPage < entry.startPage) return `El rango de «${entry.title}» termina antes de empezar.`;
    if (entry.startSeconds !== null && entry.endSeconds !== null && entry.endSeconds < entry.startSeconds) return `El rango de «${entry.title}» termina antes de empezar.`;
  }
  for (const entry of entries) {
    if (!entry.parentId) continue;
    const parent = entries.find(item => item.id === entry.parentId);
    if (!parent) return `«${entry.title}» no tiene su capítulo padre.`;
    if (entry.startPage !== null && parent.startPage !== null && parent.endPage !== null && (entry.startPage < parent.startPage || (entry.endPage ?? entry.startPage) > parent.endPage)) return `«${entry.title}» se sale de «${parent.title}».`;
  }
  for (const list of byParent.values()) {
    const ranged = list.filter(entry => entry.startPage !== null && entry.endPage !== null).sort((a, b) => a.startPage! - b.startPage!);
    for (let index = 1; index < ranged.length; index++) if (ranged[index]!.startPage! <= ranged[index - 1]!.endPage!) return `«${ranged[index - 1]!.title}» y «${ranged[index]!.title}» se solapan.`;
  }
  return null;
}

export type CoverageMap = { outcomeId: string; resourceId: string; pages: number[]; status: "proposed" | "confirmed"; chapter?: string | null };
/** How many outcomes of the plan have at least one confirmed, indexed resource, and which ones. */
export type LookupRecord = { type: ResourceType; title: string; authors: ResourceAuthor[]; year: number | null; metadata: ResourceMetadata };
export type LookupResult = { record: LookupRecord } | { error: "timeout" | "missing" | "failed" };

const splitName = (name: string): ResourceAuthor => {
  const parts = name.trim().split(/\s+/);
  if (parts.length < 2) return { kind: "person", family: name.trim(), given: "" };
  return { kind: "person", family: parts.at(-1)!, given: parts.slice(0, -1).join(" ") };
};

/** ISBN (Open Library) or DOI (Crossref). No personal data goes out. A 3 s limit leaves the form to be filled by hand. */
export async function lookupIdentifier(kind: "isbn" | "doi", value: string, fetchImpl: typeof fetch, timeoutMs = 3000): Promise<LookupResult> {
  const clean = value.trim();
  const url = kind === "isbn"
    ? `https://openlibrary.org/api/books?bibkeys=ISBN:${encodeURIComponent(clean.replace(/-/g, ""))}&format=json&jscmd=data`
    : `https://api.crossref.org/works/${encodeURIComponent(clean.replace(/^https?:\/\/(dx\.)?doi\.org\//, ""))}`;
  try {
    const response = await fetchImpl(url, { signal: AbortSignal.timeout(timeoutMs), headers: { Accept: "application/json", "User-Agent": "HappyLearners/1.3.7" } });
    if (!response.ok) return { error: response.status === 404 ? "missing" : "failed" };
    const body = await response.json() as Record<string, unknown>;
    return kind === "isbn" ? openLibrary(body, clean) : crossref(body, clean);
  } catch (error) {
    return { error: error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError") ? "timeout" : "failed" };
  }
}
function openLibrary(body: Record<string, unknown>, isbn: string): LookupResult {
  const record = Object.values(body).find(item => item && typeof item === "object") as Record<string, unknown> | undefined;
  if (!record || typeof record.title !== "string") return { error: "missing" };
  const authors: ResourceAuthor[] = Array.isArray(record.authors) ? record.authors.flatMap((item): ResourceAuthor[] => item && typeof item === "object" && typeof (item as { name?: string }).name === "string" ? [splitName((item as { name: string }).name)] : []) : [];
  const publisher = Array.isArray(record.publishers) ? (record.publishers.find(item => item && typeof item === "object" && typeof (item as { name?: string }).name === "string") as { name?: string } | undefined)?.name || "" : "";
  const year = typeof record.publish_date === "string" ? Number(record.publish_date.slice(0, 4)) : null;
  return { record: { type: "book", title: record.title, authors, year: year && year >= 1000 ? year : null, metadata: { ...(publisher ? { publisher } : {}), isbn: isbn.replace(/-/g, ""), ...(typeof record.number_of_pages === "number" ? { pages: String(record.number_of_pages) } : {}) } } };
}
function crossref(body: Record<string, unknown>, doi: string): LookupResult {
  const message = body.message && typeof body.message === "object" ? body.message as Record<string, unknown> : null;
  const title = Array.isArray(message?.title) ? message.title.find(item => typeof item === "string") as string | undefined : undefined;
  if (!message || !title) return { error: "missing" };
  const authors: ResourceAuthor[] = Array.isArray(message.author) ? message.author.flatMap((item): ResourceAuthor[] => {
    if (!item || typeof item !== "object") return [];
    const row = item as { family?: string; given?: string; name?: string };
    if (row.family) return [{ kind: "person" as const, family: row.family, given: row.given || "" }];
    return row.name ? [{ kind: "institution" as const, name: row.name }] : [];
  }) : [];
  const issued = message.issued && typeof message.issued === "object" ? (message.issued as { "date-parts"?: number[][] })["date-parts"]?.[0]?.[0] : null;
  const journal = Array.isArray(message["container-title"]) ? message["container-title"].find(item => typeof item === "string") as string | undefined : undefined;
  return { record: { type: journal ? "article" : "other", title, authors, year: typeof issued === "number" ? issued : null, metadata: { ...(journal ? { journal } : {}), ...(message.volume ? { volume: String(message.volume) } : {}), ...(message.issue ? { issue: String(message.issue) } : {}), ...(message.page ? { pages: String(message.page) } : {}), doi } } };
}

export function resourceCoverage(outcomes: { id: string }[], maps: CoverageMap[]) {
  const byOutcome = outcomes.map(outcome => ({
    outcomeId: outcome.id,
    resources: maps.filter(item => item.outcomeId === outcome.id && item.status === "confirmed" && item.pages.length).map(item => ({ resourceId: item.resourceId, pages: item.pages, chapter: item.chapter || null })),
  }));
  return { covered: byOutcome.filter(item => item.resources.length).length, total: outcomes.length, byOutcome };
}
