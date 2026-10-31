import type { AccessEvent, GrantablePermission, Member, PermissionKey, ProgramScope, SecurityGroup } from "@happy-learners/contracts";
import { builtInRoles, grantedIn, grantsInput, permissionAreas, permissionCatalog, permissionsOf, reachLabels, scopeInput, scopeLabel, securityGroupInput } from "@happy-learners/domain";
import type { Database, Prepared } from "./storage";
import { event } from "./activity";

const reply = (value: unknown, status = 200) => Response.json(value, { status });
const now = () => new Date().toISOString();

/**
 * Roles and access (ST-128, ST-135, DEC-041). The signed-in person's coordination scope and group grants are read with
 * the session, in the same query, on every request: a change applies on the next request without caching.
 */
export const permissionColumns = `(SELECT json_group_array(cs.program_id) FROM coordination_scopes cs WHERE cs.user_id=u.id AND cs.organization_id=m.organization_id) AS coordinationScopes,
  (SELECT json_group_array(json_object('permission',g.permission,'programId',g.program_id)) FROM security_group_grants g JOIN security_group_members sm ON sm.group_id=g.group_id WHERE sm.user_id=u.id AND sm.organization_id=m.organization_id) AS groupGrants`;

const scopeOf = (programIds: string[]): ProgramScope | null => !programIds.length ? null : programIds.includes("*") ? { all: true } : { programs: [...programIds].sort() };
const rowsOf = (scope: ProgramScope) => "all" in scope ? ["*"] : scope.programs;
const sameScope = (a: ProgramScope | null, b: ProgramScope | null) => JSON.stringify(a) === JSON.stringify(b);

/** The member with their effective permissions, from the columns above. */
export function withPermissions<T extends Member>(row: T & { coordinationScopes?: string | null; groupGrants?: string | null }): Member {
  const { coordinationScopes, groupGrants, ...member } = row;
  const coordination = member.role === "admin" ? null : scopeOf(JSON.parse(coordinationScopes || "[]") as string[]);
  const grants = member.role === "admin" ? [] : (JSON.parse(groupGrants || "[]") as { permission: string; programId: string }[]).map(grant => ({ permission: grant.permission, programId: grant.programId === "*" ? null : grant.programId }));
  return { ...member, permissions: permissionsOf(member, grants, coordination) };
}

/** Courses where the person holds any of the permissions; administration's reach is not listed here (it is everything). */
export async function scopedCourses(db: Database, current: Member, keys: PermissionKey[]): Promise<string[]> {
  if (current.role === "admin" || !keys.some(key => current.permissions?.grants[key])) return [];
  const courses = (await db.prepare("SELECT id,program_id AS programId FROM courses WHERE organization_id=?").bind(current.organizationId).all<{ id: string; programId: string | null }>()).results;
  return courses.filter(course => { const granted = grantedIn(current.permissions, course.programId); return keys.some(key => granted.has(key)); }).map(course => course.id);
}

async function programNames(db: Database, organizationId: string) {
  const rows = (await db.prepare("SELECT id,name,status FROM study_programs WHERE organization_id=? ORDER BY name,id").bind(organizationId).all<{ id: string; name: string; status: string }>()).results;
  return { rows, names: Object.fromEntries(rows.map(row => [row.id, row.name])) as Record<string, string> };
}
const knownPrograms = (scope: ProgramScope, names: Record<string, string>) => "all" in scope || scope.programs.every(id => names[id]);

function audit(db: Database, current: Member, action: string, subjectType: "group" | "coordination", subjectId: string, summary: string) {
  return db.prepare("INSERT INTO access_events(id,organization_id,actor_id,action,subject_type,subject_id,summary,occurred_at) VALUES (?,?,?,?,?,?,?,?)")
    .bind(`access-${crypto.randomUUID()}`, current.organizationId, current.id, action, subjectType, subjectId, summary.slice(0, 400), now());
}

/** Coordination profiles of the organization, by person. */
export async function coordinators(db: Database, organizationId: string) {
  const rows = (await db.prepare("SELECT cs.user_id AS userId,COALESCE(u.display_name,u.username) AS name,u.username,group_concat(cs.program_id) AS programs FROM coordination_scopes cs JOIN users u ON u.id=cs.user_id JOIN memberships m ON m.user_id=cs.user_id AND m.organization_id=cs.organization_id WHERE cs.organization_id=? AND m.role='instructor' GROUP BY cs.user_id ORDER BY name").bind(organizationId).all<{ userId: string; name: string; username: string; programs: string }>()).results;
  return rows.map(({ programs, ...row }) => ({ ...row, scope: scopeOf(programs.split(","))! }));
}

