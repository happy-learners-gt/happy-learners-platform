import type { Member } from "@happy-learners/contracts";
import { apaBibliography, citation, detectHeadings, indexFromOutline, indexRanges, lookupIdentifier, resourceInput, teachesSection } from "@happy-learners/domain";
import type { CitationResource, IndexEntry, LookupResult, OutlineNode, ResourceRole, ResourceType } from "@happy-learners/domain";
import type { Database } from "./storage";
import { accessTo } from "./access";
import { configurationOf } from "./courses";
import { event } from "./activity";

/**
 * Course resources (1.3.7): the library item and its record, its index, readings and reading marks.
 * ISBN and DOI lookup is optional and timed; tests use a double and never call the catalog.
 */
declare global { interface Env { RESOURCE_LOOKUP?: string } }

const reply = (value: unknown, status = 200) => Response.json(value, { status });
const listPath = /^\/api\/courses\/([a-z0-9-]+)\/resources$/;
const lookupPath = /^\/api\/courses\/([a-z0-9-]+)\/resources\/lookup$/;
const itemPath = /^\/api\/courses\/([a-z0-9-]+)\/resources\/(resource-[a-z0-9-]+)$/;
const indexPath = /^\/api\/courses\/([a-z0-9-]+)\/resources\/(resource-[a-z0-9-]+)\/index$/;
const textPath = /^\/api\/courses\/([a-z0-9-]+)\/resources\/(resource-[a-z0-9-]+)\/text$/;
const readingsPath = /^\/api\/courses\/([a-z0-9-]+)\/readings$/;
const readingPath = /^\/api\/courses\/([a-z0-9-]+)\/readings\/(reading-[a-z0-9-]+)$/;
const sectionReadingsPath = /^\/api\/sections\/([a-z0-9-]+)\/readings$/;

export function resourceMethods(path: string): string[] | null {
  if (listPath.test(path) || readingsPath.test(path)) return ["GET", "POST"];
  if (lookupPath.test(path) || textPath.test(path)) return ["POST", "PUT"].filter(method => textPath.test(path) ? method === "PUT" : method === "POST");
  if (itemPath.test(path)) return ["GET", "PUT", "DELETE"];
  if (indexPath.test(path)) return ["GET", "PUT", "POST"];
  if (readingPath.test(path)) return ["PUT", "DELETE"];
  if (sectionReadingsPath.test(path)) return ["GET"];
  return null;
}

type ResourceRow = {
  id: string; courseId: string; materialId: string | null; fileId: string | null; kind: "file" | "link" | "text" | "reference"; type: ResourceType;
  title: string; authors: string; year: number | null; metadata: string; language: string; license: string; shareable: number; level: string; area: string;
  role: ResourceRole | null; citationOverride: string | null; status: "draft" | "published" | "archived"; updatedAt: string;
  fileName: string | null; mediaType: string | null; indexCount: number;
};
const resourceColumns = `SELECT r.id,r.course_id AS courseId,r.material_id AS materialId,r.file_id AS fileId,r.kind,r.type,r.title,r.authors,r.year,r.metadata,r.language,r.license,r.shareable,r.level,r.area,r.role,r.citation_override AS citationOverride,r.status,r.updated_at AS updatedAt,
  f.original_name AS fileName,f.media_type AS mediaType,(SELECT count(*) FROM resource_index i WHERE i.resource_id=r.id) AS indexCount
  FROM course_resources r LEFT JOIN course_files f ON f.id=r.file_id`;

const viewOf = (row: ResourceRow, coverage?: { confirmed: number; total: number }) => {
  const authors = JSON.parse(row.authors) as CitationResource["authors"];
  const metadata = JSON.parse(row.metadata) as CitationResource["metadata"];
  const source: CitationResource = { type: row.type, title: row.title, authors, year: row.year, metadata, citationOverride: row.citationOverride };
  const state = !row.indexCount ? "none" : coverage && coverage.confirmed ? "mapped" : "ready";
  return {
    id: row.id, courseId: row.courseId, materialId: row.materialId, fileId: row.fileId, kind: row.kind, type: row.type, title: row.title, authors, year: row.year, metadata,
    language: row.language, license: row.license, shareable: !!row.shareable, level: row.level, area: row.area, role: row.role, citationOverride: row.citationOverride,
    citation: citation(source, "apa7"), manual: !!row.citationOverride, status: row.status, updatedAt: row.updatedAt,
    ...(row.fileName ? { fileName: row.fileName, mediaType: row.mediaType } : {}),
    indexState: state, ...(coverage ? { coverage } : {}),
  };
};

