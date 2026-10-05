import { test, expect } from "./local-test";
import type { APIRequest, APIRequestContext } from "@playwright/test";
import { E2E_PREFIX, courseNav, openNavigation, sessionToken, signIn, toast } from "./helpers";

type Assignment = { id: string; groupId: string; lessonId: string; availability: string; period: string; requiresSubstitution: boolean; assignedRevision: number; publishedRevision: number | null };

async function clients(playwright: { request: APIRequest }, baseURL: string, usernames: (string | undefined)[]) {
  return Promise.all(usernames.map(async username => playwright.request.newContext({
    baseURL, extraHTTPHeaders: { Origin: baseURL, ...(username ? { Cookie: `hl_session=${await sessionToken(username)}` } : {}) }, timeout: 15000,
  })));
}

/** A course with groups enabled, one module, two published lessons and one draft. */
async function courseWithLessons(educator: APIRequestContext, label: string) {
  const body = { title: `${E2E_PREFIX} Cronograma ${label}`, objective: "Organizar qué lección usa cada grupo.", status: "active", educationType: "non-formal", level: "unspecified", format: "workshop", modality: "in-person", pacing: "scheduled", area: "011", settings: { attendance: true }, programId: null };
  const created = await educator.post("/api/courses", { data: body }); expect(created.status(), await created.text()).toBe(201);
  const courseId = (await created.json()).id, path = `/api/courses/${courseId}`;
  const unit = await educator.post(`${path}/units`, { data: { name: `${E2E_PREFIX} Módulo 1`, objective: "Practicar.", status: "active", version: 1 } }); expect(unit.status()).toBe(201);
  const courseUnitId = (await unit.json()).id;
  const lesson = async (title: string, publish: boolean) => {
    const r = await educator.post("/api/lessons", { data: { title: `${E2E_PREFIX} ${title}`, objective: "Practicar con el grupo.", courseId, courseUnitId, instructions: "Sigue las indicaciones.", duration: 20 } });
    expect(r.status()).toBe(201);
    const saved = (await r.json()).lesson;
    if (publish) expect((await educator.post(`/api/lessons/${saved.id}/publish`)).status()).toBe(200);
    return saved as { id: string; title: string; draftVersion: number };
  };
  return { courseId, path, courseUnitId, first: await lesson("Saludos", true), second: await lesson("Despedidas", true), draft: await lesson("Borrador", false) };
}

test("ST-027 API: only published lessons are assigned, with recipient and period; replaced and archived publications are identified", async ({ playwright, baseURL }, info) => {
  const [anon, educator, admin, other] = await clients(playwright, baseURL!, [undefined, "educador-demo", "admin-demo", "externo-demo"]);
  try {
    const { path, courseUnitId, courseId, first, second, draft } = await courseWithLessons(educator, `API ${info.project.name}`);
    const group = await educator.post(`${path}/groups`, { data: { name: `${E2E_PREFIX} Grupo martes` } }); expect(group.status()).toBe(201);
    const groupId = (await group.json()).id;
    expect((await anon.get(`${path}/assignments`)).status()).toBe(401);
    expect((await admin.get(`${path}/assignments`)).status()).toBe(403);
    expect((await other.get(`${path}/assignments`)).status()).toBe(404);
    // Only published content can be assigned.
    const notPublished = await educator.post(`${path}/assignments`, { data: { groupId, lessonId: draft.id, startsOn: "2026-10-05" } });
    expect(notPublished.status()).toBe(400);
    expect((await notPublished.json()).error).toContain("Solo se pueden programar lecciones publicadas");
    // Recipient and period are required and coherent.
    expect((await educator.post(`${path}/assignments`, { data: { groupId: "group-unknown", lessonId: first.id, startsOn: "2026-10-05" } })).status()).toBe(400);
    expect((await educator.post(`${path}/assignments`, { data: { groupId, lessonId: first.id } })).status()).toBe(400);
    expect((await educator.post(`${path}/assignments`, { data: { groupId, lessonId: first.id, startsOn: "2026-10-10", endsOn: "2026-10-01" } })).status()).toBe(400);
    const created = await educator.post(`${path}/assignments`, { data: { groupId, lessonId: first.id, startsOn: "2026-01-05", endsOn: "2099-12-18" } });
    expect(created.status(), await created.text()).toBe(201);
    expect((await educator.post(`${path}/assignments`, { data: { groupId, lessonId: first.id, startsOn: "2026-10-05" } })).status()).toBe(409);
    const list = async () => (await (await educator.get(`${path}/assignments`)).json()).assignments as Assignment[];
    let [assignment] = await list();
    expect(assignment).toMatchObject({ groupId, lessonId: first.id, availability: "current", period: "active", requiresSubstitution: false, assignedRevision: 1, publishedRevision: 1 });
    // A newer publication is identified; the group already receives it, no substitution needed.
    expect((await educator.post(`/api/lessons/${first.id}/publish`)).status()).toBe(200);
    [assignment] = await list();
    expect(assignment).toMatchObject({ availability: "updated", assignedRevision: 1, publishedRevision: 2, requiresSubstitution: false });
    expect((await educator.put(`${path}/assignments/${assignment.id}`, { data: { action: "adopt" } })).status()).toBe(200);
    expect((await list())[0]).toMatchObject({ availability: "current", assignedRevision: 2 });
    // An archived lesson leaves the group without content: the assignment requires substitution.
    const current = (await (await educator.get(`/api/lessons/${first.id}?draft=1`)).json()).lesson;
    expect((await educator.put(`/api/lessons/${first.id}`, { data: { title: current.title, objective: current.objective, courseId, courseUnitId, instructions: "Sigue las indicaciones.", duration: 20, draftVersion: current.draftVersion, status: "archived" } })).status()).toBe(200);
    [assignment] = await list();
    expect(assignment).toMatchObject({ availability: "unavailable", publishedRevision: null, requiresSubstitution: true });
    expect((await educator.put(`${path}/assignments/${assignment.id}`, { data: { action: "substitute", lessonId: draft.id } })).status()).toBe(400);
    expect((await educator.put(`${path}/assignments/${assignment.id}`, { data: { action: "substitute", lessonId: second.id } })).status()).toBe(200);
    expect((await list())[0]).toMatchObject({ lessonId: second.id, availability: "current", requiresSubstitution: false });
    expect((await other.put(`${path}/assignments/${assignment.id}`, { data: { action: "withdraw" } })).status()).toBe(404);
    expect((await educator.put(`${path}/assignments/${assignment.id}`, { data: { action: "withdraw" } })).status()).toBe(200);
    expect(await list()).toEqual([]);
  } finally { await Promise.all([anon, educator, admin, other].map(c => c.dispose())); }
});

