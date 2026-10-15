import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn, type ChildProcess } from "node:child_process";
import { createServer } from "node:net";
import { once } from "node:events";
import { setTimeout as delay } from "node:timers/promises";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { calendarFeed, escapeText, feedWindow, foldLine, zonedInstant, type FeedClass } from "../packages/domain/src/index";

/** Splits a feed into content lines (unfolded) after checking its physical form: CRLF, ≤ 75 octets per line. */
function parse(ics: string) {
  expect(ics.endsWith("\r\n")).toBe(true);
  expect(ics.replace(/\r\n/g, "")).not.toMatch(/[\r\n]/);
  const physical = ics.slice(0, -2).split("\r\n");
  for (const line of physical) expect(Buffer.byteLength(line, "utf8"), line).toBeLessThanOrEqual(75);
  const lines = ics.slice(0, -2).replace(/\r\n[ \t]/g, "").split("\r\n");
  const stack: string[] = [], events: Record<string, string>[] = [];
  let current: Record<string, string> | null = null;
  for (const line of lines) {
    const match = /^([A-Z-]+)((?:;[^:]*)?):(.*)$/.exec(line);
    expect(match, line).not.toBeNull();
    const [, name, params, value] = match!;
    if (name === "BEGIN") { stack.push(value); if (value === "VEVENT") current = {}; continue; }
    if (name === "END") { expect(stack.pop()).toBe(value); if (value === "VEVENT") { events.push(current!); current = null; } continue; }
    if (current) current[name] = params ? `${params.slice(1)}:${value}` : value;
  }
  expect(stack).toEqual([]);
  expect(lines[0]).toBe("BEGIN:VCALENDAR");
  expect(lines).toContain("VERSION:2.0");
  expect(lines.some(line => line.startsWith("PRODID:"))).toBe(true);
  for (const event of events) for (const required of ["UID", "DTSTAMP", "DTSTART", "SUMMARY"]) expect(event[required], required).toBeTruthy();
  return { lines, events };
}
const unescape = (value: string) => value.replace(/\\n/g, "\n").replace(/\\([,;\\])/g, "$1");

const base: FeedClass = { id: "session-1", groupId: "group-a", sessionDate: "2026-10-20", startsAt: "08:00", durationMinutes: 45, status: "planned", version: 1, updatedAt: "2026-10-01T12:00:00.000Z", courseTitle: "Exploradores", groupName: "Sección A" };
const now = new Date("2026-10-15T15:00:00Z");

