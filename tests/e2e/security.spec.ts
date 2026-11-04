import AxeBuilder from "@axe-core/playwright";
import type { Page } from "@playwright/test";
import { test, expect } from "./local-test";
import { signIn, toast } from "./helpers";

const wcag = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];
async function audit(page: Page, label: string) {
  await page.waitForLoadState("networkidle");
  await page.waitForTimeout(400);
  const { violations } = await new AxeBuilder({ page }).withTags(wcag).analyze();
  expect(violations.map(item => `${label}: ${item.id} · ${item.nodes.map(node => node.target.join(" ")).slice(0, 3).join(" | ")}`)).toEqual([]);
}

test("Identidad y acceso: the overview scores the organization and recommends; requiring a second factor protects the administrator from locking themselves out", async ({ page }) => {
  await signIn(page, "admin-demo", "/identidad");
  await expect(page).toHaveURL(/\/identidad\/resumen$/);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Resumen");
  await expect(page.getByRole("img", { name: /Puntuación de seguridad: \d+ de 100/ })).toBeVisible();
  const recommendation = page.locator(".recommendation").filter({ hasText: "Exige la verificación en dos pasos a administración" });
  await expect(recommendation).toBeVisible();
  await audit(page, "resumen");
  await recommendation.getByRole("button", { name: "Exigir a administración" }).click();
  await expect(toast(page)).toContainText("Primero protege tu propia cuenta");
  // The old addresses land in the hub.
  await page.goto("/seguridad#politicas");
  await expect(page).toHaveURL(/\/identidad\/politicas$/);
  await expect(page.getByLabel("Longitud mínima de las contraseñas")).toHaveValue("12");
});

test("Identidad y acceso: the directory shows how each person signs in, and one person's panel has their methods, sessions and activity", async ({ page }) => {
  await signIn(page, "admin-demo", "/identidad/personas");
  const table = page.getByRole("table", { name: /Personas, su rol/ });
  await expect(table).toContainText("Solo contraseña");
  await page.getByLabel("Mostrar", { exact: true }).selectOption("password-only");
  await expect(page).toHaveURL(/filtro=password-only/);
  await audit(page, "personas");
  await table.getByRole("button").first().click();
  const panel = page.getByRole("dialog");
  for (const section of ["Métodos de inicio de sesión", "Roles y grupos", "Actividad de seguridad"]) await expect(panel.getByRole("heading", { name: section })).toBeVisible();
  await audit(page, "persona");
  await panel.getByRole("button", { name: /Cerrar/ }).first().click();
  await expect(page).not.toHaveURL(/persona=/);
});

test("Identidad y acceso: the logs verify their chain and filter; an access review keeps everyone and completes", async ({ page }, info) => {
  await signIn(page, "admin-demo", "/identidad/registros");
  await page.getByRole("button", { name: "Verificar la cadena" }).click();
  await expect(page.getByRole("status")).toContainText("Íntegro");
  await page.getByLabel("Tipo de evento").selectOption("sign_in");
  await page.getByRole("button", { name: "Filtrar" }).click();
  await expect(page.getByRole("table", { name: /Eventos de seguridad/ }).getByRole("row").nth(1)).toContainText("Inicio de sesión");
  await page.getByRole("link", { name: "Auditoría" }).click();
  await expect(page.getByRole("heading", { name: "Acciones críticas" })).toBeVisible();
  await audit(page, "registros");
  // One review at a time in the shared demonstration: only the desktop run starts one.
  test.skip(info.project.name !== "desktop", "Una revisión abierta a la vez en la demostración compartida");
  await page.goto("/identidad/revisiones");
  await expect(page.getByText("Cargando revisiones…")).toHaveCount(0);
  await expect(page.locator(".review-list, .empty-state").first()).toBeVisible();
  const start = page.getByRole("button", { name: /Iniciar (la primera|revisión)/ });
  if (await start.count()) {
    await start.first().click();
    await page.getByRole("dialog", { name: "Iniciar una revisión de accesos" }).getByRole("button", { name: "Iniciar" }).click();
  } else await page.locator(".review-list a").first().click();
  await expect(page.getByRole("button", { name: "Completar revisión" })).toBeDisabled();
  await audit(page, "revisión de accesos");
  await page.getByRole("button", { name: "Mantener a quienes faltan" }).click();
  await expect(page.getByRole("button", { name: "Completar revisión" })).toBeEnabled();
  await page.getByRole("button", { name: "Completar revisión" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Completar" }).click();
  await expect(toast(page)).toContainText("Revisión completada");
});

test("Identidad y acceso is for administration: an educator is pointed to their own security", async ({ page }) => {
  await signIn(page, "educador-demo", "/identidad/personas");
  await expect(page.getByText("Esta sección es para administración")).toBeVisible();
  await expect(page.getByText("Mi cuenta › Seguridad")).toBeVisible();
});
