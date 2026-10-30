import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn, type ChildProcess } from "node:child_process";
import { createServer } from "node:net";
import { once } from "node:events";
import { setTimeout as delay } from "node:timers/promises";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { defaultTemplate, pdfString } from "../packages/domain/src/index";

// 1.5.0 (docs/design/constructor-de-reportes.md) on the built Worker: templates, images, preview, report card, certificate.
let worker: ChildProcess;
let origin = "", logs = "";
const storage = mkdtempSync(join(tmpdir(), "hl-platform-reports-"));
beforeAll(async () => {
  const server = createServer();
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
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
    try { if ((await fetch(`${origin}/api/health`, { signal: AbortSignal.timeout(500) })).ok) return; } catch { /* Wait for the local runtime. */ }
    await delay(200);
  }
  throw new Error(`Local Worker did not start:\n${logs}`);
}, 60_000);
afterAll(async () => {
  if (worker && worker.exitCode === null) { const exited = once(worker, "exit"); worker.kill("SIGTERM"); await exited; }
  rmSync(storage, { recursive: true, force: true });
});

async function signIn(username: string) {
  const response = await fetch(`${origin}/api/login`, { method: "POST", headers: { "Content-Type": "application/json", Origin: origin }, body: JSON.stringify({ username, password: "Aprender-2026!" }) });
  expect(response.status).toBe(200);
  return response.headers.get("set-cookie")!.split(";")[0];
}
const as = (cookie: string, path: string, method = "GET", data?: unknown) => fetch(`${origin}/api${path}`, { method, headers: { Cookie: cookie, Origin: origin, ...(data !== undefined ? { "Content-Type": "application/json" } : {}) }, ...(data !== undefined ? { body: JSON.stringify(data) } : {}) });
const read = async <T = Record<string, unknown>>(response: Response, status = 200) => { const text = await response.text(); expect(response.status, text).toBe(status); return JSON.parse(text) as T; };
const pdf = async (response: Response) => { expect(response.status, response.status === 200 ? "" : await response.clone().text()).toBe(200); expect(response.headers.get("Content-Type")).toBe("application/pdf"); return new TextDecoder().decode(await response.arrayBuffer()); };
/** Text as the PDF writes it inside a string, so a phrase inside a longer line is found too. */
const inPdf = (text: string) => pdfString(text).slice(1, -1);
const jpeg = Uint8Array.from([0xff, 0xd8, 0xff, 0xc0, 0x00, 0x11, 0x08, 0x00, 0x02, 0x00, 0x03, 0x03, 1, 0x22, 0, 2, 0x11, 1, 3, 0x11, 1, 0xff, 0xd9]);
type Template = { id: string; kind: string; draft: ReturnType<typeof defaultTemplate>; publishedVersion: number | null };

describe("1.5.0 report builder on the built Worker", () => {
  it("designs, previews and publishes a report card and a certificate; without a template documents keep their format", async () => {
    const admin = await signIn("admin-demo"), educator = await signIn("lucia.herrera");
    expect((await as(educator, "/report-templates")).status).toBe(403);
    const section = "seed-group-mat-6a";
    const book = await read<{ gradebook: { learners: { id: string; name: string }[]; year: { name: string } } }>(await as(admin, `/sections/${section}/grades`));
    const learner = book.gradebook.learners[0], year = book.gradebook.year.name;

    // Before any template, the report card is the one it always was.
    const before = await pdf(await as(admin, `/sections/${section}/grades/report.pdf?learner=${learner.id}`));
    expect(before).toContain(inPdf("Boleta informativa de Happy Learners"));

    const created = await read<{ template: Template }>(await as(admin, "/report-templates", "POST", { kind: "report-card" }), 201);
    expect(created.template.draft).toEqual(defaultTemplate("report-card"));
    expect((await as(admin, "/report-templates", "POST", { kind: "report-card" })).status).toBe(409);

    expect((await fetch(`${origin}/api/report-images`, { method: "POST", headers: { Cookie: admin, Origin: origin, "Content-Type": "image/png", "X-File-Name": "logo.png" }, body: Uint8Array.from([0x89, 0x50, 0x4e, 0x47]) })).status).toBe(400);
    const image = await read<{ image: { id: string; width: number } }>(await fetch(`${origin}/api/report-images`, { method: "POST", headers: { Cookie: admin, Origin: origin, "Content-Type": "image/jpeg", "X-File-Name": "logo.jpg" }, body: jpeg }), 201);
    expect(image.image.width).toBe(3);

    const draft = { ...created.template.draft, logoId: image.image.id, header: ["{{organizacion.nombre}}", "Boleta oficial del ciclo {{ciclo.nombre}}"] };
    expect(await read(await as(admin, `/report-templates/${created.template.id}`, "PUT", { draft: { ...draft, header: ["{{estudiante.contrasena}}"] } }), 400)).toEqual({ error: "El campo {{estudiante.contrasena}} no existe en un documento de tipo «Boleta de calificaciones»." });
    await read(await as(admin, `/report-templates/${created.template.id}`, "PUT", { draft }));

    // The preview draws the draft with the section's real data and the logo.
    const preview = await pdf(await as(admin, `/report-templates/${created.template.id}/preview`, "POST", { sectionId: section, learnerId: learner.id }));
    expect(preview).toContain(inPdf(`Boleta oficial del ciclo ${year}`));
    expect(preview).toContain(inPdf(learner.name));
    expect(preview).toContain("/Subtype /Image");
    // Still a draft: the report card has not changed.
    expect(await pdf(await as(admin, `/sections/${section}/grades/report.pdf?learner=${learner.id}`))).toContain(inPdf("Boleta informativa de Happy Learners"));

    const published = await read<{ template: Template; versions: { version: number }[] }>(await as(admin, `/report-templates/${created.template.id}/publish`, "POST", {}));
    expect(published.template.publishedVersion).toBe(1);
    const after = await pdf(await as(educator, `/sections/${section}/grades/report.pdf?learner=${learner.id}`));
    expect(after).toContain(inPdf(`Boleta oficial del ciclo ${year}`));
    expect(after).not.toContain(inPdf("Boleta informativa de Happy Learners"));

    // Editing the draft after publishing does not change documents until the next version; a version can be restored.
    await read(await as(admin, `/report-templates/${created.template.id}`, "PUT", { draft: { ...draft, header: ["Otra cabecera"] } }));
    expect(await pdf(await as(admin, `/sections/${section}/grades/report.pdf?learner=${learner.id}`))).toContain(inPdf(`Boleta oficial del ciclo ${year}`));
    const restored = await read<{ template: Template }>(await as(admin, `/report-templates/${created.template.id}/restore?version=1`, "POST"));
    expect(restored.template.draft.header).toEqual(draft.header);

    // The certificate: the default template until the organization designs its own.
    const certificate = await pdf(await as(educator, `/sections/${section}/grades/certificate.pdf?learner=${learner.id}&tipo=finalizacion`));
    expect(certificate).toContain(inPdf("Constancia de finalización"));
    expect(certificate).toContain(inPdf(learner.name));
    expect((await as(educator, `/sections/${section}/grades/certificate.pdf?learner=no-existe`)).status).toBe(404);
  }, 120_000);
});
