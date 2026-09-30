import type { Course, LearningUnit, Material, Member, Taxonomy, TaxonomyTerm, Vocabulary } from "@happy-learners/contracts";
import { cleanText, completeOrder, courseInput, materialInput, record } from "@happy-learners/domain";
import type { Database } from "./storage";
import { filesFor } from "./files";

const reply = (value: unknown, status = 200) => Response.json(value, { status });
const missing = () => reply({ error: "El elemento no está disponible en tu organización." }, 404);
const conflict = () => reply({ error: "Hay cambios más recientes. Recarga antes de guardar; tu borrador no se ha sobrescrito." }, 409);
type StoredCourse = Course & { legacyProgramId: string };
export async function coursesFor(db: Database, organization: string): Promise<StoredCourse[]> {
  const rows = (await db.prepare("SELECT id,title,objective,profile,unit_label AS unitLabel,status,version,updated_at AS updatedAt,legacy_program_id AS legacyProgramId FROM courses WHERE organization_id=? ORDER BY title,id").bind(organization).all<StoredCourse>()).results;
  const terms = (await db.prepare("SELECT course_id,term_id FROM course_terms WHERE organization_id=?").bind(organization).all<{ course_id: string; term_id: string }>()).results;
  return rows.map(row => ({ ...row, termIds: terms.filter(t => t.course_id === row.id).map(t => t.term_id) }));
}
export async function unitsFor(db: Database, courseId: string) {
  return (await db.prepare("SELECT id,course_id AS courseId,name,objective,position,status,updated_at AS updatedAt FROM learning_units WHERE course_id=? ORDER BY position,id").bind(courseId).all<LearningUnit>()).results;
}
export async function materialsFor(db: Database, organization: string, courseId?: string): Promise<Material[]> {
  const rows = (await db.prepare("SELECT id,course_id AS courseId,title,description,kind,content,status,version,updated_at AS updatedAt FROM materials WHERE organization_id=?" + (courseId ? " AND course_id=?" : "") + " ORDER BY title,id").bind(organization, ...(courseId ? [courseId] : [])).all<Material>()).results;
  const terms = (await db.prepare("SELECT material_id,term_id FROM material_terms WHERE organization_id=?").bind(organization).all<{ material_id: string; term_id: string }>()).results;
  return rows.map(row => ({ ...row, termIds: terms.filter(t => t.material_id === row.id).map(t => t.term_id) }));
}
export async function taxonomyFor(db: Database, organization: string): Promise<Taxonomy> {
  const [v, t] = await Promise.all([
    db.prepare("SELECT id,name,status,version FROM vocabularies WHERE organization_id=? ORDER BY name,id").bind(organization).all<Vocabulary>(),
    db.prepare("SELECT id,vocabulary_id AS vocabularyId,name,status,version FROM taxonomy_terms WHERE organization_id=? ORDER BY name,id").bind(organization).all<TaxonomyTerm>(),
  ]);
  return { vocabularies: v.results, terms: t.results };
}
async function validTerms(db: Database, organization: string, ids: string[], previous: string[] = []) {
  const tax = await taxonomyFor(db, organization);
  return ids.every(id => tax.terms.some(t => t.id === id && (previous.includes(id) || (t.status === "active" && tax.vocabularies.some(v => v.id === t.vocabularyId && v.status === "active")))));
}

