import type { APIRequestContext } from "@playwright/test";
import { test, expect } from "./local-test";
import { E2E_PREFIX, sessionToken, signIn, toast } from "./helpers";
import { nextClassDays } from "../class-days";

type Session = { id: string; groupId: string; sessionDate: string; version: number; lessons: { id: string }[] };
const day = (offset: number) => new Date(Date.now() + offset * 86_400_000).toLocaleDateString("en-CA", { timeZone: "America/Guatemala" });

async function course(admin: APIRequestContext, educator: APIRequestContext, title: string) {
  const body = { title, objective: "Planificar el tiempo de las clases.", status: "active", educationType: "non-formal", level: "unspecified", format: "workshop", modality: "in-person", pacing: "scheduled", area: "023", settings: {}, programId: null };
  const id = (await (await admin.post("/api/courses", { data: { ...body, leadId: "user-educator" } })).json()).id as string, path = `/api/courses/${id}`;
  const version = async () => (await (await educator.get(path)).json()).course.version as number;
  const unitId = (await (await educator.post(`${path}/units`, { data: { name: `${E2E_PREFIX} Unidad`, objective: "Practicar.", status: "active", version: await version() } })).json()).id as string;
  return { id, path, unitId };
}

test("ST-117: a lesson lasts what its activities add up to, and a class warns without blocking when its lessons exceed its time", async ({ page, playwright, baseURL }, info) => {
  const admin = await playwright.request.newContext({ baseURL, extraHTTPHeaders: { Origin: baseURL!, Cookie: `hl_session=${await sessionToken("admin-demo")}` } });
  const educator = await playwright.request.newContext({ baseURL, extraHTTPHeaders: { Origin: baseURL!, Cookie: `hl_session=${await sessionToken("educador-demo")}` } });
  try {
    const { id: courseId, path, unitId } = await course(admin, educator, `${E2E_PREFIX} Tiempo ${info.project.name}`);
    // The duration a client sends is ignored: the lesson takes the minutes of its activities.
    const lessons: { id: string; title: string; duration: number }[] = [];
    for (const title of ["Primera", "Segunda"]) {
      const created = await educator.post("/api/lessons", { data: { title: `${E2E_PREFIX} ${title}`, objective: "Practicar.", courseId, courseUnitId: unitId, instructions: "Sigue las indicaciones.", duration: 90 } });
      const lesson = (await created.json()).lesson;
      expect(lesson.duration).toBe(lesson.activities.reduce((sum: number, activity: { minutes: number }) => sum + activity.minutes, 0));
      expect((await educator.post(`/api/lessons/${lesson.id}/publish`)).status()).toBe(200);
      lessons.push(lesson);
    }
    const minutes = lessons[0].duration + lessons[1].duration, length = minutes - 10;
    const groupId = (await (await admin.post(`${path}/groups`, { data: { name: `${E2E_PREFIX} Sección tiempo` } })).json()).id;
    expect((await admin.put(`${path}/groups/${groupId}/educators`, { data: { userIds: ["user-educator"], conflictReason: "Sección de prueba E2E; su horario puede coincidir con otras secciones de prueba." } })).status()).toBe(200);
    expect((await admin.put(`${path}/groups/${groupId}/schedule`, { data: { weekdays: [0, 1, 2, 3, 4, 5, 6], startsAt: "04:00", durationMinutes: length, from: day(1), until: day(3) } })).status()).toBe(200);
    const [first] = ((await (await educator.get(`${path}/sessions`)).json()).sessions as Session[]).filter(item => item.groupId === groupId).sort((a, b) => a.sessionDate.localeCompare(b.sessionDate));
    // Planning more than fits is allowed: the plan is saved as it is.
    const planned = await educator.put(`${path}/sessions/${first.id}`, { data: { sessionDate: first.sessionDate, startsAt: "04:00", durationMinutes: length, lessonIds: lessons.map(lesson => lesson.id), notes: "", version: first.version } });
    expect(planned.status(), await planned.text()).toBe(200);

    await signIn(page, "educador-demo", `/secciones/${groupId}/clases`);
    await expect(page.locator(".message-bar.warning")).toContainText("1 clase próxima tiene más lecciones de las que caben en su horario.");
    // The schedule also lists days without class (the seed has holidays): the first row that is a class.
    const row = page.getByRole("table", { name: /Cronograma de clases de/ }).locator("tbody tr").filter({ hasNotText: "Sin clase" }).first();
    await expect(row).toContainText("Excede 10 min");
    await row.getByRole("button", { name: /Planificar/ }).click();
    const dialog = page.getByRole("dialog", { name: /Planificar la clase/ });
    await expect(dialog.locator(".time-fit.over")).toContainText("Excede la duración de la clase por 10 min");
    await expect(dialog.locator(".time-fit.over")).toContainText(`${minutes} min de ${length} min`);
    await expect(dialog.locator(".time-fit.over")).toContainText("Puedes guardar igual");
    await dialog.getByRole("button", { name: `Quitar «${lessons[1].title}»` }).click();
    await expect(dialog.locator(".time-fit")).not.toHaveClass(/over/);
    await expect(dialog.locator(".time-fit")).toContainText(`${lessons[0].duration} min de ${length} min`);
    await dialog.getByRole("button", { name: "Guardar planificación" }).click();
    await expect(toast(page)).toContainText("Planificación guardada");
    await expect(page.locator(".message-bar.warning")).toHaveCount(0);

    // The editor shows the duration it computes; there is no separate duration to fill in.
    await page.goto(`/cursos/${courseId}/lecciones/${lessons[0].id}`);
    await expect(page.locator(".duration-total")).toHaveText(`${lessons[0].duration} min`);
    await expect(page.getByRole("spinbutton", { name: /Duración/ })).toHaveCount(0);
  } finally { await admin.dispose(); await educator.dispose(); }
});

