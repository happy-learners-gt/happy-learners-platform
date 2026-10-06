import { test, expect } from "./local-test";
import type { APIRequestContext, PlaywrightWorkerArgs } from "@playwright/test";
import { publish, sessionToken, signIn } from "./helpers";

const slug = "seed-course-matematicas", course = `/api/courses/${slug}`;
const original = [{ userId: "seed-user-carlos", role: "co-teacher" }, { userId: "seed-user-lucia", role: "lead" }];

const contexts: APIRequestContext[] = [];
test.afterEach(async () => { for (const context of contexts.splice(0)) await context.dispose(); });
async function client(playwright: PlaywrightWorkerArgs["playwright"], baseURL: string, username?: string) {
  const cookie: Record<string, string> = username ? { Cookie: `hl_session=${await sessionToken(username)}` } : {};
  const context = await playwright.request.newContext({ baseURL, extraHTTPHeaders: { Origin: baseURL, ...cookie }, timeout: 15000 });
  contexts.push(context);
  return context;
}
const version = async (api: APIRequestContext) => (await (await api.get(course)).json()).course.version as number;
const team = async (api: APIRequestContext) => ((await (await api.get(course)).json()).course.team as { userId: string; role: string }[])
  .map(({ userId, role }) => ({ userId, role })).sort((a, b) => a.userId.localeCompare(b.userId));
const setTeam = async (admin: APIRequestContext, members: { userId: string; role: string }[]) =>
  expect((await admin.put(`${course}/team`, { data: { members, version: await version(admin) } })).status()).toBe(200);

test("HL-115 ST-072: only administration changes a course team", async ({ playwright, baseURL }) => {
  const anon = await client(playwright, baseURL!), admin = await client(playwright, baseURL!, "marta.ruiz");
  const lead = await client(playwright, baseURL!, "lucia.herrera"), outsider = await client(playwright, baseURL!, "educador-demo"), other = await client(playwright, baseURL!, "externo-demo");
  const widened = [{ userId: "seed-user-ana", role: "co-teacher" }, ...original];
  try {
    expect((await anon.put(`${course}/team`, { data: { members: widened, version: 1 } })).status()).toBe(401);
    // The course lead and an educator outside the team cannot change it, even with the current version.
    expect((await lead.put(`${course}/team`, { data: { members: widened, version: await version(admin) } })).status()).toBe(403);
    expect((await outsider.put(`${course}/team`, { data: { members: [...original, { userId: "user-educator", role: "co-teacher" }], version: await version(admin) } })).status()).toBe(403);
    // Another organization does not even see the course.
    expect((await other.put(`${course}/team`, { data: { members: widened, version: 1 } })).status()).toBe(404);
    expect(await team(admin)).toEqual(original);

    // Administration can only choose active people of its own organization.
    expect((await admin.put(`${course}/team`, { data: { members: [...original, { userId: "user-2", role: "co-teacher" }], version: await version(admin) } })).status()).toBe(400);
    await setTeam(admin, widened);
    // Educators still see the team, and the change is in the course's activity.
    expect(await team(lead)).toEqual(widened);
    const events = (await (await lead.get("/api/activity?course=seed-course-matematicas&limit=5")).json()).events as { summary: string; actorName: string }[];
    expect(events[0]).toMatchObject({ summary: "Actualizó el equipo docente (3 personas)", actorName: "Marta Ruiz" });
  } finally {
    await setTeam(admin, original);
  }
  expect(await team(admin)).toEqual(original);
});

type Group = { id: string; learners: { id: string }[]; educators: { userId: string }[] };
const educators = (admin: APIRequestContext, groupId: string, userIds: string[]) => admin.put(`${course}/groups/${groupId}/educators`, { data: { userIds } });

