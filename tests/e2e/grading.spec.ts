import { mkdirSync } from "node:fs";
import type { Page } from "@playwright/test";
import { test, expect } from "./local-test";
import { e2eName, origin, sessionToken, signIn } from "./helpers";

const dir = ".release-evidence/screenshots/lote-2c";
const shot = async (page: Page, name: string) => {
  mkdirSync(dir, { recursive: true });
  for (const [label, size] of [["1440", { width: 1440, height: 900 }], ["390", { width: 390, height: 844 }]] as const) {
    await page.setViewportSize(size);
    await page.screenshot({ path: `${dir}/${name}-${label}.png`, fullPage: true });
  }
};

test("a university scheme, a rubric in the grid and a panel finished from Mis tribunales", async ({ page, browser }, info) => {
  test.setTimeout(120_000);
  const admin = await sessionToken("admin-demo");
  const call = async <T>(cookie: string, path: string, method = "GET", data?: unknown) => {
    const response = await fetch(`${origin}/api${path}`, { method, headers: { Origin: origin, Cookie: `hl_session=${cookie}`, ...(data !== undefined ? { "Content-Type": "application/json" } : {}) }, ...(data !== undefined ? { body: JSON.stringify(data) } : {}) });
    const text = await response.text();
    expect(response.status, `${method} ${path} ${text}`).toBeLessThan(300);
    return JSON.parse(text) as T;
  };
  const listed = await call<{ schemes: { id: string; name: string }[] }>(admin, "/grading-schemes");
  let scheme = listed.schemes.find(item => item.name === "Universidad: categorías y GPA");
  if (!scheme) scheme = (await call<{ scheme: { id: string; name: string } }>(admin, "/grading-schemes/templates/universidad", "POST", {})).scheme;
  const stored = (await call<{ schemes: { id: string; name: string; method: string; categories: unknown[]; display: unknown; passing: unknown; periods: string; retakes: string; extraCreditCap?: number }[] }>(admin, "/grading-schemes")).schemes.find(item => item.id === scheme!.id)!;
  await call(admin, `/grading-schemes/${stored.id}`, "PUT", { ...stored, levels: [{ id: "alto", label: "Alto", value: 100 }, { id: "medio", label: "Medio", value: 70 }, { id: "bajo", label: "Bajo", value: 40 }] });

  const members = (await call<{ members: { id: string; username: string }[] }>(admin, "/members")).members;
  const educatorId = members.find(item => item.username === "educador-demo")!.id;
  const carlosId = members.find(item => item.username === "carlos.mejia")!.id;
  const course = (await call<{ id: string }>(admin, "/courses", "POST", {
    title: e2eName(info, "Evaluación"), objective: "Calificar con un esquema.", status: "active", educationType: "non-formal",
    level: "bachelor", format: "subject", modality: "in-person", pacing: "scheduled", area: "011",
    settings: { attendance: true, gradingSchemeId: stored.id }, programId: null, leadId: educatorId,
  })).id;
  const group = (await call<{ id: string }>(admin, `/courses/${course}/groups`, "POST", { name: e2eName(info, "Grupo") })).id;
  await call(admin, `/courses/${course}/groups/${group}/educators`, "PUT", { userIds: [educatorId] });
  const learner = (await call<{ id: string }>(admin, `/courses/${course}/groups/${group}/learners`, "POST", { displayName: "Ada Lovelace" })).id;
  const educator = await sessionToken("educador-demo");
  const period = (await call<{ gradebook: { periods: { id: string }[] } }>(educator, `/sections/${group}/grades`)).gradebook.periods[0].id;
  const rubric = { criteria: [{ id: "argumento", label: "Argumentación", weight: 100, levels: [{ id: "solida", label: "Sólida", points: 100 }, { id: "inicial", label: "Inicial", points: 0 }] }] };
  const planned = await call<{ gradebook: { activities: { id: string; title: string }[] } }>(educator, `/sections/${group}/grades/periods/${period}/plan`, "PUT", { activities: [
    { title: "Ensayo", kind: "task", points: 30, categoryId: "tareas", grading: "rubric", rubric },
    { title: "Oral", kind: "quiz", points: 30, categoryId: "proyectos", grading: "level" },
    { title: "Examen final", kind: "exam", points: 40, categoryId: "final", grading: "points" },
    { title: "Defensa", kind: "exam", points: 30, categoryId: "proyectos", grading: "panel", panel: { combine: "average" } },
  ] });
  const idOf = (title: string) => planned.gradebook.activities.find(item => item.title === title)!.id;
  await call(educator, `/sections/${group}/grades/activities/${idOf("Defensa")}/evaluators`, "PUT", { evaluators: [{ userId: educatorId, chair: true }, { userId: carlosId, chair: false }] });
  await call(educator, `/sections/${group}/grades`, "PUT", { scores: [{ activityId: idOf("Examen final"), learnerId: learner, points: 20 }] });

  await signIn(page, "admin-demo", "/configuracion-academica");
  await page.getByRole("button", { name: "Acciones de Universidad: categorías y GPA" }).click();
  await page.getByRole("menuitem", { name: "Editar" }).click();
  await expect(page.getByRole("status", { name: "Vista previa" })).toBeVisible();
  await shot(page, "esquema");

  await signIn(page, "educador-demo", `/secciones/${group}/notas?periodo=${period}`);
  await expect(page.getByText(/No alcanzó el mínimo de 60/)).toBeVisible();
  await page.getByRole("button", { name: "Rúbrica de Ensayo de Ada Lovelace" }).click();
  await page.getByLabel("Argumentación").selectOption("solida");
  await page.getByRole("button", { name: "Guardar rúbrica" }).click();
  await page.getByLabel("Nivel de Oral de Ada Lovelace").selectOption("alto");
  await expect(page.getByRole("button", { name: "Rúbrica de Ensayo de Ada Lovelace" })).toHaveText("100");
  await shot(page, "cuadricula");
  await page.getByRole("button", { name: /Guardar \d+ cambios/ }).click();
  await expect(page.getByText("Notas guardadas")).toBeVisible();

  await page.goto("/tribunales");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Mis tribunales");
  const own = page.getByRole("listitem").filter({ hasText: e2eName(info, "Evaluación") });
  await own.getByLabel("Tu marca para Ada Lovelace").fill("24");
  await own.getByRole("button", { name: "Guardar" }).click();
  await expect(own.getByText("Pendiente")).toBeVisible();
  const carlos = await browser.newContext();
  await carlos.addCookies([{ name: "hl_session", value: await sessionToken("carlos.mejia"), url: origin, httpOnly: true, sameSite: "Strict" }]);
  const other = await carlos.newPage();
  await other.goto("/tribunales");
  const theirs = other.getByRole("listitem").filter({ hasText: e2eName(info, "Evaluación") });
  await theirs.getByLabel("Tu marca para Ada Lovelace").fill("30");
  await theirs.getByRole("button", { name: "Guardar" }).click();
  await expect(theirs.getByText("Tribunal: 27")).toBeVisible();
  await shot(other, "tribunales");
  await carlos.close();
});
