const encoder = new TextEncoder();
export async function digest(value: string): Promise<string> {
  return Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(value))), b => b.toString(16).padStart(2, "0")).join("");
}
export async function verifyPassword(password: string, salt: string, expected: string): Promise<boolean> {
  const key = await crypto.subtle.importKey("raw", encoder.encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt: encoder.encode(salt), iterations: 100000 }, key, 256);
  const actual = Array.from(new Uint8Array(bits), b => b.toString(16).padStart(2, "0")).join("");
  let difference = actual.length ^ expected.length;
  for (let i = 0; i < actual.length; i++) difference |= actual.charCodeAt(i) ^ (expected.charCodeAt(i) || 0);
  return difference === 0;
}
export function sessionToken(request: Request): string | null {
  return /(?:^|;\s*)hl_session=([do]_[a-f0-9]{64})(?:;|$)/.exec(request.headers.get("Cookie") || "")?.[1] || null;
}
export function newToken(): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(32)), b => b.toString(16).padStart(2, "0")).join("");
}
export function cookie(token: string, request: Request, remove = false): string {
  const secure = new URL(request.url).protocol === "https:" ? "; Secure" : "";
  return `hl_session=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${remove ? 0 : 28800}${secure}`;
}
