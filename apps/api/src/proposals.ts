import type { Member, ProposalJob, ProposalReadiness } from "@happy-learners/contracts";
import {
  draftFromOutput, educationLevels, fixtureGenerator, lessonMinutes, maxExcerpt, maxProposalItems, packageOf, proposalBatch, proposalProblem, proposalPromptVersion, sourceCitationVerified, sourceQuote,
  relevantPages, sequenceOf, sharePrefix, validActivities,
} from "@happy-learners/domain";
import type { ProposalInput, ProposalOutput } from "@happy-learners/domain";
import type { Database } from "./storage";
import { accessTo } from "./access";
import { configurationOf } from "./courses";
import { referencesOf } from "./bibliography";
import { digest } from "./auth";
import { openAiGenerator, openAiSettings, TransientError } from "./openai";
import { aiBudgetOf, aiBudgetSpent, tracked } from "./ai-runs";
import { confirmedMap } from "./book-map";

declare global { interface Env { LESSON_GENERATOR?: string } }

/**
 * «Proponer lecciones» (rebanada 5a). GET /api/courses/:id/proposals says whether the course is ready (outcomes, a
 * didactic sequence, a usable main book whose text was read) and lists its jobs; PUT …/proposals/book-text stores the
 * main book's text, read page by page in the browser; POST …/proposals asks for one draft per outcome in a module;
 * POST …/proposals/:job/retry puts failed items back in the queue. The work itself never runs in a request: the
 * organization's Durable Object alarm processes it in batches (processProposals). Drafts are never published.
 */
const reply = (value: unknown, status = 200) => Response.json(value, { status });
const listPath = /^\/api\/courses\/([a-z0-9-]+)\/proposals$/;
const textPath = /^\/api\/courses\/([a-z0-9-]+)\/proposals\/book-text$/;
const retryPath = /^\/api\/courses\/([a-z0-9-]+)\/proposals\/(proposal-[a-f0-9-]{36})\/retry$/;
export const bookTextPath = textPath;

export function proposalMethods(path: string): string[] | null {
  if (listPath.test(path)) return ["GET", "POST"];
  if (textPath.test(path)) return ["PUT"];
  if (retryPath.test(path)) return ["POST"];
  return null;
}

/** Which generator this environment offers: OpenAI with its secret and model, the local fixture when asked, or none. */
export function generatorKind(env: Env): "openai" | "fixture" | null {
  if (openAiSettings(env)) return "openai";
  return env.LESSON_GENERATOR === "fixture" ? "fixture" : null;
}

type Book = { fileId: string; title: string; sha256: string; text: "ready" | "no_text" | "missing" | "stale"; pages: number };
export async function readiness(db: Database, env: Env, organizationId: string, courseId: string): Promise<ProposalReadiness & { book: Book | null; sequenceId: string }> {
  const configuration = await configurationOf(db, organizationId, courseId);
  const sequence = sequenceOf(configuration!.settings.defaultSequence);
  const [outcomes, units] = await db.batch([
    db.prepare("SELECT o.id,o.statement,l.code FROM course_outcomes o LEFT JOIN course_package_links l ON l.outcome_id=o.id AND l.kind='indicator' WHERE o.course_id=? AND o.status='active' ORDER BY o.position,o.id").bind(courseId),
    db.prepare("SELECT id,name FROM learning_units WHERE course_id=? AND status='active' ORDER BY position,id").bind(courseId),
  ]) as unknown as [{ id: string; statement: string; code: string | null }[], { id: string; name: string }[]];
  const primary = (await referencesOf(db, organizationId, courseId)).find(reference => reference.primary) || null;
  let book: Book | null = null;
  if (primary && primary.kind === "file" && primary.mediaType === "application/pdf" && primary.status === "published") {
    const file = await db.prepare("SELECT f.sha256,t.status,t.sha256 AS textSha,t.pages FROM course_files f LEFT JOIN book_texts t ON t.file_id=f.id WHERE f.id=? AND f.organization_id=?").bind(primary.itemId, organizationId).first<{ sha256: string; status: "ready" | "no_text" | null; textSha: string | null; pages: number | null }>();
    if (file) book = { fileId: primary.itemId, title: primary.title, sha256: file.sha256, pages: file.pages || 0, text: !file.status ? "missing" : file.textSha !== file.sha256 ? "stale" : file.status };
  }
  const generator = generatorKind(env);
  const blockers = [
    ...(outcomes.length ? [] : ["Asocia al menos un indicador al plan curricular del curso."]),
    ...(!primary ? ["Marca un libro principal en la bibliografía del curso."] : !book ? ["El libro principal debe ser un PDF publicado de la biblioteca del curso."] : []),
    ...(book?.text === "no_text" ? ["El PDF del libro principal no tiene texto que se pueda leer (parece escaneado). Sube una versión con texto; la plataforma no hace reconocimiento de imágenes."] : []),
    ...(units.length ? [] : ["Crea al menos un módulo en el contenido del curso para recibir las lecciones."]),
    ...(generator ? [] : ["La generación de lecciones no está configurada en este entorno."]),
  ];
  return { outcomes, units, sequence: { id: sequence.value, label: sequence.label }, sequenceId: sequence.value, book, bookText: book?.text || null, generator, blockers };
}

