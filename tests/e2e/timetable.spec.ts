import { test, expect } from "./local-test";
import { E2E_PREFIX, courseNav, openNavigation, sectionNav, sessionToken, signIn } from "./helpers";

type Session = { id: string; groupId: string; lessons: { id: string; available: boolean; revision?: number | null }[]; sessionDate: string; startsAt: string | null; durationMinutes: number | null; status: string; origin: string; version: number; notes: string };
const ids = (session: Session) => session.lessons.map(lesson => lesson.id);
// Dates in the organization's time zone, as the app computes them, whatever the runner's clock.
const day = (offset: number) => new Date(Date.now() + offset * 86_400_000).toLocaleDateString("en-CA", { timeZone: "America/Guatemala" });

test("ST-099 ST-097 ST-101 ST-029 ST-100: the section schedule generates its classes, planned with optional lessons in order, and completed classes feed coverage", async ({ page, playwright, baseURL }, info) => {
  const educator = await playwright.request.newContext({ baseURL, extraHTTPHeaders: { Origin: baseURL!, Cookie: `hl_session=${await sessionToken("educador-demo")}` } });
  // DEC-023: administration creates the course with educador-demo as its lead, who prepares the content.
  const admin = await playwright.request.newContext({ baseURL, extraHTTPHeaders: { Origin: baseURL!, Cookie: `hl_session=${await sessionToken("admin-demo")}` } });
  try {
    const body = { title: `${E2E_PREFIX} Horario ${info.project.name}`, objective: "Seguir un horario.", status: "active", educationType: "non-formal", level: "unspecified", format: "workshop", modality: "in-person", pacing: "scheduled", area: "011", settings: { attendance: true }, programId: null };
    const courseId = (await (await admin.post("/api/courses", { data: { ...body, leadId: "user-educator" } })).json()).id, path = `/api/courses/${courseId}`;
    const version = async () => (await (await educator.get(path)).json()).course.version as number;
    const outcomeId = (await (await educator.post(`${path}/outcomes`, { data: { statement: "Saluda y se presenta.", level: "apply", evidence: "", competencyId: null, status: "active", version: await version() } })).json()).id;
    const courseUnitId = (await (await educator.post(`${path}/units`, { data: { name: `${E2E_PREFIX} Módulo`, objective: "Practicar.", status: "active", version: await version() } })).json()).id;
    const lessons: { id: string; shareCode: string; title: string }[] = [];
    for (const title of ["Primera", "Segunda", "Tercera"]) {
      const lesson = (await (await educator.post("/api/lessons", { data: { title: `${E2E_PREFIX} ${title}`, objective: "Practicar.", courseId, courseUnitId, instructions: "Sigue las indicaciones.", duration: 15, outcomeIds: [outcomeId] } })).json()).lesson;
      expect((await educator.post(`/api/lessons/${lesson.id}/publish`)).status()).toBe(200);
      lessons.push(lesson);
    }
    const groupId = (await (await admin.post(`${path}/groups`, { data: { name: `${E2E_PREFIX} Sección A` } })).json()).id;
    const learnerId = (await (await admin.post(`${path}/groups/${groupId}/learners`, { data: { displayName: `${E2E_PREFIX} Ana` } })).json()).id;
    // DEC-024: even the lead teaches a section only once administration assigns it.
    expect((await educator.get(`/api/sections/${groupId}`)).status()).toBe(403);
    expect((await admin.put(`${path}/groups/${groupId}/educators`, { data: { userIds: ["user-educator"] } })).status()).toBe(200);
    const sessions = async () => ((await (await educator.get(`${path}/sessions`)).json()).sessions as Session[]).filter(item => item.groupId === groupId).sort((a, b) => a.sessionDate.localeCompare(b.sessionDate));

    // Saving the schedule generates every class of the period, from today on.
    expect((await admin.put(`${path}/groups/${groupId}/schedule`, { data: { weekdays: [1], startsAt: "25:00", durationMinutes: 45, from: day(0), until: day(6) } })).status()).toBe(400);
    const saved = await admin.put(`${path}/groups/${groupId}/schedule`, { data: { weekdays: [0, 1, 2, 3, 4, 5, 6], startsAt: "08:00", durationMinutes: 45, from: day(0), until: day(6) } });
    expect(saved.status(), await saved.text()).toBe(200);
    expect((await saved.json()).classes).toBe(7);
    let list = await sessions();
    expect(list.map(item => [item.sessionDate, item.startsAt, item.origin, ids(item)])).toEqual(Array.from({ length: 7 }, (_, index) => [day(index), "08:00", "schedule", []]));
    const groups = (await (await educator.get(`${path}/groups`)).json()).groups as { id: string; schedule: unknown }[];
    expect(groups.find(group => group.id === groupId)!.schedule).toEqual({ weekdays: [0, 1, 2, 3, 4, 5, 6], startsAt: "08:00", durationMinutes: 45, from: day(0), until: day(6) });

    // Lessons go to the classes in content order; classes beyond the last lesson stay without lessons.
    expect((await educator.post(`${path}/groups/${groupId}/lessons`, { data: { perClass: 4 } })).status()).toBe(400);
    const filled = await (await educator.post(`${path}/groups/${groupId}/lessons`, { data: { perClass: 1 } })).json();
    expect(filled).toEqual({ assigned: 3, classes: 3 });
    list = await sessions();
    expect(list.map(ids)).toEqual([...lessons.map(lesson => [lesson.id]), [], [], [], []]);
    expect((await (await educator.post(`${path}/groups/${groupId}/lessons`, { data: { perClass: 2 } })).json()).assigned).toBe(0);
    // A long class covers several lessons in the chosen order, with comments; a stale edit is refused.
    const plan = { sessionDate: list[3].sessionDate, startsAt: "08:00", durationMinutes: 45, lessonIds: [lessons[1].id, lessons[0].id], notes: "Repasar" };
    const planned = await educator.put(`${path}/sessions/${list[3].id}`, { data: { ...plan, version: list[3].version } });
    expect(planned.status(), await planned.text()).toBe(200);
    expect((await (await educator.get(`${path}/sessions/${list[3].id}`)).json()).session).toMatchObject({ lessons: [{ id: lessons[1].id, position: 0 }, { id: lessons[0].id, position: 1 }], notes: "Repasar" });
    expect((await educator.put(`${path}/sessions/${list[3].id}`, { data: { ...plan, lessonIds: [], version: list[3].version } })).status()).toBe(409);
    const overview = await (await educator.get(`${path}/sessions`)).json();
    expect(overview.lessonPlans[lessons[0].id].activities.length).toBeGreaterThan(0);
    // Only published lessons of the course are planned.
    const unpublished = (await (await educator.post("/api/lessons", { data: { title: `${E2E_PREFIX} Borrador`, objective: "Practicar.", courseId, courseUnitId, instructions: "Sigue las indicaciones.", duration: 15 } })).json()).lesson;
    const refreshed = (await sessions())[4];
    expect((await educator.put(`${path}/sessions/${refreshed.id}`, { data: { sessionDate: refreshed.sessionDate, lessonIds: [unpublished.id], version: refreshed.version } })).status()).toBe(400);

    // A class added by hand and a started class survive a schedule change; pending generated classes are rebuilt with their lessons in order.
    // An extra class needs only its date: it takes the time and length of the section's schedule.
    const extra = await educator.post(`${path}/sessions`, { data: { groupId, sessionDate: day(1) } });
    expect(extra.status()).toBe(201);
    expect((await (await educator.get(`${path}/sessions/${(await extra.json()).id}`)).json()).session).toMatchObject({ startsAt: "08:00", durationMinutes: 45, origin: "manual", lessons: [] });
    expect((await educator.put(`${path}/sessions/${list[0].id}/attendance`, { data: { marks: [{ learnerId, status: "present" }] } })).status()).toBe(200);
    // Once started, a class keeps its day and time; its lessons may still change and record their current publication.
    const started = (await sessions())[0];
    expect((await educator.put(`${path}/sessions/${started.id}`, { data: { sessionDate: day(2), startsAt: "08:00", durationMinutes: 45, lessonIds: ids(started), notes: "", version: started.version } })).status()).toBe(409);
    expect((await educator.put(`${path}/sessions/${started.id}`, { data: { sessionDate: started.sessionDate, startsAt: "08:00", durationMinutes: 45, lessonIds: [lessons[0].id, lessons[1].id], notes: "", version: started.version } })).status()).toBe(200);
    expect((await sessions())[0].lessons.every(lesson => lesson.revision === 1)).toBe(true);
    const changed = await admin.put(`${path}/groups/${groupId}/schedule`, { data: { weekdays: [0, 1, 2, 3, 4, 5, 6], startsAt: "09:30", durationMinutes: 50, from: day(0), until: day(3) } });
    expect(changed.status(), await changed.text()).toBe(200);
    list = await sessions();
    expect(list.map(item => [item.sessionDate, item.startsAt, item.origin, item.status])).toEqual([
      [day(0), "08:00", "schedule", "in_progress"], [day(1), "08:00", "manual", "planned"], [day(2), "09:30", "schedule", "planned"], [day(3), "09:30", "schedule", "planned"],
    ]);
    // What was planned moves with the remaining classes, in order.
    expect(list.map(ids)).toEqual([[lessons[0].id, lessons[1].id], [], [lessons[1].id], [lessons[2].id]]);

    // The student code shows the section's lessons once each; the class resources come from the lesson.
    const { accessCode } = await (await admin.post(`${path}/groups/${groupId}/code`)).json();
    const student = await playwright.request.newContext({ baseURL, extraHTTPHeaders: { Origin: baseURL! } });
    try {
      expect((await student.post("/api/student/login", { data: { code: accessCode } })).status()).toBe(200);
      const space = await (await student.get("/api/student/space")).json();
      expect(space.lessons.map((lesson: { title: string }) => lesson.title)).toEqual(lessons.map(lesson => lesson.title));
      expect(space.next.lessons.map((lesson: { title: string }) => lesson.title)).toEqual([lessons[0].title, lessons[1].title]);
    } finally { await student.dispose(); }

    // An archived lesson asks for a replacement.
    const draft = (await (await educator.get(`/api/lessons/${lessons[2].id}?draft=1`)).json()).lesson;
    expect((await educator.put(`/api/lessons/${lessons[2].id}`, { data: { title: draft.title, objective: "Practicar.", courseId, courseUnitId, instructions: "Sigue las indicaciones.", duration: 15, draftVersion: draft.draftVersion, status: "archived" } })).status()).toBe(200);
    expect((await sessions())[3].lessons[0].available).toBe(false);

    // Finishing the class updates the coverage map; a taught class keeps its lessons and only its comments change.
    expect((await educator.post(`${path}/sessions/${list[0].id}/complete`)).status()).toBe(200);
    const taught = (await sessions())[0];
    expect((await educator.put(`${path}/sessions/${taught.id}`, { data: { sessionDate: taught.sessionDate, startsAt: "08:00", durationMinutes: 45, lessonIds: [lessons[0].id], notes: "", version: taught.version } })).status()).toBe(409);
    expect((await educator.put(`${path}/sessions/${taught.id}`, { data: { sessionDate: taught.sessionDate, startsAt: "08:00", durationMinutes: 45, lessonIds: ids(taught), notes: "Se cubrieron las dos lecciones.", version: taught.version } })).status()).toBe(200);
    await signIn(page, "educador-demo", `/cursos/${courseId}/plan`);
    await expect(page.locator(".plan-stats")).toContainText("Impartidos en clase");
    await expect(page.locator(".coverage-table")).toContainText("Impartido");
    await openNavigation(page);
    await courseNav(page).getByRole("link", { name: "Secciones", exact: true }).click();
    await page.getByRole("link", { name: `${E2E_PREFIX} Sección A`, exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`/secciones/${groupId}$`));
    await openNavigation(page);
    await sectionNav(page).getByRole("link", { name: "Cronograma", exact: true }).click();
    const schedule = page.getByRole("table", { name: /Cronograma de clases de/ });
    await expect(schedule.locator("tbody tr").filter({ hasText: "Requiere sustitución" })).toHaveCount(1);
    await expect(schedule.locator("tbody tr").first()).toContainText("Se cubrieron las dos lecciones.");
    await expect(schedule.locator("tbody tr").first()).toContainText("1 de 1 presentes (100 %)");
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await openNavigation(page);
    await sectionNav(page).getByRole("link", { name: "Horario", exact: true }).click();
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Horario");
    await expect(page.locator(".timetable")).toContainText("09:30");
    // The lead consults the schedule; administration changes it.
    await expect(page.getByRole("form", { name: `Horario de ${E2E_PREFIX} Sección A` })).toHaveCount(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await signIn(page, "admin-demo", `/secciones/${groupId}/horario`);
    await expect(page.getByRole("form", { name: `Horario de ${E2E_PREFIX} Sección A` }).getByLabel("Hora")).toHaveValue("09:30");
  } finally { await educator.dispose(); await admin.dispose(); }
});
