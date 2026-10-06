// Restore drill (ST-044): copies the demo organization from the source (production) into the target
// (the isolated preview), then checks that the target holds exactly the backed-up data.
// It only reads from the source; the target must offer the restore route, which production never does.
import { mkdirSync, writeFileSync } from "node:fs";

const source = process.env.SOURCE_URL || "https://happy-learners-demo.lfmendoza-alvarez.workers.dev";
const target = process.env.BASE_URL;
const username = process.env.DRILL_USER || "admin-demo", password = process.env.DRILL_PASSWORD || "Aprender-2026!";
if (!target || target === source) throw new Error("Set BASE_URL to a non-production target");

async function session(origin) {
  const response = await fetch(origin + "/api/login", { method: "POST", headers: { Origin: origin, "Content-Type": "application/json" }, body: JSON.stringify({ username, password }) });
  if (!response.ok) throw new Error(`Login failed on ${origin}: ${response.status}`);
  const cookie = response.headers.get("set-cookie").split(";")[0];
  const call = (path, init = {}) => fetch(origin + path, { ...init, headers: { Origin: origin, Cookie: cookie, ...init.headers } });
  return { call, sha: (await (await fetch(origin + "/api/version")).json()).sha, close: () => call("/api/logout", { method: "POST" }) };
}
const rows = backup => Object.fromEntries(Object.entries(backup.tables).map(([name, table]) => [name, table.rows.length]));

const started = new Date().toISOString();
const from = await session(source), to = await session(target);
let evidence;
try {
  const backupResponse = await from.call("/api/organization/backup");
  if (!backupResponse.ok) throw new Error(`Backup failed: ${backupResponse.status}`);
  const backup = await backupResponse.json();
  const restore = await to.call("/api/organization/restore", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(backup) });
  const restored = await restore.json();
  if (!restore.ok) throw new Error(`Restore failed: ${restore.status} ${restored.error}`);
  const after = await (await to.call("/api/organization/backup")).json();
  const differing = Object.keys(backup.digests).filter(name => after.digests[name] !== backup.digests[name]);
  const [courses, restoredCourses] = await Promise.all([from, to].map(async side => (await (await side.call("/api/courses")).json()).courses.length));
  evidence = {
    started, finished: new Date().toISOString(), source, target, source_sha: from.sha, target_sha: to.sha,
    organization: backup.organizationId, schema_version: backup.schemaVersion, backup_created_at: backup.createdAt,
    tables: Object.keys(backup.tables).length, rows: rows(backup), differing_tables: differing,
    courses: { source: courses, target: restoredCourses }, success: differing.length === 0 && courses === restoredCourses,
  };
} finally { await Promise.all([from.close(), to.close()]); }
mkdirSync(".release-evidence", { recursive: true });
writeFileSync(".release-evidence/restore-drill.json", JSON.stringify(evidence, null, 2) + "\n");
console.log(JSON.stringify({ restore_drill: evidence.success ? "passed" : "failed", tables: evidence.tables, rows: Object.values(evidence.rows).reduce((a, b) => a + b, 0), differing: evidence.differing_tables }));
if (!evidence.success) process.exitCode = 1;
