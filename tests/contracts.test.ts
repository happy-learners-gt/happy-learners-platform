import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn, type ChildProcess } from "node:child_process";
import { createServer } from "node:net";
import { once } from "node:events";
import { setTimeout as delay } from "node:timers/promises";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Contract, ContractTemplate, ContractTerms, RichTextDocument } from "../packages/contracts/src/index";
import {
  compensationAllowed, compensationSummary, contractCanonical, contractDatesInput, contractInForce, contractPhase, contractTermsFor, contractTermsInput, contractVersionInput,
  mergeContract, richPlainText,
} from "../packages/domain/src/index";

// DEC-046: contracts agnostic to the kind of engagement. Domain rules first, then the whole flow on the built Worker:
// templates and versions, a contract prepared, signed by the organization and by the person, the teaching gate, an
// invitation that comes with a contract, termination and amendment.
const doc = (...paragraphs: string[]): RichTextDocument => ({ type: "doc", content: paragraphs.map(text => ({ type: "paragraph", content: [{ type: "text", text }] })) });
const volunteer: ContractTerms = { role: "Educador voluntario", compensation: { kind: "none" }, term: { kind: "indefinite" }, weeklyHours: 4 };
const services: ContractTerms = { role: "Tutor de matemáticas", compensation: { kind: "hourly", amount: "125.50", currency: "GTQ" }, term: { kind: "fixed", months: 6 }, noticeDays: 15, location: "hybrid" };

