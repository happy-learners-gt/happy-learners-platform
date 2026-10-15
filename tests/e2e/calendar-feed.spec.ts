import { test, expect } from "./local-test";
import { e2eName, sessionToken, signIn, toast } from "./helpers";

const day = (offset: number) => new Date(Date.now() + offset * 86_400_000).toLocaleDateString("en-CA", { timeZone: "America/Guatemala" });

test("HL-171 ST-125: an educator gets the calendar link in the Agenda, the .ics carries their classes and regenerating stops the old link", async ({ page, playwright, baseURL }, info) => {
  const admin = await playwright.request.newContext({ baseURL, extraHTTPHeaders: { Origin: baseURL!, Cookie: `hl_session=${await sessionToken("admin-demo")}` } });
  try {
    // A section taught by the educator, with classes over the next days.
    const title = e2eName(info, "Calendario suscrito");
    const created = await admin.post("/api/courses", { data: { title, objective: "Seguir las clases en el calendario.", status: "active", educationType: "non-formal", level: "unspecified", format: "workshop", modality: "in-person", pacing: "scheduled", area: "011", settings: { attendance: true }, programId: null, leadId: "user-educator" } });
    expect(created.status(), await created.text()).toBe(201);
    const path = `/api/courses/${(await created.json()).id}`;
    const groupId = (await (await admin.post(`${path}/groups`, { data: { name: e2eName(info, "Sección suscrita") } })).json()).id;
    expect((await admin.put(`${path}/groups/${groupId}/educators`, { data: { userIds: ["user-educator"], conflictReason: "Sección de prueba E2E; su horario puede coincidir con otras secciones de prueba." } })).status()).toBe(200);
    expect((await admin.put(`${path}/groups/${groupId}/schedule`, { data: { weekdays: [0, 1, 2, 3, 4, 5, 6], startsAt: "07:15", durationMinutes: 40, from: day(1), until: day(3) } })).status()).toBe(200);
    const sessions = ((await (await admin.get(`${path}/sessions`)).json()).sessions as { id: string; groupId: string }[]).filter(item => item.groupId === groupId);
    expect(sessions).toHaveLength(3);

    await signIn(page, "educador-demo", "/agenda");
    const panel = page.getByRole("region", { name: "Sincronizar con mi calendario" });
    await expect(panel).toBeVisible();
    await panel.getByText("Cómo suscribirte").click();
    for (const step of ["Desde URL", "Suscribirse desde la web", "Nueva suscripción a calendario"]) await expect(panel).toContainText(step);
    // The first visit creates the link; a later one (another viewport) already has one and regenerates it.
    const create = panel.getByRole("button", { name: "Crear enlace" });
    if (await create.isVisible()) await create.click();
    else {
      await panel.getByRole("button", { name: "Regenerar enlace" }).click();
      await page.getByRole("dialog", { name: "¿Regenerar el enlace?" }).getByRole("button", { name: "Regenerar enlace" }).click();
    }
    const field = panel.getByLabel("Enlace de suscripción");
    await expect(field).toHaveValue(/\/api\/feeds\/calendar\/d_[a-f0-9]{64}\.ics$/);
    const link = await field.inputValue();
    await expect(panel.getByRole("link", { name: "Abrir en la app de calendario" })).toHaveAttribute("href", link.replace(/^https?:/, "webcal:"));

    // Calendars fetch the link without a session: it is an iCalendar with the educator's classes.
    const feed = await playwright.request.newContext();
    try {
      const response = await feed.get(link);
      expect(response.status()).toBe(200);
      expect(response.headers()["content-type"]).toBe("text/calendar; charset=utf-8");
      const ics = await response.text();
      expect(ics.startsWith("BEGIN:VCALENDAR\r\n")).toBe(true);
      expect(ics.replace(/\r\n /g, "")).toContain(`SUMMARY:${title} · ${e2eName(info, "Sección suscrita")}`);
      for (const session of sessions) expect(ics).toContain(`UID:${session.id}@127.0.0.1`);

      // Regenerating asks first; afterwards the previous link no longer works.
      await panel.getByRole("button", { name: "Regenerar enlace" }).click();
      const dialog = page.getByRole("dialog", { name: "¿Regenerar el enlace?" });
      await expect(dialog).toContainText("dejará de funcionar");
      await dialog.getByRole("button", { name: "Regenerar enlace" }).click();
      await expect(toast(page)).toContainText("El anterior ya no funciona");
      await expect(field).not.toHaveValue(link);
      expect((await feed.get(link)).status()).toBe(404);
      expect((await feed.get(await field.inputValue())).status()).toBe(200);
    } finally { await feed.dispose(); }
  } finally { await admin.dispose(); }
});
