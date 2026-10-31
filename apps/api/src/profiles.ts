import type { ExpiringDocuments, Member, StaffDocument, StaffFile, StaffProfile } from "@happy-learners/contracts";
import { areasFromSpecialties, documentStatus, expiringWindowDays, staffProfileInput, staffDocumentInput, staffDocumentLabel, storedProfile } from "@happy-learners/domain";
import type { Database } from "./storage";
import { readBounded } from "./files";
import { event } from "./activity";
import { todayFor } from "./classes";

/**
 * ST-149 (profile) and ST-150 (staff file). Photos and documents are private objects in the COURSE_FILES bucket, under
 * `<organization>/staff/<user>/…`; the Worker is the only way to read them and checks the session on every request.
 *   GET|PUT /api/profile · PUT|DELETE /api/profile/photo                — the signed-in person
 *   GET /api/members/:id/profile                                         — administration, the person, course teammates (no contact data)
 *   GET /api/members/:id/photo                                           — any signed-in staff member of the organization
 *   GET|POST /api/members/:id/files · GET …/files/:doc/content           — administration and the person
 *   POST /api/members/:id/files/:doc/withdraw · GET /api/expiring-documents — administration
 */
const reply = (data: unknown, status = 200) => Response.json(data, { status, headers: { "Cache-Control": "private, no-store" } });
const MAX_PHOTO_BYTES = 2 * 1024 * 1024;
const MAX_DOCUMENT_BYTES = 10 * 1024 * 1024;
const MAX_ORGANIZATION_STAFF_BYTES = 1024 * 1024 * 1024;
const MAX_DOCUMENTS_PER_PERSON = 100;
const photoTypes = ["image/jpeg", "image/png", "image/webp"] as const;
const documentTypes: Record<string, string> = { "application/pdf": "pdf", "image/jpeg": "jpg", "image/png": "png" };

/** Leading bytes each accepted format starts with, so a renamed file of another kind is refused. */
function validSignature(mediaType: string, bytes: Uint8Array) {
  const text = (start: number, end: number) => String.fromCharCode(...bytes.subarray(start, end));
  if (mediaType === "application/pdf") return bytes.length >= 5 && text(0, 5) === "%PDF-";
  if (mediaType === "image/jpeg") return bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  if (mediaType === "image/png") return bytes.length >= 8 && [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].every((value, index) => bytes[index] === value);
  if (mediaType === "image/webp") return bytes.length >= 12 && text(0, 4) === "RIFF" && text(8, 12) === "WEBP";
  return false;
}
const hex = (buffer: ArrayBuffer) => [...new Uint8Array(buffer)].map(value => value.toString(16).padStart(2, "0")).join("");

/** Small JSON bodies for PUT /api/profile, read with a limit like every other form. */
async function jsonBody(request: Request): Promise<unknown> {
  if (!request.headers.get("content-type")?.startsWith("application/json")) throw new Error("INPUT");
  const bytes = await readBounded(request, 16384);
  if (!bytes) throw new Error("INPUT");
  try { return JSON.parse(new TextDecoder().decode(bytes)); } catch { throw new Error("INPUT"); }
}

type Person = { id: string; name: string; username: string; role: string; active: number; email: string | null };
const personOf = (db: Database, id: string, organizationId: string) => db.prepare("SELECT u.id,COALESCE(u.display_name,u.username) AS name,u.username,CASE m.role WHEN 'instructor' THEN 'educator' ELSE m.role END AS role,m.active,u.email FROM users u JOIN memberships m ON m.user_id=u.id WHERE u.id=? AND m.organization_id=?").bind(id, organizationId).first<Person>();
type ProfileRow = { phone: string | null; contact_email: string | null; education: string; specialties: string; availability: string; photo_key: string | null; photo_type: string | null; photo_size: number | null; photo_sha256: string | null; updated_at: string };
const profileRow = (db: Database, id: string, organizationId: string) => db.prepare("SELECT phone,contact_email,education,specialties,availability,photo_key,photo_type,photo_size,photo_sha256,updated_at FROM staff_profiles WHERE user_id=? AND organization_id=?").bind(id, organizationId).first<ProfileRow>();