async function rowsOf(db: Database, organizationId: string, courseId: string) {
  return (await db.prepare(`${resourceColumns} WHERE r.course_id=? AND r.organization_id=? ORDER BY r.role='primary' DESC, r.title COLLATE NOCASE, r.created_at`).bind(courseId, organizationId).all<ResourceRow>()).results; // nosemgrep: sql-interpolated-text -- resourceColumns es una consulta constante
}
export async function resources(path: string, method: string, input: unknown, current: Member, db: Database, env: Env): Promise<Response> {
  const courseId = (lookupPath.exec(path) || indexPath.exec(path) || textPath.exec(path) || itemPath.exec(path) || listPath.exec(path) || readingPath.exec(path) || readingsPath.exec(path))?.[1];
  const sectionId = sectionReadingsPath.exec(path)?.[1] || null;
  const section = sectionId ? await db.prepare("SELECT id,course_id AS courseId,name,status FROM course_groups WHERE id=? AND organization_id=?").bind(sectionId, current.organizationId).first<{ id: string; courseId: string; name: string; status: string }>() : null;
  if (sectionId && !section) return reply({ error: "Sección no disponible." }, 404);
  const resolvedCourse = courseId || section?.courseId;
  if (!resolvedCourse) return reply({ error: "Curso no disponible." }, 404);
  const course = await db.prepare("SELECT id,title,status FROM courses WHERE id=? AND organization_id=?").bind(resolvedCourse, current.organizationId).first<{ id: string; title: string; status: string }>();
  if (!course) return reply({ error: "Curso no disponible." }, 404);
  const access = await accessTo(db, current, course.id);
  if (!access) return reply({ error: "Este curso no está asignado a tu cuenta." }, 403);
  const manage = (access.configure || access.edit) && course.status === "active";
  if (section) return sectionReadings(db, current.organizationId, course.id, section, access, manage);
  if (readingsPath.test(path) || readingPath.test(path)) return courseReadings(path, method, input, current, db, course, access, manage);
  if (!manage && method !== "GET") return reply({ error: course.status !== "active" ? "Restaura el curso antes de cambiar sus recursos." : "Solo administración y el equipo del curso gestionan sus recursos." }, 403);
  if (lookupPath.test(path)) return lookup(input, env);
  const resourceId = (indexPath.exec(path) || textPath.exec(path) || itemPath.exec(path))?.[2] || null;
  const found = resourceId ? (await rowsOf(db, current.organizationId, course.id)).find(row => row.id === resourceId) || null : null;
  if (resourceId && !found) return reply({ error: "Recurso no disponible." }, 404);
  if (indexPath.test(path)) return indexOf(method, input, current, db, course.id, found!);
  if (textPath.test(path)) return storeText(input, current, db, course.id, found!);
  if (method === "GET" && !resourceId) {
    const rows = await rowsOf(db, current.organizationId, course.id);
    const coverage = await resourceCoverage(db, course.id, rows);
    return reply({ resources: rows.map(row => viewOf(row, coverage.get(row.id))), plan: await planCoverage(db, course.id, rows), canManage: manage });
  }
  if (method === "GET") return reply({ resource: viewOf(found!, (await resourceCoverage(db, course.id, [found!])).get(found!.id)) });
  if (method === "DELETE") {
    await db.batch([
      db.prepare("UPDATE course_resources SET status='archived',role=CASE WHEN role='primary' THEN NULL ELSE role END,updated_at=? WHERE id=? AND course_id=? AND organization_id=?").bind(new Date().toISOString(), found!.id, course.id, current.organizationId),
      event(db, current, { action: "archived", targetType: "resource", targetId: found!.id, courseId: course.id, summary: `Archivó el recurso «${found!.title}»` }),
    ]);
    return reply({ ok: true });
  }
  const value = resourceInput(input);
  if ("error" in value) return reply(value, 400);
  if (value.role === "primary" && found?.status === "archived") return reply({ error: "Un recurso archivado no puede ser el texto principal." }, 409);
  const now = new Date().toISOString();
  const link = input && typeof input === "object" ? input as Record<string, unknown> : {};
  if (method === "POST") return createResource(value, link, current, db, course.id, now);
  if (value.role === "primary") await db.prepare("UPDATE course_resources SET role='required',updated_at=? WHERE course_id=? AND organization_id=? AND role='primary' AND id<>?").bind(now, course.id, current.organizationId, found!.id).run();
  await db.prepare("UPDATE course_resources SET type=?,title=?,authors=?,year=?,metadata=?,language=?,license=?,shareable=?,level=?,area=?,role=?,citation_override=?,updated_at=? WHERE id=? AND course_id=? AND organization_id=?")
    .bind(value.type, value.title, JSON.stringify(value.authors), value.year, JSON.stringify(value.metadata), value.language, value.license, value.shareable ? 1 : 0, value.level, value.area, value.role, value.citationOverride, now, found!.id, course.id, current.organizationId).run();
  // A material and its resource are one item: the library shows the same title (a new version, so a stale edit conflicts).
  if (found!.materialId) await db.prepare("UPDATE materials SET title=?,version=version+1,updated_at=? WHERE id=? AND course_id=? AND organization_id=? AND title<>?").bind(value.title, now, found!.materialId, course.id, current.organizationId, value.title).run();
  const saved = (await rowsOf(db, current.organizationId, course.id)).find(row => row.id === found!.id)!;
  return reply({ resource: viewOf(saved) });
}

