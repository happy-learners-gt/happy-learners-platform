import type { Contract, ContractEngagement, ContractOffer, ContractSignatureRecord, ContractTemplate, ContractTemplateVersion, ContractTermField, ContractTerms, Member, RichTextDocument } from "@happy-learners/contracts";
import {
  closeReasonInput, contractCanonical, contractDatesInput, contractInForce, contractPhase, contractSignatureCanonical, contractSignedNameInput, contractTemplateInput,
  contractTermsFor, contractValues, contractVersionInput, engagementLabels, localDay, mergeContract, record, richPlainText,
} from "@happy-learners/domain";
import type { Database, Prepared } from "./storage";
import { digest } from "./auth";
import { event } from "./team";
import { agreementBlock, confirmIdentity } from "./legal";

/**
 * DEC-046: contract templates and contracts. Administration keeps templates and prepares, signs, sends, voids and
 * terminates contracts; the person signs or declines the ones sent to them. A sent contract is a frozen copy of the
 * template version with the values of its placeholders and its terms; both signatures fingerprint that copy.
 * Contract events use the activity's legal target, so the activity table keeps its schema.
 */
const reply = (value: unknown, status = 200) => Response.json(value, { status });
const forbidden = () => reply({ error: "Solo administración gestiona los contratos." }, 403);
const missing = () => reply({ error: "Contrato no disponible." }, 404);
const idPattern = "[a-z0-9-]+";

export function contractMethods(path: string): string[] | null {
  if (path === "/api/contract-templates") return ["GET", "POST"];
  if (new RegExp(`^/api/contract-templates/${idPattern}$`).test(path)) return ["GET", "PUT"];
  if (new RegExp(`^/api/contract-templates/${idPattern}/draft$`).test(path)) return ["PUT"];
  if (new RegExp(`^/api/contract-templates/${idPattern}/publish$`).test(path)) return ["POST"];
  if (path === "/api/contracts") return ["GET", "POST"];
  if (path === "/api/contract-settings") return ["GET", "PUT"];
  if (path === "/api/me/contracts") return ["GET"];
  if (new RegExp(`^/api/contracts/${idPattern}$`).test(path)) return ["GET", "PUT", "DELETE"];
  if (new RegExp(`^/api/contracts/${idPattern}/(send|sign|decline|void|terminate|amend)$`).test(path)) return ["POST"];
  return null;
}

type VersionRow = { id: string; templateId: string; status: "draft" | "published"; version: number | null; title: string; body: string; defaults: string; editable: string; effectiveFrom: string | null; updatedAt: string; publishedAt: string | null; publishedBy: string | null };
const versionColumns = "v.id,v.template_id AS templateId,v.status,v.version,v.title,v.body_json AS body,v.defaults_json AS defaults,v.editable_json AS editable,v.effective_from AS effectiveFrom,v.updated_at AS updatedAt,v.published_at AS publishedAt,COALESCE(p.display_name,p.username) AS publishedBy";
const versionFrom = "FROM contract_template_versions v LEFT JOIN users p ON p.id=v.published_by";
const versionOf = (row: VersionRow): ContractTemplateVersion => ({ ...row, body: JSON.parse(row.body), defaults: JSON.parse(row.defaults), editable: JSON.parse(row.editable) });

