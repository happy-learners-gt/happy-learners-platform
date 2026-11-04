import AxeBuilder from "@axe-core/playwright";
import type { Page } from "@playwright/test";
import { test, expect } from "./local-test";
import { signIn } from "./helpers";

const wcag = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];
async function audit(page: Page, label: string) {
  await page.waitForLoadState("networkidle");
  await page.waitForTimeout(400);
  const { violations } = await new AxeBuilder({ page }).withTags(wcag).analyze();
  expect(violations.map(item => `${label}: ${item.id} · ${item.nodes.map(node => node.target.join(" ")).slice(0, 3).join(" | ")}`)).toEqual([]);
}

test("REL-007 ST-137 ST-186 ST-068: administration reads, filters, verifies and exports the security log, and audits critical actions", async ({ page }) => {
  await signIn(page, "admin-demo", "/seguridad");
  await expect(page.getByRole("heading", { level: 1, name: "Seguridad" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Registro de seguridad" })).toHaveAttribute("aria-current", "page");
  const table = page.getByRole("table", { name: /Eventos de seguridad/ });
  await expect(table).toContainText("Inicio de sesión");
  // ST-186: the chain verifies.
  await page.getByRole("button", { name: "Verificar la cadena" }).click();
  await expect(page.getByRole("status")).toContainText("Íntegro");
  // ST-137 criterion 2: a filter by event type.
  await page.getByLabel("Tipo de evento").selectOption("sign_in");
  await page.getByRole("button", { name: "Filtrar" }).click();
  await expect(table.getByRole("row").nth(1)).toContainText("Inicio de sesión");
  await expect(page.getByRole("link", { name: "Exportar CSV" })).toHaveAttribute("href", /\/api\/security\/events\/export\?tipo=sign_in$/);
  await audit(page, "registro de seguridad");
  // ST-068: the audit tab.
  await page.getByRole("link", { name: "Auditoría" }).click();
  await expect(page.getByRole("heading", { name: "Acciones críticas" })).toBeVisible();
  await expect(page.getByLabel("Objeto")).toContainText("Cuentas y roles");
  await expect(page.getByRole("heading", { name: "Cambios de rol y de acceso" })).toBeVisible();
  await audit(page, "auditoría");
});

test("REL-007 ST-184: an educator does not reach the security of the organization", async ({ page }) => {
  await signIn(page, "educador-demo", "/seguridad");
  await expect(page.getByText("Esta sección es para administración")).toBeVisible();
  await expect(page.getByRole("table", { name: /Eventos de seguridad/ })).toHaveCount(0);
});
