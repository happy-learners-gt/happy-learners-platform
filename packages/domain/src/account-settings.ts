/**
 * Account settings (ST-158): the sign-in e-mail with a verified change, open sessions and the sign-in history.
 * The domain holds the rules (lifetimes, states, what is shown of a device or a country) and the Spanish security
 * notices; the Worker stores hashes of the tokens, writes the outbox and decides who receives each notice.
 */
import { normalizeEmail, type MailMessage } from "./mail";

/** A change of e-mail waits 24 hours for the link sent to the new address; after that it reads as expired. */
export const emailChangeHours = 24;
export const emailChangeLifetimeMs = emailChangeHours * 60 * 60 * 1000;
/** The history shows the last 30 sign-ins, successful or not; older records are pruned after 90 days. */
export const signInHistoryLimit = 30;
export const signInRetentionDays = 90;
/** A session's last use is written at most once a minute: enough to tell sessions apart, cheap on every request. */
export const sessionTouchMs = 60_000;

export type EmailChangeStatus = "pending" | "verified" | "expired" | "cancelled";
/**
 * A change still marked pending after its expiry reads as expired; the others keep their status. `cancelled` covers the
 * person cancelling it and a newer request replacing it.
 */
export function emailChangeState(status: string, expiresAt: string, now: string): EmailChangeStatus {
  if (status === "pending") return expiresAt <= now ? "expired" : "pending";
  return status === "verified" || status === "cancelled" ? status : "expired";
}

/** {email, currentPassword}: a valid address different from the current one; the password is checked by the Worker. */
export function emailChangeInput(value: unknown, currentEmail: string | null): { email: string; currentPassword: string } | { error: "email" | "same" | "password" } {
  const raw = value && typeof value === "object" ? value as Record<string, unknown> : {};
  const email = normalizeEmail(raw.email);
  if (!email) return { error: "email" };
  if (email === currentEmail) return { error: "same" };
  if (typeof raw.currentPassword !== "string" || !raw.currentPassword || raw.currentPassword.length > 128) return { error: "password" };
  return { email, currentPassword: raw.currentPassword };
}

/** «p•••a@ejemplo.org»: enough to recognize one's own address in a notice without spelling it out. */
export function maskEmail(email: string): string {
  const at = email.lastIndexOf("@");
  if (at < 1) return "•••";
  const name = email.slice(0, at), domain = email.slice(at + 1);
  return `${name.length <= 2 ? name[0] : `${name[0]}•••${name[name.length - 1]}`}@${domain}`;
}

const browsers: [RegExp, string][] = [
  [/\bEdg(?:e|A|iOS)?\//, "Edge"], [/\bOPR\/|\bOpera\b/, "Opera"], [/\bSamsungBrowser\//, "Samsung Internet"], [/\bFirefox\/|\bFxiOS\//, "Firefox"],
  [/\bCriOS\/|\bChrome\/|\bChromium\/|\bHeadlessChrome\//, "Chrome"], [/\bVersion\/[\d.]+.*\bSafari\//, "Safari"],
];
const systems: [RegExp, string][] = [
  [/\biPad\b/, "iPad"], [/\biPhone\b/, "iPhone"], [/\bAndroid\b/, "Android"], [/\bCrOS\b/, "ChromeOS"], [/\bWindows\b/, "Windows"], [/\bMac OS X\b|\bMacintosh\b/, "macOS"], [/\bLinux\b/, "Linux"],
];
/**
 * What a session shows of the device: «Chrome en Windows». Only this summary is stored, never the User-Agent itself,
 * so a session or a sign-in carries no fingerprint beyond what the person needs to recognize it.
 */
export function deviceLabel(userAgent: string | null | undefined): string {
  const agent = (userAgent || "").slice(0, 512);
  const browser = browsers.find(([pattern]) => pattern.test(agent))?.[1], system = systems.find(([pattern]) => pattern.test(agent))?.[1];
  if (browser && system) return `${browser} en ${system}`;
  if (browser) return browser;
  if (system) return `Navegador en ${system}`;
  return "Navegador desconocido";
}

/** Cloudflare's CF-IPCountry: an ISO 3166-1 alpha-2 code; «XX» (unknown) and «T1» (Tor) are not countries. */
export function countryCode(header: string | null | undefined): string | null {
  const code = (header || "").trim().toUpperCase();
  return /^[A-Z]{2}$/.test(code) && code !== "XX" ? code : null;
}

/** The security notices of an account. They are mandatory: nobody can turn them off (ST-161). */
export type AccountNotice =
  | { kind: "email_verify"; username: string; link: string; expiresAt: string }
  | { kind: "email_change_requested"; username: string; newEmail: string }
  | { kind: "email_changed"; username: string; newEmail: string }
  | { kind: "password_changed"; username: string }
  | { kind: "closure_requested"; person: string; username: string; link: string }
  | { kind: "closure_started"; username: string };
export type AccountNoticeKind = AccountNotice["kind"];

const subjects: Record<AccountNoticeKind, string> = {
  email_verify: "Confirma tu nuevo correo de acceso", email_change_requested: "Se pidió cambiar el correo de tu cuenta", email_changed: "El correo de tu cuenta cambió",
  password_changed: "Tu contraseña cambió", closure_requested: "Una persona pidió cerrar su cuenta", closure_started: "Administración comenzó a cerrar tu cuenta",
};
const clip = (text: string, size: number) => text.length > size ? `${text.slice(0, size - 1)}…` : text;
/** The reason recorded in the outbox with each notice: one sentence, no secrets, at most 240 characters. */
export function accountNoticeReason(notice: AccountNotice): string {
  switch (notice.kind) {
    case "email_verify": return clip(`Confirmación del nuevo correo de acceso de @${notice.username}`, 240);
    case "email_change_requested": return clip(`Aviso al correo anterior: @${notice.username} pidió cambiar su correo de acceso a ${maskEmail(notice.newEmail)}`, 240);
    case "email_changed": return clip(`Aviso al correo anterior: el correo de acceso de @${notice.username} ahora es ${maskEmail(notice.newEmail)}`, 240);
    case "password_changed": return clip(`Aviso de seguridad: cambió la contraseña de @${notice.username}`, 240);
    case "closure_requested": return clip(`${clip(notice.person, 80)} (@${notice.username}) pidió cerrar su cuenta`, 240);
    case "closure_started": return clip(`Administración inició el cierre de la cuenta de @${notice.username}`, 240);
  }
}

const escape = (value: string) => value.replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]!);
function when(iso: string, timezone: string) {
  try { return new Intl.DateTimeFormat("es", { dateStyle: "long", timeStyle: "short", timeZone: timezone }).format(new Date(iso)); }
  catch { return `${new Intl.DateTimeFormat("es", { dateStyle: "long", timeStyle: "short", timeZone: "UTC" }).format(new Date(iso))} (UTC)`; }
}

