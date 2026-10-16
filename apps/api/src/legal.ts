import type { LegalAcceptance, LegalDocument, LegalKind, Member, PendingDocument } from "@happy-learners/contracts";
import { isLegalKind, legalDraftInput, organizationIds, pendingDocuments, record } from "@happy-learners/domain";
import type { Database } from "./storage";
import { event } from "./team";

const reply = (value: unknown, status = 200) => Response.json(value, { status });
const columns = "id,kind,status,version,title,body,consent,updated_at AS updatedAt,published_at AS publishedAt,(SELECT COALESCE(u.display_name,u.username) FROM users u WHERE u.id=d.published_by) AS publishedBy";
/** "la versión 2 de los términos y condiciones": what an event or a message names, without the document's text. */
const named = (kind: LegalKind, version: number | null) => `la versión ${version} de ${kind === "terms" ? "los términos y condiciones" : "la política de privacidad"}`;

/** The latest published version of each kind and what the person still has to accept (ST-126, ST-127). */
export async function pendingFor(db: Database, current: Member): Promise<PendingDocument[]> {
  const [published, inForce] = await db.batch([
    db.prepare("SELECT id,kind,version,title FROM legal_documents WHERE organization_id=? AND status='published'").bind(current.organizationId),
    db.prepare("SELECT document_id AS id FROM legal_acceptances WHERE organization_id=? AND user_id=? AND withdrawn_at IS NULL").bind(current.organizationId, current.id),
  ]) as unknown as [PendingDocument[], { id: string }[]];
  return pendingDocuments(published, inForce.map(row => row.id));
}

async function currentDocuments(db: Database, organizationId: string) {
  return (await db.prepare(`SELECT ${columns} FROM legal_documents d WHERE organization_id=? AND status='published' AND version=(SELECT max(version) FROM legal_documents x WHERE x.organization_id=d.organization_id AND x.kind=d.kind AND x.status='published') ORDER BY kind DESC`)
    .bind(organizationId).all<LegalDocument>()).results;
}
function acceptances(db: Database, organizationId: string, userId?: string) {
  return db.prepare(`SELECT a.id,a.document_id AS documentId,d.kind,d.version,a.user_id AS userId,COALESCE(u.display_name,u.username) AS name,a.accepted_at AS acceptedAt,a.withdrawn_at AS withdrawnAt
    FROM legal_acceptances a JOIN legal_documents d ON d.id=a.document_id JOIN users u ON u.id=a.user_id WHERE a.organization_id=?${userId ? " AND a.user_id=?" : ""} ORDER BY a.accepted_at DESC,a.id LIMIT 2000`)
    .bind(organizationId, ...(userId ? [userId] : [])).all<LegalAcceptance>().then(result => result.results);
}
async function mine(db: Database, current: Member) {
  return { documents: await currentDocuments(db, current.organizationId), pending: await pendingFor(db, current), mine: await acceptances(db, current.organizationId, current.id) };
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
    const ids = record(input)?.documentIds;
    if (!Array.isArray(ids) || !ids.length || ids.length > 2 || ids.some(id => typeof id !== "string") || new Set(ids).size !== ids.length) return reply({ error: "Elige las versiones que aceptas." }, 400);
    const latest = await currentDocuments(db, current.organizationId);
    const chosen = ids.map(id => latest.find(item => item.id === id));
    if (chosen.some(item => !item)) return reply({ error: "Hay una versión más reciente. Vuelve a leerla para aceptarla." }, 409);
    // Accepting again what is already in force changes nothing and records nothing.
    const pending = new Set((await pendingFor(db, current)).map(item => item.id));
    await db.batch(chosen.filter(item => pending.has(item!.id)).flatMap(item => [
      db.prepare("INSERT INTO legal_acceptances(id,organization_id,document_id,user_id,accepted_at) SELECT ?,?,?,?,? WHERE NOT EXISTS(SELECT 1 FROM legal_acceptances WHERE document_id=? AND user_id=? AND withdrawn_at IS NULL)")
        .bind(`acceptance-${crypto.randomUUID()}`, current.organizationId, item!.id, current.id, now, item!.id, current.id),
      event(db, current, { action: "accepted", targetType: "legal", targetId: item!.id, summary: `${item!.kind === "terms" ? "Aceptó" : "Dio su consentimiento a"} ${named(item!.kind, item!.version)}` }),
    ]));
    return reply(await mine(db, current));
  }
  if (path === "/api/legal/withdraw") {
    const id = record(input)?.documentId;
    const found = typeof id === "string" ? await db.prepare("SELECT a.id,d.kind,d.version FROM legal_acceptances a JOIN legal_documents d ON d.id=a.document_id WHERE a.document_id=? AND a.user_id=? AND a.organization_id=? AND a.withdrawn_at IS NULL").bind(id, current.id, current.organizationId).first<{ id: string; kind: LegalKind; version: number }>() : null;
    if (!found) return reply({ error: "No tienes un consentimiento vigente para esa versión." }, 404);
    if (found.kind !== "privacy") return reply({ error: "Los términos y condiciones no se retiran; solo el consentimiento de privacidad." }, 400);
    await db.batch([
      db.prepare("UPDATE legal_acceptances SET withdrawn_at=? WHERE id=? AND withdrawn_at IS NULL").bind(now, found.id),
      event(db, current, { action: "withdrawn", targetType: "legal", targetId: String(id), summary: `Retiró su consentimiento a ${named(found.kind, found.version)}` }),
    ]);
    return reply(await mine(db, current));
  }
  if (current.role !== "admin") return reply({ error: "Solo administración publica los términos y la política de privacidad." }, 403);
  if (path === "/api/legal/documents") return reply({ documents: await allDocuments(db, current.organizationId) });
  if (path === "/api/legal/acceptances") {
    const people = (await db.prepare("SELECT u.id,COALESCE(u.display_name,u.username) AS name FROM memberships m JOIN users u ON u.id=m.user_id WHERE m.organization_id=? AND m.active=1 ORDER BY name").bind(current.organizationId).all<{ id: string; name: string }>()).results;
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
  if (!value) return reply({ error: kind === "terms" ? "Escribe un título de 3 a 120 caracteres y un texto de al menos 20 caracteres, sin marcas HTML." : "Escribe un título de 3 a 120 caracteres, un texto de al menos 20 caracteres y un texto de consentimiento de 10 a 1000 caracteres en una sola línea." }, 400);
  if (draft) await db.prepare("UPDATE legal_documents SET title=?,body=?,consent=?,updated_by=?,updated_at=? WHERE id=? AND status='draft'").bind(value.title, value.body, value.consent, current.id, now, draft.id).run();
  else await db.prepare("INSERT INTO legal_documents(id,organization_id,kind,status,title,body,consent,updated_by,updated_at) VALUES (?,?,?,'draft',?,?,?,?,?)").bind(`legal-${kind}-${crypto.randomUUID()}`, current.organizationId, kind, value.title, value.body, value.consent, current.id, now).run();
  return reply({ documents: await allDocuments(db, current.organizationId) });
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
