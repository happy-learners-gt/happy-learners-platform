import type { BibliographyReference, Member } from "@happy-learners/contracts";
import { bibliographyRoleLabel, maxReferences, primaryBlocker, referenceInput } from "@happy-learners/domain";
import type { Database } from "./storage";
import { accessTo } from "./access";
import { event } from "./team";

/**
 * The course's bibliography: GET/POST /api/courses/:id/bibliography and PUT/DELETE /api/courses/:id/bibliography/:refId.
 * A reference points to an item of the course's library (a material or a file in R2) by its id. Whoever reaches the
 * course reads it; administration and the course's team (lead and co-teachers) manage it while the course is active.
 */
const reply = (value: unknown, status = 200) => Response.json(value, { status });
const listPath = /^\/api\/courses\/([a-z0-9-]+)\/bibliography$/;
const itemPath = /^\/api\/courses\/([a-z0-9-]+)\/bibliography\/(reference-[a-f0-9-]{36})$/;

export function bibliographyMethods(path: string): string[] | null {
  if (listPath.test(path)) return ["GET", "POST"];
  if (itemPath.test(path)) return ["PUT", "DELETE"];
  return null;
}

type Row = Omit<BibliographyReference, "primary" | "status"> & { primary: number; status: string; fileStatus: string | null };
// A material keeps its own status; a file is published once it is ready, as the library shows it.
const columns = `SELECT b.id,b.course_id AS courseId,COALESCE(b.material_id,b.file_id) AS itemId,CASE WHEN b.file_id IS NULL THEN m.kind ELSE 'file' END AS kind,
  COALESCE(m.title,substr(f.original_name,1,length(f.original_name)-length(f.extension)-1)) AS title,COALESCE(m.status,'') AS status,f.status AS fileStatus,
  f.original_name AS fileName,f.media_type AS mediaType,b.role,b.is_primary AS "primary",b.citation,b.updated_at AS updatedAt
  FROM course_bibliography b LEFT JOIN materials m ON m.id=b.material_id LEFT JOIN course_files f ON f.id=b.file_id`;
const statusOf = (row: Pick<Row, "status" | "fileStatus">): BibliographyReference["status"] =>
  row.fileStatus ? row.fileStatus === "ready" ? "published" : row.fileStatus === "archived" ? "archived" : "draft" : row.status as BibliographyReference["status"];
const view = ({ fileStatus, primary, fileName, mediaType, ...row }: Row): BibliographyReference =>
  ({ ...row, status: statusOf({ status: row.status, fileStatus }), primary: !!primary, ...(fileName ? { fileName } : {}), ...(mediaType ? { mediaType } : {}) });

/** The course's references: the main book first, then by role and title. */
export async function referencesOf(db: Database, organizationId: string, courseId: string): Promise<BibliographyReference[]> {
  const rows = (await db.prepare(`${columns} WHERE b.course_id=? AND b.organization_id=? ORDER BY b.is_primary DESC,CASE b.role WHEN 'text' THEN 0 WHEN 'support' THEN 1 ELSE 2 END,title COLLATE NOCASE,b.created_at`)
    .bind(courseId, organizationId).all<Row>()).results;
  return rows.map(view);
}

/** The library item an id names in this course: a material or a file, with its status as the library shows it. */
async function itemOf(db: Database, organizationId: string, courseId: string, itemId: string) {
  const material = await db.prepare("SELECT id,title,status FROM materials WHERE id=? AND course_id=? AND organization_id=?").bind(itemId, courseId, organizationId).first<{ id: string; title: string; status: BibliographyReference["status"] }>();
  if (material) return { materialId: material.id, fileId: null, title: material.title, status: material.status };
  const file = await db.prepare("SELECT id,substr(original_name,1,length(original_name)-length(extension)-1) AS title,status FROM course_files WHERE id=? AND course_id=? AND organization_id=? AND status<>'uploading'").bind(itemId, courseId, organizationId).first<{ id: string; title: string; status: string }>();
  return file ? { materialId: null, fileId: file.id, title: file.title, status: statusOf({ status: "", fileStatus: file.status }) } : null;
}

