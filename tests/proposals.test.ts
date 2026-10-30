import { createHash, randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn, type ChildProcess } from "node:child_process";
import { createServer } from "node:net";
import { once } from "node:events";
import { setTimeout as delay } from "node:timers/promises";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { BookMapView, CourseProposals, Lesson } from "../packages/contracts/src/index";
import { draftFromOutput, fixtureGenerator, pagesLabel, pdfFile, pdfString, proposalProblem, proposalPrompt, relevantPages, sequenceOf, validActivities, wrap } from "../packages/domain/src/index";
import type { ProposalInput } from "../packages/domain/src/index";

// Rebanada 5a: lesson proposals from the main book and the plan's indicators, processed by the organization's
// Durable Object alarm with a deterministic fixture generator, and the delivery PDF with published content only.
const book = [
  "Presentación del libro de Matemáticas para sexto grado. Bienvenida a estudiantes y familias.",
  "Polígonos regulares e irregulares. Un polígono regular tiene todos sus lados y ángulos iguales. Clasificación de triángulos por sus ángulos: rectángulo, obtusángulo y acutángulo. Paralelogramos: rectángulos, cuadrados, romboides y rombos.",
  "Perímetro y área. El perímetro de un polígono es la suma de sus lados. Área de triángulos con fórmula. Circunferencia y área del círculo con el número pi.",
  "La música de marimba y sus instrumentos tradicionales en la región.",
];
const sequence = sequenceOf("start-develop-close");
const input: ProposalInput = {
  course: "Matemáticas 6.º", grade: "Primaria", minutes: 45,
  sequence: { label: sequence.label, phases: sequence.phases.map(({ id, label, hint }) => ({ id, label, hint })) },
  outcome: { id: "outcome-1", statement: "Calcula perímetro y área de diferentes polígonos y del círculo.", code: "1.2", competency: "1. Produce información…", contents: ["1.2.1 Cálculo del perímetro de polígonos regulares e irregulares.", "1.2.3. Cálculo de circunferencia y área del círculo."] },
  book: { title: "Libro de Matemáticas 6", fileId: "course-file-1", pages: [3], excerpt: book[2] },
};

