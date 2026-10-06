import AxeBuilder from "@axe-core/playwright";
import type { Page } from "@playwright/test";
import { test, expect } from "./local-test";
import { signIn } from "./helpers";

const wcag = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];
async function audit(page: Page, label: string) {
  await page.waitForLoadState("networkidle");
  // Toasts fade in; wait so colours are measured at their final opacity.
  await page.waitForTimeout(400);
  // Smooth scrolling (outline links) can leave a control briefly under the sticky toolbar; measure once it stops.
  await page.waitForFunction(() => new Promise(resolve => { const y = scrollY; setTimeout(() => resolve(scrollY === y), 150); }));
  const { violations } = await new AxeBuilder({ page }).withTags(wcag).analyze();
  expect(violations.map(item => `${label}: ${item.id} · ${item.nodes.map(node => node.target.join(" ")).slice(0, 3).join(" | ")}`)).toEqual([]);
}

test("main routes have no WCAG 2.2 A/AA violations detectable by axe", async ({ page }) => {
  // Many routes are audited one after another; give the whole tour room on slow runners.
  test.setTimeout(120_000);
  await page.goto("/inicio");
  await audit(page, "login");
  await signIn(page, "educador-demo", "/inicio");
  const active = await page.evaluate(async () => ((await (await fetch("/api/sections")).json()).sections as { id: string; status: string; next?: { id: string } }[]).find(item => item.status === "active" && item.next));
  expect(active).toBeTruthy();
  const section = active!.id;
  for (const [label, path] of [
    ["inicio", "/inicio"], ["agenda", "/agenda"], ["sección", `/secciones/${section}`], ["estudiantes", `/secciones/${section}/estudiantes`], ["cursos", "/cursos"], ["nuevo curso", "/cursos/nuevo"], ["resumen", "/cursos/course-exploradores"], ["plan curricular", "/cursos/course-exploradores/plan"],
    ["contenido", "/cursos/course-exploradores/contenido"], ["editor", "/cursos/course-exploradores/lecciones/greetings-and-introductions"],
    ["vista previa", "/cursos/course-exploradores/lecciones/greetings-and-introductions?vista=previa"], ["biblioteca del curso", "/cursos/course-exploradores/biblioteca"],
    ["secciones del curso", "/cursos/course-exploradores/secciones"], ["horario", `/secciones/${section}/horario`], ["cronograma", `/secciones/${section}/clases`], ["clase", `/secciones/${section}/clases/${active!.next!.id}`], ["configuración", "/cursos/course-exploradores/configuracion"],
    ["biblioteca", "/biblioteca"], ["buscar", "/buscar?q=greet"], ["ayuda", "/ayuda"], ["guía de estilo", "/guia-de-estilo"],
  ]) {
    await page.goto(path);
    await expect(page.getByRole("heading", { level: 1 }).first()).toBeAttached();
    await audit(page, label);
  }
  // With reduced motion the outline jumps instead of scrolling smoothly, so axe measures the settled page.
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/cursos/course-exploradores/lecciones/greetings-and-introductions");
  await page.getByRole("navigation", { name: "Estructura de la lección" }).getByRole("button", { name: /Choose a greeting/ }).first().click();
  await audit(page, "editor pregunta");
  await page.goto("/cursos/course-exploradores/biblioteca");
  await page.getByRole("button", { name: "Agregar recurso" }).click();
  await audit(page, "diálogo de recurso");
  await page.goto("/aprender/GREETINGS");
  await audit(page, "estudiante inicio");
  await page.getByRole("button", { name: "Empezar" }).click();
  await page.getByRole("button", { name: "Siguiente" }).click();
  await page.getByRole("button", { name: "Siguiente" }).click();
  await audit(page, "estudiante pregunta");
  await signIn(page, "admin-demo", "/inicio");
  for (const [label, path] of [["organización", "/organizacion"], ["educadores", "/educadores"]]) {
    await page.goto(path);
    await expect(page.getByRole("heading", { level: 1 }).first()).toBeAttached();
    await audit(page, label);
  }
  await page.goto("/configuracion-academica");
  for (const summary of ["Niveles educativos · CINE 2011", "Áreas de conocimiento · CINE-F 2013"]) await page.getByText(summary).click();
  await audit(page, "configuración académica");
  await page.getByRole("button", { name: "Crear programa", exact: true }).click();
  await audit(page, "diálogo de programa");
});

test("keyboard: skip link, visible focus, menus and dialogs work without a pointer", async ({ page }) => {
  // The course menu is administration's: it configures, duplicates and archives courses.
  await signIn(page, "admin-demo", "/cursos");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Cursos");
  await page.keyboard.press("Tab");
  const skip = page.getByRole("link", { name: "Saltar al contenido" });
  await expect(skip).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.locator("main")).toBeFocused();
  // "/" jumps to search from anywhere outside a field.
  await page.locator("main").press("/");
  await expect(page.getByLabel("Buscar cursos, lecciones y recursos")).toBeFocused();
  await page.keyboard.type("greet");
  await page.keyboard.press("Enter");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Resultados para «greet»");
  await page.goto("/cursos");
  const menu = page.getByRole("button", { name: "Acciones del curso Exploradores" });
  await menu.focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("menuitem").first()).toBeFocused();
  await page.keyboard.press("ArrowDown");
  await expect(page.getByRole("menuitem", { name: "Editar configuración" })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("menu")).toHaveCount(0);
  await expect(menu).toBeFocused();
  const outline = await menu.evaluate(element => getComputedStyle(element).outlineStyle);
  expect(outline).not.toBe("none");
  await page.keyboard.press("Enter");
  await page.keyboard.press("End");
  await page.keyboard.press("Enter");
  const dialog = page.getByRole("dialog", { name: "¿Archivar «Exploradores»?" });
  await expect(dialog.getByRole("button", { name: "Cancelar" })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(page.locator("article.course-card").filter({ hasText: "Exploradores" })).toBeVisible();
});
