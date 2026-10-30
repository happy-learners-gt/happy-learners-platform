import { mkdirSync } from "node:fs";
import type { Page, TestInfo } from "@playwright/test";
import { expect, test } from "./local-test";
import { completeOnboarding, e2eName, E2E_PREFIX, origin, sessionToken, signIn } from "./helpers";

const dir = ".release-evidence/screenshots/lote-4";

async function dismissToasts(page: Page) {
  await page.locator("button[aria-label='Cerrar notificación']").evaluateAll(buttons => {
    buttons.forEach(button => (button as HTMLButtonElement).click());
  });
}

async function shoot(page: Page, info: TestInfo, name: string, focus?: () => ReturnType<Page["locator"]>) {
  if (info.project.name !== "desktop") return;
  mkdirSync(dir, { recursive: true });
  for (const [width, height] of [[1440, 900], [390, 844]] as const) {
    await page.setViewportSize({ width, height });
    if (focus) await focus().scrollIntoViewIfNeeded();
    await page.screenshot({ path: `${dir}/${name}-${width}.png` });
  }
  await page.setViewportSize({ width: 1365, height: 900 });
}

test("the lead adapts one section and coordination sees the differences", async ({ page }, info) => {
  test.setTimeout(300_000);
  const adminToken = await sessionToken("admin-demo");
  const leadToken = await sessionToken("educador-demo");
  const headers = (token: string) => ({ Origin: origin, "Content-Type": "application/json", Cookie: `hl_session=${token}` });
  const call = (token: string, path: string, method = "GET", data?: unknown) => fetch(`${origin}/api${path}`, { method, headers: headers(token), ...(data ? { body: JSON.stringify(data) } : {}) });
  const json = async <T>(response: Response, status = 200) => { expect(response.status, await response.clone().text()).toBe(status); return response.json() as Promise<T>; };

  const courseTitle = e2eName(info, "Cátedra");
  const sectionAName = `${E2E_PREFIX} Sección A ${info.project.name}`;
  const sectionBName = `${E2E_PREFIX} Sección B ${info.project.name}`;
  const coreLesson = e2eName(info, "Lección del núcleo");
  const optionalLesson = e2eName(info, "Lección que se oculta");
  const ownLesson = e2eName(info, "Lección de la sección");
  const coreExam = e2eName(info, "Examen del núcleo");
  const optionalTask = e2eName(info, "Tarea que se oculta");
  const ownActivity = e2eName(info, "Ensayo de la sección");
  const course = await json<{ id: string }>(await call(adminToken, "/courses", "POST", {
    title: courseTitle, objective: "Adaptar por sección.", status: "active", educationType: "non-formal", level: "unspecified", format: "workshop", modality: "in-person", pacing: "scheduled",
    settings: { attendance: true }, programId: null, leadId: "user-educator",
  }), 201);
  const version = async () => (await json<{ course: { version: number } }>(await call(adminToken, `/courses/${course.id}`))).course.version;
  await json(await call(adminToken, `/courses/${course.id}/team`, "PUT", { version: await version(), members: [{ userId: "user-educator", role: "lead" }, { userId: "user-1", role: "co-teacher" }] }));
  const sectionA = await json<{ id: string }>(await call(adminToken, `/courses/${course.id}/groups`, "POST", { name: sectionAName }), 201);
  const sectionB = await json<{ id: string }>(await call(adminToken, `/courses/${course.id}/groups`, "POST", { name: sectionBName }), 201);
  await json(await call(adminToken, `/courses/${course.id}/groups/${sectionA.id}/educators`, "PUT", { userIds: ["user-educator"] }));
  await json(await call(adminToken, `/courses/${course.id}/groups/${sectionB.id}/educators`, "PUT", { userIds: ["user-1", "user-educator"] }));
  const learner = await json<{ id: string }>(await call(adminToken, `/courses/${course.id}/groups/${sectionA.id}/learners`, "POST", { displayName: "Ana" }), 201);
  const unit = await json<{ id: string }>(await call(leadToken, `/courses/${course.id}/units`, "POST", { version: await version(), name: e2eName(info, "Fracciones"), objective: "Entender una fracción.", status: "active" }), 201);
  const lessonBody = (title: string) => ({ title, objective: "Objetivo de la lección.", instructions: "Haz la actividad.", courseUnitId: unit.id, activities: [{ id: "a", type: "text", position: 0, title: "Actividad", instructions: "Sigue", minutes: 10 }] });
  const kept = await json<{ lesson: { id: string } }>(await call(leadToken, "/lessons", "POST", lessonBody(coreLesson)), 201);
  const optional = await json<{ lesson: { id: string } }>(await call(leadToken, "/lessons", "POST", lessonBody(optionalLesson)), 201);
  expect((await call(leadToken, `/lessons/${kept.lesson.id}/publish`, "POST")).status).toBe(200);
  expect((await call(leadToken, `/lessons/${optional.lesson.id}/publish`, "POST")).status).toBe(200);
  const assessment = await json<{ periods: { id: string }[] }>(await call(leadToken, `/courses/${course.id}/assessment`));
  await json(await call(leadToken, `/courses/${course.id}/assessment/activities`, "POST", { periodId: assessment.periods[0].id, title: coreExam, kind: "exam", categoryId: "general", points: 60, grading: "points", groupMode: "individual" }), 201);
  await json(await call(leadToken, `/courses/${course.id}/assessment/activities`, "POST", { periodId: assessment.periods[0].id, title: optionalTask, kind: "task", categoryId: "general", points: 40, grading: "points", groupMode: "individual" }), 201);

  const username = `e2e-catedra-${info.project.name}-${Date.now().toString(36)}`;
  const created = await json<{ member: { id: string }; temporaryPassword: string }>(await call(adminToken, "/members", "POST", { displayName: e2eName(info, "Coordinación"), username, role: "educator" }), 201);
  const password = "Catedra-2026!Coord";
  const login = await fetch(`${origin}/api/login`, { method: "POST", headers: { Origin: origin, "Content-Type": "application/json" }, body: JSON.stringify({ username, password: created.temporaryPassword }) });
  expect(login.status).toBe(200);
  const coordinator = /hl_session=([^;]+)/.exec(login.headers.get("set-cookie") || "")![1];
  expect((await call(coordinator, "/account/password", "POST", { currentPassword: created.temporaryPassword, newPassword: password })).status).toBe(200);
  await completeOnboarding(coordinator, "Pedagogía", password);
  expect((await call(adminToken, `/members/${created.member.id}/coordination`, "PUT", { enabled: true, scope: { all: true } })).status).toBe(200);

  // Course configuration belongs to administration. The lead marks the core.
  await signIn(page, "admin-demo", `/cursos/${course.id}/configuracion`);
  await expect(page.getByRole("heading", { level: 1, name: "Configuración" })).toBeVisible();
  const policy = page.getByRole("group", { name: "Libertad de cátedra" });
  await expect(policy.getByRole("radio", { name: /Igual en todas las secciones/ })).toBeChecked();
  await shoot(page, info, "configuracion-politica", () => policy);
  await policy.getByRole("radio", { name: /Libre con núcleo de resultados/ }).click();
  const change = page.getByRole("dialog", { name: /¿Cambiar a «Libre con núcleo de resultados»\?/ });
  await expect(change).toContainText("Todo el contenido y la evaluación actuales quedan como núcleo.");
  await change.getByRole("button", { name: "Cambiar política" }).click();
  await expect(change).toBeHidden();
  await expect(policy.getByRole("radio", { name: /Libre con núcleo de resultados/ })).toBeChecked();
  await expect(page.getByRole("button", { name: "Guardar cambios" })).toBeVisible();
  await expect(policy.getByRole("checkbox", { name: /requieren aprobación del responsable del curso/ })).toBeVisible();
  await shoot(page, info, "revision-checkbox", () => page.getByRole("checkbox", { name: /requieren aprobación del responsable del curso/ }));

  await page.context().clearCookies();
  await signIn(page, "educador-demo", `/cursos/${course.id}/contenido`);
  await expect(page.getByRole("heading", { level: 1, name: "Contenido" })).toBeVisible();
  await expect(page.getByText(/2 en el núcleo/)).toBeVisible();
  await page.getByRole("button", { name: `Acciones de la lección ${optionalLesson}` }).click();
  await page.getByRole("menuitem", { name: "Quitar del núcleo" }).click();
  await expect(page.getByText(/1 en el núcleo/)).toBeVisible();
  await expect(page.getByRole("link", { name: "Ver diferencias entre secciones" })).toBeVisible();
  await shoot(page, info, "contenido-nucleo", () => page.getByText(coreLesson));

  await page.goto(`/cursos/${course.id}/evaluacion`);
  await expect(page.getByRole("heading", { level: 1, name: "Evaluación" })).toBeVisible();
  await expect(page.getByText(/Núcleo: 100 de 100 puntos/)).toBeVisible();
  await page.getByRole("button", { name: `Acciones de ${optionalTask}` }).click();
  await page.getByRole("menuitem", { name: "Quitar del núcleo" }).click();
  await expect(page.getByText(/Núcleo: 60 de 100 puntos/)).toBeVisible();
  await shoot(page, info, "evaluacion-nucleo", () => page.getByText(/Núcleo: 60 de 100 puntos/));

  await page.goto(`/secciones/${sectionA.id}/plan`);
  await expect(page.getByRole("heading", { level: 1, name: "Plan de la sección" })).toBeVisible();
  await expect(page.getByRole("tab", { name: "Contenido" })).toBeVisible();
  await expect(page.getByRole("tab", { name: "Evaluación" })).toBeVisible();
  await page.getByRole("button", { name: `Acciones de la lección ${optionalLesson}` }).click();
  await page.getByRole("menuitem", { name: "Ocultar en esta sección" }).click();
  await expect(page.getByText(/Ocultas en esta sección \(1\)/)).toBeVisible();
  await page.getByRole("button", { name: "Crear lección propia" }).click();
  const own = page.getByRole("dialog", { name: "Crear lección propia" });
  await expect(own.getByText("Solo la ve esta sección.")).toBeVisible();
  await own.getByLabel("Título").fill(ownLesson);
  await own.getByLabel("Objetivo").fill("Una lección que solo ve esta sección.");
  await own.getByRole("button", { name: "Crear y abrir" }).click();
  await expect(page.getByText("Solo la ve esta sección.")).toBeVisible();
  await page.goto(`/secciones/${sectionA.id}/plan`);
  await expect(page.getByText("Propia de la sección").first()).toBeVisible();
  await expect(page.getByText(ownLesson)).toBeVisible();
  await shoot(page, info, "plan-contenido", () => page.getByText(ownLesson));
  await page.getByRole("button", { name: "Acciones del plan" }).click();
  await page.getByRole("menuitem", { name: "Crear unidad propia" }).click();
  const ownUnitDialog = page.getByRole("dialog", { name: "Crear unidad propia" });
  const ownUnit = e2eName(info, "Unidad de la sección");
  await ownUnitDialog.getByLabel("Nombre").fill(ownUnit);
  await ownUnitDialog.getByRole("button", { name: "Crear unidad" }).click();
  await expect(page.getByRole("heading", { name: ownUnit })).toBeVisible();
  await dismissToasts(page);
  await shoot(page, info, "unidad-propia", () => page.getByRole("heading", { name: ownUnit }));
  await page.getByRole("button", { name: `Acciones de la lección ${ownLesson}` }).click();
  await page.getByRole("menuitem", { name: "Copiar a otra sección" }).click();
  const copy = page.getByRole("dialog", { name: "Copiar a otra sección" });
  await expect(copy.getByRole("checkbox", { name: sectionBName })).toBeVisible();
  await shoot(page, info, "copiar-seccion");
  await page.keyboard.press("Escape");
  await expect(copy).toBeHidden();
  await page.getByRole("button", { name: `Acciones de la lección ${ownLesson}` }).click();
  await page.getByRole("menuitem", { name: "Proponer al curso" }).click();
  await expect(page.getByText(/quedó propuesta al curso/)).toBeVisible();
  await dismissToasts(page);
  const withReview = await json<{ course: Record<string, unknown> & { settings: Record<string, unknown> } }>(await call(adminToken, `/courses/${course.id}`));
  expect((await call(adminToken, `/courses/${course.id}`, "PUT", { ...withReview.course, settings: { ...withReview.course.settings, sectionFreedomReview: true } })).status).toBe(200);
  await json(await call(leadToken, `/sections/${sectionA.id}/lessons`, "POST", lessonBody("Lección en revisión")), 201);
  await page.reload();
  const pending = page.getByText("En revisión", { exact: true });
  await expect(pending).toBeVisible();
  await shoot(page, info, "leccion-en-revision", () => page.getByText("En revisión", { exact: true }));
  const withoutReview = await json<{ course: Record<string, unknown> & { settings: Record<string, unknown> } }>(await call(adminToken, `/courses/${course.id}`));
  expect((await call(adminToken, `/courses/${course.id}`, "PUT", { ...withoutReview.course, settings: { ...withoutReview.course.settings, sectionFreedomReview: false } })).status).toBe(200);
  await page.getByRole("button", { name: /Lecciones del núcleo/ }).click();
  const coverage = page.getByRole("dialog", { name: "Cobertura del núcleo" });
  await expect(coverage.getByRole("heading", { name: "Lecciones sin planificar" })).toBeVisible();
  await expect(coverage.getByText(coreLesson)).toBeVisible();
  await shoot(page, info, "cobertura");
  await page.keyboard.press("Escape");
  await expect(coverage).toBeHidden();

  await page.getByRole("tab", { name: "Evaluación" }).click();
  await page.getByRole("button", { name: `Acciones de ${optionalTask}` }).click();
  await page.getByRole("menuitem", { name: "Ocultar en esta sección" }).click();
  await expect(page.getByText(/Ocultas en esta sección \(1\)/)).toBeVisible();
  await page.getByRole("button", { name: "Agregar actividad propia" }).click();
  const added = page.getByRole("dialog", { name: /Nueva actividad/ });
  await expect(added.getByText("Solo la ve esta sección.")).toBeVisible();
  await added.getByLabel("Nombre", { exact: true }).fill(ownActivity);
  await added.getByRole("button", { name: "Guardar" }).click();
  await expect(page.getByText(ownActivity, { exact: true })).toBeVisible();
  await page.getByRole("button", { name: `Acciones de ${coreExam}` }).click();
  await page.getByRole("menuitem", { name: "Reemplazar en esta sección" }).click();
  const replacement = page.getByRole("dialog", { name: /Reemplazo de/ });
  await expect(replacement.getByText(/La categoría y los puntos quedan iguales/)).toBeVisible();
  await replacement.getByRole("button", { name: "Guardar" }).click();
  await expect(replacement).toBeHidden();
  await expect(page.getByText(`Reemplaza a «${coreExam}»`, { exact: true })).toBeVisible();
  await dismissToasts(page);
  await shoot(page, info, "plan-evaluacion", () => page.getByText(`Reemplaza a «${coreExam}»`, { exact: true }));

  const plan = await json<{ activities: { id: string; title: string }[] }>(await call(leadToken, `/sections/${sectionA.id}/plan`));
  const graded = plan.activities.find(item => item.title === ownActivity);
  expect(graded).toBeTruthy();
  expect((await call(leadToken, `/sections/${sectionA.id}/grades`, "PUT", { scores: [{ activityId: graded!.id, learnerId: learner.id, points: 8 }] })).status).toBe(200);

  await page.goto(`/cursos/${course.id}/contenido`);
  await expect(page.getByRole("button", { name: "1 propuesta de las secciones" })).toBeVisible();
  await page.getByRole("button", { name: "1 propuesta de las secciones" }).click();
  const proposal = page.getByRole("dialog", { name: ownLesson });
  await expect(proposal.getByText(sectionAName)).toBeVisible();
  await shoot(page, info, "propuestas");
  await proposal.getByRole("button", { name: "Aceptar" }).click();
  await expect(page.getByText("La propuesta quedó en el curso.")).toBeVisible();
  await dismissToasts(page);

  await page.context().clearCookies();
  await signIn(page, "instructor-demo", `/secciones/${sectionB.id}/plan`);
  await expect(page.getByRole("heading", { level: 1, name: "Plan de la sección" })).toBeVisible();
  await expect(page.getByText(ownLesson)).toBeVisible();
  await expect(page.getByText("Propia de la sección")).toHaveCount(0);
  await expect(page.getByText(ownActivity)).toHaveCount(0);
  await expect(page.getByText(optionalLesson)).toBeVisible();
  await page.getByRole("tab", { name: "Evaluación" }).click();
  await expect(page.getByText(coreExam)).toBeVisible();
  await expect(page.getByText(optionalTask)).toBeVisible();
  await expect(page.getByText(`Reemplaza a «${coreExam}»`)).toHaveCount(0);

  const again = await fetch(`${origin}/api/login`, { method: "POST", headers: { Origin: origin, "Content-Type": "application/json" }, body: JSON.stringify({ username, password }) });
  expect(again.status, await again.clone().text()).toBe(200);
  const fresh = /hl_session=([^;]+)/.exec(again.headers.get("set-cookie") || "")![1];
  await page.context().clearCookies();
  await page.context().addCookies([{ name: "hl_session", value: fresh, url: origin, httpOnly: true, sameSite: "Strict" }]);
  await page.goto(`/cursos/${course.id}/secciones?vista=diferencias`);
  await expect(page.getByRole("tab", { name: "Diferencias" })).toBeVisible();
  await expect(page.getByRole("columnheader", { name: "Núcleo impartido" })).toBeVisible();
  const row = page.getByRole("row", { name: new RegExp(sectionAName) });
  await expect(row).toContainText("1");
  await row.click();
  const detail = page.getByRole("dialog", { name: sectionAName });
  await expect(detail.getByRole("link", { name: ownLesson })).toBeVisible();
  await expect(detail.getByText(optionalLesson)).toBeVisible();
  await expect(detail.getByText("Propuso 1 lección al curso · aceptada")).toBeVisible();
  await shoot(page, info, "diferencias");
  await shoot(page, info, "diferencias-propuesta");
  await page.keyboard.press("Escape");
  await expect(detail).toBeHidden();

  await page.context().clearCookies();
  await signIn(page, "admin-demo", `/cursos/${course.id}/configuracion`);
  await policy.getByRole("radio", { name: /Igual en todas las secciones/ }).click();
  const blocked = page.getByRole("dialog", { name: /¿Cambiar a «Igual en todas las secciones»\?/ });
  await blocked.getByRole("button", { name: "Cambiar política" }).click();
  await expect(blocked.getByRole("button", { name: "Entendido" })).toBeVisible();
  await expect(blocked.getByRole("button", { name: "Cambiar política" })).toHaveCount(0);
  await expect(blocked).toContainText(sectionAName);
  await expect(blocked).toContainText(ownActivity);
  await shoot(page, info, "politica-bloqueada");
  await blocked.getByRole("button", { name: "Entendido" }).click();

  const programName = e2eName(info, "Programa fijado");
  const program = await json<{ id: string }>(await call(adminToken, "/programs", "POST", {
    name: programName, description: "", educationType: "non-formal", level: "unspecified", format: "workshop", modality: "in-person", pacing: "scheduled",
    settings: { sectionFreedom: "free" }, locked: ["sectionFreedom"], status: "active",
  }), 201);
  const current = await json<{ course: Record<string, unknown> }>(await call(adminToken, `/courses/${course.id}`));
  expect((await call(adminToken, `/courses/${course.id}`, "PUT", { ...current.course, programId: program.id })).status).toBe(200);
  await page.reload();
  await expect(page.getByText(`Fijado por el programa «${programName}»`)).toBeVisible();
  await expect(policy.getByRole("radio", { name: /Libre con núcleo de resultados/ })).toBeDisabled();
  await shoot(page, info, "configuracion-fijada", () => policy);
});
