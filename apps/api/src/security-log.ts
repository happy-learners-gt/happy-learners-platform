import type { Member } from "@happy-learners/contracts";
import type { SecurityEventType, SecurityFilter, SecurityOutcome, SecurityRow } from "@happy-learners/domain";
import { securityCsv, securityFilter, securityRange } from "@happy-learners/domain";
import { verifySecurityChain } from "./security-chain";
import type { Database } from "./storage";
import type { Client } from "./account";
import { event } from "./activity";

/**
 * The security log (ST-137) and the restricted audit (ST-068), administration only (ST-184). Each event is sealed in
 * the transaction that writes it (ST-186): `sealSecurityEvents` (security-chain.ts) runs inside the organization's store whenever a batch
 * inserts into security_events, so no request can see or leave an unsealed event.
 */
const reply = (value: unknown, status = 200) => Response.json(value, { status });

export interface SecurityEntry {
  organizationId: string; type: SecurityEventType; outcome?: SecurityOutcome; actorId?: string | null; subjectId?: string | null;
  method?: string | null; detail?: string | null; client?: Client | null;
}
/** One event of the security log. Must be run in a batch, like any other write: the store seals it in the same transaction. */
export function securityEvent(db: Database, entry: SecurityEntry) {
  // Never before the latest event (QA-04): the list reads newest first and the Worker's clock may lag a few milliseconds.
  return db.prepare("INSERT INTO security_events(id,organization_id,type,outcome,actor_id,subject_id,method,detail,device,country,occurred_at) VALUES (?,?,?,?,?,?,?,?,?,?,max(?,COALESCE((SELECT max(occurred_at) FROM security_events WHERE organization_id=?),'')))")
    .bind(`security-${crypto.randomUUID()}`, entry.organizationId, entry.type, entry.outcome || "info", entry.actorId ?? null, entry.subjectId ?? null, entry.method ?? null,
      entry.detail ? entry.detail.slice(0, 240) : null, entry.client?.device ?? null, entry.client?.country ?? null, new Date().toISOString(), entry.organizationId);
}
type Row = SecurityRow & { actorId: string | null; subjectId: string | null };
function where(filter: SecurityFilter) {
  const [from, to] = securityRange(filter);
  const clauses = ["e.organization_id=?", "e.occurred_at>=?", "e.occurred_at<?"], values: (string | number)[] = [from, to];
  if (filter.person) { clauses.push("(e.subject_id=? OR e.actor_id=?)"); values.push(filter.person, filter.person); }
  if (filter.type) { clauses.push("e.type=?"); values.push(filter.type); }
  if (filter.before) { clauses.push("e.occurred_at<?"); values.push(filter.before); }
  return { sql: clauses.join(" AND "), values };
}
async function rows(db: Database, organizationId: string, filter: SecurityFilter, limit: number) {
  const { sql, values } = where(filter);
  // nosemgrep: sql-interpolated-text -- las cláusulas son constantes de `where`; los valores van como parámetros
  return (await db.prepare(`SELECT e.id,e.type,e.outcome,e.actor_id AS actorId,e.subject_id AS subjectId,COALESCE(a.display_name,a.username) AS actorName,COALESCE(s.display_name,s.username) AS subjectName,
      e.method,e.detail,e.device,e.country,e.occurred_at AS occurredAt,e.hash FROM security_events e LEFT JOIN users a ON a.id=e.actor_id LEFT JOIN users s ON s.id=e.subject_id
      WHERE ${sql} ORDER BY e.occurred_at DESC,e.rowid DESC LIMIT ?`).bind(organizationId, ...values, limit).all<Row>()).results;
}

const personSessions = /^\/api\/security\/people\/([a-z0-9-]{1,100})\/sessions$/;
/** Allowed methods of the security routes; null for any other path. */
export function securityMethodsOf(path: string): string[] | null {
  if (["/api/security/events", "/api/security/events/export", "/api/security/chain", "/api/security/audit"].includes(path)) return ["GET"];
  if (path === "/api/security/policy") return ["GET", "PUT"];
  if (path === "/api/security/access-review") return ["GET"];
  if (personSessions.test(path) || /^\/api\/security\/people\/[a-z0-9-]{1,100}\/mfa$/.test(path)) return ["DELETE"];
  return null;
}
export const isSecurityPath = (path: string) => path.startsWith("/api/security/");