async function jobsOf(db: Database, courseId: string): Promise<ProposalJob[]> {
  const [jobs, items] = await db.batch([
    db.prepare("SELECT j.id,j.unit_id AS unitId,u.name AS unitName,j.generator,j.created_at AS createdAt,COALESCE(r.display_name,r.username) AS requestedBy FROM proposal_jobs j JOIN learning_units u ON u.id=j.unit_id JOIN users r ON r.id=j.requested_by WHERE j.course_id=? ORDER BY j.created_at DESC LIMIT 10").bind(courseId),
    db.prepare("SELECT i.id,i.job_id AS jobId,i.outcome_id AS outcomeId,o.statement,i.status,i.error,i.pages,i.lesson_id AS lessonId,json_extract(l.content,'$.title') AS lessonTitle FROM proposal_items i JOIN course_outcomes o ON o.id=i.outcome_id LEFT JOIN lessons l ON l.id=i.lesson_id WHERE i.course_id=? ORDER BY i.position").bind(courseId),
  ]) as unknown as [Omit<ProposalJob, "items">[], (ProposalJob["items"][number] & { jobId: string; pages: string })[]];
  return jobs.map(job => ({ ...job, items: items.filter(item => item.jobId === job.id).map(({ jobId: _, pages, ...item }) => ({ ...item, pages: JSON.parse(pages) as number[] })) }));
}

