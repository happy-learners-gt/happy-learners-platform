import AxeBuilder from "@axe-core/playwright";
import type { Page } from "@playwright/test";
import { test, expect } from "./local-test";
import { e2eName, expectRecentActivity, signIn, toast } from "./helpers";

const wcag = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];
async function audit(page: Page, label: string) {
  await page.waitForLoadState("networkidle");
  await page.waitForTimeout(400);
  const { violations } = await new AxeBuilder({ page }).withTags(wcag).analyze();
  expect(violations.map(item => `${label}: ${item.id} · ${item.nodes.map(node => node.target.join(" ")).slice(0, 3).join(" | ")}`)).toEqual([]);
}

test("HL-137 ST-093: administration creates an account, its first sign-in requires a new password, and a reset issues another", async ({ page, browser }, info) => {
  const username = `e2e-${info.project.name}-${Date.now().toString(36)}`, name = e2eName(info, "Cuenta");
  await signIn(page, "admin-demo", "/educadores");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Educadores");

  // CA1: name, username and role; the temporary password is shown once.
  await page.getByRole("button", { name: "Agregar cuenta" }).click();
  let dialog = page.getByRole("dialog", { name: "Agregar cuenta" });
  await audit(page, "agregar cuenta");
  await dialog.getByLabel("Nombre", { exact: true }).fill(name);
  await dialog.getByLabel("Usuario", { exact: true }).fill(username);
  await dialog.getByLabel("Rol", { exact: true }).selectOption("educator");
  await dialog.getByRole("button", { name: "Crear cuenta" }).click();
  dialog = page.getByRole("dialog", { name: "Cuenta creada" });
  await expect(dialog).toContainText("no se volverá a mostrar");
  await expect(dialog.getByRole("button", { name: "Copiar contraseña" })).toBeVisible();
  const temporary = (await dialog.getByLabel("Contraseña temporal").textContent())!.trim();
  expect(temporary).toMatch(/^[A-Za-z2-9]{4}(-[A-Za-z2-9]{4}){3}$/);
  await audit(page, "contraseña temporal");
  await dialog.getByRole("button", { name: "Listo, ya la guardé" }).click();
  const row = page.getByRole("row", { name: new RegExp(name) });
  await expect(row).toContainText(`@${username}`);
  await expect(row).toContainText("Contraseña temporal");
  await expectRecentActivity(page, `creó la cuenta de ${name}`);

  // First sign-in: the temporary password leads to "Cambia tu contraseña" and nothing else.
  const context = await browser.newContext({ viewport: page.viewportSize() });
  const educator = await context.newPage();
  await educator.goto("/inicio");
  await educator.getByLabel("Usuario", { exact: true }).fill(username);
  await educator.getByLabel("Contraseña", { exact: true }).fill(temporary);
  await educator.getByRole("button", { name: "Entrar", exact: true }).click();
  await expect(educator.getByRole("heading", { level: 1 })).toHaveText("Cambia tu contraseña");
  await audit(educator, "cambia tu contraseña");
  expect(await educator.evaluate(async () => (await fetch("/api/courses")).status)).toBe(403);
  await educator.getByLabel("Contraseña temporal").fill(temporary);
  await educator.getByLabel("Nueva contraseña", { exact: true }).fill("Una frase para recordar 2026");
  await educator.getByLabel("Repite la nueva contraseña").fill("Una frase distinta 2026");
  await educator.getByRole("button", { name: "Guardar y continuar" }).click();
  await expect(educator.getByRole("alert")).toContainText("no coinciden");
  await educator.getByLabel("Repite la nueva contraseña").fill("Una frase para recordar 2026");
  await educator.getByRole("button", { name: "Guardar y continuar" }).click();
  // ST-122: a new account continues to its welcome.
  await expect(educator.getByRole("heading", { level: 1 })).toHaveText("Bienvenida");
  await expect(toast(educator)).toContainText("Contraseña guardada");

  // CA3: a reset closes the session and issues another temporary password; the change is in the activity.
  await row.getByRole("button", { name: `Acciones de ${name}` }).click();
  await page.getByRole("menuitem", { name: "Restablecer contraseña" }).click();
  await page.getByRole("dialog", { name: `¿Restablecer la contraseña de ${name}?` }).getByRole("button", { name: "Restablecer contraseña" }).click();
  dialog = page.getByRole("dialog", { name: "Contraseña restablecida" });
  const again = (await dialog.getByLabel("Contraseña temporal").textContent())!.trim();
  expect(again).not.toBe(temporary);
  await dialog.getByRole("button", { name: "Listo, ya la guardé" }).click();
  await expectRecentActivity(page, `restableció la contraseña de ${name}`);
  expect(await educator.evaluate(async () => (await fetch("/api/session")).status)).toBe(401);

  // CA2: without access, the account stays listed with its history but cannot sign in.
  await row.getByRole("button", { name: `Acciones de ${name}` }).click();
  await page.getByRole("menuitem", { name: "Quitar acceso" }).click();
  await expect(row).toContainText("Sin acceso");
  await expectRecentActivity(page, `desactivó la cuenta de ${name}`);
  expect(await educator.evaluate(async ([user, password]) => (await fetch("/api/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ username: user, password }) })).status, [username, again])).toBe(401);
  await context.close();
});
