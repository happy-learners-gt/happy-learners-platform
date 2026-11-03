import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn, type ChildProcess } from "node:child_process";
import { createServer } from "node:net";
import { once } from "node:events";
import { setTimeout as delay } from "node:timers/promises";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { acceptablePassword, accountInput, temporaryAlphabet, temporaryPassword } from "../packages/domain/src/index";
import { acceptPending } from "./accept-pending";
import { listenOnTestPort } from "./test-port";

// ST-093 (HL-137): team accounts. Domain rules first, then the built Worker on a fresh local store.
const temporary = /^[A-HJ-NP-Za-km-z2-9]{4}(-[A-HJ-NP-Za-km-z2-9]{4}){3}$/;

describe("HL-137 account rules", () => {
  it("CA1 accepts a name, a lowercase username and a role, and rejects anything else", () => {
    expect(accountInput({ displayName: "  Paula   Gómez ", username: " Paula.Gomez ", role: "educator", password: "ignored" })).toEqual({ displayName: "Paula Gómez", username: "paula.gomez", role: "educator" });
    expect(accountInput({ displayName: "Dirección", username: "direccion_2", role: "admin" })?.role).toBe("admin");
    for (const value of [null, {}, { displayName: "P", username: "paula", role: "educator" }, { displayName: "<b>Paula</b>", username: "paula", role: "educator" },
      { displayName: "Paula", username: "pa", role: "educator" }, { displayName: "Paula", username: ".paula", role: "educator" }, { displayName: "Paula", username: "paula gomez", role: "educator" },
      { displayName: "Paula", username: "x".repeat(33), role: "educator" }, { displayName: "Paula", username: "paula", role: "student" }]) expect(accountInput(value)).toBeNull();
  });
  it("CA1 CA3 temporary passwords are 16 unambiguous characters from unbiased random bytes", () => {
    expect(temporaryAlphabet).not.toMatch(/[01OIl]/);
    const bytes = Uint8Array.from({ length: 32 }, (_, i) => i * 7);
    expect(temporaryPassword(bytes)).toMatch(temporary);
    // Bytes at or above the largest multiple of the alphabet size are skipped, not folded into it.
    expect(temporaryPassword(Uint8Array.from([...Array(16).fill(255), ...Array(16).fill(0)]))).toBe("AAAA-AAAA-AAAA-AAAA");
    expect(temporaryPassword(new Uint8Array(15))).toBeNull();
  });
  it("CA1 the password a person chooses has 12 or more varied characters, unlike the username and the temporary one", () => {
    expect(acceptablePassword("Mi casa tiene 3 gatos", "paula.gomez", "AAAA-BBBB-CCCC-DDDD")).toBe(true);
    for (const password of ["corta-123", "aaaaaaaaaaaaaaaa", "paula.gomez-2026!", "AAAA-BBBB-CCCC-DDDD", "x".repeat(129), 12])
      expect(acceptablePassword(password, "paula.gomez", "AAAA-BBBB-CCCC-DDDD"), String(password)).toBe(false);
  });
});

