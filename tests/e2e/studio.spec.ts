import { test, expect } from "./local-test";
import { mp4Header, officePackage, pdfDocument } from "./office-fixture";
import { activity, addActivity, createLesson, e2eName, saveStatus, signIn, toast, publish } from "./helpers";

test("two open editors exchange rich text live and autosave the shared draft", async ({ page, context }, info) => {
  const url = "/cursos/course-exploradores/lecciones/greetings-and-introductions";
  await signIn(page, "educador-demo", url);
  await expect(page.getByLabel("Título de la lección")).toHaveValue("Greetings and Introductions");
  const other = await context.newPage();
  await other.goto(url);
  await expect(page.locator(".presence")).toContainText("También editando");
  const first = activity(page, "Say hello").locator(".richtext-content"), second = activity(other, "Say hello").locator(".richtext-content");
  await expect(first).not.toBeEmpty();
  const greeting = `We greet a classmate politely (${info.project.name}).`, reply = `Then we introduce ourselves (${info.project.name}).`;
  await first.fill(greeting);
  await expect(second).toContainText(greeting);
  await second.press("End"); await second.press("Enter");
  await second.pressSequentially(reply);
  await expect(first).toContainText(reply);
  // Both editors saved; a version conflict is rebased automatically.
  await expect(saveStatus(page)).toContainText("Borrador guardado", { timeout: 15_000 });
  await expect(saveStatus(other)).toContainText("Borrador guardado", { timeout: 15_000 });
  await other.close();
  await page.reload();
  await expect(activity(page, "Say hello").locator(".richtext-content")).toContainText(reply);
});

test("HL-97 ST-113: title, objective, order and activities merge live between open editors", async ({ page, context }, info) => {
  const title = e2eName(info, "Estructura en vivo");
  await signIn(page, "educador-demo", "/cursos/course-exploradores/contenido");
  await createLesson(page, "Greetings", title, "Saludar con cortesía.");
  await activity(page, "Instrucciones").locator(".richtext-content").first().fill("Nos saludamos.");
  for (const name of ["Uno", "Dos"]) {
    const card = await addActivity(page, "Contenido", "Desarrollo");
    await card.getByLabel(/^Título de la actividad/).fill(name);
    await card.locator(".richtext-content").first().fill(`Actividad ${name}.`);
  }
  await expect(saveStatus(page)).toContainText("Borrador guardado", { timeout: 15_000 });
  const other = await context.newPage();
  await other.goto(page.url());
  await expect(page.locator(".presence")).toContainText("También editando");
  await expect(activity(other, "Dos")).toBeVisible();

  // Each person changes a different part at the same time; both see both changes without reloading.
  await page.getByLabel("Título de la lección").fill(`${title} editada`);
  await other.getByLabel("Objetivo").fill("Saludar y presentarse con cortesía.");
  await expect(other.getByLabel("Título de la lección")).toHaveValue(`${title} editada`);
  await expect(page.getByLabel("Objetivo")).toHaveValue("Saludar y presentarse con cortesía.");
  const two = activity(other, "Dos");
  await two.getByLabel(/^Título de la actividad/).fill("Dos en parejas");
  await two.getByLabel(/^Organización de la actividad/).selectOption({ label: "En parejas" });
  await expect(activity(page, "Dos en parejas").getByLabel(/^Organización de la actividad/)).toHaveValue("pairs");

  // A new order and a new activity reach the other editor, with the text of the new activity.
  const handle = page.getByRole("navigation", { name: "Estructura de la lección" }).getByRole("button", { name: /^Reordenar actividad \d: Dos en parejas$/ });
  await handle.focus();
  await page.keyboard.press("ArrowUp");
  await expect(activity(other, "Dos en parejas").locator(".card-kind")).toHaveText("Desarrollo · Actividad 2 de 3");
  const closing = await addActivity(other, "Contenido", "Cierre");
  await closing.getByLabel(/^Título de la actividad/).fill("Despedida");
  await closing.locator(".richtext-content").first().fill("Nos despedimos.");
  await expect(activity(page, "Despedida").locator(".richtext-content")).toContainText("Nos despedimos.");

  await expect(saveStatus(page)).toContainText("Borrador guardado", { timeout: 15_000 });
  await expect(saveStatus(other)).toContainText("Borrador guardado", { timeout: 15_000 });
  await other.close();
  await page.reload();
  await expect(page.getByLabel("Título de la lección")).toHaveValue(`${title} editada`);
  await expect(page.getByLabel("Objetivo")).toHaveValue("Saludar y presentarse con cortesía.");
  await expect(activity(page, "Dos en parejas").locator(".card-kind")).toHaveText("Desarrollo · Actividad 2 de 4");
  await expect(activity(page, "Uno").locator(".card-kind")).toHaveText("Desarrollo · Actividad 3 de 4");
  await expect(activity(page, "Despedida").locator(".richtext-content")).toContainText("Nos despedimos.");
});

