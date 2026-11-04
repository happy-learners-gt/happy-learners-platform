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

test("REL-007 ST-133: a person adds an authenticator app by scanning, the code sends itself, and the next sign-in asks for it", async ({ page }, info) => {
  const username = `e2e-mfa-${info.project.name}-${Date.now().toString(36)}`;
  const session = await newPerson(username);
  await page.context().addCookies([{ name: "hl_session", value: session, url: origin, httpOnly: true, sameSite: "Strict" }]);
  await page.goto("/mi-cuenta/seguridad");
  await expect(page.getByRole("status").filter({ hasText: "Tu cuenta solo tiene contraseña" })).toBeVisible();
  await audit(page, "seguridad de la cuenta");
  await page.getByRole("button", { name: "Agregar un método" }).click();
  const chooser = page.getByRole("dialog", { name: "Agregar un método" });
  await expect(chooser.getByRole("button", { name: /Passkey/ })).toContainText("Recomendado");
  await chooser.getByRole("button", { name: /Aplicación de autenticación/ }).click();
  const wizard = page.getByRole("dialog", { name: "Aplicación de autenticación" });
  await expect(wizard.getByRole("img", { name: "Código QR para tu aplicación de autenticación" })).toBeVisible();
  await audit(page, "código QR");
  await wizard.getByRole("button", { name: "¿No puedes escanear? Escribe la clave" }).click();
  const key = (await wizard.getByLabel("Clave para tu aplicación").textContent())!;
  // Typing (or pasting) the six digits in the first box fills them all and sends the code.
  await wizard.getByLabel("Dígito 1 de 6").fill(await totpAt(fromBase32(key)!, stepOf(Date.now())));
  const codes = page.getByRole("dialog", { name: "Guarda tus códigos de recuperación" });
  await expect(codes.getByRole("listitem")).toHaveCount(10);
  await expect(codes.getByRole("button", { name: "Terminar" })).toBeDisabled();
  await codes.getByLabel("Ya guardé mis códigos en un lugar seguro").check();
  await codes.getByRole("button", { name: "Terminar" }).click();
  await expect(page.locator(".method-list")).toContainText("Aplicación de autenticación");
  await expect(page.getByRole("status").filter({ hasText: "Tu cuenta pide un segundo paso al entrar" })).toBeVisible();
  // Signing in again asks for the code after the password; it sends itself too.
  await page.context().clearCookies();
  await page.goto("/");
  await page.getByLabel("Usuario", { exact: true }).fill(username);
  await page.getByLabel("Contraseña", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Entrar", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Verificación en dos pasos" })).toBeVisible();
  await audit(page, "segundo paso");
  await page.getByLabel("Dígito 1 de 6").fill(await totpAt(fromBase32(key)!, stepOf(Date.now()) + 1));
  await expect(page.getByRole("heading", { name: "Iniciar sesión" })).toHaveCount(0);
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
});
