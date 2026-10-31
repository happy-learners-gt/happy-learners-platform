import { test, expect } from "./local-test";
import { nextClassDays } from "../class-days";
import { E2E_PREFIX, e2eName, sessionToken, signIn } from "./helpers";

// 1.4.3 (docs/design/asistente-ia.md §6d): the solver places sections in the school day's periods, never breaking a
// hard rule; applying saves each section's schedule as the schedule page would; rules in words are confirmed first.
// 1.5.3: with classrooms, each section gets one for the week and no classroom holds two classes at once.
type Meeting = { sectionId: string; weekday: number; startsAt: string; durationMinutes: number; classroomId?: string | null };
test("administration generates a timetable with rules, applies it to the sections, and a rule written in words is confirmed first", async ({ page, playwright, baseURL }, info) => {
  const admin = await playwright.request.newContext({ baseURL, extraHTTPHeaders: { Origin: baseURL!, Cookie: `hl_session=${await sessionToken("admin-demo")}` } });
  const educator = await playwright.request.newContext({ baseURL, extraHTTPHeaders: { Origin: baseURL!, Cookie: `hl_session=${await sessionToken("educador-demo")}` } });
  const rooms: string[] = [];
  try {
    expect((await educator.get("/api/timetables")).status()).toBe(403);
    // A fresh educator for this run: no other classes and no declared availability (other specs give the demo
    // educators classes every day, which the solver rightly treats as fixed).
    const teacherName = e2eName(info, "Docente de horarios"), username = `e2e-horarios-${info.project.name}-${Date.now().toString(36)}`;
    const account = await admin.post("/api/members", { data: { displayName: teacherName, username, role: "educator" } });
    expect(account.status(), await account.text()).toBe(201);
    const teacherId = (await account.json()).member.id as string;
    const body = { title: `${E2E_PREFIX} Horarios ${info.project.name}`, objective: "Generar horarios.", status: "active", educationType: "non-formal", level: "unspecified", format: "workshop", modality: "in-person", pacing: "scheduled", area: "011", settings: { attendance: true } };
    const courseId = (await (await admin.post("/api/courses", { data: { ...body, leadId: "user-educator" } })).json()).id, path = `/api/courses/${courseId}`;
    const version = (await (await admin.get(path)).json()).course.version as number;
    expect((await admin.put(`${path}/team`, { data: { version, members: [{ userId: "user-educator", role: "lead" }, { userId: teacherId, role: "co-teacher" }] } })).status()).toBe(200);
    const section = async (name: string) => {
      const id = (await (await admin.post(`${path}/groups`, { data: { name: `${E2E_PREFIX} ${name}` } })).json()).id as string;
      expect((await admin.put(`${path}/groups/${id}/educators`, { data: { userIds: [teacherId] } })).status()).toBe(200);
      return id;
    };
    const first = await section("Horario A"), second = await section("Horario B");
    const setup = await (await admin.get("/api/timetables")).json();
    const bell = setup.bellSchedules.find((item: { name: string }) => item.name === "Jornada matutina");
    expect(bell.weekdays).toEqual([1, 2, 3, 4, 5]);
    const teacher = setup.educators.find((item: { id: string }) => item.id === teacherId);
    expect(teacher.name).toBe(teacherName);

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

    // Classrooms: the first section keeps its usual one; the second, without one, keeps the one it was given.
    for (const name of [e2eName(info, "Aula habitual"), e2eName(info, "Aula amplia")]) {
      const created = await admin.post("/api/timetables/classrooms", { data: { name, capacity: name.includes("amplia") ? 40 : 30 } });
      expect(created.status(), await created.text()).toBe(201);
      rooms.push((await created.json()).classroom.id);
    }
    expect((await admin.post("/api/timetables/classrooms", { data: { name: e2eName(info, "Aula habitual"), capacity: 10 } })).status()).toBe(409);
    expect((await admin.put(`/api/timetables/sections/${first}/classroom`, { data: { classroomId: rooms[0] } })).status()).toBe(200);
    const withRooms = await (await admin.post("/api/timetables/solve", { data: { bellScheduleId: bell.id, rules, sections: [{ id: first, meetingsPerWeek: 2, blocksPerMeeting: 1 }, { id: second, meetingsPerWeek: 2, blocksPerMeeting: 1 }] } })).json();
    expect(withRooms.result.status).toBe("solved");
    const roomed = withRooms.result.meetings as Meeting[];
    expect(roomed.filter(item => item.sectionId === first).map(item => item.classroomId)).toEqual([rooms[0], rooms[0]]);
    expect(new Set(roomed.filter(item => item.sectionId === second).map(item => item.classroomId)).size).toBe(1);
    const given = roomed.find(item => item.sectionId === second)!.classroomId;
    expect((await admin.post("/api/timetables/apply", { data: { from: days[0], until: days[9], meetings: roomed } })).status()).toBe(200);
    const after = (await (await admin.get("/api/timetables")).json()).sections as { id: string; classroomId: string | null }[];
    expect([after.find(item => item.id === first)!.classroomId, after.find(item => item.id === second)!.classroomId]).toEqual([rooms[0], given]);

    // The page: a rule written in words is interpreted, confirmed and listed before generating.
    await signIn(page, "admin-demo", "/organizacion/horarios");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Horarios");
    await page.getByLabel("Escribe una regla").fill(`${teacherName} no da clases el viernes.`);
    await page.getByRole("button", { name: "Interpretar" }).click();
    const proposed = page.getByRole("region", { name: "Reglas interpretadas" });
    await expect(proposed).toContainText(`${teacherName} no da clases el viernes`);
    await proposed.getByRole("button", { name: "Agregar las marcadas" }).click();
    await expect(page.locator(".timetable-rules")).toContainText(`${teacherName} no da clases el viernes`);
    await page.getByRole("button", { name: "Generar horario" }).click();
    await expect(page.getByRole("region", { name: "Horario semanal" })).toBeVisible({ timeout: 15_000 });

    // Classrooms are added and archived from the page; a section shows its usual one.
    await expect(page.getByLabel(`Aula habitual de ${E2E_PREFIX} Horarios ${info.project.name} · ${E2E_PREFIX} Horario A`)).toHaveValue(rooms[0]);
    const extra = e2eName(info, "Laboratorio");
    const add = page.getByRole("form", { name: "Agregar aula" });
    await add.getByLabel("Nombre del aula").fill(extra);
    await add.getByLabel("Capacidad").fill("18");
    await add.getByRole("button", { name: "Agregar aula" }).click();
    const listed = page.locator(".timetable-rooms > li", { hasText: extra });
    await expect(listed).toContainText("18 estudiantes · sin secciones");
    await listed.getByRole("button", { name: `Archivar ${extra}` }).click();
    await expect(listed).toHaveCount(0);
  } finally {
    for (const id of rooms) await admin.delete(`/api/timetables/classrooms/${id}`);
    await admin.dispose(); await educator.dispose();
  }
});
