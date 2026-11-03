import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn, type ChildProcess } from "node:child_process";
import { createServer } from "node:net";
import { once } from "node:events";
import { setTimeout as delay } from "node:timers/promises";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { aiBudget } from "../packages/domain/src/index";
import { listenOnTestPort } from "./test-port";

// AIG-6 (AP-07): the organization's monthly AI budget.
describe("AIG-6 AI budget", () => {
  it("is so much per active person, never less than the minimum, and warns past 80 %", () => {
    expect(aiBudget(5, 0, false)).toEqual({ budget: 20, spent: 0, unpriced: false, level: "ok" });
    expect(aiBudget(30, 48, false).level).toBe("warning");
    expect(aiBudget(30, 60, true)).toEqual({ budget: 60, spent: 60, unpriced: true, level: "exhausted" });
    expect(aiBudget(30, 47.9, false, 2, 20).level).toBe("ok");
    expect(aiBudget(3, 0, false, 0, 0).level).toBe("exhausted");
  });
});

let worker: ChildProcess;
let origin = "";
let logs = "";
const storage = mkdtempSync(join(tmpdir(), "hl-platform-ai-budget-"));
beforeAll(async () => {
  const server = createServer();
  await listenOnTestPort(server);
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Missing local port");
  await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  origin = `http://127.0.0.1:${address.port}`;
  // A deployment whose budget is zero: the first request already finds it used.
  worker = spawn("node_modules/.bin/wrangler", ["dev", "--local", "--config", "build/wrangler.json", "--ip", "127.0.0.1", "--port", String(address.port), "--inspector-port", "0", "--persist-to", storage,
    "--var", "LESSON_GENERATOR:fixture", "--var", "AI_BUDGET_PER_PERSON_USD:0", "--var", "AI_BUDGET_MIN_USD:0"], {
    env: { ...process.env, WRANGLER_SEND_METRICS: "false", BROWSER: "none" }, stdio: ["ignore", "pipe", "pipe"],
  });
  worker.stdout?.on("data", chunk => { logs += chunk; });
  worker.stderr?.on("data", chunk => { logs += chunk; });
  for (let attempt = 0; attempt < 300; attempt++) {
    if (worker.exitCode !== null) throw new Error(logs);
    try { if ((await fetch(`${origin}/api/health`, { signal: AbortSignal.timeout(500) })).ok) return; } catch { /* Wait for the local runtime to start. */ }
    await delay(200);
  }
  throw new Error(`Local Worker did not start:\n${logs}`);
}, 90_000);
afterAll(async () => {
  if (worker && worker.exitCode === null) { const exited = once(worker, "exit"); worker.kill("SIGTERM"); await exited; }
  rmSync(storage, { recursive: true, force: true });
});

async function signIn(username: string) {
  const response = await fetch(`${origin}/api/login`, { method: "POST", headers: { "Content-Type": "application/json", Origin: origin }, body: JSON.stringify({ username, password: "Aprender-2026!" }) });
  expect(response.status).toBe(200);
  return response.headers.get("set-cookie")!.split(";")[0];
}
const as = (cookie: string, path: string, method = "GET", data?: unknown) =>
  fetch(`${origin}/api${path}`, { method, headers: { Cookie: cookie, Origin: origin, ...(data !== undefined ? { "Content-Type": "application/json" } : {}) }, ...(data !== undefined ? { body: JSON.stringify(data) } : {}) });

describe("AIG-6 AI budget on the built Worker", () => {
  it("stops asking the AI once the month's budget is used, and administration sees why", async () => {
    const admin = await signIn("admin-demo"), educator = await signIn("educador-demo");
    const write = await as(educator, "/ai/write", "POST", { field: "lesson-objective", action: "shorten", text: "Saludar en inglés. Presentarse con su nombre." });
    expect(write.status).toBe(429);
    expect((await write.json() as { error: string }).error).toContain("presupuesto de IA de este mes");
    // Invalid requests are still answered as such, and the suggestions found without the AI are still offered.
    expect((await as(educator, "/ai/write", "POST", { field: "contraseña", action: "draft", text: "" })).status).toBe(400);
    const usage = await (await as(admin, "/organization/ai-usage")).json() as { budget: { budget: number; spent: number; level: string } };
    expect(usage.budget).toMatchObject({ budget: 0, spent: 0, level: "exhausted" });
  }, 60_000);
});
