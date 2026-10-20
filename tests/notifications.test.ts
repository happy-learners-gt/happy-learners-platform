import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn, type ChildProcess } from "node:child_process";
import { createServer } from "node:net";
import { once } from "node:events";
import { setTimeout as delay } from "node:timers/promises";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { dailyMailCap, maxNotificationsPerRequest, notificationCatalog, notificationDecision, notificationMessage, notificationReason, notificationTypes, optionalNotificationCap, policyInput, preferencesInput, receives } from "../packages/domain/src/index";
import type { MailSender, NotificationType } from "../packages/domain/src/index";
import { notify } from "../apps/api/src/notify";
import type { NotifyStore as Database } from "../apps/api/src/notify";

// ST-124 (HL-170): e-mail notifications. Domain rules first, then the built Worker on a fresh store (no Brevo key).
describe("HL-170 notification rules and message", () => {
  it("CA1 the catalog covers assignments, the three review steps and class changes and cancellations", () => {
    expect([...notificationTypes]).toEqual(["course_assignment", "section_assignment", "review_submitted", "review_returned", "review_approved", "class_changed", "class_cancelled"]);
    // ST-161 adds the account and terms notices after them, always mandatory.
    expect(notificationCatalog.map(item => item.type)).toEqual([...notificationTypes, "account_security", "account_email", "terms_updated"]);
    for (const item of notificationCatalog) { expect(item.label.length).toBeGreaterThan(3); expect(item.description).toBeTruthy(); expect(item.audience).toBeTruthy(); }
  });
  it("CA2 every type is on by default, a person can turn one off, and a mandatory type cannot be turned off", () => {
    const none = new Set<NotificationType>();
    expect(receives("class_changed", {}, none)).toBe(true);
    expect(receives("class_changed", { class_changed: false }, none)).toBe(false);
    expect(receives("class_changed", { class_changed: false }, new Set<NotificationType>(["class_changed"]))).toBe(true);
    expect(receives("class_cancelled", { class_changed: false }, none)).toBe(true);
  });
  it("CA2 validates preferences and policy input", () => {
    expect(preferencesInput({ preferences: { class_changed: false, review_returned: true } })).toEqual({ class_changed: false, review_returned: true });
    for (const value of [null, {}, { preferences: {} }, { preferences: { unknown: true } }, { preferences: { class_changed: "no" } }, { preferences: [] }]) expect(preferencesInput(value)).toBeNull();
    expect(policyInput({ mandatory: ["class_cancelled", "course_assignment"] })).toEqual(["course_assignment", "class_cancelled"]);
    expect(policyInput({ mandatory: [] })).toEqual([]);
    for (const value of [null, {}, { mandatory: ["x"] }, { mandatory: ["class_changed", "class_changed"] }, { mandatory: "class_changed" }]) expect(policyInput(value)).toBeNull();
  });
  it("CA3 DEC-042 optional notices wait from the reserve below the cap; mandatory ones only at the cap; no address or provider is recorded as such", () => {
    expect(optionalNotificationCap).toBeLessThan(dailyMailCap);
    const base = { address: "a@example.test", configured: true, sentToday: 0, mandatory: false };
    expect(notificationDecision({ ...base, address: null })).toBe("no_address");
    expect(notificationDecision({ ...base, configured: false })).toBe("not_configured");
    expect(notificationDecision(base)).toBe("send");
    expect(notificationDecision({ ...base, sentToday: optionalNotificationCap - 1 })).toBe("send");
    expect(notificationDecision({ ...base, sentToday: optionalNotificationCap })).toBe("deferred");
    expect(notificationDecision({ ...base, sentToday: optionalNotificationCap, mandatory: true })).toBe("send");
    expect(notificationDecision({ ...base, sentToday: dailyMailCap, mandatory: true })).toBe("deferred");
    expect(notificationDecision({ ...base, sentInRequest: maxNotificationsPerRequest })).toBe("deferred");
  });
  it("CA3 the reason is one Spanish sentence of at most 240 characters", () => {
    expect(notificationReason({ type: "section_assignment", course: "Matemáticas", section: "3A" })).toBe("Te asignaron a la sección «3A» de «Matemáticas»");
    expect(notificationReason({ type: "course_assignment", course: "Arte", role: "lead" })).toBe("Te asignaron al equipo docente del curso «Arte» como persona responsable");
    expect(notificationReason({ type: "review_returned", course: "Arte", lesson: "Colores", actor: "Sofía" })).toBe("Sofía devolvió con comentarios tu lección «Colores» de «Arte»");
    expect(notificationReason({ type: "class_changed", course: "Arte", section: "B", date: "2026-10-20", next: { date: "2026-10-22", startsAt: "08:00" } })).toBe("Cambió la clase del 2026-10-20 de la sección «B» de «Arte»: ahora es el 2026-10-22 a las 08:00");
    expect(notificationReason({ type: "class_cancelled", course: "x".repeat(500), section: "y".repeat(500), date: "2026-10-20" }).length).toBeLessThanOrEqual(240);
  });
  it("CA1 the message is in Spanish, links to the page and to the preferences, and escapes HTML", () => {
    const message = notificationMessage("paula@example.test", { type: "review_submitted", organization: "Colegio <Ficticio>", recipientName: "Paula", reason: "Carlos envió a revisión la lección «<b>Fracciones</b>»", link: "https://example.test/cursos/c/lecciones/l", mandatory: false, preferencesLink: "https://example.test/perfil#notificaciones" });
    expect(message.subject).toBe("Una lección espera tu revisión · Colegio <Ficticio>");
    for (const part of ["Hola, Paula:", "Revisar la lección", "https://example.test/cursos/c/lecciones/l", "https://example.test/perfil#notificaciones"]) { expect(message.text).toContain(part); expect(message.html).toContain(part); }
    expect(message.html).toContain("&lt;b&gt;Fracciones&lt;/b&gt;"); expect(message.html).not.toContain("<b>Fracciones");
    const mandatory = notificationMessage("p@example.test", { type: "class_cancelled", organization: "X", recipientName: "P", reason: "R", link: "https://e.test/x", mandatory: true, preferencesLink: "https://e.test/perfil" });
    expect(mandatory.text).toContain("obligatorio"); expect(mandatory.text).not.toContain("https://e.test/perfil");
  });
});

