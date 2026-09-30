import { test, expect } from "./local-test";

test.beforeEach(async ({ page }) => {
  await page.goto("/inicio");
  await page.getByLabel("Usuario", { exact: true }).fill("educador-demo");
  await page.getByLabel("Contraseña", { exact: true }).fill("Aprender-2026!");
  await page.getByRole("button", { name: "Entrar a mi espacio" }).click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("¿Qué vamos a enseñar hoy?");
});

test("HL-44: the course is the only authoring entry and legacy URLs redirect safely", async ({ page }) => {
  const nav = page.getByRole("navigation", { name: "Navegación principal" });
  await expect(nav).toHaveCount(1);
  await expect(page.locator(".studio-home")).toContainText("preparar y dar tu clase");
  await expect(page.locator(".lesson-grid")).toHaveCount(0);
  await expect(page.locator("a[href^='/contenido'],a[href^='/biblioteca']")).toHaveCount(0);
  await page.goto("/contenido/publicadas");
  await expect(page).toHaveURL(/\/cursos$/);
  await expect(page.getByRole("heading", { name: "Cursos", exact: true })).toBeVisible();
  await page.getByRole("link", { name: "Abrir curso: Exploradores", exact: true }).click();
  const courseNav = page.getByRole("navigation", { name: "Espacios del curso" });
  for (const label of ["Preparar", "Materiales", "Editar lecciones", "Grupos", "Asistencia", "Ajustes"]) await expect(courseNav.getByRole("link", { name: label, exact: true })).toBeVisible();
});

test("HL-44: educators create a class list and record private attendance", async ({ page }) => {
  await page.getByRole("navigation", { name: "Navegación principal" }).getByRole("link", { name: "Cursos", exact: true }).click();
  await page.getByRole("link", { name: "Abrir curso: Exploradores", exact: true }).click();
  const courseNav = page.getByRole("navigation", { name: "Espacios del curso" });
  await courseNav.getByRole("link", { name: "Grupos", exact: true }).click();
  const groupName = `Grupo de prueba ${Date.now()}`;
  await page.getByLabel("Nombre del grupo").fill(groupName);
  await page.getByRole("button", { name: "Crear grupo", exact: true }).click();
  await expect(page.getByRole("heading", { name: groupName, exact: true })).toBeVisible();
  const groupCard = page.locator(".group-card").filter({ hasText: groupName });
  await groupCard.getByLabel("Añadir a la lista").fill("Participante ficticio 01");
  await groupCard.getByRole("button", { name: "Añadir", exact: true }).click();
  await expect(groupCard.getByText("Participante ficticio 01", { exact: true })).toBeVisible();

  await courseNav.getByRole("link", { name: "Asistencia", exact: true }).click();
  await page.getByLabel("Grupo", { exact: true }).selectOption({ label: groupName });
  const date = new Date().toISOString().slice(0, 10);
  await page.getByLabel("Fecha", { exact: true }).fill(date);
  await page.getByRole("button", { name: "Crear clase y pasar lista", exact: true }).click();
  const attendance = page.getByLabel("Asistencia de Participante ficticio 01");
  await expect(attendance).toHaveValue("unmarked");
  await attendance.selectOption("present");
  await page.getByRole("button", { name: "Guardar asistencia", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("Asistencia guardada");
  await page.reload();
  await page.getByRole("button", { name: `${date} · ${groupName}`, exact: true }).click();
  await expect(page.getByLabel("Asistencia de Participante ficticio 01")).toHaveValue("present");
});

test("HL-44: administration cannot read student attendance", async ({ page }) => {
  await page.context().clearCookies();
  await page.goto("/inicio");
  await page.getByLabel("Usuario", { exact: true }).fill("admin-demo");
  await page.getByLabel("Contraseña", { exact: true }).fill("Aprender-2026!");
  await page.getByRole("button", { name: "Entrar a mi espacio" }).click();
  await expect(page.locator(".member-card")).toContainText("admin-demo");
  const result = await page.evaluate(async () => {
    const session = await fetch("/api/session", { credentials: "same-origin" });
    const groups = await fetch("/api/courses/course-exploradores/groups", { credentials: "same-origin" });
    return { session: session.status, groups: groups.status };
  });
  expect(result).toEqual({ session: 200, groups: 403 });
});

test("HL-44: leaving a new course with unsaved edits asks before discarding", async ({ page }) => {
  await page.getByRole("navigation", { name: "Navegación principal" }).getByRole("link", { name: "Cursos", exact: true }).click();
  await page.getByRole("link", { name: "Crear curso", exact: true }).click();
  await page.getByLabel("Nombre del curso").fill("Borrador de navegación");
  page.once("dialog", dialog => dialog.dismiss());
  await page.getByRole("navigation", { name: "Navegación principal" }).getByRole("link", { name: "Inicio", exact: true }).click();
  await expect(page.getByLabel("Nombre del curso")).toHaveValue("Borrador de navegación");
});
