// UI audit: full-page screenshots of the educator lifecycle pages, light and dark, desktop and mobile.
// Usage: start the built Worker (`node_modules/.bin/wrangler dev --local --config build/wrangler.json --port 8797
// --persist-to <tmp>`), then `node scripts/ui-audit.mjs http://127.0.0.1:8797 <output-dir> [/path ...]`.
// Each file is <scheme>-<viewport>-<user>-<path>.png; compare them before and after a change.
import { mkdirSync } from "node:fs";
import { chromium } from "playwright";

const [base = "http://127.0.0.1:8797", out = "ui-audit", ...only] = process.argv.slice(2);
const plan = [
  ["educador-demo", ["/inicio", "/perfil", "/cuenta", "/preferencias", "/equipo", "/horas"]],
  ["admin-demo", ["/inicio", "/educadores", "/perfiles", "/organizacion", "/notificaciones", "/contratos"]],
];
const viewports = { desktop: { width: 1365, height: 900 }, mobile: { width: 390, height: 844 } };
mkdirSync(out, { recursive: true });
const browser = await chromium.launch();
for (const scheme of ["light", "dark"]) for (const [viewport, size] of Object.entries(viewports)) for (const [user, paths] of plan) {
  const context = await browser.newContext({ viewport: size, colorScheme: scheme, isMobile: viewport === "mobile", hasTouch: viewport === "mobile" });
  const login = await context.request.post(`${base}/api/login`, { headers: { Origin: base }, data: { username: user, password: "Aprender-2026!" } });
  if (!login.ok()) { console.error(`No se pudo entrar como ${user}: ${login.status()}`); await context.close(); continue; }
  const page = await context.newPage();
  for (const path of paths.filter(path => !only.length || only.includes(path))) {
    await page.goto(base + path);
    await page.waitForLoadState("networkidle").catch(() => {});
    await page.screenshot({ path: `${out}/${scheme}-${viewport}-${user.split("-")[0]}${path.replace(/\//g, "-")}.png`, fullPage: true });
  }
  await context.close();
}
await browser.close();
