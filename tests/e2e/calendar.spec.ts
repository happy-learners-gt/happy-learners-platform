import { test, expect } from "./local-test";
import { E2E_PREFIX, sessionToken, signIn } from "./helpers";

type Session = { id: string; groupId: string; lessons: { id: string; outcome?: string | null }[]; sessionDate: string; status: string; version: number; notes: string };
const ids = (session: Session) => session.lessons.map(lesson => lesson.id);
const day = (offset: number) => new Date(Date.now() + offset * 86_400_000).toLocaleDateString("en-CA", { timeZone: "America/Guatemala" });

test("HL-143 ST-108 ST-109: days without class reschedule the section, cancelling moves or skips the plan and finishing records what was covered", async ({ page, playwright, baseURL }, info) => {
  const educator = await playwright.request.newContext({ baseURL, extraHTTPHeaders: { Origin: baseURL!, Cookie: `hl_session=${await sessionToken("educador-demo")}` } });
  const admin = await playwright.request.newContext({ baseURL, extraHTTPHeaders: { Origin: baseURL!, Cookie: `hl_session=${await sessionToken("admin-demo")}` } });
  try {
    const body = { title: `${E2E_PREFIX} Calendario ${info.project.name}`, objective: "Seguir el calendario.", status: "active", educationType: "non-formal", level: "unspecified", format: "workshop", modality: "in-person", pacing: "scheduled", area: "011", settings: { attendance: true }, programId: null };
    const courseId = (await (await admin.post("/api/courses", { data: { ...body, leadId: "user-educator" } })).json()).id, path = `/api/courses/${courseId}`;
    const version = async () => (await (await educator.get(path)).json()).course.version as number;
    const outcomeId = (await (await educator.post(`${path}/outcomes`, { data: { statement: "Cuenta hasta diez.", level: "apply", evidence: "", competencyId: null, status: "active", version: await version() } })).json()).id;
    const courseUnitId = (await (await educator.post(`${path}/units`, { data: { name: `${E2E_PREFIX} Números`, objective: "Contar.", status: "active", version: await version() } })).json()).id;
    const lessons: { id: string; title: string }[] = [];
    for (const title of ["Uno", "Dos", "Tres"]) {
      const lesson = (await (await educator.post("/api/lessons", { data: { title: `${E2E_PREFIX} ${title}`, objective: "Contar.", courseId, courseUnitId, instructions: "Cuenta en voz alta.", duration: 15, outcomeIds: [outcomeId] } })).json()).lesson;
      expect((await educator.post(`/api/lessons/${lesson.id}/publish`)).status()).toBe(200);
      lessons.push(lesson);
    }
    const [one, two, three] = lessons.map(lesson => lesson.id);
    const groupId = (await (await admin.post(`${path}/groups`, { data: { name: `${E2E_PREFIX} Sección C` } })).json()).id;
    expect((await admin.put(`${path}/groups/${groupId}/educators`, { data: { userIds: ["user-educator"], conflictReason: "Sección de prueba E2E; su horario puede coincidir con otras secciones de prueba." } })).status()).toBe(200);
    expect((await admin.put(`${path}/groups/${groupId}/schedule`, { data: { weekdays: [0, 1, 2, 3, 4, 5, 6], startsAt: "08:00", durationMinutes: 45, from: day(1), until: day(7) } })).status()).toBe(200);
    expect((await educator.post(`${path}/groups/${groupId}/lessons`, { data: { perClass: 1 } })).status()).toBe(200);
    const sessions = async () => ((await (await educator.get(`${path}/sessions`)).json()).sessions as Session[]).filter(item => item.groupId === groupId && item.status !== "cancelled").sort((a, b) => a.sessionDate.localeCompare(b.sessionDate));
    const plan = async () => (await sessions()).map(item => [item.sessionDate, ids(item)]);

    // Only administration defines days without class, with a valid range.
    expect((await educator.post("/api/calendar", { data: { title: "Asueto", from: day(2), groupId } })).status()).toBe(403);
    expect((await admin.post("/api/calendar", { data: { title: "Asueto", from: day(3), until: day(2), groupId } })).status()).toBe(400);
    // A day off for the section removes its class; what was planned moves to the following classes, in order.
    const added = await admin.post("/api/calendar", { data: { title: "Asueto", from: day(2), groupId } });
    expect(added.status(), await added.text()).toBe(201);
    const dayOff = await added.json();
    expect(dayOff).toMatchObject({ break: { title: "Asueto", from: day(2), until: day(2), groupId }, sections: 1, removed: 1 });
    expect(await plan()).toEqual([[day(1), [one]], [day(3), [two]], [day(4), [three]], [day(5), []], [day(6), []], [day(7), []]]);
    expect((await (await educator.get(`${path}/sessions`)).json()).breaks).toEqual([expect.objectContaining({ id: dayOff.break.id, groupId })]);

    // Recorrer: the plan of the cancelled class goes to the next one and every later class moves one place.
    let list = await sessions();
    const shifted = await educator.post(`${path}/sessions/${list[0].id}/cancel`, { data: { plan: "shift" } });
    expect(shifted.status(), await shifted.text()).toBe(200);
    expect(await plan()).toEqual([[day(3), [one]], [day(4), [two]], [day(5), [three]], [day(6), []], [day(7), []]]);
    // Omitir: the plan stays with the cancelled class and the rest do not change.
    list = await sessions();
    expect((await educator.post(`${path}/sessions/${list[0].id}/cancel`, { data: { plan: "skip" } })).status()).toBe(200);
    expect(await plan()).toEqual([[day(4), [two]], [day(5), [three]], [day(6), []], [day(7), []]]);
    expect((await educator.post(`${path}/sessions/${list[0].id}/restore`)).status()).toBe(200);
    expect(await plan()).toEqual([[day(3), [one]], [day(4), [two]], [day(5), [three]], [day(6), []], [day(7), []]]);

    // Finishing records how far each lesson got; what was not completed opens the next class.
    list = await sessions();
    expect((await educator.post(`${path}/sessions/${list[0].id}/complete`, { data: { lessons: [{ id: one, outcome: "toString" }] } })).status()).toBe(400);
    const finished = await educator.post(`${path}/sessions/${list[0].id}/complete`, { data: { lessons: [{ id: one, outcome: "partial" }] } });
    expect(finished.status(), await finished.text()).toBe(200);
    expect(await finished.json()).toMatchObject({ status: "completed", carried: 1 });
    list = await sessions();
    expect(list[0].lessons).toEqual([expect.objectContaining({ id: one, outcome: "partial" })]);
    expect(list.slice(1).map(ids)).toEqual([[one, two], [three], [], []]);
    // Coverage counts only completed lessons; correcting the record updates it.
    const taught = async () => (await (await educator.get(`/api/sections/${groupId}`)).json()).section.indicators.lessonsTaught as number;
    expect(await taught()).toBe(0);
    expect((await educator.put(`${path}/sessions/${list[0].id}/outcomes`, { data: { lessons: [{ id: one, outcome: "completed" }] } })).status()).toBe(200);
    expect(await taught()).toBe(1);
    expect((await educator.put(`${path}/sessions/${list[1].id}/outcomes`, { data: { lessons: [{ id: one, outcome: "completed" }] } })).status()).toBe(409);

    // Removing the day off brings the class back and the plan settles in order again.
    expect((await admin.delete(`/api/calendar/${dayOff.break.id}`)).status()).toBe(200);
    expect((await sessions()).map(item => item.sessionDate)).toEqual([day(2), day(3), day(4), day(5), day(6), day(7)]);
    // A day off for the whole organization reaches every section with a schedule.
    const holiday = await (await admin.post("/api/calendar", { data: { title: `${E2E_PREFIX} Feriado`, from: day(6) } })).json();
    expect(holiday.break.groupId).toBeNull();
    expect((await sessions()).map(item => item.sessionDate)).toEqual([day(2), day(3), day(4), day(5), day(7)]);
    expect((await (await educator.get(`/api/calendar?section=${groupId}`)).json()).breaks.map((item: { id: string }) => item.id)).toEqual([holiday.break.id]);
    expect((await admin.delete(`/api/calendar/${holiday.break.id}`)).status()).toBe(200);

    // Administration manages the section's days without class from its schedule page.
    await signIn(page, "admin-demo", `/secciones/${groupId}/horario`);
    await page.getByRole("region", { name: "Días sin clase" }).getByRole("button", { name: "Agregar", exact: true }).click();
    const form = page.getByRole("form", { name: `Agregar días sin clase a ${E2E_PREFIX} Sección C` });
    await form.getByLabel("Motivo").fill("Vacaciones");
    await form.getByLabel("Desde").fill(day(6));
    await form.getByLabel("Hasta").fill(day(7));
    await form.getByRole("button", { name: "Agregar días sin clase" }).click();
    const daysOff = page.locator(".days-off");
    await expect(daysOff).toContainText("Vacaciones");
    await expect(daysOff).toContainText("Esta sección");
    expect(await plan()).toEqual([[day(2), [one, two]], [day(3), [one]], [day(4), [three]], [day(5), []]]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);

    // The educator cancels a planned class and chooses to move its plan forward, past the class already taught.
    list = await sessions();
    await signIn(page, "educador-demo", `/secciones/${groupId}/clases/${list[0].id}`);
    await page.getByRole("button", { name: "Más acciones de la clase" }).click();
    await page.getByRole("menuitem", { name: "Cancelar clase" }).click();
    const cancel = page.getByRole("dialog", { name: "¿Cancelar esta clase?" });
    await cancel.getByText("Recorrer", { exact: true }).click();
    await cancel.getByRole("button", { name: "Cancelar y recorrer" }).click();
    await expect(page.locator(".page-meta .badge")).toHaveText("Cancelada");
    expect((await sessions()).map(ids)).toEqual([[one], [one, two], [three]]);

    // Finishing a class with lessons asks how far each one got.
    list = await sessions();
    await page.goto(`/secciones/${groupId}/clases/${list[1].id}`);
    await page.getByRole("button", { name: "Comenzar clase" }).click();
    await page.getByRole("button", { name: "Finalizar clase" }).click();
    const finish = page.getByRole("dialog", { name: "Finalizar clase" });
    await finish.getByRole("radiogroup", { name: lessons[1].title }).getByLabel("No se alcanzó").check();
    await finish.getByRole("button", { name: "Finalizar clase" }).click();
    await expect(page.locator(".page-meta .badge")).toHaveText("Impartida");
    await expect(page.locator(".class-lesson").filter({ hasText: lessons[1].title })).toContainText("No se alcanzó");
    expect((await sessions()).slice(2).map(ids)).toEqual([[two, three]]);
  } finally { await educator.dispose(); await admin.dispose(); }
});
