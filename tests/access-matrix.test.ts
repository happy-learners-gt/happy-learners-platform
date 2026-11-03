import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn, type ChildProcess } from "node:child_process";
import { createServer } from "node:net";
import { once } from "node:events";
import { setTimeout as delay } from "node:timers/promises";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { builtInRoles, coordinationPermissions, courseAccess, grantablePermissions, grantedIn, grantsInput, inScope, permissionCatalog, permissionsOf, scopeInput, securityGroupInput, seesSection, teachesSection } from "../packages/domain/src/index";
import { listenOnTestPort } from "./test-port";

// ST-128 (HL-174) academic coordination and ST-135 access matrix: one permission model. Domain rules first, then the
// built Worker on a fresh local store.
const primaria = "seed-program-primaria";

describe("HL-174 ST-128 ST-135 permission model", () => {
  it("ST-135 CA1 el catálogo agrupa permisos por área y los de administración nunca se otorgan", () => {
    expect(new Set(permissionCatalog.map(item => item.area))).toEqual(new Set(["content", "team", "classes", "reports", "administration"]));
    expect(permissionCatalog.filter(item => item.area === "administration").every(item => !item.grantable)).toBe(true);
    expect(grantablePermissions).toEqual(["courses.view", "lessons.review", "teams.assign", "sections.assign", "classes.view", "activity.view"]);
    expect(builtInRoles.map(role => role.key)).toEqual(["admin", "educator", "coordination"]);
    expect(coordinationPermissions).toEqual(["courses.view", "lessons.review", "teams.assign", "sections.assign", "classes.view"]);
  });
  it("permissionsOf: administración tiene todo; un educador sin perfil ni grupos no tiene permisos adicionales", () => {
    const admin = permissionsOf({ role: "admin" }, [{ permission: "activity.view", programId: "x" }], { programs: ["x"] });
    expect(admin.admin).toBe(true);
    expect(Object.keys(admin.grants)).toHaveLength(permissionCatalog.length);
    expect(permissionsOf({ role: "educator" }, [], null)).toEqual({ admin: false, coordination: null, grants: {} });
  });
  it("ST-128 CA2 permissionsOf: la coordinación otorga el conjunto de DEC-041 en su alcance y los grupos suman permisos", () => {
    const value = permissionsOf({ role: "educator" }, [{ permission: "activity.view", programId: "p2" }, { permission: "courses.view", programId: null }, { permission: "backup.manage", programId: null }, { permission: "accounts.manage", programId: "p1" }], { programs: ["p1"] });
    expect(value.coordination).toEqual({ programs: ["p1"] });
    expect(value.grants["lessons.review"]).toEqual({ programs: ["p1"] });
    expect(value.grants["courses.view"]).toEqual({ all: true });
    expect(value.grants["activity.view"]).toEqual({ programs: ["p2"] });
    // Administration permissions never reach a group member, whatever the stored rows say.
    expect(value.grants["backup.manage"]).toBeUndefined();
    expect(value.grants["accounts.manage"]).toBeUndefined();
    expect([...grantedIn(value, "p1")].sort()).toEqual([...coordinationPermissions].sort());
    expect([...grantedIn(value, "p2")].sort()).toEqual(["activity.view", "courses.view"]);
    expect([...grantedIn(value, null)]).toEqual(["courses.view"]);
    expect(permissionsOf({ role: "educator" }, [], { programs: [] }).grants).toEqual({});
    expect(inScope({ all: true }, null)).toBe(true);
    expect(inScope({ programs: ["p1"] }, null)).toBe(false);
  });
  it("ST-128 CA2 courseAccess: la coordinación ve todas las secciones, revisa y asigna, sin editar, configurar ni impartir", () => {
    const coordination = courseAccess(false, null, [], new Set(coordinationPermissions))!;
    expect(coordination).toMatchObject({ configure: false, edit: false, publish: false, review: true, team: true, educators: true, sections: "all" });
    expect([seesSection(coordination, "g"), teachesSection(coordination, "g")]).toEqual([true, false]);
    // Only activity: the course is visible, nothing else changes.
    expect(courseAccess(false, null, [], new Set(["activity.view"]))).toMatchObject({ review: false, team: false, educators: false, sections: "assigned" });
  });
  it("un educador sin permisos conserva exactamente sus reglas de equipo (DEC-023, DEC-024)", () => {
    expect(courseAccess(false, null, [])).toBeNull();
    expect(courseAccess(false, "co-teacher", ["g"])).toEqual({ role: "co-teacher", assigned: ["g"], configure: false, edit: true, publish: false, review: false, team: false, educators: false, sections: "assigned" });
    expect(courseAccess(false, "lead", [])).toMatchObject({ publish: true, review: true, team: false, educators: false, sections: "assigned" });
    expect(courseAccess(true, null, [])).toMatchObject({ configure: true, publish: false, review: false, team: true, educators: true, sections: "all" });
  });
  it("valida alcances, grupos y permisos de entrada", () => {
    expect(scopeInput({ all: true })).toEqual({ all: true });
    expect(scopeInput({ programs: ["b", "a"] })).toEqual({ programs: ["a", "b"] });
    for (const value of [null, {}, { programs: [] }, { programs: ["a", "a"] }, { programs: ["<x>"] }, { all: "yes" }]) expect(scopeInput(value)).toBeNull();
    expect(securityGroupInput({ name: "  Coordinación   de inglés ", description: "Apoyo" })).toEqual({ name: "Coordinación de inglés", description: "Apoyo" });
    expect(securityGroupInput({ name: "x" })).toBeNull();
    expect(grantsInput([{ permission: "activity.view", scope: { all: true } }])).toHaveLength(1);
    expect(grantsInput([{ permission: "backup.manage", scope: { all: true } }])).toBeNull();
    expect(grantsInput([{ permission: "activity.view", scope: { all: true } }, { permission: "activity.view", scope: { programs: ["a"] } }])).toBeNull();
  });
});