/**
 * PUT /api/members/:id/coordination {enabled, scope:{all:true}|{programs:[ids]}} — administration assigns, changes or
 * removes the academic coordination profile of an educator (ST-128, DEC-041). Each change is written to the activity
 * and to the access audit, and closes the person's open sessions.
 */
export async function setCoordination(id: string, input: unknown, current: Member, db: Database) {
  const value = input as Record<string, unknown> | null;
  if (!value || typeof value.enabled !== "boolean") return reply({ error: "Indica si la persona tiene el perfil de coordinación y su alcance." }, 400);
  const scope = value.enabled ? scopeInput(value.scope) : null;
  if (value.enabled && !scope) return reply({ error: "Elige todos los programas o al menos un programa para el alcance de la coordinación." }, 400);
  const target = await db.prepare("SELECT m.role,m.active,COALESCE(u.display_name,u.username) AS name FROM memberships m JOIN users u ON u.id=m.user_id WHERE m.user_id=? AND m.organization_id=?").bind(id, current.organizationId).first<{ role: string; active: number; name: string }>();
  if (!target) return reply({ error: "Miembro no disponible." }, 404);
  if (target.role !== "instructor") return reply({ error: "La coordinación académica es un perfil de un educador. Administración ya tiene todos los accesos." }, 409);
  if (scope && !target.active) return reply({ error: "Da acceso a la cuenta antes de asignarle la coordinación." }, 409);
  const { names } = await programNames(db, current.organizationId);
  if (scope && !knownPrograms(scope, names)) return reply({ error: "Elige programas de tu organización." }, 400);
  const before = scopeOf((await db.prepare("SELECT program_id AS id FROM coordination_scopes WHERE user_id=? AND organization_id=?").bind(id, current.organizationId).all<{ id: string }>()).results.map(row => row.id));
  if (sameScope(before, scope)) return reply({ coordination: scope, changed: false });
  const summary = !scope ? `Retiró la coordinación académica de ${target.name}`
    : before ? `Cambió el alcance de la coordinación académica de ${target.name} a ${scopeLabel(scope, names)}`
    : `Asignó la coordinación académica a ${target.name} en ${scopeLabel(scope, names)}`;
  const action = !scope ? "revoked" : before ? "updated" : "assigned", at = now();
  await db.batch([
    db.prepare("DELETE FROM coordination_scopes WHERE user_id=? AND organization_id=?").bind(id, current.organizationId),
    ...(scope ? rowsOf(scope).map(program => db.prepare("INSERT INTO coordination_scopes(user_id,organization_id,program_id,assigned_by,assigned_at) VALUES (?,?,?,?,?)").bind(id, current.organizationId, program, current.id, at)) : []),
    // A change of profile closes the person's sessions: they sign in again with what they can do now.
    db.prepare("DELETE FROM sessions WHERE user_id=?").bind(id),
    event(db, current, { action: action as "assigned" | "updated" | "revoked", targetType: "account", targetId: id, summary }),
    audit(db, current, action, "coordination", id, summary),
  ]);
  return reply({ coordination: scope, changed: true });
}

async function groupsOf(db: Database, organizationId: string, only?: string): Promise<SecurityGroup[]> {
  const [groups, grants, members] = await db.batch([
    db.prepare(`SELECT id,name,description,version,updated_at AS updatedAt FROM security_groups WHERE organization_id=?${only ? " AND id=?" : ""} ORDER BY name,id`).bind(organizationId, ...(only ? [only] : [])),
    db.prepare("SELECT group_id AS groupId,permission,program_id AS programId FROM security_group_grants WHERE organization_id=? ORDER BY permission,program_id").bind(organizationId),
    db.prepare("SELECT sm.group_id AS groupId,sm.user_id AS userId,COALESCE(u.display_name,u.username) AS name,u.username FROM security_group_members sm JOIN users u ON u.id=sm.user_id WHERE sm.organization_id=? ORDER BY name").bind(organizationId),
  ]) as unknown as [Omit<SecurityGroup, "grants" | "members">[], { groupId: string; permission: GrantablePermission; programId: string }[], { groupId: string; userId: string; name: string; username: string }[]];
  return groups.map(group => {
    const own = grants.filter(grant => grant.groupId === group.id);
    return {
      ...group,
      grants: [...new Set(own.map(grant => grant.permission))].map(permission => ({ permission, scope: scopeOf(own.filter(grant => grant.permission === permission).map(grant => grant.programId))! })),
      members: members.filter(member => member.groupId === group.id).map(({ groupId: _, ...member }) => member),
    };
  });
}

