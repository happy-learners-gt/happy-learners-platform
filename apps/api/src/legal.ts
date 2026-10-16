import type { LegalAcceptance, LegalDocument, LegalKind, LegalSignature, Member, PendingDocument, SignatureRecord, SignatureVerification } from "@happy-learners/contracts";
import { documentCanonical, isLegalKind, legalDraftInput, legalLabels, organizationIds, pendingAgreement, pendingDocuments, record, signatureCanonical, signedKinds, signedNameInput } from "@happy-learners/domain";
import { digest, verifyPassword } from "./auth";
import type { Database } from "./storage";
import { event } from "./team";

const reply = (value: unknown, status = 200) => Response.json(value, { status });
const columns = "id,kind,status,version,title,body,consent,updated_at AS updatedAt,published_at AS publishedAt,(SELECT COALESCE(u.display_name,u.username) FROM users u WHERE u.id=d.published_by) AS publishedBy";
/** "la versión 2 de los términos y condiciones": what an event or a message names, without the document's text. */
const nouns: Record<LegalKind, string> = { terms: "los términos y condiciones", privacy: "la política de privacidad", volunteer: "el acuerdo de voluntariado ad honorem" };
const named = (kind: LegalKind, version: number | null) => `la versión ${version} de ${nouns[kind]}`;

/** The latest published version of each kind and what the person still has to accept (ST-126, ST-127). */
export async function pendingFor(db: Database, current: Member): Promise<PendingDocument[]> {
  const [published, inForce] = await db.batch([
    db.prepare("SELECT id,kind,version,title FROM legal_documents WHERE organization_id=? AND status='published'").bind(current.organizationId),
    db.prepare("SELECT document_id AS id FROM legal_acceptances WHERE organization_id=? AND user_id=? AND withdrawn_at IS NULL").bind(current.organizationId, current.id),
  ]) as unknown as [PendingDocument[], { id: string }[]];
  return pendingDocuments(published, inForce.map(row => row.id));
}
/** The volunteer agreement in force that the person has not signed yet (ST-151), or null. */
export async function agreementFor(db: Database, current: Member): Promise<PendingDocument | null> {
  const [published, inForce] = await db.batch([
    db.prepare("SELECT id,kind,version,title FROM legal_documents WHERE organization_id=? AND kind='volunteer' AND status='published'").bind(current.organizationId),
    db.prepare("SELECT a.document_id AS id FROM legal_acceptances a JOIN legal_documents d ON d.id=a.document_id WHERE a.organization_id=? AND a.user_id=? AND a.withdrawn_at IS NULL AND d.kind='volunteer'").bind(current.organizationId, current.id),
  ]) as unknown as [PendingDocument[], { id: string }[]];
  return pendingAgreement(published, inForce.map(row => row.id));
}
/**
 * ST-151 CA2: starting a class, taking its roll or completing it waits until whoever teaches has signed the volunteer
 * agreement in force. An organization that has not published one blocks nothing.
 */
export async function agreementBlock(db: Database, current: Member): Promise<Response | null> {
  const agreement = await agreementFor(db, current);
  return agreement ? reply({ error: `Firma la versión ${agreement.version} del acuerdo de voluntariado ad honorem antes de impartir clases. Puedes firmarlo desde Ayuda.`, code: "VOLUNTEER_AGREEMENT_REQUIRED", agreement }, 403) : null;
}

async function currentDocuments(db: Database, organizationId: string) {
  return (await db.prepare(`SELECT ${columns} FROM legal_documents d WHERE organization_id=? AND status='published' AND version=(SELECT max(version) FROM legal_documents x WHERE x.organization_id=d.organization_id AND x.kind=d.kind AND x.status='published') ORDER BY kind DESC`)
    .bind(organizationId).all<LegalDocument>()).results;
}
function acceptances(db: Database, organizationId: string, userId?: string) {
  return db.prepare(`SELECT a.id,a.document_id AS documentId,d.kind,d.version,a.user_id AS userId,COALESCE(u.display_name,u.username) AS name,a.accepted_at AS acceptedAt,a.withdrawn_at AS withdrawnAt,s.id AS signatureId,s.signed_name AS signedName
    FROM legal_acceptances a JOIN legal_documents d ON d.id=a.document_id JOIN users u ON u.id=a.user_id LEFT JOIN legal_signatures s ON s.acceptance_id=a.id WHERE a.organization_id=?${userId ? " AND a.user_id=?" : ""} ORDER BY a.accepted_at DESC,a.id LIMIT 2000`)
    .bind(organizationId, ...(userId ? [userId] : [])).all<LegalAcceptance>().then(result => result.results);
}
async function mine(db: Database, current: Member) {
  return { documents: await currentDocuments(db, current.organizationId), pending: await pendingFor(db, current), agreement: await agreementFor(db, current), mine: await acceptances(db, current.organizationId, current.id) };
}
async function allDocuments(db: Database, organizationId: string) {
  return (await db.prepare(`SELECT ${columns} FROM legal_documents d WHERE organization_id=? ORDER BY kind DESC,CASE status WHEN 'draft' THEN 0 ELSE 1 END,version DESC`).bind(organizationId).all<LegalDocument>()).results;
}

