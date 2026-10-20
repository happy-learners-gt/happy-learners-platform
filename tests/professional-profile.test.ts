import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn, type ChildProcess } from "node:child_process";
import { createServer } from "node:net";
import { once } from "node:events";
import { setTimeout as delay } from "node:timers/promises";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { MyProfessionalProfile, ProfessionalProfile, PublicProfile } from "../packages/contracts/src/index";
import {
  audienceView, countryCodes, credentialInput, credentialStatus, credentialTransition, defaultVisibility, emptyProfessionalProfile, languageTag, professionalProfileInput,
  profileChanges, profileCompleteness, profileLinkInput, profileTransition, submissionGaps, validOrcid, videoUrlInput, visibilityInput,
} from "../packages/domain/src/index";
import { acceptPending } from "./accept-pending";

// ST-154 to ST-157 (HL-15, DEC-045): the professional profile, its credentials, its publication and who sees it.
const complete: ProfessionalProfile = {
  ...emptyProfessionalProfile(), preferredName: "Carlos", pronouns: "él", headline: "Docente de matemática para primaria", country: "GT", city: "Quetzaltenango", timezone: "America/Guatemala",
  bio: "Enseño matemática con material concreto y juegos desde hace doce años en escuelas públicas.", approach: "Aprendizaje basado en problemas.", videoUrl: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
  languages: [{ code: "es", proficiency: "native", teaches: true }, { code: "quc", proficiency: "B1", teaches: false }],
  areas: [{ label: "Matemática", field: "05" }, { label: "Robótica educativa", field: null }], levels: ["1", "2"], modalities: ["in_person", "hybrid"], formats: ["group"], audiences: ["children"], experienceYears: 12,
  experience: [{ role: "Maestro de grado", institution: "Escuela Oficial Rural Mixta", country: "GT", from: "2014-01", to: null, description: "Tercero y cuarto grado." }],
  education: [{ degree: "Profesorado en Enseñanza Media en Matemática", institution: "Universidad de San Carlos", country: "GT", year: 2013, field: "Matemática" }],
  links: [{ kind: "orcid", url: "https://orcid.org/0000-0002-1825-0097" }],
};

