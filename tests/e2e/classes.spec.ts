import { test, expect } from "./local-test";
import { E2E_PREFIX, courseNav, e2eName, openNavigation, origin, sessionToken, signIn, toast } from "./helpers";

const course = "course-exploradores";
const day = (offset: number) => { const date = new Date(); date.setDate(date.getDate() + offset); return date.toLocaleDateString("en-CA"); };

test("HL-61 ST-035 ST-097 ST-098 ST-101: an educator assigns students, plans the schedule of classes, teaches a class and the section follows it with its code", async ({ page }, info) => {
  const group = e2eName(info, "Clase"), first = `${E2E_PREFIX} Ana`, second = `${E2E_PREFIX} Beto`;
  await signIn(page, "educador-demo", `/cursos/${course}/asignaciones`);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Asignaciones");
  await page.getByRole("button", { name: "Nueva sección", exact: true }).click();
  const form = page.getByRole("form", { name: "Nueva sección" });
  await form.getByLabel("Nombre de la sección").fill(group);
  await form.getByRole("button", { name: "Crear sección" }).click();
  const card = page.locator(".group-card").filter({ has: page.getByRole("heading", { name: group, exact: true }) });
  for (const learner of [first, second]) {
    await card.getByLabel(`Nombre o código de lista para ${group}`).fill(learner);
    await card.getByRole("button", { name: "Asignar" }).click();
    await expect(card.getByText(learner, { exact: true })).toBeVisible();
  }
  await card.getByRole("button", { name: "Generar código" }).click();
  const code = (await card.getByLabel(`Código de la sección ${group}`).textContent())!.trim();
  expect(code).toMatch(/^DG-[A-Z0-9]{4}-[A-Z0-9]{4}$/);

  await expect(card).toContainText("Sin horario.");

  // Add today's class with a lesson: the schedule shows its activities and resources, without choosing them again.
  await card.getByRole("link", { name: "Ver clases" }).click();
  await expect(page).toHaveURL(/\/clases\?seccion=group-/);
  const groupId = new URL(page.url()).searchParams.get("seccion")!;
  await page.getByRole("button", { name: "Agregar clase" }).click();
  let dialog = page.getByRole("dialog", { name: "Agregar clase" });
  await expect(dialog.getByLabel("Sección").locator("option:checked")).toContainText(group);
  await expect(dialog.getByRole("checkbox")).toHaveCount(0);
  await dialog.getByLabel("Hora").fill("08:00");
  await dialog.getByLabel("Agregar lección").selectOption({ label: "Greetings and Introductions" });
  await expect(dialog.locator(".lesson-picker-list li")).toHaveCount(1);
  await dialog.getByLabel("Comentarios").fill("Traer tarjetas con nombres");
  await dialog.getByRole("button", { name: "Agregar clase" }).click();
  await expect(toast(page)).toContainText("Clase agregada al cronograma.");
  const table = page.getByRole("table", { name: /Cronograma de clases de/ });
  for (const column of ["Fecha", "Módulo", "Lecciones", "Actividades", "Comentarios", "Recursos", "Seguimiento"]) await expect(table.getByRole("columnheader", { name: column, exact: true })).toBeAttached();
  const today = table.getByRole("row").filter({ hasText: "Greetings and Introductions" });
  await expect(today).toContainText("Clase 1 · Semana 1");
  await expect(today).toContainText("Traer tarjetas con nombres");
  await expect(today).toContainText("Introduce yourself");
  await expect(today).toContainText("Hoy");
  await today.getByRole("link").first().click();
  await expect(page).toHaveURL(/\/clases\/class-/);
  await expect(page.locator(".page-meta .badge")).toHaveText("Hoy");
  await expect(page.locator(".class-side")).toContainText("Greetings and Introductions");
  await expect(page.getByRole("heading", { name: "Recursos (1)" })).toBeVisible();
  await page.locator(".class-side").getByRole("button", { name: "Introduce yourself" }).click();
  await expect(page.getByRole("dialog")).toContainText("My name is Sunny");
  await page.keyboard.press("Escape");

  // Open the class, take attendance and finish it.
  await page.getByRole("button", { name: "Comenzar clase" }).click();
  await expect(page.locator(".page-meta .badge")).toHaveText("En curso");
  await page.getByRole("button", { name: "Marcar 2 pendientes como presente" }).click();
  await page.getByRole("radiogroup", { name: second }).getByLabel("Ausente").check();
  await page.getByRole("button", { name: "Guardar asistencia" }).click();
  await expect(toast(page)).toContainText("1 presente, 1 ausente");
  await page.getByRole("button", { name: "Finalizar clase" }).click();
  await expect(page.locator(".page-meta .badge")).toHaveText("Impartida");
  await page.reload();
  await expect(page.getByRole("heading", { name: "Asistencia registrada" })).toBeVisible();
  await expect(page.getByRole("radiogroup", { name: second }).getByLabel("Ausente")).toBeChecked();
  await expect(page.locator(".page-header")).toContainText("impartió");

  // Add the next class with only its date, then plan it from the schedule; the schedule tracks the class just taught.
  await openNavigation(page);
  await courseNav(page).getByRole("link", { name: "Clases", exact: true }).click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Clases");
  await page.getByRole("button", { name: "Agregar clase" }).click();
  dialog = page.getByRole("dialog", { name: "Agregar clase" });
  await dialog.getByLabel("Sección").selectOption(groupId);
  await dialog.getByLabel("Fecha").fill(day(1));
  await dialog.getByLabel("Hora").fill("09:15");
  await dialog.getByRole("button", { name: "Agregar clase" }).click();
  await expect(toast(page)).toContainText("Clase agregada al cronograma.");
  await table.getByRole("button", { name: /^Planificar la clase del/ }).click();
  dialog = page.getByRole("dialog", { name: /^Planificar la clase del/ });
  await dialog.getByLabel("Agregar lección").selectOption({ label: "Greetings and Introductions" });
  await dialog.getByRole("button", { name: "Guardar planificación" }).click();
  await expect(toast(page)).toContainText("Planificación guardada.");
  const next = table.getByRole("row").filter({ hasText: "09:15" });
  await expect(next).toContainText("Clase 2");
  await expect(next).toContainText("Greetings and Introductions");
  await expect(table.getByRole("row").filter({ hasText: "Impartida" })).toContainText("1 de 2 presentes (50 %)");
  await page.goto(`/cursos/${course}/clases?vista=historial&seccion=${groupId}`);
  await expect(table.locator("tbody tr")).toHaveCount(1);
  await expect(table.locator("tbody tr").first()).toContainText("Impartida");
  await expect(page.locator(".class-stats")).toContainText("50 %");
  await expect(page.locator(".class-stats")).toContainText("2 de 2");

  // The section enters with the code — no account — and sees the next class with its lesson's resources.
  await page.context().clearCookies();
  await page.goto("/inicio");
  const entry = page.getByRole("form", { name: "¿Eres estudiante?" });
  await entry.getByLabel("Código de sección o de lección").fill(code.toLowerCase());
  await entry.getByRole("button", { name: "Abrir" }).click();
  await expect(page).toHaveURL(/\/estudiante$/);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(group);
  const upcoming = page.locator(".student-next");
  await expect(upcoming).toContainText("09:15");
  await expect(upcoming.getByRole("link", { name: "Abrir lección: Greetings and Introductions" })).toBeVisible();
  await upcoming.getByRole("button", { name: "Introduce yourself" }).click();
  await expect(upcoming).toContainText("My name is Sunny");
  await expect(page.getByRole("heading", { name: "Clases anteriores" })).toBeVisible();
  await expect(page.locator("body")).not.toContainText(first);
  await upcoming.getByRole("link", { name: /Abrir lección/ }).click();
  await expect(page).toHaveURL(/\/aprender\//);
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Greetings");

  // Disabling the code ends the section's access at once.
  const educator = await sessionToken("educador-demo");
  const disabled = await fetch(`${origin}/api/courses/${course}/groups/${groupId}/code`, { method: "DELETE", headers: { Origin: origin, Cookie: `hl_session=${educator}` } });
  expect(disabled.status).toBe(200);
  await page.goto("/estudiante");
  await expect(page.getByRole("heading", { name: "Escribe el código de tu sección" })).toBeVisible();
});

test("ST-098: the section code shows only that section's published content and its own files", async ({ page }) => {
  const login = (code: string) => fetch(`${origin}/api/student/login`, { method: "POST", headers: { Origin: origin, "Content-Type": "application/json" }, body: JSON.stringify({ code }) });
  expect((await login("DG-ZZZZ-ZZZZ")).status).toBe(404);
  expect((await login("GREETINGS")).status).toBe(400);
  const response = await login("DG-MATE-3A");
  expect(response.status).toBe(200);
  const cookie = /hl_group=[^;]+/.exec(response.headers.get("set-cookie") || "")![0];
  const get = (path: string) => fetch(`${origin}${path}`, { headers: { Cookie: cookie } });
  const space = await (await get("/api/student/space")).json();
  expect(space.group.name).toBeTruthy();
  expect(space.next).toBeTruthy();
  expect(JSON.stringify(space)).not.toMatch(/displayName|attendance|notes|taughtBy/);
  // The section cookie is not an educator session.
  expect((await get("/api/courses")).status).toBe(401);
  expect((await get("/api/courses/seed-course-matematicas/groups")).status).toBe(401);
  expect((await get("/api/student/files/file-that-is-not-linked")).status).toBe(404);
  // The page opens straight from the code too.
  await page.context().addCookies([{ name: "hl_group", value: cookie.slice("hl_group=".length), url: origin, httpOnly: true, sameSite: "Strict" }]);
  await page.goto("/estudiante");
  await expect(page.getByRole("heading", { name: "Próxima clase" }).or(page.locator(".student-next"))).toBeVisible();
  await expect(page.locator(".student-next")).toContainText(/Abrir lección|no está disponible/);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test("HL-62 ST-036: the course shows upcoming classes with time and the history with indicators", async ({ page }) => {
  await signIn(page, "lucia.herrera", "/inicio");
  const upcoming = page.locator(".session-list");
  await expect(upcoming.locator("li").first()).toBeVisible();
  await expect(upcoming.locator("li").first()).toContainText(/\d{2}:\d{2}/);
  await upcoming.getByRole("link").first().click();
  await expect(page).toHaveURL(/\/clases\/seed-/);
  await expect(page.getByRole("heading", { name: "Lección", exact: true })).toBeVisible();
  await page.goto("/cursos/seed-course-matematicas/clases?vista=historial&seccion=seed-group-mat-3b");
  const rows = page.locator(".schedule-table tbody tr");
  await expect(rows.filter({ hasText: "Impartida" }).first()).toContainText(/\d+ de \d+ presentes/);
  await expect(rows.filter({ hasText: "Sin registrar" }).first()).toBeVisible();
  await expect(page.locator(".class-stats")).toContainText("%");
  // Old links to attendance land on the classes.
  await page.goto("/cursos/seed-course-matematicas/asistencia");
  await expect(page).toHaveURL(/\/cursos\/seed-course-matematicas\/clases$/);
});

test("HL-61 ST-070: a section is renamed, loses a student, closes without new classes and reopens", async ({}, info) => {
  const cookie = `hl_session=${await sessionToken("educador-demo")}`;
  const call = (method: string, path: string, data?: unknown) => fetch(`${origin}/api/courses/${course}${path}`, { method, headers: { Origin: origin, Cookie: cookie, "Content-Type": "application/json" }, body: data === undefined ? undefined : JSON.stringify(data) });
  const studentLogin = (code: string) => fetch(`${origin}/api/student/login`, { method: "POST", headers: { Origin: origin, "Content-Type": "application/json" }, body: JSON.stringify({ code }) });
  const name = e2eName(info, "Ciclo");
  const { id } = await (await call("POST", "/groups", { name })).json() as { id: string };
  const learners: string[] = [];
  for (const displayName of [`${E2E_PREFIX} Uno`, `${E2E_PREFIX} Dos`]) learners.push((await (await call("POST", `/groups/${id}/learners`, { displayName })).json() as { id: string }).id);
  const group = async () => ((await (await call("GET", "/groups")).json()).groups as { id: string; name: string; status: string; learners: { id: string }[] }[]).find(item => item.id === id)!;

  expect((await call("PUT", `/groups/${id}`, { name: `${name} B` })).status).toBe(200);
  expect((await call("PUT", `/groups/${id}/learners/${learners[0]}`, { displayName: `${E2E_PREFIX} Uno bis` })).status).toBe(200);
  expect((await call("PUT", `/groups/${id}/learners/${learners[1]}`, { status: "archived" })).status).toBe(200);
  expect(await group()).toMatchObject({ name: `${name} B`, status: "active", learners: [{ id: learners[0], displayName: `${E2E_PREFIX} Uno bis` }] });
  const { accessCode } = await (await call("POST", `/groups/${id}/code`)).json() as { accessCode: string };
  expect((await studentLogin(accessCode)).status).toBe(200);

  // A closed section keeps its history but takes no new classes, students, schedule or student sessions.
  expect((await call("PUT", `/groups/${id}`, { status: "archived" })).status).toBe(200);
  expect((await group()).status).toBe("archived");
  expect((await call("POST", "/sessions", { groupId: id, sessionDate: day(1) })).status).toBe(400);
  expect((await call("POST", `/groups/${id}/learners`, { displayName: `${E2E_PREFIX} Tres` })).status).toBe(409);
  expect((await call("PUT", `/groups/${id}/schedule`, { weekdays: [1], startsAt: "08:00", durationMinutes: 45, from: day(1), until: day(8) })).status).toBe(409);
  expect((await studentLogin(accessCode)).status).toBe(404);

  expect((await call("PUT", `/groups/${id}`, { status: "active" })).status).toBe(200);
  const planned = await call("POST", "/sessions", { groupId: id, sessionDate: day(1) });
  expect(planned.status).toBe(201);
  const { id: sessionId } = await planned.json() as { id: string };
  const detail = await (await call("GET", `/sessions/${sessionId}`)).json() as { learners: { learnerId: string }[] };
  expect(detail.learners.map(learner => learner.learnerId)).toEqual([learners[0]]);
  expect((await call("PUT", `/groups/${id}`, { status: "archived" })).status).toBe(200);
});

test("the general library adds a resource to a chosen course and edits it", async ({ page }, info) => {
  const title = e2eName(info, "Recurso general");
  await signIn(page, "educador-demo", "/biblioteca");
  await page.getByRole("button", { name: "Agregar recurso" }).first().click();
  const dialog = page.getByRole("dialog", { name: "Agregar recurso" });
  await dialog.getByLabel("Curso").selectOption({ label: "Exploradores" });
  await dialog.getByLabel("Título").fill(title);
  await dialog.getByLabel("Descripción breve").fill("Saludo para empezar la clase");
  await dialog.getByRole("textbox", { name: "Texto" }).fill("Good morning, class!");
  await dialog.getByRole("button", { name: "Agregar recurso" }).click();
  await expect(dialog).toBeHidden();
  await page.getByLabel("Buscar en la biblioteca").fill(title);
  await page.getByText(title, { exact: true }).click();
  await page.getByRole("dialog", { name: title }).getByRole("button", { name: "Editar" }).click();
  const edit = page.getByRole("dialog", { name: "Editar recurso" });
  await edit.getByLabel("Título").fill(`${title} B`);
  await edit.getByRole("button", { name: "Guardar recurso" }).click();
  await expect(edit).toBeHidden();
  await page.getByLabel("Buscar en la biblioteca").fill(`${title} B`);
  await expect(page.getByText(`${title} B`, { exact: true })).toBeVisible();
  await page.goto(`/cursos/${course}/biblioteca`);
  await expect(page.getByText(`${title} B`, { exact: true })).toBeVisible();
});
