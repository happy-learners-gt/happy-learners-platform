import type { AccountNotice, MailSender } from "@happy-learners/domain";
import { accountMessage, accountNoticeReason } from "@happy-learners/domain";
import type { Database } from "./storage";
import { deliver, type Delivery } from "./mail";
import { timezoneOf } from "./classes";

/** What the account, export and closure routes need besides the store: the request, the origin, the mail port, the session. */
export interface AccountContext { request: Request; origin: string; sender: MailSender; token: string }

/**
 * Sends one security notice to a person through the outbox. An address of '' records 'no_address'. Never throws: a
 * mail problem never undoes the change that caused it.
 */
export async function sendNotice(db: Database, sender: MailSender, organizationId: string, person: { id: string; name: string; email: string | null }, referenceId: string, notice: AccountNotice): Promise<Delivery> {
  try {
    const organization = await db.prepare("SELECT name FROM organizations WHERE id=?").bind(organizationId).first<{ name: string | null }>();
    const message = accountMessage(person.email || "", notice, { organization: organization?.name || "Acervum", recipientName: person.name, timezone: await timezoneOf(db, organizationId) });
    return await deliver(db, sender, organizationId, "account", referenceId, message, { userId: person.id, reason: accountNoticeReason(notice) });
  } catch (error) {
    console.error(JSON.stringify({ event: "account_notice_failed", cause: error instanceof Error ? `${error.name}: ${error.message}`.slice(0, 240) : "Unknown error" }));
    return { status: "failed", error: "No se pudo registrar el aviso.", sentAt: null };
  }
}

