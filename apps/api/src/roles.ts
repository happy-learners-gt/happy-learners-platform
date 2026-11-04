import type { Member } from "@happy-learners/contracts";
import type { Database } from "./storage";
import { createAccount, resetPassword } from "./accounts";
import type { Notifier } from "./notify";
import { departurePreview, recordDeparture } from "./departures";
import { event } from "./activity";
import { setCoordination } from "./permissions";
import { profileOnLeave } from "./professional";
import { securityEvent } from "./security-log";

/** /api/members: administration lists people, creates accounts (ST-093), changes roles and access, resets passwords. */
export async function roles(path: string, method: string, input: unknown, current: Member, db: Database, taken: (username: string) => Promise<boolean>, notifier?: Notifier) {
  if (current.role !== "admin") return Response.json({ error: "Solo administración puede administrar educadores." }, { status: 403 });
  // ST-123: a departure, with its reassignments, at /api/members/:id/departure.
  // ST-128: the academic coordination profile, at /api/members/:id/coordination.
  if (path.endsWith("/coordination")) return setCoordination(path.split("/")[3], input, current, db);
  if (path.endsWith("/departure")) return method === "GET" ? departurePreview(path.split("/")[3], current, db) : recordDeparture(path.split("/")[3], input, current, db);
  if (method === "GET") {
    // Each person with what they lead, co-teach and have done: the basis for reviewing contributions.
    const rows = await db.prepare(`SELECT u.id,u.username,COALESCE(u.display_name,u.username) AS displayName,CASE m.role WHEN 'instructor' THEN 'educator' ELSE m.role END AS role,m.active,u.must_change_password AS mustChangePassword,u.email,
      (SELECT count(*) FROM course_members cm JOIN courses c ON c.id=cm.course_id WHERE cm.user_id=u.id AND cm.role='lead' AND c.status='active') AS leads,
      (SELECT count(*) FROM course_members cm JOIN courses c ON c.id=cm.course_id WHERE cm.user_id=u.id AND cm.role='co-teacher' AND c.status='active') AS coTeaches,
      (SELECT count(*) FROM section_educators e JOIN course_groups g ON g.id=e.group_id AND g.status='active' JOIN courses c ON c.id=g.course_id AND c.status='active' WHERE e.user_id=u.id) AS sections,
      (SELECT count(*) FROM activity_events e WHERE e.actor_id=u.id AND e.target_type='lesson' AND e.action='created') AS lessonsCreated,
      (SELECT count(*) FROM activity_events e WHERE e.actor_id=u.id AND e.action='published') AS publications,
      (SELECT count(DISTINCT e.target_id) FROM activity_events e WHERE e.actor_id=u.id AND e.target_type='session' AND e.action='recorded') AS attendance,
      (SELECT count(*) FROM activity_events e WHERE e.actor_id=u.id) AS events,
      (SELECT max(e.occurred_at) FROM activity_events e WHERE e.actor_id=u.id) AS lastActivity,
      (SELECT d.departed_on FROM departures d WHERE d.user_id=u.id AND d.organization_id=m.organization_id ORDER BY d.recorded_at DESC LIMIT 1) AS departedOn,
      (SELECT group_concat(cs.program_id) FROM coordination_scopes cs WHERE cs.user_id=u.id AND cs.organization_id=m.organization_id) AS coordinationScopes,
      EXISTS (SELECT 1 FROM totp_factors f WHERE f.user_id=u.id AND f.status='active') AS mfa,
      (SELECT group_concat(l.provider) FROM linked_identities l WHERE l.user_id=u.id) AS identities
      FROM users u JOIN memberships m ON m.user_id=u.id WHERE m.organization_id=? ORDER BY m.role,displayName`).bind(current.organizationId).all<Member & Record<string, number | string | null>>();
    return Response.json({ members: rows.results.map(m => ({ ...m, active: !!m.active, mfa: !!m.mfa, identities: m.identities ? String(m.identities).split(",") : [], mustChangePassword: m.mustChangePassword ? true : undefined, departedOn: m.departedOn || undefined,
      coordination: m.role === "educator" && m.coordinationScopes ? String(m.coordinationScopes).split(",").includes("*") ? { all: true } : { programs: String(m.coordinationScopes).split(",").sort() } : null, coordinationScopes: undefined })) });
  }
  if (method === "POST" && path === "/api/members") return createAccount(input, current, db, taken);
  if (method === "POST") return resetPassword(path.split("/")[3], current, db, notifier);
  if (!input || typeof input !== "object") return Response.json({ error: "Revisa el rol y estado." }, { status: 400 });
  const value = input as Record<string, unknown>;
  const id = path.split("/")[3];
  if (!["admin", "educator"].includes(String(value.role)) || typeof value.active !== "boolean") return Response.json({ error: "Selecciona un rol y estado válidos." }, { status: 400 });
  if (id === current.id || id === "user-0") return Response.json({ error: "La cuenta administradora inicial conserva su acceso." }, { status: 409 });
  const target = await db.prepare("SELECT m.role,m.active,COALESCE(u.display_name,u.username) AS name FROM memberships m JOIN users u ON u.id=m.user_id WHERE m.user_id=? AND m.organization_id=?").bind(id, current.organizationId).first<{ role: string; active: number; name: string }>();
  if (!target) return Response.json({ error: "Miembro no disponible." }, { status: 404 });
  // Turning access off keeps the account and everything it did; only its sessions and its calendar link (ST-125) end,
  // so a reactivated account asks for a new link instead of reviving the old one.
  const role = value.role === "educator" ? "instructor" : "admin", changes = [];
  if (target.role !== role) changes.push(event(db, current, { action: "updated", targetType: "account", targetId: id, summary: `Cambió el rol de ${target.name} a ${value.role === "admin" ? "Administración" : "Educador"}` }),
    securityEvent(db, { organizationId: current.organizationId, type: "role_changed", actorId: current.id, subjectId: id, detail: `De ${target.role === "admin" ? "Administración" : "Educador"} a ${value.role === "admin" ? "Administración" : "Educador"}` }));
  if (!!target.active !== value.active) changes.push(event(db, current, { action: value.active ? "restored" : "archived", targetType: "account", targetId: id, summary: `${value.active ? "Reactivó" : "Desactivó"} la cuenta de ${target.name}` }),
    securityEvent(db, { organizationId: current.organizationId, type: "access_changed", actorId: current.id, subjectId: id, detail: value.active ? "Cuenta reactivada" : "Cuenta desactivada; sus sesiones se cerraron" }));
  await db.batch([
    db.prepare("UPDATE memberships SET role=?,active=? WHERE user_id=? AND organization_id=?").bind(role, value.active ? 1 : 0, id, current.organizationId),
    db.prepare("DELETE FROM sessions WHERE user_id=?").bind(id),
    ...(value.active ? [] : [db.prepare("DELETE FROM calendar_feeds WHERE user_id=?").bind(id)]),
    // ST-156: losing access hides a published profile.
    ...(target.active && !value.active ? profileOnLeave(db, current, id, target.name, "deactivation") : []),
    db.prepare("INSERT INTO role_events VALUES (?,?,?,?,?,?)").bind(crypto.randomUUID(), current.id, id, String(value.role), value.active ? 1 : 0, new Date().toISOString()),
    ...changes,
  ]);
  return Response.json({ ok: true });
}
