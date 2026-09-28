import { mkdirSync, writeFileSync } from "node:fs";
const origin = process.env.BASE_URL || "https://happy-learners-demo.lfmendoza-alvarez.workers.dev";
let cookie = ""; const checks = []; let observedSha;
async function call(path, method = "GET", body) {
  return fetch(origin + path, { method, signal: AbortSignal.timeout(20000), redirect: "error", headers: { Origin: origin, ...(cookie ? { Cookie: cookie } : {}), ...(body ? { "Content-Type": "application/json" } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
}
async function check(name, work) { await work(); checks.push({ name, passed: true }); }
function assert(value) { if (!value) throw new Error("Critical flow assertion failed"); }
let success = false;
try {
  await check("home", async () => assert((await call("/")).ok));
  await check("health", async () => assert((await (await call("/api/health")).json()).status === "ok"));
  await check("version", async () => { observedSha = (await (await call("/api/version")).json()).sha; assert(/^[a-f0-9]{40}$/.test(observedSha)); if (process.env.EXPECTED_SHA) assert(observedSha === process.env.EXPECTED_SHA); });
  await check("anonymous_denied", async () => assert((await call("/api/organization")).status === 401));
  await check("login", async () => { const response = await call("/api/login", "POST", { username: "instructor-demo", password: "Aprender-2026!" }); assert(response.ok); const value = response.headers.get("set-cookie"); assert(value?.includes("HttpOnly") && value.includes("Secure")); cookie = value.split(";")[0]; });
  await check("organization", async () => { const data = await (await call("/api/organization")).json(); assert(data.organization.id === "org-demo"); });
  await check("published_lesson", async () => { const response = await call("/api/lessons/colores-en-equipo"); assert(response.ok); assert((await response.json()).lesson.activities.length === 3); });
  await check("errors", async () => assert((await call("/api/not-found")).status === 404));
  await check("logout_revocation", async () => { assert((await call("/api/logout", "POST")).ok); assert((await call("/api/session")).status === 401); cookie = ""; });
  success = true;
} catch { console.error(JSON.stringify({ event: "critical_flow_failed", next_check: checks.length, origin })); }
finally {
  if (cookie) await call("/api/logout", "POST").catch(() => {});
  mkdirSync(".release-evidence", { recursive: true });
  writeFileSync(".release-evidence/critical-flows.json", JSON.stringify({ observed_at: new Date().toISOString(), origin, sha: observedSha, success, checks }, null, 2) + "\n");
  if (!success) process.exitCode = 1;
  else console.log(JSON.stringify({ critical_flows: "passed", sha: observedSha, checks: checks.length }));
}
