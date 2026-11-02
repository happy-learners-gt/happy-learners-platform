import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn, type ChildProcess } from "node:child_process";
import { createServer } from "node:net";
import { once } from "node:events";
import { setTimeout as delay } from "node:timers/promises";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

let worker: ChildProcess;
let origin = "";
let logs = "";
const storage = mkdtempSync(join(tmpdir(), "hl-platform-agenda-"));
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
  for (let attempt = 0; attempt < 50; attempt++) {
    if (worker.exitCode !== null) throw new Error(logs);
    try { if ((await fetch(`${origin}/api/health`, { signal: AbortSignal.timeout(500) })).ok) return; } catch { /* Wait for the local runtime to start. */ }
    await delay(200);
  }
  throw new Error(`Local Worker did not start:\n${logs}`);
}, 60_000);
afterAll(async () => {
  if (worker && worker.exitCode === null) { const exited = once(worker, "exit"); worker.kill("SIGTERM"); await exited; }
  rmSync(storage, { recursive: true, force: true });
});

const password = "Aprender-2026!";
async function signIn(username: string) {
  const response = await fetch(`${origin}/api/login`, { method: "POST", headers: { "Content-Type": "application/json", Origin: origin }, body: JSON.stringify({ username, password }) });
  return response.status === 200 ? response.headers.get("set-cookie")!.split(";")[0] : null;
}
async function as(cookie: string | null, path: string, method = "GET", data?: unknown) {
  return fetch(`${origin}/api${path}`, { method, headers: { Cookie: cookie || "", Origin: origin, ...(data !== undefined ? { "Content-Type": "application/json" } : {}) }, ...(data !== undefined ? { body: JSON.stringify(data) } : {}) });
}
const read = async <T = Record<string, unknown>>(response: Response, status = 200) => {
  const text = await response.text();
  expect(response.status, `${text}\n${logs.slice(-6000)}`).toBe(status);
  return JSON.parse(text) as T;
};

type AgendaItem = { type: string; id: string; date?: string; from?: string; startsAt?: string | null; status?: string; moved?: boolean; title?: string; sectionId?: string };
describe("agenda on the built Worker", () => {
  it("scopes classes, a cancelled class, a moved class, a holiday that shades and a delivery", async () => {
    const admin = await signIn("admin-demo"), educator = await signIn("educador-demo"), external = await signIn("admin-externo");
    const course = (await read<{ id: string }>(await as(admin, "/courses", "POST", { title: "Curso de la agenda", objective: "Probar la agenda.", status: "active", educationType: "non-formal", level: "unspecified", format: "workshop", modality: "in-person", pacing: "scheduled", area: "011", settings: { attendance: true }, programId: null, leadId: "user-educator" }), 201)).id;
    const group = (await read<{ id: string }>(await as(admin, `/courses/${course}/groups`, "POST", { name: "Sección agenda" }), 201)).id;
    await read(await as(admin, `/courses/${course}/groups/${group}/educators`, "PUT", { userIds: ["user-educator"], conflictReason: "Sección de prueba de la agenda." }));
    await read(await as(admin, `/courses/${course}/groups/${group}/schedule`, "PUT", { weekdays: [1], startsAt: "08:00", durationMinutes: 45, from: "2027-03-01", until: "2027-04-12" }));
    const sessions = (await read<{ sessions: { id: string; groupId: string; sessionDate: string; version: number; startsAt: string | null; status: string }[] }>(await as(educator, `/courses/${course}/sessions`))).sessions.filter(item => item.groupId === group);
    const on = (day: string) => sessions.find(item => item.sessionDate === day)!;
    expect(on("2027-03-01").startsAt).toBe("08:00");
    await read(await as(educator, `/courses/${course}/sessions/${on("2027-03-08").id}/cancel`, "POST"));

    const catalog = await read<{ calendars: { id: string; scope: string }[]; categories: { id: string; key: string }[] }>(await as(admin, "/calendars"));
    const calendar = catalog.calendars.find(item => item.scope === "organization")!;
    const noClass = catalog.categories.find(item => item.key === "no-class")!;
    await read(await as(admin, `/calendars/${calendar.id}/events`, "POST", { title: "Asueto de la agenda", from: "2027-03-22", until: "2027-03-22", categoryId: noClass.id, noClass: true, part: "full" }), 201);
    const after = (await read<{ sessions: { id: string; groupId: string; sessionDate: string; version: number }[] }>(await as(educator, `/courses/${course}/sessions`))).sessions.filter(item => item.groupId === group);
    const moved = after.find(item => item.sessionDate === "2027-03-15")!;
    await read(await as(educator, `/courses/${course}/sessions/${moved.id}`, "PUT", { sessionDate: "2027-03-15", startsAt: "09:30", durationMinutes: 45, lessonIds: [], notes: "", version: moved.version }));

    const book = await read<{ gradebook: { periods: { id: string }[] } }>(await as(admin, `/sections/${group}/grades`));
    await read(await as(admin, `/sections/${group}/grades/periods/${book.gradebook.periods[0].id}/plan`, "PUT", { activities: [{ title: "Ensayo", kind: "project", points: 20, dueOn: "2027-03-15" }] }));

    const query = "/agenda?from=2027-03-01&until=2027-04-12";
    expect((await as(educator, `${query}&scope=organization`)).status).toBe(403);
    expect((await as(external, `${query}&scope=program:seed-program-primaria`)).status).toBe(404);
    expect((await read(await as(admin, "/agenda?from=2027-01-01&until=2028-03-01"), 400)).error).toBe("El rango puede ser de hasta 400 días.");

    const seen = await read<{ items: AgendaItem[]; canWiden: boolean }>(await as(admin, `${query}&scope=organization`));
    const mine = await read<{ items: AgendaItem[] }>(await as(educator, `${query}&scope=mine`));
    for (const items of [seen.items, mine.items]) {
      expect(items.find(item => item.type === "class" && item.date === "2027-03-08")).toMatchObject({ status: "cancelled" });
      expect(items.find(item => item.type === "class" && item.date === "2027-03-15")).toMatchObject({ startsAt: "09:30", moved: true });
      expect(items.find(item => item.type === "class" && item.date === "2027-03-22" && item.status !== "cancelled")).toBeUndefined();
      expect(items.find(item => item.type === "no-class" && item.title === "Asueto de la agenda")).toMatchObject({ from: "2027-03-22" });
      expect(items.find(item => item.type === "class" && item.date === "2027-03-29")).toMatchObject({ moved: true });
      expect(items.find(item => item.type === "due" && item.title === "Ensayo")).toMatchObject({ date: "2027-03-15", sectionId: group });
    }
    expect(seen.canWiden).toBe(true);
    // IA-03: without a scope, administration (teaches nothing, sees everything) opens on the whole organization;
    // an educator on their own sections.
    expect(await read<{ scope: string }>(await as(admin, query))).toMatchObject({ scope: "organization" });
    expect(await read<{ scope: string }>(await as(educator, query))).toMatchObject({ scope: "mine" });
    expect((await read<{ preferences: { agendaView: string; agendaShow: string[] } }>(await as(educator, "/me/preferences", "PUT", { agendaView: "month", agendaShow: ["class", "due"] }))).preferences).toMatchObject({ agendaView: "month", agendaShow: ["class", "due"] });
  });
});