test("HL-140 ST-096 ST-102 ST-103: administration configures the sections; only those who teach a section record its classes", async ({ playwright, baseURL }) => {
  const anon = await client(playwright, baseURL!), admin = await client(playwright, baseURL!, "marta.ruiz"), demoAdmin = await client(playwright, baseURL!, "admin-demo");
  const lead = await client(playwright, baseURL!, "lucia.herrera"), coTeacher = await client(playwright, baseURL!, "carlos.mejia");
  const outsider = await client(playwright, baseURL!, "educador-demo"), other = await client(playwright, baseURL!, "externo-demo");
  // The team works with the seeded sections and classes of the course; until now everyone on it taught every section.
  const groups = (await (await lead.get(`${course}/groups`)).json()).groups as Group[];
  expect(groups.length).toBeGreaterThan(1);
  for (const group of groups) expect(group.educators.map(item => item.userId).sort()).toEqual(original.map(item => item.userId).sort());
  const sessions = (await (await coTeacher.get(`${course}/sessions`)).json()).sessions as { id: string; groupId: string; status: string; version: number }[];
  const first = sessions.find(item => item.groupId === groups[0].id)!;
  const attendance = `${course}/sessions/${first.id}/attendance`;
  const roster = (await (await lead.get(attendance)).json()).learners as { learnerId: string; status: string }[];
  expect(roster.length).toBeGreaterThan(0);

  const reading = (api: APIRequestContext) => [() => api.get(`${course}/groups`), () => api.get(`${course}/sessions`), () => api.get(attendance), () => api.get(`${course}/sessions/${first.id}`)];
  const teaching = (api: APIRequestContext) => [
    () => api.post(`${course}/sessions`, { data: { groupId: groups[0].id, sessionDate: "2026-10-05" } }),
    () => api.put(attendance, { data: { marks: roster.map(row => ({ learnerId: row.learnerId, status: "absent" })) } }),
    () => api.put(`${course}/sessions/${first.id}`, { data: { sessionDate: "2026-10-05", version: 1 } }),
    () => api.put(`${course}/sessions/${first.id}`, { data: { sessionDate: "2026-10-05", lessonIds: [], notes: "Sin permiso", version: 1 } }),
    () => api.post(`${course}/groups/${groups[0].id}/lessons`, { data: { perClass: 2 } }),
    ...["start", "complete", "cancel", "restore"].map(action => () => api.post(`${course}/sessions/${first.id}/${action}`)),
  ];
  const configuring = (api: APIRequestContext) => [
    () => api.post(`${course}/groups`, { data: { name: "Sección no autorizada" } }),
    () => api.post(`${course}/groups/${groups[0].id}/learners`, { data: { displayName: "Estudiante no autorizado" } }),
    () => api.put(`${course}/groups/${groups[0].id}/schedule`, { data: { weekdays: [1], startsAt: "08:00", durationMinutes: 45, from: "2026-10-05", until: "2026-10-30" } }),
    () => api.delete(`${course}/groups/${groups[0].id}/schedule`),
    () => api.put(`${course}/groups/${groups[0].id}`, { data: { name: "Sección renombrada sin permiso" } }),
    () => api.post(`${course}/groups/${groups[0].id}/code`), () => api.delete(`${course}/groups/${groups[0].id}/code`),
    () => api.put(`${course}/groups/${groups[0].id}/learners/${groups[0].learners[0].id}`, { data: { status: "archived" } }),
    () => educators(api, groups[0].id, ["seed-user-lucia"]),
  ];
  const statuses = async (calls: (() => Promise<{ status(): number }>)[]) => (await Promise.all(calls.map(send => send()))).map(response => response.status());
  const all = (api: APIRequestContext) => [...reading(api), ...teaching(api), ...configuring(api)];
  // Deny by default: an educator outside the team gets nothing; another organization does not even see the course.
  expect(await statuses(all(outsider))).toEqual(Array(all(outsider).length).fill(403));
  expect(await statuses(all(anon))).toEqual(Array(all(anon).length).fill(401));
  expect(await statuses(all(other))).toEqual(Array(all(other).length).fill(404));
  expect(Object.keys(await (await outsider.get(`${course}/groups`)).json())).toEqual(["error"]);
  // Administration reads every section and its attendance, but does not teach its classes.
  for (const api of [admin, demoAdmin]) {
    expect(await statuses(reading(api))).toEqual([200, 200, 200, 200]);
    expect(await statuses(teaching(api))).toEqual(Array(teaching(api).length).fill(403));
  }
  // The team teaches; it does not configure sections, students, schedules, codes or who teaches.
  for (const api of [lead, coTeacher]) expect(await statuses(configuring(api))).toEqual(Array(configuring(api).length).fill(403));
  // Nothing changed, and the outsider's own list of classes leaves this course out.
  expect((await (await lead.get(attendance)).json()).learners).toEqual(roster);
  expect(((await (await lead.get(`${course}/sessions`)).json()).sessions as typeof sessions).find(item => item.id === first.id)).toEqual(first);
  expect((await (await lead.get(`${course}/groups`)).json()).groups).toEqual(groups);
  expect((await (await outsider.get("/api/classes")).json()).classes.some((item: { courseId: string }) => item.courseId === "seed-course-matematicas")).toBe(false);
  expect((await (await lead.get("/api/classes")).json()).classes.some((item: { courseId: string }) => item.courseId === "seed-course-matematicas")).toBe(true);

  // DEC-024: a section's educators come from the course's team; nobody joins the team by being assigned a section.
  expect((await educators(admin, groups[0].id, [...groups[0].educators.map(item => item.userId), "user-educator"])).status()).toBe(400);
  expect((await outsider.get(`${course}/groups`)).status()).toBe(403);
  // Joining the team gives the course; administration then assigns the sections it teaches. Leaving revokes both.
  try {
    await setTeam(admin, [...original, { userId: "user-educator", role: "co-teacher" }]);
    expect((await (await outsider.get(`${course}/groups`)).json()).groups).toEqual([]);
    expect((await outsider.get(attendance)).status()).toBe(404);
    expect((await educators(admin, groups[0].id, [...groups[0].educators.map(item => item.userId), "user-educator"])).status()).toBe(200);
    expect(((await (await outsider.get(`${course}/groups`)).json()).groups as Group[]).map(item => item.id)).toEqual([groups[0].id]);
    expect((await outsider.get(attendance)).status()).toBe(200);
    expect((await outsider.get(`${course}/sessions/${first.id}`)).status()).toBe(200);
  } finally {
    await setTeam(admin, original);
  }
  expect((await outsider.get(`${course}/groups`)).status()).toBe(403);
  expect((await outsider.get(`${course}/sessions/${first.id}`)).status()).toBe(403);
  expect((await (await lead.get(`${course}/groups`)).json()).groups).toEqual(groups);
});

