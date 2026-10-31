import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn, type ChildProcess } from "node:child_process";
import { createServer } from "node:net";
import { once } from "node:events";
import { setTimeout as delay } from "node:timers/promises";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

// Security audit 2026-11 (docs/security/auditoria-2026-11.md): every route the API declares, read from its source,
// answers 401 without a session unless it is one of the public routes listed here on purpose. A new route that skips
// the sign-in check, or a public one nobody listed, fails this test.
let worker: ChildProcess;
let origin = "", logs = "";
const storage = mkdtempSync(join(tmpdir(), "hl-platform-routes-"));
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
    try { if ((await fetch(`${origin}/api/health`, { signal: AbortSignal.timeout(500) })).ok) return; } catch { /* Wait for the local runtime. */ }
    await delay(200);
  }
  throw new Error(`Local Worker did not start:\n${logs}`);
}, 60_000);
afterAll(async () => {
  if (worker && worker.exitCode === null) { const exited = once(worker, "exit"); worker.kill("SIGTERM"); await exited; }
  rmSync(storage, { recursive: true, force: true });
});


/** Routes that answer without a session, each for a reason. */
const publicRoutes: [RegExp, string][] = [
  [/^\/api\/(health|login|logout)$/, "estado del servicio y entrada o salida de la sesión"],
  [/^\/api\/share\//, "lecciones publicadas por su código de enlace"],
  [/^\/api\/student\//, "estudiantes que entran con el código de su sección"],
  [/^\/api\/invitations\/accept\//, "aceptar una invitación con el enlace recibido"],
  [/^\/api\/account\/email\/[a-z]_[a-f0-9]{64}$/, "confirmar un correo con el enlace recibido"],
  [/^\/api\/feeds\/calendar\//, "calendario suscrito con su enlace secreto"],
  [/^\/api\/public\//, "política de privacidad publicada"],
  [/^\/api\/(curriculum|levels|units)(\/[a-z0-9-]+)?$|^\/api\/resources\/[a-z0-9-]+$/, "rutas retiradas: responden 410 a cualquiera (HL-119)"],
];

/** Patterns in the source that are not routes on their own, each for a reason. */
const notRoutes: Record<string, string> = {
  "/api/organization/restore": "solo existe con RESTORE_ENABLED (el ensayo de restauración)",
  "^\\/api\\/me\\/credentials\\/[a-z0-9-]+$": "comprobación interna; la ruta real exige `credential-…` (professionalPath)",
};

/** Every route pattern in the API source: exact paths and `/^\/api\/…$/` expressions. */
function declaredRoutes() {
  const found = new Set<string>();
  const dir = "apps/api/src";
  for (const file of readdirSync(dir).filter(name => name.endsWith(".ts"))) {
    const text = readFileSync(join(dir, file), "utf8");
    for (const match of text.matchAll(/path === "(\/api\/[^"]+)"/g)) found.add(match[1]);
    for (const match of text.matchAll(/\/(\^\\\/api\\\/(?:[^/\n]|\\\/)*?\$)\//g)) found.add(match[1]);
  }
  return [...found];
}
/** The shortest path a route pattern accepts: first alternative, fewest repetitions. */
function sample(source: string) {
  if (!source.startsWith("^")) return source;
  const text = source.slice(1, -1);
  let at = 0;
  const alternation = (): string => { const first = sequence(); while (text[at] === "|") { at++; sequence(); } return first; };
  function sequence() {
    let out = "";
    while (at < text.length && text[at] !== "|" && text[at] !== ")") {
      let atom: string;
      if (text[at] === "(") { at++; if (text.startsWith("?:", at)) at += 2; atom = alternation(); at++; }
      else if (text[at] === "[") { const end = text.indexOf("]", at + 1), body = text.slice(at + 1, end); at = end + 1; atom = body.startsWith("^") ? "a" : body[0] === "\\" ? body[1] : body[0]; }
      else if (text[at] === "\\") { const next = text[at + 1]; at += 2; atom = next === "d" ? "1" : next === "w" ? "a" : next; }
      else atom = text[at++];
      let times = 1;
      if (text[at] === "?" || text[at] === "*") { times = 0; at++; }
      else if (text[at] === "+") at++;
      else if (text[at] === "{") { const end = text.indexOf("}", at); times = Number(text.slice(at + 1, end).split(",")[0]); at = end + 1; }
      out += atom.repeat(times);
    }
    return out;
  }
  return alternation();
}

describe("security audit: route matrix on the built Worker", () => {
  it("every declared route needs a session, except the listed public ones", async () => {
    const routes = declaredRoutes();
    expect(routes.length).toBeGreaterThan(200);
    const open: string[] = [], unknown: string[] = [];
    for (const route of routes) {
      const path = sample(route);
      expect(route.startsWith("^") ? new RegExp(route).test(path) : true, route).toBe(true);
      if (notRoutes[route] || publicRoutes.some(([pattern]) => pattern.test(path))) continue;
      let response = await fetch(`${origin}${path}`);
      if (response.status === 405) {
        const method = (response.headers.get("Allow") || "POST").split(",")[0].trim();
        response = await fetch(`${origin}${path}`, { method, headers: { Origin: origin, "Content-Type": "application/json" }, body: method === "DELETE" ? undefined : "{}" });
      }
      if (response.status === 404) unknown.push(`${route} → ${path}`);
      else if (response.status !== 401) open.push(`${route} → ${path}: ${response.status}`);
    }
    expect(open, "routes that answer without a session").toEqual([]);
    expect(unknown, "patterns the router does not serve").toEqual([]);
  }, 120_000);


  it("H2: ten failed sign-ins stop that account for 15 minutes, even with the right password; others still sign in", async () => {
    const login = (username: string, password: string) => fetch(`${origin}/api/login`, { method: "POST", headers: { "Content-Type": "application/json", Origin: origin }, body: JSON.stringify({ username, password }) });
    for (let attempt = 0; attempt < 10; attempt++) expect((await login("tomas.aguilar", `incorrecta-${attempt}`)).status).toBe(401);
    expect((await login("tomas.aguilar", "Aprender-2026!")).status).toBe(429);
    expect((await login("lucia.herrera", "Aprender-2026!")).status).toBe(200);
  }, 60_000);

  it("each API request leaves one structured line with its route template and the rows it read", async () => {
    const response = await fetch(`${origin}/api/login`, { method: "POST", headers: { "Content-Type": "application/json", Origin: origin }, body: JSON.stringify({ username: "admin-demo", password: "Aprender-2026!" }) });
    expect(response.status).toBe(200);
    await delay(300);
    const lines = logs.split("\n").filter(line => line.includes('"event":"api"') && line.includes('"route":"/api/login"')).map(line => JSON.parse(line.slice(line.indexOf("{"))));
    const last = lines.at(-1);
    expect(last).toMatchObject({ method: "POST", status: 200, organization: "org-demo" });
    expect(last.rowsRead).toBeGreaterThan(0);
    expect(last.rowsWritten).toBeGreaterThan(0);
    expect(JSON.stringify(lines)).not.toContain("Aprender-2026!");
  }, 60_000);
});

