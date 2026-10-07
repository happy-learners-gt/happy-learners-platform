import { test, expect } from "./local-test";
import { mkdir } from "node:fs/promises";
import { e2eName, openNavigation, signIn, signInWithForm, toast } from "./helpers";

test("sign-in errors, organization settings, roles, help, logout and 404", async ({ page, request }, info) => {
  const errors: string[] = []; page.on("pageerror", error => errors.push(error.message));
  const folder = `.release-evidence/screenshots/${info.project.name}`;
  await mkdir(folder, { recursive: true });
  expect((await request.get("/api/health")).status()).toBe(200);
  const version = await (await request.get("/api/version")).json();
  expect(version.sha).toMatch(/^[a-f0-9]{40}$/);
  if (process.env.EXPECTED_SHA) expect(version.sha).toBe(process.env.EXPECTED_SHA);
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Iniciar sesión" })).toBeVisible();
  await page.screenshot({ path: `${folder}/01-login.png`, fullPage: true });
  await page.getByLabel("Usuario", { exact: true }).fill("admin-demo");
  await page.getByLabel("Contraseña", { exact: true }).fill("incorrecta");
  await page.getByRole("button", { name: "Entrar", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("Usuario o contraseña incorrectos");
  await page.getByLabel("Contraseña", { exact: true }).fill("Aprender-2026!");
  await page.getByRole("button", { name: "Entrar", exact: true }).click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Inicio");
  await openNavigation(page);
  await page.getByRole("navigation", { name: "Administración" }).getByRole("link", { name: "Organización" }).click();
  await page.getByLabel("Nombre de la organización").fill("Jardín de Colores");
  // ST-120: the time zone is an IANA zone with its offset, grouped by region; not a country.
  const zone = page.getByLabel("Zona horaria");
  expect(await zone.locator("option").count()).toBeGreaterThan(300);
  await expect(zone.locator("optgroup[label='Europe'] option[value='Europe/Madrid']")).toHaveCount(1);
  await expect(zone.locator("option[value='America/Guatemala']")).toHaveText("America/Guatemala (UTC−06:00)");
  await zone.selectOption("America/Bogota");
  await expect(page.locator(".field").filter({ has: zone })).toContainText("(UTC−05:00)");
  await zone.selectOption("America/Guatemala");
  await page.getByRole("button", { name: "Guardar organización" }).click();
  await expect(toast(page)).toContainText("Organización guardada");
  await page.reload();
  await expect(page.getByLabel("Nombre de la organización")).toHaveValue("Jardín de Colores");
  // DEC-023, DEC-024: administration reads every section and its classes; only those who teach a section record its classes.
  await page.goto("/cursos/course-exploradores");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Exploradores");
  await openNavigation(page);
  await expect(page.getByRole("navigation", { name: "Navegación del curso" }).getByRole("link", { name: "Secciones", exact: true })).toBeVisible();
  await page.keyboard.press("Escape");
  expect(await page.evaluate(async () => (await fetch("/api/courses/course-exploradores/groups")).status)).toBe(200);
  expect(await page.evaluate(async () => (await fetch("/api/courses/course-exploradores/sessions", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ groupId: "none", sessionDate: "2026-10-05" }) })).status)).toBe(403);
  await page.getByRole("button", { name: /^Perfil de / }).click();
  await page.getByRole("menuitem", { name: "Cerrar sesión" }).click();
  await expect(page.getByRole("heading", { name: "Iniciar sesión" })).toBeVisible();
  await signInWithForm(page, "educador-demo", "/inicio");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Inicio");
  await openNavigation(page);
  await expect(page.getByRole("navigation", { name: "Administración" })).toHaveCount(0);
  await page.getByRole("navigation", { name: "Navegación principal" }).getByRole("link", { name: "Ayuda", exact: true }).click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Ayuda");
  await page.goto("/ruta-que-no-existe");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("No encontramos esta página");
  await page.getByRole("button", { name: /^Perfil de / }).click();
  await page.getByRole("menuitem", { name: "Cerrar sesión" }).click();
  await expect(page.getByRole("heading", { name: "Iniciar sesión" })).toBeVisible();
  expect(await page.evaluate(async () => (await fetch("/api/organization")).status)).toBe(401);
  expect((await request.get("/api/route-that-does-not-exist")).status()).toBe(404);
  expect(errors).toEqual([]);
});

