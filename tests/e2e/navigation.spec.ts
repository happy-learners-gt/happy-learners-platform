import { test, expect } from "./local-test";
import { mkdir } from "node:fs/promises";

test.beforeEach(async ({ page }) => {
  await page.goto("/inicio");
  await page.getByLabel("Usuario", { exact: true }).fill("educador-demo");
  await page.getByLabel("Contraseña", { exact: true }).fill("Aprender-2026!");
  await page.getByRole("button", { name: "Entrar a mi espacio" }).click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("¿Qué vamos a enseñar hoy?");
});

test("HL-44: one navigation, spaced cards, deep links, filters and keyboard focus", async ({ page }, info) => {
  const nav = page.getByRole("navigation", { name: "Navegación principal" });
  await expect(nav).toHaveCount(1);
  await expect(nav.getByRole("link", { name: "Organización", exact: true })).toHaveCount(0);
  const gap = await page.locator(".lesson-grid").evaluate(el => getComputedStyle(el).gap);
  expect(gap).toBe(info.project.name === "mobile" ? "16px" : "24px");
  const cards = await page.locator(".lesson-card").all();
  expect(cards.length).toBeGreaterThanOrEqual(2);
  expect(cards.length).toBeLessThanOrEqual(3);
  const first = (await cards[0].boundingBox())!, second = (await cards[1].boundingBox())!;
  expect(second.x >= first.x + first.width + 15 || second.y >= first.y + first.height + 15).toBe(true);
  const folder = `.release-evidence/screenshots/${info.project.name}`;
  await mkdir(folder, { recursive: true });
  await page.screenshot({ path: `${folder}/redesign-home.png`, fullPage: true });
  await nav.getByRole("link", { name: "Biblioteca", exact: true }).click();
  await expect(page).toHaveURL(/\/biblioteca$/);
  await expect(page.getByRole("heading", { level: 1 })).toBeFocused();
  await expect(page.getByRole("button", { name: "Nuevo recurso" })).toBeEnabled();
  await page.keyboard.press("Tab");
  await expect(page.getByRole("button", { name: "Nuevo recurso" })).toBeFocused();
  expect(await page.getByRole("button", { name: "Nuevo recurso" }).evaluate(el => getComputedStyle(el).outlineWidth)).toBe("3px");
  await page.getByLabel("Buscar recursos").fill("Hello");
  await page.getByLabel("Filtrar por habilidad").selectOption("lectura");
  await page.reload();
  await expect(page.getByLabel("Buscar recursos")).toHaveValue("Hello");
  await expect(page.getByLabel("Filtrar por habilidad")).toHaveValue("lectura");
  await nav.getByRole("link", { name: "Contenido", exact: true }).click();
  await expect(page).toHaveURL(/\/contenido$/);
  await page.goBack();
  await expect(page.getByLabel("Buscar recursos")).toHaveValue("Hello");
  await page.goForward();
  await expect(page.getByRole("heading", { name: "Niveles y módulos", exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByRole("heading", { name: "Niveles y módulos", exact: true })).toBeVisible();
  await expect(nav).toHaveCount(1);
  await page.screenshot({ path: `${folder}/redesign-content.png`, fullPage: true });
  if (info.project.name === "mobile") {
    await page.setViewportSize({ width: 320, height: 700 });
    await nav.getByRole("link", { name: "Inicio", exact: true }).click();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: `${folder}/redesign-320.png`, fullPage: true });
  }
});

test("HL-44: leaving dirty forms requires an explicit discard, including browser Back", async ({ page }) => {
  const nav = page.getByRole("navigation", { name: "Navegación principal" });
  await nav.getByRole("link", { name: "Biblioteca", exact: true }).click();
  await page.getByRole("button", { name: "Nuevo recurso" }).click();
  await page.getByLabel("Título del recurso").fill("Trabajo que no se debe perder");
  page.once("dialog", dialog => dialog.dismiss());
  await nav.getByRole("link", { name: "Contenido", exact: true }).click();
  await expect(page.getByLabel("Título del recurso")).toHaveValue("Trabajo que no se debe perder");
  page.once("dialog", dialog => dialog.dismiss());
  await page.evaluate(() => history.back());
  await expect(page).toHaveURL(/\/biblioteca$/);
  await expect(page.getByLabel("Título del recurso")).toHaveValue("Trabajo que no se debe perder");
  page.once("dialog", dialog => dialog.accept());
  await nav.getByRole("link", { name: "Contenido", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Niveles y módulos", exact: true })).toBeVisible();
  await page.getByRole("link", { name: "Lecciones", exact: true }).click();
  await page.getByRole("button", { name: "Nueva lección", exact: true }).click();
  await page.getByRole("button", { name: "Agregar actividad", exact: true }).click();
  // An unrelated order save must not mark the open lesson draft as saved.
  await page.locator('button[aria-label^="Bajar lección"]:enabled').first().click();
  await expect(page.getByRole("status")).toContainText("Cambios guardados");
  page.once("dialog", dialog => dialog.dismiss());
  await nav.getByRole("link", { name: "Inicio", exact: true }).click();
  await expect(page.locator(".activity-editor")).toHaveCount(2);
});