describe("ST-125 criterion 1: the subscription link returns a valid iCalendar that Google, Outlook and Apple read", () => {
  it("writes a VCALENDAR with one VEVENT per class, CRLF line endings, UTC times and a stable UID", () => {
    const ics = calendarFeed({ name: "Mis clases · Demo", timezone: "America/Guatemala", origin: "https://app.example.org", classes: [base, { ...base, id: "session-2", sessionDate: "2026-10-21" }], now });
    const { lines, events } = parse(ics);
    expect(lines).toEqual(expect.arrayContaining(["CALSCALE:GREGORIAN", "METHOD:PUBLISH", "X-WR-TIMEZONE:America/Guatemala"]));
    expect(events).toHaveLength(2);
    // 08:00 in Guatemala (UTC−6, no daylight saving) is 14:00 UTC; 45 minutes later ends the class.
    expect(events[0]).toMatchObject({ UID: "session-1@app.example.org", DTSTAMP: "20261015T150000Z", DTSTART: "20261020T140000Z", DTEND: "20261020T144500Z", STATUS: "CONFIRMED", SEQUENCE: "0", "LAST-MODIFIED": "20261001T120000Z", URL: "https://app.example.org/secciones/group-a/clases/session-1" });
    expect(unescape(events[0].SUMMARY)).toBe("Exploradores · Sección A");
    // The same class keeps its UID in every refresh, so calendars update it instead of duplicating it.
    expect(parse(calendarFeed({ name: "x", timezone: "America/Guatemala", origin: "https://app.example.org", classes: [base] })).events[0].UID).toBe(events[0].UID);
  });
  it("places classes on the organization's clock, including across daylight-saving changes", () => {
    expect(zonedInstant("2026-07-01", "09:30", "America/New_York").toISOString()).toBe("2026-07-01T13:30:00.000Z");
    expect(zonedInstant("2026-12-01", "09:30", "America/New_York").toISOString()).toBe("2026-12-01T14:30:00.000Z");
    expect(zonedInstant("2026-10-20", "23:30", "Asia/Kolkata").toISOString()).toBe("2026-10-20T18:00:00.000Z");
    expect(zonedInstant("2026-10-20", "00:15", "UTC").toISOString()).toBe("2026-10-20T00:15:00.000Z");
  });
  it("writes a class without a start time as an all-day event", () => {
    const { events } = parse(calendarFeed({ name: "x", timezone: "America/Guatemala", origin: "https://a.example", classes: [{ ...base, startsAt: null, durationMinutes: null }], now }));
    expect(events[0]).toMatchObject({ DTSTART: "VALUE=DATE:20261020", DTEND: "VALUE=DATE:20261021" });
  });
  it("escapes commas, semicolons, backslashes and line breaks in text", () => {
    expect(escapeText("Lengua, arte; ciencia\\física\nlínea")).toBe("Lengua\\, arte\\; ciencia\\\\física\\nlínea");
    const { events } = parse(calendarFeed({ name: "Mis clases, sede; norte", timezone: "UTC", origin: "https://a.example", classes: [{ ...base, courseTitle: "Arte, música; y más", groupName: "A\\B" }], now }));
    expect(events[0].SUMMARY).toBe("Arte\\, música\\; y más · A\\\\B");
    expect(unescape(events[0].SUMMARY)).toBe("Arte, música; y más · A\\B");
  });
  it("folds lines longer than 75 octets without splitting multi-byte characters", () => {
    const long = "SUMMARY:" + "Educación física y artística · ".repeat(8);
    const folded = foldLine(long);
    expect(folded.split("\r\n").length).toBeGreaterThan(1);
    for (const line of folded.split("\r\n")) expect(Buffer.byteLength(line, "utf8")).toBeLessThanOrEqual(75);
    expect(folded.split("\r\n").slice(1).every(line => line.startsWith(" "))).toBe(true);
    expect(folded.replace(/\r\n /g, "")).toBe(long);
    const { events } = parse(calendarFeed({ name: "x", timezone: "UTC", origin: "https://a.example", classes: [{ ...base, courseTitle: "ñ".repeat(120) }], now }));
    expect(unescape(events[0].SUMMARY)).toBe(`${"ñ".repeat(120)} · Sección A`);
  });
  it("covers from 30 days back to 180 days ahead", () => {
    expect(feedWindow("2026-10-15")).toEqual({ from: "2026-09-15", until: "2027-04-13" });
  });
});

describe("ST-125 criterion 2: changes, cancellations and reschedules appear in the next refresh", () => {
  it("marks a cancelled class STATUS:CANCELLED and raises its SEQUENCE", () => {
    const { events } = parse(calendarFeed({ name: "x", timezone: "America/Guatemala", origin: "https://a.example", classes: [{ ...base, status: "cancelled", version: 2, updatedAt: "2026-10-14T10:00:00Z" }], now }));
    expect(events[0]).toMatchObject({ UID: "session-1@a.example", STATUS: "CANCELLED", SEQUENCE: "1", "LAST-MODIFIED": "20261014T100000Z" });
    expect(unescape(events[0].DESCRIPTION)).toContain("Clase cancelada.");
  });
  it("moves a rescheduled class under the same UID with a higher SEQUENCE", () => {
    const before = parse(calendarFeed({ name: "x", timezone: "America/Guatemala", origin: "https://a.example", classes: [base], now })).events[0];
    const after = parse(calendarFeed({ name: "x", timezone: "America/Guatemala", origin: "https://a.example", classes: [{ ...base, sessionDate: "2026-10-22", startsAt: "10:00", durationMinutes: 60, version: 3 }], now })).events[0];
    expect(after.UID).toBe(before.UID);
    expect(Number(after.SEQUENCE)).toBeGreaterThan(Number(before.SEQUENCE));
    expect([after.DTSTART, after.DTEND]).toEqual(["20261022T160000Z", "20261022T170000Z"]);
  });
});

// The rest runs the built Worker locally (as build.test.ts does) with a fresh store.
let worker: ChildProcess, origin: string, logs = "";
const storage = mkdtempSync(join(tmpdir(), "hl-calendar-feed-"));
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
    try { if ((await fetch(`${origin}/api/health`, { signal: AbortSignal.timeout(500) })).ok) return; } catch { /* starting */ }
    await delay(200);
  }
  throw new Error(`Local Worker did not start:\n${logs}`);
});
afterAll(async () => {
  if (worker && worker.exitCode === null) { const exited = once(worker, "exit"); worker.kill("SIGTERM"); await exited; }
  rmSync(storage, { recursive: true, force: true });
});

