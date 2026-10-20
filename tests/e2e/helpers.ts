import type { Page, TestInfo } from "@playwright/test";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect } from "./local-test";

/** Every record a content-writing test creates starts with this prefix, so it can be recognized and cleaned up. */
export const E2E_PREFIX = "E2E ·";
export const e2eName = (info: TestInfo, label: string) => `${E2E_PREFIX} ${label} ${info.project.name}`;
/** Pattern left in the shared demo by an early E2E run before tests were isolated. */
export const legacyContamination = /\b(?:desktop|mobile)-\d{13}$/;

export const origin = `http://127.0.0.1:${Number(process.env.HL_E2E_PORT || 8789)}`;
// The API allows 30 logins per client per day. Tests that do not exercise the login form reuse one server
// session per account; the cache file survives worker restarts and is revalidated against the fresh server.
const cacheFile = join(tmpdir(), `hl-e2e-sessions-${new URL(origin).port}.json`);
export async function sessionToken(username: string): Promise<string> {
  const cache: Record<string, string> = existsSync(cacheFile) ? JSON.parse(readFileSync(cacheFile, "utf8")) : {};
  if (cache[username] && (await fetch(`${origin}/api/session`, { headers: { Cookie: `hl_session=${cache[username]}` } })).ok) return cache[username];
  const response = await fetch(`${origin}/api/login`, { method: "POST", headers: { Origin: origin, "Content-Type": "application/json" }, body: JSON.stringify({ username, password: "Aprender-2026!" }) });
  expect(response.status, await response.clone().text()).toBe(200);
  cache[username] = /hl_session=([^;]+)/.exec(response.headers.get("set-cookie") || "")![1];
  writeFileSync(cacheFile, JSON.stringify(cache));
  return cache[username];
}
export async function signIn(page: Page, username = "educador-demo", path = "/inicio") {
  await page.context().addCookies([{ name: "hl_session", value: await sessionToken(username), url: origin, httpOnly: true, sameSite: "Strict" }]);
  await page.goto(path);
}
/**
 * ST-122: a new account goes through the welcome before the app opens. Suites that only need a new account working
 * complete it through the API with a minimal «perfil completo» (contact e-mail and one specialty); the derived steps
 * cannot be skipped, so this saves a real profile.
 */
export async function completeOnboarding(session: string, specialty = "Pedagogía", password?: string) {
  const headers = { Origin: origin, "Content-Type": "application/json", Cookie: `hl_session=${session}` };
  const call = (path: string, method = "POST", data?: unknown) => fetch(`${origin}/api${path}`, { method, headers, ...(data ? { body: JSON.stringify(data) } : {}) });
  const current = await (await call("/session", "GET")).json() as { member: { displayName: string; username: string }; onboarding?: true; pending?: { id: string }[] };
  if (current.pending?.length && password) {
    expect((await call("/legal/accept", "POST", { documentIds: current.pending.map(item => item.id), signature: { fullName: current.member.displayName || current.member.username, password } })).status).toBe(200);
  }
  if (!current.onboarding) return;
  expect((await call("/onboarding/steps/welcome")).status).toBe(200);
  const saved = await call("/profile", "PUT", { displayName: current.member.displayName || current.member.username, contactEmail: `${current.member.username}@ejemplo.test`, specialties: [specialty] });
  expect(saved.status, await saved.clone().text()).toBe(200);
  const state = (await (await call("/onboarding", "GET")).json()).onboarding as { next: string };
  if (state.next === "agreement") expect((await call("/onboarding/steps/agreement")).status).toBe(200);
  expect((await call("/onboarding/steps/tour")).status).toBe(200);
}
/** Signs in through the form; only for tests about the login itself. */
export async function signInWithForm(page: Page, username = "educador-demo", path = "/inicio") {
  await page.goto(path);
  await page.getByLabel("Usuario", { exact: true }).fill(username);
  await page.getByLabel("Contraseña", { exact: true }).fill("Aprender-2026!");
  await page.getByRole("button", { name: "Entrar", exact: true }).click();
}

export async function openCourse(page: Page, title = "Exploradores") {
  await page.getByRole("navigation", { name: "Navegación principal" }).getByRole("link", { name: "Cursos", exact: true }).click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Cursos");
  await page.locator("article.course-card").getByRole("link", { name: title, exact: true }).click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(title);
}

export const courseNav = (page: Page) => page.getByRole("navigation", { name: "Navegación del curso" });
export const sectionNav = (page: Page) => page.getByRole("navigation", { name: "Navegación de la sección" });
export const saveStatus = (page: Page) => page.locator(".save-indicator");
export const toast = (page: Page) => page.locator(".toast-region");

/** The organization activity log, without needing the feed on the current page. */
export async function expectRecentActivity(page: Page, text: string | RegExp) {
  const pattern = text instanceof RegExp ? text : new RegExp(text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
  await expect.poll(async () => {
    const data = await page.evaluate(async () => {
      const response = await fetch("/api/activity?limit=20");
      if (!response.ok) return "";
      return ((await response.json()) as { events: { summary: string }[] }).events.map(item => item.summary).join("\n");
    });
    return data;
  }).toMatch(pattern);
}

/** Opens the drawer on narrow screens; the sidebar is always visible from 1024 px. */
export async function openNavigation(page: Page) {
  const toggle = page.getByRole("button", { name: "Menú", exact: true });
  if (await toggle.isVisible()) await toggle.click();
}

export async function createLesson(page: Page, unit: string, title: string, objective: string) {
  await page.getByRole("button", { name: `Nueva lección en ${unit}`, exact: true }).click();
  const form = page.getByRole("form", { name: `Nueva lección en ${unit}` });
  await form.getByLabel("Título de la lección").fill(title);
  await form.getByLabel("Objetivo").fill(objective);
  await form.getByRole("button", { name: "Crear y editar" }).click();
  await expect(page).toHaveURL(/\/lecciones\/lesson-/);
  await expect(page.getByLabel("Título de la lección")).toHaveValue(title);
}

/** The card of an activity on the lesson canvas, found by its title. */
export function activity(page: Page, title: string) {
  return page.getByRole("region", { name: new RegExp(`^Actividad \\d+: ${title.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`) });
}
/**
 * Adds an activity that starts with the given block, in a moment of the didactic sequence (by default the last
 * one), and returns its card: the newest card of that moment.
 */
export async function addActivity(page: Page, type: "Contenido" | "Recurso" | "Pregunta", moment?: string) {
  const section = moment ? page.locator(".phase-section").filter({ has: page.getByRole("heading", { name: moment, exact: true }) }) : page.locator(".phase-section").last();
  await section.locator(".insert-bar").getByRole("button", { name: type, exact: true }).click();
  return section.locator("section.activity-card").last();
}
/**
 * Publishes the open lesson. Open recommendations ask for confirmation first; `expectReview` says whether
 * that dialog must appear (true), must not (false) or may (undefined).
 */
export async function publish(page: Page, label = "Publicar", expectReview?: boolean) {
  await page.getByRole("button", { name: label, exact: true }).click();
  const review = page.getByRole("dialog", { name: "¿Publicar con recomendaciones pendientes?" });
  const shown = await review.waitFor({ timeout: 2000 }).then(() => true, () => false);
  if (expectReview !== undefined) expect(shown).toBe(expectReview);
  if (shown) await review.getByRole("button", { name: "Publicar de todos modos" }).click();
}
