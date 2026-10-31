import type { BibliographyReference, Member } from "@happy-learners/contracts";
import { bibliographyRoleLabel, maxReferences, primaryBlocker, referenceInput } from "@happy-learners/domain";
import type { ResourceRole } from "@happy-learners/domain";
import type { Database } from "./storage";
import { accessTo } from "./access";
import { apaOf } from "./resources";
import { event } from "./activity";

/**
 * The course's bibliography: GET/POST /api/courses/:id/bibliography and PUT/DELETE /api/courses/:id/bibliography/:refId.
 * A reference points to an item of the course's library (a material or a file in R2) by its id. Whoever reaches the
 * course reads it; administration and the course's team (lead and co-teachers) manage it while the course is active.
 */
const reply = (value: unknown, status = 200) => Response.json(value, { status });
const listPath = /^\/api\/courses\/([a-z0-9-]+)\/bibliography$/;
const itemPath = /^\/api\/courses\/([a-z0-9-]+)\/bibliography\/(reference-[a-f0-9-]{36}|resource-[a-z0-9-]+)$/;

export function bibliographyMethods(path: string): string[] | null {
  if (listPath.test(path)) return ["GET", "POST"];
  if (itemPath.test(path)) return ["PUT", "DELETE"];
  return null;
}

type Row = Omit<BibliographyReference, "primary" | "status"> & { primary: number; status: string; fileStatus: string | null };
// A material keeps its own status; a file is published once it is ready, as the library shows it.
// The bibliography is the resources that have a role. course_bibliography is no longer read.
const roleOf = (role: string) => role === "primary" || role === "required" ? "text" : role === "support" ? "support" : "other";
const storedRole = (role: BibliographyReference["role"], primary: boolean): ResourceRole => role === "text" ? primary ? "primary" : "required" : role === "support" ? "support" : "recommended";
const columns = `SELECT r.id,r.course_id AS courseId,COALESCE(r.material_id,r.file_id) AS itemId,CASE WHEN r.file_id IS NULL THEN m.kind ELSE 'file' END AS kind,
  COALESCE(m.title,substr(f.original_name,1,length(f.original_name)-length(f.extension)-1),r.title) AS title,COALESCE(m.status,'') AS status,f.status AS fileStatus,
  f.original_name AS fileName,f.media_type AS mediaType,r.role AS storedRole,CASE WHEN r.role='primary' THEN 1 ELSE 0 END AS "primary",COALESCE(r.citation_override,'') AS citation,r.updated_at AS updatedAt
  FROM course_resources r LEFT JOIN materials m ON m.id=r.material_id LEFT JOIN course_files f ON f.id=r.file_id`;
const statusOf = (row: Pick<Row, "status" | "fileStatus">): BibliographyReference["status"] =>
  row.fileStatus ? row.fileStatus === "ready" ? "published" : row.fileStatus === "archived" ? "archived" : "draft" : row.status as BibliographyReference["status"];
const view = ({ fileStatus, primary, fileName, mediaType, storedRole, ...row }: Row & { storedRole: string }): BibliographyReference =>
  ({ ...row, role: roleOf(storedRole), status: statusOf({ status: row.status, fileStatus }), primary: !!primary, ...(fileName ? { fileName } : {}), ...(mediaType ? { mediaType } : {}) });

/** The course's references: the main book first, then by role and title. */
export async function referencesOf(db: Database, organizationId: string, courseId: string): Promise<BibliographyReference[]> {
  const rows = (await db.prepare(`${columns} WHERE r.course_id=? AND r.organization_id=? AND r.role IS NOT NULL ORDER BY r.role='primary' DESC,CASE r.role WHEN 'primary' THEN 0 WHEN 'required' THEN 0 WHEN 'support' THEN 1 ELSE 2 END,title COLLATE NOCASE,r.created_at`) // nosemgrep: sql-interpolated-text -- columns es una consulta constante
    .bind(courseId, organizationId).all<Row & { storedRole: string }>()).results;
  return rows.map(view);
}

/** The library item an id names in this course: a material or a file, with its status as the library shows it. */
async function itemOf(db: Database, organizationId: string, courseId: string, itemId: string) {
  const material = await db.prepare("SELECT id,title,status FROM materials WHERE id=? AND course_id=? AND organization_id=?").bind(itemId, courseId, organizationId).first<{ id: string; title: string; status: BibliographyReference["status"] }>();
  if (material) return { materialId: material.id, fileId: null, title: material.title, status: material.status };
  const file = await db.prepare("SELECT id,substr(original_name,1,length(original_name)-length(extension)-1) AS title,status FROM course_files WHERE id=? AND course_id=? AND organization_id=? AND status<>'uploading'").bind(itemId, courseId, organizationId).first<{ id: string; title: string; status: string }>();
  return file ? { materialId: null, fileId: file.id, title: file.title, status: statusOf({ status: "", fileStatus: file.status }) } : null;
}