async function login(username: string) {
  const response = await fetch(`${origin}/api/login`, { method: "POST", headers: { "Content-Type": "application/json", Origin: origin }, body: JSON.stringify({ username, password: "Aprender-2026!" }) });
  expect(response.status).toBe(200);
  return /hl_session=[^;]+/.exec(response.headers.get("set-cookie") || "")![0];
}
function client(cookie: string) {
  const call = async (method: string, path: string, data?: unknown) => {
    const response = await fetch(origin + path, { method, headers: { Cookie: cookie, Origin: origin, ...(data === undefined ? {} : { "Content-Type": "application/json" }) }, ...(data === undefined ? {} : { body: JSON.stringify(data) }) });
    const text = await response.text();
    return { status: response.status, body: (text ? JSON.parse(text) : {}) as Record<string, any>, text };
  };
  return { get: (path: string) => call("GET", path), post: (path: string, data?: unknown) => call("POST", path, data), put: (path: string, data?: unknown) => call("PUT", path, data) };
}
const day = (offset: number) => new Date(Date.now() + offset * 86_400_000).toLocaleDateString("en-CA", { timeZone: "America/Guatemala" });
const fetchFeed = async (url: string) => { const response = await fetch(url.replace(/^https?:\/\/[^/]+/, origin)); return { status: response.status, type: response.headers.get("content-type"), cache: response.headers.get("cache-control"), text: await response.text() }; };

/** A course led by `leadId` with one section taught by them, scheduled daily for the next five days at 08:00. */
async function scheduledSection(admin: ReturnType<typeof client>, leadId: string, label: string) {
  const course = await admin.post("/api/courses", { title: `Calendario ${label}`, objective: "Probar el calendario.", status: "active", educationType: "non-formal", level: "unspecified", format: "workshop", modality: "in-person", pacing: "scheduled", area: "011", settings: { attendance: true }, programId: null, leadId });
  expect(course.status, course.text).toBe(201);
  const path = `/api/courses/${course.body.id}`;
  const group = await admin.post(`${path}/groups`, { name: `Sección ${label}` });
  expect(group.status, group.text).toBe(201);
  const assigned = await admin.put(`${path}/groups/${group.body.id}/educators`, { userIds: [leadId], conflictReason: "Secciones de prueba con el mismo horario." });
  expect(assigned.status, assigned.text).toBe(200);
  const schedule = await admin.put(`${path}/groups/${group.body.id}/schedule`, { weekdays: [0, 1, 2, 3, 4, 5, 6], startsAt: "08:00", durationMinutes: 45, from: day(1), until: day(5) });
  expect(schedule.status, schedule.text).toBe(200);
  return { path, groupId: group.body.id as string };
}