function profileView(person: Person, row: ProfileRow | null, contact: boolean): StaffProfile {
  return {
    userId: person.id, displayName: person.name, username: person.username, role: person.role === "admin" ? "admin" : "educator", active: !!person.active,
    photo: !!row?.photo_key, photoVersion: row?.photo_sha256?.slice(0, 12) || null,
    education: row?.education || "", specialties: row ? JSON.parse(row.specialties) : [], availability: row ? JSON.parse(row.availability) : [],
    // Contact data only for the person and administration (DEC-043).
    ...(contact ? { contact: { phone: row?.phone || null, contactEmail: row?.contact_email || null, loginEmail: person.email } } : {}),
    updatedAt: row?.updated_at || null,
  };
}

/** Whether two people share the team of an active course: teammates see each other's name, photo and specialties. */
async function teammates(db: Database, a: string, b: string, organizationId: string) {
  return !!await db.prepare("SELECT 1 AS shared FROM course_members x JOIN course_members y ON y.course_id=x.course_id AND y.organization_id=x.organization_id JOIN courses c ON c.id=x.course_id AND c.organization_id=x.organization_id WHERE x.user_id=? AND y.user_id=? AND x.organization_id=? AND c.status='active' LIMIT 1").bind(a, b, organizationId).first();
}

const fieldLabels: [keyof ReturnType<typeof comparable>, string][] = [["displayName", "nombre"], ["phone", "teléfono"], ["contactEmail", "correo de contacto"], ["education", "formación"], ["specialties", "especialidades"], ["availability", "disponibilidad"]];
function comparable(name: string, row: ProfileRow | null) {
  return { displayName: name, phone: row?.phone || null, contactEmail: row?.contact_email || null, education: row?.education || "", specialties: row?.specialties || "[]", availability: row?.availability || "[]" };
}

async function saveProfile(request: Request, current: Member, db: Database) {
  const value = staffProfileInput(await jsonBody(request));
  if (!value) return reply({ error: "Revisa el perfil: nombre de 2 a 80 caracteres, teléfono de 7 a 15 dígitos, un correo válido, hasta 12 especialidades sin repetir y horarios de disponibilidad que no se crucen." }, 400);
  const person = await personOf(db, current.id, current.organizationId);
  if (!person) return reply({ error: "Tu cuenta no está disponible." }, 404);
  const before = comparable(person.name, await profileRow(db, current.id, current.organizationId));
  const after = { ...value, specialties: JSON.stringify(value.specialties), availability: JSON.stringify(value.availability) };
  const changed = fieldLabels.filter(([key]) => before[key] !== after[key]).map(([, label]) => label);
  if (changed.length) {
    const now = new Date().toISOString();
    // ST-154: specialties are the labels of the teaching areas of the professional profile's working copy.
    const draft = storedProfile(JSON.parse((await db.prepare("SELECT draft FROM staff_profiles WHERE user_id=?").bind(current.id).first<{ draft: string }>())?.draft || "{}"));
    const areas = before.specialties === after.specialties ? null : JSON.stringify(areasFromSpecialties(value.specialties, draft.areas));
    await db.batch([
      db.prepare("UPDATE users SET display_name=? WHERE id=?").bind(value.displayName, current.id),
      db.prepare("INSERT INTO staff_profiles(user_id,organization_id,phone,contact_email,education,specialties,availability,updated_at) VALUES (?,?,?,?,?,?,?,?) ON CONFLICT(user_id) DO UPDATE SET phone=excluded.phone,contact_email=excluded.contact_email,education=excluded.education,specialties=excluded.specialties,availability=excluded.availability,updated_at=excluded.updated_at")
        .bind(current.id, current.organizationId, value.phone, value.contactEmail, value.education, after.specialties, after.availability, now),
      ...(areas ? [db.prepare("UPDATE staff_profiles SET draft=json_set(draft,'$.areas',json(?)),draft_version=draft_version+1 WHERE user_id=?").bind(areas, current.id)] : []),
      // Which fields changed, never their values: phone and e-mail are personal data.
      event(db, current, { action: "updated", targetType: "account", targetId: current.id, summary: `Actualizó su perfil: ${changed.join(", ")}` }),
    ]);
  }
  const saved = await personOf(db, current.id, current.organizationId);
  return reply({ profile: profileView(saved!, await profileRow(db, current.id, current.organizationId), true), changed });
}