describe("lesson proposal rules", () => {
  it("finds the book's pages for an indicator by its words and contents, deterministically", () => {
    const pages = book.map((text, index) => ({ page: index + 1, text }));
    // Perimeter and area: page 3 is the best match and page 2 (polygons) is relevant enough; page 1 and 4 are not.
    const perimeter = relevantPages(`${input.outcome.statement} ${input.outcome.contents.join(" ")}`, pages);
    expect(perimeter.map(page => page.page)).toEqual([2, 3]);
    expect(perimeter[1].score).toBeGreaterThan(perimeter[0].score);
    // Polygons: page 3 shares a few words only and is left out.
    expect(relevantPages("Identifica características de polígonos regulares e irregulares. Clasificación de triángulos por sus ángulos. Paralelogramos", pages).map(page => page.page)).toEqual([2]);
    expect(relevantPages("Calendario maya agrícola y sagrado, cuenta larga", pages)).toEqual([]);
    expect(relevantPages(input.outcome.statement, pages)).toEqual(relevantPages(input.outcome.statement, pages));
    expect([pagesLabel([3]), pagesLabel([3, 4, 5]), pagesLabel([3, 9])]).toEqual(["p. 3", "pp. 3–5", "pp. 3, 9"]);
  });

  it("the fixture proposes a valid lesson: one activity per moment, the book cited, a closing question, the outcome", async () => {
    const draft = draftFromOutput(await fixtureGenerator.generate(input), input);
    expect(draft.activities.map(activity => activity.phase)).toEqual(["start", "develop", "close"]);
    expect(draft.activities.reduce((sum, activity) => sum + activity.minutes, 0)).toBe(45);
    expect(draft.activities.every(activity => activity.outcomeIds?.[0] === "outcome-1")).toBe(true);
    expect(draft.activities[0].blocks?.some(block => block.kind === "resource" && block.resourceId === "course-file-1")).toBe(true);
    expect(draft.activities[2]).toMatchObject({ purpose: "assess" });
    expect(validActivities(draft.activities)).toBe(true);
    expect(proposalProblem(draft, input)).toBeNull();
    expect(JSON.stringify(draft)).toContain("p. 3");
    // With page marks in the excerpt and contents ending in a period, the text quotes cleanly.
    const marked = draftFromOutput(await fixtureGenerator.generate({ ...input, book: { ...input.book, pages: [2, 3], excerpt: `[p. 2] ${book[1]}\n[p. 3] ${book[2]}` } }), input);
    const text = JSON.stringify(marked);
    expect(text).not.toContain("[p.");
    expect(text).not.toContain("..");
    expect(text).toContain("«Polígonos regulares e irregulares»");
  });

  it("turns a model's answer into the lesson model and rejects what does not fit", () => {
    const answer = { title: "Área del círculo", objective: "Calcular el área del círculo.", activities: [
      { title: "Inicio", phase: "start", purpose: "explore" as const, grouping: "whole-class" as const, minutes: 10, instructions: "Observa la p. 3.", question: null },
      { title: "Práctica", phase: "otra", purpose: "practice" as const, grouping: "pairs" as const, minutes: 25, instructions: "Resuelve.", question: null },
      { title: "Cierre", phase: "close", purpose: "assess" as const, grouping: "individual" as const, minutes: 10, instructions: "Responde.", question: { prompt: "¿Fórmula?", options: ["πr²", "2πr", "πr²"], answer: 0 } },
    ] };
    const draft = draftFromOutput(answer, input);
    expect(draft.activities[1].phase).toBe("start");
    expect(draft.activities[2].blocks?.find(block => block.kind === "question")).toMatchObject({ options: ["πr²", "2πr"], answer: 0 });
    expect(proposalProblem(draft, input)).toBeNull();
    expect(proposalProblem({ ...draft, activities: draft.activities.slice(0, 2) }, input)).toContain("pregunta");
    expect(proposalProblem({ ...draft, activities: draft.activities.map(activity => ({ ...activity, minutes: 40 })) }, input)).toContain("minutos");
    // The prompt carries only this lesson's pages, the indicator, its CNB contents and the sequence's moments.
    const { user } = proposalPrompt(input);
    expect(user).toContain("indicador 1.2");
    expect(user).toContain("1.2.3. Cálculo de circunferencia");
    expect(user).toContain("- start: Inicio");
    expect(user).not.toContain("marimba");
  });

  it("writes a valid PDF: ASCII, WinAnsi accents, wrapped lines, offsets that match", () => {
    expect(pdfString("Área (año) \\ ñ ¿qué? “sí” — fin")).toBe("(\\301rea \\(a\\361o\\) \\\\ \\361 \\277qu\\351? \\223s\\355\\224 \\227 fin)");
    for (const line of wrap("palabra ".repeat(200), 10.5, 400)) expect(line.length).toBeLessThanOrEqual(80);
    const file = pdfFile({ title: "Prueba", header: ["Escuela", "Docente: Ana"], footer: "Pie", blocks: Array.from({ length: 120 }, (_, index) => ({ text: `Línea ${index}` })) });
    expect(file.startsWith("%PDF-1.4\n")).toBe(true);
    expect(/^[\x09\x0a\x20-\x7e]*$/.test(file)).toBe(true);
    expect(file).toContain("(P\\341gina 1 de 3)");
    const xref = Number(/startxref\n(\d+)/.exec(file)![1]);
    expect(file.slice(xref, xref + 4)).toBe("xref");
    const offsets = [...file.slice(xref).matchAll(/(\d{10}) 00000 n/g)].map(match => Number(match[1]));
    offsets.forEach((offset, index) => expect(file.slice(offset, offset + `${index + 1} 0 obj`.length)).toBe(`${index + 1} 0 obj`));
  });
});

