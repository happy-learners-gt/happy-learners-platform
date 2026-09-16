import { execFileSync, spawn, type ChildProcess } from "node:child_process";
import { createServer } from "node:net";
import { once } from "node:events";
import { setTimeout as delay } from "node:timers/promises";
import { afterAll, beforeAll, expect, it } from "vitest";

let worker: ChildProcess;
let origin: string;
let logs = "";
beforeAll(async () => {
  const server = createServer();
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Missing local port");
  const port = address.port;
  await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  origin = `http://127.0.0.1:${port}`;
  worker = spawn("node_modules/.bin/wrangler", ["dev", "--local", "--config", "build/wrangler.json", "--ip", "127.0.0.1", "--port", String(port), "--inspector-port", "0"], {
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
