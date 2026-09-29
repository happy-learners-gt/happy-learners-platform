import type { Activity, Lesson, Member, Resource } from "@happy-learners/contracts";
import { validActivities } from "@happy-learners/domain";
import type { Database } from "./storage";
const reply = (data: unknown, status = 200) => Response.json(data, { status });
type LessonRow = { id: string; content: string; published_content: string | null; unit_id: string; position: number; status: "draft" | "published"; archived: number; revision: number; draft_version: number; published_version: number; updated_at: string; completions: number };
const lessonQuery = "SELECT l.*,(SELECT count(*) FROM lesson_completions c WHERE c.lesson_id=l.id) AS completions FROM lessons l JOIN programs p ON p.id=l.program_id JOIN units u ON u.id=l.unit_id JOIN levels lv ON lv.id=u.level_id WHERE p.organization_id=?";
function lessonView(row: LessonRow, draft: boolean): Lesson {
  return { ...JSON.parse(draft ? row.content : row.published_content || row.content), unitId: row.unit_id, position: row.position, status: row.archived ? "archived" : row.status, revision: row.revision, draftVersion: row.draft_version, hasDraft: row.draft_version !== row.published_version, updatedAt: row.updated_at, completions: row.completions };
}
export async function resources(db: Database, organization: string) {
  const rows = await db.prepare("SELECT id,title,description,level,skill,topic,tags,content,status,archived,kind,updated_at AS updatedAt FROM resources WHERE organization_id=? ORDER BY title").bind(organization).all<Omit<Resource, "tags"> & { tags: string; archived: number }>();
  return rows.results.map(({ archived, ...r }) => ({ ...r, tags: JSON.parse(r.tags) as string[], status: archived ? "archived" as const : r.status }));
}
export async function content(url: URL, method: string, input: unknown, current: Member, db: Database): Promise<Response> {
  const path = url.pathname; const id = path.split("/")[3]; const resourceRoute = path.startsWith("/api/resources");
  const draft = url.searchParams.has("draft") || url.searchParams.has("drafts");
  if ((method !== "GET" || draft) && current.role !== "educator") return reply({ error: "Solo educadores pueden modificar contenido." }, 403);
  if (resourceRoute) {
    const list = await resources(db, current.organizationId);
    if (method === "GET") { const one = list.find(r => r.id === id); return id ? one ? reply({ resource: one }) : reply({ error: "Recurso no disponible." }, 404) : reply({ resources: list }); }
    if (method === "DELETE") return reply({ error: "Conserva los vínculos: archiva el recurso desde su formulario." }, 409);
    const old = list.find(r => r.id === id);
    if (id && !old) return reply({ error: "Recurso no disponible." }, 404);
    if (!input || typeof input !== "object") return reply({ error: "Revisa el recurso." }, 400);
    const v = input as Record<string, unknown>;
    const required = ["title", "description", "level", "skill", "topic", "content"];
    if (required.some(f => typeof v[f] !== "string" || !(v[f] as string).trim()) || String(v.title).length > 160 || String(v.content).length > 8000 || required.filter(f => f !== "content").some(f => String(v[f]).length > 1000) || !["lectura", "escritura", "escucha", "conversación"].includes(String(v.skill))) return reply({ error: "Completa los campos. Usa hasta 160 caracteres para el título y 8000 para el contenido." }, 400);
    const kind = v.kind || (/^https?:\/\//.test(String(v.content)) ? "link" : "text");
    if (!["text", "link"].includes(String(kind))) return reply({ error: "Elige texto o enlace." }, 400);
    if (kind === "link") {
      try { const u = new URL(String(v.content)); if (!["https:", "http:"].includes(u.protocol) || !u.hostname || u.username || u.password) throw new Error(); }
      catch { return reply({ error: "Usa una dirección completa que comience con https:// o http://, sin credenciales." }, 400); }
    }
    if (!Array.isArray(v.tags) || v.tags.length > 12 || v.tags.some(t => typeof t !== "string" || t.length > 40)) return reply({ error: "Usa hasta 12 etiquetas de 40 caracteres." }, 400);
    const status = String(v.status || "draft");
    if (!["draft", "published", "archived"].includes(status)) return reply({ error: "Estado inválido." }, 400);
    const rid = id || `resource-${crypto.randomUUID()}`; const now = new Date().toISOString();
    const values = [String(v.title).trim(), String(v.description), String(v.level), String(v.skill), String(v.topic), JSON.stringify(v.tags), String(v.content), status === "archived" ? (old?.status === "published" ? "published" : "draft") : status, status === "archived" ? 1 : 0, String(kind), now];
    if (id) await db.prepare("UPDATE resources SET title=?,description=?,level=?,skill=?,topic=?,tags=?,content=?,status=?,archived=?,kind=?,updated_at=? WHERE id=? AND organization_id=?").bind(...values, id, current.organizationId).run();
    else await db.prepare("INSERT INTO resources(title,description,level,skill,topic,tags,content,status,archived,kind,updated_at,id,organization_id) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)").bind(...values, rid, current.organizationId).run();
    return reply({ resource: (await resources(db, current.organizationId)).find(r => r.id === rid) }, id ? 200 : 201);
  }
  const rows = (await db.prepare(lessonQuery + " ORDER BY lv.position,u.position,l.position,l.id").bind(current.organizationId).all<LessonRow>()).results;
  if (id === "order" && method === "PUT") {
    const v = input as { unitId?: string; ids?: string[] } | null;
    const selected = rows.filter(r => r.unit_id === v?.unitId);
    if (!v || !Array.isArray(v.ids) || v.ids.length !== selected.length || new Set(v.ids).size !== selected.length || v.ids.some(x => !selected.some(r => r.id === x))) return reply({ error: "El orden debe incluir todas las lecciones de la unidad una sola vez." }, 400);
    await db.batch(v.ids.map((item, i) => db.prepare("UPDATE lessons SET position=? WHERE id=?").bind(i, item))); return reply({ ok: true });
  }
  const row = rows.find(r => r.id === id);
  if (id && (!row || (method === "GET" && !draft && (!row.published_content || row.archived)))) return reply({ error: "Lección no disponible." }, 404);
  if (method === "GET") return id ? reply({ lesson: lessonView(row!, draft) }) : reply({ lessons: rows.filter(r => draft || (r.published_content && !r.archived)).map(r => lessonView(r, draft)) });
  if (path.endsWith("/publish") && row) {
    const lesson = JSON.parse(row.content) as Lesson;
    if (!lesson.title.trim() || !lesson.objective.trim() || !lesson.activities.length) return reply({ error: "Completa título, objetivo y al menos una actividad." }, 400);
    const library = await resources(db, current.organizationId);
    const resourceIds = [...new Set(lesson.activities.flatMap(a => a.type === "resource" && a.resourceId ? [a.resourceId] : []))];
    if (resourceIds.some(rid => !library.some(r => r.id === rid))) return reply({ error: "Hay un recurso no disponible. Revisa las actividades." }, 400);
    if (row.archived) return reply({ error: "Restaura la lección antes de publicarla." }, 409);
    const published = { ...lesson, resources: resourceIds.map(rid => library.find(r => r.id === rid)!), publishedAt: new Date().toISOString(), revision: row.revision + 1 };
    const written = await db.prepare("UPDATE lessons SET published_content=?,published_version=draft_version,revision=revision+1,status='published' WHERE id=? AND draft_version=? RETURNING id").bind(JSON.stringify(published), row.id, row.draft_version).first();
    return written ? reply({ lesson: published }) : reply({ error: "El borrador cambió. Recarga y vuelve a publicar." }, 409);
  }
  if (method === "DELETE") return reply({ error: "Archiva la lección para conservar su historial." }, 409);
  if (!input || typeof input !== "object") return reply({ error: "Completa la lección." }, 400);
  const v = input as Record<string, unknown>;
  const unit = await db.prepare("SELECT u.id,u.name FROM units u JOIN levels l ON l.id=u.level_id WHERE u.id=? AND l.organization_id=? AND u.status='active' AND l.status!='archived'").bind(String(v.unitId || ""), current.organizationId).first<{ id: string; name: string }>();
  if (!unit) return reply({ error: "Selecciona una unidad activa de tu organización." }, 400);
  if (typeof v.title !== "string" || !v.title.trim() || v.title.length > 160 || typeof v.objective !== "string" || !v.objective.trim() || v.objective.length > 1000 || typeof v.instructions !== "string" || v.instructions.length > 8000) return reply({ error: "Completa título, objetivo e instrucciones dentro del límite." }, 400);
  const old = row ? JSON.parse(row.content) as Lesson : null;
  const lid = id || `lesson-${crypto.randomUUID()}`;
  const lesson: Lesson = { id: lid, title: v.title.trim(), objective: v.objective.trim(), program: unit.name, unitId: unit.id, duration: typeof v.duration === "number" && v.duration > 0 && v.duration <= 300 ? v.duration : 20, materials: old?.materials || [], reflection: old?.reflection || "¿Qué palabras aprendiste?", activities: [{ title: "Instrucciones", minutes: 20, instructions: v.instructions }], publishedAt: old?.publishedAt || "", shareCode: old?.shareCode || (current.organizationId === "org-other" ? "O-" : "D-") + crypto.randomUUID().replaceAll("-", "").slice(0, 16).toUpperCase() };
  const now = new Date().toISOString();
  if (v.activities !== undefined) {
    if (!validActivities(v.activities)) return reply({ error: "Revisa las actividades: título, instrucciones, tipo y posiciones consecutivas desde cero; cada pregunta requiere opciones distintas y una respuesta válida." }, 400);
    lesson.activities = (v.activities as Activity[]).map(a => ({ id: a.id, type: a.type, position: a.position, title: a.title, instructions: a.instructions, minutes: a.minutes, ...(a.type === "resource" ? { resourceId: a.resourceId } : {}), ...(a.type === "question" ? { options: a.options, answer: a.answer } : {}) }));
  } else if (old) lesson.activities = old.activities;
  const library = await resources(db, current.organizationId);
  for (const activity of lesson.activities) {
    if (activity.type !== "resource") continue;
    const resource = library.find(r => r.id === activity.resourceId);
    const alreadyLinked = old?.activities.some(a => a.resourceId === activity.resourceId);
    if (!resource || (resource.status === "archived" && !alreadyLinked)) return reply({ error: "Selecciona un recurso activo de tu organización." }, 400);
  }
  if (row) {
    if (v.draftVersion !== row.draft_version) return reply({ error: "Hay cambios más recientes. Recarga antes de guardar." }, 409);
    const written = await db.prepare("UPDATE lessons SET content=?,unit_id=?,archived=?,draft_version=draft_version+1,updated_at=? WHERE id=? AND draft_version=? RETURNING id").bind(JSON.stringify(lesson), unit.id, v.status === "archived" ? 1 : 0, now, lid, row.draft_version).first();
    if (!written) return reply({ error: "Hay cambios más recientes. Recarga antes de guardar." }, 409);
    if (unit.id !== row.unit_id) {
      await db.batch([
        db.prepare("UPDATE lessons SET position=? WHERE id=?").bind(rows.filter(r => r.unit_id === unit.id).length, lid),
        ...rows.filter(r => r.unit_id === row.unit_id && r.id !== lid).sort((a, b) => a.position - b.position).map((r, position) => db.prepare("UPDATE lessons SET position=? WHERE id=?").bind(position, r.id)),
      ]);
    }
  } else {
    let program = await db.prepare("SELECT id FROM programs WHERE organization_id=? LIMIT 1").bind(current.organizationId).first<{ id: string }>();
    if (!program) { program = { id: `curriculum-${current.organizationId}` }; await db.prepare("INSERT OR IGNORE INTO programs VALUES (?,?,?)").bind(program.id, current.organizationId, "Happy Learners").run(); }
    await db.prepare("INSERT INTO lessons(id,program_id,status,content,unit_id,position,updated_at) VALUES (?,?,'draft',?,?,?,?)").bind(lid, program.id, JSON.stringify(lesson), unit.id, rows.filter(r => r.unit_id === unit.id).length, now).run();
  }
  const updated = await db.prepare(lessonQuery + " AND l.id=?").bind(current.organizationId, lid).first<LessonRow>();
  return reply({ lesson: lessonView(updated!, true) }, row ? 200 : 201);
}

export async function shared(path: string, method: string, request: Request, db: Database): Promise<Response> {
  const code = path.split("/")[3];
  const row = await db.prepare("SELECT id,published_content FROM lessons WHERE archived=0 AND published_content IS NOT NULL AND json_extract(published_content,'$.shareCode')=?").bind(code).first<{ id: string; published_content: string }>();
  if (!row) return reply({ error: "Lección no disponible." }, 404);
  if (method === "GET") return reply({ lesson: JSON.parse(row.published_content) });
  const name = `hl_completed_${row.id.replaceAll("-", "_")}`;
  if (!(request.headers.get("Cookie") || "").split(";").some(c => c.trim() === `${name}=1`)) await db.prepare("INSERT INTO lesson_completions VALUES (?,?,?)").bind(crypto.randomUUID(), row.id, Date.now()).run();
  return Response.json({ ok: true }, { headers: { "Set-Cookie": `${name}=1; Path=/; HttpOnly; SameSite=Strict; Max-Age=2592000${new URL(request.url).protocol === "https:" ? "; Secure" : ""}` } });
}
