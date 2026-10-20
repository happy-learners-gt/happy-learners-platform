import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn, type ChildProcess } from "node:child_process";
import { createServer } from "node:net";
import { once } from "node:events";
import { setTimeout as delay } from "node:timers/promises";
import { DatabaseSync } from "node:sqlite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  accountMessage, accountNoticeReason, closureOpen, closureReasonInput, closureStatuses, closureTransition, countryCode, deviceLabel, emailChangeInput, emailChangeLifetimeMs, emailChangeState,
  maskEmail, personalDataFile, personalDataSections,
} from "../packages/domain/src/index";
import type { MailSender } from "../packages/domain/src/index";
import { deliver, type OutboxStore } from "../apps/api/src/mail";
import { acceptPending } from "./accept-pending";

// ST-158 (account settings) and ST-159 (my data and closing the account). Domain rules first, then the outbox on a
// real SQLite store with every migration, then the built Worker on a fresh local store (no mail provider).
describe("ST-158 account rules", () => {
  it("CA2 an e-mail change is pending for 24 hours, then reads as expired; verified and cancelled stay", () => {
    expect(emailChangeLifetimeMs).toBe(24 * 60 * 60 * 1000);
    expect(emailChangeState("pending", "2026-10-17T00:00:00.000Z", "2026-10-16T23:59:59.999Z")).toBe("pending");
    expect(emailChangeState("pending", "2026-10-17T00:00:00.000Z", "2026-10-17T00:00:00.000Z")).toBe("expired");
    expect(emailChangeState("verified", "2026-10-17T00:00:00.000Z", "2027-01-01T00:00:00.000Z")).toBe("verified");
    expect(emailChangeState("cancelled", "2026-10-17T00:00:00.000Z", "2026-10-16T00:00:00.000Z")).toBe("cancelled");
    expect(emailChangeState("otro", "2026-10-17T00:00:00.000Z", "2026-10-16T00:00:00.000Z")).toBe("expired");
  });
  it("CA2 a change needs a valid, different address and the current password", () => {
    expect(emailChangeInput({ email: "  Paula@Ejemplo.ORG ", currentPassword: "secreta" }, null)).toEqual({ email: "paula@ejemplo.org", currentPassword: "secreta" });
    expect(emailChangeInput({ email: "paula@ejemplo.org", currentPassword: "x" }, "paula@ejemplo.org")).toEqual({ error: "same" });
    for (const email of ["", "sin-arroba", "a@b", "a..b@ejemplo.org", 42]) expect(emailChangeInput({ email, currentPassword: "x" }, null)).toEqual({ error: "email" });
    for (const currentPassword of [undefined, "", "x".repeat(129), 7]) expect(emailChangeInput({ email: "a@ejemplo.org", currentPassword }, null)).toEqual({ error: "password" });
    expect(emailChangeInput(null, null)).toEqual({ error: "email" });
  });
  it("CA2 notices to the previous address only show a masked form of the new one", () => {
    expect(maskEmail("paula.gomez@ejemplo.org")).toBe("p•••z@ejemplo.org");
    expect(maskEmail("al@ejemplo.org")).toBe("a@ejemplo.org");
    expect(maskEmail("sin-arroba")).toBe("•••");
  });
  it("CA3 a session shows a device summary from the User-Agent, never the header itself", () => {
    const cases: [string | null, string][] = [
      ["Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36", "Chrome en Windows"],
      ["Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36 Edg/131.0.0.0", "Edge en Windows"],
      ["Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1", "Safari en iPhone"],
      ["Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/131.0 Mobile/15E148 Safari/604.1", "Chrome en iPhone"],
      ["Mozilla/5.0 (Macintosh; Intel Mac OS X 14.6; rv:132.0) Gecko/20100101 Firefox/132.0", "Firefox en macOS"],
      ["Mozilla/5.0 (Linux; Android 14; SM-S918B) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/26.0 Chrome/122.0 Mobile Safari/537.36", "Samsung Internet en Android"],
      ["Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/131.0.0.0 Safari/537.36", "Chrome en Linux"],
      ["Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1", "Safari en iPad"],
      ["curl/8.5.0", "Navegador desconocido"], [null, "Navegador desconocido"], ["Mozilla/5.0 (X11; Linux x86_64)", "Navegador en Linux"],
    ];
    for (const [agent, label] of cases) expect(deviceLabel(agent), String(agent)).toBe(label);
    expect(deviceLabel("x".repeat(10000)).length).toBeLessThanOrEqual(80);
  });
  it("CA3 the country comes from CF-IPCountry as ISO 3166-1 alpha-2; unknown and Tor are not countries", () => {
    expect(countryCode("GT")).toBe("GT");
    expect(countryCode(" mx ")).toBe("MX");
    for (const value of ["XX", "T1", "", null, undefined, "GTM", "1A"]) expect(countryCode(value), String(value)).toBeNull();
  });
  it("CA2 CA4 security notices are in Spanish, mandatory, escape HTML and keep the reason under 240 characters", () => {
    const details = { organization: "Colegio <Ficticio>", recipientName: "Paula", timezone: "America/Guatemala" };
    const verify = accountMessage("nueva@ejemplo.org", { kind: "email_verify", username: "paula", link: "https://hl.test/cuenta/correo/d_" + "a".repeat(64), expiresAt: "2026-10-17T12:00:00.000Z" }, details);
    expect(verify.subject).toBe("Confirma tu nuevo correo de acceso · Colegio <Ficticio>");
    for (const part of ["Hola, Paula:", "https://hl.test/cuenta/correo/d_", "solo funciona una vez", "no se puede desactivar"]) { expect(verify.text).toContain(part); expect(verify.html).toContain(part); }
    expect(verify.html).toContain("Colegio &lt;Ficticio&gt;"); expect(verify.html).not.toContain("<Ficticio>");
    const previous = accountMessage("vieja@ejemplo.org", { kind: "email_change_requested", username: "paula", newEmail: "nueva.direccion@ejemplo.org" }, details);
    expect(previous.text).toContain("n•••n@ejemplo.org"); expect(previous.text).not.toContain("nueva.direccion@"); expect(previous.html).not.toContain("nueva.direccion@");
    expect(previous.text).toContain("Si no fuiste tú");
    const changed = accountMessage("vieja@ejemplo.org", { kind: "email_changed", username: "paula", newEmail: "nueva.direccion@ejemplo.org" }, details);
    expect(changed.subject).toContain("El correo de tu cuenta cambió"); expect(changed.text).not.toContain("nueva.direccion@");
    const reasons = [accountNoticeReason({ kind: "closure_requested", person: "N".repeat(500), username: "u".repeat(32), link: "https://x" }), accountNoticeReason({ kind: "email_change_requested", username: "paula", newEmail: "nueva.direccion@ejemplo.org" })];
    for (const reason of reasons) expect(reason.length).toBeLessThanOrEqual(240);
    expect(reasons[1]).not.toContain("nueva.direccion@");
    expect(accountMessage("a@ejemplo.org", { kind: "password_changed", username: "paula" }, { ...details, timezone: "Zona/Inexistente" }).text).toContain("La contraseña de tu cuenta @paula cambió");
  });
});