type ContractRow = Omit<Contract, "body" | "terms" | "phase" | "organizationSignature" | "memberSignature"> & {
  body: string | null; terms: string; orgSignerId: string | null; orgSignedName: string | null; orgSignedAt: string | null; orgSignature: string | null;
  memberSignedName: string | null; memberSignedAt: string | null; memberSignature: string | null;
};
const contractColumns = `c.id,v.template_id AS templateId,c.template_version_id AS templateVersionId,v.version AS templateVersion,c.origin,c.engagement,c.title,c.body_json AS body,c.body_text AS bodyText,
  c.terms_json AS terms,c.party_name AS partyName,c.party_email AS partyEmail,c.user_id AS userId,c.invitation_id AS invitationId,c.start_date AS startDate,c.end_date AS endDate,c.status,
  c.supersedes_id AS supersedesId,c.document_sha256 AS documentSha256,c.created_at AS createdAt,c.sent_at AS sentAt,COALESCE(cu.display_name,cu.username) AS createdBy,
  c.org_signer_id AS orgSignerId,c.org_signed_name AS orgSignedName,c.org_signed_at AS orgSignedAt,c.org_signature_sha256 AS orgSignature,
  c.member_signed_name AS memberSignedName,c.member_signed_at AS memberSignedAt,c.member_signature_sha256 AS memberSignature,
  c.closed_at AS closedAt,c.close_reason AS closeReason,c.termination_date AS terminationDate
  FROM contracts c JOIN contract_template_versions v ON v.id=c.template_version_id JOIN users cu ON cu.id=c.created_by`;
function contractOf(row: ContractRow, today: string): Contract {
  const { orgSignerId, orgSignedName, orgSignedAt, orgSignature, memberSignedName, memberSignedAt, memberSignature, ...rest } = row;
  return {
    ...rest, body: row.body ? JSON.parse(row.body) as RichTextDocument : null, terms: JSON.parse(row.terms) as ContractTerms,
    phase: contractPhase(row, today),
    organizationSignature: orgSignedName && orgSignedAt && orgSignature && orgSignerId ? { name: orgSignedName, signedAt: orgSignedAt, signatureSha256: orgSignature, signerId: orgSignerId } : null,
    memberSignature: memberSignedName && memberSignedAt && memberSignature ? { name: memberSignedName, signedAt: memberSignedAt, signatureSha256: memberSignature } : null,
  };
}
async function organizationOf(db: Database, organizationId: string) {
  return (await db.prepare("SELECT name,timezone,locale,contract_required AS required FROM organizations WHERE id=?").bind(organizationId).first<{ name: string | null; timezone: string | null; locale: string | null; required: number }>())
    || { name: null, timezone: null, locale: null, required: 0 };
}
const todayIn = (timezone: string | null) => localDay(timezone || "America/Guatemala");
async function contractById(db: Database, organizationId: string, id: string, today: string) {
  const row = await db.prepare(`SELECT ${contractColumns} WHERE c.id=? AND c.organization_id=?`).bind(id, organizationId).first<ContractRow>();
  return row ? contractOf(row, today) : null;
}

/** The contracts of one person, newest first: what /api/me/contracts and the onboarding read. */
export async function contractsOf(db: Database, organizationId: string, userId: string, today?: string): Promise<Contract[]> {
  const day = today || todayIn((await organizationOf(db, organizationId)).timezone);
  const rows = (await db.prepare(`SELECT ${contractColumns} WHERE c.organization_id=? AND c.user_id=? AND c.status<>'draft' ORDER BY c.created_at DESC`).bind(organizationId, userId).all<ContractRow>()).results;
  return rows.map(row => contractOf(row, day));
}

/**
 * DEC-046: in an organization that requires a contract, teaching a class waits for one in force; elsewhere the
 * former volunteer-agreement rule (ST-151) still applies.
 */
export async function contractBlock(db: Database, current: Member): Promise<Response | null> {
  const organization = await organizationOf(db, current.organizationId);
  if (!organization.required) return agreementBlock(db, current);
  const mine = await contractsOf(db, current.organizationId, current.id, todayIn(organization.timezone));
  if (mine.some(contract => contractInForce(contract, todayIn(organization.timezone)))) return null;
  const pending = mine.find(contract => contract.status === "sent");
  return reply({
    error: pending ? `Firma tu contrato «${pending.title}» antes de impartir clases. Lo encuentras en Mi cuenta › Contratos.` : "Necesitas un contrato vigente para impartir clases. Pide a administración que te lo envíe.",
    code: "CONTRACT_REQUIRED", contractId: pending?.id || null,
  }, 403);
}


