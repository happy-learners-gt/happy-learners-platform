import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn, type ChildProcess } from "node:child_process";
import { createServer } from "node:net";
import { once } from "node:events";
import { setTimeout as delay } from "node:timers/promises";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { OnboardingFacts } from "../packages/domain/src/index";
import { declareStep, nextStep, onboardingStatus, onboardingStepStates, profileComplete, profileGaps } from "../packages/domain/src/index";
import { acceptPending } from "./accept-pending";

// ST-122 (HL-168): guided onboarding on the first sign-in. Domain rules first, then the built Worker on a fresh local store.
const base: OnboardingFacts = { role: "educator", temporaryPassword: false, legalPending: false, profile: { phone: "+502 5555-0122", contactEmail: null, specialties: ["Ciencias"] }, agreementPublished: false, agreementSigned: false, teaches: false, welcomeAt: "2026-10-15T10:00:00.000Z", agreementSkippedAt: null, tourAt: null };

describe("HL-168 onboarding rules", () => {
  it("CA2 «perfil completo»: a phone or a contact e-mail and, for educators, at least one specialty; the rest is optional", () => {
    expect(profileComplete("educator", { phone: null, contactEmail: "ana@ejemplo.org", specialties: ["Inglés"] })).toBe(true);
    expect(profileComplete("educator", { phone: "+502 5555-0000", contactEmail: null, specialties: [] })).toBe(false);
    expect(profileComplete("educator", { phone: null, contactEmail: null, specialties: ["Inglés"] })).toBe(false);
    expect(profileComplete("admin", { phone: "+502 5555-0000", contactEmail: null, specialties: [] })).toBe(true);
    expect(profileComplete("educator", null)).toBe(false);
    expect(profileGaps("educator", null)).toEqual(["Un teléfono o un correo de contacto", "Al menos una especialidad"]);
    expect(profileGaps("admin", null)).toEqual(["Un teléfono o un correo de contacto"]);
  });
  it("CA1 CA2 the order is password, terms and privacy, welcome, profile, agreement and the introduction to courses and sections", () => {
    expect(nextStep(onboardingStepStates({ ...base, temporaryPassword: true, legalPending: true, welcomeAt: null }))).toBe("password");
    expect(nextStep(onboardingStepStates({ ...base, legalPending: true, welcomeAt: null }))).toBe("legal");
    expect(nextStep(onboardingStepStates({ ...base, welcomeAt: null }))).toBe("welcome");
    expect(nextStep(onboardingStepStates({ ...base, profile: null }))).toBe("profile");
    expect(onboardingStepStates(base).map(step => step.key)).toEqual(["password", "legal", "welcome", "profile", "tour"]);
    expect(nextStep(onboardingStepStates({ ...base, agreementPublished: true }))).toBe("agreement");
    expect(nextStep(onboardingStepStates({ ...base, agreementPublished: true, agreementSkippedAt: "2026-10-15T10:01:00.000Z" }))).toBe("tour");
    expect(nextStep(onboardingStepStates({ ...base, tourAt: "2026-10-15T10:02:00.000Z" }))).toBeNull();
    // Administration has no volunteer agreement step.
    expect(onboardingStepStates({ ...base, role: "admin", agreementPublished: true }).some(step => step.key === "agreement")).toBe(false);
  });
  it("CA2 derived steps cannot be declared; the agreement is skippable only while the person teaches no section; each step waits for the previous ones", () => {
    const steps = onboardingStepStates({ ...base, agreementPublished: true });
    for (const step of ["password", "legal", "profile"]) expect(declareStep(step, steps)).toBe("derived");
    expect(declareStep("anything", steps)).toBe("unknown");
    expect(declareStep("agreement", steps)).toBeNull();
    expect(declareStep("tour", steps)).toBe("order");
    expect(declareStep("agreement", onboardingStepStates({ ...base, agreementPublished: true, teaches: true }))).toBe("required");
    // A skipped agreement does not count once the person teaches: it must be signed.
    expect(nextStep(onboardingStepStates({ ...base, agreementPublished: true, teaches: true, agreementSkippedAt: "2026-10-15T10:01:00.000Z" }))).toBe("agreement");
    expect(declareStep("welcome", onboardingStepStates({ ...base, legalPending: true, welcomeAt: null }))).toBe("order");
  });
  it("CA3 administration reads pending, in progress or complete; accounts without a record predate onboarding", () => {
    expect(onboardingStatus(null)).toBe("complete");
    expect(onboardingStatus({ completedAt: null, welcomeAt: null })).toBe("pending");
    expect(onboardingStatus({ completedAt: null, welcomeAt: "2026-10-15T10:00:00.000Z" })).toBe("in_progress");
    expect(onboardingStatus({ completedAt: "2026-10-15T11:00:00.000Z", welcomeAt: null })).toBe("complete");
  });
});