async function planCoverage(db: Database, courseId: string, rows: ResourceRow[]) {
  const outcomes = (await db.prepare("SELECT id FROM course_outcomes WHERE course_id=? AND status='active' ORDER BY position,id").bind(courseId).all<{ id: string }>()).results;
  const maps = (await db.prepare("SELECT r.id AS resourceId,r.title,m.outcome_id AS outcomeId,m.pages FROM book_maps m JOIN course_files f ON f.sha256=m.sha256 AND f.course_id=m.course_id JOIN course_resources r ON r.file_id=f.id AND r.course_id=m.course_id WHERE m.course_id=? AND m.status='confirmed'").bind(courseId).all<{ resourceId: string; title: string; outcomeId: string; pages: string }>()).results;
  const index = rows.length ? (await db.prepare("SELECT resource_id AS resourceId,title,start_page AS startPage,end_page AS endPage FROM resource_index WHERE resource_id IN (SELECT id FROM course_resources WHERE course_id=?)").bind(courseId).all<{ resourceId: string; title: string; startPage: number | null; endPage: number | null }>()).results : [];
  const byOutcome = outcomes.map(outcome => ({
    outcomeId: outcome.id,
    resources: maps.filter(item => item.outcomeId === outcome.id && JSON.parse(item.pages).length).map(item => {
      const pages = JSON.parse(item.pages) as number[];
      const chapter = index.find(entry => entry.resourceId === item.resourceId && entry.startPage !== null && pages.some(page => page >= entry.startPage! && page <= (entry.endPage ?? entry.startPage!)))?.title || null;
      return { resourceId: item.resourceId, title: item.title, pages, chapter };
    }),
  }));
  return { covered: byOutcome.filter(item => item.resources.length).length, total: outcomes.length, byOutcome };
}

async function resourceCoverage(db: Database, courseId: string, rows: ResourceRow[]) {
  const total = (await db.prepare("SELECT count(*) AS total FROM course_outcomes WHERE course_id=? AND status='active'").bind(courseId).first<{ total: number }>())?.total || 0;
  const maps = (await db.prepare("SELECT f.id AS fileId,m.outcome_id AS outcomeId,m.pages FROM book_maps m JOIN course_files f ON f.sha256=m.sha256 AND f.course_id=m.course_id WHERE m.course_id=? AND m.status='confirmed'").bind(courseId).all<{ fileId: string; outcomeId: string; pages: string }>()).results;
  return new Map(rows.map(row => {
    const confirmed = new Set(maps.filter(item => item.fileId === row.fileId && JSON.parse(item.pages).length).map(item => item.outcomeId)).size;
    return [row.id, { confirmed, total }] as const;
  }));
}