async function templateRows(db: Database, organizationId: string, id?: string): Promise<ContractTemplate[]> {
  const [templates, versions, counts] = await db.batch([
    db.prepare(`SELECT id,name,engagement,description,status,updated_at AS updatedAt FROM contract_templates WHERE organization_id=?${id ? " AND id=?" : ""} ORDER BY status,name`).bind(organizationId, ...(id ? [id] : [])),
    db.prepare(`SELECT ${versionColumns} ${versionFrom} WHERE v.organization_id=?${id ? " AND v.template_id=?" : ""} ORDER BY v.version DESC`).bind(organizationId, ...(id ? [id] : [])),
    db.prepare(`SELECT v.template_id AS templateId,count(*) AS n FROM contracts c JOIN contract_template_versions v ON v.id=c.template_version_id WHERE c.organization_id=? AND c.status<>'draft' GROUP BY v.template_id`).bind(organizationId),
  ]) as unknown as [Omit<ContractTemplate, "current" | "draft" | "versions" | "contracts">[], VersionRow[], { templateId: string; n: number }[]];
  return templates.map(template => {
    const mine = versions.filter(row => row.templateId === template.id);
    const published = mine.filter(row => row.status === "published");
    const draft = mine.find(row => row.status === "draft");
    return { ...template, current: published[0] ? versionOf(published[0]) : null, draft: draft ? versionOf(draft) : null, versions: published.length, contracts: counts.find(row => row.templateId === template.id)?.n || 0 };
  });
}

async function signatureOf(record: ContractSignatureRecord) {
  return digest(contractSignatureCanonical(record));
}