let worker: ChildProcess;
let origin = "";
let logs = "";
const storage = mkdtempSync(join(tmpdir(), "hl-platform-proposals-"));
beforeAll(async () => {
  const server = createServer();
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Missing local port");
  await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  origin = `http://127.0.0.1:${address.port}`;
  worker = spawn("node_modules/.bin/wrangler", ["dev", "--local", "--config", "build/wrangler.json", "--ip", "127.0.0.1", "--port", String(address.port), "--inspector-port", "0", "--persist-to", storage, "--var", "LESSON_GENERATOR:fixture"], {
    env: { ...process.env, WRANGLER_SEND_METRICS: "false", BROWSER: "none" }, stdio: ["ignore", "pipe", "pipe"],
  });
  worker.stdout?.on("data", chunk => { logs += chunk; });
  worker.stderr?.on("data", chunk => { logs += chunk; });
  for (let attempt = 0; attempt < 200; attempt++) {
    if (worker.exitCode !== null) throw new Error(logs);
    try { if ((await fetch(`${origin}/api/health`, { signal: AbortSignal.timeout(500) })).ok) return; } catch { /* Wait for the local runtime to start. */ }
    await delay(200);
  }
  throw new Error(`Local Worker did not start:\n${logs}`);
});
afterAll(async () => {
  if (worker && worker.exitCode === null) { const exited = once(worker, "exit"); worker.kill("SIGTERM"); await exited; }
  rmSync(storage, { recursive: true, force: true });
});

const password = "Aprender-2026!";
async function signIn(username: string) {
  const response = await fetch(`${origin}/api/login`, { method: "POST", headers: { "Content-Type": "application/json", Origin: origin }, body: JSON.stringify({ username, password }) });
  return response.status === 200 ? response.headers.get("set-cookie")!.split(";")[0] : null;
}
async function as(cookie: string | null, path: string, method = "GET", data?: unknown) {
  return fetch(`${origin}/api${path}`, { method, headers: { Cookie: cookie || "", Origin: origin, ...(data !== undefined ? { "Content-Type": "application/json" } : {}) }, ...(data !== undefined ? { body: JSON.stringify(data) } : {}) });
}
const read = async <T = Record<string, unknown>>(response: Response, status = 200) => { const text = await response.text(); expect(response.status, text).toBe(status); return JSON.parse(text) as T; };
const errorOf = async (response: Response, status: number) => (await read<{ error: string }>(response, status)).error;

const sha = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");
/** All the text a PDF shows, decoded from its WinAnsi literal strings and joined with single spaces. */
function pdfText(file: string) {
  const special: Record<number, string> = { 0x85: "…", 0x91: "‘", 0x92: "’", 0x93: "“", 0x94: "”", 0x95: "•", 0x96: "–", 0x97: "—" };
  return [...file.matchAll(/\(((?:\\.|[^\\)])*)\) Tj/g)].map(match => match[1].replace(/\\(\d{3}|.)/g, (_, escaped: string) => escaped.length === 3 ? (special[parseInt(escaped, 8)] || String.fromCharCode(parseInt(escaped, 8))) : escaped)).join(" ").replace(/\s+/g, " ");
}
async function uploadPdf(cookie: string | null, course: string, name: string) {
  const bytes = Buffer.from(`%PDF-1.4\n1 0 obj << /Type /Catalog >> endobj\n% ${name}\n%%EOF\n`);
  const response = await fetch(`${origin}/api/courses/${course}/files`, { method: "POST", headers: { Cookie: cookie || "", Origin: origin, "Content-Type": "application/pdf", "X-File-Name": encodeURIComponent(name), "Idempotency-Key": randomUUID(), "X-File-SHA256": sha(bytes), "Content-Length": String(bytes.length) }, body: bytes });
  return (await read<{ file: { id: string; sha256: string } }>(response, 201)).file;
}
async function settled(cookie: string | null, path: string) {
  for (let attempt = 0; attempt < 100; attempt++) {
    const state = await read<CourseProposals>(await as(cookie, path));
    if (state.jobs.every(job => job.items.every(item => item.status === "done" || item.status === "error"))) return state;
    await delay(150);
  }
  throw new Error("Proposals did not settle");
}

