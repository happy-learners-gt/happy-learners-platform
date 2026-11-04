import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn, type ChildProcess } from "node:child_process";
import { createServer } from "node:net";
import { once } from "node:events";
import { setTimeout as delay } from "node:timers/promises";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { acceptPending } from "./accept-pending";
import { listenOnTestPort } from "./test-port";

// ST-136 CA3: integration tokens with a scope (read only), an expiry and revocation, on the built Worker.
let worker: ChildProcess;
let origin = "";
let logs = "";
const storage = mkdtempSync(join(tmpdir(), "hl-platform-tokens-"));
beforeAll(async () => {
  const server = createServer();
  await listenOnTestPort(server);
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

const cookieOf = (response: Response) => response.headers.get("set-cookie")?.split(";")[0] || null;
const login = (username: string, password: string) => fetch(`${origin}/api/login`, { method: "POST", headers: { "Content-Type": "application/json", Origin: origin }, body: JSON.stringify({ username, password }) });
async function as(cookie: string | null, path: string, method = "GET", data?: unknown) {
  return fetch(`${origin}/api${path}`, { method, headers: { Cookie: cookie || "", Origin: origin, ...(data !== undefined ? { "Content-Type": "application/json" } : {}) }, ...(data !== undefined ? { body: JSON.stringify(data) } : {}) });
}
const bearer = (token: string, path: string, method = "GET") => fetch(`${origin}/api${path}`, { method, headers: { Authorization: `Bearer ${token}`, Origin: origin, ...(method === "GET" ? {} : { "Content-Type": "application/json" }) }, ...(method === "GET" ? {} : { body: "{}" }) });
const read = async <T = Record<string, unknown>>(response: Response, status = 200) => { const text = await response.text(); expect(response.status, text).toBe(status); return JSON.parse(text) as T; };
const password = "Una frase para recordar 2026";

describe("ST-136 integration tokens on the built Worker", () => {
  let admin: string | null = null;
  beforeAll(async () => { admin = cookieOf(await login("admin-demo", "Aprender-2026!")); expect(admin).toBeTruthy(); });

  it("CA3 a read-only token with an expiry: it reads, never writes or opens the account, security or people; revoked, it stops", async () => {
    const created = await read<{ member: { id: string }; temporaryPassword: string }>(await as(admin, "/members", "POST", { displayName: "Persona Integración", username: "token-ana", role: "educator" }), 201);
    const cookie = cookieOf(await login("token-ana", created.temporaryPassword));
    await read(await as(cookie, "/account/password", "POST", { currentPassword: created.temporaryPassword, newPassword: password }));
    await acceptPending(origin, cookie, "Persona Integración", password);
    for (const bad of [{ name: "x", days: 30 }, { name: "Tablero", days: 0 }, { name: "Tablero", days: 91 }, { name: "Tablero", days: 1.5 }]) expect((await as(cookie, "/me/tokens", "POST", bad)).status, JSON.stringify(bad)).toBe(400);
    const issued = await read<{ token: string; id: string; scope: string; expiresAt: string }>(await as(cookie, "/me/tokens", "POST", { name: "Tablero de asistencia", days: 30 }), 201);
    expect(issued.token).toMatch(/^hlt_d_[a-f0-9]{64}$/);
    expect(issued.scope).toBe("read");
    expect(Date.parse(issued.expiresAt) - Date.now()).toBeGreaterThan(29 * 86400000);
    // It reads what the person reads.
    expect((await bearer(issued.token, "/courses")).status).toBe(200);
    expect((await bearer(issued.token, "/agenda")).status).not.toBe(401);
    // Never writes, and never opens the account, the security, the people or the backup.
    for (const [path, method] of [["/courses", "POST"], ["/me/account", "GET"], ["/me/tokens", "GET"], ["/security/events", "GET"], ["/members", "GET"], ["/organization/backup", "GET"], ["/session", "GET"]])
      expect((await read<{ code: string }>(await bearer(issued.token, path, method), 403)).code, `${method} ${path}`).toBe("TOKEN_SCOPE");
    expect((await bearer(`hlt_d_${"0".repeat(64)}`, "/courses")).status).toBe(401);
    // Only its hash is kept: it is not in the list nor in the copy of the person's data.
    const listed = await read<{ tokens: { id: string; status: string; lastUsedAt: string | null }[] }>(await as(cookie, "/me/tokens"));
    expect(listed.tokens[0]).toMatchObject({ id: issued.id, status: "active" });
    expect(listed.tokens[0].lastUsedAt).toBeTruthy();
    expect(JSON.stringify(listed) + await (await as(cookie, "/me/export")).text()).not.toContain(issued.token.slice(6));
    // Administration sees it and can revoke it; its owner too.
    const all = await read<{ tokens: { id: string; owner: string }[] }>(await as(admin, "/security/tokens"));
    expect(all.tokens.find(item => item.id === issued.id)?.owner).toBe("Persona Integración");
    expect((await as(cookie, "/security/tokens")).status).toBe(403);
    await read(await as(admin, `/security/tokens/${issued.id}`, "DELETE"));
    expect((await bearer(issued.token, "/courses")).status).toBe(401);
    expect((await as(cookie, `/me/tokens/${issued.id}`, "DELETE")).status).toBe(404);
    const second = await read<{ token: string; id: string }>(await as(cookie, "/me/tokens", "POST", { name: "Otro tablero", days: 7 }), 201);
    await read(await as(cookie, `/me/tokens/${second.id}`, "DELETE"));
    expect((await bearer(second.token, "/courses")).status).toBe(401);
    // Each step is in the security log.
    const events = (await read<{ events: { type: string }[] }>(await as(admin, `/security/events?limite=100&persona=${created.member.id}`))).events.map(item => item.type);
    for (const type of ["token_created", "token_used", "token_revoked"]) expect(events, type).toContain(type);
  });
});
