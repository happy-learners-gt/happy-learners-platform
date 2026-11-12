/**
 * Notifications of the changes that affect a person (ST-124, ST-161, DEC-042). The domain holds the catalog, how a
 * person's choice per channel and the organization's policy combine, when an e-mail waits (another day, a digest or
 * the end of the quiet hours), the reason recorded with each message and the Spanish messages themselves. The Worker
 * decides who receives what and writes the outbox and the in-app inbox.
 */
import { dailyMailCap, type MailMessage } from "./mail";
import { zonedInstant } from "./calendar-feed";

/** Types each person may turn off and administration may make mandatory (ST-124). */
export const notificationTypes = ["course_assignment", "section_assignment", "review_submitted", "review_returned", "review_approved", "class_changed", "class_cancelled"] as const;
/** Account and terms notices: always on, on every channel, for everyone (ST-161); no one can turn them off. */
export const systemNotificationTypes = ["account_security", "account_email", "terms_updated"] as const;
export type ConfigurableNotificationType = typeof notificationTypes[number];
export type SystemNotificationType = typeof systemNotificationTypes[number];
export type NotificationType = ConfigurableNotificationType | SystemNotificationType;
export const allNotificationTypes: readonly NotificationType[] = [...notificationTypes, ...systemNotificationTypes];

export interface NotificationDefinition { type: NotificationType; label: string; description: string; audience: string; system?: true }
/** What each notification says and who receives it; the order is the one the screens show. */
export const notificationCatalog: NotificationDefinition[] = [
  { type: "course_assignment", label: "Asignación a un curso", description: "Te agregan al equipo docente de un curso o cambia tu papel en él.", audience: "La persona asignada." },
  { type: "section_assignment", label: "Asignación a una sección", description: "Te asignan para impartir una sección.", audience: "La persona asignada." },
  { type: "review_submitted", label: "Lección enviada a revisión", description: "Alguien del equipo envía una lección a revisión.", audience: "La persona responsable del curso y quien revisa por coordinación en su alcance." },
  { type: "review_returned", label: "Revisión devuelta", description: "Tu lección vuelve con comentarios para ajustarla.", audience: "Quien envió la lección a revisión." },
  { type: "review_approved", label: "Revisión aprobada", description: "Tu lección enviada a revisión se aprueba y publica.", audience: "Quien envió la lección a revisión." },
  { type: "class_changed", label: "Cambio de una clase", description: "Una clase de tu sección cambia de fecha, hora o duración, o se reprograma.", audience: "Quienes imparten la sección, salvo quien hizo el cambio." },
  { type: "class_cancelled", label: "Cancelación de una clase", description: "Se cancela una clase de tu sección.", audience: "Quienes imparten la sección, salvo quien la canceló." },
  { type: "account_security", label: "Seguridad de la cuenta", description: "Cambia tu contraseña o administración la restablece.", audience: "La persona dueña de la cuenta.", system: true },
  { type: "account_email", label: "Cambio de correo", description: "Se pide o se confirma un cambio del correo de acceso de tu cuenta.", audience: "La persona dueña de la cuenta.", system: true },
  { type: "terms_updated", label: "Términos y privacidad", description: "Se publica una nueva versión de los términos o de la política de privacidad.", audience: "Todas las personas de la organización.", system: true },
];
/** Any type of the catalog, configurable or not (what the outbox and the inbox may record). */
export const isNotificationType = (value: unknown): value is NotificationType => typeof value === "string" && (allNotificationTypes as readonly string[]).includes(value);
export const isConfigurableType = (value: unknown): value is ConfigurableNotificationType => typeof value === "string" && (notificationTypes as readonly string[]).includes(value);
export const isSystemType = (value: unknown): value is SystemNotificationType => typeof value === "string" && (systemNotificationTypes as readonly string[]).includes(value);
export const notificationLabel = (type: NotificationType) => notificationCatalog.find(item => item.type === type)!.label;

/** Where a notice reaches the person: the bell of the application, and e-mail. */
export const notificationChannels = ["in_app", "email"] as const;
export type NotificationChannel = typeof notificationChannels[number];
export const channelLabels: Record<NotificationChannel, string> = { in_app: "En la aplicación", email: "Correo" };
/** Each person's choices: type → channel → on/off. A missing value is on. */
export type ChannelPreferences = Partial<Record<NotificationType, Partial<Record<NotificationChannel, boolean>>>>;

