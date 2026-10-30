import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn, type ChildProcess } from "node:child_process";
import { createServer } from "node:net";
import { once } from "node:events";
import { setTimeout as delay } from "node:timers/promises";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

// ST-049: two sections of one course keep different plans, and «igual» still answers as it does today.

let worker: ChildProcess;
let origin = "";
let logs = "";
const storage = mkdtempSync(join(tmpdir(), "hl-platform-freedom-"));
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
}, 60_000);
afterAll(async () => {
  if (worker && worker.exitCode === null) { const exited = once(worker, "exit"); worker.kill("SIGTERM"); await exited; }
  rmSync(storage, { recursive: true, force: true });
});

async function login(username: string) {
  const response = await fetch(`${origin}/api/login`, { method: "POST", headers: { "Content-Type": "application/json", Origin: origin }, body: JSON.stringify({ username, password: "Aprender-2026!" }) });
  expect(response.status, await response.clone().text()).toBe(200);
  return response.headers.get("set-cookie")!.split(";")[0];
}
const call = (cookie: string, path: string, method = "GET", data?: unknown) =>
  fetch(origin + "/api" + path, { method, headers: { Cookie: cookie, Origin: origin, ...(data ? { "Content-Type": "application/json" } : {}) }, ...(data ? { body: JSON.stringify(data) } : {}) });
const read = async <T = Record<string, unknown>>(response: Response, status = 200): Promise<T> => { expect(response.status, await response.clone().text()).toBe(status); return response.json() as Promise<T>; };
const day = (offset: number) => new Date(Date.now() + offset * 86_400_000).toLocaleDateString("en-CA", { timeZone: "America/Guatemala" });

