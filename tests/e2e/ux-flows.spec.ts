import { test, expect } from "./local-test";
// @ts-expect-error — plain ESM script without type declarations
import { courses as seedCourses } from "../../scripts/seed/build.mjs";
// @ts-expect-error — plain ESM script without type declarations
import { routeCourses } from "../../scripts/seed/content-routes.mjs";
// @ts-expect-error — plain ESM script without type declarations
import { englishCourses } from "../../scripts/seed/content-english.mjs";
import { activity, addActivity, courseNav, createLesson, e2eName, E2E_PREFIX, legacyContamination, openCourse, openNavigation, saveStatus, sectionNav, sessionToken, signIn, signInWithForm, toast, publish } from "./helpers";

test("1 · login → course → content, with one navigation system and working Back", async ({ page }) => {
  const errors: string[] = []; page.on("pageerror", error => errors.push(error.message));
  await signInWithForm(page);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Inicio");
  await openNavigation(page);
  const global = page.getByRole("navigation", { name: "Navegación principal" });
  for (const label of ["Inicio", "Agenda", "Cursos", "Biblioteca", "Ayuda"]) await expect(global.getByRole("link", { name: label, exact: true })).toBeAttached();
  await openCourse(page);
  // Entering a course opens it in the same menu, with its pages beneath it; there is no second, horizontal navigation.
  await openNavigation(page);
  await expect(global.getByRole("link", { name: "Exploradores", exact: true })).toHaveAttribute("aria-current", "true");
  // The course is the definition of what is taught; classes, students and schedules live in each section.
  for (const label of ["Resumen", "Contenido", "Plan curricular", "Biblioteca del curso", "Secciones", "Configuración"]) await expect(courseNav(page).getByRole("link", { name: label, exact: true })).toBeVisible();
  for (const label of ["Clases", "Asignaciones", "Horario"]) await expect(courseNav(page).getByRole("link", { name: label, exact: true })).toHaveCount(0);
  await courseNav(page).getByRole("link", { name: "Contenido", exact: true }).click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Contenido");
  await expect(page.getByRole("heading", { level: 2, name: "Greetings", exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "Greetings and Introductions", exact: true })).toBeVisible();
  await expect(page.getByText(/Preparar|Editar lecciones|agrupaci/i)).toHaveCount(0);
  await page.goBack();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Exploradores");
  await page.goBack();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Cursos");
  await page.goForward(); await page.goForward();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Contenido");
  // v0.2.2 locations still land in the right place.
  await page.goto("/cursos/course-exploradores/lecciones?editar=greetings-and-introductions");
  await expect(page).toHaveURL(/\/cursos\/course-exploradores\/lecciones\/greetings-and-introductions$/);
  await page.goto("/cursos/course-exploradores/materiales");
  await expect(page).toHaveURL(/\/biblioteca$/);
  await page.goto("/contenido/publicadas");
  await expect(page).toHaveURL(/\/cursos$/);
  expect(errors).toEqual([]);
});