/**
 * Whether the person receives a type by e-mail (ST-124): a mandatory type always; otherwise what they chose, and every
 * type is on until they turn it off.
 */
export function receives(type: NotificationType, preferences: Partial<Record<NotificationType, boolean>>, mandatory: ReadonlySet<NotificationType>): boolean {
  return isSystemType(type) || mandatory.has(type) || preferences[type] !== false;
}
/** Whether a type cannot be turned off, and why: the platform (account and terms) or the organization's policy. */
export function lockedBy(type: NotificationType, mandatory: ReadonlySet<NotificationType>): "system" | "policy" | null {
  return isSystemType(type) ? "system" : mandatory.has(type) ? "policy" : null;
}
/** Whether the person receives a type on one channel (ST-161): locked types always; otherwise their choice, on by default. */
export function receivesOn(type: NotificationType, channel: NotificationChannel, preferences: ChannelPreferences, mandatory: ReadonlySet<NotificationType>): boolean {
  return !!lockedBy(type, mandatory) || preferences[type]?.[channel] !== false;
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

/**
 * The person's e-mail choices of ST-124: {type: boolean} for some or every type of the catalog. Account and terms
 * notices are accepted only to say they stay on (turning them off is refused by the Worker, like a mandatory type).
 */
export function preferencesInput(value: unknown): Partial<Record<NotificationType, boolean>> | null {
  const raw = value && typeof value === "object" ? (value as Record<string, unknown>).preferences : null;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const entries = Object.entries(raw as Record<string, unknown>);
  if (!entries.length || entries.some(([key, enabled]) => !isNotificationType(key) || typeof enabled !== "boolean")) return null;
  return Object.fromEntries(entries) as Partial<Record<NotificationType, boolean>>;
}
/** The organization's policy: the list of mandatory types (possibly empty), without repetitions; only configurable types. */
export function policyInput(value: unknown): ConfigurableNotificationType[] | null {
  const raw = value && typeof value === "object" ? (value as Record<string, unknown>).mandatory : null;
  if (!Array.isArray(raw) || raw.some(item => !isConfigurableType(item)) || new Set(raw).size !== raw.length) return null;
  return notificationTypes.filter(type => raw.includes(type));
}

/** The facts each reason names. Course, section and lesson titles are already visible to whoever receives it. */
export type NotificationFacts =
  | { type: "course_assignment"; course: string; role: "lead" | "co-teacher" }
  | { type: "section_assignment"; course: string; section: string }
  | { type: "review_submitted"; course: string; lesson: string; actor: string }
  | { type: "review_returned" | "review_approved"; course: string; lesson: string; actor: string }
  | { type: "class_changed"; course: string; section: string; date: string; next?: { date: string; startsAt: string | null } | null; restored?: boolean }
  | { type: "class_cancelled"; course: string; section: string; date: string }
  | { type: "account_security"; change: "password_changed" | "password_reset" }
  | { type: "account_email"; change: "requested" | "verified"; address: string }
  | { type: "terms_updated"; document: string; title: string; version: number };

const clip = (text: string, size: number) => text.length > size ? `${text.slice(0, size - 1)}…` : text;
/** The motivo recorded with each message and shown in the history: one sentence, in Spanish, up to 240 characters. */
export function notificationReason(facts: NotificationFacts): string {
  switch (facts.type) {
    case "account_security": return facts.change === "password_changed" ? "Se cambió la contraseña de tu cuenta. Si no fuiste tú, avisa a administración de inmediato"
      : "Administración restableció la contraseña de tu cuenta; al entrar elegirás una nueva";
    case "account_email": return clip(facts.change === "requested" ? `Se pidió cambiar el correo de acceso de tu cuenta a ${clip(facts.address, 120)}. Si no fuiste tú, avisa a administración`
      : `El correo de acceso de tu cuenta ahora es ${clip(facts.address, 120)}`, 240);
    case "terms_updated": return clip(`Se publicó la versión ${facts.version} de ${clip(facts.document, 60)}: «${clip(facts.title, 120)}». Revísala al entrar`, 240);
  }
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
  account_security: "Aviso de seguridad de tu cuenta", account_email: "Cambio del correo de tu cuenta", terms_updated: "Hay una nueva versión de los términos",
};
const actions: Record<NotificationType, string> = {
  course_assignment: "Abrir el curso", section_assignment: "Abrir la sección", review_submitted: "Revisar la lección", review_returned: "Ver los comentarios",
  review_approved: "Ver la lección", class_changed: "Ver la clase", class_cancelled: "Ver la clase",
  account_security: "Abrir mi cuenta", account_email: "Abrir mi cuenta", terms_updated: "Leer la nueva versión",
};
const escape = (value: string) => value.replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]!);

