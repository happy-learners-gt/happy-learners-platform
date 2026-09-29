import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync, spawn, type ChildProcess } from "node:child_process";
import { createServer } from "node:net";
import { once } from "node:events";
import { setTimeout as delay } from "node:timers/promises";
import { afterAll, beforeAll, expect, it } from "vitest";
import type { Lesson, Resource } from "../packages/contracts/src/index";

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
  expect(data.lessons.map((l: { id: string }) => l.id)).toContain("colores-en-equipo");
  const response = await fetch(`${origin}/api/lessons/colores-en-equipo`, { headers: { Cookie } });
  const { lesson } = await response.json();
  expect(lesson.title).toBe("Un mundo de colores");
  expect(lesson.activities).toHaveLength(3);
  expect(lesson.materials).toHaveLength(3);
  expect((await fetch(`${origin}/api/lessons/colores-en-equipo`, { method: "PUT", headers: { Cookie, Origin: origin, "Content-Type": "application/json" }, body: "{}" })).status).toBe(400);
  const outsider = await login("externo-demo");
  expect((await fetch(`${origin}/api/lessons/colores-en-equipo`, { headers: { Cookie: outsider } })).status).toBe(404);
  expect((await (await fetch(`${origin}/api/lessons`, { headers: { Cookie: outsider } })).json()).lessons).toEqual([]);
  expect((await (await fetch(`${origin}/api/organization`, { headers: { Cookie: outsider } })).json()).organization.id).toBe("org-other");
});
it("HL-14 responses expose no password data and reject oversized or malformed input", async () => {
  const Cookie = await login("instructor-demo");
  const response = await fetch(`${origin}/api/session`, { headers: { Cookie } });
  expect(await response.json()).toEqual({ member: { id: "user-1", username: "instructor-demo", role: "educator", organizationId: "org-demo" } });
  expect(response.headers.get("referrer-policy")).toBe("no-referrer");
  for (const body of ["{", JSON.stringify({ username: "x".repeat(3000), password: "x" })]) {
    const invalid = await fetch(`${origin}/api/login`, { method: "POST", headers: { Origin: origin, "Content-Type": "application/json" }, body });
    expect(invalid.status).toBe(400);
    expect(await invalid.text()).not.toMatch(/SQL|stack|password_hash/);
  }
});

async function requestAs(cookie: string, path: string, method = "GET", data?: unknown) {
  return fetch(origin + "/api" + path, { method, headers: { Cookie: cookie, Origin: origin, ...(data ? { "Content-Type": "application/json" } : {}) }, ...(data ? { body: JSON.stringify(data) } : {}) });
}
it("HL-19 roles are enforced and changing a role revokes sessions", async () => {
  const admin = await login("admin-demo"); const educator = await login("educador-demo");
  expect((await requestAs(educator, "/members")).status).toBe(403);
  expect((await requestAs(admin, "/levels", "POST", { name: "Blocked", description: "Forbidden" })).status).toBe(403);
  expect((await requestAs("", "/curriculum")).status).toBe(401);
  expect((await requestAs(admin, "/members/user-educator", "PUT", { role: "admin", active: true })).status).toBe(200);
  expect((await requestAs(educator, "/session")).status).toBe(401);
  expect((await (await requestAs(await login("educador-demo"), "/session")).json()).member.role).toBe("admin");
  expect((await requestAs(admin, "/members/user-educator", "PUT", { role: "educator", active: true })).status).toBe(200);
  expect((await requestAs(admin, "/members/user-0", "PUT", { role: "educator", active: false })).status).toBe(409);
});

it("HL-20 HL-22 HL-24 curriculum persists, rejects orphans and validates exact ordering", async () => {
  const educator = await login("educador-demo");
  const created = await requestAs(educator, "/levels", "POST", { name: "Elementary", description: "Next steps", status: "draft" });
  expect(created.status).toBe(201); const level = (await created.json()).id;
  expect((await requestAs(educator, `/levels/${level}`, "PUT", { name: "Elementary revised", description: "Next steps", status: "active" })).status).toBe(200);
  const unit = await requestAs(educator, "/units", "POST", { levelId: level, name: "Colors", objective: "Name colors" }); expect(unit.status).toBe(201);
  const uid = (await unit.json()).id;
  expect((await requestAs(educator, "/units", "POST", { levelId: "not-real", name: "Orphan", objective: "Blocked" })).status).toBe(400);
  expect((await requestAs(educator, "/levels/order", "PUT", { ids: [level, level] })).status).toBe(400);
  const original = (await (await requestAs(educator, "/curriculum")).json()).levels.map((l: { id: string }) => l.id).reverse();
  expect((await requestAs(educator, "/levels/order", "PUT", { ids: original })).status).toBe(200);
  const after = await (await requestAs(await login("educador-demo"), "/curriculum")).json();
  expect(after.levels.map((l: { id: string }) => l.id)).toEqual(original);
  expect(after.levels.map((l: { position: number }) => l.position)).toEqual([0, 1]);
  expect((await requestAs(educator, `/units/${uid}`, "PUT", { levelId: level, name: "Colors edited", objective: "Name colors", status: "archived" })).status).toBe(200);
  expect((await requestAs(educator, `/levels/${level}`, "PUT", { name: "Elementary revised", description: "Archived", status: "archived" })).status).toBe(200);
});

