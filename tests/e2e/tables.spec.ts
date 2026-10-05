import { test, expect } from "./local-test";
import { E2E_PREFIX, activity, publish, saveStatus, sessionToken, signIn } from "./helpers";

test("ST-069 insert a table, edit rows and columns with the keyboard, and keep it when saving and publishing", async ({ page, playwright, baseURL }, info) => {
  const educator = await playwright.request.newContext({ baseURL, extraHTTPHeaders: { Origin: baseURL!, Cookie: `hl_session=${await sessionToken("educador-demo")}` } });
  // DEC-023: administration creates the course with educador-demo as its lead, who prepares the content.
  const admin = await playwright.request.newContext({ baseURL, extraHTTPHeaders: { Origin: baseURL!, Cookie: `hl_session=${await sessionToken("admin-demo")}` } });
  try {
    const body = { title: `${E2E_PREFIX} Tablas ${info.project.name}`, objective: "Organizar vocabulario.", status: "active", educationType: "non-formal", level: "unspecified", format: "workshop", modality: "in-person", pacing: "scheduled", area: "011", settings: {}, programId: null };
    const courseId = (await (await admin.post("/api/courses", { data: { ...body, leadId: "user-educator" } })).json()).id;
    const courseUnitId = (await (await educator.post(`/api/courses/${courseId}/units`, { data: { name: `${E2E_PREFIX} Vocabulario`, objective: "Practicar.", status: "active", version: 1 } })).json()).id;
    const lesson = (await (await educator.post("/api/lessons", { data: { title: `${E2E_PREFIX} Colores`, objective: "Nombrar colores.", courseId, courseUnitId, instructions: "Completa la tabla.", duration: 15 } })).json()).lesson;

    await signIn(page, "educador-demo", `/cursos/${courseId}/lecciones/${lesson.id}`);
    await expect(page.getByLabel("Título de la lección")).toHaveValue(`${E2E_PREFIX} Colores`);
    const editor = activity(page, "Instrucciones").locator(".richtext-content");
    await editor.click();
    await editor.press("Control+End");
    await expect(page.getByRole("button", { name: "Agregar fila", exact: true })).toBeDisabled();
    await page.getByRole("button", { name: "Insertar tabla", exact: true }).click();
    const table = editor.locator("table");
    await expect(table.locator("tr")).toHaveCount(3);
    await expect(table.locator("th")).toHaveCount(3);
    // The cursor starts in the first header cell; Tab moves to the next cell.
    await page.keyboard.type("Inglés");
    await page.keyboard.press("Tab");
    await page.keyboard.type("Español");
    await page.keyboard.press("Tab");
    await page.keyboard.type("Uso");
    await page.keyboard.press("Tab");
    await page.keyboard.type("red");
    await page.keyboard.press("Tab");
    await page.keyboard.type("rojo");
    await expect(table.locator("th")).toHaveText(["Inglés", "Español", "Uso"]);
    // Rows and columns are added after the current cell and removed where the cursor is.
    await page.getByRole("button", { name: "Agregar fila", exact: true }).click();
    await expect(table.locator("tr")).toHaveCount(4);
    await page.getByRole("button", { name: "Agregar columna", exact: true }).click();
    await expect(table.locator("th")).toHaveCount(4);
    await expect(table.locator("th").nth(2)).toHaveText("");
    await table.locator("th").nth(2).click();
    await page.getByRole("button", { name: "Quitar columna", exact: true }).click();
    await expect(table.locator("th")).toHaveText(["Inglés", "Español", "Uso"]);
    await table.locator("tr").nth(2).locator("td").first().click();
    await page.getByRole("button", { name: "Quitar fila", exact: true }).click();
    await expect(table.locator("tr")).toHaveCount(3);
    await expect(table).toContainText("rojo");
    await expect(saveStatus(page)).toContainText("Borrador guardado", { timeout: 10_000 });
    // Kept when the draft is reloaded.
    await page.reload();
    const saved = activity(page, "Instrucciones").locator(".richtext-content table");
    await expect(saved.locator("th")).toHaveText(["Inglés", "Español", "Uso"]);
    await expect(saved).toContainText("rojo");
    // Kept when publishing; students read it as a table with column headers.
    await publish(page);
    await expect(page.locator(".editor-header .badge")).toHaveText("Publicada");
    const shareCode = (await (await educator.get(`/api/lessons/${lesson.id}?draft=1`)).json()).lesson.shareCode;
    await page.goto(`/aprender/${shareCode}`);
    await page.getByRole("button", { name: "Empezar" }).click();
    await expect(page.getByRole("table")).toBeVisible();
    await expect(page.getByRole("columnheader", { name: "Inglés" })).toBeVisible();
    await expect(page.getByRole("cell", { name: "rojo" })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  } finally { await educator.dispose(); await admin.dispose(); }
});