describe("ST-049 libertad de cátedra por sección", () => {
  it("keeps two sections apart, refuses a policy change that would drop grades, and leaves «igual» unchanged", async () => {
    const admin = await login("admin-demo");
    const lead = await login("educador-demo");
    const other = await login("instructor-demo");
    const course = await read<{ id: string }>(await call(admin, "/courses", "POST", {
      title: "Catedra de prueba", objective: "Adaptar por seccion.", status: "active", educationType: "non-formal", level: "unspecified", format: "subject", modality: "in-person", pacing: "scheduled", settings: { sectionFreedom: "flexible" }, programId: null, leadId: "user-educator",
    }), 201);
    const loaded = await read<{ course: { version: number } }>(await call(admin, `/courses/${course.id}`));
    await read(await call(admin, `/courses/${course.id}/team`, "PUT", { version: loaded.course.version, members: [{ userId: "user-educator", role: "lead" }, { userId: "user-1", role: "co-teacher" }] }));
    const sectionA = await read<{ id: string }>(await call(admin, `/courses/${course.id}/groups`, "POST", { name: "Seccion A" }), 201);
    const sectionB = await read<{ id: string }>(await call(admin, `/courses/${course.id}/groups`, "POST", { name: "Seccion B" }), 201);
    await read(await call(admin, `/courses/${course.id}/groups/${sectionA.id}/educators`, "PUT", { userIds: ["user-educator"] }));
    await read(await call(admin, `/courses/${course.id}/groups/${sectionB.id}/educators`, "PUT", { userIds: ["user-1"] }));
    const version = async () => (await read<{ course: { version: number } }>(await call(admin, `/courses/${course.id}`))).course.version;
    const unit = await read<{ id: string }>(await call(lead, `/courses/${course.id}/units`, "POST", { version: await version(), name: "Unidad", objective: "La unidad", status: "active" }), 201);
    const lessonBody = (title: string) => ({ title, objective: "Objetivo", instructions: "Haz la actividad", courseUnitId: unit.id, activities: [{ id: "a", type: "text", position: 0, title: "Actividad", instructions: "Sigue", minutes: 10 }] });
    const kept = await read<{ lesson: { id: string } }>(await call(lead, "/lessons", "POST", lessonBody("Leccion del nucleo")), 201);
    const optional = await read<{ lesson: { id: string } }>(await call(lead, "/lessons", "POST", lessonBody("Leccion que la A oculta")), 201);
    await read(await call(lead, `/lessons/${kept.lesson.id}/publish`, "POST"));
    await read(await call(lead, `/lessons/${optional.lesson.id}/publish`, "POST"));
    await read(await call(lead, `/courses/${course.id}/core`, "PUT", { lessons: [{ id: optional.lesson.id, core: false }] }));
    const hiddenCore = await call(lead, `/sections/${sectionA.id}/content-overrides`, "PUT", { itemType: "lesson", itemId: kept.lesson.id, hidden: true, position: null });
    expect(hiddenCore.status, await hiddenCore.clone().text()).toBe(409);
    await read(await call(lead, `/sections/${sectionA.id}/content-overrides`, "PUT", { itemType: "lesson", itemId: optional.lesson.id, hidden: true, position: null }));
    const own = await read<{ lesson: { id: string } }>(await call(lead, `/sections/${sectionA.id}/lessons`, "POST", lessonBody("Leccion propia de la A")), 201);
    await read(await call(lead, `/lessons/${own.lesson.id}/publish`, "POST"));
    expect((await call(other, `/sections/${sectionA.id}/lessons`, "POST", lessonBody("No deberia"))).status).toBe(403);

    const planA = await read<{ lessons: { id: string }[]; hiddenLessons: { id: string }[] }>(await call(lead, `/sections/${sectionA.id}/plan`));
    const planB = await read<{ lessons: { id: string }[]; hiddenLessons: { id: string }[] }>(await call(other, `/sections/${sectionB.id}/plan`));
    expect(planA.lessons.map(item => item.id)).toContain(own.lesson.id);
    expect(planA.lessons.map(item => item.id)).not.toContain(optional.lesson.id);
    expect(planA.hiddenLessons.map(item => item.id)).toContain(optional.lesson.id);
    expect(planB.lessons.map(item => item.id)).toContain(optional.lesson.id);
    expect(planB.lessons.map(item => item.id)).not.toContain(own.lesson.id);
    expect((await call(other, `/courses/${course.id}/sessions`, "POST", { groupId: sectionB.id, sessionDate: day(1), lessonIds: [own.lesson.id] })).status).toBe(400);
    expect((await call(lead, `/courses/${course.id}/sessions`, "POST", { groupId: sectionA.id, sessionDate: day(1), lessonIds: [optional.lesson.id] })).status).toBe(400);
    expect((await call(other, `/courses/${course.id}/sessions`, "POST", { groupId: sectionB.id, sessionDate: day(1), lessonIds: [optional.lesson.id] })).status).toBe(201);

    const pdf = async (section: string) => new TextDecoder().decode(await (await call(admin, `/courses/${course.id}/units/${unit.id}/delivery.pdf?section=${section}`)).arrayBuffer());
    const copyA = await pdf(sectionA.id);
    const copyB = await pdf(sectionB.id);
    expect(copyA).toContain("Leccion propia de la A");
    expect(copyA).not.toContain("Leccion que la A oculta");
    expect(copyB).toContain("Leccion que la A oculta");
    expect(copyB).not.toContain("Leccion propia de la A");

    const assessment = await read<{ periods: { id: string }[] }>(await call(lead, `/courses/${course.id}/assessment`));
    const learner = await read<{ id: string }>(await call(admin, `/courses/${course.id}/groups/${sectionA.id}/learners`, "POST", { displayName: "Ana" }), 201);
    await read(await call(admin, `/courses/${course.id}/groups/${sectionA.id}/learners`, "POST", { displayName: "Luis" }), 201);
    const set = await read<{ set: { id: string } }>(await call(lead, `/sections/${sectionA.id}/group-sets`, "POST", { name: "Equipos", rules: { by: "count", count: 1, how: "random", seed: "libertad" } }), 201);
    const activity = await read<{ id: string }>(await call(lead, `/sections/${sectionA.id}/activities`, "POST", {
      periodId: assessment.periods[0].id, title: "Ensayo de la A", kind: "project", categoryId: "general", points: 10, grading: "points", groupMode: "group", workGroupSetId: set.set.id,
    }), 201);
    const bookA = await read<{ gradebook: { activities: { id: string; workGroupSetId?: string | null }[] } }>(await call(lead, `/sections/${sectionA.id}/grades`));
    const bookB = await read<{ gradebook: { activities: { id: string }[] } }>(await call(other, `/sections/${sectionB.id}/grades`));
    expect(bookA.gradebook.activities.find(item => item.id === activity.id)?.workGroupSetId).toBe(set.set.id);
    expect(bookB.gradebook.activities.map(item => item.id)).not.toContain(activity.id);
    await read(await call(lead, `/sections/${sectionA.id}/grades`, "PUT", { scores: [{ activityId: activity.id, learnerId: learner.id, points: 8 }] }));
    const current = await read<{ course: { version: number; title: string; objective: string; status: string; educationType: string; level: string; format: string; modality: string; pacing: string; settings: Record<string, unknown>; programId: string | null } }>(await call(admin, `/courses/${course.id}`));
    const refused = await call(admin, `/courses/${course.id}`, "PUT", { ...current.course, settings: { ...current.course.settings, sectionFreedom: "shared" } });
    expect(refused.status).toBe(409);
    const refusal = await refused.json() as { error: string; affected: { section: string; activity: string }[] };
    expect(refusal.error).toContain("Seccion A");
    expect(refusal.affected).toEqual([{ section: "Seccion A", activity: "Ensayo de la A", kind: "own" }]);

    const differences = await read<{ sections: { name: string; added: number; hidden: number }[] }>(await call(admin, `/courses/${course.id}/sections/differences`));
    expect(differences.sections.find(item => item.name === "Seccion A")).toMatchObject({ added: 2, hidden: 1 });
    expect(differences.sections.find(item => item.name === "Seccion B")).toMatchObject({ added: 0, hidden: 0 });

    const sharedLessons = await read<{ lessons: Record<string, unknown>[] }>(await call(lead, "/lessons"));
    for (const lesson of sharedLessons.lessons) expect(lesson).not.toHaveProperty("groupId");
    expect((await call(admin, "/sections/seed-group-mat-6a/plan")).status).toBe(404);
    const sharedBook = await read<{ gradebook: { activities: Record<string, unknown>[] } }>(await call(admin, "/sections/seed-group-mat-6a/grades"));
    expect(sharedBook.gradebook.activities.some(item => item.title === "Tareas")).toBe(true);
    for (const activity of sharedBook.gradebook.activities) expect(activity).not.toHaveProperty("groupId");
  });
});
