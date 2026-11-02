import AxeBuilder from "@axe-core/playwright";
import type { Page } from "@playwright/test";
import { test, expect } from "./local-test";
import { completeOnboarding, e2eName, origin, sessionToken, signIn, toast } from "./helpers";

const wcag = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];
async function audit(page: Page, label: string) {
  await page.waitForLoadState("networkidle");
  await page.waitForTimeout(400);
  const { violations } = await new AxeBuilder({ page }).withTags(wcag).analyze();
  expect(violations.map(item => `${label}: ${item.id} · ${item.nodes.map(node => node.target.join(" ")).slice(0, 3).join(" | ")}`)).toEqual([]);
}
const today = () => new Date().toLocaleDateString("en-CA", { timeZone: "America/Guatemala" });
const conflictReason = "Sección de prueba E2E; su horario puede coincidir con otras secciones de prueba.";

test("DEC-046: administration publishes a template, invites with a contract, the person signs it, and teaching waits for one in force", async ({ page, browser, playwright, baseURL }, info) => {
  test.setTimeout(180_000);
  const stamp = `${info.project.name}-${Date.now().toString(36)}`;
  const templateName = e2eName(info, "Plantilla");
  const invitee = e2eName(info, "Contratada");
  const blocked = e2eName(info, "Sin contrato");
  const password = "Una frase para firmar el contrato 2026";
  const admin = await playwright.request.newContext({ baseURL, extraHTTPHeaders: { Origin: baseURL!, Cookie: `hl_session=${await sessionToken("admin-demo")}` } });
  try {
    await signIn(page, "admin-demo", "/contratos");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Contratos y políticas");
    await page.getByRole("button", { name: "Nueva plantilla" }).click();
    const create = page.getByRole("dialog", { name: "Nueva plantilla" });
    await create.getByLabel("Nombre").fill(templateName);
    await create.getByLabel("Tipo de relación").selectOption("volunteer");
    await create.getByRole("button", { name: "Crear y editar" }).click();
    await expect(page.getByRole("heading", { level: 2, name: templateName })).toBeVisible();
    await audit(page, "editor de plantilla");
    await page.getByRole("button", { name: "Publicar" }).click();
    await page.getByRole("dialog", { name: "Publicar plantilla" }).getByRole("button", { name: "Publicar versión" }).click();
    await expect(toast(page)).toContainText("Versión publicada");

    await page.goto("/educadores");
    await page.getByRole("button", { name: "Invitar por correo" }).click();
    const invite = page.getByRole("dialog", { name: "Invitar por correo" });
    await invite.getByLabel("Correo", { exact: true }).fill(`contrato-${stamp}@example.test`);
    await invite.getByLabel("Nombre", { exact: true }).fill(invitee);
    await invite.getByRole("button", { name: "Continuar" }).click();
    await invite.getByLabel("Plantilla").selectOption({ label: `${templateName} · Voluntariado ad honorem` });
    await invite.getByLabel("Inicio").fill(today());
    await invite.getByRole("button", { name: "Continuar" }).click();
    await invite.getByLabel("Nombre completo").fill("Administración de la Demostración");
    await invite.getByLabel("Contraseña de tu cuenta").fill("Aprender-2026!");
    await invite.getByRole("button", { name: "Firmar y enviar" }).click();
    const issued = page.getByRole("dialog", { name: "Invitación creada" });
    await expect(issued).toBeVisible();
    const link = await issued.getByLabel("Enlace de invitación").inputValue();
    expect(link).toMatch(/\/invitacion\/d_[a-f0-9]{64}$/);
    await issued.getByRole("button", { name: "Listo" }).click();

    const context = await browser.newContext({ viewport: page.viewportSize() });
    const guest = await context.newPage();
    await guest.goto(new URL(link).pathname);
    await expect(guest.getByRole("heading", { level: 1 })).toContainText("Únete a");
    await expect(guest.getByRole("heading", { name: templateName })).toBeVisible();
    await audit(guest, "aceptar invitación con contrato");
    await guest.getByRole("checkbox", { name: "He leído y acepto" }).check();
    await guest.getByLabel("Nombre completo").fill(invitee);
    await guest.getByLabel("Usuario", { exact: true }).fill(`e2e-ct-${stamp}`);
    await guest.getByLabel("Contraseña", { exact: true }).fill(password);
    await guest.getByLabel("Repite la contraseña").fill(password);
    await guest.getByRole("button", { name: "Crear cuenta y entrar" }).click();
    await expect(guest.getByRole("heading", { level: 1 })).toHaveText("Acepta los términos y la política de privacidad");
    const cookie = (await guest.context().cookies()).find(item => item.name === "hl_session")?.value;
    expect(cookie).toBeTruthy();
    const guestHeaders = { Origin: origin, "Content-Type": "application/json", Cookie: `hl_session=${cookie}` };
    const guestPending = (await (await fetch(`${origin}/api/session`, { headers: guestHeaders })).json()).pending as { id: string }[];
    if (guestPending.length) expect((await fetch(`${origin}/api/legal/accept`, { method: "POST", headers: guestHeaders, body: JSON.stringify({ documentIds: guestPending.map(item => item.id), signature: { fullName: invitee, password } }) })).status).toBe(200);
    await completeOnboarding(cookie!, "Pedagogía", password);
    await guest.goto("/mi-cuenta/contratos");
    await expect(guest.getByRole("heading", { level: 1 })).toHaveText("Contratos");
    await expect(guest.getByRole("heading", { level: 2, name: templateName })).toBeVisible();
    await expect(guest.getByText("Vigente", { exact: true }).first()).toBeVisible();
    await audit(guest, "contratos de la persona");
    await context.close();

    await page.goto("/contratos#contratos");
    await expect(page.getByRole("region", { name: "Contratos" })).toContainText(invitee);
    await expect(page.getByRole("row", { name: new RegExp(invitee) })).toContainText("Vigente");

    const account = await admin.post("/api/members", { data: { displayName: blocked, username: `e2e-sin-${stamp}`, role: "educator" } });
    expect(account.status(), await account.text()).toBe(201);
    const { member, temporaryPassword } = await account.json() as { member: { id: string }; temporaryPassword: string };
    const login = await fetch(`${origin}/api/login`, { method: "POST", headers: { Origin: origin, "Content-Type": "application/json" }, body: JSON.stringify({ username: `e2e-sin-${stamp}`, password: temporaryPassword }) });
    const session = /hl_session=([^;]+)/.exec(login.headers.get("set-cookie") || "")![1];
    expect((await fetch(`${origin}/api/account/password`, { method: "POST", headers: { Origin: origin, "Content-Type": "application/json", Cookie: `hl_session=${session}` }, body: JSON.stringify({ currentPassword: temporaryPassword, newPassword: password }) })).status).toBe(200);
    await completeOnboarding(session, "Pedagogía", password);
    const course = await admin.post("/api/courses", { data: { title: e2eName(info, "Curso sin contrato"), objective: "Ver el diálogo al iniciar sin contrato vigente.", status: "active", educationType: "non-formal", level: "unspecified", format: "workshop", modality: "in-person", pacing: "scheduled", area: "011", settings: { attendance: true }, programId: null, leadId: member.id } });
    expect(course.status(), await course.text()).toBe(201);
    const courseId = (await course.json()).id as string;
    const groupId = (await (await admin.post(`/api/courses/${courseId}/groups`, { data: { name: e2eName(info, "Sección sin contrato") } })).json()).id as string;
    expect((await admin.put(`/api/courses/${courseId}/groups/${groupId}/educators`, { data: { userIds: [member.id], conflictReason } })).status()).toBe(200);
    expect((await admin.put(`/api/courses/${courseId}/groups/${groupId}/schedule`, { data: { weekdays: [0, 1, 2, 3, 4, 5, 6], startsAt: "08:00", durationMinutes: 45, from: today(), until: today() } })).status()).toBe(200);
    const [sessionRow] = ((await (await admin.get(`/api/courses/${courseId}/sessions`)).json()).sessions as { id: string; groupId: string }[]).filter(item => item.groupId === groupId);
    expect(sessionRow).toBeTruthy();
    const classId = sessionRow.id;

    const blockedContext = await browser.newContext({ viewport: page.viewportSize() });
    const teacher = await blockedContext.newPage();
    await teacher.context().addCookies([{ name: "hl_session", value: session, url: origin, httpOnly: true, sameSite: "Strict" }]);
    await teacher.goto(`/secciones/${groupId}/clases/${classId}`);
    await teacher.getByRole("button", { name: "Comenzar clase" }).click();
    const block = teacher.getByRole("dialog", { name: "Necesitas un contrato vigente" });
    await expect(block).toBeVisible();
    await expect(block).toContainText("contrato vigente");
    await audit(teacher, "diálogo de contrato requerido");
    await blockedContext.close();
  } finally { await admin.dispose(); }
});