/**
 * /api/legal…: every person reads the versions in force and accepts them or withdraws a privacy consent; administration
 * writes drafts, publishes them and reads who accepted what. A published version and an acceptance are never rewritten.
 */
export async function legal(path: string, method: string, input: unknown, current: Member, db: Database): Promise<Response> {
  const now = new Date().toISOString();
  if (path === "/api/legal") return reply(await mine(db, current));
  if (path === "/api/legal/accept") {
    const value = record(input), ids = value?.documentIds;
    if (!Array.isArray(ids) || !ids.length || ids.length > 3 || ids.some(id => typeof id !== "string") || new Set(ids).size !== ids.length) return reply({ error: "Elige las versiones que aceptas." }, 400);
    const latest = await currentDocuments(db, current.organizationId);
    const chosen = ids.map(id => latest.find(item => item.id === id));
    if (chosen.some(item => !item)) return reply({ error: "Hay una versión más reciente. Vuelve a leerla para aceptarla." }, 409);
    // Accepting again what is already in force changes nothing and records nothing.
    const agreement = await agreementFor(db, current);
    const pending = new Set([...(await pendingFor(db, current)).map(item => item.id), ...(agreement ? [agreement.id] : [])]);
    const accepted = chosen.filter(item => pending.has(item!.id)) as LegalDocument[];
    // ST-153: the terms and the volunteer agreement are signed with the full name and the account's password.
    const signing = accepted.filter(item => signedKinds.includes(item.kind));
    let signedName: string | null = null;
    if (signing.length) {
      const signature = record(value?.signature);
      signedName = signedNameInput(signature?.fullName);
      const password = signature?.password;
      if (!signedName || typeof password !== "string" || !password || password.length > 128) return reply({ error: "Para firmar, escribe tu nombre completo (de 3 a 120 caracteres) y tu contraseña.", code: "SIGNATURE_REQUIRED" }, 400);
      const refused = await confirmIdentity(db, current, password);
      if (refused) return refused;
    }
    const signatures = await Promise.all(signing.map(item => signatureOf(current, item, signedName!, now)));
    await db.batch(accepted.flatMap(item => {
      const acceptanceId = `acceptance-${crypto.randomUUID()}`, signature = signatures.find(entry => entry.record.documentId === item.id);
      return [
        db.prepare("INSERT INTO legal_acceptances(id,organization_id,document_id,user_id,accepted_at) SELECT ?,?,?,?,? WHERE NOT EXISTS(SELECT 1 FROM legal_acceptances WHERE document_id=? AND user_id=? AND withdrawn_at IS NULL)")
          .bind(acceptanceId, current.organizationId, item.id, current.id, now, item.id, current.id),
        ...(signature ? [db.prepare("INSERT INTO legal_signatures(id,organization_id,acceptance_id,document_id,user_id,username,signed_name,document_sha256,signature_sha256,signed_at) SELECT ?,?,?,?,?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM legal_acceptances WHERE id=?)")
          .bind(signature.record.signatureId, current.organizationId, acceptanceId, item.id, current.id, current.username, signature.record.signedName, signature.record.documentSha256, signature.signatureSha256, now, acceptanceId)] : []),
        event(db, current, { action: "accepted", targetType: "legal", targetId: item.id, summary: `${signature ? "Firmó electrónicamente" : item.kind === "terms" ? "Aceptó" : "Dio su consentimiento a"} ${named(item.kind, item.version)}` }),
      ];
    }));
    return reply({ ...(await mine(db, current)), signatures: signatures.map(item => item.record.signatureId) });
  }
  if (path === "/api/legal/withdraw") {
    const id = record(input)?.documentId;
    const found = typeof id === "string" ? await db.prepare("SELECT a.id,d.kind,d.version FROM legal_acceptances a JOIN legal_documents d ON d.id=a.document_id WHERE a.document_id=? AND a.user_id=? AND a.organization_id=? AND a.withdrawn_at IS NULL").bind(id, current.id, current.organizationId).first<{ id: string; kind: LegalKind; version: number }>() : null;
    if (!found) return reply({ error: "No tienes un consentimiento vigente para esa versión." }, 404);
    if (found.kind !== "privacy") return reply({ error: "Los términos y condiciones y el acuerdo de voluntariado firmados no se retiran; solo el consentimiento de privacidad." }, 400);
    await db.batch([
      db.prepare("UPDATE legal_acceptances SET withdrawn_at=? WHERE id=? AND withdrawn_at IS NULL").bind(now, found.id),
      event(db, current, { action: "withdrawn", targetType: "legal", targetId: String(id), summary: `Retiró su consentimiento a ${named(found.kind, found.version)}` }),
    ]);
    return reply(await mine(db, current));
  }
  const receipt = /^\/api\/legal\/signatures\/(signature-[a-z0-9-]+)\/receipt$/.exec(path)?.[1];
  if (receipt) {
    // The signer downloads their own receipt; administration downloads anyone's.
    const found = await signatureById(db, current.organizationId, receipt);
    if (!found || (found.userId !== current.id && current.role !== "admin")) return reply({ error: "Constancia no disponible." }, 404);
    const document = await signedDocument(db, found.documentId);
    return new Response(receiptHtml(found, document!), { headers: { "Content-Type": "text/html; charset=utf-8", "Content-Disposition": `attachment; filename="constancia-${found.signatureId}.html"` } });
  }
  if (current.role !== "admin") return reply({ error: "Solo administración publica los documentos legales y revisa las firmas." }, 403);
  if (path === "/api/legal/signatures") return reply({ signatures: await signatureList(db, current.organizationId) });
  if (path === "/api/legal/signatures/verify") return reply(await verify(db, current.organizationId, input));
  if (path === "/api/legal/documents") return reply({ documents: await allDocuments(db, current.organizationId) });
  if (path === "/api/legal/acceptances") {
    const people = (await db.prepare("SELECT u.id,COALESCE(u.display_name,u.username) AS name,CASE m.role WHEN 'instructor' THEN 'educator' ELSE m.role END AS role FROM memberships m JOIN users u ON u.id=m.user_id WHERE m.organization_id=? AND m.active=1 ORDER BY name").bind(current.organizationId).all<{ id: string; name: string; role: string }>()).results;
    return reply({ acceptances: await acceptances(db, current.organizationId), people });
  }
  const [, , , , kind, action] = path.split("/");
  if (!isLegalKind(kind)) return reply({ error: "Documento no disponible." }, 404);
  const draft = await db.prepare("SELECT id FROM legal_documents WHERE organization_id=? AND kind=? AND status='draft'").bind(current.organizationId, kind).first<{ id: string }>();
  if (action === "publish") {
    if (!draft) return reply({ error: "Guarda un borrador antes de publicarlo." }, 409);
    await db.prepare("UPDATE legal_documents SET status='published',version=(SELECT COALESCE(max(version),0)+1 FROM legal_documents WHERE organization_id=? AND kind=?),published_by=?,published_at=? WHERE id=? AND status='draft'")
      .bind(current.organizationId, kind, current.id, now, draft.id).run();
    const published = await db.prepare("SELECT version FROM legal_documents WHERE id=?").bind(draft.id).first<{ version: number }>();
    await event(db, current, { action: "published", targetType: "legal", targetId: draft.id, summary: `Publicó ${named(kind, published?.version ?? null)}` }).run();
    return reply({ documents: await allDocuments(db, current.organizationId) });
  }
  const value = legalDraftInput(kind, input);
  if (!value) return reply({ error: kind !== "privacy" ? "Escribe un título de 3 a 120 caracteres y un texto de al menos 20 caracteres, sin marcas HTML." : "Escribe un título de 3 a 120 caracteres, un texto de al menos 20 caracteres y un texto de consentimiento de 10 a 1000 caracteres en una sola línea." }, 400);
  if (draft) await db.prepare("UPDATE legal_documents SET title=?,body=?,consent=?,updated_by=?,updated_at=? WHERE id=? AND status='draft'").bind(value.title, value.body, value.consent, current.id, now, draft.id).run();
  else await db.prepare("INSERT INTO legal_documents(id,organization_id,kind,status,title,body,consent,updated_by,updated_at) VALUES (?,?,?,'draft',?,?,?,?,?)").bind(`legal-${kind}-${crypto.randomUUID()}`, current.organizationId, kind, value.title, value.body, value.consent, current.id, now).run();
  return reply({ documents: await allDocuments(db, current.organizationId) });
}

