import type { Activity, Lesson, LessonReview, Member, Resource, ReviewItem } from "@happy-learners/contracts";
import { assesses, lessonMinutes, moduleNavigation, sharePrefix, lessonOutcomes, outcomeCodes, resourceIdsOf, sequenceTemplates, studentActivities, validActivities, validOutcomeIds } from "@happy-learners/domain";
import type { Database } from "./storage";
import { configurationOf, curriculumFor, materialsFor } from "./courses";
import { event, recordEvent } from "./team";
import { filesFor } from "./files";
import { accessTo, forbidden, reachableCourses } from "./access";
import { scopedCourses } from "./permissions";
import { digest } from "./auth";
import { pathLesson, studentAccess, studentToken } from "./classes";
import { studentActivityGroups } from "./workgroups";
const reply = (data: unknown, status = 200) => Response.json(data, { status });
type LessonRow = { id: string; content: string; published_content: string | null; unit_id: string | null; course_unit_id: string | null; course_id: string | null; position: number; status: "draft" | "published"; archived: number; revision: number; draft_version: number; published_version: number; updated_at: string; completions: number; review: string | null };
/** The latest review of the lesson, with the names of who asked and who decided. */
const reviewColumn = `(SELECT json_object('id',r.id,'status',r.status,'note',r.note,'requestedById',r.requested_by,'requestedByName',COALESCE(ru.display_name,ru.username),'requestedAt',r.requested_at,'decidedByName',COALESCE(du.display_name,du.username),'decidedAt',r.decided_at,'decisionNote',r.decision_note)
  FROM lesson_reviews r JOIN users ru ON ru.id=r.requested_by LEFT JOIN users du ON du.id=r.decided_by WHERE r.lesson_id=l.id ORDER BY r.requested_at DESC,r.rowid DESC LIMIT 1) AS review`;