test("2 · create a module and a lesson inside it", async ({ page }, info) => {
  const unit = e2eName(info, "Módulo"), lesson = e2eName(info, "Lección");
  await signIn(page, "educador-demo", "/cursos/course-exploradores/contenido");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Contenido");
  await page.getByRole("button", { name: "Crear módulo", exact: true }).click();
  const form = page.getByRole("form", { name: "Nuevo módulo" });
  await form.getByLabel("Nombre del módulo").fill(unit);
  await form.getByLabel("Objetivo").fill("Practicar saludos en parejas.");
  await form.getByRole("button", { name: "Crear módulo" }).click();
  await expect(toast(page)).toContainText(`Módulo «${unit}» creado`);
  await expect(page.getByRole("heading", { level: 2, name: unit, exact: true })).toBeVisible();
  await createLesson(page, unit, lesson, "Saludar a un compañero por su nombre de personaje.");
  await expect(page.locator(".badge").filter({ hasText: "Borrador" }).first()).toBeVisible();
  await page.getByRole("navigation", { name: "Ubicación" }).getByRole("link", { name: "Contenido", exact: true }).click();
  const row = page.locator(".outline-lesson").filter({ hasText: lesson });
  await expect(row).toContainText("Borrador");
  // Reordering is keyboard accessible through the contextual menu and persists.
  await page.getByRole("button", { name: `Acciones del módulo ${unit}`, exact: true }).click();
  await page.getByRole("menuitem", { name: "Mover arriba" }).click();
  await expect(toast(page)).toContainText(`«${unit}» ahora es el módulo`);
  await page.reload();
  await expect(page.locator(".outline-unit").filter({ hasText: unit })).toBeVisible();
  // Inline rename of a short name.
  await page.getByRole("button", { name: `Acciones de la lección ${lesson}`, exact: true }).click();
  await page.getByRole("menuitem", { name: "Renombrar" }).click();
  const renamed = `${lesson} (v2)`;
  await page.getByLabel("Título de la lección").fill(renamed);
  await page.getByLabel("Título de la lección").press("Enter");
  await expect(page.getByRole("link", { name: renamed, exact: true })).toBeVisible();
});

test("3 · edit with autosave, then publish", async ({ page }, info) => {
  const unitTitle = "Greetings", title = e2eName(info, "Clase con formato");
  await signIn(page, "educador-demo", "/cursos/course-exploradores/contenido");
  await createLesson(page, unitTitle, title, "Seguir una explicación organizada.");
  // A fresh activity cannot be saved empty; the indicator explains why.
  await expect(saveStatus(page)).toContainText(/Borrador guardado/);
  const editor = activity(page, "Instrucciones").locator(".richtext-content");
  await editor.fill("Paso uno");
  await editor.press("Control+a");
  await page.getByRole("button", { name: "Negrita", exact: true }).click();
  await expect(saveStatus(page)).toContainText("Borrador guardado", { timeout: 10_000 });
  const question = await addActivity(page, "Pregunta");
  await expect(saveStatus(page)).toContainText("Sin guardar");
  await question.getByLabel(/^Título de la actividad/).fill("¿Cómo saludas?");
  await question.locator(".richtext-content").fill("Elige el saludo correcto.");
  await question.getByLabel("Opción 1", { exact: true }).fill("Hello!");
  await question.getByLabel("Opción 2", { exact: true }).fill("Goodbye!");
  await expect(saveStatus(page)).toContainText("Borrador guardado", { timeout: 10_000 });
  await page.reload();
  await expect(activity(page, "Instrucciones").locator(".richtext-content strong")).toContainText("Paso uno");
  await expect(activity(page, "¿Cómo saludas?")).toBeVisible();
  await publish(page);
  await expect(toast(page)).toContainText("Lección publicada");
  await expect(page.locator(".editor-header .badge")).toHaveText("Publicada");
  await expect(page.getByRole("button", { name: "Copiar enlace", exact: true }).first()).toBeVisible();
  // Editing after publishing becomes "Cambios sin publicar" until republished.
  await page.getByLabel("Título de la lección").fill(`${title} ✓`);
  await expect(saveStatus(page)).toContainText("Borrador guardado", { timeout: 10_000 });
  await expect(page.locator(".editor-header .badge")).toHaveText("Cambios sin publicar");
  await publish(page, "Publicar cambios");
  await expect(page.locator(".editor-header .badge")).toHaveText("Publicada");
});