test("PPL-01: a new educator's incorporation says what is missing and «Crear contrato» opens the contract with that person chosen", async ({ page, playwright, baseURL }, info) => {
  const admin = await playwright.request.newContext({ baseURL, extraHTTPHeaders: { Origin: baseURL!, Cookie: `hl_session=${await sessionToken("admin-demo")}` } });
  try {
    const name = e2eName(info, "Incorporación"), username = `e2e-inc-${info.project.name}-${Date.now().toString(36)}`;
    const account = await admin.post("/api/members", { data: { displayName: name, username, role: "educator" } });
    expect(account.status(), await account.text()).toBe(201);
    await signIn(page, "admin-demo", "/educadores");
    // The incorporation column opens the incorporation: nothing done by administration yet, and the person's own welcome pending.
    await page.getByRole("button", { name: `Qué le falta a ${name}` }).click();
    const dialog = page.getByRole("dialog", { name });
    await expect(dialog.getByRole("tab", { name: "Incorporación" })).toHaveAttribute("aria-selected", "true");
    await expect(dialog).toContainText("le falta: bienvenida, contrato, equipo de un curso, secciones");
    await expect(dialog).toContainText("Pendiente · Esperando a la persona");
    await expect(dialog.getByRole("link", { name: `Ver cursos para ${name}` })).toHaveCount(2);
    await dialog.getByRole("link", { name: `Crear contrato para ${name}` }).click();
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Contratos y políticas");
    const created = page.getByRole("dialog", { name: "Nuevo contrato" });
    await expect(created.getByLabel("Persona")).toHaveValue((await account.json()).member.id);
    const violations = (await new AxeBuilder({ page }).withTags(wcag).analyze()).violations;
    expect(violations.map(item => item.id)).toEqual([]);
  } finally { await admin.dispose(); }
});
