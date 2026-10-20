import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn, type ChildProcess } from "node:child_process";
import { createServer } from "node:net";
import { once } from "node:events";
import { setTimeout as delay } from "node:timers/promises";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { availabilityInput, documentStatus, staffDocumentInput, staffProfileInput } from "../packages/domain/src/index";

// ST-149 (educator profile) and ST-150 (staff file), tracked as HL-15. Domain rules first, then the built Worker.
describe("HL-15 ST-149 ST-150 profile and staff file rules", () => {
  it("ST-149 CA1 el perfil acepta nombre, teléfono, correo de contacto, formación, especialidades y disponibilidad válidos", () => {
    const profile = staffProfileInput({ displayName: "  Carlos   Mejía ", phone: "+502 5555-1234", contactEmail: " Carlos.Contacto@Ejemplo.org ", education: "Licenciatura en Matemática", specialties: ["Álgebra", " Geometría "], availability: [{ day: 3, start: "14:00", end: "16:00" }, { day: 1, start: "08:00", end: "12:00" }] });
    expect(profile).toEqual({ displayName: "Carlos Mejía", phone: "+502 5555-1234", contactEmail: "carlos.contacto@ejemplo.org", education: "Licenciatura en Matemática", specialties: ["Álgebra", "Geometría"], availability: [{ day: 1, start: "08:00", end: "12:00" }, { day: 3, start: "14:00", end: "16:00" }] });
    expect(staffProfileInput({ displayName: "Ana", phone: "", contactEmail: null })).toMatchObject({ phone: null, contactEmail: null, specialties: [], availability: [] });
    for (const value of [null, {}, { displayName: "A" }, { displayName: "<b>Ana</b>" }, { displayName: "Ana", phone: "12345" }, { displayName: "Ana", phone: "llámame" },
      { displayName: "Ana", contactEmail: "sin-arroba" }, { displayName: "Ana", specialties: ["Arte", "arte"] }, { displayName: "Ana", specialties: Array(13).fill(0).map((_, i) => `Tema ${i}`) },
      { displayName: "Ana", education: "x".repeat(1001) }, { displayName: "Ana", availability: [{ day: 8, start: "08:00", end: "09:00" }] }]) expect(staffProfileInput(value), JSON.stringify(value).slice(0, 80)).toBeNull();
  });
  it("ST-149 CA1 la disponibilidad son franjas por día que no se cruzan", () => {
    expect(availabilityInput([{ day: 2, start: "08:00", end: "10:00" }, { day: 2, start: "10:00", end: "11:00" }])).toHaveLength(2);
    expect(availabilityInput([{ day: 2, start: "08:00", end: "10:00" }, { day: 2, start: "09:30", end: "11:00" }])).toBeNull();
    expect(availabilityInput([{ day: 2, start: "10:00", end: "10:00" }])).toBeNull();
    expect(availabilityInput([{ day: 2, start: "8:00", end: "10:00" }])).toBeNull();
  });
  it("ST-150 CA1 CA3 un documento tiene tipo, emisión no futura y vencimiento posterior; vence o está por vencer a 30 días", () => {
    expect(staffDocumentInput({ type: "criminal-record", title: "", issuedOn: "2026-01-10", expiresOn: "2026-07-10" }, "2026-10-15")).toEqual({ type: "criminal-record", title: "Antecedentes penales", issuedOn: "2026-01-10", expiresOn: "2026-07-10" });
    expect(staffDocumentInput({ type: "cv", title: "Hoja de vida 2026", issuedOn: "2026-10-15" }, "2026-10-15")).toMatchObject({ expiresOn: null });
    for (const value of [{ type: "passport", issuedOn: "2026-01-01" }, { type: "cv", issuedOn: "2026-10-16" }, { type: "cv", issuedOn: "2026-02-30" }, { type: "dpi", issuedOn: "2026-01-01", expiresOn: "2025-12-31" }, { type: "dpi", issuedOn: "2026-01-01", expiresOn: "pronto" }])
      expect(staffDocumentInput(value, "2026-10-15"), JSON.stringify(value)).toBeNull();
    expect(documentStatus(null, "2026-10-15")).toBe("valid");
    expect(documentStatus("2026-10-14", "2026-10-15")).toBe("expired");
    expect(documentStatus("2026-10-15", "2026-10-15")).toBe("expiring");
    expect(documentStatus("2026-11-14", "2026-10-15")).toBe("expiring");
    expect(documentStatus("2026-11-15", "2026-10-15")).toBe("valid");
  });
});