const missing = () => reply({ error: "El grupo de seguridad no está disponible." }, 404);
const permissionLabel = (key: string) => permissionCatalog.find(item => item.key === key)?.label || key;

/**
 * /api/access/* — the access matrix (ST-135): administration reads the catalog by area against the built-in roles and
 * the security groups, creates groups, grants them permissions with a program scope and adds people. Every change is
 * audited and applies on the person's next request.
 */
export async function accessMatrix(path: string, method: string, input: unknown, current: Member, db: Database) {
  if (current.role !== "admin") return reply({ error: "Solo administración gestiona los roles y accesos." }, 403);
  const [, , , area, id, sub] = path.split("/");
  if (area === "matrix") {
    const [{ rows: programs }, groups, coordination, events] = await Promise.all([
      programNames(db, current.organizationId), groupsOf(db, current.organizationId), coordinators(db, current.organizationId),
      db.prepare("SELECT e.id,COALESCE(u.display_name,u.username) AS actorName,e.action,e.subject_type AS subjectType,e.subject_id AS subjectId,e.summary,e.occurred_at AS occurredAt FROM access_events e JOIN users u ON u.id=e.actor_id WHERE e.organization_id=? ORDER BY e.occurred_at DESC,e.rowid DESC LIMIT 50").bind(current.organizationId).all<AccessEvent>(),
    ]);
    return reply({ areas: permissionAreas, catalog: permissionCatalog, roles: builtInRoles, reachLabels, groups, coordinators: coordination, programs, events: events.results });
  }
  if (area !== "groups") return reply({ error: "Ruta no disponible." }, 404);
  if (!id) {
    if (method === "GET") return reply({ groups: await groupsOf(db, current.organizationId) });
    const data = securityGroupInput(input);
    if (!data) return reply({ error: "Escribe un nombre de 2 a 80 caracteres y, si quieres, una descripción de hasta 300." }, 400);
    const groupId = `security-group-${crypto.randomUUID()}`, at = now();
    const created = await db.guardedBatch(db.prepare("SELECT 1 WHERE NOT EXISTS (SELECT 1 FROM security_groups WHERE organization_id=? AND name_key=?)").bind(current.organizationId, data.name.toLocaleLowerCase("es")), [
      db.prepare("INSERT INTO security_groups(id,organization_id,name,name_key,description,created_at,updated_at) VALUES (?,?,?,?,?,?,?)").bind(groupId, current.organizationId, data.name, data.name.toLocaleLowerCase("es"), data.description, at, at),
      audit(db, current, "created", "group", groupId, `Creó el grupo de seguridad «${data.name}»`),
    ]);
    if (!created) return reply({ error: `Ya existe un grupo llamado «${data.name}».` }, 409);
    return reply({ group: (await groupsOf(db, current.organizationId, groupId))[0] }, 201);
  }
  const [group] = await groupsOf(db, current.organizationId, id);
  if (!group) return missing();
  const touch = db.prepare("UPDATE security_groups SET version=version+1,updated_at=? WHERE id=?").bind(now(), id);
  if (!sub && method === "DELETE") {
    await db.batch([
      db.prepare("DELETE FROM security_group_grants WHERE group_id=?").bind(id),
      db.prepare("DELETE FROM security_group_members WHERE group_id=?").bind(id),
      db.prepare("DELETE FROM security_groups WHERE id=?").bind(id),
      audit(db, current, "deleted", "group", id, `Eliminó el grupo de seguridad «${group.name}» (${group.members.length === 1 ? "1 persona" : `${group.members.length} personas`} pierden sus permisos)`),
    ]);
    return reply({ ok: true });
  }
  if (!sub) {
    const data = securityGroupInput(input), version = (input as Record<string, unknown> | null)?.version;
    if (!data) return reply({ error: "Escribe un nombre de 2 a 80 caracteres y, si quieres, una descripción de hasta 300." }, 400);
    if (await db.prepare("SELECT 1 AS taken FROM security_groups WHERE organization_id=? AND name_key=? AND id<>?").bind(current.organizationId, data.name.toLocaleLowerCase("es"), id).first()) return reply({ error: `Ya existe un grupo llamado «${data.name}».` }, 409);
    const saved = await db.guardedBatch(db.prepare("SELECT 1 FROM security_groups WHERE id=? AND version=?").bind(id, Number.isInteger(version) ? Number(version) : -1), [
      db.prepare("UPDATE security_groups SET name=?,name_key=?,description=?,version=version+1,updated_at=? WHERE id=?").bind(data.name, data.name.toLocaleLowerCase("es"), data.description, now(), id),
      audit(db, current, "updated", "group", id, group.name === data.name ? `Actualizó la descripción del grupo «${data.name}»` : `Renombró el grupo «${group.name}» como «${data.name}»`),
    ]);
    if (!saved) return reply({ error: "El grupo cambió desde que lo abriste. Recarga antes de guardar." }, 409);
    return reply({ group: (await groupsOf(db, current.organizationId, id))[0] });
  }
  if (sub === "permissions") {
    const grants = grantsInput((input as Record<string, unknown> | null)?.grants);
    if (!grants) return reply({ error: "Elige permisos del catálogo, cada uno una vez, con todos los programas o una lista de programas. Los de administración no se otorgan a grupos." }, 400);
    const { names } = await programNames(db, current.organizationId);
    if (grants.some(grant => !knownPrograms(grant.scope, names))) return reply({ error: "Elige programas de tu organización." }, 400);
    const describe = (list: { permission: string; scope: ProgramScope }[]) => list.map(grant => `${permissionLabel(grant.permission)} (${scopeLabel(grant.scope, names)})`);
    const summary = grants.length ? `Cambió los permisos del grupo «${group.name}»: ${describe(grants).join("; ")}` : `Quitó todos los permisos del grupo «${group.name}»`;
    const statements: Prepared[] = [
      db.prepare("DELETE FROM security_group_grants WHERE group_id=?").bind(id),
      ...grants.flatMap(grant => rowsOf(grant.scope).map(program => db.prepare("INSERT INTO security_group_grants(group_id,organization_id,permission,program_id) VALUES (?,?,?,?)").bind(id, current.organizationId, grant.permission, program))),
      touch, audit(db, current, "granted", "group", id, summary),
    ];
    await db.batch(statements);
    return reply({ group: (await groupsOf(db, current.organizationId, id))[0] });
  }
  if (sub === "members") {
    const ids = (input as Record<string, unknown> | null)?.userIds;
    if (!Array.isArray(ids) || ids.length > 200 || ids.some(item => typeof item !== "string") || new Set(ids).size !== ids.length) return reply({ error: "Elige hasta 200 personas distintas." }, 400);
    const educators = (await db.prepare("SELECT u.id,COALESCE(u.display_name,u.username) AS name FROM users u JOIN memberships m ON m.user_id=u.id WHERE m.organization_id=? AND m.role='instructor'").bind(current.organizationId).all<{ id: string; name: string }>()).results;
    const kept = group.members.map(member => member.userId);
    // Former members who are no longer educators can stay; new members must be educators of the organization.
    if ((ids as string[]).some(item => !kept.includes(item) && !educators.some(person => person.id === item))) return reply({ error: "Agrega educadores de tu organización. Administración ya tiene todos los accesos." }, 400);
    const added = (ids as string[]).filter(item => !kept.includes(item)), removed = group.members.filter(member => !ids.includes(member.userId));
    if (!added.length && !removed.length) return reply({ group });
    const nameOf = (userId: string) => educators.find(person => person.id === userId)?.name || userId;
    const summary = [added.length ? `agregó a ${added.map(nameOf).join(", ")}` : "", removed.length ? `quitó a ${removed.map(member => member.name).join(", ")}` : ""].filter(Boolean).join(" y ");
    await db.batch([
      ...removed.map(member => db.prepare("DELETE FROM security_group_members WHERE group_id=? AND user_id=?").bind(id, member.userId)),
      ...added.map(userId => db.prepare("INSERT INTO security_group_members(group_id,user_id,organization_id,added_by,added_at) VALUES (?,?,?,?,?)").bind(id, userId, current.organizationId, current.id, now())),
      touch, audit(db, current, "members", "group", id, `En el grupo «${group.name}» ${summary}`),
    ]);
    return reply({ group: (await groupsOf(db, current.organizationId, id))[0] });
  }
  return reply({ error: "Ruta no disponible." }, 404);
}