test("ST-103 DEC-024: the co-teacher and the lead each see and teach only the sections assigned to them", async ({ playwright, baseURL, page }) => {
  const admin = await client(playwright, baseURL!, "marta.ruiz"), lead = await client(playwright, baseURL!, "lucia.herrera"), coTeacher = await client(playwright, baseURL!, "carlos.mejia");
  const groups = (await (await admin.get(`${course}/groups`)).json()).groups as (Group & { name: string; status: string })[];
  const [kept, removed] = groups.filter(item => item.status === "active" && item.educators.some(person => person.userId === "seed-user-carlos"));
  const sessions = (await (await admin.get(`${course}/sessions`)).json()).sessions as { id: string; groupId: string; status: string }[];
  const theirs = sessions.find(item => item.groupId === removed.id && item.status === "planned")!, leads = sessions.find(item => item.groupId === kept.id && item.status === "planned")!;
  const ids = async (api: APIRequestContext) => ((await (await api.get("/api/sections")).json()).sections as { id: string }[]).map(item => item.id);
  try {
    expect((await educators(admin, removed.id, ["seed-user-lucia"])).status()).toBe(200);
    expect((await educators(admin, kept.id, ["seed-user-carlos"])).status()).toBe(200);
    // Each section is its own instance: its classes, schedule and indicators reach only who teaches it.
    expect(await ids(coTeacher)).toContain(kept.id);
    expect(await ids(coTeacher)).not.toContain(removed.id);
    expect(await ids(lead)).toContain(removed.id);
    expect(await ids(lead)).not.toContain(kept.id);
    expect(await ids(admin)).toEqual(expect.arrayContaining([kept.id, removed.id]));
    expect((await coTeacher.get(`/api/sections/${removed.id}`)).status()).toBe(403);
    expect((await lead.get(`/api/sections/${kept.id}`)).status()).toBe(403);
    expect((await coTeacher.get(`/api/sections/${removed.id}/progress`)).status()).toBe(403);
    expect((await lead.get(`/api/sections/${kept.id}/progress`)).status()).toBe(403);
    expect((await (await coTeacher.get(`/api/sections/${kept.id}`)).json()).section).toMatchObject({ id: kept.id, teaches: true, indicators: { learners: expect.any(Number) } });
    expect(((await (await coTeacher.get(`${course}/groups`)).json()).groups as Group[]).map(item => item.id)).not.toContain(removed.id);
    expect(((await (await coTeacher.get(`${course}/sessions`)).json()).sessions as typeof sessions).some(item => item.groupId === removed.id)).toBe(false);
    expect((await coTeacher.get(`${course}/sessions/${theirs.id}`)).status()).toBe(404);
    expect((await coTeacher.post(`${course}/sessions/${theirs.id}/start`)).status()).toBe(404);
    expect((await coTeacher.post(`${course}/sessions`, { data: { groupId: removed.id, sessionDate: "2026-10-05" } })).status()).toBe(400);
    expect(((await (await coTeacher.get("/api/classes")).json()).classes as { groupId: string }[]).some(item => item.groupId === removed.id)).toBe(false);
    // The lead publishes the course's content, but teaches only the sections assigned.
    expect((await lead.get(`${course}/sessions/${theirs.id}`)).status()).toBe(200);
    expect((await lead.get(`${course}/sessions/${leads.id}`)).status()).toBe(404);
    expect(((await (await lead.get("/api/classes")).json()).classes as { groupId: string }[]).some(item => item.groupId === kept.id)).toBe(false);
    // What happens in a section stays with who teaches it.
    type Event = { targetType: string; targetId: string };
    expect(((await (await admin.get(`/api/activity?section=${removed.id}`)).json()).events as Event[]).length).toBeGreaterThan(0);
    expect((await (await coTeacher.get(`/api/activity?section=${removed.id}`)).json()).events).toEqual([]);
    expect(((await (await coTeacher.get("/api/activity?limit=100")).json()).events as Event[]).some(item => item.targetId === removed.id)).toBe(false);

    // On screen each one finds only their sections, and cannot configure them.
    await signIn(page, "carlos.mejia", "/secciones");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Docencia");
    await page.goto(`/cursos/${slug}/secciones`);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Secciones");
    await expect(page.getByRole("link", { name: kept.name, exact: true })).toBeVisible();
    await expect(page.getByRole("link", { name: removed.name, exact: true })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Nueva sección", exact: true })).toHaveCount(0);
    await page.goto(`/secciones/${removed.id}`);
    await expect(page.getByRole("heading", { name: "Esta sección no está asignada a tu cuenta" })).toBeVisible();
    await page.goto(`/secciones/${kept.id}/horario`);
    await expect(page.locator("form[aria-label^='Horario de']")).toHaveCount(0);
    await expect(page.locator(".timetable")).toContainText(kept.name);
    await signIn(page, "lucia.herrera", `/cursos/${slug}/secciones`);
    await expect(page.getByRole("link", { name: removed.name, exact: true })).toBeVisible();
    await expect(page.getByRole("link", { name: kept.name, exact: true })).toHaveCount(0);
  } finally {
    expect((await educators(admin, removed.id, removed.educators.map(item => item.userId))).status()).toBe(200);
    expect((await educators(admin, kept.id, kept.educators.map(item => item.userId))).status()).toBe(200);
  }
});

test("HL-140 ST-102 ST-103: an educator sees only their own courses; administration sees all of them, read-only", async ({ page }) => {
  await signIn(page, "educador-demo", "/cursos");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Cursos");
  await expect(page.locator("article.course-card").filter({ hasText: "Exploradores" })).toBeVisible();
  await expect(page.locator("article.course-card").filter({ hasText: "Matemáticas 3.º primaria" })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Crear curso", exact: true })).toHaveCount(0);
  await page.goto("/cursos/seed-course-matematicas/secciones");
  await expect(page.getByRole("heading", { name: "Este curso no está asignado a tu cuenta" })).toBeVisible();
  await page.goto("/secciones/seed-group-mat-3a");
  await expect(page.getByRole("heading", { name: "Esta sección no está asignada a tu cuenta" })).toBeVisible();
  // Administration reads the content and the classes, without writing them.
  await signIn(page, "marta.ruiz", "/cursos/seed-course-matematicas/contenido");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Contenido");
  await expect(page.getByRole("button", { name: /^Crear / })).toHaveCount(0);
  await expect(page.getByRole("button", { name: /^Nueva lección en / })).toHaveCount(0);
  await page.goto("/secciones/seed-group-mat-3a/clases");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Cronograma");
  await expect(page.getByRole("button", { name: "Agregar clase", exact: true })).toHaveCount(0);
  await page.goto("/cursos/seed-course-matematicas/secciones");
  await expect(page.getByRole("button", { name: "Nueva sección", exact: true })).toBeVisible();
  await page.goto("/secciones");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Docencia");
  // The team works in the sections it teaches.
  await signIn(page, "lucia.herrera", "/secciones");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Docencia");
  await expect(page.getByRole("link", { name: "3.º A", exact: true })).toBeVisible();
  await expect(page.getByRole("region", { name: "Mi semana" })).toContainText("Matemáticas 3.º primaria");
  await page.goto("/secciones/seed-group-mat-3a/horario");
  await expect(page.locator(".timetable")).toContainText("08:00");
  await expect(page.locator(".timetable")).toContainText("3.º A");
});

test("ST-104: a co-teacher sends a lesson to review; the lead returns it with comments, then approves and publishes it", async ({ playwright, baseURL, page }) => {
  const admin = await client(playwright, baseURL!, "marta.ruiz"), lead = await client(playwright, baseURL!, "lucia.herrera"), coTeacher = await client(playwright, baseURL!, "carlos.mejia");
  const lessons = (await (await lead.get("/api/lessons?drafts=1&course=seed-course-matematicas")).json()).lessons as { id: string; title: string; revision: number; hasDraft?: boolean; status: string; draftVersion: number }[];
  const lesson = lessons.find(item => item.revision > 0 && !item.hasDraft && item.status !== "archived")!;
  const path = `/api/lessons/${lesson.id}`;
  // Only the lead publishes and organizes; administration reads drafts without writing them.
  expect((await coTeacher.post(`${path}/publish`)).status()).toBe(403);
  expect((await coTeacher.post(`${course}/units`, { data: { name: "Sin permiso", objective: "", status: "active", version: 1 } })).status()).toBe(403);
  expect((await admin.get(`${path}?draft=1`)).status()).toBe(200);
  expect((await admin.post(`${path}/review`, { data: { note: "" } })).status()).toBe(403);
  expect((await admin.post(`${path}/publish`)).status()).toBe(403);
  expect((await lead.post(`${path}/review`, { data: { note: "" } })).status()).toBe(409);
  expect((await lead.post(`${path}/review/return`, { data: { note: "Nada que devolver" } })).status()).toBe(409);

  // The co-teacher edits the draft: the published version stays until the lead publishes it.
  const draft = (await (await coTeacher.get(`${path}?draft=1`)).json()).lesson;
  const edited = { title: draft.title, objective: `${draft.objective} Con práctica guiada.`, courseId: draft.courseId, courseUnitId: draft.courseUnitId, duration: draft.duration, draftVersion: draft.draftVersion, status: "draft", sequence: draft.sequence, outcomeIds: draft.outcomeIds, instructions: "", activities: draft.activities };
  expect((await coTeacher.put(path, { data: edited })).status()).toBe(200);
  await signIn(page, "carlos.mejia", `/cursos/seed-course-matematicas/lecciones/${lesson.id}`);
  await expect(page.getByLabel("Título de la lección")).toHaveValue(lesson.title);
  await expect(page.getByRole("button", { name: "Enviar a revisión", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: /^Publicar/ })).toHaveCount(0);
  const sent = await coTeacher.post(`${path}/review`, { data: { note: "Agregué la práctica guiada." } });
  expect(sent.status()).toBe(201);
  expect((await coTeacher.post(`${path}/review`, { data: { note: "Actualicé la nota." } })).status()).toBe(201);
  let queue = await (await lead.get("/api/reviews")).json();
  expect(queue.toReview.filter((item: { lessonId: string }) => item.lessonId === lesson.id)).toMatchObject([{ status: "pending", note: "Actualicé la nota.", requestedByName: "Carlos Mejía" }]);
  expect((await (await coTeacher.get("/api/reviews")).json()).mine).toMatchObject([{ lessonId: lesson.id, status: "pending" }]);

  // The lead returns it with what to change; the co-teacher sees why.
  expect((await lead.post(`${path}/review/return`, { data: { note: "" } })).status()).toBe(400);
  expect((await lead.post(`${path}/review/return`, { data: { note: "Falta la pregunta de cierre." } })).status()).toBe(200);
  expect((await (await coTeacher.get("/api/reviews")).json()).mine).toMatchObject([{ lessonId: lesson.id, status: "returned", decisionNote: "Falta la pregunta de cierre.", decidedByName: "Lucía Herrera" }]);
  await page.reload();
  await expect(page.locator(".review-banner")).toContainText("Falta la pregunta de cierre.");
  await page.getByRole("button", { name: "Volver a enviar a revisión", exact: true }).click();
  const recommendations = page.getByRole("dialog", { name: "¿Enviar con recomendaciones pendientes?" });
  if (await recommendations.waitFor({ timeout: 2000 }).then(() => true, () => false)) await recommendations.getByRole("button", { name: "Continuar" }).click();
  const dialog = page.getByRole("dialog", { name: "Enviar a revisión" });
  await dialog.getByLabel("Nota para la persona responsable").fill("Agregué la pregunta de cierre.");
  await dialog.getByRole("button", { name: "Enviar a revisión" }).click();
  await expect(page.locator(".review-banner")).toContainText("la envió a revisión");

  // The lead finds it in Inicio and approves it by publishing.
  await signIn(page, "lucia.herrera", "/inicio");
  const pending = page.locator("section").filter({ has: page.getByRole("heading", { name: /^Por revisar/ }) });
  await expect(pending).toContainText("Agregué la pregunta de cierre.");
  await pending.getByRole("link", { name: lesson.title }).click();
  await expect(page.locator(".review-banner")).toContainText("Carlos Mejía la envió a revisión");
  await publish(page, "Aprobar y publicar");
  await expect(page.locator(".toast-region")).toContainText("Revisión aprobada y lección publicada");
  queue = await (await lead.get("/api/reviews")).json();
  expect(queue.toReview.some((item: { lessonId: string }) => item.lessonId === lesson.id)).toBe(false);
  expect((await (await coTeacher.get("/api/reviews")).json()).mine.some((item: { lessonId: string }) => item.lessonId === lesson.id)).toBe(false);
  expect(((await (await lead.get(`${path}?draft=1`)).json()).lesson as { revision: number }).revision).toBe(lesson.revision + 1);
});
