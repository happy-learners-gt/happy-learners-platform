import { test, expect } from "./local-test";
import type { APIRequestContext } from "@playwright/test";
import { E2E_PREFIX, sessionToken } from "./helpers";

test("HL-44: course authorization, programs, configured requirements, versions and cross-course references", async ({ playwright, baseURL }, info) => {
  const contexts: APIRequestContext[] = [];
  async function client(username?: string) {
    const cookie: Record<string, string> = username ? { Cookie: `hl_session=${await sessionToken(username)}` } : {};
    const c = await playwright.request.newContext({ baseURL, extraHTTPHeaders: { Origin: baseURL!, ...cookie }, timeout: 15000 }); contexts.push(c);
    return c;
  }
  try {
    const anon = await client(), educator = await client("educador-demo"), admin = await client("admin-demo"), other = await client("externo-demo");
    expect((await anon.get("/api/courses")).status()).toBe(401);
    const body = { title: `${E2E_PREFIX} Laboratorio ${Date.now().toString(36)} ${info.project.name}`, objective: "Describir evidencias sin identificar personas.", status: "active", educationType: "non-formal", level: "unspecified", format: "laboratory", modality: "in-person", pacing: "scheduled", area: "053", settings: {}, programId: null };
    // DEC-023: administration creates courses, always with an active lead of its organization; educators do not.
    const course = { ...body, leadId: "user-educator" };
    expect((await educator.post("/api/courses", { data: course })).status()).toBe(403);
    expect((await admin.post("/api/courses", { data: body })).status()).toBe(400);
    expect((await admin.post("/api/courses", { data: { ...body, leadId: "user-2" } })).status()).toBe(400);
    // Resource tags stay administrable by administration only.
    expect((await educator.post("/api/vocabularies", { data: { name: "Área", status: "active" } })).status()).toBe(403);
    const run = Date.now().toString(36);
    const vocabulary = { name: `${E2E_PREFIX} Destreza ${run} ${info.project.name}`, status: "active" };
    const vr = await admin.post("/api/vocabularies", { data: vocabulary }); expect(vr.status()).toBe(201);
    const vid = (await vr.json()).id;
    expect((await admin.post("/api/vocabularies", { data: vocabulary })).status()).toBe(409);
    const tr = await admin.post("/api/terms", { data: { vocabularyId: vid, name: "Observación", status: "active" } }); expect(tr.status()).toBe(201);
    const tid = (await tr.json()).id;
    // Programs: administration manages them; a course in a program takes its type, level, modality and pacing.
    const programBody = { name: `${E2E_PREFIX} Secundaria ${run} ${info.project.name}`, description: "", educationType: "formal", level: "lower-secondary", format: "subject", modality: "in-person", pacing: "scheduled", settings: { moduleLabel: "units" }, locked: ["moduleLabel"], status: "active" };
    expect((await educator.post("/api/programs", { data: programBody })).status()).toBe(403);
    expect((await admin.post("/api/programs", { data: { ...programBody, level: "unspecified" } })).status()).toBe(400);
    expect((await admin.post("/api/programs", { data: { ...programBody, settings: {}, locked: ["attendance"] } })).status()).toBe(400);
    const pr = await admin.post("/api/programs", { data: programBody }); expect(pr.status()).toBe(201);
    const pid = (await pr.json()).id;
    const inProgram = await admin.post("/api/courses", { data: { ...course, title: `${body.title} programa`, programId: pid, settings: { moduleLabel: "weeks" } } }); expect(inProgram.status()).toBe(201);
    const programCourse = (await (await educator.get(`/api/courses/${(await inProgram.json()).id}`)).json()).course;
    expect([programCourse.educationType, programCourse.level, programCourse.modality, programCourse.programId, programCourse.settings]).toEqual(["formal", "lower-secondary", "in-person", pid, {}]);
    const otherProgram = await other.post("/api/programs", { data: { ...programBody, name: "Ajeno" } });
    expect(otherProgram.status()).toBe(403);
    expect((await admin.post("/api/courses", { data: { ...course, programId: "program-of-another-organization" } })).status()).toBe(400);
    expect((await admin.post("/api/courses", { data: { ...course, educationType: "formal" } })).status()).toBe(400);
    const created = await admin.post("/api/courses", { data: course }); expect(created.status()).toBe(201);
    const cid = (await created.json()).id, path = `/api/courses/${cid}`;
    expect((await other.get(path)).status()).toBe(404);
    expect((await other.get(`/api/lessons?drafts=1&course=${cid}`)).status()).toBe(404);
    expect((await (await educator.get(path)).json()).course.team).toMatchObject([{ userId: "user-educator", role: "lead" }]);
    // The lead prepares the content; the course's configuration is administration's.
    expect((await educator.put(path, { data: { ...body, settings: { attendance: false }, version: 1 } })).status()).toBe(403);
    expect((await admin.put(path, { data: { ...body, area: "999", version: 1 } })).status()).toBe(400);
    expect((await admin.put(path, { data: { ...body, settings: { attendance: false }, version: 1 } })).status()).toBe(200);
    expect((await admin.put(path, { data: { ...body, version: 1 } })).status()).toBe(409);
    expect((await (await educator.get(path)).json()).course.settings).toEqual({ attendance: false });
    // Attendance turned off: no new groups.
    expect((await admin.post(`${path}/groups`, { data: { name: "Grupo A" } })).status()).toBe(409);
    // Administration reads the content but does not write it.
    expect((await admin.post(`${path}/units`, { data: { name: "Sin permiso", objective: "", status: "active", version: 2 } })).status()).toBe(403);
    const unitData = { name: `${E2E_PREFIX} Observar y describir`, objective: "Distinguir observación de interpretación.", status: "active", version: 2 };
    const ur = await educator.post(`${path}/units`, { data: unitData }); expect(ur.status()).toBe(201);
    const uid = (await ur.json()).id;
    expect((await educator.post(`${path}/units`, { data: unitData })).status()).toBe(409);
    expect((await (await educator.get(path)).json()).units).toHaveLength(1);
    expect((await educator.put(`${path}/units/order`, { data: { version: 3, ids: [uid, uid] } })).status()).toBe(400);
    expect((await educator.put(`${path}/units/order`, { data: { version: 3, ids: [] } })).status()).toBe(400);
    const material = { title: `${E2E_PREFIX} Ficha de observación`, description: "Anota rasgos visibles, sin nombres.", content: "Describe color, forma y textura.", kind: "text", status: "published", termIds: [tid] };
    const mr = await educator.post(`${path}/materials`, { data: material }); expect(mr.status()).toBe(201);
    const mid = (await mr.json()).material.id;
    expect((await educator.post(`${path}/materials`, { data: { ...material, kind: "link", content: "javascript:alert(1)" } })).status()).toBe(400);
    expect((await educator.put(`${path}/materials/${mid}`, { data: { ...material, version: 1 } })).status()).toBe(200);
    expect((await educator.put(`${path}/materials/${mid}`, { data: { ...material, version: 1 } })).status()).toBe(409);
    const cid2 = (await (await admin.post("/api/courses", { data: course })).json()).id;
    const foreign = (await (await educator.post(`/api/courses/${cid2}/materials`, { data: material })).json()).material.id;
    const activity = { id: "activity-observation", type: "resource", position: 0, title: "Observa un objeto", instructions: "Lee la ficha.", minutes: 5, resourceId: mid };
    const lesson = { title: `${E2E_PREFIX} Observar sin suponer`, objective: "Describir lo que se ve.", courseId: cid, courseUnitId: uid, instructions: "Lee la ficha.", duration: 10, activities: [activity] };
    expect((await educator.post("/api/lessons", { data: { ...lesson, activities: [{ ...activity, resourceId: foreign }] } })).status()).toBe(400);
    const lr = await educator.post("/api/lessons", { data: lesson }); expect(lr.status()).toBe(201);
    const saved = (await lr.json()).lesson;
    expect((await educator.post(`/api/lessons/${saved.id}/publish`)).status()).toBe(200);
    expect((await educator.put(`${path}/materials/${mid}`, { data: { ...material, status: "archived", version: 2 } })).status()).toBe(200);
    const publicView = await (await anon.get(`/api/share/${saved.shareCode}`)).json();
    expect(publicView.lesson.resources[0].content).toBe(material.content);
    expect((await educator.post("/api/lessons", { data: lesson })).status()).toBe(400);
    expect((await educator.put(`/api/lessons/${saved.id}`, { data: { ...lesson, draftVersion: saved.draftVersion } })).status()).toBe(200);
    // A course that requires outcomes refuses to publish a lesson without them.
    expect((await admin.put(path, { data: { ...body, settings: { attendance: false, outcomesRequired: true }, version: 3 } })).status()).toBe(200);
    const blocked = await educator.post(`/api/lessons/${saved.id}/publish`); expect(blocked.status()).toBe(400);
    expect((await blocked.json()).error).toContain("resultado de aprendizaje");
    expect((await admin.put(path, { data: { ...body, settings: { attendance: false, outcomesRequired: true }, status: "archived", version: 4 } })).status()).toBe(200);
    expect((await educator.post(`${path}/materials`, { data: material })).status()).toBe(409);
    expect((await educator.post(`/api/lessons/${saved.id}/publish`)).status()).toBe(409);
    expect((await anon.get(`/api/share/${saved.shareCode}`)).status()).toBe(200);
    // Real competing saves: exactly one request can consume the current version.
    const parallel = await Promise.all([
      admin.put(`/api/courses/${cid2}`, { data: { ...body, title: `${E2E_PREFIX} Lectura de evidencias`, version: 1 } }),
      admin.put(`/api/courses/${cid2}`, { data: { ...body, title: `${E2E_PREFIX} Taller de observación`, version: 1 } }),
    ]);
    expect(parallel.map(r => r.status()).sort()).toEqual([200, 409]);
    expect((await (await educator.get(`/api/courses/${cid2}`)).json()).course.version).toBe(2);
  } finally { for (const c of contexts) await c.dispose(); }
});