describe("DEC-046 contract rules", () => {
  it("who is paid follows from the engagement", () => {
    expect(compensationAllowed("volunteer", "none")).toBe(true);
    expect(compensationAllowed("volunteer", "hourly")).toBe(false);
    expect(compensationAllowed("employment", "none")).toBe(false);
    expect(compensationAllowed("services", "per-session")).toBe(true);
    expect(compensationAllowed("other", "none")).toBe(true);
    expect(contractTermsInput("volunteer", { ...volunteer, compensation: { kind: "fixed", amount: "100", currency: "USD", period: "month" } })).toBeNull();
    expect(contractTermsInput("services", services)).toEqual(services);
  });
  it("terms are validated whole: amounts, ISO currencies, periods, bounds and plain text", () => {
    const pay = (compensation: unknown) => contractTermsInput("employment", { role: "Docente", compensation, term: { kind: "indefinite" } });
    expect(pay({ kind: "fixed", amount: "4500.00", currency: "GTQ", period: "month" })?.compensation).toEqual({ kind: "fixed", amount: "4500.00", currency: "GTQ", period: "month" });
    for (const bad of [{ kind: "fixed", amount: "4500", currency: "GTQ" }, { kind: "hourly", amount: "-1", currency: "GTQ" }, { kind: "hourly", amount: "0", currency: "GTQ" },
      { kind: "hourly", amount: "10.999", currency: "GTQ" }, { kind: "hourly", amount: "10", currency: "gtq" }, { kind: "hourly", amount: 10, currency: "GTQ" }, { kind: "gift" }]) expect(pay(bad), JSON.stringify(bad)).toBeNull();
    expect(contractTermsInput("volunteer", { ...volunteer, weeklyHours: 81 })).toBeNull();
    expect(contractTermsInput("volunteer", { ...volunteer, role: "<b>x</b>" })).toBeNull();
    expect(contractTermsInput("volunteer", { ...volunteer, term: { kind: "fixed", months: 0 } })).toBeNull();
    expect(contractTermsInput("volunteer", { ...volunteer, location: "moon" })).toBeNull();
  });
  it("a contract changes only the terms its template makes editable", () => {
    expect(contractTermsFor("services", services, ["role", "compensation"], { role: "Tutor de física" })?.role).toBe("Tutor de física");
    expect(contractTermsFor("services", services, ["role"], { noticeDays: 30 })).toBeNull();
    expect(contractTermsFor("services", services, ["compensation"], { compensation: { kind: "none" } })).toBeNull();
    expect(contractTermsFor("services", services, [], undefined)).toEqual(services);
  });
  it("dates: an indefinite term has no end; a fixed one ends on its date or after its months", () => {
    expect(contractDatesInput(volunteer, { startDate: "2026-11-02" })).toEqual({ startDate: "2026-11-02", endDate: null });
    expect(contractDatesInput(volunteer, { startDate: "2026-11-02", endDate: "2027-01-01" })).toBeNull();
    expect(contractDatesInput(services, { startDate: "2026-01-31" })).toEqual({ startDate: "2026-01-31", endDate: "2026-07-30" });
    expect(contractDatesInput(services, { startDate: "2026-11-01", endDate: "2026-12-15" })).toEqual({ startDate: "2026-11-01", endDate: "2026-12-15" });
    expect(contractDatesInput(services, { startDate: "2026-11-01", endDate: "2026-10-15" })).toBeNull();
    expect(contractDatesInput(services, { startDate: "2026-02-30" })).toBeNull();
  });
  it("a template version needs a title, rich clauses and defaults that fit its engagement", () => {
    const version = { title: "Contrato de servicios", body: doc("Cláusula primera: {{persona.nombre}} presta servicios de tutoría."), defaults: services, editable: ["role", "role", "compensation"] };
    expect(contractVersionInput("services", version)).toMatchObject({ title: "Contrato de servicios", editable: ["role", "compensation"], effectiveFrom: null });
    expect(contractVersionInput("volunteer", version)).toBeNull();
    expect(contractVersionInput("services", { ...version, body: doc("Corto") })).toBeNull();
    expect(contractVersionInput("services", { ...version, editable: ["salary"] })).toBeNull();
    expect(contractVersionInput("services", { ...version, body: { type: "doc", content: [{ type: "script", text: "x" }] } })).toBeNull();
    expect(contractVersionInput("services", { ...version, effectiveFrom: "2026-13-01" })).toBeNull();
  });
  it("placeholders are filled into the contract's own copy and the summary reads like the terms", () => {
    const merged = mergeContract(doc("Entre {{organizacion.nombre}} y {{persona.nombre}}, como {{contrato.puesto}}, por {{contrato.remuneracion}}. {{desconocido}}"),
      { "organizacion.nombre": "Colegio Horizonte", "persona.nombre": "Ana López", "contrato.puesto": "tutora", "contrato.remuneracion": compensationSummary(services) });
    expect(richPlainText(merged).replace(/\s/g, " ")).toBe("Entre Colegio Horizonte y Ana López, como tutora, por 125,50 GTQ por hora. {{desconocido}}");
    expect(compensationSummary(volunteer)).toBe("Sin remuneración (ad honorem)");
  });
  it("where a contract stands: awaiting signature, scheduled, in force, ending, expired", () => {
    const base = { startDate: "2026-11-01", endDate: "2026-12-31", terminationDate: null };
    expect(contractPhase({ ...base, status: "sent" }, "2026-10-20")).toBe("awaiting-signature");
    expect(contractPhase({ ...base, status: "active" }, "2026-10-20")).toBe("scheduled");
    expect(contractPhase({ ...base, status: "active" }, "2026-11-01")).toBe("in-force");
    expect(contractPhase({ ...base, status: "active" }, "2027-01-01")).toBe("expired");
    expect(contractPhase({ ...base, status: "terminated", terminationDate: "2026-11-15" }, "2026-11-10")).toBe("ending");
    expect(contractPhase({ ...base, status: "terminated", terminationDate: "2026-11-15" }, "2026-11-16")).toBe("terminated");
    expect(contractInForce({ ...base, status: "active", endDate: null }, "2030-01-01")).toBe(true);
    expect(contractInForce({ ...base, status: "superseded" }, "2026-11-10")).toBe(false);
  });
  it("the document fingerprint covers the parties, text, terms and dates, whatever the key order", () => {
    const contract = { id: "contract-1", organizationId: "org-demo", templateVersionId: "ctv-1", engagement: "services" as const, title: "Contrato", bodyText: "Texto", terms: services, partyName: "Ana", partyEmail: null, startDate: "2026-11-01", endDate: null };
    expect(contractCanonical(contract)).toBe(contractCanonical({ ...contract, terms: { term: services.term, compensation: services.compensation, role: services.role, noticeDays: 15, location: "hybrid" } }));
    expect(contractCanonical(contract)).not.toBe(contractCanonical({ ...contract, endDate: "2026-12-31" }));
  });
});