let worker: ChildProcess;
let origin = "";
let logs = "";
const storage = mkdtempSync(join(tmpdir(), "hl-platform-access-"));
beforeAll(async () => {
  const server = createServer();
  await listenOnTestPort(server);
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Missing local port");
  await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  origin = `http://127.0.0.1:${address.port}`;
  worker = spawn("node_modules/.bin/wrangler", ["dev", "--local", "--config", "build/wrangler.json", "--ip", "127.0.0.1", "--port", String(address.port), "--inspector-port", "0", "--persist-to", storage, "--var", "RESTORE_ENABLED:true"], {
    env: { ...process.env, WRANGLER_SEND_METRICS: "false", BROWSER: "none" }, stdio: ["ignore", "pipe", "pipe"],
  });
  worker.stdout?.on("data", chunk => { logs += chunk; });
  worker.stderr?.on("data", chunk => { logs += chunk; });
  for (let attempt = 0; attempt < 200; attempt++) {
    if (worker.exitCode !== null) throw new Error(logs);
    try { if ((await fetch(`${origin}/api/health`, { signal: AbortSignal.timeout(500) })).ok) return; } catch { /* Wait for the local runtime to start. */ }
    await delay(200);
  }
  throw new Error(`Local Worker did not start:\n${logs}`);
});
afterAll(async () => {
  if (worker && worker.exitCode === null) { const exited = once(worker, "exit"); worker.kill("SIGTERM"); await exited; }
  rmSync(storage, { recursive: true, force: true });
});

async function signIn(username: string, password = "Aprender-2026!") {
  const response = await fetch(`${origin}/api/login`, { method: "POST", headers: { "Content-Type": "application/json", Origin: origin }, body: JSON.stringify({ username, password }) });
  return response.status === 200 ? response.headers.get("set-cookie")!.split(";")[0] : null;
}
async function as(cookie: string | null, path: string, method = "GET", data?: unknown) {
  return fetch(`${origin}/api${path}`, { method, headers: { Cookie: cookie || "", Origin: origin, ...(data ? { "Content-Type": "application/json" } : {}) }, ...(data ? { body: JSON.stringify(data) } : {}) });
}
const json = async (cookie: string | null, path: string) => (await as(cookie, path)).json();
const courseIds = async (cookie: string | null) => ((await json(cookie, "/courses")).courses as { id: string }[]).map(course => course.id).sort();
const summaries = async (cookie: string | null, query = "") => ((await json(cookie, `/activity?limit=100${query}`)).events as { summary: string }[]).map(event => event.summary);
type Lesson = { id: string; status: string; courseId: string; title: string; review?: { status: string } | null };
const lessonsOf = async (cookie: string | null, course: string) => (await json(cookie, `/lessons?course=${course}&drafts=1`)).lessons as Lesson[];
const versionOf = async (cookie: string | null, course: string) => (await json(cookie, `/courses/${course}`)).course.version as number;

