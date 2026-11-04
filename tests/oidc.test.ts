import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn, type ChildProcess } from "node:child_process";
import { createServer, type Server } from "node:net";
import { createServer as createHttpServer } from "node:http";
import { webcrypto, createHash } from "node:crypto";
import { once } from "node:events";
import { setTimeout as delay } from "node:timers/promises";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ssoInput, toBase64Url, verifiedEmail, verifyIdToken } from "../packages/domain/src/index";
import { acceptPending } from "./accept-pending";
import { listenOnTestPort } from "./test-port";

// ST-129 (Google, Microsoft), ST-131 (Apple) and ST-138 (the institution's provider) by OpenID Connect, against a
// stand-in provider on this machine that signs ID tokens with its own keys, checks PKCE and Apple's client secret.
const subtle = webcrypto.subtle;
const b64 = (data: Uint8Array | string) => toBase64Url(typeof data === "string" ? new TextEncoder().encode(data) : data);
let rsa: CryptoKeyPair, publicJwk: JsonWebKey & { kid: string };
async function sign(claims: Record<string, unknown>, key = rsa.privateKey, kid = "clave-1") {
  const body = `${b64(JSON.stringify({ alg: "RS256", kid, typ: "JWT" }))}.${b64(JSON.stringify(claims))}`;
  return `${body}.${b64(new Uint8Array(await subtle.sign("RSASSA-PKCS1-v1_5", key, new TextEncoder().encode(body))))}`;
}

