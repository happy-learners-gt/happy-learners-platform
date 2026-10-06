import { test, expect } from "./local-test";
import { E2E_PREFIX, sessionToken, signIn, toast } from "./helpers";

type Path = { courses: { id: string; title: string }[]; requirements: { courseId: string; requiredId: string }[]; stages: string[][] };

test("HL-146 ST-112: a program's courses require other courses of the program, without cycles, and each course shows its place in the path", async ({ page, playwright, baseURL }, info) => {
  const educator = await playwright.request.newContext({ baseURL, extraHTTPHeaders: { Origin: baseURL!, Cookie: `hl_session=${await sessionToken("educador-demo")}` } });
  const admin = await playwright.request.newContext({ baseURL, extraHTTPHeaders: { Origin: baseURL!, Cookie: `hl_session=${await sessionToken("admin-demo")}` } });
  try {
    const run = Date.now().toString(36);
    const program = { name: `${E2E_PREFIX} Ruta ${run} ${info.project.name}`, description: "", educationType: "non-formal", level: "unspecified", format: "open-course", modality: "in-person", pacing: "scheduled", settings: {}, locked: [], status: "active" };
    const programId = (await (await admin.post("/api/programs", { data: program })).json()).id;
    const course = (title: string, programId: string | null) => ({ title: `${E2E_PREFIX} ${title} ${run}`, objective: "Avanzar en la ruta.", status: "active", educationType: "non-formal", level: "unspecified", format: "open-course", modality: "in-person", pacing: "scheduled", settings: {}, programId });
    const ids: string[] = [];
    for (const title of ["Fundamentos", "Intermedio", "Avanzado"]) ids.push((await (await admin.post("/api/courses", { data: { ...course(title, programId), leadId: "user-educator" } })).json()).id);
    const outside = (await (await admin.post("/api/courses", { data: { ...course("Independiente", null), leadId: "user-educator" } })).json()).id;
    const [basic, middle, advanced] = ids, url = `/api/programs/${programId}/prerequisites`;

    expect((await educator.put(url, { data: { courseId: middle, requiredIds: [basic] } })).status()).toBe(403);
    expect((await admin.put(url, { data: { courseId: middle, requiredIds: [middle] } })).status()).toBe(400);
    expect((await admin.put(url, { data: { courseId: middle, requiredIds: [outside] } })).status()).toBe(400);
    expect((await admin.put(url, { data: { courseId: middle, requiredIds: [basic] } })).status()).toBe(200);
    const saved = await admin.put(url, { data: { courseId: advanced, requiredIds: [middle] } });
    expect(saved.status()).toBe(200);
    expect(((await saved.json()) as Path).stages).toEqual([[basic], [middle], [advanced]]);
    // A course cannot require one that already depends on it.
    expect((await admin.put(url, { data: { courseId: basic, requiredIds: [advanced] } })).status()).toBe(409);
    expect(((await (await educator.get(url)).json()) as Path).requirements).toHaveLength(2);

    const detail = async (id: string) => (await (await educator.get(`/api/courses/${id}`)).json()).requirements;
    expect((await detail(middle)).requires.map((item: { id: string }) => item.id)).toEqual([basic]);
    expect((await detail(middle)).unlocks.map((item: { id: string }) => item.id)).toEqual([advanced]);

    // In the browser: administration edits the path from the program and each course summary shows its place.
    await signIn(page, "admin-demo", `/configuracion-academica?ruta=${programId}`);
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByRole("heading", { name: "Etapa 3" })).toBeVisible();
    await dialog.getByRole("button", { name: `Editar requisitos de ${course("Avanzado", null).title}` }).click();
    await expect(dialog.getByRole("checkbox", { name: `${course("Fundamentos", null).title}` })).toBeEnabled();
    await dialog.getByRole("checkbox", { name: `${course("Fundamentos", null).title}` }).check();
    await dialog.getByRole("button", { name: "Guardar requisitos" }).click();
    await expect(toast(page)).toContainText("Requisitos de");
    await expect(dialog.locator(".program-course").filter({ hasText: course("Avanzado", null).title })).toContainText(`Requiere ${course("Fundamentos", null).title}, ${course("Intermedio", null).title}`);
    await dialog.getByRole("button", { name: `Editar requisitos de ${course("Fundamentos", null).title}` }).click();
    await expect(dialog.getByRole("checkbox", { name: `${course("Avanzado", null).title} (ya requiere este curso)` })).toBeDisabled();
    await dialog.getByRole("button", { name: "Cancelar" }).click();
    await dialog.getByRole("button", { name: "Listo" }).click();
    await expect(dialog).toHaveCount(0);
    await page.goto(`/cursos/${middle}`);
    const card = page.locator("section").filter({ has: page.getByRole("heading", { name: "Ruta en el programa" }) });
    await expect(card).toContainText("Requiere");
    await expect(card.getByRole("link", { name: course("Fundamentos", null).title })).toBeVisible();
    await expect(card.getByRole("link", { name: course("Avanzado", null).title })).toBeVisible();
    expect(await page.evaluate(() => Math.max(document.documentElement.scrollWidth, innerWidth) <= screen.width)).toBe(true);

    // A course that leaves the program leaves its requirements there.
    const version = (await (await admin.get(`/api/courses/${middle}`)).json()).course.version;
    expect((await admin.put(`/api/courses/${middle}`, { data: { ...course("Intermedio", null), version } })).status()).toBe(200);
    expect(((await (await admin.get(url)).json()) as Path).requirements.map(item => [item.courseId, item.requiredId])).toEqual([[advanced, basic]]);
    expect(await detail(middle)).toEqual({ requires: [], unlocks: [] });
  } finally { await educator.dispose(); await admin.dispose(); }
});
