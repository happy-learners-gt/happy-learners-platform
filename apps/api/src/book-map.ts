import type { BookMapView, Member } from "@happy-learners/contracts";
import { fixtureMapper, mapCandidatePages, mapPromptVersion, maxCandidateText, pagesInput, relevantPages, verifiedPages } from "@happy-learners/domain";
import type { MapEvidence, MapSource } from "@happy-learners/domain";
import type { Database } from "./storage";
import { accessTo } from "./access";
import { contentsOf, generatorKind, readiness } from "./proposals";
import { openAiMapper, openAiSettings, TransientError } from "./openai";
import { aiBudgetOf, aiBudgetSpent, tracked } from "./ai-runs";

/**
 * The book map (rebanada 5b): GET /api/courses/:id/book-map shows, for the main book and each indicator of the plan,
 * the candidate and chosen pages with their evidence; POST …/book-map searches the book again (keeping what the team
 * confirmed); POST …/book-map/check asks a language model (or the local fixture) to confirm the candidates, in the
 * Durable Object alarm; PUT …/book-map/outcomes/:outcomeId sets and confirms an indicator's pages; POST
 * …/book-map/confirm confirms every proposed row. Lesson proposals use the confirmed pages.
 */
const reply = (value: unknown, status = 200) => Response.json(value, { status });
const mapPath = /^\/api\/courses\/([a-z0-9-]+)\/book-map$/;
const checkPath = /^\/api\/courses\/([a-z0-9-]+)\/book-map\/(check|confirm)$/;
const outcomePath = /^\/api\/courses\/([a-z0-9-]+)\/book-map\/outcomes\/([a-z0-9-]+)$/;

export function bookMapMethods(path: string): string[] | null {
  if (mapPath.test(path)) return ["GET", "POST"];
  if (checkPath.test(path)) return ["POST"];
  if (outcomePath.test(path)) return ["PUT"];
  return null;
}

type Row = { outcomeId: string; candidates: string; pages: string; evidence: string; source: MapSource; status: "proposed" | "confirmed"; aiStatus: BookMapView["outcomes"][number]["aiStatus"]; aiError: string | null };
const rowsOf = (db: Database, courseId: string, sha: string) =>
  db.prepare("SELECT outcome_id AS outcomeId,candidates,pages,evidence,source,status,ai_status AS aiStatus,ai_error AS aiError FROM book_maps WHERE course_id=? AND sha256=?").bind(courseId, sha).all<Row>().then(result => result.results);

/** The confirmed pages of each indicator for the current book: what lesson proposals use instead of the search. */
export async function confirmedMap(db: Database, courseId: string, sha: string) {
  return new Map((await rowsOf(db, courseId, sha)).filter(row => row.status === "confirmed").map(row => [row.outcomeId, JSON.parse(row.pages) as number[]]));
}