let worker: ChildProcess;
let origin = "";
let logs = "";
const storage = mkdtempSync(join(tmpdir(), "hl-platform-accounts-"));
beforeAll(async () => {
  const server = createServer();
  await listenOnTestPort(server);
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Missing local port");
  await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  origin = `http://127.0.0.1:${address.port}`;
  worker = spawn("node_modules/.bin/wrangler", ["dev", "--local", "--config", "build/wrangler.json", "--ip", "127.0.0.1", "--port", String(address.port), "--inspector-port", "0", "--persist-to", storage, "--var", "RESTORE_ENABLED:true"], {
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

async function signIn(username: string, password = "Aprender-2026!") {
  const response = await fetch(`${origin}/api/login`, { method: "POST", headers: { "Content-Type": "application/json", Origin: origin }, body: JSON.stringify({ username, password }) });
  return response.status === 200 ? response.headers.get("set-cookie")!.split(";")[0] : null;
}
async function as(cookie: string | null, path: string, method = "GET", data?: unknown) {
  return fetch(`${origin}/api${path}`, { method, headers: { Cookie: cookie || "", Origin: origin, ...(data ? { "Content-Type": "application/json" } : {}) }, ...(data ? { body: JSON.stringify(data) } : {}) });
}
const summaries = async (cookie: string | null, query = "") => (await (await as(cookie, `/activity?limit=100${query}`)).json()).events.map((event: { summary: string }) => event.summary) as string[];
type Row = { id: string; username: string; active: boolean; mustChangePassword?: true; events: number; lessonsCreated: number; leads: number };
const people = async (cookie: string | null) => (await (await as(cookie, "/members")).json()).members as Row[];

describe("HL-137 ST-093 team accounts on the built Worker", () => {
  let paula = "", temporaryOne = "";
  it("CA1 administración crea una cuenta con nombre, usuario y rol, y comunica una contraseña temporal", async () => {
    const admin = await signIn("admin-demo");
    expect((await as(await signIn("educador-demo"), "/members", "POST", { displayName: "Intrusa", username: "intrusa", role: "admin" })).status).toBe(403);
    expect((await as(admin, "/members", "POST", { displayName: "Paula", username: "Con Espacios", role: "educator" })).status).toBe(400);
    const created = await as(admin, "/members", "POST", { displayName: "Paula Gómez", username: "paula.gomez", role: "educator" });
    expect(created.status).toBe(201);
    const body = await created.json();
    expect(body.member).toMatchObject({ username: "paula.gomez", displayName: "Paula Gómez", role: "educator", active: true });
    expect(body.temporaryPassword).toMatch(temporary);
    paula = body.member.id; temporaryOne = body.temporaryPassword;
    // Usernames are unique in every organization, since they decide where their owner signs in.
    for (const username of ["paula.gomez", "admin-externo", "admin-hl"])
      expect((await as(admin, "/members", "POST", { displayName: "Otra persona", username, role: "educator" })).status, username).toBe(409);
    // The password is shown once: it is not in the list of people, the activity or the backup.
    const listed = await (await as(admin, "/members")).text();
    expect(listed).toContain("paula.gomez"); expect(listed).not.toContain(temporaryOne);
    expect((await people(admin)).find(row => row.id === paula)).toMatchObject({ active: true, mustChangePassword: true });
    expect(await summaries(admin)).toContain("Creó la cuenta de Paula Gómez (@paula.gomez) con rol Educador");
    const backup = await (await as(admin, "/organization/backup")).text();
    expect(backup).not.toContain(temporaryOne);
    expect(JSON.parse(backup).tables.users.columns).toEqual(expect.not.arrayContaining(["password_salt", "password_hash", "must_change_password"]));

    // First sign-in: the temporary password opens only the change of password.
    const first = await signIn("paula.gomez", temporaryOne);
    expect((await (await as(first, "/session")).json()).member).toMatchObject({ id: paula, role: "educator", mustChangePassword: true });
    const blocked = await as(first, "/courses");
    expect(blocked.status).toBe(403); expect((await blocked.json()).code).toBe("PASSWORD_CHANGE_REQUIRED");
    expect((await as(first, "/account/password", "POST", { currentPassword: "incorrecta", newPassword: "Mi casa tiene 3 gatos" })).status).toBe(400);
    expect((await as(first, "/account/password", "POST", { currentPassword: temporaryOne, newPassword: "corta" })).status).toBe(400);
    expect((await as(first, "/account/password", "POST", { currentPassword: temporaryOne, newPassword: "Mi casa tiene 3 gatos" })).status).toBe(200);
    expect((await (await as(first, "/session")).json()).member.mustChangePassword).toBeUndefined();
    await acceptPending(origin, first, "Paula Gómez", "Mi casa tiene 3 gatos");
    expect((await as(first, "/courses")).status).toBe(200);
    expect(await signIn("paula.gomez", temporaryOne)).toBeNull();
    expect(await signIn("paula.gomez", "Mi casa tiene 3 gatos")).not.toBeNull();
  });

  it("CA2 una cuenta desactivada no puede iniciar sesión y conserva su historial", async () => {
    const admin = await signIn("admin-demo"), diego = await signIn("diego.ramirez");
    const before = (await people(admin)).find(row => row.username === "diego.ramirez")!;
    const history = await summaries(admin, `&actor=${before.id}`);
    expect(before.lessonsCreated).toBeGreaterThan(0); expect(history.length).toBeGreaterThan(0);
    expect((await as(admin, `/members/${before.id}`, "PUT", { role: "educator", active: false })).status).toBe(200);
    expect((await as(diego, "/session")).status).toBe(401);
    expect(await signIn("diego.ramirez")).toBeNull();
    // The account, its courses and everything it did stay in place.
    const after = (await people(admin)).find(row => row.id === before.id)!;
    expect(after).toMatchObject({ active: false, lessonsCreated: before.lessonsCreated, leads: before.leads, events: before.events });
    expect(await summaries(admin, `&actor=${before.id}`)).toEqual(history);
    expect(await summaries(admin)).toContain("Desactivó la cuenta de Diego Ramírez");
    expect((await as(admin, `/members/${before.id}`, "PUT", { role: "educator", active: true })).status).toBe(200);
    expect(await signIn("diego.ramirez")).not.toBeNull();
    expect(await summaries(admin)).toContain("Reactivó la cuenta de Diego Ramírez");
  });

  it("CA3 administración restablece la contraseña de una cuenta y cada cambio queda en la actividad", async () => {
    const admin = await signIn("admin-demo"), marta = await signIn("marta.ruiz");
    const session = await signIn("paula.gomez", "Mi casa tiene 3 gatos");
    expect((await as(await signIn("lucia.herrera"), `/members/${paula}/password`, "POST")).status).toBe(403);
    expect((await as(admin, "/members/user-0/password", "POST")).status).toBe(409);
    expect((await as(marta, "/members/user-0/password", "POST")).status).toBe(409);
    expect((await as(admin, "/members/user-missing/password", "POST")).status).toBe(404);
    const reset = await as(admin, `/members/${paula}/password`, "POST");
    expect(reset.status).toBe(200);
    const { temporaryPassword: again } = await reset.json();
    expect(again).toMatch(temporary); expect(again).not.toBe(temporaryOne);
    // The old password and open sessions stop working; the new temporary one must be replaced again.
    expect((await as(session, "/session")).status).toBe(401);
    expect(await signIn("paula.gomez", "Mi casa tiene 3 gatos")).toBeNull();
    const renewed = await signIn("paula.gomez", again);
    expect((await (await as(renewed, "/session")).json()).member.mustChangePassword).toBe(true);
    expect((await as(admin, `/members/${paula}`, "PUT", { role: "admin", active: true })).status).toBe(200);
    const feed = await summaries(admin);
    for (const summary of ["Creó la cuenta de Paula Gómez (@paula.gomez) con rol Educador", "Cambió su contraseña", "Restableció la contraseña de Paula Gómez", "Cambió el rol de Paula Gómez a Administración"]) expect(feed).toContain(summary);
    const text = JSON.stringify(await (await as(admin, "/activity?limit=100")).json());
    for (const secret of [temporaryOne, again, "Mi casa tiene 3 gatos"]) expect(text).not.toContain(secret);
    // Account changes are administration's: educators do not see them in their activity.
    expect((await summaries(await signIn("lucia.herrera"))).filter(summary => summary.includes("Paula Gómez"))).toEqual([]);
    expect(logs).not.toContain(again);
  });
});
