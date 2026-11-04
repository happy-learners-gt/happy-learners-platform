import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn, type ChildProcess } from "node:child_process";
import { createServer } from "node:net";
import { once } from "node:events";
import { setTimeout as delay } from "node:timers/promises";
import { webcrypto } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { decodeCbor, derToRaw, fromBase64Url, signedChallenge, toBase64Url, verifyAssertion, verifyRegistration } from "../packages/domain/src/index";
import { acceptPending } from "./accept-pending";
import { listenOnTestPort } from "./test-port";

// ST-132: passkeys, checked with an authenticator emulated here: a P-256 key, CBOR as authenticators encode it and
// DER signatures, so registration and sign-in run end to end on the built Worker.
const subtle = webcrypto.subtle;
type Value = number | string | Uint8Array | Value[] | Map<Value, Value>;
function cbor(value: Value): Uint8Array {
  const head = (major: number, size: number) => size < 24 ? [major << 5 | size] : size < 256 ? [major << 5 | 24, size] : [major << 5 | 25, size >> 8, size & 255];
  if (typeof value === "number") return Uint8Array.from(value >= 0 ? head(0, value) : head(1, -1 - value));
  if (typeof value === "string") { const bytes = new TextEncoder().encode(value); return Uint8Array.from([...head(3, bytes.length), ...bytes]); }
  if (value instanceof Uint8Array) return Uint8Array.from([...head(2, value.length), ...value]);
  if (Array.isArray(value)) return Uint8Array.from([...head(4, value.length), ...value.flatMap(item => [...cbor(item)])]);
  return Uint8Array.from([...head(5, value.size), ...[...value].flatMap(([key, item]) => [...cbor(key), ...cbor(item)])]);
}
const sha256 = async (data: Uint8Array) => new Uint8Array(await subtle.digest("SHA-256", data));
const join8 = (...parts: Uint8Array[]) => { const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0)); let offset = 0; for (const part of parts) { out.set(part, offset); offset += part.length; } return out; };
const u32 = (value: number) => Uint8Array.from([value >>> 24, (value >>> 16) & 255, (value >>> 8) & 255, value & 255]);
function der(raw: Uint8Array) {
  const int = (part: Uint8Array) => { let bytes = [...part]; while (bytes.length > 1 && bytes[0] === 0 && !(bytes[1] & 0x80)) bytes = bytes.slice(1); if (bytes[0] & 0x80) bytes = [0, ...bytes]; return [2, bytes.length, ...bytes]; };
  const body = [...int(raw.slice(0, 32)), ...int(raw.slice(32))];
  return Uint8Array.from([0x30, body.length, ...body]);
}
/** A passkey on an emulated authenticator: it answers create() and get() as a browser would pass them on. */
async function authenticator(rpId: string, origin: string) {
  const pair = await subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]) as CryptoKeyPair;
  const raw = new Uint8Array(await subtle.exportKey("raw", pair.publicKey));
  const id = webcrypto.getRandomValues(new Uint8Array(32)), cose = cbor(new Map<Value, Value>([[1, 2], [3, -7], [-1, 1], [-2, raw.slice(1, 33)], [-3, raw.slice(33)]]));
  let counter = 0, handle: string | null = null;
  const clientData = (type: string, challenge: string, at = origin) => toBase64Url(new TextEncoder().encode(JSON.stringify({ type, challenge, origin: at, crossOrigin: false })));
  return {
    id: toBase64Url(id),
    create: async (challenge: string, flags = 0x45, at = origin, user?: string) => {
      if (user) handle = user;
      const authData = join8(await sha256(new TextEncoder().encode(rpId)), Uint8Array.of(flags), u32(0), new Uint8Array(16), Uint8Array.of(0, 32), id, cose);
      return { id: toBase64Url(id), rawId: toBase64Url(id), type: "public-key", response: { clientDataJSON: clientData("webauthn.create", challenge, at), attestationObject: toBase64Url(cbor(new Map<Value, Value>([["fmt", "none"], ["attStmt", new Map()], ["authData", authData]]))), transports: ["internal"] } };
    },
    get: async (challenge: string, options: { flags?: number; counter?: number; at?: string } = {}) => {
      if (options.counter === undefined) counter++;
      const authData = join8(await sha256(new TextEncoder().encode(rpId)), Uint8Array.of(options.flags ?? 0x05), u32(options.counter ?? counter));
      const client = clientData("webauthn.get", challenge, options.at);
      const signature = new Uint8Array(await subtle.sign({ name: "ECDSA", hash: "SHA-256" }, pair.privateKey, join8(authData, await sha256(fromBase64Url(client)!))));
      return { id: toBase64Url(id), rawId: toBase64Url(id), type: "public-key", response: { clientDataJSON: client, authenticatorData: toBase64Url(authData), signature: toBase64Url(der(signature)), userHandle: handle } };
    },
  };
}

