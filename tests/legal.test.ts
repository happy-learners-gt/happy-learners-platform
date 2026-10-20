import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn, type ChildProcess } from "node:child_process";
import { createServer } from "node:net";
import { once } from "node:events";
import { setTimeout as delay } from "node:timers/promises";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { legalDraftInput, pendingDocuments } from "@happy-learners/domain";

// ST-126 (HL-172) and ST-127 (HL-173) against the built Worker, in a store of their own: publishing a version gates
// every account of the organization, so these checks never share data with the other acceptance tests.
let worker: ChildProcess;
let origin = "";
let logs = "";
const storage = mkdtempSync(join(tmpdir(), "hl-platform-legal-"));
beforeAll(async () => {
  const server = createServer();
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Missing local port");
  await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  origin = `http://127.0.0.1:${address.port}`;
  worker = spawn("node_modules/.bin/wrangler", ["dev", "--local", "--config", "build/wrangler.json", "--ip", "127.0.0.1", "--port", String(address.port), "--inspector-port", "0", "--persist-to", storage, "--var", "RESTORE_ENABLED:true"], {
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

async function login(username: string) {
  const response = await fetch(`${origin}/api/login`, { method: "POST", headers: { "Content-Type": "application/json", Origin: origin }, body: JSON.stringify({ username, password: "Aprender-2026!" }) });
  expect(response.status, await response.clone().text()).toBe(200);
  return response.headers.get("set-cookie")!.split(";")[0];
}
const call = (cookie: string, path: string, method = "GET", data?: unknown) =>
  fetch(origin + "/api" + path, { method, headers: { Cookie: cookie, Origin: origin, ...(data ? { "Content-Type": "application/json" } : {}) }, ...(data ? { body: JSON.stringify(data) } : {}) });
const read = async <T = Record<string, unknown>>(response: Response, status = 200): Promise<T> => { expect(response.status, await response.clone().text()).toBe(status); return response.json() as Promise<T>; };
type Doc = { id: string; kind: string; status: string; version: number | null; title: string; body: string; consent: string | null; publishedAt: string | null };
type Record_ = { documentId: string; kind: string; version: number; userId: string; name: string; acceptedAt: string; withdrawnAt: string | null };
// Since ST-153 the terms are signed with the full name and the account's password.
const signed = (fullName: string) => ({ fullName, password: "Aprender-2026!" });
const terms = { title: "Términos de uso ficticios", body: "Texto ficticio de prueba.\n\nSegundo párrafo de los términos de la demostración." };
const privacy = { title: "Política de privacidad ficticia", body: "Texto ficticio de la política de privacidad de la demostración.", consent: "Doy mi consentimiento informado para el tratamiento de mis datos." };

describe("legal documents in the domain", () => {
  it("accepts plain-text drafts and requires the consent text only for the privacy policy", () => {
    expect(legalDraftInput("terms", { ...terms, title: "  Términos  " })).toEqual({ title: "Términos", body: terms.body, consent: null, bodyJson: null });
    expect(legalDraftInput("privacy", privacy)).toEqual({ ...privacy, bodyJson: null });
    // DEC-046: a rich-text body keeps its document and derives the plain text that the fingerprint reads.
    const rich = { type: "doc", content: [{ type: "heading", attrs: { level: 2 }, content: [{ type: "text", text: "Uso de la plataforma" }] }, { type: "paragraph", content: [{ type: "text", text: "Texto con ", marks: [{ type: "bold" }] }, { type: "text", text: "formato suficiente." }] }] };
    expect(legalDraftInput("terms", { title: "Términos", bodyJson: rich })).toEqual({ title: "Términos", body: "Uso de la plataforma\n\nTexto con formato suficiente.", consent: null, bodyJson: rich });
    expect(legalDraftInput("terms", { title: "Términos", bodyJson: { type: "doc", content: [{ type: "script", text: "x" }] } })).toBeNull();
    expect(legalDraftInput("privacy", { ...privacy, consent: "" })).toBeNull();
    expect(legalDraftInput("terms", { ...terms, consent: "Acepto el tratamiento de datos." })).toBeNull();
    expect(legalDraftInput("terms", { ...terms, title: "<b>T</b>" })).toBeNull();
    expect(legalDraftInput("terms", { ...terms, body: "corto" })).toBeNull();
    expect(legalDraftInput("terms", { ...terms, body: "x".repeat(60001) })).toBeNull();
    expect(legalDraftInput("terms", null)).toBeNull();
  });
  it("asks for the latest version of each kind until it is accepted, and nothing without publications", () => {
    const published = [{ id: "t1", kind: "terms" as const, version: 1, title: "T" }, { id: "t2", kind: "terms" as const, version: 2, title: "T" }, { id: "p1", kind: "privacy" as const, version: 1, title: "P" }];
    expect(pendingDocuments([], [])).toEqual([]);
    expect(pendingDocuments(published, ["t1"]).map(item => item.id)).toEqual(["t2", "p1"]);
    expect(pendingDocuments(published, ["t2", "p1"])).toEqual([]);
  });
});

describe("ST-126 (HL-172) terms and conditions", () => {
  it("an organization without published documents asks nobody to accept anything", async () => {
    const educator = await login("educador-demo");
    expect((await read<{ pending: unknown[] }>(await call(educator, "/session"))).pending).toEqual([]);
    expect((await call(educator, "/courses")).status).toBe(200);
  });
  it("ST-126 CA1: administración redacta y publica una nueva versión de los términos", async () => {
    const admin = await login("admin-demo"), educator = await login("educador-demo");
    expect((await call(educator, "/legal/documents/terms", "PUT", terms)).status).toBe(403);
    expect((await call(admin, "/legal/documents/terms/publish", "POST")).status).toBe(409);
    expect((await call(admin, "/legal/documents/terms", "PUT", { ...terms, body: "<script>" })).status).toBe(400);
    const draft = await read<{ documents: Doc[] }>(await call(admin, "/legal/documents/terms", "PUT", terms));
    expect(draft.documents.find(item => item.status === "draft")).toMatchObject({ kind: "terms", status: "draft", version: null, title: terms.title });
    // Saving again edits the same draft.
    const edited = await read<{ documents: Doc[] }>(await call(admin, "/legal/documents/terms", "PUT", { ...terms, title: "Términos de uso ficticios v1" }));
    expect(edited.documents.filter(item => item.status === "draft")).toHaveLength(1);
    const published = await read<{ documents: Doc[] }>(await call(admin, "/legal/documents/terms/publish", "POST"));
    const latest = published.documents.find(item => item.kind === "terms" && item.status === "published" && item.title === "Términos de uso ficticios v1")!;
    expect(latest).toMatchObject({ kind: "terms", status: "published", title: "Términos de uso ficticios v1" });
    expect(latest.version).toBeGreaterThanOrEqual(1);
    expect(latest.publishedAt).toBeTruthy();
  });
  it("ST-126 CA2: al publicarla, cada persona debe aceptarla en su siguiente ingreso", async () => {
    const educator = await login("educador-demo");
    const session = await read<{ pending: { kind: string; version: number }[] }>(await call(educator, "/session"));
    expect(session.pending).toMatchObject([{ kind: "terms" }]);
    expect(session.pending[0].version).toBeGreaterThanOrEqual(1);
    // Until then the platform answers only the session, the organization and the documents to accept.
    const blocked = await call(educator, "/courses");
    expect(blocked.status).toBe(403);
    expect((await blocked.json()).pending).toHaveLength(1);
    expect((await call(educator, "/organization")).status).toBe(200);
    const current = await read<{ documents: Doc[] }>(await call(educator, "/legal"));
    expect(current.documents.some(item => item.kind === "terms" && item.status === "published")).toBe(true);
    const accepted = await read<{ pending: unknown[] }>(await call(educator, "/legal/accept", "POST", { documentIds: [current.documents[0].id], signature: signed("Educador Demo") }));
    expect(accepted.pending).toEqual([]);
    expect((await call(educator, "/courses")).status).toBe(200);
    // Administration is asked as well, including whoever published.
    expect((await call(await login("admin-demo"), "/courses")).status).toBe(403);
  });
  it("ST-126 CA3: se registra quién aceptó qué versión y cuándo, y las versiones anteriores se conservan", async () => {
    const admin = await login("admin-demo"), educator = await login("educador-demo");
    const v1 = (await read<{ documents: Doc[] }>(await call(admin, "/legal"))).documents[0];
    await read(await call(admin, "/legal/accept", "POST", { documentIds: [v1.id], signature: signed("Administración Demo") }));
    await read(await call(admin, "/legal/documents/terms", "PUT", { ...terms, title: "Términos de uso ficticios v2" }));
    const after = await read<{ documents: Doc[] }>(await call(admin, "/legal/documents/terms/publish", "POST"));
    expect(after.documents.map(item => [item.version, item.title])).toEqual(expect.arrayContaining([[expect.any(Number), "Términos de uso ficticios v2"], [expect.any(Number), "Términos de uso ficticios v1"]]));
    // Accepting an earlier version is refused: only the one in force counts.
    expect((await call(educator, "/legal/accept", "POST", { documentIds: [v1.id] })).status).toBe(409);
    expect((await read<{ pending: { kind: string }[] }>(await call(educator, "/session"))).pending).toMatchObject([{ kind: "terms" }]);
    await read(await call(educator, "/legal/accept", "POST", { documentIds: [after.documents[0].id], signature: signed("Educador Demo") }));
    const { acceptances } = await read<{ acceptances: Record_[] }>(await call(admin, "/legal/acceptances"));
    const educatorRecords = acceptances.filter(item => item.userId === "user-educator").map(item => item.version).sort();
    expect(educatorRecords.length).toBeGreaterThanOrEqual(2);
    expect(acceptances.filter(item => item.kind === "terms").every(item => /^\d{4}-\d{2}-\d{2}T/.test(item.acceptedAt) && item.name)).toBe(true);
    expect((await call(educator, "/legal/acceptances")).status).toBe(403);
    await read(await call(admin, "/legal/accept", "POST", { documentIds: [after.documents[0].id], signature: signed("Administración Demo") }));
    // Published versions and acceptances are recorded in the activity log, without their text.
    const events = (await read<{ events: { action: string; targetType: string; summary: string }[] }>(await call(admin, "/activity?limit=100"))).events.filter(item => item.targetType === "legal");
    expect(events.map(item => item.action)).toEqual(expect.arrayContaining(["published", "accepted"]));
    expect(events.some(item => item.summary.includes("ficticio"))).toBe(false);
  });
});

describe("ST-127 (HL-173) privacy policy and informed consent", () => {
  it("ST-127 CA1: administración publica y versiona la política de privacidad y el texto de consentimiento", async () => {
    const admin = await login("admin-demo");
    expect((await call(admin, "/legal/documents/privacy", "PUT", { ...privacy, consent: undefined })).status).toBe(400);
    await read(await call(admin, "/legal/documents/privacy", "PUT", privacy));
    const first = await read<{ documents: Doc[] }>(await call(admin, "/legal/documents/privacy/publish", "POST"));
    expect(first.documents.find(item => item.kind === "privacy" && item.title === privacy.title)).toMatchObject({ consent: privacy.consent });
    await read(await call(admin, "/legal/documents/privacy", "PUT", { ...privacy, consent: "Acepto el tratamiento de mis datos según la versión 2." }));
    const second = await read<{ documents: Doc[] }>(await call(admin, "/legal/documents/privacy/publish", "POST"));
    expect(second.documents.filter(item => item.kind === "privacy").map(item => item.consent)).toEqual(expect.arrayContaining(["Acepto el tratamiento de mis datos según la versión 2.", privacy.consent]));
  });
  it("ST-127 CA2: la política vigente es pública y se puede consultar sin iniciar sesión", async () => {
    const response = await fetch(`${origin}/api/public/privacy?organization=org-demo`);
    const { policies } = await read<{ policies: { organization: { id: string }; document: Record<string, unknown> }[] }>(response);
    expect(policies).toHaveLength(1);
    expect(policies[0].organization.id).toBe("org-demo");
    expect(policies[0].document).toMatchObject({ kind: "privacy", title: privacy.title });
    expect((policies[0].document.version as number)).toBeGreaterThanOrEqual(1);
    expect(policies[0].document).not.toHaveProperty("publishedBy");
    expect(response.headers.get("content-security-policy")).toContain("default-src 'self'");
    expect((await read<{ policies: unknown[] }>(await fetch(`${origin}/api/public/privacy`))).policies).toHaveLength(1);
    expect((await fetch(`${origin}/api/public/privacy?organization=org-other`)).status).toBe(404);
    expect((await fetch(`${origin}/api/public/privacy?organization=nada`)).status).toBe(404);
    expect((await fetch(`${origin}/api/public/privacy`, { method: "POST", headers: { Origin: origin } })).status).toBe(405);
    const page = await fetch(`${origin}/privacidad`, { headers: { "Sec-Fetch-Mode": "navigate" } });
    expect(page.status).toBe(200);
    expect(page.headers.get("content-type")).toContain("text/html");
    // The terms stay private.
    expect((await fetch(`${origin}/api/legal`)).status).toBe(401);
  });
  it("ST-127 CA3: el consentimiento de cada persona queda registrado con su versión y su fecha, y puede retirarse", async () => {
    const admin = await login("admin-demo"), educator = await login("educador-demo");
    const current = await read<{ documents: Doc[]; pending: { kind: string }[] }>(await call(educator, "/legal"));
    expect(current.pending.map(item => item.kind)).toEqual(["privacy"]);
    const policy = current.documents.find(item => item.kind === "privacy")!;
    expect((await call(educator, "/courses")).status).toBe(403);
    const consented = await read<{ pending: unknown[]; mine: Record_[] }>(await call(educator, "/legal/accept", "POST", { documentIds: [policy.id] }));
    expect(consented.pending).toEqual([]);
    expect(consented.mine.find(item => item.documentId === policy.id)).toMatchObject({ kind: "privacy", withdrawnAt: null });
    expect((await call(educator, "/courses")).status).toBe(200);
    // Terms are not withdrawn; the privacy consent is, and the record stays with its withdrawal date.
    const termsInForce = current.documents.find(item => item.kind === "terms")!;
    expect((await call(educator, "/legal/withdraw", "POST", { documentId: termsInForce.id })).status).toBe(400);
    const withdrawn = await read<{ pending: { kind: string }[]; mine: Record_[] }>(await call(educator, "/legal/withdraw", "POST", { documentId: policy.id }));
    expect(withdrawn.pending.map(item => item.kind)).toEqual(["privacy"]);
    const record = withdrawn.mine.find(item => item.documentId === policy.id)!;
    expect(record.withdrawnAt! >= record.acceptedAt).toBe(true);
    expect((await call(educator, "/legal/withdraw", "POST", { documentId: policy.id })).status).toBe(404);
    // Without consent the platform stays closed; consenting again adds a new record.
    expect((await call(educator, "/courses")).status).toBe(403);
    const again = await read<{ mine: Record_[] }>(await call(educator, "/legal/accept", "POST", { documentIds: [policy.id] }));
    expect(again.mine.filter(item => item.documentId === policy.id).map(item => !!item.withdrawnAt).sort()).toEqual([false, true]);
    const { acceptances } = await read<{ acceptances: Record_[] }>(await call(admin, "/legal/acceptances"));
    expect(acceptances.filter(item => item.userId === "user-educator" && item.kind === "privacy" && item.documentId === policy.id)).toHaveLength(2);
    const adminPending = (await read<{ pending: { id: string }[] }>(await call(admin, "/session"))).pending;
    if (adminPending.length) await read(await call(admin, "/legal/accept", "POST", { documentIds: adminPending.map(item => item.id), signature: signed("Administración Demo") }));
    await read(await call(admin, "/legal/accept", "POST", { documentIds: [policy.id] }));
    const { events } = await read<{ events: { action: string; targetType: string }[] }>(await call(admin, "/activity?limit=100"));
    expect(events.filter(item => item.targetType === "legal").map(item => item.action)).toContain("withdrawn");
  });
  it("backups carry the documents and the acceptances, and a restore brings them back", async () => {
    const admin = await login("admin-demo");
    const pending = (await read<{ pending: { id: string }[] }>(await call(admin, "/session"))).pending;
    if (pending.length) await read(await call(admin, "/legal/accept", "POST", { documentIds: pending.map(item => item.id), signature: signed("Administración Demo") }));
    const backup = await read<{ tables: Record<string, { rows: unknown[] }>; digests: Record<string, string> }>(await call(admin, "/organization/backup"));
    expect(backup.tables.legal_documents.rows.length).toBeGreaterThanOrEqual(4);
    expect(backup.tables.legal_acceptances.rows.length).toBeGreaterThanOrEqual(6);
    const restored = await read<{ restored: Record<string, number> }>(await call(admin, "/organization/restore", "POST", backup));
    expect(restored.restored.legal_documents).toBe(backup.tables.legal_documents.rows.length);
    expect(restored.restored.legal_acceptances).toBe(backup.tables.legal_acceptances.rows.length);
    expect((await read<{ pending: unknown[] }>(await call(await login("educador-demo"), "/session"))).pending).toEqual([]);
  });
});
