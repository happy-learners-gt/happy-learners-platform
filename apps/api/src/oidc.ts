import type { Member, SignInMethod } from "@happy-learners/contracts";
import type { IdClaims, ProviderKey } from "@happy-learners/domain";
import { identifierInput, maskEmail, oidcStateMs, pkceChallenge, providerNames, ssoInput, tokenMessage, tokenPattern, tokenPrefix, verifiedEmail, verifyIdToken } from "@happy-learners/domain";
import type { Database } from "./storage";
import { digest, newToken } from "./auth";
import { clientOf, type Client } from "./account";
import { event } from "./activity";
import { securityEvent } from "./security-log";
import { finishSignIn } from "./sign-in";
import { seal, unseal } from "./mfa";

/**
 * Identity providers by OpenID Connect (REL-007):
 * - ST-129 Google and Microsoft, ST-131 Apple: a person links their account from Mi cuenta (signed in) and then signs
 *   in with it. Only an account linked to an active person of the organization enters. Each needs the application
 *   registered with the provider; its client id and secret are Worker secrets. Without them, the provider is not offered.
 * - ST-138: the institution's provider (Okta, Microsoft Entra ID or any OpenID Connect provider), configured by
 *   administration, tested before it can be activated. Its people enter by their e-mail domain; the role follows the
 *   configured group when there is one.
 * Every round trip has a state of one use (10 minutes), a nonce checked in the ID token, PKCE, and a cookie of this
 * browser that must come back with it, so nobody can finish a sign-in started elsewhere. Every result is logged.
 */
declare global { interface Env {
  GOOGLE_CLIENT_ID?: string; GOOGLE_CLIENT_SECRET?: string; MICROSOFT_CLIENT_ID?: string; MICROSOFT_CLIENT_SECRET?: string;
  APPLE_CLIENT_ID?: string; APPLE_TEAM_ID?: string; APPLE_KEY_ID?: string; APPLE_PRIVATE_KEY?: string; OIDC_TEST_BASE?: string;
} }
const reply = (value: unknown, status = 200) => Response.json(value, { status });
type Jwk = JsonWebKey & { kid?: string };
interface Provider {
  key: ProviderKey; clientId: string; secret: () => Promise<string>; authorize: string; token: string; jwks: string; scope: string;
  issuer: string | ((claims: IdClaims) => boolean); extra?: Record<string, string>;
}
const local = (origin: string) => /^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(origin);
/** A provider's address is https, or a server on this machine when the Worker runs here too (the tests' stand-in). */
const allowed = (url: string, origin: string) => /^https:\/\//.test(url) || (local(origin) && /^http:\/\/127\.0\.0\.1:\d+\//.test(url));
const testBase = (env: Env, origin: string) => { const base = env.OIDC_TEST_BASE?.trim(); return base && local(origin) && /^http:\/\/127\.0\.0\.1:\d+$/.test(base) ? base : null; };

