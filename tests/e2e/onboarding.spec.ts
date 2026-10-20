import AxeBuilder from "@axe-core/playwright";
import type { Page } from "@playwright/test";
import { test, expect } from "./local-test";
import { e2eName, expectRecentActivity, sessionToken, signIn, toast } from "./helpers";

// ST-122 (HL-168). The terms and privacy are published in the fictional external organization, like tests/e2e/legal.spec.ts,
// so no other suite is gated by them.
const wcag = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];
async function audit(page: Page, label: string) {
  await page.waitForLoadState("networkidle");
  await page.waitForTimeout(400);
  const { violations } = await new AxeBuilder({ page }).withTags(wcag).analyze();
  expect(violations.map(item => `${label}: ${item.id} · ${item.nodes.map(node => node.target.join(" ")).slice(0, 3).join(" | ")}`)).toEqual([]);
}
const stepHeading = (page: Page, title: string | RegExp) => page.getByRole("heading", { level: 2, name: title instanceof RegExp ? title : new RegExp(`^Paso \\d de \\d: ${title}$`) });

test("HL-168 ST-122: a new account changes its password, signs the terms, completes its welcome and lands on Inicio; administration sees it complete", async ({ page, browser, playwright, baseURL }, info) => {
  test.setTimeout(120_000);
  const admin = await playwright.request.newContext({ baseURL, extraHTTPHeaders: { Origin: baseURL!, Cookie: `hl_session=${await sessionToken("admin-externo")}` } });
  try {
    // Terms and privacy in force in org-other (published here only when no earlier suite did), accepted by administration.
    const published = ((await (await admin.get("/api/legal/documents")).json()).documents as { kind: string; status: string }[]).filter(item => item.status === "published");
    for (const [kind, data] of [["terms", { title: "Términos ficticios de bienvenida", body: "Texto ficticio de los términos para la bienvenida." }], ["privacy", { title: "Privacidad ficticia de bienvenida", body: "Texto ficticio de la política para la bienvenida.", consent: "Doy mi consentimiento informado de prueba." }]] as const) {
      if (published.some(item => item.kind === kind)) continue;
      expect((await admin.put(`/api/legal/documents/${kind}`, { data })).status()).toBe(200);
      expect((await admin.post(`/api/legal/documents/${kind}/publish`)).status()).toBe(200);
    }
    const pending = (await (await admin.get("/api/session")).json()).pending as { id: string }[];
    if (pending.length) expect((await admin.post("/api/legal/accept", { data: { documentIds: pending.map(item => item.id), signature: { fullName: "Administración Externa Ficticia", password: "Aprender-2026!" } } })).status()).toBe(200);

    // Administration creates the account from Educadores.
    const name = e2eName(info, "Bienvenida"), username = `e2e-bienvenida-${info.project.name}-${Date.now().toString(36)}`, password = "Una frase para la bienvenida 2026";
    await signIn(page, "admin-externo", "/educadores");
    await page.getByRole("button", { name: "Agregar cuenta" }).click();
    let dialog = page.getByRole("dialog", { name: "Agregar cuenta" });
    await dialog.getByLabel("Nombre", { exact: true }).fill(name);
    await dialog.getByLabel("Usuario", { exact: true }).fill(username);
    await dialog.getByRole("button", { name: "Crear cuenta" }).click();
    dialog = page.getByRole("dialog", { name: "Cuenta creada" });
    const temporary = (await dialog.getByLabel("Contraseña temporal").textContent())!.trim();
    await dialog.getByRole("button", { name: "Listo, ya la guardé" }).click();
    const row = page.getByRole("row", { name: new RegExp(name) });
    await expect(row).toContainText("Pendiente");

    // First sign-in: own password, then the terms and privacy (signed), then the welcome.
    const context = await browser.newContext({ viewport: page.viewportSize() });
    const person = await context.newPage();
    await person.goto("/inicio");
    await person.getByLabel("Usuario", { exact: true }).fill(username);
    await person.getByLabel("Contraseña", { exact: true }).fill(temporary);
    await person.getByRole("button", { name: "Entrar", exact: true }).click();
    await expect(person.getByRole("heading", { level: 1 })).toHaveText("Cambia tu contraseña");
    await person.getByLabel("Contraseña temporal").fill(temporary);
    await person.getByLabel("Nueva contraseña", { exact: true }).fill(password);
    await person.getByLabel("Repite la nueva contraseña").fill(password);
    await person.getByRole("button", { name: "Guardar y continuar" }).click();
    // Criterion 1: the terms and the privacy policy in force come before anything else.
    await expect(person.getByRole("heading", { level: 1 })).toHaveText("Acepta los términos y la política de privacidad");
    await expect(person.getByRole("checkbox")).toHaveCount(2);
    await audit(person, "términos antes de la bienvenida");
    for (const box of await person.getByRole("checkbox").all()) await box.check();
    await person.getByLabel("Nombre completo").fill(name);
    await person.getByLabel("Contraseña de tu cuenta").fill(password);
    await person.getByRole("button", { name: "Firmar y continuar" }).click();

    // Criterion 2: the welcome — what the role can do, the profile and the courses and sections.
    await expect(person.getByRole("heading", { level: 1 })).toHaveText("Bienvenida");
    await expect(stepHeading(person, "Qué puedes hacer")).toBeVisible();
    await expect(person.getByRole("heading", { level: 3, name: "Educador" })).toBeVisible();
    await audit(person, "bienvenida: qué puedes hacer");
    await person.getByRole("button", { name: "Entendido, continuar" }).click();
    await expect(stepHeading(person, "Completa tu perfil")).toBeVisible();
    await expect(stepHeading(person, "Completa tu perfil")).toBeFocused();
    // The state is on the server: reloading resumes on the same step.
    await person.reload();
    await expect(stepHeading(person, "Completa tu perfil")).toBeVisible();
    await expect(person.getByRole("button", { name: "Continuar" })).toBeDisabled();
    await expect(person.getByText("Falta: un teléfono o un correo de contacto; al menos una especialidad.")).toBeVisible();
    await person.getByLabel("Teléfono").fill("+502 5555-0122");
    await person.getByLabel("Nueva especialidad").fill("Ciencias");
    await person.getByLabel("Nueva especialidad").press("Enter");
    await person.getByRole("button", { name: "Guardar perfil" }).click();
    await expect(toast(person)).toContainText("Perfil guardado.");
    await expect(person.getByText("Tu perfil está completo.")).toBeVisible();
    await audit(person, "bienvenida: perfil");
    await person.getByRole("button", { name: "Continuar" }).click();
    // A contract or leftover volunteer agreement published by another suite is optional here: this person teaches no section yet.
    if (await stepHeading(person, /^Paso \d de \d: Firma tu (contrato|acuerdo de voluntariado)$/).isVisible()) await person.getByRole("button", { name: "Firmar más tarde" }).click();
    await expect(stepHeading(person, "Tus cursos y secciones")).toBeVisible();
    await expect(person.getByText("Sincronizar con mi calendario")).toBeVisible();
    await audit(person, "bienvenida: cursos y secciones");
    await person.getByRole("button", { name: "Empezar" }).click();
    await expect(person.getByRole("heading", { level: 1 })).toHaveText("Inicio");
    await expect(toast(person)).toContainText("Bienvenida completada");
    expect(await person.evaluate(async () => (await (await fetch("/api/session")).json()).onboarding)).toBeUndefined();
    await context.close();

    // Criterion 3: administration sees the onboarding of each person, and filters by it.
    await page.reload();
    await expect(row).toContainText("Completa");
    await page.getByLabel("Incorporación").selectOption("pending");
    await expect(row).toHaveCount(0);
    await page.getByLabel("Incorporación").selectOption("complete");
    await expect(row).toContainText("Completa");
    await audit(page, "educadores con incorporación");
    await expectRecentActivity(page, "completó su incorporación");
  } finally { await admin.dispose(); }
});