test("administration configures programs and library tags; courses inherit what the program fixes", async ({ page }, info) => {
  const run = Date.now().toString(36);
  const tags = e2eName(info, `Habilidad ${run}`), program = e2eName(info, `Primaria bilingüe ${run}`);
  await signIn(page, "admin-demo", "/clasificaciones");
  // The former address leads to the new page.
  await expect(page).toHaveURL(/\/configuracion-academica$/);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Configuración académica");

  await page.getByRole("button", { name: "Crear programa", exact: true }).click();
  let dialog = page.getByRole("dialog", { name: "Crear programa" });
  await dialog.getByLabel("Nombre", { exact: true }).fill(program);
  await dialog.getByLabel("Tipo de educación").selectOption({ label: "Formal" });
  await dialog.getByLabel("Nivel educativo").selectOption({ label: "Educación primaria (CINE 1)" });
  await dialog.getByLabel("Área de conocimiento").selectOption({ label: "Idiomas" });
  await dialog.getByRole("combobox", { name: "Nombre de las partes del curso" }).selectOption({ label: "Unidades" });
  await dialog.getByRole("checkbox", { name: "Fijar para sus cursos" }).first().check();
  await dialog.getByRole("button", { name: "Guardar programa" }).click();
  await expect(toast(page)).toContainText("Programa creado");
  const row = page.locator(".program-list > li").filter({ hasText: program });
  await expect(row).toContainText("Educación primaria");
  await expect(row).toContainText("Fija: nombre de las partes del curso");

  await page.getByRole("button", { name: "Crear grupo de etiquetas", exact: true }).click();
  dialog = page.getByRole("dialog", { name: "Crear grupo de etiquetas" });
  await dialog.getByLabel("Nombre").fill(tags);
  await dialog.getByRole("button", { name: "Guardar" }).click();
  await expect(toast(page)).toContainText("Etiquetas guardadas");
  await page.getByRole("button", { name: `Acciones de ${tags}`, exact: true }).click();
  await page.getByRole("menuitem", { name: "Agregar etiqueta" }).click();
  dialog = page.getByRole("dialog", { name: "Crear etiqueta" });
  await dialog.getByLabel("Nombre").fill("Lectura");
  await dialog.getByRole("button", { name: "Guardar" }).click();
  const group = page.getByRole("group", { name: tags, exact: true });
  await group.getByRole("button", { name: "Editar etiqueta Lectura" }).click();
  dialog = page.getByRole("dialog", { name: "Editar etiqueta" });
  await dialog.getByLabel("Nombre").fill("Comprensión lectora");
  await dialog.getByRole("button", { name: "Guardar" }).click();
  await expect(group).toContainText("Comprensión lectora");
  await page.getByText("Niveles educativos · CINE 2011").click();
  await expect(page.getByRole("rowheader", { name: "Secundaria alta" })).toBeVisible();
  // Administration creates the courses.
  await page.goto("/cursos");
  await expect(page.getByRole("link", { name: "Crear curso", exact: true })).toBeVisible();
});

test("DEC-023: administration creates a course with its lead, keeps unsaved input when leaving is cancelled, and the lead prepares its content", async ({ page }, info) => {
  const title = e2eName(info, `Curso ${Date.now().toString(36)}`);
  // Educators do not create courses.
  await signIn(page, "educador-demo", "/cursos");
  await expect(page.getByRole("link", { name: "Crear curso", exact: true })).toHaveCount(0);
  await page.goto("/cursos/nuevo");
  await expect(page.getByRole("heading", { name: "Administración crea los cursos" })).toBeVisible();
  await signIn(page, "admin-demo", "/cursos");
  await page.getByRole("link", { name: "Crear curso", exact: true }).click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Crear curso");
  await page.getByLabel("Nombre del curso").fill(title);
  page.once("dialog", dialog => dialog.dismiss());
  await page.getByRole("navigation", { name: "Ubicación" }).getByRole("link", { name: "Cursos", exact: true }).click();
  await expect(page.getByLabel("Nombre del curso")).toHaveValue(title);
  await page.getByLabel("Objetivo").fill("Componer una fotografía con luz natural.");
  // A template fills the configuration; the behaviour shows each value and where it comes from.
  await page.getByRole("radio", { name: /Taller/ }).check();
  await expect(page.getByLabel("Formato")).toHaveValue("workshop");
  await page.getByLabel("Área de conocimiento").selectOption({ label: "Artes" });
  const sequence = page.locator(".setting-item").filter({ hasText: "Secuencia didáctica de las lecciones nuevas" });
  await expect(sequence.getByRole("combobox")).toContainText("Automático: Demostración · Práctica guiada · Práctica independiente");
  await expect(sequence).toContainText("Según el tipo de curso");
  const names = page.locator(".setting-item").filter({ hasText: "Nombre de las partes del curso" });
  await names.getByRole("combobox").selectOption({ label: "Sesiones" });
  await expect(names).toContainText("Definido en el curso");
  await page.getByLabel("Responsable del curso").selectOption("user-educator");
  await page.getByRole("button", { name: "Crear curso", exact: true }).click();
  await expect(page).toHaveURL(/\/cursos\/course-[^/]+$/);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(title);
  const courseId = new URL(page.url()).pathname.split("/")[2];
  // In-person workshops get sections and attendance: administration starts by creating them.
  await expect(page.getByRole("link", { name: "Crear secciones", exact: true })).toBeVisible();
  await openNavigation(page);
  await expect(page.getByRole("navigation", { name: "Navegación del curso" }).getByRole("link", { name: "Secciones", exact: true })).toBeVisible();
  await page.keyboard.press("Escape");
  // Duplicate and archive from the course list menu.
  await page.goto("/cursos");
  await page.getByRole("button", { name: `Acciones del curso ${title}`, exact: true }).click();
  await page.getByRole("menuitem", { name: "Duplicar" }).click();
  await page.getByRole("dialog", { name: `¿Duplicar «${title}»?` }).getByRole("button", { name: "Duplicar curso" }).click();
  await expect(toast(page)).toContainText(`Copia creada: «${title} (copia)»`, { timeout: 20_000 });
  await page.getByRole("button", { name: `Acciones del curso ${title} (copia)`, exact: true }).click();
  await page.getByRole("menuitem", { name: "Archivar" }).click();
  await page.getByRole("dialog", { name: `¿Archivar «${title} (copia)»?` }).getByRole("button", { name: "Archivar curso" }).click();
  await expect(toast(page)).toContainText("se archivó");
  await page.getByLabel("Archivados").check();
  await expect(page.locator("article.course-card").filter({ hasText: `${title} (copia)` })).toBeVisible();
  // The lead finds the course among their own and starts its content.
  await signIn(page, "educador-demo", "/cursos");
  await expect(page.locator("article.course-card").filter({ hasText: title }).first()).toBeVisible();
  await page.goto(`/cursos/${courseId}/contenido`);
  await expect(page.getByRole("form", { name: "Nueva sesión" })).toBeVisible();
});