test("ST-118: assigning an educator who teaches at the same time asks for a recorded confirmation", async ({ page, playwright, baseURL }, info) => {
  const admin = await playwright.request.newContext({ baseURL, extraHTTPHeaders: { Origin: baseURL!, Cookie: `hl_session=${await sessionToken("admin-demo")}` } });
  const educator = await playwright.request.newContext({ baseURL, extraHTTPHeaders: { Origin: baseURL!, Cookie: `hl_session=${await sessionToken("educador-demo")}` } });
  // Other specs teach as this educator from 04:00 to about 10:00; each project and retry gets its own two hours after that.
  const hour = 12 + (info.project.name === "mobile" ? 4 : 0) + info.retry * 8;
  // DEC-047: this test is about overlaps, so the educator declares the whole week while it runs (availability has its
  // own test in tests/availability.test.ts) and gets their declared slots back at the end.
  const declared = (await (await educator.get("/api/me/profile")).json()).profile.availability;
  const declare = async (availability: unknown) => {
    const { profile } = await (await educator.get("/api/me/profile")).json();
    expect((await educator.put("/api/me/profile", { data: { availability, draftVersion: profile.draftVersion } })).status()).toBe(200);
  };
  await declare([1, 2, 3, 4, 5, 6, 7].map(day => ({ day, start: "00:00", end: "23:59" })));
  try {
    const { path } = await course(admin, educator, `${E2E_PREFIX} Choques ${info.project.name}`);
    // The next two days with class after today: a holiday in between (the seed has them) gives no class to overlap.
    const [, from, until] = await nextClassDays(async () => await (await admin.get("/api/calendar")).json(), 3);
    const section = async (name: string, startsAt: string) => {
      const id = (await (await admin.post(`${path}/groups`, { data: { name: `${E2E_PREFIX} ${name}` } })).json()).id as string;
      expect((await admin.put(`${path}/groups/${id}/schedule`, { data: { weekdays: [0, 1, 2, 3, 4, 5, 6], startsAt, durationMinutes: 45, from, until } })).status()).toBe(200);
      return id;
    };
    const first = await section("Mañana", `${hour}:00`), second = await section("Misma hora", `${hour}:30`), later = await section("Más tarde", `${hour + 1}:20`);
    expect((await admin.put(`${path}/groups/${first}/educators`, { data: { userIds: ["user-educator"] } })).status()).toBe(200);
    // Classes last 45 minutes: :30 overlaps the class at :00 on both days; an hour later, :20 starts after both end.
    const refused = await admin.put(`${path}/groups/${second}/educators`, { data: { userIds: ["user-educator"] } });
    expect(refused.status()).toBe(409);
    expect((await refused.json()).conflicts).toEqual([expect.objectContaining({ userId: "user-educator", otherGroupId: first, overlaps: 2, firstDate: from, confirmation: null })]);
    expect((await admin.put(`${path}/groups/${second}/educators`, { data: { userIds: ["user-educator"], conflictReason: "ok" } })).status()).toBe(400);
    expect((await admin.get(`${path}/groups/${second}`).then(response => response.json())).group.educators).toEqual([]);
    expect((await admin.put(`${path}/groups/${later}/educators`, { data: { userIds: ["user-educator"] } })).status()).toBe(200);

    await signIn(page, "admin-demo", `/secciones/${second}`);
    const panel = page.getByLabel(`Educadores de ${E2E_PREFIX} Misma hora`);
    await panel.getByLabel(`Educador para ${E2E_PREFIX} Misma hora`).selectOption("user-educator");
    await panel.getByRole("button", { name: "Asignar" }).click();
    const dialog = page.getByRole("dialog", { name: "Choque de horario" });
    await expect(dialog.getByRole("alert")).toContainText("ya imparte otra sección a la misma hora");
    await expect(dialog.getByRole("alert")).toContainText(`2 clases coinciden con «${E2E_PREFIX} Choques ${info.project.name} · ${E2E_PREFIX} Mañana» (${hour}:00)`);
    await expect(dialog.getByRole("button", { name: "Confirmar y asignar" })).toBeDisabled();
    await dialog.getByLabel("Motivo de la excepción").fill("Las dos secciones comparten aula y se atienden juntas.");
    await dialog.getByRole("button", { name: "Confirmar y asignar" }).click();
    await expect(toast(page)).toContainText("imparte");
    expect((await (await admin.get(`/api/sections/${second}`)).json()).section.educators).toEqual([expect.objectContaining({ userId: "user-educator", conflicts: [expect.objectContaining({ otherGroupId: first, confirmation: expect.objectContaining({ confirmedBy: expect.any(String) }) })] })]);
    await expect(panel.locator(".conflict-note.confirmed")).toContainText("Choque confirmado.");
    await expect(panel.locator(".conflict-note.confirmed")).toContainText("«Las dos secciones comparten aula y se atienden juntas.»");

    // The confirmation stays with the section and in the activity history; the same pair is not asked again.
    const educators = (await admin.get(`${path}/groups/${second}`).then(response => response.json())).group.educators;
    expect(educators[0].conflicts[0]).toMatchObject({ otherGroupId: first, confirmation: { reason: "Las dos secciones comparten aula y se atienden juntas." } });
    const activity = await (await admin.get(`/api/activity?section=${second}`)).json();
    expect(JSON.stringify(activity)).toContain("Confirmó el choque de horario");
    expect((await admin.put(`${path}/groups/${second}/educators`, { data: { userIds: [] } })).status()).toBe(200);
    expect((await admin.put(`${path}/groups/${second}/educators`, { data: { userIds: ["user-educator"] } })).status()).toBe(200);
  } finally { await declare(declared); await admin.dispose(); await educator.dispose(); }
});
