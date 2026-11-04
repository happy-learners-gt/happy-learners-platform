/**
 * ST-133: the second factor with an authenticator app (TOTP, RFC 6238: HMAC-SHA1, 30-second steps, 6 digits) and the
 * recovery codes. A code is accepted for the current step and the one before or after it (clock drift), and never for
 * a step at or before the last one used, so a code cannot be replayed. Checked against the RFC's test vectors.
 */
export const totpPeriod = 30;
export const totpDigits = 6;
export const recoveryCodeCount = 10;
/** A second-factor step after the password lasts 5 minutes and allows 5 wrong codes. */
export const mfaChallengeMs = 5 * 60 * 1000;
export const mfaAttempts = 5;

const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
export function base32(bytes: Uint8Array): string {
  let bits = 0, value = 0, out = "";
  for (const byte of bytes) { value = (value << 8) | byte; bits += 8; while (bits >= 5) { out += alphabet[(value >>> (bits - 5)) & 31]; bits -= 5; } }
  if (bits > 0) out += alphabet[(value << (5 - bits)) & 31];
  return out;
}
export function fromBase32(text: string): Uint8Array | null {
  const clean = text.replace(/[\s=-]/g, "").toUpperCase();
  if (!/^[A-Z2-7]+$/.test(clean)) return null;
  let bits = 0, value = 0; const out: number[] = [];
  for (const char of clean) { value = (value << 5) | alphabet.indexOf(char); bits += 5; if (bits >= 8) { out.push((value >>> (bits - 8)) & 255); bits -= 8; } }
  return Uint8Array.from(out);
}

/** The code of one time step. */
export async function totpAt(secret: Uint8Array, step: number, digits = totpDigits): Promise<string> {
  const counter = new Uint8Array(8);
  new DataView(counter.buffer).setUint32(0, Math.floor(step / 0x100000000)); new DataView(counter.buffer).setUint32(4, step >>> 0);
  const key = await crypto.subtle.importKey("raw", secret as BufferSource, { name: "HMAC", hash: "SHA-1" }, false, ["sign"]);
  const mac = new Uint8Array(await crypto.subtle.sign("HMAC", key, counter));
  const offset = mac[mac.length - 1] & 15;
  const number = ((mac[offset] & 127) << 24) | (mac[offset + 1] << 16) | (mac[offset + 2] << 8) | mac[offset + 3];
  return String(number % 10 ** digits).padStart(digits, "0");
}
export const stepOf = (ms: number) => Math.floor(ms / 1000 / totpPeriod);
/** The step a typed code matches (current ±1), newer than the last one used; null when it does not match. */
export async function matchTotp(secret: Uint8Array, code: unknown, lastStep: number, now = Date.now()): Promise<number | null> {
  if (typeof code !== "string") return null;
  const typed = code.replace(/\s/g, "");
  if (!/^\d{6}$/.test(typed)) return null;
  const current = stepOf(now);
  for (const step of [current, current - 1, current + 1]) if (step > lastStep && await totpAt(secret, step) === typed) return step;
  return null;
}
/** What an authenticator app reads (as a link or typed by hand): the issuer, the account and the key. */
export function otpauthUri(secretBase32: string, account: string, issuer = "Happy Learners") {
  const label = encodeURIComponent(`${issuer}:${account}`);
  return `otpauth://totp/${label}?secret=${secretBase32}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=${totpDigits}&period=${totpPeriod}`;
}
/** The key in groups of four, to type it by hand. */
export const groupedKey = (secretBase32: string) => secretBase32.match(/.{1,4}/g)!.join(" ");

/** A recovery code: 10 characters without look-alikes, in two groups (about 50 bits). Bytes that would bias are skipped. */
const codeAlphabet = "abcdefghjkmnpqrstuvwxyz23456789";
export function recoveryCode(bytes: Uint8Array): string | null {
  const limit = 256 - (256 % codeAlphabet.length);
  const chars = [...bytes].filter(byte => byte < limit).slice(0, 10).map(byte => codeAlphabet[byte % codeAlphabet.length]);
  return chars.length === 10 ? `${chars.slice(0, 5).join("")}-${chars.slice(5).join("")}` : null;
}
/** A recovery code as typed: lowercase, without spaces; the hyphen optional. */
export function recoveryCodeInput(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const clean = value.toLowerCase().replace(/[\s-]/g, "");
  return /^[a-hjkmnp-z2-9]{10}$/.test(clean) ? `${clean.slice(0, 5)}-${clean.slice(5)}` : null;
}