const pem = (text: string) => Uint8Array.from(atob(text.replace(/-----[^-]+-----/g, "").replace(/\s+/g, "")), char => char.charCodeAt(0));
const b64url = (data: Uint8Array | string) => btoa(typeof data === "string" ? unescape(encodeURIComponent(data)) : String.fromCharCode(...data)).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
/** Apple's client secret: a JWT signed with the key of the developer account, valid for 5 minutes. */
async function appleSecret(env: Env) {
  const key = await crypto.subtle.importKey("pkcs8", pem(env.APPLE_PRIVATE_KEY!), { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);
  const now = Math.floor(Date.now() / 1000), body = `${b64url(JSON.stringify({ alg: "ES256", kid: env.APPLE_KEY_ID }))}.${b64url(JSON.stringify({ iss: env.APPLE_TEAM_ID, iat: now, exp: now + 300, aud: "https://appleid.apple.com", sub: env.APPLE_CLIENT_ID }))}`;
  return `${body}.${b64url(new Uint8Array(await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, key, new TextEncoder().encode(body))))}`;
}
/** Google, Microsoft and Apple, when their credentials are configured. */
export function socialProvider(env: Env, key: ProviderKey, origin: string): Provider | null {
  const base = testBase(env, origin);
  const at = (provider: string, real: { authorize: string; token: string; jwks: string; issuer: Provider["issuer"] }) => base
    ? { authorize: `${base}/${provider}/authorize`, token: `${base}/${provider}/token`, jwks: `${base}/${provider}/jwks`, issuer: `${base}/${provider}` } : real;
  if (key === "google" && env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET) return { key, clientId: env.GOOGLE_CLIENT_ID, secret: async () => env.GOOGLE_CLIENT_SECRET!, scope: "openid email",
    ...at("google", { authorize: "https://accounts.google.com/o/oauth2/v2/auth", token: "https://oauth2.googleapis.com/token", jwks: "https://www.googleapis.com/oauth2/v3/certs", issuer: claims => claims.iss === "https://accounts.google.com" || claims.iss === "accounts.google.com" }) };
  if (key === "microsoft" && env.MICROSOFT_CLIENT_ID && env.MICROSOFT_CLIENT_SECRET) return { key, clientId: env.MICROSOFT_CLIENT_ID, secret: async () => env.MICROSOFT_CLIENT_SECRET!, scope: "openid email profile",
    ...at("microsoft", { authorize: "https://login.microsoftonline.com/common/oauth2/v2.0/authorize", token: "https://login.microsoftonline.com/common/oauth2/v2.0/token", jwks: "https://login.microsoftonline.com/common/discovery/v2.0/keys",
      issuer: claims => typeof claims.tid === "string" && /^[0-9a-f-]{36}$/.test(claims.tid) && claims.iss === `https://login.microsoftonline.com/${claims.tid}/v2.0` }) };
  if (key === "apple" && env.APPLE_CLIENT_ID && env.APPLE_TEAM_ID && env.APPLE_KEY_ID && env.APPLE_PRIVATE_KEY) return { key, clientId: env.APPLE_CLIENT_ID, secret: () => appleSecret(env), scope: "openid",
    ...at("apple", { authorize: "https://appleid.apple.com/auth/authorize", token: "https://appleid.apple.com/auth/token", jwks: "https://appleid.apple.com/auth/keys", issuer: "https://appleid.apple.com" }), extra: { response_mode: "query" } };
  return null;
}
export const socialKeys: ProviderKey[] = ["google", "microsoft", "apple"];
export const availableProviders = (env: Env, origin: string) => socialKeys.filter(key => socialProvider(env, key, origin));

type Connection = { name: string; issuer: string; clientId: string; clientSecret: string; domains: string; defaultRole: "educator" | "admin"; adminGroup: string | null; status: "draft" | "tested" | "active"; testedAt: string | null; version: number; updatedAt: string };
const connectionOf = (db: Database, org: string) => db.prepare("SELECT name,issuer,client_id AS clientId,client_secret AS clientSecret,domains,default_role AS defaultRole,admin_group AS adminGroup,status,tested_at AS testedAt,version,updated_at AS updatedAt FROM sso_connections WHERE organization_id=?").bind(org).first<Connection>();
async function fetchJson<T>(url: string, origin: string, init?: RequestInit): Promise<T> {
  if (!allowed(url, origin)) throw new Error("Dirección no permitida");
  const response = await fetch(url, { ...init, signal: AbortSignal.timeout(5000), headers: { Accept: "application/json", ...(init?.headers || {}) } });
  if (!response.ok) throw new Error(`El proveedor respondió ${response.status}`);
  return response.json() as Promise<T>;
}
/** The institution's provider, from its discovery document; the issuer must be the one configured. */
async function ssoProvider(db: Database, org: string, origin: string): Promise<{ provider: Provider; connection: Connection } | null> {
  const connection = await connectionOf(db, org);
  if (!connection || !allowed(connection.issuer, origin)) return null;
  const discovery = await fetchJson<{ issuer: string; authorization_endpoint: string; token_endpoint: string; jwks_uri: string }>(`${connection.issuer}/.well-known/openid-configuration`, origin);
  if (discovery.issuer.replace(/\/+$/, "") !== connection.issuer || ![discovery.authorization_endpoint, discovery.token_endpoint, discovery.jwks_uri].every(url => typeof url === "string" && allowed(url, origin))) throw new Error("El documento de descubrimiento no corresponde al emisor configurado");
  return { connection, provider: { key: "sso", clientId: connection.clientId, secret: async () => new TextDecoder().decode(await unseal(db, connection.clientSecret)), authorize: discovery.authorization_endpoint, token: discovery.token_endpoint, jwks: discovery.jwks_uri, scope: "openid email profile", issuer: discovery.issuer } };
}

type Purpose = "link" | "sign_in" | "test";
type State = { provider: ProviderKey; purpose: Purpose; userId: string | null; nonce: string; verifier: string; binding: string };
const bindingCookie = (value: string, request: Request, remove = false) => `hl_oidc=${value}; Path=/api/auth; HttpOnly; SameSite=Lax; Max-Age=${remove ? 0 : 600}${new URL(request.url).protocol === "https:" ? "; Secure" : ""}`;
const bindingOf = (request: Request) => /(?:^|;\s*)hl_oidc=([a-f0-9]{64})(?:;|$)/.exec(request.headers.get("Cookie") || "")?.[1] || null;
const callbackUrl = (origin: string, key: ProviderKey) => `${origin}/api/auth/callback/${key}`;

/** Starts a round trip: the provider's address to open, and the cookie that binds it to this browser. */
async function start(provider: Provider, purpose: Purpose, userId: string | null, scope: string, db: Database, request: Request) {
  const origin = new URL(request.url).origin, state = tokenPrefix(scope) + newToken(), nonce = newToken(), verifier = newToken() + newToken(), binding = newToken(), now = Date.now();
  const data: State = { provider: provider.key, purpose, userId, nonce, verifier, binding: await digest(binding) };
  await db.batch([db.prepare("INSERT INTO auth_challenges(token_hash,kind,user_id,data,created_at,expires_at) VALUES (?,'provider',?,?,?,?)").bind(await digest(state), userId, JSON.stringify(data), now, now + oidcStateMs)]);
  const url = new URL(provider.authorize);
  for (const [key, value] of Object.entries({ response_type: "code", client_id: provider.clientId, redirect_uri: callbackUrl(origin, provider.key), scope: provider.scope, state, nonce, code_challenge: await pkceChallenge(verifier), code_challenge_method: "S256", ...(provider.extra || {}) })) url.searchParams.set(key, value);
  return Response.json({ url: url.toString() }, { headers: { "Set-Cookie": bindingCookie(binding, request) } });
}

const redirect = (location: string, cookies: string[] = []) => { const headers = new Headers({ Location: location, "Cache-Control": "no-store" }); for (const cookie of cookies) headers.append("Set-Cookie", cookie); return new Response(null, { status: 302, headers }); };
const back = (purpose: Purpose, outcome: string) => purpose === "link" ? `/mi-cuenta/cuenta?vinculo=${outcome}#cuentas-vinculadas` : purpose === "test" ? `/seguridad?prueba=${outcome}#proveedor` : `/?acceso=${outcome}`;
export const callbackPath = /^\/api\/auth\/callback\/(google|microsoft|apple|sso)$/;

/** GET /api/auth/callback/:provider: the provider's answer. Everything is checked before anything changes. */
export async function callback(key: ProviderKey, url: URL, request: Request, scope: string, db: Database, env: Env): Promise<Response> {
  const client: Client = clientOf(request), origin = url.origin, token = url.searchParams.get("state") || "", clear = bindingCookie("", request, true);
  if (!tokenPattern.test(token)) return redirect("/?acceso=error", [clear]);
  const hash = await digest(token), now = Date.now();
  const row = await db.prepare("SELECT data FROM auth_challenges WHERE token_hash=? AND kind='provider' AND used_at IS NULL AND expires_at>?").bind(hash, now).first<{ data: string }>();
  const state = row ? JSON.parse(row.data) as State : null;
  if (!state || state.provider !== key) return redirect("/?acceso=caducado", [clear]);
  const binding = bindingOf(request);
  if (!binding || await digest(binding) !== state.binding) return redirect(back(state.purpose, "otro-navegador"), [clear]);
  const used = await db.guardedBatch(db.prepare("SELECT 1 FROM auth_challenges WHERE token_hash=? AND used_at IS NULL").bind(hash), [db.prepare("UPDATE auth_challenges SET used_at=? WHERE token_hash=?").bind(now, hash)]);
  if (!used) return redirect("/?acceso=caducado", [clear]);
  const fail = async (outcome: string, detail: string, subject: string | null = state.userId) => {
    await db.batch([securityEvent(db, { organizationId: scope, type: state.purpose === "link" ? "provider_linked" : state.purpose === "test" ? "sso_changed" : "sign_in", outcome: "failed", actorId: state.userId, subjectId: subject, method: key, detail: `${providerNames[key]}: ${detail}`.slice(0, 240), client })]);
    return redirect(back(state.purpose, outcome), [clear]);
  };
  if (url.searchParams.get("error")) return fail("cancelado", "el proveedor no autorizó el acceso");
  const code = url.searchParams.get("code");
  if (!code || code.length > 4000) return fail("error", "sin código de autorización");
  let provider: Provider | null = null, connection: Connection | null = null;
  try {
    if (key === "sso") { const found = await ssoProvider(db, scope, origin); provider = found?.provider || null; connection = found?.connection || null; }
    else provider = socialProvider(env, key, origin);
  } catch { return fail("error", "no se pudo leer la configuración del proveedor"); }
  if (!provider) return fail("error", "el proveedor no está configurado");
  let claims: IdClaims | { problem: keyof typeof tokenMessage };
  try {
    const answer = await fetchJson<{ id_token?: string }>(provider.token, origin, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ grant_type: "authorization_code", code, redirect_uri: callbackUrl(origin, key), client_id: provider.clientId, client_secret: await provider.secret(), code_verifier: state.verifier }).toString() });
    const keys = (await fetchJson<{ keys: Jwk[] }>(provider.jwks, origin)).keys || [];
    claims = await verifyIdToken(answer.id_token, keys, { issuer: provider.issuer, audience: provider.clientId, nonce: state.nonce });
  } catch { return fail("error", "no se pudo completar el intercambio con el proveedor"); }
  if ("problem" in claims) return fail("error", tokenMessage[claims.problem]);
  const at = new Date().toISOString();

  if (state.purpose === "test") {
    const email = verifiedEmail(claims, true), domains = connection!.domains.split(",");
    if (!email || !domains.includes(email.split("@")[1])) return fail("dominio", "la cuenta de prueba no tiene un correo de los dominios configurados");
    await db.batch([
      db.prepare("UPDATE sso_connections SET status=CASE WHEN status='active' THEN 'active' ELSE 'tested' END,tested_at=? WHERE organization_id=? AND version=?").bind(at, scope, connection!.version),
      securityEvent(db, { organizationId: scope, type: "sso_changed", outcome: "succeeded", actorId: state.userId, method: "sso", detail: `Prueba correcta con ${maskEmail(email)}${claims.groups?.length ? ` (${claims.groups.length} grupos)` : ""}`, client }),
    ]);
    return redirect(back("test", "correcta"), [clear]);
  }
  if (state.purpose === "link") {
    const person = await db.prepare("SELECT u.id FROM users u JOIN memberships m ON m.user_id=u.id AND m.organization_id=? AND m.active=1 WHERE u.id=?").bind(scope, state.userId).first<{ id: string }>();
    if (!person) return fail("error", "la cuenta ya no está activa");
    const email = verifiedEmail(claims, key === "microsoft");
    const ok = await db.guardedBatch(db.prepare("SELECT 1 WHERE NOT EXISTS (SELECT 1 FROM linked_identities WHERE (provider=? AND subject=?) OR (user_id=? AND provider=?))").bind(key, claims.sub, person.id, key), [
      db.prepare("INSERT INTO linked_identities(provider,subject,user_id,email,linked_at) VALUES (?,?,?,?,?)").bind(key, claims.sub, person.id, email, at),
      securityEvent(db, { organizationId: scope, type: "provider_linked", outcome: "succeeded", actorId: person.id, subjectId: person.id, method: key, detail: email ? `${providerNames[key]} · ${maskEmail(email)}` : providerNames[key], client }),
      event(db, { id: person.id, username: "", role: "educator", organizationId: scope }, { action: "assigned", targetType: "account", targetId: person.id, summary: `Vinculó su cuenta de ${providerNames[key]}` }),
    ]);
    return ok ? redirect(back("link", "vinculada"), [clear]) : fail("ya-vinculada", "esa cuenta ya está vinculada, o ya hay una de este proveedor");
  }
  // Signing in: only an account linked to an active person enters. For the institution's provider, an active person
  // whose sign-in e-mail is in the configured domains is linked on their first federated sign-in.
  let found = await db.prepare("SELECT l.user_id AS userId FROM linked_identities l JOIN memberships m ON m.user_id=l.user_id AND m.organization_id=? AND m.active=1 WHERE l.provider=? AND l.subject=?").bind(scope, key, claims.sub).first<{ userId: string }>();
  const extra = [];
  if (key === "sso") {
    if (connection!.status !== "active") return fail("error", "el proveedor institucional no está activo");
    const email = verifiedEmail(claims, true), domains = connection!.domains.split(",");
    if (!email || !domains.includes(email.split("@")[1])) return fail("dominio", "el correo de la cuenta no es de los dominios de la organización");
    if (!found) {
      const byEmail = await db.prepare("SELECT u.id FROM users u JOIN memberships m ON m.user_id=u.id AND m.organization_id=? AND m.active=1 WHERE u.email=?").bind(scope, email).first<{ id: string }>();
      if (byEmail) { found = { userId: byEmail.id }; extra.push(db.prepare("INSERT OR IGNORE INTO linked_identities(provider,subject,user_id,email,linked_at) VALUES ('sso',?,?,?,?)").bind(claims.sub, byEmail.id, email, at)); }
    }
    if (found && connection!.adminGroup && Array.isArray(claims.groups)) {
      // The role follows the configured group at each federated sign-in.
      const role = claims.groups.includes(connection!.adminGroup) ? "admin" : connection!.defaultRole, stored = role === "admin" ? "admin" : "instructor";
      const current = await db.prepare("SELECT role FROM memberships WHERE user_id=? AND organization_id=?").bind(found.userId, scope).first<{ role: string }>();
      if (current && current.role !== stored && found.userId !== "user-0") extra.push(
        db.prepare("UPDATE memberships SET role=? WHERE user_id=? AND organization_id=?").bind(stored, found.userId, scope),
        db.prepare("INSERT INTO role_events VALUES (?,?,?,?,?,?)").bind(crypto.randomUUID(), found.userId, found.userId, role, 1, at),
        securityEvent(db, { organizationId: scope, type: "role_changed", actorId: null, subjectId: found.userId, method: "sso", detail: `Por el grupo del proveedor institucional: ${role === "admin" ? "Administración" : "Educador"}`, client }));
    }
  }
  if (!found) return fail("sin-cuenta", "la cuenta no está vinculada a ninguna persona activa de la organización", null);
  extra.push(db.prepare("UPDATE linked_identities SET last_used_at=? WHERE provider=? AND subject=?").bind(at, key, claims.sub));
  const signedIn = await finishSignIn(db, request, found.userId, scope, key as SignInMethod, client, extra);
  const answer = await signedIn.json() as { challenge?: string };
  if (answer.challenge) return redirect(`/?mfa=${answer.challenge}`, [clear]);
  return redirect("/inicio", [clear, signedIn.headers.get("Set-Cookie")!]);
}