export async function taxonomy(path: string, method: string, input: unknown, current: Member, db: Database) {
  if (method === "GET") return reply(await taxonomyFor(db, current.organizationId));
  if (current.role !== "admin") return reply({ error: "Solo administración puede configurar las clasificaciones." }, 403);
  const v = record(input), name = cleanText(v?.name, 80);
  if (!v || !name || !["active", "archived"].includes(String(v.status))) return reply({ error: "Escribe un nombre de hasta 80 caracteres y un estado válido." }, 400);
  const isTerm = path.startsWith("/api/terms"), id = path.split("/")[3];
  const table = isTerm ? "taxonomy_terms" : "vocabularies";
  const data = await taxonomyFor(db, current.organizationId);
  const rows = isTerm ? data.terms : data.vocabularies;
  const old = rows.find(r => r.id === id);
  if (id && !old) return missing();
  const parentId = isTerm ? (old && "vocabularyId" in old ? String(old.vocabularyId) : String(v.vocabularyId || "")) : null;
  if (isTerm && !data.vocabularies.some(r => r.id === parentId && r.status === "active")) return reply({ error: "Selecciona un vocabulario activo de tu organización." }, 400);
  const nameKey = name.toLocaleLowerCase("es");
  if (rows.some(r => r.id !== id && r.name.toLocaleLowerCase("es") === nameKey && (!isTerm || ("vocabularyId" in r && r.vocabularyId === parentId)))) return reply({ error: "Ya existe ese nombre en este vocabulario u organización." }, 409);
  const itemId = id || `${isTerm ? "term" : "vocabulary"}-${crypto.randomUUID()}`;
  if (id) {
    const updated = await db.prepare(`UPDATE OR IGNORE ${table} SET name=?,name_key=?,status=?,version=version+1 WHERE id=? AND organization_id=? AND version=? RETURNING id`).bind(name, nameKey, String(v.status), id, current.organizationId, Number.isInteger(v.version) ? Number(v.version) : -1).first();
    if (!updated) return conflict();
  } else {
    // Conditional insertion prevents duplicate names even when requests race.
    const values = [itemId, current.organizationId, name, nameKey, String(v.status)];
    const created = isTerm
      ? await db.prepare("INSERT INTO taxonomy_terms(id,organization_id,name,name_key,status,vocabulary_id) VALUES (?,?,?,?,?,?) ON CONFLICT(vocabulary_id,name_key) DO NOTHING RETURNING id").bind(...values, parentId).first()
      : await db.prepare("INSERT INTO vocabularies(id,organization_id,name,name_key,status) VALUES (?,?,?,?,?) ON CONFLICT(organization_id,name_key) DO NOTHING RETURNING id").bind(...values).first();
    if (!created) return reply({ error: "Ese nombre ya fue registrado. Actualiza la lista." }, 409);
  }
  return reply({ id: itemId, ...await taxonomyFor(db, current.organizationId) }, id ? 200 : 201);
}