describe("ST-159 closure and my data rules", () => {
  it("CA2 requested → in_progress (administration) → completed (departure); cancelled only before it starts", () => {
    expect([...closureStatuses]).toEqual(["requested", "in_progress", "completed", "cancelled"]);
    expect(closureTransition("requested", "start")).toBe("in_progress");
    expect(closureTransition("requested", "cancel")).toBe("cancelled");
    expect(closureTransition("requested", "complete")).toBe("completed");
    expect(closureTransition("in_progress", "complete")).toBe("completed");
    for (const [from, action] of [["in_progress", "cancel"], ["in_progress", "start"], ["completed", "start"], ["completed", "cancel"], ["completed", "complete"], ["cancelled", "start"], ["cancelled", "complete"], ["cancelled", "cancel"]] as const)
      expect(closureTransition(from, action), `${from} ${action}`).toBeNull();
    expect(closureStatuses.filter(closureOpen)).toEqual(["requested", "in_progress"]);
  });
  it("CA2 the reason is optional, up to 500 characters, without markup", () => {
    expect(closureReasonInput({})).toBe("");
    expect(closureReasonInput(null)).toBe("");
    expect(closureReasonInput({ reason: "  Me mudo   de país \n\n\n\nGracias " })).toBe("Me mudo de país \n\nGracias");
    for (const reason of ["<b>no</b>", "x".repeat(501), 12, "a\u0000b"]) expect(closureReasonInput({ reason }), String(reason)).toBeNull();
  });
  it("CA1 the export lists its sections in order and names the file after the person and the day", () => {
    expect(personalDataSections.map(item => item.key)).toEqual(["account", "profile", "credentials", "preferences", "consents", "signatures", "hours", "activity", "security", "closures"]);
    expect(personalDataFile("paula.gomez", "2026-10-16")).toBe("mis-datos-paula.gomez-2026-10-16.json");
    expect(personalDataFile("../x", "2026-10-16")).toBe("mis-datos-..x-2026-10-16.json");
  });
});