export async function bibliography(path: string, method: string, input: unknown, current: Member, db: Database): Promise<Response> {
  const [, courseId, referenceId] = (itemPath.exec(path) || listPath.exec(path))!;
  const course = await db.prepare("SELECT id,title,status FROM courses WHERE id=? AND organization_id=?").bind(courseId, current.organizationId).first<{ id: string; title: string; status: string }>();
  if (!course) return reply({ error: "Curso no disponible." }, 404);
  const access = await accessTo(db, current, courseId);
  if (!access) return reply({ error: "Este curso no está asignado a tu cuenta." }, 403);
  const manage = (access.configure || access.edit) && course.status === "active";
  const list = async () => ({ references: await referencesOf(db, current.organizationId, courseId), canManage: manage });
  if (method === "GET") return reply(await list());
  if (!manage) return reply({ error: course.status !== "active" ? "Restaura el curso antes de cambiar su bibliografía." : "Solo administración y el equipo del curso gestionan su bibliografía." }, 403);
  const now = new Date().toISOString();
  const found = referenceId ? (await referencesOf(db, current.organizationId, courseId)).find(item => item.id === referenceId) : null;
  if (referenceId && !found) return reply({ error: "Referencia no disponible." }, 404);

  if (method === "DELETE") {
    await db.batch([
      db.prepare("DELETE FROM course_bibliography WHERE id=? AND course_id=? AND organization_id=?").bind(referenceId, courseId, current.organizationId),
      event(db, current, { action: "archived", targetType: "resource", targetId: found!.itemId, courseId, summary: `Quitó «${found!.title}» de la bibliografía del curso${found!.primary ? " (era el libro principal)" : ""}` }),
    ]);
    return reply(await list());
  }

  const value = referenceInput(input);
  if ("error" in value) return reply(value, 400);
  let item: { materialId: string | null; fileId: string | null; title: string; status: BibliographyReference["status"] };
  if (method === "POST") {
    const raw = input && typeof input === "object" ? (input as Record<string, unknown>).itemId : undefined;
    const found = typeof raw === "string" && raw.length <= 120 ? await itemOf(db, current.organizationId, courseId, raw) : null;
    if (!found) return reply({ error: "Elige un recurso de la biblioteca de este curso." }, 400);
    if (found.status === "archived") return reply({ error: "Un recurso archivado no se agrega a la bibliografía." }, 409);
    const count = await db.prepare("SELECT count(*) AS total, sum(material_id IS ? AND file_id IS ?) AS same FROM course_bibliography WHERE course_id=? AND organization_id=?").bind(found.materialId, found.fileId, courseId, current.organizationId).first<{ total: number; same: number | null }>();
    if (count?.same) return reply({ error: `«${found.title}» ya está en la bibliografía.` }, 409);
    if ((count?.total || 0) >= maxReferences) return reply({ error: `La bibliografía admite hasta ${maxReferences} referencias.` }, 409);
    item = found;
  } else item = { materialId: null, fileId: null, title: found!.title, status: found!.status };
  if (value.primary) { const blocked = primaryBlocker(item.status); if (blocked) return reply({ error: blocked }, 409); }

  const id = referenceId || `reference-${crypto.randomUUID()}`;
  const wasPrimary = !!found?.primary, previous = value.primary ? (await referencesOf(db, current.organizationId, courseId)).find(entry => entry.primary && entry.id !== id) : undefined;
  const ok = await db.guardedBatch(
    // Compare-and-write: a new reference still is not there; an edited one still exists.
    method === "POST"
      ? db.prepare("SELECT 1 WHERE NOT EXISTS (SELECT 1 FROM course_bibliography WHERE course_id=? AND (material_id=? OR file_id=?))").bind(courseId, item.materialId, item.fileId)
      : db.prepare("SELECT 1 FROM course_bibliography WHERE id=? AND course_id=?").bind(id, courseId), [
      // Choosing a main book replaces the previous one in the same transaction.
      ...(value.primary ? [db.prepare("UPDATE course_bibliography SET is_primary=0,updated_at=? WHERE course_id=? AND organization_id=? AND is_primary=1 AND id<>?").bind(now, courseId, current.organizationId, id)] : []),
      method === "POST"
        ? db.prepare("INSERT INTO course_bibliography(id,organization_id,course_id,material_id,file_id,role,is_primary,citation,created_by,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)")
          .bind(id, current.organizationId, courseId, item.materialId, item.fileId, value.role, value.primary ? 1 : 0, value.citation, current.id, now, now)
        : db.prepare("UPDATE course_bibliography SET role=?,is_primary=?,citation=?,updated_at=? WHERE id=? AND course_id=? AND organization_id=?").bind(value.role, value.primary ? 1 : 0, value.citation, now, id, courseId, current.organizationId),
      event(db, current, { action: method === "POST" ? "created" : "updated", targetType: "resource", targetId: item.materialId || item.fileId || found!.itemId, courseId,
        summary: value.primary && !wasPrimary ? `Marcó «${item.title}» como libro principal del curso${previous ? ` en lugar de «${previous.title}»` : ""}`
          : method === "POST" ? `Agregó «${item.title}» a la bibliografía del curso como ${bibliographyRoleLabel(value.role).toLocaleLowerCase("es")}` : `Actualizó «${item.title}» en la bibliografía del curso` }),
    ]);
  if (!ok) return reply({ error: method === "POST" ? `«${item.title}» ya está en la bibliografía.` : "La referencia cambió mientras la editabas. Recarga y vuelve a intentar." }, 409);
  return reply(await list(), method === "POST" ? 201 : 200);
}
