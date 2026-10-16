import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn, type ChildProcess } from "node:child_process";
import { createServer } from "node:net";
import { once } from "node:events";
import { setTimeout as delay } from "node:timers/promises";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { departureDate, departureReason } from "../packages/domain/src/index";

// ST-123 (HL-169): a person leaves the team. Domain rules first, then the built Worker on a fresh local store.
describe("HL-169 departure rules", () => {
  it("CA1 the departure date is a real day, today or earlier; the reason is optional and short", () => {
    expect(departureDate("2026-09-30", "2026-10-15")).toBe("2026-09-30");
    expect(departureDate("2026-10-15", "2026-10-15")).toBe("2026-10-15");
    for (const value of ["2026-10-16", "2026-02-30", "2026-9-30", "1999-12-31", "", null, 20260930]) expect(departureDate(value, "2026-10-15"), String(value)).toBeNull();
    expect(departureReason(undefined)).toBe("");
    expect(departureReason("  Cambio   de ciudad ")).toBe("Cambio de ciudad");
    for (const value of ["x".repeat(301), "<b>no</b>", 3]) expect(departureReason(value)).toBeNull();
  });
});

let worker: ChildProcess;
let origin = "";
let logs = "";
const storage = mkdtempSync(join(tmpdir(), "hl-platform-departures-"));
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

async function signIn(username: string, password = "Aprender-2026!") {
  const response = await fetch(`${origin}/api/login`, { method: "POST", headers: { "Content-Type": "application/json", Origin: origin }, body: JSON.stringify({ username, password }) });
  return response.status === 200 ? response.headers.get("set-cookie")!.split(";")[0] : null;
}
async function as(cookie: string | null, path: string, method = "GET", data?: unknown) {
  return fetch(`${origin}/api${path}`, { method, headers: { Cookie: cookie || "", Origin: origin, ...(data ? { "Content-Type": "application/json" } : {}) }, ...(data ? { body: JSON.stringify(data) } : {}) });
}
const summaries = async (cookie: string | null, query = "") => (await (await as(cookie, `/activity?limit=100${query}`)).json()).events.map((event: { summary: string }) => event.summary) as string[];
type Row = { id: string; username: string; active: boolean; mustChangePassword?: true; events: number; lessonsCreated: number; publications: number; lastActivity: string | null; leads: number; departedOn?: string };
const people = async (cookie: string | null) => (await (await as(cookie, "/members")).json()).members as Row[];


type Preview = { member: { id: string; name: string; active: boolean }; today: string; courses: { id: string; title: string; role: string; team: { id: string }[] }[]; sections: { id: string; name: string; courseId: string; required: boolean; others: { id: string }[] }[]; people: { id: string; name: string }[] };
type Progress = { courseId: string; lessons: number; team: { userId: string; role: string }[] };
const progressOf = async (cookie: string | null) => (await (await as(cookie, "/progress")).json()).courses as Progress[];
const educatorsOf = async (cookie: string | null, section: string) => ((await (await as(cookie, `/sections/${section}`)).json()).section.educators as { userId: string }[]).map(item => item.userId).sort();
const backupOf = async (cookie: string | null) => JSON.parse(await (await as(cookie, "/organization/backup")).text()) as { tables: Record<string, { columns: string[]; rows: unknown[][] }> };
const departed = "2026-09-30", reason = "Se muda a otra ciudad por motivos familiares";

