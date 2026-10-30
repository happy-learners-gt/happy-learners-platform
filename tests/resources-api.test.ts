import { createHash, randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn, type ChildProcess } from "node:child_process";
import { createServer } from "node:net";
import { once } from "node:events";
import { setTimeout as delay } from "node:timers/promises";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

// A library item is a resource. The bibliography is the resources that have a role. ISBN and DOI use the fixture.

let worker: ChildProcess;
let origin = "";
let logs = "";
const storage = mkdtempSync(join(tmpdir(), "hl-platform-resources-"));
beforeAll(async () => {
  const server = createServer();
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Missing local port");
  await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  origin = `http://127.0.0.1:${address.port}`;
  worker = spawn("node_modules/.bin/wrangler", ["dev", "--local", "--config", "build/wrangler.json", "--ip", "127.0.0.1", "--port", String(address.port), "--inspector-port", "0", "--persist-to", storage, "--var", "RESOURCE_LOOKUP:fixture", "--var", "LESSON_GENERATOR:fixture"], {
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
}, 60_000);
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
async function uploadPdf(cookie: string | null, course: string, name: string) {
  const bytes = Buffer.from(`%PDF-1.4\n1 0 obj << /Type /Catalog >> endobj\n% ${name}\n%%EOF\n`);
  const response = await fetch(`${origin}/api/courses/${course}/files`, { method: "POST", headers: { Cookie: cookie || "", Origin: origin, "Content-Type": "application/pdf", "X-File-Name": encodeURIComponent(name), "Idempotency-Key": randomUUID(), "X-File-SHA256": sha(bytes), "Content-Length": String(bytes.length) }, body: bytes });
  return (await read<{ file: { id: string; sha256: string } }>(response, 201)).file;
}
const person = { kind: "person", family: "López", given: "Ana" };
const ficha = (extra: Record<string, unknown> = {}) => ({ type: "book", kind: "reference", title: "Guía de lectura", authors: [person], year: 2024, metadata: { publisher: "Santillana" }, language: "es", license: "reserved", shareable: false, level: "Primaria", area: "Matemática", role: null, citationOverride: null, ...extra });

type Resource = { id: string; fileId: string | null; title: string; type: string; role: string | null; citationOverride: string | null; manual: boolean; shareable: boolean; authors: unknown[]; metadata: Record<string, string> };
type Reading = { id: string; groupId: string | null; title: string; read?: boolean };

describe("course resources on the built Worker", () => {
  it("keeps a handwritten citation, maps a resource that is not the main book, and hides a resource the student may not see", async () => {
    const admin = await signIn("admin-demo"), educator = await signIn("educador-demo"), other = await signIn("instructor-demo");
    const course = (await read<{ id: string }>(await as(admin, "/courses", "POST", { title: "Curso con recursos", objective: "Leer con ficha.", status: "active", educationType: "non-formal", level: "unspecified", format: "subject", modality: "in-person", pacing: "scheduled", area: "011", settings: { sectionFreedom: "flexible" }, programId: null, leadId: "user-educator" }), 201)).id;
    const version = async () => (await read<{ course: { version: number } }>(await as(admin, `/courses/${course}`))).course.version;
    await read(await as(admin, `/courses/${course}/team`, "PUT", { version: await version(), members: [{ userId: "user-educator", role: "lead" }, { userId: "user-1", role: "co-teacher" }] }));
    const carlos = (await read<{ members: { id: string; username: string }[] }>(await as(admin, "/members"))).members.find(row => row.username === "carlos.mejia")!;
    await read(await as(admin, `/members/${carlos.id}/coordination`, "PUT", { enabled: true, scope: { all: true } }));
    const outsider = await signIn("carlos.mejia");
    expect(await errorOf(await as(outsider, `/courses/${course}/resources`, "POST", ficha()), 403)).toContain("Solo administración y el equipo del curso");
    await read(await as(admin, `/members/${carlos.id}/coordination`, "PUT", { enabled: false }));

    const book = await uploadPdf(educator, course, "Libro de lectura.pdf");
    const guide = await uploadPdf(educator, course, "Guia del docente.pdf");
    await read(await as(educator, `/courses/${course}/bibliography`, "POST", { itemId: book.id, role: "text", citation: "Editorial escolar, 2026", primary: true }), 201);
    const listed = await read<{ resources: Resource[] }>(await as(educator, `/courses/${course}/resources`));
    const primary = listed.resources.find(item => item.fileId === book.id)!;
    const secondary = listed.resources.find(item => item.fileId === guide.id)!;
    expect(primary).toMatchObject({ type: "book", role: "primary", citationOverride: "Editorial escolar, 2026", manual: true });
    expect(secondary.role).toBeNull();
    await read(await as(educator, `/courses/${course}/bibliography`, "POST", { itemId: guide.id, role: "text", primary: true }), 201);
    const replaced = await read<{ resources: Resource[] }>(await as(educator, `/courses/${course}/resources`));
    expect(replaced.resources.filter(item => item.role === "primary")).toHaveLength(1);
    expect(replaced.resources.find(item => item.id === primary.id)?.role).toBe("required");
    const apa = await read<{ text: string }>(await as(educator, `/courses/${course}/bibliography?format=apa7`));
    expect(apa.text).toContain("(cita escrita a mano)");

    const page = "Las fracciones equivalentes comparan la misma cantidad escrita de dos maneras. ".repeat(4);
    await read(await as(educator, `/courses/${course}/resources/${secondary.id}/text`, "PUT", { sha256: guide.sha256, pages: [{ page: 1, text: page }] }));
    await read(await as(admin, "/curriculum-packages/cnb-matematicas-primaria-6/activate", "POST"));
    await read(await as(educator, `/courses/${course}/curriculum-packages/cnb-matematicas-primaria-6`, "POST", { codes: ["1.1"], version: await version() }), 201);
    const mapped = await read<{ book: { title: string } }>(await as(educator, `/courses/${course}/book-map?resourceId=${secondary.id}`, "POST", {}));
    expect(mapped.book.title).toBe("Guia del docente");

    const found = await read<{ record: { title: string } }>(await as(educator, `/courses/${course}/resources/lookup`, "POST", { isbn: "978-1" }));
    expect(found.record.title).toBe("Matemática 6");
    expect(await errorOf(await as(educator, `/courses/${course}/resources/lookup`, "POST", { isbn: "978-0" }), 504)).toContain("tardó demasiado");
    const article = await read<{ record: { title: string; type: string } }>(await as(educator, `/courses/${course}/resources/lookup`, "POST", { doi: "10.1000/fraccion" }));
    expect(article.record).toMatchObject({ type: "article", title: "La fracción como relación" });
    expect((await as(educator, `/courses/${course}/resources/lookup`, "POST", { doi: "10.1000/fraccion0" })).status).toBe(504);

    const hidden = await read<{ resource: Resource }>(await as(educator, `/courses/${course}/resources`, "POST", ficha({ title: "Notas del docente", shareable: false })), 201);
    const visible = await read<{ resource: Resource }>(await as(educator, `/courses/${course}/resources`, "POST", ficha({ title: "Lectura para el grado", shareable: true, role: "required" })), 201);
    const sectionA = await read<{ id: string }>(await as(admin, `/courses/${course}/groups`, "POST", { name: "Seccion A" }), 201);
    const sectionB = await read<{ id: string }>(await as(admin, `/courses/${course}/groups`, "POST", { name: "Seccion B" }), 201);
    await read(await as(admin, `/courses/${course}/groups/${sectionA.id}/educators`, "PUT", { userIds: ["user-educator"] }));
    await read(await as(admin, `/courses/${course}/groups/${sectionB.id}/educators`, "PUT", { userIds: ["user-1"] }));
    const unit = (await read<{ id: string }>(await as(educator, `/courses/${course}/units`, "POST", { version: await version(), name: "Fracciones", objective: "Leer", status: "active" }), 201)).id;
    const own = await read<{ id: string }>(await as(educator, `/courses/${course}/readings`, "POST", { unitId: unit, resourceId: visible.resource.id, groupId: sectionA.id, pages: "1-4", required: true }), 201);
    const ofB = await read<{ readings: Reading[] }>(await as(other, `/sections/${sectionB.id}/readings`));
    expect(ofB.readings.map(item => item.id)).not.toContain(own.id);
    expect((await as(other, `/sections/${sectionA.id}/readings`)).status).toBe(403);

    const learner = (await read<{ id: string }>(await as(admin, `/courses/${course}/groups/${sectionA.id}/learners`, "POST", { displayName: "Ana" }), 201)).id;
    await read(await as(educator, `/courses/${course}/readings`, "POST", { unitId: unit, resourceId: hidden.resource.id, pages: "1", required: false }), 201);
    const code = (await read<{ accessCode: string }>(await as(admin, `/courses/${course}/groups/${sectionA.id}/code`, "POST"))).accessCode;
    const login = await fetch(`${origin}/api/student/login`, { method: "POST", headers: { Origin: origin, "Content-Type": "application/json" }, body: JSON.stringify({ code }) });
    expect(login.status).toBe(200);
    const student = /hl_group=[^;]+/.exec(login.headers.get("set-cookie") || "")![0];
    const before = await read<{ readings: Reading[] }>(await fetch(`${origin}/api/student/readings`, { headers: { Cookie: student, Origin: origin } }));
    expect(before.readings.map(item => item.title)).toEqual(["Lectura para el grado"]);
    await read(await fetch(`${origin}/api/student/identity`, { method: "POST", headers: { Cookie: student, Origin: origin, "Content-Type": "application/json" }, body: JSON.stringify({ learnerId: learner }) }));
    await read(await fetch(`${origin}/api/student/readings/${own.id}/mark`, { method: "POST", headers: { Cookie: student, Origin: origin, "Content-Type": "application/json" }, body: "{}" }));
    const progress = await read<{ progress: { percent: number } }>(await as(educator, `/sections/${sectionA.id}/readings`));
    expect(progress.progress.percent).toBe(100);
  });
});