async function createResource(value: ReturnType<typeof resourceInput> & object, link: Record<string, unknown>, current: Member, db: Database, courseId: string, now: string) {
  if ("error" in value) return reply(value, 400);
  let materialId = typeof link.materialId === "string" ? link.materialId : null;
  let fileId = typeof link.fileId === "string" ? link.fileId : null;
  if (value.kind === "reference") { materialId = null; fileId = null; }
  if (value.kind === "file" && !fileId) return reply({ error: "Sube el archivo y vuelve a guardar la ficha." }, 400);
  if ((value.kind === "link" || value.kind === "text") && !materialId) {
    materialId = `material-${crypto.randomUUID()}`;
    const content = value.kind === "link" ? String(value.metadata.url || value.title) : String(value.metadata.description || value.title);
    await db.prepare("INSERT INTO materials(id,course_id,organization_id,title,description,kind,content,status,updated_at) VALUES (?,?,?,?,?,?,?,?,?)")
      .bind(materialId, courseId, current.organizationId, value.title, "", value.kind, content, "published", now).run();
  }
  const existing = materialId || fileId
    ? await db.prepare("SELECT id FROM course_resources WHERE course_id=? AND organization_id=? AND ((material_id IS NOT NULL AND material_id=?) OR (file_id IS NOT NULL AND file_id=?))").bind(courseId, current.organizationId, materialId, fileId).first<{ id: string }>()
    : null;
  if (value.role === "primary") await db.prepare("UPDATE course_resources SET role='required',updated_at=? WHERE course_id=? AND organization_id=? AND role='primary'").bind(now, courseId, current.organizationId).run();
  const id = existing?.id || `resource-${crypto.randomUUID()}`;
  if (existing) {
    await db.prepare("UPDATE course_resources SET type=?,title=?,authors=?,year=?,metadata=?,language=?,license=?,shareable=?,level=?,area=?,role=?,citation_override=?,status='published',updated_at=? WHERE id=?")
      .bind(value.type, value.title, JSON.stringify(value.authors), value.year, JSON.stringify(value.metadata), value.language, value.license, value.shareable ? 1 : 0, value.level, value.area, value.role, value.citationOverride, now, id).run();
  } else {
    await db.prepare("INSERT INTO course_resources(id,organization_id,course_id,material_id,file_id,kind,type,title,authors,year,metadata,language,license,shareable,level,area,role,citation_override,status,created_by,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?, 'published',?,?,?)")
      .bind(id, current.organizationId, courseId, materialId, fileId, value.kind, value.type, value.title, JSON.stringify(value.authors), value.year, JSON.stringify(value.metadata), value.language, value.license, value.shareable ? 1 : 0, value.level, value.area, value.role, value.citationOverride, current.id, now, now).run();
  }
  await event(db, current, { action: "created", targetType: "resource", targetId: id, courseId, summary: `Agregó el recurso «${value.title}»` }).run();
  const saved = (await rowsOf(db, current.organizationId, courseId)).find(row => row.id === id)!;
  return reply({ resource: viewOf(saved) }, existing ? 200 : 201);
}

async function lookup(input: unknown, env: Env) {
  const body = input && typeof input === "object" ? input as Record<string, unknown> : {};
  const isbn = typeof body.isbn === "string" ? body.isbn.trim() : "";
  const doi = typeof body.doi === "string" ? body.doi.trim() : "";
  if (!isbn === !doi) return reply({ error: "Escribe un ISBN o un DOI." }, 400);
  const kind = isbn ? "isbn" as const : "doi" as const;
  const value = isbn || doi;
  const result: LookupResult = env.RESOURCE_LOOKUP === "fixture" ? fixtureLookup(kind, value) : await lookupIdentifier(kind, value, fetch);
  if ("error" in result) {
    if (result.error === "timeout") return reply({ error: "La consulta tardó demasiado. Llena la ficha a mano." }, 504);
    return reply({ error: "No se encontró. Llena la ficha a mano." }, 404);
  }
  return reply(result);
}
function fixtureLookup(kind: "isbn" | "doi", value: string): LookupResult {
  if (value.endsWith("0")) return { error: "timeout" };
  if (kind === "isbn") return { record: { type: "book", title: "Matemática 6", authors: [{ kind: "person", family: "López", given: "Ana" }], year: 2024, metadata: { publisher: "Santillana", isbn: value.replace(/-/g, "") } } };
  return { record: { type: "article", title: "La fracción como relación", authors: [{ kind: "person", family: "López", given: "Ana" }], year: 2024, metadata: { journal: "Revista de Educación Matemática", doi: value } } };
}

