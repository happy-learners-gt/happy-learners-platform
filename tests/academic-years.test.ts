import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn, type ChildProcess } from "node:child_process";
import { createServer } from "node:net";
import { once } from "node:events";
import { setTimeout as delay } from "node:timers/promises";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { AcademicYear } from "../packages/contracts/src/index";
import { academicYearInput, academicYearTransition, activationBlocker, nextAcademicYear, nextYearDay, periodName, scheduleSuggestion, splitPeriods } from "../packages/domain/src/index";

// The organization's school year (ciclo lectivo) and its periods: draft → current → closed, one current year per
// organization, periods within the year and without overlaps, and the next year opened empty with the same pattern.
const year2027 = { name: "Ciclo 2027", from: "2027-01-11", until: "2027-10-22", periodKind: "bimester" as const };
const four = splitPeriods(year2027.from, year2027.until, "bimester");

describe("school year rules", () => {
  it("divides a year into consecutive periods named after their kind", () => {
    expect(four.map(period => period.name)).toEqual(["Primer bimestre", "Segundo bimestre", "Tercer bimestre", "Cuarto bimestre"]);
    expect(four[0].from).toBe("2027-01-11");
    expect(four[3].until).toBe("2027-10-22");
    for (let index = 1; index < four.length; index++) expect(Date.parse(four[index].from) - Date.parse(four[index - 1].until)).toBe(86400000);
    expect(periodName("unit", 1)).toBe("Primera unidad");
    expect(periodName("unit", 3)).toBe("Tercera unidad");
    expect(periodName("unit", 2)).toBe("Segunda unidad");
    expect(splitPeriods("2027-01-11", "2027-07-09", "semester").map(period => period.name)).toEqual(["Primer semestre", "Segundo semestre"]);
  });

  it("accepts a valid year and returns its periods in order", () => {
    const result = academicYearInput({ ...year2027, name: "  Ciclo   2027 ", periods: [four[2], four[0], four[3], four[1]] });
    expect(result).toEqual({ ...year2027, periods: four });
  });

  it("rejects invalid dates, periods outside the year, overlaps and repeated names", () => {
    const error = (patch: Record<string, unknown>) => (academicYearInput({ ...year2027, periods: four, ...patch }) as { error: string }).error;
    expect(error({ name: "C" })).toContain("nombre del ciclo");
    expect(error({ from: "2027-02-30" })).toContain("fechas de inicio y de fin");
    expect(error({ until: "2027-01-11" })).toContain("posterior");
    expect(error({ from: "2027-01-01", until: "2028-01-02" })).toContain("hasta un año");
    expect(academicYearInput({ ...year2027, from: "2027-01-01", until: "2028-01-01", periods: [] })).not.toHaveProperty("error");
    expect(error({ periodKind: "quarter" })).toContain("bimestres");
    expect(error({ periods: [{ ...four[0], from: "2027-01-04" }] })).toContain("dentro de las fechas del ciclo");
    expect(error({ periods: [{ ...four[3], until: "2027-10-30" }] })).toContain("dentro de las fechas del ciclo");
    expect(error({ periods: [four[0], { ...four[1], from: four[0].until }] })).toContain("se traslapan");
    expect(error({ periods: [{ ...four[0], until: "2027-01-10" }] })).toContain("igual o posterior");
    expect(error({ periods: [four[0], { ...four[1], name: "primer BIMESTRE" }] })).toContain("nombre distinto");
    expect(error({ periods: [{ ...four[0], id: "year-1" }] })).toContain("no es válido");
    expect(error({ periods: Array.from({ length: 13 }, () => four[0]) })).toContain("hasta 12");
  });

  it("moves only forward and activates a draft with periods when no other year is current", () => {
    expect(academicYearTransition("draft", "activate")).toBe("current");
    expect(academicYearTransition("current", "close")).toBe("closed");
    expect(academicYearTransition("draft", "close")).toBeNull();
    expect(academicYearTransition("closed", "activate")).toBeNull();
    expect(academicYearTransition("current", "activate")).toBeNull();
    expect(activationBlocker({ status: "draft", periods: four }, false)).toBeNull();
    expect(activationBlocker({ status: "draft", periods: four }, true)).toContain("Ya hay un ciclo vigente");
    expect(activationBlocker({ status: "draft", periods: [] }, false)).toContain("al menos un periodo");
    expect(activationBlocker({ status: "closed", periods: four }, false)).toContain("cerrado");
  });

  it("opens the next year one year later with the same pattern and nothing else", () => {
    const next = nextAcademicYear({ ...year2027, periods: four });
    expect(next.name).toBe("Ciclo 2028");
    expect(next.from).toBe("2028-01-11");
    expect(next.periods.map(period => period.name)).toEqual(four.map(period => period.name));
    expect(next.periods.every(period => period.id === null)).toBe(true);
    expect(Object.keys(next).sort()).toEqual(["from", "name", "periodKind", "periods", "until"]);
    expect(nextYearDay("2028-02-29")).toBe("2029-02-28");
    expect(nextAcademicYear({ ...year2027, name: "Ciclo escolar", periods: [] }).name).toBe("Ciclo escolar (siguiente)");
    expect(academicYearInput(next)).not.toHaveProperty("error");
  });

  it("suggests a schedule from today or the start of the current year until its end", () => {
    expect(scheduleSuggestion(year2027, "2026-10-26")).toEqual({ from: "2027-01-11", until: "2027-10-22" });
    expect(scheduleSuggestion(year2027, "2027-03-01")).toEqual({ from: "2027-03-01", until: "2027-10-22" });
    expect(scheduleSuggestion(year2027, "2027-11-01")).toBeNull();
    expect(scheduleSuggestion(null, "2027-03-01")).toBeNull();
  });
});