async function savePhoto(method: string, request: Request, current: Member, db: Database, bucket: R2Bucket) {
  const now = new Date().toISOString();
  if (method === "DELETE") {
    const row = await profileRow(db, current.id, current.organizationId);
    if (!row?.photo_key) return reply({ ok: true });
    // The object stays in the bucket, like every uploaded file, so a restored backup still finds it.
    await db.batch([
      db.prepare("UPDATE staff_profiles SET photo_key=NULL,photo_type=NULL,photo_size=NULL,photo_sha256=NULL,updated_at=? WHERE user_id=?").bind(now, current.id),
      event(db, current, { action: "updated", targetType: "account", targetId: current.id, summary: "Quitó su foto de perfil" }),
    ]);
    return reply({ ok: true });
  }
  const mediaType = request.headers.get("Content-Type") || "";
  if (!(photoTypes as readonly string[]).includes(mediaType)) return reply({ error: "La foto debe ser una imagen JPG, PNG o WebP de hasta 2 MB." }, 400);
  const bytes = await readBounded(request, MAX_PHOTO_BYTES);
  if (!bytes || !validSignature(mediaType, bytes)) return reply({ error: "La foto debe ser una imagen JPG, PNG o WebP de hasta 2 MB." }, 400);
  const sha256 = hex(await crypto.subtle.digest("SHA-256", bytes)), key = `${current.organizationId}/staff/${current.id}/photo-${crypto.randomUUID()}`;
  await bucket.put(key, bytes, { httpMetadata: { contentType: "application/octet-stream" }, customMetadata: { sha256, organizationId: current.organizationId, userId: current.id } });
  await db.batch([
    db.prepare("INSERT INTO staff_profiles(user_id,organization_id,photo_key,photo_type,photo_size,photo_sha256,updated_at) VALUES (?,?,?,?,?,?,?) ON CONFLICT(user_id) DO UPDATE SET photo_key=excluded.photo_key,photo_type=excluded.photo_type,photo_size=excluded.photo_size,photo_sha256=excluded.photo_sha256,updated_at=excluded.updated_at")
      .bind(current.id, current.organizationId, key, mediaType, bytes.byteLength, sha256, now),
    event(db, current, { action: "updated", targetType: "account", targetId: current.id, summary: "Cambió su foto de perfil" }),
  ]);
  return reply({ ok: true, photoVersion: sha256.slice(0, 12) });
}

async function photo(id: string, current: Member, db: Database, bucket: R2Bucket) {
  return photoResponse(db, id, current.organizationId, bucket);
}
/** The stored photo of a person of the organization, checked against its fingerprint; also served to students (ST-157). */
export async function photoResponse(db: Database, id: string, organizationId: string, bucket: R2Bucket) {
  const row = await db.prepare("SELECT p.photo_key,p.photo_type,p.photo_size,p.photo_sha256 FROM staff_profiles p JOIN memberships m ON m.user_id=p.user_id AND m.organization_id=p.organization_id WHERE p.user_id=? AND p.organization_id=? AND p.photo_key IS NOT NULL").bind(id, organizationId).first<{ photo_key: string; photo_type: string; photo_size: number; photo_sha256: string }>();
  if (!row) return reply({ error: "Esta persona no tiene foto." }, 404);
  const object = await bucket.get(row.photo_key);
  if (!object) return reply({ error: "No se encontró la foto almacenada." }, 404);
  if (object.size !== row.photo_size || object.customMetadata?.sha256 !== row.photo_sha256 || object.customMetadata?.organizationId !== organizationId) return reply({ error: "La foto almacenada no pasó la verificación de integridad." }, 503);
  return new Response(object.body, { headers: { "Content-Type": row.photo_type, "Content-Length": String(row.photo_size), "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff", "Cross-Origin-Resource-Policy": "same-origin", "X-File-SHA256": row.photo_sha256 } });
}

