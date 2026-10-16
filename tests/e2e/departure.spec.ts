import AxeBuilder from "@axe-core/playwright";
import type { Page } from "@playwright/test";
import { test, expect } from "./local-test";
import { e2eName, sessionToken, signIn, toast } from "./helpers";

const wcag = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];
async function audit(page: Page, label: string) {
  await page.waitForLoadState("networkidle");
  await page.waitForTimeout(400);
  const { violations } = await new AxeBuilder({ page }).withTags(wcag).analyze();
  expect(violations.map(item => `${label}: ${item.id} · ${item.nodes.map(node => node.target.join(" ")).slice(0, 3).join(" | ")}`)).toEqual([]);
}

test("HL-169 ST-123: administration registers a departure after reassigning the person's course and section", async ({ page, playwright, baseURL }, info) => {
  const admin = await playwright.request.newContext({ baseURL, extraHTTPHeaders: { Origin: baseURL!, Cookie: `hl_session=${await sessionToken("admin-demo")}` } });
  try {
    // A person who leads a course and is the only educator of its section.
    const name = e2eName(info, "Salida"), username = `e2e-salida-${info.project.name}-${Date.now().toString(36)}`;
    const account = await admin.post("/api/members", { data: { displayName: name, username, role: "educator" } });
    expect(account.status(), await account.text()).toBe(201);
    const leaving = (await account.json()).member.id as string;
    const title = e2eName(info, "Curso con salida");
    const created = await admin.post("/api/courses", { data: { title, objective: "Seguir el curso tras una salida.", status: "active", educationType: "non-formal", level: "unspecified", format: "workshop", modality: "in-person", pacing: "scheduled", area: "011", settings: { attendance: true }, programId: null, leadId: leaving } });
    expect(created.status(), await created.text()).toBe(201);
    const courseId = (await created.json()).id as string, path = `/api/courses/${courseId}`;
    const section = e2eName(info, "Sección con salida");
    const groupId = (await (await admin.post(`${path}/groups`, { data: { name: section } })).json()).id as string;
    expect((await admin.put(`${path}/groups/${groupId}/educators`, { data: { userIds: [leaving] } })).status()).toBe(200);

    await signIn(page, "admin-demo", "/educadores");
    const row = page.getByRole("row", { name: new RegExp(name) });
    await row.getByRole("button", { name: `Acciones de ${name}` }).click();
    await page.getByRole("menuitem", { name: "Registrar salida" }).click();
    const dialog = page.getByRole("dialog", { name: `Registrar la salida de ${name}` });
    await expect(dialog.getByLabel("Fecha de salida")).not.toHaveValue("");
    const confirm = dialog.getByRole("button", { name: "Registrar salida" });
    // Criterion 2: confirming waits until the course and the section have someone.
    await expect(confirm).toBeDisabled();
    await expect(dialog).toContainText("Faltan 2 reasignaciones para confirmar.");
    await audit(page, "registrar salida");
    await dialog.getByLabel("Motivo").fill("Termina su contrato.");
    await dialog.getByLabel(`Nueva persona responsable de «${title}»`).selectOption("user-educator");
    await expect(confirm).toBeDisabled();
    await dialog.getByLabel(`Quién imparte «${section}» (${title})`).selectOption("user-1");
    await expect(dialog).toContainText("Todo lo que dirige o imparte tiene quien lo continúe.");
    await expect(confirm).toBeEnabled();
    await confirm.click();

    // Criterion 1: the person loses access and the date shows in the list; criterion 3: the departure is in the activity.
    await expect(toast(page)).toContainText(`Salida de ${name} registrada`);
    await expect(row).toContainText("Sin acceso");
    await expect(row).toContainText("Salió el");
    await expect(page.locator(".activity-feed").first()).toContainText(`registró la salida de ${name}`);
    await audit(page, "educadores tras la salida");
    const team = ((await (await admin.get("/api/progress")).json()).courses as { courseId: string; team: { userId: string; role: string }[] }[]).find(course => course.courseId === courseId)!.team;
    expect(team.map(member => [member.userId, member.role]).sort()).toEqual([["user-1", "co-teacher"], ["user-educator", "lead"]]);
    const educators = (await (await admin.get(`/api/sections/${groupId}`)).json()).section.educators as { userId: string }[];
    expect(educators.map(item => item.userId)).toEqual(["user-1"]);
    expect((await admin.get("/api/members")).ok()).toBe(true);
    expect(((await (await admin.get("/api/members")).json()).members as { id: string; active: boolean }[]).find(member => member.id === leaving)).toMatchObject({ active: false });
  } finally { await admin.dispose(); }
});
