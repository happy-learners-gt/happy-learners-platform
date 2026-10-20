import AxeBuilder from "@axe-core/playwright";
import { readFileSync } from "node:fs";
import type { APIRequestContext, Page, TestInfo } from "@playwright/test";
import { test, expect } from "./local-test";
import { completeOnboarding, e2eName, invitedAccount, origin, sessionToken, toast } from "./helpers";

const wcag = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];
async function audit(page: Page, label: string) {
  await page.waitForLoadState("networkidle");
  await page.waitForTimeout(400);
  const { violations } = await new AxeBuilder({ page }).withTags(wcag).analyze();
  expect(violations.map(item => `${label}: ${item.id} · ${item.nodes.map(node => node.target.join(" ")).slice(0, 3).join(" | ")}`)).toEqual([]);
}
const iphone = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1";
const password = "Mi cuenta de prueba 2026";
async function signInApi(username: string, agent?: string) {
  const response = await fetch(`${origin}/api/login`, { method: "POST", headers: { Origin: origin, "Content-Type": "application/json", ...(agent ? { "User-Agent": agent } : {}) }, body: JSON.stringify({ username, password }) });
  expect(response.status, await response.clone().text()).toBe(200);
  return /hl_session=([^;]+)/.exec(response.headers.get("set-cookie") || "")![1];
}
/**
 * A new educator with their own password, so closing sessions or asking to close the account never touches the demo
 * accounts the other suites reuse. Terms another suite published are signed first; the welcome is completed.
 */
async function freshAccount(admin: APIRequestContext, info: TestInfo, label: string) {
  const name = e2eName(info, label), username = `e2e-${label.toLowerCase()}-${info.project.name}-${Date.now().toString(36)}`;
  const created = await admin.post("/api/members", { data: { displayName: name, username, role: "educator" } });
  expect(created.status(), await created.text()).toBe(201);
  const { member, temporaryPassword } = await created.json() as { member: { id: string }; temporaryPassword: string };
  const first = await fetch(`${origin}/api/login`, { method: "POST", headers: { Origin: origin, "Content-Type": "application/json" }, body: JSON.stringify({ username, password: temporaryPassword }) });
  const session = /hl_session=([^;]+)/.exec(first.headers.get("set-cookie") || "")![1];
  const headers = { Origin: origin, "Content-Type": "application/json", Cookie: `hl_session=${session}` };
  expect((await fetch(`${origin}/api/account/password`, { method: "POST", headers, body: JSON.stringify({ currentPassword: temporaryPassword, newPassword: password }) })).status).toBe(200);
  const pending = (await (await fetch(`${origin}/api/session`, { headers })).json()).pending as { id: string }[];
  if (pending.length) expect((await fetch(`${origin}/api/legal/accept`, { method: "POST", headers, body: JSON.stringify({ documentIds: pending.map(item => item.id), signature: { fullName: name, password } }) })).status).toBe(200);
  await completeOnboarding(session);
  return { id: member.id, name, username, session };
}
const useSession = (page: Page, session: string) => page.context().addCookies([{ name: "hl_session", value: session, url: origin, httpOnly: true, sameSite: "Strict" }]);

