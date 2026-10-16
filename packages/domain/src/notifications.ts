/**
 * E-mail notifications of the changes that affect a person (ST-124, DEC-042). The domain holds the catalog, how a
 * person's choice and the organization's policy combine, when a message waits for another day, the reason recorded
 * with each message and the Spanish message itself. The Worker decides who receives what and writes the outbox.
 */
import { dailyMailCap, type MailMessage } from "./mail";

export const notificationTypes = ["course_assignment", "section_assignment", "review_submitted", "review_returned", "review_approved", "class_changed", "class_cancelled"] as const;
export type NotificationType = typeof notificationTypes[number];

export interface NotificationDefinition { type: NotificationType; label: string; description: string; audience: string }
/** What each notification says and who receives it; the order is the one the screens show. */
export const notificationCatalog: NotificationDefinition[] = [
  { type: "course_assignment", label: "Asignación a un curso", description: "Te agregan al equipo docente de un curso o cambia tu papel en él.", audience: "La persona asignada." },
  { type: "section_assignment", label: "Asignación a una sección", description: "Te asignan para impartir una sección.", audience: "La persona asignada." },
  { type: "review_submitted", label: "Lección enviada a revisión", description: "Alguien del equipo envía una lección a revisión.", audience: "La persona responsable del curso y quien revisa por coordinación en su alcance." },
  { type: "review_returned", label: "Revisión devuelta", description: "Tu lección vuelve con comentarios para ajustarla.", audience: "Quien envió la lección a revisión." },
  { type: "review_approved", label: "Revisión aprobada", description: "Tu lección enviada a revisión se aprueba y publica.", audience: "Quien envió la lección a revisión." },
  { type: "class_changed", label: "Cambio de una clase", description: "Una clase de tu sección cambia de fecha, hora o duración, o se reprograma.", audience: "Quienes imparten la sección, salvo quien hizo el cambio." },
  { type: "class_cancelled", label: "Cancelación de una clase", description: "Se cancela una clase de tu sección.", audience: "Quienes imparten la sección, salvo quien la canceló." },
];
export const isNotificationType = (value: unknown): value is NotificationType => typeof value === "string" && (notificationTypes as readonly string[]).includes(value);
export const notificationLabel = (type: NotificationType) => notificationCatalog.find(item => item.type === type)!.label;

/**
 * Whether the person receives a type: a mandatory type always; otherwise what they chose, and every type is on until
 * they turn it off.
 */
export function receives(type: NotificationType, preferences: Partial<Record<NotificationType, boolean>>, mandatory: ReadonlySet<NotificationType>): boolean {
  return mandatory.has(type) || preferences[type] !== false;
}

/**
 * DEC-042 keeps each organization below 250 messages a day. Optional notifications stop earlier, so the last 50 of the
 * day stay for invitations and mandatory notifications; a mandatory notification waits only when the organization's
 * cap itself is reached. A message that waits is recorded as `deferred` (with its mandatory flag) and is not resent.
 */
export const notificationReserve = 50;
export const optionalNotificationCap = dailyMailCap - notificationReserve;
/** At most this many messages leave while one request waits; the rest of that request is recorded as deferred. */
export const maxNotificationsPerRequest = 20;

export type NotificationStatus = "send" | "no_address" | "not_configured" | "deferred";
export function notificationDecision(input: { address: string | null; configured: boolean; sentToday: number; mandatory: boolean; sentInRequest?: number }): NotificationStatus {
  if (!input.address) return "no_address";
  if (!input.configured) return "not_configured";
  if (input.sentToday >= (input.mandatory ? dailyMailCap : optionalNotificationCap)) return "deferred";
  return (input.sentInRequest || 0) >= maxNotificationsPerRequest ? "deferred" : "send";
}

/** The person's choices: {type: boolean} for some or every type of the catalog. */
export function preferencesInput(value: unknown): Partial<Record<NotificationType, boolean>> | null {
  const raw = value && typeof value === "object" ? (value as Record<string, unknown>).preferences : null;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const entries = Object.entries(raw as Record<string, unknown>);
  if (!entries.length || entries.some(([key, enabled]) => !isNotificationType(key) || typeof enabled !== "boolean")) return null;
  return Object.fromEntries(entries) as Partial<Record<NotificationType, boolean>>;
}
/** The organization's policy: the list of mandatory types (possibly empty), without repetitions. */
export function policyInput(value: unknown): NotificationType[] | null {
  const raw = value && typeof value === "object" ? (value as Record<string, unknown>).mandatory : null;
  if (!Array.isArray(raw) || raw.some(item => !isNotificationType(item)) || new Set(raw).size !== raw.length) return null;
  return notificationTypes.filter(type => raw.includes(type));
}

