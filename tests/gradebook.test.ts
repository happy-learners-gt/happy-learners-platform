import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn, type ChildProcess } from "node:child_process";
import { createServer } from "node:net";
import { once } from "node:events";
import { setTimeout as delay } from "node:timers/promises";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Gradebook } from "../packages/contracts/src/index";
import { assessmentTemplates, averageOf, csvFile, gradeResult, gradeStatistics, letterOf, pastedCells, pdfFile, periodFromPlan, planTotal, pointsInput, scoreInput, settingChoices, settingsInput, settingValue, splitPeriods } from "../packages/domain/src/index";
import type { GradingPolicy } from "../packages/domain/src/index";
import { listenOnTestPort } from "./test-port";

// The minimal gradebook (libreta): one optional score per student of the section's roster and period of the school
// year. A missing score is never a zero; the course's settings (or its program's) decide scale, passing score,
// letter thresholds and how periods average.
const policy: GradingPolicy = { scale: "numeric_100", passingGrade: 60, letterThresholds: [90, 80, 70, 60], average: "simple" };

describe("gradebook rules", () => {
  it("accepts scores from 0 to 100 with one decimal and clears empty cells", () => {
    expect(scoreInput("85")).toBe(85);
    expect(scoreInput("85,5")).toBe(85.5);
    expect(scoreInput(0)).toBe(0);
    expect(scoreInput(100)).toBe(100);
    expect(scoreInput("")).toBeNull();
    expect(scoreInput(null)).toBeNull();
    for (const bad of [101, -1, 85.55, "85.55", "abc", "1e2", Number.NaN, true]) expect(scoreInput(bad), String(bad)).toBeUndefined();
  });

  it("reads letters from the thresholds, with F below D", () => {
    expect([95, 90, 89.9, 80, 75, 60, 59.9, 0].map(score => letterOf(score, [90, 80, 70, 60]))).toEqual(["A", "A", "B", "B", "C", "D", "F", "F"]);
    expect(letterOf(84, [93, 85, 77, 70])).toBe("C");
  });

  it("averages only the periods with a score: an empty one is not a zero", () => {
    expect(averageOf([{ score: 80, weight: 1 }, { score: null, weight: 1 }], "simple")).toBe(80);
    expect(averageOf([{ score: 80, weight: 1 }, { score: 65, weight: 1 }, { score: 70, weight: 1 }], "simple")).toBe(71.7);
    expect(averageOf([{ score: null, weight: 1 }], "simple")).toBeNull();
    // Weighted: each score by its weight, over the weights of the periods that have one.
    expect(averageOf([{ score: 90, weight: 3 }, { score: 60, weight: 1 }], "weighted")).toBe(82.5);
    expect(averageOf([{ score: 90, weight: 3 }, { score: null, weight: 1 }], "weighted")).toBe(90);
    expect(averageOf([], "weighted")).toBeNull();
  });

  it("passes from the passing score, says whether every period has a score and gives the letter in the letters scale", () => {
    expect(gradeResult([{ score: 60, weight: 1 }, { score: 60, weight: 1 }], policy)).toEqual({ average: 60, letter: null, passed: true, complete: true });
    expect(gradeResult([{ score: 59.9, weight: 1 }, { score: null, weight: 1 }], policy)).toEqual({ average: 59.9, letter: null, passed: false, complete: false });
    expect(gradeResult([{ score: null, weight: 1 }], policy)).toEqual({ average: null, letter: null, passed: null, complete: false });
    expect(gradeResult([{ score: 85, weight: 1 }], { ...policy, scale: "letters_af" }).letter).toBe("B");
  });

  it("validates the grading settings a course or program stores, and reads them back from the selects", () => {
    expect(settingsInput({ gradeScale: "letters_af", passingGrade: 65, letterThresholds: [93, 85, 77, 70], gradeAverage: "weighted" })).toEqual({ gradeScale: "letters_af", passingGrade: 65, letterThresholds: [93, 85, 77, 70], gradeAverage: "weighted" });
    for (const bad of [{ gradeScale: "letters" }, { passingGrade: 0 }, { passingGrade: 60.5 }, { letterThresholds: [90, 90, 70, 60] }, { letterThresholds: [90, 80, 70] }, { gradeAverage: "median" }]) expect(settingsInput(bad), JSON.stringify(bad)).toBeNull();
    expect(settingValue("passingGrade", "65")).toBe(65);
    expect(settingValue("letterThresholds", "93,85,77,70")).toEqual([93, 85, 77, 70]);
    expect(settingValue("gradeScale", "")).toBeUndefined();
    expect(settingChoices("passingGrade", 61).map(([value]) => value)).toContain("61");
  });
});