/** Failed signing attempts per account: at most five every 15 minutes, in the bucket table sign-in uses. */
const maxSigningFailures = 5;
async function confirmIdentity(db: Database, current: Member, password: string): Promise<Response | null> {
  const bucket = await digest(`signature:${current.organizationId}:${current.id}`), now = Date.now();
  const limit = await db.prepare("SELECT attempts FROM login_limits WHERE bucket=? AND expires_at>?").bind(bucket, now).first<{ attempts: number }>();
  if (limit && limit.attempts >= maxSigningFailures) return Response.json({ error: "Demasiados intentos de firma con una contraseña incorrecta. Espera 15 minutos y vuelve a intentar.", code: "SIGNATURE_RATE_LIMITED" }, { status: 429, headers: { "Retry-After": "900" } });
  const user = await db.prepare("SELECT password_salt,password_hash FROM users WHERE id=?").bind(current.id).first<{ password_salt: string; password_hash: string }>();
  if (user && await verifyPassword(password, user.password_salt, user.password_hash)) {
    if (limit) await db.prepare("DELETE FROM login_limits WHERE bucket=?").bind(bucket).run();
    return null;
  }
  await db.prepare("INSERT INTO login_limits (bucket, attempts, expires_at) VALUES (?,1,?) ON CONFLICT(bucket) DO UPDATE SET attempts=CASE WHEN expires_at<? THEN 1 ELSE attempts+1 END, expires_at=CASE WHEN expires_at<? THEN excluded.expires_at ELSE expires_at END")
    .bind(bucket, now + 900000, now, now).run();
  return reply({ error: "La contraseña no es correcta. Tu firma no se registró.", code: "SIGNATURE_PASSWORD_INVALID" }, 403);
}

