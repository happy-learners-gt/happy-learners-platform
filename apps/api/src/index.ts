import type { Lesson, Member, Organization, Resource } from "@happy-learners/contracts";
import { organizationInput } from "@happy-learners/domain";
import { sha } from "./generated/version";
import { database } from "./storage";
import type { Database } from "./storage";
export { OrganizationStore } from "./storage";
import { cookie, digest, newToken, sessionToken, verifyPassword } from "./auth";
import { roles } from "./roles";

const headers = {
  "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff", "Referrer-Policy": "no-referrer",
  "Content-Security-Policy": "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
};
function json(data: unknown, status = 200, extra: Record<string, string> = {}) {
  return Response.json(data, { status, headers: { ...headers, ...extra } });
}
async function body(request: Request): Promise<unknown> {
  if (!request.headers.get("content-type")?.startsWith("application/json")) throw new Error("INPUT");
  if (Number(request.headers.get("content-length")) > 2048) throw new Error("INPUT");
  const reader = request.body?.getReader();
  if (!reader) throw new Error("INPUT");
  let text = ""; const decoder = new TextDecoder(); let size = 0;
  while (true) {
    const chunk = await reader.read(); if (chunk.done) break;
    size += chunk.value.length;
    if (size > 2048) { await reader.cancel(); throw new Error("INPUT"); }
    text += decoder.decode(chunk.value, { stream: true });
  }
  try { return JSON.parse(text + decoder.decode()); } catch { throw new Error("INPUT"); }
}
async function member(request: Request, db: Database): Promise<Member | null> {
  const token = sessionToken(request);
  if (!token) return null;
  return db.prepare("SELECT u.id, u.username, CASE m.role WHEN 'instructor' THEN 'educator' ELSE m.role END AS role, m.organization_id AS organizationId FROM sessions s JOIN users u ON u.id=s.user_id JOIN memberships m ON m.user_id=u.id WHERE s.token_hash=? AND s.expires_at>? AND m.active=1")
    .bind(await digest(token), Date.now()).first<Member>();
}
async function route(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url); const path = url.pathname; const method = request.method;
  if (!path.startsWith("/api/")) {
    const asset = await env.ASSETS.fetch(request); const result = new Response(asset.body, asset);
    for (const [name, value] of Object.entries(headers)) result.headers.set(name, value);
    return result;
  }
  const input = ((path === "/api/login" && method === "POST") || (path === "/api/organization" && method === "PUT") || (path.startsWith("/api/members/") && method === "PUT") || (path === "/api/resources" && method === "POST") || (path === "/api/lessons" && method === "POST"))
    ? await body(request) : undefined;
  let scope = sessionToken(request)?.startsWith("o_") ? "org-other" : "org-demo";
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
  const allowed = methods[path] || (path === "/api/members" ? ["GET"] : /^\/api\/members\/[a-z0-9-]+$/.test(path) ? ["PUT"] : /^\/api\/lessons\/[a-z0-9-]+$/.test(path) ? ["GET"] : /^\/api\/lessons\/[a-z0-9-]+\/publish$/.test(path) ? ["POST"] : /^\/api\/share\/[A-Z0-9-]+$/.test(path) ? ["GET"] : /^\/api\/share\/[A-Z0-9-]+\/complete$/.test(path) ? ["POST"] : null);
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
    const code = path.split("/")[3];
    const shared = await db.prepare("SELECT id,content FROM lessons WHERE status='published'").all<{ id: string; content: string }>();
    const match = shared.results.find(row => (JSON.parse(row.content) as Lesson & { shareCode?: string }).shareCode === code);
    if (!match) return json({ error: "Lección no disponible." }, 404);
    if (method === "POST") { const id = `completion-${crypto.randomUUID()}`; await db.prepare("INSERT INTO lesson_completions (id,lesson_id,completed_at) VALUES (?,?,?)").bind(id, match.id, Date.now()).run(); return json({ ok: true }); }
    return json({ lesson: JSON.parse(match.content) as Lesson });
  }
  if (path === "/api/logout") {
    const token = sessionToken(request);
    if (token) await db.prepare("DELETE FROM sessions WHERE token_hash=?").bind(await digest(token)).run();
    return json({ ok: true }, 200, { "Set-Cookie": cookie("", request, true) });
  }
  const current = await member(request, db);
  if (!current) return json({ error: "Inicia sesión para continuar." }, 401);
  if (path === "/api/session") return json({ member: current });
  if (path.startsWith("/api/members")) return roles(path, method, input, current, db);
  if (!["GET", "HEAD"].includes(method) && path !== "/api/organization" && current.role !== "educator") return json({ error: "Solo educadores pueden modificar contenido." }, 403);
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
  if (path === "/api/resources" && method === "GET") {
    const rows = await db.prepare("SELECT id,title,description,level,skill,topic,tags,content,status FROM resources WHERE organization_id=? ORDER BY title").bind(current.organizationId).all<Omit<Resource, "tags"> & { tags: string }>();
    return json({ resources: rows.results.map(row => ({ ...row, tags: JSON.parse(row.tags) })) });
  }
  if (path === "/api/resources" && method === "POST") {
    if (!input || typeof input !== "object") return json({ error: "Revisa el recurso." }, 400);
    const value = input as Record<string, unknown>; const fields = ["title", "description", "level", "skill", "topic", "content"];
    if (fields.some(field => typeof value[field] !== "string" || !(value[field] as string).trim()) || !["lectura", "escritura", "escucha", "conversación"].includes(value.skill as string)) return json({ error: "Completa los campos del recurso." }, 400);
    const resource: Resource = { id: `resource-${crypto.randomUUID().slice(0, 8)}`, title: value.title as string, description: value.description as string, level: value.level as string, skill: value.skill as Resource["skill"], topic: value.topic as string, tags: Array.isArray(value.tags) ? value.tags.filter(tag => typeof tag === "string") as string[] : [], content: value.content as string, status: "draft" };
    await db.prepare("INSERT INTO resources VALUES (?,?,?,?,?,?,?,?,?,?)").bind(resource.id, current.organizationId, resource.title, resource.description, resource.level, resource.skill, resource.topic, JSON.stringify(resource.tags), resource.content, resource.status).run(); return json({ resource }, 201);
  }
  if (path === "/api/lessons" && method === "POST") {
    if (!input || typeof input !== "object") return json({ error: "Revisa la lección." }, 400); const value = input as Record<string, unknown>;
    if (typeof value.title !== "string" || typeof value.objective !== "string" || !Array.isArray(value.resourceIds) || !value.resourceIds.length) return json({ error: "Una lección necesita título, objetivo y recursos." }, 400);
    const id = `lesson-${crypto.randomUUID().slice(0, 8)}`; const content = { id, title: value.title, program: "Biblioteca Happy Learners", duration: 20, objective: value.objective, materials: [], activities: [{ title: "Exploramos el material", minutes: 20, instructions: typeof value.instructions === "string" ? value.instructions : "Lee el material y conversa sobre lo aprendido." }], reflection: "¿Qué ayudó a participar?", publishedAt: "", resourceIds: value.resourceIds, shareCode: crypto.randomUUID().slice(0, 6).toUpperCase() };
    await db.prepare("INSERT INTO lessons VALUES (?,?,?,?)").bind(id, "exploradores", "draft", JSON.stringify(content)).run(); return json({ lesson: content }, 201);
  }
  if (path.match(/^\/api\/lessons\/[^/]+\/publish$/)) { const id = path.split("/")[3]; const row = await db.prepare("SELECT content FROM lessons WHERE id=? AND program_id='exploradores'").bind(id).first<{ content: string }>(); if (!row) return json({ error: "Lección no encontrada." }, 404); const content = JSON.parse(row.content) as Lesson; content.publishedAt = new Date().toISOString().slice(0, 10); await db.prepare("UPDATE lessons SET status='published',content=? WHERE id=?").bind(JSON.stringify(content), id).run(); return json({ lesson: content }); }
  if (path === "/api/lessons" && method === "GET") {
    const rows = await db.prepare("SELECT l.content FROM lessons l JOIN programs p ON p.id=l.program_id WHERE p.organization_id=? AND l.status='published' ORDER BY l.id").bind(current.organizationId).all<{ content: string }>();
    return json({ lessons: rows.results.map(row => JSON.parse(row.content) as Lesson) });
  }
  const row = await db.prepare("SELECT l.content FROM lessons l JOIN programs p ON p.id=l.program_id WHERE l.id=? AND p.organization_id=? AND l.status='published'").bind(path.split("/").pop()!, current.organizationId).first<{ content: string }>();
  return row ? json({ lesson: JSON.parse(row.content) as Lesson }) : json({ error: "La lección no está disponible para esta organización." }, 404);
}
export default {
  async fetch(request, env): Promise<Response> {
    try { const response = await route(request, env); for (const [key, value] of Object.entries(headers)) response.headers.set(key, value); return response; }
    catch (error) {
      if (error instanceof Error && error.message === "INPUT") return json({ error: "Revisa los datos del formulario." }, 400);
      console.error(JSON.stringify({ event: "request_failed", code: "DEPENDENCY_UNAVAILABLE", release: "0.1.0", sha }));
      return json({ error: "El servicio no está disponible. Vuelve a intentar en un momento." }, 503, { "Retry-After": "30" });
    }
  },
} satisfies ExportedHandler<Env>;