test("4 · open a lesson as a student, one activity at a time", async ({ page, context }, info) => {
  const errors: string[] = []; page.on("pageerror", error => errors.push(error.message));
  await page.goto("/");
  await page.getByLabel("Código de sección o de lección").fill("greetings");
  await page.getByRole("button", { name: "Abrir", exact: true }).click();
  await expect(page).toHaveURL(/\/aprender\/GREETINGS$/);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Greetings and Introductions");
  await expect(page.getByText("Lo que aprenderás")).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Navegación principal" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Anterior" })).toBeDisabled();
  await page.getByRole("button", { name: "Empezar" }).click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Say hello");
  await expect(page.getByRole("progressbar", { name: "Avance de la lección" })).toHaveAttribute("aria-valuenow", "1");
  await page.getByRole("button", { name: "Siguiente" }).click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Meet Sunny");
  await expect(page.getByText("Usa un nombre imaginario.", { exact: false })).toBeVisible();
  await page.getByRole("button", { name: "Anterior" }).click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Say hello");
  await page.getByRole("button", { name: "Siguiente" }).click();
  await page.getByRole("button", { name: "Siguiente" }).click();
  await page.getByLabel("Goodbye!").check();
  await expect(page.getByRole("status").filter({ hasText: "Todavía no" })).toBeVisible();
  await page.getByLabel("Hello!").check();
  await expect(page.getByRole("status").filter({ hasText: "¡Correcto!" })).toBeVisible();
  await page.getByRole("button", { name: "Terminar lección" }).click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("¡Terminaste la lección!");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  // No personal data is requested anywhere in the student flow.
  await expect(page.locator("input[type=email], input[type=tel], input[name*=name]")).toHaveCount(0);
  const missing = await context.newPage();
  await missing.goto("/aprender/NO-EXISTE");
  await expect(missing.getByRole("heading", { level: 1 })).toHaveText("No encontramos esta lección");
  expect(errors).toEqual([]);
  void info;
});

test("5 · administration assigns a student and an educator to a section; the educator records attendance", async ({ page }, info) => {
  const group = e2eName(info, "Sección"), learner = `${E2E_PREFIX} Estudiante 01`;
  await signIn(page, "admin-demo", "/cursos/course-exploradores/grupos");
  await expect(page).toHaveURL(/\/cursos\/course-exploradores\/secciones$/);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Secciones");
  await page.getByRole("button", { name: "Nueva sección", exact: true }).click();
  const form = page.getByRole("form", { name: "Nueva sección" });
  await form.getByLabel("Nombre de la sección").fill(group);
  await form.getByRole("button", { name: "Crear sección" }).click();
  await expect(toast(page)).toContainText(`Sección «${group}» creada`);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(group);
  const section = new URL(page.url()).pathname;
  await page.getByLabel(`Educador para ${group}`).selectOption("user-educator");
  await page.getByRole("form", { name: `Asignar educador a ${group}` }).getByRole("button", { name: "Asignar" }).click();
  await expect(page.locator(".section-educators")).toContainText("@educador-demo");
  await page.goto(`${section}/estudiantes`);
  await page.getByLabel("Nombres de lista").fill(learner);
  await page.getByRole("form", { name: `Agregar estudiantes a ${group}` }).getByRole("button", { name: "Agregar estudiante", exact: true }).click();
  await expect(page.locator(".roster").getByText(learner, { exact: true })).toBeVisible();
  // The educator finds the section among their own and works in it.
  await signIn(page, "educador-demo", "/agenda");
  await page.getByRole("main").getByRole("link", { name: group, exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`${section}$`));
  await openNavigation(page);
  await sectionNav(page).getByRole("link", { name: "Cronograma", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Esta sección aún no tiene clases" })).toBeVisible();
  await page.getByRole("button", { name: "Agregar clase" }).first().click();
  const dialog = page.getByRole("dialog", { name: "Agregar clase" });
  await expect(dialog.getByLabel("Sección")).toHaveCount(0);
  await dialog.getByRole("button", { name: "Agregar clase" }).click();
  await expect(toast(page)).toContainText("Clase agregada al cronograma.");
  await page.getByRole("table", { name: /Cronograma de clases de/ }).getByRole("row").nth(1).getByRole("link").first().click();
  await expect(page).toHaveURL(new RegExp(`${section}/clases/class-`));
  const marks = page.getByRole("radiogroup", { name: learner });
  await expect(page.getByRole("button", { name: "Guardar asistencia" })).toBeDisabled();
  await marks.getByLabel("Presente").check();
  await page.getByRole("button", { name: "Guardar asistencia" }).click();
  await expect(toast(page)).toContainText("Asistencia guardada: 1 presente");
  await expect(page.locator(".sheet-header .badge")).toHaveText("Guardada");
  await page.reload();
  await expect(page.getByRole("radiogroup", { name: learner }).getByLabel("Presente")).toBeChecked();
  await page.getByRole("button", { name: "Finalizar clase" }).click();
  await expect(page.locator(".page-meta .badge")).toHaveText("Impartida");
  await openNavigation(page);
  await sectionNav(page).getByRole("link", { name: "Resumen", exact: true }).click();
  await expect(page.locator(".stat-tiles").first()).toContainText("1 de 1");
  await expect(page.locator(".stat-tiles").first()).toContainText("100 %");
});

test("6 · mobile navigation opens the course drawer, closes on selection and with Escape", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await signIn(page, "educador-demo", "/cursos/course-exploradores");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Exploradores");
  await expect(courseNav(page)).toBeHidden();
  const toggle = page.getByRole("button", { name: "Menú", exact: true });
  await expect(toggle).toHaveAttribute("aria-expanded", "false");
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-expanded", "true");
  await expect(courseNav(page)).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(courseNav(page)).toBeHidden();
  await expect(toggle).toBeFocused();
  await toggle.click();
  await courseNav(page).getByRole("link", { name: "Contenido", exact: true }).click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Contenido");
  await expect(courseNav(page)).toBeHidden();
  await toggle.click();
  await page.getByRole("navigation", { name: "Navegación principal" }).getByRole("link", { name: "Cursos", exact: true }).click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Cursos");
  for (const path of ["/inicio", "/cursos/course-exploradores/contenido", "/cursos/course-exploradores/lecciones/greetings-and-introductions", "/biblioteca"]) {
    await page.goto(path);
    await expect(page.getByRole("heading", { level: 1 })).toBeAttached();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), path).toBe(true);
  }
});

