import { test, expect } from "./local-test";
import { E2E_PREFIX, e2eName, openNavigation, origin, sectionNav, sessionToken, signIn, toast } from "./helpers";

const course = "course-exploradores";
// Dates in the organization's time zone, as the app computes them, whatever the runner's clock.
const day = (offset: number) => new Date(Date.now() + offset * 86_400_000).toLocaleDateString("en-CA", { timeZone: "America/Guatemala" });

test("HL-61 ST-035 ST-097 ST-098 ST-101 ST-102: administration prepares a section, its educator plans and teaches a class and the section follows it with its code", async ({ page }, info) => {
  const group = e2eName(info, "Clase"), first = `${E2E_PREFIX} Ana`, second = `${E2E_PREFIX} Beto`;
  // DEC-024: the course defines what is taught; each section is its own instance, created by administration.
  await signIn(page, "admin-demo", `/cursos/${course}/secciones`);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Secciones");
  await page.getByRole("button", { name: "Nueva sección", exact: true }).click();
  const form = page.getByRole("form", { name: "Nueva sección" });
  await form.getByLabel("Nombre de la sección").fill(group);
  await form.getByRole("button", { name: "Crear sección" }).click();
  await expect(page).toHaveURL(/\/secciones\/group-[a-z0-9-]+$/);
  const groupId = new URL(page.url()).pathname.split("/")[2];
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(group);
  // ST-102: administration assigns who teaches the section, from the course's team.
  const educators = page.getByRole("form", { name: `Asignar educador a ${group}` });
  await educators.getByLabel(`Educador para ${group}`).selectOption("user-educator");
  await educators.getByRole("button", { name: "Asignar" }).click();
  await expect(toast(page)).toContainText(`imparte ${group}`);
  await expect(page.locator(".section-educators")).toContainText("@educador-demo");
  await openNavigation(page);
  await sectionNav(page).getByRole("link", { name: "Estudiantes", exact: true }).click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Estudiantes");
  // A pasted list adds every student at once.
  await page.getByLabel("Nombres de lista").fill(`${first}\n${second}`);
  await page.getByRole("form", { name: `Agregar estudiantes a ${group}` }).getByRole("button", { name: "Agregar 2 estudiantes" }).click();
  await expect(toast(page)).toContainText("2 estudiantes agregados");
  for (const learner of [first, second]) await expect(page.locator(".roster").getByText(learner, { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Generar código" }).click();
  const code = (await page.getByLabel(`Código de la sección ${group}`).textContent())!.trim();
  expect(code).toMatch(/^DG-[A-Z0-9]{4}-[A-Z0-9]{4}$/);

  // The educator teaches it: the section is theirs to consult, but not to configure.
  await signIn(page, "educador-demo", `/secciones/${groupId}/estudiantes`);
  await expect(page.locator(".roster")).toContainText(first);
  await expect(page.getByRole("form", { name: `Agregar estudiantes a ${group}` })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Agregar estudiantes" })).toHaveCount(0);
  await page.goto(`/secciones/${groupId}`);
  await expect(page.locator(".page-header")).toContainText("sin horario");
  await expect(page.getByRole("button", { name: `Acciones de la sección ${group}` })).toHaveCount(0);
  await expect(page.getByRole("form", { name: `Asignar educador a ${group}` })).toHaveCount(0);

  // Add today's class with a lesson: the schedule shows its activities and resources, without choosing them again.
  await page.getByRole("link", { name: "Ver cronograma" }).click();
  await expect(page).toHaveURL(new RegExp(`/secciones/${groupId}/clases$`));
  await page.getByRole("button", { name: "Agregar clase" }).click();
  let dialog = page.getByRole("dialog", { name: "Agregar clase" });
  // The class belongs to this section: there is no other section to choose.
  await expect(dialog.getByLabel("Sección")).toHaveCount(0);
  await expect(dialog.getByRole("checkbox")).toHaveCount(0);
  await dialog.getByLabel("Hora").fill("08:00");
  await dialog.getByLabel("Agregar lección").selectOption({ label: "Greetings and Introductions · 20 min" });
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
  await expect(page).toHaveURL(new RegExp(`/secciones/${groupId}/clases/class-`));
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
  // ST-109: finishing asks how far each lesson got; every lesson starts as completed.
  const finish = page.getByRole("dialog", { name: "Finalizar clase" });
  await expect(finish.getByRole("radiogroup", { name: "Greetings and Introductions" }).getByLabel("Completada")).toBeChecked();
  await finish.getByRole("button", { name: "Finalizar clase" }).click();
  await expect(page.locator(".page-meta .badge")).toHaveText("Impartida");
  await page.reload();
  await expect(page.getByRole("heading", { name: "Asistencia registrada" })).toBeVisible();
  await expect(page.getByRole("radiogroup", { name: second }).getByLabel("Ausente")).toBeChecked();
  await expect(page.locator(".page-header")).toContainText("impartió");

  // Add the next class with only its date, then plan it from the schedule; the schedule tracks the class just taught.
  await openNavigation(page);
  await sectionNav(page).getByRole("link", { name: "Cronograma", exact: true }).click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Cronograma");
  await page.getByRole("button", { name: "Agregar clase" }).click();
  dialog = page.getByRole("dialog", { name: "Agregar clase" });
  await dialog.getByLabel("Fecha").fill(day(1));
  await dialog.getByLabel("Hora").fill("09:15");
  await dialog.getByRole("button", { name: "Agregar clase" }).click();
  await expect(toast(page)).toContainText("Clase agregada al cronograma.");
  await table.getByRole("button", { name: /^Planificar la clase del/ }).click();
  dialog = page.getByRole("dialog", { name: /^Planificar la clase del/ });
  await dialog.getByLabel("Agregar lección").selectOption({ label: "Greetings and Introductions · 20 min" });
  await dialog.getByRole("button", { name: "Guardar planificación" }).click();
  await expect(toast(page)).toContainText("Planificación guardada.");
  const next = table.getByRole("row").filter({ hasText: "09:15" });
  await expect(next).toContainText("Clase 2");
  await expect(next).toContainText("Greetings and Introductions");
  await expect(table.getByRole("row").filter({ hasText: "Impartida" })).toContainText("1 de 2 presentes (50 %)");
  await page.goto(`/secciones/${groupId}/clases?vista=historial`);
  await expect(table.locator("tbody tr")).toHaveCount(1);
  await expect(table.locator("tbody tr").first()).toContainText("Impartida");
  await expect(page.locator(".class-stats")).toContainText("50 %");
  await expect(page.locator(".class-stats")).toContainText("2 de 2");
  // The section's summary has its own indicators.
  await page.goto(`/secciones/${groupId}`);
  await expect(page.locator(".stat-tiles").first()).toContainText("1 de 2");
  await expect(page.locator(".stat-tiles").first()).toContainText("50 %");

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
  const admin = await sessionToken("admin-demo");
  const disabled = await fetch(`${origin}/api/courses/${course}/groups/${groupId}/code`, { method: "DELETE", headers: { Origin: origin, Cookie: `hl_session=${admin}` } });
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
  // ST-157: «Tu educador» shows the educators' published profiles on purpose; nothing else names a person, and the
  // card never carries contact data.
  const { educators, ...rest } = space;
  expect(JSON.stringify(rest)).not.toMatch(/displayName|attendance|notes|taughtBy/);
  expect(JSON.stringify(educators ?? [])).not.toMatch(/phone|contactEmail|"email"|attendance|notes/);
  // The section cookie is not an educator session.
  expect((await get("/api/courses")).status).toBe(401);
  expect((await get("/api/courses/seed-course-matematicas/groups")).status).toBe(401);
  expect((await get("/api/student/files/file-that-is-not-linked")).status).toBe(404);
  // The page opens straight from the code too.
  await page.context().addCookies([{ name: "hl_group", value: cookie.slice("hl_group=".length), url: origin, httpOnly: true, sameSite: "Strict" }]);
  await page.goto("/estudiante");
  await expect(page.getByRole("heading", { name: "Próxima clase" }).or(page.locator(".student-next"))).toBeVisible();
  await expect(page.locator(".student-next")).toContainText(/Abrir lección|aún no están disponibles/);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test("HL-62 ST-036: the course shows upcoming classes with time and the history with indicators", async ({ page }) => {
  await signIn(page, "lucia.herrera", "/inicio");
  const upcoming = page.locator(".session-list");
  await expect(upcoming.locator("li").first()).toBeVisible();
  await expect(upcoming.locator("li").first()).toContainText(/\d{2}:\d{2}/);
  await upcoming.getByRole("link").first().click();
  await expect(page).toHaveURL(/\/secciones\/seed-group-[a-z0-9-]+\/clases\/seed-/);
  await expect(page.getByRole("heading", { name: "Lección", exact: true })).toBeVisible();
  await page.goto("/secciones/seed-group-mat-3b/clases?vista=historial");
  const rows = page.locator(".schedule-table tbody tr");
  await expect(rows.filter({ hasText: "Impartida" }).first()).toContainText(/\d+ de \d+ presentes/);
  await expect(rows.filter({ hasText: "Sin registrar" }).first()).toBeVisible();
  await expect(page.locator(".class-stats")).toContainText("%");
  // Links from before sections were their own instance land in the section, or in the course's sections.
  await page.goto("/cursos/seed-course-matematicas/clases?seccion=seed-group-mat-3b&vista=historial");
  await expect(page).toHaveURL(/\/secciones\/seed-group-mat-3b\/clases\?vista=historial$/);
  await page.goto("/cursos/seed-course-matematicas/horario#horario-seed-group-mat-3b");
  await expect(page).toHaveURL(/\/secciones\/seed-group-mat-3b\/horario$/);
  await page.goto("/cursos/seed-course-matematicas/asistencia");
  await expect(page).toHaveURL(/\/cursos\/seed-course-matematicas\/secciones$/);
});

test("HL-61 ST-070: a section is renamed, loses a student, closes without new classes and reopens", async ({}, info) => {
  // Administration manages the section; the course's lead plans its classes.
  const cookie = `hl_session=${await sessionToken("admin-demo")}`, lead = `hl_session=${await sessionToken("educador-demo")}`;
  const request = (session: string) => (method: string, path: string, data?: unknown) => fetch(`${origin}/api/courses/${course}${path}`, { method, headers: { Origin: origin, Cookie: session, "Content-Type": "application/json" }, body: data === undefined ? undefined : JSON.stringify(data) });
  const call = request(cookie), teach = request(lead);
  const studentLogin = (code: string) => fetch(`${origin}/api/student/login`, { method: "POST", headers: { Origin: origin, "Content-Type": "application/json" }, body: JSON.stringify({ code }) });
  const name = e2eName(info, "Ciclo");
  const { id } = await (await call("POST", "/groups", { name })).json() as { id: string };
  expect((await call("PUT", `/groups/${id}/educators`, { userIds: ["user-educator"], conflictReason: "Sección de prueba E2E; su horario puede coincidir con otras secciones de prueba." })).status).toBe(200);
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
  expect((await teach("POST", "/sessions", { groupId: id, sessionDate: day(1) })).status).toBe(400);
  expect((await call("POST", `/groups/${id}/learners`, { displayName: `${E2E_PREFIX} Tres` })).status).toBe(409);
  expect((await call("PUT", `/groups/${id}/schedule`, { weekdays: [1], startsAt: "08:00", durationMinutes: 45, from: day(1), until: day(8) })).status).toBe(409);
  expect((await studentLogin(accessCode)).status).toBe(404);

  expect((await call("PUT", `/groups/${id}`, { status: "active" })).status).toBe(200);
  const planned = await teach("POST", "/sessions", { groupId: id, sessionDate: day(1) });
  expect(planned.status).toBe(201);
  const { id: sessionId } = await planned.json() as { id: string };
  const detail = await (await teach("GET", `/sessions/${sessionId}`)).json() as { learners: { learnerId: string }[] };
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