test("a legacy lesson without activity IDs opens with its text and saves", async ({ page }) => {
  await signIn(page, "educador-demo", "/cursos/course-exploradores/contenido");
  await page.getByRole("link", { name: "Un mundo de colores", exact: true }).click();
  const content = activity(page, "Miramos a nuestro alrededor").locator(".richtext-content");
  // Every legacy activity shows its stored text, not only the first one.
  await expect(activity(page, "Compartimos lo que descubrimos").locator(".richtext-content")).toContainText("Invita a mostrar");
  await expect(content).toContainText("Muestra tres objetos");
  // Opening alone must not create a draft change.
  const badge = page.locator(".editor-header .badge");
  const before = await badge.textContent();
  await page.waitForTimeout(1500);
  await expect(saveStatus(page)).toContainText("Borrador guardado");
  await expect(badge).toHaveText(before!);
  await content.press("End");
  await content.pressSequentially(" Repite cada color.");
  await expect(saveStatus(page)).toContainText("Borrador guardado", { timeout: 15_000 });
  await page.reload();
  await expect(activity(page, "Miramos a nuestro alrededor").locator(".richtext-content")).toContainText("Muestra tres objetos");
  await expect(activity(page, "Miramos a nuestro alrededor").locator(".richtext-content")).toContainText("Repite cada color.");
});

test("private Office documents preview in the course library and reach students only through a published lesson", async ({ page, context }, info) => {
  await signIn(page, "educador-demo", "/cursos/course-exploradores/biblioteca");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Recursos");
  const formats = [
    { ext: "docx" as const, marker: "Documento de demostración validado" },
    { ext: "pptx" as const, marker: "Presentación de demostración" },
    { ext: "xlsx" as const, marker: "Hoja de demostración" },
  ];
  for (const { ext, marker } of formats) {
    const title = e2eName(info, `Documento ${ext}`), filename = `${title}.${ext}`;
    await page.getByRole("button", { name: "Agregar recurso", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "Agregar recurso" });
    await dialog.getByRole("radio", { name: "Archivo" }).check();
    await dialog.getByRole("button", { name: "Continuar" }).click();
    await dialog.getByLabel("Archivo").setInputFiles({ name: filename, mimeType: "application/octet-stream", buffer: officePackage(ext) });
    await dialog.getByRole("button", { name: "Subir documento" }).click();
    await expect(toast(page)).toContainText(`«${filename}» se agregó`);
    await page.getByRole("button", { name: `Vista previa de ${title}` }).click();
    const preview = page.getByRole("dialog", { name: title });
    await expect(preview.locator(".viewer-stage")).toContainText(marker, { timeout: 20_000 });
    await preview.getByRole("button", { name: "Cerrar", exact: true }).first().click();
  }
  const lessonTitle = e2eName(info, "Lectura compartida");
  await page.goto("/cursos/course-exploradores/contenido");
  await createLesson(page, "Greetings", lessonTitle, "Consultar el documento durante la clase.");
  await activity(page, "Instrucciones").locator(".richtext-content").fill("Lee el documento y comparte una idea.");
  const linked = await addActivity(page, "Recurso");
  await linked.locator(".richtext-content").fill("Abre el documento de apoyo.");
  await linked.getByLabel(/^Recurso de la actividad/).selectOption({ label: e2eName(info, "Documento docx") });
  await linked.getByRole("button", { name: /Ver el archivo aquí/ }).click();
  await expect(linked.locator(".viewer-stage")).toContainText("Documento de demostración validado", { timeout: 20_000 });
  await expect(saveStatus(page)).toContainText("Borrador guardado", { timeout: 15_000 });
  await publish(page);
  await expect(toast(page)).toContainText("Lección publicada");
  const code = (await page.locator(".share-row strong").textContent())!.trim();
  const student = await context.newPage();
  await student.goto(`/aprender/${code}`);
  await student.getByRole("button", { name: "Empezar" }).click();
  await student.getByRole("button", { name: "Siguiente" }).click();
  await expect(student.locator(".viewer-stage")).toContainText("Documento de demostración validado", { timeout: 20_000 });
  await student.close();
  await context.clearCookies();
  expect([401, 403]).toContain((await page.request.get("/api/courses/course-exploradores/files")).status());
});

