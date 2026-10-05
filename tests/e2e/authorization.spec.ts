import { test, expect } from "./local-test";
import type { APIRequestContext, PlaywrightWorkerArgs } from "@playwright/test";
import { openNavigation, sessionToken, signIn } from "./helpers";

const course = "/api/courses/seed-course-matematicas";
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

test("HL-140 ST-096: only the course's teaching team reaches its groups, learners, sessions and attendance", async ({ playwright, baseURL }) => {
  const anon = await client(playwright, baseURL!), admin = await client(playwright, baseURL!, "marta.ruiz"), demoAdmin = await client(playwright, baseURL!, "admin-demo");
  const lead = await client(playwright, baseURL!, "lucia.herrera"), coTeacher = await client(playwright, baseURL!, "carlos.mejia");
  const outsider = await client(playwright, baseURL!, "educador-demo"), other = await client(playwright, baseURL!, "externo-demo");
  // The team works with the seeded groups and classes of the course.
  const groups = (await (await lead.get(`${course}/groups`)).json()).groups as { id: string; learners: { id: string }[] }[];
  expect(groups.length).toBeGreaterThan(0);
  expect((await coTeacher.get(`${course}/groups`)).status()).toBe(200);
  const sessions = (await (await coTeacher.get(`${course}/sessions`)).json()).sessions as { id: string; status: string; version: number }[];
  expect(sessions.length).toBeGreaterThan(0);
  const attendance = `${course}/sessions/${sessions[0].id}/attendance`;
  const roster = (await (await lead.get(attendance)).json()).learners as { learnerId: string; status: string }[];
  expect(roster.length).toBeGreaterThan(0);

  const requests = (api: APIRequestContext) => [
    () => api.get(`${course}/groups`), () => api.get(`${course}/sessions`), () => api.get(`${course}/assignments`), () => api.get(attendance),
    () => api.post(`${course}/groups`, { data: { name: "Grupo no autorizado" } }),
    () => api.post(`${course}/groups/${groups[0].id}/learners`, { data: { displayName: "Estudiante no autorizado" } }),
    () => api.post(`${course}/sessions`, { data: { groupId: groups[0].id, sessionDate: "2026-10-05" } }),
    () => api.put(attendance, { data: { marks: roster.map(row => ({ learnerId: row.learnerId, status: "absent" })) } }),
    () => api.get(`${course}/sessions/${sessions[0].id}`),
    () => api.put(`${course}/sessions/${sessions[0].id}`, { data: { sessionDate: "2026-10-05", version: 1 } }),
    ...["start", "complete", "cancel", "restore"].map(action => () => api.post(`${course}/sessions/${sessions[0].id}/${action}`)),
    () => api.put(`${course}/groups/${groups[0].id}`, { data: { name: "Grupo renombrado sin permiso" } }),
    () => api.post(`${course}/groups/${groups[0].id}/code`), () => api.delete(`${course}/groups/${groups[0].id}/code`),
    () => api.put(`${course}/groups/${groups[0].id}/learners/${groups[0].learners[0].id}`, { data: { status: "archived" } }),
  ];
  const total = requests(lead).length;
  const statuses = async (api: APIRequestContext) => (await Promise.all(requests(api).map(send => send()))).map(response => response.status());
  // Deny by default: an educator outside the team, administration and anonymous visitors get nothing; another
  // organization does not even see the course.
  expect(await statuses(outsider)).toEqual(Array(total).fill(403));
  expect(await statuses(admin)).toEqual(Array(total).fill(403));
  expect(await statuses(demoAdmin)).toEqual(Array(total).fill(403));
  expect(await statuses(anon)).toEqual(Array(total).fill(401));
  expect(await statuses(other)).toEqual(Array(total).fill(404));
  expect(Object.keys(await (await outsider.get(`${course}/groups`)).json())).toEqual(["error"]);
  // Nothing changed for the team, and the outsider's own list of classes leaves this course out.
  expect((await (await lead.get(attendance)).json()).learners).toEqual(roster);
  const after = (await (await lead.get(`${course}/sessions`)).json()).sessions as typeof sessions;
  expect(after.find(item => item.id === sessions[0].id)).toEqual(sessions[0]);
  expect((await (await lead.get(`${course}/groups`)).json()).groups).toEqual(groups);
  expect((await (await outsider.get("/api/classes")).json()).classes.some((item: { courseId: string }) => item.courseId === "seed-course-matematicas")).toBe(false);
  expect((await (await lead.get("/api/classes")).json()).classes.some((item: { courseId: string }) => item.courseId === "seed-course-matematicas")).toBe(true);

  // Access follows team membership: joining the team grants it, leaving revokes it.
  try {
    await setTeam(admin, [...original, { userId: "user-educator", role: "co-teacher" }]);
    expect((await outsider.get(`${course}/groups`)).status()).toBe(200);
    expect((await outsider.get(attendance)).status()).toBe(200);
    expect((await outsider.get(`${course}/sessions/${sessions[0].id}`)).status()).toBe(200);
  } finally {
    await setTeam(admin, original);
  }
  expect((await outsider.get(`${course}/groups`)).status()).toBe(403);
  expect((await outsider.get(`${course}/sessions/${sessions[0].id}`)).status()).toBe(403);
  expect((await outsider.post(`${course}/groups/${groups[0].id}/code`)).status()).toBe(403);
});

test("HL-140 ST-096: educators outside the team see no groups or attendance in the course", async ({ page }) => {
  await signIn(page, "educador-demo", "/cursos/seed-course-matematicas");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Matemáticas 3.º primaria");
  await openNavigation(page);
  const nav = page.getByRole("navigation", { name: "Navegación del curso" });
  for (const name of ["Clases", "Grupos", "Cronograma"]) await expect(nav.getByRole("link", { name, exact: true })).toHaveCount(0);
  await page.goto("/cursos/seed-course-matematicas/clases");
  await expect(page.getByRole("heading", { name: "Solo el equipo docente del curso" })).toBeVisible();
  // The team still works with them.
  await signIn(page, "lucia.herrera", "/cursos/seed-course-matematicas/grupos");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Grupos");
  await expect(page.locator(".group-card").first()).toBeVisible();
});
