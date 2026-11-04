/**
 * ST-132: passkeys (WebAuthn Level 2) without a library: the CBOR the authenticator sends, its COSE public key (ES256
 * or RS256), the authenticator data and the signature, on Web Crypto. Registration takes attestation "none" (the key
 * proves possession; no device certificate is checked). Every check that matters for security is here: type,
 * challenge, origin, relying party, user presence and verification (a passkey counts as both factors, ST-133), the
 * signature and the counter that reveals a cloned authenticator.
 */
export const passkeyTimeoutMs = 5 * 60 * 1000;
export const maxPasskeys = 10;

export const toBase64Url = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes)).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
export function fromBase64Url(text: unknown): Uint8Array | null {
  if (typeof text !== "string" || !/^[A-Za-z0-9_-]*$/.test(text) || text.length > 20000) return null;
  try { return Uint8Array.from(atob(text.replaceAll("-", "+").replaceAll("_", "/") + "=".repeat((4 - text.length % 4) % 4)), char => char.charCodeAt(0)); } catch { return null; }
}

type Cbor = number | bigint | string | Uint8Array | boolean | null | undefined | Cbor[] | Map<Cbor, Cbor>;
/** Decodes one CBOR item (RFC 8949): integers, byte and text strings, arrays, maps and simple values; no tags or floats. */
export function decodeCbor(data: Uint8Array, start = 0): { value: Cbor; end: number } {
  let offset = start;
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const length = (info: number): number => {
    if (info < 24) return info;
    if (info === 24) return data[offset++];
    if (info === 25) { const value = view.getUint16(offset); offset += 2; return value; }
    if (info === 26) { const value = view.getUint32(offset); offset += 4; return value; }
    if (info === 27) { const high = view.getUint32(offset), low = view.getUint32(offset + 4); offset += 8; if (high > 0x1fffff) throw new Error("CBOR integer too large"); return high * 0x100000000 + low; }
    throw new Error("CBOR indefinite length");
  };
  const item = (depth: number): Cbor => {
    if (depth > 16 || offset >= data.length) throw new Error("CBOR too deep or short");
    const head = data[offset++], major = head >> 5, info = head & 31;
    if (major === 7) { if (info === 20) return false; if (info === 21) return true; if (info === 22) return null; if (info === 23) return undefined; throw new Error("CBOR simple value"); }
    const size = length(info);
    switch (major) {
      case 0: return size;
      case 1: return -1 - size;
      case 2: { if (offset + size > data.length) throw new Error("CBOR short"); const out = data.slice(offset, offset + size); offset += size; return out; }
      case 3: { if (offset + size > data.length) throw new Error("CBOR short"); const out = new TextDecoder("utf-8", { fatal: true, ignoreBOM: false }).decode(data.subarray(offset, offset + size)); offset += size; return out; }
      case 4: { if (size > 1000) throw new Error("CBOR array too long"); const out: Cbor[] = []; for (let i = 0; i < size; i++) out.push(item(depth + 1)); return out; }
      case 5: { if (size > 1000) throw new Error("CBOR map too long"); const out = new Map<Cbor, Cbor>(); for (let i = 0; i < size; i++) { const key = item(depth + 1); out.set(key, item(depth + 1)); } return out; }
      default: throw new Error("CBOR tag");
    }
  };
  const value = item(0);
  return { value, end: offset };
}

export interface AuthenticatorData { rpIdHash: Uint8Array; userPresent: boolean; userVerified: boolean; backedUp: boolean; counter: number; credentialId?: Uint8Array; publicKey?: Uint8Array }
/** The authenticator data (WebAuthn §6.1), with the attested credential when there is one. */
export function parseAuthenticatorData(data: Uint8Array): AuthenticatorData {
  if (data.length < 37) throw new Error("Authenticator data too short");
  const flags = data[32], view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const parsed: AuthenticatorData = { rpIdHash: data.slice(0, 32), userPresent: !!(flags & 1), userVerified: !!(flags & 4), backedUp: !!(flags & 16), counter: view.getUint32(33) };
  if (flags & 64) {
    if (data.length < 55) throw new Error("Attested data too short");
    const idLength = view.getUint16(53);
    if (idLength < 16 || idLength > 1023 || data.length < 55 + idLength) throw new Error("Credential id length");
    parsed.credentialId = data.slice(55, 55 + idLength);
    const key = decodeCbor(data, 55 + idLength);
    parsed.publicKey = data.slice(55 + idLength, key.end);
  }
  return parsed;
}

