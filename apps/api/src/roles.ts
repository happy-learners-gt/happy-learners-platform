import type { Member } from "@happy-learners/contracts";
import type { Database } from "./storage";

export async function roles(path: string, method: string, input: unknown, current: Member, db: Database) {
  if (current.role !== "admin") return Response.json({ error: "Solo administración puede administrar educadores." }, { status: 403 });
  if (method === "GET") {
    // Each person with what they lead, co-teach and have done: the basis for reviewing contributions.
    const rows = await db.prepare(`SELECT u.id,u.username,COALESCE(u.display_name,u.username) AS displayName,CASE m.role WHEN 'instructor' THEN 'educator' ELSE m.role END AS role,m.active,
      (SELECT count(*) FROM course_members cm JOIN courses c ON c.id=cm.course_id WHERE cm.user_id=u.id AND cm.role='lead' AND c.status='active') AS leads,
      (SELECT count(*) FROM course_members cm JOIN courses c ON c.id=cm.course_id WHERE cm.user_id=u.id AND cm.role='co-teacher' AND c.status='active') AS coTeaches,
      (SELECT count(*) FROM activity_events e WHERE e.actor_id=u.id AND e.target_type='lesson' AND e.action='created') AS lessonsCreated,
      (SELECT count(*) FROM activity_events e WHERE e.actor_id=u.id AND e.action='published') AS publications,
      (SELECT count(*) FROM activity_events e WHERE e.actor_id=u.id AND e.target_type='session') AS attendance,
      (SELECT count(*) FROM activity_events e WHERE e.actor_id=u.id) AS events,
      (SELECT max(e.occurred_at) FROM activity_events e WHERE e.actor_id=u.id) AS lastActivity
      FROM users u JOIN memberships m ON m.user_id=u.id WHERE m.organization_id=? ORDER BY m.role,displayName`).bind(current.organizationId).all<Member & Record<string, number | string | null>>();
    return Response.json({ members: rows.results.map(m => ({ ...m, active: !!m.active })) });
  }
  if (!input || typeof input !== "object") return Response.json({ error: "Revisa el rol y estado." }, { status: 400 });
  const value = input as Record<string, unknown>;
  const id = path.split("/")[3];
  if (!["admin", "educator"].includes(String(value.role)) || typeof value.active !== "boolean") return Response.json({ error: "Selecciona un rol y estado válidos." }, { status: 400 });
  if (id === current.id || id === "user-0") return Response.json({ error: "La cuenta administradora inicial conserva su acceso." }, { status: 409 });
  const target = await db.prepare("SELECT user_id FROM memberships WHERE user_id=? AND organization_id=?").bind(id, current.organizationId).first();
  if (!target) return Response.json({ error: "Miembro no disponible." }, { status: 404 });
  await db.batch([
    db.prepare("UPDATE memberships SET role=?,active=? WHERE user_id=? AND organization_id=?").bind(value.role === "educator" ? "instructor" : "admin", value.active ? 1 : 0, id, current.organizationId),
    db.prepare("DELETE FROM sessions WHERE user_id=?").bind(id),
    db.prepare("INSERT INTO role_events VALUES (?,?,?,?,?,?)").bind(crypto.randomUUID(), current.id, id, String(value.role), value.active ? 1 : 0, new Date().toISOString()),
  ]);
  return Response.json({ ok: true });
}