export async function bookMap(path: string, method: string, input: unknown, current: Member, db: Database, env: Env, wake: () => Promise<void>, resourceId: string | null = null): Promise<Response> {
  const courseId = (mapPath.exec(path) || checkPath.exec(path) || outcomePath.exec(path))![1];
  const course = await db.prepare("SELECT id,status FROM courses WHERE id=? AND organization_id=?").bind(courseId, current.organizationId).first<{ id: string; status: string }>();
  if (!course) return reply({ error: "Curso no disponible." }, 404);
  const access = await accessTo(db, current, courseId);
  if (!access) return reply({ error: "Este curso no está asignado a tu cuenta." }, 403);
  const state = await readiness(db, env, current.organizationId, courseId);
  const canEdit = access.edit && course.status === "active";
  let book = state.book && state.bookText === "ready" ? state.book : null;
  let bookText = state.bookText;
  if (resourceId) {
    const chosen = await db.prepare("SELECT r.title,r.file_id AS fileId,f.sha256,f.media_type AS mediaType,f.status AS fileStatus,t.status AS textStatus,t.sha256 AS textSha,t.pages FROM course_resources r LEFT JOIN course_files f ON f.id=r.file_id LEFT JOIN book_texts t ON t.file_id=f.id WHERE r.id=? AND r.course_id=? AND r.organization_id=?").bind(resourceId, courseId, current.organizationId).first<{ title: string; fileId: string | null; sha256: string | null; mediaType: string | null; fileStatus: string | null; textStatus: string | null; textSha: string | null; pages: number | null }>();
    if (!chosen) return reply({ error: "Ese recurso no está en este curso." }, 404);
    if (!chosen.fileId || chosen.mediaType !== "application/pdf" || chosen.fileStatus !== "ready") return reply({ error: "Ese recurso no tiene un PDF." }, 409);
    const ready = chosen.textStatus === "ready" && chosen.textSha === chosen.sha256;
    const indexed = ready ? 0 : (await db.prepare("SELECT max(end_page) AS pages FROM resource_index WHERE resource_id=?").bind(resourceId).first<{ pages: number | null }>())?.pages || 0;
    bookText = ready ? "ready" : chosen.textStatus === "no_text" ? "no_text" : "missing";
    book = { fileId: chosen.fileId, title: chosen.title, sha256: chosen.sha256!, pages: ready ? chosen.pages || 0 : Math.max(indexed, 1), text: bookText };
  }
  const view = async (): Promise<BookMapView> => {
    const rows = book ? await rowsOf(db, courseId, book.sha256) : [];
    const outcomes = state.outcomes.map(outcome => {
      const row = rows.find(item => item.outcomeId === outcome.id);
      return { outcomeId: outcome.id, code: outcome.code, statement: outcome.statement, ...(row
        ? { candidates: JSON.parse(row.candidates), pages: JSON.parse(row.pages), evidence: JSON.parse(row.evidence), source: row.source, status: row.status, aiStatus: row.aiStatus, aiError: row.aiError }
        : { candidates: [], pages: [], evidence: [], source: null, status: null, aiStatus: "none" as const, aiError: null }) };
    });
    const mapped = outcomes.filter(item => item.status);
    return {
      book: book && { title: book.title, pages: book.pages }, bookText, mapper: generatorKind(env), canEdit, outcomes,
      summary: { total: outcomes.length, mapped: mapped.length, confirmed: mapped.filter(item => item.status === "confirmed").length, uncovered: mapped.filter(item => !item.pages.length).length },
    };
  };
  if (method === "GET") return reply(await view());
  if (!canEdit) return reply({ error: course.status !== "active" ? "Restaura el curso antes de cambiar el mapa del libro." : "Solo el equipo docente del curso revisa el mapa del libro." }, 403);
  if (!book) return reply({ error: state.book ? "Lee primero el texto del libro principal en «Proponer lecciones»." : "Marca un libro principal en PDF en la bibliografía del curso." }, 409);
  if (resourceId && book.text !== "ready" && !outcomePath.exec(path) && checkPath.exec(path)?.[2] !== "confirm") return reply({ error: "Ese recurso no tiene un PDF con texto leído. Mapea a mano los capítulos del índice." }, 409);
  const now = new Date().toISOString();

  const outcomeMatch = outcomePath.exec(path);
  if (outcomeMatch) {
    const outcome = state.outcomes.find(item => item.id === outcomeMatch[2]);
    if (!outcome) return reply({ error: "Ese indicador no está activo en el plan del curso." }, 404);
    const value = input && typeof input === "object" ? input as Record<string, unknown> : {};
    const pages = pagesInput(value.pages, book.pages);
    if (!pages) return reply({ error: `Escribe páginas del libro (de 1 a ${book.pages}), por ejemplo «12, 15-17», o deja la lista vacía si el libro no lo trata.` }, 400);
    const row = (await rowsOf(db, courseId, book.sha256)).find(item => item.outcomeId === outcome.id);
    const same = row && JSON.stringify(JSON.parse(row.pages)) === JSON.stringify(pages);
    const evidence = row ? (JSON.parse(row.evidence) as MapEvidence[]).filter(item => pages.includes(item.page)) : [];
    // The team's word is final: confirming keeps where the pages came from, changing them makes the team their source.
    await db.prepare(`INSERT INTO book_maps(course_id,organization_id,file_id,sha256,outcome_id,candidates,pages,evidence,source,status,ai_status,updated_by,updated_at) VALUES (?,?,?,?,?,'[]',?,?,'teacher','confirmed','none',?,?)
      ON CONFLICT(course_id,sha256,outcome_id) DO UPDATE SET pages=excluded.pages,evidence=?,source=?,status='confirmed',ai_status=CASE WHEN book_maps.ai_status IN ('queued','running') THEN 'none' ELSE book_maps.ai_status END,updated_by=excluded.updated_by,updated_at=excluded.updated_at`)
      .bind(courseId, current.organizationId, book.fileId, book.sha256, outcome.id, JSON.stringify(pages), JSON.stringify(evidence), current.id, now, JSON.stringify(evidence), same ? row!.source : "teacher").run();
    return reply(await view());
  }

  const action = checkPath.exec(path)?.[2];
  if (action === "confirm") {
    const confirmed = await db.prepare("UPDATE book_maps SET status='confirmed',updated_by=?,updated_at=? WHERE course_id=? AND sha256=? AND status='proposed' AND ai_status NOT IN ('queued','running') RETURNING outcome_id").bind(current.id, now, courseId, book.sha256).all();
    if (!confirmed.results.length) return reply({ error: "No hay indicadores por confirmar (o la IA aún los revisa)." }, 409);
    return reply(await view());
  }
  if (action === "check") {
    if (!generatorKind(env)) return reply({ error: "La revisión con IA no está configurada en este entorno." }, 409);
    if ((await aiBudgetOf(db, current.organizationId, env)).level === "exhausted") return aiBudgetSpent();
    const queued = await db.prepare("UPDATE book_maps SET ai_status='queued',ai_error=NULL,ai_attempts=0 WHERE course_id=? AND sha256=? AND status='proposed' AND candidates<>'[]' AND ai_status IN ('none','error') RETURNING outcome_id").bind(courseId, book.sha256).all();
    if (!queued.results.length) return reply({ error: "No hay indicadores por revisar: busca primero en el libro o ya están confirmados." }, 409);
    await wake();
    return reply(await view(), 202);
  }

  // Search the book again: every indicator not confirmed yet gets its candidates and the pages a proposal would use.
  const [pages, contents, rows] = await Promise.all([
    db.prepare("SELECT page,text FROM book_pages WHERE file_id=? ORDER BY page").bind(book.fileId).all<{ page: number; text: string }>().then(result => result.results),
    contentsOf(db, courseId), rowsOf(db, courseId, book.sha256),
  ]);
  const statements = state.outcomes.filter(outcome => rows.find(row => row.outcomeId === outcome.id)?.status !== "confirmed").map(outcome => {
    const query = [outcome.statement, ...(contents.get(outcome.id) || [])].join(" ");
    const candidates = mapCandidatePages(query, pages), chosen = relevantPages(query, pages).map(page => page.page);
    return db.prepare(`INSERT INTO book_maps(course_id,organization_id,file_id,sha256,outcome_id,candidates,pages,evidence,source,status,ai_status,updated_by,updated_at) VALUES (?,?,?,?,?,?,?,'[]','lexical','proposed','none',?,?)
      ON CONFLICT(course_id,sha256,outcome_id) DO UPDATE SET candidates=excluded.candidates,pages=excluded.pages,evidence='[]',source='lexical',ai_status='none',ai_error=NULL,updated_by=excluded.updated_by,updated_at=excluded.updated_at WHERE book_maps.status<>'confirmed'`)
      .bind(courseId, current.organizationId, book.fileId, book.sha256, outcome.id, JSON.stringify(candidates), JSON.stringify(chosen), current.id, now);
  });
  if (statements.length) await db.batch(statements);
  return reply(await view());
}

