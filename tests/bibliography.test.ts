import { createHash, randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn, type ChildProcess } from "node:child_process";
import { createServer } from "node:net";
import { once } from "node:events";
import { setTimeout as delay } from "node:timers/promises";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { BibliographyReference } from "../packages/contracts/src/index";
import { primaryBlocker, referenceInput } from "../packages/domain/src/index";
import { listenOnTestPort } from "./test-port";

// The course's bibliography: references to items of the course's library (materials or files in R2), each with a
// role, and at most one main book, a published text.
describe("bibliography rules", () => {
  it("validates the role, the citation and the main book", () => {
    expect(referenceInput({ role: "text", citation: "  Ana   Pérez,  Editorial  Piedra Santa, 2024 ", primary: true })).toEqual({ role: "text", citation: "Ana Pérez, Editorial Piedra Santa, 2024", primary: true });
    expect(referenceInput({ role: "support" })).toEqual({ role: "support", citation: "", primary: false });
    expect(referenceInput({ role: "texto" })).toHaveProperty("error");
    expect((referenceInput({ role: "support", primary: true }) as { error: string }).error).toContain("rol «Texto»");
    expect(referenceInput({ role: "other", citation: "x".repeat(301) })).toHaveProperty("error");
    expect(referenceInput({ role: "other", citation: "<b>" })).toHaveProperty("error");
    expect(referenceInput({ role: "text", primary: "sí" })).toHaveProperty("error");
    expect(primaryBlocker("published")).toBeNull();
    expect(primaryBlocker("draft")).toContain("Publica");
    expect(primaryBlocker("archived")).toContain("archivado");
  });
});