describe("HL-174 ST-128 coordinación académica on the built Worker", () => {
  let coordinator = "", primariaCourses: string[] = [];
  it("ST-128 CA1 administración asigna la coordinación con su alcance; nadie más puede, y el alcance se valida", async () => {
    const admin = await signIn("admin-demo"), carlos = await signIn("carlos.mejia");
    const members = (await json(admin, "/members")).members as { id: string; username: string; coordination: unknown }[];
    coordinator = members.find(row => row.username === "instructor-demo")!.id;
    expect(members.find(row => row.id === coordinator)!.coordination).toBeNull();
    expect((await as(carlos, `/members/${coordinator}/coordination`, "PUT", { enabled: true, scope: { all: true } })).status).toBe(403);
    for (const [input, status] of [
      [{ enabled: true }, 400], [{ enabled: true, scope: { programs: [] } }, 400], [{ enabled: true, scope: { programs: ["program-missing"] } }, 400], [{ scope: { all: true } }, 400],
    ] as const) expect((await as(admin, `/members/${coordinator}/coordination`, "PUT", input)).status, JSON.stringify(input)).toBe(status);
    expect((await as(admin, "/members/seed-user-marta/coordination", "PUT", { enabled: true, scope: { all: true } })).status).toBe(409);
    expect((await as(admin, "/members/user-missing/coordination", "PUT", { enabled: true, scope: { all: true } })).status).toBe(404);
    const response = await as(admin, `/members/${coordinator}/coordination`, "PUT", { enabled: true, scope: { programs: [primaria] } });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ coordination: { programs: [primaria] }, changed: true });
    expect(((await json(admin, "/members")).members as { id: string; coordination: unknown }[]).find(row => row.id === coordinator)!.coordination).toEqual({ programs: [primaria] });
    primariaCourses = ["seed-course-ciencias", "seed-course-mate6", "seed-course-matematicas"];
  });

  it("ST-128 CA3 el cambio de perfil queda en la actividad y en la auditoría, y revoca las sesiones abiertas", async () => {
    const admin = await signIn("admin-demo"), open = await signIn("instructor-demo");
    expect((await as(open, "/session")).status).toBe(200);
    expect((await as(admin, `/members/${coordinator}/coordination`, "PUT", { enabled: true, scope: { programs: [primaria, "seed-program-ingles"] } })).status).toBe(200);
    expect((await as(open, "/session")).status).toBe(401);
    // Same scope again: nothing changes, nothing is revoked.
    const again = await signIn("instructor-demo");
    expect(await (await as(admin, `/members/${coordinator}/coordination`, "PUT", { enabled: true, scope: { programs: ["seed-program-ingles", primaria] } })).json()).toMatchObject({ changed: false });
    expect((await as(again, "/session")).status).toBe(200);
    expect((await as(admin, `/members/${coordinator}/coordination`, "PUT", { enabled: true, scope: { programs: [primaria] } })).status).toBe(200);
    expect((await as(again, "/session")).status).toBe(401);
    const activity = await summaries(admin, `&actor=user-0`);
    expect(activity.some(text => text.startsWith("Asignó la coordinación académica a") && text.includes("Primaria bilingüe"))).toBe(true);
    expect(activity.some(text => text.startsWith("Cambió el alcance de la coordinación académica"))).toBe(true);
    const events = (await json(admin, "/access/matrix")).events as { subjectType: string; subjectId: string; action: string }[];
    expect(events.filter(item => item.subjectType === "coordination" && item.subjectId === coordinator).map(item => item.action)).toEqual(["updated", "updated", "assigned"]);
  });

  it("ST-128 CA2 la coordinación consulta los cursos, secciones, cronogramas, asistencia y avance de su alcance, y nada más", async () => {
    const session = await signIn("instructor-demo");
    const me = (await json(session, "/session")).member;
    expect(me.permissions.coordination).toEqual({ programs: [primaria] });
    expect(Object.keys(me.permissions.grants).sort()).toEqual([...coordinationPermissions].sort());
    expect(await courseIds(session)).toEqual(primariaCourses);
    const detail = await json(session, "/courses/seed-course-matematicas");
    expect(detail.course.access).toMatchObject({ configure: false, edit: false, publish: false, review: true, team: true, educators: true, sections: "all" });
    // Out of scope: other programs and courses without a program stay closed, as for any educator outside the team.
    expect((await as(session, "/courses/seed-course-english")).status).toBe(403);
    expect((await as(session, "/courses/course-exploradores")).status).toBe(403);
    const sections = ((await json(session, "/sections")).sections as { id: string; teaches: boolean }[]);
    expect(sections.map(item => item.id).sort()).toEqual(["seed-group-cie-4a", "seed-group-mat-3a", "seed-group-mat-3b", "seed-group-mat-6a"]);
    expect(sections.every(item => !item.teaches)).toBe(true);
    expect((await as(session, "/sections/seed-group-mat-3a")).status).toBe(200);
    expect((await as(session, "/sections/seed-group-eng-sab")).status).toBe(403);
    expect((await as(session, "/courses/seed-course-matematicas/groups")).status).toBe(200);
    expect((await as(session, "/courses/seed-course-matematicas/sessions")).status).toBe(200);
    expect((await as(session, "/courses/seed-course-english/sessions")).status).toBe(403);
    const progress = (await json(session, "/progress")).courses as { courseId: string; learners: number }[];
    expect(progress.map(item => item.courseId).sort()).toEqual(primariaCourses);
    expect(progress.find(item => item.courseId === "seed-course-matematicas")!.learners).toBeGreaterThan(0);
    // Seeing a section does not make the person teach it or edit the course.
    const lesson = (await lessonsOf(session, "seed-course-matematicas"))[0];
    expect((await as(session, `/lessons/${lesson.id}`, "PUT", { title: "x" })).status).toBe(403);
    expect((await as(session, "/courses/seed-course-matematicas/groups/seed-group-mat-3a/lessons", "POST", { lessonIds: [] })).status).toBe(403);
    expect((await as(session, "/lessons?course=seed-course-english&drafts=1")).ok && (await lessonsOf(session, "seed-course-english")).length).toBe(0);
  });

  it("ST-128 CA2 la coordinación revisa, devuelve con observaciones y publica lecciones como la persona responsable, solo en su alcance", async () => {
    const session = await signIn("instructor-demo"), carlos = await signIn("carlos.mejia"), admin = await signIn("admin-demo");
    const lesson = (await lessonsOf(carlos, "seed-course-matematicas")).find(item => item.status !== "archived")!;
    expect((await as(carlos, `/lessons/${lesson.id}/review`, "POST", { note: "Lista para revisar" })).status).toBe(201);
    const queue = (await json(session, "/reviews")).toReview as { lessonId: string }[];
    expect(queue.map(item => item.lessonId)).toContain(lesson.id);
    expect((await as(session, `/lessons/${lesson.id}/review/return`, "POST", { note: "Agrega una actividad de cierre." })).status).toBe(200);
    expect((await as(carlos, `/lessons/${lesson.id}/review`, "POST", { note: "Ajustada" })).status).toBe(201);
    const published = await as(session, `/lessons/${lesson.id}/publish`, "POST");
    expect(published.status, await published.clone().text()).toBe(200);
    // Publishing approves the request: it leaves the queue.
    expect(((await json(session, "/reviews")).toReview as { lessonId: string }[]).map(item => item.lessonId)).not.toContain(lesson.id);
    expect((await summaries(admin, "&course=seed-course-matematicas")).some(text => text.startsWith("Publicó"))).toBe(true);
    // Out of scope the lesson does not exist for the coordinator.
    const english = (await lessonsOf(admin, "seed-course-english"))[0];
    expect((await as(session, `/lessons/${english.id}/publish`, "POST")).status).toBe(404);
  });

  it("ST-128 CA2 la coordinación asigna responsable, colaboradores y educadores de sección en su alcance", async () => {
    const session = await signIn("instructor-demo");
    const team = [{ userId: "seed-user-lucia", role: "lead" }, { userId: "seed-user-carlos", role: "co-teacher" }, { userId: "seed-user-tomas", role: "co-teacher" }];
    const saved = await as(session, "/courses/seed-course-matematicas/team", "PUT", { members: team, version: await versionOf(session, "seed-course-matematicas") });
    expect(saved.status, await saved.clone().text()).toBe(200);
    const educators = await as(session, "/courses/seed-course-matematicas/groups/seed-group-mat-3a/educators", "PUT", { userIds: ["seed-user-lucia", "seed-user-tomas"], conflictReason: "Prueba de coordinación" });
    expect(educators.status, await educators.clone().text()).toBe(200);
    expect(((await educators.json()).educators as { userId: string }[]).map(item => item.userId).sort()).toEqual(["seed-user-lucia", "seed-user-tomas"]);
    const admin = await signIn("admin-demo");
    expect((await as(session, "/courses/seed-course-english/team", "PUT", { members: [{ userId: "seed-user-ana", role: "lead" }], version: await versionOf(admin, "seed-course-english") })).status).toBe(403);
    expect((await as(session, "/courses/seed-course-english/groups/seed-group-eng-sab/educators", "PUT", { userIds: ["seed-user-ana"] })).status).toBe(403);
  });

  it("ST-128 CA2 la coordinación no configura la organización ni cursos, ni gestiona cuentas, invitaciones, respaldo, términos o accesos", async () => {
    const session = await signIn("instructor-demo");
    for (const [path, method, data] of [
      ["/organization", "PUT", { name: "Otra", timezone: "America/Guatemala" }], ["/organization/backup", "GET"], ["/organization/restore", "POST", { tables: {} }],
      ["/members", "GET"], ["/members", "POST", { displayName: "Nueva", username: "nueva.persona", role: "educator" }], [`/members/${coordinator}/coordination`, "PUT", { enabled: true, scope: { all: true } }],
      ["/invitations", "GET"], ["/legal/documents", "GET"], ["/legal/documents/terms", "PUT", { body: "x" }], ["/access/matrix", "GET"], ["/access/groups", "POST", { name: "Mío" }],
      ["/programs", "POST", { name: "Nuevo" }], ["/courses", "POST", { title: "Nuevo" }], ["/courses/seed-course-matematicas/groups", "POST", { name: "3.º C" }],
      ["/courses/seed-course-matematicas", "PUT", { title: "Cambio" }], ["/courses/seed-course-matematicas/groups/seed-group-mat-3a/schedule", "PUT", {}],
    ] as const) expect((await as(session, path, method, data)).status, `${method} ${path}`).toBe(403);
  });

  it("ST-128 CA1 CA3 retirar el perfil revoca las sesiones y el acceso vuelve al de un educador sin cursos", async () => {
    const admin = await signIn("admin-demo"), session = await signIn("instructor-demo");
    expect(await (await as(admin, `/members/${coordinator}/coordination`, "PUT", { enabled: false })).json()).toEqual({ coordination: null, changed: true });
    expect((await as(session, "/session")).status).toBe(401);
    const again = await signIn("instructor-demo");
    expect(await courseIds(again)).toEqual([]);
    expect((await as(again, "/courses/seed-course-matematicas")).status).toBe(403);
    expect((await summaries(admin, "&actor=user-0")).some(text => text === "Retiró la coordinación académica de Instructor Demo" || text.startsWith("Retiró la coordinación académica de"))).toBe(true);
  });

  it("un educador sin coordinación ni grupos conserva sus cursos y secciones de equipo", async () => {
    const carlos = await signIn("carlos.mejia");
    expect((await json(carlos, "/session")).member.permissions).toEqual({ admin: false, coordination: null, grants: {} });
    expect(await courseIds(carlos)).toEqual(["seed-course-ciencias", "seed-course-matematicas"]);
    expect((await as(carlos, "/courses/seed-course-english")).status).toBe(403);
    expect((await json(carlos, "/courses/seed-course-ciencias")).course.access).toMatchObject({ role: "lead", publish: true, review: true, team: false, educators: false, sections: "assigned" });
    expect((await as(carlos, "/courses/seed-course-ciencias/team", "PUT", { members: [{ userId: "seed-user-carlos", role: "lead" }], version: 1 })).status).toBe(403);
  });
});

