import { test, expect } from "./local-test";
import { E2E_PREFIX, courseNav, openNavigation, sessionToken, signIn } from "./helpers";

type Session = { id: string; groupId: string; lessonId: string | null; sessionDate: string; startsAt: string | null; status: string; origin: string; version: number; lessonAvailable: number | null };
const day = (offset: number) => { const date = new Date(); date.setDate(date.getDate() + offset); return date.toLocaleDateString("en-CA"); };

test("ST-099 ST-097 ST-029 ST-100: the section schedule generates its classes, lessons follow content order and completed classes feed coverage", async ({ page, playwright, baseURL }, info) => {
  const educator = await playwright.request.newContext({ baseURL, extraHTTPHeaders: { Origin: baseURL!, Cookie: `hl_session=${await sessionToken("educador-demo")}` } });
  try {
    const body = { title: `${E2E_PREFIX} Horario ${info.project.name}`, objective: "Seguir un horario.", status: "active", educationType: "non-formal", level: "unspecified", format: "workshop", modality: "in-person", pacing: "scheduled", area: "011", settings: { attendance: true }, programId: null };
    const courseId = (await (await educator.post("/api/courses", { data: body })).json()).id, path = `/api/courses/${courseId}`;
    const version = async () => (await (await educator.get(path)).json()).course.version as number;
    const outcomeId = (await (await educator.post(`${path}/outcomes`, { data: { statement: "Saluda y se presenta.", level: "apply", evidence: "", competencyId: null, status: "active", version: await version() } })).json()).id;
    const courseUnitId = (await (await educator.post(`${path}/units`, { data: { name: `${E2E_PREFIX} Módulo`, objective: "Practicar.", status: "active", version: await version() } })).json()).id;
    const lessons: { id: string; shareCode: string; title: string }[] = [];
    for (const title of ["Primera", "Segunda", "Tercera"]) {
      const lesson = (await (await educator.post("/api/lessons", { data: { title: `${E2E_PREFIX} ${title}`, objective: "Practicar.", courseId, courseUnitId, instructions: "Sigue las indicaciones.", duration: 15, outcomeIds: [outcomeId] } })).json()).lesson;
      expect((await educator.post(`/api/lessons/${lesson.id}/publish`)).status()).toBe(200);
      lessons.push(lesson);
    }
    const groupId = (await (await educator.post(`${path}/groups`, { data: { name: `${E2E_PREFIX} Sección A` } })).json()).id;
    const learnerId = (await (await educator.post(`${path}/groups/${groupId}/learners`, { data: { displayName: `${E2E_PREFIX} Ana` } })).json()).id;
    const sessions = async () => ((await (await educator.get(`${path}/sessions`)).json()).sessions as Session[]).filter(item => item.groupId === groupId).sort((a, b) => a.sessionDate.localeCompare(b.sessionDate));

    // Saving the schedule generates every class of the period, from today on.
    expect((await educator.put(`${path}/groups/${groupId}/schedule`, { data: { weekdays: [1], startsAt: "25:00", durationMinutes: 45, from: day(0), until: day(6) } })).status()).toBe(400);
    const saved = await educator.put(`${path}/groups/${groupId}/schedule`, { data: { weekdays: [0, 1, 2, 3, 4, 5, 6], startsAt: "08:00", durationMinutes: 45, from: day(0), until: day(6) } });
    expect(saved.status(), await saved.text()).toBe(200);
    expect((await saved.json()).classes).toBe(7);
    let list = await sessions();
    expect(list.map(item => [item.sessionDate, item.startsAt, item.origin, item.lessonId])).toEqual(Array.from({ length: 7 }, (_, index) => [day(index), "08:00", "schedule", null]));
    const groups = (await (await educator.get(`${path}/groups`)).json()).groups as { id: string; schedule: unknown }[];
    expect(groups.find(group => group.id === groupId)!.schedule).toEqual({ weekdays: [0, 1, 2, 3, 4, 5, 6], startsAt: "08:00", durationMinutes: 45, from: day(0), until: day(6) });

    // Lessons go to the classes in content order; classes beyond the last lesson stay empty.
    expect((await (await educator.post(`${path}/groups/${groupId}/lessons`)).json()).assigned).toBe(3);
    list = await sessions();
    expect(list.map(item => item.lessonId)).toEqual([...lessons.map(lesson => lesson.id), null, null, null, null]);
    expect((await (await educator.post(`${path}/groups/${groupId}/lessons`)).json()).assigned).toBe(0);
    // Changing one lesson keeps the class notes.
    const notes = await educator.put(`${path}/sessions/${list[3].id}`, { data: { sessionDate: list[3].sessionDate, startsAt: "08:00", durationMinutes: 45, lessonId: null, notes: "Repasar", version: list[3].version } });
    expect(notes.status(), await notes.text()).toBe(200);
    const current = (await sessions())[3];
    expect((await educator.put(`${path}/sessions/${current.id}/lesson`, { data: { lessonId: lessons[0].id, version: current.version } })).status()).toBe(200);
    expect((await (await educator.get(`${path}/sessions/${current.id}`)).json()).session).toMatchObject({ lessonId: lessons[0].id, notes: "Repasar" });
    expect((await educator.put(`${path}/sessions/${current.id}/lesson`, { data: { lessonId: null, version: current.version } })).status()).toBe(409);
    // Only published lessons are assigned to a class.
    const unpublished = (await (await educator.post("/api/lessons", { data: { title: `${E2E_PREFIX} Borrador`, objective: "Practicar.", courseId, courseUnitId, instructions: "Sigue las indicaciones.", duration: 15 } })).json()).lesson;
    const refreshed = (await sessions())[4];
    expect((await educator.put(`${path}/sessions/${refreshed.id}/lesson`, { data: { lessonId: unpublished.id, version: refreshed.version } })).status()).toBe(400);

    // A class added by hand and a started class survive a schedule change; pending generated classes are rebuilt with their lessons in order.
    const extra = await educator.post(`${path}/sessions`, { data: { groupId, sessionDate: day(1), startsAt: "15:00", durationMinutes: 30 } });
    expect(extra.status()).toBe(201);
    expect((await educator.put(`${path}/sessions/${list[0].id}/attendance`, { data: { marks: [{ learnerId, status: "present" }] } })).status()).toBe(200);
    const changed = await educator.put(`${path}/groups/${groupId}/schedule`, { data: { weekdays: [0, 1, 2, 3, 4, 5, 6], startsAt: "09:30", durationMinutes: 50, from: day(0), until: day(3) } });
    expect(changed.status(), await changed.text()).toBe(200);
    list = await sessions();
    expect(list.map(item => [item.sessionDate, item.startsAt, item.origin, item.status])).toEqual([
      [day(0), "08:00", "schedule", "in_progress"], [day(1), "15:00", "manual", "planned"], [day(2), "09:30", "schedule", "planned"], [day(3), "09:30", "schedule", "planned"],
    ]);
    expect(list.map(item => item.lessonId)).toEqual([lessons[0].id, null, lessons[1].id, lessons[2].id]);

    // The student code shows the section's lessons once each; the class resources come from the lesson.
    const { accessCode } = await (await educator.post(`${path}/groups/${groupId}/code`)).json();
    const student = await playwright.request.newContext({ baseURL, extraHTTPHeaders: { Origin: baseURL! } });
    try {
      expect((await student.post("/api/student/login", { data: { code: accessCode } })).status()).toBe(200);
      const space = await (await student.get("/api/student/space")).json();
      expect(space.lessons.map((lesson: { title: string }) => lesson.title)).toEqual(lessons.map(lesson => lesson.title));
      expect(space.next.lesson.title).toBe(lessons[0].title);
    } finally { await student.dispose(); }

    // An archived lesson asks for a replacement.
    const draft = (await (await educator.get(`/api/lessons/${lessons[2].id}?draft=1`)).json()).lesson;
    expect((await educator.put(`/api/lessons/${lessons[2].id}`, { data: { title: draft.title, objective: "Practicar.", courseId, courseUnitId, instructions: "Sigue las indicaciones.", duration: 15, draftVersion: draft.draftVersion, status: "archived" } })).status()).toBe(200);
    expect((await sessions())[3].lessonAvailable).toBe(0);

    // Finishing the class updates the coverage map.
    expect((await educator.post(`${path}/sessions/${list[0].id}/complete`)).status()).toBe(200);
    await signIn(page, "educador-demo", `/cursos/${courseId}/plan`);
    await expect(page.locator(".plan-stats")).toContainText("Impartidos en clase");
    await expect(page.locator(".coverage-table")).toContainText("Impartido");
    await openNavigation(page);
    await courseNav(page).getByRole("link", { name: "Clases", exact: true }).click();
    await expect(page.locator(".class-list li").filter({ hasText: "Requiere sustitución" })).toHaveCount(1);
    await openNavigation(page);
    await courseNav(page).getByRole("link", { name: "Horario", exact: true }).click();
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Horario");
    await expect(page.locator(".timetable")).toContainText("09:30");
    await expect(page.getByRole("form", { name: `Horario de ${E2E_PREFIX} Sección A` }).getByLabel("Hora")).toHaveValue("09:30");
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  } finally { await educator.dispose(); }
});
