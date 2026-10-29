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
const storage = mkdtempSync(join(tmpdir(), "hl-platform-group-grading-"));
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

describe("group sets and group grading on the built Worker", () => {
  it("forms a set from the students present in a class and copies a group rubric with adjustments", async () => {
    const admin = await signIn("admin-demo"), educator = await signIn("educador-demo");
    const outsider = await signIn("lucia.herrera"), external = await signIn("admin-externo");
    const course = (await read<{ id: string }>(await as(admin, "/courses", "POST", {
      title: "Ensayo en equipos", objective: "Calificar un trabajo de grupo.", status: "active", educationType: "non-formal",
      level: "unspecified", format: "workshop", modality: "in-person", pacing: "scheduled", area: "011",
      settings: { attendance: true }, programId: null, leadId: "user-educator",
    }), 201)).id;
    const group = (await read<{ id: string }>(await as(admin, `/courses/${course}/groups`, "POST", { name: "Taller" }), 201)).id;
    await read(await as(admin, `/courses/${course}/groups/${group}/educators`, "PUT", { userIds: ["user-educator"] }));
    const names = ["Ana", "Leo", "Noa", "Iva"];
    const learners = [];
    for (const displayName of names) learners.push((await read<{ id: string }>(await as(admin, `/courses/${course}/groups/${group}/learners`, "POST", { displayName }), 201)).id);
    const [ana, leo, noa, iva] = learners;
    const seeded = (await read<{ years: { id: string; status: string }[] }>(await as(admin, "/academic-years"))).years;
    for (const seededYear of seeded) {
      if (seededYear.status === "current") await read(await as(admin, `/academic-years/${seededYear.id}/close`, "POST"));
      else if (seededYear.status === "draft") await read(await as(admin, `/academic-years/${seededYear.id}`, "DELETE"));
    }
    const year = (await read<{ year: { id: string } }>(await as(admin, "/academic-years", "POST", {
      name: "Ciclo de grupos", from: "2031-01-10", until: "2031-06-30", periodKind: "semester",
      periods: [{ name: "Semestre", from: "2031-01-10", until: "2031-06-30", weight: 1 }],
    }), 201)).year.id;
    await read(await as(admin, `/academic-years/${year}/activate`, "POST"));
    const session = (await read<{ id: string }>(await as(educator, `/courses/${course}/sessions`, "POST", { groupId: group, sessionDate: "2031-02-03", lessonIds: [] }), 201)).id;
    await read(await as(educator, `/courses/${course}/sessions/${session}/attendance`, "PUT", {
      marks: [
        { learnerId: ana, status: "present" }, { learnerId: leo, status: "present" },
        { learnerId: noa, status: "late" }, { learnerId: iva, status: "absent" },
      ],
    }));
    const rules = { by: "size", size: 3, how: "random", seed: "clase" };
    const preview = await read<{ groups: { learnerIds: string[] }[]; unmet: unknown[] }>(await as(educator, `/sections/${group}/group-sets?preview=1`, "POST", { name: "Ensayo", rules, sessionId: session }));
    expect(preview.unmet).toEqual([]);
    expect(preview.groups.flatMap(item => item.learnerIds).sort()).toEqual([ana, leo, noa].sort());
    const created = await read<{ set: { id: string; groups: { id: string; name: string; learnerIds: string[] }[]; unmet: unknown[] } }>(await as(educator, `/sections/${group}/group-sets`, "POST", { name: "Ensayo", rules, sessionId: session }), 201);
    expect(created.set.unmet).toEqual([]);
    expect(created.set.groups.flatMap(item => item.learnerIds).sort()).toEqual([ana, leo, noa].sort());
    expect(created.set.groups.map(item => item.name)).toEqual(["Grupo 1"]);
    const regenerated = await read<{ set: { groups: { learnerIds: string[] }[] } }>(await as(educator, `/sections/${group}/group-sets/${created.set.id}/regenerate`, "POST", { seed: "otra-clase" }));
    expect(regenerated.set.groups.flatMap(item => item.learnerIds).sort()).toEqual([ana, leo, noa].sort());
    const workGroupId = (await read<{ set: { groups: { id: string }[] } }>(await as(educator, `/sections/${group}/group-sets/${created.set.id}/regenerate`, "POST", { seed: "clase" }))).set.groups[0].id;

    expect((await as(outsider, `/sections/${group}/group-sets`, "POST", { name: "Ajeno", rules })).status).toBe(403);
    expect((await as(external, `/sections/${group}/group-sets`, "POST", { name: "Ajeno", rules })).status).toBe(404);

    const rubric = { criteria: [{ id: "ideas", label: "Ideas", weight: 100, levels: [{ id: "alto", label: "Alto", points: 4 }, { id: "bajo", label: "Bajo", points: 1 }] }] };
    const gradePath = `/sections/${group}/grades`;
    const period = (await read<{ gradebook: Gradebook }>(await as(educator, gradePath))).gradebook.periods[0].id;
    let book = (await read<{ gradebook: Gradebook }>(await as(educator, `${gradePath}/periods/${period}/plan`, "PUT", { activities: [
      { title: "Ensayo grupal", kind: "project", points: 100, categoryId: "general", grading: "rubric", rubric, groupMode: "group", workGroupSetId: created.set.id },
    ] }))).gradebook;
    const activityId = book.activities.find(item => item.title === "Ensayo grupal")!.id;
    expect(book.activities.find(item => item.id === activityId)).toMatchObject({ groupMode: "group", workGroupSetId: created.set.id });
    const mark = { kind: "rubric", choices: { ideas: "alto" } };
    book = (await read<{ gradebook: Gradebook }>(await as(educator, `${gradePath}/activities/${activityId}/groups`, "PUT", { workGroupId, mark }))).gradebook;
    const memberMark = (id: string) => book.marks?.find(item => item.activityId === activityId && item.learnerId === id);
    for (const id of [ana, leo, noa]) expect(memberMark(id)).toMatchObject({ mark, source: "group" });
    expect(memberMark(iva)).toBeUndefined();
    expect(book.workGroups?.flatMap(item => item.learnerIds).sort()).toEqual([ana, leo, noa].sort());
    expect(book.groupMarks).toEqual([{ activityId, workGroupId, mark }]);

    const hand = { kind: "rubric", choices: { ideas: "bajo" } };
    book = (await read<{ gradebook: Gradebook }>(await as(educator, gradePath, "PUT", { marks: [{ activityId, learnerId: ana, mark: hand }] }))).gradebook;
    book = (await read<{ gradebook: Gradebook }>(await as(educator, `${gradePath}/activities/${activityId}/groups`, "PUT", { workGroupId, mark }))).gradebook;
    expect(book.marks?.find(item => item.learnerId === ana && item.activityId === activityId)).toMatchObject({ mark: hand, source: "individual" });
    expect(book.marks?.find(item => item.learnerId === leo && item.activityId === activityId)).toMatchObject({ mark, source: "group" });

    book = (await read<{ gradebook: Gradebook }>(await as(educator, `${gradePath}/activities/${activityId}/adjustments`, "PUT", { learnerId: leo, kind: "factor", value: 0.5, note: "Participó menos" }))).gradebook;
    expect(book.marks?.find(item => item.learnerId === leo && item.activityId === activityId)).toMatchObject({ mark: { kind: "points", value: 50 }, source: "group" });
    expect(book.groupAdjustments).toEqual([{ activityId, learnerId: leo, kind: "factor", value: 0.5, note: "Participó menos" }]);
    book = (await read<{ gradebook: Gradebook }>(await as(educator, `${gradePath}/activities/${activityId}/peer-ratings`, "PUT", { ratings: [
      { raterId: ana, rateeId: leo, score: 5 }, { raterId: ana, rateeId: noa, score: 1 },
      { raterId: leo, rateeId: ana, score: 5 }, { raterId: leo, rateeId: noa, score: 1 },
      { raterId: noa, rateeId: ana, score: 5 }, { raterId: noa, rateeId: leo, score: 5 },
    ] }))).gradebook;
    expect(book.marks?.find(item => item.learnerId === ana && item.activityId === activityId)).toMatchObject({ mark: hand, source: "individual" });
    expect(book.marks?.find(item => item.learnerId === leo && item.activityId === activityId)).toMatchObject({ mark: { kind: "points", value: 50 }, source: "group" });
    expect(book.marks?.find(item => item.learnerId === noa && item.activityId === activityId)).toMatchObject({ mark: { kind: "points", value: 50 }, source: "group" });
    expect(memberMark(iva)).toBeUndefined();

    expect((await as(educator, `/sections/${group}/group-sets/${created.set.id}/regenerate`, "POST", { seed: "tarde" })).status).toBe(409);
    await read(await as(educator, `${gradePath}/periods/${period}/submit`, "POST"));
    expect((await as(educator, `${gradePath}/activities/${activityId}/groups`, "PUT", { workGroupId, mark })).status).toBe(409);
    expect((await as(outsider, `${gradePath}/activities/${activityId}/groups`, "PUT", { workGroupId, mark })).status).toBe(403);
    expect((await as(external, `${gradePath}/activities/${activityId}/groups`, "PUT", { workGroupId, mark })).status).toBe(404);
  }, 60000);
});