it("HL-23–29 editing, republication, ordered activities, links, archive and aggregate completion", async () => {
  const educator = await login("educador-demo");
  const value = { title: "Hello test", description: "Synthetic", level: "Beginner", skill: "lectura", topic: "Greetings", tags: ["demo"], content: "Hello, friend!", kind: "text", status: "draft" };
  const made = await requestAs(educator, "/resources", "POST", value); expect(made.status).toBe(201); const resource: Resource = (await made.json()).resource;
  expect((await requestAs(educator, `/resources/${resource.id}`, "PUT", { ...value, title: "Edited greeting" })).status).toBe(200);
  expect((await requestAs(educator, "/resources", "POST", { ...value, kind: "link", content: "javascript:alert(1)" })).status).toBe(400);
  expect((await requestAs(educator, "/resources", "POST", { ...value, kind: "link", content: "https://example.org/english" })).status).toBe(201);
  const data = { title: "Acceptance lesson", objective: "Greet", instructions: "Say hello", unitId: "unit-org-demo", activities: [
    { id: "a", type: "text", position: 0, title: "Listen", instructions: "Say hello", minutes: 5 },
    { id: "b", type: "resource", position: 1, title: "Read", instructions: "Read the greeting", minutes: 5, resourceId: resource.id },
    { id: "c", type: "question", position: 2, title: "Choose", instructions: "Select the greeting", minutes: 5, options: ["Hello", "Goodbye"], answer: 0 },
  ] };
  const draft = await requestAs(educator, "/lessons", "POST", data); expect(draft.status).toBe(201); let lesson: Lesson = (await draft.json()).lesson;
  expect(lesson.status).toBe("draft"); expect((await requestAs("", `/share/${lesson.shareCode}`)).status).toBe(404);
  expect((await requestAs(educator, `/lessons/${lesson.id}/publish`, "POST")).status).toBe(200);
  const publicBefore = await (await requestAs("", `/share/${lesson.shareCode}`)).json(); expect(publicBefore.lesson.resources[0].title).toBe("Edited greeting");
  const reordered = [data.activities[2], data.activities[0], data.activities[1]].map((a, i) => ({ ...a, position: i }));
  const edited = await requestAs(educator, `/lessons/${lesson.id}`, "PUT", { ...data, title: "New revision", activities: reordered, draftVersion: lesson.draftVersion });
  expect(edited.status).toBe(200); lesson = (await edited.json()).lesson;
  expect((await (await requestAs("", `/share/${lesson.shareCode}`)).json()).lesson.title).toBe("Acceptance lesson");
  expect((await requestAs(educator, `/lessons/${lesson.id}`, "PUT", { ...data, draftVersion: 0 })).status).toBe(409);
  expect((await requestAs(educator, `/lessons/${lesson.id}`, "PUT", { ...data, activities: [{ ...data.activities[0], position: 2 }], draftVersion: lesson.draftVersion })).status).toBe(400);
  expect((await requestAs(educator, `/lessons/${lesson.id}/publish`, "POST")).status).toBe(200);
  const publicAfter = (await (await requestAs("", `/share/${lesson.shareCode}`)).json()).lesson;
  expect(publicAfter.revision).toBe(2); expect(publicAfter.title).toBe("New revision"); expect(publicAfter.activities.map((a: { id: string }) => a.id)).toEqual(["c", "a", "b"]);
  const shortened = reordered.slice(1).map((a, i) => ({ ...a, position: i, title: a.id === "a" ? "Edited instruction" : a.title }));
  expect((await requestAs(educator, `/lessons/${lesson.id}`, "PUT", { ...data, activities: shortened, draftVersion: lesson.draftVersion })).status).toBe(200);
  expect((await (await requestAs("", `/share/${lesson.shareCode}`)).json()).lesson.activities).toHaveLength(3);
  expect((await requestAs(educator, `/resources/${resource.id}`, "DELETE")).status).toBe(409);
  expect((await requestAs(educator, `/resources/${resource.id}`, "PUT", { ...value, status: "archived" })).status).toBe(200);
  expect((await (await requestAs("", `/share/${lesson.shareCode}`)).json()).lesson.resources[0].title).toBe("Edited greeting");
  const completion = await requestAs("", `/share/${lesson.shareCode}/complete`, "POST"); expect(completion.status).toBe(200);
  const cookie = completion.headers.get("set-cookie")!.split(";")[0];
  await requestAs(cookie, `/share/${lesson.shareCode}/complete`, "POST");
  const persisted = (await (await requestAs(await login("educador-demo"), `/lessons/${lesson.id}?draft=1`)).json()).lesson;
  expect(persisted.completions).toBe(1); expect(persisted.activities.map((a: { position: number }) => a.position)).toEqual([0, 1]);
  expect(persisted.activities[0].title).toBe("Edited instruction");
  const outsider = await login("externo-demo");
  expect((await requestAs(outsider, `/lessons/${lesson.id}?draft=1`)).status).toBe(404);
  expect((await requestAs(outsider, `/resources/${resource.id}`, "PUT", value)).status).toBe(404);
  const crossed = await requestAs(outsider, "/lessons", "POST", { ...data, unitId: "unit-org-other" }); expect(crossed.status).toBe(400);
});