export async function proposals(path: string, method: string, input: unknown, current: Member, db: Database, env: Env, wake: () => Promise<void>): Promise<Response> {
  const courseId = (listPath.exec(path) || textPath.exec(path) || retryPath.exec(path))![1];
  const course = await db.prepare("SELECT id,title,status,legacy_program_id AS programId FROM courses WHERE id=? AND organization_id=?").bind(courseId, current.organizationId).first<{ id: string; title: string; status: string; programId: string }>();
  if (!course) return reply({ error: "Curso no disponible." }, 404);
  const access = await accessTo(db, current, courseId);
  if (!access) return reply({ error: "Este curso no está asignado a tu cuenta." }, 403);
  const state = await readiness(db, env, current.organizationId, courseId);
  const canPropose = access.edit && course.status === "active";
  const view = async () => { const { book, sequenceId: _, ...rest } = state; return { ...rest, book: book && { fileId: book.fileId, title: book.title, pages: book.pages, sha256: book.sha256 }, jobs: await jobsOf(db, courseId), canPropose }; };
  if (method === "GET") return reply(await view());
  if (!canPropose) return reply({ error: course.status !== "active" ? "Restaura el curso antes de proponer lecciones." : "Solo el equipo docente del curso propone sus lecciones." }, 403);
  // AIG-6: no new proposals once the month's AI budget is used; saving the book's text is not AI.
  if (!textPath.test(path) && (await aiBudgetOf(db, current.organizationId, env)).level === "exhausted") return aiBudgetSpent();
  const now = new Date().toISOString();

  if (textPath.test(path)) {
    // The browser read the main book with pdf.js; the platform keeps its text per page, never parsing PDFs itself.
    const value = input && typeof input === "object" ? input as Record<string, unknown> : {};
    if (!state.book || value.fileId !== state.book.fileId || value.sha256 !== state.book.sha256) return reply({ error: "El libro principal cambió. Recarga y vuelve a intentar." }, 409);
    const pages = Array.isArray(value.pages) ? value.pages : null;
    if (!pages || pages.length > 1000 || pages.some((page, index) => !page || typeof page !== "object" || (page as Record<string, unknown>).page !== index + 1 || typeof (page as Record<string, unknown>).text !== "string")) return reply({ error: "Revisa el texto del libro: las páginas deben venir completas y en orden." }, 400);
    const clean = (pages as { page: number; text: string }[]).map(page => ({ page: page.page, text: page.text.replace(/\s+/g, " ").trim().slice(0, 12000) }));
    const characters = clean.reduce((sum, page) => sum + page.text.length, 0);
    // A scanned book has (almost) no text layer: fewer than 40 characters per page on average.
    const status = characters >= Math.max(200, clean.length * 40) ? "ready" : "no_text";
    await db.batch([
      db.prepare("DELETE FROM book_pages WHERE file_id=?").bind(state.book.fileId),
      db.prepare("INSERT INTO book_texts(file_id,organization_id,course_id,sha256,status,pages,characters,extracted_by,extracted_at) VALUES (?,?,?,?,?,?,?,?,?) ON CONFLICT(file_id) DO UPDATE SET sha256=excluded.sha256,status=excluded.status,pages=excluded.pages,characters=excluded.characters,extracted_by=excluded.extracted_by,extracted_at=excluded.extracted_at")
        .bind(state.book.fileId, current.organizationId, courseId, state.book.sha256, status, clean.length, characters, current.id, now),
      ...(status === "ready" ? clean.filter(page => page.text).map(page => db.prepare("INSERT INTO book_pages(file_id,page,text) VALUES (?,?,?)").bind(state.book!.fileId, page.page, page.text)) : []),
    ]);
    if (status === "no_text") return reply({ error: "El PDF del libro principal no tiene texto que se pueda leer (parece escaneado). Sube una versión con texto; la plataforma no hace reconocimiento de imágenes." }, 422);
    return reply({ pages: clean.length, characters });
  }

  const retry = retryPath.exec(path);
  if (retry) {
    if (state.blockers.length) return reply({ error: state.blockers[0], blockers: state.blockers }, 409);
    const reset = await db.prepare("UPDATE proposal_items SET status='queued',error=NULL,attempts=0,started_at=NULL WHERE job_id=? AND course_id=? AND status='error' AND pages<>'[]' RETURNING id").bind(retry[2], courseId).all<{ id: string }>();
    if (!reset.results.length) return reply({ error: "No hay propuestas con error que se puedan reintentar." }, 409);
    await wake();
    return reply(await view(), 202);
  }

  if (state.blockers.length || !state.book || state.bookText !== "ready") return reply({ error: state.blockers[0] || "Lee primero el texto del libro principal.", blockers: state.blockers }, 409);
  const value = input && typeof input === "object" ? input as Record<string, unknown> : {};
  // «plan»: each lesson goes to the module whose plan works on its indicator (the first active one), or the first
  // module when no module plans it; otherwise, every lesson goes to the module chosen.
  const byPlan = value.unitId === "plan", chosen = state.units.find(item => item.id === value.unitId);
  if (!byPlan && !chosen) return reply({ error: "Elige el módulo que recibirá las lecciones." }, 400);
  const ids = value.outcomeIds;
  if (!Array.isArray(ids) || !ids.length || ids.length > maxProposalItems || new Set(ids).size !== ids.length || ids.some(id => !state.outcomes.some(outcome => outcome.id === id))) return reply({ error: `Elige de 1 a ${maxProposalItems} indicadores activos del plan curricular.` }, 400);
  const minutes = value.minutes === undefined ? 45 : Number(value.minutes);
  if (!Number.isInteger(minutes) || minutes < 10 || minutes > 300) return reply({ error: "La duración de cada clase va de 10 a 300 minutos." }, 400);
  const requested = Array.isArray(value.resourceIds) ? [...new Set(value.resourceIds.filter((id): id is string => typeof id === "string"))] : [];
  const sources = requested.length ? (await db.prepare(`SELECT r.id AS resourceId,r.file_id AS fileId,r.title FROM course_resources r WHERE r.course_id=? AND r.organization_id=? AND r.status<>'archived' AND r.id IN (${requested.map(() => "?").join(",")}) AND EXISTS (SELECT 1 FROM book_maps m JOIN course_files f ON f.sha256=m.sha256 AND f.id=r.file_id WHERE m.course_id=r.course_id AND m.status='confirmed' AND m.pages<>'[]')`).bind(courseId, current.organizationId, ...requested).all<{ resourceId: string; fileId: string; title: string }>()).results : []; // nosemgrep: sql-interpolated-text -- los ? son parámetros, no texto
  if (requested.length && sources.length !== requested.length) return reply({ error: "Solo puedes usar recursos indexados de este curso." }, 400);
  const planned = byPlan ? (await db.prepare("SELECT o.outcome_id AS outcomeId,o.unit_id AS unitId FROM unit_outcomes o JOIN learning_units u ON u.id=o.unit_id WHERE o.course_id=? AND u.status='active' ORDER BY u.position,u.id").bind(courseId).all<{ outcomeId: string; unitId: string }>()).results : [];
  const unitOf = (outcomeId: string) => chosen || state.units.find(item => item.id === planned.find(row => row.outcomeId === outcomeId)?.unitId) || state.units[0];

  // The book's pages that match each outcome, found now so the person sees where each lesson will come from.
  const pages = (await db.prepare("SELECT page,text FROM book_pages WHERE file_id=? ORDER BY page").bind(state.book.fileId).all<{ page: number; text: string }>()).results;
  const contents = await contentsOf(db, courseId), confirmed = await confirmedMap(db, courseId, state.book.sha256);
  const generator = state.generator!;
  const items = await Promise.all((ids as string[]).map(async (outcomeId, position) => {
    const outcome = state.outcomes.find(item => item.id === outcomeId)!, unit = unitOf(outcomeId);
    // The team's confirmed map wins over the search; an empty, confirmed list means the book does not cover it.
    const found = confirmed.get(outcomeId) ?? relevantPages([outcome.statement, ...(contents.get(outcomeId) || [])].join(" "), pages).map(page => page.page);
    // Retrying the same request (same outcome, module, book, instructions and generator) never makes a second lesson.
    const base = [courseId, unit.id, outcomeId, state.book!.sha256, proposalPromptVersion, generator, minutes, found.join(",")].join("|");
    const key = await digest(sources.length ? `${base}|${sources.map(source => source.resourceId).sort().join(",")}` : base);
    return { id: `item-${crypto.randomUUID()}`, outcomeId, position, key, pages: found, unit };
  }));
  const existing = new Set((await db.prepare(`SELECT idempotency_key AS key FROM proposal_items WHERE idempotency_key IN (${items.map(() => "?").join(",")})`).bind(...items.map(item => item.key)).all<{ key: string }>()).results.map(row => row.key));
  const fresh = items.filter(item => !existing.has(item.key));
  if (!fresh.length) return reply({ error: "Esas lecciones ya se propusieron con este libro. Revisa los borradores o reintenta las que tuvieron error.", ...(await view()) }, 409);
  // One job per module: each job's lessons are drafts of that module.
  const groups = [...new Map(fresh.map(item => [item.unit.id, item.unit])).values()].map(unit => ({ unit, job: `proposal-${crypto.randomUUID()}`, items: fresh.filter(item => item.unit.id === unit.id) }));
  await db.batch([
    ...groups.flatMap(({ unit, job, items: own }) => [
      db.prepare("INSERT INTO proposal_jobs(id,organization_id,course_id,unit_id,book_file_id,sequence,minutes,generator,requested_by,created_at,sources) VALUES (?,?,?,?,?,?,?,?,?,?,?)").bind(job, current.organizationId, courseId, unit.id, state.book!.fileId, state.sequenceId, minutes, generator, current.id, now, JSON.stringify(sources.map(source => ({ resourceId: source.resourceId, fileId: source.fileId, title: source.title })))),
      ...own.map((item, index) => db.prepare("INSERT INTO proposal_items(id,job_id,organization_id,course_id,outcome_id,position,idempotency_key,status,error,pages) VALUES (?,?,?,?,?,?,?,?,?,?) ON CONFLICT(idempotency_key) DO NOTHING")
        .bind(item.id, job, current.organizationId, courseId, item.outcomeId, index, item.key, item.pages.length ? "queued" : "error", item.pages.length ? null : confirmed.has(item.outcomeId) ? "En el mapa del libro marcaron que el libro no trata este indicador." : "El libro principal no parece tratar este indicador: no se encontraron páginas.", JSON.stringify(item.pages))),
    ]),
    db.prepare("INSERT INTO activity_events(id,organization_id,actor_id,action,target_type,target_id,course_id,group_id,summary,occurred_at) VALUES (?,?,?,'planned','course',?,?,NULL,?,?)")
      .bind(`event-${crypto.randomUUID()}`, current.organizationId, current.id, courseId, courseId, `Pidió ${fresh.length === 1 ? "1 propuesta de lección" : `${fresh.length} propuestas de lecciones`} para ${groups.map(group => `«${group.unit.name}»`).join(", ")}`.slice(0, 240), now),
  ]);
  await wake();
  return reply({ ...(await view()), skipped: items.length - fresh.length }, 202);
}

