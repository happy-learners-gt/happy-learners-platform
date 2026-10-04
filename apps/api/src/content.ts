import type { Activity, Lesson, Member, Resource } from "@happy-learners/contracts";
import { assesses, moduleNavigation, lessonOutcomes, outcomeCodes, resourceIdsOf, sequenceTemplates, studentActivities, validActivities, validOutcomeIds } from "@happy-learners/domain";
import type { Database } from "./storage";
import { configurationOf, curriculumFor, materialsFor } from "./courses";
import { recordEvent } from "./team";
import { filesFor } from "./files";
const reply = (data: unknown, status = 200) => Response.json(data, { status });
type LessonRow = { id: string; content: string; published_content: string | null; unit_id: string | null; course_unit_id: string | null; course_id: string | null; position: number; status: "draft" | "published"; archived: number; revision: number; draft_version: number; published_version: number; updated_at: string; completions: number };
const lessonQuery = "SELECT l.*,c.id AS course_id,(SELECT count(*) FROM lesson_completions lc WHERE lc.lesson_id=l.id) AS completions FROM lessons l JOIN programs p ON p.id=l.program_id LEFT JOIN courses c ON c.legacy_program_id=p.id LEFT JOIN learning_units cu ON cu.id=l.course_unit_id LEFT JOIN units u ON u.id=l.unit_id LEFT JOIN levels lv ON lv.id=u.level_id WHERE p.organization_id=?";
function lessonView(row: LessonRow, draft: boolean): Lesson {
  return { ...JSON.parse(draft ? row.content : row.published_content || row.content), unitId: row.unit_id || undefined, courseUnitId: row.course_unit_id || undefined, courseId: row.course_id || undefined, position: row.position, status: row.archived ? "archived" : row.status, revision: row.revision, draftVersion: row.draft_version, hasDraft: row.draft_version !== row.published_version, updatedAt: row.updated_at, completions: row.completions };
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
  const courseFilter = url.searchParams.get("course");
  if (courseFilter && !await db.prepare("SELECT id FROM courses WHERE id=? AND organization_id=?").bind(courseFilter, current.organizationId).first()) return reply({ error: "Curso no disponible." }, 404);
  const rows = (await db.prepare(lessonQuery + (courseFilter ? " AND c.id=?" : "") + " ORDER BY c.title,COALESCE(cu.position,u.position),l.position,l.id").bind(current.organizationId, ...(courseFilter ? [courseFilter] : [])).all<LessonRow>()).results;
  if (id === "order" && method === "PUT") {
    const v = input as { unitId?: string; courseUnitId?: string; ids?: string[] } | null;
    if (!v?.unitId && !v?.courseUnitId) return reply({ error: "Selecciona una unidad." }, 400);
    const selected = rows.filter(r => v?.courseUnitId ? r.course_unit_id === v.courseUnitId : r.unit_id === v?.unitId);
    if (!v || !Array.isArray(v.ids) || v.ids.length !== selected.length || new Set(v.ids).size !== selected.length || v.ids.some(x => !selected.some(r => r.id === x))) return reply({ error: "El orden debe incluir todas las lecciones de la unidad una sola vez." }, 400);
    await db.batch(v.ids.map((item, i) => db.prepare("UPDATE lessons SET position=? WHERE id=?").bind(i, item))); return reply({ ok: true });
  }
  const row = rows.find(r => r.id === id);
  if (id && (!row || (method === "GET" && !draft && (!row.published_content || row.archived)))) return reply({ error: "Lección no disponible." }, 404);
  if (method === "GET") return id ? reply({ lesson: lessonView(row!, draft) }) : reply({ lessons: rows.filter(r => draft || (r.published_content && !r.archived)).map(r => lessonView(r, draft)) });
  if (path.endsWith("/publish") && row) {
    if (row.course_id && !await db.prepare("SELECT c.id FROM courses c JOIN learning_units u ON u.course_id=c.id WHERE c.id=? AND u.id=? AND c.status='active' AND u.status='active'").bind(row.course_id, row.course_unit_id).first()) return reply({ error: "Restaura el curso y su unidad antes de publicar." }, 409);
    const lesson = JSON.parse(row.content) as Lesson;
    if (!lesson.title.trim() || !lesson.objective.trim() || !lesson.activities.length) return reply({ error: "Completa título, objetivo y al menos una actividad." }, 400);
    const library = [...await resources(db, current.organizationId), ...await materialsFor(db, current.organizationId), ...await filesFor(db, current.organizationId)];
    const resourceIds = resourceIdsOf(lesson.activities);
    if (resourceIds.some(rid => !library.some(r => r.id === rid))) return reply({ error: "Hay un recurso no disponible. Revisa las actividades." }, 400);
    if (row.archived) return reply({ error: "Restaura la lección antes de publicarla." }, 409);
    // Students see the wording of the outcomes as it is today; later edits to the plan need a new publication.
    const outcomes = row.course_id ? (await curriculumFor(db, row.course_id)).outcomes : [];
    const codes = outcomeCodes(outcomes);
    // What the course's configuration requires before publishing.
    const settings = row.course_id ? (await configurationOf(db, current.organizationId, row.course_id))?.settings : undefined;
    if (settings?.outcomesRequired && !lessonOutcomes(lesson).some(oid => codes.has(oid))) return reply({ error: "Este curso exige que la lección trabaje al menos un resultado de aprendizaje antes de publicarla." }, 400);
    if (settings?.assessmentRequired && !lesson.activities.some(assesses)) return reply({ error: "Este curso exige una pregunta o una actividad de evaluación antes de publicar." }, 400);
    const learning = lessonOutcomes(lesson).filter(oid => codes.has(oid)).sort((a, b) => codes.get(a)!.localeCompare(codes.get(b)!, "es", { numeric: true })).map(oid => ({ id: oid, code: codes.get(oid)!, statement: outcomes.find(o => o.id === oid)!.statement }));
    // Teacher notes stay in the draft; students only receive what is meant for them.
    const published = { ...lesson, outcomes: learning, activities: studentActivities(lesson.activities), resources: resourceIds.map(rid => library.find(r => r.id === rid)!), publishedAt: new Date().toISOString(), revision: row.revision + 1 };
    const written = await db.prepare("UPDATE lessons SET published_content=?,published_version=draft_version,revision=revision+1,status='published' WHERE id=? AND draft_version=? RETURNING id").bind(JSON.stringify(published), row.id, row.draft_version).first();
    if (!written) return reply({ error: "El borrador cambió. Recarga y vuelve a publicar." }, 409);
    await recordEvent(db, current, { action: "published", targetType: "lesson", targetId: row.id, courseId: row.course_id, summary: `Publicó «${lesson.title}» (publicación ${row.revision + 1})` });
    return reply({ lesson: published });
  }
  if (method === "DELETE") return reply({ error: "Archiva la lección para conservar su historial." }, 409);
  if (!input || typeof input !== "object") return reply({ error: "Completa la lección." }, 400);
  const v = input as Record<string, unknown>;
  const generic = typeof v.courseUnitId === "string";
  const unit = generic
    ? await db.prepare("SELECT u.id,u.name,u.legacy_unit_id AS legacyUnitId,c.id AS courseId,c.legacy_program_id AS programId FROM learning_units u JOIN courses c ON c.id=u.course_id WHERE u.id=? AND c.organization_id=? AND u.status='active' AND c.status='active'").bind(String(v.courseUnitId), current.organizationId).first<{ id: string; name: string; courseId?: string; programId?: string; legacyUnitId?: string | null }>()
    : await db.prepare("SELECT u.id,u.name FROM units u JOIN levels l ON l.id=u.level_id WHERE u.id=? AND l.organization_id=? AND u.status='active' AND l.status!='archived'").bind(String(v.unitId || ""), current.organizationId).first<{ id: string; name: string; courseId?: string; programId?: string; legacyUnitId?: string | null }>();
  if (!unit) return reply({ error: "Selecciona una unidad activa de tu organización." }, 400);
  if (generic && ((v.courseId && v.courseId !== unit.courseId) || (row?.course_id && row.course_id !== unit.courseId))) return reply({ error: "La lección debe permanecer en su curso. Reutilizar entre cursos requiere una copia." }, 400);
  if (typeof v.title !== "string" || !v.title.trim() || v.title.length > 160 || typeof v.objective !== "string" || !v.objective.trim() || v.objective.length > 1000 || typeof v.instructions !== "string" || v.instructions.length > 8000) return reply({ error: "Completa título, objetivo e instrucciones dentro del límite." }, 400);
  const old = row ? JSON.parse(row.content) as Lesson : null;
  const lid = id || `lesson-${crypto.randomUUID()}`;
  const lesson: Lesson = { id: lid, title: v.title.trim(), objective: v.objective.trim(), program: unit.name, ...(generic ? { courseId: unit.courseId, courseUnitId: unit.id } : { unitId: unit.id }), duration: typeof v.duration === "number" && v.duration > 0 && v.duration <= 300 ? v.duration : 20, materials: old?.materials || [], reflection: old?.reflection || "¿Qué aprendiste y cómo lo aplicarías?", activities: [{ title: "Instrucciones", minutes: 20, instructions: v.instructions }], publishedAt: old?.publishedAt || "", shareCode: old?.shareCode || (current.organizationId === "org-other" ? "O-" : "D-") + crypto.randomUUID().replaceAll("-", "").slice(0, 16).toUpperCase() };
  // The didactic sequence is a known template or, when not sent, the one the lesson already had.
  const sequence = sequenceTemplates.some(template => template.value === v.sequence) ? v.sequence as Lesson["sequence"] : old?.sequence;
  if (sequence) lesson.sequence = sequence;
  const now = new Date().toISOString();
  if (v.activities !== undefined) {
    if (!validActivities(v.activities)) return reply({ error: "Revisa las actividades: título, instrucciones, tipo y posiciones consecutivas desde cero; cada pregunta requiere opciones distintas y una respuesta válida." }, 400);
    // Only known fields are stored, whatever else the client sends.
    lesson.activities = (v.activities as Activity[]).map(a => ({
      id: a.id, position: a.position, title: a.title, minutes: a.minutes,
      ...(a.phase ? { phase: a.phase } : {}), ...(a.purpose ? { purpose: a.purpose } : {}), ...(a.grouping ? { grouping: a.grouping } : {}), ...(a.outcomeIds?.length ? { outcomeIds: a.outcomeIds } : {}),
      ...(a.blocks ? { instructions: "", blocks: a.blocks.map(b => ({ id: b.id, kind: b.kind, ...(b.instructions ? { instructions: b.instructions } : {}), ...(b.richContent ? { richContent: b.richContent } : {}), ...(b.kind === "resource" ? { resourceId: b.resourceId } : {}), ...(b.kind === "question" ? { options: b.options, answer: b.answer } : {}) })) }
        : { type: a.type, instructions: a.instructions, ...(a.richContent ? { richContent: a.richContent } : {}), ...(a.type === "resource" ? { resourceId: a.resourceId } : {}), ...(a.type === "question" ? { options: a.options, answer: a.answer } : {}) }),
    }));
  } else if (old) lesson.activities = old.activities;
  // Outcomes come from the lesson's own course; archived ones may stay where they were already named.
  if (v.outcomeIds !== undefined) {
    if (!validOutcomeIds(v.outcomeIds)) return reply({ error: "Elige hasta 12 resultados de aprendizaje distintos." }, 400);
    lesson.outcomeIds = v.outcomeIds;
  } else if (old?.outcomeIds) lesson.outcomeIds = old.outcomeIds;
  if (lessonOutcomes(lesson).length) {
    const outcomes = generic && unit.courseId ? (await curriculumFor(db, unit.courseId)).outcomes : [];
    const before = new Set(old ? lessonOutcomes(old) : []);
    if (lessonOutcomes(lesson).some(oid => !outcomes.some(o => o.id === oid && (o.status === "active" || before.has(oid))))) return reply({ error: "Elige resultados de aprendizaje activos del curso de esta lección." }, 400);
  }
  const library = [...await resources(db, current.organizationId), ...await materialsFor(db, current.organizationId), ...await filesFor(db, current.organizationId)];
  const previouslyLinked = new Set(old ? resourceIdsOf(old.activities) : []);
  for (const resourceId of resourceIdsOf(lesson.activities)) {
    const resource = library.find(r => r.id === resourceId);
    const alreadyLinked = previouslyLinked.has(resourceId);
    if (!resource || (resource.status === "archived" && !alreadyLinked)) return reply({ error: "Selecciona un recurso activo de tu organización." }, 400);
    if ("courseId" in resource && resource.courseId !== unit.courseId) return reply({ error: "El material pertenece a otro curso. No se puede vincular directamente." }, 400);
  }
  // Legacy authoring routes are retained during migration. Their IDs stay stable;
  // resolve the explicit course/unit mapping instead of creating a course per level.
  let programId = unit.programId;
  let courseUnitId = generic ? unit.id : null;
  if (!generic) {
    const existing = row ? await db.prepare("SELECT program_id AS id FROM lessons WHERE id=?").bind(row.id).first<{ id: string }>() : await db.prepare("SELECT p.id FROM programs p JOIN courses c ON c.legacy_program_id=p.id WHERE p.organization_id=? AND c.id=\'course-\'||p.id ORDER BY CASE WHEN EXISTS(SELECT 1 FROM lessons l WHERE l.program_id=p.id AND l.unit_id=?) THEN 0 ELSE 1 END,p.id LIMIT 1").bind(current.organizationId, unit.id).first<{ id: string }>();
    programId = existing?.id || `curriculum-${current.organizationId}`;
    let course = await db.prepare("SELECT id,status FROM courses WHERE legacy_program_id=? AND organization_id=?").bind(programId, current.organizationId).first<{ id: string; status: string }>();
    if (!course) {
      course = { id: `course-${programId}`, status: "active" };
      await db.batch([
        db.prepare("INSERT OR IGNORE INTO programs(id,organization_id,title) VALUES (?,?,?)").bind(programId, current.organizationId, "Contenido existente"),
        db.prepare("INSERT OR IGNORE INTO courses(id,organization_id,legacy_program_id,title,profile,unit_label,updated_at) SELECT ?,organization_id,id,title,'free','Unidades',? FROM programs WHERE id=?").bind(course.id, now, programId),
      ]);
    }
    if (course.status === "archived") return reply({ error: "Restaura el curso antes de editar sus lecciones." }, 409);
    courseUnitId = `${course.id}--${unit.id}`;
    await db.prepare("INSERT OR IGNORE INTO learning_units(id,course_id,legacy_unit_id,name,objective,position,status,updated_at) SELECT ?,?,id,name,objective,(SELECT count(*) FROM learning_units WHERE course_id=?),status,updated_at FROM units WHERE id=?").bind(courseUnitId, course.id, course.id, unit.id).run();
    lesson.courseId = course.id; lesson.courseUnitId = courseUnitId;
  }
  if (row) {
    if (v.draftVersion !== row.draft_version) return reply({ error: "Hay cambios más recientes. Recarga antes de guardar." }, 409);
    const written = await db.prepare("UPDATE lessons SET content=?,unit_id=?,course_unit_id=?,archived=?,draft_version=draft_version+1,updated_at=? WHERE id=? AND draft_version=? RETURNING id").bind(JSON.stringify(lesson), generic ? unit.legacyUnitId || null : unit.id, courseUnitId, v.status === "archived" ? 1 : 0, now, lid, row.draft_version).first();
    if (!written) return reply({ error: "Hay cambios más recientes. Recarga antes de guardar." }, 409);
    if (courseUnitId !== row.course_unit_id) {
      await db.batch([
        db.prepare("UPDATE lessons SET position=? WHERE id=?").bind(rows.filter(r => r.course_unit_id === courseUnitId).length, lid),
        ...rows.filter(r => r.course_unit_id === row.course_unit_id && r.id !== lid).sort((a, b) => a.position - b.position).map((r, position) => db.prepare("UPDATE lessons SET position=? WHERE id=?").bind(position, r.id)),
      ]);
    }
  } else {
    await db.prepare("INSERT INTO lessons(id,program_id,status,content,unit_id,course_unit_id,position,updated_at) VALUES (?,?,'draft',?,?,?,?,?)").bind(lid, programId!, JSON.stringify(lesson), generic ? unit.legacyUnitId || null : unit.id, courseUnitId, rows.filter(r => r.course_unit_id === courseUnitId).length, now).run();
  }
  // Autosave is not an event; creating, archiving and restoring a lesson are.
  const archivedNow = v.status === "archived" ? 1 : 0;
  if (!row || row.archived !== archivedNow) await recordEvent(db, current, { action: !row ? "created" : archivedNow ? "archived" : "restored", targetType: "lesson", targetId: lid, courseId: lesson.courseId || null, summary: `${!row ? "Creó" : archivedNow ? "Archivó" : "Restauró"} la lección «${lesson.title}»` });
  const updated = await db.prepare(lessonQuery + " AND l.id=?").bind(current.organizationId, lid).first<LessonRow>();
  return reply({ lesson: lessonView(updated!, true) }, row ? 200 : 201);
}

