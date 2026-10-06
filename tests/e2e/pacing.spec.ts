import { test, expect } from "./local-test";
import { E2E_PREFIX, openNavigation, sectionNav, sessionToken, signIn } from "./helpers";

type Space = { pacing: string; learner: { id: string; name: string } | null; roster: { id: string; name: string }[]; path: { name: string; lessons: { title: string; shareCode: string; opened: boolean; completed: boolean }[] }[] };

test("HL-142 ST-110: a self-paced section has no schedule or classes; each student works through the course and the section follows their progress", async ({ page, playwright, baseURL }, info) => {
  const educator = await playwright.request.newContext({ baseURL, extraHTTPHeaders: { Origin: baseURL!, Cookie: `hl_session=${await sessionToken("educador-demo")}` } });
  const admin = await playwright.request.newContext({ baseURL, extraHTTPHeaders: { Origin: baseURL!, Cookie: `hl_session=${await sessionToken("admin-demo")}` } });
  const student = await playwright.request.newContext({ baseURL, extraHTTPHeaders: { Origin: baseURL! } });
  try {
    const body = { title: `${E2E_PREFIX} A tu ritmo ${info.project.name}`, objective: "Avanzar a su ritmo.", status: "active", educationType: "non-formal", level: "unspecified", format: "open-course", modality: "online", pacing: "self-paced", area: "023", settings: { attendance: true }, programId: null };
    const courseId = (await (await admin.post("/api/courses", { data: { ...body, leadId: "user-educator" } })).json()).id, path = `/api/courses/${courseId}`;
    const version = async () => (await (await educator.get(path)).json()).course.version as number;
    const lessons: { id: string; title: string; shareCode: string }[] = [];
    for (const [unit, titles] of [["Saludos", ["Hola", "Adiós"]], ["Números", ["Contar"]]] as const) {
      const courseUnitId = (await (await educator.post(`${path}/units`, { data: { name: `${E2E_PREFIX} ${unit}`, objective: "Practicar.", status: "active", version: await version() } })).json()).id;
      for (const title of titles) {
        const lesson = (await (await educator.post("/api/lessons", { data: { title: `${E2E_PREFIX} ${title}`, objective: "Practicar.", courseId, courseUnitId, instructions: "Sigue las indicaciones.", duration: 10 } })).json()).lesson;
        expect((await educator.post(`/api/lessons/${lesson.id}/publish`)).status()).toBe(200);
        lessons.push(lesson);
      }
    }
    const groupId = (await (await admin.post(`${path}/groups`, { data: { name: `${E2E_PREFIX} Grupo libre` } })).json()).id;
    const [ana, beto] = [`${E2E_PREFIX} Ana`, `${E2E_PREFIX} Beto`];
    const anaId = (await (await admin.post(`${path}/groups/${groupId}/learners`, { data: { displayName: ana } })).json()).id;
    expect((await admin.post(`${path}/groups/${groupId}/learners`, { data: { displayName: beto } })).status()).toBe(201);
    expect((await admin.put(`${path}/groups/${groupId}/educators`, { data: { userIds: ["user-educator"] } })).status()).toBe(200);
    const { accessCode } = await (await admin.post(`${path}/groups/${groupId}/code`)).json();

    // No schedule, no classes and no lesson planning: the course is the path.
    expect((await admin.put(`${path}/groups/${groupId}/schedule`, { data: { weekdays: [1], startsAt: "08:00", durationMinutes: 45, from: "2026-10-12", until: "2026-10-30" } })).status()).toBe(409);
    expect((await educator.post(`${path}/sessions`, { data: { groupId, sessionDate: "2026-10-12" } })).status()).toBe(409);
    expect((await educator.post(`${path}/groups/${groupId}/lessons`, { data: { perClass: 1 } })).status()).toBe(409);
    const section = async () => (await (await educator.get(`/api/sections/${groupId}`)).json()).section;
    expect(await section()).toMatchObject({ pacing: "self-paced", schedule: null, next: null, indicators: { learners: 2, started: 0, finished: 0, pathAverage: 0 } });

    // The student enters with the code and picks their name from the section's list.
    expect((await student.post("/api/student/login", { data: { code: accessCode } })).status()).toBe(200);
    let space = await (await student.get("/api/student/space")).json() as Space;
    expect(space).toMatchObject({ pacing: "self-paced", learner: null });
    expect(space.roster.map(person => person.name)).toEqual([ana, beto]);
    expect(space.path.map(unit => [unit.name, unit.lessons.map(lesson => lesson.title)])).toEqual([[`${E2E_PREFIX} Saludos`, [lessons[0].title, lessons[1].title]], [`${E2E_PREFIX} Números`, [lessons[2].title]]]);
    expect((await student.post("/api/student/progress", { data: { shareCode: lessons[0].shareCode } })).status()).toBe(409);
    expect((await student.post("/api/student/identity", { data: { learnerId: "learner-elsewhere" } })).status()).toBe(400);
    expect((await student.post("/api/student/identity", { data: { learnerId: anaId } })).status()).toBe(200);
    // Opening a lesson records it; finishing it in the player counts it in the student's progress.
    expect((await student.post("/api/student/progress", { data: { shareCode: "NOT-IN-COURSE" } })).status()).toBe(404);
    expect((await student.post("/api/student/progress", { data: { shareCode: lessons[0].shareCode } })).status()).toBe(200);
    expect(await (await student.post(`/api/share/${lessons[0].shareCode}/complete`)).json()).toMatchObject({ ok: true, learner: ana });
    expect((await student.post("/api/student/progress", { data: { shareCode: lessons[1].shareCode } })).status()).toBe(200);
    space = await (await student.get("/api/student/space")).json() as Space;
    expect(space.learner).toEqual({ id: anaId, name: ana });
    expect(space.roster).toEqual([]);
    expect(space.path[0].lessons.map(lesson => [lesson.opened, lesson.completed])).toEqual([[true, true], [true, false]]);

    const response = await educator.get(`/api/sections/${groupId}/progress`);
    expect(response.status(), await response.text()).toBe(200);
    const progress = await response.json();
    expect(progress.lessons.map((lesson: { id: string }) => lesson.id)).toEqual(lessons.map(lesson => lesson.id));
    expect(progress.learners.map((learner: { name: string; completed: string[]; opened: string[] }) => [learner.name, learner.completed, learner.opened.length])).toEqual([[ana, [lessons[0].id], 2], [beto, [], 0]]);
    expect((await section()).indicators).toMatchObject({ started: 1, finished: 0, pathAverage: 17 });

    // In the browser: another student picks their name, finishes the first lesson and returns to their section.
    await page.goto("/inicio");
    const entry = page.getByRole("form", { name: "¿Eres estudiante?" });
    await entry.getByLabel("Código de sección o de lección").fill(accessCode);
    await entry.getByRole("button", { name: "Abrir" }).click();
    await expect(page).toHaveURL(/\/estudiante$/);
    await expect(page.getByRole("heading", { name: "¿Quién eres?" })).toBeVisible();
    await page.getByRole("button", { name: beto, exact: true }).click();
    await expect(page.locator(".student-next")).toContainText(`Hola, ${beto}`);
    await expect(page.locator(".student-next")).toContainText("Empieza el curso");
    await page.getByRole("button", { name: `Abrir lección: ${lessons[0].title}` }).click();
    await expect(page).toHaveURL(new RegExp(`/aprender/${lessons[0].shareCode}`));
    await page.getByRole("button", { name: "Empezar" }).click();
    const nextStep = page.getByRole("button", { name: "Siguiente", exact: true });
    while (await nextStep.isVisible()) await nextStep.click();
    await page.getByRole("button", { name: "Terminar lección" }).click();
    await expect(page.getByRole("status").filter({ hasText: "¡Bien hecho" })).toContainText(beto);
    await page.getByRole("link", { name: "Volver a mi sección" }).click();
    await expect(page.locator(".student-next")).toContainText("Continúa donde te quedaste");
    await expect(page.locator(".student-path li.is-done")).toHaveCount(1);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);

    // The educator follows the section's progress; it has no schedule or classes to manage.
    await signIn(page, "educador-demo", `/secciones/${groupId}`);
    await expect(page.locator(".page-header")).toContainText("a tu ritmo");
    await expect(page.locator(".overview-kpis")).toContainText("Empezaron");
    await openNavigation(page);
    await expect(sectionNav(page).getByRole("link", { name: "Cronograma", exact: true })).toHaveCount(0);
    await sectionNav(page).getByRole("link", { name: "Avance", exact: true }).click();
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Avance");
    const rows = page.getByRole("region", { name: "Avance por estudiante" }).locator("tbody tr");
    await expect(rows.filter({ hasText: ana })).toContainText("1 de 3");
    await expect(rows.filter({ hasText: ana })).toContainText(lessons[1].title);
    await expect(rows.filter({ hasText: beto })).toContainText("1 de 3");
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.goto(`/secciones/${groupId}/horario`);
    await expect(page.getByRole("heading", { name: "Este curso es a tu ritmo" })).toBeVisible();
  } finally { await educator.dispose(); await admin.dispose(); await student.dispose(); }
});
