import AxeBuilder from "@axe-core/playwright";
import type { Page } from "@playwright/test";
import { test, expect } from "./local-test";
import { sessionToken, signIn, toast } from "./helpers";
import { wallTimeIn } from "../../packages/domain/src/index";

// ST-160, ST-161 (DEC-045): «Preferencias». educador-demo teaches sections with upcoming classes; every change is
// undone at the end so the other suites see the defaults.
const wcag = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];
async function audit(page: Page, label: string) {
  await page.waitForLoadState("networkidle");
  await page.waitForTimeout(400);
  const { violations } = await new AxeBuilder({ page }).withTags(wcag).analyze();
  expect(violations.map(item => `${label}: ${item.id} · ${item.nodes.map(node => node.target.join(" ")).slice(0, 3).join(" | ")}`)).toEqual([]);
}
type Section = { id: string; status: string; teaches: boolean; course: { status: string }; next: { id: string; sessionDate: string; startsAt: string | null } | null };

test("ST-160 ST-161: theme and text size persist after reloading, an e-mail notice turns off, an account notice cannot, and the agenda reads in the chosen zone", async ({ page, playwright, baseURL }) => {
  test.setTimeout(90_000);
  const educator = await playwright.request.newContext({ baseURL, extraHTTPHeaders: { Origin: baseURL!, Cookie: `hl_session=${await sessionToken("educador-demo")}` } });
  try {
    const pending = (await (await educator.get("/api/session")).json()).pending as { id: string }[];
    if (pending.length) expect((await educator.post("/api/legal/accept", { data: { documentIds: pending.map(item => item.id) } })).status()).toBe(200);
    const root = page.locator("html");

    // Appearance: dark theme and 130 % text apply at once and come back after reloading.
    await signIn(page, "educador-demo", "/inicio");
    await page.getByRole("button", { name: /^Perfil de / }).click();
    await page.getByRole("menuitem", { name: "Preferencias" }).click();
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Preferencias");
    await page.getByRole("tab", { name: "Apariencia y accesibilidad" }).click();
    await page.getByRole("radio", { name: "Oscuro" }).check();
    await expect(toast(page)).toContainText("Tema oscuro activado.");
    await expect(root).toHaveAttribute("data-theme", "dark");
    const size = page.getByLabel("Tamaño del texto");
    await size.fill("130");
    await size.blur();
    await expect(toast(page)).toContainText("Tamaño del texto: 130 %.");
    await expect.poll(() => root.evaluate(element => getComputedStyle(element).getPropertyValue("--text-scale").trim())).toBe("1.3");
    await audit(page, "preferencias · apariencia oscura");
    await page.reload();
    await expect(root).toHaveAttribute("data-theme", "dark");
    await expect.poll(() => root.evaluate(element => (element as HTMLElement).style.getPropertyValue("--text-scale"))).toBe("1.3");
    await expect(page.getByRole("radio", { name: "Oscuro" })).toBeChecked();
    await expect(page.getByLabel("Tamaño del texto")).toHaveValue("130");
    expect((await (await educator.get("/api/me/preferences")).json()).preferences).toMatchObject({ theme: "dark", textScale: 130 });

    // Notifications: one notice off by e-mail, saved; an account notice is locked on.
    await page.getByRole("tab", { name: "Notificaciones" }).click();
    const matrix = page.getByRole("region", { name: "Avisos por canal" });
    const changed = matrix.getByRole("switch", { name: "Cambio de una clase: Correo" });
    await expect(changed).toBeChecked();
    await changed.uncheck();
    await expect(toast(page)).toContainText("Ya no recibirás «Cambio de una clase» por correo.");
    const security = matrix.getByRole("switch", { name: "Seguridad de la cuenta: Correo" });
    await expect(security).toBeChecked();
    await expect(security).toBeDisabled();
    await expect(matrix.getByRole("row", { name: /Seguridad de la cuenta/ })).toContainText("Obligatorio");
    expect((await educator.put("/api/me/notification-preferences", { data: { channels: { account_security: { email: false } } } })).status()).toBe(409);
    await page.reload();
    await expect(page.getByRole("region", { name: "Avisos por canal" }).getByRole("switch", { name: "Cambio de una clase: Correo" })).not.toBeChecked();
    await expect(page.getByRole("region", { name: "Avisos por canal" }).getByRole("switch", { name: "Cambio de una clase: En la aplicación" })).toBeChecked();

    // Region: another zone; the agenda shows the next class in it.
    await page.getByRole("tab", { name: "Región e idioma" }).click();
    await page.getByLabel("Zona horaria", { exact: true }).selectOption("Asia/Tokyo");
    await expect(toast(page)).toContainText("Zona horaria guardada.");
    const sections = (await (await educator.get("/api/sections")).json()).sections as Section[];
    // The agenda lists at most eight next classes; one with a time is checked (others may have none).
    const upcoming = sections.filter(item => item.status === "active" && item.course.status === "active" && item.teaches && item.next)
      .sort((a, b) => `${a.next!.sessionDate} ${a.next!.startsAt || ""}`.localeCompare(`${b.next!.sessionDate} ${b.next!.startsAt || ""}`)).slice(0, 8).filter(item => item.next!.startsAt);
    expect(upcoming.length).toBeGreaterThan(0);
    const organizationZone = (await (await educator.get("/api/organization")).json()).organization.timezone as string;
    const expected = wallTimeIn(upcoming[0].next!.sessionDate, upcoming[0].next!.startsAt, organizationZone, "Asia/Tokyo");
    await page.goto("/agenda");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Agenda");
    await expect(page.locator(".page-header")).toContainText("Horas en tu zona");
    const shown = page.locator(".agenda-list li").filter({ has: page.locator(`a[href$="/clases/${upcoming[0].next!.id}"]`) });
    await expect(shown.locator(".agenda-when")).toContainText(expected.time!);
  } finally {
    await educator.put("/api/me/preferences", { data: { theme: "system", textScale: 100, timezone: null } });
    await educator.put("/api/me/notification-preferences", { data: { channels: { class_changed: { email: true } } } });
    await educator.dispose();
  }
});
