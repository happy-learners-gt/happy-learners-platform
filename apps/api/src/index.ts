import type { CatalogResponse, HealthResponse, Lesson, Resource, Session, VersionResponse } from "@happy-learners/contracts";
import { sha } from "./generated/version";

type State = { resources: Resource[]; lessons: Lesson[]; sessions: string[] };
const seed: State = { sessions: [], resources: [
  { id: "res-colors", title: "Colors around us", description: "Palabras y una actividad breve para identificar colores.", level: "Inicial", skill: "lectura", topic: "Colores", tags: ["vocabulario", "familia"], content: "Red, blue, yellow and green. Find three objects and say their color.", status: "publicado" },
  { id: "res-greetings", title: "Greetings song", description: "Rutina sencilla para comenzar la clase.", level: "Inicial", skill: "conversación", topic: "Saludos", tags: ["rutina", "oral"], content: "Hello! How are you? I am fine, thank you. Practice with a partner.", status: "publicado" },
], lessons: [{ id: "lesson-colors", title: "My colorful classroom", objective: "Reconocer y decir cuatro colores en inglés.", instructions: "Lee el material, repite las palabras y encuentra objetos con esos colores.", resourceIds: ["res-colors"], published: true, shareCode: "COLORES", completedCount: 3 }] };
function json(data: unknown, status = 200, extra: HeadersInit = {}) { return Response.json(data, { status, headers: { "Cache-Control": "no-store", ...extra } }); }
function id(prefix: string) { return `${prefix}-${crypto.randomUUID().slice(0, 8)}`; }

export class AppState implements DurableObject {
  constructor(private ctx: DurableObjectState, private env: Env) {}
  private async read(): Promise<State> { return (await this.ctx.storage.get<State>("state")) ?? structuredClone(seed); }
  private async write(state: State) { await this.ctx.storage.put("state", state); }
  async fetch(request: Request) {
    const url = new URL(request.url); const state = await this.read();
    if (url.pathname === "/state" && request.method === "GET") return json({ resources: state.resources, lessons: state.lessons } satisfies CatalogResponse);
    if (url.pathname === "/login" && request.method === "POST") { const body = await request.json() as { code?: string }; if (body.code !== "san-gaspar") return json({ error: "Código no válido" }, 401); const token = crypto.randomUUID(); state.sessions.push(token); await this.write(state); return json({ session: { user: "Educador de demostración", role: "educador" } satisfies Session }, 200, { "Set-Cookie": `hl_session=${token}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=86400` }); }
    const token = request.headers.get("Cookie")?.match(/(?:^|; )hl_session=([^;]+)/)?.[1]; const educator = Boolean(token && state.sessions.includes(token));
    if (url.pathname === "/resource" && request.method === "POST") { if (!educator) return json({ error: "Inicia sesión como educador" }, 401); const resource = { ...(await request.json() as Omit<Resource, "id">), id: id("res") }; state.resources.push(resource); await this.write(state); return json(resource, 201); }
    if (url.pathname.startsWith("/resource/") && request.method === "PUT") { if (!educator) return json({ error: "Inicia sesión como educador" }, 401); const index = state.resources.findIndex(r => r.id === url.pathname.split("/")[2]); if (index < 0) return json({ error: "Recurso no encontrado" }, 404); state.resources[index] = { ...state.resources[index], ...(await request.json() as Partial<Resource>) }; await this.write(state); return json(state.resources[index]); }
    if (url.pathname === "/lesson" && request.method === "POST") { if (!educator) return json({ error: "Inicia sesión como educador" }, 401); const input = await request.json() as Omit<Lesson, "id" | "published" | "shareCode" | "completedCount">; const lesson: Lesson = { ...input, id: id("lesson"), published: false, shareCode: crypto.randomUUID().slice(0, 6).toUpperCase(), completedCount: 0 }; state.lessons.push(lesson); await this.write(state); return json(lesson, 201); }
    if (url.pathname.match(/^\/lesson\/[^/]+\/publish$/) && request.method === "POST") { if (!educator) return json({ error: "Inicia sesión como educador" }, 401); const lesson = state.lessons.find(l => l.id === url.pathname.split("/")[2]); if (!lesson) return json({ error: "Lección no encontrada" }, 404); lesson.published = true; await this.write(state); return json(lesson); }
    if (url.pathname.match(/^\/lesson\/[^/]+\/complete$/) && request.method === "POST") { const lesson = state.lessons.find(l => l.id === url.pathname.split("/")[2]); if (!lesson?.published) return json({ error: "Lección no disponible" }, 404); lesson.completedCount += 1; await this.write(state); return json({ ok: true }); }
    return json({ error: "Not found" }, 404);
  }
}

export default { async fetch(request, env) {
  const path = new URL(request.url).pathname; if (!path.startsWith("/api/")) return env.ASSETS.fetch(request); const headers = { "Cache-Control": "no-store" };
  if (path === "/api/health" || path === "/api/version") { if (request.method !== "GET" && request.method !== "HEAD") return json({ error: "Method not allowed" }, 405, { ...headers, Allow: "GET, HEAD" }); const body: HealthResponse | VersionResponse = path === "/api/health" ? { status: "ok" } : { sha }; const response = json(body, 200, headers); return request.method === "HEAD" ? new Response(null, response) : response; }
  const durable = env.APP_STATE.get(env.APP_STATE.idFromName("happy-learners-demo")); const target = new URL(request.url); target.pathname = path.slice(4) || "/state"; return durable.fetch(new Request(target, request));
} } satisfies ExportedHandler<Env>;