test("HL-15 ST-158: the person adds a sign-in e-mail confirmed through the copied link, closes another session and reads their sign-in history", async ({ page, browser, playwright, baseURL }, info) => {
  const admin = await playwright.request.newContext({ baseURL, extraHTTPHeaders: { Origin: baseURL!, Cookie: `hl_session=${await sessionToken("admin-demo")}` } });
  const guestContext = await browser.newContext({ viewport: page.viewportSize() });
  try {
    const person = await freshAccount(admin, info, "Ajustes");
    const email = `${person.username}@ejemplo.test`;
    await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
    await useSession(page, person.session);
    await page.goto("/inicio");
    await page.getByRole("button", { name: /^Perfil de / }).click();
    await page.getByRole("menuitem", { name: "Cuenta" }).click();
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Cuenta");
    for (const section of ["Correo", "Contraseña", "Sesiones activas", "Historial de accesos", "Mis datos", "Cerrar la cuenta"]) await expect(page.getByRole("heading", { level: 2, name: section, exact: true })).toBeVisible();
    await expect(page.getByText(`@${person.username}`)).toBeVisible();
    await audit(page, "cuenta");

    // Criterion 2: the change asks for the password; without a mail provider the link is shown to copy.
    await page.getByRole("button", { name: "Agregar correo" }).click();
    const dialog = page.getByRole("dialog", { name: "Agregar correo de acceso" });
    await dialog.getByLabel("Nuevo correo").fill(email);
    await dialog.getByLabel("Contraseña actual").fill("No es la contraseña 2026");
    await dialog.getByRole("button", { name: "Enviar enlace" }).click();
    await expect(dialog.getByRole("alert")).toContainText("no es correcta");
    await dialog.getByLabel("Contraseña actual").fill(password);
    await dialog.getByRole("button", { name: "Enviar enlace" }).click();
    const issued = page.getByRole("dialog", { name: "Confirma tu nuevo correo" });
    await expect(issued).toContainText("no tiene configurado el envío de correo");
    const link = await issued.getByLabel("Enlace de confirmación").inputValue();
    expect(link).toMatch(/\/cuenta\/correo\/d_[a-f0-9]{64}$/);
    await issued.getByRole("button", { name: "Copiar enlace" }).click();
    await expect(toast(page)).toContainText("Enlace copiado");
    await audit(page, "enlace de confirmación");
    await issued.getByRole("button", { name: "Listo" }).click();
    await expect(page.getByRole("status").filter({ hasText: "Pendiente de confirmar" })).toContainText(email);

    // The link opens without a session; opening it alone confirms nothing.
    const guest = await guestContext.newPage();
    await guest.goto(new URL(link).pathname);
    await expect(guest.getByRole("heading", { level: 1 })).toHaveText("Confirma tu nuevo correo");
    await expect(guest.getByText(email)).toBeVisible();
    await audit(guest, "confirmar correo");
    await guest.getByRole("button", { name: "Confirmar correo" }).click();
    await expect(guest.getByRole("heading", { level: 1 })).toHaveText("Correo confirmado");
    await guest.goto(new URL(link).pathname);
    await expect(guest.getByRole("heading", { level: 1 })).toHaveText("Este correo ya está confirmado");
    await page.reload();
    await expect(page.locator(".profile-facts")).toContainText(email);
    await expect(page.getByText("Pendiente de confirmar")).toHaveCount(0);

    // Criteria 3 and 4: another session (an iPhone) appears with its device; it is closed from here.
    const other = await signInApi(person.username, iphone);
    await page.reload();
    const sessions = page.getByRole("region", { name: "Lista de sesiones activas" });
    await expect(sessions.getByRole("row")).toHaveCount(3);
    await expect(sessions.getByRole("row", { name: /Esta sesión/ })).toBeVisible();
    await sessions.getByRole("button", { name: "Cerrar la sesión en Safari en iPhone" }).click();
    await page.getByRole("dialog", { name: "¿Cerrar la sesión en Safari en iPhone?" }).getByRole("button", { name: "Cerrar sesión" }).click();
    await expect(toast(page)).toContainText("Sesión en Safari en iPhone cerrada.");
    await expect(sessions.getByRole("row")).toHaveCount(2);
    expect((await fetch(`${origin}/api/session`, { headers: { Cookie: `hl_session=${other}` } })).status).toBe(401);
    expect((await fetch(`${origin}/api/session`, { headers: { Cookie: `hl_session=${person.session}` } })).status).toBe(200);

    // Criterion 5: the sign-in history lists the own sign-ins with their device.
    const history = page.getByRole("region", { name: "Lista de accesos recientes" });
    await expect(history.getByRole("row")).toHaveCount(3);
    await expect(history).toContainText("Safari en iPhone");
    await expect(history.getByText("Correcto").first()).toBeVisible();
    await audit(page, "cuenta con sesiones e historial");
  } finally {
    await guestContext.close();
    await admin.dispose();
  }
});

