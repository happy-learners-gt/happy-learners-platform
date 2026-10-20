import AxeBuilder from "@axe-core/playwright";
import type { Page } from "@playwright/test";
import { test, expect } from "./local-test";
import { completeOnboarding, e2eName, expectRecentActivity, origin, publish, sessionToken, signIn, toast } from "./helpers";

const wcag = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];
async function audit(page: Page, label: string) {
  await page.waitForLoadState("networkidle");
  await page.waitForTimeout(400);
  const { violations } = await new AxeBuilder({ page }).withTags(wcag).analyze();
  expect(violations.map(item => `${label}: ${item.id} · ${item.nodes.map(node => node.target.join(" ")).slice(0, 3).join(" | ")}`)).toEqual([]);
}

test("HL-174 ST-128 ST-135: administration assigns coordination of one program, the coordinator publishes there, and a security group grants a permission", async ({ page, playwright, baseURL }, info) => {
  const headers = (username: string) => sessionToken(username).then(token => ({ Origin: baseURL!, Cookie: `hl_session=${token}` }));
  const admin = await playwright.request.newContext({ baseURL, extraHTTPHeaders: await headers("admin-demo") });
  const lucia = await playwright.request.newContext({ baseURL, extraHTTPHeaders: await headers("lucia.herrera") });
  let personId = "", groupId = "";
  try {
    // A fresh educator for this run, who never taught a course.
    const name = e2eName(info, "Coordinación"), username = `e2e-coord-${info.project.name}-${Date.now().toString(36)}`;
    const account = await admin.post("/api/members", { data: { displayName: name, username, role: "educator" } });
    expect(account.status(), await account.text()).toBe(201);
    const created = await account.json();
    personId = created.member.id;

    // ST-128 criterion 1: administration assigns the profile with a one-program scope from Educadores.
    await signIn(page, "admin-demo", "/educadores");
    const row = page.getByRole("row", { name: new RegExp(name) });
    await row.getByRole("button", { name: `Acciones de ${name}` }).click();
    await page.getByRole("menuitem", { name: "Asignar coordinación académica" }).click();
    const dialog = page.getByRole("dialog", { name: `Coordinación académica de ${name}` });
    await expect(dialog.getByRole("button", { name: "Asignar coordinación" })).toBeDisabled();
    await dialog.getByLabel("Primaria bilingüe", { exact: true }).check();
    await audit(page, "coordinación académica");
    await dialog.getByRole("button", { name: "Asignar coordinación" }).click();
    await expect(toast(page)).toContainText("tiene la coordinación académica de primaria bilingüe");
    await expect(row).toContainText("Coordinación: 1 programa");
    // Criterion 3: the change is in the activity.
    await expectRecentActivity(page, `asignó la coordinación académica a ${name}`);

    // The person signs in after the change and chooses their own password.
    const login = await fetch(`${origin}/api/login`, { method: "POST", headers: { Origin: origin, "Content-Type": "application/json" }, body: JSON.stringify({ username, password: created.temporaryPassword }) });
    expect(login.status).toBe(200);
    const token = /hl_session=([^;]+)/.exec(login.headers.get("set-cookie") || "")![1];
    const changed = await fetch(`${origin}/api/account/password`, { method: "POST", headers: { Origin: origin, "Content-Type": "application/json", Cookie: `hl_session=${token}` }, body: JSON.stringify({ currentPassword: created.temporaryPassword, newPassword: "Coordina el programa 2026" }) });
    expect(changed.status).toBe(200);
    const coordinator = await playwright.request.newContext({ baseURL, extraHTTPHeaders: { Origin: baseURL!, Cookie: `hl_session=${token}` } });
    // Terms or a privacy policy another test published must be accepted first, as for anyone.
    const pending = (await (await coordinator.get("/api/session")).json()).pending as { id: string }[];
    if (pending.length) expect((await coordinator.post("/api/legal/accept", { data: { documentIds: pending.map(item => item.id) } })).status()).toBe(200);
    // ST-122: and, as a new account, the welcome.
    await completeOnboarding(token);

    // A co-teacher of Ciencias sends a lesson to review: a copy of a published one, so it meets the course's requirements.
    const lessons = (await (await lucia.get("/api/lessons?drafts=1&course=seed-course-ciencias")).json()).lessons as { id: string; revision: number; status: string }[];
    const source = (await (await lucia.get(`/api/lessons/${lessons.find(item => item.revision > 0 && item.status !== "archived")!.id}?draft=1`)).json()).lesson;
    const title = e2eName(info, "Lección para coordinación");
    const draft = await lucia.post("/api/lessons", { data: { title, objective: source.objective, courseId: source.courseId, courseUnitId: source.courseUnitId, duration: source.duration, sequence: source.sequence, outcomeIds: source.outcomeIds, instructions: "", activities: source.activities } });
    expect(draft.status(), await draft.text()).toBe(201);
    const lessonId = (await draft.json()).lesson.id as string;
    expect((await lucia.post(`/api/lessons/${lessonId}/review`, { data: { note: "Lista para revisión" } })).status()).toBe(201);

    // ST-128 criterion 2: the coordinator sees only the courses of that program, and publishes the lesson like the lead.
    await page.context().clearCookies();
    await page.context().addCookies([{ name: "hl_session", value: token, url: origin, httpOnly: true, sameSite: "Strict" }]);
    await page.goto("/cursos");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Cursos");
    const cards = page.locator("article.course-card");
    await expect(cards.getByRole("link", { name: "Ciencias Naturales 4.º primaria", exact: true })).toBeVisible();
    await expect(cards.getByRole("link", { name: "Matemáticas 3.º primaria", exact: true })).toBeVisible();
    await expect(cards.getByRole("link", { name: "Exploradores", exact: true })).toHaveCount(0);
    await expect(cards.getByRole("link", { name: "English Explorers A1", exact: true })).toHaveCount(0);
    await expect(cards).toHaveCount(2);
    expect((await coordinator.get("/api/courses/seed-course-english")).status()).toBe(403);
    await page.goto(`/cursos/seed-course-ciencias/lecciones/${lessonId}`);
    await expect(page.getByLabel("Título de la lección")).toHaveValue(title);
    await expect(page.locator(".review-banner")).toContainText("Lista para revisión");
    await audit(page, "lección en revisión para coordinación");
    await publish(page, "Aprobar y publicar");
    await expect(toast(page)).toContainText("Revisión aprobada y lección publicada");
    expect(((await (await lucia.get("/api/lessons?drafts=1&course=seed-course-ciencias")).json()).lessons as { id: string; status: string }[]).find(item => item.id === lessonId)!.status).toBe("published");

    // ST-135: administration creates a group, grants «Consultar la actividad» and adds the coordinator.
    await page.context().clearCookies();
    await signIn(page, "admin-demo", "/roles-y-accesos");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Roles y accesos");
    const matrix = page.getByRole("region", { name: "Matriz de accesos" });
    await expect(matrix).toContainText("Coordinación académica");
    await expect(matrix).toContainText("Solo administración");
    await audit(page, "roles y accesos");
    const group = e2eName(info, "Seguimiento");
    await page.getByRole("button", { name: "Crear grupo" }).first().click();
    const create = page.getByRole("dialog", { name: "Nuevo grupo de seguridad" });
    await create.getByLabel("Nombre").fill(group);
    await create.getByRole("button", { name: "Crear grupo" }).click();
    await expect(toast(page)).toContainText(`Grupo «${group}» creado`);
    groupId = ((await (await admin.get("/api/access/groups")).json()).groups as { id: string; name: string }[]).find(item => item.name === group)!.id;
    await page.getByRole("button", { name: `Acciones del grupo ${group}` }).click();
    await page.getByRole("menuitem", { name: "Permisos y alcance" }).click();
    const permissions = page.getByRole("dialog", { name: `Permisos de «${group}»` });
    await permissions.getByRole("checkbox", { name: /Consultar la actividad/ }).check();
    await audit(page, "permisos del grupo");
    await permissions.getByRole("button", { name: "Guardar permisos" }).click();
    await expect(toast(page)).toContainText("Se aplican en la siguiente solicitud");
    await page.getByRole("button", { name: `Acciones del grupo ${group}` }).click();
    await page.getByRole("menuitem", { name: "Personas del grupo" }).click();
    const people = page.getByRole("dialog", { name: `Personas de «${group}»` });
    await people.getByRole("checkbox", { name: new RegExp(name) }).check();
    await people.getByRole("button", { name: "Guardar personas" }).click();
    await expect(toast(page)).toContainText(`Personas de «${group}» guardadas`);
    const column = await matrix.locator("thead th").allTextContents();
    expect(column).toContain(group);
    await expect(matrix.getByRole("row", { name: /Consultar la actividad/ })).toContainText("Todos los programas");
    await expect(page.locator(".access-events")).toContainText(`Creó el grupo de seguridad «${group}»`);
    // ST-135 criterion 3: applied on the coordinator's next request, without a new session.
    expect((await (await coordinator.get("/api/session")).json()).member.permissions.grants["activity.view"]).toEqual({ all: true });
    expect((await coordinator.get("/api/courses/seed-course-english")).status()).toBe(200);
    await coordinator.dispose();
  } finally {
    if (groupId) await admin.delete(`/api/access/groups/${groupId}`);
    if (personId) await admin.put(`/api/members/${personId}/coordination`, { data: { enabled: false } });
    await admin.dispose(); await lucia.dispose();
  }
});