/** The Web Crypto key of a COSE public key: ES256 (P-256) or RS256 (RSA, at least 2048 bits). */
export async function importCoseKey(cose: Uint8Array): Promise<{ key: CryptoKey; algorithm: -7 | -257 }> {
  const map = decodeCbor(cose).value;
  if (!(map instanceof Map)) throw new Error("COSE key");
  const alg = map.get(3), kty = map.get(1);
  if (alg === -7 && kty === 2 && map.get(-1) === 1) {
    const x = map.get(-2), y = map.get(-3);
    if (!(x instanceof Uint8Array) || !(y instanceof Uint8Array) || x.length !== 32 || y.length !== 32) throw new Error("EC2 key");
    const raw = new Uint8Array(65); raw[0] = 4; raw.set(x, 1); raw.set(y, 33);
    return { key: await crypto.subtle.importKey("raw", raw, { name: "ECDSA", namedCurve: "P-256" }, false, ["verify"]), algorithm: -7 };
  }
  if (alg === -257 && kty === 3) {
    const n = map.get(-1), e = map.get(-2);
    if (!(n instanceof Uint8Array) || !(e instanceof Uint8Array) || n.length < 256) throw new Error("RSA key");
    const jwk = { kty: "RSA", n: toBase64Url(n.subarray(n[0] === 0 ? 1 : 0)), e: toBase64Url(e), alg: "RS256", ext: true };
    return { key: await crypto.subtle.importKey("jwk", jwk, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"]), algorithm: -257 };
  }
  throw new Error("Unsupported COSE algorithm");
}

/** An ECDSA signature in DER (as authenticators send it) as the r‖s Web Crypto verifies. */
export function derToRaw(der: Uint8Array): Uint8Array | null {
  if (der[0] !== 0x30) return null;
  let offset = 2; if (der[1] & 0x80) offset += der[1] & 0x7f;
  const part = (): Uint8Array | null => {
    if (der[offset] !== 0x02) return null;
    const size = der[offset + 1]; let value = der.slice(offset + 2, offset + 2 + size); offset += 2 + size;
    while (value.length > 32 && value[0] === 0) value = value.slice(1);
    if (value.length > 32) return null;
    const out = new Uint8Array(32); out.set(value, 32 - value.length); return out;
  };
  const r = part(), s = part();
  if (!r || !s) return null;
  const raw = new Uint8Array(64); raw.set(r); raw.set(s, 32); return raw;
}

const sha256 = async (data: Uint8Array) => new Uint8Array(await crypto.subtle.digest("SHA-256", data as BufferSource));
const same = (a: Uint8Array, b: Uint8Array) => a.length === b.length && a.every((value, index) => value === b[index]);
interface ClientData { type: string; challenge: string; origin: string; crossOrigin?: boolean }
function clientData(bytes: Uint8Array): ClientData | null {
  try { const value = JSON.parse(new TextDecoder().decode(bytes)) as ClientData; return typeof value.type === "string" && typeof value.challenge === "string" && typeof value.origin === "string" ? value : null; } catch { return null; }
}
/** The challenge a browser signed, as text: the server sends the ticket of the ceremony as UTF-8 bytes. */
export function signedChallenge(clientDataJSON: unknown): string | null {
  const bytes = fromBase64Url(clientDataJSON), data = bytes && clientData(bytes), challenge = data && fromBase64Url(data.challenge);
  return challenge ? new TextDecoder().decode(challenge) : null;
}
export type PasskeyProblem = "format" | "type" | "challenge" | "origin" | "rp" | "presence" | "verification" | "algorithm" | "signature" | "counter";
interface Expected { challenge: string; origin: string; rpId: string }

/** Registration: the new credential, or why it is refused. */
export async function verifyRegistration(response: { clientDataJSON?: unknown; attestationObject?: unknown }, expected: Expected): Promise<{ id: string; publicKey: string; counter: number; backedUp: boolean } | { problem: PasskeyProblem }> {
  const clientBytes = fromBase64Url(response.clientDataJSON), attestation = fromBase64Url(response.attestationObject);
  if (!clientBytes || !attestation) return { problem: "format" };
  const data = clientData(clientBytes);
  if (!data) return { problem: "format" };
  if (data.type !== "webauthn.create") return { problem: "type" };
  if (signedChallenge(response.clientDataJSON) !== expected.challenge) return { problem: "challenge" };
  if (data.origin !== expected.origin || data.crossOrigin) return { problem: "origin" };
  let auth: AuthenticatorData;
  try {
    const object = decodeCbor(attestation).value;
    if (!(object instanceof Map) || !(object.get("authData") instanceof Uint8Array)) return { problem: "format" };
    auth = parseAuthenticatorData(object.get("authData") as Uint8Array);
  } catch { return { problem: "format" }; }
  if (!same(auth.rpIdHash, await sha256(new TextEncoder().encode(expected.rpId)))) return { problem: "rp" };
  if (!auth.userPresent) return { problem: "presence" };
  if (!auth.userVerified) return { problem: "verification" };
  if (!auth.credentialId || !auth.publicKey) return { problem: "format" };
  try { await importCoseKey(auth.publicKey); } catch { return { problem: "algorithm" }; }
  return { id: toBase64Url(auth.credentialId), publicKey: toBase64Url(auth.publicKey), counter: auth.counter, backedUp: auth.backedUp };
}

/** Sign-in: whether the assertion is valid for the stored key, with the new counter. */
export async function verifyAssertion(response: { clientDataJSON?: unknown; authenticatorData?: unknown; signature?: unknown }, stored: { publicKey: string; counter: number }, expected: Expected): Promise<{ counter: number; backedUp: boolean } | { problem: PasskeyProblem }> {
  const clientBytes = fromBase64Url(response.clientDataJSON), authBytes = fromBase64Url(response.authenticatorData), signature = fromBase64Url(response.signature), cose = fromBase64Url(stored.publicKey);
  if (!clientBytes || !authBytes || !signature || !cose) return { problem: "format" };
  const data = clientData(clientBytes);
  if (!data) return { problem: "format" };
  if (data.type !== "webauthn.get") return { problem: "type" };
  if (signedChallenge(response.clientDataJSON) !== expected.challenge) return { problem: "challenge" };
  if (data.origin !== expected.origin || data.crossOrigin) return { problem: "origin" };
  let auth: AuthenticatorData;
  try { auth = parseAuthenticatorData(authBytes); } catch { return { problem: "format" }; }
  if (!same(auth.rpIdHash, await sha256(new TextEncoder().encode(expected.rpId)))) return { problem: "rp" };
  if (!auth.userPresent) return { problem: "presence" };
  if (!auth.userVerified) return { problem: "verification" };
  let key: { key: CryptoKey; algorithm: -7 | -257 };
  try { key = await importCoseKey(cose); } catch { return { problem: "algorithm" }; }
  const signed = new Uint8Array(authBytes.length + 32); signed.set(authBytes); signed.set(await sha256(clientBytes), authBytes.length);
  const sig = key.algorithm === -7 ? derToRaw(signature) : signature;
  if (!sig) return { problem: "signature" };
  const valid = await crypto.subtle.verify(key.algorithm === -7 ? { name: "ECDSA", hash: "SHA-256" } : { name: "RSASSA-PKCS1-v1_5" }, key.key, sig as BufferSource, signed as BufferSource);
  if (!valid) return { problem: "signature" };
  // A counter that does not move forward means a copy of the authenticator; authenticators that never count send 0.
  if ((auth.counter !== 0 || stored.counter !== 0) && auth.counter <= stored.counter) return { problem: "counter" };
  return { counter: auth.counter, backedUp: auth.backedUp };
}
export const passkeyMessage: Record<PasskeyProblem, string> = {
  format: "La respuesta de la passkey no es válida. Vuelve a intentar.", type: "La respuesta de la passkey no corresponde a este paso.",
  challenge: "La solicitud caducó o ya se usó. Vuelve a intentar.", origin: "La passkey respondió para otro sitio.", rp: "La passkey es de otro sitio.",
  presence: "Confirma en tu dispositivo que eres tú.", verification: "Tu dispositivo debe verificarte (huella, rostro o PIN) para usar una passkey.",
  algorithm: "Tu dispositivo usa un tipo de clave que no admitimos todavía.", signature: "La firma de la passkey no es válida.",
  counter: "Esta passkey parece copiada en otro dispositivo. Por seguridad no se aceptó; avisa a administración.",
};
