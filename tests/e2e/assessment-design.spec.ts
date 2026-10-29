import { mkdirSync } from "node:fs";
import { expect, test } from "./local-test";
import { e2eName, origin, sessionToken, signIn, E2E_PREFIX } from "./helpers";

test("designs the evaluation, chooses each section's groups and grades", async ({ page }, info) => {
  const admin = await sessionToken("admin-demo");
  const headers = { Origin: origin, "Content-Type": "application/json", Cookie: `hl_session=${admin}` };
  const call = (path: string, method = "GET", data?: unknown) => fetch(`${origin}/api${path}`, { method, headers, ...(data ? { body: JSON.stringify(data) } : {}) });
  const listed = ((await (await call("/grading-schemes")).json()) as { schemes: { id: string; name: string }[] }).schemes;
  const scheme = listed.find(item => item.name === "Universidad: categorías y GPA")?.id
    || ((await (await call("/grading-schemes/templates/universidad", "POST", {})).json()) as { scheme: { id: string } }).scheme.id;
  const course = ((await (await call("/courses", "POST", {
    title: e2eName(info, "Evaluación"), objective: "Diseñar y calificar.", status: "active", educationType: "non-formal",
    level: "unspecified", format: "workshop", modality: "in-person", pacing: "scheduled", area: "011",
    settings: { attendance: true }, programId: null, leadId: "user-educator",
  })).json()) as { id: string }).id;
  const sectionA = ((await (await call(`/courses/${course}/groups`, "POST", { name: `${E2E_PREFIX} Sección A` })).json()) as { id: string }).id;
  const sectionB = ((await (await call(`/courses/${course}/groups`, "POST", { name: `${E2E_PREFIX} Sección B` })).json()) as { id: string }).id;
  expect((await call(`/courses/${course}/assessment/scheme`, "PUT", { gradingSchemeId: scheme })).status).toBe(200);
  await call(`/courses/${course}/groups/${sectionA}/educators`, "PUT", { userIds: ["user-educator"] });
  await call(`/courses/${course}/groups/${sectionB}/educators`, "PUT", { userIds: ["user-educator"] });
  await call(`/courses/${course}/groups/${sectionA}/learners`, "POST", { displayName: "Ana" });
  await call(`/courses/${course}/groups/${sectionA}/learners`, "POST", { displayName: "Leo" });
  await call(`/courses/${course}/groups/${sectionB}/learners`, "POST", { displayName: "Bea" });
  const rules = { by: "size", size: 2, how: "random", seed: "seccion" };
  const educator = await sessionToken("educador-demo");
  const teach = { Origin: origin, "Content-Type": "application/json", Cookie: `hl_session=${educator}` };
  const teachCall = (path: string, method = "GET", data?: unknown) => fetch(`${origin}/api${path}`, { method, headers: teach, ...(data ? { body: JSON.stringify(data) } : {}) });
  expect((await teachCall(`/sections/${sectionA}/group-sets`, "POST", { name: "Equipos de la A", rules })).status).toBe(201);
  expect((await teachCall(`/sections/${sectionA}/group-sets`, "POST", { name: "Parejas de la A", rules: { ...rules, seed: "parejas" } })).status).toBe(201);
  expect((await teachCall(`/sections/${sectionB}/group-sets`, "POST", { name: "Equipo de la B", rules: { by: "count", count: 1, how: "random", seed: "una" } })).status).toBe(201);

  await signIn(page, "educador-demo", `/cursos/${course}/evaluacion`);
  await expect(page.getByRole("heading", { level: 1, name: "Evaluación" })).toBeVisible();
  await expect(page.getByText(/Tareas 30 % \+ Proyectos 30 % \+ Examen final 40 %/)).toBeVisible();
  await expect(page.getByRole("heading", { name: "Tareas · 30 %" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Proyectos · 30 %" })).toBeVisible();
  await expect(page.getByRole("status")).toHaveText("Sin actividades en Tareas, Proyectos y Examen final");
  await expect(page.getByText(/faltan \d+ pts/)).toHaveCount(0);
  if (info.project.name === "desktop") {
    const dir = ".release-evidence/screenshots/lote-3c";
    mkdirSync(dir, { recursive: true });
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.screenshot({ path: `${dir}/evaluacion-1440.png` });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.screenshot({ path: `${dir}/evaluacion-390.png` });
    await page.setViewportSize({ width: 1365, height: 900 });
  }
  await page.getByRole("button", { name: "Agregar actividad" }).click();
  const panel = page.getByRole("dialog", { name: /Nueva actividad/ });
  await panel.getByLabel("Nombre", { exact: true }).fill("Tarea de puntos");
  await panel.getByRole("textbox", { name: "Puntos", exact: true }).fill("20");
  await panel.getByRole("button", { name: "Guardar" }).click();
  await expect(page.getByText("Tarea de puntos", { exact: true })).toBeVisible();

  await page.getByRole("article", { name: /Proyectos/ }).getByRole("button", { name: "Agregar" }).click();
  const rubric = page.getByRole("dialog", { name: /Nueva actividad/ });
  await rubric.getByLabel("Nombre", { exact: true }).fill("Ensayo");
  await rubric.getByRole("textbox", { name: "Puntos", exact: true }).fill("20");
  await rubric.getByRole("radio", { name: "Rúbrica" }).click();
  await rubric.getByLabel("Descriptor de Alto en Criterio 1").fill("Argumenta con evidencia.");
  await rubric.getByRole("button", { name: "Agregar criterio" }).click();
  await rubric.getByRole("button", { name: "Agregar criterio" }).click();
  await rubric.getByRole("radio", { name: "En grupos" }).click();
  await rubric.getByLabel("Descriptor de Alto en Criterio 1").scrollIntoViewIfNeeded();
  await expect(rubric.getByRole("button", { name: "Guardar" })).toBeInViewport();
  if (info.project.name === "desktop") {
    await page.setViewportSize({ width: 1440, height: 900 });
    await expect(rubric.getByRole("button", { name: "Guardar" })).toBeInViewport();
    await page.screenshot({ path: ".release-evidence/screenshots/lote-3c/evaluacion-panel-1440.png" });
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(rubric.getByRole("button", { name: "Guardar" })).toBeInViewport();
    await page.screenshot({ path: ".release-evidence/screenshots/lote-3c/evaluacion-panel-390.png" });
    await page.setViewportSize({ width: 1365, height: 900 });
  }
  await rubric.getByRole("button", { name: "Guardar" }).click();
  await expect(page.getByText("Ensayo", { exact: true })).toBeVisible();
  await expect(page.getByText(/Rúbrica · En grupos/)).toBeVisible();

  await page.goto(`/secciones/${sectionA}/grupos`);
  await expect(page.getByText("Forma los grupos de la sección una vez y úsalos en las actividades de las lecciones y en las evaluaciones en grupos.")).toBeVisible();
  await expect(page.getByText("Se usa en ninguna actividad.").first()).toBeVisible();
  await expect(page.getByRole("heading", { name: "Equipos de la A" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Parejas de la A" })).toBeVisible();
  const rows = page.getByRole("region", { name: "Actividades en grupos" });
  await rows.getByLabel("Conjunto de Ensayo").selectOption({ label: "Equipos de la A" });
  await expect(page.getByText("Conjunto elegido.")).toBeVisible();
  if (info.project.name === "desktop") {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.screenshot({ path: ".release-evidence/screenshots/lote-3c/grupos-1440.png" });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.screenshot({ path: ".release-evidence/screenshots/lote-3c/grupos-390.png" });
    await page.setViewportSize({ width: 1365, height: 900 });
  }
  await page.goto(`/secciones/${sectionB}/grupos`);
  await page.getByRole("region", { name: "Actividades en grupos" }).getByLabel("Conjunto de Ensayo").selectOption({ label: "Equipo de la B" });
  await expect(page.getByText("Conjunto elegido.")).toBeVisible();

  await page.goto(`/secciones/${sectionA}/notas`);
  await expect(page.getByText(/Tareas 30 % \+ Proyectos 30 % \+ Examen final 40 %/)).toBeVisible();
  await expect(page.getByRole("link", { name: "Ver la evaluación del curso" }).first()).toBeVisible();
  await expect(page.getByRole("button", { name: "Editar el plan" })).toHaveCount(0);
  await page.getByRole("tab", { name: /Primer bimestre/ }).click();
  await page.getByRole("button", { name: "Rúbrica de Ensayo de Grupo 1" }).click();
  const rubricDialog = page.getByRole("dialog", { name: "Rúbrica · Ensayo" });
  await rubricDialog.getByLabel("Criterio 1").selectOption({ label: "Alto · 4" });
  await rubricDialog.getByLabel("Criterio 2").selectOption({ label: "Alto · 4" });
  await rubricDialog.getByLabel("Criterio 3").selectOption({ label: "Alto · 4" });
  await rubricDialog.getByRole("button", { name: "Guardar rúbrica" }).click();
  await expect(page.getByText("del grupo").first()).toBeVisible();
  if (info.project.name === "desktop") {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.screenshot({ path: ".release-evidence/screenshots/lote-3c/notas-1440.png" });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.screenshot({ path: ".release-evidence/screenshots/lote-3c/notas-390.png" });
  }
});