describe("HL-170 notify on a fake store", () => {
  const actor = { id: "u-actor", username: "actor", displayName: "Actora", role: "admin" as const, organizationId: "org-demo" };
  function store(sentToday: number, people: { id: string; name: string; email: string | null }[], mandatory: NotificationType[] = [], off: { userId: string; type: NotificationType }[] = []) {
    const inserts: unknown[][] = [], updates: unknown[][] = [];
    const statement = (sql: string) => ({ sql, values: [] as unknown[], bind(...values: unknown[]) { this.values = values; return this; },
      async all() { return { results: sql.includes("FROM users u JOIN memberships") ? people : sql.includes("notification_policies") ? mandatory.map(type => ({ type })) : sql.includes("notification_preferences") ? off.map(item => ({ ...item, enabled: 0 })) : [] }; },
      async first() { return sql.includes("count(*)") ? { sent: sentToday } : sql.includes("organizations") ? { name: "Colegio" } : null; },
      async run() { if (sql.startsWith("UPDATE")) updates.push(this.values); } });
    // Only the outbox rows: since ST-161 the same batch also writes the in-app notices (inbox), checked below.
    const inbox: unknown[][] = [];
    const db = { prepare: statement, async batch(list: { sql: string; values: unknown[] }[]) { for (const item of list) (item.sql.includes("notification_inbox") ? inbox : inserts).push(item.values); return []; } } as unknown as Database;
    return { db, inserts, updates, inbox };
  }
  const notice = (userId: string, type: NotificationType = "class_changed") => ({ userId, targetId: "class-1", path: "/secciones/g/clases/class-1", facts: { type, course: "Arte", section: "B", date: "2026-10-20" } as never });
  const ok: MailSender & { sent: string[] } = { configured: true, sent: [], async send(message) { this.sent.push(message.to); return { ok: true, id: "m" }; } };

  it("CA1 CA3 sends to people with an address, records the rest as no_address and never the actor", async () => {
    const fake = store(0, [{ id: "u-1", name: "Uno", email: "uno@example.test" }, { id: "u-2", name: "Dos", email: null }, { id: "u-actor", name: "Actora", email: "a@example.test" }]);
    ok.sent = [];
    expect(await notify(fake.db, { origin: "https://hl.test", sender: ok }, actor, [notice("u-1"), notice("u-2"), notice("u-actor"), notice("u-1")])).toBe(2);
    expect(ok.sent).toEqual(["uno@example.test"]);
    expect(fake.inserts.map(values => values[5])).toEqual(["queued", "no_address"]);
    expect(fake.updates[0]).toContain("sent");
    // The bell gets the notice too, address or not.
    expect(fake.inbox.map(values => values[2])).toEqual(["u-1", "u-2"]);
  });
  it("CA2 DEC-042 over the optional cap optional notices are deferred while mandatory ones still go; a turned-off type leaves no record", async () => {
    const people = [{ id: "u-1", name: "Uno", email: "uno@example.test" }, { id: "u-2", name: "Dos", email: "dos@example.test" }];
    const capped = store(optionalNotificationCap, people, ["class_cancelled"], [{ userId: "u-2", type: "class_cancelled" }]);
    ok.sent = [];
    await notify(capped.db, { origin: "https://hl.test", sender: ok }, actor, [notice("u-1"), notice("u-2", "class_cancelled")]);
    expect(capped.inserts.map(values => [values[8], values[5], values[11]])).toEqual([["u-1", "deferred", 0], ["u-2", "queued", 1]]);
    expect(ok.sent).toEqual(["dos@example.test"]);
    const full = store(dailyMailCap, people, ["class_cancelled"]);
    await notify(full.db, { origin: "https://hl.test", sender: ok }, actor, [notice("u-2", "class_cancelled")]);
    expect(full.inserts.map(values => [values[5], values[11]])).toEqual([["deferred", 1]]);
    const quiet = store(0, people, [], [{ userId: "u-1", type: "class_changed" }]);
    expect(await notify(quiet.db, { origin: "https://hl.test", sender: ok }, actor, [notice("u-1")])).toBe(0);
    expect(quiet.inserts).toEqual([]);
    // Turning off the e-mail leaves the bell on.
    expect(quiet.inbox.map(values => values[3])).toEqual(["class_changed"]);
  });
  it("never throws: a failing store leaves the triggering change alone", async () => {
    const broken = { prepare: () => { throw new Error("down"); } } as unknown as Database;
    expect(await notify(broken, { origin: "https://hl.test", sender: ok }, actor, [notice("u-1")])).toBe(0);
  });
});

