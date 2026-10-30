import { test, expect } from "./local-test";
import { createLesson, e2eName, saveStatus, signIn } from "./helpers";

// 1.4.1 (docs/design/asistente-ia.md §6c, §6e), with the local generator: improvements are accepted into the draft and
// survive a reload (block texts go through the collaboration room); «Redactar con IA» proposes and the person decides.
test("the review proposes improvements, accepted ones raise the score and stay; writing with AI proposes and the person uses it", async ({ page }, info) => {
  await signIn(page, "lucia.herrera", "/cursos/seed-course-mate6/contenido");
  await createLesson(page, "Unidad 2: Fracciones y decimales", e2eName(info, "Lección para mejorar"), "Fracciones");
  await expect(saveStatus(page)).toContainText("Borrador guardado", { timeout: 10_000 });
  const reviewButton = page.getByRole("button", { name: /^Revisar Calidad \d{1,3}$/ });
  const before = Number((await reviewButton.textContent())!.match(/\d+/)![0]);
  expect(before).toBeLessThan(60);
  await reviewButton.click();
  const panel = page.getByRole("dialog", { name: "Revisión de la lección" });
  await panel.getByRole("button", { name: "Proponer mejoras" }).click();
  const changes = panel.locator(".improve-changes > li");
  await expect(changes.first()).toBeVisible();
  await expect(changes.filter({ hasText: "Objetivo de la lección" })).toContainText("Al terminar la clase, cada estudiante fracciones y lo demuestra en una actividad.");
  // Discarding one leaves it out; accepting the rest applies them to the draft.
  const count = await changes.count();
  await changes.filter({ hasText: "Objetivo de la lección" }).getByRole("button", { name: /^Descartar/ }).click();
  await expect(changes).toHaveCount(count - 1);
  await panel.getByRole("button", { name: `Aceptar todo (${count - 1})` }).click();
  await expect(changes).toHaveCount(0);
  const after = Number(await panel.locator(".review-score strong").textContent());
  expect(after).toBeGreaterThan(before);
  await panel.getByRole("button", { name: "Cerrar" }).click();
  await expect(page.getByLabel("Objetivo", { exact: true })).toHaveValue("Fracciones");
  await expect(saveStatus(page)).toContainText("Borrador guardado", { timeout: 10_000 });
  await page.reload();
  await expect(page.getByRole("button", { name: `Revisar Calidad ${after}` })).toBeVisible();
  await expect(page.getByRole("region", { name: /^Actividad \d+: Comprobamos lo aprendido$/ })).toBeVisible();

  // «Redactar con IA» under the objective: a proposal, and the field changes only with «Usar».
  const objective = page.getByLabel("Objetivo", { exact: true });
  await objective.fill("Comparar fracciones con regletas. Después explicarlo a la clase.");
  await page.getByRole("group", { name: "Redactar con IA: Objetivo" }).getByRole("button", { name: "Más breve" }).click();
  const proposal = page.getByRole("region", { name: "Propuesta para Objetivo" });
  await expect(proposal).toContainText("Comparar fracciones con regletas.");
  await expect(objective).toHaveValue("Comparar fracciones con regletas. Después explicarlo a la clase.");
  await proposal.getByRole("button", { name: "Usar" }).click();
  await expect(objective).toHaveValue("Comparar fracciones con regletas.");
  await expect(proposal).toBeHidden();
});
