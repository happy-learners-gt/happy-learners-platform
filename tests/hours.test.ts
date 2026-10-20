import { createHash } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn, type ChildProcess } from "node:child_process";
import { createServer } from "node:net";
import { once } from "node:events";
import { setTimeout as delay } from "node:timers/promises";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { HoursReport, HoursRow } from "@happy-learners/contracts";
import { csvCell, effectiveDuration, hoursAdjustmentInput, hoursCsv, hoursDay, hoursFilterInput, hoursTotals, inHoursFilter, localDateTime } from "@happy-learners/domain";

// ST-152 (DEC-043): effective hours teaching classes. Domain rules first, then the built Worker in a store of its own.

describe("ST-152 effective duration of a class", () => {
  it("counts from the start to the completion, in whole minutes", () => {
    expect(effectiveDuration("2026-10-15T14:00:00.000Z", "2026-10-15T15:35:00.000Z")).toEqual({ computed: 95, minutes: 95, state: "counted" });
    expect(effectiveDuration("2026-10-15T14:00:00.000Z", "2026-10-15T14:00:29.000Z")).toEqual({ computed: 0, minutes: 0, state: "counted" });
    expect(effectiveDuration("2026-10-15T14:00:00.000Z", "2026-10-15T14:00:31.000Z").computed).toBe(1);
    expect(effectiveDuration("2026-10-15T14:00:00.000Z", "2026-10-15T22:00:00.000Z")).toEqual({ computed: 480, minutes: 480, state: "counted" });
  });
  it("counts 0 without a real start and asks for a review beyond 8 hours", () => {
    for (const start of [null, undefined, "", "no es fecha", "2026-10-15T15:00:00.000Z", "2026-10-15T16:00:00.000Z"])
      expect(effectiveDuration(start, "2026-10-15T15:00:00.000Z"), String(start)).toEqual({ computed: 0, minutes: 0, state: "no_start" });
    expect(effectiveDuration("2026-10-15T14:00:00.000Z", "2026-10-15T22:01:00.000Z")).toEqual({ computed: 481, minutes: 0, state: "review" });
  });
});

describe("ST-152 period in the organization's time zone", () => {
  it("a class counts on the calendar day of its start where the organization is", () => {
    // 03:00 UTC of 11 March is 21:00 of 10 March in Guatemala (UTC−06:00) and 12:00 of 11 March in Tokyo.
    expect(hoursDay("2026-03-11T03:00:00.000Z", "2026-03-11", "America/Guatemala")).toBe("2026-03-10");
    expect(hoursDay("2026-03-11T03:00:00.000Z", "2026-03-10", "Asia/Tokyo")).toBe("2026-03-11");
    expect(hoursDay(null, "2026-03-09", "America/Guatemala")).toBe("2026-03-09");
    expect(localDateTime("2026-03-11T03:05:00.000Z", "America/Guatemala")).toBe("2026-03-10 21:05");
    expect(localDateTime(null, "America/Guatemala")).toBe("");
  });
  it("filters by period (both limits included), course, section and person", () => {
    const row = { day: "2026-03-10", courseId: "c-1", sectionId: "s-1", educatorId: "u-1" };
    const filter = (query: string) => { const value = hoursFilterInput(new URLSearchParams(query)); if ("error" in value) throw new Error(value.error); return value; };
    expect(inHoursFilter(row, filter("from=2026-03-10&to=2026-03-10"))).toBe(true);
    expect(inHoursFilter(row, filter("from=2026-03-11"))).toBe(false);
    expect(inHoursFilter(row, filter("to=2026-03-09"))).toBe(false);
    expect(inHoursFilter(row, filter("course=c-1&section=s-1&person=u-1"))).toBe(true);
    expect(inHoursFilter(row, filter("person=u-2"))).toBe(false);
    for (const query of ["from=10/03/2026", "from=2026-03-11&to=2026-03-10", "course=<x>", "person=" + "a".repeat(101)]) expect(hoursFilterInput(new URLSearchParams(query)), query).toHaveProperty("error");
  });
});