describe("OpenID Connect rules", () => {
  beforeAll(async () => {
    rsa = await subtle.generateKey({ name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" }, true, ["sign", "verify"]) as CryptoKeyPair;
    publicJwk = { ...await subtle.exportKey("jwk", rsa.publicKey), kid: "clave-1", use: "sig" } as JsonWebKey & { kid: string };
  });
  it("an ID token is accepted only with a valid signature, issuer, audience, expiry and nonce", async () => {
    const now = Math.floor(Date.now() / 1000), claims = { iss: "https://idp.ejemplo.org", aud: "cliente", sub: "persona-1", exp: now + 300, iat: now, nonce: "n-1", email: "a@ejemplo.org", email_verified: true };
    const expected = { issuer: "https://idp.ejemplo.org", audience: "cliente", nonce: "n-1" };
    expect(await verifyIdToken(await sign(claims), [publicJwk], expected)).toMatchObject({ sub: "persona-1" });
    expect(await verifyIdToken(await sign({ ...claims, iss: "https://otro.org" }), [publicJwk], expected)).toEqual({ problem: "issuer" });
    expect(await verifyIdToken(await sign({ ...claims, aud: "otro" }), [publicJwk], expected)).toEqual({ problem: "audience" });
    expect(await verifyIdToken(await sign({ ...claims, exp: now - 120 }), [publicJwk], expected)).toEqual({ problem: "expired" });
    expect(await verifyIdToken(await sign({ ...claims, nonce: "n-2" }), [publicJwk], expected)).toEqual({ problem: "nonce" });
    expect(await verifyIdToken(await sign(claims, rsa.privateKey, "otra-clave"), [publicJwk], expected)).toEqual({ problem: "key" });
    const other = await subtle.generateKey({ name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" }, true, ["sign", "verify"]) as CryptoKeyPair;
    expect(await verifyIdToken(await sign(claims, other.privateKey), [publicJwk], expected)).toEqual({ problem: "signature" });
    const none = `${b64(JSON.stringify({ alg: "none" }))}.${b64(JSON.stringify(claims))}.`;
    expect(await verifyIdToken(none, [publicJwk], expected)).toEqual({ problem: "algorithm" });
    expect(verifiedEmail({ ...claims, email_verified: false })).toBeNull();
    expect(verifiedEmail({ ...claims, email_verified: undefined, email: undefined, preferred_username: "B@Escuela.edu.gt" }, true)).toBe("b@escuela.edu.gt");
  });
  it("the institution's provider is saved with an https issuer, domains and a role", () => {
    const base = { name: "Okta de la escuela", issuer: "https://escuela.okta.com/oauth2/default/", clientId: "abc", clientSecret: "s", domains: ["Escuela.edu.gt"], defaultRole: "educator", adminGroup: "", version: 0 };
    expect(ssoInput(base)).toMatchObject({ issuer: "https://escuela.okta.com/oauth2/default", domains: ["escuela.edu.gt"], adminGroup: null });
    for (const change of [{ issuer: "http://escuela.okta.com" }, { domains: [] }, { domains: ["sin punto"] }, { defaultRole: "root" }, { clientId: "" }]) expect(ssoInput({ ...base, ...change }), JSON.stringify(change)).toBeNull();
  });
});

const servers: { close(): void }[] = [];
const codes = new Map<string, { claims: Record<string, unknown>; challenge: string; client: string }>();
let applePublic: CryptoKey;
let worker: ChildProcess;
let origin = "", base = "", logs = "";
const storage = mkdtempSync(join(tmpdir(), "hl-platform-oidc-"));
async function freePort() {
  const server: Server = createServer();
  await listenOnTestPort(server);
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Missing local port");
  await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  return address.port;
}
beforeAll(async () => {
  const apple = await subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]) as CryptoKeyPair;
  applePublic = apple.publicKey;
  const pkcs8 = Buffer.from(await subtle.exportKey("pkcs8", apple.privateKey)).toString("base64");
  const idpPort = await freePort(), port = await freePort();
  base = `http://127.0.0.1:${idpPort}`;
  // The stand-in provider: discovery for the institution, keys, and a token endpoint that checks PKCE and the client.
  const idp = createHttpServer((request, response) => {
    let body = ""; request.on("data", chunk => { body += chunk; });
    request.on("end", async () => {
      const path = request.url || "";
      const send = (status: number, value: unknown) => response.writeHead(status, { "Content-Type": "application/json" }).end(JSON.stringify(value));
      if (path === "/okta/.well-known/openid-configuration") return send(200, { issuer: `${base}/okta`, authorization_endpoint: `${base}/okta/authorize`, token_endpoint: `${base}/okta/token`, jwks_uri: `${base}/okta/jwks` });
      if (path.endsWith("/jwks")) return send(200, { keys: [publicJwk] });
      if (path.endsWith("/token")) {
        const form = new URLSearchParams(body), found = codes.get(form.get("code") || "");
        if (!found) return send(400, { error: "invalid_grant" });
        codes.delete(form.get("code")!);
        const verifier = createHash("sha256").update(form.get("code_verifier") || "").digest("base64url");
        if (verifier !== found.challenge || form.get("client_id") !== found.client) return send(400, { error: "invalid_grant" });
        if (path.startsWith("/apple/")) {
          const [head, claims, signature] = (form.get("client_secret") || "").split(".");
          const valid = await subtle.verify({ name: "ECDSA", hash: "SHA-256" }, applePublic, Buffer.from(signature || "", "base64url"), new TextEncoder().encode(`${head}.${claims}`));
          if (!valid || JSON.parse(Buffer.from(claims, "base64url").toString()).sub !== "apple-test") return send(401, { error: "invalid_client" });
        } else if (form.get("client_secret") !== `secreto-${path.split("/")[1]}`) return send(401, { error: "invalid_client" });
        return send(200, { id_token: await sign(found.claims), token_type: "Bearer" });
      }
      send(404, {});
    });
  });
  idp.listen(idpPort, "127.0.0.1"); await once(idp, "listening"); servers.push(idp);
  origin = `http://127.0.0.1:${port}`;
  const vars = { GOOGLE_CLIENT_ID: "google-test", GOOGLE_CLIENT_SECRET: "secreto-google", MICROSOFT_CLIENT_ID: "microsoft-test", MICROSOFT_CLIENT_SECRET: "secreto-microsoft",
    APPLE_CLIENT_ID: "apple-test", APPLE_TEAM_ID: "EQUIPO1234", APPLE_KEY_ID: "CLAVE12345", APPLE_PRIVATE_KEY: `-----BEGIN PRIVATE KEY-----${pkcs8}-----END PRIVATE KEY-----`, OIDC_TEST_BASE: base };
  worker = spawn("node_modules/.bin/wrangler", ["dev", "--local", "--config", "build/wrangler.json", "--ip", "127.0.0.1", "--port", String(port), "--inspector-port", "0", "--persist-to", storage, ...Object.entries(vars).flatMap(([key, value]) => ["--var", `${key}:${value}`])], {
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
  for (const server of servers) server.close();
  rmSync(storage, { recursive: true, force: true });
});

const cookieOf = (response: Response, name = "hl_session") => response.headers.getSetCookie().map(item => item.split(";")[0]).find(item => item.startsWith(`${name}=`) && item.length > name.length + 1) || null;
const login = (username: string, password: string) => fetch(`${origin}/api/login`, { method: "POST", headers: { "Content-Type": "application/json", Origin: origin }, body: JSON.stringify({ username, password }) });
async function as(cookie: string | null, path: string, method = "GET", data?: unknown) {
  return fetch(`${origin}/api${path}`, { method, redirect: "manual", headers: { Cookie: cookie || "", Origin: origin, ...(data !== undefined ? { "Content-Type": "application/json" } : {}) }, ...(data !== undefined ? { body: JSON.stringify(data) } : {}) });
}
const read = async <T = Record<string, unknown>>(response: Response, status = 200) => { const text = await response.text(); expect(response.status, text).toBe(status); return JSON.parse(text) as T; };
const password = "Una frase para recordar 2026";
async function person(admin: string | null, username: string, role: "educator" | "admin" = "educator") {
  const created = await read<{ member: { id: string }; temporaryPassword: string }>(await as(admin, "/members", "POST", { displayName: `Persona ${username}`, username, role }), 201);
  const cookie = cookieOf(await login(username, created.temporaryPassword));
  await read(await as(cookie, "/account/password", "POST", { currentPassword: created.temporaryPassword, newPassword: password }));
  await acceptPending(origin, cookie, `Persona ${username}`, password);
  return { id: created.member.id, cookie };
}
/** Plays the provider's part: a code for these claims, then the browser comes back to the callback with it. */
async function roundTrip(started: Response, claims: (url: URL) => Record<string, unknown>, options: { cookie?: string | null; code?: string } = {}) {
  const { url } = await read<{ url: string }>(started);
  const binding = options.cookie === undefined ? cookieOf(started, "hl_oidc") : options.cookie;
  const authorize = new URL(url), code = options.code || `codigo-${Math.random().toString(36).slice(2)}`;
  expect(authorize.searchParams.get("code_challenge_method")).toBe("S256");
  codes.set(code, { claims: claims(authorize), challenge: authorize.searchParams.get("code_challenge")!, client: authorize.searchParams.get("client_id")! });
  const back = await fetch(`${authorize.searchParams.get("redirect_uri")}?code=${code}&state=${authorize.searchParams.get("state")}`, { redirect: "manual", headers: { Cookie: binding || "" } });
  return { response: back, location: back.headers.get("location") || "", state: authorize.searchParams.get("state")! };
}
const claimsFor = (provider: string, sub: string, extra: Record<string, unknown> = {}) => (url: URL) => ({ iss: `${base}/${provider}`, aud: url.searchParams.get("client_id"), sub, nonce: url.searchParams.get("nonce"), exp: Math.floor(Date.now() / 1000) + 300, iat: Math.floor(Date.now() / 1000), ...extra });
const log = async (admin: string | null, query: string) => (await read<{ events: { type: string; outcome: string; method: string | null; detail: string | null }[] }>(await as(admin, `/security/events?limite=100${query}`))).events;

describe("ST-129 ST-131 ST-138 on the built Worker", () => {
  let admin: string | null = null;
  beforeAll(async () => { admin = cookieOf(await login("admin-demo", "Aprender-2026!")); expect(admin).toBeTruthy(); });

  it("ST-129 CA1–CA3 a person links Google and signs in with it; an account not linked does not enter; administration unlinks", async () => {
    expect((await read<{ providers: string[] }>(await as(null, "/login/providers"))).providers).toEqual(["google", "microsoft", "apple"]);
    const ana = await person(admin, "oidc-ana");
    const linked = await roundTrip(await as(ana.cookie, "/me/identities/google", "POST"), claimsFor("google", "g-ana", { email: "ana@gmail.com", email_verified: true }));
    expect(linked.location).toBe("/mi-cuenta/seguridad?vinculo=vinculada");
    const mine = await read<{ linked: { provider: string; email: string }[] }>(await as(ana.cookie, "/me/identities"));
    expect(mine.linked).toEqual([expect.objectContaining({ provider: "google", email: "ana@gmail.com" })]);
    // Signing in with it, after typing who one is.
    const signedIn = await roundTrip(await as(null, "/login/provider/google", "POST", { identifier: "oidc-ana" }), claimsFor("google", "g-ana"));
    expect(signedIn.location).toBe("/inicio");
    const session = cookieOf(signedIn.response);
    expect((await read<{ member: { username: string } }>(await as(session, "/session"))).member.username).toBe("oidc-ana");
    expect((await read<{ sessions: { method: string; current: boolean }[] }>(await as(session, "/me/account/sessions"))).sessions.find(item => item.current)?.method).toBe("google");
    // CA2: another Google account is not linked to anyone.
    expect((await roundTrip(await as(null, "/login/provider/google", "POST", { identifier: "oidc-ana" }), claimsFor("google", "g-otra"))).location).toBe("/?acceso=sin-cuenta");
    // The same state twice, a callback from another browser, a wrong nonce or audience: refused.
    const replay = await roundTrip(await as(null, "/login/provider/google", "POST", { identifier: "oidc-ana" }), claimsFor("google", "g-ana"));
    codes.set("otro-codigo", { claims: {}, challenge: "", client: "" });
    expect((await fetch(`${origin}/api/auth/callback/google?code=otro-codigo&state=${replay.state}`, { redirect: "manual" })).headers.get("location")).toBe("/?acceso=caducado");
    expect((await roundTrip(await as(null, "/login/provider/google", "POST", { identifier: "oidc-ana" }), claimsFor("google", "g-ana"), { cookie: null })).location).toBe("/?acceso=otro-navegador");
    expect((await roundTrip(await as(null, "/login/provider/google", "POST", { identifier: "oidc-ana" }), url => ({ ...claimsFor("google", "g-ana")(url), nonce: "otro" }))).location).toBe("/?acceso=error");
    expect((await roundTrip(await as(null, "/login/provider/google", "POST", { identifier: "oidc-ana" }), url => ({ ...claimsFor("google", "g-ana")(url), aud: "otra-app" }))).location).toBe("/?acceso=error");
    // The same Google account cannot be linked to a second person.
    const leo = await person(admin, "oidc-leo");
    expect((await roundTrip(await as(leo.cookie, "/me/identities/google", "POST"), claimsFor("google", "g-ana"))).location).toBe("/mi-cuenta/seguridad?vinculo=ya-vinculada");
    // CA3: administration unlinks it; it no longer enters. Every step is logged.
    expect((await as(leo.cookie, `/security/people/${ana.id}/identities/google`, "DELETE")).status).toBe(403);
    await read(await as(admin, `/security/people/${ana.id}/identities/google`, "DELETE"));
    expect((await roundTrip(await as(null, "/login/provider/google", "POST", { identifier: "oidc-ana" }), claimsFor("google", "g-ana"))).location).toBe("/?acceso=sin-cuenta");
    const events = (await log(admin, `&persona=${ana.id}`)).map(item => `${item.type}:${item.outcome}:${item.method}`);
    for (const expected of ["provider_linked:succeeded:google", "sign_in:succeeded:google", "provider_unlinked:info:google"]) expect(events, expected).toContain(expected);
    expect((await log(admin, "&tipo=sign_in")).some(item => item.method === "google" && item.outcome === "failed")).toBe(true);
  });

  it("ST-129 Microsoft and ST-131 Apple (its client secret signed with the account's key) link and sign in the same way", async () => {
    const eva = await person(admin, "oidc-eva");
    for (const provider of ["microsoft", "apple"]) {
      expect((await roundTrip(await as(eva.cookie, `/me/identities/${provider}`, "POST"), claimsFor(provider, `${provider}-eva`))).location, provider).toBe("/mi-cuenta/seguridad?vinculo=vinculada");
      const signedIn = await roundTrip(await as(null, `/login/provider/${provider}`, "POST", { identifier: "oidc-eva" }), claimsFor(provider, `${provider}-eva`));
      expect(signedIn.location, provider).toBe("/inicio");
    }
    await read(await as(eva.cookie, "/me/identities/apple", "DELETE"));
    expect((await read<{ linked: { provider: string }[] }>(await as(eva.cookie, "/me/identities"))).linked.map(item => item.provider)).toEqual(["microsoft"]);
  });

  it("ST-138 CA1–CA3 administration configures the institution's provider, tests it, activates it; only active people enter and the role follows the group", async () => {
    const educator = await person(admin, "oidc-mirona");
    const config = { name: "Okta de la escuela", issuer: `${base}/okta`, clientId: "okta-test", clientSecret: "secreto-okta", domains: ["escuela.edu.gt"], defaultRole: "educator", adminGroup: "hl-admins", version: 0 };
    expect((await as(educator.cookie, "/security/sso", "PUT", config)).status).toBe(403);
    const saved = await read<{ connection: { status: string; version: number; clientSecret?: string } }>(await as(admin, "/security/sso", "PUT", config), 201);
    expect(saved.connection).toMatchObject({ status: "draft", version: 1 });
    expect(JSON.stringify(await read(await as(admin, "/security/sso")))).not.toContain("secreto-okta");
    expect((await as(admin, "/security/sso/activate", "POST", { version: 1 })).status).toBe(409);
    // A test with an account outside the domains fails; one inside passes.
    expect((await roundTrip(await as(admin, "/security/sso/test", "POST"), claimsFor("okta", "okta-x", { email: "x@otra.org", email_verified: true }))).location).toBe("/identidad/inicio-de-sesion?prueba=dominio");
    expect((await roundTrip(await as(admin, "/security/sso/test", "POST"), claimsFor("okta", "okta-admin", { email: "direccion@escuela.edu.gt", email_verified: true, groups: ["hl-admins"] }))).location).toBe("/identidad/inicio-de-sesion?prueba=correcta");
    const active = await read<{ connection: { status: string } }>(await as(admin, "/security/sso/activate", "POST", { version: 1 }));
    expect(active.connection.status).toBe("active");
    // An active person with that sign-in e-mail enters; the group makes them administration.
    const maria = await person(admin, "oidc-maria");
    const change = await read<{ link?: string }>(await as(maria.cookie, "/me/account/email", "POST", { email: "maria@escuela.edu.gt", currentPassword: password }), 201);
    await read(await as(null, `/account/email/${/cuenta\/correo\/([a-z]_[a-f0-9]{64})/.exec(change.link!)![1]}`, "POST"));
    const signedIn = await roundTrip(await as(null, "/login/provider/sso", "POST", { identifier: "maria@escuela.edu.gt" }), claimsFor("okta", "okta-maria", { email: "maria@escuela.edu.gt", email_verified: true, groups: ["hl-admins"] }));
    expect(signedIn.location).toBe("/inicio");
    expect((await read<{ member: { username: string; role: string } }>(await as(cookieOf(signedIn.response), "/session"))).member).toMatchObject({ username: "oidc-maria", role: "admin" });
    // Nobody else enters: an unknown person of the domain, or an e-mail of another domain.
    expect((await roundTrip(await as(null, "/login/provider/sso", "POST", { identifier: "maria@escuela.edu.gt" }), claimsFor("okta", "okta-nadie", { email: "nadie@escuela.edu.gt", email_verified: true }))).location).toBe("/?acceso=sin-cuenta");
    expect((await roundTrip(await as(null, "/login/provider/sso", "POST", { identifier: "maria@escuela.edu.gt" }), claimsFor("okta", "okta-maria", { email: "maria@otra.org", email_verified: true }))).location).toBe("/?acceso=dominio");
    const events = (await log(admin, "&tipo=sso_changed")).map(item => item.outcome);
    expect(events).toEqual(expect.arrayContaining(["succeeded", "failed", "info"]));
    expect((await log(admin, `&persona=${maria.id}&tipo=role_changed`)).some(item => item.method === "sso")).toBe(true);
    // Changing how to reach it needs a new test.
    const again = await read<{ connection: { status: string } }>(await as(admin, "/security/sso", "PUT", { ...config, clientSecret: "otro-secreto", version: 1 }));
    expect(again.connection.status).toBe("draft");
  });
});