type StoredDocument = { kind: LegalKind; version: number; title: string; body: string; publishedAt: string };
const documentSha = (document: StoredDocument) => digest(documentCanonical(document));
async function signatureOf(current: Member, document: LegalDocument, signedName: string, signedAt: string) {
  const documentSha256 = await documentSha({ kind: document.kind, version: document.version!, title: document.title, body: document.body, publishedAt: document.publishedAt! });
  const record: SignatureRecord = { signatureId: `signature-${crypto.randomUUID()}`, organizationId: current.organizationId, userId: current.id, username: current.username, signedName, documentId: document.id, kind: document.kind, version: document.version!, documentSha256, signedAt };
  return { record, signatureSha256: await digest(signatureCanonical(record)) };
}
const signatureColumns = `s.id AS signatureId,s.organization_id AS organizationId,s.user_id AS userId,s.username,s.signed_name AS signedName,s.document_id AS documentId,d.kind,d.version,d.title,
  s.document_sha256 AS documentSha256,s.signature_sha256 AS signatureSha256,s.signed_at AS signedAt,s.acceptance_id AS acceptanceId,COALESCE(u.display_name,u.username) AS name,
  COALESCE((SELECT max(m.active) FROM memberships m WHERE m.user_id=s.user_id AND m.organization_id=s.organization_id),0) AS active,
  (SELECT x.departed_on FROM departures x WHERE x.user_id=s.user_id AND x.organization_id=s.organization_id ORDER BY x.recorded_at DESC LIMIT 1) AS departedOn
  FROM legal_signatures s JOIN legal_documents d ON d.id=s.document_id JOIN users u ON u.id=s.user_id`;
