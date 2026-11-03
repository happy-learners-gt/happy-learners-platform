import AxeBuilder from "@axe-core/playwright";
import { readFileSync } from "node:fs";
import { test, expect } from "./local-test";
import { E2E_PREFIX, sessionToken, signIn, toast } from "./helpers";

const day = (offset: number) => new Date(Date.now() + offset * 86_400_000).toLocaleDateString("en-CA", { timeZone: "America/Guatemala" });
const wcag = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];

test("ST-152: an educator starts and completes a class and sees its hours; administration corrects them with a reason and exports", async ({ page, playwright, baseURL }, info) => {
  const admin = await playwright.request.newContext({ baseURL, extraHTTPHeaders: { Origin: baseURL!, Cookie: `hl_session=${await sessionToken("admin-demo")}` } });
  try {
    const title = `${E2E_PREFIX} Horas ${info.project.name}`;
    const course = await admin.post("/api/courses", { data: { title, objective: "Contar las horas efectivas.", status: "active", educationType: "non-formal", level: "unspecified", format: "workshop", modality: "in-person", pacing: "scheduled", area: "011", settings: { attendance: true }, programId: null, leadId: "user-educator" } });
    expect(course.status(), await course.text()).toBe(201);
    const courseId = (await course.json()).id as string, path = `/api/courses/${courseId}`;
    const groupId = (await (await admin.post(`${path}/groups`, { data: { name: `${E2E_PREFIX} Sección horas` } })).json()).id as string;
    expect((await admin.put(`${path}/groups/${groupId}/educators`, { data: { userIds: ["user-educator"], conflictReason: "Sección de prueba E2E; su horario puede coincidir con otras secciones de prueba." } })).status()).toBe(200);
    expect((await admin.put(`${path}/groups/${groupId}/schedule`, { data: { weekdays: [0, 1, 2, 3, 4, 5, 6], startsAt: "05:00", durationMinutes: 45, from: day(1), until: day(2) } })).status()).toBe(200);
    const [first] = ((await (await admin.get(`${path}/sessions`)).json()).sessions as { id: string; groupId: string; sessionDate: string }[]).filter(item => item.groupId === groupId).sort((a, b) => a.sessionDate.localeCompare(b.sessionDate));

    // CA1: the educator starts and completes the class; «Mis horas» lists it with the time between both.
    await signIn(page, "educador-demo", `/secciones/${groupId}/clases/${first.id}`);
    await page.getByRole("button", { name: "Comenzar clase" }).click();
    await page.getByRole("button", { name: "Finalizar clase" }).click();
    await expect(page.locator(".page-meta .badge")).toHaveText("Impartida");
    await page.goto(`/horas?curso=${courseId}`);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Mis horas");
    const mine = page.getByRole("table", { name: "Clases impartidas" }).locator("tbody tr");
    await expect(mine).toHaveCount(1);
    await expect(mine.first()).toContainText(title);
    await expect(mine.first()).toContainText("Cuenta");
    await expect(page.getByRole("combobox", { name: "Educador" })).toHaveCount(0);

    // CA3 and CA2: administration corrects the minutes with a reason, sees the new total and exports the filtered period.
    await signIn(page, "admin-demo", `/horas?curso=${courseId}`);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Horas efectivas");
    const rows = page.getByRole("table", { name: "Clases impartidas" }).locator("tbody tr");
    await expect(rows).toHaveCount(1);
    await rows.first().getByRole("button", { name: /Corregir las horas de la clase/ }).click();
    const dialog = page.getByRole("dialog", { name: "Corregir las horas de la clase" });
    await dialog.getByLabel("Minutos efectivos").fill("50");
    await expect(dialog.getByRole("button", { name: "Guardar corrección" })).toBeDisabled();
    await dialog.getByLabel("Motivo de la corrección").fill("Comenzó la clase tarde en la plataforma");
    await dialog.getByRole("button", { name: "Guardar corrección" }).click();
    await expect(toast(page)).toContainText("Horas corregidas: 50 min");
    await expect(rows.first()).toContainText("Corregida");
    await expect(rows.first()).toContainText("Motivo: Comenzó la clase tarde en la plataforma");
    await expect(page.locator(".stat-tile").filter({ hasText: "Horas efectivas" })).toContainText("50 min");
    await page.waitForTimeout(400);
    const { violations } = await new AxeBuilder({ page }).withTags(wcag).analyze();
    expect(violations.map(item => `horas: ${item.id} · ${item.nodes.map(node => node.target.join(" ")).slice(0, 3).join(" | ")}`)).toEqual([]);

    const download = page.waitForEvent("download");
    await page.getByRole("link", { name: "Exportar CSV" }).click();
    const file = await download;
    // HRS-01: the page opens on the last 30 days, so the file is named after that period.
    expect(file.suggestedFilename()).toMatch(/^horas-efectivas-\d{4}-\d{2}-\d{2}_a_\d{4}-\d{2}-\d{2}\.csv$/);
    const csv = readFileSync((await file.path())!, "utf8");
    expect(csv.charCodeAt(0)).toBe(0xfeff);
    expect(csv).toContain("Fecha,Curso,Sección,Educador,Inicio,Finalización,Minutos calculados,Minutos efectivos,Horas efectivas,Estado,Motivo de la corrección");
    expect(csv).toContain(",50,0.83,Corregida,Comenzó la clase tarde en la plataforma");
    expect(csv.trim().split("\r\n").at(-1)).toBe("Total,,,,,,,50,0.83,,");

    // The correction is in the activity of the section.
    const events = (await (await admin.get(`/api/activity?section=${groupId}&limit=20`)).json()).events as { summary: string }[];
    expect(events.map(item => item.summary)).toContainEqual(expect.stringMatching(/^Corrigió las horas efectivas .*→ 50 min\. Motivo: Comenzó la clase tarde en la plataforma$/));

    // The educator now sees the corrected hours.
    await signIn(page, "educador-demo", `/horas?curso=${courseId}`);
    await expect(page.locator(".stat-tile").filter({ hasText: "Horas efectivas" })).toContainText("50 min");

    // HRS-02: a class completed without its start is «por revisar»; administration gives it its planned duration.
    const second = ((await (await admin.get(`${path}/sessions`)).json()).sessions as { id: string; groupId: string; sessionDate: string }[]).filter(item => item.groupId === groupId && item.id !== first.id)[0];
    const educatorApi = await playwright.request.newContext({ baseURL, extraHTTPHeaders: { Origin: baseURL!, Cookie: `hl_session=${await sessionToken("educador-demo")}` } });
    try { expect((await educatorApi.post(`${path}/sessions/${second.id}/complete`)).status()).toBe(200); } finally { await educatorApi.dispose(); }
    await signIn(page, "admin-demo", `/horas?curso=${courseId}&periodo=todo`);
    await page.getByRole("button", { name: "Por revisar (1)" }).click();
    await page.getByRole("button", { name: "Corregir 1 clase con su duración planificada" }).click();
    const batch = page.getByRole("dialog", { name: "Corregir con la duración planificada" });
    await expect(batch).toContainText("45 min");
    await batch.getByLabel("Motivo de la corrección").fill("La dio sin registrar el inicio");
    await batch.getByRole("button", { name: "Corregir clases" }).click();
    await expect(toast(page)).toContainText("1 clase corregida (45 min)");
    await expect(page.locator(".stat-tile").filter({ hasText: "Horas efectivas" })).toContainText("1 h 35 min");
  } finally { await admin.dispose(); }
});