describe("HL-174 ST-135 matriz de accesos on the built Worker", () => {
  let groupId = "";
  it("ST-135 CA1 administración consulta la matriz de roles y permisos por área; nadie más", async () => {
    const admin = await signIn("admin-demo");
    const matrix = await json(admin, "/access/matrix");
    expect(matrix.areas.map((area: { key: string }) => area.key)).toEqual(["content", "team", "classes", "reports", "administration"]);
    expect(matrix.catalog).toHaveLength(permissionCatalog.length);
    expect(matrix.roles.map((role: { key: string }) => role.key)).toEqual(["admin", "educator", "coordination"]);
    expect(matrix.programs.map((program: { id: string }) => program.id)).toContain(primaria);
    expect((await as(await signIn("carlos.mejia"), "/access/matrix")).status).toBe(403);
    expect((await as(await signIn("carlos.mejia"), "/access/groups")).status).toBe(403);
  });

  it("ST-135 CA2 administración crea un grupo de seguridad, le asigna permisos y agrega personas", async () => {
    const admin = await signIn("admin-demo");
    const created = await as(admin, "/access/groups", "POST", { name: "Lectores de actividad", description: "Consultan la actividad de inglés" });
    expect(created.status).toBe(201);
    groupId = (await created.json()).group.id;
    expect((await as(admin, "/access/groups", "POST", { name: "lectores de actividad" })).status).toBe(409);
    expect((await as(admin, `/access/groups/${groupId}/permissions`, "PUT", { grants: [{ permission: "backup.manage", scope: { all: true } }] })).status).toBe(400);
    expect((await as(admin, `/access/groups/${groupId}/permissions`, "PUT", { grants: [{ permission: "activity.view", scope: { programs: ["program-missing"] } }] })).status).toBe(400);
    const granted = await as(admin, `/access/groups/${groupId}/permissions`, "PUT", { grants: [{ permission: "activity.view", scope: { programs: ["seed-program-ingles"] } }] });
    expect(granted.status).toBe(200);
    expect((await granted.json()).group.grants).toEqual([{ permission: "activity.view", scope: { programs: ["seed-program-ingles"] } }]);
    expect((await as(admin, `/access/groups/${groupId}/members`, "PUT", { userIds: ["seed-user-marta"] })).status).toBe(400);
    const renamed = await as(admin, `/access/groups/${groupId}`, "PUT", { name: "Lectura de actividad", description: "Inglés", version: 1 });
    expect(renamed.status).toBe(409);
    const current = ((await json(admin, "/access/groups")).groups as { id: string; version: number }[]).find(item => item.id === groupId)!;
    expect((await as(admin, `/access/groups/${groupId}`, "PUT", { name: "Lectura de actividad", description: "Inglés", version: current.version })).status).toBe(200);
  });

  it("ST-135 CA3 el permiso de un grupo se aplica en la siguiente solicitud y se retira igual, sin cerrar la sesión", async () => {
    const admin = await signIn("admin-demo"), tomas = await signIn("tomas.aguilar");
    expect((await as(tomas, "/courses/seed-course-english")).status).toBe(403);
    expect((await summaries(tomas, "&course=seed-course-english")).length).toBe(0);
    expect((await as(admin, `/access/groups/${groupId}/members`, "PUT", { userIds: ["seed-user-tomas"] })).status).toBe(200);
    // Same session, next request.
    expect((await as(tomas, "/courses/seed-course-english")).status).toBe(200);
    expect((await json(tomas, "/session")).member.permissions.grants).toEqual({ "activity.view": { programs: ["seed-program-ingles"] } });
    expect((await summaries(tomas, "&course=seed-course-english")).length).toBeGreaterThan(0);
    // Activity only: it does not let the person review, assign or see sections.
    expect((await json(tomas, "/courses/seed-course-english")).course.access).toMatchObject({ review: false, team: false, educators: false, sections: "assigned" });
    expect((await as(admin, `/access/groups/${groupId}/members`, "PUT", { userIds: [] })).status).toBe(200);
    expect((await as(tomas, "/courses/seed-course-english")).status).toBe(403);
    expect((await as(tomas, "/session")).status).toBe(200);
  });

  it("ST-135 CA3 cada cambio de la matriz queda auditado, también al eliminar un grupo, y el respaldo incluye las tablas", async () => {
    const admin = await signIn("admin-demo");
    expect((await as(admin, `/access/groups/${groupId}/members`, "PUT", { userIds: ["seed-user-tomas"] })).status).toBe(200);
    expect((await as(admin, `/access/groups/${groupId}`, "DELETE")).status).toBe(200);
    expect((await as(admin, `/access/groups/${groupId}`, "DELETE")).status).toBe(404);
    expect((await as(await signIn("tomas.aguilar"), "/courses/seed-course-english")).status).toBe(403);
    const events = ((await json(admin, "/access/matrix")).events as { subjectType: string; subjectId: string; action: string; summary: string; actorName: string }[]).filter(item => item.subjectId === groupId);
    expect(events.map(item => item.action)).toEqual(["deleted", "members", "members", "members", "updated", "granted", "created"]);
    expect(events.find(item => item.action === "granted")!.summary).toContain("Consultar la actividad (el programa «Inglés para niños»)");
    expect(events.every(item => item.actorName)).toBe(true);
    const backup = JSON.parse(await (await as(admin, "/organization/backup")).text()) as { tables: Record<string, { rows: unknown[] }> };
    for (const table of ["coordination_scopes", "security_groups", "security_group_grants", "security_group_members", "access_events"]) expect(backup.tables[table], table).toBeDefined();
    expect(backup.tables.access_events.rows.length).toBeGreaterThanOrEqual(10);
  });
});