const signatureRow = (row: Omit<LegalSignature, "active"> & { active: number }): LegalSignature => ({ ...row, active: !!row.active, departedOn: row.departedOn || null });
/** ST-151 CA3: every signature, including those of people who already left; nothing is filtered by the membership. */
async function signatureList(db: Database, organizationId: string) {
  return (await db.prepare(`SELECT ${signatureColumns} WHERE s.organization_id=? ORDER BY s.signed_at DESC,s.id LIMIT 2000`).bind(organizationId).all<Omit<LegalSignature, "active"> & { active: number }>()).results.map(signatureRow);
}
async function signatureById(db: Database, organizationId: string, id: string) {
  const row = await db.prepare(`SELECT ${signatureColumns} WHERE s.organization_id=? AND s.id=?`).bind(organizationId, id).first<Omit<LegalSignature, "active"> & { active: number }>();
  return row ? signatureRow(row) : null;
}
const signedDocument = (db: Database, id: string) => db.prepare("SELECT kind,version,title,body,published_at AS publishedAt FROM legal_documents WHERE id=?").bind(id).first<StoredDocument>();
const recordOf = (signature: SignatureRecord): SignatureRecord => ({ signatureId: signature.signatureId, organizationId: signature.organizationId, userId: signature.userId, username: signature.username, signedName: signature.signedName, documentId: signature.documentId, kind: signature.kind, version: signature.version, documentSha256: signature.documentSha256, signedAt: signature.signedAt });
const recordFields = ["signatureId", "organizationId", "userId", "username", "signedName", "documentId", "kind", "version", "documentSha256", "signedAt"] as const;

/**
 * ST-153 CA3: administration verifies a signature by its id or by the fields of a downloaded receipt. The document's
 * fingerprint is recomputed from the version kept in the store and the signature's from its record; a receipt is
 * compared field by field and against its own fingerprint.
 */
async function verify(db: Database, organizationId: string, input: unknown): Promise<SignatureVerification> {
  const value = record(input), receipt = record(value?.receipt);
  const id = receipt ? receipt.signatureId : value?.signatureId;
  const unknown: SignatureVerification = { status: "unknown", message: "No hay ninguna firma con ese identificador en esta organización." };
  if (typeof id !== "string" || !/^signature-[a-z0-9-]{1,80}$/.test(id.trim())) return unknown;
  const signature = await signatureById(db, organizationId, id.trim());
  if (!signature) return unknown;
  const document = await signedDocument(db, signature.documentId);
  if (!document || await documentSha(document) !== signature.documentSha256)
    return { status: "document_mismatch", message: "El documento guardado ya no coincide con la versión que se firmó: su huella SHA-256 es distinta.", signature, mismatches: ["documentSha256"] };
  if (receipt && receipt.documentSha256 !== signature.documentSha256)
    return { status: "document_mismatch", message: "La constancia no corresponde al documento firmado: la huella SHA-256 del documento no coincide.", signature, mismatches: ["documentSha256"] };
  if (await digest(signatureCanonical(recordOf(signature))) !== signature.signatureSha256)
    return { status: "receipt_mismatch", message: "El registro de la firma fue alterado: su huella no coincide.", signature, mismatches: ["signatureSha256"] };
  if (receipt) {
    const mismatches: string[] = recordFields.filter(field => receipt[field] !== signature[field]);
    if (receipt.signatureSha256 !== signature.signatureSha256) mismatches.push("signatureSha256");
    if (mismatches.length) return { status: "receipt_mismatch", message: `La constancia fue modificada: no coincide en ${mismatches.join(", ")}.`, signature, mismatches };
  }
  return { status: "valid", message: `Firma válida: ${signature.signedName} firmó ${named(signature.kind, signature.version)} el ${signature.signedAt}, y el documento coincide con la versión firmada.`, signature };
}

const escape = (value: string | number) => String(value).replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]!);
/**
 * The downloadable receipt ("constancia"): a self-contained, printable HTML page with every field, both fingerprints,
 * the signed text and how to verify it. Its data block holds the record administration's verification reads.
 */
