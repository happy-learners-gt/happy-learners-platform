import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn, type ChildProcess } from "node:child_process";
import { createServer } from "node:net";
import { once } from "node:events";
import { setTimeout as delay } from "node:timers/promises";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { EducatorConflict } from "../packages/contracts/src/index";
import { outsideAvailability } from "../packages/domain/src/index";
import { listenOnTestPort } from "./test-port";

// DEC-047: the weekly availability each educator declares counts when they are assigned to a section. Classes outside
// it need a confirmation with a reason, like an overlap with another section (DEC-035), and the confirmation is kept.
describe("DEC-047 availability rule", () => {
  const slots = [{ day: 2 as const, start: "10:00", end: "13:00" }, { day: 4 as const, start: "10:00", end: "13:00" }];
  it("a class must fit whole within a slot of its weekday; declaring nothing never restricts", () => {
    expect(outsideAvailability(slots, "2026-10-20", "11:00", 45)).toBe(false); // Tuesday 11:00–11:45
    expect(outsideAvailability(slots, "2026-10-20", "12:30", 45)).toBe(true); // ends 13:15
    expect(outsideAvailability(slots, "2026-10-19", "11:00", 45)).toBe(true); // Monday
    expect(outsideAvailability(slots, "2026-10-25", "11:00", null)).toBe(true); // Sunday
    expect(outsideAvailability(slots, "2026-10-22", "13:00", null)).toBe(false); // Thursday, start only, at the edge
    expect(outsideAvailability([], "2026-10-19", "06:00", 600)).toBe(false);
  });
});

let worker: ChildProcess;
let origin = "";
let logs = "";
const storage = mkdtempSync(join(tmpdir(), "hl-platform-contracts-"));
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

const password = "Aprender-2026!";
async function signIn(username: string, secret = password) {
  const response = await fetch(`${origin}/api/login`, { method: "POST", headers: { "Content-Type": "application/json", Origin: origin }, body: JSON.stringify({ username, password: secret }) });
  return response.status === 200 ? response.headers.get("set-cookie")!.split(";")[0] : null;
}
async function as(cookie: string | null, path: string, method = "GET", data?: unknown) {
  return fetch(`${origin}/api${path}`, { method, headers: { Cookie: cookie || "", Origin: origin, ...(data !== undefined ? { "Content-Type": "application/json" } : {}) }, ...(data !== undefined ? { body: JSON.stringify(data) } : {}) });
}
const read = async <T = Record<string, unknown>>(response: Response, status = 200) => { const text = await response.text(); expect(response.status, text).toBe(status); return JSON.parse(text) as T; };
/** A Monday after today, plus `offset` days: classes are only planned from today on, so fixed dates expire. */
const day = (offset: number) => { const base = new Date(); base.setUTCHours(0, 0, 0, 0); base.setUTCDate(base.getUTCDate() + ((8 - base.getUTCDay()) % 7 || 7) + offset); return base.toISOString().slice(0, 10); };

describe("DEC-047 availability on the built Worker", () => {
  it("assigning outside the declared availability asks for a reason and keeps the confirmation", async () => {
    const admin = await signIn("admin-demo");
    const course = (await read<{ id: string }>(await as(admin, "/courses", "POST", { title: "Curso de disponibilidad", objective: "Las franjas declaradas cuentan al asignar.", status: "active", educationType: "non-formal", level: "unspecified", format: "workshop", modality: "in-person", pacing: "scheduled", area: "011", settings: { attendance: true }, programId: null, leadId: "user-educator" }), 201)).id;
    const section = async (name: string, weekday: number, startsAt: string) => {
      const group = (await read<{ id: string }>(await as(admin, `/courses/${course}/groups`, "POST", { name }), 201)).id;
      await read(await as(admin, `/courses/${course}/groups/${group}/schedule`, "PUT", { weekdays: [weekday], startsAt, durationMinutes: 45, from: day(0), until: day(20) }));
      return group;
    };
    // educador-demo declared Tuesday and Thursday 10:00–13:00 (0047); a Thursday 12:00 section fits (their own class ends at 11:45).
    const inside = await section("Jueves a las 12", 4, "12:00");
    await read(await as(admin, `/courses/${course}/groups/${inside}/educators`, "PUT", { userIds: ["user-educator"] }));
    // A Monday 08:00 section does not: three classes outside, so the assignment waits for a reason.
    const outside = await section("Lunes a las 8", 1, "08:00");
    const refused = await read<{ error: string; conflicts: EducatorConflict[] }>(await as(admin, `/courses/${course}/groups/${outside}/educators`, "PUT", { userIds: ["user-educator"] }), 409);
    expect(refused.error).toContain("fuera de la disponibilidad que declaró");
    expect(refused.conflicts).toEqual([expect.objectContaining({ kind: "availability", userId: "user-educator", groupId: outside, overlaps: 3, firstDate: day(0), startsAt: "08:00" })]);
    expect((await as(admin, `/courses/${course}/groups/${outside}/educators`, "PUT", { userIds: ["user-educator"], conflictReason: "x" })).status).toBe(400);
    await read(await as(admin, `/courses/${course}/groups/${outside}/educators`, "PUT", { userIds: ["user-educator"], conflictReason: "Cubre la sección mientras llega su educadora." }));
    // The section shows it as confirmed, with who allowed it and why, and the activity records it.
    const { section: shown } = await read<{ section: { conflicts?: EducatorConflict[]; educators: { conflicts?: EducatorConflict[] }[] } }>(await as(admin, `/sections/${outside}`));
    const listed = [...(shown.conflicts || []), ...shown.educators.flatMap(item => item.conflicts || [])];
    expect(listed).toContainEqual(expect.objectContaining({ kind: "availability", confirmation: expect.objectContaining({ reason: "Cubre la sección mientras llega su educadora." }) }));
    const { events } = await read<{ events: { summary: string }[] }>(await as(admin, "/activity?limit=20"));
    expect(events.map(item => item.summary)).toContain("Confirmó que Educador de la demostración imparte fuera de su disponibilidad en «Lunes a las 8» (3 clases)");
  });
});
