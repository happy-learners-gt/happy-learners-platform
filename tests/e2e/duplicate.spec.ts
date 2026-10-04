import { test, expect } from "./local-test";
import { E2E_PREFIX, sessionToken, signIn, toast } from "./helpers";

test("ST-016 duplicating a lesson creates an independent draft that keeps its reusable resources", async ({ page, playwright, baseURL }, info) => {
  const educator = await playwright.request.newContext({ baseURL, extraHTTPHeaders: { Origin: baseURL!, Cookie: `hl_session=${await sessionToken("educador-demo")}` } });
  const admin = await playwright.request.newContext({ baseURL, extraHTTPHeaders: { Origin: baseURL!, Cookie: `hl_session=${await sessionToken("admin-demo")}` } });
  try {
    const body = { title: `${E2E_PREFIX} Copias ${info.project.name}`, objective: "Adaptar lecciones sin tocar el original.", status: "active", educationType: "non-formal", level: "unspecified", format: "workshop", modality: "in-person", pacing: "scheduled", area: "011", settings: {}, programId: null };
    const courseId = (await (await educator.post("/api/courses", { data: body })).json()).id, path = `/api/courses/${courseId}`;
    const courseUnitId = (await (await educator.post(`${path}/units`, { data: { name: `${E2E_PREFIX} Módulo`, objective: "Practicar.", status: "active", version: 1 } })).json()).id;
    const material = (await (await educator.post(`${path}/materials`, { data: { title: `${E2E_PREFIX} Ficha`, description: "Ficha reutilizable.", content: "Lee y responde.", kind: "text", status: "published", termIds: [] } })).json()).material.id;
    const activity = { id: "activity-sheet", type: "resource", position: 0, title: "Lee la ficha", instructions: "Lee la ficha.", minutes: 5, resourceId: material };
    const created = await educator.post("/api/lessons", { data: { title: `${E2E_PREFIX} Original`, objective: "Practicar.", courseId, courseUnitId, instructions: "", duration: 15, activities: [activity] } });
    expect(created.status(), await created.text()).toBe(201);
    const original = (await created.json()).lesson;
    const later = (await (await educator.post("/api/lessons", { data: { title: `${E2E_PREFIX} Siguiente`, objective: "Practicar.", courseId, courseUnitId, instructions: "Sigue.", duration: 15 } })).json()).lesson;
    expect((await educator.post(`/api/lessons/${original.id}/publish`)).status()).toBe(200);
    expect((await admin.post(`/api/lessons/${original.id}/duplicate`)).status()).toBe(403);

    const duplicated = await educator.post(`/api/lessons/${original.id}/duplicate`);
    expect(duplicated.status(), await duplicated.text()).toBe(201);
    const copy = (await duplicated.json()).lesson;
    // New identity, Draft status, no publication.
    expect(copy.id).not.toBe(original.id);
    expect(copy.shareCode).not.toBe(original.shareCode);
    expect(copy).toMatchObject({ title: `${E2E_PREFIX} Original (copia)`, status: "draft", revision: 0, courseUnitId });
    expect((await page.request.get(`/api/share/${copy.shareCode}`)).status()).toBe(404);
    // Keeps the reference to the reusable resource.
    expect(copy.activities[0]).toMatchObject({ type: "resource", resourceId: material });
    // Placed right after the original in the module.
    const order = ((await (await educator.get(`/api/lessons?drafts=1&course=${courseId}`)).json()).lessons as { id: string }[]).map(item => item.id);
    expect(order).toEqual([original.id, copy.id, later.id]);
    // Publication cycles are independent.
    expect((await educator.post(`/api/lessons/${copy.id}/publish`)).status()).toBe(200);
    const originalNow = (await (await educator.get(`/api/lessons/${original.id}?draft=1`)).json()).lesson;
    expect(originalNow.revision).toBe(1);
    expect((await educator.post(`/api/lessons/${original.id}/publish`)).status()).toBe(200);
    expect((await (await educator.get(`/api/lessons/${copy.id}?draft=1`)).json()).lesson.revision).toBe(1);

    // From the content outline.
    await signIn(page, "educador-demo", `/cursos/${courseId}/contenido`);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Contenido");
    await page.getByRole("button", { name: `Acciones de la lección ${E2E_PREFIX} Siguiente` }).click();
    await page.getByRole("menuitem", { name: "Duplicar" }).click();
    await expect(toast(page)).toContainText(`Copia creada como borrador: «${E2E_PREFIX} Siguiente (copia)»`);
    await expect(page.getByText(`${E2E_PREFIX} Siguiente (copia)`, { exact: true })).toBeVisible();
    await toast(page).getByRole("button", { name: "Abrir" }).click();
    await expect(page).toHaveURL(/\/lecciones\/lesson-/);
    await expect(page.getByLabel("Título de la lección")).toHaveValue(`${E2E_PREFIX} Siguiente (copia)`);
  } finally { await Promise.all([educator.dispose(), admin.dispose()]); }
});
