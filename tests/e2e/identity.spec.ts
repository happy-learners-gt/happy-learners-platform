import AxeBuilder from "@axe-core/playwright";
import type { Page } from "@playwright/test";
import { test, expect } from "./local-test";
import { completeOnboarding, origin, sessionToken, signIn } from "./helpers";
import { fromBase32, stepOf, totpAt } from "../../packages/domain/src/index";

const wcag = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];
async function audit(page: Page, label: string) {
  await page.waitForLoadState("networkidle");
  await page.waitForTimeout(400);
  const { violations } = await new AxeBuilder({ page }).withTags(wcag).analyze();
  expect(violations.map(item => `${label}: ${item.id} · ${item.nodes.map(node => node.target.join(" ")).slice(0, 3).join(" | ")}`)).toEqual([]);
}
const password = "Una frase para recordar 2026";
/** A new educator of this run with their own password, signed in through the API. */
async function newPerson(username: string) {
  // The cached session of the helpers: signing in each run would spend the 30 sign-ins per address the suite shares.
  const admin = `hl_session=${await sessionToken("admin-demo")}`;
  const created = await (await fetch(`${origin}/api/members`, { method: "POST", headers: { Origin: origin, "Content-Type": "application/json", Cookie: admin }, body: JSON.stringify({ displayName: `E2E · ${username}`, username, role: "educator" }) })).json() as { temporaryPassword: string };
  const first = (await fetch(`${origin}/api/login`, { method: "POST", headers: { Origin: origin, "Content-Type": "application/json" }, body: JSON.stringify({ username, password: created.temporaryPassword }) })).headers.get("set-cookie")!.split(";")[0];
  expect((await fetch(`${origin}/api/account/password`, { method: "POST", headers: { Origin: origin, "Content-Type": "application/json", Cookie: first }, body: JSON.stringify({ currentPassword: created.temporaryPassword, newPassword: password }) })).status).toBe(200);
  await completeOnboarding(first.split("=")[1], "Pedagogía", password);
  return first.split("=")[1];
}

test("REL-007 ST-134 ST-130: the sign-in page offers recovering the password and a link, with the same answer for anyone", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "¿Olvidaste tu contraseña?" }).click();
  await expect(page.getByRole("heading", { name: "Recuperar la contraseña" })).toBeVisible();
  await page.getByLabel("Usuario o correo de acceso").fill("nadie-en-e2e");
  await page.getByRole("button", { name: "Enviar enlace" }).click();
  await expect(page.getByRole("status")).toContainText("Si la cuenta existe");
  await audit(page, "recuperar la contraseña");
  await page.getByRole("button", { name: "Volver a iniciar sesión" }).click();
  await page.getByRole("button", { name: "Entrar con un enlace por correo" }).click();
  await expect(page.getByRole("heading", { name: "Entrar con un enlace por correo" })).toBeVisible();
  // A link that does not exist says so, without signing anyone in.
  await page.goto(`/entrar/d_${"0".repeat(64)}`);
  await expect(page.getByRole("alert")).toContainText("no existe");
});

test("REL-007 ST-133: a person turns on two-step verification from their account and then signs in with a code", async ({ page }, info) => {
  const username = `e2e-mfa-${info.project.name}-${Date.now().toString(36)}`;
  const session = await newPerson(username);
  await page.context().addCookies([{ name: "hl_session", value: session, url: origin, httpOnly: true, sameSite: "Strict" }]);
  await page.goto("/mi-cuenta/cuenta");
  const section = page.locator("#dos-pasos");
  await section.getByRole("button", { name: "Activar la verificación en dos pasos" }).click();
  await section.getByLabel("Tu contraseña actual").fill(password);
  await section.getByRole("button", { name: "Continuar" }).click();
  const key = (await section.getByLabel("Clave para tu aplicación").textContent())!;
  await audit(page, "activar la verificación en dos pasos");
  await section.getByLabel("Código de verificación").fill(await totpAt(fromBase32(key)!, stepOf(Date.now())));
  await section.getByRole("button", { name: "Activar" }).click();
  await expect(section.getByRole("region", { name: "Códigos de recuperación" }).getByRole("listitem")).toHaveCount(10);
  await section.getByLabel("Ya guardé mis códigos en un lugar seguro").check();
  await section.getByRole("button", { name: "Terminar" }).click();
  await expect(section).toContainText("Activa desde el");
  // Signing in again asks for the code after the password.
  await page.context().clearCookies();
  await page.goto("/");
  await page.getByLabel("Usuario", { exact: true }).fill(username);
  await page.getByLabel("Contraseña", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Entrar", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Verificación en dos pasos" })).toBeVisible();
  await audit(page, "segundo paso");
  await page.getByLabel("Código de verificación").fill(await totpAt(fromBase32(key)!, stepOf(Date.now()) + 1));
  await page.getByRole("button", { name: "Verificar" }).click();
  // The space opens: the sign-in page is gone and the menu is there.
  await expect(page.getByRole("heading", { name: "Iniciar sesión" })).toHaveCount(0);
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
});

test("REL-007 ST-134 ST-138 ST-136: administration sees the access policy, the institution's provider and the tokens", async ({ page }) => {
  await signIn(page, "admin-demo", "/seguridad#politicas");
  await expect(page.getByLabel("Longitud mínima de las contraseñas")).toHaveValue("12");
  await expect(page.getByRole("group", { name: "Exigir la verificación en dos pasos" })).toBeVisible();
  await audit(page, "política de acceso");
  await page.getByRole("link", { name: "Proveedor institucional" }).click();
  await expect(page.getByLabel("Emisor (issuer)")).toBeVisible();
  await expect(page.getByText("/api/auth/callback/sso")).toBeVisible();
  await audit(page, "proveedor institucional");
  await page.getByRole("link", { name: "Tokens", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Tokens de integración" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Revisión de accesos" })).toHaveAttribute("href", "/api/security/access-review");
});
