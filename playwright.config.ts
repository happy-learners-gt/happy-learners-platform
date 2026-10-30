import { defineConfig } from "@playwright/test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { assertLocalTestTarget } from "./tests/e2e/target-policy";
const external = process.env.BASE_URL;
const smoke = process.env.E2E_SUITE === "smoke";
if (!smoke) assertLocalTestTarget(external);
const port = Number(process.env.HL_E2E_PORT || 8789);
if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error("HL_E2E_PORT must be an available local TCP port.");
const localUrl = `http://127.0.0.1:${port}`;
// Each invocation has a new database. Never reuse the developer's local/demo data.
const storage = external ? undefined : mkdtempSync(join(tmpdir(), "hl-e2e-"));
export default defineConfig({
  testDir: "tests/e2e", timeout: 45000, retries: 0, workers: 1,
  ...(smoke ? { testMatch: "**/smoke.spec.ts" } : { testIgnore: "**/smoke.spec.ts" }),
  // CI runs desktop and mobile at once, each with its own server; HL_E2E_RESULTS keeps their evidence apart.
  reporter: [["list"], ["json", { outputFile: process.env.HL_E2E_RESULTS || ".release-evidence/e2e-results.json" }]],
  use: { baseURL: external || localUrl, trace: "off", screenshot: "only-on-failure" },
  projects: [
    { name: "desktop", use: { browserName: "chromium", viewport: { width: 1365, height: 900 } } },
    { name: "mobile", use: { browserName: "chromium", viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 1 } },
  ],
  ...(external ? {} : { webServer: { command: `node_modules/.bin/wrangler dev --local --config build/wrangler.json --persist-to "${storage}" --ip 127.0.0.1 --port ${port} --inspector-port 0 --var RESTORE_ENABLED:true --var LESSON_GENERATOR:fixture`, url: `${localUrl}/api/health`, timeout: 60000, reuseExistingServer: false } }),
});