async function indexOf(method: string, input: unknown, current: Member, db: Database, courseId: string, resource: ResourceRow) {
  if (method === "GET") return reply({ entries: await entriesOf(db, resource.id) });
  const body = input && typeof input === "object" ? input as Record<string, unknown> : {};
  let entries: IndexEntry[];
  if (method === "POST" && body.source === "outline") entries = indexFromOutline(Array.isArray(body.outline) ? body.outline as OutlineNode[] : []);
  else if (method === "POST" && body.source === "detected") {
    if (!resource.fileId) return reply({ error: "Este recurso no tiene texto por página." }, 409);
    const pages = (await db.prepare("SELECT page,text FROM book_pages WHERE file_id=? ORDER BY page").bind(resource.fileId).all<{ page: number; text: string }>()).results;
    if (!pages.length) return reply({ error: "Lee primero el texto del recurso. Sin texto solo se puede escribir el índice a mano." }, 409);
    entries = detectHeadings(pages);
  } else entries = manualEntries(body.entries);
  if (!entries.length) return reply({ error: "El índice no tiene capítulos." }, 400);
  const invalid = indexRanges(entries);
  if (invalid) return reply({ error: invalid }, 400);
  const ordered: IndexEntry[] = [];
  const pending = [...entries];
  while (pending.length) {
    const next = pending.findIndex(entry => !entry.parentId || ordered.some(item => item.id === entry.parentId));
    if (next < 0) return reply({ error: "El índice tiene un capítulo sin su padre." }, 400);
    ordered.push(pending.splice(next, 1)[0]!);
  }
  await db.batch([
    db.prepare("DELETE FROM resource_index WHERE resource_id=?").bind(resource.id),
    ...ordered.map(entry => db.prepare("INSERT INTO resource_index(id,resource_id,parent_id,position,title,start_page,end_page,start_seconds,end_seconds,source) VALUES (?,?,?,?,?,?,?,?,?,?)")
      .bind(`${resource.id}-${entry.id}`, resource.id, entry.parentId ? `${resource.id}-${entry.parentId}` : null, entry.position, entry.title, entry.startPage, entry.endPage, entry.startSeconds, entry.endSeconds, entry.source)),
    event(db, current, { action: "updated", targetType: "resource", targetId: resource.id, courseId, summary: `Actualizó el índice de «${resource.title}»` }),
  ]);
  return reply({ entries: await entriesOf(db, resource.id) });
}
function manualEntries(input: unknown): IndexEntry[] {
  if (!Array.isArray(input)) return [];
  return input.flatMap((item, position) => {
    if (!item || typeof item !== "object") return [];
    const row = item as Record<string, unknown>;
    if (typeof row.title !== "string" || !row.title.trim()) return [];
    const numberOrNull = (value: unknown) => typeof value === "number" && Number.isInteger(value) ? value : null;
    return [{ id: typeof row.id === "string" && /^[a-z0-9-]+$/.test(row.id) ? row.id : `manual-${position}`, parentId: typeof row.parentId === "string" ? row.parentId : null, position, title: row.title.trim(), startPage: numberOrNull(row.startPage), endPage: numberOrNull(row.endPage), startSeconds: numberOrNull(row.startSeconds), endSeconds: numberOrNull(row.endSeconds), source: "manual" as const }];
  });
}
async function entriesOf(db: Database, resourceId: string): Promise<IndexEntry[]> {
  const rows = (await db.prepare("SELECT id,parent_id AS parentId,position,title,start_page AS startPage,end_page AS endPage,start_seconds AS startSeconds,end_seconds AS endSeconds,source FROM resource_index WHERE resource_id=? ORDER BY position,id").bind(resourceId).all<IndexEntry>()).results;
  const prefix = `${resourceId}-`;
  return rows.map(row => ({ ...row, id: row.id.startsWith(prefix) ? row.id.slice(prefix.length) : row.id, parentId: row.parentId?.startsWith(prefix) ? row.parentId.slice(prefix.length) : row.parentId }));
}