let worker: ChildProcess;
let origin = "";
let logs = "";
const storage = mkdtempSync(join(tmpdir(), "hl-platform-gradebook-"));
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
async function signIn(username: string) {
  const response = await fetch(`${origin}/api/login`, { method: "POST", headers: { "Content-Type": "application/json", Origin: origin }, body: JSON.stringify({ username, password }) });
  return response.status === 200 ? response.headers.get("set-cookie")!.split(";")[0] : null;
}
async function as(cookie: string | null, path: string, method = "GET", data?: unknown) {
  return fetch(`${origin}/api${path}`, { method, headers: { Cookie: cookie || "", Origin: origin, ...(data !== undefined ? { "Content-Type": "application/json" } : {}) }, ...(data !== undefined ? { body: JSON.stringify(data) } : {}) });
}
const read = async <T = Record<string, unknown>>(response: Response, status = 200) => { const text = await response.text(); expect(response.status, text).toBe(status); return JSON.parse(text) as T; };
const errorOf = async (response: Response, status: number) => (await read<{ error: string }>(response, status)).error;

describe("assessment plan rules", () => {
  it("every template adds up to 100 and points stay within the activity", () => {
    for (const template of assessmentTemplates) expect(planTotal(template.activities), template.id).toBe(100);
    expect(pointsInput("19,5", 20)).toBe(19.5);
    expect(pointsInput(20, 20)).toBe(20);
    expect(pointsInput("", 20)).toBeNull();
    for (const bad of [20.5, -1, "abc", 1.25]) expect(pointsInput(bad, 20), String(bad)).toBeUndefined();
  });

  it("the period is the sum earned so far, says how many points were graded and whether every activity has a score", () => {
    const plan = [{ id: "a", points: 30 }, { id: "b", points: 30 }, { id: "c", points: 40 }];
    expect(periodFromPlan(plan, new Map())).toEqual({ score: null, graded: 0, complete: false });
    expect(periodFromPlan(plan, new Map([["a", 25], ["b", 0]]))).toEqual({ score: 25, graded: 60, complete: false });
    expect(periodFromPlan(plan, new Map([["a", 25], ["b", 27.5], ["c", 33]]))).toEqual({ score: 85.5, graded: 100, complete: true });
  });

  it("statistics count who passes, the bands of ten points and who is at risk", () => {
    const stats = gradeStatistics([{ learnerId: "a", score: 95 }, { learnerId: "b", score: 62 }, { learnerId: "c", score: 40 }, { learnerId: "d", score: null }], 60);
    expect(stats).toMatchObject({ count: 3, missing: 1, average: 65.7, median: 62, highest: 95, lowest: 40, passed: 2, failed: 1 });
    expect(stats.bands.map(band => band.count)).toEqual([1, 0, 0, 1, 1]);
    expect(stats.atRisk).toEqual([{ learnerId: "c", score: 40, failing: true }, { learnerId: "b", score: 62, failing: false }]);
  });

  it("reads cells pasted from a spreadsheet and writes a CSV that spreadsheets open safely", () => {
    expect(pastedCells("18\t20\r\n15,5\t\n")).toEqual([["18", "20"], ["15,5", ""]]);
    expect(pastedCells("18;20")).toEqual([["18", "20"]]);
    expect(csvFile([["Estudiante", "Nota"], ["=HYPERLINK()", 85.5], ["Pérez, Ana", null]])).toBe("\uFEFFEstudiante,Nota\r\n'=HYPERLINK(),85.5\r\n\"Pérez, Ana\",\r\n");
  });

  it("the PDF writer lays out table rows in columns and starts a block on a new page", () => {
    const file = pdfFile({ title: "Boleta", header: ["Escuela"], footer: "Pie", blocks: [{ text: "Ana", bold: true }, { text: "Periodo\tNota", columns: [0, 300] }, { text: "Beto", pageBreak: true }] });
    expect(file).toContain("/Count 2");
    expect(file).toMatch(/356\.00 [0-9.]+ Td \(Nota\) Tj/);
  });
});