describe("HL-15 ST-154 ST-155 ST-156 ST-157 professional profile rules", () => {
  it("ST-154 CA1 el perfil usa estándares internacionales: BCP 47, ISO 3166-1, IANA, CINE 2011 y CINE-F 2013", () => {
    const result = professionalProfileInput({ ...complete, headline: "  Docente   de matemática para primaria ", languages: [{ code: "ES", proficiency: "native", teaches: true }, { code: "pt_br", proficiency: "B2" }], levels: ["2", "1"], areas: ["Matemática"] }, new Date("2026-10-16T00:00:00Z"));
    expect("value" in result && result.value).toMatchObject({ headline: "Docente de matemática para primaria", languages: [{ code: "es", proficiency: "native", teaches: true }, { code: "pt-BR", proficiency: "B2", teaches: false }], levels: ["1", "2"], areas: [{ label: "Matemática", field: null }] });
    expect(languageTag("zh-hant-tw")).toBe("zh-Hant-TW");
    expect(languageTag("es-419")).toBe("es-419");
    expect(languageTag("español")).toBeNull();
    expect(countryCodes).toHaveLength(249);
    const wrong = professionalProfileInput({ ...complete, country: "XX", timezone: "Guatemala", levels: ["13"], languages: [{ code: "es", proficiency: "C3" }], areas: [{ label: "Arte", field: "99" }, { label: "arte" }], videoUrl: "https://example.org/v.mp4",
      experience: [{ role: "Maestro", institution: "Escuela", from: "2030-01" }], links: [{ kind: "linkedin", url: "https://example.org/yo" }, { kind: "orcid", url: "0000-0002-1825-0098" }, { kind: "website", url: "http://inseguro.org" }] });
    expect("errors" in wrong && Object.keys(wrong.errors).sort()).toEqual(["areas.0.field", "country", "experience.0.from", "languages.0.proficiency", "levels", "links.0.url", "links.1.url", "links.2.url", "timezone", "videoUrl"]);
    expect("errors" in professionalProfileInput({ ...complete, bio: "x".repeat(2001), headline: "<b>Hola</b>" })).toBe(true);
  });
  it("ST-154 CA1 video de YouTube o Vimeo, enlaces https validados por tipo e iD de ORCID con dígito verificador", () => {
    expect(videoUrlInput("https://youtu.be/dQw4w9WgXcQ")).toBe("https://www.youtube.com/watch?v=dQw4w9WgXcQ");
    expect(videoUrlInput("https://www.youtube.com/shorts/dQw4w9WgXcQ")).toBe("https://www.youtube.com/watch?v=dQw4w9WgXcQ");
    expect(videoUrlInput("https://player.vimeo.com/video/76979871")).toBe("https://vimeo.com/76979871");
    for (const url of ["http://youtu.be/dQw4w9WgXcQ", "https://youtube.com/watch?v=corto", "https://vimeo.com/canal", "https://usuario:clave@youtu.be/dQw4w9WgXcQ"]) expect(videoUrlInput(url), url).toBeUndefined();
    expect(videoUrlInput("")).toBeNull();
    expect(validOrcid("0000-0002-1825-0097")).toBe(true);
    expect(validOrcid("0000-0002-1825-0098")).toBe(false);
    expect(profileLinkInput({ kind: "orcid", url: "0000-0002-1825-0097" })).toEqual({ kind: "orcid", url: "https://orcid.org/0000-0002-1825-0097" });
    expect(profileLinkInput({ kind: "linkedin", url: "https://gt.LinkedIn.com/in/carlos" })).toEqual({ kind: "linkedin", url: "https://gt.linkedin.com/in/carlos" });
    expect(profileLinkInput({ kind: "website", url: "https://escuela.edu.gt" })).toEqual({ kind: "website", url: "https://escuela.edu.gt/" });
  });
  it("ST-154 CA2 la completitud lista los pasos que faltan y enviar exige titular, biografía, idioma, área y nivel", () => {
    const empty = profileCompleteness(emptyProfessionalProfile(), { photo: false, credentials: 0 });
    expect(empty.percent).toBe(0);
    expect(empty.steps.filter(step => !step.done).map(step => step.key)).toEqual(["photo", "headline", "location", "bio", "approach", "languages", "areas", "levels", "modalities", "experience", "education", "credentials"]);
    expect(profileCompleteness(complete, { photo: true, credentials: 1 }).percent).toBe(100);
    expect(profileCompleteness(complete, { photo: false, credentials: 0 }).percent).toBe(83);
    expect(submissionGaps(emptyProfessionalProfile())).toEqual(["un titular", "una biografía", "al menos un idioma", "al menos un área de enseñanza", "al menos un nivel educativo"]);
    expect(submissionGaps(complete)).toEqual([]);
  });
  it("ST-156 CA1 CA2 el flujo de publicación: revisión, cambios solicitados, publicación efectiva y ocultamiento", () => {
    const review = { actor: "self" as const, reviewRequired: true };
    expect(profileTransition({ status: "draft", hiddenBy: null, openReview: false }, "submit", review)).toEqual({ status: "in_review", hiddenBy: null, publishes: false });
    expect(profileTransition({ status: "draft", hiddenBy: null, openReview: false }, "submit", { actor: "self", reviewRequired: false })).toEqual({ status: "published", hiddenBy: null, publishes: true });
    // Editing a published profile sends a revision: the published version stays until approval.
    expect(profileTransition({ status: "published", hiddenBy: null, openReview: false }, "submit", review)).toEqual({ status: "published", hiddenBy: null, publishes: false });
    expect(profileTransition({ status: "in_review", hiddenBy: null, openReview: true }, "request_changes", { actor: "admin", reviewRequired: true })).toMatchObject({ status: "changes_requested" });
    expect(profileTransition({ status: "changes_requested", hiddenBy: null, openReview: false }, "submit", review)).toMatchObject({ status: "in_review" });
    expect(profileTransition({ status: "in_review", hiddenBy: null, openReview: true }, "approve", { actor: "admin", reviewRequired: true })).toEqual({ status: "published", hiddenBy: null, publishes: true });
    expect(profileTransition({ status: "in_review", hiddenBy: null, openReview: true }, "approve", review)).toHaveProperty("error");
    expect(profileTransition({ status: "draft", hiddenBy: null, openReview: false }, "hide", review)).toHaveProperty("error");
    expect(profileTransition({ status: "published", hiddenBy: null, openReview: false }, "hide", { actor: "admin", reviewRequired: true })).toEqual({ status: "hidden", hiddenBy: "admin", publishes: false });
    expect(profileTransition({ status: "hidden", hiddenBy: "admin", openReview: false }, "show", review)).toHaveProperty("error");
    expect(profileTransition({ status: "hidden", hiddenBy: "self", openReview: false }, "show", review)).toEqual({ status: "published", hiddenBy: null, publishes: false });
    expect(profileTransition({ status: "published", hiddenBy: null, openReview: false }, "leave", { actor: "system", reviewRequired: true })).toEqual({ status: "hidden", hiddenBy: "system", publishes: false });
    expect(profileTransition({ status: "in_review", hiddenBy: null, openReview: true }, "leave", { actor: "system", reviewRequired: true })).toMatchObject({ status: "draft" });
    expect(profileChanges(complete, { ...complete, bio: "Otra biografía", levels: ["3"] })).toEqual(["Sobre mí", "Enseñanza"]);
    expect(profileChanges(null, complete)).toEqual(["Identidad", "Sobre mí", "Idiomas", "Enseñanza", "Trayectoria", "Enlaces profesionales"]);
  });
  it("ST-155 CA1 CA2 una credencial se valida, se verifica o rechaza y vence por fecha al leerla", () => {
    const value = credentialInput({ type: "teaching_license", name: " Colegiado activo ", issuer: "Colegio de Profesionales", country: "gt", issuedOn: "2020-02-01", expiresOn: "2026-10-15", verificationUrl: "https://colegio.org.gt/verificar/123" }, "2026-10-16");
    expect("value" in value && value.value).toMatchObject({ name: "Colegiado activo", country: "GT", documentId: null, credentialCode: null });
    const wrong = credentialInput({ type: "passport", name: "", issuer: "X", issuedOn: "2026-10-17", expiresOn: "2020-01-01", verificationUrl: "ftp://x" }, "2026-10-16");
    expect("errors" in wrong && Object.keys(wrong.errors).sort()).toEqual(["expiresOn", "issuedOn", "issuer", "name", "type", "verificationUrl"]);
    expect(credentialStatus("verified", "2026-10-15", "2026-10-16")).toBe("expired");
    expect(credentialStatus("verified", "2026-10-16", "2026-10-16")).toBe("verified");
    expect(credentialStatus("submitted", "2020-01-01", "2026-10-16")).toBe("submitted");
    expect(credentialTransition("draft", "submit", "self")).toBe("submitted");
    expect(credentialTransition("submitted", "verify", "self")).toHaveProperty("error");
    expect(credentialTransition("submitted", "reject", "admin")).toBe("rejected");
    expect(credentialTransition("verified", "edit", "self")).toBe("draft");
    expect(credentialTransition("rejected", "submit", "self")).toHaveProperty("error");
    expect(credentialTransition("withdrawn", "edit", "self")).toHaveProperty("error");
  });
  it("ST-157 CA1 cada audiencia recibe solo las secciones que la persona le muestra; el contacto nunca llega a estudiantes", () => {
    const visibility = { ...defaultVisibility, about: "organization" as const, links: "private" as const };
    const learners = audienceView(complete, visibility, "learners"), team = audienceView(complete, visibility, "organization");
    expect(learners.sections).toEqual(["identity", "languages", "teaching", "credentials"]);
    expect(learners.content).toMatchObject({ headline: complete.headline, bio: "", approach: "", videoUrl: null, experience: [], links: [], languages: complete.languages });
    expect(team.sections).toEqual(["identity", "about", "languages", "teaching", "career", "credentials", "availability"]);
    expect(team.content.links).toEqual([]);
    expect(visibilityInput({ contact: "learners" })).toBeNull();
    expect(visibilityInput({ availability: "learners" })).toBeNull();
    expect(visibilityInput({ identity: "private" })).toBeNull();
    expect(visibilityInput({ contact: "organization" })).toMatchObject({ contact: "organization", identity: "learners" });
  });
});

