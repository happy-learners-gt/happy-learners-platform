import { defineConfig } from "@playwright/test";
const external = process.env.BASE_URL;
export default defineConfig({
  testDir: "tests/e2e", timeout: 45000, retries: 0, workers: 1,
  reporter: [["list"], ["json", { outputFile: ".release-evidence/e2e-results.json" }]],
  use: { baseURL: external || "http://127.0.0.1:8789", trace: "off", screenshot: "only-on-failure" },
  projects: [
    { name: "desktop", use: { browserName: "chromium", viewport: { width: 1365, height: 900 } } },
    { name: "mobile", use: { browserName: "chromium", viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 1 } },
  ],
  ...(external ? {} : { webServer: { command: "node_modules/.bin/wrangler dev --local --config build/wrangler.json --ip 127.0.0.1 --port 8789 --inspector-port 0", url: "http://127.0.0.1:8789/api/health", timeout: 60000, reuseExistingServer: false } }),
});
