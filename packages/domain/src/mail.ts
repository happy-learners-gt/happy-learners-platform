/**
 * Transactional mail (DEC-042, ST-121). The domain only describes the port and builds the messages; the Worker
 * provides the adapters (Brevo's HTTP API, or a disabled sender when it is not configured).
 */
import type { AccountRole } from "./accounts";

export interface MailMessage { to: string; subject: string; text: string; html: string }
/** `retry` says whether trying again may help (network, 429, 5xx); `error` never carries credentials. */
export type MailResult = { ok: true; id: string } | { ok: false; error: string; retry: boolean };
/** The sending port: one message to one recipient. Adapters never throw; they answer with a result. */
export interface MailSender { readonly configured: boolean; send(message: MailMessage): Promise<MailResult> }

/** The provider's free plan allows 300 messages a day; each organization stays below it (DEC-042). */
export const dailyMailCap = 250;
/** A message is tried at most this many times while the request waits (one retry). */
export const mailAttempts = 2;
export const invitationDays = 7;
export const invitationLifetimeMs = invitationDays * 24 * 60 * 60 * 1000;

export type MailStatus = "queued" | "sent" | "failed" | "not_configured" | "deferred";
/** What happens to the next message: no provider, over today's cap, or send it. */
export function mailDecision(configured: boolean, sentToday: number, cap = dailyMailCap): "send" | "deferred" | "not_configured" {
  if (!configured) return "not_configured";
  return sentToday >= cap ? "deferred" : "send";
}

/** An address in a plain, common form; lowercase, at most 254 characters. */
export const emailPattern = /^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/;
export function normalizeEmail(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const email = value.trim().toLowerCase();
  return email.length <= 254 && emailPattern.test(email) && !email.includes("..") ? email : null;
}

export function invitationInput(value: unknown): { email: string; displayName: string; role: AccountRole } | null {
  if (!value || typeof value !== "object") return null;
  const { email, displayName, role } = value as Record<string, unknown>;
  const address = normalizeEmail(email);
  if (!address || typeof displayName !== "string" || (role !== "admin" && role !== "educator")) return null;
  const name = displayName.trim().replace(/\s+/g, " ").normalize("NFC");
  if (name.length < 2 || name.length > 80 || /[<>\x00-\x1f]/.test(name)) return null;
  return { email: address, displayName: name, role };
}

/** An invitation still marked pending after its expiry reads as expired; the others keep their status. */
export function invitationState(status: string, expiresAt: string, now: string): "pending" | "accepted" | "revoked" | "expired" {
  if (status === "pending") return expiresAt <= now ? "expired" : "pending";
  return status === "accepted" || status === "revoked" ? status : "expired";
}

export const roleLabel = (role: AccountRole) => role === "admin" ? "Administración" : "Educador";
const escape = (value: string) => value.replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]!);

export interface InvitationDetails { organization: string; displayName: string; role: AccountRole; inviter: string; link: string; expiresAt: string; timezone: string }
/** The invitation e-mail, in Spanish: plain text and a simple HTML version with the same content. */
export function invitationMessage(to: string, details: InvitationDetails): MailMessage {
  const role = roleLabel(details.role);
  let expires: string;
  try { expires = new Intl.DateTimeFormat("es", { dateStyle: "long", timeStyle: "short", timeZone: details.timezone }).format(new Date(details.expiresAt)); }
  catch { expires = new Intl.DateTimeFormat("es", { dateStyle: "long", timeStyle: "short", timeZone: "UTC" }).format(new Date(details.expiresAt)) + " (UTC)"; }
  const subject = "Te invitaron a Acervum";
  const text = [
    `Hola, ${details.displayName}:`,
    "",
    `${details.inviter} te invitó a unirte a ${details.organization} en Acervum con el rol ${role}.`,
    "",
    "Para aceptar, abre este enlace y elige tu usuario y contraseña:",
    details.link,
    "",
    `El enlace caduca el ${expires}. Solo funciona una vez.`,
    "",
    "Si no esperabas esta invitación, ignora este correo: no se creará ninguna cuenta.",
  ].join("\n");
  const html = `<!doctype html><html lang="es"><body style="font-family:Segoe UI,Arial,sans-serif;color:#242424;line-height:1.5">
<p>Hola, ${escape(details.displayName)}:</p>
<p>${escape(details.inviter)} te invitó a unirte a <strong>${escape(details.organization)}</strong> en Acervum con el rol <strong>${escape(role)}</strong>.</p>
<p><a href="${escape(details.link)}" style="display:inline-block;padding:10px 16px;background:#0f6cbd;color:#ffffff;text-decoration:none;border-radius:4px">Aceptar la invitación</a></p>
<p>Si el botón no funciona, copia este enlace en tu navegador:<br><span style="word-break:break-all">${escape(details.link)}</span></p>
<p>El enlace caduca el ${escape(expires)}. Solo funciona una vez.</p>
<p style="color:#616161">Si no esperabas esta invitación, ignora este correo: no se creará ninguna cuenta.</p>
</body></html>`;
  return { to, subject, text, html };
}