export interface AccountNoticeDetails { organization: string; recipientName: string; timezone: string }
/**
 * The notice in Spanish, as plain text and simple HTML with the same content. Notices to the previous address never
 * spell out the new one, and none of them carries a password or a token other than the confirmation link itself.
 */
export function accountMessage(to: string, notice: AccountNotice, details: AccountNoticeDetails): MailMessage {
  const lines: string[] = [], action: { label: string; link: string } | null = notice.kind === "email_verify" ? { label: "Confirmar mi correo", link: notice.link } : notice.kind === "closure_requested" ? { label: "Ver la solicitud", link: notice.link } : null;
  const notMe = "Si no fuiste tú, cambia tu contraseña de inmediato y avisa a administración de tu organización.";
  switch (notice.kind) {
    case "email_verify":
      lines.push(`Pediste usar esta dirección como correo de acceso de tu cuenta @${notice.username} en ${details.organization}.`, "Para confirmarla, abre este enlace:");
      lines.push(notice.link, "", `El enlace caduca el ${when(notice.expiresAt, details.timezone)} y solo funciona una vez.`, "Si no lo pediste, ignora este correo: tu cuenta no cambiará.");
      break;
    case "email_change_requested":
      lines.push(`Se pidió cambiar el correo de acceso de tu cuenta @${notice.username} a ${maskEmail(notice.newEmail)}.`, "El cambio solo se hace cuando alguien confirma el enlace enviado a la nueva dirección.", notMe);
      break;
    case "email_changed":
      lines.push(`El correo de acceso de tu cuenta @${notice.username} ahora es ${maskEmail(notice.newEmail)}. Desde ahora los avisos llegan a esa dirección.`, notMe);
      break;
    case "password_changed":
      lines.push(`La contraseña de tu cuenta @${notice.username} cambió y se cerraron tus otras sesiones abiertas.`, notMe);
      break;
    case "closure_requested":
      lines.push(`${notice.person} (@${notice.username}) pidió cerrar su cuenta. Revisa la solicitud en Educadores y, cuando corresponda, registra su salida.`);
      break;
    case "closure_started":
      lines.push(`Administración inició el cierre de tu cuenta @${notice.username}. Al registrar tu salida ya no podrás entrar; lo que hiciste se conserva en la organización.`, "Si ya no quieres cerrarla, habla con administración.");
      break;
  }
  const footer = "Este es un aviso de seguridad de tu cuenta: se envía siempre y no se puede desactivar.";
  const text = [`Hola, ${details.recipientName}:`, "", ...lines, "", footer, `Happy Learners · ${details.organization}`].join("\n");
  const paragraphs = lines.filter(line => !action || line !== action.link).map(line => `<p>${escape(line)}</p>`).join("\n");
  const button = action ? `<p><a href="${escape(action.link)}" style="display:inline-block;padding:10px 16px;background:#0f6cbd;color:#ffffff;text-decoration:none;border-radius:4px">${escape(action.label)}</a></p>
<p>Si el botón no funciona, copia este enlace en tu navegador:<br><span style="word-break:break-all">${escape(action.link)}</span></p>` : "";
  const html = `<!doctype html><html lang="es"><body style="font-family:Segoe UI,Arial,sans-serif;color:#242424;line-height:1.5">
<p>Hola, ${escape(details.recipientName)}:</p>
${paragraphs}
${button}
<p style="color:#616161">${escape(footer)}</p>
<p style="color:#616161">Happy Learners · ${escape(details.organization)}</p>
</body></html>`;
  return { to, subject: `${subjects[notice.kind]} · ${clip(details.organization, 80)}`, text, html };
}