describe("gradebook on the built Worker", () => {
  it("in a section with three students and two bimestres, administration and the section's educator record scores and see who passes", async () => {
    const admin = await signIn("admin-demo"), educator = await signIn("educador-demo"), other = await signIn("carlos.mejia"), external = await signIn("admin-externo");
    const course = (await read<{ id: string }>(await as(admin, "/courses", "POST", { title: "Curso con libreta", objective: "Registrar notas por bimestre.", status: "active", educationType: "non-formal", level: "unspecified", format: "workshop", modality: "in-person", pacing: "scheduled", area: "011", settings: { attendance: true }, programId: null, leadId: "user-educator" }), 201)).id;
    const group = (await read<{ id: string }>(await as(admin, `/courses/${course}/groups`, "POST", { name: "Quinto A" }), 201)).id;
    await read(await as(admin, `/courses/${course}/groups/${group}/educators`, "PUT", { userIds: ["user-educator"] }));
    const ids: string[] = [];
    for (const displayName of ["Ana", "Beto", "Carla"]) ids.push((await read<{ id: string }>(await as(admin, `/courses/${course}/groups/${group}/learners`, "POST", { displayName }), 201)).id);
    const path = `/sections/${group}/grades`;

    // The demo starts with the pilot seed (0054): «Ciclo 2026» current and «Ciclo 2027» as a draft. This flow starts clean.
    const seeded = (await read<{ years: { id: string; name: string; status: string }[] }>(await as(admin, "/academic-years"))).years;
    expect(seeded.map(item => [item.name, item.status])).toEqual([["Ciclo 2027", "draft"], ["Ciclo 2026", "current"]]);
    await read(await as(admin, `/academic-years/${seeded[1].id}/close`, "POST"));
    await read(await as(admin, `/academic-years/${seeded[0].id}`, "DELETE"));
    // Without a current school year nothing is graded: the closed year is only read.
    expect((await read<{ gradebook: Gradebook }>(await as(admin, path))).gradebook).toMatchObject({ year: { name: "Ciclo 2026", status: "closed" }, canEdit: false });
    expect(await errorOf(await as(admin, path, "PUT", { grades: [{ learnerId: ids[0], periodId: "period-x", score: 80 }] }), 409)).toContain("No hay un ciclo lectivo vigente");

    const year = { name: "Ciclo 2027", from: "2027-01-11", until: "2027-06-30", periodKind: "bimester", periods: splitPeriods("2027-01-11", "2027-06-30", "bimester", 2).map((period, index) => ({ ...period, weight: index === 0 ? 1 : 3 })) };
    const created = (await read<{ year: { id: string } }>(await as(admin, "/academic-years", "POST", year), 201)).year;
    await read(await as(admin, `/academic-years/${created.id}/activate`, "POST"));
    const book = (await read<{ gradebook: Gradebook }>(await as(educator, path))).gradebook;
    expect(book).toMatchObject({ year: { name: "Ciclo 2027", status: "current" }, canEdit: true, canSubmit: true, canLock: false, canUnlock: false, policy: { scale: "numeric_100", passingGrade: 60, average: "simple" } });
    expect(book.learners.map(learner => learner.name)).toEqual(["Ana", "Beto", "Carla"]);
    const [first, second] = book.periods.map(period => period.id);

    // Who passes: Ana 80 and 70, Beto 50 and nothing yet (not a zero), Carla nothing.
    const saved = (await read<{ gradebook: Gradebook }>(await as(educator, path, "PUT", { grades: [
      { learnerId: ids[0], periodId: first, score: 80 }, { learnerId: ids[0], periodId: second, score: "70" }, { learnerId: ids[1], periodId: first, score: 50 },
    ] }))).gradebook;
    expect(saved.results).toEqual([
      { learnerId: ids[0], average: 75, letter: null, passed: true, complete: true },
      { learnerId: ids[1], average: 50, letter: null, passed: false, complete: false },
      { learnerId: ids[2], average: null, letter: null, passed: null, complete: false },
    ]);
    // Validation on the server: range, decimals, roster and periods.
    expect(await errorOf(await as(educator, path, "PUT", { grades: [{ learnerId: ids[2], periodId: first, score: 101 }] }), 400)).toContain("de 0 a 100");
    expect(await errorOf(await as(educator, path, "PUT", { grades: [{ learnerId: ids[2], periodId: first, score: 70.25 }] }), 400)).toContain("un decimal");
    expect(await errorOf(await as(educator, path, "PUT", { grades: [{ learnerId: "learner-otro", periodId: first, score: 70 }] }), 400)).toContain("lista de la sección");
    expect(await errorOf(await as(educator, path, "PUT", { grades: [{ learnerId: ids[2], periodId: "period-otro", score: 70 }] }), 400)).toContain("ciclo vigente");

    // The course's settings decide: weighted by the period's weight and read in letters.
    await read(await as(admin, `/courses/${course}`, "PUT", { ...(await read<{ course: Record<string, unknown> }>(await as(admin, `/courses/${course}`))).course, settings: { attendance: true, gradeAverage: "weighted", gradeScale: "letters_af" } }));
    const weighted = (await read<{ gradebook: Gradebook }>(await as(educator, path))).gradebook;
    expect(weighted.policy).toMatchObject({ scale: "letters_af", average: "weighted" });
    expect(weighted.results[0]).toEqual({ learnerId: ids[0], average: 72.5, letter: "C", passed: true, complete: true });

    // Clearing a cell removes the score; it does not become a zero.
    const cleared = (await read<{ gradebook: Gradebook }>(await as(admin, path, "PUT", { grades: [{ learnerId: ids[1], periodId: first, score: null }] }))).gradebook;
    expect(cleared.results[1]).toMatchObject({ average: null, passed: null });

    // Closing with review: the educator hands the period in (no more edits), administration approves and closes it.
    expect(await errorOf(await as(educator, `${path}/periods/${first}/lock`, "POST"), 403)).toContain("Entrégalo para revisión");
    const handed = (await read<{ gradebook: Gradebook }>(await as(educator, `${path}/periods/${first}/submit`, "POST"))).gradebook;
    expect(handed.reviews).toEqual([expect.objectContaining({ periodId: first, status: "submitted", submittedBy: "Educador de la demostración" })]);
    expect(await errorOf(await as(educator, path, "PUT", { grades: [{ learnerId: ids[2], periodId: first, score: 90 }] }), 409)).toContain("entregado a revisión");
    const locked = (await read<{ gradebook: Gradebook }>(await as(admin, `${path}/periods/${first}/lock`, "POST"))).gradebook;
    expect(locked.periods[0]).toMatchObject({ locked: true, lockedBy: expect.any(String) });
    expect(locked.reviews[0]).toMatchObject({ status: "approved", reviewedBy: expect.any(String) });
    expect(await errorOf(await as(educator, path, "PUT", { grades: [{ learnerId: ids[2], periodId: first, score: 90 }] }), 409)).toContain("están cerradas");
    expect(await errorOf(await as(educator, `${path}/periods/${first}/lock`, "DELETE"), 403)).toContain("Solo administración");
    await read(await as(admin, `${path}/periods/${first}/lock`, "DELETE"));
    await read(await as(educator, path, "PUT", { grades: [{ learnerId: ids[2], periodId: first, score: 90 }] }));

    // Permissions: an educator who does not teach the section, coordination reads only, another organization sees nothing.
    expect((await as(other, path)).status).toBe(403);
    expect((await as(other, path, "PUT", { grades: [{ learnerId: ids[2], periodId: first, score: 10 }] })).status).toBe(403);
    expect((await as(external, path)).status).toBe(404);
    expect((await as(external, `${path}/periods/${first}/lock`, "POST")).status).toBe(404);
    const coordinatorId = ((await read<{ members: { id: string; username: string }[] }>(await as(admin, "/members"))).members).find(row => row.username === "instructor-demo")!.id;
    await read(await as(admin, `/members/${coordinatorId}/coordination`, "PUT", { enabled: true, scope: { all: true } }));
    const coordinator = await signIn("instructor-demo");
    const readOnly = (await read<{ gradebook: Gradebook }>(await as(coordinator, path))).gradebook;
    // Coordination approves and returns, but never writes scores.
    expect(readOnly).toMatchObject({ canEdit: false, canSubmit: false, canLock: true, canUnlock: false });
    expect(readOnly.grades).toHaveLength(3);
    expect(await errorOf(await as(coordinator, path, "PUT", { grades: [{ learnerId: ids[2], periodId: first, score: 10 }] }), 403)).toContain("Solo administración y quienes imparten");

    // The activity says that scores changed, never which ones.
    const { events } = await read<{ events: { summary: string }[] }>(await as(admin, "/activity?limit=50"));
    expect(events.map(item => item.summary)).toContain("Aprobó y cerró las notas de «Primer bimestre» en «Quinto A»");
    expect(events.map(item => item.summary)).toContain("Entregó las notas de «Primer bimestre» en «Quinto A» para revisión");
    expect(events.some(item => /\b(80|70|50)\b/.test(item.summary))).toBe(false);

    // A period with scores is not removed from the year; closing the year keeps the scores and freezes them.
    const yearNow = (await read<{ years: { id: string; periods: { id: string; name: string; from: string; until: string; weight: number }[] }[] }>(await as(admin, "/academic-years"))).years[0];
    expect(await errorOf(await as(admin, `/academic-years/${created.id}`, "PUT", { ...year, periods: [yearNow.periods[1]] }), 409)).toContain("ya tiene notas");
    await read(await as(admin, `/academic-years/${created.id}/close`, "POST"));
    const closed = (await read<{ gradebook: Gradebook }>(await as(educator, path))).gradebook;
    expect(closed).toMatchObject({ year: { status: "closed" }, canEdit: false });
    expect(closed.grades).toHaveLength(3);
    expect(closed.periods.every(period => period.locked)).toBe(true);
    expect(await errorOf(await as(educator, path, "PUT", { grades: [{ learnerId: ids[2], periodId: first, score: 10 }] }), 409)).toContain("No hay un ciclo lectivo vigente");
    // Closing the year promotes nobody: the roster is the same.
    expect((await read<{ gradebook: Gradebook }>(await as(admin, path))).gradebook.learners).toHaveLength(3);
  }, 30_000); // One flow from the empty gradebook to the closed year: room for slow runners.

  it("an assessment plan adds up to 100: the period score is the points earned so far, with comments, history, review and report cards", async () => {
    const admin = await signIn("admin-demo"), educator = await signIn("educador-demo");
    const course = (await read<{ id: string }>(await as(admin, "/courses", "POST", { title: "Curso con plan de evaluación", objective: "Calcular la nota con zona y examen.", status: "active", educationType: "non-formal", level: "unspecified", format: "workshop", modality: "in-person", pacing: "scheduled", area: "011", settings: { attendance: true }, programId: null, leadId: "user-educator" }), 201)).id;
    const group = (await read<{ id: string }>(await as(admin, `/courses/${course}/groups`, "POST", { name: "Sexto B" }), 201)).id;
    await read(await as(admin, `/courses/${course}/groups/${group}/educators`, "PUT", { userIds: ["user-educator"] }));
    const ids: string[] = [];
    for (const displayName of ["Ana", "Beto", "Carla"]) ids.push((await read<{ id: string }>(await as(admin, `/courses/${course}/groups/${group}/learners`, "POST", { displayName }), 201)).id);
    const created = (await read<{ year: { id: string } }>(await as(admin, "/academic-years", "POST", { name: "Ciclo 2028", from: "2028-01-10", until: "2028-06-30", periodKind: "bimester", periods: splitPeriods("2028-01-10", "2028-06-30", "bimester", 2) }), 201)).year;
    await read(await as(admin, `/academic-years/${created.id}/activate`, "POST"));
    const path = `/sections/${group}/grades`;
    const [first, second] = (await read<{ gradebook: Gradebook }>(await as(educator, path))).gradebook.periods.map(period => period.id);
    const plan = `${path}/periods/${first}/plan`;

    // The plan: up to 100 points, validated; an incomplete plan is not handed in.
    expect(await errorOf(await as(educator, plan, "PUT", { activities: [{ title: "Examen", kind: "exam", points: 60 }, { title: "Proyecto", kind: "project", points: 50 }] }), 400)).toContain("no puede pasar de 100");
    expect(await errorOf(await as(educator, plan, "PUT", { activities: [{ title: "Examen", kind: "examen", points: 60 }] }), 400)).toContain("Elige el tipo");
    let book = (await read<{ gradebook: Gradebook }>(await as(educator, plan, "PUT", { activities: [{ title: "Tareas", kind: "task", points: 20 }, { title: "Proyecto", kind: "project", points: 20 }, { title: "Examen del periodo", kind: "exam", points: 40, dueOn: "2028-03-10" }] }))).gradebook;
    expect(book.activities.map(item => [item.title, item.points, item.position])).toEqual([["Tareas", 20, 0], ["Proyecto", 20, 1], ["Examen del periodo", 40, 2]]);
    expect(await errorOf(await as(educator, `${path}/periods/${first}/submit`, "POST"), 409)).toContain("suma 80 puntos");
    const [tasks, project, exam] = book.activities.map(item => item.id);
    book = (await read<{ gradebook: Gradebook }>(await as(educator, plan, "PUT", { activities: [...book.activities.map(({ id, title, kind, points, dueOn }) => ({ id, title, kind, points, dueOn })), { title: "Participación", kind: "participation", points: 20 }] }))).gradebook;
    expect(book.activities.map(item => item.id).slice(0, 3)).toEqual([tasks, project, exam]);

    // Points per activity, never above its maximum; the period score is their sum and is not written by hand.
    expect(await errorOf(await as(educator, path, "PUT", { scores: [{ activityId: tasks, learnerId: ids[0], points: 21 }] }), 400)).toContain("van de 0 a 20");
    expect(await errorOf(await as(educator, path, "PUT", { grades: [{ learnerId: ids[0], periodId: first, score: 90 }] }), 400)).toContain("se calcula con su plan");
    book = (await read<{ gradebook: Gradebook }>(await as(educator, path, "PUT", {
      scores: [{ activityId: tasks, learnerId: ids[0], points: 18 }, { activityId: project, learnerId: ids[0], points: "19,5" }, { activityId: exam, learnerId: ids[0], points: 35 }, { activityId: tasks, learnerId: ids[1], points: 10 }],
      comments: [{ learnerId: ids[0], periodId: first, body: "Excelente proyecto." }],
    }))).gradebook;
    expect(book.grades.filter(grade => grade.periodId === first).map(grade => [grade.learnerId, grade.score]).sort()).toEqual([[ids[0], 72.5], [ids[1], 10]].sort());
    expect(book.comments).toEqual([expect.objectContaining({ learnerId: ids[0], periodId: first, body: "Excelente proyecto.", updatedBy: "Educador de la demostración" })]);
    book = (await read<{ gradebook: Gradebook }>(await as(educator, path, "PUT", { scores: [{ activityId: tasks, learnerId: ids[1], points: null }] }))).gradebook;
    expect(book.grades.some(grade => grade.learnerId === ids[1])).toBe(false);

    // History: who changed which score, from what to what.
    const { changes } = await read<{ changes: { activity: string | null; before: number | null; after: number | null; by: string }[] }>(await as(educator, `${path}/history?learner=${ids[1]}`));
    expect(changes.map(item => [item.activity, item.before, item.after])).toEqual([["Tareas", 10, null], ["Tareas", null, 10]]);
    expect((await as(educator, `${path}/history?learner=learner-otro`)).status).toBe(404);

    // Activities with scores stay and their points do not drop below a score; a period with scores typed by hand keeps that mode.
    const current = book.activities.filter(item => item.periodId === first).map(({ id, title, kind, points, dueOn }) => ({ id, title, kind, points, dueOn }));
    expect(await errorOf(await as(educator, plan, "PUT", { activities: current.filter(item => item.id !== exam) }), 409)).toContain("ya tiene punteos");
    expect(await errorOf(await as(educator, plan, "PUT", { activities: current.map(item => item.id === exam ? { ...item, points: 30 } : item) }), 409)).toContain("no pueden ser menos");
    await read(await as(educator, path, "PUT", { grades: [{ learnerId: ids[2], periodId: second, score: 70 }] }));
    expect(await errorOf(await as(educator, `${path}/periods/${second}/plan`, "PUT", { activities: [{ title: "Examen", kind: "exam", points: 100 }] }), 409)).toContain("ya tiene notas registradas sin plan");

    // Handing in freezes the period and its plan; coordination or administration returns it with a note or approves it.
    await read(await as(educator, `${path}/periods/${first}/submit`, "POST"));
    expect(await errorOf(await as(educator, plan, "PUT", { activities: current }), 409)).toContain("cerrado o entregado en «Sexto B»");
    expect(await errorOf(await as(educator, `${path}/periods/${first}/return`, "POST", { note: "Revisa a Beto." }), 403)).toContain("Solo coordinación y administración");
    expect(await errorOf(await as(admin, `${path}/periods/${first}/return`, "POST", { note: "" }), 400)).toContain("Explica qué revisar");
    book = (await read<{ gradebook: Gradebook }>(await as(admin, `${path}/periods/${first}/return`, "POST", { note: "Falta el punteo de Beto." }))).gradebook;
    expect(book.reviews[0]).toMatchObject({ status: "returned", note: "Falta el punteo de Beto." });
    await read(await as(educator, path, "PUT", { scores: [{ activityId: tasks, learnerId: ids[1], points: 15 }] }));
    await read(await as(educator, `${path}/periods/${first}/submit`, "POST"));
    book = (await read<{ gradebook: Gradebook }>(await as(admin, `${path}/periods/${first}/lock`, "POST"))).gradebook;
    expect(book.periods[0].locked).toBe(true);
    expect(await errorOf(await as(educator, path, "PUT", { scores: [{ activityId: tasks, learnerId: ids[1], points: 16 }] }), 409)).toContain("están cerradas");

    // Report cards: the whole section or one student, as a PDF.
    const pdf = await as(educator, `${path}/report.pdf`);
    expect(pdf.status).toBe(200);
    expect(pdf.headers.get("content-type")).toBe("application/pdf");
    const text = await pdf.text();
    expect(text.startsWith("%PDF-1.4")).toBe(true);
    for (const expected of ["(Ana)", "(Beto)", "(Carla)", "Excelente proyecto.", "Examen del periodo"]) expect(text).toContain(expected);
    expect((await as(educator, `${path}/report.pdf?learner=${ids[0]}`)).status).toBe(200);
    expect((await as(educator, `${path}/report.pdf?learner=learner-otro`)).status).toBe(404);
    expect((await as(await signIn("admin-externo"), `${path}/report.pdf`)).status).toBe(404);
  }, 30_000);
});