describe("ST-152 corrections and export", () => {
  it("a correction needs whole minutes and a reason", () => {
    expect(hoursAdjustmentInput({ minutes: 90, reason: "  Olvidó   comenzar la clase " })).toEqual({ minutes: 90, educatorId: null, reason: "Olvidó comenzar la clase" });
    expect(hoursAdjustmentInput({ minutes: 0, educatorId: "user-1", reason: "No la impartió" })).toEqual({ minutes: 0, educatorId: "user-1", reason: "No la impartió" });
    for (const value of [null, { minutes: 90 }, { minutes: 90, reason: "abc" }, { minutes: 90, reason: "x".repeat(301) }, { minutes: -1, reason: "Motivo válido" }, { minutes: 721, reason: "Motivo válido" }, { minutes: 1.5, reason: "Motivo válido" }, { minutes: "90", reason: "Motivo válido" }, { minutes: 90, reason: "Motivo válido", educatorId: "Ana" }])
      expect(hoursAdjustmentInput(value), JSON.stringify(value)).toHaveProperty("error");
  });
  it("escapes CSV cells and neutralizes formulas", () => {
    expect(csvCell("Inglés A1")).toBe("Inglés A1");
    expect(csvCell('Sección "B", tarde')).toBe('"Sección ""B"", tarde"');
    expect(csvCell("línea\nnueva")).toBe('"línea\nnueva"');
    expect(csvCell("=HYPERLINK(\"x\")")).toBe("\"'=HYPERLINK(\"\"x\"\")\"");
    for (const formula of ["+1", "-1", "@SUM(A1)"]) expect(csvCell(formula)).toBe(`'${formula}`);
    expect(csvCell(-5)).toBe("-5");
    expect(csvCell(null)).toBe("");
  });
  it("exports UTF-8 with BOM, Spanish headers, local times and a total; totals group by person, course and section", () => {
    const base: HoursRow = { sessionId: "s", courseId: "c-1", courseTitle: "Inglés, nivel A1", sectionId: "g-1", sectionName: "Sección A", sessionDate: "2026-03-10", day: "2026-03-10", startedAt: "2026-03-11T03:00:00.000Z", completedAt: "2026-03-11T04:30:00.000Z", educatorId: "u-1", educatorName: "Ana", computedMinutes: 90, minutes: 90, state: "counted", adjustment: null, adjustments: 0 };
    const rows: HoursRow[] = [base, { ...base, sessionId: "t", sectionId: "g-2", sectionName: "Sección B", educatorId: "u-2", educatorName: "Luis", minutes: 30, computedMinutes: 600, state: "adjusted", adjustment: { minutesBefore: 0, minutesAfter: 30, educatorBefore: "u-2", educatorAfter: "u-2", reason: "Finalizó tarde, \"por error\"", adjustedBy: "Admin", adjustedAt: "2026-03-12T00:00:00.000Z" } }];
    const csv = hoursCsv(rows, "America/Guatemala");
    expect(csv.charCodeAt(0)).toBe(0xfeff);
    const lines = csv.slice(1).split("\r\n");
    expect(lines[0]).toBe("Fecha,Curso,Sección,Educador,Inicio,Finalización,Minutos calculados,Minutos efectivos,Horas efectivas,Estado,Motivo de la corrección");
    expect(lines[1]).toBe('2026-03-10,"Inglés, nivel A1",Sección A,Ana,2026-03-10 21:00,2026-03-10 22:30,90,90,1.50,Cuenta,');
    expect(lines[2]).toContain(',600,30,0.50,Corregida,"Finalizó tarde, ""por error"""');
    expect(lines[3]).toBe("Total,,,,,,,120,2.00,,");
    expect(hoursTotals(rows)).toEqual({
      people: [{ id: "u-1", name: "Ana", minutes: 90, classes: 1 }, { id: "u-2", name: "Luis", minutes: 30, classes: 1 }],
      courses: [{ id: "c-1", name: "Inglés, nivel A1", minutes: 120, classes: 2 }],
      sections: [{ id: "g-1", name: "Sección A (Inglés, nivel A1)", minutes: 90, classes: 1 }, { id: "g-2", name: "Sección B (Inglés, nivel A1)", minutes: 30, classes: 1 }],
    });
  });
});

