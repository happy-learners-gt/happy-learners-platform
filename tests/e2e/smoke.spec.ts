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
    await page.getByRole("button", { name: "Entrar", exact: true }).click();
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Inicio");
    await page.screenshot({ path: `${folder}/home.png`, fullPage: true });
    // Read-only: the records an early E2E run left in the demo must stay gone (removed by migration 0010).
    const names = await page.evaluate(async () => {
      const get = async (path: string) => (await fetch(`/api${path}`)).json();
      const [course, lessons, resources, materials] = await Promise.all([get("/courses/course-exploradores"), get("/lessons?drafts=1"), get("/resources"), get("/courses/course-exploradores/materials")]);
      return [...course.units.map((u: { name: string }) => u.name), ...lessons.lessons.map((l: { title: string }) => l.title), ...resources.resources.map((r: { title: string }) => r.title), ...materials.materials.map((m: { title: string }) => m.title)];
    });
    expect(names.filter(name => /\b(?:desktop|mobile)-\d{13}$/.test(name))).toEqual([]);
    const menu = page.getByRole("button", { name: "Menú", exact: true });
    if (await menu.isVisible()) await menu.click();
    await page.getByRole("navigation", { name: "Navegación principal" }).getByRole("link", { name: "Cursos", exact: true }).click();
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Cursos");
    await expect(page.locator(".course-card").first()).toBeVisible();
    await page.reload();
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Cursos");
    await page.screenshot({ path: `${folder}/courses-list.png`, fullPage: true });
    await page.locator("article.course-card").getByRole("link", { name: "Exploradores", exact: true }).click();
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Exploradores");
    await page.goto("/cursos/course-exploradores/contenido");
    await expect(page.locator(".outline-unit").first()).toBeVisible();
    await expect(page.getByRole("link", { name: "Greetings and Introductions", exact: true })).toBeVisible();
    await page.screenshot({ path: `${folder}/course-content.png`, fullPage: true });
    // Opening the editor only reads; the smoke policy blocks any save.
    await page.goto("/cursos/course-exploradores/lecciones/greetings-and-introductions?vista=previa");
    await expect(page.getByText("Vista previa del borrador")).toBeVisible();
    await page.goto("/contenido/publicadas");
    await expect(page).toHaveURL(/\/cursos$/);
    await expect(page.getByRole("heading", { name: "Cursos", exact: true })).toBeVisible();
    // No completion POST: aggregate counts must not increase during monitoring.
    const student = await context.newPage();
    await student.goto("/?code=GREETINGS");
    await expect(student.getByRole("heading", { name: "Greetings and Introductions", exact: true })).toBeVisible();
    await student.getByRole("button", { name: "Empezar" }).click();
    await expect(student.getByRole("heading", { level: 1 })).toHaveText("Say hello");
    expect(await student.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await student.screenshot({ path: `${folder}/redesign-student.png`, fullPage: true });
    await student.close();
    await page.getByRole("button", { name: /^Perfil de / }).click();
    await page.getByRole("menuitem", { name: "Cerrar sesión" }).click();
    await expect(page.getByRole("heading", { name: "Iniciar sesión", exact: true })).toBeVisible();
    expect(await page.evaluate(async () => (await fetch("/api/session")).status)).toBe(401);
    expect(blocked).toEqual([]); expect(errors).toEqual([]);
  } finally {
    // A failed assertion must not leave a monitoring session active.
    await context.request.post(`${origin}/api/logout`, { headers: { Origin: origin }, timeout: 15000 }).catch(() => {});
  }
});
