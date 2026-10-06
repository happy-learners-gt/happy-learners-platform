import type { Activity, Lesson, Member } from "@happy-learners/contracts";
import { sharePrefix } from "@happy-learners/domain";
import type { Database, Prepared } from "./storage";
import { curriculumFor, materialsFor, unitsFor } from "./courses";
import { event } from "./team";

const reply = (data: unknown, status = 200) => Response.json(data, { status });
const MAX_ORGANIZATION_BYTES = 4 * 1024 * 1024 * 1024;
const notCopied = "Recurso no copiado: estaba archivado en el curso original.";
type FileRow = { id: string; object_key: string; original_name: string; extension: string; media_type: string; size_bytes: number; sha256: string };

/**
 * POST /api/courses/:id/duplicate — administration copies a course with its configuration, team, modules,
 * curriculum plan, resources, files and lessons. Every lesson of the copy is a draft; sections, schedules, classes
 * and attendance are not copied. The copy is written in one transaction, so it is complete or it does not exist.
 */
export async function duplicateCourse(courseId: string, current: Member, db: Database, bucket: R2Bucket) {
  if (current.role !== "admin") return reply({ error: "Solo administración crea cursos, también como copia de otro." }, 403);
  const course = await db.prepare("SELECT id,title FROM courses WHERE id=? AND organization_id=?").bind(courseId, current.organizationId).first<{ id: string; title: string }>();
  if (!course) return reply({ error: "El elemento no está disponible en tu organización." }, 404);
  const team = (await db.prepare("SELECT user_id AS userId,role FROM course_members WHERE course_id=? AND organization_id=?").bind(courseId, current.organizationId).all<{ userId: string; role: string }>()).results;
  if (!team.some(member => member.role === "lead")) return reply({ error: "Asigna la persona responsable del curso antes de duplicarlo." }, 409);
  const [units, curriculum, materials, files, lessons] = await Promise.all([
    unitsFor(db, courseId), curriculumFor(db, courseId), materialsFor(db, current.organizationId, courseId),
    db.prepare("SELECT id,object_key,original_name,extension,media_type,size_bytes,sha256 FROM course_files WHERE course_id=? AND organization_id=? AND status='ready' ORDER BY created_at,id").bind(courseId, current.organizationId).all<FileRow>(),
    db.prepare("SELECT l.content,l.course_unit_id AS unitId,l.position FROM lessons l JOIN learning_units u ON u.id=l.course_unit_id WHERE u.course_id=? AND u.status='active' AND l.archived=0 ORDER BY u.position,l.position,l.id").bind(courseId).all<{ content: string; unitId: string; position: number }>(),
  ]);
  const cid = `course-${crypto.randomUUID()}`, now = new Date().toISOString(), title = `${course.title} (copia)`.slice(0, 160);
  const ids = new Map<string, string>();
  const fresh = (old: string, prefix: string) => { const id = `${prefix}-${crypto.randomUUID()}`; ids.set(old, id); return id; };
  const statements: Prepared[] = [
    db.prepare("INSERT INTO programs(id,organization_id,title) VALUES (?,?,?)").bind(cid, current.organizationId, title),
    db.prepare("INSERT INTO courses(id,organization_id,legacy_program_id,title,objective,profile,program_id,education_type,level,format,modality,pacing,area,settings,status,unit_label,updated_at) SELECT ?,organization_id,?,?,objective,profile,program_id,education_type,level,format,modality,pacing,area,settings,'active',unit_label,? FROM courses WHERE id=?").bind(cid, cid, title, now, courseId),
    ...team.map(member => db.prepare("INSERT INTO course_members(course_id,organization_id,user_id,role,added_at) VALUES (?,?,?,?,?)").bind(cid, current.organizationId, member.userId, member.role, now)),
  ];
  for (const unit of units.filter(item => item.status === "active"))
    statements.push(db.prepare("INSERT INTO learning_units(id,course_id,name,objective,position,status,updated_at) VALUES (?,?,?,?,?,'active',?)").bind(fresh(unit.id, "learning-unit"), cid, unit.name, unit.objective, unit.position, now));
  for (const item of curriculum.competencies.filter(entry => entry.status === "active"))
    statements.push(db.prepare("INSERT INTO course_competencies(id,course_id,organization_id,name,description,position,status,updated_at) VALUES (?,?,?,?,?,?,'active',?)").bind(fresh(item.id, "competency"), cid, current.organizationId, item.name, item.description, item.position, now));
  for (const item of curriculum.outcomes.filter(entry => entry.status === "active"))
    statements.push(db.prepare("INSERT INTO course_outcomes(id,course_id,organization_id,competency_id,statement,level,evidence,position,status,updated_at) VALUES (?,?,?,?,?,?,?,?,'active',?)").bind(fresh(item.id, "outcome"), cid, current.organizationId, item.competencyId && ids.get(item.competencyId) || null, item.statement, item.level, item.evidence, item.position, now));
  for (const link of curriculum.unitOutcomes.filter(entry => ids.has(entry.unitId) && ids.has(entry.outcomeId)))
    statements.push(db.prepare("INSERT INTO unit_outcomes(unit_id,outcome_id,course_id) VALUES (?,?,?)").bind(ids.get(link.unitId)!, ids.get(link.outcomeId)!, cid));
  for (const material of materials.filter(item => item.status !== "archived")) {
    const mid = fresh(material.id, "material");
    statements.push(db.prepare("INSERT INTO materials(id,course_id,organization_id,title,description,content,kind,status,updated_at) VALUES (?,?,?,?,?,?,?,?,?)").bind(mid, cid, current.organizationId, material.title, material.description, material.content, material.kind, material.status, now),
      ...material.termIds.map(term => db.prepare("INSERT INTO material_terms VALUES (?,?,?)").bind(mid, term, current.organizationId)));
  }
  // Course resources that were archived stay behind; lessons that used them say so instead of linking nothing.
  const courseResources = new Set([...materials.map(item => item.id), ...files.results.map(item => item.id)]);
  const copiedFiles: string[] = [];
  const total = files.results.reduce((sum, file) => sum + file.size_bytes, 0);
  if (total && !await db.prepare("SELECT 1 AS ok WHERE COALESCE((SELECT SUM(size_bytes) FROM course_files WHERE organization_id=?),0)+?<=?").bind(current.organizationId, total, MAX_ORGANIZATION_BYTES).first())
    return reply({ error: "La organización alcanzó el límite de 4 GiB de archivos. Archiva documentos antes de duplicar el curso." }, 413);
  try {
    for (const file of files.results) {
      const object = await bucket.get(file.object_key);
      if (!object || object.size !== file.size_bytes || object.customMetadata?.sha256 !== file.sha256) continue;
      const key = `${current.organizationId}/${cid}/${crypto.randomUUID()}`;
      await bucket.put(key, object.body, { sha256: file.sha256, httpMetadata: { contentType: "application/octet-stream" }, customMetadata: { sha256: file.sha256, courseId: cid, organizationId: current.organizationId } });
      copiedFiles.push(key);
      statements.push(db.prepare("INSERT INTO course_files(id,organization_id,course_id,upload_key,object_key,original_name,extension,media_type,size_bytes,sha256,status,created_by,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,'ready',?,?,?)")
        .bind(fresh(file.id, "course-file"), current.organizationId, cid, crypto.randomUUID(), key, file.original_name, file.extension, file.media_type, file.size_bytes, file.sha256, current.id, now, now));
    }
    const resource = (id?: string) => id && courseResources.has(id) ? ids.get(id) ?? null : id;
    const outcomes = (list?: string[]) => (list || []).flatMap(id => ids.has(id) ? [ids.get(id)!] : []);
    for (const row of lessons.results.filter(item => ids.has(item.unitId))) {
      const source = JSON.parse(row.content) as Lesson;
      const lid = `lesson-${crypto.randomUUID()}`;
      const activities = (source.activities || []).map((activity): Activity => {
        const copy = { ...activity, ...(activity.outcomeIds ? { outcomeIds: outcomes(activity.outcomeIds) } : {}) };
        if (activity.blocks) copy.blocks = activity.blocks.map(block => block.kind !== "resource" ? block : resource(block.resourceId) ? { ...block, resourceId: resource(block.resourceId)! } : { id: block.id, kind: "text", instructions: notCopied });
        else if (activity.type === "resource") Object.assign(copy, resource(activity.resourceId) ? { resourceId: resource(activity.resourceId)! } : { type: "text", resourceId: undefined, instructions: notCopied });
        return copy;
      });
      const lesson: Lesson = { ...source, id: lid, courseId: cid, courseUnitId: ids.get(row.unitId)!, unitId: undefined, publishedAt: "", activities, outcomeIds: outcomes(source.outcomeIds),
        shareCode: sharePrefix(current.organizationId) + crypto.randomUUID().replaceAll("-", "").slice(0, 16).toUpperCase() };
      statements.push(db.prepare("INSERT INTO lessons(id,program_id,status,content,unit_id,course_unit_id,position,updated_at) VALUES (?,?,'draft',?,NULL,?,?,?)").bind(lid, cid, JSON.stringify(lesson), ids.get(row.unitId)!, row.position, now));
    }
    statements.push(event(db, current, { action: "created", targetType: "course", targetId: cid, courseId: cid, summary: `Duplicó «${course.title}» como «${title}»` }));
    await db.batch(statements);
  } catch (error) {
    await Promise.all(copiedFiles.map(key => bucket.delete(key)));
    throw error;
  }
  return reply({ id: cid }, 201);
}