let worker: ChildProcess;
let origin = "";
let logs = "";
const storage = mkdtempSync(join(tmpdir(), "hl-platform-profiles-"));
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
async function send(cookie: string | null, path: string, method: string, body: Uint8Array<ArrayBuffer>, headers: Record<string, string>) {
  return fetch(`${origin}/api${path}`, { method, headers: { Cookie: cookie || "", Origin: origin, ...headers }, body });
}
const summaries = async (cookie: string, query = "") => (await (await as(cookie, `/activity?limit=100${query}`)).json()).events.map((event: { summary: string }) => event.summary) as string[];
const idOf = async (admin: string, username: string) => ((await (await as(admin, "/members")).json()).members as { id: string; username: string }[]).find(row => row.username === username)!.id;
const png = (size = 64) => { const bytes = new Uint8Array(size); bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]); for (let i = 8; i < size; i++) bytes[i] = i % 251; return bytes; };
const pdf = (text: string) => new TextEncoder().encode(`%PDF-1.4\n% ${text}\n%%EOF\n`);
const addDays = (day: string, days: number) => new Date(Date.parse(`${day}T00:00:00Z`) + days * 86400000).toISOString().slice(0, 10);
const upload = (cookie: string, userId: string, body: Uint8Array<ArrayBuffer>, meta: { type: string; title?: string; issuedOn: string; expiresOn?: string }, mediaType = "application/pdf") =>
  send(cookie, `/members/${userId}/files`, "POST", body, { "Content-Type": mediaType, "X-Document-Type": meta.type, "X-Document-Title": encodeURIComponent(meta.title || ""), "X-Issued-On": meta.issuedOn, ...(meta.expiresOn ? { "X-Expires-On": meta.expiresOn } : {}) });
type Doc = { id: string; type: string; title: string; status: string; expiresOn: string | null; selfUploaded: boolean; withdrawnAt: string | null };

const phone = "+502 5555-0149", contactEmail = "carlos.contacto@ejemplo.org";

