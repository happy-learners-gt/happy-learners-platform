import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync, spawn, type ChildProcess } from "node:child_process";
import { createServer } from "node:net";
import { once } from "node:events";
import { setTimeout as delay } from "node:timers/promises";
import { afterAll, beforeAll, expect, it } from "vitest";

let worker: ChildProcess;
let origin: string;
let logs = "";
const storage = mkdtempSync(join(tmpdir(), "hl-platform-acceptance-"));
beforeAll(async () => {
  const server = createServer();
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Missing local port");
  const port = address.port;
  await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  origin = `http://127.0.0.1:${port}`;
  worker = spawn("node_modules/.bin/wrangler", ["dev", "--local", "--config", "build/wrangler.json", "--ip", "127.0.0.1", "--port", String(port), "--inspector-port", "0", "--persist-to", storage], {
    env: { ...process.env, WRANGLER_SEND_METRICS: "false", BROWSER: "none" }, stdio: ["ignore", "pipe", "pipe"],
  });
  worker.stdout?.on("data", chunk => { logs += chunk; });
  worker.stderr?.on("data", chunk => { logs += chunk; });
  for (let attempt = 0; attempt < 200; attempt++) {
    if (worker.exitCode !== null) throw new Error(logs);
    try {
      const response = await fetch(`${origin}/api/health`, { signal: AbortSignal.timeout(500) });
      if (response.ok) return;
    } catch { /* Wait for the local runtime to start. */ }
    await delay(200);
  }
  throw new Error(`Local Worker did not start:\n${logs}`);
});
afterAll(async () => {
  if (worker && worker.exitCode === null) {
    const exited = once(worker, "exit");
    worker.kill("SIGTERM");
    await exited;
  }
  rmSync(storage, { recursive: true, force: true });
});
it("serves the health check from the built Worker", async () => {
  const response = await fetch(`${origin}/api/health`);
  expect(response.status).toBe(200);
  expect(response.headers.get("cache-control")).toBe("no-store");
  expect(await response.json()).toEqual({ status: "ok" });
});
it("serves the exact checkout SHA even for browser navigation", async () => {
  const response = await fetch(`${origin}/api/version`, { headers: { "Sec-Fetch-Mode": "navigate" } });
  expect(response.status).toBe(200);
  expect(response.headers.get("cache-control")).toBe("no-store");
  expect(await response.json()).toEqual({ sha: execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim() });
});
it("serves HTML and its built JavaScript and CSS through Static Assets", async () => {
  const response = await fetch(origin);
  expect(response.status).toBe(200);
  expect(response.headers.get("content-type")).toContain("text/html");
  const html = await response.text();
  expect(html).toContain('<html lang="es">');
  const assets = [...html.matchAll(/(?:src|href)="(\/assets\/[^\"]+)"/g)].map(match => match[1]);
  expect(assets.length).toBeGreaterThanOrEqual(2);
  for (const path of assets) {
    const asset = await fetch(origin + path);
    expect(asset.status).toBe(200);
    expect((await asset.text()).length).toBeGreaterThan(0);
  }
});
it("returns API errors without falling back to the page", async () => {
  const missing = await fetch(`${origin}/api/missing`);
  expect(missing.status).toBe(404);
  expect(await missing.json()).toEqual({ error: "Not found" });
  const method = await fetch(`${origin}/api/version`, { method: "POST" });
  expect(method.status).toBe(405);
  expect(method.headers.get("allow")).toBe("GET, HEAD");
  const head = await fetch(`${origin}/api/version`, { method: "HEAD" });
  expect(head.status).toBe(200);
  expect(await head.text()).toBe("");
});