test("an expired session asks to sign in again and keeps the unsaved edit", async ({ page, context }, info) => {
  const title = e2eName(info, "Sesión");
  await signIn(page, "educador-demo", "/cursos/course-exploradores/contenido");
  await createLesson(page, "Greetings", title, "Comprobar la renovación de sesión.");
  await context.clearCookies();
  await activity(page, "Instrucciones").locator(".richtext-content").fill("Texto escrito después de que expiró la sesión.");
  const dialog = page.getByRole("dialog", { name: "Tu sesión terminó" });
  await expect(dialog).toBeVisible({ timeout: 15_000 });
  // Depending on timing the edit was refused by the API or is waiting for the live connection; either way it is not saved yet.
  await expect(saveStatus(page)).toContainText(/No se guardó|Conectando para guardar/);
  await dialog.getByLabel("Contraseña").fill("Aprender-2026!");
  await dialog.getByRole("button", { name: "Continuar" }).click();
  // Signing in again verifies the password and reloads the session with its preferences; on a slow runner that takes longer than 5 s.
  await expect(toast(page)).toContainText("Sesión renovada", { timeout: 15_000 });
  await expect(saveStatus(page)).toContainText("Borrador guardado", { timeout: 15_000 });
  await page.reload();
  await expect(activity(page, "Instrucciones").locator(".richtext-content")).toContainText("Texto escrito después de que expiró la sesión.");
});

test("archiving asks for confirmation and can be undone", async ({ page }, info) => {
  // QA-03: unique per run; the restored lesson stays, so a repeated run against the same server would find two.
  const title = e2eName(info, `Archivo ${Date.now().toString(36)}`);
  await signIn(page, "educador-demo", "/cursos/course-exploradores/contenido");
  await createLesson(page, "Greetings", title, "Probar el archivo de lecciones.");
  await page.getByRole("navigation", { name: "Ubicación" }).getByRole("link", { name: "Contenido", exact: true }).click();
  await page.getByRole("button", { name: `Acciones de la lección ${title}`, exact: true }).click();
  await page.getByRole("menuitem", { name: "Archivar lección" }).click();
  const dialog = page.getByRole("dialog", { name: `¿Archivar «${title}»?` });
  await dialog.getByRole("button", { name: "Cancelar" }).click();
  await expect(page.getByRole("link", { name: title, exact: true })).toBeVisible();
  await page.getByRole("button", { name: `Acciones de la lección ${title}`, exact: true }).click();
  await page.getByRole("menuitem", { name: "Archivar lección" }).click();
  await page.getByRole("dialog", { name: `¿Archivar «${title}»?` }).getByRole("button", { name: "Archivar lección" }).click();
  await expect(toast(page)).toContainText(`«${title}» se archivó`);
  await expect(page.getByRole("link", { name: title, exact: true })).toHaveCount(0);
  await page.getByLabel(/Mostrar archivados/).check();
  await page.getByRole("button", { name: `Acciones de la lección ${title}`, exact: true }).click();
  await page.getByRole("menuitem", { name: "Restaurar lección" }).click();
  await expect(toast(page)).toContainText("se restauró");
  await page.getByLabel(/Mostrar archivados/).click();
  await expect(page.getByLabel(/Mostrar archivados/)).toHaveCount(0);
  await expect(page.getByRole("link", { name: title, exact: true })).toBeVisible();
});

