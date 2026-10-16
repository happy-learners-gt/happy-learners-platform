import type { MailMessage, MailResult, MailSender, MailStatus } from "@happy-learners/domain";
import { dailyMailCap, mailAttempts, mailDecision } from "@happy-learners/domain";

/**
 * Adapters of the mail port (DEC-042). Real sending needs the Worker secret BREVO_API_KEY and the variable MAIL_FROM
 * (an address verified as a sender in Brevo); without both, messages stay in the outbox as `not_configured` and
 * administration shares the link by hand. Local development and the tests run without them.
 */
declare global { interface Env { BREVO_API_KEY?: string; MAIL_FROM?: string } }

export const brevoEndpoint = "https://api.brevo.com/v3/smtp/email";
export const senderName = "Happy Learners";

/** Keeps an error short and free of the key, of anything that looks like a key or token, and of the recipient. */
export function sanitize(text: string, secrets: (string | undefined)[] = []): string {
  let clean = text;
  for (const secret of secrets) if (secret && secret.length >= 4) clean = clean.split(secret).join("[oculto]");
  return clean.replace(/xkeysib-[A-Za-z0-9-]+/g, "[oculto]").replace(/[a-z]_[a-f0-9]{64}/g, "[oculto]").replace(/[^\s@"']+@[^\s@"']+/g, "[correo]").replace(/[\x00-\x1f]+/g, " ").slice(0, 240);
}

/** Brevo's transactional e-mail API over HTTPS. Non-2xx answers are failures; 429 and 5xx may be retried. */
export class BrevoMailSender implements MailSender {
  readonly configured = true;
  constructor(private apiKey: string, private from: string, private fetcher: typeof fetch = (input, init) => fetch(input, init)) {}
  async send(message: MailMessage): Promise<MailResult> {
    try {
      const response = await this.fetcher(brevoEndpoint, {
        method: "POST", signal: AbortSignal.timeout(10000),
        headers: { "api-key": this.apiKey, "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ sender: { name: senderName, email: this.from }, to: [{ email: message.to }], subject: message.subject, textContent: message.text, htmlContent: message.html }),
      });
      let detail: Record<string, unknown> = {};
      try { detail = await response.json() as Record<string, unknown>; } catch { /* Empty or non-JSON body. */ }
      if (response.ok) return { ok: true, id: typeof detail.messageId === "string" ? detail.messageId.slice(0, 200) : "" };
      const code = typeof detail.code === "string" ? ` ${detail.code}` : "";
      return { ok: false, retry: response.status === 429 || response.status >= 500, error: sanitize(`Brevo respondió ${response.status}${code}`, [this.apiKey, message.to]) };
    } catch (error) {
      const name = error instanceof Error ? error.name : "Error";
      return { ok: false, retry: true, error: sanitize(`No se pudo conectar con Brevo (${name})`, [this.apiKey, message.to]) };
    }
  }
}

/** Used when the Worker has no provider configured: nothing leaves, the outbox records `not_configured`. */
export class DisabledMailSender implements MailSender {
  readonly configured = false;
  async send(): Promise<MailResult> { return { ok: false, retry: false, error: "El envío de correo no está configurado." }; }
}

export function mailSender(env: Pick<Env, "BREVO_API_KEY" | "MAIL_FROM">): MailSender {
  const key = env.BREVO_API_KEY?.trim(), from = env.MAIL_FROM?.trim();
  return key && from ? new BrevoMailSender(key, from) : new DisabledMailSender();
}

/** Sends while the request waits: one try plus one retry when the failure is temporary. */
export async function attempt(sender: MailSender, message: MailMessage, tries = mailAttempts): Promise<{ result: MailResult; attempts: number }> {
  let result: MailResult = { ok: false, retry: false, error: "Sin intentos." }, attempts = 0;
  while (attempts < tries) {
    attempts++;
    result = await sender.send(message);
    if (result.ok || !result.retry) break;
  }
  return { result, attempts };
}

/** The part of the organization's store the outbox needs (the Durable Object `Database` satisfies it). */
type Bound = { first<T>(): Promise<T | null>; run(): Promise<unknown> };
export interface OutboxStore { prepare(sql: string): { bind(...values: (string | number | null)[]): Bound } }

export interface Delivery { status: MailStatus; error: string | null; sentAt: string | null }

/**
 * One message through the organization's outbox: queued, then sent, failed, deferred (over today's cap) or
 * not_configured. The body is not stored (it carries the link's secret).
 */
export async function deliver(db: OutboxStore, sender: MailSender, organizationId: string, kind: "invitation", referenceId: string, message: MailMessage): Promise<Delivery> {
  const id = `mail-${crypto.randomUUID()}`, now = new Date(), day = now.toISOString().slice(0, 10);
  const today = await db.prepare("SELECT count(*) AS sent FROM mail_outbox WHERE organization_id=? AND status='sent' AND sent_at>=?").bind(organizationId, `${day}T00:00:00.000Z`).first<{ sent: number }>();
  const decision = mailDecision(sender.configured, today?.sent || 0, dailyMailCap);
  const insert = (status: MailStatus, error: string | null) => db.prepare("INSERT INTO mail_outbox(id,organization_id,kind,reference_id,recipient,subject,status,attempts,last_error,created_at) VALUES (?,?,?,?,?,?,?,0,?,?)")
    .bind(id, organizationId, kind, referenceId, message.to, message.subject, status, error, now.toISOString());
  if (decision === "not_configured") { await insert("not_configured", "El envío de correo no está configurado.").run(); return { status: "not_configured", error: null, sentAt: null }; }
  if (decision === "deferred") { await insert("deferred", `Se alcanzó el tope diario de ${dailyMailCap} correos.`).run(); return { status: "deferred", error: null, sentAt: null }; }
  await insert("queued", null).run();
  const { result, attempts } = await attempt(sender, message);
  const sentAt = result.ok ? new Date().toISOString() : null, error = result.ok ? null : result.error;
  await db.prepare("UPDATE mail_outbox SET status=?,attempts=?,last_error=?,sent_at=?,provider_id=? WHERE id=?")
    .bind(result.ok ? "sent" : "failed", attempts, error, sentAt, result.ok ? result.id || null : null, id).run();
  return { status: result.ok ? "sent" : "failed", error, sentAt };
}
