import AxeBuilder from "@axe-core/playwright";
import type { Page } from "@playwright/test";
import { test, expect } from "./local-test";
import { completeOnboarding, e2eName, origin, sessionToken, toast } from "./helpers";

const wcag = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];
async function audit(page: Page, label: string) {
  await page.waitForLoadState("networkidle");
  // From the top, so the sticky header does not cover targets the test scrolled under it.
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(400);
  const { violations } = await new AxeBuilder({ page }).withTags(wcag).analyze();
  expect(violations.map(item => `${label}: ${item.id} · ${item.nodes.map(node => node.target.join(" ")).slice(0, 3).join(" | ")}`)).toEqual([]);
}
const conflictReason = "Sección de prueba E2E; su horario puede coincidir con otras secciones de prueba.";

test("HL-15 ST-154 ST-155 ST-156 ST-157: an educator completes and sends their profile, administration asks for changes and approves it, an edit keeps the published version until approved, a credential is verified and the student sees «Tu educador»", async ({ page, browser, playwright, baseURL }, info) => {
  test.setTimeout(180000);
  const admin = await playwright.request.newContext({ baseURL, extraHTTPHeaders: { Origin: baseURL!, Cookie: `hl_session=${await sessionToken("admin-demo")}` } });
  const adminContext = await browser.newContext({ viewport: page.viewportSize() || undefined });
  try {
    // A new educator of the fictional demo, who teaches a section with a student code.
    const name = e2eName(info, "Perfil profesional"), username = `e2e-profesional-${info.project.name}-${Date.now().toString(36)}`;
    const account = await admin.post("/api/members", { data: { displayName: name, username, role: "educator" } });
    expect(account.status(), await account.text()).toBe(201);
    const { member, temporaryPassword } = await account.json() as { member: { id: string }; temporaryPassword: string };
    const login = await fetch(`${origin}/api/login`, { method: "POST", headers: { Origin: origin, "Content-Type": "application/json" }, body: JSON.stringify({ username, password: temporaryPassword }) });
    const session = /hl_session=([^;]+)/.exec(login.headers.get("set-cookie") || "")![1];
    expect((await fetch(`${origin}/api/account/password`, { method: "POST", headers: { Origin: origin, "Content-Type": "application/json", Cookie: `hl_session=${session}` }, body: JSON.stringify({ currentPassword: temporaryPassword, newPassword: "Perfil profesional 2026" }) })).status).toBe(200);
    await completeOnboarding(session, "Ciencias naturales");
    const created = await admin.post("/api/courses", { data: { title: e2eName(info, "Curso con perfil"), objective: "Conocer a quien enseña.", status: "active", educationType: "non-formal", level: "unspecified", format: "workshop", modality: "in-person", pacing: "scheduled", area: "011", settings: { attendance: true }, programId: null, leadId: member.id } });
    expect(created.status(), await created.text()).toBe(201);
    const course = `/api/courses/${(await created.json()).id}`;
    const groupId = (await (await admin.post(`${course}/groups`, { data: { name: e2eName(info, "Sección con perfil") } })).json()).id as string;
    expect((await admin.put(`${course}/groups/${groupId}/educators`, { data: { userIds: [member.id], conflictReason } })).status()).toBe(200);
    const { accessCode } = await (await admin.post(`${course}/groups/${groupId}/code`)).json() as { accessCode: string };
    await page.context().addCookies([{ name: "hl_session", value: session, url: origin, httpOnly: true, sameSite: "Strict" }]);

    // ST-154: «Mi perfil» by sections; ST-149's specialty arrived as a teaching area.
    await page.goto("/perfil");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Mi perfil");
    const meter = page.getByRole("progressbar", { name: /Perfil completo al/ });
    // The specialty given at the welcome already counts as a teaching area.
    await expect(meter).toHaveAttribute("aria-valuenow", "8");
    const sections = page.getByRole("navigation", { name: "Secciones del perfil" });
    await page.getByLabel("Titular").fill("Docente de ciencias para primaria, con experimentos de bajo costo");
    await page.getByRole("combobox", { name: /^País/ }).selectOption("GT");
    await page.getByLabel("Zona horaria").selectOption("America/Guatemala");
    await sections.getByRole("button", { name: "Sobre mí" }).click();
    await page.getByLabel("Biografía").fill("Acompaño a niñas y niños a preguntar como científicos: observamos, medimos y compartimos lo que descubrimos.");
    await sections.getByRole("button", { name: "Idiomas" }).click();
    await page.getByLabel("Agregar idioma").selectOption("es");
    await expect(page.getByRole("list", { name: "Tus idiomas" })).toContainText("Español");
    await sections.getByRole("button", { name: "Enseñanza" }).click();
    await expect(page.getByRole("list", { name: "Tus áreas de enseñanza" })).toContainText("Ciencias naturales");
    await page.getByRole("checkbox", { name: "CINE 1 · Educación primaria" }).check();
    await page.getByRole("checkbox", { name: "En línea" }).check();
    await sections.getByRole("button", { name: "Contacto" }).click();
    await page.getByRole("textbox", { name: "Teléfono (opcional)" }).fill("+502 5555-0157");
    await page.getByRole("button", { name: "Guardar perfil" }).click();
    await expect(toast(page)).toContainText("Perfil guardado.");
    await expect(meter).not.toHaveAttribute("aria-valuenow", "8");
    await audit(page, "mi perfil");

    // The preview shows what a student would see: never the phone.
    await page.getByRole("button", { name: "Vista previa" }).click();
    const preview = page.getByRole("dialog", { name: "Así te ve un estudiante" });
    await expect(preview).toContainText("Docente de ciencias para primaria");
    await expect(preview).not.toContainText("5555-0157");
    await audit(page, "vista previa");
    await preview.getByRole("button", { name: "Cerrar" }).click();

    // ST-156: sent for review; administration asks for changes.
    await page.getByRole("button", { name: "Enviar a revisión" }).click();
    await page.getByRole("dialog", { name: "¿Enviar tu perfil a revisión?" }).getByRole("button", { name: "Enviar a revisión" }).click();
    await expect(toast(page)).toContainText("Perfil enviado a revisión.");
    await expect(page.getByRole("status").filter({ hasText: "Administración está revisando tu perfil" })).toBeVisible();
    await adminContext.addCookies([{ name: "hl_session", value: await sessionToken("admin-demo"), url: origin, httpOnly: true, sameSite: "Strict" }]);
    const adminPage = await adminContext.newPage();
    await adminPage.goto("/perfiles");
    await expect(adminPage.getByRole("heading", { level: 1 })).toHaveText("Revisión de perfiles");
    await adminPage.getByRole("button", { name: `Revisar el perfil de ${name}` }).click();
    let review = adminPage.getByRole("dialog", { name: `Perfil de ${name}` });
    await expect(review).toContainText("Primera publicación");
    await audit(adminPage, "revisar perfil");
    await review.getByRole("button", { name: "Pedir cambios" }).click();
    const returning = adminPage.getByRole("dialog", { name: "Pedir cambios" });
    await returning.getByLabel("Qué debe cambiar").fill("Cuéntanos también cómo trabajas en línea.");
    await returning.getByRole("button", { name: "Pedir cambios" }).click();
    await expect(toast(adminPage)).toContainText(`Pediste cambios en el perfil de ${name}.`);

    // The educator reads the note, corrects and sends again; administration approves.
    await page.reload();
    await expect(page.getByRole("status").filter({ hasText: "Cuéntanos también cómo trabajas en línea." })).toBeVisible();
    await sections.getByRole("button", { name: "Sobre mí" }).click();
    await page.getByLabel("Enfoque de enseñanza").fill("En línea usamos materiales de casa y una bitácora compartida.");
    await page.getByRole("button", { name: "Guardar perfil" }).click();
    await expect(toast(page)).toContainText("Perfil guardado.");
    await page.getByRole("button", { name: "Enviar a revisión" }).click();
    await page.getByRole("dialog", { name: "¿Enviar tu perfil a revisión?" }).getByRole("button", { name: "Enviar a revisión" }).click();
    await expect(toast(page)).toContainText("Perfil enviado a revisión.");
    await adminPage.reload();
    await adminPage.getByRole("button", { name: `Revisar el perfil de ${name}` }).click();
    review = adminPage.getByRole("dialog", { name: `Perfil de ${name}` });
    await review.getByRole("button", { name: "Aprobar y publicar" }).click();
    await expect(toast(adminPage)).toContainText(`Perfil de ${name} aprobado y publicado.`);
    await page.reload();
    await expect(page.getByText("Publicado", { exact: true }).first()).toBeVisible();

    // An edit of the published profile waits for approval; the team keeps seeing the published version.
    await page.getByLabel("Titular").fill("Ciencias y robótica para primaria");
    await page.getByRole("button", { name: "Guardar perfil" }).click();
    await expect(toast(page)).toContainText("Perfil guardado.");
    await expect(page.getByText("Cambios sin enviar")).toBeVisible();
    await adminPage.goto(`/equipo/${member.id}`);
    await expect(adminPage.getByRole("article", { name: `Perfil de ${name}` })).toContainText("Docente de ciencias para primaria");
    await page.getByRole("button", { name: "Enviar cambios a revisión" }).click();
    await page.getByRole("dialog", { name: "¿Enviar tu perfil a revisión?" }).getByRole("button", { name: "Enviar a revisión" }).click();
    await expect(toast(page)).toContainText("Perfil enviado a revisión.");
    await adminPage.reload();
    await expect(adminPage.getByRole("article", { name: `Perfil de ${name}` })).toContainText("Docente de ciencias para primaria");
    await adminPage.goto("/perfiles");
    await adminPage.getByRole("button", { name: `Revisar el perfil de ${name}` }).click();
    review = adminPage.getByRole("dialog", { name: `Perfil de ${name}` });
    await expect(review).toContainText("Cambia respecto a la versión publicada: Identidad");
    await review.getByRole("button", { name: "Aprobar y publicar" }).click();
    await expect(toast(adminPage)).toContainText("aprobado y publicado");
    await adminPage.goto(`/equipo/${member.id}`);
    await expect(adminPage.getByRole("article", { name: `Perfil de ${name}` })).toContainText("Ciencias y robótica para primaria");
    await audit(adminPage, "perfil del equipo");

    // ST-155: the educator sends a credential; administration verifies it.
    await page.reload();
    await sections.getByRole("button", { name: "Credenciales" }).click();
    await page.getByRole("button", { name: "Agregar credencial" }).click();
    const credential = page.getByRole("dialog", { name: "Agregar credencial" });
    await credential.getByLabel("Tipo").selectOption("teaching_license");
    await credential.getByLabel("Nombre de la credencial").fill("Licencia docente ficticia");
    await credential.getByLabel("Emisor", { exact: true }).fill("Ministerio ficticio de Educación");
    await credential.getByLabel("Fecha de emisión").fill("2019-01-15");
    await audit(page, "agregar credencial");
    await credential.getByRole("button", { name: "Guardar y enviar a verificación" }).click();
    await expect(toast(page)).toContainText("Credencial enviada a verificación.");
    await expect(page.getByRole("list", { name: "Tus credenciales" })).toContainText("En verificación");
    await adminPage.goto("/perfiles");
    await adminPage.getByRole("button", { name: `Verificar Licencia docente ficticia de ${name}` }).click();
    await expect(toast(adminPage)).toContainText("«Licencia docente ficticia» verificada.");
    await audit(adminPage, "revisión de perfiles");

    // ST-157: the directory finds the educator by language; the student space shows «Tu educador».
    await adminPage.goto("/equipo");
    await adminPage.getByLabel("Idioma").selectOption("es");
    await expect(adminPage.getByRole("list", { name: "Personas del equipo" })).toContainText(name);
    await adminPage.getByLabel("Modalidad").selectOption("in_person");
    await expect(adminPage.getByRole("link", { name })).toHaveCount(0);
    await adminPage.getByLabel("Modalidad").selectOption("online");
    await expect(adminPage.getByRole("link", { name })).toBeVisible();
    await audit(adminPage, "equipo");

    const student = await browser.newContext({ viewport: page.viewportSize() || undefined });
    try {
      const learner = await student.newPage();
      expect((await learner.request.post(`${origin}/api/student/login`, { data: { code: accessCode }, headers: { Origin: origin } })).status()).toBe(200);
      await learner.goto("/estudiante");
      const card = learner.getByRole("article", { name: `Perfil de ${name}` });
      await expect(learner.getByRole("heading", { name: "Tu educador" })).toBeVisible();
      await expect(card).toContainText("Ciencias y robótica para primaria");
      await expect(card).toContainText("Verificada");
      await expect(card).not.toContainText("5555-0157");
      await audit(learner, "tu educador");
    } finally { await student.close(); }
  } finally {
    await adminContext.close();
    await admin.dispose();
  }
});