/** /api/contract-templates, /api/contracts, /api/contract-settings and /api/me/contracts. */
export async function contracts(path: string, method: string, input: unknown, current: Member, db: Database): Promise<Response> {
  const organization = await organizationOf(db, current.organizationId);
  const today = todayIn(organization.timezone), now = new Date().toISOString(), admin = current.role === "admin";

  if (path === "/api/me/contracts") return reply({ contracts: await contractsOf(db, current.organizationId, current.id, today), required: !!organization.required });

  if (path === "/api/contract-settings") {
    if (!admin) return forbidden();
    if (method === "PUT") {
      const value = record(input);
      if (typeof value?.required !== "boolean") return reply({ error: "Indica si se exige un contrato vigente para impartir clases." }, 400);
      if (value.required && !(await db.prepare("SELECT 1 AS found FROM contract_template_versions WHERE organization_id=? AND status='published'").bind(current.organizationId).first()))
        return reply({ error: "Publica al menos una plantilla de contrato antes de exigirlo." }, 409);
      await db.batch([
        db.prepare("UPDATE organizations SET contract_required=? WHERE id=?").bind(value.required ? 1 : 0, current.organizationId),
        event(db, current, { action: "updated", targetType: "legal", targetId: "contract-settings", summary: value.required ? "Exigió un contrato vigente para impartir clases" : "Dejó de exigir un contrato para impartir clases" }),
      ]);
    }
    return reply({ required: !!(await organizationOf(db, current.organizationId)).required });
  }

  // Templates: administration only.
  if (path.startsWith("/api/contract-templates")) {
    if (!admin) return forbidden();
    const [, , , id, action] = path.split("/");
    if (path === "/api/contract-templates") {
      if (method === "GET") return reply({ templates: await templateRows(db, current.organizationId), required: !!organization.required });
      const value = record(input), template = contractTemplateInput(value?.template), version = template && contractVersionInput(template.engagement, value?.version);
      if (!template || !version) return reply({ error: "Revisa la plantilla: nombre, tipo de relación, título, cláusulas de al menos 20 caracteres y condiciones que correspondan al tipo." }, 400);
      if (await db.prepare("SELECT 1 AS found FROM contract_templates WHERE organization_id=? AND name=?").bind(current.organizationId, template.name).first()) return reply({ error: "Ya hay una plantilla con ese nombre." }, 409);
      const templateId = `ct-${crypto.randomUUID()}`;
      await db.batch([
        db.prepare("INSERT INTO contract_templates(id,organization_id,name,engagement,description,status,created_by,created_at,updated_at) VALUES (?,?,?,?,?,'active',?,?,?)").bind(templateId, current.organizationId, template.name, template.engagement, template.description, current.id, now, now),
        db.prepare("INSERT INTO contract_template_versions(id,organization_id,template_id,status,title,body_json,body_text,defaults_json,editable_json,effective_from,updated_by,updated_at) VALUES (?,?,?,'draft',?,?,?,?,?,?,?,?)")
          .bind(`ctv-${crypto.randomUUID()}`, current.organizationId, templateId, version.title, JSON.stringify(version.body), version.bodyText, JSON.stringify(version.defaults), JSON.stringify(version.editable), version.effectiveFrom, current.id, now),
        event(db, current, { action: "created", targetType: "legal", targetId: templateId, summary: `Creó la plantilla de contrato «${template.name}» (${engagementLabels[template.engagement]})` }),
      ]);
      return reply({ template: (await templateRows(db, current.organizationId, templateId))[0] }, 201);
    }
    const [template] = await templateRows(db, current.organizationId, id);
    if (!template) return reply({ error: "Plantilla no disponible." }, 404);
    if (!action) {
      if (method === "GET") {
        const history = (await db.prepare(`SELECT ${versionColumns} ${versionFrom} WHERE v.template_id=? AND v.status='published' ORDER BY v.version DESC`).bind(id).all<VersionRow>()).results.map(versionOf);
        return reply({ template, history });
      }
      const value = record(input);
      const name = value?.name === undefined ? template.name : contractTemplateInput({ name: value.name, engagement: template.engagement, description: value.description ?? template.description })?.name;
      const description = value?.description === undefined ? template.description : contractTemplateInput({ name: template.name, engagement: template.engagement, description: value.description })?.description;
      const status = value?.status === undefined ? template.status : value.status;
      if (!name || description === undefined || (status !== "active" && status !== "archived")) return reply({ error: "Revisa el nombre, la descripción y el estado de la plantilla." }, 400);
      await db.batch([
        db.prepare("UPDATE contract_templates SET name=?,description=?,status=?,updated_at=? WHERE id=?").bind(name, description, status, now, id),
        event(db, current, { action: status === template.status ? "updated" : status === "archived" ? "archived" : "restored", targetType: "legal", targetId: id, summary: `${status !== template.status ? (status === "archived" ? "Archivó" : "Restauró") : "Actualizó"} la plantilla de contrato «${name}»` }),
      ]);
      return reply({ template: (await templateRows(db, current.organizationId, id))[0] });
    }
    if (action === "draft") {
      const version = contractVersionInput(template.engagement, input);
      if (!version) return reply({ error: "Revisa el título, las cláusulas (al menos 20 caracteres) y que las condiciones correspondan al tipo de relación." }, 400);
      const values = [version.title, JSON.stringify(version.body), version.bodyText, JSON.stringify(version.defaults), JSON.stringify(version.editable), version.effectiveFrom, current.id, now];
      if (template.draft) await db.prepare("UPDATE contract_template_versions SET title=?,body_json=?,body_text=?,defaults_json=?,editable_json=?,effective_from=?,updated_by=?,updated_at=? WHERE id=? AND status='draft'").bind(...values, template.draft.id).run();
      else await db.prepare("INSERT INTO contract_template_versions(id,organization_id,template_id,status,title,body_json,body_text,defaults_json,editable_json,effective_from,updated_by,updated_at) VALUES (?,?,?,'draft',?,?,?,?,?,?,?,?)")
        .bind(`ctv-${crypto.randomUUID()}`, current.organizationId, id, ...values).run();
      return reply({ template: (await templateRows(db, current.organizationId, id))[0] });
    }
    // Publishing turns the draft into the next version; it applies to contracts prepared from its effective date.
    if (!template.draft) return reply({ error: "No hay un borrador que publicar." }, 409);
    const value = record(input), effectiveFrom = typeof value?.effectiveFrom === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value.effectiveFrom) ? value.effectiveFrom : template.draft.effectiveFrom || today;
    if (effectiveFrom < today) return reply({ error: "La vigencia de una versión empieza hoy o después." }, 400);
    const next = template.versions + 1;
    await db.batch([
      db.prepare("UPDATE contract_template_versions SET status='published',version=?,effective_from=?,published_by=?,published_at=? WHERE id=? AND status='draft'").bind(next, effectiveFrom, current.id, now, template.draft.id),
      db.prepare("UPDATE contract_templates SET updated_at=? WHERE id=?").bind(now, id),
      event(db, current, { action: "published", targetType: "legal", targetId: id, summary: `Publicó la versión ${next} de la plantilla «${template.name}», vigente desde ${effectiveFrom}` }),
    ]);
    return reply({ template: (await templateRows(db, current.organizationId, id))[0] });
  }

  // Contracts.
  if (path === "/api/contracts") {
    if (!admin) return forbidden();
    if (method === "GET") {
      const rows = (await db.prepare(`SELECT ${contractColumns} WHERE c.organization_id=? ORDER BY c.created_at DESC LIMIT 500`).bind(current.organizationId).all<ContractRow>()).results;
      return reply({ contracts: rows.map(row => contractOf(row, today)), required: !!organization.required });
    }
    const value = record(input);
    const person = typeof value?.userId === "string" ? await db.prepare("SELECT u.id,COALESCE(u.display_name,u.username) AS name,u.email FROM users u JOIN memberships m ON m.user_id=u.id WHERE u.id=? AND m.organization_id=? AND m.active=1").bind(value.userId, current.organizationId).first<{ id: string; name: string; email: string | null }>() : null;
    if (!person) return reply({ error: "Elige una persona activa del equipo." }, 400);
    const prepared = await prepareContract(db, current, organization, value, { name: person.name, email: person.email }, today);
    if (prepared instanceof Response) return prepared;
    const id = `contract-${crypto.randomUUID()}`;
    await db.batch([
      insertDraft(db, current, id, prepared, { userId: person.id, invitationId: null, supersedesId: null }, now),
      event(db, current, { action: "created", targetType: "legal", targetId: id, summary: `Preparó el contrato «${prepared.title}» para ${person.name}` }),
    ]);
    return reply({ contract: await contractById(db, current.organizationId, id, today) }, 201);
  }

  const [, , , id, action] = path.split("/");
  const contract = await contractById(db, current.organizationId, id, today);
  const party = contract?.userId === current.id;
  if (!contract || (!admin && !party)) return missing();
  if (!action) {
    if (method === "GET") return reply({ contract });
    if (!admin) return forbidden();
    if (contract.status !== "draft") return reply({ error: "Un contrato enviado no se edita. Para cambiarlo, prepara una enmienda." }, 409);
    if (method === "DELETE") {
      await db.batch([db.prepare("DELETE FROM contracts WHERE id=? AND status='draft'").bind(id), event(db, current, { action: "archived", targetType: "legal", targetId: id, summary: `Descartó el borrador del contrato de ${contract.partyName}` })]);
      return reply({ ok: true });
    }
    const prepared = await prepareContract(db, current, organization, { templateId: contract.templateId, ...record(input) }, { name: contract.partyName, email: contract.partyEmail }, today);
    if (prepared instanceof Response) return prepared;
    await db.prepare("UPDATE contracts SET template_version_id=?,engagement=?,title=?,body_json=?,body_text=?,terms_json=?,start_date=?,end_date=?,updated_at=? WHERE id=? AND status='draft'")
      .bind(prepared.versionId, prepared.engagement, prepared.title, JSON.stringify(prepared.body), prepared.bodyText, JSON.stringify(prepared.terms), prepared.startDate, prepared.endDate, now, id).run();
    return reply({ contract: await contractById(db, current.organizationId, id, today) });
  }

  const value = record(input);
  if (action === "send") {
    if (!admin) return forbidden();
    if (contract.status !== "draft") return reply({ error: "Este contrato ya se envió." }, 409);
    const signed = await organizationSigns(db, current, contract, value?.signature, now);
    if (signed instanceof Response) return signed;
    await db.batch([...signed, event(db, current, { action: "submitted", targetType: "legal", targetId: id, summary: `Firmó y envió el contrato «${contract.title}» a ${contract.partyName}` })]);
    return reply({ contract: await contractById(db, current.organizationId, id, today) });
  }
  if (action === "sign") {
    if (!party) return reply({ error: "Solo la persona del contrato lo firma." }, 403);
    if (contract.status !== "sent") return reply({ error: contract.status === "active" ? "Ya firmaste este contrato." : "Este contrato ya no se puede firmar." }, 409);
    const signature = record(value?.signature), signedName = contractSignedNameInput(signature?.fullName);
    if (!signedName || typeof signature?.password !== "string") return reply({ error: "Escribe tu nombre completo y tu contraseña para firmar." }, 400);
    const denied = await confirmIdentity(db, current, signature.password);
    if (denied) return denied;
    const statements = await memberSigns(db, current.organizationId, contract, current.id, current.username, signedName, now);
    await db.batch([...statements, event(db, current, { action: "accepted", targetType: "legal", targetId: id, summary: `Firmó electrónicamente su contrato «${contract.title}»` })]);
    return reply({ contract: await contractById(db, current.organizationId, id, today) });
  }
  if (action === "decline") {
    if (!party) return reply({ error: "Solo la persona del contrato lo rechaza." }, 403);
    if (contract.status !== "sent") return reply({ error: "Este contrato ya no se puede rechazar." }, 409);
    const reason = closeReasonInput(value?.reason, true);
    if (!reason) return reply({ error: "Cuenta a administración por qué no lo firmas (hasta 500 caracteres)." }, 400);
    await db.batch([
      db.prepare("UPDATE contracts SET status='declined',closed_at=?,closed_by=?,close_reason=?,updated_at=? WHERE id=? AND status='sent'").bind(now, current.id, reason, now, id),
      event(db, current, { action: "rejected", targetType: "legal", targetId: id, summary: `Rechazó el contrato «${contract.title}»` }),
    ]);
    return reply({ contract: await contractById(db, current.organizationId, id, today) });
  }
  if (!admin) return forbidden();
  if (action === "void") {
    if (contract.status !== "draft" && contract.status !== "sent") return reply({ error: "Solo se anula un contrato que aún no se firmó." }, 409);
    const reason = closeReasonInput(value?.reason, true);
    if (!reason) return reply({ error: "Indica el motivo de la anulación (hasta 500 caracteres)." }, 400);
    await db.batch([
      db.prepare("UPDATE contracts SET status='voided',closed_at=?,closed_by=?,close_reason=?,updated_at=? WHERE id=? AND status IN ('draft','sent')").bind(now, current.id, reason, now, id),
      event(db, current, { action: "revoked", targetType: "legal", targetId: id, summary: `Anuló el contrato de ${contract.partyName}` }),
    ]);
    return reply({ contract: await contractById(db, current.organizationId, id, today) });
  }
  if (action === "terminate") {
    if (contract.status !== "active") return reply({ error: "Solo se termina un contrato firmado." }, 409);
    const date = typeof value?.terminationDate === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value.terminationDate) ? value.terminationDate : null;
    const reason = closeReasonInput(value?.reason, true);
    if (!date || date < contract.startDate || (contract.endDate && date > contract.endDate) || !reason) return reply({ error: "Indica la fecha de terminación (dentro de la vigencia del contrato) y el motivo." }, 400);
    await db.batch([
      db.prepare("UPDATE contracts SET status='terminated',termination_date=?,closed_at=?,closed_by=?,close_reason=?,updated_at=? WHERE id=? AND status='active'").bind(date, now, current.id, reason, now, id),
      event(db, current, { action: "archived", targetType: "legal", targetId: id, summary: `Terminó el contrato de ${contract.partyName} con fecha ${date}` }),
    ]);
    return reply({ contract: await contractById(db, current.organizationId, id, today) });
  }
  // Amending prepares a new draft that, once signed by both, supersedes this one.
  if (contract.status !== "active" || !contract.userId) return reply({ error: "Solo se enmienda un contrato firmado." }, 409);
  if (await db.prepare("SELECT 1 AS found FROM contracts WHERE supersedes_id=? AND status IN ('draft','sent')").bind(id).first()) return reply({ error: "Este contrato ya tiene una enmienda en curso." }, 409);
  const prepared = await prepareContract(db, current, organization, { templateId: value?.templateId || contract.templateId, ...value }, { name: contract.partyName, email: contract.partyEmail }, today);
  if (prepared instanceof Response) return prepared;
  const amendment = `contract-${crypto.randomUUID()}`;
  await db.batch([
    insertDraft(db, current, amendment, prepared, { userId: contract.userId, invitationId: null, supersedesId: id }, now),
    event(db, current, { action: "created", targetType: "legal", targetId: amendment, summary: `Preparó una enmienda al contrato de ${contract.partyName}` }),
  ]);
  return reply({ contract: await contractById(db, current.organizationId, amendment, today) }, 201);
}