type DocumentRow = { id: string; user_id: string; type: StaffDocument["type"]; title: string; issued_on: string; expires_on: string | null; object_key: string; media_type: string; size_bytes: number; sha256: string; uploaded_at: string; uploaded_by: string; uploader: string; withdrawn_at: string | null };
const documentColumns = "d.id,d.user_id,d.type,d.title,d.issued_on,d.expires_on,d.object_key,d.media_type,d.size_bytes,d.sha256,d.uploaded_at,d.uploaded_by,COALESCE(u.display_name,u.username) AS uploader,d.withdrawn_at";
function documentView(row: DocumentRow, today: string): StaffDocument {
  return { id: row.id, userId: row.user_id, type: row.type, title: row.title, issuedOn: row.issued_on, expiresOn: row.expires_on, status: documentStatus(row.expires_on, today), mediaType: row.media_type, sizeBytes: row.size_bytes, uploadedAt: row.uploaded_at, uploadedBy: row.uploader, selfUploaded: row.uploaded_by === row.user_id, withdrawnAt: row.withdrawn_at };
}
const intoFile = (person: Person, current: Member) => person.id === current.id ? "a su expediente" : `al expediente de ${person.name}`;
const ofFile = (person: Person, current: Member) => person.id === current.id ? "de su expediente" : `del expediente de ${person.name}`;

