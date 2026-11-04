import { acceptablePassword, maxPasswordLength, minPasswordLength } from "./accounts";

/**
 * The organization's access policy (REL-007): how long a password must be and whether it is checked against known
 * breaches (ST-134), whether the second factor is required by role (ST-133), how long a session lasts (ST-136) and
 * whether people may sign in with a link sent to their e-mail (ST-130). One per organization; these are the defaults.
 */
export interface AccessPolicy {
  minPasswordLength: number; breachedCheck: boolean; mfaAdmin: boolean; mfaEducator: boolean; sessionHours: number; linkSignIn: boolean;
  version: number; updatedAt: string | null;
}
export const defaultAccessPolicy: AccessPolicy = { minPasswordLength, breachedCheck: true, mfaAdmin: false, mfaEducator: false, sessionHours: 8, linkSignIn: true, version: 0, updatedAt: null };
export const policyLimits = { minPasswordLength: [12, 64], sessionHours: [1, 12] } as const;

/** What administration saves; null when a value is out of range. */
export function accessPolicyInput(value: unknown): Omit<AccessPolicy, "version" | "updatedAt"> & { version: number } | null {
  if (!value || typeof value !== "object") return null;
  const input = value as Record<string, unknown>;
  const integer = (key: keyof typeof policyLimits) => Number.isInteger(input[key]) && (input[key] as number) >= policyLimits[key][0] && (input[key] as number) <= policyLimits[key][1];
  const flags = ["breachedCheck", "mfaAdmin", "mfaEducator", "linkSignIn"] as const;
  if (!integer("minPasswordLength") || !integer("sessionHours") || flags.some(key => typeof input[key] !== "boolean") || !Number.isInteger(input.version)) return null;
  return {
    minPasswordLength: input.minPasswordLength as number, sessionHours: input.sessionHours as number, breachedCheck: input.breachedCheck as boolean,
    mfaAdmin: input.mfaAdmin as boolean, mfaEducator: input.mfaEducator as boolean, linkSignIn: input.linkSignIn as boolean, version: input.version as number,
  };
}

/**
 * Passwords that appear at the top of every leaked list, at 12 characters or more, plus the obvious ones for this
 * platform. The breach check (Have I Been Pwned, k-anonymity) covers the rest when the policy turns it on.
 */
const common = new Set([
  "123456789012", "1234567890123", "12345678901234", "123456789abc", "1q2w3e4r5t6y", "qwertyuiop12", "qwertyuiop123", "qwerty123456", "1qaz2wsx3edc",
  "password1234", "password12345", "passwordpassword", "iloveyou1234", "abc123456789", "aaaaaaaaaaaa", "contraseña123", "contrasena123", "contraseña1234",
  "contrasena1234", "micontraseña", "micontrasena123", "happylearners", "happylearners1", "happylearners2026",
  "guatemala2026", "guatemala1234", "bienvenido123", "bienvenido1234", "administrador", "administrador1", "educador2026", "profesor12345",
]);
/** Why a password is not acceptable under the policy, or null. The breach check runs apart, in the Worker. */
export function passwordProblem(password: unknown, username: string, policy: Pick<AccessPolicy, "minPasswordLength">, previous?: string): "length" | "weak" | "common" | null {
  if (typeof password !== "string" || password.length < Math.max(minPasswordLength, policy.minPasswordLength) || password.length > maxPasswordLength) return "length";
  if (!acceptablePassword(password, username, previous)) return "weak";
  const plain = password.toLowerCase().normalize("NFC");
  if (common.has(plain) || /^(.)\1+$/.test(plain) || "01234567890123456789".includes(plain) || "abcdefghijklmnopqrstuvwxyz".includes(plain)) return "common";
  return null;
}
export const passwordMessage = (problem: "length" | "weak" | "common" | "breached", minimum: number) => ({
  length: `Usa de ${Math.max(minPasswordLength, minimum)} a ${maxPasswordLength} caracteres. Una frase que recuerdes funciona bien.`,
  weak: "Usa caracteres variados, distintos de tu usuario y de tu contraseña anterior.",
  common: "Esa contraseña es de las más usadas y se adivina fácil. Elige otra.",
  breached: "Esa contraseña apareció en filtraciones de datos conocidas. Elige otra que no hayas usado en otros sitios.",
})[problem];

/** ST-134: a recovery link works once, for 30 minutes. ST-130: a sign-in link, once, for 15 minutes. */
export const recoveryLifetimeMs = 30 * 60 * 1000;
export const signInLinkLifetimeMs = 15 * 60 * 1000;
/** The answer to any request for a link, whether or not the account exists (ST-130 CA2). */
export const linkRequestedMessage = "Si la cuenta existe y tiene un correo de acceso confirmado, te enviamos un enlace. Revisa tu bandeja de entrada y la de correo no deseado.";
/** A username or a sign-in e-mail, as typed on the sign-in page. */
export function identifierInput(value: unknown): { username: string } | { email: string } | null {
  const raw = value && typeof value === "object" ? (value as Record<string, unknown>).identifier : null;
  if (typeof raw !== "string") return null;
  const text = raw.trim().toLowerCase();
  if (text.length < 3 || text.length > 254) return null;
  if (text.includes("@")) return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(text) ? { email: text } : null;
  return /^[a-z0-9][a-z0-9._-]{1,30}[a-z0-9]$/.test(text) ? { username: text } : null;
}