describe("ST-158 account notices in the outbox of a migrated store", () => {
  function migrated() {
    const db = new DatabaseSync(":memory:");
    db.exec("PRAGMA foreign_keys=ON");
    for (const name of readdirSync("database/migrations").filter(file => file.endsWith(".sql")).sort()) db.exec(readFileSync(join("database/migrations", name), "utf8"));
    const store: OutboxStore = { prepare: sql => ({ bind: (...values) => ({ first: async <T>() => (db.prepare(sql).get(...values) as T) ?? null, run: async () => db.prepare(sql).run(...values) }) }) };
    return { db, store };
  }
  const message = (to: string) => ({ to, subject: "Aviso", text: "t", html: "<p>t</p>" });
  it("CA4 a mandatory account notice is recorded with its person and reason, and a person without an address leaves no_address", async () => {
    const { db, store } = migrated();
    const sent: string[] = [];
    const ok: MailSender = { configured: true, async send(item) { sent.push(item.to); return { ok: true, id: "brevo-1" }; } };
    expect((await deliver(store, ok, "org-demo", "account", "email-change-1", message("nueva@ejemplo.org"), { userId: "user-0", reason: "Confirmación del nuevo correo" })).status).toBe("sent");
    expect((await deliver(store, ok, "org-demo", "account", "closure-1", message(""), { userId: "user-0", reason: "Pidió cerrar su cuenta" })).status).toBe("no_address");
    expect((await deliver(store, { configured: false, send: ok.send }, "org-demo", "account", "x", message("a@ejemplo.org"), { userId: "user-0", reason: "R" })).status).toBe("not_configured");
    expect(sent).toEqual(["nueva@ejemplo.org"]);
    expect(db.prepare("SELECT kind,status,user_id AS userId,mandatory,reason FROM mail_outbox ORDER BY rowid").all()).toEqual([
      { kind: "account", status: "sent", userId: "user-0", mandatory: 1, reason: "Confirmación del nuevo correo" },
      { kind: "account", status: "no_address", userId: "user-0", mandatory: 1, reason: "Pidió cerrar su cuenta" },
      { kind: "account", status: "not_configured", userId: "user-0", mandatory: 1, reason: "R" },
    ]);
    // An account notice always names its person; invitations still carry none.
    expect(() => db.prepare("INSERT INTO mail_outbox(id,organization_id,kind,recipient,subject,status,created_at,reason,mandatory) VALUES ('m','org-demo','account','a@ejemplo.org','S','sent','t','R',1)").run()).toThrow();
    expect(() => db.prepare("INSERT INTO mail_outbox(id,organization_id,kind,recipient,subject,status,created_at,user_id,reason,mandatory) VALUES ('m','org-demo','account','a@ejemplo.org','S','sent','t','user-0','R',0)").run()).toThrow();
    expect((await deliver(store, ok, "org-demo", "invitation", "invitation-1", message("x@ejemplo.org"))).status).toBe("sent");
  });
});

let worker: ChildProcess;
let origin = "";
let logs = "";
const storage = mkdtempSync(join(tmpdir(), "hl-platform-account-"));
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

