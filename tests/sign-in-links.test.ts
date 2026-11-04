import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn, type ChildProcess } from "node:child_process";
import { createServer, type Server } from "node:net";
import { createServer as createHttpServer } from "node:http";
import { createHash } from "node:crypto";
import { once } from "node:events";
import { setTimeout as delay } from "node:timers/promises";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { accessPolicyInput, defaultAccessPolicy, identifierInput, passwordMessage, passwordProblem } from "../packages/domain/src/index";
import { acceptPending } from "./accept-pending";
import { listenOnTestPort } from "./test-port";

// ST-134 (recover the password, password policies, temporary lock) and ST-130 (sign in with a link sent by e-mail).
// Domain rules, then the built Worker with a stand-in for Brevo and for Have I Been Pwned on this machine: the links
// that leave by e-mail are read from what the stand-in received.
describe("ST-134 password policy rules", () => {
  it("CA2 a minimum length from the policy, never under 12; the most common passwords are refused", () => {
    expect(passwordProblem("una frase larga", "ana", { minPasswordLength: 12 })).toBeNull();
    expect(passwordProblem("una frase larga", "ana", { minPasswordLength: 20 })).toBe("length");
    expect(passwordProblem("corta", "ana", { minPasswordLength: 6 })).toBe("length");
    expect(passwordProblem("x".repeat(129), "ana", { minPasswordLength: 12 })).toBe("length");
    expect(passwordProblem("ana.gomez-frase-2026", "ana.gomez", { minPasswordLength: 12 })).toBe("weak");
    for (const common of ["Password1234", "contraseña123", "123456789012", "HappyLearners2026", "qwertyuiop12"]) expect(passwordProblem(common, "ana", { minPasswordLength: 12 }), common).not.toBeNull();
    expect(passwordMessage("breached", 12)).toMatch(/filtraciones/);
  });
  it("the policy is saved only within its limits", () => {
    const base = { ...defaultAccessPolicy, version: 0 };
    expect(accessPolicyInput(base)).toMatchObject({ minPasswordLength: 12, sessionHours: 8, linkSignIn: true });
    for (const change of [{ minPasswordLength: 11 }, { minPasswordLength: 65 }, { sessionHours: 0 }, { sessionHours: 13 }, { linkSignIn: "sí" }, { version: 1.5 }]) expect(accessPolicyInput({ ...base, ...change }), JSON.stringify(change)).toBeNull();
  });
  it("ST-130 a username or a sign-in e-mail", () => {
    expect(identifierInput({ identifier: " Ana.Gomez " })).toEqual({ username: "ana.gomez" });
    expect(identifierInput({ identifier: "Ana@Ejemplo.ORG" })).toEqual({ email: "ana@ejemplo.org" });
    for (const identifier of ["", "ab", "sin arroba", "a@b", 42, "x".repeat(255)]) expect(identifierInput({ identifier }), String(identifier)).toBeNull();
  });
});