/** /api/security/…: the log, its export and chain, the audit, and closing every session of a person. Administration only. */
export async function security(path: string, method: string, url: URL, current: Member, db: Database, client: Client): Promise<Response> {
  if (current.role !== "admin") return reply({ error: "Solo administración consulta la seguridad de la organización." }, 403);
  const org = current.organizationId;
  if (path === "/api/security/chain") return reply({ chain: await verifySecurityChain(db, org) });
  const target = personSessions.exec(path)?.[1];
  if (target) {
    if (target === current.id) return reply({ error: "Para cerrar tus propias sesiones usa «Cerrar las demás sesiones» en tu cuenta." }, 409);
    const person = await db.prepare("SELECT COALESCE(u.display_name,u.username) AS name FROM users u JOIN memberships m ON m.user_id=u.id WHERE u.id=? AND m.organization_id=?").bind(target, org).first<{ name: string }>();
    if (!person) return reply({ error: "Miembro no disponible." }, 404);
    const now = Date.now();
    const [open] = await db.batch([
      db.prepare("SELECT count(*) AS n FROM sessions WHERE user_id=? AND expires_at>?").bind(target, now),
      db.prepare("DELETE FROM sessions WHERE user_id=?").bind(target),
    ]) as unknown as [{ n: number }[]];
    const closed = open[0]?.n || 0;
    await db.batch([
      securityEvent(db, { organizationId: org, type: "sessions_closed", actorId: current.id, subjectId: target, detail: `${closed} ${closed === 1 ? "sesión abierta" : "sesiones abiertas"}`, client }),
      event(db, current, { action: "revoked", targetType: "account", targetId: target, summary: `Cerró las sesiones abiertas de ${person.name}` }),
    ]);
    return reply({ closed });
  }
  if (path === "/api/security/access-review") return accessReview(current, db, client);
  const filter = securityFilter(url.searchParams);
  if (!filter) return reply({ error: "Revisa los filtros: persona, tipo de evento y fechas (AAAA-MM-DD, desde antes de hasta)." }, 400);
  if (path === "/api/security/audit") return audit(filter, url.searchParams.get("objeto"), org, db);
  if (path === "/api/security/events/export") {
    const list = await rows(db, org, { ...filter, before: null }, 20000);
    await db.batch([securityEvent(db, { organizationId: org, type: "log_exported", actorId: current.id, detail: `${list.length} eventos${filter.from || filter.to ? ` del ${filter.from || "inicio"} al ${filter.to || "día de hoy"}` : ""}`, client })]);
    const name = `registro-de-seguridad-${new Date().toISOString().slice(0, 10)}.csv`;
    return new Response(securityCsv(list), { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="${name}"` } });
  }
  const list = await rows(db, org, filter, filter.limit + 1);
  return reply({ events: list.slice(0, filter.limit).map(({ hash: _, ...row }) => row), more: list.length > filter.limit });
}

/** The object types of the audit and what they are called. */
export const auditObjects: Record<string, string> = {
  account: "Cuentas y roles", legal: "Términos, privacidad y contratos", invitation: "Invitaciones", profile: "Perfiles profesionales", credential: "Credenciales",
  course: "Cursos", team: "Equipos docentes", group: "Secciones", session: "Clases", program: "Programas", module: "Módulos", lesson: "Lecciones", resource: "Recursos",
  competency: "Competencias", outcome: "Resultados de aprendizaje",
};
/**
 * ST-068: the history of critical actions and of role changes, filtered by person, object and date. Unlike the activity
 * each person sees of their courses, it covers the whole organization and is for administration only.
 */
async function audit(filter: SecurityFilter, object: string | null, org: string, db: Database) {
  if (object && !Object.hasOwn(auditObjects, object)) return reply({ error: "Elige un tipo de objeto de la lista." }, 400);
  const [from, to] = securityRange(filter);
  const clauses = ["e.organization_id=?", "e.occurred_at>=?", "e.occurred_at<?"], values: string[] = [org, from, to];
  if (filter.person) { clauses.push("(e.actor_id=? OR e.target_id=?)"); values.push(filter.person, filter.person); }
  if (object) { clauses.push("e.target_type=?"); values.push(object); }
  if (filter.before) { clauses.push("e.occurred_at<?"); values.push(filter.before); }
  const roleClauses = ["r.occurred_at>=?", "r.occurred_at<?"], roleValues: string[] = [from, to];
  if (filter.person) { roleClauses.push("(r.member_id=? OR r.actor_id=?)"); roleValues.push(filter.person, filter.person); }
  const [events, roles] = await db.batch([
    // nosemgrep: sql-interpolated-text -- las cláusulas son constantes; los valores van como parámetros
    db.prepare(`SELECT e.id,e.action,e.target_type AS targetType,e.target_id AS targetId,e.summary,e.occurred_at AS occurredAt,e.actor_id AS actorId,COALESCE(u.display_name,u.username) AS actorName
      FROM activity_events e JOIN users u ON u.id=e.actor_id WHERE ${clauses.join(" AND ")} ORDER BY e.occurred_at DESC,e.rowid DESC LIMIT ?`).bind(...values, filter.limit + 1),
    // nosemgrep: sql-interpolated-text -- las cláusulas son constantes; los valores van como parámetros
    db.prepare(`SELECT r.id,r.role,r.active,r.occurred_at AS occurredAt,r.actor_id AS actorId,COALESCE(a.display_name,a.username) AS actorName,r.member_id AS memberId,COALESCE(m.display_name,m.username) AS memberName
      FROM role_events r LEFT JOIN users a ON a.id=r.actor_id LEFT JOIN users m ON m.id=r.member_id WHERE ${roleClauses.join(" AND ")} ${object && object !== "account" ? "AND 0" : ""} ORDER BY r.occurred_at DESC LIMIT 100`).bind(...roleValues),
  ]) as unknown as [Record<string, unknown>[], (Record<string, unknown> & { active: number })[]];
  return reply({ events: events.slice(0, filter.limit), more: events.length > filter.limit, roleChanges: roles.map(row => ({ ...row, active: !!row.active })), objects: auditObjects });
}

/**
 * ST-189 CA3: the periodic review of who can enter and with what. One row per person: role, access, coordination,
 * security groups, second factor, passkeys, linked accounts, active tokens and last sign-in. The export is logged.
 */
async function accessReview(current: Member, db: Database, client: Client) {
  const rows = (await db.prepare(`SELECT u.username,COALESCE(u.display_name,u.username) AS name,CASE m.role WHEN 'instructor' THEN 'Educador' ELSE 'Administración' END AS role,m.active,
      (SELECT group_concat(cs.program_id) FROM coordination_scopes cs WHERE cs.user_id=u.id) AS coordination,
      (SELECT group_concat(g.name, '; ') FROM security_group_members gm JOIN security_groups g ON g.id=gm.group_id WHERE gm.user_id=u.id) AS groups,
      EXISTS (SELECT 1 FROM totp_factors f WHERE f.user_id=u.id AND f.status='active') AS mfa,
      (SELECT count(*) FROM passkeys p WHERE p.user_id=u.id) AS passkeys,
      (SELECT group_concat(l.provider) FROM linked_identities l WHERE l.user_id=u.id) AS providers,
      (SELECT count(*) FROM access_tokens t WHERE t.user_id=u.id AND t.revoked_at IS NULL AND t.expires_at>?) AS tokens,
      (SELECT max(s.occurred_at) FROM sign_in_events s WHERE s.user_id=u.id AND s.outcome='succeeded') AS lastSignIn
    FROM users u JOIN memberships m ON m.user_id=u.id AND m.organization_id=? ORDER BY m.active DESC,m.role,name`).bind(new Date().toISOString(), current.organizationId).all<Record<string, string | number | null>>()).results;
  const cell = (value: unknown) => { const text = String(value ?? ""); const safe = /^[=+\-@\t\r]/.test(text) ? `'${text}` : text; return /[",\n\r;]/.test(safe) ? `"${safe.replaceAll('"', '""')}"` : safe; };
  const header = ["Usuario", "Nombre", "Rol", "Acceso", "Coordinación", "Grupos de seguridad", "Verificación en dos pasos", "Passkeys", "Cuentas vinculadas", "Tokens activos", "Último inicio de sesión (UTC)"];
  const lines = rows.map(row => [row.username, row.name, row.role, row.active ? "Activo" : "Sin acceso", row.coordination === "*" ? "Todos los programas" : row.coordination, row.groups, row.mfa ? "Sí" : "No", row.passkeys, row.providers, row.tokens, row.lastSignIn].map(cell).join(","));
  await db.batch([securityEvent(db, { organizationId: current.organizationId, type: "access_review_exported", actorId: current.id, detail: `${rows.length} personas`, client })]);
  return new Response("\uFEFF" + [header.join(","), ...lines].join("\r\n") + "\r\n", { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="revision-de-accesos-${new Date().toISOString().slice(0, 10)}.csv"` } });
}
