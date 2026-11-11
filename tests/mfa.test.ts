import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn, type ChildProcess } from "node:child_process";
import { createServer } from "node:net";
import { once } from "node:events";
import { setTimeout as delay } from "node:timers/promises";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { base32, fromBase32, matchTotp, otpauthUri, recoveryCode, recoveryCodeInput, stepOf, totpAt } from "../packages/domain/src/index";
import { acceptPending } from "./accept-pending";
import { listenOnTestPort } from "./test-port";

// ST-133: the second factor (TOTP) with recovery codes, required by role and reset by administration.
describe("ST-133 TOTP rules", () => {
  const rfc = new TextEncoder().encode("12345678901234567890");
  it("CA1 matches the test vectors of RFC 6238 (SHA-1)", async () => {
    for (const [seconds, code] of [[59, "94287082"], [1111111109, "07081804"], [1111111111, "14050471"], [1234567890, "89005924"], [2000000000, "69279037"], [20000000000, "65353130"]] as const)
      expect(await totpAt(rfc, Math.floor(seconds / 30), 8), String(seconds)).toBe(code);
  });
  it("CA1 accepts the current step or the one beside it, never one already used", async () => {
    const now = 1_800_000_000_000, step = stepOf(now);
    expect(await matchTotp(rfc, await totpAt(rfc, step), 0, now)).toBe(step);
    expect(await matchTotp(rfc, await totpAt(rfc, step - 1), 0, now)).toBe(step - 1);
    expect(await matchTotp(rfc, await totpAt(rfc, step + 1), 0, now)).toBe(step + 1);
    expect(await matchTotp(rfc, await totpAt(rfc, step - 2), 0, now)).toBeNull();
    expect(await matchTotp(rfc, await totpAt(rfc, step), step, now)).toBeNull();
    for (const code of ["", "12345", "abcdef", 123456, null]) expect(await matchTotp(rfc, code, 0, now)).toBeNull();
  });
  it("keys in base32 and the link for the app; recovery codes without look-alikes", () => {
    const key = base32(rfc);
    expect(key).toBe("GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ");
    expect(fromBase32(key.toLowerCase().replace(/(.{4})/g, "$1 "))).toEqual(rfc);
    expect(fromBase32("no válida")).toBeNull();
    expect(otpauthUri(key, "ana.gomez")).toBe("otpauth://totp/Acervum%3Aana.gomez?secret=GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ&issuer=Acervum&algorithm=SHA1&digits=6&period=30");
    const code = recoveryCode(new Uint8Array(24).map((_, index) => index * 7))!;
    expect(code).toMatch(/^[a-hjkmnp-z2-9]{5}-[a-hjkmnp-z2-9]{5}$/);
    expect(recoveryCodeInput(` ${code.toUpperCase().replace("-", " ")} `)).toBe(code);
    expect(recoveryCodeInput("abc")).toBeNull();
  });
});

let worker: ChildProcess;
let origin = "";
let logs = "";
const storage = mkdtempSync(join(tmpdir(), "hl-platform-mfa-"));
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

const login = (username: string, password: string) => fetch(`${origin}/api/login`, { method: "POST", headers: { "Content-Type": "application/json", Origin: origin }, body: JSON.stringify({ username, password }) });
const cookieOf = (response: Response) => response.headers.get("set-cookie")?.split(";")[0] || null;
async function as(cookie: string | null, path: string, method = "GET", data?: unknown) {
  return fetch(`${origin}/api${path}`, { method, headers: { Cookie: cookie || "", Origin: origin, ...(data !== undefined ? { "Content-Type": "application/json" } : {}) }, ...(data !== undefined ? { body: JSON.stringify(data) } : {}) });
}
const read = async <T = Record<string, unknown>>(response: Response, status = 200) => { const text = await response.text(); expect(response.status, text).toBe(status); return JSON.parse(text) as T; };
const password = "Una frase para recordar 2026";
async function person(admin: string | null, username: string) {
  const created = await read<{ member: { id: string }; temporaryPassword: string }>(await as(admin, "/members", "POST", { displayName: `Persona ${username}`, username, role: "educator" }), 201);
  const cookie = cookieOf(await login(username, created.temporaryPassword));
  await read(await as(cookie, "/account/password", "POST", { currentPassword: created.temporaryPassword, newPassword: password }));
  await acceptPending(origin, cookie, `Persona ${username}`, password);
  return { id: created.member.id, cookie };
}
/** Sets up the factor and returns the key and the recovery codes. */
async function enroll(cookie: string | null) {
  const { setup } = await read<{ setup: { key: string; uri: string } }>(await as(cookie, "/me/mfa/setup", "POST", { currentPassword: password }));
  const secret = fromBase32(setup.key)!;
  const { recoveryCodes } = await read<{ recoveryCodes: string[] }>(await as(cookie, "/me/mfa/enable", "POST", { code: await totpAt(secret, stepOf(Date.now())) }));
  return { secret, key: setup.key, recoveryCodes };
}
const log = async (admin: string | null, query: string) => (await read<{ events: { type: string; outcome: string; method: string | null; detail: string | null }[] }>(await as(admin, `/security/events?limite=100${query}`))).events;