type PreparedContract = { versionId: string; engagement: ContractEngagement; title: string; body: RichTextDocument; bodyText: string; terms: ContractTerms; startDate: string; endDate: string | null; partyName: string; partyEmail: string | null };
/**
 * A contract from the template's version in force: its terms (defaults changed where allowed), its dates and its
 * clauses with the placeholders filled in.
 */
export async function prepareContract(db: Database, current: Member, organization: { name: string | null; locale: string | null }, value: Record<string, unknown> | null, party: { name: string; email: string | null }, today: string): Promise<PreparedContract | Response> {
  if (typeof value?.templateId !== "string") return reply({ error: "Elige una plantilla de contrato." }, 400);
  const template = await db.prepare("SELECT id,engagement,status FROM contract_templates WHERE id=? AND organization_id=?").bind(value.templateId, current.organizationId).first<{ id: string; engagement: ContractEngagement; status: string }>();
  if (!template || template.status !== "active") return reply({ error: "Esa plantilla no está disponible." }, 400);
  const version = await db.prepare(`SELECT ${versionColumns} ${versionFrom} WHERE v.template_id=? AND v.status='published' AND v.effective_from<=? ORDER BY v.version DESC LIMIT 1`).bind(template.id, today).first<VersionRow>();
  if (!version) return reply({ error: "La plantilla no tiene una versión publicada vigente." }, 409);
  const published = versionOf(version);
  const terms = contractTermsFor(template.engagement, published.defaults, published.editable as ContractTermField[], value.terms);
  if (!terms) return reply({ error: "Revisa las condiciones: solo se cambian las que la plantilla permite y deben corresponder al tipo de relación." }, 400);
  const dates = contractDatesInput(terms, value);
  if (!dates) return reply({ error: terms.term.kind === "fixed" ? "Indica la fecha de inicio y la de fin (o la duración en meses)." : "Indica la fecha de inicio; un contrato indefinido no tiene fecha de fin." }, 400);
  const format = (date: string) => new Intl.DateTimeFormat(organization.locale || "es", { dateStyle: "long", timeZone: "UTC" }).format(new Date(`${date}T12:00:00Z`));
  const body = mergeContract(published.body, contractValues({ partyName: party.name, partyEmail: party.email, organization: organization.name || "la organización", engagement: template.engagement, terms, ...dates, formatDate: format }));
  return { versionId: published.id, engagement: template.engagement, title: published.title, body, bodyText: richPlainText(body), terms, ...dates, partyName: party.name, partyEmail: party.email };
}
export function insertDraft(db: Database, current: Member, id: string, prepared: PreparedContract, links: { userId: string | null; invitationId: string | null; supersedesId: string | null }, now: string) {
  return db.prepare(`INSERT INTO contracts(id,organization_id,template_version_id,engagement,title,body_json,body_text,terms_json,party_name,party_email,user_id,invitation_id,start_date,end_date,status,supersedes_id,created_by,created_at,updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,'draft',?,?,?,?)`).bind(id, current.organizationId, prepared.versionId, prepared.engagement, prepared.title, JSON.stringify(prepared.body), prepared.bodyText,
    JSON.stringify(prepared.terms), prepared.partyName, prepared.partyEmail, links.userId, links.invitationId, prepared.startDate, prepared.endDate, links.supersedesId, current.id, now, now);
}

