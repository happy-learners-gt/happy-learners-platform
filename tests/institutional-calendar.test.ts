import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn, type ChildProcess } from "node:child_process";
import { createServer } from "node:net";
import { once } from "node:events";
import { setTimeout as delay } from "node:timers/promises";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { DateRule, InstitutionalCalendarEvent, InstitutionalCalendarRule } from "../packages/contracts/src/index";
import { effectiveCalendar, generateYear, noClassDays } from "../packages/domain/src/index";

const event = (patch: Partial<InstitutionalCalendarEvent> = {}): InstitutionalCalendarEvent => ({
  id: "event-1", calendarId: "calendar-1", categoryId: "category-no-class", title: "Sin clase",
  from: "2027-05-10", until: "2027-05-10", part: "full", noClass: true, ruleId: null, year: null,
  status: "active", ...patch,
});
const schedule = (startsAt: string) => ({ startsAt, durationMinutes: 45 });

describe("institutional calendar domain", () => {
  it("filters active no-class dates and applies half days to the meeting start", () => {
    const events = [
      event({ id: "full", from: "2027-05-08", until: "2027-05-10" }),
      event({ id: "morning", from: "2027-05-11", until: "2027-05-11", part: "morning" }),
      event({ id: "afternoon", from: "2027-05-12", until: "2027-05-12", part: "afternoon" }),
      event({ id: "skipped", from: "2027-05-13", until: "2027-05-13", status: "skipped" }),
      event({ id: "class", from: "2027-05-14", until: "2027-05-14", noClass: false }),
    ];
    expect(noClassDays(events, { from: "2027-05-09", until: "2027-05-14", schedule: schedule("08:00") }).map(item => item.id)).toEqual(["full", "morning"]);
    expect(noClassDays(events, { from: "2027-05-09", until: "2027-05-14", schedule: schedule("14:00") }).map(item => item.id)).toEqual(["full", "afternoon"]);
    expect(noClassDays(events, { from: "2027-05-10", until: "2027-05-10" })[0]).toMatchObject({ from: "2027-05-10", until: "2027-05-10" });
  });

  it("adds organization, program and section levels without lower-level overrides", () => {
    const organization = [event({ id: "organization" })];
    const program = [event({ id: "program", status: "skipped" })];
    const section = [event({ id: "section" })];
    expect(effectiveCalendar(organization, program, section).map(item => item.id)).toEqual(["organization", "program", "section"]);
  });

  it("plans new and edited occurrences while preserving moved and skipped ones", () => {
    const dateRule: DateRule = { id: "rule-1", title: "Asueto", anchor: { kind: "fixed", month: 5, day: 1 } };
    const rule: InstitutionalCalendarRule = { id: "stored-rule-1", calendarId: "calendar-1", categoryId: "holiday", rule: dateRule, noClass: true };
    expect(generateYear([rule], 2027, []).create).toEqual([expect.objectContaining({ ruleId: "stored-rule-1", from: "2027-05-01", noClass: true })]);

    const ordinary = event({ id: "ordinary", ruleId: rule.id, year: 2027, from: "2027-04-30", title: "Nombre anterior" });
    const moved = event({ id: "moved", ruleId: rule.id, year: 2027, from: "2027-05-03", manual: true } as Partial<InstitutionalCalendarEvent>);
    const skipped = event({ id: "skipped", ruleId: rule.id, year: 2027, status: "skipped" });
    expect(generateYear([rule], 2027, [ordinary]).update).toEqual([expect.objectContaining({ id: "ordinary", from: "2027-05-01", title: "Asueto" })]);
    expect(generateYear([rule], 2027, [moved as InstitutionalCalendarEvent]).keep.map(item => item.id)).toEqual(["moved"]);
    expect(generateYear([rule], 2027, [skipped]).keep.map(item => item.id)).toEqual(["skipped"]);
  });
});

let worker: ChildProcess;
let origin = "";
let logs = "";
const storage = mkdtempSync(join(tmpdir(), "hl-platform-institutional-calendar-"));
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

