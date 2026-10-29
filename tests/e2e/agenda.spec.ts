import { mkdirSync } from "node:fs";
import { test, expect } from "./local-test";
import { e2eName, signIn } from "./helpers";

test("the agenda shows a class, a holiday and a delivery, and a holiday configured in Organización moves the class", async ({ page }, info) => {
  test.setTimeout(120_000);
  const courseTitle = e2eName(info, "Agenda");
  const due = e2eName(info, "Entrega");
  const holiday = e2eName(info, "Asueto");
  const first = info.project.name.includes("mobile") ? "2027-07-05" : "2027-06-07";
  const until = info.project.name.includes("mobile") ? "2027-07-19" : "2027-06-21";
  await signIn(page, "admin-demo", "/agenda");
  await page.evaluate(async ({ courseTitle, due, first, until }) => {
    const call = (path: string, method = "GET", body?: unknown) => fetch(`/api${path}`, { method, headers: { "Content-Type": "application/json" }, ...(body ? { body: JSON.stringify(body) } : {}) });
    await call("/me/preferences", "PUT", { weekStart: 1 });
    const course = await (await call("/courses", "POST", { title: courseTitle, objective: "Probar la agenda.", status: "active", educationType: "non-formal", level: "unspecified", format: "workshop", modality: "in-person", pacing: "scheduled", area: "011", settings: { attendance: true }, programId: null, leadId: "user-educator" })).json() as { id: string };
    const group = await (await call(`/courses/${course.id}/groups`, "POST", { name: "Sección de la agenda" })).json() as { id: string };
    await call(`/courses/${course.id}/groups/${group.id}/educators`, "PUT", { userIds: ["user-educator"], conflictReason: "Sección de prueba de la agenda." });
    await call(`/courses/${course.id}/groups/${group.id}/schedule`, "PUT", { weekdays: [1], startsAt: "09:00", durationMinutes: 45, from: first, until });
    const book = await (await call(`/sections/${group.id}/grades`)).json() as { gradebook: { periods: { id: string }[] } };
    await call(`/sections/${group.id}/grades/periods/${book.gradebook.periods[0].id}/plan`, "PUT", { activities: [{ title: due, kind: "project", points: 20, dueOn: "2026-10-30" }] });
  }, { courseTitle, due, first, until });

  await page.goto("/agenda?fecha=2026-10-30&ver=organization");
  await page.getByRole("tab", { name: "Semana" }).click();
  const week = page.getByRole("region", { name: "La semana" });
  await expect(week.getByRole("button", { name: /10:30/ }).first()).toBeVisible();
  await expect(week.locator(".agenda-off").filter({ hasText: "Día de Todos los Santos" })).toBeVisible();
  await expect(week.getByRole("button", { name: due })).toBeVisible();
  await week.getByRole("button", { name: /10:30/ }).first().click();
  const panel = page.getByRole("dialog");
  await panel.getByRole("link", { name: "Abrir la clase" }).click();
  await expect(page).toHaveURL(/\/secciones\/seed-group-mat-6a\/clases\//);

  await page.goto(`/agenda?fecha=${first}&ver=organization`);
  await page.getByRole("tab", { name: "Semana" }).click();
  await expect(page.getByRole("region", { name: "La semana" }).getByRole("button", { name: courseTitle })).toBeVisible();
  await page.goto("/organizacion/calendario");
  await page.getByRole("button", { name: "Más acciones del calendario" }).click();
  await page.getByRole("menuitem", { name: "Agregar evento" }).click();
  const dialog = page.getByRole("dialog", { name: "Agregar evento" });
  await dialog.getByLabel("Categoría").selectOption({ label: "Día sin clase" });
  await dialog.getByLabel("Título").fill(holiday);
  await dialog.getByLabel("Desde").fill(first);
  await dialog.getByLabel("Hasta").fill(first);
  await dialog.getByRole("checkbox", { name: "Sin clase" }).check();
  await dialog.getByRole("button", { name: "Guardar evento" }).click();
  await expect(page.getByText("Evento guardado")).toBeVisible();

  await page.goto(`/agenda?fecha=${first}&ver=organization`);
  await page.getByRole("tab", { name: "Semana" }).click();
  const movedWeek = page.getByRole("region", { name: "La semana" });
  await expect(movedWeek.locator(".agenda-off").filter({ hasText: holiday })).toBeVisible();
  await expect(movedWeek.getByRole("button", { name: courseTitle })).toHaveCount(0);
  await page.getByRole("button", { name: "Semana siguiente" }).click();
  await expect(page.getByRole("region", { name: "La semana" }).getByRole("button", { name: courseTitle })).toContainText("Movida");

  if (!info.project.name.includes("mobile")) {
    mkdirSync(".release-evidence/screenshots/lote-1d", { recursive: true });
    const shoot = async (name: string, width: number, height: number) => {
      await page.setViewportSize({ width, height });
      await page.screenshot({ path: `.release-evidence/screenshots/lote-1d/${name}-${width}.png` });
    };
    await page.goto("/agenda?fecha=2026-10-30&ver=organization");
    await page.getByRole("tab", { name: "Semana" }).click();
    await expect(page.getByRole("region", { name: "La semana" })).toBeVisible();
    await shoot("semana", 1440, 900);
    await shoot("semana", 390, 844);
    await page.getByRole("tab", { name: "Mes" }).click();
    await expect(page.getByRole("region", { name: "El mes" })).toBeVisible();
    await shoot("mes", 1440, 900);
    await shoot("mes", 390, 844);
    await page.getByRole("tab", { name: "Día" }).click();
    await expect(page.getByRole("region", { name: "El día" })).toBeVisible();
    await shoot("dia", 1440, 900);
    await shoot("dia", 390, 844);
    await page.getByRole("tab", { name: "Semana" }).click();
    await page.getByRole("region", { name: "La semana" }).getByRole("button", { name: /10:30/ }).first().click();
    await expect(page.getByRole("dialog").getByRole("link", { name: "Abrir la clase" })).toBeVisible();
    await shoot("panel-clase", 1440, 900);
    await shoot("panel-clase", 390, 844);
    await page.keyboard.press("Escape");
    await page.goto("/organizacion/calendario");
    await expect(page.getByRole("heading", { level: 1, name: "Calendario institucional" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Asuetos y fechas recurrentes" })).toBeVisible();
    await expect(page.getByText("Año Nuevo").first()).toBeVisible();
    await shoot("configuracion", 1440, 900);
    await shoot("configuracion", 390, 844);
    await page.setViewportSize({ width: 1365, height: 900 });
  }
});
