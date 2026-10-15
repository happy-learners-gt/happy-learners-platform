/**
 * Team accounts (ST-093). A username names the organization at sign-in, so it is unique across organizations:
 * 3 to 32 lowercase letters, digits, dots, hyphens or underscores, starting and ending with a letter or digit.
 */
export const usernamePattern = /^[a-z0-9][a-z0-9._-]{1,30}[a-z0-9]$/;
export const minPasswordLength = 12;
export const maxPasswordLength = 128;
/** Temporary passwords avoid characters that read alike (0/O, 1/l/I) so they can be dictated or copied by hand. */
export const temporaryAlphabet = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";

export type AccountRole = "admin" | "educator";
export function accountInput(value: unknown): { displayName: string; username: string; role: AccountRole } | null {
  if (!value || typeof value !== "object") return null;
  const { displayName, username, role } = value as Record<string, unknown>;
  if (typeof displayName !== "string" || typeof username !== "string" || (role !== "admin" && role !== "educator")) return null;
  const name = displayName.trim().replace(/\s+/g, " ").normalize("NFC"), user = username.trim().toLowerCase();
  if (name.length < 2 || name.length > 80 || /[<>\x00-\x1f]/.test(name) || !usernamePattern.test(user)) return null;
  return { displayName: name, username: user, role };
}

/** A password a person chooses: 12 to 128 characters, not their username, not the temporary one it replaces. */
export function acceptablePassword(password: unknown, username: string, previous?: string): password is string {
  return typeof password === "string" && password.length >= minPasswordLength && password.length <= maxPasswordLength
    && !password.toLowerCase().includes(username.toLowerCase()) && password !== previous && new Set(password).size >= 5;
}

/**
 * Turns random bytes into a temporary password of 16 characters in groups of four (about 93 bits).
 * Bytes that would bias the alphabet are skipped; it returns null when there are not enough left.
 */
export function temporaryPassword(bytes: Uint8Array): string | null {
  const limit = 256 - (256 % temporaryAlphabet.length);
  const chars = [...bytes].filter(byte => byte < limit).slice(0, 16).map(byte => temporaryAlphabet[byte % temporaryAlphabet.length]);
  return chars.length === 16 ? [0, 4, 8, 12].map(start => chars.slice(start, start + 4).join("")).join("-") : null;
}