export const providerStartPath = /^\/api\/login\/provider\/(google|microsoft|apple|sso)$/;
/** POST /api/login/provider/:provider {identifier}: starts signing in; the organization comes from what was typed. */
export async function startSignIn(key: ProviderKey, input: unknown, request: Request, scope: string, db: Database, env: Env) {
  if (!identifierInput(input)) return reply({ error: key === "sso" ? "Escribe tu correo institucional." : "Escribe tu usuario o tu correo para entrar con tu cuenta vinculada." }, 400);
  const origin = new URL(request.url).origin;
  try {
    const provider = key === "sso" ? (await ssoProvider(db, scope, origin))?.provider : socialProvider(env, key, origin);
    if (!provider || (key === "sso" && (await connectionOf(db, scope))?.status !== "active")) return reply({ error: key === "sso" ? "Tu organización no tiene un proveedor institucional activo para ese correo." : `El inicio con ${providerNames[key]} no está disponible.` }, 404);
    return start(provider, "sign_in", null, scope, db, request);
  } catch { return reply({ error: "No pudimos contactar al proveedor. Vuelve a intentar." }, 502); }
}

export const identityPath = /^\/api\/me\/identities\/(google|microsoft|apple)$/;
export const personIdentityPath = /^\/api\/security\/people\/([a-z0-9-]{1,100})\/identities\/(google|microsoft|apple|sso)$/;
async function unlink(db: Database, current: Member, userId: string, key: ProviderKey, client: Client, byAdmin: boolean) {
  const found = await db.prepare("SELECT l.email,COALESCE(u.display_name,u.username) AS name FROM linked_identities l JOIN users u ON u.id=l.user_id JOIN memberships m ON m.user_id=u.id AND m.organization_id=? WHERE l.user_id=? AND l.provider=?").bind(current.organizationId, userId, key).first<{ email: string | null; name: string }>();
  if (!found) return reply({ error: `No hay una cuenta de ${providerNames[key]} vinculada.` }, 404);
  await db.batch([
    db.prepare("DELETE FROM linked_identities WHERE user_id=? AND provider=?").bind(userId, key),
    securityEvent(db, { organizationId: current.organizationId, type: "provider_unlinked", actorId: current.id, subjectId: userId, method: key, detail: providerNames[key], client }),
    event(db, current, { action: "revoked", targetType: "account", targetId: userId, summary: byAdmin ? `Desvinculó la cuenta de ${providerNames[key]} de ${found.name}` : `Desvinculó su cuenta de ${providerNames[key]}` }),
  ]);
  return reply({ ok: true });
}
/** /api/me/identities…: the person's linked accounts, linking (a round trip) and unlinking. */
export async function myIdentities(path: string, method: string, current: Member, db: Database, request: Request, env: Env) {
  const origin = new URL(request.url).origin, client = clientOf(request);
  if (path === "/api/me/identities") {
    const linked = (await db.prepare("SELECT provider,email,linked_at AS linkedAt,last_used_at AS lastUsedAt FROM linked_identities WHERE user_id=? ORDER BY linked_at").bind(current.id).all()).results;
    return reply({ linked, available: availableProviders(env, origin) });
  }
  const key = identityPath.exec(path)![1] as ProviderKey;
  if (method === "DELETE") return unlink(db, current, current.id, key, client, false);
  const provider = socialProvider(env, key, origin);
  if (!provider) return reply({ error: `El inicio con ${providerNames[key]} no está configurado en esta plataforma.` }, 404);
  return start(provider, "link", current.id, current.organizationId, db, request);
}
export const unlinkByAdmin = (userId: string, key: ProviderKey, current: Member, db: Database, client: Client) => unlink(db, current, userId, key, client, true);

