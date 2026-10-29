import type { Page } from "@playwright/test";
import { test, expect } from "./local-test";
import { signIn } from "./helpers";

// Layout invariants of the design standard (docs/design/fluent.md, point 9), checked on desktop and on mobile:
// pages use the full content column, the page header stays compact, row actions stay at the end of their row, menus
// open inside the screen, nothing overflows sideways, and the profile's section bar keeps the section chosen.
const routes = ["/inicio", "/cursos", "/agenda", "/calendario", "/organizacion", "/educadores", "/configuracion-academica", "/mi-cuenta/cuenta", "/mi-cuenta/notificaciones",
  "/cursos/seed-course-mate6", "/cursos/seed-course-mate6/plan", "/cursos/seed-course-mate6/contenido", "/cursos/seed-course-mate6/configuracion",
  "/secciones/seed-group-mat-6a", "/secciones/seed-group-mat-6a/clases", "/secciones/seed-group-mat-6a/estudiantes", "/secciones/seed-group-mat-6a/notas"];
const fullWidth = new Set(["/organizacion", "/mi-cuenta/cuenta", "/cursos/seed-course-mate6/configuracion"]);

async function settle(page: Page) {
  await page.waitForLoadState("networkidle");
  await expect(page.getByRole("heading", { level: 1 }).first()).toBeVisible();
  await page.waitForTimeout(300);
}

const measure = () => {
  const main = document.querySelector<HTMLElement>("main#main")!;
  const style = getComputedStyle(main), column = main.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
  const header = main.querySelector(".page-header"), title = header?.querySelector(".page-header-title")?.getBoundingClientRect(), description = header?.querySelector(".page-description")?.getBoundingClientRect();
  const visible = (element: Element) => { const box = element.getBoundingClientRect(); return box.width > 0 && box.height > 0; };
  const pushed: string[] = [];
  for (const trigger of main.querySelectorAll("button[aria-haspopup=menu]")) {
    const holder = trigger.closest(".menu") || trigger, row = holder.parentElement!;
    if (!visible(holder) || row.closest(".guide-stack, .page-actions, .page-header")) continue;
    const mine = holder.getBoundingClientRect(), box = row.getBoundingClientRect();
    const siblings = [...row.children].filter(child => child !== holder && visible(child));
    if (siblings.length && box.width > 200 && mine.left < box.left + box.width / 2) pushed.push(trigger.getAttribute("aria-label") || "menú");
  }
  return {
    overflow: document.documentElement.scrollWidth - innerWidth,
    headerGap: title && description ? Math.round(description.top - title.bottom) : 0,
    narrow: [...main.querySelectorAll(":scope > .form-sheet > .panel, :scope > .form-sheet > form.panel, :scope > .stack-lg > *")].filter(visible).map(panel => panel.getBoundingClientRect().width / column).filter(ratio => ratio < 0.95).length,
    pushed,
  };
};

test("pages use the full width, keep a compact header and their row actions at the end of the row", async ({ page }) => {
  test.setTimeout(240_000);
  await signIn(page, "admin-demo", "/inicio");
  for (const route of routes) {
    await page.goto(route);
    await settle(page);
    const result = await page.evaluate(measure);
    expect.soft(result.overflow, `${route}: desborde horizontal`).toBeLessThanOrEqual(1);
    expect.soft(result.headerGap, `${route}: espacio entre título y descripción`).toBeLessThanOrEqual(24);
    expect.soft(result.pushed, `${route}: menús empujados fuera del final de su fila`).toEqual([]);
    if (fullWidth.has(route)) expect.soft(result.narrow, `${route}: paneles que no usan el ancho`).toBe(0);
    // Up to three menus: each opens inside the viewport.
    const triggers = page.locator("main button[aria-haspopup=menu]:visible");
    for (let index = 0; index < Math.min(3, await triggers.count()); index++) {
      await triggers.nth(index).scrollIntoViewIfNeeded();
      await triggers.nth(index).click();
      const box = (await page.getByRole("menu").first().boundingBox())!;
      const viewport = page.viewportSize()!;
      expect.soft(box.x >= 0 && box.x + box.width <= viewport.width && box.y >= 0 && box.y + box.height <= viewport.height, `${route}: menú ${index + 1} fuera de la pantalla (${JSON.stringify(box)})`).toBe(true);
      await page.keyboard.press("Escape");
    }
  }
});

test("the profile's section bar keeps the section chosen through the scroll and follows the person's own scrolling", async ({ page }) => {
  await signIn(page, "lucia.herrera", "/mi-cuenta/perfil");
  const bar = page.getByRole("navigation", { name: "Secciones del perfil" });
  await expect(bar).toBeVisible();
  const labels = (await bar.getByRole("button").allTextContents()).map(label => label.trim());
  for (const label of [...labels, ...[...labels].reverse()]) {
    await bar.getByRole("button", { name: label }).click();
    await page.waitForFunction(() => new Promise(resolve => { const y = scrollY; setTimeout(() => resolve(scrollY === y), 200); }));
    await expect(bar.locator("[aria-current=true]")).toHaveText(label);
  }
  await page.mouse.wheel(0, -100000);
  await expect(bar.locator("[aria-current=true]")).toHaveText(labels[0]);
});