async function storeText(input: unknown, current: Member, db: Database, courseId: string, resource: ResourceRow) {
  if (!resource.fileId) return reply({ error: "Este recurso no es un PDF." }, 409);
  const file = await db.prepare("SELECT sha256,media_type AS mediaType,status FROM course_files WHERE id=? AND organization_id=?").bind(resource.fileId, current.organizationId).first<{ sha256: string; mediaType: string; status: string }>();
  const value = input && typeof input === "object" ? input as Record<string, unknown> : {};
  if (!file || file.mediaType !== "application/pdf" || file.status !== "ready" || value.sha256 !== file.sha256) return reply({ error: "El archivo cambió. Recarga y vuelve a intentar." }, 409);
  const pages = Array.isArray(value.pages) ? value.pages : null;
  if (!pages || pages.length > 1000 || pages.some((page, index) => !page || typeof page !== "object" || (page as { page?: unknown }).page !== index + 1 || typeof (page as { text?: unknown }).text !== "string")) return reply({ error: "Revisa el texto: las páginas deben venir completas y en orden." }, 400);
  const clean = (pages as { page: number; text: string }[]).map(page => ({ page: page.page, text: page.text.replace(/\s+/g, " ").trim().slice(0, 12000) }));
  const characters = clean.reduce((sum, page) => sum + page.text.length, 0);
  const status = characters >= Math.max(200, clean.length * 40) ? "ready" : "no_text";
  const now = new Date().toISOString();
  await db.batch([
    db.prepare("DELETE FROM book_pages WHERE file_id=?").bind(resource.fileId),
    db.prepare("INSERT INTO book_texts(file_id,organization_id,course_id,sha256,status,pages,characters,extracted_by,extracted_at) VALUES (?,?,?,?,?,?,?,?,?) ON CONFLICT(file_id) DO UPDATE SET sha256=excluded.sha256,status=excluded.status,pages=excluded.pages,characters=excluded.characters,extracted_by=excluded.extracted_by,extracted_at=excluded.extracted_at")
      .bind(resource.fileId, current.organizationId, courseId, file.sha256, status, clean.length, characters, current.id, now),
    ...(status === "ready" ? clean.filter(page => page.text).map(page => db.prepare("INSERT INTO book_pages(file_id,page,text) VALUES (?,?,?)").bind(resource.fileId, page.page, page.text)) : []),
  ]);
  if (status === "no_text") return reply({ error: "El PDF no tiene texto que se pueda leer." }, 422);
  return reply({ pages: clean.length, characters });
}

type ReadingRow = { id: string; unitId: string; unitName: string; groupId: string | null; resourceId: string; title: string; shareable: number; indexId: string | null; chapter: string | null; pages: string; required: number; note: string; position: number };
const readingColumns = `SELECT g.id,g.unit_id AS unitId,u.name AS unitName,g.group_id AS groupId,g.resource_id AS resourceId,r.title,r.shareable,g.index_id AS indexId,i.title AS chapter,g.pages,g.required,g.note,g.position
  FROM readings g JOIN learning_units u ON u.id=g.unit_id JOIN course_resources r ON r.id=g.resource_id LEFT JOIN resource_index i ON i.id=g.index_id`;

async function courseReadings(path: string, method: string, input: unknown, current: Member, db: Database, course: { id: string; status: string }, access: NonNullable<Awaited<ReturnType<typeof accessTo>>>, manage: boolean) {
  const readingId = readingPath.exec(path)?.[2] || null;
  if (method === "GET") {
    const rows = (await db.prepare(`${readingColumns} WHERE g.course_id=? AND g.organization_id=? ORDER BY u.position,g.position,g.created_at`).bind(course.id, current.organizationId).all<ReadingRow>()).results; // nosemgrep: sql-interpolated-text -- readingColumns es una consulta constante
    const visible = access.sections === "all" || access.configure ? rows : rows.filter(row => !row.groupId || access.assigned.includes(row.groupId));
    return reply({ readings: visible.map(readingView), canManage: manage });
  }
  if (!manage && method !== "POST") return reply({ error: "Solo administración y el equipo del curso gestionan las lecturas del curso." }, 403);
  return saveReading(method, input, current, db, course, access, readingId, null);
}