async function staffFile(path: string, method: string, request: Request, current: Member, db: Database, bucket: R2Bucket) {
  const parts = path.split("/"), id = parts[3], self = id === current.id, admin = current.role === "admin";
  // DEC-043: the staff file is seen only by administration and the person; anyone else gets the same answer as a stranger.
  if (!admin && !self) return reply({ error: "Solo administración y la propia persona consultan este expediente." }, 403);
  const person = await personOf(db, id, current.organizationId);
  if (!person) return reply({ error: "Persona no disponible." }, 404);
  const today = await todayFor(db, current.organizationId);
  if (parts.length === 5 && method === "GET") {
    const rows = (await db.prepare(`SELECT ${documentColumns} FROM staff_documents d JOIN users u ON u.id=d.uploaded_by WHERE d.user_id=? AND d.organization_id=?${admin ? "" : " AND d.withdrawn_at IS NULL"} ORDER BY d.withdrawn_at IS NOT NULL,d.type,d.issued_on DESC,d.id`).bind(id, current.organizationId).all<DocumentRow>()).results;
    const file: StaffFile = { member: { id: person.id, name: person.name, active: !!person.active }, today, documents: rows.map(row => documentView(row, today)) };
    return reply(file);
  }
  if (parts.length === 5 && method === "POST") {
    let title = request.headers.get("X-Document-Title") || "";
    try { title = decodeURIComponent(title); } catch { return reply({ error: "El título del documento no es válido." }, 400); }
    const meta = staffDocumentInput({ type: request.headers.get("X-Document-Type"), title, issuedOn: request.headers.get("X-Issued-On"), expiresOn: request.headers.get("X-Expires-On") || null }, today);
    if (!meta) return reply({ error: "Elige el tipo, una fecha de emisión que no sea futura y, si tiene, un vencimiento posterior a la emisión." }, 400);
    const mediaType = request.headers.get("Content-Type") || "";
    if (!documentTypes[mediaType]) return reply({ error: "Sube un PDF, JPG o PNG de hasta 10 MB." }, 400);
    const bytes = await readBounded(request, MAX_DOCUMENT_BYTES);
    if (!bytes || !validSignature(mediaType, bytes)) return reply({ error: "El archivo no es un PDF, JPG o PNG válido de hasta 10 MB." }, 400);
    const sha256 = hex(await crypto.subtle.digest("SHA-256", bytes)), documentId = `staff-document-${crypto.randomUUID()}`, key = `${current.organizationId}/staff/${id}/${crypto.randomUUID()}`, now = new Date().toISOString();
    await bucket.put(key, bytes, { httpMetadata: { contentType: "application/octet-stream" }, customMetadata: { sha256, organizationId: current.organizationId, userId: id } });
    const saved = await db.guardedBatch(
      db.prepare("SELECT 1 AS room WHERE COALESCE((SELECT SUM(size_bytes) FROM staff_documents WHERE organization_id=?),0)+?<=? AND (SELECT count(*) FROM staff_documents WHERE user_id=? AND withdrawn_at IS NULL)<?").bind(current.organizationId, bytes.byteLength, MAX_ORGANIZATION_STAFF_BYTES, id, MAX_DOCUMENTS_PER_PERSON),
      [db.prepare("INSERT INTO staff_documents(id,organization_id,user_id,type,title,issued_on,expires_on,object_key,media_type,size_bytes,sha256,uploaded_by,uploaded_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)")
        .bind(documentId, current.organizationId, id, meta.type, meta.title, meta.issuedOn, meta.expiresOn, key, mediaType, bytes.byteLength, sha256, current.id, now),
      // Only the type: titles and file contents can carry personal data.
      event(db, current, { action: "uploaded", targetType: "account", targetId: id, summary: `Agregó ${intoFile(person, current)}: ${staffDocumentLabel(meta.type)}` })],
    );
    if (!saved) { await bucket.delete(key); return reply({ error: `El expediente admite hasta ${MAX_DOCUMENTS_PER_PERSON} documentos vigentes por persona y 1 GiB por organización.` }, 413); }
    const row = await db.prepare(`SELECT ${documentColumns} FROM staff_documents d JOIN users u ON u.id=d.uploaded_by WHERE d.id=?`).bind(documentId).first<DocumentRow>();
    return reply({ document: documentView(row!, today) }, 201);
  }
  const row = await db.prepare(`SELECT ${documentColumns} FROM staff_documents d JOIN users u ON u.id=d.uploaded_by WHERE d.id=? AND d.user_id=? AND d.organization_id=?`).bind(parts[5], id, current.organizationId).first<DocumentRow>();
  if (!row || (!admin && row.withdrawn_at)) return reply({ error: "El documento no está en este expediente." }, 404);
  if (parts[6] === "withdraw" && method === "POST") {
    if (!admin) return reply({ error: "Solo administración retira documentos del expediente." }, 403);
    if (row.withdrawn_at) return reply({ error: "El documento ya se retiró." }, 409);
    // The metadata and the stored object stay: withdrawing only takes the document out of the current file.
    await db.batch([
      db.prepare("UPDATE staff_documents SET withdrawn_at=?,withdrawn_by=? WHERE id=? AND withdrawn_at IS NULL").bind(new Date().toISOString(), current.id, row.id),
      event(db, current, { action: "withdrawn", targetType: "account", targetId: id, summary: `Retiró ${ofFile(person, current)}: ${staffDocumentLabel(row.type)}` }),
    ]);
    return reply({ ok: true });
  }
  if (parts[6] !== "content" || method !== "GET") return reply({ error: "Not found" }, 404);
  const object = await bucket.get(row.object_key);
  if (!object) return reply({ error: "No se encontró el archivo almacenado." }, 404);
  if (object.size !== row.size_bytes || object.customMetadata?.sha256 !== row.sha256 || object.customMetadata?.organizationId !== current.organizationId || object.customMetadata?.userId !== id) return reply({ error: "La copia almacenada no pasó la verificación de integridad." }, 503);
  // Each download is part of the activity (a "consulta"), with the document type only.
  await event(db, current, { action: "recorded", targetType: "account", targetId: id, summary: `Consultó un documento ${ofFile(person, current)}: ${staffDocumentLabel(row.type)}` }).run();
  const name = `${staffDocumentLabel(row.type).normalize("NFD").replace(/[^A-Za-z0-9]+/g, "-").replace(/^-|-$/g, "").toLowerCase()}-${row.issued_on}.${documentTypes[row.media_type]}`;
  return new Response(object.body, { headers: { "Cache-Control": "private, no-store", "Content-Type": "application/octet-stream", "Content-Length": String(row.size_bytes), "Content-Disposition": `attachment; filename="${name}"`, "X-Content-Type-Options": "nosniff", "Cross-Origin-Resource-Policy": "same-origin", "X-File-SHA256": row.sha256 } });
}