const breachedPassword = "Una contraseña filtrada en 2026";
const mails: { to: string; subject: string; text: string }[] = [];
let worker: ChildProcess;
let origin = "";
let logs = "";
const storage = mkdtempSync(join(tmpdir(), "hl-platform-links-"));
const servers: { close(): void }[] = [];
async function freePort() {
  const server: Server = createServer();
  await listenOnTestPort(server);
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Missing local port");
  await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  return address.port;
}
beforeAll(async () => {
  // A stand-in for Brevo: keeps each message. And for the range API of Have I Been Pwned: one breached password.
  const mail = createHttpServer((request, response) => {
    let body = ""; request.on("data", chunk => { body += chunk; });
    request.on("end", () => { const value = JSON.parse(body); mails.push({ to: value.to[0].email, subject: value.subject, text: value.textContent }); response.writeHead(201, { "Content-Type": "application/json" }).end(JSON.stringify({ messageId: `m-${mails.length}` })); });
  });
  const sha1 = createHash("sha1").update(breachedPassword).digest("hex").toUpperCase();
  const pwned = createHttpServer((request, response) => {
    const prefix = request.url?.split("/").pop() || "";
    response.writeHead(200, { "Content-Type": "text/plain" }).end(prefix === sha1.slice(0, 5) ? `0000000000000000000000000000000000A:0\r\n${sha1.slice(5)}:42\r\n` : "0000000000000000000000000000000000B:3\r\n");
  });
  const mailPort = await freePort(), pwnedPort = await freePort(), port = await freePort();
  mail.listen(mailPort, "127.0.0.1"); pwned.listen(pwnedPort, "127.0.0.1");
  await Promise.all([once(mail, "listening"), once(pwned, "listening")]);
  servers.push(mail, pwned);
  origin = `http://127.0.0.1:${port}`;
  worker = spawn("node_modules/.bin/wrangler", ["dev", "--local", "--config", "build/wrangler.json", "--ip", "127.0.0.1", "--port", String(port), "--inspector-port", "0", "--persist-to", storage,
    "--var", "BREVO_API_KEY:clave-de-prueba", "--var", "MAIL_FROM:avisos@ejemplo.org", "--var", `MAIL_API_URL:http://127.0.0.1:${mailPort}/v3/smtp/email`, "--var", `PWNED_PASSWORDS_URL:http://127.0.0.1:${pwnedPort}/range/`], {
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
  for (const server of servers) server.close();
  rmSync(storage, { recursive: true, force: true });
});

async function signIn(username: string, password = "Aprender-2026!") {
  const response = await fetch(`${origin}/api/login`, { method: "POST", headers: { "Content-Type": "application/json", Origin: origin }, body: JSON.stringify({ username, password }) });
  return response.status === 200 ? response.headers.get("set-cookie")!.split(";")[0] : null;
}
async function as(cookie: string | null, path: string, method = "GET", data?: unknown) {
  return fetch(`${origin}/api${path}`, { method, headers: { Cookie: cookie || "", Origin: origin, ...(data !== undefined ? { "Content-Type": "application/json" } : {}) }, ...(data !== undefined ? { body: JSON.stringify(data) } : {}) });
}
const read = async <T = Record<string, unknown>>(response: Response, status = 200) => { const text = await response.text(); expect(response.status, text).toBe(status); return JSON.parse(text) as T; };
/** The newest message to an address, after the Worker sent it (it leaves after the response). */
async function mailTo(address: string, after: number) {
  for (let attempt = 0; attempt < 50; attempt++) {
    const found = mails.slice(after).reverse().find(item => item.to === address);
    if (found) return found;
    await delay(100);
  }
  throw new Error(`No message to ${address}`);
}
const linkIn = (text: string, page: string) => new RegExp(`/${page}/([a-z]_[a-f0-9]{64})`).exec(text)![1];
/** A new educator with a confirmed sign-in e-mail. */
async function person(admin: string | null, username: string, email: string) {
  const created = await read<{ member: { id: string }; temporaryPassword: string }>(await as(admin, "/members", "POST", { displayName: `Persona ${username}`, username, role: "educator" }), 201);
  const cookie = await signIn(username, created.temporaryPassword);
  const password = "Una frase para recordar 2026";
  await read(await as(cookie, "/account/password", "POST", { currentPassword: created.temporaryPassword, newPassword: password }));
  await acceptPending(origin, cookie, `Persona ${username}`, password);
  const before = mails.length;
  await read(await as(cookie, "/me/account/email", "POST", { email, currentPassword: password }), 201);
  const token = linkIn((await mailTo(email, before)).text, "cuenta/correo");
  await read(await as(null, `/account/email/${token}`, "POST"));
  return { id: created.member.id, cookie, password };
}
const log = async (admin: string | null, query: string) => (await read<{ events: { type: string; outcome: string; method: string | null }[] }>(await as(admin, `/security/events?limite=100${query}`))).events;

describe("ST-134 ST-130 on the built Worker", () => {
  let admin: string | null = null;
  beforeAll(async () => { admin = await signIn("admin-demo"); expect(admin).toBeTruthy(); });

  it("ST-134 CA1 a single-use recovery link by e-mail; CA2 short, common and breached passwords are refused; every session closes", async () => {
    const ana = await person(admin, "recupera-ana", "ana@ejemplo.org");
    const before = mails.length;
    const asked = await read<{ message: string }>(await as(null, "/account/recovery", "POST", { identifier: "recupera-ana" }));
    const message = await mailTo("ana@ejemplo.org", before);
    expect(message.subject).toMatch(/^Recupera tu contraseña/);
    const token = linkIn(message.text, "recuperar");
    // Opening the link changes nothing.
    const preview = await read<{ recovery: { username: string; minimum: number } }>(await as(null, `/account/recovery/${token}`));
    expect(preview.recovery).toMatchObject({ username: "recupera-ana", minimum: 12 });
    expect((await as(null, `/account/recovery/${token}`)).status).toBe(200);
    for (const [password, pattern] of [["corta", /12 a 128/], ["Password12345", /más usadas/], [breachedPassword, /filtraciones/]] as const)
      expect((await read<{ error: string }>(await as(null, `/account/recovery/${token}`, "POST", { password }), 400)).error).toMatch(pattern);
    const beforeChange = mails.length;
    await read(await as(null, `/account/recovery/${token}`, "POST", { password: "Otra frase que sí recuerdo" }));
    // The new password is announced to its owner.
    expect((await mailTo("ana@ejemplo.org", beforeChange)).subject).toMatch(/^Tu contraseña cambió/);
    expect((await as(ana.cookie, "/session")).status).toBe(401);
    expect(await signIn("recupera-ana", ana.password)).toBeNull();
    expect(await signIn("recupera-ana", "Otra frase que sí recuerdo")).toBeTruthy();
    expect((await read<{ code: string }>(await as(null, `/account/recovery/${token}`, "POST", { password: "Una tercera frase distinta" }), 410)).code).toBe("LINK_USED");
    // CA2: the same answer for an account that does not exist, and no message.
    const count = mails.length;
    expect((await read<{ message: string }>(await as(null, "/account/recovery", "POST", { identifier: "nadie@ejemplo.org" }))).message).toBe(asked.message);
    await delay(300);
    expect(mails.length).toBe(count);
    expect((await log(admin, `&persona=${ana.id}`)).map(item => `${item.type}:${item.outcome}`)).toEqual(expect.arrayContaining(["password_recovery_requested:info", "password_recovered:succeeded"]));
  });

  it("ST-134 CA3 recovering the password lifts the temporary lock", async () => {
    await person(admin, "recupera-bloqueo", "bloqueo@ejemplo.org");
    for (let attempt = 0; attempt < 10; attempt++) expect(await signIn("recupera-bloqueo", `clave-${attempt}`)).toBeNull();
    expect(await signIn("recupera-bloqueo", "Una frase para recordar 2026")).toBeNull();
    const before = mails.length;
    await read(await as(null, "/account/recovery", "POST", { identifier: "bloqueo@ejemplo.org" }));
    const token = linkIn((await mailTo("bloqueo@ejemplo.org", before)).text, "recuperar");
    await read(await as(null, `/account/recovery/${token}`, "POST", { password: "Mi frase nueva y segura" }));
    expect(await signIn("recupera-bloqueo", "Mi frase nueva y segura")).toBeTruthy();
  });

  it("ST-130 CA1–CA3 a single-use link signs in once; only the newest works; the use is logged", async () => {
    const luis = await person(admin, "enlace-luis", "luis@ejemplo.org");
    let before = mails.length;
    await read(await as(null, "/login/link", "POST", { identifier: "luis@ejemplo.org" }));
    const first = linkIn((await mailTo("luis@ejemplo.org", before)).text, "entrar");
    before = mails.length;
    await read(await as(null, "/login/link", "POST", { identifier: "enlace-luis" }));
    const message = await mailTo("luis@ejemplo.org", before);
    expect(message.subject).toMatch(/^Tu enlace para entrar/);
    const token = linkIn(message.text, "entrar");
    expect((await read<{ code: string }>(await as(null, `/login/link/${first}`, "POST"), 410)).code).toBe("LINK_USED");
    expect((await read<{ link: { username: string } }>(await as(null, `/login/link/${token}`))).link.username).toBe("enlace-luis");
    const opened = await as(null, `/login/link/${token}`, "POST");
    expect(opened.status).toBe(200);
    const cookie = opened.headers.get("set-cookie")!.split(";")[0];
    expect((await read<{ member: { username: string } }>(await as(cookie, "/session"))).member.username).toBe("enlace-luis");
    const sessions = await read<{ sessions: { method: string; current: boolean }[] }>(await as(cookie, "/me/account/sessions"));
    expect(sessions.sessions.find(item => item.current)?.method).toBe("link");
    expect((await as(null, `/login/link/${token}`, "POST")).status).toBe(410);
    expect((await log(admin, `&persona=${luis.id}&tipo=sign_in`)).some(item => item.method === "link" && item.outcome === "succeeded")).toBe(true);
    // An account without a confirmed e-mail gets the same answer and no message.
    await read(await as(admin, "/members", "POST", { displayName: "Persona sin correo", username: "enlace-sin-correo", role: "educator" }), 201);
    const count = mails.length;
    await read(await as(null, "/login/link", "POST", { identifier: "enlace-sin-correo" }));
    await delay(300);
    expect(mails.length).toBe(count);
  });

  it("ST-134 policies: administration sets them, they apply, educators cannot change them, and each change is logged", async () => {
    const educator = await person(admin, "politica-eva", "eva@ejemplo.org");
    expect((await as(educator.cookie, "/security/policy")).status).toBe(403);
    expect((await as(null, "/security/policy")).status).toBe(401);
    const { policy } = await read<{ policy: typeof defaultAccessPolicy }>(await as(admin, "/security/policy"));
    expect(policy).toMatchObject({ minPasswordLength: 12, breachedCheck: true, sessionHours: 8, linkSignIn: true });
    const saved = await read<{ policy: typeof defaultAccessPolicy; changed: boolean }>(await as(admin, "/security/policy", "PUT", { ...policy, minPasswordLength: 20, sessionHours: 2, linkSignIn: false }));
    expect(saved).toMatchObject({ changed: true, policy: { minPasswordLength: 20, sessionHours: 2, linkSignIn: false, version: policy.version + 1 } });
    expect((await as(admin, "/security/policy", "PUT", { ...policy, minPasswordLength: 13 })).status).toBe(409);
    // A shorter password than the policy is refused when changing it; the session lasts 2 hours.
    expect((await read<{ error: string }>(await as(educator.cookie, "/account/password", "POST", { currentPassword: educator.password, newPassword: "Quince letras!!" }), 400)).error).toMatch(/20 a 128/);
    const login = await fetch(`${origin}/api/login`, { method: "POST", headers: { "Content-Type": "application/json", Origin: origin }, body: JSON.stringify({ username: "politica-eva", password: educator.password }) });
    expect(login.headers.get("set-cookie")).toMatch(/Max-Age=7200/);
    // The link sign-in is off: no message, and a link sent before no longer works.
    const count = mails.length;
    await read(await as(null, "/login/link", "POST", { identifier: "eva@ejemplo.org" }));
    await delay(300);
    expect(mails.length).toBe(count);
    expect((await log(admin, "&tipo=policy_changed"))[0]).toMatchObject({ outcome: "info" });
    await read(await as(admin, "/security/policy", "PUT", { ...saved.policy, minPasswordLength: 12, sessionHours: 8, linkSignIn: true }));
  });

  it("ST-130 at most 10 requests per address every 15 minutes", async () => {
    let status = 200;
    for (let attempt = 0; attempt < 12 && status === 200; attempt++) status = (await as(null, "/login/link", "POST", { identifier: `alguien-${attempt}` })).status;
    expect(status).toBe(429);
  });
});
