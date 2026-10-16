import AxeBuilder from "@axe-core/playwright";
import type { Page } from "@playwright/test";
import { test, expect } from "./local-test";
import { e2eName, origin, sessionToken, signIn, toast } from "./helpers";

const wcag = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];
async function audit(page: Page, label: string) {
  await page.waitForLoadState("networkidle");
  await page.waitForTimeout(400);
  const { violations } = await new AxeBuilder({ page }).withTags(wcag).analyze();
  expect(violations.map(item => `${label}: ${item.id} · ${item.nodes.map(node => node.target.join(" ")).slice(0, 3).join(" | ")}`)).toEqual([]);
}
const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, ...Array.from({ length: 56 }, (_, i) => i)]);
const pdf = Buffer.from("%PDF-1.4\n% Documento ficticio de prueba\n%%EOF\n");
const addDays = (day: string, days: number) => new Date(Date.parse(`${day}T00:00:00Z`) + days * 86400000).toISOString().slice(0, 10);

test("HL-15 ST-149 ST-150: an educator edits their profile with a photo, administration files a document that is about to expire, and the educator downloads it", async ({ page, browser, playwright, baseURL }, info) => {
  const admin = await playwright.request.newContext({ baseURL, extraHTTPHeaders: { Origin: baseURL!, Cookie: `hl_session=${await sessionToken("admin-demo")}` } });
  const adminContext = await browser.newContext();
  try {
    // A new educator of the fictional demo, signed in with the session of their first sign-in.
    const name = e2eName(info, "Perfil"), username = `e2e-perfil-${info.project.name}-${Date.now().toString(36)}`;
    const account = await admin.post("/api/members", { data: { displayName: name, username, role: "educator" } });
    expect(account.status(), await account.text()).toBe(201);
    const { member, temporaryPassword } = await account.json() as { member: { id: string }; temporaryPassword: string };
    const login = await fetch(`${origin}/api/login`, { method: "POST", headers: { Origin: origin, "Content-Type": "application/json" }, body: JSON.stringify({ username, password: temporaryPassword }) });
    const session = /hl_session=([^;]+)/.exec(login.headers.get("set-cookie") || "")![1];
    const changed = await fetch(`${origin}/api/account/password`, { method: "POST", headers: { Origin: origin, "Content-Type": "application/json", Cookie: `hl_session=${session}` }, body: JSON.stringify({ currentPassword: temporaryPassword, newPassword: "Perfil de prueba 2026" }) });
    expect(changed.status).toBe(200);
    await page.context().addCookies([{ name: "hl_session", value: session, url: origin, httpOnly: true, sameSite: "Strict" }]);

    // ST-149 criterion 1: the person edits their profile, photo included.
    await page.goto("/inicio");
    await page.getByRole("button", { name: /^Perfil de / }).click();
    await page.getByRole("menuitem", { name: "Mi perfil" }).click();
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Mi perfil");
    await page.getByLabel("Subir foto").setInputFiles({ name: "foto.png", mimeType: "image/png", buffer: png });
    await expect(toast(page)).toContainText("Foto actualizada.");
    await expect(page.getByRole("img", { name: "Tu foto de perfil" })).toBeVisible();
    await page.getByLabel("Teléfono").fill("+502 5555-0149");
    await page.getByLabel("Correo de contacto").fill("perfil.contacto@ejemplo.org");
    await page.getByLabel("Formación").fill("Profesorado ficticio en Matemática");
    await page.getByLabel("Nueva especialidad").fill("Álgebra");
    await page.getByRole("button", { name: "Agregar especialidad" }).click();
    await expect(page.getByRole("list", { name: "Tus especialidades" })).toContainText("Álgebra");
    await page.getByRole("button", { name: "Agregar franja" }).click();
    await page.getByLabel("Día de la franja 1").selectOption("3");
    await page.getByLabel("Desde, franja 1").fill("14:00");
    await page.getByLabel("Hasta, franja 1").fill("16:30");
    await page.getByRole("button", { name: "Guardar perfil" }).click();
    await expect(toast(page)).toContainText("Perfil guardado.");
    await audit(page, "mi perfil");
    const saved = (await (await admin.get(`/api/members/${member.id}/profile`)).json()).profile;
    expect(saved).toMatchObject({ photo: true, specialties: ["Álgebra"], availability: [{ day: 3, start: "14:00", end: "16:30" }], contact: { phone: "+502 5555-0149", contactEmail: "perfil.contacto@ejemplo.org" } });

    // ST-150 criteria 1 and 3: administration files a document with its expiry and sees it flagged.
    const today = (await (await admin.get(`/api/members/${member.id}/files`)).json()).today as string;
    const adminPage = await adminContext.newPage();
    await adminContext.addCookies([{ name: "hl_session", value: await sessionToken("admin-demo"), url: origin, httpOnly: true, sameSite: "Strict" }]);
    await adminPage.goto("/educadores");
    const row = adminPage.getByRole("row", { name: new RegExp(name) });
    await row.getByRole("button", { name: `Acciones de ${name}` }).click();
    await adminPage.getByRole("menuitem", { name: "Perfil y expediente" }).click();
    const detail = adminPage.getByRole("dialog", { name });
    await expect(detail).toContainText("+502 5555-0149");
    await detail.getByRole("tab", { name: "Expediente" }).click();
    await expect(detail.getByRole("tab", { name: "Expediente" })).toHaveAttribute("aria-selected", "true");
    await detail.getByRole("button", { name: "Agregar documento" }).click();
    const upload = adminPage.getByRole("dialog", { name: "Agregar documento" });
    await upload.getByLabel("Tipo").selectOption("criminal-record");
    await upload.getByLabel("Título").fill("Antecedentes penales ficticios");
    await upload.getByLabel("Fecha de emisión").fill(addDays(today, -120));
    await upload.getByLabel("Vencimiento").fill(addDays(today, 10));
    await upload.getByLabel("Archivo").setInputFiles({ name: "antecedentes.pdf", mimeType: "application/pdf", buffer: pdf });
    await audit(adminPage, "agregar documento");
    await upload.getByRole("button", { name: "Agregar documento" }).click();
    await expect(toast(adminPage)).toContainText("Documento agregado al expediente.");
    const documentRow = detail.getByRole("row", { name: /Antecedentes penales ficticios/ });
    await expect(documentRow).toContainText("Por vencer");
    await audit(adminPage, "expediente");
    await detail.getByRole("button", { name: "Cerrar" }).click();
    const overview = adminPage.getByRole("region", { name: "Documentos vencidos o por vencer" });
    await expect(overview).toContainText(name);
    await expect(overview).toContainText("Por vencer");

    // ST-150 criterion 2: the educator downloads their own document, and the download is in the activity.
    await page.reload();
    const mine = page.getByRole("region", { name: "Mi expediente" });
    await expect(mine.getByRole("row", { name: /Antecedentes penales ficticios/ })).toContainText("Por vencer");
    const download = page.waitForEvent("download");
    await mine.getByRole("link", { name: "Descargar Antecedentes penales ficticios" }).click();
    expect((await download).suggestedFilename()).toMatch(/^antecedentes-penales-\d{4}-\d{2}-\d{2}\.pdf$/);
    await expect(mine.getByRole("button", { name: /Retirar/ })).toHaveCount(0);
    const events = ((await (await admin.get(`/api/activity?actor=${member.id}&limit=20`)).json()).events as { summary: string }[]).map(event => event.summary);
    expect(events).toEqual(expect.arrayContaining(["Consultó un documento de su expediente: Antecedentes penales", "Cambió su foto de perfil"]));
  } finally {
    await adminContext.close();
    await admin.dispose();
  }
});
