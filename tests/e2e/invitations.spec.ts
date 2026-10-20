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
async function invite(page: Page, email: string, name: string, role: "educator" | "admin") {
  await page.getByRole("button", { name: "Invitar por correo" }).click();
  const dialog = page.getByRole("dialog", { name: "Invitar por correo" });
  await dialog.getByLabel("Correo", { exact: true }).fill(email);
  await dialog.getByLabel("Nombre", { exact: true }).fill(name);
  await dialog.getByLabel("Rol", { exact: true }).selectOption(role);
  await dialog.getByRole("button", { name: "Continuar" }).click();
  await dialog.getByRole("button", { name: "Enviar sin contrato" }).click();
  const result = page.getByRole("dialog", { name: "Invitación creada" });
  // Local runs have no mail provider: the message stays in the outbox and the link is the way to share it.
  await expect(result).toContainText("el envío no está configurado");
  const link = await result.getByLabel("Enlace de invitación").inputValue();
  expect(link).toMatch(/\/invitacion\/d_[a-f0-9]{64}$/);
  return { result, link: new URL(link).pathname };
}

test("HL-167 ST-121: administration invites by e-mail, the person accepts from the link and enters; a revoked link stops working", async ({ page, browser }, info) => {
  const stamp = `${info.project.name}-${Date.now().toString(36)}`, name = e2eName(info, "Invitada"), revokedName = e2eName(info, "Revocada");
  await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
  await signIn(page, "admin-demo", "/educadores");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Educadores");

  // CA1: e-mail, name and role; the result shows whether it was sent and the link to copy.
  await page.getByRole("button", { name: "Invitar por correo" }).click();
  await audit(page, "invitar por correo");
  await page.getByRole("dialog", { name: "Invitar por correo" }).getByRole("button", { name: "Cancelar" }).click();
  const { result, link } = await invite(page, `invitada-${stamp}@example.test`, name, "educator");
  await result.getByRole("button", { name: "Copiar enlace" }).click();
  await expect(toast(page)).toContainText("Enlace copiado");
  await audit(page, "invitación creada");
  await result.getByRole("button", { name: "Listo" }).click();
  const invitations = page.getByRole("region", { name: "Invitaciones" });
  const row = invitations.getByRole("row", { name: new RegExp(name) });
  await expect(row).toContainText("Pendiente");
  await expect(row).toContainText("Sin envío configurado");
  await expectRecentActivity(page, `invitó a ${name}`);

  // CA2: the person opens the link without a session, chooses a username and password and lands signed in.
  const context = await browser.newContext({ viewport: page.viewportSize() });
  const guest = await context.newPage();
  await guest.goto(link);
  await expect(guest.getByRole("heading", { level: 1 })).toContainText("Únete a");
  await expect(guest.getByText("Educador", { exact: true })).toBeVisible();
  await audit(guest, "aceptar invitación");
  await guest.getByLabel("Usuario", { exact: true }).fill(`inv-${stamp}`);
  await guest.getByLabel("Contraseña", { exact: true }).fill("Una frase para recordar 2026");
  await guest.getByLabel("Repite la contraseña").fill("Una frase distinta 2026");
  await guest.getByRole("button", { name: "Crear cuenta y entrar" }).click();
  await expect(guest.getByRole("alert")).toContainText("no coinciden");
  await guest.getByLabel("Repite la contraseña").fill("Una frase para recordar 2026");
  await guest.getByRole("button", { name: "Crear cuenta y entrar" }).click();
  // ST-122: a new account lands on its welcome.
  await expect(guest.getByRole("heading", { level: 1 })).toHaveText("Bienvenida");
  expect(await guest.evaluate(async () => (await (await fetch("/api/session")).json()).member.displayName)).toBe(name);
  // The used link no longer opens.
  await guest.goto(link);
  await expect(guest.getByRole("heading", { level: 1 })).toHaveText("Esta invitación ya se usó");

  await page.reload();
  await page.getByRole("navigation", { name: "Secciones de educadores" }).getByRole("link", { name: "Invitaciones" }).click();
  await expect(page.getByRole("region", { name: "Invitaciones" }).getByRole("row", { name: new RegExp(name) })).toContainText("Aceptada");
  await page.getByRole("navigation", { name: "Secciones de educadores" }).getByRole("link", { name: "Personas" }).click();
  await expect(page.getByRole("region", { name: "Personas de la organización" })).toContainText(`invitada-${stamp}@example.test`);

  // CA3: revoking asks for confirmation, invalidates the link and is recorded.
  const second = await invite(page, `revocada-${stamp}@example.test`, revokedName, "admin");
  await second.result.getByRole("button", { name: "Listo" }).click();
  const revokedRow = page.getByRole("region", { name: "Invitaciones" }).getByRole("row", { name: new RegExp(revokedName) });
  await revokedRow.getByRole("button", { name: `Acciones de la invitación de ${revokedName}` }).click();
  await page.getByRole("menuitem", { name: "Revocar" }).click();
  await page.getByRole("dialog", { name: `¿Revocar la invitación de ${revokedName}?` }).getByRole("button", { name: "Revocar invitación" }).click();
  await expect(revokedRow).toContainText("Revocada");
  await expectRecentActivity(page, `revocó la invitación de ${revokedName}`);
  await guest.goto(second.link);
  await expect(guest.getByRole("heading", { level: 1 })).toHaveText("Esta invitación fue revocada");
  await audit(guest, "invitación revocada");
  await context.close();
});