async function sectionReadings(db: Database, organizationId: string, courseId: string, section: { id: string; name: string; status: string }, access: NonNullable<Awaited<ReturnType<typeof accessTo>>>, manage: boolean) {
  if (access.sections !== "all" && !access.configure && !teachesSection(access, section.id)) return reply({ error: "Esta sección no está asignada a tu cuenta." }, 403);
  const rows = (await db.prepare(`${readingColumns} WHERE g.course_id=? AND g.organization_id=? AND (g.group_id IS NULL OR g.group_id=?) ORDER BY u.position,g.position`).bind(courseId, organizationId, section.id).all<ReadingRow>()).results; // nosemgrep: sql-interpolated-text -- readingColumns es una consulta constante
  const learners = (await db.prepare("SELECT id,display_name AS name FROM group_learners WHERE group_id=? AND status='active' ORDER BY display_name").bind(section.id).all<{ id: string; name: string }>()).results;
  const marks = rows.length ? (await db.prepare(`SELECT reading_id AS readingId,learner_id AS learnerId FROM reading_marks WHERE group_id=?`).bind(section.id).all<{ readingId: string; learnerId: string }>()).results : [];
  const required = rows.filter(row => row.required);
  const read = required.reduce((sum, row) => sum + marks.filter(mark => mark.readingId === row.id).length, 0);
  const percent = required.length && learners.length ? Math.round(read / (required.length * learners.length) * 100) : null;
  return reply({
    readings: rows.map(readingView),
    progress: { required: required.length, learners: learners.length, percent },
    learners: learners.map(learner => ({ id: learner.id, name: learner.name, read: marks.filter(mark => mark.learnerId === learner.id).map(mark => mark.readingId) })),
    canManage: manage,
  });
}
const readingView = (row: ReadingRow) => ({ id: row.id, unitId: row.unitId, unitName: row.unitName, groupId: row.groupId, resourceId: row.resourceId, title: row.title, shareable: !!row.shareable, indexId: row.indexId, chapter: row.chapter, pages: row.pages, required: !!row.required, note: row.note, position: row.position, ...(row.groupId ? { own: true } : {}) });

async function saveReading(method: string, input: unknown, current: Member, db: Database, course: { id: string; status: string }, access: NonNullable<Awaited<ReturnType<typeof accessTo>>>, readingId: string | null, forcedGroup: string | null) {
  if (course.status !== "active") return reply({ error: "Restaura el curso antes de cambiar sus lecturas." }, 409);
  const body = input && typeof input === "object" ? input as Record<string, unknown> : {};
  if (method === "DELETE" && readingId) {
    const row = await db.prepare("SELECT id,group_id AS groupId,resource_id AS resourceId FROM readings WHERE id=? AND course_id=?").bind(readingId, course.id).first<{ id: string; groupId: string | null; resourceId: string }>();
    if (!row) return reply({ error: "Lectura no disponible." }, 404);
    if (row.groupId && !teachesSection(access, row.groupId) && !access.configure && !access.edit) return reply({ error: "Solo quien imparte la sección quita su lectura." }, 403);
    await db.prepare("DELETE FROM readings WHERE id=?").bind(readingId).run();
    return reply({ ok: true });
  }
  const groupId = forcedGroup || (typeof body.groupId === "string" ? body.groupId : null);
  const editing = access.edit || access.configure;
  if (groupId) {
    if (!teachesSection(access, groupId) && !access.configure) return reply({ error: "Solo quien imparte la sección agrega sus lecturas." }, 403);
    const settings = await configurationOf(db, current.organizationId, course.id);
    if (settings?.settings.sectionFreedom === "shared") return reply({ error: "Con «Igual en todas las secciones» las lecturas son del curso." }, 409);
  } else if (!editing) return reply({ error: "Solo administración y el equipo del curso gestionan las lecturas del curso." }, 403);
  const unitId = typeof body.unitId === "string" ? body.unitId : "";
  const resourceId = typeof body.resourceId === "string" ? body.resourceId : "";
  const unit = await db.prepare("SELECT id FROM learning_units WHERE id=? AND course_id=? AND status='active'").bind(unitId, course.id).first();
  const resource = await db.prepare("SELECT id,title,status FROM course_resources WHERE id=? AND course_id=? AND status<>'archived'").bind(resourceId, course.id).first<{ id: string; title: string; status: string }>();
  if (!unit || !resource) return reply({ error: "Elige una unidad y un recurso del curso." }, 400);
  const pages = typeof body.pages === "string" ? body.pages.trim().slice(0, 80) : "";
  const note = typeof body.note === "string" ? body.note.trim().slice(0, 300) : "";
  const required = body.required === false ? 0 : 1;
  const indexId = typeof body.indexId === "string" ? `${resourceId}-${body.indexId}` : null;
  if (indexId && !await db.prepare("SELECT id FROM resource_index WHERE id=? AND resource_id=?").bind(indexId, resourceId).first()) return reply({ error: "Ese capítulo no está en el índice." }, 400);
  const now = new Date().toISOString();
  const id = readingId || `reading-${crypto.randomUUID()}`;
  if (readingId) {
    await db.prepare("UPDATE readings SET unit_id=?,resource_id=?,index_id=?,pages=?,required=?,note=? WHERE id=? AND course_id=?").bind(unitId, resourceId, indexId, pages, required, note, id, course.id).run();
  } else {
    const position = (await db.prepare("SELECT COALESCE(max(position),-1)+1 AS position FROM readings WHERE unit_id=? AND group_id IS ?").bind(unitId, groupId).first<{ position: number }>())?.position || 0;
    await db.prepare("INSERT INTO readings(id,organization_id,course_id,unit_id,group_id,resource_id,index_id,pages,required,note,position,created_by,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)")
      .bind(id, current.organizationId, course.id, unitId, groupId, resourceId, indexId, pages, required, note, position, current.id, now).run();
  }
  return reply({ id }, readingId ? 200 : 201);
}

