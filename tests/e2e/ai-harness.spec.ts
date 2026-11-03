import { test, expect } from "./local-test";
import { createLesson, e2eName, signIn } from "./helpers";

// 1.4.0 (docs/design/asistente-ia.md): the lesson review with a fact-based score and the organization's AI usage.
test("a lesson shows its review score, explains each check and leads to the activity to fix; administration reads the AI usage", async ({ page }, info) => {
  await signIn(page, "lucia.herrera", "/cursos/seed-course-mate6/contenido");
  await expect(page.locator(".page-description")).toContainText("Calidad media");
  const chip = page.locator(".review-chip").first();
  await expect(chip).toHaveText(/^Calidad \d{1,3}$/);

  await page.goto("/cursos/seed-course-mate6/lecciones/seed-lesson-m6-poligonos");
  const open = page.getByRole("button", { name: /^Revisar Calidad \d{1,3}$/ });
  await expect(open).toBeVisible();
  const score = Number((await open.textContent())!.match(/\d+/)![0]);
  await open.click();
  const panel = page.getByRole("dialog", { name: "Revisión de la lección" });
  await expect(panel.locator(".review-score strong")).toHaveText(String(score));
  await expect(panel.locator(".review-checks > li")).toHaveCount(8);
  for (const label of ["Objetivo", "Alineación con el plan", "Secuencia didáctica", "Tiempo", "Evaluación", "Agrupación", "Recursos", "Instrucciones"]) await expect(panel.getByText(label, { exact: true })).toBeVisible();
  // The same lesson always gets the same score: closing and opening again does not change it.
  await panel.getByRole("button", { name: "Cerrar" }).click();
  await open.click();
  await expect(panel.locator(".review-score strong")).toHaveText(String(score));
  await panel.getByRole("button", { name: "Cerrar" }).click();

  // A new lesson starts with 20 minutes of empty activities: time and instructions fail, each with its reason.
  await page.goto("/cursos/seed-course-mate6/contenido");
  await createLesson(page, "Unidad 2: Fracciones y decimales", e2eName(info, "Lección para revisar"), "Comparar fracciones con regletas y explicar el resultado.");
  await page.getByRole("button", { name: /^Revisar Calidad \d{1,3}$/ }).click();
  const fresh = page.getByRole("dialog", { name: "Revisión de la lección" });
  const time = fresh.locator(".review-checks > li.is-fail").filter({ hasText: "Tiempo" });
  await expect(time).toContainText("Faltan 25 min: amplía una actividad o agrega otra.");
  await expect(time).toContainText("Las actividades suman 20 min; las clases del curso duran 45 min.");
  // An activity without instructions is named as evidence, and its link leads to the activity's card.
  const evidence = fresh.locator(".review-checks > li.is-fail").filter({ hasText: "Instrucciones" }).getByRole("button", { name: /no tiene instrucciones ni contenido$/ });
  await expect(evidence.first()).toBeVisible();
  const target = (await evidence.first().textContent())!.replace(/: no tiene instrucciones ni contenido$/, "");
  await evidence.first().click();
  await expect(fresh).toBeHidden();
  await expect(page.getByRole("region", { name: new RegExp(`^Actividad \\d+: ${target}$`) })).toBeInViewport();

  await signIn(page, "admin-demo", "/organizacion/ia");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Uso de IA");
  await expect(page.locator(".stat-tile")).toHaveCount(5);
  await expect(page.locator(".stat-tile", { hasText: "Propuestas usadas" })).toBeVisible();
  await page.getByRole("button", { name: "Registrar precio" }).first().click();
  const dialog = page.getByRole("dialog", { name: "Precio de un modelo" });
  await dialog.getByLabel("Modelo").fill("modelo-e2e");
  await dialog.getByLabel("Entrada (USD por millón de tokens)").fill("1,5");
  await dialog.getByLabel("Salida (USD por millón de tokens)").fill("6");
  await dialog.getByRole("button", { name: "Guardar precio" }).click();
  await expect(dialog).toBeHidden();
  await expect(page.locator(".ai-price-list")).toContainText("modelo-e2e");
  await page.getByRole("button", { name: "Mes anterior" }).click();
  await expect(page).toHaveURL(/\/organizacion\/ia\?mes=\d{4}-\d{2}$/);

  await signIn(page, "lucia.herrera", "/organizacion/ia");
  await expect(page.getByText("Solo administración ve el uso de IA de la organización.")).toBeVisible();
});