describe("ST-132 WebAuthn rules", () => {
  it("decodes CBOR and DER as authenticators send them", () => {
    expect(decodeCbor(Uint8Array.from([0xa2, 0x01, 0x02, 0x20, 0x43, 1, 2, 3])).value).toEqual(new Map<unknown, unknown>([[1, 2], [-1, Uint8Array.from([1, 2, 3])]]));
    expect(() => decodeCbor(Uint8Array.from([0x9f]))).toThrow();
    const raw = Uint8Array.from({ length: 64 }, (_, index) => index === 0 ? 0x80 : index);
    expect(derToRaw(der(raw))).toEqual(raw);
    expect(derToRaw(Uint8Array.of(1, 2, 3))).toBeNull();
  });
  it("CA1 registration is refused for another type, challenge, origin, site or without verifying the person", async () => {
    const origin = "https://ejemplo.org", device = await authenticator("ejemplo.org", origin), challenge = toBase64Url(new TextEncoder().encode("d_ticket"));
    const expected = { challenge: "d_ticket", origin, rpId: "ejemplo.org" };
    const ok = await verifyRegistration((await device.create(challenge)).response, expected);
    expect(ok).toMatchObject({ id: device.id, counter: 0 });
    expect(signedChallenge((await device.create(challenge)).response.clientDataJSON)).toBe("d_ticket");
    expect(await verifyRegistration((await device.create(challenge)).response, { ...expected, challenge: "d_otro" })).toEqual({ problem: "challenge" });
    expect(await verifyRegistration((await device.create(challenge, 0x45, "https://otro.org")).response, expected)).toEqual({ problem: "origin" });
    expect(await verifyRegistration((await device.create(challenge)).response, { ...expected, rpId: "otro.org" })).toEqual({ problem: "rp" });
    expect(await verifyRegistration((await device.create(challenge, 0x41)).response, expected)).toEqual({ problem: "verification" });
    const stored = { publicKey: (ok as { publicKey: string }).publicKey, counter: 0 };
    const assertion = await device.get(challenge);
    expect(await verifyAssertion(assertion.response, stored, expected)).toMatchObject({ counter: 1 });
    expect(await verifyAssertion({ ...assertion.response, signature: toBase64Url(new Uint8Array(70)) }, stored, expected)).toEqual({ problem: "signature" });
    expect(await verifyAssertion(assertion.response, { ...stored, counter: 1 }, expected)).toEqual({ problem: "counter" });
    expect(await verifyAssertion((await device.get(challenge, { flags: 0x01 })).response, stored, expected)).toEqual({ problem: "verification" });
  });
});

let worker: ChildProcess;
let origin = "";
let logs = "";
const storage = mkdtempSync(join(tmpdir(), "hl-platform-passkeys-"));
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

const cookieOf = (response: Response) => response.headers.get("set-cookie")?.split(";")[0] || null;
const login = (username: string, password: string) => fetch(`${origin}/api/login`, { method: "POST", headers: { "Content-Type": "application/json", Origin: origin }, body: JSON.stringify({ username, password }) });
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
type Options = { publicKey: { challenge: string; rpId?: string; rp?: { id: string }; allowCredentials?: { id: string }[]; user?: { id: string }; authenticatorSelection?: { userVerification: string } } };
const log = async (admin: string | null, query: string) => (await read<{ events: { type: string; outcome: string; method: string | null; detail: string | null }[] }>(await as(admin, `/security/events?limite=100${query}`))).events;

