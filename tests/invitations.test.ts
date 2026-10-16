import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn, type ChildProcess } from "node:child_process";
import { createServer } from "node:net";
import { once } from "node:events";
import { setTimeout as delay } from "node:timers/promises";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { dailyMailCap, invitationInput, invitationMessage, invitationState, mailDecision, normalizeEmail } from "../packages/domain/src/index";
import type { MailMessage, MailResult, MailSender } from "../packages/domain/src/index";
import { attempt, BrevoMailSender, brevoEndpoint, deliver, DisabledMailSender, mailSender, sanitize } from "../apps/api/src/mail";
import type { OutboxStore } from "../apps/api/src/mail";

// ST-121 (HL-167): invitations by e-mail (DEC-042). Domain and adapters first, then the built Worker on a fresh store.
const details = { organization: "Colegio Ficticio", displayName: "Paula <Gómez>", role: "educator" as const, inviter: "Marta Ruiz", link: "https://example.test/invitacion/d_" + "a".repeat(64), expiresAt: "2026-10-22T18:00:00.000Z", timezone: "America/Guatemala" };
const sample: MailMessage = { to: "paula@example.test", subject: "Te invitaron a Happy Learners", text: "texto", html: "<p>html</p>" };

describe("HL-167 invitation rules and message", () => {
  it("CA1 accepts a valid e-mail, name and role, lowercasing the address", () => {
    expect(invitationInput({ email: "  Paula.Gomez@Example.TEST ", displayName: "  Paula   Gómez ", role: "educator" })).toEqual({ email: "paula.gomez@example.test", displayName: "Paula Gómez", role: "educator" });
    for (const value of [null, {}, { email: "no-es-correo", displayName: "Paula", role: "educator" }, { email: "a@b", displayName: "Paula", role: "educator" },
      { email: "paula@example.test", displayName: "P", role: "educator" }, { email: "paula@example.test", displayName: "<b>P</b>", role: "educator" },
      { email: "paula@example.test", displayName: "Paula", role: "student" }, { email: `${"x".repeat(250)}@example.test`, displayName: "Paula", role: "admin" }]) expect(invitationInput(value)).toBeNull();
    expect(normalizeEmail("a..b@example.test")).toBeNull();
  });
  it("CA1 the message names the organization, role, inviter, link and expiry, and escapes HTML", () => {
    const message = invitationMessage("paula@example.test", details);
    expect(message.subject).toBe("Te invitaron a Happy Learners");
    expect(message.to).toBe("paula@example.test");
    for (const part of ["Colegio Ficticio", "Educador", "Marta Ruiz", details.link, "22 de octubre de 2026", "ignora este correo"]) {
      expect(message.text, part).toContain(part); expect(message.html, part).toContain(part);
    }
    expect(message.html).toContain("Paula &lt;Gómez&gt;"); expect(message.html).not.toContain("<Gómez>");
  });
  it("CA2 a pending invitation expires at its time; used and revoked ones stay as they are", () => {
    expect(invitationState("pending", "2026-10-22T00:00:00.000Z", "2026-10-21T23:59:59.999Z")).toBe("pending");
    expect(invitationState("pending", "2026-10-22T00:00:00.000Z", "2026-10-22T00:00:00.000Z")).toBe("expired");
    expect(invitationState("accepted", "2026-10-22T00:00:00.000Z", "2026-10-01T00:00:00.000Z")).toBe("accepted");
    expect(invitationState("revoked", "2026-10-22T00:00:00.000Z", "2026-10-01T00:00:00.000Z")).toBe("revoked");
  });
  it("CA1 DEC-042 the daily cap stays below the provider's 300 and defers the rest; no provider means not configured", () => {
    expect(dailyMailCap).toBeLessThan(300);
    expect(mailDecision(true, 0)).toBe("send");
    expect(mailDecision(true, dailyMailCap - 1)).toBe("send");
    expect(mailDecision(true, dailyMailCap)).toBe("deferred");
    expect(mailDecision(false, 0)).toBe("not_configured");
  });
});