/** The CNB contents of each outcome taken from a curriculum package, by outcome id. */
export async function contentsOf(db: Database, courseId: string) {
  const links = (await db.prepare("SELECT outcome_id AS outcomeId,package_id AS packageId,code FROM course_package_links WHERE course_id=? AND kind='indicator'").bind(courseId).all<{ outcomeId: string; packageId: string; code: string }>()).results;
  return new Map(links.map(link => [link.outcomeId, packageOf(link.packageId)?.competencies.flatMap(competency => competency.indicators).find(indicator => indicator.code === link.code)?.contents || []]));
}

type Item = { id: string; jobId: string; courseId: string; outcomeId: string; pages: string; attempts: number; startedAt: string; unitId: string; unitName: string; legacyUnitId: string | null; bookFileId: string; sequence: string; minutes: number; generator: "fixture" | "openai"; requestedBy: string; organizationId: string; sources: string };

/**
 * One batch of the organization's queued proposals, run by its Durable Object alarm: claim an item, ask the generator,
 * turn the answer into a lesson and, in one transaction, create the draft and mark the item done. True when work remains.
 */
export async function processProposals(db: Database, env: Env, scope: string): Promise<boolean> {
  // AIG-6: with the month's budget used, the queue waits; asking again next month wakes it.
  if ((await aiBudgetOf(db, scope, env)).level === "exhausted") return false;
  const now = () => new Date().toISOString();
  // An item left running by an interrupted wake goes back to the queue; its lesson was never written.
  await db.prepare("UPDATE proposal_items SET status='queued' WHERE status='running' AND started_at<?").bind(new Date(Date.now() - 10 * 60_000).toISOString()).run();
  const queued = (await db.prepare(`SELECT i.id,i.job_id AS jobId,i.course_id AS courseId,i.outcome_id AS outcomeId,i.pages,i.attempts,j.unit_id AS unitId,u.name AS unitName,u.legacy_unit_id AS legacyUnitId,j.book_file_id AS bookFileId,
    j.sequence,j.minutes,j.generator,j.requested_by AS requestedBy,j.organization_id AS organizationId,j.sources FROM proposal_items i JOIN proposal_jobs j ON j.id=i.job_id JOIN learning_units u ON u.id=j.unit_id
    WHERE i.status='queued' AND j.organization_id=? ORDER BY j.created_at,i.position LIMIT ?`).bind(scope, proposalBatch).all<Omit<Item, "startedAt">>()).results;
  for (const row of queued) {
    const startedAt = now();
    // Claim it: only one wake moves an item from queued to running.
    if (!await db.prepare("UPDATE proposal_items SET status='running',attempts=attempts+1,started_at=? WHERE id=? AND status='queued' RETURNING id").bind(startedAt, row.id).first()) continue;
    await propose({ ...row, attempts: row.attempts + 1, startedAt }, db, env);
  }
  return !!await db.prepare("SELECT 1 FROM proposal_items i JOIN proposal_jobs j ON j.id=i.job_id WHERE i.status='queued' AND j.organization_id=? LIMIT 1").bind(scope).first();
}