describe("HL-15 ST-149 educator profile on the built Worker", () => {
  it("ST-149 CA1 la persona edita su nombre, foto, teléfono, correo de contacto, formación, especialidades y disponibilidad", async () => {
    const carlos = await signIn("carlos.mejia");
    expect((await as(null, "/profile")).status).toBe(401);
    const empty = (await (await as(carlos, "/profile")).json()).profile;
    expect(empty).toMatchObject({ displayName: "Carlos Mejía", photo: false });
    expect(empty.specialties.length).toBeGreaterThanOrEqual(0);
    expect((await as(carlos, "/profile", "PUT", { displayName: "Carlos Mejía", phone: "123" })).status).toBe(400);
    expect((await as(carlos, "/profile", "PUT", { displayName: "Carlos Mejía", availability: [{ day: 1, start: "08:00", end: "10:00" }, { day: 1, start: "09:00", end: "11:00" }] })).status).toBe(400);
    const saved = await as(carlos, "/profile", "PUT", { displayName: "Carlos A. Mejía", phone, contactEmail, education: "Profesorado en Matemática y Física", specialties: ["Álgebra", "Geometría"], availability: [{ day: 2, start: "14:00", end: "17:00" }, { day: 4, start: "08:00", end: "12:00" }] });
    expect(saved.status).toBe(200);
    const body = await saved.json();
    expect(body.changed).toEqual(["nombre", "teléfono", "correo de contacto", "formación", "especialidades", "disponibilidad"]);
    expect(body.profile).toMatchObject({ displayName: "Carlos A. Mejía", education: "Profesorado en Matemática y Física", specialties: ["Álgebra", "Geometría"], contact: { phone, contactEmail } });
    // The name is the one the whole platform shows.
    expect((await (await as(carlos, "/session")).json()).member.displayName).toBe("Carlos A. Mejía");

    // Photo: images only, at most 2 MB, checked by their leading bytes; served only with a staff session.
    expect((await send(carlos, "/profile/photo", "PUT", pdf("no es imagen"), { "Content-Type": "application/pdf" })).status).toBe(400);
    expect((await send(carlos, "/profile/photo", "PUT", pdf("disfrazado"), { "Content-Type": "image/png" })).status).toBe(400);
    expect((await send(carlos, "/profile/photo", "PUT", png(2 * 1024 * 1024 + 1), { "Content-Type": "image/png" })).status).toBe(400);
    const photo = await send(carlos, "/profile/photo", "PUT", png(), { "Content-Type": "image/png" });
    expect(photo.status, await photo.clone().text()).toBe(200);
    const me = (await (await as(carlos, "/profile")).json()).profile;
    expect(me.photo).toBe(true);
    const served = await as(await signIn("diego.ramirez"), `/members/${me.userId}/photo`);
    expect(served.status).toBe(200);
    expect(served.headers.get("content-type")).toBe("image/png");
    expect(new Uint8Array(await served.arrayBuffer())).toEqual(png());
    expect((await as(null, `/members/${me.userId}/photo`)).status).toBe(401);
  });

  it("ST-149 CA2 administración consulta el perfil de cada persona y los estudiantes nunca ven sus datos de contacto", async () => {
    const admin = await signIn("admin-demo"), carlosId = await idOf(admin, "carlos.mejia");
    const full = (await (await as(admin, `/members/${carlosId}/profile`)).json()).profile;
    expect(full).toMatchObject({ displayName: "Carlos A. Mejía", photo: true, specialties: ["Álgebra", "Geometría"], contact: { phone, contactEmail } });
    // A teammate of Matemáticas sees who Carlos is and what he teaches, without his contact data.
    const teammate = await as(await signIn("lucia.herrera"), `/members/${carlosId}/profile`);
    expect(teammate.status).toBe(200);
    const shared = await teammate.text();
    expect(JSON.parse(shared).profile).toMatchObject({ displayName: "Carlos A. Mejía", specialties: ["Álgebra", "Geometría"] });
    expect(shared).not.toContain(phone); expect(shared).not.toContain(contactEmail); expect(JSON.parse(shared).profile.contact).toBeUndefined();
    // Someone who shares no course with him does not see the profile at all.
    expect((await as(await signIn("diego.ramirez"), `/members/${carlosId}/profile`)).status).toBe(403);
    // Students: the section code of a course Carlos teaches never carries his profile or contact data.
    const login = await fetch(`${origin}/api/student/login`, { method: "POST", headers: { Origin: origin, "Content-Type": "application/json" }, body: JSON.stringify({ code: "DG-MATE-3A" }) });
    expect(login.status).toBe(200);
    const student = /hl_group=[^;]+/.exec(login.headers.get("set-cookie") || "")![0];
    const space = await (await fetch(`${origin}/api/student/space`, { headers: { Cookie: student } })).text();
    expect(space.length).toBeGreaterThan(50);
    for (const secret of [phone, contactEmail, "Profesorado en Matemática", "contactEmail", "\"phone\""]) expect(space).not.toContain(secret);
    // A student cookie opens no staff route.
    for (const path of [`/members/${carlosId}/profile`, `/members/${carlosId}/photo`, `/members/${carlosId}/files`, "/profile"])
      expect((await fetch(`${origin}/api${path}`, { headers: { Cookie: student } })).status, path).toBe(401);
  });

  it("ST-149 CA3 cada cambio del perfil queda en la actividad, sin los datos personales", async () => {
    const admin = await signIn("admin-demo"), carlos = await signIn("carlos.mejia"), carlosId = await idOf(admin, "carlos.mejia");
    const before = await summaries(admin, `&actor=${carlosId}`);
    expect(before).toContain("Actualizó su perfil: nombre, teléfono, correo de contacto, formación, especialidades, disponibilidad");
    expect(before).toContain("Cambió su foto de perfil");
    // Saving without changes adds nothing; each real change adds one entry naming the fields.
    const current = (await (await as(carlos, "/profile")).json()).profile;
    const same = { displayName: current.displayName, phone, contactEmail, education: current.education, specialties: current.specialties, availability: current.availability };
    expect((await (await as(carlos, "/profile", "PUT", same)).json()).changed).toEqual([]);
    expect((await as(carlos, "/profile", "PUT", { ...same, phone: "+502 4444-0149" })).status).toBe(200);
    expect((await as(carlos, "/profile/photo", "DELETE")).status).toBe(200);
    const after = await summaries(admin, `&actor=${carlosId}`);
    expect(after.length).toBe(before.length + 2);
    expect(after.slice(0, 2)).toEqual(["Quitó su foto de perfil", "Actualizó su perfil: teléfono"]);
    expect(JSON.stringify(after)).not.toContain("4444");
    // Educators do not see these entries: they are part of the organization's administration.
    expect(await summaries(await signIn("lucia.herrera"))).not.toContain("Actualizó su perfil: teléfono");
  });
});