export async function courses(path: string, method: string, input: unknown, current: Member, db: Database) {
  const [, , , id, area, itemId] = path.split("/");
  const list = await coursesFor(db, current.organizationId);
  const course = list.find(c => c.id === id);
  if (id && !course) return missing();
  if (method === "GET") {
    if (!id) return reply({ courses: list.map(({ legacyProgramId: _, ...c }) => c) });
    if (area === "materials") return reply({ materials: [...await materialsFor(db, current.organizationId, id), ...await filesFor(db, current.organizationId, id)] });
    const { legacyProgramId: _, ...view } = course!;
    return reply({ course: view, units: await unitsFor(db, id) });
  }
  if (current.role !== "educator") return reply({ error: "Solo educadores pueden preparar cursos y materiales." }, 403);
  const v = record(input);
  if (!v) return reply({ error: "Completa los datos." }, 400);
  const now = new Date().toISOString();
  const guard = () => db.prepare("UPDATE courses SET version=version+1,updated_at=? WHERE id=? AND organization_id=? AND version=? AND status='active' RETURNING id").bind(now, id, current.organizationId, Number.isInteger(v.version) ? Number(v.version) : -1);
  if (area && course?.status === "archived") return reply({ error: "Restaura el curso antes de modificarlo. Sus enlaces publicados se conservan." }, 409);
  if (!area) {
    const data = courseInput(v);
    if (!data) return reply({ error: "Revisa el título, objetivo, perfil, agrupaciones y clasificaciones del curso." }, 400);
    if (!await validTerms(db, current.organizationId, data.termIds, course?.termIds)) return reply({ error: "Hay clasificaciones ajenas a tu organización o archivadas." }, 400);
    const cid = id || `course-${crypto.randomUUID()}`;
    const relationships = [
      db.prepare("DELETE FROM course_terms WHERE course_id=? AND organization_id=?").bind(cid, current.organizationId),
      ...data.termIds.map(term => db.prepare("INSERT INTO course_terms VALUES (?,?,?)").bind(cid, term, current.organizationId)),
    ];
    if (course) {
      const updated = await db.guardedBatch(db.prepare("UPDATE courses SET title=?,objective=?,profile=?,unit_label=?,status=?,version=version+1,updated_at=? WHERE id=? AND organization_id=? AND version=? RETURNING id").bind(data.title, data.objective, data.profile, data.unitLabel, data.status, now, cid, current.organizationId, Number.isInteger(v.version) ? Number(v.version) : -1), relationships);
      if (!updated) return conflict();
    } else {
      await db.batch([
        db.prepare("INSERT INTO programs(id,organization_id,title) VALUES (?,?,?)").bind(cid, current.organizationId, data.title),
        db.prepare("INSERT INTO courses(id,organization_id,legacy_program_id,title,objective,profile,unit_label,status,updated_at) VALUES (?,?,?,?,?,?,?,?,?)").bind(cid, current.organizationId, cid, data.title, data.objective, data.profile, data.unitLabel, data.status, now),
        ...relationships,
      ]);
    }
    return reply({ id: cid }, id ? 200 : 201);
  }
  if (area === "units") {
    const units = await unitsFor(db, id);
    if (itemId === "order") {
      if (!completeOrder(v.ids, units.map(u => u.id))) return reply({ error: "Incluye todas las unidades una sola vez, también las archivadas." }, 400);
      const changes = v.ids.map((uid, position) => db.prepare("UPDATE learning_units SET position=?,updated_at=? WHERE id=? AND course_id=?").bind(position, now, uid, id));
      if (!await db.guardedBatch(guard(), [...changes, db.prepare("SELECT id FROM courses WHERE id=?").bind(id)])) return conflict();
      return reply({ ok: true });
    }
    if (itemId && !units.some(u => u.id === itemId)) return missing();
    const name = cleanText(v.name, 100), objective = cleanText(v.objective, 1000, false);
    if (!name || objective === null || !["active", "archived"].includes(String(v.status))) return reply({ error: "Revisa el nombre, objetivo y estado de la unidad." }, 400);
    const uid = itemId || `learning-unit-${crypto.randomUUID()}`;
    const statement = itemId
      ? db.prepare("UPDATE learning_units SET name=?,objective=?,status=?,updated_at=? WHERE id=? AND course_id=?").bind(name, objective, String(v.status), now, uid, id)
      : db.prepare("INSERT INTO learning_units(id,course_id,name,objective,position,status,updated_at) VALUES (?,?,?,?,?,?,?)").bind(uid, id, name, objective, units.length, String(v.status), now);
    if (!await db.guardedBatch(guard(), [statement])) return conflict();
    return reply({ id: uid }, itemId ? 200 : 201);
  }
  if (area === "materials") {
    const list = await materialsFor(db, current.organizationId, id);
    const old = list.find(m => m.id === itemId);
    if (itemId && !old) return missing();
    const data = materialInput(v);
    if (!data) return reply({ error: "Completa título, descripción y contenido. Los enlaces deben ser http(s), sin credenciales. La clasificación es opcional." }, 400);
    if (data.kind === "link") {
      try { const url = new URL(data.content); if (!url.hostname || url.username || url.password) throw new Error(); }
      catch { return reply({ error: "La dirección del material no es válida." }, 400); }
    }
    if (!await validTerms(db, current.organizationId, data.termIds, old?.termIds)) return reply({ error: "Selecciona clasificaciones activas de tu organización." }, 400);
    const mid = itemId || `material-${crypto.randomUUID()}`;
    const relationships = [
      db.prepare("DELETE FROM material_terms WHERE material_id=? AND organization_id=?").bind(mid, current.organizationId),
      ...data.termIds.map(term => db.prepare("INSERT INTO material_terms VALUES (?,?,?)").bind(mid, term, current.organizationId)),
    ];
    if (old) {
      const updated = await db.guardedBatch(db.prepare("UPDATE materials SET title=?,description=?,content=?,kind=?,status=?,version=version+1,updated_at=? WHERE id=? AND course_id=? AND organization_id=? AND version=? RETURNING id").bind(data.title, data.description, data.content, data.kind, data.status, now, mid, id, current.organizationId, Number.isInteger(v.version) ? Number(v.version) : -1), relationships);
      if (!updated) return conflict();
    } else {
      await db.batch([db.prepare("INSERT INTO materials(id,course_id,organization_id,title,description,content,kind,status,updated_at) VALUES (?,?,?,?,?,?,?,?,?)").bind(mid, id, current.organizationId, data.title, data.description, data.content, data.kind, data.status, now), ...relationships]);
    }
    return reply({ material: (await materialsFor(db, current.organizationId, id)).find(m => m.id === mid) }, itemId ? 200 : 201);
  }
  return missing();
}