let worker: ChildProcess;
let origin = "";
let logs = "";
const storage = mkdtempSync(join(tmpdir(), "hl-platform-onboarding-"));
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

async function signIn(username: string, password = "Aprender-2026!") {
  const response = await fetch(`${origin}/api/login`, { method: "POST", headers: { "Content-Type": "application/json", Origin: origin }, body: JSON.stringify({ username, password }) });
  return response.status === 200 ? response.headers.get("set-cookie")!.split(";")[0] : null;
}
async function as(cookie: string | null, path: string, method = "GET", data?: unknown) {
  return fetch(`${origin}/api${path}`, { method, headers: { Cookie: cookie || "", Origin: origin, ...(data ? { "Content-Type": "application/json" } : {}) }, ...(data ? { body: JSON.stringify(data) } : {}) });
}
const summaries = (body: { events: { summary: string }[] }) => body.events.map(event => event.summary);
type State = { status: string; next: string | null; steps: { key: string; done: boolean; optional: boolean }[]; profileGaps: string[]; agreement: { id: string } | null; courses: unknown[]; sections: unknown[] };
const state = async (cookie: string | null) => (await (await as(cookie, "/onboarding")).json()).onboarding as State;
type Person = { userId: string; username: string; status: string; missing: string[]; completedAt: string | null; startedAt: string | null };
const people = async (cookie: string | null) => (await (await as(cookie, "/onboarding/people")).json()).people as Person[];
async function newAccount(admin: string | null, username: string, role = "educator") {
  const created = await as(admin, "/members", "POST", { displayName: `Persona ${username}`, username, role });
  expect(created.status).toBe(201);
  const { member, temporaryPassword } = await created.json() as { member: { id: string }; temporaryPassword: string };
  const first = await signIn(username, temporaryPassword);
  expect((await as(first, "/account/password", "POST", { currentPassword: temporaryPassword, newPassword: "Una frase para empezar 2026" })).status).toBe(200);
  await acceptPending(origin, first, `Persona ${username}`, "Una frase para empezar 2026");
  return { id: member.id, cookie: first };
}
const profile = (displayName: string, extra: Record<string, unknown>) => ({ displayName, phone: "", contactEmail: "", education: "", specialties: [], availability: [], ...extra });

