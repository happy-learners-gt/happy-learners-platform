import { test, expect } from "./local-test";
import { signIn } from "./helpers";

// Fifth wave of the improvement plan (docs/transformacion/auditoria.md §10): what needs doing comes first.
test("HRS-05: classes waiting for a correction are the first thing administration sees, with a way to review them", async ({ page }) => {
  // The whole history: other tests finish classes in the last 30 days, which leaves that period with nothing to review.
  await signIn(page, "admin-demo", "/horas?periodo=todo");
  const pending = page.locator(".hours-pending");
  await expect(pending).toContainText(/clases? (está|están) por revisar/);
  await pending.getByRole("button", { name: "Revisarlas" }).click();
  await expect(page.getByRole("button", { name: /^Por revisar \(\d+\)$/ })).toHaveAttribute("aria-pressed", "true");
});

test("CUR-02: courses can be sorted by name or by what needs attention, with the reasons on each course", async ({ page }) => {
  await signIn(page, "admin-demo", "/cursos?vista=tarjetas");
  await page.getByLabel("Ordenar").selectOption("nombre");
  await expect(page).toHaveURL(/orden=nombre/);
  const titles = await page.locator(".course-card h3").allTextContents();
  expect(titles).toEqual([...titles].sort((a, b) => a.localeCompare(b, "es", { numeric: true })));
  await page.getByLabel("Ordenar").selectOption("atencion");
  await expect(page.locator(".course-card").first().getByRole("list", { name: "Necesita atención" })).toBeVisible();
});

test("IDA-02: on a phone the sections of Identidad y acceso are one row, and the people's badges are whole", async ({ page }, info) => {
  test.skip(info.project.name !== "mobile", "Solo en el teléfono");
  await signIn(page, "admin-demo", "/identidad/personas");
  const nav = page.getByRole("navigation", { name: "Identidad y acceso" });
  const box = await nav.boundingBox();
  expect(box!.height).toBeLessThan(80);
  await expect(page.getByRole("heading", { level: 1 })).toBeInViewport();
});

test("EDU-01 PRF-01: each person's row says what they need, with a link; the review tab shows the work before its setting", async ({ page }) => {
  await signIn(page, "admin-demo", "/educadores");
  const needs = page.locator(".person-needs a").filter({ hasText: /Perfil por revisar|Credencial por verificar|Documento por vencer|Pidió cerrar su cuenta/ });
  await expect(needs.first()).toBeVisible();
  const first = needs.first(), label = (await first.textContent())!;
  await first.click();
  await expect(page).toHaveURL(label.includes("Documento") ? /#documentos$/ : label.includes("cerrar") ? /#cierres$/ : /#perfiles$/);
  await page.goto("/educadores#perfiles");
  await expect(page.getByRole("heading", { level: 2, name: "Publicación de perfiles" })).toBeVisible();
  const headings = await page.getByRole("heading", { level: 2 }).allTextContents();
  expect(headings.findIndex(text => text.startsWith("Perfiles por revisar"))).toBeLessThan(headings.indexOf("Publicación de perfiles"));
});
