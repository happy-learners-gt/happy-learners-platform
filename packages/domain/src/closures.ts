/**
 * My data and closing the account (ST-159). A person asks to close their account; administration starts it and closes
 * it by recording the person's departure (ST-123), which keeps everything they did and ends their access. Until
 * administration starts it, the person may cancel their request. Every transition is recorded in the activity.
 *
 *   requested ──start (administration)──▶ in_progress ──departure recorded──▶ completed
 *       │  └──────────────departure recorded──────────────────────────────────▲
 *       └──cancel (the person)──▶ cancelled
 */
export const closureStatuses = ["requested", "in_progress", "completed", "cancelled"] as const;
export type ClosureStatus = typeof closureStatuses[number];
export type ClosureAction = "start" | "cancel" | "complete";
export const closureLabels: Record<ClosureStatus, string> = { requested: "Solicitado", in_progress: "En curso", completed: "Completado", cancelled: "Cancelado" };
export const maxClosureReason = 500;

/** The status a request moves to, or null when the action is not allowed from where it is. */
export function closureTransition(from: ClosureStatus, action: ClosureAction): ClosureStatus | null {
  if (action === "start") return from === "requested" ? "in_progress" : null;
  if (action === "cancel") return from === "requested" ? "cancelled" : null;
  return from === "requested" || from === "in_progress" ? "completed" : null;
}
/** A request that still waits for administration or is being attended: at most one per person. */
export const closureOpen = (status: ClosureStatus) => status === "requested" || status === "in_progress";

/** The optional reason the person gives: up to 500 characters, without < or > or control characters; '' when absent. */
export function closureReasonInput(value: unknown): string | null {
  const raw = value && typeof value === "object" ? (value as Record<string, unknown>).reason : undefined;
  if (raw === undefined || raw === null) return "";
  if (typeof raw !== "string") return null;
  const text = raw.trim().replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").normalize("NFC");
  return text.length <= maxClosureReason && !/[<>\x00-\x09\x0b-\x1f]/.test(text) ? text : null;
}

/**
 * What «Exportar mis datos» contains, in the order of the file. Only the person's own records: nothing about other
 * people beyond the names already on what they did, and nothing about students.
 */
export const personalDataSections = [
  { key: "account", label: "Cuenta", description: "Usuario, nombre, rol, correo de acceso y organización." },
  { key: "profile", label: "Perfil", description: "Contacto, formación, especialidades, disponibilidad y tu perfil profesional con sus versiones." },
  { key: "credentials", label: "Credenciales y expediente", description: "Tus credenciales y su verificación, y los documentos de tu expediente (sus datos, no los archivos)." },
  { key: "preferences", label: "Preferencias", description: "Región, apariencia, cómo recibes los avisos y los de tu campana." },
  { key: "consents", label: "Consentimientos", description: "Las versiones de los términos y la privacidad que aceptaste o retiraste." },
  { key: "signatures", label: "Firmas", description: "Los comprobantes de los documentos que firmaste." },
  { key: "hours", label: "Horas", description: "Las clases que impartiste con sus horas efectivas." },
  { key: "activity", label: "Actividad", description: "Lo que hiciste en la plataforma, como lo registra la actividad." },
  { key: "security", label: "Seguridad", description: "Tus sesiones abiertas, tus inicios de sesión y los cambios de correo." },
  { key: "closures", label: "Cierre de la cuenta", description: "Tus solicitudes de cierre y su estado." },
] as const;
export type PersonalDataSection = typeof personalDataSections[number]["key"];
/** The name of the downloaded file: mis-datos-<usuario>-<AAAA-MM-DD>.json. */
export const personalDataFile = (username: string, day: string) => `mis-datos-${username.replace(/[^a-z0-9._-]/g, "")}-${day}.json`;
export const personalDataFormat = "happy-learners-personal-data/1";
