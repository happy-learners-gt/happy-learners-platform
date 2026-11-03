import { createHash } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn, type ChildProcess } from "node:child_process";
import { createServer } from "node:net";
import { once } from "node:events";
import { setTimeout as delay } from "node:timers/promises";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { LegalSignature, SignatureRecord, SignatureVerification } from "@happy-learners/contracts";
import { canonicalJson, documentCanonical, legalDraftInput, pendingAgreement, pendingDocuments, signatureCanonical, signedNameInput } from "@happy-learners/domain";
import { listenOnTestPort } from "./test-port";

// ST-153 (firma electrónica de la aceptación) and ST-151 (acuerdo de voluntariado ad honorem), against the built
// Worker in a store of their own: publishing the terms gates every account of the organization.
const sha256 = (text: string) => createHash("sha256").update(text, "utf8").digest("hex");

describe("canonical fingerprints in the domain", () => {
  const document = { kind: "terms" as const, version: 3, title: "Términos ficticios", body: "Primer párrafo.\n\nSegundo «párrafo» con ñ.", publishedAt: "2026-10-01T10:00:00.000Z" };
  it("the canonical JSON is the same whatever the order of the keys, at every level", () => {
    expect(canonicalJson({ b: 1, a: { d: [3, { z: 1, y: 2 }], c: "x" } })).toBe('{"a":{"c":"x","d":[3,{"y":2,"z":1}]},"b":1}');
    expect(canonicalJson({ a: { c: "x", d: [3, { y: 2, z: 1 }] }, b: 1 })).toBe(canonicalJson({ b: 1, a: { d: [3, { z: 1, y: 2 }], c: "x" } }));
    const reordered = { publishedAt: document.publishedAt, body: document.body, version: 3, title: document.title, kind: "terms" as const };
    expect(documentCanonical(reordered)).toBe(documentCanonical(document));
    // Only the five fields of the version count: anything else that travels with it is left out.
    expect(documentCanonical({ ...document, id: "legal-x", status: "published" } as typeof document)).toBe(documentCanonical(document));
    expect(() => canonicalJson({ value: Number.NaN })).toThrow();
  });
  it("any changed byte of the document or of the signature gives another SHA-256", () => {
    const base = sha256(documentCanonical(document));
    expect(base).toMatch(/^[a-f0-9]{64}$/);
    expect(sha256(documentCanonical({ ...document }))).toBe(base);
    for (const changed of [{ ...document, body: document.body + " " }, { ...document, body: document.body.replace("ñ", "n") }, { ...document, title: "Términos ficticioS" }, { ...document, version: 4 }, { ...document, kind: "volunteer" as const }, { ...document, publishedAt: "2026-10-01T10:00:00.001Z" }])
      expect(sha256(documentCanonical(changed))).not.toBe(base);
    const record: SignatureRecord = { signatureId: "signature-1", organizationId: "org-demo", userId: "user-1", username: "ana", signedName: "Ana Pérez", documentId: "legal-1", kind: "terms", version: 3, documentSha256: base, signedAt: "2026-10-02T00:00:00.000Z" };
    const signature = sha256(signatureCanonical(record));
    expect(sha256(signatureCanonical({ ...record }))).toBe(signature);
    for (const key of Object.keys(record) as (keyof SignatureRecord)[])
      expect(sha256(signatureCanonical({ ...record, [key]: typeof record[key] === "number" ? 4 : `${record[key]}x` })), key).not.toBe(signature);
  });
  it("the signed name is kept as typed, trimmed, with 3 to 120 characters on one line", () => {
    expect(signedNameInput("  María José Núñez  ")).toBe("María José Núñez");
    for (const value of ["", "ab", "x".repeat(121), "Ana\nPérez", "<b>Ana</b>", "1234", 12, null]) expect(signedNameInput(value), String(value)).toBeNull();
  });
  it("the volunteer agreement is versioned like the terms and never gates the whole platform", () => {
    expect(legalDraftInput("volunteer", { title: "Acuerdo ficticio", body: "Texto ficticio del acuerdo de voluntariado." })).toMatchObject({ consent: null });
    expect(legalDraftInput("volunteer", { title: "Acuerdo ficticio", body: "Texto ficticio del acuerdo de voluntariado.", consent: "Acepto el tratamiento de datos." })).toBeNull();
    const published = [{ id: "v1", kind: "volunteer" as const, version: 1, title: "A" }, { id: "v2", kind: "volunteer" as const, version: 2, title: "A" }];
    expect(pendingDocuments(published, [])).toEqual([]);
    expect(pendingAgreement(published, ["v1"])?.id).toBe("v2");
    expect(pendingAgreement(published, ["v2"])).toBeNull();
    expect(pendingAgreement([], [])).toBeNull();
  });
});