const firefox = "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:132.0) Gecko/20100101 Firefox/132.0";
const iphone = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1";
async function signIn(username: string, password = "Aprender-2026!", agent = firefox, country = "GT") {
  const response = await fetch(`${origin}/api/login`, { method: "POST", headers: { "Content-Type": "application/json", Origin: origin, "User-Agent": agent, "CF-IPCountry": country }, body: JSON.stringify({ username, password }) });
  return response.status === 200 ? response.headers.get("set-cookie")!.split(";")[0] : null;
}
async function as(cookie: string | null, path: string, method = "GET", data?: unknown) {
  return fetch(`${origin}/api${path}`, { method, headers: { Cookie: cookie || "", Origin: origin, ...(data !== undefined ? { "Content-Type": "application/json" } : {}) }, ...(data !== undefined ? { body: JSON.stringify(data) } : {}) });
}
const read = async <T = Record<string, unknown>>(response: Response, status = 200) => { const text = await response.text(); expect(response.status, text).toBe(status); return JSON.parse(text) as T; };
const summaries = async (cookie: string | null, actor: string) => (await read<{ events: { summary: string }[] }>(await as(cookie, `/activity?limit=100&actor=${actor}`))).events.map(item => item.summary);
/** A new educator with their own password, so closing sessions or the account never touches the demo accounts. */
async function newEducator(admin: string | null, username: string, displayName: string) {
  const created = await read<{ member: { id: string }; temporaryPassword: string }>(await as(admin, "/members", "POST", { displayName, username, role: "educator" }), 201);
  const first = await signIn(username, created.temporaryPassword);
  await read(await as(first, "/account/password", "POST", { currentPassword: created.temporaryPassword, newPassword: "Una frase para recordar 2026" }));
  await acceptPending(origin, first, displayName, "Una frase para recordar 2026");
  return { id: created.member.id, cookie: first, password: "Una frase para recordar 2026" };
}