/** The organization signs a draft (administration re-enters its password): fingerprint, signature and status sent. */
export async function organizationSigns(db: Database, current: Member, contract: Pick<Contract, "id" | "templateVersionId" | "engagement" | "title" | "bodyText" | "terms" | "partyName" | "partyEmail" | "startDate" | "endDate">, value: unknown, now: string): Promise<Prepared[] | Response> {
  const signature = record(value), signedName = contractSignedNameInput(signature?.fullName);
  if (!signedName || typeof signature?.password !== "string") return reply({ error: "Escribe tu nombre completo y tu contraseña para firmar en nombre de la organización." }, 400);
  const denied = await confirmIdentity(db, current, signature.password);
  if (denied) return denied;
  const documentSha256 = await digest(contractCanonical({ id: contract.id, organizationId: current.organizationId, templateVersionId: contract.templateVersionId, engagement: contract.engagement, title: contract.title, bodyText: contract.bodyText, terms: contract.terms, partyName: contract.partyName, partyEmail: contract.partyEmail, startDate: contract.startDate, endDate: contract.endDate }));
  const orgSignature = await signatureOf({ contractId: contract.id, organizationId: current.organizationId, party: "organization", userId: current.id, username: current.username, signedName, documentSha256, signedAt: now });
  return [db.prepare("UPDATE contracts SET status='sent',document_sha256=?,sent_at=?,org_signer_id=?,org_signed_name=?,org_signed_at=?,org_signature_sha256=?,updated_at=? WHERE id=? AND status='draft'")
    .bind(documentSha256, now, current.id, signedName, now, orgSignature, now, contract.id)];
}

