import { test, expect } from "./local-test";
import { activity, addActivity, e2eName, origin, publish, saveStatus, signIn, toast } from "./helpers";

test("curricular plan: outcomes, coverage gaps, aligned lesson and what students will learn", async ({ page, browser }, info) => {
  const run = Date.now().toString(36);
  const competency = e2eName(info, `Expresión escrita ${run}`), statement = e2eName(info, `Escribe una presentación personal de tres frases ${run}`);
  await signIn(page, "educador-demo", "/cursos/course-exploradores/plan");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Plan curricular");
  // The curated demo plan shows a gap out of the box.
  await expect(page.getByRole("heading", { name: "Comunicación oral en inglés" })).toBeVisible();
  await expect(page.getByRole("row", { name: /Nombra en inglés los colores básicos/ })).toContainText("Sin módulo ni lecciones");

  await page.getByRole("button", { name: "Nueva competencia", exact: true }).first().click();
  let dialog = page.getByRole("dialog", { name: "Nueva competencia" });
  await dialog.getByLabel("Nombre").fill(competency);
  await dialog.getByRole("button", { name: "Guardar" }).click();
  await expect(toast(page)).toContainText("Competencia creada");

  await page.getByRole("button", { name: "Nuevo resultado", exact: true }).first().click();
  dialog = page.getByRole("dialog", { name: "Nuevo resultado de aprendizaje" });
  await dialog.getByLabel("Resultado de aprendizaje").fill(statement);
  await dialog.getByLabel("Nivel de pensamiento").selectOption({ label: "Crear" });
  await expect(dialog.getByText(/diseña, produce, propone/)).toBeVisible();
  await dialog.getByLabel("Competencia").selectOption({ label: competency });
  await dialog.getByLabel("Evidencia").fill("Entrega su presentación escrita.");
  await dialog.getByRole("button", { name: "Guardar" }).click();
  await expect(toast(page)).toContainText("Resultado creado");
  await expect(page.getByRole("article", { name: competency })).toContainText(statement);

  // Plan it in a unit, then close the gap by creating a lesson aligned to it.
  const row = page.getByRole("row", { name: new RegExp(statement) });
  const plan = row.getByRole("button", { name: /^Planificar RA\d+ en Greetings$/ });
  await plan.click();
  await expect(plan).toHaveAttribute("aria-pressed", "true");
  await expect(row).toContainText("Ninguna lección lo trabaja");
  await row.getByRole("button", { name: "Crear lección" }).click();
  dialog = page.getByRole("dialog", { name: /^Nueva lección para RA\d+$/ });
  await dialog.getByLabel("Título de la lección").fill(e2eName(info, "Mi presentación"));
  await expect(dialog.getByLabel("Módulo")).toHaveValue("course-exploradores--unit-org-demo");
  await dialog.getByRole("button", { name: "Crear y editar" }).click();
  await expect(page).toHaveURL(/\/lecciones\/lesson-/);
  await expect(page.getByRole("checkbox", { name: new RegExp(statement) })).toBeChecked();
  const checklist = page.getByRole("region", { name: /Antes de publicar/ });
  await expect(checklist.locator("li").filter({ hasText: "Alineada a resultados de aprendizaje" })).toHaveClass("is-ok");
  await expect(checklist.locator("li").filter({ hasText: "Comprueba lo aprendido" })).toHaveClass("is-open");

  await activity(page, "Instrucciones").locator(".richtext-content").first().fill("Escribe tu nombre, tu edad y lo que te gusta.");
  const check = await addActivity(page, "Pregunta", "Cierre");
  await check.getByLabel(/^Título de la actividad/).fill("Revisamos la presentación");
  await check.locator(".richtext-content").fill("¿Qué frase sirve para presentarte?");
  await check.getByLabel("Opción 1", { exact: true }).fill("My name is Ana.");
  await check.getByLabel("Opción 2", { exact: true }).fill("It is blue.");
  await check.getByRole("button", { name: new RegExp(`^RA\\d+: ${statement}`) }).click();
  await expect(check.getByRole("button", { name: new RegExp(`^RA\\d+: ${statement}`) })).toHaveAttribute("aria-pressed", "true");
  await expect(saveStatus(page)).toContainText("Borrador guardado", { timeout: 10_000 });
  await expect(checklist.locator("li").filter({ hasText: "Comprueba lo aprendido" })).toHaveClass("is-ok");

  // "Desarrollo" is still empty: publishing asks first, and can go ahead.
  await publish(page, "Publicar", true);
  await expect(toast(page)).toContainText("Lección publicada");
  const code = (await page.locator(".share-row strong").textContent())!;

  await page.goto("/cursos/course-exploradores/plan");
  await expect(page.getByRole("row", { name: new RegExp(statement) })).toContainText("Cubierto");

  const student = await (await browser.newContext()).newPage();
  await student.goto(`${origin}/aprender/${code}`);
  await expect(student.getByText("Al terminar podrás:")).toBeVisible();
  await expect(student.locator(".player-outcomes")).toContainText(statement);
  await student.context().close();
});