const lessonQuery = `SELECT l.*,c.id AS course_id,(SELECT count(*) FROM lesson_completions lc WHERE lc.lesson_id=l.id) AS completions,${reviewColumn} FROM lessons l JOIN programs p ON p.id=l.program_id LEFT JOIN courses c ON c.legacy_program_id=p.id LEFT JOIN learning_units cu ON cu.id=l.course_unit_id LEFT JOIN units u ON u.id=l.unit_id LEFT JOIN levels lv ON lv.id=u.level_id WHERE p.organization_id=?`;
function lessonView(row: LessonRow, draft: boolean): Lesson {
  const review = draft && row.review ? JSON.parse(row.review) as LessonReview : null;
  return { ...JSON.parse(draft ? row.content : row.published_content || row.content), unitId: row.unit_id || undefined, courseUnitId: row.course_unit_id || undefined, courseId: row.course_id || undefined, position: row.position, status: row.archived ? "archived" : row.status, revision: row.revision, draftVersion: row.draft_version, hasDraft: row.draft_version !== row.published_version, updatedAt: row.updated_at, completions: row.completions,
    ...(draft ? { review: review && review.status !== "approved" ? review : null } : {}) };
}
export async function resources(db: Database, organization: string) {
  const rows = await db.prepare("SELECT id,title,description,level,skill,topic,tags,content,status,archived,kind,updated_at AS updatedAt FROM resources WHERE organization_id=? ORDER BY title").bind(organization).all<Omit<Resource, "tags"> & { tags: string; archived: number }>();
  return rows.results.map(({ archived, ...r }) => ({ ...r, tags: JSON.parse(r.tags) as string[], status: archived ? "archived" as const : r.status }));
}
const noteOf = (value: unknown) => typeof value === "string" && value.trim().length <= 600 && !/[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(value) ? value.trim() : null;

/**
 * What a lesson's publication would contain, or why it cannot be published yet. Publishing and asking for a
 * review apply the same rules, so the lead never receives a lesson that could not be published.
 */
async function publication(db: Database, current: Member, row: LessonRow) {
  if (row.course_id && !await db.prepare("SELECT c.id FROM courses c JOIN learning_units u ON u.course_id=c.id WHERE c.id=? AND u.id=? AND c.status='active' AND u.status='active'").bind(row.course_id, row.course_unit_id).first()) return { error: "Restaura el curso y su unidad antes de publicar.", status: 409 };
  const lesson = JSON.parse(row.content) as Lesson;
  if (!lesson.title.trim() || !lesson.objective.trim() || !lesson.activities.length) return { error: "Completa título, objetivo y al menos una actividad.", status: 400 };
  const library = [...await resources(db, current.organizationId), ...await materialsFor(db, current.organizationId), ...await filesFor(db, current.organizationId)];
  const resourceIds = resourceIdsOf(lesson.activities);
  if (resourceIds.some(rid => !library.some(r => r.id === rid))) return { error: "Hay un recurso no disponible. Revisa las actividades.", status: 400 };
  if (row.archived) return { error: "Restaura la lección antes de publicarla.", status: 409 };
  // Students see the wording of the outcomes as it is today; later edits to the plan need a new publication.
  const outcomes = row.course_id ? (await curriculumFor(db, row.course_id)).outcomes : [];
  const codes = outcomeCodes(outcomes);
  // What the course's configuration requires before publishing.
  const settings = row.course_id ? (await configurationOf(db, current.organizationId, row.course_id))?.settings : undefined;
  if (settings?.outcomesRequired && !lessonOutcomes(lesson).some(oid => codes.has(oid))) return { error: "Este curso exige que la lección trabaje al menos un resultado de aprendizaje antes de publicarla.", status: 400 };
  if (settings?.assessmentRequired && !lesson.activities.some(assesses)) return { error: "Este curso exige una pregunta o una actividad de evaluación antes de publicar.", status: 400 };
  const learning = lessonOutcomes(lesson).filter(oid => codes.has(oid)).sort((a, b) => codes.get(a)!.localeCompare(codes.get(b)!, "es", { numeric: true })).map(oid => ({ id: oid, code: codes.get(oid)!, statement: outcomes.find(o => o.id === oid)!.statement }));
  // Teacher notes stay in the draft; students only receive what is meant for them.
  return { lesson, published: { ...lesson, outcomes: learning, activities: studentActivities(lesson.activities), resources: resourceIds.map(rid => library.find(r => r.id === rid)!), publishedAt: new Date().toISOString(), revision: row.revision + 1 } };
}

/** GET /api/reviews — what the lead has to decide, and what the person sent for review that is still open. */
export async function reviews(current: Member, db: Database) {
  const columns = "r.id,r.status,r.note,r.requested_by AS requestedById,COALESCE(ru.display_name,ru.username) AS requestedByName,r.requested_at AS requestedAt,COALESCE(du.display_name,du.username) AS decidedByName,r.decided_at AS decidedAt,r.decision_note AS decisionNote,r.lesson_id AS lessonId,json_extract(l.content,'$.title') AS lessonTitle,c.id AS courseId,c.title AS courseTitle";
  const joins = "FROM lesson_reviews r JOIN users ru ON ru.id=r.requested_by LEFT JOIN users du ON du.id=r.decided_by JOIN lessons l ON l.id=r.lesson_id AND l.archived=0 JOIN courses c ON c.id=r.course_id AND c.status='active'";
  // The lead decides the course's reviews; coordination too, in the courses of its scope (DEC-041).
  const scoped = await scopedCourses(db, current, ["lessons.review"]);
  const [toReview, mine] = await db.batch([
    db.prepare(`SELECT ${columns} ${joins} WHERE r.organization_id=? AND r.status='pending' AND (EXISTS(SELECT 1 FROM course_members cm WHERE cm.course_id=r.course_id AND cm.user_id=? AND cm.role='lead') OR r.course_id IN (SELECT value FROM json_each(?))) ORDER BY r.requested_at`).bind(current.organizationId, current.id, JSON.stringify(scoped)),
    // Only the latest request of each lesson: a returned one stays until it is sent again or published.
    db.prepare(`SELECT ${columns} ${joins} WHERE r.organization_id=? AND r.requested_by=? AND r.status IN ('pending','returned') AND NOT EXISTS(SELECT 1 FROM lesson_reviews n WHERE n.lesson_id=r.lesson_id AND (n.requested_at>r.requested_at OR (n.requested_at=r.requested_at AND n.rowid>r.rowid))) ORDER BY COALESCE(r.decided_at,r.requested_at) DESC LIMIT 20`).bind(current.organizationId, current.id),
  ]) as unknown as [ReviewItem[], ReviewItem[]];
  return reply({ toReview, mine });
}

export async function content(url: URL, method: string, input: unknown, current: Member, db: Database): Promise<Response> {
  const path = url.pathname; const id = path.split("/")[3]; const resourceRoute = path.startsWith("/api/resources");
  const draft = url.searchParams.has("draft") || url.searchParams.has("drafts");
  // The organization's general library, read-only since 1.0 (ST-076): resources are added and edited in each course.
  if (resourceRoute) return reply({ resources: await resources(db, current.organizationId) });
  const courseFilter = url.searchParams.get("course");
  if (courseFilter && !await db.prepare("SELECT id FROM courses WHERE id=? AND organization_id=?").bind(courseFilter, current.organizationId).first()) return reply({ error: "Curso no disponible." }, 404);
  // Educators reach the lessons of their courses only; administration reads every course.
  const reachable = await reachableCourses(db, current);
  const rows = (await db.prepare(lessonQuery + (courseFilter ? " AND c.id=?" : "") + " ORDER BY c.title,COALESCE(cu.position,u.position),l.position,l.id").bind(current.organizationId, ...(courseFilter ? [courseFilter] : [])).all<LessonRow>()).results
    .filter(r => !reachable || (r.course_id !== null && reachable.has(r.course_id)));
  const accessOf = async (courseId: string | null) => courseId ? await accessTo(db, current, courseId) : null;
  if (id === "order" && method === "PUT") {
    const v = input as { unitId?: string; courseUnitId?: string; ids?: string[] } | null;
    if (!v?.unitId && !v?.courseUnitId) return reply({ error: "Selecciona una unidad." }, 400);
    const selected = rows.filter(r => v?.courseUnitId ? r.course_unit_id === v.courseUnitId : r.unit_id === v?.unitId);
    if (!v || !Array.isArray(v.ids) || v.ids.length !== selected.length || new Set(v.ids).size !== selected.length || v.ids.some(x => !selected.some(r => r.id === x))) return reply({ error: "El orden debe incluir todas las lecciones de la unidad una sola vez." }, 400);
    if (selected.length && !(await accessOf(selected[0].course_id))?.publish) return forbidden("Solo la persona responsable del curso ordena sus lecciones.");
    await db.batch(v.ids.map((item, i) => db.prepare("UPDATE lessons SET position=? WHERE id=?").bind(i, item))); return reply({ ok: true });
  }
  const row = rows.find(r => r.id === id);
  if (id && (!row || (method === "GET" && !draft && (!row.published_content || row.archived)))) return reply({ error: "Lección no disponible." }, 404);
  if (method === "GET") return id ? reply({ lesson: lessonView(row!, draft) }) : reply({ lessons: rows.filter(r => draft || (r.published_content && !r.archived)).map(r => lessonView(r, draft)) });
  const access = row ? await accessOf(row.course_id) : null;
  // Publishing and returning a review belong to whoever reviews the course: its lead, or coordination in its scope.
  const deciding = method === "POST" && (path.endsWith("/publish") || path.endsWith("/review/return"));
  if (row && !access?.edit && !(deciding && access?.review)) return forbidden("Solo el equipo docente del curso edita sus lecciones.");
  const lessonTitle = row ? (JSON.parse(row.content) as Lesson).title : "";
  if (path.endsWith("/publish") && row) {
    if (!access!.review) return forbidden("La persona responsable del curso publica sus lecciones. Envía la lección a revisión.");
    const expected = url.searchParams.get("draftVersion");
    if (expected !== null && Number(expected) !== row.draft_version) return reply({ error: "La lección cambió desde que la abriste. Recarga para revisar la versión actual antes de publicar." }, 409);
    const result = await publication(db, current, row);
    if ("error" in result) return reply({ error: result.error }, result.status);
    const now = new Date().toISOString();
    const written = await db.guardedBatch(
      db.prepare("UPDATE lessons SET published_content=?,published_version=draft_version,revision=revision+1,status='published' WHERE id=? AND draft_version=? RETURNING id").bind(JSON.stringify(result.published), row.id, row.draft_version),
      // Publishing what a co-teacher sent for review approves it.
      [db.prepare("UPDATE lesson_reviews SET status='approved',decided_by=?,decided_at=? WHERE lesson_id=? AND status='pending'").bind(current.id, now, row.id),
        event(db, current, { action: "published", targetType: "lesson", targetId: row.id, courseId: row.course_id, summary: `Publicó «${result.lesson.title}» (publicación ${row.revision + 1})` })]);
    if (!written) return reply({ error: "El borrador cambió. Recarga y vuelve a publicar." }, 409);
    return reply({ lesson: result.published });
  }
  if (path.endsWith("/review") && row && method === "POST") {
    if (access!.review) return reply({ error: "Como responsable del curso, publica la lección directamente." }, 409);
    const note = noteOf((input as Record<string, unknown> | null)?.note ?? "");
    if (note === null) return reply({ error: "Escribe un comentario de hasta 600 caracteres." }, 400);
    const result = await publication(db, current, row);
    if ("error" in result) return reply({ error: result.error }, result.status);
    const now = new Date().toISOString();
    // Sending again while a request is open updates it: one open request per lesson.
    await db.batch([
      db.prepare("INSERT INTO lesson_reviews(id,lesson_id,course_id,organization_id,status,note,requested_by,requested_at) VALUES (?,?,?,?,'pending',?,?,?) ON CONFLICT(lesson_id) WHERE status='pending' DO UPDATE SET note=excluded.note,requested_by=excluded.requested_by,requested_at=excluded.requested_at")
        .bind(`review-${crypto.randomUUID()}`, row.id, row.course_id!, current.organizationId, note, current.id, now),
      event(db, current, { action: "updated", targetType: "lesson", targetId: row.id, courseId: row.course_id, summary: `Envió a revisión «${lessonTitle}»` }),
    ]);
    const updated = await db.prepare(lessonQuery + " AND l.id=?").bind(current.organizationId, row.id).first<LessonRow>();
    return reply({ lesson: lessonView(updated!, true) }, 201);
  }
  if (path.endsWith("/review/return") && row && method === "POST") {
    if (!access!.review) return forbidden("Solo la persona responsable del curso y la coordinación académica revisan sus lecciones.");
    const note = noteOf((input as Record<string, unknown> | null)?.note);
    if (!note) return reply({ error: "Escribe qué falta ajustar, en hasta 600 caracteres." }, 400);
    const returned = await db.guardedBatch(
      db.prepare("UPDATE lesson_reviews SET status='returned',decided_by=?,decided_at=?,decision_note=? WHERE lesson_id=? AND status='pending' RETURNING id").bind(current.id, new Date().toISOString(), note, row.id),
      [event(db, current, { action: "updated", targetType: "lesson", targetId: row.id, courseId: row.course_id, summary: `Devolvió «${lessonTitle}» con comentarios` })]);
    if (!returned) return reply({ error: "La lección ya no tiene una revisión pendiente. Recarga para ver su estado." }, 409);
    const updated = await db.prepare(lessonQuery + " AND l.id=?").bind(current.organizationId, row.id).first<LessonRow>();
    return reply({ lesson: lessonView(updated!, true) });
  }
  if (path.endsWith("/duplicate") && row) {
    // A new draft in the same module, right after the original: new identity and share code, no publication,
    // the same activities and references to reusable resources (ST-016).
    if (!row.course_unit_id || !await db.prepare("SELECT u.id FROM learning_units u JOIN courses c ON c.id=u.course_id WHERE u.id=? AND u.status='active' AND c.status='active'").bind(row.course_unit_id).first()) return reply({ error: "Restaura el curso y su unidad antes de duplicar la lección." }, 409);
    const source = JSON.parse(row.content) as Lesson;
    const lid = `lesson-${crypto.randomUUID()}`, now = new Date().toISOString();
    const suffix = " (copia)", title = source.title.slice(0, 160 - suffix.length) + suffix;
    const copy: Lesson = { ...source, id: lid, title, publishedAt: "", shareCode: sharePrefix(current.organizationId) + crypto.randomUUID().replaceAll("-", "").slice(0, 16).toUpperCase() };
    const program = await db.prepare("SELECT program_id AS id FROM lessons WHERE id=?").bind(row.id).first<{ id: string }>();
    await db.batch([
      ...rows.filter(r => r.course_unit_id === row.course_unit_id && r.position > row.position).map(r => db.prepare("UPDATE lessons SET position=position+1 WHERE id=?").bind(r.id)),
      db.prepare("INSERT INTO lessons(id,program_id,status,content,unit_id,course_unit_id,position,updated_at) VALUES (?,?,'draft',?,?,?,?,?)").bind(lid, program!.id, JSON.stringify(copy), row.unit_id, row.course_unit_id, row.position + 1, now),
    ]);
    await recordEvent(db, current, { action: "created", targetType: "lesson", targetId: lid, courseId: row.course_id, summary: `Duplicó la lección «${source.title}»` });
    const created = await db.prepare(lessonQuery + " AND l.id=?").bind(current.organizationId, lid).first<LessonRow>();
    return reply({ lesson: lessonView(created!, true) }, 201);
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
  const lesson: Lesson = { id: lid, title: v.title.trim(), objective: v.objective.trim(), program: unit.name, ...(generic ? { courseId: unit.courseId, courseUnitId: unit.id } : { unitId: unit.id }), duration: typeof v.duration === "number" && v.duration > 0 && v.duration <= 300 ? v.duration : 20, materials: old?.materials || [], reflection: old?.reflection || "¿Qué aprendiste y cómo lo aplicarías?", activities: [{ title: "Instrucciones", minutes: 20, instructions: v.instructions }], publishedAt: old?.publishedAt || "", shareCode: old?.shareCode || sharePrefix(current.organizationId) + crypto.randomUUID().replaceAll("-", "").slice(0, 16).toUpperCase() };
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
  lesson.duration = lessonMinutes(lesson);
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
  let courseId = generic ? unit.courseId! : row?.course_id || null;
  if (!generic && !row) {
    const existing = await db.prepare("SELECT p.id FROM programs p JOIN courses c ON c.legacy_program_id=p.id WHERE p.organization_id=? AND c.id=\'course-\'||p.id ORDER BY CASE WHEN EXISTS(SELECT 1 FROM lessons l WHERE l.program_id=p.id AND l.unit_id=?) THEN 0 ELSE 1 END,p.id LIMIT 1").bind(current.organizationId, unit.id).first<{ id: string }>();
    courseId = existing ? `course-${existing.id}` : null;
  }
  // Creating, editing and archiving a lesson belong to the course's team; archiving or restoring it, to its lead.
  const target = row ? access : await accessOf(courseId);
  if (!target?.edit) return forbidden("Solo el equipo docente del curso edita sus lecciones.");
  const archivedNow = v.status === "archived" ? 1 : 0;
  if (row && row.archived !== archivedNow && !target.publish) return forbidden("Solo la persona responsable del curso archiva o restaura sus lecciones.");
  if (!generic) {
    const existing = row ? await db.prepare("SELECT program_id AS id FROM lessons WHERE id=?").bind(row.id).first<{ id: string }>() : { id: courseId!.slice("course-".length) };
    programId = existing!.id;
    const course = await db.prepare("SELECT id,status FROM courses WHERE legacy_program_id=? AND organization_id=?").bind(programId, current.organizationId).first<{ id: string; status: string }>();
    if (!course) return reply({ error: "Selecciona una unidad de un curso de tu organización." }, 400);
    if (course.status === "archived") return reply({ error: "Restaura el curso antes de editar sus lecciones." }, 409);
    courseUnitId = `${course.id}--${unit.id}`;
    await db.prepare("INSERT OR IGNORE INTO learning_units(id,course_id,legacy_unit_id,name,objective,position,status,updated_at) SELECT ?,?,id,name,objective,(SELECT count(*) FROM learning_units WHERE course_id=?),status,updated_at FROM units WHERE id=?").bind(courseUnitId, course.id, course.id, unit.id).run();
    lesson.courseId = course.id; lesson.courseUnitId = courseUnitId;
  }
  if (row) {
    if (v.draftVersion !== row.draft_version) return reply({ error: "Hay cambios más recientes. Recarga antes de guardar." }, 409);
    const written = await db.prepare("UPDATE lessons SET content=?,unit_id=?,course_unit_id=?,archived=?,draft_version=draft_version+1,updated_at=? WHERE id=? AND draft_version=? RETURNING id").bind(JSON.stringify(lesson), generic ? unit.legacyUnitId || null : unit.id, courseUnitId, archivedNow, now, lid, row.draft_version).first();
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
  const token = studentToken(request), now = Date.now(), tokenHash = token ? await digest(token) : "";
  const access = token ? await studentAccess(db, tokenHash) : null;
  if (method === "GET") {
    // With the section code, each activity done in groups says which of the section's groups do it (DEC-028).
    const settings = access && await pathLesson(db, access.courseId, code) ? (await configurationOf(db, access.organizationId, access.courseId))?.settings : null;
    const ofSection = access && settings?.attendance && settings.workGroups;
    return reply({ lesson: JSON.parse(row.published_content), navigation: await navigationOf(db, row.id, row.course_unit_id), groups: ofSection ? await studentActivityGroups(db, access.groupId, row.id, access.learnerId) : [] });
  }
  const name = `hl_completed_${row.id.replaceAll("-", "_")}`;
  // A tu ritmo (DEC-027): a lesson of the course's path counts for the section and for the student who chose their name.
  const inPath = access?.pacing === "self-paced" && !!await pathLesson(db, access.courseId, code);
  if (inPath && access.learnerId) {
    const at = new Date(now).toISOString();
    await db.prepare("INSERT INTO learner_progress(organization_id,group_id,learner_id,lesson_id,opened_at,completed_at) VALUES (?,?,?,?,?,?) ON CONFLICT DO UPDATE SET completed_at=COALESCE(completed_at,max(opened_at,excluded.completed_at))")
      .bind(access.organizationId, access.groupId, access.learnerId, row.id, at, at).run();
  }
  if (!(request.headers.get("Cookie") || "").split(";").some(c => c.trim() === `${name}=1`)) {
    // With the section code, the opening is the section's when the lesson is in one of its classes (DEC-024).
    await db.prepare(`INSERT INTO lesson_completions(id,lesson_id,completed_at,group_id) VALUES (?,?,?,COALESCE(?,(SELECT a.group_id FROM group_access_sessions a JOIN course_groups g ON g.id=a.group_id AND g.status='active'
      WHERE a.token_hash=? AND a.expires_at>? AND EXISTS(SELECT 1 FROM class_sessions s JOIN class_session_lessons p ON p.session_id=s.id WHERE s.group_id=a.group_id AND s.status<>'cancelled' AND p.lesson_id=?))))`)
      .bind(crypto.randomUUID(), row.id, now, inPath ? access.groupId : null, tokenHash, now, row.id).run();
  }
  return Response.json({ ok: true, learner: inPath && access.learnerName ? access.learnerName : null }, { headers: { "Set-Cookie": `${name}=1; Path=/; HttpOnly; SameSite=Strict; Max-Age=2592000${new URL(request.url).protocol === "https:" ? "; Secure" : ""}` } });
}
