import { test, expect } from "./local-test";
import { E2E_PREFIX, signIn } from "./helpers";

test("the institutional calendar applies a template, generates a year, skips one occurrence and adds a program event", async ({ page }, info) => {
  test.setTimeout(90_000);
  await signIn(page, "admin-demo", "/calendario");
  const programs = await page.evaluate(async () => (await (await fetch("/api/programs")).json()).programs as { id: string; name: string; status: string }[]);
  const program = programs.find(item => item.status === "active")!;
  expect(program).toBeTruthy();
  const year = info.project.name.includes("mobile") ? 2037 : 2036;
  await page.evaluate(async ({ programId, year }) => {
    const catalog = await (await fetch("/api/calendars")).json() as { calendars: { id: string; scope: string; scopeId: string | null }[] };
    const calendar = catalog.calendars.find(item => item.scope === "program" && item.scopeId === programId)!;
    const view = await (await fetch(`/api/calendars/view?from=${year}-01-01&until=${year}-12-31&program=${programId}`)).json() as { events: { id: string; calendarId: string }[] };
    await Promise.all(view.events.filter(item => item.calendarId === calendar.id).map(item => fetch(`/api/calendars/${calendar.id}/events/${item.id}`, { method: "DELETE" })));
  }, { programId: program.id, year });
  await page.goto(`/configuracion-academica/calendario?programa=${program.id}&año=${year}`);
  await expect(page.getByRole("heading", { level: 1, name: "Calendario" })).toBeVisible();

  await page.getByRole("button", { name: "Más acciones del calendario" }).click();
  await page.getByRole("menuitem", { name: "Aplicar plantilla de Guatemala" }).click();
  await expect(page.getByText(/plantilla|reglas agregadas/i).last()).toBeVisible();

  const generate = page.getByRole("button", { name: `Generar ${year}` });
  await expect(generate).toBeVisible();
  await generate.click();
  const preview = page.getByRole("dialog", { name: `Generar el año ${year}` });
  await expect(preview.getByRole("heading", { name: /Se crean/ })).toBeVisible();
  await preview.getByRole("button", { name: `Confirmar y generar ${year}` }).click();
  // CAL-01: each holiday shows and manages its date of the year in its own rule; the event list keeps the rest.
  const newYear = page.locator(".agenda-rule-list > li").filter({ hasText: "Año Nuevo" }).first();
  await expect(newYear).toContainText(`1 ene`);
  await expect(newYear).not.toContainText("se crea al generar el año");
  await expect(page.locator(".agenda-event").filter({ hasText: "Año Nuevo" })).toHaveCount(0);
  await newYear.getByRole("button", { name: "Acciones de Año Nuevo" }).click();
  await page.getByRole("menuitem", { name: `Saltar la fecha de ${year}` }).click();
  await expect(newYear).toContainText("omitida");

  await page.getByRole("button", { name: "Más acciones del calendario" }).click();
  await page.getByRole("menuitem", { name: "Agregar evento" }).click();
  const dialog = page.getByRole("dialog", { name: "Agregar evento" });
  const title = `${E2E_PREFIX} Encuentro ${info.project.name}`;
  await dialog.getByLabel("Título").fill(title);
  await dialog.getByLabel("Desde").fill(`${year}-08-14`);
  await dialog.getByLabel("Hasta").fill(`${year}-08-15`);
  await dialog.getByRole("button", { name: "Guardar evento" }).click();
  await expect(page.locator(".agenda-event").filter({ hasText: title })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  if (process.env.CAPTURE_CALENDAR === "1") await page.screenshot({ path: `test-results/calendario-${info.project.name}.png`, fullPage: true });
});