describe("ST-125 subscription link in the local Worker", () => {
  it("criteria 1-3: the feed lists only the educator's classes, follows cancellations and reschedules, and regenerating stops the old link", async () => {
    const admin = client(await login("admin-demo")), educator = client(await login("educador-demo")), other = client(await login("instructor-demo"));
    const mine = await scheduledSection(admin, "user-educator", "propia");
    const theirs = await scheduledSection(admin, "user-1", "ajena");

    // Signed out, nothing is offered; signed in, there is no link until the person creates one.
    expect((await fetch(`${origin}/api/feeds/calendar`)).status).toBe(401);
    expect((await educator.get("/api/feeds/calendar")).body).toEqual({ active: false, createdAt: null });
    const created = await educator.post("/api/feeds/calendar");
    expect(created.status).toBe(201);
    expect(created.body.url).toMatch(new RegExp(`^${origin}/api/feeds/calendar/d_[a-f0-9]{64}\\.ics$`));
    expect(created.body.webcal).toBe(created.body.url.replace(/^http:/, "webcal:"));
    // The link is shown once: afterwards only its existence is reported.
    const status = await educator.get("/api/feeds/calendar");
    expect(status.body).toEqual({ active: true, createdAt: created.body.createdAt });
    expect(status.text).not.toContain("d_");

    // Criterion 1: a valid calendar with the educator's classes, without the classes of other educators.
    let feed = await fetchFeed(created.body.url);
    expect(feed.status).toBe(200);
    expect(feed.type).toBe("text/calendar; charset=utf-8");
    expect(feed.cache).toBe("private, max-age=900");
    let events = parse(feed.text).events;
    const minePlan = (await educator.get(`${mine.path}/sessions`)).body.sessions.filter((item: { groupId: string }) => item.groupId === mine.groupId) as { id: string; version: number; sessionDate: string }[];
    const theirsPlan = (await other.get(`${theirs.path}/sessions`)).body.sessions.filter((item: { groupId: string }) => item.groupId === theirs.groupId) as { id: string }[];
    expect(minePlan).toHaveLength(5);
    expect(theirsPlan).toHaveLength(5);
    for (const item of minePlan) expect(events.find(event => event.UID === `${item.id}@127.0.0.1`), item.id).toBeTruthy();
    for (const item of theirsPlan) expect(feed.text).not.toContain(item.id);
    expect(feed.text).not.toContain("Calendario ajena");
    expect(feed.text).toContain("Calendario propia · Sección propia");

    // Criterion 2: a cancelled class and a rescheduled one change in the next refresh, under the same UID.
    const [cancelled, moved] = minePlan;
    expect((await educator.post(`${mine.path}/sessions/${cancelled.id}/cancel`)).status).toBe(200);
    const reschedule = await educator.put(`${mine.path}/sessions/${moved.id}`, { sessionDate: day(9), startsAt: "10:30", durationMinutes: 60, lessonIds: [], notes: "", version: moved.version });
    expect(reschedule.status, reschedule.text).toBe(200);
    events = parse((await fetchFeed(created.body.url)).text).events;
    const byId = (id: string) => events.find(event => event.UID === `${id}@127.0.0.1`)!;
    expect(byId(cancelled.id)).toMatchObject({ STATUS: "CANCELLED" });
    expect(Number(byId(cancelled.id).SEQUENCE)).toBeGreaterThan(0);
    expect(byId(moved.id).DTSTART).toBe(zonedInstant(day(9), "10:30", "America/Guatemala").toISOString().replace(/[-:]/g, "").replace(".000", ""));
    expect(Number(byId(moved.id).SEQUENCE)).toBeGreaterThan(0);

    // Criterion 3: regenerating gives a new link and the previous one stops working.
    const regenerated = await educator.post("/api/feeds/calendar");
    expect(regenerated.status).toBe(201);
    expect(regenerated.body.url).not.toBe(created.body.url);
    expect((await fetchFeed(created.body.url)).status).toBe(404);
    expect((await fetchFeed(regenerated.body.url)).status).toBe(200);

    // Unknown, foreign-organization and session tokens are not feeds; only GET is allowed, and no session is needed.
    const token = /calendar\/(d_[a-f0-9]{64})\.ics$/.exec(regenerated.body.url)![1];
    expect((await fetchFeed(`${origin}/api/feeds/calendar/d_${"0".repeat(64)}.ics`)).status).toBe(404);
    expect((await fetchFeed(`${origin}/api/feeds/calendar/o_${token.slice(2)}.ics`)).status).toBe(404);
    const sessionCookie = /hl_session=([^;]+)/.exec(await login("educador-demo"))![1];
    expect((await fetchFeed(`${origin}/api/feeds/calendar/${sessionCookie}.ics`)).status).toBe(404);
    expect((await fetch(`${origin}/api/feeds/calendar/${token}.ics`, { method: "POST", headers: { Origin: origin } })).status).toBe(405);

    // Another educator's link carries only their classes; deactivating the account turns it off.
    const otherLink = (await other.post("/api/feeds/calendar")).body.url as string;
    const otherFeed = await fetchFeed(otherLink);
    for (const item of theirsPlan) expect(otherFeed.text).toContain(`${item.id}@127.0.0.1`);
    for (const item of minePlan) expect(otherFeed.text).not.toContain(item.id);
    expect((await admin.put("/api/members/user-1", { role: "educator", active: false })).status).toBe(200);
    expect((await fetchFeed(otherLink)).status).toBe(404);
    expect((await admin.put("/api/members/user-1", { role: "educator", active: true })).status).toBe(200);
  }, 60000);

  it("never copies calendar links into backups", async () => {
    const admin = client(await login("admin-demo"));
    expect((await admin.post("/api/feeds/calendar")).status).toBe(201);
    const backup = await admin.get("/api/organization/backup");
    expect(backup.status).toBe(200);
    expect(Object.keys(backup.body.tables)).not.toContain("calendar_feeds");
  });
});
