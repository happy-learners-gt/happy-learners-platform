import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn, type ChildProcess } from "node:child_process";
import { createServer } from "node:net";
import { once } from "node:events";
import { setTimeout as delay } from "node:timers/promises";
import { DatabaseSync } from "node:sqlite";
import { webcrypto } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { genesisHash, sealText, securityCsv, securityEventTypes, securityFilter, securityRange, sha256Hex } from "../packages/domain/src/index";
import { sealSecurityEvents, verifySecurityChain } from "../apps/api/src/security-chain";
import { acceptPending } from "./accept-pending";
import { listenOnTestPort } from "./test-port";

// ST-137 (security log), ST-068 (restricted audit), ST-184 (security routes for administration only), ST-186 (sealed,
// verifiable log) and ST-187 (no secrets, own events in the personal export). Domain rules, then the seal on a real
// SQLite store with every migration, then the built Worker on a fresh local store.
describe("ST-186 SHA-256 for the seals", () => {
  it("matches the FIPS 180-4 test vectors", () => {
    expect(sha256Hex("")).toBe("e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
    expect(sha256Hex("abc")).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
    expect(sha256Hex("abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq")).toBe("248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1");
    expect(sha256Hex("a".repeat(1000000))).toBe("cdc76e5c9914fb9281a1c7e284d73e67f1809a48a497200e046d39ccc7112cd0");
  });
  it("matches Web Crypto on texts of every length around the block size, with accents", async () => {
    for (const length of [1, 54, 55, 56, 57, 63, 64, 65, 119, 120, 200]) {
      const text = "ñá€".repeat(length).slice(0, length);
      const expected = Buffer.from(await webcrypto.subtle.digest("SHA-256", new TextEncoder().encode(text))).toString("hex");
      expect(sha256Hex(text), String(length)).toBe(expected);
    }
  });
});

describe("ST-137 security log rules", () => {
  it("CA2 filters by person, event type and dates; anything else is rejected", () => {
    expect(securityFilter(new URLSearchParams("persona=user-1&tipo=sign_in&desde=2026-11-01&hasta=2026-11-03"))).toEqual({ person: "user-1", type: "sign_in", from: "2026-11-01", to: "2026-11-03", before: null, limit: 50 });
    expect(securityFilter(new URLSearchParams(""))?.limit).toBe(50);
    expect(securityFilter(new URLSearchParams("limite=5000"))?.limit).toBe(100);
    for (const query of ["tipo=borrar", "persona=x%27%20OR%201", "desde=2026-13-01", "desde=2026-02-30", "desde=2026-11-04&hasta=2026-11-03", "antes=ayer"]) expect(securityFilter(new URLSearchParams(query)), query).toBeNull();
    expect(securityRange({ from: "2026-11-01", to: "2026-11-03" })).toEqual(["2026-11-01T00:00:00.000Z", "2026-11-04T00:00:00.000Z"]);
    expect(securityRange({ from: null, to: null })).toEqual(["", "9999"]);
  });
  it("CA3 the export reads in a spreadsheet, never runs a formula and keeps each seal", () => {
    const csv = securityCsv([{ id: "security-1", type: "sign_in", outcome: "failed", actorName: null, subjectName: "=HYPERLINK(\"x\")", method: "password", detail: "Usuario, desconocido", device: "Firefox en Windows", country: "GT", occurredAt: "2026-11-03T10:00:00.000Z", hash: "a".repeat(64) }]);
    expect(csv.startsWith("﻿Fecha (UTC),Evento,Tipo,Resultado,Persona,")).toBe(true);
    expect(csv).toContain("Inicio de sesión,sign_in,Fallido,\"'=HYPERLINK(\"\"x\"\")\",,Contraseña,\"Usuario, desconocido\",Firefox en Windows,GT," + "a".repeat(64));
    expect(Object.keys(securityEventTypes).length).toBeGreaterThan(25);
  });
});

/** SqlStorage and Database over node:sqlite, so the seal runs on the real schema outside the Worker. */
function stores(db: DatabaseSync) {
  const sql = { exec: (text: string, ...values: unknown[]) => { const rows = /^\s*(SELECT|INSERT[\s\S]*RETURNING)/i.test(text) ? db.prepare(text).all(...values as never[]) : (db.prepare(text).run(...values as never[]), []); return { toArray: () => rows, one: () => rows[0] }; } } as unknown as Parameters<typeof sealSecurityEvents>[0];
  const database = { prepare: (text: string) => ({ bind: (...values: unknown[]) => ({ all: async () => ({ results: db.prepare(text).all(...values as never[]) }), first: async () => db.prepare(text).get(...values as never[]) ?? null }) }) } as unknown as Parameters<typeof verifySecurityChain>[0];
  return { sql, database };
}
function migrated() {
  const db = new DatabaseSync(":memory:");
  for (const file of readdirSync("database/migrations").filter(name => name.endsWith(".sql")).sort()) db.exec(readFileSync(join("database/migrations", file), "utf8"));
  return db;
}
const insert = (db: DatabaseSync, id: string, occurredAt = new Date().toISOString()) => db.prepare("INSERT INTO security_events(id,organization_id,type,outcome,subject_id,occurred_at) VALUES (?,?,?,?,?,?)").run(id, "org-demo", "sign_in", "succeeded", "user-0", occurredAt);

describe("ST-186 the sealed chain on the real schema", () => {
  it("CA1 each event is sealed with the previous seal; the chain verifies", async () => {
    const db = migrated(), { sql, database } = stores(db);
    insert(db, "security-a"); insert(db, "security-b"); sealSecurityEvents(sql, "org-demo");
    insert(db, "security-c"); sealSecurityEvents(sql, "org-demo");
    const rows = db.prepare("SELECT id,organization_id,type,outcome,actor_id,subject_id,method,detail,device,country,occurred_at,hash FROM security_events ORDER BY rowid").all() as never[];
    let previous = genesisHash;
    for (const row of rows as { hash: string }[]) { previous = sha256Hex(sealText(previous, row as never)); expect(row.hash).toBe(previous); }
    const status = await verifySecurityChain(database, "org-demo");
    expect(status).toMatchObject({ ok: true, events: 3, head: previous, anchor: genesisHash, brokenAt: null });
  });
  it("CA2 a sealed event cannot be updated; one changed, removed or added behind the seal breaks the chain", async () => {
    const db = migrated(), { sql, database } = stores(db);
    for (const id of ["security-a", "security-b", "security-c"]) insert(db, id);
    sealSecurityEvents(sql, "org-demo");
    expect(() => db.exec("UPDATE security_events SET detail='otro' WHERE id='security-b'")).toThrow(/sealed/);
    // Someone able to bypass the trigger changes a field: the chain points at that event.
    db.exec("DROP TRIGGER security_events_sealed; UPDATE security_events SET detail='otro' WHERE id='security-b'");
    expect(await verifySecurityChain(database, "org-demo")).toMatchObject({ ok: false, reason: "event", brokenAt: { id: "security-b" } });
    db.exec("UPDATE security_events SET detail=NULL WHERE id='security-b'");
    expect((await verifySecurityChain(database, "org-demo")).ok).toBe(true);
    db.exec("DELETE FROM security_events WHERE id='security-b'");
    expect(await verifySecurityChain(database, "org-demo")).toMatchObject({ ok: false, reason: "event", brokenAt: { id: "security-c" } });
    const tail = migrated(), other = stores(tail);
    for (const id of ["security-a", "security-b"]) insert(tail, id);
    sealSecurityEvents(other.sql, "org-demo");
    tail.exec("DELETE FROM security_events WHERE id='security-b'");
    expect(await verifySecurityChain(other.database, "org-demo")).toMatchObject({ ok: false, reason: "head" });
  });
  it("CA3 events past the 365-day retention leave in order and the chain keeps verifying from its anchor", async () => {
    const db = migrated(), { sql, database } = stores(db);
    insert(db, "security-old", new Date(Date.now() - 400 * 86400000).toISOString()); insert(db, "security-new");
    sealSecurityEvents(sql, "org-demo");
    expect(db.prepare("SELECT id FROM security_events").all()).toEqual([{ id: "security-new" }]);
    const status = await verifySecurityChain(database, "org-demo");
    expect(status.ok).toBe(true);
    expect(status.anchor).not.toBe(genesisHash);
    expect(status.events).toBe(1);
  });
});

let worker: ChildProcess;
let origin = "";
let logs = "";
const storage = mkdtempSync(join(tmpdir(), "hl-platform-security-"));
beforeAll(async () => {
  const server = createServer();
  await listenOnTestPort(server);
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Missing local port");
  await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  origin = `http://127.0.0.1:${address.port}`;
  worker = spawn("node_modules/.bin/wrangler", ["dev", "--local", "--config", "build/wrangler.json", "--ip", "127.0.0.1", "--port", String(address.port), "--inspector-port", "0", "--persist-to", storage], {
    env: { ...process.env, WRANGLER_SEND_METRICS: "false", BROWSER: "none" }, stdio: ["ignore", "pipe", "pipe"],
  });
  worker.stdout?.on("data", chunk => { logs += chunk; });
  worker.stderr?.on("data", chunk => { logs += chunk; });
  for (let attempt = 0; attempt < 200; attempt++) {
    if (worker.exitCode !== null) throw new Error(logs);
    try { if ((await fetch(`${origin}/api/health`, { signal: AbortSignal.timeout(500) })).ok) return; } catch { /* Wait for the local runtime to start. */ }
    await delay(200);
  }
  throw new Error(`Local Worker did not start:\n${logs}`);
});
afterAll(async () => {
  if (worker && worker.exitCode === null) { const exited = once(worker, "exit"); worker.kill("SIGTERM"); await exited; }
  rmSync(storage, { recursive: true, force: true });
});

const firefox = "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:132.0) Gecko/20100101 Firefox/132.0";
async function signIn(username: string, password = "Aprender-2026!", country = "GT") {
  const response = await fetch(`${origin}/api/login`, { method: "POST", headers: { "Content-Type": "application/json", Origin: origin, "User-Agent": firefox, "CF-IPCountry": country }, body: JSON.stringify({ username, password }) });
  return response.status === 200 ? response.headers.get("set-cookie")!.split(";")[0] : null;
}
async function as(cookie: string | null, path: string, method = "GET", data?: unknown) {
  return fetch(`${origin}/api${path}`, { method, headers: { Cookie: cookie || "", Origin: origin, "User-Agent": firefox, ...(data !== undefined ? { "Content-Type": "application/json" } : {}) }, ...(data !== undefined ? { body: JSON.stringify(data) } : {}) });
}
const read = async <T = Record<string, unknown>>(response: Response, status = 200) => { const text = await response.text(); expect(response.status, text).toBe(status); return JSON.parse(text) as T; };
type Event = { id: string; type: string; outcome: string; subjectId: string | null; actorId: string | null; method: string | null; detail: string | null; device: string | null; country: string | null };
const log = async (cookie: string | null, query = "") => (await read<{ events: Event[]; more: boolean }>(await as(cookie, `/security/events?limite=100${query}`))).events;
async function newEducator(admin: string | null, username: string, displayName: string) {
  const created = await read<{ member: { id: string }; temporaryPassword: string }>(await as(admin, "/members", "POST", { displayName, username, role: "educator" }), 201);
  const first = await signIn(username, created.temporaryPassword);
  await read(await as(first, "/account/password", "POST", { currentPassword: created.temporaryPassword, newPassword: "Una frase para recordar 2026" }));
  await acceptPending(origin, first, displayName, "Una frase para recordar 2026");
  return { id: created.member.id, cookie: first, password: "Una frase para recordar 2026" };
}

describe("ST-137 ST-068 ST-184 ST-186 ST-187 on the built Worker", () => {
  let admin: string | null = null;
  beforeAll(async () => { admin = await signIn("admin-demo"); expect(admin).toBeTruthy(); });

  it("ST-184 CA2 every security route answers 401 without a session and 403 to an educator", async () => {
    const educator = await newEducator(admin, "seguridad-educa", "Educadora de Prueba");
    for (const [path, method] of [["/security/events", "GET"], ["/security/events/export", "GET"], ["/security/chain", "GET"], ["/security/audit", "GET"], [`/security/people/${educator.id}/sessions`, "DELETE"]]) {
      expect((await as(null, path, method)).status, path).toBe(401);
      expect((await as(educator.cookie, path, method)).status, path).toBe(403);
    }
  });

  it("ST-137 CA1 sign-ins, failures, the lock, password and role changes are logged, without secrets", async () => {
    const person = await newEducator(admin, "seguridad-uno", "Persona Uno");
    expect(await signIn("seguridad-uno", "no-es-la-clave")).toBeNull();
    expect(await signIn("nadie-con-este-nombre", "no-es-la-clave")).toBeNull();
    await read(await as(admin, `/members/${person.id}`, "PUT", { role: "admin", active: true }));
    const own = await log(admin, `&persona=${person.id}`);
    const types = own.map(item => `${item.type}:${item.outcome}`);
    for (const expected of ["role_changed:info", "sign_in:failed", "password_changed:succeeded", "sign_in:succeeded"]) expect(types, expected).toContain(expected);
    const failed = own.find(item => item.type === "sign_in" && item.outcome === "failed")!;
    expect(failed).toMatchObject({ method: "password", device: "Firefox en Windows", country: "GT", subjectId: person.id });
    const unknown = (await log(admin, "&tipo=sign_in")).find(item => item.detail === "Usuario desconocido");
    expect(unknown).toMatchObject({ outcome: "failed", subjectId: null });
    const text = JSON.stringify(await log(admin));
    for (const secret of ["no-es-la-clave", "Una frase para recordar", "Aprender-2026", "nadie-con-este-nombre", "127.0.0.1", "Mozilla"]) expect(text).not.toContain(secret);
  });

  it("ST-134 CA3 the tenth failure in 15 minutes locks the account once and is logged", async () => {
    const person = await newEducator(admin, "seguridad-bloqueo", "Persona Bloqueo");
    for (let attempt = 0; attempt < 10; attempt++) expect(await signIn("seguridad-bloqueo", `clave-${attempt}`, "MX")).toBeNull();
    const blocked = await fetch(`${origin}/api/login`, { method: "POST", headers: { "Content-Type": "application/json", Origin: origin }, body: JSON.stringify({ username: "seguridad-bloqueo", password: person.password }) });
    expect(blocked.status).toBe(429);
    const locks = await log(admin, `&persona=${person.id}&tipo=sign_in_locked`);
    expect(locks).toHaveLength(1);
    expect(locks[0]).toMatchObject({ outcome: "failed", country: "MX" });
  });

  it("ST-137 CA2 administration filters by person, type and date; CA3 the export has every seal and is itself logged", async () => {
    const today = new Date().toISOString().slice(0, 10), tomorrow = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
    expect((await log(admin, `&desde=${tomorrow}`))).toEqual([]);
    expect((await log(admin, `&desde=${today}&hasta=${today}&tipo=role_changed`)).every(item => item.type === "role_changed")).toBe(true);
    expect((await as(admin, "/security/events?tipo=otro")).status).toBe(400);
    const exported = await as(admin, `/security/events/export?desde=${today}`);
    expect(exported.status).toBe(200);
    expect(exported.headers.get("content-type")).toBe("text/csv; charset=utf-8");
    expect(exported.headers.get("content-disposition")).toMatch(/^attachment; filename="registro-de-seguridad-\d{4}-\d{2}-\d{2}\.csv"$/);
    const csv = await exported.text(), lines = csv.trim().split("\r\n");
    expect(lines.length).toBeGreaterThan(5);
    expect(lines.slice(1).every(line => /,[0-9a-f]{64}$/.test(line))).toBe(true);
    expect(csv).not.toMatch(/Aprender-2026|clave-\d|Una frase para recordar/);
    expect((await log(admin, "&tipo=log_exported"))[0]).toMatchObject({ outcome: "info" });
  });

  it("ST-186 CA2 the chain of the organization verifies end to end", async () => {
    const { chain } = await read<{ chain: { ok: boolean; events: number; head: string } }>(await as(admin, "/security/chain"));
    expect(chain.ok).toBe(true);
    expect(chain.events).toBeGreaterThan(10);
    expect(chain.head).toMatch(/^[0-9a-f]{64}$/);
  });

  it("ST-136 CA2 administration closes every session of a person; it is logged", async () => {
    const person = await newEducator(admin, "seguridad-sesiones", "Persona Sesiones");
    const second = await signIn("seguridad-sesiones", person.password);
    expect((await as(second, "/session")).status).toBe(200);
    const { closed } = await read<{ closed: number }>(await as(admin, `/security/people/${person.id}/sessions`, "DELETE"));
    expect(closed).toBe(2);
    expect((await as(second, "/session")).status).toBe(401);
    expect((await as(person.cookie, "/session")).status).toBe(401);
    expect((await log(admin, `&persona=${person.id}&tipo=sessions_closed`))[0]).toMatchObject({ detail: "2 sesiones abiertas" });
    const session = await read<{ member: { id: string } }>(await as(admin, "/session"));
    expect((await as(admin, `/security/people/${session.member.id}/sessions`, "DELETE")).status).toBe(409);
  });

  it("ST-068 CA1–CA3 the audit covers critical actions and role changes, by person, object and date", async () => {
    const person = await newEducator(admin, "seguridad-auditoria", "Persona Auditoría");
    await read(await as(admin, `/members/${person.id}`, "PUT", { role: "educator", active: false }));
    const audit = await read<{ events: { targetType: string; targetId: string; summary: string }[]; roleChanges: { memberId: string; active: boolean }[]; objects: Record<string, string> }>(await as(admin, `/security/audit?persona=${person.id}&objeto=account`));
    expect(audit.events.map(item => item.summary)).toContain("Desactivó la cuenta de Persona Auditoría");
    expect(audit.events.every(item => item.targetType === "account")).toBe(true);
    expect(audit.roleChanges.map(item => [item.memberId, item.active])).toContainEqual([person.id, false]);
    expect(audit.objects.account).toBe("Cuentas y roles");
    const none = await read<{ events: unknown[]; roleChanges: unknown[] }>(await as(admin, `/security/audit?persona=${person.id}&objeto=lesson`));
    expect(none).toMatchObject({ events: [], roleChanges: [] });
    expect((await as(admin, "/security/audit?objeto=tabla")).status).toBe(400);
    const educator = await newEducator(admin, "seguridad-mirona", "Persona Mirona");
    expect((await as(educator.cookie, `/security/audit?persona=${person.id}`)).status).toBe(403);
  });

  it("ST-187 CA3 a person's own security events are in the copy of their data", async () => {
    const person = await newEducator(admin, "seguridad-copia", "Persona Copia");
    const data = await read<{ security: { log: { type: string; seal: string; byThemselves: boolean }[] } }>(await as(person.cookie, "/me/export"));
    expect(data.security.log.map(item => item.type)).toEqual(expect.arrayContaining(["sign_in", "password_changed", "role_changed"]));
    expect(data.security.log.every(item => /^[0-9a-f]{64}$/.test(item.seal))).toBe(true);
    expect(data.security.log.find(item => item.type === "role_changed")?.byThemselves).toBe(false);
  });

  it("ST-187 CA2 a backup of the organization never carries the security log", async () => {
    const backup = await read<{ tables: Record<string, unknown> }>(await as(admin, "/organization/backup"));
    for (const table of ["security_events", "security_chain", "totp_factors", "recovery_codes", "passkeys", "auth_challenges", "linked_identities", "sso_connections", "access_tokens", "sessions"]) expect(backup.tables, table).not.toHaveProperty(table);
    expect(backup.tables).toHaveProperty("security_policies");
  });
});
