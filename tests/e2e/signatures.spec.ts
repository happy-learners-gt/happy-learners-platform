import { readFileSync, writeFileSync } from "node:fs";
import AxeBuilder from "@axe-core/playwright";
import type { Page } from "@playwright/test";
import { test, expect } from "./local-test";
import { signIn, signInWithForm, toast } from "./helpers";

// DEC-046: the volunteer agreement is a contract template. This suite uses the fictional external organization
// so no other suite waits for the contract it sends; it only blocks teaching, and that organization has no classes.
const wcag = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];
async function audit(page: Page, label: string) {
  await page.waitForLoadState("networkidle");
  await page.waitForTimeout(400);
  // Measure the page at rest at its top: a control the previous step left scrolled under the sticky top bar shows a
  // few pixels that axe's target-size check reads as a target crowded by the bar's buttons, an artifact of the scroll.
  await page.evaluate(() => scrollTo(0, 0));
  const { violations } = await new AxeBuilder({ page }).withTags(wcag).analyze();
  expect(violations.map(item => `${label}: ${item.id} · ${item.nodes.map(node => node.target.join(" ")).slice(0, 3).join(" | ")}`)).toEqual([]);
}
/** If another suite left terms to accept in this organization, sign them first. */
async function passGate(page: Page, fullName: string) {
  const gate = page.getByRole("heading", { level: 1, name: "Acepta los términos y la política de privacidad" });
  await page.waitForLoadState("networkidle");
  if (!await gate.count()) return;
  for (const box of await page.getByRole("checkbox").all()) await box.check();
  if (await page.getByRole("group", { name: "Firma electrónica" }).count()) {
    await page.getByLabel("Nombre completo").fill(fullName);
    await page.getByLabel("Contraseña de tu cuenta").fill("Aprender-2026!");
  }
  await page.getByRole("button", { name: /^(Aceptar|Firmar) y continuar$/ }).click();
  await expect(gate).toBeHidden();
}
const today = () => new Date().toLocaleDateString("en-CA", { timeZone: "America/Guatemala" });

test("ST-151 ST-153: administration publishes a contract template, the educator signs it with name and password and downloads the receipt, and administration verifies it", async ({ page, browser }, info) => {
  test.setTimeout(120_000);
  const stamp = `${info.project.name} ${Date.now()}`;
  const title = `Acuerdo ficticio ${stamp}`;
  await signIn(page, "admin-externo", "/contratos");
  await passGate(page, "Administración Externa Ficticia");
  await page.getByRole("button", { name: "Nueva plantilla" }).click();
  const create = page.getByRole("dialog", { name: "Nueva plantilla" });
  await create.getByLabel("Nombre").fill(title);
  await create.getByLabel("Tipo de relación").selectOption("volunteer");
  await create.getByRole("button", { name: "Crear y editar" }).click();
  await expect(page.getByRole("heading", { level: 2, name: title })).toBeVisible();
  await page.getByRole("button", { name: "Publicar" }).click();
  await page.getByRole("dialog", { name: "Publicar plantilla" }).getByRole("button", { name: "Publicar versión" }).click();
  await expect(toast(page)).toContainText("Versión publicada");

  await page.goto("/contratos#contratos");
  await page.getByRole("button", { name: "Nuevo contrato" }).click();
  const draft = page.getByRole("dialog", { name: "Nuevo contrato" });
  await draft.getByLabel("Persona").selectOption({ label: "Educador externo" });
  await draft.getByLabel("Plantilla").selectOption({ label: title });
  await draft.getByLabel("Inicio").fill(today());
  await draft.getByRole("button", { name: "Crear borrador" }).click();
  const drawer = page.getByRole("dialog", { name: title });
  await expect(drawer).toBeVisible();
  await drawer.getByRole("button", { name: "Enviar" }).click();
  const send = page.getByRole("dialog", { name: "Firmar y enviar" });
  await send.getByLabel("Nombre completo").fill("Administración Externa Ficticia");
  await send.getByLabel("Contraseña de tu cuenta").fill("Aprender-2026!");
  await send.getByRole("button", { name: "Firmar y enviar" }).click();
  await expect(toast(page)).toContainText("Contrato actualizado");

  const context = await browser.newContext({ baseURL: info.project.use.baseURL, acceptDownloads: true });
  const educator = await context.newPage();
  await signInWithForm(educator, "externo-demo", "/inicio");
  await passGate(educator, "Educador Externo Ficticio");
  const banner = educator.getByRole("region", { name: "Contrato pendiente de firma" });
  await expect(banner).toBeVisible();
  await audit(educator, "aviso del contrato pendiente");
  await banner.getByRole("link", { name: "Leer y firmar" }).click();
  await expect(educator).toHaveURL(/\/mi-cuenta\/contratos/);
  await educator.getByRole("button", { name: "Firmar", exact: true }).click();
  const dialog = educator.getByRole("dialog", { name: "Firmar contrato" });
  await expect(dialog).toContainText("Firmas");
  await audit(educator, "firmar el contrato");
  await dialog.getByLabel("Nombre completo").fill("Educador Externo Ficticio");
  await dialog.getByLabel("Contraseña de tu cuenta").fill("no-es-la-clave");
  await dialog.getByRole("button", { name: "Firmar", exact: true }).click();
  await expect(dialog.getByRole("alert")).toContainText("La contraseña no es correcta");
  await dialog.getByLabel("Contraseña de tu cuenta").fill("Aprender-2026!");
  await dialog.getByRole("button", { name: "Firmar", exact: true }).click();
  await expect(educator.getByRole("heading", { name: "Firma registrada" })).toBeVisible();
  const [download] = await Promise.all([educator.waitForEvent("download"), educator.getByRole("dialog").getByRole("link", { name: "Descargar constancia" }).click()]);
  expect(download.suggestedFilename()).toMatch(/^constancia-contract-[a-z0-9-]+\.html$/);
  const receipt = info.outputPath("constancia.html");
  await download.saveAs(receipt);
  const html = readFileSync(receipt, "utf8");
  expect(html).toContain("Constancia de contrato");
  expect(html).toContain("Educador Externo Ficticio");
  await educator.getByRole("button", { name: "Cerrar" }).last().click();
  await expect(banner).toBeHidden();
  await context.close();

  await page.reload();
  await page.goto("/contratos#contratos");
  const verify = async (path: string) => {
    await page.getByLabel("Archivo de la constancia").setInputFiles(path);
    await page.getByRole("button", { name: "Verificar", exact: true }).click();
  };
  const result = page.locator(".signature-result");
  await verify(receipt);
  await expect(result).toContainText("Contrato válido");
  await audit(page, "contratos y verificación");
  const renamed = info.outputPath("constancia-modificada.html");
  writeFileSync(renamed, html.replace(/"signedName":"[^"]+"/, '"signedName":"Otra Persona"'));
  await verify(renamed);
  await expect(result).toContainText("Constancia modificada");
  const otherDocument = info.outputPath("constancia-otro-documento.html");
  writeFileSync(otherDocument, html.replace(/"documentSha256":"[a-f0-9]{64}"/, `"documentSha256":"${"0".repeat(64)}"`));
  await verify(otherDocument);
  await expect(result).toContainText("El documento no coincide");
});