let worker: ChildProcess;
let origin = "";
let logs = "";
const storage = mkdtempSync(join(tmpdir(), "hl-platform-hours-"));
beforeAll(async () => {
  const server = createServer();
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Missing local port");
  await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  origin = `http://127.0.0.1:${address.port}`;
  worker = spawn("node_modules/.bin/wrangler", ["dev", "--local", "--config", "build/wrangler.json", "--ip", "127.0.0.1", "--port", String(address.port), "--inspector-port", "0", "--persist-to", storage, "--var", "RESTORE_ENABLED:true"], {
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

const sha256 = (text: string) => createHash("sha256").update(text, "utf8").digest("hex");
async function login(username: string) {
  const response = await fetch(`${origin}/api/login`, { method: "POST", headers: { "Content-Type": "application/json", Origin: origin }, body: JSON.stringify({ username, password: "Aprender-2026!" }) });
  expect(response.status, await response.clone().text()).toBe(200);
  return response.headers.get("set-cookie")!.split(";")[0];
}
const call = (cookie: string, path: string, method = "GET", data?: unknown) =>
  fetch(origin + "/api" + path, { method, headers: { Cookie: cookie, Origin: origin, ...(data ? { "Content-Type": "application/json" } : {}) }, ...(data ? { body: JSON.stringify(data) } : {}) });
const read = async <T = Record<string, unknown>>(response: Response, status = 200): Promise<T> => { expect(response.status, await response.clone().text()).toBe(status); return response.json() as Promise<T>; };
const day = (offset: number) => new Date(Date.now() + offset * 86_400_000).toLocaleDateString("en-CA", { timeZone: "America/Guatemala" });
const report = async (cookie: string, query = "") => read<HoursReport>(await call(cookie, `/hours${query}`));
const row = (value: HoursReport, sessionId: string) => value.rows.find(item => item.sessionId === sessionId);

/** A course led by `leadId` with one section taught by them and daily classes for the next five days. */
async function section(admin: string, leadId: string, label: string) {
  const course = await read<{ id: string }>(await call(admin, "/courses", "POST", { title: `Horas ${label}`, objective: "Probar las horas efectivas.", status: "active", educationType: "non-formal", level: "unspecified", format: "workshop", modality: "in-person", pacing: "scheduled", area: "011", settings: { attendance: true }, programId: null, leadId }), 201);
  const path = `/courses/${course.id}`;
  const group = await read<{ id: string }>(await call(admin, `${path}/groups`, "POST", { name: `Sección ${label}` }), 201);
  await read(await call(admin, `${path}/groups/${group.id}/educators`, "PUT", { userIds: [leadId], conflictReason: "Secciones de prueba con el mismo horario." }));
  await read(await call(admin, `${path}/groups/${group.id}/schedule`, "PUT", { weekdays: [0, 1, 2, 3, 4, 5, 6], startsAt: "08:00", durationMinutes: 45, from: day(1), until: day(5) }));
  const { sessions } = await read<{ sessions: { id: string; groupId: string; sessionDate: string }[] }>(await call(admin, `${path}/sessions`));
  return { courseId: course.id, path, groupId: group.id, classes: sessions.filter(item => item.groupId === group.id).sort((a, b) => a.sessionDate.localeCompare(b.sessionDate)).map(item => item.id) };
}

let admin = "", educator = "", other = "";
let mine: Awaited<ReturnType<typeof section>>, theirs: Awaited<ReturnType<typeof section>>;
describe("ST-152 Controlar las horas efectivas impartiendo clases", () => {
  it("ST-152 CA1: las horas efectivas se calculan de cada clase impartida, desde su inicio hasta su finalización", async () => {
    admin = await login("admin-demo"); educator = await login("educador-demo"); other = await login("instructor-demo");
    await read(await call(admin, "/contract-settings", "PUT", { required: false }));
    mine = await section(admin, "user-educator", "propia"); theirs = await section(admin, "user-1", "ajena");
    const [a, b] = mine.classes, [c, d] = theirs.classes;
    // The educator starts and completes two classes; the other educator completes one straight from planned and teaches another.
    for (const id of [a, b]) { await read(await call(educator, `${mine.path}/sessions/${id}/start`, "POST")); await read(await call(educator, `${mine.path}/sessions/${id}/complete`, "POST")); }
    await read(await call(other, `${theirs.path}/sessions/${c}/complete`, "POST"));
    await read(await call(other, `${theirs.path}/sessions/${d}/start`, "POST")); await read(await call(other, `${theirs.path}/sessions/${d}/complete`, "POST"));
    const fresh = await report(educator);
    expect(row(fresh, a)).toMatchObject({ educatorId: "user-educator", state: "counted", courseId: mine.courseId, sectionId: mine.groupId, day: day(0) });
    expect(row(fresh, a)!.startedAt! < row(fresh, a)!.completedAt).toBe(true);

    // Real durations need real time: the timestamps are moved through a restore, as a long class would leave them.
    const backup = await read<{ tables: Record<string, { columns: string[]; rows: unknown[][] }>; digests: Record<string, string> }>(await call(admin, "/organization/backup"));
    expect(backup.tables.class_hour_adjustments).toBeDefined();
    const table = backup.tables.class_sessions, column = (name: string) => table.columns.indexOf(name);
    const times: Record<string, [string, string]> = {
      [a]: ["2026-03-11T03:00:00.000Z", "2026-03-11T04:35:00.000Z"], // 21:00–22:35 of 10 March in Guatemala: 95 min.
      [b]: ["2026-04-01T14:00:00.000Z", "2026-04-01T23:30:00.000Z"], // 9 h 30 min: to review.
      [d]: ["2026-04-02T15:00:00.000Z", "2026-04-02T16:00:00.000Z"], // 60 min.
    };
    for (const item of table.rows) { const found = times[String(item[column("id")])]; if (found) [item[column("started_at")], item[column("completed_at")]] = found; }
    backup.digests.class_sessions = sha256(table.columns.join(",") + "\n" + table.rows.map(item => JSON.stringify(item)).sort().join("\n"));
    await read(await call(admin, "/organization/restore", "POST", backup));
    admin = await login("admin-demo"); educator = await login("educador-demo"); other = await login("instructor-demo");

    const all = await report(admin);
    expect(all.scope).toBe("all");
    expect(all.timezone).toBe("America/Guatemala");
    expect(row(all, a)).toMatchObject({ computedMinutes: 95, minutes: 95, state: "counted", day: "2026-03-10", educatorName: expect.any(String) });
    expect(row(all, b)).toMatchObject({ computedMinutes: 570, minutes: 0, state: "review" });
    expect(row(all, c)).toMatchObject({ computedMinutes: 0, minutes: 0, state: "no_start", startedAt: null, educatorId: "user-1" });
    expect(row(all, d)).toMatchObject({ computedMinutes: 60, minutes: 60, state: "counted", educatorId: "user-1" });
    expect((await report(admin, `?course=${mine.courseId}`)).totals.people).toEqual([{ id: "user-educator", name: row(all, a)!.educatorName, minutes: 95, classes: 2 }]);
    expect((await report(admin, `?course=${theirs.courseId}`)).totals.people).toEqual([{ id: "user-1", name: row(all, d)!.educatorName, minutes: 60, classes: 2 }]);
    // Classes completed before this release (the demonstration's) have no real start: they are listed and count 0.
    const seeded = all.rows.filter(item => ![a, b, c, d].includes(item.sessionId));
    expect(seeded.length).toBeGreaterThan(0);
    expect(seeded.every(item => item.state === "no_start" && item.minutes === 0)).toBe(true);
  }, 30_000); // Backs up and restores the whole store: room for slow runners.

  it("ST-152 CA2: administración y cada educador consultan las horas por periodo, curso y sección, y las exportan", async () => {
    const [a, b] = mine.classes, [c, d] = theirs.classes;
    const ids = (value: HoursReport) => value.rows.map(item => item.sessionId).filter(id => [a, b, c, d].includes(id)).sort();
    // The period compares the day of the start in the organization's time zone: 03:00 UTC of 11 March is 10 March there.
    expect(ids(await report(admin, "?from=2026-03-10&to=2026-03-10"))).toEqual([a]);
    expect(ids(await report(admin, "?from=2026-03-11&to=2026-04-01"))).toEqual([b]);
    expect(ids(await report(admin, `?course=${theirs.courseId}`))).toEqual([c, d].sort());
    expect(ids(await report(admin, `?section=${mine.groupId}`))).toEqual([a, b].sort());
    expect(ids(await report(admin, "?person=user-1"))).toEqual([c, d].sort());
    const period = await report(admin, `?from=2026-04-01&to=2026-04-30&course=${theirs.courseId}`);
    expect(period.minutes).toBe(60);
    expect(period.totals.sections).toEqual([{ id: theirs.groupId, name: "Sección ajena (Horas ajena)", minutes: 60, classes: 1 }]);
    expect((await call(admin, "/hours?from=2026-04-30&to=2026-04-01")).status).toBe(400);

    // Each educator sees only their own classes, whatever they ask for.
    const own = await report(educator);
    expect(own.scope).toBe("own");
    expect(own.rows.every(item => item.educatorId === "user-educator")).toBe(true);
    expect(ids(own)).toEqual([a, b].sort());
    expect(own.options.people.map(item => item.id)).toEqual(["user-educator"]);
    expect((await report(educator, "?person=user-1")).rows).toEqual([]);
    expect(ids(await report(other, `?course=${mine.courseId}`))).toEqual([]);

    // The export: CSV in UTF-8 with BOM, Spanish headers, the same filters and the same visibility.
    const exported = await call(admin, `/hours/export?course=${theirs.courseId}`);
    expect(exported.status).toBe(200);
    expect(exported.headers.get("content-type")).toBe("text/csv; charset=utf-8");
    expect(exported.headers.get("content-disposition")).toBe('attachment; filename="horas-efectivas-todo.csv"');
    const bytes = new Uint8Array(await exported.arrayBuffer());
    expect([...bytes.slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
    const lines = new TextDecoder().decode(bytes.slice(3)).trim().split("\r\n");
    expect(lines[0]).toBe("Fecha,Curso,Sección,Educador,Inicio,Finalización,Minutos calculados,Minutos efectivos,Horas efectivas,Estado,Motivo de la corrección");
    expect(lines).toContain("2026-04-02,Horas ajena,Sección ajena,Instructor Demo,2026-04-02 09:00,2026-04-02 10:00,60,60,1.00,Cuenta,".replace("Instructor Demo", (await report(admin, "?person=user-1")).rows[0].educatorName!));
    expect(lines.at(-1)).toBe("Total,,,,,,,60,1.00,,");
    const dated = await call(educator, "/hours/export?from=2026-03-01&to=2026-03-31");
    expect(dated.headers.get("content-disposition")).toBe('attachment; filename="horas-efectivas-2026-03-01_a_2026-03-31.csv"');
    const text = await dated.text();
    expect(text).toContain("Sección propia");
    expect(text).not.toContain("Sección ajena");
    expect(text.trim().split("\r\n").at(-1)).toBe("Total,,,,,,,95,1.58,,");
  });

  it("ST-152 CA3: una clase cancelada o sin finalizar no suma horas y cada corrección con su motivo queda en la actividad", async () => {
    const [a, b, , cancelled, running] = mine.classes, [c] = theirs.classes;
    const before = await report(admin);
    await read(await call(educator, `${mine.path}/sessions/${cancelled}/cancel`, "POST"));
    await read(await call(educator, `${mine.path}/sessions/${running}/start`, "POST"));
    const after = await report(admin);
    expect(row(after, cancelled)).toBeUndefined();
    expect(row(after, running)).toBeUndefined();
    expect(after.minutes).toBe(before.minutes);
    for (const id of [cancelled, running]) expect((await call(admin, `/hours/${id}/adjustment`, "POST", { minutes: 45, reason: "Intento de corrección" })).status).toBe(409);
    expect((await call(admin, "/hours/class-missing/adjustment", "POST", { minutes: 45, reason: "Clase inexistente" })).status).toBe(404);

    // Only administration corrects, always with a reason.
    expect((await call(educator, `/hours/${b}/adjustment`, "POST", { minutes: 120, reason: "Me corrijo a mí mismo" })).status).toBe(403);
    expect((await call(admin, `/hours/${b}/adjustment`, "POST", { minutes: 120 })).status).toBe(400);
    expect((await call(admin, `/hours/${b}/adjustment`, "POST", { minutes: 120, reason: "  " })).status).toBe(400);
    expect((await call(admin, `/hours/${b}/adjustment`, "POST", { minutes: 0, reason: "Sin cambios reales" })).status).toBe(400);
    expect((await call(admin, `/hours/${b}/adjustment`, "POST", { minutes: 120, educatorId: "user-missing", reason: "Persona inexistente" })).status).toBe(400);

    // The long class counts what administration reviewed; the class without a start goes to who really taught it.
    const corrected = await read<{ row: HoursRow }>(await call(admin, `/hours/${b}/adjustment`, "POST", { minutes: 120, reason: "Olvidó finalizarla al terminar" }));
    expect(corrected.row).toMatchObject({ minutes: 120, computedMinutes: 570, state: "adjusted", adjustments: 1, adjustment: { minutesBefore: 0, minutesAfter: 120, reason: "Olvidó finalizarla al terminar" } });
    await read(await call(admin, `/hours/${c}/adjustment`, "POST", { minutes: 45, educatorId: "user-educator", reason: "La impartió el educador suplente" }));
    const own = await report(educator);
    expect(own.minutes).toBe(95 + 120 + 45);
    expect(row(own, c)).toMatchObject({ educatorId: "user-educator", minutes: 45, state: "adjusted" });
    expect(row(await report(other), c)).toBeUndefined();
    // A second correction keeps the first: the latest is in force.
    const again = await read<{ row: HoursRow }>(await call(admin, `/hours/${b}/adjustment`, "POST", { minutes: 110, reason: "Revisión con la coordinación" }));
    expect(again.row).toMatchObject({ minutes: 110, adjustments: 2, adjustment: { minutesBefore: 120 } });
    expect(row(await report(admin), a)).toMatchObject({ minutes: 95, state: "counted" });

    const { events } = await read<{ events: { action: string; summary: string }[] }>(await call(admin, `/activity?section=${mine.groupId}&limit=100`));
    const summaries = events.filter(item => item.summary.startsWith("Corrigió las horas efectivas")).map(item => item.summary);
    expect(summaries).toEqual(expect.arrayContaining([expect.stringContaining("0 min → 2 h. Motivo: Olvidó finalizarla al terminar"), expect.stringContaining("2 h → 1 h 50 min. Motivo: Revisión con la coordinación")]));
    expect(events.find(item => item.summary.includes("Revisión con la coordinación"))!.action).toBe("updated");
    const moved = (await read<{ events: { summary: string }[] }>(await call(admin, `/activity?section=${theirs.groupId}&limit=100`))).events.find(item => item.summary.startsWith("Corrigió las horas efectivas"))!;
    expect(moved.summary).toMatch(/0 min → 45 min, atribuidas a .+\. Motivo: La impartió el educador suplente$/);
    // The backup carries every correction.
    const backup = await read<{ tables: Record<string, { columns: string[]; rows: unknown[][] }> }>(await call(admin, "/organization/backup"));
    expect(backup.tables.class_hour_adjustments.rows).toHaveLength(3);
    expect(backup.tables.class_hour_adjustments.columns).toEqual(["id", "organization_id", "session_id", "minutes_before", "minutes_after", "educator_before", "educator_after", "reason", "adjusted_by", "adjusted_at"]);
  });
});