let worker: ChildProcess;
let origin = "";
let logs = "";
const storage = mkdtempSync(join(tmpdir(), "hl-platform-professional-"));
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

const cookies = new Map<string, string>();
async function signIn(username: string) {
  if (cookies.has(username)) return cookies.get(username)!;
  const response = await fetch(`${origin}/api/login`, { method: "POST", headers: { "Content-Type": "application/json", Origin: origin }, body: JSON.stringify({ username, password: "Aprender-2026!" }) });
  expect(response.status, username).toBe(200);
  cookies.set(username, response.headers.get("set-cookie")!.split(";")[0]);
  return cookies.get(username)!;
}
async function as(cookie: string | null, path: string, method = "GET", data?: unknown) {
  return fetch(`${origin}/api${path}`, { method, headers: { Cookie: cookie || "", Origin: origin, ...(data ? { "Content-Type": "application/json" } : {}) }, ...(data ? { body: JSON.stringify(data) } : {}) });
}
const json = async <T,>(response: Response) => await response.json() as T;
const mine = async (cookie: string) => (await json<{ profile: MyProfessionalProfile }>(await as(cookie, "/me/profile"))).profile;
const summaries = async (cookie: string, query = "") => (await json<{ events: { summary: string; action: string; targetType: string }[] }>(await as(cookie, `/activity?limit=100${query}`))).events;
const idOf = async (admin: string, username: string) => (await json<{ members: { id: string; username: string }[] }>(await as(admin, "/members"))).members.find(row => row.username === username)!.id;
const pdf = (text: string) => new TextEncoder().encode(`%PDF-1.4\n% ${text}\n%%EOF\n`);
async function studentSpace(code: string) {
  const login = await fetch(`${origin}/api/student/login`, { method: "POST", headers: { Origin: origin, "Content-Type": "application/json" }, body: JSON.stringify({ code }) });
  expect(login.status).toBe(200);
  const cookie = /hl_group=[^;]+/.exec(login.headers.get("set-cookie") || "")![0];
  const response = await fetch(`${origin}/api/student/space`, { headers: { Cookie: cookie } });
  return { cookie, text: await response.text() };
}

