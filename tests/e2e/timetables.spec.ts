import { test, expect } from "./local-test";
import { nextClassDays } from "../class-days";
import { E2E_PREFIX, sessionToken, signIn } from "./helpers";

// 1.4.3 (docs/design/asistente-ia.md §6d): the solver places sections in the school day's periods, never breaking a
// hard rule; applying saves each section's schedule as the schedule page would; rules in words are confirmed first.
type Meeting = { sectionId: string; weekday: number; startsAt: string; durationMinutes: number };
test("administration generates a timetable with rules, applies it to the sections, and a rule written in words is confirmed first", async ({ page, playwright, baseURL }, info) => {
  const admin = await playwright.request.newContext({ baseURL, extraHTTPHeaders: { Origin: baseURL!, Cookie: `hl_session=${await sessionToken("admin-demo")}` } });
  const educator = await playwright.request.newContext({ baseURL, extraHTTPHeaders: { Origin: baseURL!, Cookie: `hl_session=${await sessionToken("educador-demo")}` } });
  let declared: unknown = null;
  const declare = async (context: typeof educator, availability: unknown) => {
    const { profile } = await (await context.get("/api/me/profile")).json();
    expect((await context.put("/api/me/profile", { data: { availability, draftVersion: profile.draftVersion } })).status()).toBe(200);
  };
  try {
    expect((await educator.get("/api/timetables")).status()).toBe(403);
    // Availability has its own tests (tests/availability.test.ts): here the educator declares the whole week while the
    // test runs, and gets their declared slots back at the end, as in planning.spec.ts.
    declared = (await (await educator.get("/api/me/profile")).json()).profile.availability;
    await declare(educator, [1, 2, 3, 4, 5, 6, 7].map(day => ({ day, start: "00:00", end: "23:59" })));
    const body = { title: `${E2E_PREFIX} Horarios ${info.project.name}`, objective: "Generar horarios.", status: "active", educationType: "non-formal", level: "unspecified", format: "workshop", modality: "in-person", pacing: "scheduled", area: "011", settings: { attendance: true } };
    const courseId = (await (await admin.post("/api/courses", { data: { ...body, leadId: "user-educator" } })).json()).id, path = `/api/courses/${courseId}`;
    const section = async (name: string) => {
      const id = (await (await admin.post(`${path}/groups`, { data: { name: `${E2E_PREFIX} ${name}` } })).json()).id as string;
      expect((await admin.put(`${path}/groups/${id}/educators`, { data: { userIds: ["user-educator"], conflictReason: "Sección de prueba E2E; su horario puede coincidir con otras secciones de prueba." } })).status()).toBe(200);
      return id;
    };
    const first = await section("Horario A"), second = await section("Horario B");
    const setup = await (await admin.get("/api/timetables")).json();
    const bell = setup.bellSchedules.find((item: { name: string }) => item.name === "Jornada matutina");
    expect(bell.weekdays).toEqual([1, 2, 3, 4, 5]);
    const teacher = setup.educators.find((item: { id: string }) => item.id === "user-educator");
    expect(teacher.name).toBe("Educador de la demostración");

    // Both sections share students and their educator, who does not teach on Fridays.
    const rules = [{ kind: "shared-students", sectionIds: [first, second] }, { kind: "unavailable", educatorId: teacher.id, weekday: 5 }];
    const solved = await (await admin.post("/api/timetables/solve", { data: { bellScheduleId: bell.id, rules, sections: [{ id: first, meetingsPerWeek: 2, blocksPerMeeting: 2 }, { id: second, meetingsPerWeek: 2, blocksPerMeeting: 1 }] } })).json();
    expect(solved.result.status).toBe("solved");
    const meetings = solved.result.meetings as Meeting[];
    expect(meetings.filter(item => item.sectionId === first).map(item => item.durationMinutes)).toEqual([85, 85]);
    expect(meetings.some(item => item.weekday === 5)).toBe(false);
    const minutes = (clock: string) => Number(clock.slice(0, 2)) * 60 + Number(clock.slice(3));
    const pairs = meetings.flatMap((a, index) => meetings.slice(index + 1).map(b => [a, b]));
    expect(pairs.filter(([a, b]) => a.weekday === b.weekday && minutes(a.startsAt) < minutes(b.startsAt) + b.durationMinutes && minutes(b.startsAt) < minutes(a.startsAt) + a.durationMinutes)).toEqual([]);
    expect((await admin.post("/api/timetables/solve", { data: { bellScheduleId: bell.id, rules: [{ kind: "not-on", sectionId: "seccion-inexistente", weekday: 1 }], sections: [{ id: first, meetingsPerWeek: 2, blocksPerMeeting: 1 }] } })).status()).toBe(400);

    // Applying gives each section its schedule for the dates chosen.
    const days = await nextClassDays(async () => await (await admin.get("/api/calendar")).json(), 10);
    const applied = await admin.post("/api/timetables/apply", { data: { from: days[0], until: days[9], meetings } });
    expect(applied.status(), await applied.text()).toBe(200);
    expect((await applied.json()).results.map((item: { ok: boolean }) => item.ok)).toEqual([true, true]);
    // A schedule whose meetings share start and length is stored as days, start and length: compare the meetings either way.
    type Stored = { weekdays: number[]; startsAt: string; durationMinutes: number; meetings?: Omit<Meeting, "sectionId">[] };
    const groups = (await (await admin.get(`${path}/groups`)).json()).groups as { id: string; schedule: Stored }[];
    const stored = (id: string) => { const schedule = groups.find(group => group.id === id)!.schedule; return (schedule.meetings || schedule.weekdays.map(weekday => ({ weekday, startsAt: schedule.startsAt, durationMinutes: schedule.durationMinutes }))).map(item => [item.weekday, item.startsAt, item.durationMinutes]); };
    for (const id of [first, second]) expect(stored(id)).toEqual(meetings.filter(item => item.sectionId === id).map(item => [item.weekday, item.startsAt, item.durationMinutes]));

    // The page: a rule written in words is interpreted, confirmed and listed before generating.
    await signIn(page, "admin-demo", "/organizacion/horarios");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Horarios");
    await page.getByLabel("Escribe una regla").fill("Educador de la demostración no da clases el viernes.");
    await page.getByRole("button", { name: "Interpretar" }).click();
    const proposed = page.getByRole("region", { name: "Reglas interpretadas" });
    await expect(proposed).toContainText("Educador de la demostración no da clases el viernes");
    await proposed.getByRole("button", { name: "Agregar las marcadas" }).click();
    await expect(page.locator(".timetable-rules")).toContainText("Educador de la demostración no da clases el viernes");
    await page.getByRole("button", { name: "Generar horario" }).click();
    await expect(page.getByRole("region", { name: "Horario semanal" })).toBeVisible({ timeout: 15_000 });
  } finally {
    if (declared) await declare(educator, declared);
    await admin.dispose(); await educator.dispose();
  }
});