describe("HL-167 mail adapters", () => {
  const key = "xkeysib-0123456789abcdef-SECRET";
  it("CA1 Brevo receives the api-key header, the Happy Learners sender and both bodies", async () => {
    const fetcher = vi.fn(async () => Response.json({ messageId: "<id@brevo>" }, { status: 201 }));
    const result = await new BrevoMailSender(key, "avisos@example.test", fetcher as unknown as typeof fetch).send(sample);
    expect(result).toEqual({ ok: true, id: "<id@brevo>" });
    const [url, init] = fetcher.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(brevoEndpoint); expect(url).toBe("https://api.brevo.com/v3/smtp/email");
    expect(init.method).toBe("POST");
    expect((init.headers as Record<string, string>)["api-key"]).toBe(key);
    expect(JSON.parse(String(init.body))).toEqual({ sender: { name: "Happy Learners", email: "avisos@example.test" }, to: [{ email: "paula@example.test" }], subject: sample.subject, textContent: "texto", htmlContent: "<p>html</p>" });
  });
  it("CA1 non-2xx answers fail without the key or the recipient in the error; only 429/5xx are retried", async () => {
    const answer = (status: number) => vi.fn(async () => Response.json({ code: "unauthorized", message: `Key ${key} not found for paula@example.test` }, { status }));
    const unauthorized = await new BrevoMailSender(key, "avisos@example.test", answer(401) as unknown as typeof fetch).send(sample) as Extract<MailResult, { ok: false }>;
    expect(unauthorized).toMatchObject({ ok: false, retry: false });
    expect(unauthorized.error).toContain("401"); expect(unauthorized.error).not.toContain(key); expect(unauthorized.error).not.toContain("paula@example.test");
    expect(await new BrevoMailSender(key, "a@example.test", answer(503) as unknown as typeof fetch).send(sample)).toMatchObject({ ok: false, retry: true });
    const offline = await new BrevoMailSender(key, "a@example.test", (async () => { throw new TypeError(`fetch failed ${key}`); }) as unknown as typeof fetch).send(sample) as Extract<MailResult, { ok: false }>;
    expect(offline).toMatchObject({ ok: false, retry: true }); expect(offline.error).not.toContain(key);
    expect(sanitize(`x ${key} y d_${"b".repeat(64)} z paula@example.test`, [key])).not.toMatch(/xkeysib|bbbb|paula@/);
  });
  it("CA1 sends once, retries once on a temporary failure and stops on a permanent one", async () => {
    const sequence = (...results: MailResult[]): MailSender & { calls: number } => ({ configured: true, calls: 0, async send() { return results[this.calls++]; } });
    const flaky = sequence({ ok: false, retry: true, error: "503" }, { ok: true, id: "m-1" });
    expect(await attempt(flaky, sample)).toEqual({ result: { ok: true, id: "m-1" }, attempts: 2 });
    const down = sequence({ ok: false, retry: true, error: "503" }, { ok: false, retry: true, error: "503" }, { ok: true, id: "never" });
    expect((await attempt(down, sample)).attempts).toBe(2); expect(down.calls).toBe(2);
    const refused = sequence({ ok: false, retry: false, error: "400" }, { ok: true, id: "never" });
    expect((await attempt(refused, sample)).attempts).toBe(1);
  });
  it("CA1 DEC-042 the outbox records each message: deferred over the cap, sent with the provider id, never the body", async () => {
    const outbox = (sentToday: number) => {
      const writes: { sql: string; values: unknown[] }[] = [];
      const db = { prepare: (sql: string) => ({ bind: (...values: unknown[]) => ({
        first: async () => sql.includes("count(*)") ? { sent: sentToday } : null,
        run: async () => { writes.push({ sql, values }); },
      }) }) } as unknown as OutboxStore;
      return { db, writes };
    };
    const ok: MailSender = { configured: true, send: vi.fn(async () => ({ ok: true as const, id: "m-1" })) };
    const capped = outbox(dailyMailCap);
    expect(await deliver(capped.db, ok, "org-demo", "invitation", "invitation-1", sample)).toMatchObject({ status: "deferred" });
    expect(ok.send).not.toHaveBeenCalled();
    expect(capped.writes[0].values).toContain("deferred");
    const open = outbox(3);
    expect(await deliver(open.db, ok, "org-demo", "invitation", "invitation-1", sample)).toMatchObject({ status: "sent", error: null });
    expect(open.writes.map(write => write.values.find(value => ["queued", "sent"].includes(String(value))))).toEqual(["queued", "sent"]);
    expect(open.writes[1].values).toContain("m-1");
    expect(JSON.stringify(open.writes)).not.toContain(sample.html);
    const disabled = outbox(0);
    expect(await deliver(disabled.db, new DisabledMailSender(), "org-demo", "invitation", "invitation-1", sample)).toMatchObject({ status: "not_configured" });
    expect(disabled.writes[0].values).toContain("not_configured");
  });
  it("CA1 without BREVO_API_KEY and MAIL_FROM the Worker uses the disabled sender", async () => {
    expect(mailSender({})).toBeInstanceOf(DisabledMailSender);
    expect(mailSender({ BREVO_API_KEY: key })).toBeInstanceOf(DisabledMailSender);
    expect(mailSender({ BREVO_API_KEY: key, MAIL_FROM: "avisos@example.test" })).toBeInstanceOf(BrevoMailSender);
    expect(await new DisabledMailSender().send()).toMatchObject({ ok: false, retry: false });
  });
});