export interface NotificationDetails { type: NotificationType; organization: string; recipientName: string; reason: string; link: string; mandatory: boolean; preferencesLink: string }
/** The notification e-mail, in Spanish: plain text and simple HTML with the same content and a link to the page. */
export function notificationMessage(to: string, details: NotificationDetails): MailMessage {
  const subject = `${subjects[details.type]} · ${clip(details.organization, 80)}`;
  const footer = isSystemType(details.type)
    ? "Este aviso de la cuenta es obligatorio: lo recibes siempre para proteger tu acceso."
    : details.mandatory
    ? "Administración marcó este aviso como obligatorio, por eso lo recibes siempre."
    : "Puedes elegir qué avisos recibes, por qué medio y con qué frecuencia en Preferencias, sección Notificaciones:";
  const text = [
    `Hola, ${details.recipientName}:`, "", `${details.reason}.`, "", `${actions[details.type]}:`, details.link, "",
    footer, ...(details.mandatory ? [] : [details.preferencesLink]), "", `Acervum · ${details.organization}`,
  ].join("\n");
  const html = `<!doctype html><html lang="es"><body style="font-family:Segoe UI,Arial,sans-serif;color:#242424;line-height:1.5">
<p>Hola, ${escape(details.recipientName)}:</p>
<p>${escape(details.reason)}.</p>
<p><a href="${escape(details.link)}" style="display:inline-block;padding:10px 16px;background:#0f6cbd;color:#ffffff;text-decoration:none;border-radius:4px">${escape(actions[details.type])}</a></p>
<p>Si el botón no funciona, copia este enlace en tu navegador:<br><span style="word-break:break-all">${escape(details.link)}</span></p>
<p style="color:#616161">${escape(footer)}${details.mandatory ? "" : ` <a href="${escape(details.preferencesLink)}">${escape(details.preferencesLink)}</a>`}</p>
<p style="color:#616161">Acervum · ${escape(details.organization)}</p>
</body></html>`;
  return { to, subject, text, html };
}

/**
 * How e-mail reaches a person (ST-161): each notice at once, a daily or weekly digest, or never (only mandatory notices
 * and the account notices). The digest leaves at `digestTime` of the person's zone; the weekly one on their first day
 * of the week. Optional e-mail that would arrive during the quiet hours waits until they end. The bell is never delayed.
 */
export const emailFrequencies = ["immediate", "daily", "weekly", "never"] as const;
export type EmailFrequency = typeof emailFrequencies[number];
export const emailFrequencyLabels: Record<EmailFrequency, string> = { immediate: "En cuanto ocurre", daily: "Resumen diario", weekly: "Resumen semanal", never: "Nunca (solo avisos obligatorios)" };
export interface DeliverySettings { frequency: EmailFrequency; digestTime: string; quietHours: { start: string; end: string } | null }
export const defaultDeliverySettings: DeliverySettings = { frequency: "immediate", digestTime: "07:00", quietHours: null };
const clockPattern = /^([01]\d|2[0-3]):[0-5]\d$/;