describe("HL-168 ST-122 guided onboarding on the built Worker", () => {
  it("CA1 el primer ingreso de una cuenta nueva pide aceptar los términos y la privacidad vigentes antes de la incorporación", async () => {
    // Fictional external organization: publishing here gates no other suite.
    const admin = await signIn("admin-externo");
    expect((await as(admin, "/legal/documents/terms", "PUT", { title: "Términos ficticios", body: "Texto ficticio de los términos de prueba." })).status).toBe(200);
    expect((await as(admin, "/legal/documents/terms/publish", "POST")).status).toBe(200);
    expect((await as(admin, "/legal/documents/privacy", "PUT", { title: "Privacidad ficticia", body: "Texto ficticio de la política de prueba.", consent: "Doy mi consentimiento informado de prueba." })).status).toBe(200);
    expect((await as(admin, "/legal/documents/privacy/publish", "POST")).status).toBe(200);
    const mine = (await (await as(admin, "/session")).json()).pending as { id: string }[];
    expect((await as(admin, "/legal/accept", "POST", { documentIds: mine.map(item => item.id), signature: { fullName: "Administración Externa", password: "Aprender-2026!" } })).status).toBe(200);

    const created = await as(admin, "/members", "POST", { displayName: "Nora Nueva", username: "nora.nueva", role: "educator" });
    expect(created.status).toBe(201);
    const { temporaryPassword } = await created.json() as { temporaryPassword: string };
    const nora = await signIn("nora.nueva", temporaryPassword);
    // First the own password: onboarding is closed like everything else.
    expect((await as(nora, "/onboarding")).status).toBe(403);
    expect((await as(nora, "/account/password", "POST", { currentPassword: temporaryPassword, newPassword: "Una frase para empezar 2026" })).status).toBe(200);
    // Then the terms and the privacy policy in force; the welcome waits for them.
    const session = await (await as(nora, "/session")).json();
    expect(session.onboarding).toBe(true);
    expect(session.pending.map((item: { kind: string }) => item.kind).sort()).toEqual(["privacy", "terms"]);
    const blocked = await as(nora, "/onboarding");
    expect(blocked.status).toBe(403);
    expect((await blocked.json()).pending).toHaveLength(2);
    expect((await as(nora, "/onboarding/steps/welcome", "POST")).status).toBe(403);
    expect((await as(nora, "/legal/accept", "POST", { documentIds: session.pending.map((item: { id: string }) => item.id), signature: { fullName: "Nora Nueva", password: "Una frase para empezar 2026" } })).status).toBe(200);
    const after = await state(nora);
    expect(after.status).toBe("pending");
    expect(after.next).toBe("welcome");
    expect(after.steps.filter(step => step.done).map(step => step.key)).toEqual(["password", "legal"]);
  });

  it("CA2 la persona completa su perfil y recorre la introducción a sus cursos y secciones; los pasos derivados no se pueden declarar", async () => {
    const admin = await signIn("admin-demo");
    const { cookie } = await newAccount(admin, "olga.onboarding");
    let current = await state(cookie);
    expect(current.next).toBe("welcome");
    // Derived steps cannot be faked, and the introduction waits for the rest.
    for (const step of ["password", "legal", "profile"]) {
      const refused = await as(cookie, `/onboarding/steps/${step}`, "POST");
      expect(refused.status).toBe(409);
      expect((await refused.json()).code).toBe("ONBOARDING_DERIVED");
    }
    expect((await as(cookie, "/onboarding/steps/whatever", "POST")).status).toBe(404);
    expect((await as(cookie, "/onboarding/steps/tour", "POST")).status).toBe(409);
    // Without a published volunteer agreement that step does not apply to her.
    expect([200, 404, 409]).toContain((await as(cookie, "/onboarding/steps/agreement", "POST")).status);
    expect((await as(cookie, "/onboarding/steps/welcome", "GET")).status).toBe(405);
    expect([200, 409]).toContain((await as(cookie, "/onboarding/steps/welcome", "POST")).status);
    current = await state(cookie);
    expect(current.status).toBe("in_progress");
    expect(current.next).toBe("profile");
    // A profile without a specialty is not complete; the gaps say what is missing.
    expect((await as(cookie, "/profile", "PUT", profile("Olga Onboarding", { phone: "+502 5555-0122" }))).status).toBe(200);
    current = await state(cookie);
    expect(current.next).toBe("profile");
    expect(current.profileGaps).toEqual(["Al menos una especialidad"]);
    expect((await as(cookie, "/onboarding/steps/tour", "POST")).status).toBe(409);
    expect((await as(cookie, "/profile", "PUT", profile("Olga Onboarding", { contactEmail: "olga@ejemplo.org", specialties: ["Ciencias"] }))).status).toBe(200);
    current = await state(cookie);
    expect(current.profileGaps).toEqual([]);
    if (current.next === "agreement") expect((await as(cookie, "/onboarding/steps/agreement", "POST")).status).toBe(200);
    expect((await state(cookie)).next).toBe("tour");
    expect(Array.isArray(current.courses) && Array.isArray(current.sections)).toBe(true);
    const done = await as(cookie, "/onboarding/steps/tour", "POST");
    expect(done.status).toBe(200);
    expect((await done.json()).onboarding).toMatchObject({ status: "complete", next: null });
    expect((await (await as(cookie, "/session")).json()).onboarding).toBeUndefined();
    expect((await as(cookie, "/onboarding/steps/tour", "POST")).status).toBe(409);
    expect(summaries(await (await as(admin, "/activity?limit=50")).json())).toContain("Completó su incorporación");
    // Emptying the profile later does not reopen a completed onboarding.
    expect((await as(cookie, "/profile", "PUT", profile("Olga Onboarding", {}))).status).toBe(200);
    expect((await state(cookie)).status).toBe("complete");
  });

  it("CA2 una cuenta que llega por invitación también empieza la incorporación, y el acuerdo de voluntariado publicado se puede dejar para después si no imparte secciones", async () => {
    const admin = await signIn("admin-demo");
    expect((await as(admin, "/contract-settings", "PUT", { required: false })).status).toBe(200);
    const invited = await (await as(admin, "/invitations", "POST", { email: "ines.invitada@example.test", displayName: "Inés Invitada", role: "educator" })).json();
    const token = /\/invitacion\/([a-z]_[a-f0-9]{64})$/.exec(invited.link)![1];
    const accepted = await fetch(`${origin}/api/invitations/accept/${token}`, { method: "POST", headers: { "Content-Type": "application/json", Origin: origin }, body: JSON.stringify({ username: "ines.invitada", password: "Una frase para empezar 2026" }) });
    expect(accepted.status).toBe(201);
    const ines = accepted.headers.get("set-cookie")!.split(";")[0];
    await acceptPending(origin, ines, "Inés Invitada", "Una frase para empezar 2026");
    expect((await (await as(ines, "/session")).json()).onboarding).toBe(true);
    // DEC-046: the agreement is a volunteer contract template that the organization requires.
    const version = { title: "Acuerdo ficticio", body: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "Texto ficticio del acuerdo de voluntariado de prueba." }] }] }, defaults: { role: "Educador voluntario", compensation: { kind: "none" }, term: { kind: "indefinite" } }, editable: [] };
    const created = await (await as(admin, "/contract-templates", "POST", { template: { name: "Acuerdo ficticio", engagement: "volunteer" }, version })).json();
    expect((await as(admin, `/contract-templates/${created.template.id}/publish`, "POST", {})).status).toBe(200);
    expect((await as(admin, "/contract-settings", "PUT", { required: true })).status).toBe(200);
    expect((await as(ines, "/onboarding/steps/welcome", "POST")).status).toBe(200);
    expect((await as(ines, "/profile", "PUT", profile("Inés Invitada", { phone: "+502 5555-0123", specialties: ["Inglés"] }))).status).toBe(200);
    const current = await state(ines);
    expect(current.next).toBe("agreement");
    expect(current.agreement).toBeNull();
    expect(current.steps.find(step => step.key === "agreement")).toMatchObject({ optional: true, done: false });
    expect((await as(ines, "/onboarding/steps/agreement", "POST")).status).toBe(200);
    expect((await state(ines)).next).toBe("tour");
    expect((await as(ines, "/onboarding/steps/tour", "POST")).status).toBe(200);
  });

  it("CA3 administración ve el estado de incorporación de cada persona", async () => {
    const admin = await signIn("admin-demo");
    const pending = await newAccount(admin, "pablo.pendiente");
    const list = await people(admin);
    expect(list.find(person => person.username === "pablo.pendiente")).toMatchObject({ status: "pending", missing: ["welcome", "profile", "agreement", "tour"], completedAt: null });
    expect((await as(pending.cookie, "/onboarding/steps/welcome", "POST")).status).toBe(200);
    expect((await people(admin)).find(person => person.username === "pablo.pendiente")).toMatchObject({ status: "in_progress", missing: ["profile", "agreement", "tour"] });
    const olga = (await people(admin)).find(person => person.username === "olga.onboarding")!;
    expect(olga.status).toBe("complete");
    expect(olga.completedAt).toBeTruthy();
    expect(olga.missing).toEqual([]);
    // Only administration reads it.
    expect((await as(pending.cookie, "/onboarding/people")).status).toBe(403);
    // The backup carries the onboarding state.
    const backup = await (await as(admin, "/organization/backup")).json();
    expect(backup.tables.onboarding.columns).toEqual(["user_id", "organization_id", "started_at", "welcome_at", "agreement_skipped_at", "tour_at", "completed_at"]);
    expect(backup.tables.onboarding.rows.length).toBeGreaterThan(3);
  });

  it("CA1 las cuentas anteriores a esta versión no entran en la incorporación", async () => {
    for (const username of ["admin-demo", "educador-demo", "lucia.herrera"]) {
      const cookie = await signIn(username);
      expect((await (await as(cookie, "/session")).json()).onboarding, username).toBeUndefined();
      expect(await state(cookie), username).toMatchObject({ status: "complete", next: null });
      expect((await as(cookie, "/onboarding/steps/welcome", "POST")).status, username).toBe(409);
    }
    const seeded = (await people(await signIn("admin-demo"))).filter(person => ["admin-demo", "educador-demo", "lucia.herrera"].includes(person.username));
    expect(seeded).toHaveLength(3);
    expect(seeded.every(person => person.status === "complete" && person.missing.length === 0)).toBe(true);
  });
});