let worker: ChildProcess;
let origin = "";
let logs = "";
const storage = mkdtempSync(join(tmpdir(), "hl-platform-contracts-"));
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
async function signIn(username: string, secret = password) {
  const response = await fetch(`${origin}/api/login`, { method: "POST", headers: { "Content-Type": "application/json", Origin: origin }, body: JSON.stringify({ username, password: secret }) });
  return response.status === 200 ? response.headers.get("set-cookie")!.split(";")[0] : null;
}
async function as(cookie: string | null, path: string, method = "GET", data?: unknown) {
  return fetch(`${origin}/api${path}`, { method, headers: { Cookie: cookie || "", Origin: origin, ...(data !== undefined ? { "Content-Type": "application/json" } : {}) }, ...(data !== undefined ? { body: JSON.stringify(data) } : {}) });
}
const read = async <T = Record<string, unknown>>(response: Response, status = 200) => { const text = await response.text(); expect(response.status, text).toBe(status); return JSON.parse(text) as T; };
const today = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Guatemala", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
const adminSignature = { fullName: "Administración de la Demostración", password };

let admin: string | null, volunteerTemplate: ContractTemplate, servicesTemplate: ContractTemplate, educatorContract: Contract;
type ClassRow = { id: string; courseId: string; status: string };

describe("DEC-046 contracts on the built Worker", () => {
  beforeAll(async () => { admin = await signIn("admin-demo"); expect(admin).toBeTruthy(); });

  it("administration creates templates of any engagement, versions them in rich text and keeps their history", async () => {
    const educator = await signIn("educador-demo");
    expect((await as(educator, "/contract-templates")).status).toBe(403);
    const created = await read<{ template: ContractTemplate }>(await as(admin, "/contract-templates", "POST", {
      template: { name: "Voluntariado docente", engagement: "volunteer", description: "Docencia voluntaria sin remuneración." },
      version: { title: "Acuerdo de voluntariado docente", body: doc("{{persona.nombre}} colabora con {{organizacion.nombre}} como {{contrato.puesto}}.", "La actividad es voluntaria y sin remuneración: {{contrato.remuneracion}}."), defaults: volunteer, editable: ["role", "weeklyHours"] },
    }), 201);
    expect(created.template).toMatchObject({ engagement: "volunteer", current: null, versions: 0, draft: { title: "Acuerdo de voluntariado docente", status: "draft" } });
    expect((await as(admin, "/contract-templates", "POST", { template: { name: "Voluntariado docente", engagement: "volunteer" }, version: { title: "Otro", body: doc("Texto suficientemente largo."), defaults: volunteer, editable: [] } })).status).toBe(409);
    // A volunteer template cannot carry pay.
    expect((await as(admin, "/contract-templates", "POST", { template: { name: "Mal", engagement: "volunteer" }, version: { title: "Mal", body: doc("Texto suficientemente largo."), defaults: services, editable: [] } })).status).toBe(400);
    expect((await as(admin, `/contract-templates/${created.template.id}/publish`, "POST", { effectiveFrom: "2020-01-01" })).status).toBe(400);
    volunteerTemplate = (await read<{ template: ContractTemplate }>(await as(admin, `/contract-templates/${created.template.id}/publish`, "POST", {}))).template;
    expect(volunteerTemplate).toMatchObject({ versions: 1, draft: null, current: { version: 1, effectiveFrom: today, status: "published" } });
    // A new draft does not change the version in force until it is published.
    await read(await as(admin, `/contract-templates/${created.template.id}/draft`, "PUT", { title: "Acuerdo de voluntariado docente", body: doc("{{persona.nombre}} colabora con {{organizacion.nombre}} como {{contrato.puesto}}.", "Segunda versión: actividad voluntaria y sin remuneración."), defaults: volunteer, editable: ["role", "weeklyHours"] }));
    volunteerTemplate = (await read<{ template: ContractTemplate }>(await as(admin, `/contract-templates/${created.template.id}/publish`, "POST", {}))).template;
    const { history } = await read<{ history: { version: number }[] }>(await as(admin, `/contract-templates/${created.template.id}`));
    expect(history.map(item => item.version)).toEqual([2, 1]);
    servicesTemplate = (await read<{ template: ContractTemplate }>(await as(admin, "/contract-templates", "POST", {
      template: { name: "Prestación de servicios de tutoría", engagement: "services" },
      version: { title: "Contrato de prestación de servicios", body: doc("{{persona.nombre}} presta servicios de {{contrato.puesto}} del {{contrato.inicio}} al {{contrato.fin}} por {{contrato.remuneracion}}."), defaults: services, editable: ["role", "compensation", "term"] },
    }), 201)).template;
    servicesTemplate = (await read<{ template: ContractTemplate }>(await as(admin, `/contract-templates/${servicesTemplate.id}/publish`, "POST", {}))).template;
  });

  it("a contract is prepared from the version in force, signed by the organization and then by the person", async () => {
    const educator = await signIn("educador-demo");
    const { members } = await read<{ members: { id: string; username: string }[] }>(await as(admin, "/members"));
    const educatorId = members.find(item => item.username === "educador-demo")!.id;
    // Only editable terms change.
    expect((await as(admin, "/contracts", "POST", { templateId: volunteerTemplate.id, userId: educatorId, startDate: today, terms: { noticeDays: 30 } })).status).toBe(400);
    const draft = (await read<{ contract: Contract }>(await as(admin, "/contracts", "POST", { templateId: volunteerTemplate.id, userId: educatorId, startDate: today, terms: { weeklyHours: 6 } }), 201)).contract;
    expect(draft).toMatchObject({ status: "draft", phase: "draft", templateVersion: 2, terms: { weeklyHours: 6, compensation: { kind: "none" } }, documentSha256: null });
    expect(draft.bodyText).toContain("Educador de la demostración colabora con Colegio Horizonte (demostración) como Educador voluntario.");
    // A draft is not visible to the person; a wrong password does not sign.
    expect((await read<{ contracts: Contract[] }>(await as(educator, "/me/contracts"))).contracts).toEqual([]);
    expect((await as(admin, `/contracts/${draft.id}/send`, "POST", { signature: { ...adminSignature, password: "incorrecta" } })).status).toBe(403);
    const sent = (await read<{ contract: Contract }>(await as(admin, `/contracts/${draft.id}/send`, "POST", { signature: adminSignature }))).contract;
    expect(sent).toMatchObject({ status: "sent", phase: "awaiting-signature", organizationSignature: { name: "Administración de la Demostración" } });
    expect(sent.documentSha256).toMatch(/^[a-f0-9]{64}$/);
    expect((await as(admin, `/contracts/${draft.id}`, "PUT", { startDate: today })).status).toBe(409);
    expect((await as(admin, `/contracts/${draft.id}/sign`, "POST", { signature: adminSignature })).status).toBe(403);
    expect((await as(educator, `/contracts/${draft.id}/sign`, "POST", { signature: { fullName: "Educador Demo", password: "incorrecta" } })).status).toBe(403);
    educatorContract = (await read<{ contract: Contract }>(await as(educator, `/contracts/${draft.id}/sign`, "POST", { signature: { fullName: "Educador de la Demostración", password } }))).contract;
    expect(educatorContract).toMatchObject({ status: "active", phase: "in-force", memberSignature: { name: "Educador de la Demostración" }, documentSha256: sent.documentSha256 });
    expect((await as(educator, `/contracts/${draft.id}/sign`, "POST", { signature: { fullName: "Educador de la Demostración", password } })).status).toBe(409);
    // Another person's contract is not readable.
    expect((await as(await signIn("lucia.herrera"), `/contracts/${draft.id}`)).status).toBe(404);
  });

  it("where a contract is required, teaching waits for one in force; reading does not", async () => {
    const lucia = await signIn("lucia.herrera");
    const { classes } = await read<{ classes: ClassRow[] }>(await as(lucia, "/classes"));
    const planned = classes.filter(item => item.status === "planned");
    expect(planned.length).toBeGreaterThan(1);
    await read(await as(lucia, `/courses/${planned[0].courseId}/sessions/${planned[0].id}/start`, "POST"));
    expect((await as(admin, "/contract-settings", "PUT", { required: "sí" })).status).toBe(400);
    expect(await read(await as(admin, "/contract-settings", "PUT", { required: true }))).toEqual({ required: true });
    const blocked = await as(lucia, `/courses/${planned[1].courseId}/sessions/${planned[1].id}/start`, "POST");
    expect(blocked.status).toBe(403);
    expect(await blocked.json()).toMatchObject({ code: "CONTRACT_REQUIRED", contractId: null });
    expect((await as(lucia, `/courses/${planned[1].courseId}/sessions/${planned[1].id}`)).status).toBe(200);
    const { members } = await read<{ members: { id: string; username: string }[] }>(await as(admin, "/members"));
    const luciaId = members.find(item => item.username === "lucia.herrera")!.id;
    const draft = (await read<{ contract: Contract }>(await as(admin, "/contracts", "POST", { templateId: servicesTemplate.id, userId: luciaId, startDate: today, terms: { role: "Tutora de lectura" } }), 201)).contract;
    expect(draft.endDate).not.toBeNull();
    await read(await as(admin, `/contracts/${draft.id}/send`, "POST", { signature: adminSignature }));
    expect(await (await as(lucia, `/courses/${planned[1].courseId}/sessions/${planned[1].id}/start`, "POST")).json()).toMatchObject({ code: "CONTRACT_REQUIRED", contractId: draft.id });
    await read(await as(lucia, `/contracts/${draft.id}/sign`, "POST", { signature: { fullName: "Lucía Herrera", password } }));
    await read(await as(lucia, `/courses/${planned[1].courseId}/sessions/${planned[1].id}/start`, "POST"));
    // The onboarding's agreement step is the contract, already signed.
    const { onboarding } = await read<{ onboarding: { steps: { key: string; done: boolean }[] } }>(await as(lucia, "/onboarding"));
    expect(onboarding.steps.find(step => step.key === "agreement")).toMatchObject({ done: true });
  });

  it("an invitation comes with its contract: the invitee reads it and signs it to create the account", async () => {
    expect(await read(await as(admin, "/invitations", "POST", { email: "sin.contrato@example.test", displayName: "Sin Contrato", role: "educator" }), 400)).toMatchObject({ code: "CONTRACT_REQUIRED" });
    const invited = await read<{ link: string; invitation: { id: string; contractId: string; contractStatus: string } }>(await as(admin, "/invitations", "POST", {
      email: "paula.contrato@example.test", displayName: "Paula Contreras", role: "educator",
      contract: { templateId: servicesTemplate.id, startDate: today, terms: { compensation: { kind: "per-session", amount: "200", currency: "GTQ" } } }, signature: adminSignature,
    }), 201);
    expect(invited.invitation).toMatchObject({ contractStatus: "sent", contractId: expect.stringMatching(/^contract-/) });
    const token = /\/invitacion\/([a-z]_[a-f0-9]{64})$/.exec(invited.link)![1];
    const preview = await read<{ invitation: { contract: Contract } }>(await fetch(`${origin}/api/invitations/accept/${token}`));
    expect(preview.invitation.contract).toMatchObject({ engagement: "services", partyName: "Paula Contreras", terms: { compensation: { kind: "per-session", amount: "200" } }, organizationSignature: { name: "Administración de la Demostración" } });
    expect(preview.invitation.contract.bodyText).toContain("Paula Contreras presta servicios de Tutor de matemáticas");
    const accept = (data: unknown) => fetch(`${origin}/api/invitations/accept/${token}`, { method: "POST", headers: { "Content-Type": "application/json", Origin: origin }, body: JSON.stringify(data) });
    const account = { username: "paula.contreras", password: "Una frase para firmar 2026" };
    expect(await read(await accept(account), 400)).toMatchObject({ code: "CONTRACT_SIGNATURE_REQUIRED" });
    expect((await accept({ ...account, signature: { fullName: "Paula Contreras", accept: false } })).status).toBe(400);
    const accepted = await accept({ ...account, signature: { fullName: "Paula Contreras", accept: true } });
    expect(accepted.status).toBe(201);
    const paula = accepted.headers.get("set-cookie")!.split(";")[0];
    const { contracts } = await read<{ contracts: Contract[] }>(await as(paula, "/me/contracts"));
    expect(contracts).toHaveLength(1);
    expect(contracts[0]).toMatchObject({ id: invited.invitation.contractId, status: "active", memberSignature: { name: "Paula Contreras" } });
    // Revoking an invitation voids the contract that came with it.
    const other = await read<{ invitation: { id: string; contractId: string } }>(await as(admin, "/invitations", "POST", {
      email: "revocada@example.test", displayName: "Rita Revocada", role: "educator", contract: { templateId: volunteerTemplate.id, startDate: today }, signature: adminSignature,
    }), 201);
    await read(await as(admin, `/invitations/${other.invitation.id}/revoke`, "POST"));
    expect((await read<{ contract: Contract }>(await as(admin, `/contracts/${other.invitation.contractId}`))).contract).toMatchObject({ status: "voided", closeReason: "Invitación revocada" });
  });

  it("an amendment, once signed by both, supersedes the contract; a termination keeps it in force until its date", async () => {
    const educator = await signIn("educador-demo");
    const amendment = (await read<{ contract: Contract }>(await as(admin, `/contracts/${educatorContract.id}/amend`, "POST", { startDate: today, terms: { weeklyHours: 8 } }), 201)).contract;
    expect(amendment).toMatchObject({ status: "draft", supersedesId: educatorContract.id, terms: { weeklyHours: 8 } });
    expect((await as(admin, `/contracts/${educatorContract.id}/amend`, "POST", { startDate: today })).status).toBe(409);
    await read(await as(admin, `/contracts/${amendment.id}/send`, "POST", { signature: adminSignature }));
    await read(await as(educator, `/contracts/${amendment.id}/sign`, "POST", { signature: { fullName: "Educador de la Demostración", password } }));
    expect((await read<{ contract: Contract }>(await as(admin, `/contracts/${educatorContract.id}`))).contract.status).toBe("superseded");
    expect((await as(admin, `/contracts/${amendment.id}/terminate`, "POST", { terminationDate: today })).status).toBe(400);
    const ended = (await read<{ contract: Contract }>(await as(admin, `/contracts/${amendment.id}/terminate`, "POST", { terminationDate: today, reason: "Fin del ciclo de prueba" }))).contract;
    expect(ended).toMatchObject({ status: "terminated", phase: "ending", terminationDate: today });
    expect((await as(admin, `/contracts/${amendment.id}/void`, "POST", { reason: "x" })).status).toBe(409);
    // A declined contract records the reason.
    const { members } = await read<{ members: { id: string; username: string }[] }>(await as(admin, "/members"));
    const sofia = members.find(item => item.username === "sofia.castillo")!.id;
    const offer = (await read<{ contract: Contract }>(await as(admin, "/contracts", "POST", { templateId: volunteerTemplate.id, userId: sofia, startDate: today }), 201)).contract;
    await read(await as(admin, `/contracts/${offer.id}/send`, "POST", { signature: adminSignature }));
    const sofiaSession = await signIn("sofia.castillo");
    expect((await as(sofiaSession, `/contracts/${offer.id}/decline`, "POST", {})).status).toBe(400);
    expect((await read<{ contract: Contract }>(await as(sofiaSession, `/contracts/${offer.id}/decline`, "POST", { reason: "Prefiero un acuerdo por horas." }))).contract).toMatchObject({ status: "declined", closeReason: "Prefiero un acuerdo por horas." });
    const { contracts } = await read<{ contracts: Contract[] }>(await as(admin, "/contracts"));
    expect(contracts.map(item => item.status)).toEqual(expect.arrayContaining(["superseded", "terminated", "active", "declined", "voided"]));
  });

  it("terms and privacy are rich text with an effective date; the volunteer agreement moved to contracts", async () => {
    expect(await read(await as(admin, "/legal/documents/volunteer", "PUT", { title: "Acuerdo", body: "Texto del acuerdo de voluntariado." }), 410)).toMatchObject({ code: "MOVED_TO_CONTRACTS" });
    const body = doc("Primera cláusula de los términos de uso.", "Segunda cláusula con más detalle.");
    await read(await as(admin, "/legal/documents/terms", "PUT", { title: "Términos y condiciones", bodyJson: body }));
    const tomorrow = new Date(Date.parse(`${today}T12:00:00Z`) + 86400000).toISOString().slice(0, 10);
    const { documents } = await read<{ documents: { kind: string; status: string; bodyJson: RichTextDocument; body: string; effectiveAt: string | null }[] }>(await as(admin, "/legal/documents/terms/publish", "POST", { effectiveAt: tomorrow }));
    expect(documents.find(item => item.kind === "terms")).toMatchObject({ status: "published", bodyJson: body, body: "Primera cláusula de los términos de uso.\n\nSegunda cláusula con más detalle.", effectiveAt: tomorrow });
    // Until its effective date, nobody is asked to accept it.
    expect((await read<{ pending: unknown[] }>(await as(await signIn("tomas.aguilar"), "/session"))).pending).toEqual([]);
  });
});