/** A change to the person's channels, frequency, digest time and quiet hours; only what is sent is validated. */
export interface NotificationPreferencesChange { channels?: ChannelPreferences; frequency?: EmailFrequency; digestTime?: string; quietHours?: { start: string; end: string } | null }
export function notificationPreferencesInput(value: unknown): NotificationPreferencesChange | { error: string } {
  if (!value || typeof value !== "object" || Array.isArray(value)) return { error: "Envía las preferencias de notificación que quieres cambiar." };
  const raw = value as Record<string, unknown>, out: NotificationPreferencesChange = {};
  const unknown = Object.keys(raw).find(key => !["channels", "frequency", "digestTime", "quietHours"].includes(key));
  if (unknown || !Object.keys(raw).length) return { error: "Envía los canales, la frecuencia, la hora del resumen o el horario de silencio." };
  if (raw.channels !== undefined) {
    if (!raw.channels || typeof raw.channels !== "object" || Array.isArray(raw.channels)) return { error: "Indica, para cada aviso, en qué canales quieres recibirlo." };
    const channels: ChannelPreferences = {};
    for (const [type, value] of Object.entries(raw.channels as Record<string, unknown>)) {
      if (!isNotificationType(type) || !value || typeof value !== "object" || Array.isArray(value)) return { error: "Indica, para cada aviso del catálogo, en qué canales quieres recibirlo." };
      const entries = Object.entries(value as Record<string, unknown>);
      if (!entries.length || entries.some(([channel, on]) => !(notificationChannels as readonly string[]).includes(channel) || typeof on !== "boolean")) return { error: "Los canales son «in_app» y «email», cada uno activado o no." };
      channels[type] = Object.fromEntries(entries) as Partial<Record<NotificationChannel, boolean>>;
    }
    if (!Object.keys(channels).length) return { error: "Indica al menos un aviso." };
    out.channels = channels;
  }
  if (raw.frequency !== undefined) {
    if (!(emailFrequencies as readonly unknown[]).includes(raw.frequency)) return { error: "Elige con qué frecuencia recibir los correos." };
    out.frequency = raw.frequency as EmailFrequency;
  }
  if (raw.digestTime !== undefined) {
    if (typeof raw.digestTime !== "string" || !clockPattern.test(raw.digestTime)) return { error: "Escribe la hora del resumen con el formato HH:MM." };
    out.digestTime = raw.digestTime;
  }
  if (raw.quietHours !== undefined) {
    const quiet = raw.quietHours as Record<string, unknown> | null;
    if (quiet === null) out.quietHours = null;
    else if (!quiet || typeof quiet !== "object" || typeof quiet.start !== "string" || typeof quiet.end !== "string" || !clockPattern.test(quiet.start) || !clockPattern.test(quiet.end)) return { error: "Escribe el inicio y el fin del horario de silencio con el formato HH:MM." };
    else if (quiet.start === quiet.end) return { error: "El horario de silencio debe empezar y terminar a horas distintas." };
    else out.quietHours = { start: quiet.start, end: quiet.end };
  }
  return out;
}