let worker: ChildProcess;
let origin = "";
let logs = "";
const storage = mkdtempSync(join(tmpdir(), "hl-platform-academic-years-"));
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
async function signIn(username: string) {
  const response = await fetch(`${origin}/api/login`, { method: "POST", headers: { "Content-Type": "application/json", Origin: origin }, body: JSON.stringify({ username, password }) });
  return response.status === 200 ? response.headers.get("set-cookie")!.split(";")[0] : null;
}
async function as(cookie: string | null, path: string, method = "GET", data?: unknown) {
  return fetch(`${origin}/api${path}`, { method, headers: { Cookie: cookie || "", Origin: origin, ...(data !== undefined ? { "Content-Type": "application/json" } : {}) }, ...(data !== undefined ? { body: JSON.stringify(data) } : {}) });
}
const read = async <T = Record<string, unknown>>(response: Response, status = 200) => { const text = await response.text(); expect(response.status, text).toBe(status); return JSON.parse(text) as T; };
const errorOf = async (response: Response, status: number) => (await read<{ error: string }>(response, status)).error;

describe("school year on the built Worker", () => {
  it("administration creates «Ciclo 2027» with four bimestres, activates, closes and opens the next one; others only read", async () => {
    const admin = await signIn("admin-demo"), educator = await signIn("educador-demo"), external = await signIn("admin-externo");
    // The demo starts with the pilot seed (0054): «Ciclo 2026» current and «Ciclo 2027» as a draft. This flow starts clean.
    const seeded = (await read<{ years: AcademicYear[] }>(await as(admin, "/academic-years"))).years;
    expect(seeded.map(item => [item.name, item.status])).toEqual([["Ciclo 2027", "draft"], ["Ciclo 2026", "current"]]);
    await read(await as(admin, `/academic-years/${seeded[1].id}/close`, "POST"));
    await read(await as(admin, `/academic-years/${seeded[0].id}`, "DELETE"));
    expect((await read<{ years: AcademicYear[] }>(await as(educator, "/academic-years"))).years.map(item => item.status)).toEqual(["closed"]);
    expect(await errorOf(await as(educator, "/academic-years", "POST", { ...year2027, periods: four }), 403)).toContain("Solo administración");
    expect((await as(null, "/academic-years")).status).toBe(401);

    // Validation happens on the server.
    expect(await errorOf(await as(admin, "/academic-years", "POST", { ...year2027, until: "2026-12-31", periods: [] }), 400)).toContain("posterior");
    expect(await errorOf(await as(admin, "/academic-years", "POST", { ...year2027, periods: [four[0], { ...four[1], from: four[0].from }] }), 400)).toContain("se traslapan");
    expect(await errorOf(await as(admin, "/academic-years", "POST", { ...year2027, periods: [{ ...four[0], from: "2026-12-01" }] }), 400)).toContain("dentro de las fechas");

    const { year } = await read<{ year: AcademicYear }>(await as(admin, "/academic-years", "POST", { ...year2027, periods: four }), 201);
    expect(year).toMatchObject({ name: "Ciclo 2027", status: "draft", periodKind: "bimester", activatedAt: null });
    expect(year.periods.map(period => [period.position, period.name])).toEqual([[1, "Primer bimestre"], [2, "Segundo bimestre"], [3, "Tercer bimestre"], [4, "Cuarto bimestre"]]);
    expect(await errorOf(await as(admin, "/academic-years", "POST", { ...year2027, name: "ciclo 2027", periods: [] }), 409)).toContain("Ya existe");

    // Editing keeps each period's id; a period of another year is refused.
    const renamed = year.periods.map(period => ({ ...period, name: period.name.replace("bimestre", "bimestre (B)") }));
    const { year: edited } = await read<{ year: AcademicYear }>(await as(admin, `/academic-years/${year.id}`, "PUT", { ...year2027, periods: renamed }));
    expect(edited.periods.map(period => period.id)).toEqual(year.periods.map(period => period.id));
    expect(edited.periods[0].name).toBe("Primer bimestre (B)");

    // Activation: a draft with periods, at most one current year.
    const { year: current } = await read<{ year: AcademicYear }>(await as(admin, `/academic-years/${year.id}/activate`, "POST"));
    expect(current.status).toBe("current");
    const { year: other } = await read<{ year: AcademicYear }>(await as(admin, "/academic-years", "POST", { name: "Ciclo 2028", from: "2028-01-10", until: "2028-10-20", periodKind: "semester", periods: [] }), 201);
    expect(await errorOf(await as(admin, `/academic-years/${other.id}/activate`, "POST"), 409)).toContain("Ya hay un ciclo vigente");
    expect(await errorOf(await as(admin, `/academic-years/${year.id}`, "PUT", { ...year2027, periods: [{ ...four[0], id: `period-${"0".repeat(8)}-0000-0000-0000-${"0".repeat(12)}` }] }), 400)).toContain("no es de este ciclo");
    expect(await errorOf(await as(admin, `/academic-years/${year.id}`, "PUT", { ...year2027, periods: [] }), 400)).toContain("al menos un periodo");
    expect(await errorOf(await as(admin, `/academic-years/${year.id}`, "DELETE"), 409)).toContain("Solo se elimina un ciclo en borrador");
    await read(await as(admin, `/academic-years/${other.id}`, "DELETE"));

    // Another organization neither sees nor touches it; an educator reads but does not act.
    expect(await read<{ years: AcademicYear[] }>(await as(external, "/academic-years"))).toMatchObject({ years: [] });
    expect((await as(external, `/academic-years/${year.id}`, "PUT", { ...year2027, periods: four })).status).toBe(404);
    expect((await as(external, `/academic-years/${year.id}/close`, "POST")).status).toBe(404);
    expect((await as(educator, `/academic-years/${year.id}/close`, "POST")).status).toBe(403);
    expect((await read<{ years: AcademicYear[] }>(await as(educator, "/academic-years"))).years.map(item => item.status)).toEqual(["current", "closed"]);

    // Section schedules keep working with their own dates, apart from the year.
    const course = (await read<{ id: string }>(await as(admin, "/courses", "POST", { title: "Curso del ciclo", objective: "El horario conserva sus fechas.", status: "active", educationType: "non-formal", level: "unspecified", format: "workshop", modality: "in-person", pacing: "scheduled", area: "011", settings: { attendance: true }, programId: null, leadId: "user-educator" }), 201)).id;
    const group = (await read<{ id: string }>(await as(admin, `/courses/${course}/groups`, "POST", { name: "Primero A" }), 201)).id;
    const schedule = { weekdays: [1, 3], startsAt: "08:00", durationMinutes: 45, from: "2026-11-02", until: "2026-11-27" };
    expect((await read<{ classes: number }>(await as(admin, `/courses/${course}/groups/${group}/schedule`, "PUT", schedule))).classes).toBe(8);
    const sectionsBefore = await read(await as(admin, "/sections"));

    // Closing promotes nobody and the next year copies only its pattern of periods.
    const { year: closed } = await read<{ year: AcademicYear }>(await as(admin, `/academic-years/${year.id}/close`, "POST"));
    expect(closed.status).toBe("closed");
    expect(await errorOf(await as(admin, `/academic-years/${year.id}`, "PUT", { ...year2027, periods: four }), 409)).toContain("cerrado");
    expect((await as(admin, `/academic-years/${year.id}/activate`, "POST")).status).toBe(409);
    expect((await as(admin, `/academic-years/${year.id}`, "DELETE")).status).toBe(409);
    const { year: next } = await read<{ year: AcademicYear }>(await as(admin, `/academic-years/${year.id}/next`, "POST"), 201);
    expect(next).toMatchObject({ name: "Ciclo 2028", status: "draft", from: "2028-01-11", until: "2028-10-22", periodKind: "bimester" });
    expect(next.periods.map(period => period.name)).toEqual(closed.periods.map(period => period.name));
    expect(next.periods.some(period => closed.periods.some(old => old.id === period.id))).toBe(false);
    expect(await read(await as(admin, "/sections"))).toEqual(sectionsBefore);
    const { section } = await read<{ section: { schedule: typeof schedule } }>(await as(admin, `/sections/${group}`));
    expect(section.schedule).toMatchObject(schedule);
    expect((await read<{ year: AcademicYear }>(await as(admin, `/academic-years/${next.id}/activate`, "POST"))).year.status).toBe("current");
  }, 30_000); // The whole life of a year in one flow: room for slow runners.
});