describe("HL-15 ST-150 staff file on the built Worker", () => {
  let carlosId = "", today = "", criminal = "";
  it("ST-150 CA1 administración adjunta al expediente documentos con su tipo, su fecha de emisión y su vencimiento", async () => {
    const admin = await signIn("admin-demo");
    carlosId = await idOf(admin, "carlos.mejia");
    const empty = await (await as(admin, `/members/${carlosId}/files`)).json();
    today = empty.today;
    expect(empty).toMatchObject({ member: { id: carlosId, active: true }, documents: [] });
    // Invalid metadata or contents are refused before anything is stored.
    for (const [meta, body, type] of [
      [{ type: "passport", issuedOn: "2026-01-05" }, pdf("x"), "application/pdf"],
      [{ type: "cv", issuedOn: addDays(today, 1) }, pdf("x"), "application/pdf"],
      [{ type: "dpi", issuedOn: "2026-01-05", expiresOn: "2025-01-05" }, pdf("x"), "application/pdf"],
      [{ type: "cv", issuedOn: "2026-01-05" }, new TextEncoder().encode("PK no es pdf"), "application/pdf"],
      [{ type: "cv", issuedOn: "2026-01-05" }, pdf("x"), "application/zip"],
      [{ type: "cv", issuedOn: "2026-01-05" }, new Uint8Array(10 * 1024 * 1024 + 1).fill(37), "application/pdf"],
    ] as const) { const refused = await upload(admin, carlosId, body, meta, type); expect(refused.status, JSON.stringify(meta) + await refused.text()).toBe(400); }
    const created = await upload(admin, carlosId, pdf("antecedentes penales de prueba"), { type: "criminal-record", title: "Antecedentes 2026", issuedOn: addDays(today, -200), expiresOn: addDays(today, 10) });
    expect(created.status, await created.clone().text()).toBe(201);
    const document = (await created.json()).document as Doc;
    criminal = document.id;
    expect(document).toMatchObject({ type: "criminal-record", title: "Antecedentes 2026", expiresOn: addDays(today, 10), status: "expiring", selfUploaded: false, withdrawnAt: null });
    expect((await upload(admin, carlosId, png(), { type: "dpi", issuedOn: "2019-03-01", expiresOn: addDays(today, -1) }, "image/png")).status).toBe(201);
    expect((await upload(admin, carlosId, pdf("cv"), { type: "cv", issuedOn: addDays(today, -30) })).status).toBe(201);
    // The person may add documents to their own file; they are marked as such.
    const own = await upload(await signIn("carlos.mejia"), carlosId, pdf("certificado"), { type: "certificate", title: "Diplomado en evaluación", issuedOn: addDays(today, -5), expiresOn: addDays(today, 800) });
    expect(own.status).toBe(201);
    expect((await own.json()).document).toMatchObject({ selfUploaded: true, status: "valid" });
    const listed = (await (await as(admin, `/members/${carlosId}/files`)).json()).documents as Doc[];
    expect(listed.map(item => [item.type, item.status]).sort()).toEqual([["certificate", "valid"], ["criminal-record", "expiring"], ["cv", "valid"], ["dpi", "expired"]]);
  });

  it("ST-150 CA2 los archivos son privados y cada carga, consulta o retiro queda en la actividad", async () => {
    const admin = await signIn("admin-demo"), carlos = await signIn("carlos.mejia"), lucia = await signIn("lucia.herrera");
    // Another educator, even a teammate, cannot list, download, upload or withdraw.
    expect((await as(lucia, `/members/${carlosId}/files`)).status).toBe(403);
    expect((await as(lucia, `/members/${carlosId}/files/${criminal}/content`)).status).toBe(403);
    expect((await upload(lucia, carlosId, pdf("x"), { type: "cv", issuedOn: "2026-01-05" })).status).toBe(403);
    expect((await as(lucia, `/members/${carlosId}/files/${criminal}/withdraw`, "POST")).status).toBe(403);
    // Without a session nothing is served.
    expect((await as(null, `/members/${carlosId}/files`)).status).toBe(401);
    expect((await as(null, `/members/${carlosId}/files/${criminal}/content`)).status).toBe(401);
    // The person downloads their own document, as stored.
    const download = await as(carlos, `/members/${carlosId}/files/${criminal}/content`);
    expect(download.status).toBe(200);
    expect(download.headers.get("content-disposition")).toMatch(/^attachment; filename="antecedentes-penales-\d{4}-\d{2}-\d{2}\.pdf"$/);
    expect(download.headers.get("cache-control")).toContain("no-store");
    expect(new TextDecoder().decode(await download.arrayBuffer())).toContain("antecedentes penales de prueba");
    // Only administration withdraws; the document leaves the person's file but its record stays.
    expect((await as(carlos, `/members/${carlosId}/files/${criminal}/withdraw`, "POST")).status).toBe(403);
    expect((await as(admin, `/members/${carlosId}/files/${criminal}/withdraw`, "POST")).status).toBe(200);
    expect((await as(admin, `/members/${carlosId}/files/${criminal}/withdraw`, "POST")).status).toBe(409);
    expect(((await (await as(carlos, `/members/${carlosId}/files`)).json()).documents as Doc[]).map(item => item.id)).not.toContain(criminal);
    expect((await as(carlos, `/members/${carlosId}/files/${criminal}/content`)).status).toBe(404);
    const kept = ((await (await as(admin, `/members/${carlosId}/files`)).json()).documents as Doc[]).find(item => item.id === criminal)!;
    expect(kept.withdrawnAt).not.toBeNull();
    expect((await as(admin, `/members/${carlosId}/files/${criminal}/content`)).status).toBe(200);
    // Activity: upload, consulta and withdrawal, naming the type only, never the title or the contents.
    const events = await summaries(admin);
    for (const line of ["Agregó al expediente de Carlos A. Mejía: Antecedentes penales", "Agregó a su expediente: Certificado", "Consultó un documento de su expediente: Antecedentes penales",
      "Retiró del expediente de Carlos A. Mejía: Antecedentes penales", "Consultó un documento del expediente de Carlos A. Mejía: Antecedentes penales"]) expect(events, line).toContain(line);
    expect(JSON.stringify(events)).not.toContain("Antecedentes 2026");
    expect(JSON.stringify(events)).not.toContain("Diplomado");
    // Educators never see these entries in their activity.
    expect(JSON.stringify(await summaries(lucia))).not.toContain("expediente");
  });

  it("ST-150 CA3 la plataforma señala los documentos vencidos o por vencer y el expediente se conserva tras la salida", async () => {
    const admin = await signIn("admin-demo");
    expect((await as(await signIn("carlos.mejia"), "/expiring-documents")).status).toBe(403);
    const overview = await (await as(admin, "/expiring-documents")).json();
    expect(overview.today).toBe(today);
    const carlos = overview.people.find((person: { id: string }) => person.id === carlosId);
    // The withdrawn document no longer counts; the expired DPI does.
    expect(carlos.documents.map((item: Doc) => [item.type, item.status])).toEqual([["dpi", "expired"]]);
    expect((await upload(admin, carlosId, pdf("policía"), { type: "police-record", issuedOn: addDays(today, -100), expiresOn: addDays(today, 30) })).status).toBe(201);
    const next = (await (await as(admin, "/expiring-documents")).json()).people.find((person: { id: string }) => person.id === carlosId);
    expect(next.documents.map((item: Doc) => [item.type, item.status])).toEqual([["dpi", "expired"], ["police-record", "expiring"]]);

    // A person who leaves (ST-123) keeps their file; administration still reads and downloads it.
    const created = await (await as(admin, "/members", "POST", { displayName: "Paula Expediente", username: "paula.expediente", role: "educator" })).json();
    const paula = created.member.id as string;
    const stored = await (await upload(admin, paula, pdf("hoja de vida"), { type: "cv", issuedOn: addDays(today, -3) })).json();
    expect((await upload(admin, paula, pdf("dpi vencido"), { type: "dpi", issuedOn: "2015-01-01", expiresOn: addDays(today, -40) })).status).toBe(201);
    const left = await as(admin, `/members/${paula}/departure`, "POST", { date: today, reassignments: { courses: {}, sections: {} } });
    expect(left.status, await left.clone().text()).toBe(200);
    const file = await (await as(admin, `/members/${paula}/files`)).json();
    expect(file.member).toMatchObject({ id: paula, active: false });
    expect(file.documents).toHaveLength(2);
    expect((await as(admin, `/members/${paula}/files/${stored.document.id}/content`)).status).toBe(200);
    // Her expired document no longer needs attention in the overview.
    expect((await (await as(admin, "/expiring-documents")).json()).people.map((person: { id: string }) => person.id)).not.toContain(paula);
    // Backup (administration only): profile and staff file metadata travel; file contents stay in private storage.
    const backup = JSON.parse(await (await as(admin, "/organization/backup")).text());
    expect(backup.tables.staff_profiles.rows.length).toBeGreaterThan(0);
    expect(backup.tables.staff_documents.rows.length).toBe(7);
    expect(backup.tables.staff_documents.columns).toEqual(expect.arrayContaining(["object_key", "sha256", "withdrawn_at"]));
    expect((await as(await signIn("lucia.herrera"), "/organization/backup")).status).toBe(403);
  });
});