/** The facts each reason names. Course, section and lesson titles are already visible to whoever receives it. */
export type NotificationFacts =
  | { type: "course_assignment"; course: string; role: "lead" | "co-teacher" }
  | { type: "section_assignment"; course: string; section: string }
  | { type: "review_submitted"; course: string; lesson: string; actor: string }
  | { type: "review_returned" | "review_approved"; course: string; lesson: string; actor: string }
  | { type: "class_changed"; course: string; section: string; date: string; next?: { date: string; startsAt: string | null } | null; restored?: boolean }
  | { type: "class_cancelled"; course: string; section: string; date: string };

const clip = (text: string, size: number) => text.length > size ? `${text.slice(0, size - 1)}…` : text;
/** The motivo recorded with each message and shown in the history: one sentence, in Spanish, up to 240 characters. */
export function notificationReason(facts: NotificationFacts): string {
  const course = `«${clip(facts.course, 80)}»`;
  switch (facts.type) {
    case "course_assignment": return clip(`Te asignaron al equipo docente del curso ${course} como ${facts.role === "lead" ? "persona responsable" : "colaborador"}`, 240);
    case "section_assignment": return clip(`Te asignaron a la sección «${clip(facts.section, 60)}» de ${course}`, 240);
    case "review_submitted": return clip(`${clip(facts.actor, 60)} envió a revisión la lección «${clip(facts.lesson, 70)}» de ${course}`, 240);
    case "review_returned": return clip(`${clip(facts.actor, 60)} devolvió con comentarios tu lección «${clip(facts.lesson, 70)}» de ${course}`, 240);
    case "review_approved": return clip(`${clip(facts.actor, 60)} aprobó y publicó tu lección «${clip(facts.lesson, 70)}» de ${course}`, 240);
    case "class_changed": {
      const when = facts.next ? `${facts.next.date}${facts.next.startsAt ? ` a las ${facts.next.startsAt}` : ""}` : "";
      return clip(facts.restored ? `Se reprogramó la clase del ${facts.date} de la sección «${clip(facts.section, 60)}» de ${course}`
        : `Cambió la clase del ${facts.date} de la sección «${clip(facts.section, 60)}» de ${course}${when ? `: ahora es el ${when}` : ""}`, 240);
    }
    case "class_cancelled": return clip(`Se canceló la clase del ${facts.date} de la sección «${clip(facts.section, 60)}» de ${course}`, 240);
  }
}

const subjects: Record<NotificationType, string> = {
  course_assignment: "Te asignaron a un curso", section_assignment: "Te asignaron a una sección",
  review_submitted: "Una lección espera tu revisión", review_returned: "Tu lección volvió con comentarios", review_approved: "Tu lección fue aprobada",
  class_changed: "Cambió una clase de tu sección", class_cancelled: "Se canceló una clase de tu sección",
};
const actions: Record<NotificationType, string> = {
  course_assignment: "Abrir el curso", section_assignment: "Abrir la sección", review_submitted: "Revisar la lección", review_returned: "Ver los comentarios",
  review_approved: "Ver la lección", class_changed: "Ver la clase", class_cancelled: "Ver la clase",
};
const escape = (value: string) => value.replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]!);

export interface NotificationDetails { type: NotificationType; organization: string; recipientName: string; reason: string; link: string; mandatory: boolean; preferencesLink: string }
/** The notification e-mail, in Spanish: plain text and simple HTML with the same content and a link to the page. */
export function notificationMessage(to: string, details: NotificationDetails): MailMessage {
  const subject = `${subjects[details.type]} · ${clip(details.organization, 80)}`;
  const footer = details.mandatory
    ? "Administración marcó este aviso como obligatorio, por eso lo recibes siempre."
    : "Puedes elegir qué avisos recibes en Mi perfil, sección Notificaciones:";
  const text = [
    `Hola, ${details.recipientName}:`, "", `${details.reason}.`, "", `${actions[details.type]}:`, details.link, "",
    footer, ...(details.mandatory ? [] : [details.preferencesLink]), "", `Happy Learners · ${details.organization}`,
  ].join("\n");
  const html = `<!doctype html><html lang="es"><body style="font-family:Segoe UI,Arial,sans-serif;color:#242424;line-height:1.5">
<p>Hola, ${escape(details.recipientName)}:</p>
<p>${escape(details.reason)}.</p>
<p><a href="${escape(details.link)}" style="display:inline-block;padding:10px 16px;background:#0f6cbd;color:#ffffff;text-decoration:none;border-radius:4px">${escape(actions[details.type])}</a></p>
<p>Si el botón no funciona, copia este enlace en tu navegador:<br><span style="word-break:break-all">${escape(details.link)}</span></p>
<p style="color:#616161">${escape(footer)}${details.mandatory ? "" : ` <a href="${escape(details.preferencesLink)}">${escape(details.preferencesLink)}</a>`}</p>
<p style="color:#616161">Happy Learners · ${escape(details.organization)}</p>
</body></html>`;
  return { to, subject, text, html };
}