/** /api/security/sso[/test|/activate]: the institution's provider, administration only. */
export async function sso(path: string, method: string, input: unknown, current: Member, db: Database, request: Request) {
  if (current.role !== "admin") return reply({ error: "Solo administración configura el proveedor institucional." }, 403);
  const org = current.organizationId, client = clientOf(request), origin = new URL(request.url).origin, connection = await connectionOf(db, org);
  const view = (row: Connection | null) => row && { name: row.name, issuer: row.issuer, clientId: row.clientId, domains: row.domains.split(","), defaultRole: row.defaultRole, adminGroup: row.adminGroup, status: row.status, testedAt: row.testedAt, version: row.version, updatedAt: row.updatedAt, callback: callbackUrl(origin, "sso") };
  if (path === "/api/security/sso" && method === "GET") return reply({ connection: view(connection), callback: callbackUrl(origin, "sso") });
  if (path === "/api/security/sso" && method === "DELETE") {
    if (!connection) return reply({ error: "No hay un proveedor institucional configurado." }, 404);
    await db.batch([db.prepare("DELETE FROM sso_connections WHERE organization_id=?").bind(org), db.prepare("DELETE FROM linked_identities WHERE provider='sso'"),
      securityEvent(db, { organizationId: org, type: "sso_changed", actorId: current.id, method: "sso", detail: `Eliminó el proveedor «${connection.name}»`, client })]);
    return reply({ ok: true });
  }
  if (path === "/api/security/sso/test") {
    if (!connection) return reply({ error: "Guarda el proveedor antes de probarlo." }, 409);
    try { const found = await ssoProvider(db, org, origin); if (!found) return reply({ error: "La dirección del emisor no es válida." }, 400); return start(found.provider, "test", current.id, org, db, request); }
    catch (cause) { return reply({ error: `No pudimos leer la configuración del proveedor: ${cause instanceof Error ? cause.message : "error"}.` }, 502); }
  }
  if (path === "/api/security/sso/activate") {
    const value = input && typeof input === "object" ? input as Record<string, unknown> : {};
    if (!connection || connection.status === "draft") return reply({ error: "Prueba el proveedor con una cuenta de la institución antes de activarlo." }, 409);
    if (value.version !== connection.version) return reply({ error: "La configuración cambió. Recarga antes de activarla." }, 409);
    const on = value.active !== false;
    await db.batch([db.prepare("UPDATE sso_connections SET status=? WHERE organization_id=?").bind(on ? "active" : "tested", org),
      securityEvent(db, { organizationId: org, type: "sso_changed", actorId: current.id, method: "sso", detail: on ? `Activó el proveedor «${connection.name}»` : `Desactivó el proveedor «${connection.name}»`, client })]);
    return reply({ connection: view(await connectionOf(db, org)) });
  }
  const next = ssoInput(input);
  if (!next || (!local(origin) && !next.issuer.startsWith("https://"))) return reply({ error: "Revisa el proveedor: nombre, emisor https, identificador de cliente, dominios de correo y rol." }, 400);
  if (!connection && !next.clientSecret) return reply({ error: "Escribe el secreto de cliente." }, 400);
  if ((connection?.version || 0) !== next.version) return reply({ error: "La configuración cambió. Recarga antes de guardar." }, 409);
  const secret = next.clientSecret ? await seal(db, new TextEncoder().encode(next.clientSecret)) : connection!.clientSecret, at = new Date().toISOString();
  // Any change of how to reach the provider needs a new test before it can be active again.
  const retest = !connection || connection.issuer !== next.issuer || connection.clientId !== next.clientId || !!next.clientSecret || connection.domains !== next.domains.join(",");
  await db.batch([
    db.prepare(`INSERT INTO sso_connections(organization_id,name,issuer,client_id,client_secret,domains,default_role,admin_group,status,tested_at,version,updated_at,updated_by) VALUES (?,?,?,?,?,?,?,?,'draft',NULL,1,?,?)
      ON CONFLICT(organization_id) DO UPDATE SET name=excluded.name,issuer=excluded.issuer,client_id=excluded.client_id,client_secret=excluded.client_secret,domains=excluded.domains,default_role=excluded.default_role,admin_group=excluded.admin_group,
      status=CASE WHEN ? THEN 'draft' ELSE sso_connections.status END,tested_at=CASE WHEN ? THEN NULL ELSE sso_connections.tested_at END,version=sso_connections.version+1,updated_at=excluded.updated_at,updated_by=excluded.updated_by`)
      .bind(org, next.name, next.issuer, next.clientId, secret, next.domains.join(","), next.defaultRole, next.adminGroup, at, current.id, retest ? 1 : 0, retest ? 1 : 0),
    securityEvent(db, { organizationId: org, type: "sso_changed", actorId: current.id, method: "sso", detail: `${connection ? "Cambió" : "Configuró"} el proveedor «${next.name}» (${next.domains.join(", ")})${retest ? "; necesita una prueba" : ""}`, client }),
  ]);
  return reply({ connection: view(await connectionOf(db, org)) }, connection ? 200 : 201);
}
export function ssoMethods(path: string): string[] | null {
  if (path === "/api/security/sso") return ["GET", "PUT", "DELETE"];
  if (path === "/api/security/sso/test" || path === "/api/security/sso/activate") return ["POST"];
  return null;
}
/** The organization whose active institutional provider covers an e-mail's domain. */
export async function organizationOfDomain(stores: { id: string; db: Database }[], email: string) {
  const domain = email.split("@")[1] || "";
  const found = await Promise.all(stores.map(({ db }) => db.prepare("SELECT domains FROM sso_connections WHERE status='active'").first<{ domains: string }>()));
  const index = found.findIndex(row => row?.domains.split(",").includes(domain));
  return index >= 0 ? stores[index].id : null;
}
