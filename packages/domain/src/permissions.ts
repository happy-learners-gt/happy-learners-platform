import type { EffectivePermissions, GrantablePermission, PermissionArea, PermissionKey, ProgramScope } from "@happy-learners/contracts";

/**
 * Roles and access (ST-128, ST-135, DEC-041, DEC-043). One fixed catalog of permissions grouped by area. The grantable
 * ones reach an educator through the academic coordination profile or a security group, always within a program scope;
 * the administration ones belong to the administration role and are never granted to anyone else.
 */
export interface PermissionDefinition { key: PermissionKey; area: PermissionArea; label: string; description: string; grantable: boolean }

export const permissionAreas: { key: PermissionArea; label: string }[] = [
  { key: "content", label: "Contenido" },
  { key: "team", label: "Equipo docente" },
  { key: "classes", label: "Secciones y clases" },
  { key: "reports", label: "Reportes" },
  { key: "administration", label: "Administración" },
];

export const permissionCatalog: PermissionDefinition[] = [
  { key: "courses.view", area: "content", grantable: true, label: "Consultar cursos", description: "Ver los cursos del alcance con sus módulos, lecciones, plan curricular y recursos." },
  { key: "lessons.review", area: "content", grantable: true, label: "Revisar y publicar lecciones", description: "Revisar lecciones, devolverlas con observaciones y publicarlas como la persona responsable del curso." },
  { key: "teams.assign", area: "team", grantable: true, label: "Asignar el equipo del curso", description: "Elegir a la persona responsable y a quienes colaboran en cada curso del alcance." },
  { key: "sections.assign", area: "team", grantable: true, label: "Asignar educadores de sección", description: "Elegir, entre el equipo del curso, quiénes imparten cada sección." },
  { key: "classes.view", area: "classes", grantable: true, label: "Consultar secciones y clases", description: "Ver todas las secciones del alcance con su cronograma, asistencia y avance." },
  { key: "activity.view", area: "reports", grantable: true, label: "Consultar la actividad", description: "Ver la actividad de los cursos y secciones del alcance: quién creó, publicó o registró qué." },
  { key: "organization.configure", area: "administration", grantable: false, label: "Configurar la organización", description: "Nombre, zona horaria, días sin clase, programas, cursos, secciones y clasificaciones." },
  { key: "accounts.manage", area: "administration", grantable: false, label: "Gestionar cuentas, roles e invitaciones", description: "Crear cuentas, invitar, cambiar roles, restablecer contraseñas y registrar salidas." },
  { key: "access.manage", area: "administration", grantable: false, label: "Gestionar roles y accesos", description: "La matriz de accesos, los grupos de seguridad y los perfiles de coordinación." },
  { key: "backup.manage", area: "administration", grantable: false, label: "Respaldar y restaurar", description: "Descargar el respaldo de la organización y restaurarlo." },
  { key: "legal.manage", area: "administration", grantable: false, label: "Editar términos y privacidad", description: "Redactar y publicar los términos de uso y la política de privacidad." },
];
export const permissionKeys = permissionCatalog.map(item => item.key);
export const grantablePermissions = permissionCatalog.filter(item => item.grantable).map(item => item.key) as GrantablePermission[];
export const isGrantable = (value: unknown): value is GrantablePermission => typeof value === "string" && (grantablePermissions as string[]).includes(value);

/** How far a built-in role reaches with a permission, as the matrix shows it. */
export type Reach = "all" | "scope" | "team" | "assigned" | "lead";
export const reachLabels: Record<Reach, string> = { all: "Toda la organización", scope: "En su alcance", team: "En sus cursos", assigned: "En sus secciones", lead: "Si es responsable del curso" };
export type BuiltInRole = "admin" | "educator" | "coordination";
/**
 * The built-in roles, read-only in the matrix. Educators keep the course-team rules of DEC-023 and DEC-024; coordination
 * is DEC-041: within its scope it sees every course, section, schedule, attendance and progress, reviews and publishes
 * lessons like the lead and assigns course teams and section educators. Administration publishes lessons only when it
 * leads the course, as before.
 */
export const builtInRoles: { key: BuiltInRole; label: string; description: string; reach: Partial<Record<PermissionKey, Reach>> }[] = [
  { key: "admin", label: "Administración", description: "Configura la organización y su equipo.", reach: { "courses.view": "all", "lessons.review": "lead", "teams.assign": "all", "sections.assign": "all", "classes.view": "all", "activity.view": "all", "organization.configure": "all", "accounts.manage": "all", "access.manage": "all", "backup.manage": "all", "legal.manage": "all" } },
  { key: "educator", label: "Educador", description: "Prepara e imparte los cursos de su equipo.", reach: { "courses.view": "team", "lessons.review": "lead", "classes.view": "assigned", "activity.view": "team" } },
  { key: "coordination", label: "Coordinación académica", description: "Perfil adicional de un educador, con alcance de programas (DEC-041).", reach: { "courses.view": "scope", "lessons.review": "scope", "teams.assign": "scope", "sections.assign": "scope", "classes.view": "scope" } },
];
export const coordinationPermissions = Object.keys(builtInRoles[2].reach) as GrantablePermission[];

