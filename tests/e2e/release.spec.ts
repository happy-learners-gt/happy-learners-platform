import { test, expect } from "./local-test";
import { sessionToken, signIn } from "./helpers";

const as = async (playwright: { request: { newContext: (options: object) => Promise<import("@playwright/test").APIRequestContext> } }, baseURL: string | undefined, username?: string) =>
  playwright.request.newContext({ baseURL, extraHTTPHeaders: { Origin: baseURL!, ...(username ? { Cookie: `hl_session=${await sessionToken(username)}` } : {}) } });

test("HL-119 ST-076: retired routes answer 410 and the library still lists its resources", async ({ playwright, baseURL }) => {
  const api = await as(playwright, baseURL, "educador-demo");
  try {
    for (const [method, path] of [["GET", "/api/curriculum"], ["POST", "/api/levels"], ["PUT", "/api/levels/level-a1"], ["POST", "/api/units"], ["PUT", "/api/units/unit-greetings"],
      ["POST", "/api/resources"], ["GET", "/api/resources/resource-colors"], ["PUT", "/api/resources/resource-colors"], ["DELETE", "/api/resources/resource-colors"]]) {
      const response = await api.fetch(path, { method, data: method === "GET" || method === "DELETE" ? undefined : {} });
      expect(response.status(), `${method} ${path}`).toBe(410);
    }
    const library = await api.get("/api/resources");
    expect(library.status()).toBe(200);
    expect(Array.isArray((await library.json()).resources)).toBe(true);
  } finally { await api.dispose(); }
});

test("HL-58 ST-044: administration downloads a backup without credentials; restoring it leaves the organization as it was", async ({ playwright, baseURL }) => {
  const admin = await as(playwright, baseURL, "admin-externo"), otherAdmin = await as(playwright, baseURL, "admin-demo"), educator = await as(playwright, baseURL, "educador-demo"), anonymous = await as(playwright, baseURL);
  try {
    expect((await anonymous.get("/api/organization/backup")).status()).toBe(401);
    expect((await educator.get("/api/organization/backup")).status()).toBe(403);
    const response = await admin.get("/api/organization/backup");
    expect(response.status()).toBe(200);
    expect(response.headers()["content-disposition"]).toContain("org-other-");
    const backup = await response.json();
    expect(backup).toMatchObject({ format: "happy-learners-backup/1", organizationId: "org-other" });
    expect(backup.tables.users.columns).not.toContain("password_hash");
    expect(backup.tables.users.columns).not.toContain("password_salt");
    for (const name of ["sessions", "group_access_sessions", "login_limits"]) expect(backup.tables[name]).toBeUndefined();
    expect(Object.keys(backup.digests).sort()).toEqual(Object.keys(backup.tables).sort());
    // Only administration restores; another organization refuses the copy, and its own refuses a tampered one.
    expect((await educator.post("/api/organization/restore", { data: backup })).status()).toBe(403);
    expect((await otherAdmin.post("/api/organization/restore", { data: backup })).status()).toBe(409);
    const tampered = structuredClone(backup);
    tampered.tables.organizations.rows[0][1] = "Otra organización";
    expect((await admin.post("/api/organization/restore", { data: tampered })).status()).toBe(400);
    const restored = await admin.post("/api/organization/restore", { data: backup });
    expect(restored.status(), await restored.text()).toBe(200);
    expect((await restored.json()).digests).toEqual(backup.digests);
    // The account keeps its credentials: its session still works and the data reads the same.
    const after = await (await admin.get("/api/organization/backup")).json();
    expect(after.digests).toEqual(backup.digests);
  } finally { await Promise.all([admin.dispose(), otherAdmin.dispose(), educator.dispose(), anonymous.dispose()]); }
});

test("HL-58 ST-044: administration downloads the backup from Organización", async ({ page }) => {
  await signIn(page, "admin-demo", "/organizacion");
  const respaldo = page.getByRole("region", { name: "Respaldo" });
  const [download] = await Promise.all([page.waitForEvent("download"), respaldo.getByRole("link", { name: "Descargar respaldo" }).click()]);
  expect(download.suggestedFilename()).toMatch(/^org-demo-\d{4}-\d{2}-\d{2}\.json$/);
  const backup = JSON.parse(await (await import("node:fs/promises")).readFile((await download.path())!, "utf8"));
  expect(backup).toMatchObject({ format: "happy-learners-backup/1", organizationId: "org-demo" });
});

test("HL-120 ST-077: pages and the API send the security headers and the content security policy", async ({ playwright, baseURL }) => {
  const api = await as(playwright, baseURL);
  try {
    for (const path of ["/", "/inicio", "/api/health"]) {
      const headers = (await api.get(path)).headers();
      expect(headers["content-security-policy"], path).toContain("default-src 'self'");
      expect(headers["content-security-policy"], path).toContain("frame-ancestors 'none'");
      expect(headers["x-content-type-options"], path).toBe("nosniff");
      expect(headers["referrer-policy"], path).toBe("no-referrer");
      expect(headers["strict-transport-security"], path).toContain("max-age=31536000");
      expect(headers["permissions-policy"], path).toContain("camera=()");
    }
  } finally { await api.dispose(); }
});