const fail = (db: Database, item: Item, message: string, retry = false) =>
  db.prepare("UPDATE proposal_items SET status=?,error=?,finished_at=? WHERE id=? AND status='running' AND started_at=?").bind(retry ? "queued" : "error", retry ? null : message, new Date().toISOString(), item.id, item.startedAt).run();

async function sourceInputs(db: Database, item: Item): Promise<NonNullable<ProposalInput["sources"]>> {
  const stored = JSON.parse(item.sources || "[]") as { resourceId: string; fileId: string; title: string }[];
  const built = [];
  for (const source of stored) {
    const confirmed = await db.prepare("SELECT m.pages FROM book_maps m JOIN course_files f ON f.sha256=m.sha256 AND f.id=? WHERE m.course_id=? AND m.outcome_id=? AND m.status='confirmed'").bind(source.fileId, item.courseId, item.outcomeId).first<{ pages: string }>();
    const pages = (confirmed ? JSON.parse(confirmed.pages) as number[] : []).slice(0, 3);
    const index = pages.length ? await db.prepare("SELECT title,start_page AS startPage,end_page AS endPage FROM resource_index WHERE resource_id=? AND start_page IS NOT NULL ORDER BY position").bind(source.resourceId).all<{ title: string; startPage: number; endPage: number | null }>() : { results: [] as { title: string; startPage: number; endPage: number | null }[] };
    const chapter = index.results.find(entry => pages.some(page => page >= entry.startPage && page <= (entry.endPage ?? entry.startPage)))?.title || null;
    const texts = pages.length ? (await db.prepare(`SELECT page,text FROM book_pages WHERE file_id=? AND page IN (${pages.map(() => "?").join(",")}) ORDER BY page`).bind(source.fileId, ...pages).all<{ page: number; text: string }>()).results : []; // nosemgrep: sql-interpolated-text -- los ? son parámetros, no texto
    built.push({ resourceId: source.resourceId, fileId: source.fileId, title: source.title, chapter, pages, excerpt: texts.map(page => `[p. ${page.page}] ${page.text}`).join("\n").slice(0, maxExcerpt) });
  }
  return built;
}