describe("HL-169 ST-123 departures on the built Worker", () => {
  let diego = "", sofia = "", lucia = "", preview: Preview;
  it("CA2 la vista previa enumera lo que dirige e imparte, y sin reasignaciones completas la salida responde 409 con lo que falta", async () => {
    const admin = await signIn("admin-demo");
    const members = await people(admin);
    diego = members.find(row => row.username === "diego.ramirez")!.id; sofia = members.find(row => row.username === "sofia.castillo")!.id; lucia = members.find(row => row.username === "lucia.herrera")!.id;
    expect((await as(await signIn("carlos.mejia"), `/members/${diego}/departure`)).status).toBe(403);
    const response = await as(admin, `/members/${diego}/departure`);
    expect(response.status).toBe(200);
    preview = await response.json();
    expect(preview.member).toMatchObject({ id: diego, name: "Diego Ramírez", active: true });
    const leads = preview.courses.filter(course => course.role === "lead").map(course => course.id).sort();
    expect(leads).toEqual(["seed-course-programacion-1", "seed-course-programacion-2", "seed-course-programacion-3", "seed-course-programacion-4", "seed-course-robotica"]);
    expect(preview.sections.filter(section => section.required).map(section => section.id)).toEqual(["seed-group-rob-mar"]);
    expect(preview.people.map(person => person.id)).not.toContain(diego);
    expect(JSON.stringify(preview)).not.toContain("password");

    // Nothing reassigned: 409 with every course and section that needs someone; nothing changes.
    let refused = await as(admin, `/members/${diego}/departure`, "POST", { date: departed, reason, reassignments: { courses: {}, sections: {} } });
    expect(refused.status).toBe(409);
    let body = await refused.json();
    expect(body.missing.courses.map((item: { id: string }) => item.id).sort()).toEqual(leads);
    expect(body.missing.sections.map((item: { id: string }) => item.id)).toEqual(["seed-group-rob-mar"]);
    expect(body.error).toContain("5 cursos necesitan una nueva persona responsable y 1 sección necesita quien la imparta");
    // Courses only: the section is still missing.
    const courses = Object.fromEntries(leads.map(id => [id, sofia]));
    refused = await as(admin, `/members/${diego}/departure`, "POST", { date: departed, reassignments: { courses, sections: {} } });
    expect(refused.status).toBe(409);
    body = await refused.json();
    expect(body.missing).toEqual({ courses: [], sections: [{ id: "seed-group-rob-mar", name: expect.any(String), courseTitle: "Taller de robótica educativa" }] });
    // Invalid choices and dates are refused before anything is written.
    const sections = { "seed-group-rob-mar": lucia };
    for (const [input, status] of [
      [{ date: "2999-01-01", reassignments: { courses, sections } }, 400],
      [{ date: "2026-02-30", reassignments: { courses, sections } }, 400],
      [{ date: departed, reason: "x".repeat(301), reassignments: { courses, sections } }, 400],
      [{ date: departed, reassignments: { courses: { ...courses, "seed-course-robotica": diego }, sections } }, 400],
      [{ date: departed, reassignments: { courses: { ...courses, "seed-course-robotica": "user-missing" }, sections } }, 400],
      [{ date: departed, reassignments: { courses: { ...courses, "seed-course-arte": sofia }, sections } }, 400],
    ] as const) expect((await as(admin, `/members/${diego}/departure`, "POST", input)).status, JSON.stringify(input).slice(0, 120)).toBe(status);
    expect((await as(admin, "/members/user-0/departure", "POST", { date: departed, reassignments: { courses: {}, sections: {} } })).status).toBe(409);
    const marta = await signIn("marta.ruiz"), martaId = members.find(row => row.username === "marta.ruiz")!.id;
    expect((await as(marta, `/members/${martaId}/departure`, "POST", { date: departed, reassignments: { courses: {}, sections: {} } })).status).toBe(409);
    expect((await people(admin)).find(row => row.id === diego)).toMatchObject({ active: true });
    expect(await signIn("diego.ramirez")).not.toBeNull();
  });

  it("CA1 CA3 la salida se registra con su fecha, reasigna cursos y secciones, quita el acceso y conserva el historial", async () => {
    const admin = await signIn("admin-demo"), session = await signIn("diego.ramirez");
    const before = (await people(admin)).find(row => row.id === diego)!;
    const history = await summaries(admin, `&actor=${diego}`);
    const lessons = Object.fromEntries((await progressOf(admin)).map(course => [course.courseId, course.lessons]));
    expect(before.lessonsCreated).toBeGreaterThan(0);
    const leads = preview.courses.filter(course => course.role === "lead").map(course => course.id);
    const response = await as(admin, `/members/${diego}/departure`, "POST", {
      date: departed, reason, conflictReason: "Prueba de salida: se acepta el choque de horario.",
      reassignments: { courses: Object.fromEntries(leads.map(id => [id, sofia])), sections: { "seed-group-rob-mar": lucia } },
    });
    expect(response.status, await response.clone().text()).toBe(200);
    expect(await response.json()).toMatchObject({ ok: true, departedOn: departed, reassigned: { courses: 5, sections: 1 } });

    // CA1: access ends at once and the date is recorded.
    expect((await as(session, "/session")).status).toBe(401);
    expect(await signIn("diego.ramirez")).toBeNull();
    const after = (await people(admin)).find(row => row.id === diego)!;
    expect(after).toMatchObject({ active: false, departedOn: departed, leads: 0 });
    const backup = await backupOf(admin);
    const table = backup.tables.departures, row = table.rows.find(item => item[table.columns.indexOf("user_id")] === diego)!;
    expect(row[table.columns.indexOf("departed_on")]).toBe(departed);
    expect(row[table.columns.indexOf("reason")]).toBe(reason);

    // Reassignments: each course keeps exactly one lead, the section has its replacement, nobody keeps Diego.
    const progress = await progressOf(admin);
    for (const id of leads) {
      const team = progress.find(course => course.courseId === id)!.team;
      expect(team.filter(member => member.role === "lead").map(member => member.userId), id).toEqual([sofia]);
      expect(team.map(member => member.userId)).not.toContain(diego);
    }
    expect(progress.find(course => course.courseId === "seed-course-robotica")!.team).toEqual(expect.arrayContaining([expect.objectContaining({ userId: lucia, role: "co-teacher" })]));
    expect(await educatorsOf(admin, "seed-group-rob-mar")).toEqual([lucia]);

    // CA3: everything Diego did stays; the departure and each reassignment are in the activity, without the reason.
    expect(after).toMatchObject({ lessonsCreated: before.lessonsCreated, publications: before.publications, events: before.events, lastActivity: before.lastActivity });
    expect(await summaries(admin, `&actor=${diego}`)).toEqual(history);
    expect(Object.fromEntries(progress.map(course => [course.courseId, course.lessons]))).toEqual(lessons);
    const feed = await summaries(admin);
    expect(feed).toContain(`Registró la salida de Diego Ramírez el ${departed}`);
    expect(feed.filter(summary => summary === "Nombró a Sofía Castillo responsable del curso por la salida de Diego Ramírez")).toHaveLength(5);
    expect(feed.some(summary => summary.startsWith("Asignó a Lucía Herrera a «") && summary.endsWith("» por la salida de Diego Ramírez"))).toBe(true);
    const activity = await (await as(admin, "/activity?limit=100")).text();
    expect(activity).not.toContain(reason);
    // Educators see the change in their courses, not the account event.
    const sofiaFeed = await summaries(await signIn("sofia.castillo"));
    expect(sofiaFeed).toContain("Nombró a Sofía Castillo responsable del curso por la salida de Diego Ramírez");
    expect(sofiaFeed.filter(summary => summary.startsWith("Registró la salida"))).toEqual([]);

    // Recorded once; reactivating keeps the record.
    expect((await as(admin, `/members/${diego}/departure`, "POST", { date: departed, reassignments: { courses: {}, sections: {} } })).status).toBe(409);
    expect((await as(admin, `/members/${diego}`, "PUT", { role: "educator", active: true })).status).toBe(200);
    expect(await signIn("diego.ramirez")).not.toBeNull();
    expect((await people(admin)).find(row => row.id === diego)).toMatchObject({ active: true, departedOn: departed, leads: 0 });
  });

  it("CA2 un nuevo responsable que ya colabora pasa a dirigir y las secciones compartidas siguen con sus otros educadores", async () => {
    const admin = await signIn("admin-demo"), members = await people(admin);
    const carlos = members.find(row => row.username === "carlos.mejia")!.id;
    const view = await (await as(admin, `/members/${carlos}/departure`)).json() as Preview;
    expect(view.courses.map(course => [course.id, course.role])).toEqual([["seed-course-ciencias", "lead"], ["seed-course-matematicas", "co-teacher"]]);
    expect(view.sections.every(section => !section.required && section.others.some(person => person.id === lucia))).toBe(true);
    // A coordination profile and a security group (ST-128, ST-135) end with the departure and do not come back.
    expect((await as(admin, `/members/${carlos}/coordination`, "PUT", { enabled: true, scope: { all: true } })).status).toBe(200);
    const group = await (await as(admin, "/access/groups", "POST", { name: "E2E · Salida", description: "Grupo de prueba de la salida" })).json() as { group: { id: string } };
    expect((await as(admin, `/access/groups/${group.group.id}/members`, "PUT", { userIds: [carlos] })).status).toBe(200);
    const response = await as(admin, `/members/${carlos}/departure`, "POST", { date: view.today, reassignments: { courses: { "seed-course-ciencias": lucia }, sections: {} } });
    expect(response.status, await response.clone().text()).toBe(200);
    const backup = await backupOf(admin), userColumn = (table: string) => backup.tables[table].columns.indexOf("user_id");
    for (const table of ["coordination_scopes", "security_group_members"]) expect(backup.tables[table].rows.filter(row => row[userColumn(table)] === carlos), table).toEqual([]);
    const access = backup.tables.access_events, summary = access.columns.indexOf("summary");
    expect(access.rows.map(row => row[summary])).toContain("Retiró la coordinación y los grupos de Carlos Mejía por su salida");
    const progress = await progressOf(admin);
    expect(progress.find(course => course.courseId === "seed-course-ciencias")!.team.map(member => [member.userId, member.role])).toEqual([[lucia, "lead"]]);
    expect(progress.find(course => course.courseId === "seed-course-matematicas")!.team.map(member => member.userId)).toEqual([lucia]);
    for (const section of ["seed-group-cie-4a", "seed-group-mat-3a", "seed-group-mat-3b"]) expect(await educatorsOf(admin, section), section).toEqual([lucia]);
    expect(await summaries(admin)).toContain("Carlos Mejía dejó el equipo docente por su salida");
  });
});