describe("lesson proposals and the delivery PDF on the built Worker", () => {
  it("proposes drafts from the book for the plan's indicators, never twice, and delivers only what is published", async () => {
    const admin = await signIn("admin-demo"), educator = await signIn("educador-demo"), other = await signIn("carlos.mejia"), external = await signIn("admin-externo");
    const course = (await read<{ id: string }>(await as(admin, "/courses", "POST", { title: "Matemáticas 6.º", objective: "Resolver problemas con números y figuras.", status: "active", educationType: "non-formal", level: "unspecified", format: "subject", modality: "in-person", pacing: "scheduled", area: "011", settings: { defaultSequence: "start-develop-close" }, programId: null, leadId: "user-educator" }), 201)).id;
    const path = `/courses/${course}/proposals`;
    const version = async () => (await read<{ course: { version: number } }>(await as(educator, `/courses/${course}`))).course.version;

    // Not ready: no indicator, no main book, no module.
    const empty = await read<CourseProposals>(await as(educator, path));
    expect(empty).toMatchObject({ generator: "fixture", canPropose: true, bookText: null, sequence: { id: "start-develop-close" } });
    expect(empty.blockers).toEqual([
      "Asocia al menos un indicador al plan curricular del curso.",
      "Marca un libro principal en la bibliografía del curso.",
      "Crea al menos un módulo en el contenido del curso para recibir las lecciones.",
    ]);
    expect(await errorOf(await as(educator, path, "POST", { unitId: "x", outcomeIds: ["y"] }), 409)).toContain("indicador");

    // The plan takes three CNB indicators; the course gets a module and a PDF as its main book.
    await read(await as(admin, "/curriculum-packages/cnb-matematicas-primaria-6/activate", "POST"));
    await read(await as(educator, `/courses/${course}/curriculum-packages/cnb-matematicas-primaria-6`, "POST", { codes: ["1.1", "1.2", "7.3"], version: await version() }), 201);
    const unit = (await read<{ id: string }>(await as(educator, `/courses/${course}/units`, "POST", { version: await version(), name: "Unidad 1: figuras y medidas", objective: "Geometría", status: "active" }), 201)).id;
    const file = await uploadPdf(educator, course, "Libro de Matemáticas 6.pdf");
    await read(await as(educator, `/courses/${course}/bibliography`, "POST", { itemId: file.id, role: "text", primary: true }), 201);
    const ready = await read<CourseProposals>(await as(educator, path));
    expect(ready).toMatchObject({ blockers: [], bookText: "missing", book: { fileId: file.id, title: "Libro de Matemáticas 6" } });
    const [polygons, perimeter, calendar] = ready.outcomes.map(outcome => outcome.id);
    expect(ready.outcomes.map(outcome => outcome.code)).toEqual(["1.1", "1.2", "7.3"]);
    expect(await errorOf(await as(educator, path, "POST", { unitId: unit, outcomeIds: [polygons] }), 409)).toContain("Lee primero el texto");

    // The browser sends the book's text page by page; a scanned PDF (no text) is refused, without OCR.
    const textPath = `${path}/book-text`;
    expect(await errorOf(await as(educator, textPath, "PUT", { fileId: file.id, sha256: file.sha256, pages: [{ page: 1, text: "" }, { page: 2, text: " " }] }), 422)).toContain("no tiene texto");
    expect((await read<CourseProposals>(await as(educator, path))).blockers[0]).toContain("parece escaneado");
    expect(await errorOf(await as(educator, textPath, "PUT", { fileId: file.id, sha256: "0".repeat(64), pages: [] }), 409)).toContain("cambió");
    expect(await read(await as(educator, textPath, "PUT", { fileId: file.id, sha256: file.sha256, pages: book.map((text, index) => ({ page: index + 1, text })) }))).toEqual({ pages: 4, characters: book.join("").length });

    // Asking: one item per indicator; the one the book does not cover fails at once and says why.
    expect((await as(other, path)).status).toBe(403);
    expect((await as(external, path)).status).toBe(404);
    // «Según el plan curricular»: perimeter is planned in a second module; the others go to the first one.
    const measures = (await read<{ id: string }>(await as(educator, `/courses/${course}/units`, "POST", { version: await version(), name: "Unidad de medidas", objective: "Perímetro y área", status: "active" }), 201)).id;
    await read(await as(educator, `/courses/${course}/units/${measures}/outcomes`, "PUT", { version: await version(), outcomeIds: [perimeter] }));
    const asked = await read<CourseProposals>(await as(educator, path, "POST", { unitId: "plan", outcomeIds: [polygons, perimeter, calendar], minutes: 45 }), 202);
    expect(asked.jobs.map(job => [job.unitId, job.items.map(item => [item.outcomeId, item.pages, item.status])]).sort()).toEqual([
      [measures, [[perimeter, [2, 3], "queued"]]], [unit, [[polygons, [2], "queued"], [calendar, [], "error"]]]].sort());
    const done = await settled(educator, path);
    const items = [polygons, perimeter, calendar].map(id => done.jobs.flatMap(job => job.items).find(item => item.outcomeId === id)!);
    expect(items.map(item => item.status)).toEqual(["done", "done", "error"]);
    expect(items[2].error).toContain("no parece tratar este indicador");

    // The drafts are ordinary lessons of the module: draft status, the outcome, the sequence's moments and the book.
    const listed = (await read<{ lessons: Lesson[] }>(await as(educator, `/lessons?course=${course}&drafts=1`))).lessons;
    expect(listed).toHaveLength(2);
    const drafts = [items[0], items[1]].map(item => listed.find(lesson => lesson.id === item.lessonId)!);
    expect(drafts.map(lesson => [lesson.status, lesson.courseUnitId])).toEqual([["draft", unit], ["draft", measures]]);
    expect(drafts[1].outcomeIds).toEqual([perimeter]);
    expect(drafts[1].activities.map(activity => activity.phase)).toEqual(["start", "develop", "close"]);
    expect(JSON.stringify(drafts[1].activities)).toContain(file.id);
    // Each proposal says where it came from (DEC-052): generator, model, pages, indicator and when.
    expect(drafts[1].generated).toMatchObject({ source: "fixture", model: "fixture", pages: [2, 3], indicator: "1.2" });

    // Asking again for the same lessons never duplicates them; a failure with no pages is not retried.
    expect(await errorOf(await as(educator, path, "POST", { unitId: "plan", outcomeIds: [polygons, perimeter] }), 409)).toContain("ya se propusieron");
    expect(await errorOf(await as(educator, `${path}/${done.jobs.find(job => job.unitId === unit)!.id}/retry`, "POST"), 409)).toContain("No hay propuestas");
    expect((await read<{ lessons: Lesson[] }>(await as(educator, `/lessons?course=${course}&drafts=1`))).lessons).toHaveLength(2);

    // Review and publication are the existing ones: the lead publishes the first draft, then edits it again.
    const first = drafts[0];
    await read(await as(educator, `/lessons/${first.id}/publish`, "POST"));
    const current = (await read<{ lesson: Lesson & { draftVersion: number } }>(await as(educator, `/lessons/${first.id}?draft=1`))).lesson;
    await read(await as(educator, `/lessons/${first.id}`, "PUT", { ...current, courseUnitId: unit, title: "CAMBIO SIN PUBLICAR", instructions: "", draftVersion: current.draftVersion }));
    // Editing through the regular API keeps the provenance.
    expect((await read<{ lesson: Lesson }>(await as(educator, `/lessons/${first.id}?draft=1`))).lesson.generated).toMatchObject({ source: "fixture", indicator: "1.1" });

    // The delivery PDF: only the published version, with the letterhead and the footer.
    const group = (await read<{ id: string }>(await as(admin, `/courses/${course}/groups`, "POST", { name: "Sexto A" }), 201)).id;
    await read(await as(admin, `/courses/${course}/groups/${group}/educators`, "PUT", { userIds: ["user-educator"] }));
    // The period is named so the letterhead does not depend on today's date; the demo's current year is «Ciclo 2026» (0054).
    const cycle = (await read<{ years: { status: string; periods: { id: string; name: string }[] }[] }>(await as(educator, "/academic-years"))).years.find(item => item.status === "current")!;
    const pdf = `/courses/${course}/units/${unit}/delivery.pdf?section=${group}&period=${cycle.periods[3].id}`;
    const response = await as(educator, pdf);
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("application/pdf");
    const downloaded = await response.text();
    expect(downloaded.startsWith("%PDF-1.4")).toBe(true);
    const text = pdfText(downloaded);
    expect(text).toContain("Copia de entrega. No redistribuir. Generado en Happy Learners.");
    expect(text).toContain(`1. ${first.title}`);
    expect(text).not.toContain("CAMBIO SIN PUBLICAR");
    expect(text).not.toContain(drafts[1].title.slice(0, 30));
    expect(text).toContain("Docente: Educador de la demostración · Curso: Matemáticas 6.º · Sección: Sexto A");
    expect(text).toContain("Ciclo lectivo: Ciclo 2026 · Periodo: Cuarto bimestre");
    expect(text).toContain("Página 1 de");
    expect((await as(other, pdf)).status).toBe(403);
    expect((await as(external, pdf)).status).toBe(404);
    expect(await errorOf(await as(educator, `/courses/${course}/units/${unit}/delivery.pdf`), 400)).toContain("sección");
    const second = (await read<{ id: string }>(await as(educator, `/courses/${course}/units`, "POST", { version: await version(), name: "Unidad 2", objective: "Vacía", status: "active" }), 201)).id;
    expect(await errorOf(await as(educator, `/courses/${course}/units/${second}/delivery.pdf?section=${group}`), 409)).toContain("no tiene lecciones publicadas");
  }, 60_000); // Proposals run in the Durable Object's alarm: room for the batches and slow runners.
});

