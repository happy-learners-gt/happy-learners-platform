import { test, expect } from "./local-test";
import { sessionToken, signIn, toast } from "./helpers";

// 1.5.0 (docs/design/constructor-de-reportes.md): administration designs a document, previews it with real data,
// publishes it, and the documents generated from then on use it; 1.5.2 adds «Sugerir campos». The certificate is used
// here so the report card other specs check keeps its format.
test("administration designs, previews and publishes the certificate, and new certificates use it", async ({ page, playwright, baseURL }, info) => {
  // The organization has one certificate template per scope and section 6.º A takes it: desktop and mobile at once
  // would archive and create the same one. The designer's phone layout is checked by layout and accessibility.
  test.skip(info.project.name === "mobile", "one certificate template per scope; the flow runs once");
  const admin = await playwright.request.newContext({ baseURL, extraHTTPHeaders: { Origin: baseURL!, Cookie: `hl_session=${await sessionToken("admin-demo")}` } });
  const educator = await playwright.request.newContext({ baseURL, extraHTTPHeaders: { Origin: baseURL!, Cookie: `hl_session=${await sessionToken("lucia.herrera")}` } });
  try {
    expect((await educator.get("/api/report-templates")).status()).toBe(403);
    // A retry starts again: an earlier certificate template of this run is archived.
    for (const item of (await (await admin.get("/api/report-templates")).json()).templates.filter((template: { kind: string }) => template.kind === "certificate")) await admin.delete(`/api/report-templates/${item.id}`);

    await signIn(page, "admin-demo", "/organizacion/documentos");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Documentos");
    await page.getByRole("button", { name: "Nueva plantilla" }).click();
    const dialog = page.getByRole("dialog", { name: "Nueva plantilla" });
    await dialog.getByLabel("Documento").selectOption({ label: "Constancia" });
    await dialog.getByRole("button", { name: "Crear y diseñar" }).click();
    await expect(page).toHaveURL(/\/organizacion\/documentos\/report-template-/);
    await expect(page.getByText("Sin publicar")).toBeVisible();

    // Edit the title with a field from the list, and add a text block.
    await page.getByRole("region", { name: "Hoja" }).getByRole("button", { name: /^Título/ }).click();
    const properties = page.getByRole("region", { name: "Propiedades" });
    await properties.getByLabel("Texto").fill("Constancia oficial de ");
    await properties.getByLabel("Insertar campo").selectOption({ label: "Inscripción o finalización" });
    await expect(properties.getByLabel("Texto")).toHaveValue("Constancia oficial de {{constancia.tipo}}");
    await page.getByRole("region", { name: "Bloques" }).getByRole("button", { name: "Texto" }).click();
    await expect(page.getByRole("region", { name: "Hoja" }).locator("li")).toHaveCount(5);
    // «Sugerir campos» (1.5.2) proposes the written date as a field; accepting it replaces it in the text.
    await properties.getByLabel("Texto").fill("Emitida el 2 de marzo de 2027.");
    await properties.getByRole("button", { name: "Sugerir campos" }).click();
    const suggested = properties.getByRole("region", { name: "Campos sugeridos" });
    await expect(suggested).toContainText("«2 de marzo de 2027» → Fecha de hoy");
    await suggested.getByRole("button", { name: "Usar Fecha de hoy en lugar de «2 de marzo de 2027»" }).click();
    await expect(properties.getByLabel("Texto")).toHaveValue("Emitida el {{fecha.hoy}}.");
    await page.getByRole("button", { name: "Guardar" }).click();
    await expect(toast(page)).toContainText("Plantilla guardada.");

    // The preview is the real PDF with a section's data.
    await page.getByRole("button", { name: "Ver con datos reales" }).click();
    await expect(page.getByTitle("Vista previa del documento")).toHaveAttribute("src", /^blob:/);

    await page.getByRole("button", { name: "Publicar" }).click();
    await expect(toast(page)).toContainText("Publicada la versión 1.");
    await page.getByRole("button", { name: "Historial" }).click();
    await expect(page.getByRole("dialog", { name: "Historial de versiones" })).toContainText("v1");

    // From now on, certificates use the published template.
    const book = await (await educator.get("/api/sections/seed-group-mat-6a/grades")).json();
    const learner = book.gradebook.learners[0].id as string;
    const certificate = await educator.get(`/api/sections/seed-group-mat-6a/grades/certificate.pdf?learner=${learner}&tipo=finalizacion`);
    expect(certificate.status()).toBe(200);
    expect(certificate.headers()["content-type"]).toBe("application/pdf");
    expect((await certificate.body()).toString("latin1")).toContain("Constancia oficial de finalizaci\\363n");

    // The section's progress report (1.5.2) downloads from Notas with the default template.
    await page.goto("/secciones/seed-group-mat-6a/notas");
    const download = page.waitForEvent("download");
    await page.getByRole("button", { name: "Reporte de avance" }).click();
    expect((await download).suggestedFilename()).toMatch(/\.pdf$/);
  } finally { await admin.dispose(); await educator.dispose(); }
});
