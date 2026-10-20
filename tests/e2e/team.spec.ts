import { test, expect } from "./local-test";
import { signIn, toast } from "./helpers";

test("seeded educators see their courses' progress, teams and who did what", async ({ page }) => {
  await signIn(page, "lucia.herrera", "/inicio");
  await expect(page.getByText("Hola, Lucía Herrera.")).toBeVisible();
  const mine = page.getByRole("region", { name: "Mis cursos" }).or(page.locator("section").filter({ has: page.getByRole("heading", { name: "Mis cursos" }) })).first();
  await expect(mine.getByRole("link", { name: "Matemáticas 3.º primaria" })).toBeVisible();
  await expect(mine.getByRole("link", { name: "Ciencias Naturales 4.º primaria" })).toBeVisible();
  await expect(mine.getByRole("progressbar", { name: "Lecciones publicadas" }).first()).toBeVisible();
  await expect(page.locator(".activity-feed.people")).toContainText(/Lucía Herrera|Marta Ruiz/);

  // Course overview: the team and the course's own history.
  await page.goto("/cursos/seed-course-matematicas");
  const team = page.locator("section").filter({ has: page.getByRole("heading", { name: "Equipo docente" }) }).first();
  await expect(team).toContainText("Lucía Herrera");
  await expect(team).toContainText("Responsable");
  await expect(team).toContainText("Carlos Mejía");
  // Team changes by administration are part of the course's history too.
  await expect(page.locator(".activity-feed.people").first()).toContainText(/Lucía Herrera|Carlos Mejía|Marta Ruiz/);

  // The program fixes the module name; settings show where each value comes from.
  await page.goto("/cursos/seed-course-matematicas/configuracion");
  await expect(page.locator(".setting-item").filter({ hasText: "Nombre de las partes del curso" })).toContainText("Fijado por el programa");
  // Educators see the team but cannot change it (HL-115 / ST-072).
  const view = page.getByRole("region", { name: "Equipo docente" });
  await expect(view.locator(".team-list")).toContainText("Carlos Mejía");
  await expect(view).toContainText("Administración gestiona el equipo.");
  await expect(view.getByRole("button", { name: "Guardar equipo" })).toHaveCount(0);
  await expect(view.getByLabel("Agregar persona al equipo")).toHaveCount(0);

  // Courses can be filtered by who leads them.
  await page.goto("/cursos");
  await page.getByLabel("Responsable").selectOption("seed-user-lucia");
  await expect(page.locator("article.course-card")).toHaveCount(1);
  await expect(page.locator("article.course-card")).toContainText("Matemáticas 3.º primaria");
});

test("administration reviews each educator's contributions and every course's progress", async ({ page }) => {
  await signIn(page, "marta.ruiz", "/educadores");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Educadores");
  const row = page.getByRole("row", { name: /Diego Ramírez/ });
  await expect(row).toContainText("responsable de 5");
  await expect(page.getByRole("navigation", { name: "Secciones de educadores" }).getByRole("link", { name: "Personas" })).toHaveAttribute("aria-current", "page");
  await page.goto("/inicio");
  const progress = page.locator("section").filter({ has: page.getByRole("heading", { name: "Avance de los cursos" }) });
  for (const title of ["Matemáticas 3.º primaria", "Ciencias Naturales 4.º primaria", "English Explorers A1", "Taller de robótica educativa", "Arte y expresión creativa"]) await expect(progress.getByRole("link", { name: title })).toBeVisible();
  await expect(page.locator(".activity-feed.people").first()).toContainText(/Diego Ramírez|Marta Ruiz/);
  await page.goto("/configuracion-academica");
  await expect(page.locator(".program-list")).toContainText("Primaria bilingüe");
  await expect(page.locator(".program-list")).toContainText("2 cursos");

  // Administration manages a course team (HL-115 / ST-072): add a co-teacher, then restore the original team.
  await page.goto("/cursos/seed-course-matematicas");
  await page.getByRole("link", { name: "Gestionar equipo" }).click();
  const editor = page.getByRole("region", { name: "Equipo docente" });
  await editor.getByLabel("Agregar persona al equipo").selectOption({ label: "Ana López (@ana.lopez)" });
  await editor.getByRole("button", { name: "Agregar", exact: true }).click();
  await editor.getByRole("button", { name: "Guardar equipo" }).click();
  await expect(toast(page)).toContainText("Equipo docente actualizado");
  await expect(editor.locator(".team-list")).toContainText("Ana López");
  await editor.getByRole("button", { name: "Quitar a Ana López del equipo" }).click();
  await editor.getByRole("button", { name: "Guardar equipo" }).click();
  await expect(toast(page)).toContainText("Equipo docente actualizado");
  await expect(editor.locator(".team-list")).not.toContainText("Ana López");
});