describe("ST-133 on the built Worker", () => {
  let admin: string | null = null;
  beforeAll(async () => { admin = cookieOf(await login("admin-demo", "Aprender-2026!")); expect(admin).toBeTruthy(); });

  it("CA1 a person activates TOTP, receives 10 recovery codes once, and the password then asks for a code", async () => {
    const ana = await person(admin, "mfa-ana");
    const other = cookieOf(await login("mfa-ana", password));
    // Right after signing in the session is in its confirmation window: no password is asked again; a wrong one
    // sent anyway is still refused by the confirmation itself.
    expect((await read<{ code: string }>(await as(ana.cookie, "/me/confirm", "POST", { password: "otra" }), 400)).code).toBe("REAUTH_FAILED");
    const { setup } = await read<{ setup: { key: string; uri: string } }>(await as(ana.cookie, "/me/mfa/setup", "POST", { currentPassword: password }));
    expect(setup.uri).toMatch(/^otpauth:\/\/totp\/Acervum%3Amfa-ana\?secret=[A-Z2-7]{32}&/);
    expect((await read<{ code: string }>(await as(ana.cookie, "/me/mfa/enable", "POST", { code: "000000" }), 400)).code).toBe("MFA_CODE_INVALID");
    const secret = fromBase32(setup.key)!;
    const { recoveryCodes } = await read<{ recoveryCodes: string[] }>(await as(ana.cookie, "/me/mfa/enable", "POST", { code: await totpAt(secret, stepOf(Date.now())) }));
    expect(recoveryCodes).toHaveLength(10);
    expect(new Set(recoveryCodes).size).toBe(10);
    // The session that activated it stays; the others close.
    expect((await as(ana.cookie, "/session")).status).toBe(200);
    expect((await as(other, "/session")).status).toBe(401);
    expect(await read<{ mfa: { enabled: boolean; recoveryCodesLeft: number } }>(await as(ana.cookie, "/me/mfa"))).toMatchObject({ mfa: { enabled: true, recoveryCodesLeft: 10 } });
    // The password alone opens no session now.
    const first = await login("mfa-ana", password);
    const answer = await read<{ mfa: string; challenge: string }>(first);
    expect(answer.mfa).toBe("required");
    expect(cookieOf(first)).toBeNull();
    expect((await read<{ code: string }>(await as(null, "/login/mfa", "POST", { challenge: answer.challenge, code: "123456" }), 400)).code).toBe("MFA_CODE_INVALID");
    // The code of the next step works once; the same code again is refused.
    const code = await totpAt(secret, stepOf(Date.now()) + 1);
    const opened = await as(null, "/login/mfa", "POST", { challenge: answer.challenge, code });
    expect(opened.status).toBe(200);
    const session = cookieOf(opened);
    expect((await as(session, "/session")).status).toBe(200);
    expect((await as(null, "/login/mfa", "POST", { challenge: answer.challenge, code })).status).toBe(410);
    const again = await read<{ challenge: string }>(await login("mfa-ana", password));
    expect((await as(null, "/login/mfa", "POST", { challenge: again.challenge, code })).status).toBe(400);
    // A recovery code works once.
    expect((await as(null, "/login/mfa", "POST", { challenge: again.challenge, recoveryCode: recoveryCodes[0] })).status).toBe(200);
    const third = await read<{ challenge: string }>(await login("mfa-ana", password));
    expect((await as(null, "/login/mfa", "POST", { challenge: third.challenge, recoveryCode: recoveryCodes[0] })).status).toBe(400);
    // CA3: activation, failures and the recovery code are in the security log; no key or code is.
    const events = await log(admin, `&persona=${ana.id}`);
    for (const expected of ["mfa_enabled:succeeded", "mfa_failed:failed", "recovery_code_used:succeeded", "sign_in:succeeded"]) expect(events.map(item => `${item.type}:${item.outcome}`), expected).toContain(expected);
    expect(events.find(item => item.type === "sign_in" && item.detail === "Con verificación en dos pasos")).toBeTruthy();
    const text = JSON.stringify(events) + JSON.stringify(await read(await as(session, "/me/export")));
    expect(text).not.toContain(setup.key.replaceAll(" ", ""));
    for (const recovery of recoveryCodes) expect(text).not.toContain(recovery);
  });

  it("CA1 five wrong codes end the step", async () => {
    const eva = await person(admin, "mfa-eva");
    await enroll(eva.cookie);
    const { challenge } = await read<{ challenge: string }>(await login("mfa-eva", password));
    for (let attempt = 0; attempt < 5; attempt++) expect((await as(null, "/login/mfa", "POST", { challenge, code: "000000" })).status).toBe(400);
    expect((await read<{ code: string }>(await as(null, "/login/mfa", "POST", { challenge, code: "000000" }), 410)).code).toBe("MFA_CHALLENGE_EXPIRED");
  });

  it("CA2 administration requires it by role: without it nothing else opens until it is set up; it cannot be turned off", async () => {
    const tom = await person(admin, "mfa-tom");
    const { policy } = await read<{ policy: Record<string, unknown> }>(await as(admin, "/security/policy"));
    await read(await as(admin, "/security/policy", "PUT", { ...policy, mfaEducator: true }));
    try {
      const session = await read<{ member: { mfaSetupRequired?: boolean } }>(await as(tom.cookie, "/session"));
      expect(session.member.mfaSetupRequired).toBe(true);
      expect((await read<{ code: string }>(await as(tom.cookie, "/courses"), 403)).code).toBe("MFA_SETUP_REQUIRED");
      const { secret } = await enroll(tom.cookie);
      expect((await as(tom.cookie, "/courses")).status).toBe(200);
      expect((await read<{ member: { mfaSetupRequired?: boolean } }>(await as(tom.cookie, "/session"))).member.mfaSetupRequired).toBeUndefined();
      const refused = await read<{ error: string }>(await as(tom.cookie, "/me/mfa", "DELETE", { currentPassword: password, code: await totpAt(secret, stepOf(Date.now()) + 1) }), 409);
      expect(refused.error).toMatch(/exige/);
    } finally {
      await read(await as(admin, "/security/policy", "PUT", { ...policy, version: (policy.version as number) + 1, mfaEducator: false }));
    }
  });

  it("CA3 administration resets a lost factor: the person's sessions close and it is logged; the owner can turn it off", async () => {
    const leo = await person(admin, "mfa-leo");
    await enroll(leo.cookie);
    const members = await read<{ members: { id: string; mfa: boolean }[] }>(await as(admin, "/members"));
    expect(members.members.find(item => item.id === leo.id)?.mfa).toBe(true);
    const educator = await person(admin, "mfa-mirona");
    expect((await as(educator.cookie, `/security/people/${leo.id}/mfa`, "DELETE")).status).toBe(403);
    await read(await as(admin, `/security/people/${leo.id}/mfa`, "DELETE"));
    expect((await as(leo.cookie, "/session")).status).toBe(401);
    expect(cookieOf(await login("mfa-leo", password))).toBeTruthy();
    expect((await as(admin, `/security/people/${leo.id}/mfa`, "DELETE")).status).toBe(409);
    expect((await log(admin, `&persona=${leo.id}&tipo=mfa_reset`))).toHaveLength(1);
    // Turning it off happens within the confirmation window; a code sent with it must still be right.
    const zoe = await person(admin, "mfa-zoe");
    const { secret } = await enroll(zoe.cookie);
    expect((await as(zoe.cookie, "/me/mfa", "DELETE", { currentPassword: password, code: "000000" })).status).toBe(400);
    await read(await as(zoe.cookie, "/me/mfa", "DELETE", { currentPassword: password, code: await totpAt(secret, stepOf(Date.now()) + 1) }));
    expect(cookieOf(await login("mfa-zoe", password))).toBeTruthy();
  });
});