async function login(username: string) {
  const response = await fetch(`${origin}/api/login`, { method: "POST", headers: { "Content-Type": "application/json", Origin: origin }, body: JSON.stringify({ username, password: "Aprender-2026!" }) });
  expect(response.status, response.status === 200 ? "" : (await response.text()) + logs).toBe(200);
  expect(response.headers.get("set-cookie")).toContain("HttpOnly");
  expect(response.headers.get("set-cookie")).toContain("SameSite=Strict");
  return response.headers.get("set-cookie")!.split(";")[0];
}
it("HL-9 rejects invalid credentials and revokes the server-side session on logout", async () => {
  expect((await fetch(`${origin}/api/session`)).status).toBe(401);
  const invalid = await fetch(`${origin}/api/login`, { method: "POST", headers: { "Content-Type": "application/json", Origin: origin }, body: JSON.stringify({ username: "admin-demo", password: "wrong" }) });
  expect(invalid.status).toBe(401);
  const Cookie = await login("admin-demo");
  const session = await fetch(`${origin}/api/session`, { headers: { Cookie } });
  expect((await session.json()).member.role).toBe("admin");
  expect((await fetch(`${origin}/api/logout`, { method: "POST", headers: { Cookie, Origin: origin } })).status).toBe(200);
  expect((await fetch(`${origin}/api/organization`, { headers: { Cookie } })).status).toBe(401);
});
it("HL-10 persists organization settings, validates input and restricts administration", async () => {
  const Cookie = await login("admin-demo");
  const headers = { Cookie, Origin: origin, "Content-Type": "application/json" };
  const before = await (await fetch(`${origin}/api/organization`, { headers })).json();
  const response = await fetch(`${origin}/api/organization`, { method: "PUT", headers, body: JSON.stringify({ name: "Jardín de Colores", timezone: "America/Guatemala" }) });
  expect(response.status).toBe(200);
  const second = await login("admin-demo");
  const read = await (await fetch(`${origin}/api/organization`, { headers: { Cookie: second } })).json();
  expect(read.organization).toMatchObject({ name: "Jardín de Colores", configured: true });
  expect((await fetch(`${origin}/api/organization`, { method: "PUT", headers, body: JSON.stringify({ name: "x", timezone: "UTC" }) })).status).toBe(400);
  expect((await fetch(`${origin}/api/organization`, { method: "PUT", headers: { ...headers, Origin: "https://evil.example" }, body: "{}" })).status).toBe(403);
  const instructor = await login("instructor-demo");
  expect((await fetch(`${origin}/api/organization`, { method: "PUT", headers: { ...headers, Cookie: instructor }, body: JSON.stringify({ name: "Forbidden", timezone: "America/Guatemala" }) })).status).toBe(403);
  expect(before.organization.id).toBe(read.organization.id);
});
it("HL-11 published lessons are read-only and isolated from other organizations", async () => {
  const Cookie = await login("instructor-demo");
  const data = await (await fetch(`${origin}/api/lessons`, { headers: { Cookie } })).json();
  expect(data.lessons).toHaveLength(1);
  const response = await fetch(`${origin}/api/lessons/colores-en-equipo`, { headers: { Cookie } });
  const { lesson } = await response.json();
  expect(lesson.title).toBe("Un mundo de colores");
  expect(lesson.activities).toHaveLength(3);
  expect(lesson.materials).toHaveLength(3);
  expect((await fetch(`${origin}/api/lessons/colores-en-equipo`, { method: "PUT", headers: { Cookie, Origin: origin } })).status).toBe(405);
  const outsider = await login("externo-demo");
  expect((await fetch(`${origin}/api/lessons/colores-en-equipo`, { headers: { Cookie: outsider } })).status).toBe(404);
  expect((await (await fetch(`${origin}/api/lessons`, { headers: { Cookie: outsider } })).json()).lessons).toEqual([]);
  expect((await (await fetch(`${origin}/api/organization`, { headers: { Cookie: outsider } })).json()).organization.id).toBe("org-other");
});
it("HL-14 responses expose no password data and reject oversized or malformed input", async () => {
  const Cookie = await login("instructor-demo");
  const response = await fetch(`${origin}/api/session`, { headers: { Cookie } });
  expect(await response.json()).toEqual({ member: { id: "user-1", username: "instructor-demo", role: "instructor", organizationId: "org-demo" } });
  expect(response.headers.get("referrer-policy")).toBe("no-referrer");
  for (const body of ["{", JSON.stringify({ username: "x".repeat(3000), password: "x" })]) {
    const invalid = await fetch(`${origin}/api/login`, { method: "POST", headers: { Origin: origin, "Content-Type": "application/json" }, body });
    expect(invalid.status).toBe(400);
    expect(await invalid.text()).not.toMatch(/SQL|stack|password_hash/);
  }
});
