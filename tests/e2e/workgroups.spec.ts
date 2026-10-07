import { test, expect } from "./local-test";
import { E2E_PREFIX, openNavigation, sectionNav, sessionToken, signIn, toast } from "./helpers";

type Groups = { workGroups: { id: string; name: string; learnerIds: string[] }[]; activities: { lessonId: string; activityId: string; title: string; grouping: string; workGroupIds: string[] }[] };
const day = (offset: number) => new Date(Date.now() + offset * 86_400_000).toLocaleDateString("en-CA", { timeZone: "America/Guatemala" });

test("HL-149 ST-111: a section forms work groups from its students and assigns them to the activities done in pairs or teams", async ({ page, playwright, baseURL }, info) => {
  const educator = await playwright.request.newContext({ baseURL, extraHTTPHeaders: { Origin: baseURL!, Cookie: `hl_session=${await sessionToken("educador-demo")}` } });
  const admin = await playwright.request.newContext({ baseURL, extraHTTPHeaders: { Origin: baseURL!, Cookie: `hl_session=${await sessionToken("admin-demo")}` } });
  const student = await playwright.request.newContext({ baseURL, extraHTTPHeaders: { Origin: baseURL! } });
  try {
    const body = { title: `${E2E_PREFIX} Grupos ${info.project.name}`, objective: "Trabajar en equipo.", status: "active", educationType: "non-formal", level: "unspecified", format: "workshop", modality: "in-person", pacing: "scheduled", area: "011", settings: {}, programId: null };
    const courseId = (await (await admin.post("/api/courses", { data: { ...body, leadId: "user-educator" } })).json()).id, path = `/api/courses/${courseId}`;
    const courseUnitId = (await (await educator.post(`${path}/units`, { data: { name: `${E2E_PREFIX} Módulo`, objective: "Practicar.", status: "active", version: 1 } })).json()).id;
    const step = (id: string, position: number, title: string, grouping?: string) => ({ id, type: "text", position, title, instructions: "Sigue las indicaciones.", minutes: 10, ...(grouping ? { grouping } : {}) });
    const created = await educator.post("/api/lessons", { data: { title: `${E2E_PREFIX} Argumentar`, objective: "Defender una idea.", courseId, courseUnitId, instructions: "", duration: 30,
      activities: [step("activity-read", 0, "Leer el caso", "individual"), step("activity-debate", 1, "Debate", "teams"), step("activity-interview", 2, "Entrevista", "pairs")] } });
    expect(created.status(), await created.text()).toBe(201);
    const lesson = (await created.json()).lesson as { id: string; shareCode: string };
    expect((await educator.post(`/api/lessons/${lesson.id}/publish`)).status()).toBe(200);
    const groupId = (await (await admin.post(`${path}/groups`, { data: { name: `${E2E_PREFIX} Sección A` } })).json()).id, section = `${path}/groups/${groupId}`;
    const names = ["Ana", "Beto", "Caro", "Dani"].map(name => `${E2E_PREFIX} ${name}`);
    const ids: string[] = [];
    for (const displayName of names) ids.push((await (await admin.post(`${section}/learners`, { data: { displayName } })).json()).id);
    expect((await admin.put(`${section}/educators`, { data: { userIds: ["user-educator"], conflictReason: "Sección de prueba E2E; su horario puede coincidir con otras secciones de prueba." } })).status()).toBe(200);
    const read = async () => (await (await educator.get(`${section}/work-groups`)).json()) as Groups;

    // The whole section is the default group: activities in pairs or teams start without groups of their own.
    let groups = await read();
    expect(groups.workGroups).toEqual([]);
    expect(groups.activities.map(item => [item.title, item.grouping, item.workGroupIds])).toEqual([["Debate", "teams", []], ["Entrevista", "pairs", []]]);
    expect((await (await educator.get(`/api/sections/${groupId}`)).json()).section.workGroups).toBe(true);

    expect((await educator.post(`${section}/work-groups`, { data: { name: "Toda la sección", learnerIds: [] } })).status()).toBe(400);
    expect((await educator.post(`${section}/work-groups`, { data: { name: "Equipo Azul", learnerIds: ["learner-elsewhere"] } })).status()).toBe(400);
    expect((await educator.post(`${section}/work-groups`, { data: { name: "Equipo Azul", learnerIds: [ids[0], ids[0]] } })).status()).toBe(400);
    const blue = await educator.post(`${section}/work-groups`, { data: { name: "Equipo Azul", learnerIds: [ids[0], ids[1]] } });
    expect(blue.status(), await blue.text()).toBe(201);
    const blueId = (await blue.json()).id;
    expect((await admin.post(`${section}/work-groups`, { data: { name: "equipo azul", learnerIds: [] } })).status()).toBe(409);
    const redId = (await (await admin.post(`${section}/work-groups`, { data: { name: "Equipo Rojo", learnerIds: [ids[2], ids[3]] } })).json()).id;

    const assign = (activityId: string, workGroupIds: string[]) => educator.put(`${section}/activity-groups`, { data: { lessonId: lesson.id, activityId, workGroupIds } });
    expect((await assign("activity-read", [blueId])).status()).toBe(400);
    expect((await assign("activity-debate", ["work-group-elsewhere"])).status()).toBe(400);
    expect((await assign("activity-debate", [blueId, redId])).status()).toBe(200);
    groups = await read();
    expect(groups.workGroups.map(group => [group.name, group.learnerIds.length])).toEqual([["Equipo Azul", 2], ["Equipo Rojo", 2]]);
    expect(groups.activities.find(item => item.activityId === "activity-debate")!.workGroupIds.sort()).toEqual([blueId, redId].sort());

    // With the section code, students see which groups do the activity; without it, nothing about the section.
    const { accessCode } = await (await admin.post(`${section}/code`)).json();
    expect((await (await student.get(`/api/share/${lesson.shareCode}`)).json()).groups).toEqual([]);
    expect((await student.post("/api/student/login", { data: { code: accessCode } })).status()).toBe(200);
    expect((await (await student.get(`/api/share/${lesson.shareCode}`)).json()).groups).toEqual([{ activityId: "activity-debate", groups: [{ name: "Equipo Azul", mine: false }, { name: "Equipo Rojo", mine: false }] }]);

    // Turning work groups off keeps what exists readable and stops changes.
    const version = async () => (await (await admin.get(path)).json()).course.version as number;
    expect((await admin.put(path, { data: { ...body, settings: { workGroups: false }, version: await version() } })).status()).toBe(200);
    expect((await educator.post(`${section}/work-groups`, { data: { name: "Equipo Verde", learnerIds: [] } })).status()).toBe(409);
    expect((await educator.get(`${section}/work-groups`)).status()).toBe(200);
    expect((await (await educator.get(`/api/sections/${groupId}`)).json()).section.workGroups).toBe(false);
    expect((await (await student.get(`/api/share/${lesson.shareCode}`)).json()).groups).toEqual([]);
    expect((await admin.put(path, { data: { ...body, settings: {}, version: await version() } })).status()).toBe(200);

    // Deleting a group frees its activities; without groups left, the whole section does them.
    expect((await educator.delete(`${section}/work-groups/${redId}`)).status()).toBe(200);
    expect((await read()).activities.find(item => item.activityId === "activity-debate")!.workGroupIds).toEqual([blueId]);
    const session = await educator.post(`${path}/sessions`, { data: { groupId, sessionDate: day(1), lessonIds: [lesson.id] } });
    expect(session.status(), await session.text()).toBe(201);
    const sessionId = (await session.json()).id;

    // In the browser: the educator forms a group and assigns it; the class shows who does each activity.
    await signIn(page, "educador-demo", `/secciones/${groupId}`);
    await expect(page.locator(".overview-kpis")).toBeVisible();
    await openNavigation(page);
    await sectionNav(page).getByRole("link", { name: "Grupos", exact: true }).click();
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Grupos de trabajo");
    await expect(page.getByRole("heading", { name: "Toda la sección" })).toBeVisible();
    await page.getByRole("button", { name: "Nuevo grupo" }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel("Nombre del grupo").fill("Equipo Verde");
    await dialog.getByRole("checkbox", { name: names[2], exact: true }).check();
    await dialog.getByRole("checkbox", { name: names[3], exact: true }).check();
    await dialog.getByRole("button", { name: "Formar grupo" }).click();
    await expect(toast(page)).toContainText("«Equipo Verde» quedó formado.");
    await expect(page.getByRole("list", { name: "Integrantes de Equipo Verde" })).toContainText(names[2]);
    await page.getByRole("button", { name: "Asignar grupos a Entrevista" }).click();
    await page.getByRole("dialog").getByRole("checkbox", { name: "Equipo Verde" }).check();
    await page.getByRole("dialog").getByRole("button", { name: "Guardar" }).click();
    const rows = page.getByRole("region", { name: "Actividades en grupo" }).locator("tbody tr");
    await expect(rows.filter({ hasText: "Entrevista" })).toContainText("Equipo Verde");
    await expect(rows.filter({ hasText: "Debate" })).toContainText("Equipo Azul");
    expect(await page.evaluate(() => Math.max(document.documentElement.scrollWidth, innerWidth) <= screen.width)).toBe(true);
    await page.goto(`/secciones/${groupId}/clases/${sessionId}`);
    const lessonCard = page.locator(".class-lesson").first();
    await expect(lessonCard.locator(".activity-teams")).toHaveText(["Equipo Azul", "Equipo Verde"]);

    // Students see the groups of each activity in the lesson.
    await page.context().clearCookies();
    await page.goto("/inicio");
    const entry = page.getByRole("form", { name: "¿Eres estudiante?" });
    await entry.getByLabel("Código de sección o de lección").fill(accessCode);
    await entry.getByRole("button", { name: "Abrir" }).click();
    await expect(page).toHaveURL(/\/estudiante$/);
    await page.goto(`/aprender/${lesson.shareCode}`);
    await page.getByRole("button", { name: "Empezar" }).click();
    await page.getByRole("button", { name: "Siguiente", exact: true }).click();
    await expect(page.locator(".player-teams")).toContainText("La trabaja Equipo Azul.");
  } finally { await educator.dispose(); await admin.dispose(); await student.dispose(); }
});