/** The person signs a sent contract; an amendment, once signed, supersedes the contract it replaces. */
export async function memberSigns(db: Database, organizationId: string, contract: Pick<Contract, "id" | "documentSha256" | "supersedesId">, userId: string, username: string, signedName: string, now: string): Promise<Prepared[]> {
  const memberSignature = await signatureOf({ contractId: contract.id, organizationId, party: "member", userId, username, signedName, documentSha256: contract.documentSha256!, signedAt: now });
  return [
    db.prepare("UPDATE contracts SET user_id=COALESCE(user_id,?),status='active',member_signed_name=?,member_signed_at=?,member_signature_sha256=?,updated_at=? WHERE id=? AND status='sent'").bind(userId, signedName, now, memberSignature, now, contract.id),
    ...(contract.supersedesId ? [db.prepare("UPDATE contracts SET status='superseded',closed_at=?,closed_by=?,close_reason='Reemplazado por una enmienda firmada',updated_at=? WHERE id=? AND status='active'").bind(now, userId, now, contract.supersedesId)] : []),
  ];
}

/** The contract an invitation offers, as the invitee reviews it before creating the account. */
export async function invitationOffer(db: Database, invitationId: string): Promise<ContractOffer | null> {
  const row = await db.prepare(`SELECT ${contractColumns} WHERE c.invitation_id=? AND c.status='sent'`).bind(invitationId).first<ContractRow>();
  if (!row) return null;
  const { id, engagement, title, body, bodyText, terms, partyName, startDate, endDate, documentSha256, organizationSignature } = contractOf(row, row.startDate);
  return { id, engagement, title, body, bodyText, terms, partyName, startDate, endDate, documentSha256, organizationSignature };
}