describe("HL-15 ST-154 ST-156 professional profile and its publication on the built Worker", () => {
  let carlosId = "";
  it("ST-154 CA1 la persona edita su perfil por secciones; los errores llegan por campo y cada cambio queda en la actividad sin sus valores", async () => {
    const carlos = await signIn("carlos.mejia"), admin = await signIn("admin-demo");
    carlosId = await idOf(admin, "carlos.mejia");
    expect((await as(null, "/me/profile")).status).toBe(401);
    const start = await mine(carlos);
    expect(start.reviewRequired).toBe(true);
    const refused = await as(carlos, "/me/profile", "PUT", { draft: { ...complete, country: "Guatemala", languages: [{ code: "es", proficiency: "experto" }] }, draftVersion: start.draftVersion });
    expect(refused.status).toBe(400);
    expect(Object.keys((await json<{ errors: Record<string, string> }>(refused)).errors).sort()).toEqual(["country", "languages.0.proficiency"]);
    expect((await as(carlos, "/me/profile", "PUT", { visibility: { contact: "learners" } })).status).toBe(400);
    const saved = await as(carlos, "/me/profile", "PUT", { draft: complete, visibility: { ...defaultVisibility, links: "private" }, contact: { phone: "+502 5555-0154", contactEmail: "carlos@ejemplo.org" }, draftVersion: start.draftVersion });
    expect(saved.status, await saved.clone().text()).toBe(200);
    const body = await json<{ profile: MyProfessionalProfile; changed: string[] }>(saved);
    expect(body.changed.length).toBeGreaterThan(0);
    expect(body.profile).toMatchObject({ draftVersion: start.draftVersion + 1, missing: [], draft: { headline: complete.headline, areas: complete.areas } });
    // A stale window does not overwrite newer changes.
    expect((await as(carlos, "/me/profile", "PUT", { draft: { ...complete, headline: "Otro titular" }, draftVersion: 0 })).status).toBe(409);
    // ST-149 keeps working: its specialties are the labels of the areas, both ways.
    const legacy = (await json<{ profile: { specialties: string[] } }>(await as(carlos, "/profile"))).profile;
    expect(legacy.specialties).toEqual(["Matemática", "Robótica educativa"]);
    expect((await as(carlos, "/profile", "PUT", { displayName: "Carlos Mejía", phone: "+502 5555-0154", contactEmail: "carlos@ejemplo.org", specialties: ["Matemática", "Geometría"] })).status).toBe(200);
    expect((await mine(carlos)).draft.areas).toEqual([{ label: "Matemática", field: "05" }, { label: "Geometría", field: null }]);
    const events = await summaries(admin, `&actor=${carlosId}`);
    expect(events.map(item => item.summary)).toContain("Actualizó su perfil profesional: Identidad, Sobre mí, Idiomas, Enseñanza, Trayectoria, Enlaces profesionales, Visibilidad, Teléfono, Correo de contacto");
    expect(JSON.stringify(events)).not.toContain("5555-0154");
    expect(JSON.stringify(events)).not.toContain("Quetzaltenango");
  });

  it("ST-156 CA1 enviar, pedir cambios, reenviar y aprobar; nadie decide sobre su propio perfil", async () => {
    const carlos = await signIn("carlos.mejia"), admin = await signIn("admin-demo"), lucia = await signIn("lucia.herrera");
    const created = await json<{ member: { id: string }; temporaryPassword: string }>(await as(admin, "/members", "POST", { displayName: "Diego Vacío", username: "diego.vacio", role: "educator" }));
    const first = await fetch(`${origin}/api/login`, { method: "POST", headers: { Origin: origin, "Content-Type": "application/json" }, body: JSON.stringify({ username: "diego.vacio", password: created.temporaryPassword }) });
    const empty = first.headers.get("set-cookie")!.split(";")[0];
    expect((await as(empty, "/account/password", "POST", { currentPassword: created.temporaryPassword, newPassword: "Una frase para el perfil 2026" })).status).toBe(200);
    await acceptPending(origin, empty, "Diego Vacío", "Una frase para el perfil 2026");
    const gaps = await as(empty, "/me/profile/submit", "POST");
    expect(gaps.status).toBe(400);
    expect((await json<{ missing: string[] }>(gaps)).missing).toEqual(["un titular", "una biografía", "al menos un idioma", "al menos un área de enseñanza", "al menos un nivel educativo"]);
    expect((await as(carlos, "/me/profile", "PUT", { draft: complete })).status).toBe(200);
    const current = await mine(carlos);
    const sent = current.status === "in_review" ? { status: 200 } : await as(carlos, "/me/profile/submit", "POST");
    expect(sent.status).toBe(200);
    expect((await mine(carlos))).toMatchObject({ status: "in_review", submission: { status: "in_review" } });
    expect([200, 409]).toContain((await as(carlos, "/me/profile/submit", "POST")).status);
    // Not published yet: the team does not see it.
    expect((await as(lucia, `/profiles/${carlosId}`)).status).toBe(404);
    expect((await json<{ entries: { userId: string }[] }>(await as(lucia, "/profiles"))).entries.find(item => item.userId === carlosId)).toBeUndefined();
    // Educators do not review; the queue is administration's.
    expect((await as(lucia, "/profile-reviews")).status).toBe(403);
    expect((await as(lucia, `/members/${carlosId}/profile/approve`, "POST")).status).toBe(403);
    const queue = await json<{ profiles: { userId: string; firstPublication: boolean; changes: string[]; missing: string[] }[] }>(await as(admin, "/profile-reviews"));
    expect(queue.profiles.some(item => item.userId === carlosId)).toBe(true);
    expect((await as(admin, `/members/${carlosId}/profile/request-changes`, "POST", { note: "no" })).status).toBe(400);
    expect((await as(admin, `/members/${carlosId}/profile/request-changes`, "POST", { note: "Agrega tu enfoque para estudiantes adultos." })).status).toBe(200);
    expect(await mine(carlos)).toMatchObject({ status: "changes_requested", submission: { status: "returned", note: "Agrega tu enfoque para estudiantes adultos.", decidedBy: "Administración de la demostración" } });
    expect((await as(admin, `/members/${carlosId}/profile/approve`, "POST")).status).toBe(409);
    expect((await as(carlos, "/me/profile", "PUT", { draft: { ...complete, audiences: ["children", "adults"] } })).status).toBe(200);
    expect((await as(carlos, "/me/profile/submit", "POST")).status).toBe(200);
    expect((await mine(carlos)).submission).toMatchObject({ status: "in_review" });
    const approved = await as(admin, `/members/${carlosId}/profile/approve`, "POST");
    expect(approved.status, await approved.clone().text()).toBe(200);
    expect(await mine(carlos)).toMatchObject({ status: "published", submission: null });
    // An administrator's own profile is reviewed by someone else.
    const adminId = await idOf(admin, "admin-demo");
    expect((await as(admin, `/members/${adminId}/profile/approve`, "POST")).status).toBe(403);
    const activity = (await summaries(admin, `&limit=100`)).filter(item => item.targetType === "profile").map(item => `${item.action}: ${item.summary}`);
    expect(activity.some(item => item.startsWith("submitted:"))).toBe(true);
    expect(activity.some(item => item.startsWith("returned:"))).toBe(true);
    expect(activity.some(item => item.startsWith("approved:"))).toBe(true);
  });

  it("ST-156 CA2 editar un perfil publicado no cambia la versión visible hasta aprobar la nueva; queda el historial", async () => {
    const carlos = await signIn("carlos.mejia"), admin = await signIn("marta.ruiz"), diego = await signIn("diego.ramirez");
    const before = (await json<{ profile: PublicProfile }>(await as(diego, `/profiles/${carlosId}`))).profile;
    expect(before).toMatchObject({ audience: "organization", content: { headline: complete.headline } });
    // Contact data stays private by default; links are private by choice.
    expect(before.contact).toBeUndefined();
    expect(before.content.links).toEqual([]);
    expect(before.availability).toEqual([]);
    expect((await as(carlos, "/me/profile", "PUT", { draft: { ...complete, audiences: ["children", "adults"], headline: "Matemática y robótica para primaria" } })).status).toBe(200);
    expect(await mine(carlos)).toMatchObject({ status: "published", hasChanges: true });
    expect((await json<{ profile: PublicProfile }>(await as(diego, `/profiles/${carlosId}`))).profile.content.headline).toBe(complete.headline);
    expect((await as(carlos, "/me/profile/submit", "POST")).status).toBe(200);
    expect(await mine(carlos)).toMatchObject({ status: "published", submission: { status: "in_review" } });
    const queue = await json<{ profiles: { userId?: string; firstPublication: boolean; changes: string[] }[] }>(await as(admin, "/profile-reviews"));
    expect(queue.profiles.some(item => item.changes.includes("Identidad"))).toBe(true);
    expect((await json<{ profile: PublicProfile }>(await as(diego, `/profiles/${carlosId}`))).profile.content.headline).toBe(complete.headline);
    expect((await as(admin, `/members/${carlosId}/profile/approve`, "POST")).status).toBe(200);
    expect((await json<{ profile: PublicProfile }>(await as(diego, `/profiles/${carlosId}`))).profile).toMatchObject({ content: { headline: "Matemática y robótica para primaria" } });
    expect((await mine(carlos)).history.some(item => item.status === "published")).toBe(true);
  });

  it("ST-156 CA3 la persona o administración ocultan el perfil; lo que oculta administración solo administración lo muestra", async () => {
    const carlos = await signIn("carlos.mejia"), admin = await signIn("admin-demo"), diego = await signIn("diego.ramirez");
    expect([200, 409]).toContain((await as(carlos, "/me/profile/hide", "POST")).status);
    expect((await as(diego, `/profiles/${carlosId}`)).status).toBe(404);
    expect((await json<{ entries: { userId: string }[] }>(await as(diego, "/profiles"))).entries.find(item => item.userId === carlosId)).toBeUndefined();
    expect([200, 409]).toContain((await as(carlos, "/me/profile/show", "POST")).status);
    expect((await as(admin, `/members/${carlosId}/profile/hide`, "POST")).status).toBe(200);
    expect(await mine(carlos)).toMatchObject({ status: "hidden", hiddenBy: "admin" });
    expect((await as(carlos, "/me/profile/show", "POST")).status).toBe(409);
    // Hidden, the person and administration still open it; the team does not.
    expect((await as(carlos, `/profiles/${carlosId}`)).status).toBe(200);
    expect((await as(admin, `/members/${carlosId}/profile/show`, "POST")).status).toBe(200);
    expect((await as(diego, `/profiles/${carlosId}`)).status).toBe(200);
  });
});