test("ST-027 UI: assign a published lesson to a group and see distinct messages for no assignment and no publication", async ({ page, playwright, baseURL }, info) => {
  const [educator] = await clients(playwright, baseURL!, ["educador-demo"]);
  try {
    // A course with groups but nothing published shows the missing publication, not a missing assignment.
    const emptyBody = { title: `${E2E_PREFIX} Sin publicar ${info.project.name}`, objective: "Curso sin lecciones publicadas.", status: "active", educationType: "non-formal", level: "unspecified", format: "workshop", modality: "in-person", pacing: "scheduled", area: "011", settings: { attendance: true }, programId: null };
    const empty = (await (await educator.post("/api/courses", { data: emptyBody })).json()).id;
    expect((await educator.post(`/api/courses/${empty}/groups`, { data: { name: `${E2E_PREFIX} Grupo sin contenido` } })).status()).toBe(201);
    // Links to the former Asignaciones page open the schedule.
    await signIn(page, "educador-demo", `/cursos/${empty}/asignaciones`);
    await expect(page).toHaveURL(new RegExp(`/cursos/${empty}/cronograma$`));
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Cronograma");
    await expect(page.getByRole("status").filter({ hasText: "Este curso no tiene lecciones publicadas" })).toBeVisible();
    await expect(page.getByText("Este grupo aún no tiene lecciones en el cronograma.")).toBeVisible();
    await expect(page.getByRole("button", { name: "Programar lección", exact: true })).toHaveCount(0);

    const { courseId, first } = await courseWithLessons(educator, `UI ${info.project.name}`);
    const groupName = `${E2E_PREFIX} Grupo jueves`;
    expect((await educator.post(`/api/courses/${courseId}/groups`, { data: { name: groupName } })).status()).toBe(201);
    await page.goto(`/cursos/${courseId}`);
    await expect(page.getByRole("heading", { level: 1 })).toContainText("Cronograma UI");
    await openNavigation(page);
    await courseNav(page).getByRole("link", { name: "Cronograma", exact: true }).click();
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Cronograma");
    const panel = page.locator(".assignment-group").filter({ has: page.getByRole("heading", { name: groupName, exact: true }) });
    await expect(panel.getByText("Este grupo aún no tiene lecciones en el cronograma.")).toBeVisible();
    await panel.getByRole("button", { name: `Programar para ${groupName}` }).click();
    const dialog = page.getByRole("dialog", { name: "Programar lección" });
    await expect(dialog.getByLabel("Grupo").locator("option:checked")).toHaveText(groupName);
    // Drafts are never offered.
    await expect(dialog.getByLabel("Lección").locator("option")).toHaveCount(2);
    await dialog.getByLabel("Lección").selectOption(first.id);
    await dialog.getByRole("button", { name: "Programar", exact: true }).click();
    await expect(toast(page)).toContainText(`Lección programada para ${groupName}.`);
    const row = panel.locator(".assignment-row").filter({ hasText: first.title });
    await expect(row.getByText("Vigente", { exact: true })).toBeVisible();
    await expect(row.getByText("Publicación 1", { exact: true })).toBeVisible();
    await expect(row).toContainText("Desde el");
    // Persisted after reload.
    await page.reload();
    await expect(page.locator(".assignment-row").filter({ hasText: first.title })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.locator(".assignment-row").filter({ hasText: first.title }).getByRole("button", { name: "Retirar" }).click();
    await expect(toast(page)).toContainText("se retiró de");
    await expect(panel.getByText("Este grupo aún no tiene lecciones en el cronograma.")).toBeVisible();
  } finally { await educator.dispose(); }
});