test("7 · no E2E contamination is visible: only curated data or cleanable E2E-prefixed records", async ({ playwright, baseURL }) => {
  // Administration reads every course of the organization, with its sections.
  const api = await playwright.request.newContext({ baseURL, extraHTTPHeaders: { Origin: baseURL!, Cookie: `hl_session=${await sessionToken("admin-demo")}` } });
  try {
    const names: string[] = [];
    const { courses } = await (await api.get("/api/courses")).json();
    for (const course of courses) {
      names.push(course.title);
      const detail = await (await api.get(`/api/courses/${course.id}`)).json();
      names.push(...detail.units.map((unit: { name: string }) => unit.name));
      names.push(...(await (await api.get(`/api/courses/${course.id}/materials`)).json()).materials.map((item: { title: string }) => item.title));
      if (course.status === "active") names.push(...(await (await api.get(`/api/courses/${course.id}/groups`)).json()).groups.map((group: { name: string }) => group.name));
    }
    names.push(...(await (await api.get("/api/lessons?drafts=1")).json()).lessons.map((lesson: { title: string }) => lesson.title));
    names.push(...(await (await api.get("/api/resources")).json()).resources.map((item: { title: string }) => item.title));
    // Curated names: the original demo plus everything the demo organization seeds define.
    const seeded = ([...seedCourses, ...routeCourses, ...englishCourses] as { title: string; resources: { title: string }[]; groups: { name: string }[]; modules: { name: string; lessons: { title: string }[] }[] }[])
      .flatMap(course => [course.title, ...course.resources.map(item => item.title), ...course.groups.map(item => item.name), ...course.modules.flatMap(module => [module.name, ...module.lessons.map(lesson => lesson.title)])]);
    const curated = new Set(["Exploradores", "Greetings", "Greetings and Introductions", "Un mundo de colores", "Colores en clase", "Grupo de demostración", "Colors around us", "Greetings song", "Introduce yourself", ...seeded]);
    expect(names.filter(name => legacyContamination.test(name))).toEqual([]);
    const unexpected = names.filter(name => !curated.has(name) && !name.startsWith(E2E_PREFIX));
    expect(unexpected, "records created by E2E must carry the E2E prefix").toEqual([]);
  } finally { await api.dispose(); }
});

