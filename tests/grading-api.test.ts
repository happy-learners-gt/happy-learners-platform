import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn, type ChildProcess } from "node:child_process";
import { createServer } from "node:net";
import { once } from "node:events";
import { setTimeout as delay } from "node:timers/promises";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Course, Gradebook, OrganizationGradingScheme } from "../packages/contracts/src/index";
import { schemeTemplates } from "../packages/domain/src/index";

let worker: ChildProcess;
let origin = "", logs = "";
const storage = mkdtempSync(join(tmpdir(), "hl-platform-grading-api-"));
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
    try { if ((await fetch(`${origin}/api/health`, { signal: AbortSignal.timeout(500) })).ok) return; } catch { /* Wait for the runtime. */ }
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
const read = async <T>(response: Response, status = 200) => { const text = await response.text(); expect(response.status, text).toBe(status); return JSON.parse(text) as T; };
const errorOf = async (response: Response, status: number) => (await read<{ error: string }>(response, status)).error;

describe("data-driven grading on the built Worker", () => {
  it("stores schemes, weighted marks, retakes, exemptions and a private three-person panel", async () => {
    const admin = await signIn("admin-demo"), educator = await signIn("educador-demo"), carlos = await signIn("carlos.mejia");
    const outsider = await signIn("lucia.herrera"), external = await signIn("admin-externo");
    const university = schemeTemplates.find(item => item.id === "universidad")!;
    const created = await read<{ scheme: OrganizationGradingScheme }>(await as(admin, "/grading-schemes", "POST", university), 201);
    const schemeId = created.scheme.id;
    expect(created.scheme).toMatchObject({ name: university.name, builtin: false, status: "active" });
    expect((await read<{ schemes: OrganizationGradingScheme[] }>(await as(educator, "/grading-schemes"))).schemes.map(item => item.id)).toContain(schemeId);
    expect(await errorOf(await as(educator, "/grading-schemes", "POST", university), 403)).toContain("Solo administración");
    expect((await read<{ schemes: unknown[] }>(await as(external, "/grading-schemes"))).schemes).toEqual([]);

    const course = (await read<{ id: string }>(await as(admin, "/courses", "POST", {
      title: "Evaluación universitaria", objective: "Evaluar con categorías.", status: "active", educationType: "non-formal",
      level: "bachelor", format: "subject", modality: "in-person", pacing: "scheduled", area: "011",
      settings: { attendance: true, gradingSchemeId: schemeId }, programId: null, leadId: "user-educator",
    }), 201)).id;
    const group = (await read<{ id: string }>(await as(admin, `/courses/${course}/groups`, "POST", { name: "Grupo U" }), 201)).id;
    await read(await as(admin, `/courses/${course}/groups/${group}/educators`, "PUT", { userIds: ["user-educator"] }));
    const learner = (await read<{ id: string }>(await as(admin, `/courses/${course}/groups/${group}/learners`, "POST", { displayName: "Ada" }), 201)).id;
    const exemptLearner = (await read<{ id: string }>(await as(admin, `/courses/${course}/groups/${group}/learners`, "POST", { displayName: "Grace" }), 201)).id;

    const seeded = (await read<{ years: { id: string; status: string }[] }>(await as(admin, "/academic-years"))).years;
    for (const seededYear of seeded) {
      if (seededYear.status === "current") await read(await as(admin, `/academic-years/${seededYear.id}/close`, "POST"));
      else if (seededYear.status === "draft") await read(await as(admin, `/academic-years/${seededYear.id}`, "DELETE"));
    }
    const year = (await read<{ year: { id: string } }>(await as(admin, "/academic-years", "POST", {
      name: "Ciclo evaluación", from: "2030-01-10", until: "2030-06-30", periodKind: "semester",
      periods: [{ name: "Semestre", from: "2030-01-10", until: "2030-06-30", weight: 1 }],
    }), 201)).year.id;
    await read(await as(admin, `/academic-years/${year}/activate`, "POST"));
    const path = `/sections/${group}/grades`;
    const period = (await read<{ gradebook: Gradebook }>(await as(educator, path))).gradebook.periods[0].id;
    const rubric = { criteria: [{ id: "argument", label: "Argumentación", weight: 100, levels: [{ id: "strong", label: "Sólida", points: 100 }, { id: "start", label: "Inicial", points: 0 }] }] };
    let book = (await read<{ gradebook: Gradebook }>(await as(educator, `${path}/periods/${period}/plan`, "PUT", { activities: [
      { title: "Ensayo", kind: "task", points: 30, categoryId: "tareas", grading: "rubric", rubric },
      { title: "Proyecto", kind: "project", points: 30, categoryId: "proyectos", grading: "points" },
      { title: "Examen final", kind: "exam", points: 40, categoryId: "final", grading: "points" },
    ] }))).gradebook;
    const essay = book.activities.find(item => item.title === "Ensayo")!.id;
    const project = book.activities.find(item => item.title === "Proyecto")!.id;
    const exam = book.activities.find(item => item.title === "Examen final")!.id;
    book = (await read<{ gradebook: Gradebook }>(await as(educator, `${path}/periods/${period}/plan`, "PUT", { activities: [
      ...book.activities.map(({ id, title, kind, points, dueOn, categoryId, grading, rubric: savedRubric }) => ({ id, title, kind, points, dueOn, categoryId, grading, ...(savedRubric ? { rubric: savedRubric } : {}) })),
      { title: "Reposición de proyecto", kind: "project", points: 30, categoryId: "proyectos", grading: "points", retakeOf: project },
    ] }))).gradebook;
    const retake = book.activities.find(item => item.title === "Reposición de proyecto")!.id;
    book = (await read<{ gradebook: Gradebook }>(await as(educator, path, "PUT", {
      scores: [
        { activityId: project, learnerId: learner, points: 10 }, { activityId: retake, learnerId: learner, points: 25 },
        { activityId: exam, learnerId: learner, points: 20 },
      ],
      marks: [
        { activityId: essay, learnerId: learner, mark: { kind: "rubric", choices: { argument: "strong" } } },
        { activityId: essay, learnerId: exemptLearner, mark: { kind: "exempt" } },
      ],
    }))).gradebook;
    expect(book.results.find(item => item.learnerId === learner)).toMatchObject({ average: 75, display: "2,00", passed: false, reasons: ["No alcanzó el mínimo de 60 en «Examen final»."] });
    expect(book.results.find(item => item.learnerId === exemptLearner)).toMatchObject({ average: null, passed: null });

    book = (await read<{ gradebook: Gradebook }>(await as(educator, `${path}/periods/${period}/plan`, "PUT", { activities: [
      ...book.activities.map(({ id, title, kind, points, dueOn, categoryId, grading, rubric: savedRubric, retakeOf }) => ({ id, title, kind, points, dueOn, categoryId, grading, ...(savedRubric ? { rubric: savedRubric } : {}), ...(retakeOf ? { retakeOf } : {}) })),
      { title: "Defensa", kind: "exam", points: 30, categoryId: "proyectos", grading: "panel", panel: { combine: "majority" } },
    ] }))).gradebook;
    const defense = book.activities.find(item => item.title === "Defensa")!.id;
    const members = (await read<{ members: { id: string; username: string }[] }>(await as(admin, "/members"))).members;
    const evaluatorIds = ["admin-demo", "educador-demo", "carlos.mejia"].map(username => members.find(item => item.username === username)!.id);
    await read(await as(educator, `${path}/activities/${defense}/evaluators`, "PUT", { evaluators: evaluatorIds.map((userId, index) => ({ userId, chair: index === 0 })) }));
    expect((await as(outsider, `${path}/activities/${defense}/panel`, "PUT", { learnerId: learner, mark: { kind: "pass", value: true } })).status).toBe(403);
    const partial = (await read<{ gradebook: Gradebook }>(await as(carlos, `${path}/activities/${defense}/panel`, "PUT", { learnerId: learner, mark: { kind: "pass", value: true } }))).gradebook;
    expect(partial.marks?.filter(item => item.activityId === defense)).toHaveLength(1);
    await read(await as(educator, `${path}/activities/${defense}/panel`, "PUT", { learnerId: learner, mark: { kind: "pass", value: true } }));
    const complete = (await read<{ gradebook: Gradebook }>(await as(admin, `${path}/activities/${defense}/panel`, "PUT", { learnerId: learner, mark: { kind: "pass", value: false } }))).gradebook;
    expect(complete.marks?.filter(item => item.activityId === defense)).toHaveLength(3);
    // Majority: two passes and one fail count as a pass (the same grade as a unanimous pass); two fails, as a fail.
    const scoreOf = (book: Gradebook) => book.grades.find(item => item.learnerId === learner)?.score;
    const majorityPass = scoreOf(complete);
    expect(majorityPass).toBeTypeOf("number");
    const unanimous = (await read<{ gradebook: Gradebook }>(await as(admin, `${path}/activities/${defense}/panel`, "PUT", { learnerId: learner, mark: { kind: "pass", value: true } }))).gradebook;
    expect(scoreOf(unanimous)).toBe(majorityPass);
    await read(await as(admin, `${path}/activities/${defense}/panel`, "PUT", { learnerId: learner, mark: { kind: "pass", value: false } }));
    const majorityFail = (await read<{ gradebook: Gradebook }>(await as(educator, `${path}/activities/${defense}/panel`, "PUT", { learnerId: learner, mark: { kind: "pass", value: false } }))).gradebook;
    expect(scoreOf(majorityFail)!).toBeLessThan(majorityPass!);
    const mine = await read<{ panels: { activityId: string; learners: { id: string; marked: boolean }[] }[] }>(await as(carlos, "/me/panels"));
    expect(mine.panels.map(item => item.activityId)).toContain(defense);
    expect(mine.panels.find(item => item.activityId === defense)!.learners.find(item => item.id === learner)!.marked).toBe(true);
    expect((await read<{ panels: unknown[] }>(await as(outsider, "/me/panels"))).panels).toEqual([]);
  }, 30_000);

  it("prints a level in PDF and CSV and archives an in-use scheme", async () => {
    const admin = await signIn("admin-demo"), educator = await signIn("educador-demo");
    const levels = schemeTemplates.find(item => item.id === "idiomas")!;
    const scheme = (await read<{ scheme: OrganizationGradingScheme }>(await as(admin, "/grading-schemes", "POST", levels), 201)).scheme;
    const course = (await read<{ id: string }>(await as(admin, "/courses", "POST", {
      title: "Idiomas por niveles", objective: "Evaluar el nivel.", status: "active", educationType: "non-formal",
      level: "unspecified", format: "workshop", modality: "in-person", pacing: "scheduled", area: "023",
      settings: { attendance: true, gradingSchemeId: scheme.id }, programId: null, leadId: "user-educator",
    }), 201)).id;
    const group = (await read<{ id: string }>(await as(admin, `/courses/${course}/groups`, "POST", { name: "Nivel" }), 201)).id;
    await read(await as(admin, `/courses/${course}/groups/${group}/educators`, "PUT", { userIds: ["user-educator"] }));
    const learner = (await read<{ id: string }>(await as(admin, `/courses/${course}/groups/${group}/learners`, "POST", { displayName: "Lin" }), 201)).id;
    const path = `/sections/${group}/grades`;
    const period = (await read<{ gradebook: Gradebook }>(await as(educator, path))).gradebook.periods[0].id;
    let book = (await read<{ gradebook: Gradebook }>(await as(educator, `${path}/periods/${period}/plan`, "PUT", { activities: [
      { title: "Conversación", kind: "other", points: 100, categoryId: "expresion", grading: "level" },
    ] }))).gradebook;
    const conversation = book.activities[0].id;
    book = (await read<{ gradebook: Gradebook }>(await as(educator, path, "PUT", { marks: [{ activityId: conversation, learnerId: learner, mark: { kind: "level", value: "b2" } }] }))).gradebook;
    expect(book.results[0]).toMatchObject({ average: 80, display: "B2", level: "b2", passed: true });
    expect(await (await as(educator, `${path}/report.pdf`)).text()).toContain("B2");
    expect(await (await as(educator, `${path}/report.csv`)).text()).toContain("B2");
    expect(await read<{ ok: boolean; archived: boolean }>(await as(admin, `/grading-schemes/${scheme.id}`, "DELETE"))).toEqual({ ok: true, archived: true });
  }, 30_000);

  it("rejects a missing, archived or foreign grading scheme on a course and a program", async () => {
    const admin = await signIn("admin-demo"), external = await signIn("admin-externo");
    const foreign = (await read<{ scheme: OrganizationGradingScheme }>(await as(external, "/grading-schemes", "POST", schemeTemplates.find(item => item.id === "colegio")), 201)).scheme;
    const own = (await read<{ scheme: OrganizationGradingScheme }>(await as(admin, "/grading-schemes", "POST", schemeTemplates.find(item => item.id === "tecnica")), 201)).scheme;
    const course = (title: string, gradingSchemeId: string) => ({
      title, objective: "Comprobar el esquema.", status: "active", educationType: "non-formal", level: "unspecified",
      format: "workshop", modality: "in-person", pacing: "scheduled", settings: { gradingSchemeId }, programId: null, leadId: "user-educator",
    });
    const program = (name: string, gradingSchemeId: string) => ({
      name, description: "", status: "active", educationType: "non-formal", level: "unspecified", format: "workshop",
      modality: "in-person", pacing: "scheduled", settings: { gradingSchemeId }, locked: [],
    });
    const missing = "scheme-00000000-0000-4000-8000-000000000000";
    expect(await errorOf(await as(admin, "/courses", "POST", course("Curso sin esquema", missing)), 400)).toBe("Elige un esquema de evaluación activo de tu organización.");
    expect(await errorOf(await as(admin, "/programs", "POST", program("Programa sin esquema", missing)), 400)).toBe("Elige un esquema de evaluación activo de tu organización.");
    expect(await errorOf(await as(admin, "/courses", "POST", course("Curso de otra organización", foreign.id)), 400)).toBe("Elige un esquema de evaluación activo de tu organización.");
    expect(await errorOf(await as(admin, "/programs", "POST", program("Programa de otra organización", foreign.id)), 400)).toBe("Elige un esquema de evaluación activo de tu organización.");
    const holder = (await read<{ id: string }>(await as(admin, "/courses", "POST", course("Curso que archiva el esquema", own.id)), 201)).id;
    expect(await read<{ ok: boolean; archived: boolean }>(await as(admin, `/grading-schemes/${own.id}`, "DELETE"))).toEqual({ ok: true, archived: true });
    expect(await errorOf(await as(admin, "/courses", "POST", course("Curso con esquema archivado", own.id)), 409)).toBe("Ese esquema de evaluación está archivado.");
    expect(await errorOf(await as(admin, "/programs", "POST", program("Programa con esquema archivado", own.id)), 409)).toBe("Ese esquema de evaluación está archivado.");
    const saved = (await read<{ course: Course }>(await as(admin, `/courses/${holder}`))).course;
    expect(await errorOf(await as(admin, `/courses/${holder}`, "PUT", { ...saved, settings: { ...saved.settings, gradingSchemeId: own.id } }), 409)).toBe("Ese esquema de evaluación está archivado.");
  }, 30_000);
});
