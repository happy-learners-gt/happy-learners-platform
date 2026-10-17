import type { ClosureRequest, Member, MyClosure } from "@happy-learners/contracts";
import type { ClosureStatus } from "@happy-learners/domain";
import { closureReasonInput, closureTransition, maxClosureReason } from "@happy-learners/domain";
import type { Database } from "./storage";
import { event } from "./team";
import { sendNotice, type AccountContext } from "./account-notices";

/**
 * ST-159: closing the account. The person asks (/api/me/closure) and may cancel until administration starts it;
 * administration lists the requests (/api/closures) and starts one (/api/closures/:id/start), then completes it by
 * recording the person's departure (ST-123, /api/members/:id/departure), which ends their access and keeps everything
 * they did. Requests and their transitions are rows of account_closures and entries of the activity.
 */
const reply = (value: unknown, status = 200) => Response.json(value, { status });
const startPath = /^\/api\/closures\/(closure-[a-f0-9-]{36})\/start$/;

export function closureMethods(path: string): string[] | null {
  if (path === "/api/me/closure") return ["GET", "POST", "DELETE"];
  if (path === "/api/closures") return ["GET"];
  if (startPath.test(path)) return ["POST"];
  return null;
}

const columns = `SELECT c.id,c.user_id AS userId,COALESCE(u.display_name,u.username) AS personName,u.username,c.status,c.reason,c.requested_at AS requestedAt,c.started_at AS startedAt,
  COALESCE(s.display_name,s.username) AS startedBy,c.completed_at AS completedAt,c.cancelled_at AS cancelledAt,d.departed_on AS departedOn
  FROM account_closures c JOIN users u ON u.id=c.user_id LEFT JOIN users s ON s.id=c.started_by LEFT JOIN departures d ON d.id=c.departure_id`;
const blockedFor = (current: Member) => current.id === "user-0" ? "La cuenta administradora inicial no se puede cerrar: es la que conserva el acceso a la organización." : null;

/** The person's requests, newest first. */
export const closuresOf = (db: Database, current: Member) =>
  db.prepare(`${columns} WHERE c.user_id=? AND c.organization_id=? ORDER BY c.requested_at DESC,c.rowid DESC LIMIT 20`).bind(current.id, current.organizationId).all<ClosureRequest>();

