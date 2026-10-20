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

test("HL-170 ST-124: an educator turns off one notice, administration marks another mandatory, and an assignment appears in the sent log", async ({ page, playwright, baseURL }, info) => {
  const headers = (username: string) => sessionToken(username).then(token => ({ Origin: baseURL!, Cookie: `hl_session=${token}` }));
  const admin = await playwright.request.newContext({ baseURL, extraHTTPHeaders: await headers("admin-demo") });
  const diego = await playwright.request.newContext({ baseURL, extraHTTPHeaders: await headers("diego.ramirez") });
  const course = "seed-course-robotica";
  let personId = "";
  try {
    // Terms or a privacy policy another test published must be accepted first, as for anyone.
    const pending = (await (await diego.get("/api/session")).json()).pending as { id: string }[];
    if (pending.length) expect((await diego.post("/api/legal/accept", { data: { documentIds: pending.map(item => item.id) } })).status()).toBe(200);

    // Criterion 2: the educator turns off one notice by e-mail in «Preferencias» (ST-161 moved it from «Mi perfil»).
    await signIn(page, "diego.ramirez", "/perfil#notificaciones");
    await expect(page).toHaveURL(/\/mi-cuenta\/notificaciones$/);
    const notices = page.getByRole("region", { name: "Avisos por canal" });
    const returned = notices.getByRole("switch", { name: "Revisión devuelta: Correo" });
    await expect(returned).toBeChecked();
    await returned.uncheck();
    await expect(toast(page)).toContainText("Ya no recibirás «Revisión devuelta» por correo");
    await expect(returned).not.toBeChecked();
    await audit(page, "preferencias · notificaciones");

    // Criterion 2: administration marks another one mandatory; the educator sees it locked.
    await signIn(page, "admin-demo", "/notificaciones");
    await page.getByRole("list", { name: "Avisos obligatorios" }).getByRole("checkbox", { name: /Cancelación de una clase/ }).check();
    await page.getByRole("button", { name: "Guardar avisos obligatorios" }).click();
    await expect(toast(page)).toContainText("Avisos obligatorios guardados.");
    const settings = (await (await diego.get("/api/notifications/preferences")).json()).settings as { type: string; enabled: boolean; mandatory: boolean }[];
    expect(settings.find(item => item.type === "class_cancelled")).toMatchObject({ enabled: true, mandatory: true });
    expect(settings.find(item => item.type === "review_returned")).toMatchObject({ enabled: false, mandatory: false });

    // Criteria 1 and 3: assigning a fresh person to a course team leaves a record in the sent log.
    const name = e2eName(info, "Avisos"), username = `e2e-avisos-${info.project.name}-${Date.now().toString(36)}`;
    const account = await admin.post("/api/members", { data: { displayName: name, username, role: "educator" } });
    expect(account.status(), await account.text()).toBe(201);
    personId = (await account.json()).member.id;
    const current = (await (await admin.get(`/api/courses/${course}`)).json()).course as { version: number; team: { userId: string; role: string }[] };
    const team = [...current.team.map(member => ({ userId: member.userId, role: member.role })), { userId: personId, role: "co-teacher" }];
    const saved = await admin.put(`/api/courses/${course}/team`, { data: { members: team, version: current.version } });
    expect(saved.status(), await saved.text()).toBe(200);
    await page.reload();
    const log = page.getByRole("region", { name: "Notificaciones enviadas" });
    await page.getByLabel("Persona").selectOption({ label: name });
    const row = log.getByRole("row", { name: new RegExp(name) });
    await expect(row).toContainText("Asignación a un curso");
    await expect(row).toContainText("Te asignaron al equipo docente del curso");
    await expect(row).toContainText("Sin correo");
    await audit(page, "notificaciones");
  } finally {
    await admin.put("/api/notifications/policy", { data: { mandatory: [] } });
    await diego.put("/api/notifications/preferences", { data: { preferences: { review_returned: true } } });
    if (personId) {
      const current = (await (await admin.get(`/api/courses/${course}`)).json()).course as { version: number; team: { userId: string; role: string }[] };
      await admin.put(`/api/courses/${course}/team`, { data: { members: current.team.filter(member => member.userId !== personId).map(member => ({ userId: member.userId, role: member.role })), version: current.version } });
      await admin.put(`/api/members/${personId}`, { data: { role: "educator", active: false } });
    }
    await admin.dispose(); await diego.dispose();
  }
});
