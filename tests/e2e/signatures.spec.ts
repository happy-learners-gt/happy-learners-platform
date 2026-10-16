import { readFileSync, writeFileSync } from "node:fs";
import AxeBuilder from "@axe-core/playwright";
import type { Page } from "@playwright/test";
import { test, expect } from "./local-test";
import { signIn, signInWithForm, toast } from "./helpers";

// ST-151, ST-153: the volunteer agreement is published in the fictional external organization, so no other suite
// waits for it; it only blocks teaching, and that organization has no classes. Its educator signs every run's version.
const wcag = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];
async function audit(page: Page, label: string) {
  await page.waitForLoadState("networkidle");
  await page.waitForTimeout(400);
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

test("ST-151 ST-153: administration publishes the volunteer agreement, the educator signs it with name and password and downloads the receipt, and administration verifies it", async ({ page, browser }, info) => {
  test.setTimeout(120_000);
  const stamp = `${info.project.name} ${Date.now()}`;
  await signIn(page, "admin-externo", "/organizacion");
  await passGate(page, "Administración Externa Ficticia");
  const kind = "acuerdo de voluntariado ad honorem";
  const editor = page.getByRole("form", { name: `Borrador de ${kind}` });
  await editor.getByLabel(`Título de ${kind}`).fill(`Acuerdo ficticio ${stamp}`);
  await editor.getByLabel(`Texto de ${kind}`).fill("Texto ficticio del acuerdo de voluntariado ad honorem.\n\nLa actividad es voluntaria y sin remuneración económica.");
  await editor.getByRole("button", { name: "Guardar borrador" }).click();
  await expect(toast(page)).toContainText("Borrador guardado");
  await editor.getByRole("button", { name: "Publicar nueva versión" }).click();
  await page.getByRole("dialog").getByRole("button", { name: /^Publicar versión \d+$/ }).click();
  await expect(toast(page)).toContainText("Cada educador la firmará antes de impartir clases");

  // The educator sees why classes wait and signs: a wrong password is refused, then the name and password sign.
  const context = await browser.newContext({ baseURL: info.project.use.baseURL, acceptDownloads: true });
  const educator = await context.newPage();
  await signInWithForm(educator, "externo-demo", "/inicio");
  await passGate(educator, "Educador Externo Ficticio");
  const banner = educator.getByRole("region", { name: "Acuerdo de voluntariado pendiente" });
  await expect(banner).toBeVisible();
  await audit(educator, "aviso del acuerdo pendiente");
  await banner.getByRole("button", { name: "Leer y firmar el acuerdo" }).click();
  const dialog = educator.getByRole("dialog");
  await expect(dialog.getByRole("region", { name: `Texto de Acuerdo ficticio ${stamp}` })).toContainText("sin remuneración económica");
  await expect(dialog.getByRole("group", { name: "Firma electrónica" })).toContainText("Firmo electrónicamente");
  await audit(educator, "firmar el acuerdo");
  await dialog.getByLabel("Nombre completo").fill("Educador Externo Ficticio");
  await dialog.getByLabel("Contraseña de tu cuenta").fill("no-es-la-clave");
  await dialog.getByRole("button", { name: "Firmar", exact: true }).click();
  await expect(dialog.getByRole("alert")).toContainText("La contraseña no es correcta");
  await dialog.getByLabel("Contraseña de tu cuenta").fill("Aprender-2026!");
  await dialog.getByRole("button", { name: "Firmar", exact: true }).click();
  await expect(dialog.getByRole("heading", { name: "Firma registrada" })).toBeVisible();
  const [download] = await Promise.all([educator.waitForEvent("download"), dialog.getByRole("link", { name: "Descargar constancia" }).click()]);
  expect(download.suggestedFilename()).toMatch(/^constancia-signature-[a-z0-9-]+\.html$/);
  const receipt = info.outputPath("constancia.html");
  await download.saveAs(receipt);
  const html = readFileSync(receipt, "utf8");
  expect(html).toContain("Constancia de firma electrónica");
  expect(html).toContain("Educador Externo Ficticio");
  await dialog.getByRole("button", { name: "Cerrar" }).last().click();
  await expect(banner).toBeHidden();
  await context.close();

  // Administration sees the signature and verifies the receipt; a changed receipt or another document is detected.
  await page.reload();
  const records = page.getByRole("region", { name: "Registro de firmas" });
  await expect(records.getByRole("row").filter({ hasText: "Educador Externo Ficticio" }).filter({ hasText: "Acuerdo de voluntariado ad honorem" })).not.toHaveCount(0);
  const verify = async (path: string) => {
    await page.getByLabel("Archivo de la constancia").setInputFiles(path);
    await page.getByRole("button", { name: "Verificar", exact: true }).click();
  };
  const result = page.locator(".signature-result");
  await verify(receipt);
  await expect(result).toContainText("Firma válida");
  await audit(page, "firmas y verificación");
  const renamed = info.outputPath("constancia-modificada.html");
  writeFileSync(renamed, html.replace(/"signedName":"[^"]+"/, '"signedName":"Otra Persona"'));
  await verify(renamed);
  await expect(result).toContainText("Constancia modificada");
  const otherDocument = info.outputPath("constancia-otro-documento.html");
  writeFileSync(otherDocument, html.replace(/"documentSha256":"[a-f0-9]{64}"/, `"documentSha256":"${"0".repeat(64)}"`));
  await verify(otherDocument);
  await expect(result).toContainText("El documento no coincide");
});