let worker: ChildProcess;
let origin = "";
let logs = "";
const storage = mkdtempSync(join(tmpdir(), "hl-platform-signatures-"));
beforeAll(async () => {
  const server = createServer();
  await listenOnTestPort(server);
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

const password = "Aprender-2026!";
async function login(username: string) {
  const response = await fetch(`${origin}/api/login`, { method: "POST", headers: { "Content-Type": "application/json", Origin: origin }, body: JSON.stringify({ username, password }) });
  expect(response.status, await response.clone().text()).toBe(200);
  return response.headers.get("set-cookie")!.split(";")[0];
}
const call = (cookie: string, path: string, method = "GET", data?: unknown) =>
  fetch(origin + "/api" + path, { method, headers: { Cookie: cookie, Origin: origin, ...(data ? { "Content-Type": "application/json" } : {}) }, ...(data ? { body: JSON.stringify(data) } : {}) });
const read = async <T = Record<string, unknown>>(response: Response, status = 200): Promise<T> => { expect(response.status, await response.clone().text()).toBe(status); return response.json() as Promise<T>; };
type Doc = { id: string; kind: string; status: string; version: number; title: string; body: string; publishedAt: string };
type Mine = { documents: Doc[]; pending: { id: string; kind: string }[]; agreement: { id: string; version: number } | null; mine: { documentId: string; kind: string; signatureId: string | null; signedName: string | null; withdrawnAt: string | null }[]; signatures?: string[] };
const terms = { title: "Términos de uso ficticios", body: "Texto ficticio de los términos.\n\nSegundo párrafo de la demostración." };
async function publish(admin: string, kind: string, draft: Record<string, string>) {
  await read(await call(admin, `/legal/documents/${kind}`, "PUT", draft));
  return (await read<{ documents: Doc[] }>(await call(admin, `/legal/documents/${kind}/publish`, "POST"))).documents.find(item => item.kind === kind && item.status === "published")!;
}
/** Signs whatever closes the platform for this account, so the checks below reach what they test. */
async function signPending(cookie: string, fullName: string) {
  const { pending } = await read<Mine>(await call(cookie, "/legal"));
  if (pending.length) await read(await call(cookie, "/legal/accept", "POST", { documentIds: pending.map(item => item.id), signature: { fullName, password } }));
}
const documentHash = (document: Doc) => sha256(documentCanonical({ kind: document.kind as "terms", version: document.version, title: document.title, body: document.body, publishedAt: document.publishedAt }));
const receiptData = (html: string) => JSON.parse(/<script type="application\/json" id="hl-constancia">([^<]*)<\/script>/.exec(html)![1]) as SignatureRecord & { signatureSha256: string };
async function verified(admin: string, body: unknown) { return read<SignatureVerification>(await call(admin, "/legal/signatures/verify", "POST", body)); }

let termsV1: Doc, educatorSignature = "";
describe("ST-153 firma electrónica de la aceptación de los términos y condiciones", () => {
  it("ST-153 CA1: la persona firma escribiendo su nombre completo y confirmando su identidad con su contraseña", async () => {
    const admin = await login("admin-demo"), educator = await login("educador-demo");
    termsV1 = await publish(admin, "terms", terms);
    // Without a signature, with an unusable name or without the password, nothing is recorded.
    for (const body of [{ documentIds: [termsV1.id] }, { documentIds: [termsV1.id], signature: { fullName: "Ed", password } }, { documentIds: [termsV1.id], signature: { fullName: "Educador Demo" } }]) {
      const refused = await call(educator, "/legal/accept", "POST", body);
      expect(refused.status).toBe(400);
      expect((await refused.json()).code).toBe("SIGNATURE_REQUIRED");
    }
    // A wrong password is rejected and does not sign.
    const wrong = await call(educator, "/legal/accept", "POST", { documentIds: [termsV1.id], signature: { fullName: "Educador Demo", password: "otra-clave-incorrecta" } });
    expect(wrong.status).toBe(403);
    expect(await wrong.json()).toMatchObject({ code: "SIGNATURE_PASSWORD_INVALID" });
    expect((await read<Mine>(await call(educator, "/legal"))).pending.map(item => item.id)).toEqual([termsV1.id]);
    expect((await call(educator, "/courses")).status).toBe(403);
    const signed = await read<Mine>(await call(educator, "/legal/accept", "POST", { documentIds: [termsV1.id], signature: { fullName: "  Educador Demo Ficticio ", password } }));
    expect(signed.pending).toEqual([]);
    expect(signed.signatures).toHaveLength(1);
    educatorSignature = signed.signatures![0];
    expect(signed.mine.find(item => item.documentId === termsV1.id)).toMatchObject({ signatureId: educatorSignature, signedName: "Educador Demo Ficticio" });
    expect((await call(educator, "/courses")).status).toBe(200);
    // The privacy consent stays a simple consent, without a signature.
    const privacy = await publish(admin, "privacy", { title: "Privacidad ficticia", body: "Texto ficticio de la política de privacidad.", consent: "Doy mi consentimiento informado para el tratamiento de mis datos." });
    const consent = await read<Mine>(await call(educator, "/legal/accept", "POST", { documentIds: [privacy.id] }));
    expect(consent.mine.find(item => item.documentId === privacy.id)).toMatchObject({ signatureId: null });
    await signPending(admin, "Administración Demo");
  });

  it("ST-153 CA1: las contraseñas incorrectas se limitan: tras cinco fallos la firma espera 15 minutos", async () => {
    const marta = await login("marta.ruiz");
    const body = (secret: string) => ({ documentIds: [termsV1.id], signature: { fullName: "Marta Ruiz", password: secret } });
    for (let attempt = 0; attempt < 5; attempt++) expect((await call(marta, "/legal/accept", "POST", body(`incorrecta-${attempt}`))).status).toBe(403);
    const limited = await call(marta, "/legal/accept", "POST", body(password));
    expect(limited.status).toBe(429);
    expect(limited.headers.get("retry-after")).toBe("900");
    expect(await limited.json()).toMatchObject({ code: "SIGNATURE_RATE_LIMITED" });
    expect((await read<Mine>(await call(marta, "/legal"))).pending.map(item => item.id)).toContain(termsV1.id);
    // The limit is per account: another person still signs.
    await signPending(await login("sofia.castillo"), "Sofía Castillo");
  });

  it("ST-153 CA2: cada firma registra la versión, su huella SHA-256, la fecha y la cuenta, y genera una constancia descargable", async () => {
    const admin = await login("admin-demo"), educator = await login("educador-demo");
    const { signatures } = await read<{ signatures: LegalSignature[] }>(await call(admin, "/legal/signatures"));
    const signature = signatures.find(item => item.signatureId === educatorSignature)!;
    expect(signature).toMatchObject({ userId: "user-educator", username: "educador-demo", signedName: "Educador Demo Ficticio", documentId: termsV1.id, kind: "terms", version: termsV1.version, organizationId: "org-demo", active: true });
    expect(signature.signedAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    expect(signature.documentSha256).toBe(documentHash(termsV1));
    const record: SignatureRecord = { signatureId: signature.signatureId, organizationId: signature.organizationId, userId: signature.userId, username: signature.username, signedName: signature.signedName, documentId: signature.documentId, kind: signature.kind, version: signature.version, documentSha256: signature.documentSha256, signedAt: signature.signedAt };
    expect(signature.signatureSha256).toBe(sha256(signatureCanonical(record)));
    // The signer and administration download the receipt; nobody else does.
    const own = await call(educator, `/legal/signatures/${educatorSignature}/receipt`);
    expect(own.status).toBe(200);
    expect(own.headers.get("content-type")).toContain("text/html");
    expect(own.headers.get("content-disposition")).toBe(`attachment; filename="constancia-${educatorSignature}.html"`);
    const html = await own.text();
    for (const text of ["Constancia de firma electrónica", "Educador Demo Ficticio", "educador-demo", signature.documentSha256, signature.signatureSha256, signature.signedAt, "Segundo párrafo de la demostración.", "Firma electrónica simple (DEC-043)"]) expect(html).toContain(text);
    expect(html).not.toContain(password);
    expect(receiptData(html)).toEqual({ ...record, signatureSha256: signature.signatureSha256 });
    expect((await call(admin, `/legal/signatures/${educatorSignature}/receipt`)).status).toBe(200);
    expect((await call(await login("sofia.castillo"), `/legal/signatures/${educatorSignature}/receipt`)).status).toBe(404);
    expect((await call(educator, "/legal/signatures")).status).toBe(403);
    // Signing is in the activity, without the document's text; the backup carries the signatures and no password.
    const { events } = await read<{ events: { summary: string }[] }>(await call(admin, "/activity?limit=100"));
    expect(events.map(item => item.summary)).toContain(`Firmó electrónicamente la versión ${termsV1.version} de los términos y condiciones`);
    const backup = await read<{ tables: Record<string, { columns: string[]; rows: unknown[][] }> }>(await call(admin, "/organization/backup"));
    expect(backup.tables.legal_signatures.rows.length).toBe(signatures.length);
    expect(backup.tables.legal_signatures.columns).not.toContain("password_hash");
    expect(JSON.stringify(backup.tables.legal_signatures)).not.toContain(password);
  });

  it("ST-153 CA3: administración verifica una constancia y detecta si el documento firmado no coincide", async () => {
    const admin = await login("admin-demo"), educator = await login("educador-demo");
    const receipt = receiptData(await (await call(educator, `/legal/signatures/${educatorSignature}/receipt`)).text());
    expect((await verified(admin, { signatureId: educatorSignature })).status).toBe("valid");
    expect((await verified(admin, { receipt })).status).toBe("valid");
    const otherDocument = await verified(admin, { receipt: { ...receipt, documentSha256: sha256("otro documento") } });
    expect(otherDocument).toMatchObject({ status: "document_mismatch", mismatches: ["documentSha256"] });
    const renamed = await verified(admin, { receipt: { ...receipt, signedName: "Otra Persona" } });
    expect(renamed.status).toBe("receipt_mismatch");
    expect(renamed.mismatches).toContain("signedName");
    expect((await verified(admin, { receipt: { ...receipt, signatureSha256: "0".repeat(64) } })).status).toBe("receipt_mismatch");
    expect((await verified(admin, { signatureId: "signature-00000000-0000-0000-0000-000000000000" })).status).toBe("unknown");
    expect((await verified(admin, { signatureId: "<script>" })).status).toBe("unknown");
    expect((await call(educator, "/legal/signatures/verify", "POST", { signatureId: educatorSignature })).status).toBe(403);

    // The stored version is changed behind the platform's back (through a restore that skips its triggers): the
    // signature no longer matches the document it was given for.
    const backup = await read<{ tables: Record<string, { columns: string[]; rows: unknown[][] }>; digests: Record<string, string> }>(await call(admin, "/organization/backup"));
    const table = backup.tables.legal_documents, column = (name: string) => table.columns.indexOf(name);
    const tampered = structuredClone(backup);
    const row = tampered.tables.legal_documents.rows.find(item => item[column("id")] === termsV1.id)!;
    row[column("body")] = `${row[column("body")]} Cláusula añadida después.`;
    const canonical = (value: { columns: string[]; rows: unknown[][] }) => value.columns.join(",") + "\n" + value.rows.map(item => JSON.stringify(item)).sort().join("\n");
    tampered.digests.legal_documents = sha256(canonical(tampered.tables.legal_documents));
    await read(await call(admin, "/organization/restore", "POST", tampered));
    const mismatch = await verified(await login("admin-demo"), { signatureId: educatorSignature });
    expect(mismatch.status).toBe("document_mismatch");
    expect(mismatch.message).toContain("ya no coincide");
    await read(await call(await login("admin-demo"), "/organization/restore", "POST", backup));
    expect((await verified(await login("admin-demo"), { signatureId: educatorSignature })).status).toBe("valid");
  });
});

type ClassRow = { id: string; courseId: string; status: string };
type ContractView = { id: string; status: string; phase: string; templateVersion: number; documentSha256: string; memberSignature: { name: string } | null; userId: string };
const volunteerVersion = (version: number) => ({
  title: `Acuerdo de voluntariado ficticio v${version}`,
  body: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: `{{persona.nombre}} colabora como {{contrato.puesto}}. Texto ficticio del acuerdo de voluntariado ad honorem, versión ${version}. La actividad es voluntaria y sin remuneración económica.` }] }] },
  defaults: { role: "Educador voluntario", compensation: { kind: "none" }, term: { kind: "indefinite" } }, editable: ["role"],
});
let lucia: ContractView, volunteerTemplateId = "";
// DEC-046: the volunteer agreement ad honorem (ST-151) is a contract template of the volunteer engagement; its three
// criteria hold on contracts: it is published and versioned, each educator signs it before teaching, and the record of
// who signed which version stays after they leave.
describe("ST-151 acuerdo de voluntariado ad honorem", () => {
  it("ST-151 CA1: administración publica y versiona el acuerdo de voluntariado ad honorem", async () => {
    const admin = await login("admin-demo"), educator = await login("lucia.herrera");
    await signPending(educator, "Lucía Herrera");
    // Without a required contract nothing waits for it, and a class starts.
    const { classes } = await read<{ classes: ClassRow[] }>(await call(educator, "/classes"));
    const planned = classes.filter(item => item.status === "planned");
    expect(planned.length).toBeGreaterThan(1);
    await read(await call(educator, `/courses/${planned[0].courseId}/sessions/${planned[0].id}/start`, "POST"));
    expect((await call(educator, "/contract-templates", "POST", { template: { name: "Acuerdo", engagement: "volunteer" }, version: volunteerVersion(1) })).status).toBe(403);
    // Volunteer work is never paid.
    expect((await call(admin, "/contract-templates", "POST", { template: { name: "Acuerdo de voluntariado", engagement: "volunteer" }, version: { ...volunteerVersion(1), defaults: { role: "Educador", compensation: { kind: "hourly", amount: "10", currency: "GTQ" }, term: { kind: "indefinite" } } } })).status).toBe(400);
    volunteerTemplateId = (await read<{ template: { id: string } }>(await call(admin, "/contract-templates", "POST", { template: { name: "Acuerdo de voluntariado", engagement: "volunteer" }, version: volunteerVersion(1) }), 201)).template.id;
    await read(await call(admin, `/contract-templates/${volunteerTemplateId}/publish`, "POST", {}));
    await read(await call(admin, `/contract-templates/${volunteerTemplateId}/draft`, "PUT", volunteerVersion(2)));
    const { template } = await read<{ template: { versions: number; current: { version: number; title: string } } }>(await call(admin, `/contract-templates/${volunteerTemplateId}/publish`, "POST", {}));
    expect(template).toMatchObject({ versions: 2, current: { version: 2, title: volunteerVersion(2).title } });
    expect((await read<{ history: { version: number }[] }>(await call(admin, `/contract-templates/${volunteerTemplateId}`))).history.map(item => item.version)).toEqual([2, 1]);
    await read(await call(admin, "/contract-settings", "PUT", { required: true }));
    // The agreement does not close the platform: it waits only for teaching.
    expect((await read<{ pending: unknown[] }>(await call(educator, "/session"))).pending).toEqual([]);
    expect((await call(educator, "/courses")).status).toBe(200);
  });

  it("ST-151 CA2: cada educador lo aprueba con su firma digital antes de impartir clases", async () => {
    const admin = await login("admin-demo");
    const created = await read<{ member: { id: string }; temporaryPassword: string }>(await call(admin, "/members", "POST", { displayName: "Nora Voluntaria", username: "nora.voluntaria", role: "educator" }), 201);
    const first = await fetch(`${origin}/api/login`, { method: "POST", headers: { "Content-Type": "application/json", Origin: origin }, body: JSON.stringify({ username: "nora.voluntaria", password: created.temporaryPassword }) });
    expect(first.status).toBe(200);
    const educator = first.headers.get("set-cookie")!.split(";")[0];
    await read(await call(educator, "/account/password", "POST", { currentPassword: created.temporaryPassword, newPassword: password }));
    await signPending(educator, "Nora Voluntaria");
    const course = await read<{ id: string }>(await call(admin, "/courses", "POST", { title: "Curso de firma", objective: "El contrato espera antes de la clase.", status: "active", educationType: "non-formal", level: "unspecified", format: "workshop", modality: "in-person", pacing: "scheduled", area: "011", settings: { attendance: true }, programId: null, leadId: created.member.id }), 201);
    const group = await read<{ id: string }>(await call(admin, `/courses/${course.id}/groups`, "POST", { name: "Sección de firma" }), 201);
    await read(await call(admin, `/courses/${course.id}/groups/${group.id}/educators`, "PUT", { userIds: [created.member.id], conflictReason: "Sección de prueba." }));
    const today = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Guatemala", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
    await read(await call(admin, `/courses/${course.id}/groups/${group.id}/schedule`, "PUT", { weekdays: [0, 1, 2, 3, 4, 5, 6], startsAt: "08:00", durationMinutes: 45, from: today, until: today }));
    const { classes } = await read<{ classes: ClassRow[] }>(await call(educator, "/classes"));
    const planned = classes.find(item => item.status === "planned")!;
    expect(planned).toBeTruthy();
    const path = (item: ClassRow, action: string) => `/courses/${item.courseId}/sessions/${item.id}/${action}`;
    // Starting, taking the roll and completing a class all wait for the contract (the gate comes before the class state).
    for (const [action, method, body] of [["start", "POST", undefined], ["attendance", "PUT", { marks: [] }], ["complete", "POST", undefined]] as const) {
      const blocked = await call(educator, path(planned, action), method, body);
      expect(blocked.status, action).toBe(403);
      expect(await blocked.json()).toMatchObject({ code: "CONTRACT_REQUIRED" });
    }
    // Reading a class is not teaching it.
    expect((await call(educator, `/courses/${planned.courseId}/sessions/${planned.id}`)).status).toBe(200);
    expect((await call(educator, `/courses/${planned.courseId}/sessions/${planned.id}`)).status).toBe(200);
    const { contract } = await read<{ contract: ContractView }>(await call(admin, "/contracts", "POST", { templateId: volunteerTemplateId, userId: created.member.id, startDate: today }), 201);
    expect(contract.templateVersion).toBe(2);
    await read(await call(admin, `/contracts/${contract.id}/send`, "POST", { signature: { fullName: "Administración Demo", password } }));
    expect((await call(educator, `/contracts/${contract.id}/sign`, "POST", { signature: { fullName: "Nora Voluntaria" } })).status).toBe(400);
    lucia = (await read<{ contract: ContractView }>(await call(educator, `/contracts/${contract.id}/sign`, "POST", { signature: { fullName: "Nora Voluntaria", password } }))).contract;
    expect(lucia).toMatchObject({ status: "active", phase: "in-force", memberSignature: { name: "Nora Voluntaria" } });
    await read(await call(educator, path(planned, "start"), "POST"));
  });

  it("ST-151 CA3: administración ve quién aprobó qué versión y cuándo, y la aprobación se conserva tras la salida", async () => {
    const admin = await login("admin-demo");
    const { members } = await read<{ members: { id: string; username: string }[] }>(await call(admin, "/members"));
    const person = members.find(item => item.username === "nora.voluntaria")!;
    await read(await call(admin, `/members/${person.id}`, "PUT", { role: "educator", active: false }));
    const { contracts } = await read<{ contracts: ContractView[] }>(await call(admin, "/contracts"));
    expect(contracts.find(item => item.id === lucia.id)).toMatchObject({ userId: person.id, templateVersion: 2, status: "active", memberSignature: { name: "Nora Voluntaria" }, documentSha256: lucia.documentSha256 });
  });
});

