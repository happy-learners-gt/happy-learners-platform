import { test, expect } from "./local-test";
import { E2E_PREFIX, sessionToken, signIn } from "./helpers";

type Current = { id: string; lessonId: string; lessonTitle: string; effective: { revision: number; shareCode: string } | null; availability: string };

test("ST-029 an assignment resolves the current publication, warns without a valid version and never exposes drafts", async ({ page, playwright, baseURL }, info) => {
  const educator = await playwright.request.newContext({ baseURL, extraHTTPHeaders: { Origin: baseURL!, Cookie: `hl_session=${await sessionToken("educador-demo")}` } });
  const admin = await playwright.request.newContext({ baseURL, extraHTTPHeaders: { Origin: baseURL!, Cookie: `hl_session=${await sessionToken("admin-demo")}` } });
  try {
    expect((await admin.get("/api/assignments")).status()).toBe(403);
    const body = { title: `${E2E_PREFIX} Vigente ${info.project.name}`, objective: "Recibir la versión vigente.", status: "active", educationType: "non-formal", level: "unspecified", format: "workshop", modality: "in-person", pacing: "scheduled", area: "011", settings: { attendance: true }, programId: null };
    const courseId = (await (await educator.post("/api/courses", { data: body })).json()).id, path = `/api/courses/${courseId}`;
    const courseUnitId = (await (await educator.post(`${path}/units`, { data: { name: `${E2E_PREFIX} Módulo`, objective: "Practicar.", status: "active", version: 1 } })).json()).id;
    const lessonBody = { title: `${E2E_PREFIX} Publicada ${info.project.name}`, objective: "Practicar.", courseId, courseUnitId, instructions: "Sigue las indicaciones.", duration: 15 };
    const lesson = (await (await educator.post("/api/lessons", { data: lessonBody })).json()).lesson;
    expect((await educator.post(`/api/lessons/${lesson.id}/publish`)).status()).toBe(200);
    const groupName = `${E2E_PREFIX} Grupo vigente ${info.project.name}`;
    const groupId = (await (await educator.post(`${path}/groups`, { data: { name: groupName } })).json()).id;
    const today = (await (await educator.get(`${path}/assignments`)).json()).today as string;
    const created = await educator.post(`${path}/assignments`, { data: { groupId, lessonId: lesson.id, startsOn: today } });
    expect(created.status(), await created.text()).toBe(201);
    const id = (await created.json()).id;
    // An upcoming assignment is not current yet.
    const future = (await (await educator.post("/api/lessons", { data: { ...lessonBody, title: `${E2E_PREFIX} Futura ${info.project.name}` } })).json()).lesson;
    expect((await educator.post(`/api/lessons/${future.id}/publish`)).status()).toBe(200);
    expect((await educator.post(`${path}/assignments`, { data: { groupId, lessonId: future.id, startsOn: "2099-01-01" } })).status()).toBe(201);
    const current = async () => ((await (await educator.get("/api/assignments")).json()).assignments as Current[]).filter(item => item.id === id || item.lessonId === future.id);
    let [item] = await current();
    expect((await current()).map(entry => entry.lessonId)).toEqual([lesson.id]);
    expect(item.effective).toEqual({ revision: 1, shareCode: lesson.shareCode });
    // A newer publication is resolved automatically; nobody picks revisions by hand.
    expect((await educator.post(`/api/lessons/${lesson.id}/publish`)).status()).toBe(200);
    [item] = await current();
    expect(item.effective).toEqual({ revision: 2, shareCode: lesson.shareCode });
    // Draft edits after publishing are never exposed.
    const draft = (await (await educator.get(`/api/lessons/${lesson.id}?draft=1`)).json()).lesson;
    expect((await educator.put(`/api/lessons/${lesson.id}`, { data: { ...lessonBody, title: `${E2E_PREFIX} Borrador sin publicar`, draftVersion: draft.draftVersion } })).status()).toBe(200);
    [item] = await current();
    expect(item.lessonTitle).toBe(lessonBody.title);
    expect(item.effective?.revision).toBe(2);
    const shared = (await (await page.request.get(`/api/share/${lesson.shareCode}`)).json()).lesson;
    expect(shared.title).toBe(lessonBody.title);

    // The dashboard opens the resolved publication.
    await signIn(page, "educador-demo", "/inicio");
    const section = page.getByRole("region", { name: "Tus asignaciones vigentes" });
    const row = section.getByRole("listitem").filter({ hasText: groupName });
    await expect(row.getByRole("link", { name: `Abrir «${lessonBody.title}», publicación 2` })).toHaveAttribute("href", `/aprender/${lesson.shareCode}`);
    // Archived: no valid version, a warning instead of a link.
    const latest = (await (await educator.get(`/api/lessons/${lesson.id}?draft=1`)).json()).lesson;
    expect((await educator.put(`/api/lessons/${lesson.id}`, { data: { ...lessonBody, draftVersion: latest.draftVersion, status: "archived" } })).status()).toBe(200);
    [item] = await current();
    expect(item).toMatchObject({ effective: null, availability: "unavailable" });
    await page.reload();
    const warned = page.getByRole("region", { name: "Tus asignaciones vigentes" }).getByRole("listitem").filter({ hasText: groupName });
    await expect(warned.getByText("Sin versión válida", { exact: true })).toBeVisible();
    await expect(warned.getByRole("link", { name: "Sustitúyela en Asignaciones" })).toHaveAttribute("href", `/cursos/${courseId}/asignaciones`);
    await expect(warned.getByRole("link", { name: /Abrir/ })).toHaveCount(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  } finally { await Promise.all([educator.dispose(), admin.dispose()]); }
});

test("ST-029 the demo educator sees the seeded class assignment with its current publication", async ({ page }) => {
  await signIn(page, "educador-demo", "/inicio");
  const section = page.getByRole("region", { name: "Tus asignaciones vigentes" });
  await expect(section.getByRole("listitem").filter({ hasText: "Grupo de demostración" }).getByRole("link", { name: /Abrir .*publicación \d+/ })).toBeVisible();
});
