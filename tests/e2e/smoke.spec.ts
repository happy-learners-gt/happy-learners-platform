import { test, expect } from "@playwright/test";
import { permitsSmokeRequest } from "./target-policy";
import { mkdir } from "node:fs/promises";

test("production smoke: read content without changing the demo", async ({ page, context, baseURL }, info) => {
  const origin = new URL(baseURL!).origin;
  const blocked: string[] = [];
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  // Applies to every page in the context, not only to this test's explicit requests.
  await context.route("**/*", route => {
    const request = route.request();
    if (permitsSmokeRequest(request.method(), request.url(), origin)) return route.continue();
    blocked.push(`${request.method()} ${new URL(request.url()).pathname}`);
    return route.abort("blockedbyclient");
  });
  const folder = `.release-evidence/screenshots/${info.project.name}`;
  await mkdir(folder, { recursive: true });
  try {
    await page.goto("/inicio");
    const health = await page.evaluate(async () => (await fetch("/api/health")).json());
    expect(health.status).toBe("ok");
    const version = await page.evaluate(async () => (await fetch("/api/version")).json());
    expect(version.sha).toMatch(/^[a-f0-9]{40}$/);
    if (process.env.EXPECTED_SHA) expect(version.sha).toBe(process.env.EXPECTED_SHA);
    await page.getByLabel("Usuario", { exact: true }).fill("educador-demo");
    await page.getByLabel("Contraseña", { exact: true }).fill("Aprender-2026!");
    await page.getByRole("button", { name: "Entrar a mi espacio" }).click();
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("¿Qué vamos a enseñar hoy?");
    await page.screenshot({ path: `${folder}/redesign-home.png`, fullPage: true });
    await page.getByRole("navigation", { name: "Navegación principal" }).getByRole("link", { name: "Biblioteca", exact: true }).click();
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Biblioteca");
    await expect(page.locator(".resource-grid article").first()).toBeVisible();
    await page.reload();
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Biblioteca");
    await page.getByRole("navigation", { name: "Navegación principal" }).getByRole("link", { name: "Contenido", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Niveles y módulos", exact: true })).toBeVisible();
    await page.getByRole("link", { name: "Publicadas", exact: true }).click();
    await page.getByRole("link", { name: /Abrir lección/ }).first().click();
    await expect(page.getByText("Publicada · Solo lectura", { exact: true })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: `${folder}/redesign-published.png`, fullPage: true });
    // No completion POST: aggregate counts must not increase during monitoring.
    const student = await context.newPage();
    await student.goto("/?code=GREETINGS");
    await expect(student.getByRole("heading", { name: "Greetings and Introductions", exact: true })).toBeVisible();
    await expect(student.getByRole("button", { name: "Terminé la lección" })).toBeVisible();
    expect(await student.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await student.screenshot({ path: `${folder}/redesign-student.png`, fullPage: true });
    await student.close();
    await page.getByRole("button", { name: "Cerrar sesión", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Iniciar sesión", exact: true })).toBeVisible();
    expect(await page.evaluate(async () => (await fetch("/api/session")).status)).toBe(401);
    expect(blocked).toEqual([]); expect(errors).toEqual([]);
  } finally {
    // A failed assertion must not leave a monitoring session active.
    await context.request.post(`${origin}/api/logout`, { headers: { Origin: origin }, timeout: 15000 }).catch(() => {});
  }
});