let worker: ChildProcess;
let origin = "";
let logs = "";
const storage = mkdtempSync(join(tmpdir(), "hl-platform-notifications-"));
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
const json = async (cookie: string | null, path: string) => (await as(cookie, path)).json();
type Logged = { id: string; type: NotificationType; userId: string; recipient: string | null; reason: string; targetId: string; status: string; mandatory: boolean };
const log = async (admin: string | null, query = "") => (await json(admin, `/notifications/log?limit=200${query}`)).notifications as Logged[];
const course = "seed-course-matematicas", section = "seed-group-mat-3a";
const versionOf = async (cookie: string | null) => (await json(cookie, `/courses/${course}`)).course.version as number;

describe("HL-170 ST-124 notifications on the built Worker", () => {
  let admin: string | null, lucia: string | null, carlos: string | null, sofia: string | null;
  beforeAll(async () => {
    [admin, lucia, carlos, sofia] = await Promise.all(["admin-demo", "lucia.herrera", "carlos.mejia", "sofia.castillo"].map(name => signIn(name)));
    // Sofía has a contact e-mail; the others have no address yet.
    const saved = await as(sofia, "/profile", "PUT", { displayName: "Sofía Castillo", phone: "", contactEmail: "sofia.castillo@example.test", education: "", specialties: [], availability: [] });
    expect(saved.status, await saved.clone().text()).toBe(200);
  });

  it("CA1 CA3 asignar a un curso y a una sección registra el aviso de quien llega, con motivo y estado; no de quien asigna ni de quien sigue igual", async () => {
    const before = (await json(admin, `/courses/${course}`)).course.team as { userId: string; role: string }[];
    const team = [...before.map(member => ({ userId: member.userId, role: member.role })), { userId: "seed-user-sofia", role: "co-teacher" }];
    const saved = await as(admin, `/courses/${course}/team`, "PUT", { members: team, version: await versionOf(admin) });
    expect(saved.status, await saved.clone().text()).toBe(200);
    const assigned = (await log(admin, "&type=course_assignment")).filter(item => item.targetId === course);
    expect(assigned.map(item => item.userId)).toEqual(["seed-user-sofia"]);
    expect(assigned[0]).toMatchObject({ status: "not_configured", mandatory: false, reason: expect.stringMatching(/^Te asignaron al equipo docente del curso «.+» como colaborador$/) });
    expect(assigned[0].recipient).toMatch(/sofia\.castillo@/);

    const group = (await json(admin, `/courses/${course}/groups/${section}`)).group as { name: string; educators: { userId: string }[] };
    const educators = [...new Set([...group.educators.map(item => item.userId), "seed-user-lucia", "seed-user-sofia", "seed-user-carlos"])];
    const put = await as(admin, `/courses/${course}/groups/${section}/educators`, "PUT", { userIds: educators, conflictReason: "Prueba de avisos" });
    expect(put.status, await put.clone().text()).toBe(200);
    const sections = (await log(admin, "&type=section_assignment")).filter(item => item.targetId === section);
    const added = educators.filter(id => !group.educators.some(item => item.userId === id)).sort();
    expect(sections.map(item => item.userId).sort()).toEqual(added);
    const title = (await json(admin, `/courses/${course}`)).course.title as string;
    expect(sections.find(item => item.userId === "seed-user-sofia")).toMatchObject({ status: "not_configured", reason: `Te asignaron a la sección «${group.name}» de «${title}»` });
    // Without an address the record says so; the change itself succeeded.
    for (const item of sections.filter(item => item.userId !== "seed-user-sofia")) expect(item).toMatchObject({ status: "no_address", recipient: null });
    // Saving the same educators again notifies nobody.
    const again = await as(admin, `/courses/${course}/groups/${section}/educators`, "PUT", { userIds: educators, conflictReason: "Prueba de avisos" });
    expect(again.status).toBe(200);
    expect((await log(admin, "&type=section_assignment")).filter(item => item.targetId === section)).toHaveLength(sections.length);
  });

  it("CA1 enviar a revisión avisa a la persona responsable; devolver y aprobar avisan a quien la envió; nunca a quien actúa", async () => {
    const lessons = (await json(carlos, `/lessons?course=${course}&drafts=1`)).lessons as { id: string; status: string }[];
    const lesson = lessons.find(item => item.status !== "archived")!;
    expect((await as(carlos, `/lessons/${lesson.id}/review`, "POST", { note: "Lista" })).status).toBe(201);
    const submitted = (await log(admin, "&type=review_submitted")).filter(item => item.targetId === lesson.id);
    expect(submitted.map(item => item.userId)).toContain("seed-user-lucia");
    expect(submitted.map(item => item.userId)).not.toContain("seed-user-carlos");
    expect(submitted[0].reason).toMatch(/^Carlos Mejía envió a revisión la lección «.+» de «.+»$/);
    expect((await as(lucia, `/lessons/${lesson.id}/review/return`, "POST", { note: "Agrega un cierre." })).status).toBe(200);
    const returned = (await log(admin, "&type=review_returned")).filter(item => item.targetId === lesson.id);
    expect(returned.map(item => item.userId)).toEqual(["seed-user-carlos"]);
    expect(returned[0].reason).toMatch(/^Lucía Herrera devolvió con comentarios tu lección/);
    expect((await as(carlos, `/lessons/${lesson.id}/review`, "POST", { note: "Ajustada" })).status).toBe(201);
    const published = await as(lucia, `/lessons/${lesson.id}/publish`, "POST");
    expect(published.status, await published.clone().text()).toBe(200);
    const approved = (await log(admin, "&type=review_approved")).filter(item => item.targetId === lesson.id);
    expect(approved.map(item => item.userId)).toEqual(["seed-user-carlos"]);
    expect((await log(admin, `&person=seed-user-lucia&type=review_returned`))).toEqual([]);
  });

  let sessionId = "";
  it("CA2 cada persona apaga un tipo de aviso y deja de recibirlo (sin registro); los demás tipos siguen", async () => {
    const off = await as(sofia, "/notifications/preferences", "PUT", { preferences: { class_cancelled: false } });
    expect(off.status).toBe(200);
    const body = await off.json();
    expect(body.settings.find((item: { type: string }) => item.type === "class_cancelled")).toMatchObject({ enabled: false, mandatory: false });
    expect(body.settings.find((item: { type: string }) => item.type === "class_changed")).toMatchObject({ enabled: true });
    expect(body.hasAddress).toBe(true);
    expect((await as(sofia, "/notifications/preferences", "PUT", { preferences: { nope: false } })).status).toBe(400);

    const created = await as(lucia, `/courses/${course}/sessions`, "POST", { groupId: section, sessionDate: "2027-03-10", startsAt: "08:00", durationMinutes: 45, lessonIds: [], notes: "" });
    expect(created.status, await created.clone().text()).toBe(201);
    sessionId = (await created.json()).id;
    const cancelled = await as(lucia, `/courses/${course}/sessions/${sessionId}/cancel`, "POST");
    expect(cancelled.status, await cancelled.clone().text()).toBe(200);
    const records = (await log(admin, "&type=class_cancelled")).filter(item => item.targetId === sessionId);
    expect(records.map(item => item.userId)).not.toContain("seed-user-sofia");
    expect(records.map(item => item.userId)).not.toContain("seed-user-lucia");
    expect(records.map(item => item.userId)).toContain("seed-user-carlos");
    expect(records[0].reason).toMatch(/^Se canceló la clase del 2027-03-10 de la sección/);
  });

  it("CA2 administración define los obligatorios: no se pueden apagar y llegan aunque la persona los haya apagado", async () => {
    expect((await as(sofia, "/notifications/preferences", "PUT", { preferences: { class_changed: false } })).status).toBe(200);
    expect((await as(sofia, "/notifications/policy", "PUT", { mandatory: ["class_changed"] })).status).toBe(403);
    expect((await as(admin, "/notifications/policy", "PUT", { mandatory: ["bogus"] })).status).toBe(400);
    const policy = await as(admin, "/notifications/policy", "PUT", { mandatory: ["class_changed"] });
    expect(policy.status).toBe(200);
    expect((await policy.json()).settings.find((item: { type: string }) => item.type === "class_changed").mandatory).toBe(true);
    const mine = await json(sofia, "/notifications/preferences");
    expect(mine.settings.find((item: { type: string }) => item.type === "class_changed")).toMatchObject({ enabled: true, mandatory: true });
    const locked = await as(sofia, "/notifications/preferences", "PUT", { preferences: { class_changed: false } });
    expect(locked.status).toBe(409);

    const restored = await as(lucia, `/courses/${course}/sessions/${sessionId}/restore`, "POST");
    expect(restored.status, await restored.clone().text()).toBe(200);
    const detail = (await json(lucia, `/courses/${course}/sessions/${sessionId}`)).session as { version: number };
    const moved = await as(lucia, `/courses/${course}/sessions/${sessionId}`, "PUT", { sessionDate: "2027-03-11", startsAt: "09:00", durationMinutes: 45, lessonIds: [], notes: "", version: detail.version });
    expect(moved.status, await moved.clone().text()).toBe(200);
    const changed = (await log(admin, "&type=class_changed&person=seed-user-sofia")).filter(item => item.targetId === sessionId);
    expect(changed).toHaveLength(2);
    expect(changed.every(item => item.mandatory && item.status === "not_configured")).toBe(true);
    const [title, name] = [(await json(admin, `/courses/${course}`)).course.title, (await json(admin, `/courses/${course}/groups/${section}`)).group.name];
    expect(changed.map(item => item.reason).sort()).toEqual([`Cambió la clase del 2027-03-10 de la sección «${name}» de «${title}»: ahora es el 2027-03-11 a las 09:00`, `Se reprogramó la clase del 2027-03-10 de la sección «${name}» de «${title}»`]);
    expect((await log(admin, "&type=class_changed&person=seed-user-lucia")).filter(item => item.targetId === sessionId)).toEqual([]);
    expect((await json(admin, "/activity?limit=50")).events.map((event: { summary: string }) => event.summary)).toContain("Cambió los avisos por correo obligatorios: Cambio de una clase");
  });

  it("CA3 administración consulta el registro filtrado por persona, tipo y estado; cada persona ve solo su historial", async () => {
    expect((await as(sofia, "/notifications/log")).status).toBe(403);
    expect((await as(admin, "/notifications/log?type=bogus")).status).toBe(400);
    const all = await log(admin);
    expect(all.length).toBeGreaterThan(5);
    for (const item of all) { expect(item.reason.length).toBeGreaterThan(5); expect(["not_configured", "no_address", "scheduled", "sent", "deferred"]).toContain(item.status); }
    const bySofia = await log(admin, "&person=seed-user-sofia");
    expect(bySofia.length).toBeGreaterThan(0); expect(bySofia.every(item => item.userId === "seed-user-sofia")).toBe(true);
    expect((await log(admin, "&status=no_address")).every(item => item.status === "no_address" && item.recipient === null)).toBe(true);
    const mine = await json(sofia, "/notifications/preferences");
    expect(mine.history.length).toBe(bySofia.length);
    expect(mine.history.every((item: Logged) => item.userId === "seed-user-sofia")).toBe(true);
    const carlosHistory = (await json(carlos, "/notifications/preferences")).history as Logged[];
    expect(carlosHistory.every(item => item.userId === "seed-user-carlos")).toBe(true);
    expect(typeof (await json(carlos, "/notifications/preferences")).hasAddress).toBe("boolean");
  });

  it("the backup includes preferences and policy, and still skips the outbox", async () => {
    const tables = (await json(admin, "/organization/backup")).tables;
    expect(tables.notification_preferences.rows.length).toBeGreaterThan(0);
    expect(tables.notification_policies.rows.length).toBe(notificationTypes.length);
    expect(tables.mail_outbox).toBeUndefined();
  });
});