describe("book map on the built Worker (rebanada 5b)", () => {
  it("searches, checks with the mapper in the alarm, lets the team correct and confirm, and proposals follow it", async () => {
    const admin = await signIn("admin-demo"), educator = await signIn("educador-demo"), other = await signIn("carlos.mejia"), external = await signIn("admin-externo");
    const course = (await read<{ id: string }>(await as(admin, "/courses", "POST", { title: "Matemáticas 6.º B", objective: "Mapa del libro.", status: "active", educationType: "non-formal", level: "unspecified", format: "subject", modality: "in-person", pacing: "scheduled", area: "011", settings: { defaultSequence: "start-develop-close" }, programId: null, leadId: "user-educator" }), 201)).id;
    const version = async () => (await read<{ course: { version: number } }>(await as(educator, `/courses/${course}`))).course.version;
    await read(await as(admin, "/curriculum-packages/cnb-matematicas-primaria-6/activate", "POST"));
    await read(await as(educator, `/courses/${course}/curriculum-packages/cnb-matematicas-primaria-6`, "POST", { codes: ["1.1", "1.2", "7.3"], version: await version() }), 201);
    const unit = (await read<{ id: string }>(await as(educator, `/courses/${course}/units`, "POST", { version: await version(), name: "Unidad 1", objective: "Geometría", status: "active" }), 201)).id;
    const file = await uploadPdf(educator, course, "Libro B.pdf");
    await read(await as(educator, `/courses/${course}/bibliography`, "POST", { itemId: file.id, role: "text", primary: true }), 201);
    const map = `/courses/${course}/book-map`;
    // Before the book's text is read there is nothing to map.
    expect(await read<BookMapView>(await as(educator, map))).toMatchObject({ book: null, mapper: "fixture" });
    expect(await errorOf(await as(educator, map, "POST", {}), 409)).toContain("Lee primero");
    await read(await as(educator, `/courses/${course}/proposals/book-text`, "PUT", { fileId: file.id, sha256: file.sha256, pages: book.map((text, index) => ({ page: index + 1, text })) }));

    // Search: candidates and proposed pages for every indicator; the calendar is not in the book.
    const searched = await read<BookMapView>(await as(educator, map, "POST", {}));
    const [polygons, perimeter, calendar] = searched.outcomes;
    expect(searched.outcomes.map(row => [row.code, row.pages, row.source, row.status])).toEqual([["1.1", [2], "lexical", "proposed"], ["1.2", [2, 3], "lexical", "proposed"], ["7.3", [], "lexical", "proposed"]]);
    expect(searched.summary).toEqual({ total: 3, mapped: 3, confirmed: 0, uncovered: 1 });

    // The mapper's review runs in the alarm; each accepted page carries a quote that is on that page.
    expect((await read<BookMapView>(await as(educator, `${map}/check`, "POST", {}), 202)).outcomes.filter(row => row.aiStatus === "queued").map(row => row.code)).toEqual(["1.1", "1.2"]);
    let checked = searched;
    for (let attempt = 0; attempt < 100 && checked.outcomes.some(row => row.aiStatus === "queued" || row.aiStatus === "running"); attempt++) { await delay(150); checked = await read<BookMapView>(await as(educator, map)); }
    for (const row of checked.outcomes.filter(item => item.aiStatus === "done")) {
      expect(row.source).toBe("ai");
      for (const evidence of row.evidence) expect(book[evidence.page - 1].toLowerCase()).toContain(evidence.quote.toLowerCase().slice(0, 20));
    }
    expect(checked.outcomes.find(row => row.code === "1.2")!.pages).toContain(3);

    // The team corrects 1.2, says the book does not cover 1.1 and confirms the rest; bad pages are refused.
    expect(await errorOf(await as(educator, `${map}/outcomes/${perimeter.outcomeId}`, "PUT", { pages: "9" }), 400)).toContain("de 1 a 4");
    const corrected = await read<BookMapView>(await as(educator, `${map}/outcomes/${perimeter.outcomeId}`, "PUT", { pages: "3" }));
    expect(corrected.outcomes.find(row => row.code === "1.2")).toMatchObject({ pages: [3], status: "confirmed", source: "teacher" });
    await read(await as(educator, `${map}/outcomes/${polygons.outcomeId}`, "PUT", { pages: "" }));
    const confirmed = await read<BookMapView>(await as(educator, `${map}/confirm`, "POST", {}));
    expect(confirmed.summary).toEqual({ total: 3, mapped: 3, confirmed: 3, uncovered: 2 });
    // Searching again keeps what the team confirmed.
    expect((await read<BookMapView>(await as(educator, map, "POST", {}))).outcomes.map(row => [row.code, row.pages, row.status])).toEqual([["1.1", [], "confirmed"], ["1.2", [3], "confirmed"], ["7.3", [], "confirmed"]]);
    expect((await as(other, map)).status).toBe(403);
    expect((await as(external, map)).status).toBe(404);
    expect(await errorOf(await as(other, `${map}/confirm`, "POST", {}), 403)).toContain("Este curso no está asignado");

    // Proposals follow the confirmed map: 1.2 uses page 3 only; 1.1 is not covered, as the team said.
    const asked = await read<CourseProposals>(await as(educator, `/courses/${course}/proposals`, "POST", { unitId: unit, outcomeIds: [polygons.outcomeId, perimeter.outcomeId] }), 202);
    expect(asked.jobs[0].items.map(item => [item.pages, item.status])).toEqual([[[], "error"], [[3], "queued"]]);
    expect(asked.jobs[0].items[0].error).toContain("marcaron que el libro no trata");
    expect(calendar.code).toBe("7.3");
  }, 60_000);
});

