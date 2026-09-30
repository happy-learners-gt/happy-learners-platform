import type { Material, Member } from "@happy-learners/contracts";
import type { Database } from "./storage";

const MAX_BYTES = 15 * 1024 * 1024;
const MAX_EXPANDED_BYTES = 100 * 1024 * 1024;
const MAX_ORGANIZATION_BYTES = 4 * 1024 * 1024 * 1024;
const reply = (data: unknown, status = 200) => Response.json(data, { status, headers: { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" } });
const formats = {
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
} as const;
type Extension = keyof typeof formats;
type FileRow = { id: string; course_id: string; courseId: string; title: string; original_name: string; extension: Extension; media_type: string; size_bytes: number; sha256: string; status: "uploading" | "ready" | "archived"; created_at: string; updated_at: string; object_key: string };
const fileColumns = "id,course_id AS courseId,substr(original_name,1,length(original_name)-length(extension)-1) AS title,original_name,extension,media_type,size_bytes,sha256,status,created_at,updated_at";
const contentTypes: Record<Extension, string> = {
  docx: "word/document.xml",
  pptx: "ppt/presentation.xml",
  xlsx: "xl/workbook.xml",
};

function safeName(value: string): string | null {
  const name = value.normalize("NFC").replaceAll("\\", "/").split("/").pop()?.trim() || "";
  if (!name || name.length > 140 || /[\x00-\x1f\x7f]/.test(name)) return null;
  return name;
}

async function readBounded(request: Request): Promise<Uint8Array | null> {
  const contentLength = request.headers.get("Content-Length");
  const declared = contentLength === null ? null : Number(contentLength);
  if ((declared !== null && (!Number.isSafeInteger(declared) || declared < 1 || declared > MAX_BYTES)) || !request.body) return null;
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      total += chunk.value.byteLength;
      if (total > MAX_BYTES || (declared !== null && total > declared)) { await reader.cancel(); return null; }
      chunks.push(chunk.value);
    }
  } catch {
    return null;
  }
  if (total < 1 || (declared !== null && total !== declared)) return null;
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return bytes;
}

function validateOfficeZip(bytes: Uint8Array, extension: Extension): boolean {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const start = Math.max(0, bytes.length - 22 - 65_535);
  let eocd = -1;
  for (let i = bytes.length - 22; i >= start; i--) {
    if (view.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0 || view.getUint16(eocd + 4, true) !== 0 || view.getUint16(eocd + 6, true) !== 0) return false;
  const entries = view.getUint16(eocd + 10, true), centralSize = view.getUint32(eocd + 12, true), centralStart = view.getUint32(eocd + 16, true);
  if (!entries || entries > 3_000 || centralStart + centralSize > eocd) return false;
  let cursor = centralStart, expanded = 0;
  const names = new Set<string>();
  let hasMainDocument = false;
  let hasContentTypes = false;
  for (let i = 0; i < entries; i++) {
    if (cursor + 46 > bytes.length || view.getUint32(cursor, true) !== 0x02014b50) return false;
    const flags = view.getUint16(cursor + 8, true), method = view.getUint16(cursor + 10, true);
    const compressed = view.getUint32(cursor + 20, true), uncompressed = view.getUint32(cursor + 24, true);
    const nameLength = view.getUint16(cursor + 28, true), extraLength = view.getUint16(cursor + 30, true), commentLength = view.getUint16(cursor + 32, true);
    if (flags & 1 || ![0, 8].includes(method) || cursor + 46 + nameLength + extraLength + commentLength > bytes.length) return false;
    const name = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes.subarray(cursor + 46, cursor + 46 + nameLength));
    if (!name || name.startsWith("/") || name.includes("\\") || name.split("/").includes("..") || names.has(name)) return false;
    names.add(name);
    if (/vbaProject\.bin$/i.test(name) || /^customUI\//i.test(name)) return false;
    expanded += uncompressed;
    if (expanded > MAX_EXPANDED_BYTES || (compressed === 0 ? uncompressed > 0 : uncompressed / compressed > 250)) return false;
    if (name === contentTypes[extension]) hasMainDocument = true;
    if (name === "[Content_Types].xml") hasContentTypes = true;
    cursor += 46 + nameLength + extraLength + commentLength;
  }
  return cursor === centralStart + centralSize && hasContentTypes && hasMainDocument;
}

function fileView(row: FileRow): Material {
  const state = row.status === "ready" ? "published" : row.status === "archived" ? "archived" : "draft";
  return { id: row.id, fileId: row.id, courseId: row.course_id || row.courseId, title: row.title, description: `${row.extension.toUpperCase()} · ${(row.size_bytes / 1024 / 1024).toFixed(1)} MB`, kind: "file", content: "", status: state, version: 1, updatedAt: row.updated_at, termIds: [], fileName: row.original_name, mediaType: row.media_type, sizeBytes: row.size_bytes, sha256: row.sha256 };
}

export async function courseFiles(path: string, method: string, request: Request, current: Member, db: Database, bucket: R2Bucket): Promise<Response> {
  const parts = path.split("/");
  const courseId = parts[3];
  if (current.role !== "educator") return reply({ error: "Solo educadores pueden consultar los archivos del curso." }, 403);
  const course = await db.prepare("SELECT id FROM courses WHERE id=? AND organization_id=? AND status='active'").bind(courseId, current.organizationId).first();
  if (!course) return reply({ error: "El curso no está disponible." }, 404);
  if (parts.length === 5 && method === "GET") {
    const result = await db.prepare(`SELECT ${fileColumns} FROM course_files WHERE course_id=? AND organization_id=? ORDER BY created_at DESC,id`).bind(courseId, current.organizationId).all<FileRow>();
    return reply({ files: result.results.map(fileView) });
  }
  if (parts.length === 5 && method === "POST") {
    let submittedName = request.headers.get("X-File-Name") || "";
    try { submittedName = decodeURIComponent(submittedName); } catch { return reply({ error: "El nombre del archivo no es válido." }, 400); }
    const name = safeName(submittedName);
    const uploadKey = request.headers.get("Idempotency-Key") || "";
    const mediaType = request.headers.get("Content-Type") || "";
    const extension = name?.split(".").pop()?.toLowerCase() as Extension | undefined;
    if (!name || !extension || !(extension in formats) || formats[extension] !== mediaType || !/^[0-9a-f-]{36}$/i.test(uploadKey)) return reply({ error: "Sube un archivo DOCX, PPTX o XLSX válido e inténtalo de nuevo." }, 400);
    const bytes = await readBounded(request);
    if (!bytes || !validateOfficeZip(bytes, extension)) return reply({ error: "El archivo no es un paquete Office válido, supera el límite de 15 MB o contiene partes no permitidas." }, 400);
    const hashBytes = await crypto.subtle.digest("SHA-256", bytes);
    const sha256 = [...new Uint8Array(hashBytes)].map(value => value.toString(16).padStart(2, "0")).join("");
    const existing = await db.prepare(`SELECT ${fileColumns},object_key FROM course_files WHERE course_id=? AND upload_key=? AND organization_id=?`).bind(courseId, uploadKey, current.organizationId).first<FileRow>();
    if (existing && (existing.sha256 !== sha256 || existing.original_name !== name)) return reply({ error: "La clave de carga ya se usó para otro archivo." }, 409);
    if (existing?.status === "ready") {
      const stored = await bucket.head(existing.object_key);
      if (stored?.customMetadata?.sha256 === sha256) return reply({ file: fileView(existing) });
    }
    const now = new Date().toISOString();
    const row = existing || {
      id: `course-file-${crypto.randomUUID()}`, course_id: courseId, courseId, title: name.replace(/\.[^.]+$/, ""), original_name: name, extension, media_type: mediaType, size_bytes: bytes.byteLength, sha256, status: "uploading" as const, created_at: now, updated_at: now, object_key: `${current.organizationId}/${courseId}/${crypto.randomUUID()}`,
    };
    if (!existing) {
      const reserved = await db.guardedBatch(
        db.prepare("SELECT 1 AS within_quota WHERE COALESCE((SELECT SUM(size_bytes) FROM course_files WHERE organization_id=?),0)+?<=?").bind(current.organizationId, bytes.byteLength, MAX_ORGANIZATION_BYTES),
        [db.prepare("INSERT INTO course_files(id,organization_id,course_id,upload_key,object_key,original_name,extension,media_type,size_bytes,sha256,status,created_by,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,'uploading',?,?,?) ON CONFLICT(course_id,upload_key) DO NOTHING RETURNING id")
          .bind(row.id, current.organizationId, courseId, uploadKey, row.object_key, name, extension, mediaType, bytes.byteLength, sha256, current.id, now, now)],
      );
      const reservation = await db.prepare("SELECT id,sha256,original_name FROM course_files WHERE course_id=? AND upload_key=? AND organization_id=?").bind(courseId, uploadKey, current.organizationId).first<{ id: string; sha256: string; original_name: string }>();
      if (!reserved || reservation?.id !== row.id) {
        if (reservation) return reply({ error: "La carga ya está en proceso. Actualiza la lista y vuelve a intentar." }, 409);
        return reply({ error: "El curso alcanzó el límite de 4 GiB de documentos. Archiva o revisa el espacio disponible antes de cargar más." }, 413);
      }
    }
    await bucket.put(row.object_key, bytes, { httpMetadata: { contentType: "application/octet-stream" }, customMetadata: { sha256, courseId, organizationId: current.organizationId } });
    const saved = await db.prepare(`UPDATE course_files SET status='ready',updated_at=? WHERE id=? AND organization_id=? AND sha256=? RETURNING ${fileColumns},object_key`).bind(new Date().toISOString(), row.id, current.organizationId, sha256).first<FileRow>();
    if (!saved) return reply({ error: "El archivo se almacenó, pero no se pudo confirmar. Reintenta con la misma clave de carga." }, 503);
    return reply({ file: fileView(saved) }, existing ? 200 : 201);
  }
  const fileId = parts[5];
  const row = await db.prepare(`SELECT ${fileColumns},object_key FROM course_files WHERE id=? AND course_id=? AND organization_id=?`).bind(fileId, courseId, current.organizationId).first<FileRow>();
  if (!row) return reply({ error: "El archivo no está disponible en este curso." }, 404);
  if (parts[6] === "archive" && method === "POST") {
    await db.prepare("UPDATE course_files SET status='archived',updated_at=? WHERE id=? AND organization_id=?").bind(new Date().toISOString(), fileId, current.organizationId).run();
    return reply({ ok: true });
  }
  if (parts[6] !== "content" || method !== "GET" || !["ready", "archived"].includes(row.status)) return reply({ error: "El archivo no está disponible." }, 404);
  const object = await bucket.get(row.object_key);
  if (!object) return reply({ error: "No se encontró el archivo almacenado." }, 404);
  if (object.size !== row.size_bytes || object.customMetadata?.sha256 !== row.sha256 || object.customMetadata?.courseId !== courseId || object.customMetadata?.organizationId !== current.organizationId) return reply({ error: "La copia almacenada no pasó la verificación de integridad." }, 503);
  return new Response(object.body, { headers: { "Cache-Control": "private, no-store", "Content-Type": "application/octet-stream", "Content-Length": String(row.size_bytes), "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(row.original_name)}`, "X-Content-Type-Options": "nosniff", "Content-Security-Policy": "sandbox; default-src 'none'", "Cross-Origin-Resource-Policy": "same-origin", "X-File-SHA256": row.sha256 } });
}

export async function filesFor(db: Database, organizationId: string, courseId?: string): Promise<Material[]> {
  const result = await db.prepare(`SELECT ${fileColumns} FROM course_files WHERE organization_id=?` + (courseId ? " AND course_id=?" : "") + " ORDER BY title,id").bind(organizationId, ...(courseId ? [courseId] : [])).all<FileRow>();
  return result.results.map(fileView);
}

export async function sharedFile(code: string, fileId: string, organizationId: string, db: Database, bucket: R2Bucket): Promise<Response> {
  const lesson = await db.prepare("SELECT id,published_content FROM lessons WHERE archived=0 AND published_content IS NOT NULL AND json_extract(published_content,'$.shareCode')=?").bind(code).first<{ id: string; published_content: string }>();
  if (!lesson) return reply({ error: "Lección no disponible." }, 404);
  const snapshot = JSON.parse(lesson.published_content) as { resources?: Material[] };
  const reference = snapshot.resources?.find(resource => resource.kind === "file" && resource.fileId === fileId);
  if (!reference) return reply({ error: "El archivo no forma parte de esta publicación." }, 404);
  const row = await db.prepare("SELECT object_key,original_name,size_bytes,sha256,status FROM course_files WHERE id=? AND organization_id=?").bind(fileId, organizationId).first<{ object_key: string; original_name: string; size_bytes: number; sha256: string; status: string }>();
  if (!row || !["ready", "archived"].includes(row.status)) return reply({ error: "El archivo no está disponible." }, 404);
  const object = await bucket.get(row.object_key);
  if (!object) return reply({ error: "No se encontró el archivo almacenado." }, 404);
  if (object.size !== row.size_bytes || object.customMetadata?.sha256 !== row.sha256 || object.customMetadata?.organizationId !== organizationId) return reply({ error: "La copia almacenada no pasó la verificación de integridad." }, 503);
  return new Response(object.body, { headers: { "Cache-Control": "private, no-store", "Content-Type": "application/octet-stream", "Content-Length": String(row.size_bytes), "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(row.original_name)}`, "X-Content-Type-Options": "nosniff", "Content-Security-Policy": "sandbox; default-src 'none'", "Cross-Origin-Resource-Policy": "same-origin", "X-File-SHA256": row.sha256 } });
}
