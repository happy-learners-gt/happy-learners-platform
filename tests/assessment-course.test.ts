import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn, type ChildProcess } from "node:child_process";
import { createServer } from "node:net";
import { once } from "node:events";
import { setTimeout as delay } from "node:timers/promises";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Gradebook } from "../packages/contracts/src/index";

let worker: ChildProcess;
let origin = "", logs = "";
const storage = mkdtempSync(join(tmpdir(), "hl-platform-assessment-"));
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

describe("course assessment on the built Worker", () => {
  it("designs one activity at a time, protects graded work, and lets each section choose its groups", async () => {
    const admin = await signIn("admin-demo"), educator = await signIn("educador-demo"), external = await signIn("admin-externo");
    const course = (await read<{ id: string }>(await as(admin, "/courses", "POST", {
      title: "Evaluación del curso", objective: "Diseñar la evaluación una vez.", status: "active", educationType: "non-formal",
      level: "unspecified", format: "workshop", modality: "in-person", pacing: "scheduled", area: "011",
      settings: { attendance: true }, programId: null, leadId: "user-educator",
    }), 201)).id;
    const sectionA = (await read<{ id: string }>(await as(admin, `/courses/${course}/groups`, "POST", { name: "Sección A" }), 201)).id;
    const sectionB = (await read<{ id: string }>(await as(admin, `/courses/${course}/groups`, "POST", { name: "Sección B" }), 201)).id;
    await read(await as(admin, `/courses/${course}/groups/${sectionA}/educators`, "PUT", { userIds: ["user-educator"] }));
    await read(await as(admin, `/courses/${course}/groups/${sectionB}/educators`, "PUT", { userIds: ["user-educator"] }));
    const ana = (await read<{ id: string }>(await as(admin, `/courses/${course}/groups/${sectionA}/learners`, "POST", { displayName: "Ana" }), 201)).id;
    const leo = (await read<{ id: string }>(await as(admin, `/courses/${course}/groups/${sectionA}/learners`, "POST", { displayName: "Leo" }), 201)).id;
    const bea = (await read<{ id: string }>(await as(admin, `/courses/${course}/groups/${sectionB}/learners`, "POST", { displayName: "Bea" }), 201)).id;

    const view = await read<{ periods: { id: string; name: string }[]; explanation: string[]; canEdit: boolean }>(await as(educator, `/courses/${course}/assessment`));
    expect(view.canEdit).toBe(true);
    expect(view.explanation[0]).toContain("suma de los puntos");
    expect(view.periods.length).toBeGreaterThanOrEqual(2);
    const [first, second, third] = view.periods;
    const created = await read<{ id: string }>(await as(educator, `/courses/${course}/assessment/activities`, "POST", {
      periodId: first.id, title: "Tarea", kind: "task", categoryId: "general", points: 20, grading: "points", groupMode: "individual",
    }), 201);
    await read(await as(educator, `/courses/${course}/assessment/activities/${created.id}`, "PUT", {
      periodId: first.id, title: "Tarea de casa", kind: "task", categoryId: "general", points: 20, grading: "points", groupMode: "individual",
    }));
    const named = await read<{ periods: { activities: { id: string; title: string }[] }[] }>(await as(educator, `/courses/${course}/assessment`));
    expect(named.periods[0].activities.find(item => item.id === created.id)?.title).toBe("Tarea de casa");

    await read(await as(educator, `/sections/${sectionA}/grades`, "PUT", { scores: [{ activityId: created.id, learnerId: ana, points: 15 }] }));
    const blocked = await as(educator, `/courses/${course}/assessment/activities/${created.id}`, "PUT", {
      periodId: first.id, title: "Tarea de casa", kind: "task", categoryId: "general", points: 20, grading: "rubric", groupMode: "individual",
      rubric: { criteria: [{ id: "ideas", label: "Ideas", weight: 100, levels: [{ id: "alto", label: "Alto", points: 4 }, { id: "bajo", label: "Bajo", points: 1 }] }] },
    });
    expect(blocked.status).toBe(409);
    expect(await blocked.json()).toEqual({ error: "«Tarea de casa» ya tiene notas: puedes cambiar su nombre y su fecha, no su forma de calificar ni sus puntos por debajo de una nota dada." });
    const lowered = await as(educator, `/courses/${course}/assessment/activities/${created.id}`, "PUT", {
      periodId: first.id, title: "Tarea de casa", kind: "task", categoryId: "general", points: 10, grading: "points", groupMode: "individual",
    });
    expect((await lowered.json()).error).toBe("«Tarea de casa» ya tiene un punteo de 15: sus puntos no pueden ser menos.");
    await read(await as(educator, `/courses/${course}/assessment/activities/${created.id}`, "PUT", {
      periodId: first.id, title: "Tarea revisada", kind: "task", categoryId: "general", points: 20, dueOn: "2031-03-01", grading: "points", groupMode: "individual",
    }));
    expect((await as(educator, `/courses/${course}/assessment/activities/${created.id}`, "DELETE")).status).toBe(409);

    const seeded = await read<{ ids: string[] }>(await as(educator, `/courses/${course}/assessment/periods/${second.id}/template`, "POST", { templateId: "zona-60" }));
    expect(seeded.ids.length).toBeGreaterThan(1);
    expect((await as(educator, `/courses/${course}/assessment/periods/${second.id}/template`, "POST", { templateId: "zona-60" })).status).toBe(409);
    if (third) {
      const copied = await read<{ ids: string[] }>(await as(educator, `/courses/${course}/assessment/periods/${third.id}/copy-from/${first.id}`, "POST"));
      expect(copied.ids.length).toBe(1);
    }

    const groupActivity = (await read<{ id: string }>(await as(educator, `/courses/${course}/assessment/activities`, "POST", {
      periodId: first.id, title: "Ensayo en grupos", kind: "project", categoryId: "general", points: 20, grading: "points", groupMode: "group",
    }), 201)).id;
    const rules = { by: "size", size: 2, how: "random", seed: "seccion" };
    const setA = (await read<{ set: { id: string; groups: { id: string }[] } }>(await as(educator, `/sections/${sectionA}/group-sets`, "POST", { name: "Equipos A", rules }), 201)).set;
    const setB = (await read<{ set: { id: string; groups: { id: string }[] } }>(await as(educator, `/sections/${sectionB}/group-sets`, "POST", { name: "Equipos B", rules: { by: "count", count: 1, how: "random", seed: "otra" } }), 201)).set;
    await read(await as(educator, `/sections/${sectionA}/group-sets/assignments`, "PUT", { kind: "assessment", activityId: groupActivity, setId: setA.id }));
    await read(await as(educator, `/sections/${sectionB}/group-sets/assignments`, "PUT", { kind: "assessment", activityId: groupActivity, setId: setB.id }));
    const bookA = (await read<{ gradebook: Gradebook }>(await as(educator, `/sections/${sectionA}/grades/activities/${groupActivity}/groups`, "PUT", { workGroupId: setA.groups[0].id, mark: { kind: "points", value: 18 } }))).gradebook;
    const bookB = (await read<{ gradebook: Gradebook }>(await as(educator, `/sections/${sectionB}/grades/activities/${groupActivity}/groups`, "PUT", { workGroupId: setB.groups[0].id, mark: { kind: "points", value: 12 } }))).gradebook;
    expect(bookA.activities.find(item => item.id === groupActivity)?.workGroupSetId).toBe(setA.id);
    expect(bookB.activities.find(item => item.id === groupActivity)?.workGroupSetId).toBe(setB.id);
    expect(bookA.scores?.some(item => item.learnerId === ana && item.points === 18) || bookA.marks?.some(item => item.learnerId === ana)).toBeTruthy();
    expect(bookA.learners.map(item => item.id)).toEqual(expect.arrayContaining([ana, leo]));
    expect(bookB.learners.map(item => item.id)).toEqual([bea]);
    expect(bookA.learners.map(item => item.id)).not.toContain(bea);

    await read(await as(admin, "/members/seed-user-carlos/coordination", "PUT", { enabled: true, scope: { all: true } }));
    const carlos = await signIn("carlos.mejia");
    expect((await as(carlos, `/courses/${course}/assessment`)).status).toBe(200);
    expect((await as(carlos, `/courses/${course}/assessment/activities`, "POST", {
      periodId: first.id, title: "Ajena", kind: "task", categoryId: "general", points: 10, grading: "points",
    })).status).toBe(403);
    expect((await as(external, `/courses/${course}/assessment`)).status).toBe(404);
  }, 60000);
});