describe("ST-132 on the built Worker", () => {
  let admin: string | null = null;
  beforeAll(async () => { admin = cookieOf(await login("admin-demo", "Aprender-2026!")); expect(admin).toBeTruthy(); });

  it("CA1–CA3 a person registers a named passkey, signs in with it without a password or a code, and removes it; all logged", async () => {
    const ana = await person(admin, "llave-ana");
    const device = await authenticator("127.0.0.1", origin);
    const options = await read<Options>(await as(ana.cookie, "/me/passkeys/options", "POST"));
    expect(options.publicKey).toMatchObject({ rp: { id: "127.0.0.1" }, authenticatorSelection: { userVerification: "required" } });
    // The user handle carries the organization's letter, to sign in without typing a name.
    expect(new TextDecoder().decode(fromBase64Url(options.publicKey.user!.id)!)).toBe(`d_${ana.id}`);
    // One click: without a name it takes the device's; it is renamed later.
    const created = await read<{ passkey: { id: string; name: string } }>(await as(ana.cookie, "/me/passkeys", "POST", { credential: await device.create(options.publicKey.challenge) }), 201);
    expect(created.passkey).toMatchObject({ id: device.id, name: "Navegador desconocido" });
    expect((await as(ana.cookie, `/me/passkeys/${device.id}`, "PUT", { name: "" })).status).toBe(400);
    expect((await read<{ name: string }>(await as(ana.cookie, `/me/passkeys/${device.id}`, "PUT", { name: "Teléfono de Ana" }))).name).toBe("Teléfono de Ana");
    // The same ceremony cannot register twice.
    expect((await as(ana.cookie, "/me/passkeys", "POST", { name: "Otra", credential: await device.create(options.publicKey.challenge) })).status).toBe(400);
    expect((await read<{ passkeys: { name: string }[] }>(await as(ana.cookie, "/me/passkeys"))).passkeys.map(item => item.name)).toEqual(["Teléfono de Ana"]);
    // A second factor is on: a passkey still signs in without asking for a code (it proves both).
    const { setup } = await read<{ setup: { key: string } }>(await as(ana.cookie, "/me/mfa/setup", "POST", { currentPassword: password }));
    const { stepOf, totpAt, fromBase32 } = await import("../packages/domain/src/index");
    await read(await as(ana.cookie, "/me/mfa/enable", "POST", { code: await totpAt(fromBase32(setup.key)!, stepOf(Date.now())) }));
    const signIn = await read<Options>(await as(null, "/login/passkey/options", "POST", { identifier: "llave-ana" }));
    expect(signIn.publicKey.allowCredentials?.map(item => item.id)).toEqual([device.id]);
    const opened = await as(null, "/login/passkey", "POST", { credential: await device.get(signIn.publicKey.challenge) });
    expect(opened.status, await opened.clone().text()).toBe(200);
    const session = cookieOf(opened);
    const sessions = await read<{ sessions: { method: string; current: boolean }[] }>(await as(session, "/me/account/sessions"));
    expect(sessions.sessions.find(item => item.current)?.method).toBe("passkey");
    // The ticket works once; a counter that does not move past the last one accepted (1) means a copy.
    expect((await as(null, "/login/passkey", "POST", { credential: await device.get(signIn.publicKey.challenge) })).status).toBe(400);
    const again = await read<Options>(await as(null, "/login/passkey/options", "POST", { identifier: "llave-ana" }));
    expect((await read<{ code: string }>(await as(null, "/login/passkey", "POST", { credential: await device.get(again.publicKey.challenge, { counter: 1 }) }), 401)).code).toBe("PASSKEY_REJECTED");
    // Another site's answer is refused.
    const third = await read<Options>(await as(null, "/login/passkey/options", "POST", { identifier: "llave-ana" }));
    expect((await as(null, "/login/passkey", "POST", { credential: await device.get(third.publicKey.challenge, { at: "https://otro.org" }) })).status).toBe(401);
    // An unknown name gets options too.
    expect((await read<Options>(await as(null, "/login/passkey/options", "POST", { identifier: "nadie-con-llave" }))).publicKey.allowCredentials).toEqual([]);
    await read(await as(session, `/me/passkeys/${device.id}`, "DELETE"));
    const fourth = await read<Options>(await as(null, "/login/passkey/options", "POST", { identifier: "llave-ana" }));
    expect((await as(null, "/login/passkey", "POST", { credential: await device.get(fourth.publicKey.challenge) })).status).toBe(401);
    const events = (await log(admin, `&persona=${ana.id}`)).map(item => `${item.type}:${item.outcome}:${item.method}`);
    for (const expected of ["passkey_added:succeeded:passkey", "sign_in:succeeded:passkey", "sign_in:failed:passkey", "passkey_removed:info:passkey"]) expect(events, expected).toContain(expected);
  });

  it("ST-132 a passkey signs in without typing a name: the device offers it and its handle names the organization", async () => {
    const eva = await person(admin, "llave-eva");
    const device = await authenticator("127.0.0.1", origin);
    const options = await read<Options>(await as(eva.cookie, "/me/passkeys/options", "POST"));
    await read(await as(eva.cookie, "/me/passkeys", "POST", { credential: await device.create(options.publicKey.challenge, 0x45, origin, options.publicKey.user!.id) }), 201);
    const anyone = await read<Options>(await as(null, "/login/passkey/options", "POST", {}));
    expect(anyone.publicKey.allowCredentials).toEqual([]);
    const opened = await as(null, "/login/passkey", "POST", { credential: await device.get(anyone.publicKey.challenge) });
    expect(opened.status, await opened.clone().text()).toBe(200);
    expect((await read<{ member: { username: string } }>(await as(cookieOf(opened), "/session"))).member.username).toBe("llave-eva");
  });

  it("ST-133 CA2 a session opened with a passkey meets a policy that requires two factors", async () => {
    const leo = await person(admin, "llave-leo");
    const device = await authenticator("127.0.0.1", origin);
    const options = await read<Options>(await as(leo.cookie, "/me/passkeys/options", "POST"));
    await read(await as(leo.cookie, "/me/passkeys", "POST", { name: "Portátil", credential: await device.create(options.publicKey.challenge) }), 201);
    const { policy } = await read<{ policy: Record<string, unknown> }>(await as(admin, "/security/policy"));
    await read(await as(admin, "/security/policy", "PUT", { ...policy, mfaEducator: true }));
    try {
      expect((await read<{ code: string }>(await as(leo.cookie, "/courses"), 403)).code).toBe("MFA_SETUP_REQUIRED");
      const signIn = await read<Options>(await as(null, "/login/passkey/options", "POST", { identifier: "llave-leo" }));
      const session = cookieOf(await as(null, "/login/passkey", "POST", { credential: await device.get(signIn.publicKey.challenge) }));
      expect((await as(session, "/courses")).status).toBe(200);
    } finally {
      await read(await as(admin, "/security/policy", "PUT", { ...policy, version: (policy.version as number) + 1, mfaEducator: false }));
    }
  });
});
