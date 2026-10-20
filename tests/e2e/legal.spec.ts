import AxeBuilder from "@axe-core/playwright";
import type { Page } from "@playwright/test";
import { test, expect } from "./local-test";
import { signIn, signInWithForm, toast } from "./helpers";

// ST-126 (HL-172), ST-127 (HL-173). Publishing a version gates every account of its organization, so this flow uses the
// fictional external organization and leaves both of its accounts with the versions in force accepted.
const wcag = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];
async function audit(page: Page, label: string) {
  await page.waitForLoadState("networkidle");
  await page.waitForTimeout(400);
  const { violations } = await new AxeBuilder({ page }).withTags(wcag).analyze();
  expect(violations.map(item => `${label}: ${item.id} · ${item.nodes.map(node => node.target.join(" ")).slice(0, 3).join(" | ")}`)).toEqual([]);
}
const gate = (page: Page) => page.getByRole("heading", { level: 1, name: "Acepta los términos y la política de privacidad" });
// Since ST-153 the terms are signed: full name and the account's password; the privacy consent alone is not.
async function acceptAll(page: Page, fullName: string) {
  await expect(gate(page)).toBeVisible();
  const accept = page.getByRole("button", { name: /^(Aceptar|Firmar) y continuar$/ });
  await expect(page.getByRole("checkbox").first()).toBeVisible();
  await expect(accept).toBeDisabled();
  for (const box of await page.getByRole("checkbox").all()) await box.check();
  if (await page.getByRole("group", { name: "Firma electrónica" }).count()) {
    await expect(accept).toHaveText("Firmar y continuar");
    await page.getByLabel("Nombre completo").fill(fullName);
    await page.getByLabel("Contraseña de tu cuenta").fill("Aprender-2026!");
  }
  await accept.click();
  await expect(gate(page)).toBeHidden();
}
async function publish(page: Page, kind: "Términos y condiciones" | "Política de privacidad", title: string, body: string) {
  const editor = page.getByRole("form", { name: `Borrador de ${kind.toLowerCase()}` });
  await editor.getByLabel(`Título de ${kind.toLowerCase()}`).fill(title);
  await editor.getByRole("textbox", { name: `Texto de ${kind.toLowerCase()}` }).fill(body);
  await editor.getByRole("button", { name: "Guardar borrador" }).click();
  await expect(toast(page)).toContainText("Borrador guardado");
  await editor.getByRole("button", { name: "Publicar nueva versión" }).click();
  await page.getByRole("dialog").getByRole("button", { name: /^Publicar versión \d+$/ }).click();
}

test("ST-126 ST-127: administration publishes terms and privacy, the next sign-in must accept them, consent can be withdrawn, and the policy is public", async ({ page, browser }, info) => {
  test.setTimeout(120_000);
  const stamp = `${info.project.name} ${Date.now()}`;
  // Administration publishes the terms; publishing asks its own account to accept them before continuing.
  await signIn(page, "admin-externo", "/contratos#politicas");
  await expect(page.getByRole("heading", { name: "Términos y privacidad" })).toBeVisible();
  await publish(page, "Términos y condiciones", `Términos ficticios ${stamp}`, "Texto ficticio de los términos de la demostración.\n\nNo contiene datos reales.");
  await acceptAll(page, "Administración Externa Ficticia");
  await expect(page.getByRole("heading", { name: "Términos y privacidad" })).toBeVisible();
  await publish(page, "Política de privacidad", `Privacidad ficticia ${stamp}`, "Texto ficticio de la política de privacidad de la demostración.");
  await acceptAll(page, "Administración Externa Ficticia");
  await audit(page, "organización con términos y privacidad");

  // The educator's next sign-in shows the documents before the app; nothing opens until both are accepted.
  const educator = await browser.newContext({ baseURL: info.project.use.baseURL });
  const learner = await educator.newPage();
  await signInWithForm(learner, "externo-demo", "/inicio");
  await expect(gate(learner)).toBeVisible();
  await expect(learner.getByRole("region", { name: `Texto de Términos ficticios ${stamp}` })).toContainText("No contiene datos reales.");
  await audit(learner, "aceptar términos y privacidad");
  await acceptAll(learner, "Educador Externo Ficticio");
  await expect(learner.getByRole("heading", { level: 1 })).toHaveText("Inicio");

  // Withdrawing the privacy consent is recorded and closes the platform until consent is given again.
  await learner.goto("/ayuda");
  await learner.getByRole("button", { name: "Retirar consentimiento" }).click();
  await learner.getByRole("dialog").getByRole("button", { name: "Retirar consentimiento" }).click();
  await expect(gate(learner)).toBeVisible();
  await expect(learner.getByRole("checkbox")).toHaveCount(1);
  await acceptAll(learner, "Educador Externo Ficticio");
  await educator.close();

  // Administration sees who accepted which version and when, including the withdrawal.
  await page.reload();
  const records = page.getByRole("region", { name: "Registro de aceptaciones" });
  await expect(records.getByRole("row").filter({ hasText: "Educador externo" }).filter({ hasText: "Retirado el" })).not.toHaveCount(0);
  await expect(records.getByRole("row").filter({ hasText: "Educador externo" }).filter({ hasText: "Términos y condiciones" })).not.toHaveCount(0);
  // ST-153: the terms carry the electronic signature with the name as typed.
  await expect(records.getByRole("row").filter({ hasText: "Términos y condiciones" }).filter({ hasText: "Firmada como «Educador Externo Ficticio»" })).not.toHaveCount(0);

  // The policy in force is public: the login links to it and it opens without a session.
  const visitor = await browser.newContext({ baseURL: info.project.use.baseURL });
  const anonymous = await visitor.newPage();
  await anonymous.goto("/");
  await anonymous.getByRole("link", { name: "Política de privacidad" }).click();
  await expect(anonymous.getByRole("heading", { level: 1, name: "Política de privacidad" })).toBeVisible();
  await expect(anonymous.getByRole("heading", { level: 2, name: `Privacidad ficticia ${stamp}` })).toBeVisible();
  await audit(anonymous, "política de privacidad pública");
  await anonymous.goto("/privacidad?organizacion=org-other");
  await expect(anonymous.getByRole("heading", { level: 2, name: `Privacidad ficticia ${stamp}` })).toBeVisible();
  await visitor.close();
});