export async function closures(path: string, method: string, input: unknown, current: Member, db: Database, context: AccountContext): Promise<Response> {
  const now = new Date().toISOString();
  if (path === "/api/me/closure") {
    const history = (await closuresOf(db, current)).results, open = history.find(item => item.status === "requested" || item.status === "in_progress") || null;
    const mine = (): Promise<MyClosure> => closuresOf(db, current).then(({ results }) => ({ closure: results.find(item => item.status === "requested" || item.status === "in_progress") || results[0] || null, history: results, blocked: blockedFor(current) }));
    if (method === "GET") return reply(await mine());
    if (method === "DELETE") {
      if (!open) return reply({ error: "No tienes una solicitud de cierre pendiente." }, 404);
      if (!closureTransition(open.status, "cancel")) return reply({ error: "Administración ya inició el cierre de tu cuenta. Si quieres conservarla, habla con administración." }, 409);
      const ok = await db.guardedBatch(db.prepare("SELECT 1 FROM account_closures WHERE id=? AND status='requested'").bind(open.id), [
        db.prepare("UPDATE account_closures SET status='cancelled',cancelled_at=max(?,requested_at) WHERE id=? AND status='requested'").bind(now, open.id),
        event(db, current, { action: "withdrawn", targetType: "account", targetId: open.id, summary: "Canceló su solicitud de cierre de cuenta" }),
      ]);
      if (!ok) return reply({ error: "Administración ya inició el cierre de tu cuenta. Si quieres conservarla, habla con administración." }, 409);
      return reply(await mine());
    }
    const blocked = blockedFor(current);
    if (blocked) return reply({ error: blocked }, 409);
    if (open) return reply({ error: "Ya pediste cerrar tu cuenta. Puedes cancelar la solicitud mientras administración no la inicie." }, 409);
    const reason = closureReasonInput(input);
    if (reason === null) return reply({ error: `El motivo admite hasta ${maxClosureReason} caracteres, sin < ni >.` }, 400);
    const id = `closure-${crypto.randomUUID()}`;
    const ok = await db.guardedBatch(db.prepare("SELECT 1 WHERE NOT EXISTS (SELECT 1 FROM account_closures WHERE user_id=? AND status IN ('requested','in_progress'))").bind(current.id), [
      db.prepare("INSERT INTO account_closures(id,organization_id,user_id,status,reason,requested_at) VALUES (?,?,?,'requested',?,?)").bind(id, current.organizationId, current.id, reason, now),
      // The reason is the person's note to administration: it stays out of the activity.
      event(db, current, { action: "created", targetType: "account", targetId: id, summary: "Solicitó el cierre de su cuenta" }),
    ]);
    if (!ok) return reply({ error: "Ya pediste cerrar tu cuenta. Puedes cancelar la solicitud mientras administración no la inicie." }, 409);
    // Administration is told by e-mail (a mandatory account notice) and sees the request in Educadores.
    const admins = (await db.prepare("SELECT u.id,COALESCE(u.display_name,u.username) AS name,COALESCE(u.email,p.contact_email) AS email FROM users u JOIN memberships m ON m.user_id=u.id AND m.organization_id=? AND m.active=1 AND m.role='admin' LEFT JOIN staff_profiles p ON p.user_id=u.id WHERE u.id<>? ORDER BY u.id LIMIT 20")
      .bind(current.organizationId, current.id).all<{ id: string; name: string; email: string | null }>()).results;
    for (const admin of admins) await sendNotice(db, context.sender, current.organizationId, admin, id, { kind: "closure_requested", person: current.displayName || current.username, username: current.username, link: `${context.origin}/educadores#cierres` });
    return reply(await mine(), 201);
  }
  if (current.role !== "admin") return reply({ error: "Solo administración atiende las solicitudes de cierre de cuenta." }, 403);
  if (path === "/api/closures") {
    // Open requests first (oldest first: they have waited longest), then the latest closed ones.
    const rows = (await db.prepare(`${columns} WHERE c.organization_id=? ORDER BY CASE WHEN c.status IN ('requested','in_progress') THEN 0 ELSE 1 END,CASE WHEN c.status IN ('requested','in_progress') THEN c.requested_at END ASC,c.requested_at DESC LIMIT 50`)
      .bind(current.organizationId).all<ClosureRequest>()).results;
    return reply({ closures: rows });
  }
  const id = startPath.exec(path)![1];
  const found = await db.prepare(`${columns} WHERE c.id=? AND c.organization_id=?`).bind(id, current.organizationId).first<ClosureRequest>();
  if (!found) return reply({ error: "Solicitud no disponible." }, 404);
  if (found.userId === current.id) return reply({ error: "Tu propio cierre lo atiende otra persona de administración." }, 409);
  if (!closureTransition(found.status as ClosureStatus, "start")) return reply({ error: found.status === "cancelled" ? "La persona canceló esta solicitud." : found.status === "completed" ? "Esta cuenta ya se cerró." : "El cierre ya está en curso." }, 409);
  const ok = await db.guardedBatch(db.prepare("SELECT 1 FROM account_closures WHERE id=? AND status='requested'").bind(id), [
    db.prepare("UPDATE account_closures SET status='in_progress',started_at=max(?,requested_at),started_by=? WHERE id=? AND status='requested'").bind(now, current.id, id),
    event(db, current, { action: "updated", targetType: "account", targetId: id, summary: `Inició el cierre de la cuenta de ${found.personName}` }),
  ]);
  if (!ok) return reply({ error: "La solicitud cambió mientras la atendías. Recarga y vuelve a intentar." }, 409);
  const person = await db.prepare("SELECT u.id,COALESCE(u.display_name,u.username) AS name,COALESCE(u.email,p.contact_email) AS email FROM users u LEFT JOIN staff_profiles p ON p.user_id=u.id WHERE u.id=?").bind(found.userId).first<{ id: string; name: string; email: string | null }>();
  if (person) await sendNotice(db, context.sender, current.organizationId, person, `${id}:started`, { kind: "closure_started", username: found.username });
  return reply({ closure: await db.prepare(`${columns} WHERE c.id=?`).bind(id).first<ClosureRequest>() });
}

/**
 * Statements for recordDeparture (ST-123): an open request of the person becomes completed with the departure that
 * closes it, and the activity says so. Placed in the departure's own transaction, before nothing else depends on it.
 */
// Each later moment is never before the earlier ones: two requests may read the Worker's clock a few milliseconds apart.
export function completeClosure(db: Database, current: Member, userId: string, name: string, departureId: string, now: string) {
  return [
    db.prepare("INSERT INTO activity_events(id,organization_id,actor_id,action,target_type,target_id,course_id,group_id,summary,occurred_at) SELECT ?,?,?,'archived','account',c.id,NULL,NULL,?,? FROM account_closures c WHERE c.user_id=? AND c.organization_id=? AND c.status IN ('requested','in_progress')")
      .bind(`event-${crypto.randomUUID()}`, current.organizationId, current.id, `Completó el cierre de la cuenta de ${name} al registrar su salida`.slice(0, 240), now, userId, current.organizationId),
    db.prepare("UPDATE account_closures SET status='completed',completed_at=max(?,requested_at,COALESCE(started_at,requested_at)),departure_id=? WHERE user_id=? AND organization_id=? AND status IN ('requested','in_progress')").bind(now, departureId, userId, current.organizationId),
  ];
}