async function propose(item: Item, db: Database, env: Env) {
  const settings = openAiSettings(env);
  const generator = item.generator === "fixture" ? fixtureGenerator : settings ? openAiGenerator(settings) : null;
  if (!generator) return fail(db, item, "La generación de lecciones ya no está configurada en este entorno.");
  const [outcome, course, book] = await db.batch([
    db.prepare("SELECT o.id,o.statement,o.status,c.name AS competency,l.code FROM course_outcomes o LEFT JOIN course_competencies c ON c.id=o.competency_id LEFT JOIN course_package_links l ON l.outcome_id=o.id AND l.kind='indicator' WHERE o.id=? AND o.course_id=?").bind(item.outcomeId, item.courseId),
    db.prepare("SELECT title,level,legacy_program_id AS programId FROM courses WHERE id=? AND status='active'").bind(item.courseId),
    db.prepare("SELECT substr(original_name,1,length(original_name)-length(extension)-1) AS title FROM course_files WHERE id=?").bind(item.bookFileId),
  ]) as unknown as [{ id: string; statement: string; status: string; competency: string | null; code: string | null }[], { title: string; level: string; programId: string }[], { title: string }[]];
  if (!outcome[0] || outcome[0].status !== "active" || !course[0] || !book[0]) return fail(db, item, "El curso, el indicador o el libro ya no están disponibles.");
  const pages = JSON.parse(item.pages) as number[];
  const texts = (await db.prepare(`SELECT page,text FROM book_pages WHERE file_id=? AND page IN (${pages.map(() => "?").join(",") || "NULL"}) ORDER BY page`).bind(item.bookFileId, ...pages).all<{ page: number; text: string }>()).results;
  const sequence = sequenceOf(item.sequence);
  const input: ProposalInput = {
    course: course[0].title, grade: educationLevels.find(level => level.value === course[0].level)?.label || course[0].level, minutes: item.minutes,
    sequence: { label: sequence.label, phases: sequence.phases.map(({ id, label, hint }) => ({ id, label, hint })) },
    outcome: { id: outcome[0].id, statement: outcome[0].statement, code: outcome[0].code, competency: outcome[0].competency, contents: (await contentsOf(db, item.courseId)).get(item.outcomeId) || [] },
    book: { title: book[0].title, fileId: item.bookFileId, pages, excerpt: texts.map(page => `[p. ${page.page}] ${page.text}`).join("\n").slice(0, maxExcerpt) },
    sources: await sourceInputs(db, item),
  };
  if (!input.sources?.length) delete input.sources;
  let output: ProposalOutput;
  try {
    output = await tracked(db, {
      organizationId: item.organizationId, userId: item.requestedBy, courseId: item.courseId, task: "lesson-proposal", promptVersion: proposalPromptVersion,
      generator: generator.kind, model: generator.kind === "openai" ? settings!.model : "fixture", inputChars: JSON.stringify(input).length,
    }, observe => generator.generate(input, observe));
  }
  catch (error) {
    // Rate limits and outages get two more tries on later wakes; anything else is reported, without internals.
    const transient = error instanceof TransientError && item.attempts < 3;
    console.error(JSON.stringify({ event: "proposal_failed", item: item.id, transient, cause: error instanceof Error ? error.message.slice(0, 120) : "unknown" }));
    return fail(db, item, "El generador no respondió. Vuelve a intentar en unos minutos.", transient);
  }
  const draft = draftFromOutput(output, input);
  const problem = proposalProblem(draft, input) || (validActivities(draft.activities) ? null : "La propuesta no cumple el formato de una lección.");
  if (problem) return fail(db, item, `${problem} Vuelve a intentar.`, item.attempts < 2);
  const id = `lesson-${crypto.randomUUID()}`, at = new Date().toISOString();
  const lesson = {
    id, title: draft.title, objective: draft.objective, program: item.unitName, courseId: item.courseId, courseUnitId: item.unitId, duration: lessonMinutes({ activities: draft.activities }),
    materials: [], reflection: "¿Qué aprendiste y cómo lo aplicarías?", activities: draft.activities, publishedAt: "", sequence: item.sequence, outcomeIds: [item.outcomeId],
    // Provenance travels with the lesson: the editor and the content say it is a proposal until a person publishes it.
    generated: { source: generator.kind, model: generator.kind === "openai" ? settings!.model : "fixture", pages, indicator: outcome[0].code, at: new Date().toISOString(),
      ...(input.sources?.length ? { resources: input.sources.map(source => ({ resourceId: source.resourceId, title: source.title, chapter: source.chapter, pages: source.pages, verified: sourceCitationVerified(sourceQuote(source.excerpt), source.excerpt.replace(/\[p\. \d+\]\s*/g, "")) })) } : {}) },
    shareCode: sharePrefix(item.organizationId) + crypto.randomUUID().replaceAll("-", "").slice(0, 16).toUpperCase(),
  };
  // The draft and the item's state are one transaction: a retried or concurrent wake never writes a second lesson.
  await db.guardedBatch(db.prepare("UPDATE proposal_items SET status='done',lesson_id=?,error=NULL,finished_at=? WHERE id=? AND status='running' AND started_at=? RETURNING id").bind(id, at, item.id, item.startedAt), [
    db.prepare("INSERT INTO lessons(id,program_id,status,content,unit_id,course_unit_id,position,updated_at) VALUES (?,?,'draft',?,?,?,(SELECT count(*) FROM lessons WHERE course_unit_id=?),?)")
      .bind(id, course[0].programId, JSON.stringify(lesson), item.legacyUnitId, item.unitId, item.unitId, at),
    db.prepare("INSERT INTO activity_events(id,organization_id,actor_id,action,target_type,target_id,course_id,group_id,summary,occurred_at) VALUES (?,?,?,'created','lesson',?,?,NULL,?,?)")
      .bind(`event-${crypto.randomUUID()}`, item.organizationId, item.requestedBy, id, item.courseId, `Recibió la propuesta de lección «${draft.title.slice(0, 120)}» (borrador)`, at),
  ]);
}