test("HL-15 ST-159: the person downloads their data, asks to close the account and cancels; asked again, administration starts it and the departure completes it", async ({ page, browser, playwright, baseURL }, info) => {
  const admin = await playwright.request.newContext({ baseURL, extraHTTPHeaders: { Origin: baseURL!, Cookie: `hl_session=${await sessionToken("admin-demo")}` } });
  const adminContext = await browser.newContext({ viewport: page.viewportSize() });
  try {
    // Only the account is new here; its sign-in history is the other test's, so it does not spend a sign-in.
    const person = await invitedAccount(admin, info, "Cierre", password);
    await useSession(page, person.session);
    await page.goto("/cuenta#datos");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Cuenta");

    // Criterion 1: the JSON download holds the person's own records only.
    const download = page.waitForEvent("download");
    await page.getByRole("link", { name: "Descargar mis datos" }).click();
    const file = await download;
    expect(file.suggestedFilename()).toMatch(new RegExp(`^mis-datos-${person.username}-\\d{4}-\\d{2}-\\d{2}\\.json$`));
    const data = JSON.parse(readFileSync((await file.path())!, "utf8"));
    expect(data.account).toMatchObject({ id: person.id, username: person.username, role: "educator" });
    expect(data.sections.map((item: { key: string }) => item.key)).toContain("consents");
    expect(JSON.stringify(data)).not.toMatch(/password_hash|token_hash|admin-demo/);

    // Criterion 2: asking and cancelling before administration starts it.
    const closing = page.locator("#cierre");
    await closing.getByLabel("Motivo").fill("Cambio de trabajo");
    await closing.getByRole("button", { name: "Solicitar el cierre" }).click();
    await page.getByRole("dialog", { name: "¿Pedir el cierre de tu cuenta?" }).getByRole("button", { name: "Solicitar el cierre" }).click();
    await expect(toast(page)).toContainText("Solicitud enviada a administración.");
    await expect(closing.getByText("Solicitado", { exact: true })).toBeVisible();
    await audit(page, "cierre solicitado");

    const adminPage = await adminContext.newPage();
    await adminContext.addCookies([{ name: "hl_session", value: await sessionToken("admin-demo"), url: origin, httpOnly: true, sameSite: "Strict" }]);
    await adminPage.goto("/educadores");
    const requests = adminPage.getByRole("region", { name: "Lista de solicitudes de cierre" });
    await expect(requests.getByRole("row", { name: new RegExp(person.name) })).toContainText("Solicitado");
    await expect(requests.getByRole("row", { name: new RegExp(person.name) })).toContainText("Cambio de trabajo");

    await closing.getByRole("button", { name: "Cancelar la solicitud" }).click();
    await page.getByRole("dialog", { name: "¿Cancelar tu solicitud de cierre?" }).getByRole("button", { name: "Cancelar la solicitud" }).click();
    await expect(toast(page)).toContainText("Solicitud de cierre cancelada.");
    await expect(closing.getByRole("button", { name: "Solicitar el cierre" })).toBeVisible();
    await expect(closing.getByText("Solicitudes anteriores")).toBeVisible();
    await adminPage.reload();
    await expect(requests.getByRole("row", { name: new RegExp(person.name) })).toContainText("Cancelado");

    // Asked again, administration starts it and records the departure, which completes it.
    await closing.getByRole("button", { name: "Solicitar el cierre" }).click();
    await page.getByRole("dialog", { name: "¿Pedir el cierre de tu cuenta?" }).getByRole("button", { name: "Solicitar el cierre" }).click();
    await expect(closing.getByText("Solicitado", { exact: true })).toBeVisible();
    await adminPage.reload();
    const row = requests.getByRole("row", { name: new RegExp(person.name) }).filter({ hasText: "Solicitado" });
    await row.getByRole("button", { name: "Iniciar el cierre" }).click();
    await adminPage.getByRole("dialog", { name: `¿Iniciar el cierre de la cuenta de ${person.name}?` }).getByRole("button", { name: "Iniciar el cierre" }).click();
    const departure = adminPage.getByRole("dialog", { name: `Registrar la salida de ${person.name}` });
    await expect(departure.getByLabel("Fecha de salida")).toBeVisible();
    await page.reload();
    await expect(page.locator("#cierre").getByText("En curso", { exact: true })).toBeVisible();
    await expect(page.locator("#cierre").getByRole("button", { name: "Cancelar la solicitud" })).toHaveCount(0);
    await departure.getByRole("button", { name: "Registrar salida" }).click();
    await expect(toast(adminPage)).toContainText(`Salida de ${person.name} registrada`);
    await expect(requests.getByRole("row", { name: new RegExp(person.name) }).first()).toContainText("Completado");
    expect((await fetch(`${origin}/api/session`, { headers: { Cookie: `hl_session=${person.session}` } })).status).toBe(401);
    await audit(adminPage, "solicitudes de cierre");
  } finally {
    await adminContext.close();
    await admin.dispose();
  }
});
