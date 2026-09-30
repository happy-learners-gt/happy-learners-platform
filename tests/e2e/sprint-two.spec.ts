import { test, expect } from "./local-test";
import { officePackage } from "./office-fixture";

test("SPR-002: a rich lesson draft publishes safely and renders as a student", async ({ page, context }) => {
  await page.goto("/cursos/course-exploradores");
  await page.getByLabel("Usuario", { exact: true }).fill("educador-demo");
  await page.getByLabel("Contraseña", { exact: true }).fill("Aprender-2026!");
  await page.getByRole("button", { name: "Entrar a mi espacio" }).click();
  const nav = page.getByRole("navigation", { name: "Espacios del curso" });
  await nav.getByRole("link", { name: "Editar lecciones", exact: true }).click();
  await page.getByRole("button", { name: "Nueva lección", exact: true }).click();
  const suffix = Date.now();
  await page.getByLabel("Título de la lección").fill(`Clase con formato ${suffix}`);
  await page.getByLabel("Objetivo de la lección").fill("Seguir una explicación organizada y practicarla.");
  const editor = page.locator(".activity-editor").first().locator(".richtext-content");
  await editor.fill("Paso uno");
  await editor.press("Control+a");
  await page.getByRole("button", { name: "Negrita", exact: true }).click();
  await expect(editor.locator("strong")).toContainText("Paso uno");
  await page.getByRole("button", { name: "Guardar borrador", exact: true }).click();
  await expect(page.getByText("Borrador guardado. La versión pública conserva sus contenidos hasta republicar.")).toBeVisible();
  await page.reload();
  await page.getByRole("button", { name: `Editar lección Clase con formato ${suffix}`, exact: true }).click();
  await expect(page.getByLabel("Título de la lección")).toHaveValue(`Clase con formato ${suffix}`);
  await expect(page.locator(".richtext-content strong")).toContainText("Paso uno");
  await page.getByRole("button", { name: "Publicar", exact: true }).click();
  await expect(page.getByText("Lección publicada. El enlace ya muestra esta revisión.")).toBeVisible();
  const href = await page.getByRole("link", { name: "Abrir enlace público", exact: true }).getAttribute("href");
  const student = await context.newPage();
  await student.goto(href!);
  await expect(student.locator(".richtext-content")).toContainText("Paso uno");
  await expect(student.locator(".richtext-content strong")).toContainText("Paso uno");
});

test("SPR-002: two open editors exchange rich-text changes and persist the shared draft", async ({ page, context }) => {
  await page.goto("/cursos/course-exploradores/lecciones?editar=greetings-and-introductions");
  await page.getByLabel("Usuario", { exact: true }).fill("educador-demo");
  await page.getByLabel("Contraseña", { exact: true }).fill("Aprender-2026!");
  await page.getByRole("button", { name: "Entrar a mi espacio" }).click();
  await expect(page.getByLabel("Título de la lección")).toHaveValue("Greetings and Introductions");
  const collaborator = await context.newPage();
  await collaborator.goto("/cursos/course-exploradores/lecciones?editar=greetings-and-introductions");
  await expect(collaborator.getByLabel("Título de la lección")).toHaveValue("Greetings and Introductions");
  await expect(page.locator(".collaboration-status")).toContainText("Edición colaborativa en vivo");
  await expect(collaborator.locator(".collaboration-status")).toContainText("Edición colaborativa en vivo");
  const first = page.locator(".activity-editor .richtext-content").first();
  const second = collaborator.locator(".activity-editor .richtext-content").first();
  await first.fill("We greet a classmate politely.");
  await expect(second).toContainText("We greet a classmate politely.");
  await second.press("End");
  await second.press("Enter");
  await second.pressSequentially("Then we introduce ourselves.");
  await expect(first).toContainText("Then we introduce ourselves.");
  await page.getByRole("button", { name: "Guardar borrador", exact: true }).click();
  await expect(page.getByText("Borrador guardado. La versión pública conserva sus contenidos hasta republicar.")).toBeVisible();
  await page.reload();
  await expect(page.locator(".richtext-content").first()).toContainText("Then we introduce ourselves.");
  await collaborator.close();
});

test("SPR-002: private course files preview Office formats and published lessons share only linked documents", async ({ page, context }) => {
  await page.goto("/cursos/course-exploradores/materiales");
  await page.getByLabel("Usuario", { exact: true }).fill("educador-demo");
  await page.getByLabel("Contraseña", { exact: true }).fill("Aprender-2026!");
  await page.getByRole("button", { name: "Entrar a mi espacio" }).click();
  const formats = [
    { ext: "docx" as const, marker: "Documento de demostración validado" },
    { ext: "pptx" as const, marker: "Presentación de demostración" },
    { ext: "xlsx" as const, marker: "Hoja de demostración" },
  ];
  for (const { ext, marker } of formats) {
    const filename = `material-${ext}-${Date.now()}.${ext}`;
    await page.locator("#course-office-file").setInputFiles({ name: filename, mimeType: "application/octet-stream", buffer: officePackage(ext) });
    await page.getByRole("button", { name: "Subir al curso", exact: true }).click();
    await expect(page.locator(".alert.success")).toContainText("Documento agregado");
    const item = page.locator("article.editor-card").filter({ hasText: filename });
    await item.getByRole("button", { name: `Vista previa ${filename}` }).click();
    await expect(item.locator(".office-preview-content")).toContainText(marker, { timeout: 20_000 });
    await item.getByRole("button", { name: "Cerrar vista previa" }).click();
    if (ext === "docx") {
      await page.getByRole("navigation", { name: "Espacios del curso" }).getByRole("link", { name: "Preparar", exact: true }).click();
      await page.getByRole("link", { name: "+ Preparar lección aquí", exact: true }).first().click();
      await page.getByLabel("Título de la lección").fill("Lectura compartida de demostración");
      await page.getByLabel("Objetivo de la lección").fill("Consultar el documento adjunto durante la clase.");
      await page.locator(".activity-editor .richtext-content").first().fill("Lee el documento y comparte una idea.");
      await page.getByRole("button", { name: "Agregar actividad", exact: true }).click();
      const activity = page.locator(".activity-editor").nth(1);
      await activity.getByLabel("Tipo de actividad").selectOption("resource");
      await activity.getByLabel("Título de actividad").fill("Documento de lectura");
      await activity.locator(".richtext-content").fill("Abre el documento de apoyo.");
      await activity.getByLabel("Material del curso").selectOption({ label: filename.replace(/\.docx$/, "") });
      await page.getByRole("button", { name: "Guardar borrador", exact: true }).click();
      await page.getByRole("button", { name: "Publicar", exact: true }).click();
      await expect(page.getByText("Lección publicada. El enlace ya muestra esta revisión.")).toBeVisible();
      const student = await context.newPage();
      await student.goto(await page.getByRole("link", { name: "Abrir enlace público", exact: true }).getAttribute("href") || "");
      await expect(student.locator(".office-preview-content")).toContainText(marker, { timeout: 20_000 });
      await student.close();
      await page.getByRole("navigation", { name: "Espacios del curso" }).getByRole("link", { name: "Materiales", exact: true }).click();
    }
  }
  await context.clearCookies();
  const privateResponse = await page.request.get(`/api/courses/course-exploradores/files`);
  expect([401, 403]).toContain(privateResponse.status());
});