/** What a student of the section may read, and marking their own reading. */
export async function studentReadings(path: string, method: string, db: Database, access: { groupId: string; organizationId: string; courseId: string; learnerId: string | null }) {
  const mark = /^\/api\/student\/readings\/(reading-[a-z0-9-]+)\/mark$/.exec(path);
  if (path === "/api/student/readings" && method === "GET") {
    const rows = (await db.prepare(`${readingColumns} WHERE g.course_id=? AND (g.group_id IS NULL OR g.group_id=?) AND r.shareable=1 AND r.status='published' ORDER BY u.position,g.position`).bind(access.courseId, access.groupId).all<ReadingRow>()).results; // nosemgrep: sql-interpolated-text -- readingColumns es una consulta constante
    const marks = access.learnerId ? (await db.prepare("SELECT reading_id AS readingId FROM reading_marks WHERE learner_id=? AND group_id=?").bind(access.learnerId, access.groupId).all<{ readingId: string }>()).results : [];
    return reply({ readings: rows.map(row => ({ ...readingView(row), read: marks.some(item => item.readingId === row.id) })) });
  }
  if (mark && method === "POST") {
    if (!access.learnerId) return reply({ error: "Elige tu nombre para marcar la lectura." }, 400);
    const reading = await db.prepare("SELECT g.id FROM readings g JOIN course_resources r ON r.id=g.resource_id WHERE g.id=? AND g.course_id=? AND (g.group_id IS NULL OR g.group_id=?) AND r.shareable=1 AND r.status='published'").bind(mark[1], access.courseId, access.groupId).first();
    if (!reading) return reply({ error: "Esa lectura no está disponible para tu sección." }, 404);
    await db.prepare("INSERT INTO reading_marks(reading_id,learner_id,group_id,read_at) VALUES (?,?,?,?) ON CONFLICT(reading_id,learner_id) DO UPDATE SET read_at=excluded.read_at").bind(mark[1], access.learnerId, access.groupId, new Date().toISOString()).run();
    return reply({ ok: true });
  }
  return null;
}

/** APA 7 of the resources that have a role. A handwritten citation is marked. */
export async function apaOf(db: Database, organizationId: string, courseId: string) {
  const rows = (await rowsOf(db, organizationId, courseId)).filter(row => row.role && row.status !== "archived");
  const entries = rows.map(row => ({ role: row.role!, citation: citation({ type: row.type, title: row.title, authors: JSON.parse(row.authors), year: row.year, metadata: JSON.parse(row.metadata), citationOverride: row.citationOverride }, "apa7"), manual: !!row.citationOverride }));
  return { ...apaBibliography(entries), entries };
}
