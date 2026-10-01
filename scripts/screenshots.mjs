// Captures every main route at desktop, tablet and mobile sizes for visual review.
// Usage: BASE_URL=http://127.0.0.1:8789 node scripts/screenshots.mjs [output-folder]
// Read-only except for login/logout. STATES=1 also captures dialogs and edited states, which writes
// E2E-prefixed records, so it only runs against a loopback server with disposable storage.
import { chromium } from "@playwright/test";
import { mkdirSync } from "node:fs";

const origin = process.env.BASE_URL || "http://127.0.0.1:8789";
const folder = process.argv[2] || ".release-evidence/screenshots/routes";
const viewports = { desktop: { width: 1440, height: 900 }, tablet: { width: 1024, height: 768 }, mobile: { width: 390, height: 844 } };
const course = process.env.COURSE_ID || "course-exploradores";
const lesson = process.env.LESSON_ID || "greetings-and-introductions";
const routes = [
  ["login", "/inicio", false],
  ["inicio", "/inicio"],
  ["cursos", "/cursos"],
  ["curso-resumen", `/cursos/${course}`],
  ["curso-contenido", `/cursos/${course}/contenido`],
  ["editor-leccion", `/cursos/${course}/lecciones/${lesson}`],
  ["editor-vista-previa", `/cursos/${course}/lecciones/${lesson}?vista=previa`],
  ["curso-biblioteca", `/cursos/${course}/biblioteca`],
  ["curso-grupos", `/cursos/${course}/grupos`],
  ["curso-asistencia", `/cursos/${course}/asistencia`],
  ["curso-configuracion", `/cursos/${course}/configuracion`],
  ["biblioteca", "/biblioteca"],
  ["buscar", "/buscar?q=greet"],
  ["ayuda", "/ayuda"],
  ["estudiante", "/aprender/GREETINGS", false],
];
if (process.env.STATES === "1" && !["127.0.0.1", "localhost"].includes(new URL(origin).hostname)) throw new Error("STATES=1 writes data; use a local disposable server.");
async function shot(page, path) { await page.waitForTimeout(300); await page.screenshot({ path, fullPage: true }); }
async function states(page, name, out) {
  const suffix = `${name} ${Date.now()}`;
  await page.goto(`${origin}/cursos/${course}/contenido`);
  await page.getByRole("button", { name: "Nueva lección en Greetings" }).click();
  await shot(page, `${out}/40-nueva-leccion.png`);
  const form = page.getByRole("form", { name: "Nueva lección en Greetings" });
  await form.getByLabel("Título de la lección").fill(`E2E · Estados ${suffix}`);
  await form.getByLabel("Objetivo").fill("Revisar los estados del editor.");
  await form.getByRole("button", { name: "Crear y editar" }).click();
  await page.waitForURL(/lecciones\/lesson-/);
  await shot(page, `${out}/41-editor-actividad-vacia.png`);
  await page.locator("section.activity-card .richtext-content").first().fill("Saluda a tu compañero con una sonrisa.");
  await page.getByText("Borrador guardado").first().waitFor();
  const end = page.getByRole("group", { name: "Agregar al final de la lección" });
  await end.getByRole("button", { name: "Pregunta", exact: true }).click();
  await shot(page, `${out}/43-editor-pregunta-incompleta.png`);
  await end.getByRole("button", { name: "Recurso", exact: true }).click();
  await shot(page, `${out}/44-editor-recurso.png`);
  await page.goto(`${origin}/cursos/${course}/biblioteca`);
  await page.getByRole("button", { name: "Agregar recurso" }).click();
  await shot(page, `${out}/45-dialogo-recurso.png`);
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Vista previa de Introduce yourself" }).click();
  await shot(page, `${out}/46-vista-previa-recurso.png`);
  await page.keyboard.press("Escape");
  await page.goto(`${origin}/cursos/${course}/asistencia`);
  await page.getByRole("button", { name: "Registrar clase" }).first().click();
  await shot(page, `${out}/47-dialogo-clase.png`);
  await page.getByRole("dialog").getByRole("button", { name: "Registrar y pasar lista" }).click();
  await page.waitForURL(/asistencia\/class-/);
  const groups = page.locator(".mark-group");
  await groups.nth(0).getByLabel("Presente").check();
  await groups.nth(1).getByLabel("Tarde").check();
  await groups.nth(2).getByLabel("Ausente").check();
  await shot(page, `${out}/48-hoja-asistencia.png`);
  await page.goto(`${origin}/cursos`);
  await page.getByRole("button", { name: /Acciones del curso Exploradores/ }).click();
  await shot(page, `${out}/49-menu-curso.png`);
  await page.getByRole("menuitem", { name: "Archivar" }).click();
  await shot(page, `${out}/50-confirmar-archivo.png`);
  await page.getByRole("dialog").getByRole("button", { name: "Cancelar" }).click();
  await page.goto(`${origin}/cursos/nuevo`);
  await shot(page, `${out}/51-crear-curso.png`);
  await page.goto(`${origin}/cursos?q=zzz`);
  await shot(page, `${out}/52-cursos-sin-resultados.png`);
  await page.goto(`${origin}/ruta-inexistente`);
  await shot(page, `${out}/53-no-encontrada.png`);
}
const browser = await chromium.launch();
const problems = [];
try {
  for (const [name, viewport] of Object.entries(viewports)) {
    mkdirSync(`${folder}/${name}`, { recursive: true });
    const context = await browser.newContext({ viewport, deviceScaleFactor: 1, isMobile: name === "mobile", hasTouch: name === "mobile" });
    const page = await context.newPage();
    page.on("pageerror", error => problems.push(`${name}: ${error.message}`));
    page.on("console", entry => { if (entry.type() === "error") problems.push(`${name}: console ${entry.text()}`); });
    await page.goto(`${origin}/inicio`);
    await page.screenshot({ path: `${folder}/${name}/00-login.png`, fullPage: true });
    await page.getByLabel("Usuario", { exact: true }).fill("educador-demo");
    await page.getByLabel("Contraseña", { exact: true }).fill("Aprender-2026!");
    await page.getByRole("button", { name: "Entrar", exact: true }).click();
    await page.getByRole("heading", { level: 1, name: "Inicio" }).waitFor();
    for (const [index, [label, path, signedIn = true]] of routes.entries()) {
      if (!signedIn) continue;
      await page.goto(origin + path);
      await page.waitForLoadState("networkidle");
      await page.waitForTimeout(400);
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
      if (overflow > 0) problems.push(`${name} ${label}: horizontal overflow ${overflow}px`);
      await page.screenshot({ path: `${folder}/${name}/${String(index).padStart(2, "0")}-${label}.png`, fullPage: true });
    }
    if (viewport.width < 1024) {
      await page.goto(`${origin}/cursos/${course}/contenido`);
      await page.getByRole("button", { name: "Menú" }).click();
      await page.waitForTimeout(250);
      await page.screenshot({ path: `${folder}/${name}/20-menu-abierto.png` });
    }
    if (process.env.STATES === "1") await states(page, name, `${folder}/${name}`).catch(async error => { await page.screenshot({ path: `${folder}/${name}/99-error.png`, fullPage: true }); throw error; });
    const student = await context.newPage();
    await student.goto(`${origin}/aprender/GREETINGS`);
    await student.getByRole("heading", { level: 1 }).waitFor();
    await student.screenshot({ path: `${folder}/${name}/30-estudiante-inicio.png`, fullPage: true });
    await student.getByRole("button", { name: "Empezar" }).click();
    await student.waitForTimeout(300);
    await student.screenshot({ path: `${folder}/${name}/31-estudiante-actividad.png`, fullPage: true });
    await context.request.post(`${origin}/api/logout`, { headers: { Origin: origin } });
    await context.close();
  }
} finally { await browser.close(); }
console.log(JSON.stringify({ folder, problems }, null, 2));