describe("institutional calendar on the built Worker", () => {
  it("generates rules, scopes no-class events, supports program cycles and keeps the legacy API", async () => {
    const admin = await signIn("admin-demo"), educator = await signIn("educador-demo"), external = await signIn("admin-externo");
    const catalog = await read<{ calendars: { id: string; scope: string; scopeId: string | null }[]; categories: { id: string; key: string }[] }>(await as(admin, "/calendars"));
    const organization = catalog.calendars.find(item => item.scope === "organization")!;
    const programCalendar = catalog.calendars.find(item => item.scope === "program")!;
    const holiday = catalog.categories.find(item => item.key === "holiday")!;
    const noClass = catalog.categories.find(item => item.key === "no-class")!;

    expect((await as(educator, `/calendars/${organization.id}/templates/guatemala`, "POST")).status).toBe(403);
    expect((await as(external, `/calendars/${organization.id}/templates/guatemala`, "POST")).status).toBe(404);
    expect((await read<{ added: number }>(await as(admin, `/calendars/${organization.id}/templates/guatemala`, "POST"))).added).toBe(13);
    expect((await read<{ added: number }>(await as(admin, `/calendars/${organization.id}/templates/guatemala`, "POST"))).added).toBe(0);
    const preview = await read<{ plan: { create: unknown[] } }>(await as(admin, `/calendars/${organization.id}/years/2027/generate?preview=1`, "POST"));
    expect(preview.plan.create).toHaveLength(13);
    expect((await read<{ applied: { created: number } }>(await as(admin, `/calendars/${organization.id}/years/2027/generate`, "POST"))).applied.created).toBe(13);

    const programId = programCalendar.scopeId!;
    const year = await read<{ year: { id: string; periods: { id: string }[] } }>(await as(admin, "/academic-years", "POST", {
      name: "Ciclo propio del programa", from: "2028-01-10", until: "2028-06-30", periodKind: "semester", programId,
      periods: [{ name: "Primer semestre", from: "2028-01-10", until: "2028-06-30", weight: 100 }],
    }), 201);
    expect((await read<{ year: { status: string; programId: string } }>(await as(admin, `/academic-years/${year.year.id}/activate`, "POST"))).year).toMatchObject({ status: "current", programId });

    const courseInput = (title: string, selectedProgram: string | null) => ({
      title, objective: "Probar el calendario institucional.", status: "active", educationType: "non-formal", level: "unspecified",
      format: "workshop", modality: "in-person", pacing: "scheduled", area: "011", settings: { attendance: true }, programId: selectedProgram, leadId: "user-educator",
    });
    const programCourse = (await read<{ id: string }>(await as(admin, "/courses", "POST", courseInput("Curso con calendario de programa", programId)), 201)).id;
    const otherCourse = (await read<{ id: string }>(await as(admin, "/courses", "POST", courseInput("Curso fuera del programa", null)), 201)).id;
    const programGroup = (await read<{ id: string }>(await as(admin, `/courses/${programCourse}/groups`, "POST", { name: "Programa A" }), 201)).id;
    const otherGroup = (await read<{ id: string }>(await as(admin, `/courses/${otherCourse}/groups`, "POST", { name: "General B" }), 201)).id;
    const schedule = { weekdays: [1], startsAt: "08:00", durationMinutes: 45, from: "2027-05-03", until: "2027-05-31" };
    expect((await read<{ classes: number }>(await as(admin, `/courses/${programCourse}/groups/${programGroup}/schedule`, "PUT", schedule))).classes).toBe(5);
    expect((await read<{ classes: number }>(await as(admin, `/courses/${otherCourse}/groups/${otherGroup}/schedule`, "PUT", schedule))).classes).toBe(5);
    expect((await read<{ sessions: { groupId: string }[] }>(await as(admin, `/courses/${programCourse}/sessions`))).sessions.filter(item => item.groupId === programGroup)).toHaveLength(5);
    const added = await read<{ removed: number }>(await as(admin, `/calendars/${programCalendar.id}/events`, "POST", {
      categoryId: noClass.id, title: "Asueto del programa", from: "2027-05-10", until: "2027-05-10", noClass: true,
    }), 201);
    expect(added.removed).toBe(1);

    const legacy = await read<{ break: { id: string } }>(await as(admin, "/calendar", "POST", { title: "Compatibilidad", from: "2027-05-17", until: "2027-05-17", groupId: otherGroup }), 201);
    expect((await read<{ breaks: { id: string }[] }>(await as(admin, `/calendar?section=${otherGroup}`))).breaks.some(item => item.id === legacy.break.id)).toBe(true);
    await read(await as(admin, `/calendar/${legacy.break.id}`, "DELETE"));

    const view = await read<{ events: { title: string; scope: string }[] }>(await as(admin, `/calendars/view?from=2027-01-01&until=2027-12-31&program=${programId}`));
    expect(view.events).toEqual(expect.arrayContaining([expect.objectContaining({ title: "Asueto del programa", scope: "program" }), expect.objectContaining({ title: "Navidad", scope: "organization" })]));
    const periodSchedule = await read<{ schedule: { from: string; until: string; periodId: string } }>(await as(admin, `/courses/${programCourse}/groups/${programGroup}/schedule`, "PUT", {
      periodId: year.year.periods[0].id, weekdays: [1], startsAt: "08:00", durationMinutes: 45,
    }));
    expect(periodSchedule.schedule).toMatchObject({ from: "2028-01-10", until: "2028-06-30", periodId: year.year.periods[0].id });
    expect(holiday.id).toContain("holiday");
  }, 45_000);
});
