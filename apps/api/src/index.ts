import type { Activity, Lesson, Member, Organization, Resource } from "@happy-learners/contracts";
import { hasText, organizationInput, richTextFieldsOf } from "@happy-learners/domain";
import { sha } from "./generated/version";
import { database } from "./storage";
import type { Database } from "./storage";
export { OrganizationStore } from "./storage";
import { cookie, digest, newToken, sessionToken, verifyPassword } from "./auth";
import { roles } from "./roles";
import { curriculum } from "./curriculum";
import { content, reviews, shared } from "./content";
import { courses, programs, taxonomy } from "./courses";
import { duplicateCourse } from "./duplicate";
import { accessTo } from "./access";
import { activity, people, progress } from "./team";
import { classroom } from "./attendance";
import { myClasses, student, studentScope, studentToken } from "./classes";
import { courseFiles, sharedFile } from "./files";
import { LessonCollaborationRoom } from "./collaboration";
import { encodeLessonDraft } from "./rich-text";
export { LessonCollaborationRoom };

const headers = {
  "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff", "Referrer-Policy": "no-referrer",
  "Content-Security-Policy": "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self' wss: ws:; frame-src 'self' blob:; media-src 'self' blob:; worker-src 'self' blob:; frame-ancestors 'none'; base-uri 'self'; form-action 'self'",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
};
function json(data: unknown, status = 200, extra: Record<string, string> = {}) {
  return Response.json(data, { status, headers: { ...headers, ...extra } });
}
async function body(request: Request): Promise<unknown> {
  if (!request.headers.get("content-type")?.startsWith("application/json")) throw new Error("INPUT");
  const pathname = new URL(request.url).pathname;
  // Lessons carry rich text for every block; other bodies stay small.
  const limit = pathname === "/api/login" ? 2048 : /^\/api\/lessons(\/|$)/.test(pathname) ? 262144 : 65536;
  const reader = request.body?.getReader();
  if (!reader) throw new Error("INPUT");
  let text = ""; const decoder = new TextDecoder(); let size = 0;
  while (true) {
    const chunk = await reader.read(); if (chunk.done) break;
    size += chunk.value.length;
    if (size > limit) { await reader.cancel(); throw new Error("INPUT"); }
    text += decoder.decode(chunk.value, { stream: true });
  }
  try { return JSON.parse(text + decoder.decode()); } catch { throw new Error("INPUT"); }
}
async function member(request: Request, db: Database): Promise<Member | null> {
  const token = sessionToken(request);
  if (!token) return null;
  return db.prepare("SELECT u.id, u.username, COALESCE(u.display_name,u.username) AS displayName, CASE m.role WHEN 'instructor' THEN 'educator' ELSE m.role END AS role, m.organization_id AS organizationId FROM sessions s JOIN users u ON u.id=s.user_id JOIN memberships m ON m.user_id=u.id WHERE s.token_hash=? AND s.expires_at>? AND m.active=1")
    .bind(await digest(token), Date.now()).first<Member>();
}
async function route(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url); const path = url.pathname; const method = request.method;
  if (!path.startsWith("/api/")) {
    const asset = await env.ASSETS.fetch(request); const result = new Response(asset.body, asset);
    for (const [name, value] of Object.entries(headers)) result.headers.set(name, value);
    return result;
  }
  let input = (["POST", "PUT"].includes(method) && /^\/api\/(login|organization|members|levels|units|resources|lessons|courses|programs|vocabularies|terms|student)(\/[a-z0-9-]+){0,5}$/.test(path) && !/\/(publish|duplicate|start|complete|cancel|restore|code|logout)$/.test(path) && !path.includes("/files"))
    ? await body(request) : undefined;
  let scope = sessionToken(request)?.startsWith("o_") ? "org-other" : "org-demo";
  if (path.startsWith("/api/share/")) scope = path.split("/")[3].startsWith("O-") ? "org-other" : "org-demo";
  if (path.startsWith("/api/student/")) scope = path === "/api/student/login" ? studentScope(String((input as Record<string, unknown> | null)?.code || "").trim().toUpperCase()) : studentToken(request)?.startsWith("o_") ? "org-other" : "org-demo";
  if (path === "/api/login" && method === "POST") {
    const credentials = input as Record<string, unknown> | null;
    scope = typeof credentials?.username === "string" && credentials.username.trim().toLowerCase() === "externo-demo" ? "org-other" : "org-demo";
  }
  const db = database(env, scope);
  if (["/api/health", "/api/version"].includes(path)) {
    if (!["GET", "HEAD"].includes(method)) return json({ error: "Method not allowed" }, 405, { Allow: "GET, HEAD" });
    if (path === "/api/health") await db.prepare("SELECT id FROM organizations LIMIT 1").first();
    return method === "HEAD" ? new Response(null, { headers }) : json(path === "/api/health" ? { status: "ok" } : { sha });
  }
  const methods: Record<string, string[]> = { "/api/session": ["GET"], "/api/login": ["POST"], "/api/logout": ["POST"], "/api/organization": ["GET", "PUT"], "/api/resources": ["GET", "POST"], "/api/lessons": ["GET", "POST"] };
  if (/^\/api\/courses$/.test(path)) methods[path] = ["GET", "POST"];
  if (/^\/api\/courses\/[a-z0-9-]+$/.test(path)) methods[path] = ["GET", "PUT"];
  if (/^\/api\/courses\/[a-z0-9-]+\/(units|materials)$/.test(path)) methods[path] = ["GET", "POST"];
  if (/^\/api\/courses\/[a-z0-9-]+\/(units|materials|competencies|outcomes)\/[a-z0-9-]+$/.test(path)) methods[path] = ["PUT"];
  if (/^\/api\/courses\/[a-z0-9-]+\/(competencies|outcomes)$/.test(path)) methods[path] = ["POST"];
  if (/^\/api\/courses\/[a-z0-9-]+\/units\/[a-z0-9-]+\/outcomes$/.test(path)) methods[path] = ["PUT"];
  if (/^\/api\/courses\/[a-z0-9-]+\/team$/.test(path)) methods[path] = ["PUT"];
  if (/^\/api\/courses\/[a-z0-9-]+\/duplicate$/.test(path)) methods[path] = ["POST"];
  if (path === "/api/activity" || path === "/api/progress" || path === "/api/people" || path === "/api/reviews") methods[path] = ["GET"];
  if (/^\/api\/courses\/[a-z0-9-]+\/files$/.test(path)) methods[path] = ["GET", "POST"];
  if (/^\/api\/courses\/[a-z0-9-]+\/files\/[a-z0-9-]+\/content$/.test(path)) methods[path] = ["GET"];
  if (/^\/api\/courses\/[a-z0-9-]+\/files\/[a-z0-9-]+\/archive$/.test(path)) methods[path] = ["POST"];
  if (/^\/api\/courses\/[a-z0-9-]+\/lessons\/[a-z0-9-]+\/collaborate$/.test(path)) methods[path] = ["GET"];
  if (/^\/api\/courses\/[a-z0-9-]+\/(groups|sessions)$/.test(path)) methods[path] = ["GET", "POST"];
  if (/^\/api\/courses\/[a-z0-9-]+\/groups\/[a-z0-9-]+\/schedule$/.test(path)) methods[path] = ["PUT", "DELETE"];
  if (/^\/api\/courses\/[a-z0-9-]+\/groups\/[a-z0-9-]+\/lessons$/.test(path)) methods[path] = ["POST"];
  if (/^\/api\/courses\/[a-z0-9-]+\/groups\/[a-z0-9-]+\/educators$/.test(path)) methods[path] = ["PUT"];
  if (/^\/api\/courses\/[a-z0-9-]+\/groups\/[a-z0-9-]+\/learners$/.test(path)) methods[path] = ["POST"];
  if (/^\/api\/courses\/[a-z0-9-]+\/groups\/[a-z0-9-]+\/learners\/[a-z0-9-]+$/.test(path)) methods[path] = ["PUT"];
  if (/^\/api\/courses\/[a-z0-9-]+\/groups\/[a-z0-9-]+$/.test(path)) methods[path] = ["PUT"];
  if (/^\/api\/courses\/[a-z0-9-]+\/groups\/[a-z0-9-]+\/code$/.test(path)) methods[path] = ["POST", "DELETE"];
  if (/^\/api\/courses\/[a-z0-9-]+\/sessions\/[a-z0-9-]+$/.test(path)) methods[path] = ["GET", "PUT"];
  if (/^\/api\/courses\/[a-z0-9-]+\/sessions\/[a-z0-9-]+\/(start|complete|cancel|restore)$/.test(path)) methods[path] = ["POST"];
  if (/^\/api\/courses\/[a-z0-9-]+\/sessions\/[a-z0-9-]+\/attendance$/.test(path)) methods[path] = ["GET", "PUT"];
  if (path === "/api/classes" || path === "/api/student/space" || /^\/api\/student\/files\/[a-z0-9-]+$/.test(path)) methods[path] = ["GET"];
  if (path === "/api/student/login" || path === "/api/student/logout") methods[path] = ["POST"];
  if (path === "/api/taxonomy") methods[path] = ["GET"];
  if (path === "/api/programs") methods[path] = ["GET", "POST"];
  if (/^\/api\/programs\/[a-z0-9-]+$/.test(path)) methods[path] = ["GET", "PUT"];
  if (/^\/api\/(vocabularies|terms)$/.test(path)) methods[path] = ["POST"];
  if (/^\/api\/(vocabularies|terms)\/[a-z0-9-]+$/.test(path)) methods[path] = ["PUT"];
  const allowed = methods[path] || (path === "/api/curriculum" ? ["GET"] : /^\/api\/(levels|units)$/.test(path) ? ["POST"] : /^\/api\/(levels|units)\/[a-z0-9-]+$/.test(path) ? ["PUT"] : path === "/api/members" ? ["GET"] : /^\/api\/members\/[a-z0-9-]+$/.test(path) ? ["PUT"] : /^\/api\/(lessons|resources)\/[a-z0-9-]+$/.test(path) ? ["GET", "PUT", "DELETE"] : /^\/api\/lessons\/[a-z0-9-]+\/(publish|duplicate|review|review\/return)$/.test(path) ? ["POST"] : /^\/api\/share\/[A-Z0-9-]+$/.test(path) ? ["GET"] : /^\/api\/share\/[A-Z0-9-]+\/complete$/.test(path) ? ["POST"] : /^\/api\/share\/[A-Z0-9-]+\/files\/[a-z0-9-]+$/.test(path) ? ["GET"] : null);
  if (!allowed) return json({ error: "Not found" }, 404);
  if (!allowed.includes(method)) return json({ error: "Method not allowed" }, 405, { Allow: allowed.join(", ") });
  if (!["GET", "HEAD"].includes(method)) {
    if (request.headers.get("Origin") !== url.origin || request.headers.get("Sec-Fetch-Site") === "cross-site") return json({ error: "Origen no permitido." }, 403);
  }
  if (path === "/api/login") {
    const value = input as Record<string, unknown>;
    if (!value || typeof value.username !== "string" || typeof value.password !== "string" || value.username.length > 64 || value.password.length > 128) return json({ error: "Introduce usuario y contraseña." }, 400);
    // Daily rotating short-lived hash; no raw IP addresses in application storage.
    const bucket = await digest(`${new Date().toISOString().slice(0, 10)}:${request.headers.get("CF-Connecting-IP") || "local"}`);
    const now = Date.now();
    const limit = await db.prepare("INSERT INTO login_limits (bucket, attempts, expires_at) VALUES (?,1,?) ON CONFLICT(bucket) DO UPDATE SET attempts=CASE WHEN expires_at<? THEN 1 ELSE attempts+1 END, expires_at=CASE WHEN expires_at<? THEN excluded.expires_at ELSE expires_at END RETURNING attempts")
      .bind(bucket, now + 900000, now, now).first<{ attempts: number }>();
    if (!limit || limit.attempts > 30) return json({ error: "Demasiados intentos. Espera 15 minutos y vuelve a intentar." }, 429, { "Retry-After": "900" });
    const user = await db.prepare("SELECT u.id, u.password_salt, u.password_hash FROM users u JOIN memberships m ON m.user_id=u.id WHERE u.username=? AND m.active=1").bind(value.username.trim().toLowerCase()).first<{ id: string; password_salt: string; password_hash: string }>();
    const valid = await verifyPassword(value.password, user?.password_salt || "synthetic-dummy-salt", user?.password_hash || "0".repeat(64));
    if (!user || !valid) return json({ error: "Usuario o contraseña incorrectos." }, 401);
    const token = (scope === "org-other" ? "o_" : "d_") + newToken();
    await db.batch([
      db.prepare("DELETE FROM sessions WHERE expires_at<=?").bind(now),
      db.prepare("DELETE FROM login_limits WHERE expires_at<=?").bind(now),
      db.prepare("INSERT INTO sessions (token_hash,user_id,expires_at) VALUES (?,?,?)").bind(await digest(token), user.id, now + 28800000),
    ]);
    return json({ ok: true }, 200, { "Set-Cookie": cookie(token, request) });
  }
  if (path.startsWith("/api/share/")) {
    const shareParts = path.split("/");
    if (shareParts[4] === "files" && method === "GET") return sharedFile(shareParts[3], shareParts[5], scope, db, env.COURSE_FILES);
    return shared(path, method, request, db);
  }
  if (path.startsWith("/api/student/")) return student(path, method, input, request, scope, db, env.COURSE_FILES);
  if (path === "/api/logout") {
    const token = sessionToken(request);
    if (token) await db.prepare("DELETE FROM sessions WHERE token_hash=?").bind(await digest(token)).run();
    return json({ ok: true }, 200, { "Set-Cookie": cookie("", request, true) });
  }
  const current = await member(request, db);
  if (!current) return json({ error: "Inicia sesión para continuar." }, 401);
  if (path === "/api/session") return json({ member: current });
  if (/^\/api\/courses\/[a-z0-9-]+\/files(?:\/|$)/.test(path)) return courseFiles(path, method, request, current, db, env.COURSE_FILES);
  const collaborationMatch = path.match(/^\/api\/courses\/([a-z0-9-]+)\/lessons\/([a-z0-9-]+)\/collaborate$/);
  if (collaborationMatch) {
    const [courseId, lessonId] = [collaborationMatch[1], collaborationMatch[2]];
    if (!(await accessTo(db, current, courseId))?.edit) return json({ error: "Solo el equipo docente del curso edita sus lecciones." }, 403);
    if (request.headers.get("Upgrade")?.toLowerCase() !== "websocket" || request.headers.get("Origin") !== url.origin) return json({ error: "Se requiere una conexión segura del mismo origen." }, 400);
    const lesson = await db.prepare("SELECT l.content FROM lessons l JOIN learning_units u ON u.id=l.course_unit_id JOIN courses c ON c.id=u.course_id WHERE l.id=? AND c.id=? AND c.organization_id=? AND c.status='active' AND u.status='active' AND l.archived=0").bind(lessonId, courseId, current.organizationId).first<{ content: string }>();
    if (!lesson) return json({ error: "Lección no disponible en este curso." }, 404);
    const roomIdentity = { organizationId: current.organizationId, courseId, lessonId };
    const room = env.LESSON_ROOMS.getByName(`${current.organizationId}:${lessonId}`);
    await room.initialize(roomIdentity, encodeLessonDraft((JSON.parse(lesson.content) as Lesson).activities));
    const token = sessionToken(request);
    if (!token) return json({ error: "Inicia sesión para editar." }, 401);
    const internalHeaders = new Headers();
    request.headers.forEach((value, key) => internalHeaders.append(key, value));
    internalHeaders.set("X-HL-Organization", current.organizationId);
    internalHeaders.set("X-HL-Course", courseId);
    internalHeaders.set("X-HL-Lesson", lessonId);
    internalHeaders.set("X-HL-User", current.id);
    internalHeaders.set("X-HL-Username", current.username);
    internalHeaders.set("X-HL-Session", await digest(token));
    return room.fetch(new Request(request, { headers: internalHeaders }));
  }
  if (/^\/api\/(taxonomy|vocabularies|terms)(\/|$)/.test(path)) return taxonomy(path, method, input, current, db);
  if (/^\/api\/courses\/[a-z0-9-]+\/(groups|sessions)(\/|$)/.test(path)) return classroom(path, method, input, current, db);
  if (/^\/api\/courses\/[a-z0-9-]+\/duplicate$/.test(path)) return duplicateCourse(path.split("/")[3], current, db, env.COURSE_FILES);
  if (/^\/api\/courses(\/|$)/.test(path)) return courses(path, method, input, current, db);
  if (/^\/api\/programs(\/|$)/.test(path)) return programs(path, method, input, current, db);
  if (path === "/api/activity") return activity(url, current, db);
  if (path === "/api/classes") return myClasses(current, db);
  if (path === "/api/progress") return progress(current, db);
  if (path === "/api/people") return people(current, db);
  if (path === "/api/reviews") return reviews(current, db);
  if (path.startsWith("/api/members")) return roles(path, method, input, current, db);
  if (/^\/api\/(curriculum|levels|units)(\/|$)/.test(path)) return curriculum(path, method, input, current, db);
  if (path === "/api/organization") {
    if (method === "PUT") {
      if (current.role !== "admin") return json({ error: "Solo administración puede configurar la organización." }, 403);
      const settings = organizationInput(input);
      if (!settings) return json({ error: "Usa un nombre de 3 a 80 caracteres y una zona horaria válida." }, 400);
      await db.prepare("UPDATE organizations SET name=?,timezone=?,configured=1 WHERE id=?").bind(settings.name, settings.timezone, current.organizationId).run();
    }
    const organization = await db.prepare("SELECT id,name,timezone,configured FROM organizations WHERE id=?").bind(current.organizationId).first<Organization>();
    if (!organization) return json({ error: "Organización no disponible." }, 404);
    return json({ organization: { ...organization, configured: !!organization.configured } });
  }
  const lessonUpdate = path.match(/^\/api\/lessons\/([a-z0-9-]+)$/);
  if (method === "PUT" && lessonUpdate && input && typeof input === "object") {
    const value = input as Record<string, unknown>;
    const activities = Array.isArray(value.activities) ? value.activities as Activity[] : [];
    const course = await db.prepare("SELECT c.id AS courseId FROM lessons l JOIN learning_units u ON u.id=l.course_unit_id JOIN courses c ON c.id=u.course_id WHERE l.id=? AND c.organization_id=?").bind(lessonUpdate[1], current.organizationId).first<{ courseId: string }>();
    if (course && activities.length) {
      const snapshot = await env.LESSON_ROOMS.getByName(`${current.organizationId}:${lessonUpdate[1]}`).snapshot({ organizationId: current.organizationId, courseId: course.courseId, lessonId: lessonUpdate[1] }, richTextFieldsOf(activities));
      // Live text wins only where the room actually holds text; an empty or missing field never erases what the client sent.
      const live = (id: string | undefined) => { const doc = id ? snapshot[id] as Activity["richContent"] : undefined; return doc && hasText(doc) ? doc : undefined; };
      input = { ...value, activities: activities.map(activity => activity.blocks
        ? { ...activity, blocks: activity.blocks.map(block => { const doc = live(block.id); return doc ? { ...block, richContent: doc, instructions: "" } : block; }) }
        : (() => { const doc = live(activity.id); return doc ? { ...activity, richContent: doc, instructions: "" } : activity; })()) };
    }
  }
  return content(url, method, input, current, db);
}
export default {
    async fetch(request, env): Promise<Response> {
    try { const response = await route(request, env); if (response.status === 101) return response; for (const [key, value] of Object.entries(headers)) response.headers.set(key, value); if (response.headers.has("X-File-SHA256")) response.headers.set("Content-Security-Policy", "sandbox; default-src 'none'; frame-ancestors 'none'"); return response; }
    catch (error) {
      if (error instanceof Error && error.message === "INPUT") return json({ error: "Revisa los datos del formulario." }, 400);
      const cause = error instanceof Error ? `${error.name}: ${error.message}`.slice(0, 240) : "Unknown error";
      console.error(JSON.stringify({ event: "request_failed", code: "DEPENDENCY_UNAVAILABLE", sha, cause }));
      return json({ error: "El servicio no está disponible. Vuelve a intentar en un momento." }, 503, { "Retry-After": "30" });
    }
  },
} satisfies ExportedHandler<Env>;
