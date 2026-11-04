/**
 * The security log (ST-137, ST-186, ST-187): what each event means, how administration filters it, how it is exported
 * and the text each seal covers. Nothing here holds a password, a code, a token, an IP address or a User-Agent.
 */
export const securityEventTypes = {
  sign_in: "Inicio de sesión",
  sign_in_locked: "Cuenta bloqueada temporalmente",
  sign_out: "Cierre de sesión",
  session_closed: "Sesión cerrada por su dueño",
  sessions_closed: "Sesiones cerradas por administración",
  password_changed: "Contraseña cambiada",
  password_reset: "Contraseña restablecida por administración",
  password_recovery_requested: "Recuperación de contraseña solicitada",
  password_recovered: "Contraseña recuperada",
  link_requested: "Enlace de acceso solicitado",
  email_changed: "Correo de acceso cambiado",
  role_changed: "Rol cambiado",
  access_changed: "Acceso activado o desactivado",
  permissions_changed: "Permisos cambiados",
  mfa_enabled: "Verificación en dos pasos activada",
  mfa_disabled: "Verificación en dos pasos desactivada",
  mfa_reset: "Verificación en dos pasos restablecida por administración",
  mfa_failed: "Código de verificación incorrecto",
  recovery_code_used: "Código de recuperación usado",
  recovery_codes_renewed: "Códigos de recuperación renovados",
  passkey_added: "Passkey registrada",
  passkey_removed: "Passkey eliminada",
  provider_linked: "Cuenta externa vinculada",
  provider_unlinked: "Cuenta externa desvinculada",
  token_created: "Token de integración creado",
  token_revoked: "Token de integración revocado",
  token_used: "Token de integración usado",
  sso_changed: "Proveedor institucional cambiado",
  policy_changed: "Política de acceso cambiada",
  log_exported: "Registro de seguridad exportado",
  access_review_exported: "Revisión de accesos exportada",
} as const;
export type SecurityEventType = keyof typeof securityEventTypes;
export type SecurityOutcome = "succeeded" | "failed" | "info";
export const securityOutcomes: Record<SecurityOutcome, string> = { succeeded: "Correcto", failed: "Fallido", info: "Registro" };
export const isSecurityEventType = (value: unknown): value is SecurityEventType => typeof value === "string" && Object.hasOwn(securityEventTypes, value);

/** How a person proved who they are. */
export const securityMethods: Record<string, string> = {
  password: "Contraseña", invitation: "Invitación", link: "Enlace por correo", recovery: "Recuperación de contraseña", passkey: "Passkey",
  google: "Google", microsoft: "Microsoft", apple: "Apple", sso: "Proveedor institucional", totp: "Aplicación de autenticación", recovery_code: "Código de recuperación", token: "Token de integración",
};

/** Events older than this leave the log, oldest first; the chain keeps the seal of the last one removed (ST-186). */
export const securityRetentionDays = 365;
export const securityPageLimit = 100;
/** The seal before the first event. */
export const genesisHash = "0".repeat(64);

export interface SecurityFilter { person: string | null; type: SecurityEventType | null; from: string | null; to: string | null; before: string | null; limit: number }
const day = /^\d{4}-\d{2}-\d{2}$/, id = /^[a-z0-9-]{1,100}$/;
const validDay = (value: string) => day.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`)) && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;
/** The filters of the security log and the audit, from the query string; null when one is not valid. */
export function securityFilter(params: URLSearchParams): SecurityFilter | null {
  const person = params.get("persona") || null, type = params.get("tipo") || null, from = params.get("desde") || null, to = params.get("hasta") || null, before = params.get("antes") || null;
  if (person && !id.test(person)) return null;
  if (type && !isSecurityEventType(type)) return null;
  if ((from && !validDay(from)) || (to && !validDay(to)) || (from && to && from > to)) return null;
  if (before && Number.isNaN(Date.parse(before))) return null;
  const limit = Math.min(securityPageLimit, Math.max(1, Number(params.get("limite")) || 50));
  return { person, type: type as SecurityEventType | null, from, to, before, limit };
}
/** The [from, to) instants of a filter's days, in UTC. */
export function securityRange(filter: Pick<SecurityFilter, "from" | "to">): [string, string] {
  const next = (value: string) => new Date(Date.parse(`${value}T00:00:00Z`) + 86400000).toISOString();
  return [filter.from ? `${filter.from}T00:00:00.000Z` : "", filter.to ? next(filter.to) : "9999"];
}

export interface SealedFields {
  id: string; organization_id: string; type: string; outcome: string; actor_id: string | null; subject_id: string | null; method: string | null;
  detail: string | null; device: string | null; country: string | null; occurred_at: string;
}
/** What a seal covers: the previous seal and every field of the event, in a fixed order. */
export const sealText = (previous: string, row: SealedFields) =>
  previous + "\n" + JSON.stringify([row.id, row.organization_id, row.type, row.outcome, row.actor_id, row.subject_id, row.method, row.detail, row.device, row.country, row.occurred_at]);

/** A cell that a spreadsheet would run as a formula starts with an apostrophe. */
const cell = (value: string | null | undefined) => {
  const text = String(value ?? "");
  const safe = /^[=+\-@\t\r]/.test(text) ? `'${text}` : text;
  return /[",\n\r;]/.test(safe) ? `"${safe.replaceAll('"', '""')}"` : safe;
};
export interface SecurityRow {
  id: string; type: string; outcome: string; actorName: string | null; subjectName: string | null; method: string | null; detail: string | null;
  device: string | null; country: string | null; occurredAt: string; hash: string | null;
}
/** The exported log: one row per event with its seal, readable in a spreadsheet; never a secret (ST-137). */
export function securityCsv(rows: SecurityRow[]): string {
  const header = ["Fecha (UTC)", "Evento", "Tipo", "Resultado", "Persona", "Realizado por", "Método", "Detalle", "Dispositivo", "País", "Sello"];
  const lines = rows.map(row => [row.occurredAt, securityEventTypes[row.type as SecurityEventType] || row.type, row.type, securityOutcomes[row.outcome as SecurityOutcome] || row.outcome,
    row.subjectName, row.actorName, row.method ? securityMethods[row.method] || row.method : "", row.detail, row.device, row.country, row.hash].map(cell).join(","));
  return "﻿" + [header.join(","), ...lines].join("\r\n") + "\r\n";
}