let worker: ChildProcess;
let origin = "";
let logs = "";
const storage = mkdtempSync(join(tmpdir(), "hl-platform-bibliography-"));
beforeAll(async () => {
  const server = createServer();
  await listenOnTestPort(server);
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Missing local port");
  await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  origin = `http://127.0.0.1:${address.port}`;
  worker = spawn("node_modules/.bin/wrangler", ["dev", "--local", "--config", "build/wrangler.json", "--ip", "127.0.0.1", "--port", String(address.port), "--inspector-port", "0", "--persist-to", storage], {
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

type List = { references: BibliographyReference[]; canManage: boolean };
async function uploadPdf(cookie: string | null, course: string, name: string) {
  const bytes = Buffer.from(`%PDF-1.4\n1 0 obj << /Type /Catalog >> endobj\n% ${name}\n%%EOF\n`);
  const response = await fetch(`${origin}/api/courses/${course}/files`, { method: "POST", headers: { Cookie: cookie || "", Origin: origin, "Content-Type": "application/pdf", "X-File-Name": encodeURIComponent(name), "Idempotency-Key": randomUUID(), "X-File-SHA256": createHash("sha256").update(bytes).digest("hex"), "Content-Length": String(bytes.length) }, body: bytes });
  return (await read<{ file: { id: string } }>(response, 201)).file.id;
}

describe("bibliography on the built Worker", () => {
  it("the course's team uploads or links a book, marks it as the main book and replaces it; others only read", async () => {
    const admin = await signIn("admin-demo"), educator = await signIn("educador-demo"), outsider = await signIn("carlos.mejia"), external = await signIn("admin-externo");
    const course = (await read<{ id: string }>(await as(admin, "/courses", "POST", { title: "Curso con bibliografía", objective: "Leer con un libro principal.", status: "active", educationType: "non-formal", level: "unspecified", format: "workshop", modality: "in-person", pacing: "scheduled", area: "011", settings: {}, programId: null, leadId: "user-educator" }), 201)).id;
    const path = `/courses/${course}/bibliography`;
    // The book is a PDF in the course's library (R2); a link and a draft text are library items too.
    const book = await uploadPdf(educator, course, "Libro de lectura 5.pdf");
    const link = (await read<{ material: { id: string } }>(await as(educator, `/courses/${course}/materials`, "POST", { title: "Diccionario en línea", description: "Consulta", content: "https://dle.rae.es", kind: "link", status: "published", termIds: [] }), 201)).material.id;
    const draft = (await read<{ material: { id: string } }>(await as(educator, `/courses/${course}/materials`, "POST", { title: "Guía en preparación", description: "Borrador", content: "Texto de la guía", kind: "text", status: "draft", termIds: [] }), 201)).material.id;
    expect(await read<List>(await as(educator, path))).toEqual({ references: [], canManage: true });

    // Linking an existing book as the main one.
    const added = await read<List>(await as(educator, path, "POST", { itemId: book, role: "text", citation: "Editorial escolar, 2026", primary: true }), 201);
    expect(added.references).toEqual([expect.objectContaining({ itemId: book, kind: "file", title: "Libro de lectura 5", fileName: "Libro de lectura 5.pdf", mediaType: "application/pdf", status: "published", role: "text", primary: true, citation: "Editorial escolar, 2026" })]);
    expect(await errorOf(await as(educator, path, "POST", { itemId: book, role: "support" }), 409)).toContain("ya está en la bibliografía");
    expect(await errorOf(await as(educator, path, "POST", { itemId: "material-ajeno", role: "support" }), 400)).toContain("biblioteca de este curso");
    expect(await errorOf(await as(educator, path, "POST", { itemId: draft, role: "text", primary: true }), 409)).toContain("Publica el recurso");
    expect(await errorOf(await as(educator, path, "POST", { itemId: link, role: "support", primary: true }), 400)).toContain("rol «Texto»");
    const withLink = await read<List>(await as(educator, path, "POST", { itemId: link, role: "support" }), 201);
    expect(withLink.references.map(item => [item.title, item.role, item.primary])).toEqual([["Libro de lectura 5", "text", true], ["Diccionario en línea", "support", false]]);

    // Administration (not on the team) manages it too: a second PDF replaces the main book in one step.
    const second = await uploadPdf(educator, course, "Antología 5.pdf");
    const replaced = await read<List>(await as(admin, path, "POST", { itemId: second, role: "text", primary: true }), 201);
    expect(replaced.references.filter(item => item.primary).map(item => item.title)).toEqual(["Antología 5"]);
    expect(replaced.references.find(item => item.itemId === book)).toMatchObject({ primary: false, role: "text" });
    const first = replaced.references.find(item => item.itemId === book)!;
    const back = await read<List>(await as(educator, `${path}/${first.id}`, "PUT", { role: "text", citation: first.citation, primary: true }));
    expect(back.references.filter(item => item.primary).map(item => item.itemId)).toEqual([book]);
    const supportRef = back.references.find(item => item.itemId === link)!;
    expect(await errorOf(await as(educator, `${path}/${supportRef.id}`, "PUT", { role: "support", primary: true }), 400)).toContain("rol «Texto»");

    // Others: an educator outside the course has no access; another organization does not see the course.
    expect((await as(outsider, path)).status).toBe(403);
    expect((await as(external, path)).status).toBe(404);
    expect((await as(external, `${path}/${first.id}`, "DELETE")).status).toBe(404);
    // Coordination reads it without managing it.
    const members = (await read<{ members: { id: string; username: string }[] }>(await as(admin, "/members"))).members;
    await read(await as(admin, `/members/${members.find(row => row.username === "instructor-demo")!.id}/coordination`, "PUT", { enabled: true, scope: { all: true } }));
    const coordinator = await signIn("instructor-demo");
    expect((await read<List>(await as(coordinator, path))).canManage).toBe(false);
    expect(await errorOf(await as(coordinator, path, "POST", { itemId: draft, role: "other" }), 403)).toContain("Solo administración y el equipo del curso");

    // Removing keeps the library item; the activity records the main book.
    await read(await as(educator, `${path}/${supportRef.id}`, "DELETE"));
    expect((await read<{ materials: { id: string }[] }>(await as(educator, `/courses/${course}/materials`))).materials.map(item => item.id)).toContain(link);
    const { events } = await read<{ events: { summary: string }[] }>(await as(admin, "/activity?limit=30"));
    expect(events.map(item => item.summary)).toContain("Marcó «Antología 5» como libro principal del curso en lugar de «Libro de lectura 5»");
    // Persistence: a fresh read gives the same bibliography.
    expect((await read<List>(await as(admin, path))).references.map(item => [item.title, item.primary])).toEqual([["Libro de lectura 5", true], ["Antología 5", false]]);
  }, 30_000); // Uploads to local R2 and a full flow: room for slow runners.
});
