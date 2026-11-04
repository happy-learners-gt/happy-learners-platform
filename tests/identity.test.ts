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

// Identidad y acceso (docs/design/identidad-y-acceso.md): the confirmation window, the organization's posture with its
// recommendations, the directory and one person's picture, and access reviews, on the built Worker. The window is
// shortened to 2 seconds (CONFIRM_WINDOW_MS, accepted only by a local Worker) to see it close.
let worker: ChildProcess;
let origin = "";
let logs = "";
const storage = mkdtempSync(join(tmpdir(), "hl-platform-identity-"));
beforeAll(async () => {
  const server = createServer();
  await listenOnTestPort(server);
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Missing local port");
  await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  origin = `http://127.0.0.1:${address.port}`;
  worker = spawn("node_modules/.bin/wrangler", ["dev", "--local", "--config", "build/wrangler.json", "--ip", "127.0.0.1", "--port", String(address.port), "--inspector-port", "0", "--persist-to", storage, "--var", "CONFIRM_WINDOW_MS:2000"], {
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
const read = async <T = Record<string, unknown>>(response: Response, status = 200) => { const text = await response.text(); expect(response.status, text).toBe(status); return JSON.parse(text) as T; };
const password = "Una frase para recordar 2026";
async function person(admin: string | null, username: string, role: "educator" | "admin" = "educator") {
  const created = await read<{ member: { id: string }; temporaryPassword: string }>(await as(admin, "/members", "POST", { displayName: `Persona ${username}`, username, role }), 201);
  const cookie = cookieOf(await login(username, created.temporaryPassword));
  await read(await as(cookie, "/account/password", "POST", { currentPassword: created.temporaryPassword, newPassword: password }));
  await acceptPending(origin, cookie, `Persona ${username}`, password);
  return { id: created.member.id, cookie };
}

describe("Identidad y acceso on the built Worker", () => {
  let admin: string | null = null;
  beforeAll(async () => { admin = cookieOf(await login("admin-demo", "Aprender-2026!")); expect(admin).toBeTruthy(); });

  it("the confirmation window: right after signing in nothing is asked; once it closes, one confirmation opens it again", async () => {
    const ana = await person(admin, "identidad-ana");
    const fresh = cookieOf(await login("identidad-ana", password));
    expect((await as(fresh, "/me/mfa/setup", "POST", {})).status).toBe(200);
    await delay(2300);
    expect((await read<{ code: string }>(await as(fresh, "/me/tokens", "POST", { name: "Tablero", days: 7 }), 403)).code).toBe("REAUTH_REQUIRED");
    expect((await read<{ code: string }>(await as(fresh, "/me/confirm", "POST", { password: "otra" }), 400)).code).toBe("REAUTH_FAILED");
    await read(await as(fresh, "/me/confirm", "POST", { password }));
    expect((await as(fresh, "/me/tokens", "POST", { name: "Tablero", days: 7 })).status).toBe(201);
    // The password sent with the change itself also confirms (older screens and integrations).
    await delay(2300);
    expect((await as(fresh, "/me/tokens", "POST", { name: "Otro tablero", days: 7, currentPassword: password })).status).toBe(201);
    // Five wrong confirmations in 15 minutes stop it.
    for (let attempt = 0; attempt < 5; attempt++) await as(ana.cookie, "/me/confirm", "POST", { password: "mala" });
    expect((await as(ana.cookie, "/me/confirm", "POST", { password })).status).toBe(429);
  });

  it("the overview scores the organization and recommends what to do, with the people concerned", async () => {
    await person(admin, "identidad-jefa", "admin");
    const educator = await person(admin, "identidad-mirona");
    expect((await as(educator.cookie, "/identity/overview")).status).toBe(403);
    expect((await as(null, "/identity/overview")).status).toBe(401);
    const { score, recommendations, metrics } = await read<{ score: number; recommendations: { id: string; severity: string; people?: string[]; action: { kind: string } }[]; metrics: Record<string, number> }>(await as(admin, "/identity/overview"));
    expect(score).toBeGreaterThanOrEqual(0);
    expect(score).toBeLessThanOrEqual(100);
    expect(metrics.people).toBeGreaterThan(3);
    const ids = recommendations.map(item => item.id);
    expect(ids).toEqual(expect.arrayContaining(["require-mfa-admin", "admins-without-mfa", "review-due", "adopt-passkeys"]));
    expect(recommendations.find(item => item.id === "admins-without-mfa")?.people).toContain("Persona identidad-jefa");
    expect(recommendations[0].severity).toBe("high");
    // Requiring it for administration needs one's own second factor first, or one would be locked out.
    const { policy } = await read<{ policy: Record<string, unknown> }>(await as(admin, "/security/policy"));
    expect((await read<{ code: string }>(await as(admin, "/security/policy", "PUT", { ...policy, mfaAdmin: true }), 409)).code).toBe("SELF_MFA_FIRST");
    // Requiring it for educators raises the score.
    await read(await as(admin, "/security/policy", "PUT", { ...policy, mfaEducator: true }));
    const after = await read<{ score: number; recommendations: { id: string }[] }>(await as(admin, "/identity/overview"));
    expect(after.score).toBeGreaterThan(score);
    await read(await as(admin, "/security/policy", "PUT", { ...policy, version: (policy.version as number) + 1, mfaEducator: false }));
  });

  it("the directory shows each person's methods and risks; one person's picture has their sessions and security activity", async () => {
    const leo = await person(admin, "identidad-leo");
    const { people } = await read<{ people: { id: string; strength: string; methods: { mfa: boolean; passkeys: number }; risks: string[]; sessions: number }[] }>(await as(admin, "/identity/people"));
    const row = people.find(item => item.id === leo.id)!;
    expect(row).toMatchObject({ strength: "password", methods: { mfa: false, passkeys: 0 }, sessions: 1 });
    const detail = await read<{ person: { name: string; sessions: { device: string }[]; events: { type: string }[]; passkeys: unknown[] } }>(await as(admin, `/identity/people/${leo.id}`));
    expect(detail.person.name).toBe("Persona identidad-leo");
    expect(detail.person.sessions).toHaveLength(1);
    expect(detail.person.events.map(item => item.type)).toEqual(expect.arrayContaining(["sign_in", "password_changed", "role_changed"]));
    expect((await as(admin, "/identity/people/nadie")).status).toBe(404);
  });

  it("an access review: each person kept or removed; completing it ends the removed access and is logged", async () => {
    const zoe = await person(admin, "identidad-zoe");
    const self = await read<{ member: { id: string } }>(await as(admin, "/session"));
    expect((await as(admin, "/identity/reviews", "POST", { name: "x", dueOn: "2099-01-01" })).status).toBe(400);
    expect((await as(admin, "/identity/reviews", "POST", { name: "Revisión de noviembre", dueOn: "2000-01-01" })).status).toBe(400);
    const { id } = await read<{ id: string }>(await as(admin, "/identity/reviews", "POST", { name: "Revisión de noviembre", dueOn: "2099-01-01" }), 201);
    expect((await as(admin, "/identity/reviews", "POST", { name: "Otra", dueOn: "2099-01-01" })).status).toBe(409);
    const { review } = await read<{ review: { items: { userId: string; decision: string | null; person: { name: string } | null }[] } }>(await as(admin, `/identity/reviews/${id}`));
    expect(review.items.some(item => item.userId === zoe.id && item.person?.name === "Persona identidad-zoe")).toBe(true);
    expect((await as(admin, `/identity/reviews/${id}/items/${self.member.id}`, "PUT", { decision: "remove" })).status).toBe(409);
    expect((await as(admin, `/identity/reviews/${id}/complete`, "POST")).status).toBe(409);
    for (const item of review.items) await read(await as(admin, `/identity/reviews/${id}/items/${item.userId}`, "PUT", { decision: item.userId === zoe.id ? "remove" : "keep", note: item.userId === zoe.id ? "Ya no trabaja con la organización" : null }));
    expect((await read<{ removed: number }>(await as(admin, `/identity/reviews/${id}/complete`, "POST"))).removed).toBe(1);
    expect((await as(zoe.cookie, "/session")).status).toBe(401);
    expect(cookieOf(await login("identidad-zoe", password))).toBeNull();
    const listed = await read<{ reviews: { id: string; status: string; removed: number }[] }>(await as(admin, "/identity/reviews"));
    expect(listed.reviews[0]).toMatchObject({ id, status: "completed", removed: 1 });
    expect((await as(admin, `/identity/reviews/${id}/items/${zoe.id}`, "PUT", { decision: "keep" })).status).toBe(409);
    const events = (await read<{ events: { type: string; detail: string | null }[] }>(await as(admin, `/security/events?limite=50&persona=${zoe.id}`))).events;
    expect(events.find(item => item.type === "access_changed")?.detail).toBe("Acceso retirado por la revisión «Revisión de noviembre»");
  });
});