const minutesOf = (time: string) => { const [hours, minutes] = time.split(":").map(Number); return hours * 60 + minutes; };
const addDays = (day: string, days: number) => new Date(Date.parse(`${day}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
/** Day, time and ISO weekday (1 Monday … 7 Sunday) of an instant in a zone. */
function localParts(instant: Date, zone: string) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-US", { timeZone: zone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", weekday: "short", hourCycle: "h23" })
    .formatToParts(instant).map(part => [part.type, part.value]));
  const weekday = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].indexOf(parts.weekday) + 1;
  return { day: `${parts.year}-${parts.month}-${parts.day}`, time: `${parts.hour}:${parts.minute}`, weekday };
}
/** Whether a wall-clock time falls inside the quiet hours; they may cross midnight (22:00 to 07:00). */
export function inQuietHours(time: string, quiet: { start: string; end: string } | null): boolean {
  if (!quiet) return false;
  const now = minutesOf(time), start = minutesOf(quiet.start), end = minutesOf(quiet.end);
  return start < end ? now >= start && now < end : now >= start || now < end;
}
/** When the quiet hours that contain `now` end, or null when `now` is not inside them. */
export function quietHoursEnd(now: Date, zone: string, quiet: { start: string; end: string } | null): Date | null {
  const local = localParts(now, zone);
  if (!inQuietHours(local.time, quiet)) return null;
  const day = minutesOf(local.time) < minutesOf(quiet!.end) ? local.day : addDays(local.day, 1);
  return zonedInstant(day, quiet!.end, zone);
}
/**
 * The next digest after `now`: today or a later day at `digestTime` (weekly: on the person's first day of the week),
 * moved to the end of the quiet hours when it falls inside them.
 */
export function nextDigestAt(now: Date, zone: string, settings: Pick<DeliverySettings, "digestTime" | "quietHours"> & { frequency: "daily" | "weekly" }, weekStart = 1): Date {
  const local = localParts(now, zone);
  for (let offset = 0; offset <= 8; offset++) {
    const day = addDays(local.day, offset), instant = zonedInstant(day, settings.digestTime, zone);
    if (instant.getTime() <= now.getTime()) continue;
    if (settings.frequency === "weekly" && localParts(instant, zone).weekday !== weekStart) continue;
    return quietHoursEnd(instant, zone, settings.quietHours) || instant;
  }
  return new Date(now.getTime() + 86_400_000);
}
/**
 * What happens to one e-mail notice now: leave at once, wait until a given instant (digest or quiet hours), or not be
 * written at all (frequency «never»). Mandatory notices and account notices always leave at once.
 */
export type EmailPlan = { action: "send" } | { action: "schedule"; at: Date } | { action: "skip" };
export function emailPlan(input: { mandatory: boolean; settings: DeliverySettings; zone: string; weekStart?: number; now?: Date }): EmailPlan {
  if (input.mandatory) return { action: "send" };
  const now = input.now || new Date(), { settings } = input;
  if (settings.frequency === "never") return { action: "skip" };
  if (settings.frequency === "daily" || settings.frequency === "weekly") return { action: "schedule", at: nextDigestAt(now, input.zone, { ...settings, frequency: settings.frequency }, input.weekStart) };
  const end = quietHoursEnd(now, input.zone, settings.quietHours);
  return end ? { action: "schedule", at: end } : { action: "send" };
}

export interface DigestItem { type: NotificationType; reason: string; link: string; createdAt: string }
export interface DigestDetails { organization: string; recipientName: string; frequency: EmailFrequency; items: DigestItem[]; preferencesLink: string; locale?: string; timezone?: string }
/** The digest e-mail: every waiting notice grouped by type, each with its reason and link; at most 50 listed. */
export function digestMessage(to: string, details: DigestDetails): MailMessage {
  const count = details.items.length, shown = details.items.slice(0, 50);
  const label = details.frequency === "weekly" ? "Tu resumen semanal" : details.frequency === "daily" ? "Tu resumen diario" : "Tus avisos pendientes";
  const subject = `${label}: ${count} ${count === 1 ? "aviso" : "avisos"} · ${clip(details.organization, 80)}`;
  const groups = notificationCatalog.map(item => ({ item, entries: shown.filter(entry => entry.type === item.type) })).filter(group => group.entries.length);
  const when = (value: string) => { try { return new Intl.DateTimeFormat(details.locale || "es", { dateStyle: "medium", timeStyle: "short", timeZone: details.timezone || "UTC" }).format(new Date(value)); } catch { return value.slice(0, 16).replace("T", " "); } };
  const more = count > shown.length ? `Y ${count - shown.length} avisos más en la aplicación.` : "";
  const text = [
    `Hola, ${details.recipientName}:`, "", `${label} reúne ${count === 1 ? "un aviso" : `${count} avisos`} desde el último correo.`, "",
    ...groups.flatMap(group => [`${group.item.label} (${group.entries.length})`, ...group.entries.flatMap(entry => [`- ${when(entry.createdAt)} · ${entry.reason}.`, `  ${entry.link}`]), ""]),
    ...(more ? [more, ""] : []),
    "Puedes cambiar la frecuencia de los correos en Preferencias, sección Notificaciones:", details.preferencesLink, "", `Acervum · ${details.organization}`,
  ].join("\n");
  const html = `<!doctype html><html lang="es"><body style="font-family:Segoe UI,Arial,sans-serif;color:#242424;line-height:1.5">
<p>Hola, ${escape(details.recipientName)}:</p>
<p>${escape(label)} reúne ${count === 1 ? "un aviso" : `${count} avisos`} desde el último correo.</p>
${groups.map(group => `<h2 style="font-size:16px;margin:16px 0 4px">${escape(group.item.label)} (${group.entries.length})</h2>
<ul>${group.entries.map(entry => `<li><span style="color:#616161">${escape(when(entry.createdAt))}</span> · ${escape(entry.reason)}. <a href="${escape(entry.link)}">${escape(actions[entry.type])}</a></li>`).join("")}</ul>`).join("\n")}
${more ? `<p>${escape(more)}</p>` : ""}
<p style="color:#616161">Puedes cambiar la frecuencia de los correos en Preferencias, sección Notificaciones: <a href="${escape(details.preferencesLink)}">${escape(details.preferencesLink)}</a></p>
<p style="color:#616161">Acervum · ${escape(details.organization)}</p>
</body></html>`;
  return { to, subject: subject.slice(0, 200), text, html };
}
/** The reason recorded with a digest in the outbox. */
export const digestReason = (frequency: EmailFrequency, count: number) =>
  `${frequency === "weekly" ? "Resumen semanal" : frequency === "daily" ? "Resumen diario" : "Avisos pendientes"} con ${count} ${count === 1 ? "aviso" : "avisos"}`;