// 1.4.0 (docs/design/asistente-ia.md §6a): the proposals and map checks above went through the harness.
type AiUsageView = {
  month: string; summary: { total: { runs: number; errors: number; cost: number | null }; byTask: { task: string; runs: number }[]; byPerson: { userId: string | null; runs: number }[] };
  prices: { model: string; effectiveFrom: string; inputPerMillion: number; outputPerMillion: number }[]; unpriced: string[]; recent: Record<string, unknown>[];
};
describe("AI harness on the built Worker (1.4.0)", () => {
  it("records every run without its text, and only administration sees the usage and sets prices", async () => {
    const admin = await signIn("admin-demo"), educator = await signIn("educador-demo");
    let usage = await read<AiUsageView>(await as(admin, "/organization/ai-usage"));
    for (let attempt = 0; attempt < 100 && !["lesson-proposal", "book-map"].every(task => usage.summary.byTask.some(item => item.task === task)); attempt++) {
      await delay(150);
      usage = await read<AiUsageView>(await as(admin, "/organization/ai-usage"));
    }
    expect(usage.summary.byTask.map(item => item.task).sort()).toEqual(["book-map", "lesson-proposal"]);
    expect(usage.summary.total).toMatchObject({ errors: 0, cost: 0 });
    expect(usage.summary.total.runs).toBe(usage.recent.length);
    expect(usage.unpriced).toEqual([]);
    for (const run of usage.recent) {
      // What a run keeps: never the input, the prompt or the answer.
      expect(Object.keys(run).sort()).toEqual(["cost", "courseId", "courseTitle", "createdAt", "durationMs", "generator", "id", "inputChars", "inputTokens", "model", "outputTokens", "promptVersion", "status", "task", "userId", "userName"]);
      expect(run).toMatchObject({ generator: "fixture", model: "fixture", status: "ok", cost: 0, inputTokens: null });
      expect(run.userId).toEqual(expect.stringMatching(/\S/));
      expect(run.inputChars).toBeGreaterThan(100);
    }
    expect((await read<AiUsageView>(await as(admin, "/organization/ai-usage?mes=2020-01"))).summary.total.runs).toBe(0);

    expect(await errorOf(await as(educator, "/organization/ai-usage"), 403)).toBe("Solo administración ve el uso de IA de la organización.");
    expect((await as(educator, "/organization/ai-prices", "POST", { model: "m", effectiveFrom: "2026-10-01", inputPerMillion: 1, outputPerMillion: 1 })).status).toBe(403);
    expect(await errorOf(await as(admin, "/organization/ai-prices", "POST", { model: "m", effectiveFrom: "ayer", inputPerMillion: 1, outputPerMillion: 1 }), 400)).toBe("Indica desde qué fecha rige el precio.");
    const first = await read<AiUsageView>(await as(admin, "/organization/ai-prices", "POST", { model: "modelo-prueba", effectiveFrom: "2026-10-01", inputPerMillion: "1,25", outputPerMillion: 10 }));
    expect(first.prices).toEqual([{ model: "modelo-prueba", effectiveFrom: "2026-10-01", inputPerMillion: 1.25, outputPerMillion: 10 }]);
    // The same model and date replace the price; another date adds one.
    await read(await as(admin, "/organization/ai-prices", "POST", { model: "modelo-prueba", effectiveFrom: "2026-10-01", inputPerMillion: 2, outputPerMillion: 8 }));
    const both = await read<AiUsageView>(await as(admin, "/organization/ai-prices", "POST", { model: "modelo-prueba", effectiveFrom: "2026-11-01", inputPerMillion: 1, outputPerMillion: 4 }));
    expect(both.prices.map(price => [price.effectiveFrom, price.inputPerMillion])).toEqual([["2026-11-01", 1], ["2026-10-01", 2]]);
  }, 60_000);
});