test("PDF and video upload, open in a full-size viewer, page through and go full screen; forged files are rejected", async ({ page }, info) => {
  await signIn(page, "educador-demo", "/cursos/course-exploradores/biblioteca");
  async function upload(filename: string, buffer: Buffer) {
    await page.getByRole("button", { name: "Agregar recurso", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "Agregar recurso" });
    await dialog.getByRole("radio", { name: "Archivo" }).check();
    await dialog.getByRole("button", { name: "Continuar" }).click();
    await dialog.getByLabel("Archivo").setInputFiles({ name: filename, mimeType: "application/octet-stream", buffer });
    await dialog.getByRole("button", { name: "Subir documento" }).click();
    return dialog;
  }
  const pdf = e2eName(info, "Guía PDF");
  await upload(`${pdf}.pdf`, pdfDocument());
  await expect(toast(page)).toContainText(`«${pdf}.pdf» se agregó`);
  await page.getByRole("button", { name: `Vista previa de ${pdf}` }).click();
  const viewer = page.getByRole("dialog", { name: pdf }).locator(".file-viewer");
  await expect(viewer.getByRole("img", { name: new RegExp(`Página 1 de 2 de ${pdf}`) })).toBeVisible({ timeout: 20_000 });
  // The viewer uses the whole dialog, not a thumbnail.
  const box = await viewer.boundingBox();
  expect(box!.height).toBeGreaterThan((page.viewportSize()!.height) * 0.6);
  await viewer.getByRole("button", { name: "Página siguiente" }).click();
  await expect(viewer.getByRole("img", { name: new RegExp("Página 2 de 2") })).toBeVisible();
  await viewer.getByRole("button", { name: "Pantalla completa" }).click();
  await expect(viewer).toHaveClass(/is-fullscreen/);
  await viewer.getByRole("button", { name: "Salir" }).click();
  await expect(viewer).not.toHaveClass(/is-fullscreen/);
  await page.getByRole("dialog", { name: pdf }).getByRole("button", { name: "Cerrar", exact: true }).first().click();

  const video = e2eName(info, "Video");
  await upload(`${video}.mp4`, mp4Header());
  await expect(toast(page)).toContainText(`«${video}.mp4» se agregó`);
  await page.getByRole("button", { name: `Vista previa de ${video}` }).click();
  await expect(page.getByRole("dialog", { name: video }).locator("video.viewer-video")).toHaveAttribute("src", /^blob:/, { timeout: 20_000 });
  await page.getByRole("dialog", { name: video }).getByRole("button", { name: "Cerrar", exact: true }).first().click();

  const forged = await upload(`${e2eName(info, "Falso")}.pdf`, Buffer.from("esto no es un PDF"));
  await expect(forged.getByRole("alert")).toContainText("El archivo no es un PDF válido");
  await forged.getByRole("button", { name: "Cancelar" }).click();
  await expect(page.getByRole("button", { name: `Vista previa de ${e2eName(info, "Falso")}` })).toHaveCount(0);
});