export async function bibliography(path: string, method: string, input: unknown, current: Member, db: Database, format?: string | null): Promise<Response> {
  const [, courseId, referenceId] = (itemPath.exec(path) || listPath.exec(path))!;
  const course = await db.prepare("SELECT id,title,status FROM courses WHERE id=? AND organization_id=?").bind(courseId, current.organizationId).first<{ id: string; title: string; status: string }>();
  if (!course) return reply({ error: "Curso no disponible." }, 404);
  const access = await accessTo(db, current, courseId);
  if (!access) return reply({ error: "Este curso no está asignado a tu cuenta." }, 403);
  const manage = (access.configure || access.edit) && course.status === "active";
  const list = async () => ({ references: await referencesOf(db, current.organizationId, courseId), canManage: manage });
  if (method === "GET" && format === "apa7") return reply(await apaOf(db, current.organizationId, courseId));
  if (method === "GET") return reply(await list());
  if (!manage) return reply({ error: course.status !== "active" ? "Restaura el curso antes de cambiar su bibliografía." : "Solo administración y el equipo del curso gestionan su bibliografía." }, 403);
  const now = new Date().toISOString();
  const found = referenceId ? (await referencesOf(db, current.organizationId, courseId)).find(item => item.id === referenceId) : null;
  if (referenceId && !found) return reply({ error: "Referencia no disponible." }, 404);

  if (method === "DELETE") {
    await db.batch([
      db.prepare("UPDATE course_resources SET role=NULL,citation_override=NULL,updated_at=? WHERE id=? AND course_id=? AND organization_id=?").bind(now, referenceId, courseId, current.organizationId),
      event(db, current, { action: "archived", targetType: "resource", targetId: found!.itemId, courseId, summary: `Quitó «${found!.title}» de la bibliografía del curso${found!.primary ? " (era el libro principal)" : ""}` }),
    ]);
    return reply(await list());
  }

  const value = referenceInput(input);
  if ("error" in value) return reply(value, 400);
  let item: { materialId: string | null; fileId: string | null; title: string; status: BibliographyReference["status"]; resourceId?: string | null };
  if (method === "POST") {
    const raw = input && typeof input === "object" ? (input as Record<string, unknown>).itemId : undefined;
    const found = typeof raw === "string" && raw.length <= 120 ? await itemOf(db, current.organizationId, courseId, raw) : null;
    if (!found) return reply({ error: "Elige un recurso de la biblioteca de este curso." }, 400);
    if (found.status === "archived") return reply({ error: "Un recurso archivado no se agrega a la bibliografía." }, 409);
    const count = await db.prepare("SELECT count(*) AS total FROM course_resources WHERE course_id=? AND organization_id=? AND role IS NOT NULL").bind(courseId, current.organizationId).first<{ total: number }>();
    const same = await db.prepare("SELECT id,role FROM course_resources WHERE course_id=? AND organization_id=? AND ((material_id IS NOT NULL AND material_id=?) OR (file_id IS NOT NULL AND file_id=?))").bind(courseId, current.organizationId, found.materialId, found.fileId).first<{ id: string; role: string | null }>();
    if (same?.role) return reply({ error: `«${found.title}» ya está en la bibliografía.` }, 409);
    if ((count?.total || 0) >= maxReferences) return reply({ error: `La bibliografía admite hasta ${maxReferences} referencias.` }, 409);
    item = { ...found, resourceId: same?.id || null };
  } else item = { materialId: null, fileId: null, title: found!.title, status: found!.status };
  if (value.primary) { const blocked = primaryBlocker(item.status); if (blocked) return reply({ error: blocked }, 409); }

  const role = storedRole(value.role, value.primary);
  const id = referenceId || item.resourceId || `resource-${crypto.randomUUID()}`;
  const wasPrimary = !!found?.primary, previous = value.primary ? (await referencesOf(db, current.organizationId, courseId)).find(entry => entry.primary && entry.id !== id) : undefined;
  const writing = item.resourceId || referenceId
    ? db.prepare("UPDATE course_resources SET role=?,citation_override=?,type=CASE WHEN ? IN ('primary','required') AND type='other' THEN 'book' ELSE type END,updated_at=? WHERE id=? AND course_id=? AND organization_id=?").bind(role, value.citation || null, role, now, id, courseId, current.organizationId)
    : db.prepare("INSERT INTO course_resources(id,organization_id,course_id,material_id,file_id,kind,type,title,authors,year,metadata,language,license,shareable,level,area,role,citation_override,status,created_by,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?, '[]',NULL,'{}','','reserved',0,'','',?,?, 'published',?,?,?)")
      .bind(id, current.organizationId, courseId, item.materialId, item.fileId, item.fileId ? "file" : "text", role === "primary" || role === "required" ? "book" : "other", item.title, role, value.citation || null, current.id, now, now);
  const ok = await db.guardedBatch(
    method === "POST"
      ? db.prepare("SELECT 1 WHERE NOT EXISTS (SELECT 1 FROM course_resources WHERE course_id=? AND role IS NOT NULL AND ((material_id IS NOT NULL AND material_id=?) OR (file_id IS NOT NULL AND file_id=?)))").bind(courseId, item.materialId, item.fileId)
      : db.prepare("SELECT 1 FROM course_resources WHERE id=? AND course_id=?").bind(id, courseId), [
      ...(value.primary ? [db.prepare("UPDATE course_resources SET role='required',updated_at=? WHERE course_id=? AND organization_id=? AND role='primary' AND id<>?").bind(now, courseId, current.organizationId, id)] : []),
      writing,
      event(db, current, { action: method === "POST" ? "created" : "updated", targetType: "resource", targetId: item.materialId || item.fileId || found!.itemId, courseId,
        summary: value.primary && !wasPrimary ? `Marcó «${item.title}» como libro principal del curso${previous ? ` en lugar de «${previous.title}»` : ""}`
          : method === "POST" ? `Agregó «${item.title}» a la bibliografía del curso como ${bibliographyRoleLabel(value.role).toLocaleLowerCase("es")}` : `Actualizó «${item.title}» en la bibliografía del curso` }),
    ]);
  if (!ok) return reply({ error: method === "POST" ? `«${item.title}» ya está en la bibliografía.` : "La referencia cambió mientras la editabas. Recarga y vuelve a intentar." }, 409);
  return reply(await list(), method === "POST" ? 201 : 200);
}