export function receiptHtml(signature: LegalSignature, document: StoredDocument): string {
  const data = JSON.stringify({ ...recordOf(signature), signatureSha256: signature.signatureSha256 }).replace(/</g, "\\u003c");
  const rows: [string, string | number][] = [["Identificador de la firma", signature.signatureId], ["Organización", signature.organizationId], ["Nombre escrito al firmar", signature.signedName],
    ["Cuenta", `${signature.username} (${signature.userId})`], ["Documento", `${legalLabels[signature.kind]} · ${document.title}`], ["Versión", signature.version], ["Publicada el (UTC)", document.publishedAt],
    ["Firmado el (UTC)", signature.signedAt], ["Huella SHA-256 del documento", signature.documentSha256], ["Huella SHA-256 de la firma", signature.signatureSha256]];
  return `<!doctype html>
<html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Constancia de firma electrónica · ${escape(signature.signatureId)}</title>
<style>body{font:16px/1.5 system-ui,sans-serif;color:#1b1b1b;max-width:48rem;margin:2rem auto;padding:0 1rem}th{text-align:left;vertical-align:top;padding:.25rem 1rem .25rem 0}td{word-break:break-all}pre,code{white-space:pre-wrap;word-break:break-word;background:#f3f3f3;padding:.1rem .25rem}.text{border:1px solid #ccc;padding:0 1rem}</style></head>
<body><main>
<h1>Constancia de firma electrónica</h1>
<p>${escape(signature.signedName)} firmó electrónicamente ${escape(named(signature.kind, signature.version))} confirmando su identidad con la contraseña de su cuenta.</p>
<table><tbody>${rows.map(([label, value]) => `<tr><th scope="row">${escape(label)}</th><td>${escape(value)}</td></tr>`).join("")}</tbody></table>
<h2>Cómo verificar esta constancia</h2>
<ol><li>Administración abre Organización › Términos y privacidad › Firmas y carga este archivo o escribe el identificador de la firma; la plataforma recalcula ambas huellas e indica si la firma es válida, si el documento no coincide o si la constancia fue modificada.</li>
<li>La huella del documento es el SHA-256 (hexadecimal) del JSON canónico —claves en orden alfabético, sin espacios— de <code>{"body","kind","publishedAt","title","version"}</code> de la versión firmada, cuyo texto se reproduce abajo.</li>
<li>La huella de la firma es el SHA-256 del JSON canónico de <code>{"documentId","documentSha256","kind","organizationId","signatureId","signedAt","signedName","userId","username","version"}</code>, los datos que figuran en esta constancia.</li></ol>
<p>Firma electrónica simple (DEC-043): cuenta, contraseña, nombre escrito, fecha y huella SHA-256 del documento. No es una firma electrónica avanzada con certificado de un prestador acreditado.</p>
<h2>Texto firmado</h2>
<section class="text" aria-label="Texto firmado"><h3>${escape(document.title)}</h3>${document.body.split(/\n{2,}/).map(paragraph => `<p>${escape(paragraph)}</p>`).join("")}</section>
<script type="application/json" id="hl-constancia">${data}</script>
</main></body></html>
`;
}

/**
 * GET /api/public/privacy[?organization=id] (ST-127): the privacy policy in force can be read without signing in. Without
 * an organization it lists every organization that published one; only the text, its version and its date are shown.
 */
export async function publicPrivacy(url: URL, open: (organizationId: string) => Database): Promise<Response> {
  const asked = url.searchParams.get("organization");
  if (asked !== null && !organizationIds.includes(asked)) return reply({ error: "Organización no disponible." }, 404);
  const policies = (await Promise.all((asked ? [asked] : organizationIds).map(id => open(id).prepare(
    "SELECT o.id AS organizationId,COALESCE(o.name,'Organización sin nombre') AS organizationName,d.version,d.title,d.body,d.consent,d.published_at AS publishedAt FROM legal_documents d JOIN organizations o ON o.id=d.organization_id WHERE d.organization_id=? AND d.kind='privacy' AND d.status='published' ORDER BY d.version DESC LIMIT 1",
  ).bind(id).first<{ organizationId: string; organizationName: string; version: number; title: string; body: string; consent: string; publishedAt: string }>()))).filter(item => !!item);
  if (asked && !policies.length) return reply({ error: "Esta organización todavía no publica su política de privacidad." }, 404);
  return reply({ policies: policies.map(({ organizationId, organizationName, ...document }) => ({ organization: { id: organizationId, name: organizationName }, document: { kind: "privacy", ...document } })) });
}