async function expiring(current: Member, db: Database) {
  if (current.role !== "admin") return reply({ error: "Solo administración consulta los vencimientos del equipo." }, 403);
  const today = await todayFor(db, current.organizationId);
  const limit = new Date(Date.parse(`${today}T00:00:00Z`) + expiringWindowDays * 86400000).toISOString().slice(0, 10);
  // Active people only: the file of someone who left is kept, but its expiry no longer needs attention.
  const rows = (await db.prepare("SELECT d.id,d.user_id AS userId,COALESCE(u.display_name,u.username) AS name,d.type,d.title,d.expires_on AS expiresOn FROM staff_documents d JOIN users u ON u.id=d.user_id JOIN memberships m ON m.user_id=d.user_id AND m.organization_id=d.organization_id WHERE d.organization_id=? AND d.withdrawn_at IS NULL AND d.expires_on IS NOT NULL AND d.expires_on<=? AND m.active=1 ORDER BY d.expires_on,name,d.id")
    .bind(current.organizationId, limit).all<{ id: string; userId: string; name: string; type: StaffDocument["type"]; title: string; expiresOn: string }>()).results;
  const people: ExpiringDocuments["people"] = [];
  for (const row of rows) {
    let person = people.find(item => item.id === row.userId);
    if (!person) { person = { id: row.userId, name: row.name, documents: [] }; people.push(person); }
    person.documents.push({ id: row.id, type: row.type, title: row.title, expiresOn: row.expiresOn, status: documentStatus(row.expiresOn, today) });
  }
  const overview: ExpiringDocuments = { today, people };
  return reply(overview);
}

export const staffPath = /^\/api\/(profile(\/photo)?|expiring-documents|members\/[a-z0-9-]+\/(profile|photo|files(\/[a-z0-9-]+\/(content|withdraw))?))$/;
export function staffMethods(path: string): string[] | null {
  if (!staffPath.test(path)) return null;
  if (path === "/api/profile") return ["GET", "PUT"];
  if (path === "/api/profile/photo") return ["PUT", "DELETE"];
  if (path.endsWith("/files")) return ["GET", "POST"];
  if (path.endsWith("/withdraw")) return ["POST"];
  return ["GET"];
}

export async function staff(path: string, method: string, request: Request, current: Member, db: Database, bucket: R2Bucket): Promise<Response> {
  const response = await handle(path, method, request, current, db, bucket);
  // A refused upload still drains its body when it is within the limits, so the client's connection stays usable.
  if (request.body && !request.bodyUsed) {
    const declared = Number(request.headers.get("Content-Length"));
    await (Number.isSafeInteger(declared) && declared <= 2 * MAX_DOCUMENT_BYTES ? request.arrayBuffer() : request.body.cancel()).catch(() => undefined);
  }
  return response;
}
async function handle(path: string, method: string, request: Request, current: Member, db: Database, bucket: R2Bucket): Promise<Response> {
  if (path === "/api/profile") {
    if (method === "PUT") return saveProfile(request, current, db);
    const person = await personOf(db, current.id, current.organizationId);
    return person ? reply({ profile: profileView(person, await profileRow(db, current.id, current.organizationId), true) }) : reply({ error: "Tu cuenta no está disponible." }, 404);
  }
  if (path === "/api/profile/photo") return savePhoto(method, request, current, db, bucket);
  if (path === "/api/expiring-documents") return expiring(current, db);
  const id = path.split("/")[3];
  if (path.endsWith("/photo")) return photo(id, current, db, bucket);
  if (path.endsWith("/profile")) {
    const person = await personOf(db, id, current.organizationId);
    if (!person) return reply({ error: "Persona no disponible." }, 404);
    const full = current.role === "admin" || id === current.id;
    if (!full && !await teammates(db, current.id, id, current.organizationId)) return reply({ error: "Solo administración y el equipo de sus cursos ven este perfil." }, 403);
    return reply({ profile: profileView(person, await profileRow(db, id, current.organizationId), full) });
  }
  return staffFile(path, method, request, current, db, bucket);
}