test("8 · HL-150 ST-114: one menu in levels opens sections and courses in place; administration creates a section from it", async ({ page }, info) => {
  const group = e2eName(info, "Sección del menú");
  await signIn(page, "admin-demo", "/inicio");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Inicio");
  await openNavigation(page);
  const menu = page.getByRole("navigation", { name: "Navegación principal" });
  // Each area shows or hides its list in place; the list keeps every active section or course.
  const toggle = menu.getByRole("button", { name: "Mostrar los cursos" });
  await expect(toggle).toHaveAttribute("aria-expanded", "true");
  await expect(menu.getByRole("link", { name: "Matemáticas 3.º primaria", exact: true })).toBeVisible();
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-expanded", "false");
  await expect(menu.getByRole("link", { name: "Matemáticas 3.º primaria", exact: true })).toBeHidden();
  await toggle.click();
  // Courses open as an accordion: opening one closes the other.
  const maths = menu.getByRole("button", { name: "Mostrar las páginas de Matemáticas 3.º primaria" }), explorers = menu.getByRole("button", { name: "Mostrar las páginas de Exploradores" });
  await maths.click();
  await expect(maths).toHaveAttribute("aria-expanded", "true");
  await explorers.click();
  await expect(explorers).toHaveAttribute("aria-expanded", "true");
  await expect(maths).toHaveAttribute("aria-expanded", "false");
  // Secciones opens inside its course; its + creates a section of that course and opens it, with its pages beneath it.
  await menu.getByRole("button", { name: "Mostrar las secciones de Exploradores" }).click();
  await menu.getByRole("button", { name: "Agregar una sección a Exploradores" }).click();
  const dialog = page.getByRole("dialog", { name: "Nueva sección" });
  await expect(dialog.getByLabel("Curso")).toHaveValue("course-exploradores");
  await dialog.getByLabel("Nombre de la sección").fill(group);
  await dialog.getByRole("button", { name: "Crear sección" }).click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(group);
  await openNavigation(page);
  const current = menu.getByRole("link", { name: group, exact: true });
  await expect(current).toHaveAttribute("aria-current", "true");
  await sectionNav(page).getByRole("link", { name: "Horario", exact: true }).click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Horario");
  // The schedule editor previews the classes before saving.
  const editor = page.getByRole("form", { name: `Horario de ${group}` });
  await editor.getByLabel("Lunes").check();
  await expect(editor.getByRole("status")).toContainText(/\d+ clases?: lunes de 08:00 a 08:45/);
  await openNavigation(page);
  await expect(current).toHaveAttribute("aria-current", "true");
  await menu.getByRole("link", { name: "Exploradores", exact: true }).click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Exploradores");
  await openNavigation(page);
  await expect(courseNav(page).getByRole("link", { name: "Contenido", exact: true })).toBeVisible();
  await expect(sectionNav(page)).toHaveCount(0);
  // Choosing the course again, on its own page, folds and unfolds it every time without leaving the page.
  for (const expanded of ["false", "true", "false", "true"]) {
    await menu.getByRole("link", { name: "Exploradores", exact: true }).click();
    await expect(explorers).toHaveAttribute("aria-expanded", expanded);
  }
  await expect(page).toHaveURL(/\/cursos\/course-exploradores$/);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Exploradores");
});