// ST-044 with DEC-046: a contract can come with an invitation. A copy restored where that invitation does not exist
// (another store, or one taken back to an earlier copy) restores all the same; the invitation's link does not.
type Copy = { tables: Record<string, { columns: string[]; rows: unknown[][] }>; digests: Record<string, string> };
describe("ST-044 un respaldo con un contrato que llega con una invitación se restaura en otro espacio", () => {
  it("la invitación se copia sin su enlace, se restaura donde no existe y su enlace funciona solo después de reenviarla", async () => {
    expect(volunteerTemplateId).toBeTruthy();
    const today = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Guatemala", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
    const invited = await read<{ link: string; invitation: { id: string; contractId: string } }>(await call(await login("admin-demo"), "/invitations", "POST", {
      email: "vera.respaldo@example.test", displayName: "Vera Respaldo", role: "educator",
      contract: { templateId: volunteerTemplateId, startDate: today }, signature: { fullName: "Administración de la Demostración", password },
    }), 201);
    const token = (link: string) => /\/invitacion\/([a-z]_[a-f0-9]{64})$/.exec(link)![1];
    const opens = async (link: string) => (await fetch(`${origin}/api/invitations/accept/${token(link)}`)).status;
    const backup = await read<Copy>(await call(await login("admin-demo"), "/organization/backup"));
    const invitations = backup.tables.invitations, contracts = backup.tables.contracts;
    expect(invitations.columns).not.toContain("token_hash");
    expect(JSON.stringify(backup)).not.toContain(token(invited.link).slice(2));
    expect(contracts.rows.find(row => row[contracts.columns.indexOf("id")] === invited.invitation.contractId)![contracts.columns.indexOf("invitation_id")]).toBe(invited.invitation.id);

    // Restored in the store that issued it, the invitation keeps its link.
    await read(await call(await login("admin-demo"), "/organization/restore", "POST", backup));
    expect(await opens(invited.link)).toBe(200);

    // Where it does not exist (here, the same copy with another id for it), the copy restores with the contract
    // pointing to it, and the old link does not open it until administration resends the invitation.
    const canonical = (value: { columns: string[]; rows: unknown[][] }) => value.columns.join(",") + "\n" + value.rows.map(item => JSON.stringify(item)).sort().join("\n");
    const elsewhere = invited.invitation.id.replace(/.$/, last => last === "0" ? "1" : "0"), moved = structuredClone(backup);
    for (const row of moved.tables.invitations.rows) if (row[invitations.columns.indexOf("id")] === invited.invitation.id) row[invitations.columns.indexOf("id")] = elsewhere;
    for (const row of moved.tables.contracts.rows) if (row[contracts.columns.indexOf("invitation_id")] === invited.invitation.id) row[contracts.columns.indexOf("invitation_id")] = elsewhere;
    for (const name of ["invitations", "contracts"]) moved.digests[name] = sha256(canonical(moved.tables[name]));
    const restored = await read<{ restored: Record<string, number> }>(await call(await login("admin-demo"), "/organization/restore", "POST", moved));
    expect(restored.restored.invitations).toBe(invitations.rows.length);
    const admin = await login("admin-demo");
    expect((await read<{ contract: { status: string } }>(await call(admin, `/contracts/${invited.invitation.contractId}`))).contract.status).toBe("sent");
    expect(await opens(invited.link)).toBe(404);
    const resent = await read<{ link: string }>(await call(admin, `/invitations/${elsewhere}/resend`, "POST"));
    expect(await opens(resent.link)).toBe(200);

    // A copy taken before invitations were copied still restores and leaves the store's invitations as they are.
    const legacy = structuredClone(moved);
    delete legacy.tables.invitations; delete legacy.digests.invitations;
    await read(await call(admin, "/organization/restore", "POST", legacy));
    expect(await opens(resent.link)).toBe(200);
  });
});