describe("HL-15 ST-155 ST-157 credentials, directory and «Tu educador» on the built Worker", () => {
  let carlosId = "", today = "", credential = "";
  it("ST-155 CA1 CA2 la persona registra credenciales con su respaldo del expediente; administración las verifica o rechaza con motivo", async () => {
    const carlos = await signIn("carlos.mejia"), admin = await signIn("admin-demo"), lucia = await signIn("lucia.herrera");
    carlosId = await idOf(admin, "carlos.mejia");
    const file = await json<{ today: string }>(await as(admin, `/members/${carlosId}/files`));
    today = file.today;
    const uploaded = await fetch(`${origin}/api/members/${carlosId}/files`, { method: "POST", headers: { Cookie: carlos, Origin: origin, "Content-Type": "application/pdf", "X-Document-Type": "studies", "X-Document-Title": "Titulo", "X-Issued-On": "2013-11-30" }, body: pdf("titulo") });
    expect(uploaded.status).toBe(201);
    const documentId = (await json<{ document: { id: string } }>(uploaded)).document.id;
    const luciaDoc = await fetch(`${origin}/api/members/${await idOf(admin, "lucia.herrera")}/files`, { method: "POST", headers: { Cookie: lucia, Origin: origin, "Content-Type": "application/pdf", "X-Document-Type": "cv", "X-Issued-On": "2020-01-01" }, body: pdf("cv") });
    const otherDocument = (await json<{ document: { id: string } }>(luciaDoc)).document.id;
    const data = { type: "degree", name: "Profesorado en Matemática", issuer: "Universidad de San Carlos", country: "GT", issuedOn: "2013-11-30", credentialCode: "PEM-2013-0154", verificationUrl: "https://registro.example.edu/verificar/0154" };
    expect((await as(carlos, "/me/credentials", "POST", { ...data, documentId: otherDocument })).status).toBe(400);
    const created = await as(carlos, "/me/credentials", "POST", { ...data, documentId });
    expect(created.status, await created.clone().text()).toBe(201);
    credential = (await json<{ credential: { id: string; status: string; documentTitle: string } }>(created)).credential.id;
    expect((await mine(carlos)).credentials).toEqual(expect.arrayContaining([expect.objectContaining({ id: credential, status: "draft", documentTitle: "Titulo" })]));
    expect((await as(carlos, `/me/credentials/${credential}/submit`, "POST")).status).toBe(200);
    expect((await as(carlos, `/members/${carlosId}/credentials/${credential}/verify`, "POST")).status).toBe(403);
    const queue = await json<{ credentials: { userId: string; credential: { id: string } }[] }>(await as(admin, "/profile-reviews"));
    expect(queue.credentials.map(item => item.credential.id)).toEqual(expect.arrayContaining([credential]));
    expect((await as(admin, `/members/${carlosId}/credentials/${credential}/reject`, "POST", { reason: "x" })).status).toBe(400);
    expect((await as(admin, `/members/${carlosId}/credentials/${credential}/reject`, "POST", { reason: "El enlace de verificación no abre." })).status).toBe(200);
    const rejected = (await mine(carlos)).credentials.find(item => item.id === credential)!;
    expect(rejected).toMatchObject({ status: "rejected", rejectionReason: "El enlace de verificación no abre.", decidedBy: "Administración de la demostración" });
    expect((await as(carlos, `/me/credentials/${credential}/submit`, "POST")).status).toBe(409);
    const fixed = await as(carlos, `/me/credentials/${credential}`, "PUT", { ...data, documentId, verificationUrl: "https://registro.example.edu/v/0154", version: rejected.version, submit: true });
    expect(fixed.status, await fixed.clone().text()).toBe(200);
    expect((await json<{ credential: { status: string; rejectionReason: string | null } }>(fixed)).credential).toMatchObject({ status: "submitted", rejectionReason: null });
    expect((await as(admin, `/members/${carlosId}/credentials/${credential}/verify`, "POST")).status).toBe(200);
    expect((await as(admin, `/members/${carlosId}/credentials/${credential}/verify`, "POST")).status).toBe(409);
    // A verified credential that has already expired counts as expired when read.
    const old = await as(carlos, "/me/credentials", "POST", { type: "language_certificate", name: "Certificado de inglés B2", issuer: "Instituto de idiomas", issuedOn: "2018-03-01", expiresOn: "2020-03-01", submit: true });
    const oldId = (await json<{ credential: { id: string } }>(old)).credential.id;
    expect((await as(admin, `/members/${carlosId}/credentials/${oldId}/verify`, "POST")).status).toBe(200);
    expect((await mine(carlos)).credentials.map(item => [item.type, item.status])).toEqual(expect.arrayContaining([["degree", "verified"], ["language_certificate", "expired"]]));
    // Activity: the type of credential only, never its name, code or link.
    const events = (await summaries(admin)).filter(item => item.targetType === "credential").map(item => item.summary);
    expect(events).toEqual(expect.arrayContaining(["Rechazó una credencial de Carlos Mejía: Título académico", "Verificó una credencial de Carlos Mejía: Título académico", "Corrigió y envió a verificación una credencial: Título académico"]));
    expect(JSON.stringify(events)).not.toContain("PEM-2013");
  });

  it("ST-157 CA1 el directorio del equipo filtra por área, nivel, idioma y modalidad sin revelar secciones privadas", async () => {
    const carlos = await signIn("carlos.mejia"), admin = await signIn("admin-demo"), diego = await signIn("diego.ramirez");
    // Without required review, sending publishes at once.
    expect((await as(diego, "/organization/profile-review", "PUT", { required: false })).status).toBe(403);
    expect((await as(admin, "/organization/profile-review", "PUT", { required: false })).status).toBe(200);
    const visibility = { ...defaultVisibility, teaching: "private" as const, contact: "organization" as const };
    expect((await as(carlos, "/me/profile", "PUT", { draft: complete, visibility })).status).toBe(200);
    expect([200, 409]).toContain((await as(carlos, "/me/profile/submit", "POST")).status);
    expect(await mine(carlos)).toMatchObject({ status: "published" });
    expect((await as(admin, "/organization/profile-review", "PUT", { required: true })).status).toBe(200);
    const list = async (query = "") => (await json<{ entries: { userId: string; verifiedCredentials: number; areas: unknown[] }[] }>(await as(diego, `/profiles${query}`))).entries;
    expect((await list("?language=es")).map(item => item.userId)).toEqual(expect.arrayContaining([carlosId]));
    expect(await list("?language=quc")).toHaveLength(1);
    expect(await list("?q=universidad")).toHaveLength(0);
    // Teaching is private: its areas and levels do not reach the team, nor do the filters find them.
    expect((await list("?area=matemática")).find(item => item.userId === carlosId)).toBeUndefined();
    expect((await list("?level=1")).find(item => item.userId === carlosId)).toBeUndefined();
    expect((await list()).find(item => item.userId === carlosId)).toMatchObject({ areas: [], userId: carlosId });
    const page = (await json<{ profile: PublicProfile }>(await as(diego, `/profiles/${carlosId}`))).profile;
    expect(page.contact).toEqual({ phone: "+502 5555-0154", contactEmail: "carlos@ejemplo.org" });
    expect(page.credentials.map(item => [item.type, item.status])).toEqual(expect.arrayContaining([["degree", "verified"], ["language_certificate", "expired"]]));
    expect(JSON.stringify(page)).not.toContain("PEM-2013");
    expect(JSON.stringify(page)).not.toContain("registro.example.edu");
    expect((await as(carlos, "/me/profile", "PUT", { visibility: { ...defaultVisibility, links: "learners" } })).status).toBe(200);
    expect((await list("?area=matemática")).map(item => item.userId)).toEqual(expect.arrayContaining([carlosId]));
    expect((await list("?area=05")).map(item => item.userId)).toEqual(expect.arrayContaining([carlosId]));
    expect((await list("?level=2&modality=hybrid")).map(item => item.userId)).toEqual(expect.arrayContaining([carlosId]));
  });

  it("ST-157 CA2 «Tu educador» en el espacio de la sección muestra solo la versión publicada y lo que la persona comparte con estudiantes", async () => {
    const carlos = await signIn("carlos.mejia");
    const { cookie, text } = await studentSpace("DG-MATE-3A");
    const space = JSON.parse(text) as { educators: PublicProfile[] };
    expect(space.educators.map(item => item.userId)).toEqual(expect.arrayContaining([carlosId]));
    const card = space.educators.find(item => item.userId === carlosId)!;
    expect(card).toMatchObject({ audience: "learners", content: { headline: complete.headline, bio: complete.bio } });
    expect(card.sections).toEqual(expect.arrayContaining(["identity", "about", "languages", "credentials"]));
    // Only credentials in force; never contact data, availability or the career kept for the team.
    expect(card.credentials.map(item => item.status)).toEqual(["verified"]);
    for (const secret of ["+502 5555-0154", "carlos@ejemplo.org", "contactEmail", "\"phone\"", "availability", "Escuela Oficial Rural", "PEM-2013"]) expect(text, secret).not.toContain(secret);
    // A working copy that is not published does not reach students.
    expect((await as(carlos, "/me/profile", "PUT", { draft: { ...complete, headline: "Borrador sin publicar" } })).status).toBe(200);
    expect((await studentSpace("DG-MATE-3A")).text).not.toContain("Borrador sin publicar");
    // The photo is served to the section's students only for its educators with a published profile.
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, ...Array.from({ length: 40 }, (_, i) => i)]);
    expect((await fetch(`${origin}/api/profile/photo`, { method: "PUT", headers: { Cookie: carlos, Origin: origin, "Content-Type": "image/png" }, body: png })).status).toBe(200);
    const after = JSON.parse((await studentSpace("DG-MATE-3A")).text) as { educators: PublicProfile[] };
    const photo = await fetch(`${origin}${after.educators[0].photoUrl}`, { headers: { Cookie: cookie } });
    expect(photo.status).toBe(200);
    expect((await fetch(`${origin}/api/student/educators/${await idOf(await signIn("admin-demo"), "lucia.herrera")}/photo`, { headers: { Cookie: cookie } })).status).toBe(404);
    expect((await fetch(`${origin}${after.educators[0].photoUrl}`)).status).toBe(401);
    // Another section, without Carlos, has no educator card.
    expect(JSON.parse((await studentSpace("DG-ROBO-MAR")).text).educators).toEqual([]);
  });

  it("ST-156 CA4 la salida (ST-123) y la desactivación ocultan el perfil publicado automáticamente", async () => {
    const admin = await signIn("admin-demo");
    const created = await json<{ member: { id: string }; temporaryPassword: string }>(await as(admin, "/members", "POST", { displayName: "Paula Perfil", username: "paula.perfil", role: "educator" }));
    const login = await fetch(`${origin}/api/login`, { method: "POST", headers: { Origin: origin, "Content-Type": "application/json" }, body: JSON.stringify({ username: "paula.perfil", password: created.temporaryPassword }) });
    const temporary = login.headers.get("set-cookie")!.split(";")[0];
    expect((await as(temporary, "/account/password", "POST", { currentPassword: created.temporaryPassword, newPassword: "Perfil publicado 2026" })).status).toBe(200);
    await acceptPending(origin, temporary, "Paula Perfil", "Perfil publicado 2026");
    const paula = temporary;
    expect((await as(paula, "/me/profile", "PUT", { draft: { ...complete, links: [] } })).status).toBe(200);
    expect((await as(admin, "/organization/profile-review", "PUT", { required: false })).status).toBe(200);
    expect((await as(paula, "/me/profile/submit", "POST")).status).toBe(200);
    expect((await as(admin, "/organization/profile-review", "PUT", { required: true })).status).toBe(200);
    expect((await as(admin, `/profiles/${created.member.id}`)).status).toBe(200);
    const left = await as(admin, `/members/${created.member.id}/departure`, "POST", { date: today, reassignments: { courses: {}, sections: {} } });
    expect(left.status, await left.clone().text()).toBe(200);
    const page = await json<{ status: string }>(await as(admin, `/profiles/${created.member.id}`));
    expect(page.status).toBe("hidden");
    expect((await json<{ entries: { userId: string }[] }>(await as(admin, "/profiles"))).entries.map(item => item.userId)).not.toContain(created.member.id);
    expect((await summaries(admin)).map(item => item.summary)).toContain("Ocultó el perfil de Paula Perfil por su salida");
    // Backup: profiles, versions and credentials travel with the organization.
    const backup = JSON.parse(await (await as(admin, "/organization/backup")).text());
    expect(backup.tables.staff_profile_versions.rows.length).toBeGreaterThanOrEqual(4);
    expect(backup.tables.staff_credentials.rows.length).toBeGreaterThanOrEqual(2);
  });
});
