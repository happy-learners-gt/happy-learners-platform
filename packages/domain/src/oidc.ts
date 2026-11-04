import { fromBase64Url, toBase64Url } from "./webauthn";

/**
 * ST-129, ST-131, ST-138: OpenID Connect without a library: the authorization code flow with PKCE (S256), a state and
 * a nonce of one use, and the ID token checked here (signature RS256 or ES256 with the provider's keys, issuer,
 * audience, expiry, nonce). The provider's answer is trusted only after every check.
 */
export type ProviderKey = "google" | "microsoft" | "apple" | "sso";
export const providerNames: Record<ProviderKey, string> = { google: "Google", microsoft: "Microsoft", apple: "Apple", sso: "Proveedor institucional" };
export const oidcStateMs = 10 * 60 * 1000;

/** PKCE (RFC 7636): the verifier stays in the Worker; the challenge travels to the provider. */
export async function pkceChallenge(verifier: string) {
  return toBase64Url(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier))));
}

export interface IdClaims { iss: string; aud: string | string[]; sub: string; exp: number; iat?: number; nonce?: string; email?: string; email_verified?: boolean | string; tid?: string; preferred_username?: string; name?: string; groups?: string[] }
type Jwk = JsonWebKey & { kid?: string; alg?: string; use?: string };
const json = <T>(part: string): T | null => { const bytes = fromBase64Url(part); if (!bytes) return null; try { return JSON.parse(new TextDecoder().decode(bytes)) as T; } catch { return null; } };

export type TokenProblem = "format" | "algorithm" | "key" | "signature" | "issuer" | "audience" | "expired" | "nonce";
/**
 * Checks an ID token against the provider's keys and what this sign-in expects. `issuer` is an exact value or, for
 * Microsoft's common endpoint, a function of the token's tenant.
 */
export async function verifyIdToken(token: unknown, keys: Jwk[], expected: { issuer: string | ((claims: IdClaims) => boolean); audience: string; nonce: string; now?: number }): Promise<IdClaims | { problem: TokenProblem }> {
  if (typeof token !== "string" || token.length > 16000) return { problem: "format" };
  const parts = token.split(".");
  if (parts.length !== 3) return { problem: "format" };
  const header = json<{ alg?: string; kid?: string }>(parts[0]), claims = json<IdClaims>(parts[1]), signature = fromBase64Url(parts[2]);
  if (!header || !claims || !signature) return { problem: "format" };
  if (header.alg !== "RS256" && header.alg !== "ES256") return { problem: "algorithm" };
  const jwk = keys.find(key => (!header.kid || key.kid === header.kid) && (key.kty === (header.alg === "RS256" ? "RSA" : "EC")) && (!key.use || key.use === "sig"));
  if (!jwk) return { problem: "key" };
  let key: CryptoKey;
  try {
    const { kid: _, alg: __, use: ___, key_ops: ____, ...material } = jwk;
    key = await crypto.subtle.importKey("jwk", material, header.alg === "RS256" ? { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" } : { name: "ECDSA", namedCurve: "P-256" }, false, ["verify"]);
  } catch { return { problem: "key" }; }
  const valid = await crypto.subtle.verify(header.alg === "RS256" ? { name: "RSASSA-PKCS1-v1_5" } : { name: "ECDSA", hash: "SHA-256" }, key, signature as BufferSource, new TextEncoder().encode(`${parts[0]}.${parts[1]}`));
  if (!valid) return { problem: "signature" };
  if (typeof claims.iss !== "string" || !(typeof expected.issuer === "string" ? claims.iss === expected.issuer : expected.issuer(claims))) return { problem: "issuer" };
  const audiences = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
  if (!audiences.includes(expected.audience)) return { problem: "audience" };
  const now = Math.floor((expected.now ?? Date.now()) / 1000);
  if (typeof claims.exp !== "number" || claims.exp + 60 < now || (typeof claims.iat === "number" && claims.iat - 300 > now)) return { problem: "expired" };
  if (claims.nonce !== expected.nonce) return { problem: "nonce" };
  if (typeof claims.sub !== "string" || !claims.sub || claims.sub.length > 255) return { problem: "format" };
  return claims;
}
export const tokenMessage: Record<TokenProblem, string> = {
  format: "La respuesta del proveedor no es válida.", algorithm: "El proveedor firmó con un algoritmo que no aceptamos.", key: "No encontramos la clave con la que firmó el proveedor.",
  signature: "La firma del proveedor no es válida.", issuer: "La respuesta es de otro emisor.", audience: "La respuesta es para otra aplicación.", expired: "La respuesta del proveedor caducó.",
  nonce: "La respuesta no corresponde a este inicio de sesión.",
};
/** The e-mail of the claims, when the provider says it is verified (Entra ID does not send email_verified). */
export function verifiedEmail(claims: IdClaims, trustUnflagged = false): string | null {
  const email = (claims.email || (trustUnflagged ? claims.preferred_username : undefined))?.trim().toLowerCase();
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return null;
  const flag = claims.email_verified;
  return flag === true || flag === "true" || (trustUnflagged && flag === undefined) ? email : null;
}

/** What administration saves for the institution's provider; null when a value is not valid. */
export interface SsoInput { name: string; issuer: string; clientId: string; clientSecret: string | null; domains: string[]; defaultRole: "educator" | "admin"; adminGroup: string | null; version: number }
export function ssoInput(value: unknown): SsoInput | null {
  if (!value || typeof value !== "object") return null;
  const input = value as Record<string, unknown>;
  const text = (key: string, max: number) => typeof input[key] === "string" ? (input[key] as string).trim() : "";
  const name = text("name", 80), issuer = text("issuer", 300).replace(/\/+$/, ""), clientId = text("clientId", 255), secret = text("clientSecret", 2000), group = text("adminGroup", 255);
  const domains = Array.isArray(input.domains) ? [...new Set(input.domains.map(item => String(item).trim().toLowerCase()))].filter(Boolean) : [];
  if (name.length < 2 || name.length > 80 || !/^(https:\/\/[a-z0-9.-]+(:\d+)?|http:\/\/127\.0\.0\.1:\d+)(\/[A-Za-z0-9._~\/-]*)?$/.test(issuer) || issuer.length > 300) return null;
  if (!clientId || clientId.length > 255 || secret.length > 2000 || group.length > 255 || !Number.isInteger(input.version)) return null;
  if (!domains.length || domains.length > 10 || domains.some(domain => !/^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(domain))) return null;
  if (input.defaultRole !== "educator" && input.defaultRole !== "admin") return null;
  return { name, issuer, clientId, clientSecret: secret || null, domains, defaultRole: input.defaultRole, adminGroup: group || null, version: input.version as number };
}
