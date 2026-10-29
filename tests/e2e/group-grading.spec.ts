import { mkdirSync } from "node:fs";
import type { Locator, Page } from "@playwright/test";
import { test, expect } from "./local-test";
import { e2eName, origin, sessionToken, signIn } from "./helpers";

const dir = ".release-evidence/screenshots/lote-3b";
const shot = async (page: Page, name: string, target?: Locator) => {
  const current = page.viewportSize();
  mkdirSync(dir, { recursive: true });
  for (const [label, size] of [["1440", { width: 1440, height: 900 }], ["390", { width: 390, height: 844 }]] as const) {
    await page.setViewportSize(size);
    if (target) await target.screenshot({ path: `${dir}/${name}-${label}.png` });
    else await page.screenshot({ path: `${dir}/${name}-${label}.png`, fullPage: true });
  }
  if (current) await page.setViewportSize(current);
};

test("forms a set from the students present in a class, grades the group and records coevaluation", async ({ page }, info) => {
  test.setTimeout(120_000);
  const admin = await sessionToken("admin-demo");
  const educator = await sessionToken("educador-demo");
  const call = async <T>(cookie: string, path: string, method = "GET", data?: unknown) => {
    const response = await fetch(`${origin}/api${path}`, { method, headers: { Origin: origin, Cookie: `hl_session=${cookie}`, ...(data !== undefined ? { "Content-Type": "application/json" } : {}) }, ...(data !== undefined ? { body: JSON.stringify(data) } : {}) });
    const text = await response.text();
    expect(response.status, `${method} ${path} ${text}`).toBeLessThan(300);
    return JSON.parse(text) as T;
  };
  const educatorId = (await call<{ members: { id: string; username: string }[] }>(admin, "/members")).members.find(item => item.username === "educador-demo")!.id;
  const course = (await call<{ id: string }>(admin, "/courses", "POST", {
    title: e2eName(info, "Grupos"), objective: "Calificar un trabajo de grupo.", status: "active", educationType: "non-formal",
    level: "unspecified", format: "workshop", modality: "in-person", pacing: "scheduled", area: "011",
    settings: { attendance: true, workGroups: true }, programId: null, leadId: educatorId,
  })).id;
  const group = (await call<{ id: string }>(admin, `/courses/${course}/groups`, "POST", { name: e2eName(info, "Taller") })).id;
  await call(admin, `/courses/${course}/groups/${group}/educators`, "PUT", { userIds: [educatorId] });
  const names = ["Ana", "Leo", "Noa", "Iva"].map(name => e2eName(info, name));
  const learners: string[] = [];
  for (const displayName of names) learners.push((await call<{ id: string }>(admin, `/courses/${course}/groups/${group}/learners`, "POST", { displayName })).id);
  const period = (await call<{ gradebook: { periods: { id: string; from: string }[] } }>(educator, `/sections/${group}/grades`)).gradebook.periods[0];
  const session = (await call<{ id: string }>(educator, `/courses/${course}/sessions`, "POST", { groupId: group, sessionDate: period.from, lessonIds: [] })).id;
  await call(educator, `/courses/${course}/sessions/${session}/attendance`, "PUT", { marks: learners.map((learnerId, index) => ({ learnerId, status: index === 3 ? "absent" : index === 2 ? "late" : "present" })) });

  await signIn(page, "educador-demo", `/secciones/${group}/grupos`);
  await page.getByRole("button", { name: "Formar grupos" }).click();
  const wizard = page.getByRole("dialog", { name: "Formar grupos" });
  await wizard.getByLabel("Nombre del conjunto").fill("Ensayo");
  await wizard.getByRole("radio", { name: "Los presentes de una clase" }).click();
  await wizard.getByLabel("Clase", { exact: true }).selectOption(session);
  await wizard.getByRole("button", { name: "Vista previa" }).click();
  const preview = wizard.getByRole("region", { name: "Vista previa de los grupos" });
  await expect(preview.getByRole("heading", { name: "Grupo 1" })).toBeVisible();
  await expect(preview.getByText(names[0])).toBeVisible();
  await expect(preview.getByText(names[3])).toHaveCount(0);
  await shot(page, "asistente", wizard);
  // The dialog's body scrolls and its footer stays on screen, even on a phone with the preview open.
  await expect(wizard.getByRole("button", { name: "Crear conjunto" })).toBeInViewport({ ratio: 1 });
  await wizard.getByRole("button", { name: "Crear conjunto" }).click();
  await expect(page.getByRole("heading", { name: "Ensayo" })).toBeVisible();
  await shot(page, "conjunto");

  const setId = (await call<{ sets: { id: string }[] }>(educator, `/sections/${group}/group-sets`)).sets[0].id;
  await call(educator, `/sections/${group}/grades/periods/${period.id}/plan`, "PUT", { activities: [
    { title: "Ensayo en grupos", kind: "project", points: 60, grading: "points", groupMode: "group", workGroupSetId: setId, peerMin: 0.5, peerMax: 1.5 },
  ] });
  await page.goto(`/secciones/${group}/notas?periodo=${period.id}`);
  const mark = page.getByLabel("Nota de Grupo 1 en Ensayo en grupos");
  await mark.fill("60");
  await mark.blur();
  await expect(page.getByText("del grupo").first()).toBeVisible();
  await page.getByRole("button", { name: "Coevaluación" }).click();
  const matrix = page.getByRole("dialog", { name: /Coevaluación/ });
  await matrix.getByLabel(`Calificación de ${names[0]} a ${names[1]}`).fill("5");
  await matrix.getByLabel(`Calificación de ${names[0]} a ${names[2]}`).fill("1");
  await matrix.getByLabel(`Calificación de ${names[1]} a ${names[0]}`).fill("5");
  await matrix.getByLabel(`Calificación de ${names[1]} a ${names[2]}`).fill("1");
  await matrix.getByLabel(`Calificación de ${names[2]} a ${names[0]}`).fill("5");
  await matrix.getByLabel(`Calificación de ${names[2]} a ${names[1]}`).fill("3");
  await expect(matrix.getByText(`Factor de ${names[0]} ×1,5`)).toBeVisible();
  await matrix.getByRole("button", { name: "Guardar coevaluación" }).click();
  await expect(page.getByText("Coevaluación guardada")).toBeVisible();
  await shot(page, "cuadricula");
});