describe("ST-158 ST-159 on the built Worker", () => {
  let admin: string | null = null;
  beforeAll(async () => { admin = await signIn("admin-demo"); expect(admin).toBeTruthy(); });

  it("CA1 la cuenta muestra el usuario, el correo y las sesiones; sin sesión responde 401 y otras rutas no existen", async () => {
    const { account } = await read<{ account: Record<string, unknown> }>(await as(admin, "/me/account"));
    expect(account).toMatchObject({ username: "admin-demo", role: "admin", email: null, pendingEmail: null, mailConfigured: false });
    expect(account.sessions).toBeGreaterThanOrEqual(1);
    expect((await as(null, "/me/account")).status).toBe(401);
    expect((await as(admin, "/me/account", "PUT", {})).status).toBe(405);
    expect((await as(admin, "/me/account/sessions/session-zz")).status).toBe(404);
    expect((await fetch(`${origin}/api/me/closure`, { method: "POST", headers: { Cookie: admin!, "Content-Type": "application/json" }, body: "{}" })).status).toBe(403);
  });

  it("CA3 CA4 las sesiones muestran dispositivo, país, inicio y último uso; se cierra una o todas las demás, nunca la actual", async () => {
    const person = await newEducator(admin, "sesiones.prueba", "Sesiones Prueba");
    const phone = await signIn("sesiones.prueba", person.password, iphone, "MX");
    const tablet = await signIn("sesiones.prueba", person.password, iphone, "XX");
    const { sessions } = await read<{ sessions: { id: string; device: string; country: string | null; current: boolean; method: string; createdAt: string; lastUsedAt: string; expiresAt: string }[] }>(await as(person.cookie, "/me/account/sessions"));
    expect(sessions).toHaveLength(3);
    expect(sessions[0]).toMatchObject({ current: true, device: "Firefox en Windows", country: "GT", method: "password" });
    expect(sessions.filter(item => !item.current).map(item => `${item.device} · ${item.country}`).sort()).toEqual(["Safari en iPhone · MX", "Safari en iPhone · null"]);
    for (const item of sessions) { expect(item.id).toMatch(/^session-[a-f0-9]{32}$/); expect(Date.parse(item.expiresAt) - Date.parse(item.createdAt)).toBe(28800000); expect(item.lastUsedAt >= item.createdAt).toBe(true); }
    expect(JSON.stringify(sessions)).not.toMatch(/[a-f0-9]{64}/);
    // The current one is closed with «Cerrar sesión», not from here.
    expect((await read<{ error: string }>(await as(person.cookie, `/me/account/sessions/${sessions[0].id}`, "DELETE"), 409)).error).toContain("Cerrar sesión");
    // Another person's session id is not found.
    expect((await as(admin, `/me/account/sessions/${sessions[1].id}`, "DELETE")).status).toBe(404);
    const mexico = sessions.find(item => item.country === "MX")!;
    await read(await as(person.cookie, `/me/account/sessions/${mexico.id}`, "DELETE"));
    expect((await as(phone, "/session")).status).toBe(401);
    expect((await as(tablet, "/session")).status).toBe(200);
    expect((await as(person.cookie, `/me/account/sessions/${mexico.id}`, "DELETE")).status).toBe(404);
    expect(await read(await as(person.cookie, "/me/account/sessions/others", "DELETE"))).toEqual({ closed: 1 });
    expect((await as(tablet, "/session")).status).toBe(401);
    expect((await as(person.cookie, "/session")).status).toBe(200);
    expect(await read(await as(person.cookie, "/me/account/sessions/others", "DELETE"))).toEqual({ closed: 0 });
    expect(await summaries(admin, person.id)).toEqual(expect.arrayContaining(["Cerró una sesión abierta en Safari en iPhone", "Cerró su otra sesión abierta"]));
  });

  it("CA5 el historial muestra los intentos correctos y fallidos de la propia cuenta, más recientes primero", async () => {
    const person = await newEducator(admin, "historial.prueba", "Historial Prueba");
    expect(await signIn("historial.prueba", "Una contraseña equivocada", iphone, "SV")).toBeNull();
    // An unknown username leaves nothing anywhere.
    expect(await signIn("nadie.existe", "Una contraseña equivocada")).toBeNull();
    const again = await signIn("historial.prueba", person.password, firefox, "GT");
    const { logins, limit } = await read<{ logins: { outcome: string; method: string; device: string; country: string | null }[]; limit: number }>(await as(again, "/me/account/logins"));
    expect(limit).toBe(30);
    expect(logins.map(item => [item.outcome, item.device, item.country])).toEqual([["succeeded", "Firefox en Windows", "GT"], ["failed", "Safari en iPhone", "SV"], ["succeeded", "Firefox en Windows", "GT"]]);
    expect(JSON.stringify(logins)).not.toMatch(/127\.0\.0\.1|Mozilla/);
    // Each person sees only their own.
    const own = (await read<{ logins: { device: string }[] }>(await as(admin, "/me/account/logins"))).logins;
    expect(own.every(item => item.device === "Firefox en Windows")).toBe(true);
  });

  it("CA2 cambiar el correo exige la contraseña, queda pendiente hasta confirmar el enlace (24 h, un uso) y avisa al correo anterior", async () => {
    const person = await newEducator(admin, "correo.prueba", "Correo Prueba");
    const me = person.cookie;
    expect((await read<{ error: string }>(await as(me, "/me/account/email", "POST", { email: "correo.prueba@ejemplo.test" }), 400)).error).toContain("contraseña actual");
    expect((await read<{ error: string }>(await as(me, "/me/account/email", "POST", { email: "correo.prueba@ejemplo.test", currentPassword: "No es esta 2026" }), 400)).error).toContain("no es correcta");
    expect((await as(me, "/me/account/email", "POST", { email: "no-es-correo", currentPassword: person.password })).status).toBe(400);
    const first = await read<{ change: { id: string; newEmail: string; status: string; expiresAt: string; requestedAt: string }; delivery: string; link: string }>(await as(me, "/me/account/email", "POST", { email: "Correo.Prueba@Ejemplo.test", currentPassword: person.password }), 201);
    expect(first.delivery).toBe("not_configured");
    expect(first.change).toMatchObject({ newEmail: "correo.prueba@ejemplo.test", status: "pending" });
    expect(Date.parse(first.change.expiresAt) - Date.parse(first.change.requestedAt)).toBe(24 * 60 * 60 * 1000);
    expect(first.link).toMatch(new RegExp(`^${origin}/cuenta/correo/d_[a-f0-9]{64}$`));
    const token = first.link.split("/").pop()!;
    expect((await read<{ account: { email: string | null; pendingEmail: { newEmail: string } } }>(await as(me, "/me/account"))).account).toMatchObject({ email: null, pendingEmail: { newEmail: "correo.prueba@ejemplo.test" } });
    // A newer request replaces the pending one: its link stops working.
    const second = await read<{ link: string }>(await as(me, "/me/account/email", "POST", { email: "correo.prueba@ejemplo.test", currentPassword: person.password }), 201);
    expect((await read<{ code: string }>(await as(null, `/account/email/${token}`), 410)).code).toBe("EMAIL_CHANGE_CANCELLED");
    const latest = second.link.split("/").pop()!;
    // Public: preview without a session; GET never confirms.
    expect((await read<{ change: Record<string, string> }>(await as(null, `/account/email/${latest}`))).change).toMatchObject({ username: "correo.prueba", newEmail: "correo.prueba@ejemplo.test", organization: expect.any(String) });
    expect((await read<{ account: { email: string | null } }>(await as(me, "/me/account"))).account.email).toBeNull();
    expect(await read(await as(null, `/account/email/${latest}`, "POST"))).toMatchObject({ ok: true, email: "correo.prueba@ejemplo.test" });
    expect((await read<{ account: { email: string; pendingEmail: null } }>(await as(me, "/me/account"))).account).toMatchObject({ email: "correo.prueba@ejemplo.test", pendingEmail: null });
    expect((await read<{ code: string }>(await as(null, `/account/email/${latest}`, "POST"), 410)).code).toBe("EMAIL_CHANGE_USED");
    expect((await read<{ code: string }>(await as(null, `/account/email/d_${"0".repeat(64)}`), 404)).code).toBe("EMAIL_CHANGE_NOT_FOUND");
    expect((await as(me, "/me/account/email", "POST", { email: "correo.prueba@ejemplo.test", currentPassword: person.password })).status).toBe(400);
    // The address is now taken for anyone else in the organization.
    expect((await read<{ error: string }>(await as(admin, "/me/account/email", "POST", { email: "correo.prueba@ejemplo.test", currentPassword: "Aprender-2026!" }), 409)).error).toContain("otra cuenta");
    // Cancelling a pending change: its link stops working and the e-mail stays.
    const third = await read<{ link: string }>(await as(me, "/me/account/email", "POST", { email: "otra.direccion@ejemplo.test", currentPassword: person.password }), 201);
    await read(await as(me, "/me/account/email", "DELETE"));
    expect((await as(me, "/me/account/email", "DELETE")).status).toBe(404);
    expect((await read<{ code: string }>(await as(null, `/account/email/${third.link.split("/").pop()}`, "POST"), 410)).code).toBe("EMAIL_CHANGE_CANCELLED");
    expect((await read<{ account: { email: string } }>(await as(me, "/me/account"))).account.email).toBe("correo.prueba@ejemplo.test");
    // The activity names the steps, never the addresses.
    const events = await summaries(admin, person.id);
    expect(events).toEqual(expect.arrayContaining(["Pidió cambiar su correo de acceso", "Confirmó su nuevo correo de acceso", "Canceló el cambio de su correo de acceso"]));
    expect(events.join(" ")).not.toContain("@ejemplo.test");
    // The notices are mandatory account messages in the outbox: confirmation to the new address, notices to the previous one.
    const exported = await (await as(me, "/me/export")).json() as { security: { notices: { kind: string; reason: string; status: string }[]; emailChanges: { status: string; newEmail: string }[] } };
    const reasons = exported.security.notices.map(item => item.reason);
    expect(exported.security.notices.every(item => item.kind === "account" && item.status === "not_configured")).toBe(true);
    expect(reasons.filter(reason => reason.startsWith("Confirmación del nuevo correo"))).toHaveLength(3);
    expect(reasons).toEqual(expect.arrayContaining(["Aviso al correo anterior: @correo.prueba pidió cambiar su correo de acceso a o•••n@ejemplo.test"]));
    expect(exported.security.emailChanges.map(item => item.status)).toEqual(["cancelled", "verified", "cancelled"]);
    // Changing the password also sends a security notice now that there is an address.
    await read(await as(me, "/account/password", "POST", { currentPassword: person.password, newPassword: "Otra frase segura para 2026" }));
    const after = await (await as(me, "/me/export")).json() as { security: { notices: { kind: string; type: string | null; reason: string }[] } };
    expect(after.security.notices.map(item => item.reason)).toContain("Aviso de seguridad: cambió la contraseña de @correo.prueba");
    // v1.1.1 (ST-161): one e-mail only, the account notice; the bell shows the mandatory account_security notice.
    expect(after.security.notices.filter(item => item.kind === "notification" && item.type === "account_security")).toEqual([]);
    const bell = await read<{ items: { type: string; mandatory: boolean; path: string }[] }>(await as(me, "/me/inbox"));
    expect(bell.items.filter(item => item.type === "account_security")).toEqual([expect.objectContaining({ mandatory: true, path: "/cuenta" })]);
  });

  it("CA1 ST-159 exportar mis datos descarga un JSON con lo propio, sin secretos ni datos de terceros, y queda en la actividad", async () => {
    const person = await newEducator(admin, "datos.prueba", "Datos Prueba");
    await read(await as(person.cookie, "/profile", "PUT", { displayName: "Datos Prueba", phone: "+502 5555-0159", contactEmail: "datos@ejemplo.test", specialties: ["Biología"], availability: [] }));
    const response = await as(person.cookie, "/me/export");
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("application/json");
    expect(response.headers.get("content-disposition")).toMatch(/^attachment; filename="mis-datos-datos\.prueba-\d{4}-\d{2}-\d{2}\.json"$/);
    const text = await response.text(), data = JSON.parse(text);
    expect(data.format).toBe("happy-learners-personal-data/1");
    expect(data.sections.map((item: { key: string }) => item.key)).toEqual(personalDataSections.map(item => item.key));
    expect(data.account).toMatchObject({ id: person.id, username: "datos.prueba", role: "educator", active: true });
    expect(data.profile).toMatchObject({ phone: "+502 5555-0159", contactEmail: "datos@ejemplo.test", specialties: ["Biología"], hasPhoto: false });
    for (const key of ["credentials", "preferences", "consents", "signatures", "hours", "activity", "security", "closures"]) expect(data).toHaveProperty(key);
    // v1.1.1: the professional profile (ST-154, ST-156), the credentials (ST-155) and the preferences (ST-160, ST-161) join the export.
    expect(data.profile).toMatchObject({ status: "draft", draft: expect.any(Object), visibility: expect.any(Object), versions: [] });
    expect(data.credentials).toMatchObject({ staffDocuments: [], credentials: [] });
    for (const key of ["regional", "delivery", "notifications", "inbox"]) expect(data.preferences).toHaveProperty(key);
    expect(data.security.sessions[0]).toMatchObject({ current: true, device: "Firefox en Windows" });
    for (const secret of ["password_hash", "passwordHash", "password_salt", "token_hash", "tokenHash", "salt", "photo_key", "object_key", "admin-demo"]) expect(text, secret).not.toContain(secret);
    expect(await summaries(admin, person.id)).toContain("Descargó una copia de sus datos");
  });

  it("CA2 ST-159 solicitar el cierre, cancelarlo antes de que inicie; administración lo inicia y la salida (ST-123) lo completa", async () => {
    const person = await newEducator(admin, "cierre.prueba", "Cierre Prueba");
    const me = person.cookie;
    expect(await read(await as(me, "/me/closure"))).toEqual({ closure: null, history: [], blocked: null });
    expect((await as(me, "/me/closure", "POST", { reason: "<b>no</b>" })).status).toBe(400);
    const requested = await read<{ closure: { id: string; status: string; reason: string } }>(await as(me, "/me/closure", "POST", { reason: "Me mudo de país" }), 201);
    expect(requested.closure).toMatchObject({ status: "requested", reason: "Me mudo de país" });
    expect((await as(me, "/me/closure", "POST", {})).status).toBe(409);
    expect((await read<{ closure: { status: string } }>(await as(me, "/me/closure", "DELETE"))).closure.status).toBe("cancelled");
    expect((await as(me, "/me/closure", "DELETE")).status).toBe(404);
    const again = await read<{ closure: { id: string }; history: unknown[] }>(await as(me, "/me/closure", "POST", {}), 201);
    expect(again.history).toHaveLength(2);
    // Only administration lists and starts requests.
    expect((await as(me, "/closures")).status).toBe(403);
    expect((await as(me, `/closures/${again.closure.id}/start`, "POST")).status).toBe(403);
    const list = await read<{ closures: { id: string; status: string; username: string }[] }>(await as(admin, "/closures"));
    expect(list.closures.find(item => item.id === again.closure.id)).toMatchObject({ id: again.closure.id, status: "requested", username: "cierre.prueba" });
    const started = await read<{ closure: { status: string; startedBy: string } }>(await as(admin, `/closures/${again.closure.id}/start`, "POST"));
    expect(started.closure).toMatchObject({ status: "in_progress", startedBy: expect.any(String) });
    expect((await as(admin, `/closures/${again.closure.id}/start`, "POST")).status).toBe(409);
    expect((await read<{ error: string }>(await as(me, "/me/closure", "DELETE"), 409)).error).toContain("ya inició");
    // Recording the departure completes the request and ends the access.
    const preview = await read<{ today: string }>(await as(admin, `/members/${person.id}/departure`));
    await read(await as(admin, `/members/${person.id}/departure`, "POST", { date: preview.today, reassignments: {} }));
    expect((await as(me, "/session")).status).toBe(401);
    const done = (await read<{ closures: { id: string; status: string; departedOn: string | null; completedAt: string | null }[] }>(await as(admin, "/closures"))).closures.find(item => item.id === again.closure.id)!;
    expect(done).toMatchObject({ status: "completed", departedOn: preview.today, completedAt: expect.any(String) });
    expect(await summaries(admin, person.id)).toEqual(expect.arrayContaining(["Solicitó el cierre de su cuenta", "Canceló su solicitud de cierre de cuenta"]));
    const adminEvents = (await read<{ events: { summary: string }[] }>(await as(admin, "/activity?limit=100"))).events.map(item => item.summary);
    expect(adminEvents).toEqual(expect.arrayContaining(["Inició el cierre de la cuenta de Cierre Prueba", "Completó el cierre de la cuenta de Cierre Prueba al registrar su salida"]));
    // The reason stays out of the activity.
    expect(adminEvents.join(" ")).not.toContain("Me mudo");
  });

  it("CA2 ST-159 una salida registrada sin iniciar el cierre también lo completa; la cuenta inicial no se puede cerrar", async () => {
    const person = await newEducator(admin, "salida.directa", "Salida Directa");
    const { closure } = await read<{ closure: { id: string } }>(await as(person.cookie, "/me/closure", "POST", {}), 201);
    const preview = await read<{ today: string }>(await as(admin, `/members/${person.id}/departure`));
    await read(await as(admin, `/members/${person.id}/departure`, "POST", { date: preview.today, reassignments: {} }));
    const done = (await read<{ closures: { id: string; status: string; startedAt: string | null } []}>(await as(admin, "/closures"))).closures.find(item => item.id === closure.id)!;
    expect(done).toMatchObject({ status: "completed", startedAt: null });
    expect((await as(admin, `/closures/${closure.id}/start`, "POST")).status).toBe(409);
    expect((await read<MyClosureShape>(await as(admin, "/me/closure"))).blocked).toContain("cuenta administradora inicial");
    expect((await as(admin, "/me/closure", "POST", {})).status).toBe(409);
  });
});
type MyClosureShape = { blocked: string | null };