/** One batch of the organization's queued map checks, run by its Durable Object alarm. True when work remains. */
export async function processBookMaps(db: Database, env: Env, scope: string): Promise<boolean> {
  // AIG-6: with the month's budget used, the queue waits; asking again next month wakes it.
  if ((await aiBudgetOf(db, scope, env)).level === "exhausted") return false;
  await db.prepare("UPDATE book_maps SET ai_status='queued' WHERE ai_status='running' AND ai_started_at<? AND organization_id=?").bind(new Date(Date.now() - 10 * 60_000).toISOString(), scope).run();
  const settings = openAiSettings(env), mapper = settings ? openAiMapper(settings) : env.LESSON_GENERATOR === "fixture" ? fixtureMapper : null;
  const queued = (await db.prepare("SELECT course_id AS courseId,sha256,outcome_id AS outcomeId,file_id AS fileId,candidates,ai_attempts AS attempts,updated_by AS userId FROM book_maps WHERE ai_status='queued' AND organization_id=? LIMIT 3").bind(scope)
    .all<{ courseId: string; sha256: string; outcomeId: string; fileId: string; candidates: string; attempts: number; userId: string }>()).results;
  for (const row of queued) {
    const startedAt = new Date().toISOString(), key = [row.courseId, row.sha256, row.outcomeId];
    if (!await db.prepare("UPDATE book_maps SET ai_status='running',ai_attempts=ai_attempts+1,ai_started_at=? WHERE course_id=? AND sha256=? AND outcome_id=? AND ai_status='queued' RETURNING outcome_id").bind(startedAt, ...key).first()) continue;
    const finish = (status: "queued" | "error", error: string | null) => db.prepare("UPDATE book_maps SET ai_status=?,ai_error=? WHERE course_id=? AND sha256=? AND outcome_id=? AND ai_status='running' AND ai_started_at=?").bind(status, error, ...key, startedAt).run();
    if (!mapper) { await finish("error", "La revisión con IA ya no está configurada en este entorno."); continue; }
    const pages = (JSON.parse(row.candidates) as { page: number }[]).map(item => item.page);
    const [outcome, texts] = await db.batch([
      db.prepare("SELECT o.statement,l.code FROM course_outcomes o LEFT JOIN course_package_links l ON l.outcome_id=o.id AND l.kind='indicator' WHERE o.id=? AND o.course_id=?").bind(row.outcomeId, row.courseId),
      db.prepare(`SELECT page,text FROM book_pages WHERE file_id=? AND page IN (${pages.map(() => "?").join(",") || "NULL"}) ORDER BY page`).bind(row.fileId, ...pages),
    ]) as unknown as [{ statement: string; code: string | null }[], { page: number; text: string }[]];
    if (!outcome[0]) { await finish("error", "El indicador ya no está en el plan."); continue; }
    const candidates = texts.map(page => ({ page: page.page, text: page.text.slice(0, maxCandidateText) }));
    try {
      const input = { outcome: { ...outcome[0], contents: (await contentsOf(db, row.courseId)).get(row.outcomeId) || [] }, candidates };
      const answer = await tracked(db, {
        organizationId: scope, userId: row.userId, courseId: row.courseId, task: "book-map", promptVersion: mapPromptVersion,
        generator: mapper.kind, model: mapper.kind === "openai" ? settings!.model : "fixture", inputChars: JSON.stringify(input).length,
      }, observe => mapper.map(input, observe));
      const result = verifiedPages(answer, candidates);
      // The team may have confirmed this indicator meanwhile: its decision is kept.
      await db.prepare("UPDATE book_maps SET pages=?,evidence=?,source='ai',ai_status='done',ai_error=? WHERE course_id=? AND sha256=? AND outcome_id=? AND ai_status='running' AND ai_started_at=? AND status='proposed'")
        .bind(JSON.stringify(result.pages), JSON.stringify(result.evidence), result.dropped ? `Se descartaron ${result.dropped} páginas sin una cita verificable.` : null, ...key, startedAt).run();
      await db.prepare("UPDATE book_maps SET ai_status='done' WHERE course_id=? AND sha256=? AND outcome_id=? AND ai_status='running' AND ai_started_at=?").bind(...key, startedAt).run();
    } catch (error) {
      const transient = error instanceof TransientError && row.attempts + 1 < 3;
      console.error(JSON.stringify({ event: "book_map_failed", outcome: row.outcomeId, transient, cause: error instanceof Error ? error.message.slice(0, 120) : "unknown" }));
      await finish(transient ? "queued" : "error", transient ? null : "La IA no respondió. Vuelve a intentar en unos minutos.");
    }
  }
  return !!await db.prepare("SELECT 1 FROM book_maps WHERE ai_status='queued' AND organization_id=? LIMIT 1").bind(scope).first();
}