/** The lesson's place among the published lessons of its module, in curriculum order. */
async function navigationOf(db: Database, lessonId: string, unitId: string | null) {
  if (!unitId) return null;
  const unit = await db.prepare("SELECT u.name FROM learning_units u JOIN courses c ON c.id=u.course_id WHERE u.id=? AND u.status='active' AND c.status='active'").bind(unitId).first<{ name: string }>();
  if (!unit) return null;
  const siblings = await db.prepare("SELECT id,json_extract(published_content,'$.title') AS title,json_extract(published_content,'$.shareCode') AS shareCode,archived,(published_content IS NOT NULL) AS published FROM lessons WHERE course_unit_id=? ORDER BY position,id").bind(unitId).all<{ id: string; title: string | null; shareCode: string | null; archived: number; published: number }>();
  return moduleNavigation(unit.name, siblings.results.map(item => ({ id: item.id, title: item.title || "Lección", shareCode: item.shareCode || undefined, published: !!item.published, archived: !!item.archived })), lessonId);
}

export async function shared(path: string, method: string, request: Request, db: Database): Promise<Response> {
  const code = path.split("/")[3];
  const row = await db.prepare("SELECT id,published_content,course_unit_id FROM lessons WHERE archived=0 AND published_content IS NOT NULL AND json_extract(published_content,'$.shareCode')=?").bind(code).first<{ id: string; published_content: string; course_unit_id: string | null }>();
  if (!row) return reply({ error: "Lección no disponible." }, 404);
  if (method === "GET") return reply({ lesson: JSON.parse(row.published_content), navigation: await navigationOf(db, row.id, row.course_unit_id) });
  const name = `hl_completed_${row.id.replaceAll("-", "_")}`;
  if (!(request.headers.get("Cookie") || "").split(";").some(c => c.trim() === `${name}=1`)) await db.prepare("INSERT INTO lesson_completions VALUES (?,?,?)").bind(crypto.randomUUID(), row.id, Date.now()).run();
  return Response.json({ ok: true }, { headers: { "Set-Cookie": `${name}=1; Path=/; HttpOnly; SameSite=Strict; Max-Age=2592000${new URL(request.url).protocol === "https:" ? "; Secure" : ""}` } });
}