let worker: ChildProcess;
let origin = "";
let logs = "";
const storage = mkdtempSync(join(tmpdir(), "hl-platform-invitations-"));
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
const tokenOf = (link: string) => /\/invitacion\/([a-z]_[a-f0-9]{64})$/.exec(link)![1];
const accept = (token: string, data: unknown, headers: Record<string, string> = { Origin: origin }) =>
  fetch(`${origin}/api/invitations/accept/${token}`, { method: "POST", headers: { "Content-Type": "application/json", ...headers }, body: JSON.stringify(data) });
type Listed = { id: string; email: string; status: string; delivery: string | null; expiresAt: string };
const listed = async (cookie: string | null) => (await (await as(cookie, "/invitations")).json()).invitations as Listed[];
const summaries = async (cookie: string | null) => (await (await as(cookie, "/activity?limit=100")).json()).events.map((event: { summary: string }) => event.summary) as string[];

describe("HL-167 ST-121 invitations on the built Worker", () => {
  const links: string[] = [];
  let invitationId = "";
  it("CA1 administración envía una invitación con el rol asignado; sin proveedor queda not_configured y devuelve el enlace", async () => {
    const admin = await signIn("admin-demo");
    expect((await as(await signIn("educador-demo"), "/invitations", "POST", { email: "x@example.test", displayName: "Intrusa", role: "admin" })).status).toBe(403);
    expect((await as(await signIn("educador-demo"), "/invitations")).status).toBe(403);
    expect((await as(admin, "/invitations", "POST", { email: "no-es-correo", displayName: "Paula", role: "educator" })).status).toBe(400);
    const crossSite = await fetch(`${origin}/api/invitations`, { method: "POST", headers: { Cookie: admin!, Origin: "https://evil.example", "Content-Type": "application/json" }, body: JSON.stringify({ email: "x@example.test", displayName: "Paula", role: "educator" }) });
    expect(crossSite.status).toBe(403);
    const created = await as(admin, "/invitations", "POST", { email: "Paula.Invitada@Example.TEST", displayName: "Paula Invitada", role: "educator" });
    expect(created.status).toBe(201);
    const body = await created.json();
    expect(body.delivery).toBe("not_configured");
    expect(body.link).toMatch(new RegExp(`^${origin}/invitacion/d_[a-f0-9]{64}$`));
    expect(body.invitation).toMatchObject({ email: "paula.invitada@example.test", displayName: "Paula Invitada", role: "educator", status: "pending", delivery: "not_configured", invitedBy: expect.any(String) });
    const days = (Date.parse(body.invitation.expiresAt) - Date.now()) / 86400000;
    expect(days).toBeGreaterThan(6.9); expect(days).toBeLessThanOrEqual(7);
    invitationId = body.invitation.id; links.push(body.link);
    // One open invitation per address; the list never carries the token.
    expect((await as(admin, "/invitations", "POST", { email: "paula.invitada@example.test", displayName: "Otra", role: "admin" })).status).toBe(409);
    const text = await (await as(admin, "/invitations")).text();
    expect(text).toContain("paula.invitada@example.test"); expect(text).not.toContain(tokenOf(body.link));
    // Neither the activity nor the backup holds the link; the backup skips invitations and the outbox.
    expect(await summaries(admin)).toContain("Invitó a Paula Invitada con rol Educador");
    const backup = await (await as(admin, "/organization/backup")).text();
    expect(backup).not.toContain(tokenOf(body.link));
    const tables = JSON.parse(backup).tables;
    expect(tables.invitations).toBeUndefined(); expect(tables.mail_outbox).toBeUndefined(); expect(tables.users.columns).toContain("email");
  });

  it("CA3 reenviar rota el enlace (el anterior deja de funcionar) y revocar lo invalida", async () => {
    const admin = await signIn("admin-demo");
    const resent = await as(admin, `/invitations/${invitationId}/resend`, "POST");
    expect(resent.status).toBe(200);
    const body = await resent.json();
    expect(body.delivery).toBe("not_configured"); expect(body.link).not.toBe(links[0]);
    expect((await fetch(`${origin}/api/invitations/accept/${tokenOf(links[0])}`)).status).toBe(404);
    expect((await accept(tokenOf(links[0]), { username: "paula.vieja", password: "Una frase larga 2026" })).status).toBe(404);
    links.push(body.link);
    const preview = await fetch(`${origin}/api/invitations/accept/${tokenOf(body.link)}`);
    expect(preview.status).toBe(200);
    expect((await preview.json()).invitation).toMatchObject({ displayName: "Paula Invitada", role: "educator", email: "paula.invitada@example.test" });

    // A second invitation, revoked: its link answers 410 and it cannot be resent.
    const other = await (await as(admin, "/invitations", "POST", { email: "revocada@example.test", displayName: "Rita Revocada", role: "admin" })).json();
    expect((await as(await signIn("educador-demo"), `/invitations/${other.invitation.id}/revoke`, "POST")).status).toBe(403);
    const revoked = await as(admin, `/invitations/${other.invitation.id}/revoke`, "POST");
    expect(revoked.status).toBe(200); expect((await revoked.json()).invitation.status).toBe("revoked");
    const gone = await fetch(`${origin}/api/invitations/accept/${tokenOf(other.link)}`);
    expect(gone.status).toBe(410); expect((await gone.json()).code).toBe("INVITATION_REVOKED");
    expect((await accept(tokenOf(other.link), { username: "rita.revocada", password: "Una frase larga 2026" })).status).toBe(410);
    expect((await as(admin, `/invitations/${other.invitation.id}/resend`, "POST")).status).toBe(409);
    expect((await as(admin, "/invitations/invitation-missing/revoke", "POST")).status).toBe(404);
    expect((await listed(admin)).find(item => item.id === other.invitation.id)?.status).toBe("revoked");
  });

  it("CA2 la persona acepta desde el enlace vigente, define su contraseña y entra con sesión", async () => {
    const token = tokenOf(links[1]);
    expect((await accept(token, { username: "paula.invitada", password: "Una frase larga 2026" }, { Origin: "https://evil.example" })).status).toBe(403);
    expect((await accept(token, { username: "Con Espacios", password: "Una frase larga 2026" })).status).toBe(400);
    expect((await accept(token, { username: "paula.invitada", password: "corta" })).status).toBe(400);
    // Usernames stay unique across organizations (ST-093).
    expect((await accept(token, { username: "admin-hl", password: "Una frase larga 2026" })).status).toBe(409);
    const accepted = await accept(token, { username: "paula.invitada", password: "Una frase larga 2026" });
    expect(accepted.status).toBe(201);
    const cookie = accepted.headers.get("set-cookie")!;
    expect(cookie).toMatch(/^hl_session=d_[a-f0-9]{64}; Path=\/; HttpOnly; SameSite=Strict/);
    const session = await (await as(cookie.split(";")[0], "/session")).json();
    expect(session.member).toMatchObject({ username: "paula.invitada", displayName: "Paula Invitada", role: "educator" });
    expect(session.member.mustChangePassword).toBeUndefined();
    expect((await as(cookie.split(";")[0], "/courses")).status).toBe(200);
    expect(await signIn("paula.invitada", "Una frase larga 2026")).not.toBeNull();
    // A used link no longer works.
    const used = await fetch(`${origin}/api/invitations/accept/${token}`);
    expect(used.status).toBe(410); expect((await used.json()).code).toBe("INVITATION_USED");
    expect((await accept(token, { username: "paula.otra", password: "Una frase larga 2026" })).status).toBe(410);
    // Administration sees the address; educators' lists of people do not.
    const admin = await signIn("admin-demo");
    const members = (await (await as(admin, "/members")).json()).members as { username: string; email?: string }[];
    expect(members.find(item => item.username === "paula.invitada")?.email).toBe("paula.invitada@example.test");
    expect(await (await as(await signIn("educador-demo"), "/people")).text()).not.toContain("paula.invitada@example.test");
    expect((await as(admin, "/invitations", "POST", { email: "paula.invitada@example.test", displayName: "Paula", role: "educator" })).status).toBe(409);
    expect((await listed(admin)).find(item => item.id === invitationId)?.status).toBe("accepted");
    expect((await as(admin, `/invitations/${invitationId}/revoke`, "POST")).status).toBe(409);
  });

  it("CA2 an unknown, malformed or expired-looking link is rejected", async () => {
    expect((await fetch(`${origin}/api/invitations/accept/d_${"0".repeat(64)}`)).status).toBe(404);
    expect((await fetch(`${origin}/api/invitations/accept/not-a-token`)).status).toBe(404);
  });

  it("CA3 cada acción queda en la actividad, sin enlaces ni contraseñas", async () => {
    const admin = await signIn("admin-demo");
    const feed = await summaries(admin);
    for (const summary of ["Invitó a Paula Invitada con rol Educador", "Reenvió la invitación de Paula Invitada", "Invitó a Rita Revocada con rol Administración", "Revocó la invitación de Rita Revocada", "Aceptó la invitación y creó su cuenta (@paula.invitada) con rol Educador"])
      expect(feed).toContain(summary);
    const events = JSON.stringify(await (await as(admin, "/activity?limit=100")).json());
    // The Worker never logs a link. (The local runtime's own request log prints paths; production keeps invocation logs off.)
    const written = logs.split("\n").filter(line => !line.includes("[wrangler:info]")).join("\n");
    for (const link of links) { expect(events).not.toContain(tokenOf(link)); expect(written).not.toContain(tokenOf(link)); }
    expect(events).not.toContain("Una frase larga 2026");
    // Invitations are administration's: educators do not see them in their activity.
    expect((await summaries(await signIn("lucia.herrera"))).filter(summary => summary.includes("invitación") || summary.includes("Invitó"))).toEqual([]);
  });
});