/** Whether a course of `programId` (null: no program) is inside the scope. */
export function inScope(scope: ProgramScope | undefined | null, programId: string | null | undefined): boolean {
  if (!scope) return false;
  return "all" in scope ? true : !!programId && scope.programs.includes(programId);
}
function merge(a: ProgramScope | undefined, b: ProgramScope): ProgramScope {
  if (!a) return "all" in b ? { all: true } : { programs: [...new Set(b.programs)].sort() };
  if ("all" in a || "all" in b) return { all: true };
  return { programs: [...new Set([...a.programs, ...b.programs])].sort() };
}

/** One permission a security group grants; a null program means every program. */
export interface GroupGrant { permission: string; programId: string | null }
/**
 * The effective permissions of a person: administration holds every permission everywhere; an educator holds the
 * coordination set within the profile's scope, plus what their security groups grant, merged by permission. Anything
 * outside the grantable catalog is ignored, so administration permissions never reach a group member.
 */
export function permissionsOf(member: { role: "admin" | "educator" }, groups: GroupGrant[], coordination: ProgramScope | null): EffectivePermissions {
  if (member.role === "admin") return { admin: true, coordination: null, grants: Object.fromEntries(permissionKeys.map(key => [key, { all: true }])) };
  const grants: EffectivePermissions["grants"] = {};
  const scope = coordination && ("all" in coordination || coordination.programs.length) ? coordination : null;
  if (scope) for (const key of coordinationPermissions) grants[key] = merge(grants[key], scope);
  for (const grant of groups) if (isGrantable(grant.permission)) grants[grant.permission] = merge(grants[grant.permission], grant.programId === null ? { all: true } : { programs: [grant.programId] });
  return { admin: false, coordination: scope, grants };
}
/** The permissions that apply to a course of `programId`. */
export function grantedIn(permissions: EffectivePermissions | undefined, programId: string | null | undefined): Set<PermissionKey> {
  const out = new Set<PermissionKey>();
  for (const [key, scope] of Object.entries(permissions?.grants || {})) if (inScope(scope, programId)) out.add(key as PermissionKey);
  return out;
}
/** Whether the person holds the permission anywhere. */
export const holds = (permissions: EffectivePermissions | undefined, key: PermissionKey) => !!permissions?.grants[key];

/** Input of a coordination profile or a grant: {all:true} or {programs:[ids]} with 1 to 50 distinct program ids. */
export function scopeInput(value: unknown): ProgramScope | null {
  if (!value || typeof value !== "object") return null;
  const v = value as Record<string, unknown>;
  if (v.all === true) return { all: true };
  if (!Array.isArray(v.programs) || !v.programs.length || v.programs.length > 50 || v.programs.some(id => typeof id !== "string" || !/^[a-z0-9-]{1,100}$/.test(id))) return null;
  const programs = [...new Set(v.programs as string[])].sort();
  return programs.length === v.programs.length ? { programs } : null;
}
/** A security group: a name of 2 to 80 characters and an optional description of up to 300. */
export function securityGroupInput(value: unknown): { name: string; description: string } | null {
  if (!value || typeof value !== "object") return null;
  const { name, description = "" } = value as Record<string, unknown>;
  if (typeof name !== "string" || typeof description !== "string") return null;
  const clean = name.trim().replace(/\s+/g, " ").normalize("NFC"), text = description.trim().normalize("NFC");
  if (clean.length < 2 || clean.length > 80 || text.length > 300 || /[<>\x00-\x1f]/.test(clean) || /[<>\x00-\x08\x0b-\x1f]/.test(text)) return null;
  return { name: clean, description: text };
}
/** The grants of a security group: grantable permissions only, each once, with a valid scope. */
export function grantsInput(value: unknown): { permission: GrantablePermission; scope: ProgramScope }[] | null {
  if (!Array.isArray(value) || value.length > grantablePermissions.length) return null;
  const out: { permission: GrantablePermission; scope: ProgramScope }[] = [];
  for (const item of value) {
    const permission = (item as Record<string, unknown> | null)?.permission, scope = scopeInput((item as Record<string, unknown> | null)?.scope);
    if (!isGrantable(permission) || !scope || out.some(grant => grant.permission === permission)) return null;
    out.push({ permission, scope });
  }
  return out;
}
/** "todos los programas" or the names of the programs, for summaries. */
export function scopeLabel(scope: ProgramScope, names: Record<string, string> = {}): string {
  if ("all" in scope) return "todos los programas";
  const list = scope.programs.map(id => names[id] || id);
  return list.length === 1 ? `el programa «${list[0]}»` : `los programas ${list.map(name => `«${name}»`).join(", ")}`;
}
