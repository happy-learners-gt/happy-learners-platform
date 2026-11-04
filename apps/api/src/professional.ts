import type {
  Credential, CredentialReviewItem, CredentialState, CredentialType, DirectoryEntry, Member, MyProfessionalProfile, ProfessionalProfile, ProfileReviewItem, ProfileReviewQueue,
  ProfileStatus, ProfileVersionSummary, ProfileVersionStatus, PublicCredential, PublicProfile, StaffAvailabilitySlot,
} from "@happy-learners/contracts";
import {
  audienceView, availabilityInput, contactEmailInput, credentialInput, credentialStatus, credentialTransition, credentialTypeLabel, decisionNote, holds, maxEducationLength,
  phoneInput, professionalProfileInput, profileChanges, profileCompleteness, profileTransition, reaches, sameProfile, storedProfile, storedVisibility, submissionGaps, visibilityInput,
} from "@happy-learners/domain";
import type { ProfileAction, ProfileActor } from "@happy-learners/domain";
import type { Database, Prepared } from "./storage";
import { event } from "./activity";
import { todayFor } from "./classes";
import { photoResponse } from "./profiles";

/**
 * ST-154 to ST-157 (DEC-045): the professional profile, its credentials, its publication and who sees it.
 *   GET|PUT /api/me/profile · POST /api/me/profile/(submit|hide|show)                      — the signed-in person
 *   GET|POST /api/me/credentials · PUT /api/me/credentials/:id · POST …/:id/(submit|withdraw) — the signed-in person
 *   GET /api/profile-reviews · POST /api/members/:id/profile/(approve|request-changes|hide|show) — profile reviewers
 *   GET /api/members/:id/credentials · POST /api/members/:id/credentials/:cid/(verify|reject)   — reviewers (and the person, read-only)
 *   PUT /api/organization/profile-review                                                       — administration
 *   GET /api/profiles · GET /api/profiles/:id                                                  — any person of the team
 * Profile reviewers are administration or whoever holds «Revisar perfiles y verificar credenciales» (ST-135). Nobody
 * decides on their own profile or credentials. The working copy never leaves the person and the reviewers; the team
 * and the students see only the published version, and only the sections the person shows them.
 */
const reply = (data: unknown, status = 200) => Response.json(data, { status, headers: { "Cache-Control": "private, no-store" } });
const now = () => new Date().toISOString();
const MAX_CREDENTIALS = 30;
export const canReviewProfiles = (current: Member) => current.role === "admin" || holds(current.permissions, "profiles.review");

type ProfileRow = {
  user_id: string; name: string; username: string; role: string; active: number; email: string | null;
  phone: string | null; contact_email: string | null; education: string | null; availability: string | null; photo_sha256: string | null;
  draft: string | null; visibility: string | null; status: ProfileStatus | null; draft_version: number | null; hidden_by: ProfileActor | null; updated_at: string | null;
};
const profileColumns = "u.id AS user_id,COALESCE(u.display_name,u.username) AS name,u.username,CASE m.role WHEN 'instructor' THEN 'educator' ELSE m.role END AS role,m.active,u.email,p.phone,p.contact_email,p.education,p.availability,p.photo_sha256,p.draft,p.visibility,p.status,p.draft_version,p.hidden_by,p.updated_at";
const profileFrom = "FROM users u JOIN memberships m ON m.user_id=u.id LEFT JOIN staff_profiles p ON p.user_id=u.id AND p.organization_id=m.organization_id";
const profileOf = (db: Database, id: string, organizationId: string) => db.prepare(`SELECT ${profileColumns} ${profileFrom} WHERE u.id=? AND m.organization_id=?`).bind(id, organizationId).first<ProfileRow>();
/** Every person has a profile row once they touch their profile; earlier accounts get it on first use. */
const ensureRow = (db: Database, id: string, organizationId: string) => db.prepare("INSERT INTO staff_profiles(user_id,organization_id,updated_at) VALUES (?,?,?) ON CONFLICT(user_id) DO NOTHING").bind(id, organizationId, now());
const teamPhoto = (row: { user_id: string; photo_sha256: string | null }) => row.photo_sha256 ? `/api/members/${row.user_id}/photo?v=${row.photo_sha256.slice(0, 12)}` : null;

type VersionRow = { id: string; user_id: string; version: number; draft_version: number; content: string; status: ProfileVersionStatus; submitted_at: string; decided_at: string | null; decider: string | null; decision_note: string | null; published_at: string | null };
const versionColumns = "v.id,v.user_id,v.version,v.draft_version,v.content,v.status,v.submitted_at,v.decided_at,COALESCE(d.display_name,d.username) AS decider,v.decision_note,v.published_at";
const versionsOf = (db: Database, id: string) => db.prepare(`SELECT ${versionColumns} FROM staff_profile_versions v LEFT JOIN users d ON d.id=v.decided_by WHERE v.user_id=? ORDER BY v.version DESC`).bind(id).all<VersionRow>();
const summary = (row: VersionRow): ProfileVersionSummary => ({ version: row.version, status: row.status, submittedAt: row.submitted_at, decidedAt: row.decided_at, decidedBy: row.decider, note: row.decision_note, publishedAt: row.published_at });

type CredentialRow = { id: string; user_id: string; type: CredentialType; name: string; issuer: string; country: string | null; issued_on: string; expires_on: string | null; credential_code: string | null; verification_url: string | null; document_id: string | null; document_title: string | null; status: CredentialState; rejection_reason: string | null; submitted_at: string | null; decided_at: string | null; decider: string | null; version: number; updated_at: string };
const credentialColumns = "c.id,c.user_id,c.type,c.name,c.issuer,c.country,c.issued_on,c.expires_on,c.credential_code,c.verification_url,c.document_id,sd.title AS document_title,c.status,c.rejection_reason,c.submitted_at,c.decided_at,COALESCE(d.display_name,d.username) AS decider,c.version,c.updated_at";
const credentialFrom = "FROM staff_credentials c LEFT JOIN staff_documents sd ON sd.id=c.document_id LEFT JOIN users d ON d.id=c.decided_by";
const credentialsOf = (db: Database, id: string) => db.prepare(`SELECT ${credentialColumns} ${credentialFrom} WHERE c.user_id=? ORDER BY c.status='withdrawn',c.issued_on DESC,c.id`).bind(id).all<CredentialRow>();
const credentialView = (row: CredentialRow, today: string): Credential => ({
  id: row.id, userId: row.user_id, type: row.type, name: row.name, issuer: row.issuer, country: row.country, issuedOn: row.issued_on, expiresOn: row.expires_on,
  credentialCode: row.credential_code, verificationUrl: row.verification_url, documentId: row.document_id, documentTitle: row.document_title,
  status: credentialStatus(row.status, row.expires_on, today), rejectionReason: row.rejection_reason, submittedAt: row.submitted_at, decidedAt: row.decided_at, decidedBy: row.decider, version: row.version, updatedAt: row.updated_at,
});
const publicCredential = (row: CredentialRow, today: string): PublicCredential => ({ id: row.id, type: row.type, name: row.name, issuer: row.issuer, country: row.country, issuedOn: row.issued_on, expiresOn: row.expires_on, status: credentialStatus(row.status, row.expires_on, today) as "verified" | "expired" });

async function reviewRequired(db: Database, organizationId: string) {
  return !!(await db.prepare("SELECT profile_review_required AS required FROM organizations WHERE id=?").bind(organizationId).first<{ required: number }>())?.required;
}

/** GET /api/me/profile — everything «Mi perfil» needs: working copy, publication, open review, history and completeness. */
async function myProfile(current: Member, db: Database): Promise<MyProfessionalProfile | null> {
  const [row, versions, credentials, required, today] = await Promise.all([profileOf(db, current.id, current.organizationId), versionsOf(db, current.id), credentialsOf(db, current.id), reviewRequired(db, current.organizationId), todayFor(db, current.organizationId)]);
  if (!row) return null;
  const draft = storedProfile(JSON.parse(row.draft || "{}"));
  const published = versions.results.find(version => version.status === "published") || null;
  // The latest version sent, while it is open or was returned and nothing newer has been sent.
  const latest = versions.results[0];
  const submission = latest && (latest.status === "in_review" || latest.status === "returned") ? summary(latest) : null;
  const compared = latest?.status === "in_review" ? storedProfile(JSON.parse(latest.content)) : published ? storedProfile(JSON.parse(published.content)) : null;
  const sent = credentials.results.filter(item => item.status === "submitted" || item.status === "verified").length;
  return {
    userId: row.user_id, username: row.username, displayName: row.name, role: row.role === "admin" ? "admin" : "educator", photoVersion: row.photo_sha256?.slice(0, 12) || null,
    contact: { phone: row.phone, contactEmail: row.contact_email, loginEmail: row.email }, availability: JSON.parse(row.availability || "[]") as StaffAvailabilitySlot[], education: row.education || "",
    draft, draftVersion: row.draft_version || 0, visibility: storedVisibility(JSON.parse(row.visibility || "{}")),
    status: row.status || "draft", hiddenBy: row.hidden_by, reviewRequired: required,
    publication: published ? { version: published.version, publishedAt: published.published_at!, content: storedProfile(JSON.parse(published.content)) } : null,
    submission, hasChanges: compared ? !sameProfile(compared, draft) : true,
    history: versions.results.filter(version => version.status === "published" || version.status === "superseded").map(summary),
    completeness: profileCompleteness(draft, { photo: !!row.photo_sha256, credentials: sent }), missing: submissionGaps(draft),
    credentials: credentials.results.map(item => credentialView(item, today)),
  };
}

type Input = Record<string, unknown> | null;
/** PUT /api/me/profile {draft?, visibility?, displayName?, contact?, availability?, education?, draftVersion} */
async function saveMine(input: unknown, current: Member, db: Database) {
  const value = (input && typeof input === "object" ? input : null) as Input;
  if (!value) return reply({ error: "Envía los datos del perfil." }, 400);
  await ensureRow(db, current.id, current.organizationId).run();
  const row = (await profileOf(db, current.id, current.organizationId))!;
  if (value.draftVersion !== undefined && value.draftVersion !== row.draft_version) return reply({ error: "Tu perfil cambió en otra ventana. Recarga antes de guardar para no perder esos cambios.", code: "STALE" }, 409);
  const errors: Record<string, string> = {}, changed: string[] = [], sets: string[] = [], values: (string | number | null)[] = [];
  const before = storedProfile(JSON.parse(row.draft || "{}"));
  let draft = before;
  if (value.draft !== undefined) {
    const result = professionalProfileInput(value.draft);
    if ("errors" in result) Object.assign(errors, result.errors);
    else {
      draft = result.value;
      const sections = profileChanges(before, draft);
      if (sections.length) {
        changed.push(...sections);
        // The specialties of ST-149 (and the onboarding) are the labels of the areas.
        sets.push("draft=?", "draft_version=draft_version+1", "specialties=?"); values.push(JSON.stringify(draft), JSON.stringify(draft.areas.map(area => area.label)));
      }
    }
  }
  if (value.visibility !== undefined) {
    const visibility = visibilityInput(value.visibility);
    if (!visibility) errors.visibility = "Elige quién ve cada sección.";
    else if (JSON.stringify(visibility) !== JSON.stringify(storedVisibility(JSON.parse(row.visibility || "{}")))) { changed.push("Visibilidad"); sets.push("visibility=?"); values.push(JSON.stringify(visibility)); }
  }
  let name: string | null = null;
  if (value.displayName !== undefined) {
    const text = typeof value.displayName === "string" ? value.displayName.trim().replace(/\s+/g, " ").normalize("NFC") : "";
    if (text.length < 2 || text.length > 80 || /[<>\x00-\x1f]/.test(text)) errors.displayName = "Escribe un nombre de 2 a 80 caracteres.";
    else if (text !== row.name) { name = text; changed.push("Nombre"); }
  }
  if (value.contact !== undefined) {
    const contact = (value.contact || {}) as Record<string, unknown>, phone = phoneInput(contact.phone), email = contactEmailInput(contact.contactEmail);
    if (phone === undefined) errors["contact.phone"] = "Escribe un teléfono de 7 a 15 dígitos.";
    if (email === undefined) errors["contact.contactEmail"] = "Escribe un correo válido.";
    if (phone !== undefined && phone !== row.phone) { changed.push("Teléfono"); sets.push("phone=?"); values.push(phone); }
    if (email !== undefined && email !== row.contact_email) { changed.push("Correo de contacto"); sets.push("contact_email=?"); values.push(email); }
  }
  if (value.availability !== undefined) {
    const availability = availabilityInput(value.availability);
    if (!availability) errors.availability = "Revisa las franjas: inicio antes del fin y sin cruces el mismo día.";
    else if (JSON.stringify(availability) !== (row.availability || "[]")) { changed.push("Disponibilidad"); sets.push("availability=?"); values.push(JSON.stringify(availability)); }
  }
  if (value.education !== undefined) {
    const education = typeof value.education === "string" ? value.education.trim().normalize("NFC") : null;
    if (education === null || education.length > maxEducationLength || /[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(education)) errors.educationSummary = `El resumen de formación tiene hasta ${maxEducationLength} caracteres.`;
    else if (education !== (row.education || "")) { changed.push("Resumen de formación"); sets.push("education=?"); values.push(education); }
  }
  if (Object.keys(errors).length) return reply({ error: "Revisa los campos marcados del perfil.", errors }, 400);
  if (changed.length) {
    const statements: Prepared[] = [];
    if (name) statements.push(db.prepare("UPDATE users SET display_name=? WHERE id=?").bind(name, current.id));
    statements.push(db.prepare(`UPDATE staff_profiles SET ${[...sets, "updated_at=?"].join(",")} WHERE user_id=?`).bind(...values, now(), current.id));
    // Which sections changed, never their contents.
    statements.push(event(db, current, { action: "updated", targetType: "profile", targetId: current.id, summary: `Actualizó su perfil profesional: ${changed.join(", ")}` }));
    const saved = await db.guardedBatch(db.prepare("SELECT 1 FROM staff_profiles WHERE user_id=? AND draft_version=?").bind(current.id, row.draft_version || 0), statements);
    if (!saved) return reply({ error: "Tu perfil cambió en otra ventana. Recarga antes de guardar para no perder esos cambios.", code: "STALE" }, 409);
  }
  return reply({ profile: await myProfile(current, db), changed });
}

/** Moves the profile through ST-156's states and writes the version records and the activity in one transaction. */
async function transition(action: ProfileAction, actor: ProfileActor, targetId: string, input: unknown, current: Member, db: Database) {
  const row = await profileOf(db, targetId, current.organizationId);
  if (!row) return reply({ error: "Persona no disponible." }, 404);
  const versions = (await versionsOf(db, targetId)).results, open = versions.find(version => version.status === "in_review"), required = await reviewRequired(db, current.organizationId);
  const status = row.status || "draft", self = targetId === current.id;
  const next = profileTransition({ status, hiddenBy: row.hidden_by, openReview: !!open }, action, { actor, reviewRequired: required });
  if ("error" in next) return reply({ error: next.error }, 409);
  const at = now(), owner = self ? "su perfil" : `el perfil de ${row.name}`;
  // What the person sends is the working copy as read; decisions apply to the version in review, whatever the draft does meanwhile.
  const statements: Prepared[] = [], guard = action === "submit"
    ? db.prepare("SELECT 1 FROM staff_profiles WHERE user_id=? AND status=? AND draft_version=?").bind(targetId, status, row.draft_version || 0)
    : db.prepare("SELECT 1 FROM staff_profiles WHERE user_id=? AND status=?").bind(targetId, status);
  const setStatus = db.prepare("UPDATE staff_profiles SET status=?,hidden_by=?,status_changed_at=? WHERE user_id=?").bind(next.status, next.hiddenBy, at, targetId);
  if (action === "submit") {
    const draft = storedProfile(JSON.parse(row.draft || "{}")), gaps = submissionGaps(draft);
    if (gaps.length) return reply({ error: `Para enviar tu perfil falta ${gaps.join(", ")}.`, missing: gaps }, 400);
    const checked = professionalProfileInput(draft);
    if ("errors" in checked) return reply({ error: "Revisa los campos marcados del perfil antes de enviarlo.", errors: checked.errors }, 400);
    const published = versions.find(version => version.status === "published");
    if (open && open.draft_version === row.draft_version) return reply({ error: "Esta versión de tu perfil ya está en revisión." }, 409);
    if (published && !open && sameProfile(storedProfile(JSON.parse(published.content)), draft)) return reply({ error: "No hay cambios que enviar: tu perfil publicado ya es esta versión." }, 409);
    const version = (versions[0]?.version || 0) + 1, id = `profile-version-${crypto.randomUUID()}`;
    // A newer submission replaces the one in review.
    if (open) statements.push(db.prepare("UPDATE staff_profile_versions SET status='withdrawn' WHERE id=? AND status='in_review'").bind(open.id));
    if (next.publishes) {
      statements.push(db.prepare("UPDATE staff_profile_versions SET status='superseded' WHERE user_id=? AND status='published'").bind(targetId),
        db.prepare("INSERT INTO staff_profile_versions(id,organization_id,user_id,version,draft_version,content,status,submitted_by,submitted_at,decided_by,decided_at,published_at) VALUES (?,?,?,?,?,?,'published',?,?,?,?,?)")
          .bind(id, current.organizationId, targetId, version, row.draft_version || 0, JSON.stringify(draft), current.id, at, current.id, at, at),
        event(db, current, { action: "published", targetType: "profile", targetId, summary: `Publicó su perfil profesional (versión ${version})` }));
    } else {
      statements.push(db.prepare("INSERT INTO staff_profile_versions(id,organization_id,user_id,version,draft_version,content,status,submitted_by,submitted_at) VALUES (?,?,?,?,?,?,'in_review',?,?)")
        .bind(id, current.organizationId, targetId, version, row.draft_version || 0, JSON.stringify(draft), current.id, at),
        event(db, current, { action: "submitted", targetType: "profile", targetId, summary: `Envió su perfil profesional a revisión (versión ${version}${published ? `; cambia ${profileChanges(storedProfile(JSON.parse(published.content)), draft).join(", ")}` : ""})` }));
    }
  } else if (action === "approve") {
    statements.push(db.prepare("UPDATE staff_profile_versions SET status='superseded' WHERE user_id=? AND status='published'").bind(targetId),
      db.prepare("UPDATE staff_profile_versions SET status='published',decided_by=?,decided_at=?,published_at=? WHERE id=? AND status='in_review'").bind(current.id, at, at, open!.id),
      event(db, current, { action: "approved", targetType: "profile", targetId, summary: `Aprobó y publicó ${owner} (versión ${open!.version})` }));
  } else if (action === "request_changes") {
    const note = decisionNote((input as Input)?.note);
    if (!note) return reply({ error: "Explica qué cambiar, en 5 a 500 caracteres." }, 400);
    statements.push(db.prepare("UPDATE staff_profile_versions SET status='returned',decided_by=?,decided_at=?,decision_note=? WHERE id=? AND status='in_review'").bind(current.id, at, note, open!.id),
      event(db, current, { action: "returned", targetType: "profile", targetId, summary: `Pidió cambios en ${owner} (versión ${open!.version})` }));
  } else if (action === "hide") {
    statements.push(event(db, current, { action: "hidden", targetType: "profile", targetId, summary: `Ocultó ${owner}` }));
  } else if (action === "show") {
    statements.push(event(db, current, { action: "restored", targetType: "profile", targetId, summary: `Volvió a mostrar ${owner}` }));
  }
  statements.push(setStatus);
  if (!await db.guardedBatch(guard, statements)) return reply({ error: "El perfil cambió mientras tanto. Recarga y vuelve a intentar." }, 409);
  return reply({ status: next.status, ...(self ? { profile: await myProfile(current, db) } : {}) });
}

/**
 * ST-123 and deactivation: a person who leaves or loses access stops showing their profile and their first review
 * closes. Statements for the caller's batch, before the membership changes; the activity says it only when a
 * published profile was hidden.
 */
export function profileOnLeave(db: Database, current: Member, userId: string, name: string, reason: "departure" | "deactivation"): Prepared[] {
  const at = now();
  return [
    db.prepare("INSERT INTO activity_events(id,organization_id,actor_id,action,target_type,target_id,summary,occurred_at) SELECT ?,?,?,'hidden','profile',?,?,? WHERE EXISTS (SELECT 1 FROM staff_profiles WHERE user_id=? AND status='published')")
      .bind(`event-${crypto.randomUUID()}`, current.organizationId, current.id, userId, `Ocultó el perfil de ${name} por ${reason === "departure" ? "su salida" : "la desactivación de su cuenta"}`.slice(0, 240), at, userId),
    db.prepare("UPDATE staff_profile_versions SET status='withdrawn' WHERE user_id=? AND status='in_review'").bind(userId),
    // Every SET expression reads the row as it was, so hidden_by follows the previous status.
    db.prepare("UPDATE staff_profiles SET status=CASE status WHEN 'published' THEN 'hidden' WHEN 'hidden' THEN 'hidden' ELSE 'draft' END,hidden_by=CASE status WHEN 'published' THEN 'system' ELSE hidden_by END,status_changed_at=? WHERE user_id=? AND status<>'draft' AND NOT (status='hidden')")
      .bind(at, userId),
  ];
}

/** /api/me/credentials… — the person's credentials (ST-155). */
async function myCredentials(path: string, method: string, input: unknown, current: Member, db: Database) {
  const [, , , , id, step] = path.split("/"), today = await todayFor(db, current.organizationId);
  if (!id && method === "GET") return reply({ credentials: (await credentialsOf(db, current.id)).results.map(row => credentialView(row, today)) });
  const value = input as Input;
  const checkDocument = async (documentId: string | null) => !documentId || !!await db.prepare("SELECT 1 AS ok FROM staff_documents WHERE id=? AND user_id=? AND organization_id=? AND withdrawn_at IS NULL").bind(documentId, current.id, current.organizationId).first();
  if (!id) {
    const result = credentialInput(value, today);
    if ("errors" in result) return reply({ error: "Revisa los campos marcados de la credencial.", errors: result.errors }, 400);
    if (!await checkDocument(result.value.documentId)) return reply({ error: "Elige un documento vigente de tu expediente.", errors: { documentId: "Elige un documento vigente de tu expediente." } }, 400);
    const credentialId = `credential-${crypto.randomUUID()}`, at = now(), submit = value?.submit === true, c = result.value;
    const created = await db.guardedBatch(db.prepare("SELECT 1 WHERE (SELECT count(*) FROM staff_credentials WHERE user_id=? AND status<>'withdrawn')<?").bind(current.id, MAX_CREDENTIALS), [
      db.prepare("INSERT INTO staff_credentials(id,organization_id,user_id,type,name,issuer,country,issued_on,expires_on,credential_code,verification_url,document_id,status,submitted_at,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)")
        .bind(credentialId, current.organizationId, current.id, c.type, c.name, c.issuer, c.country, c.issuedOn, c.expiresOn, c.credentialCode, c.verificationUrl, c.documentId, submit ? "submitted" : "draft", submit ? at : null, at, at),
      // The type only: names, codes and links of credentials stay in the profile.
      event(db, current, { action: submit ? "submitted" : "created", targetType: "credential", targetId: credentialId, summary: submit ? `Envió a verificación una credencial: ${credentialTypeLabel(c.type)}` : `Agregó una credencial: ${credentialTypeLabel(c.type)}` }),
    ]);
    if (!created) return reply({ error: `Puedes tener hasta ${MAX_CREDENTIALS} credenciales vigentes.` }, 409);
    return reply({ credential: credentialView((await db.prepare(`SELECT ${credentialColumns} ${credentialFrom} WHERE c.id=?`).bind(credentialId).first<CredentialRow>())!, today) }, 201);
  }
  const row = await db.prepare(`SELECT ${credentialColumns} ${credentialFrom} WHERE c.id=? AND c.user_id=? AND c.organization_id=?`).bind(id, current.id, current.organizationId).first<CredentialRow>();
  if (!row) return reply({ error: "La credencial no está en tu perfil." }, 404);
  const at = now(), label = credentialTypeLabel(row.type);
  if (!step) {
    const result = credentialInput(value, today);
    if ("errors" in result) return reply({ error: "Revisa los campos marcados de la credencial.", errors: result.errors }, 400);
    if (!await checkDocument(result.value.documentId)) return reply({ error: "Elige un documento vigente de tu expediente.", errors: { documentId: "Elige un documento vigente de tu expediente." } }, 400);
    const next = credentialTransition(row.status, "edit", "self");
    if (typeof next !== "string") return reply({ error: next.error }, 409);
    const submit = value?.submit === true, c = result.value;
    const saved = await db.guardedBatch(db.prepare("SELECT 1 FROM staff_credentials WHERE id=? AND version=?").bind(id, Number.isInteger(value?.version) ? Number(value!.version) : -1), [
      db.prepare("UPDATE staff_credentials SET type=?,name=?,issuer=?,country=?,issued_on=?,expires_on=?,credential_code=?,verification_url=?,document_id=?,status=?,submitted_at=?,rejection_reason=NULL,decided_by=NULL,decided_at=NULL,version=version+1,updated_at=? WHERE id=?")
        .bind(c.type, c.name, c.issuer, c.country, c.issuedOn, c.expiresOn, c.credentialCode, c.verificationUrl, c.documentId, submit ? "submitted" : next, submit ? at : null, at, id),
      event(db, current, { action: submit ? "submitted" : "updated", targetType: "credential", targetId: id, summary: `${submit ? "Corrigió y envió a verificación" : row.status === "verified" ? "Editó (y volvió a borrador)" : "Editó"} una credencial: ${credentialTypeLabel(c.type)}` }),
    ]);
    if (!saved) return reply({ error: "La credencial cambió mientras tanto. Recarga antes de guardar." }, 409);
  } else {
    const next = credentialTransition(row.status, step === "submit" ? "submit" : "withdraw", "self");
    if (typeof next !== "string") return reply({ error: next.error }, 409);
    const saved = await db.guardedBatch(db.prepare("SELECT 1 FROM staff_credentials WHERE id=? AND status=?").bind(id, row.status), [
      db.prepare(`UPDATE staff_credentials SET status=?,${step === "submit" ? "submitted_at=?," : ""}version=version+1,updated_at=? WHERE id=?`).bind(next, ...(step === "submit" ? [at] : []), at, id),
      event(db, current, { action: step === "submit" ? "submitted" : "withdrawn", targetType: "credential", targetId: id, summary: `${step === "submit" ? "Envió a verificación" : "Retiró"} una credencial: ${label}` }),
    ]);
    if (!saved) return reply({ error: "La credencial cambió mientras tanto. Recarga y vuelve a intentar." }, 409);
  }
  return reply({ credential: credentialView((await db.prepare(`SELECT ${credentialColumns} ${credentialFrom} WHERE c.id=?`).bind(id).first<CredentialRow>())!, today) });
}

/** /api/members/:id/credentials[/:cid/(verify|reject)] — reviewers verify; the person reads their own. */
async function memberCredentials(parts: string[], method: string, input: unknown, current: Member, db: Database) {
  const [, , , userId, , credentialId, step] = parts, today = await todayFor(db, current.organizationId);
  if (!canReviewProfiles(current) && userId !== current.id) return reply({ error: "Solo administración consulta y verifica las credenciales." }, 403);
  const person = await profileOf(db, userId, current.organizationId);
  if (!person) return reply({ error: "Persona no disponible." }, 404);
  if (method === "GET") return reply({ credentials: (await credentialsOf(db, userId)).results.map(row => credentialView(row, today)) });
  if (!canReviewProfiles(current)) return reply({ error: "Solo administración verifica credenciales." }, 403);
  if (userId === current.id) return reply({ error: "Otra persona de administración verifica tus credenciales." }, 403);
  const row = await db.prepare(`SELECT ${credentialColumns} ${credentialFrom} WHERE c.id=? AND c.user_id=? AND c.organization_id=?`).bind(credentialId, userId, current.organizationId).first<CredentialRow>();
  if (!row) return reply({ error: "La credencial no está en este perfil." }, 404);
  const next = credentialTransition(row.status, step === "verify" ? "verify" : "reject", "admin");
  if (typeof next !== "string") return reply({ error: next.error }, 409);
  const reason = step === "reject" ? decisionNote((input as Input)?.reason) : null;
  if (step === "reject" && !reason) return reply({ error: "Explica el motivo del rechazo, en 5 a 500 caracteres." }, 400);
  const at = now();
  const saved = await db.guardedBatch(db.prepare("SELECT 1 FROM staff_credentials WHERE id=? AND status='submitted' AND version=?").bind(row.id, row.version), [
    db.prepare("UPDATE staff_credentials SET status=?,rejection_reason=?,decided_by=?,decided_at=?,version=version+1,updated_at=? WHERE id=?").bind(next, reason, current.id, at, at, row.id),
    event(db, current, { action: next === "verified" ? "verified" : "rejected", targetType: "credential", targetId: row.id, summary: `${next === "verified" ? "Verificó" : "Rechazó"} una credencial de ${person.name}: ${credentialTypeLabel(row.type)}` }),
  ]);
  if (!saved) return reply({ error: "La credencial cambió mientras tanto. Recarga y vuelve a intentar." }, 409);
  return reply({ credential: credentialView((await db.prepare(`SELECT ${credentialColumns} ${credentialFrom} WHERE c.id=?`).bind(row.id).first<CredentialRow>())!, today) });
}

/** GET /api/profile-reviews — «Perfiles por revisar» and «Credenciales por verificar», oldest first. */
async function reviewQueue(current: Member, db: Database) {
  if (!canReviewProfiles(current)) return reply({ error: "Solo administración revisa perfiles y credenciales." }, 403);
  const [open, published, credentials, required, today] = await Promise.all([
    db.prepare(`SELECT ${versionColumns},COALESCE(u.display_name,u.username) AS name,p.photo_sha256 FROM staff_profile_versions v JOIN users u ON u.id=v.user_id JOIN memberships m ON m.user_id=v.user_id AND m.organization_id=v.organization_id AND m.active=1 LEFT JOIN staff_profiles p ON p.user_id=v.user_id LEFT JOIN users d ON d.id=v.decided_by WHERE v.organization_id=? AND v.status='in_review' ORDER BY v.submitted_at,v.id`).bind(current.organizationId).all<VersionRow & { name: string; photo_sha256: string | null }>(),
    db.prepare("SELECT user_id,content FROM staff_profile_versions WHERE organization_id=? AND status='published'").bind(current.organizationId).all<{ user_id: string; content: string }>(),
    db.prepare(`SELECT ${credentialColumns},COALESCE(u.display_name,u.username) AS person ${credentialFrom} JOIN users u ON u.id=c.user_id JOIN memberships m ON m.user_id=c.user_id AND m.organization_id=c.organization_id AND m.active=1 WHERE c.organization_id=? AND c.status='submitted' ORDER BY c.submitted_at,c.id`).bind(current.organizationId).all<CredentialRow & { person: string }>(),
    reviewRequired(db, current.organizationId), todayFor(db, current.organizationId),
  ]);
  const profiles: ProfileReviewItem[] = open.results.map(row => {
    const content = storedProfile(JSON.parse(row.content)), before = published.results.find(item => item.user_id === row.user_id), previous = before ? storedProfile(JSON.parse(before.content)) : null;
    return { userId: row.user_id, name: row.name, photoUrl: teamPhoto(row), version: row.version, submittedAt: row.submitted_at, firstPublication: !previous, changes: profileChanges(previous, content), content, published: previous, missing: submissionGaps(content) };
  });
  const items: CredentialReviewItem[] = credentials.results.map(row => ({ userId: row.user_id, name: row.person, credential: credentialView(row, today) }));
  const queue: ProfileReviewQueue = { reviewRequired: required, profiles, credentials: items };
  return reply(queue);
}

type Published = ProfileRow & { content: string; version: number; published_at: string };
const publishedColumns = `${profileColumns},v.content,v.version,v.published_at`;
const publishedFrom = `${profileFrom} JOIN staff_profile_versions v ON v.user_id=u.id AND v.status='published'`;

/** A published profile for an audience: only its sections, verified credentials and, for the team, what the person shares. */
function publicView(row: Published, credentials: CredentialRow[], audience: "organization" | "learners", today: string, photoUrl: string | null): PublicProfile {
  const visibility = storedVisibility(JSON.parse(row.visibility || "{}")), view = audienceView(storedProfile(JSON.parse(row.content)), visibility, audience);
  const showCredentials = reaches(visibility, "credentials", audience);
  const verified = credentials.filter(item => item.user_id === row.user_id && item.status === "verified").map(item => publicCredential(item, today));
  return {
    userId: row.user_id, displayName: row.name, photoUrl, role: row.role === "admin" ? "admin" : "educator", audience, sections: view.sections, content: view.content,
    // Students see only credentials in force; the team also sees which ones expired.
    credentials: showCredentials ? verified.filter(item => audience === "organization" || item.status === "verified") : [],
    ...(audience === "organization" && visibility.availability === "organization" ? { availability: JSON.parse(row.availability || "[]") as StaffAvailabilitySlot[] } : {}),
    ...(audience === "organization" && visibility.contact === "organization" ? { contact: { phone: row.phone, contactEmail: row.contact_email } } : {}),
    version: row.version, publishedAt: row.published_at,
  };
}
const fold = (value: string) => value.normalize("NFD").replace(/\p{M}/gu, "").toLocaleLowerCase("es");

/** GET /api/profiles?q=&area=&level=&language=&modality= — the team directory: published profiles of active people. */
async function directory(url: URL, current: Member, db: Database) {
  const [rows, credentials, teams] = await Promise.all([
    db.prepare(`SELECT ${publishedColumns} ${publishedFrom} WHERE m.organization_id=? AND m.active=1 AND p.status='published' ORDER BY name`).bind(current.organizationId).all<Published>(),
    db.prepare("SELECT c.user_id,c.status,c.expires_on FROM staff_credentials c WHERE c.organization_id=? AND c.status='verified'").bind(current.organizationId).all<{ user_id: string; status: CredentialState; expires_on: string | null }>(),
    // TEAM-01: what each person teaches, from the course teams of the organization.
    db.prepare("SELECT m.user_id,c.title FROM course_members m JOIN courses c ON c.id=m.course_id AND c.organization_id=m.organization_id WHERE m.organization_id=? AND c.status='active' ORDER BY c.title").bind(current.organizationId).all<{ user_id: string; title: string }>(),
  ]);
  const today = await todayFor(db, current.organizationId);
  const q = fold(url.searchParams.get("q") || "").trim(), area = fold(url.searchParams.get("area") || ""), level = url.searchParams.get("level") || "", language = url.searchParams.get("language") || "", modality = url.searchParams.get("modality") || "";
  // Filters look only at what the team may see, so a private section never shows through a filter.
  const all: DirectoryEntry[] = rows.results.map(row => {
    const { content, sections } = audienceView(storedProfile(JSON.parse(row.content)), storedVisibility(JSON.parse(row.visibility || "{}")), "organization");
    return { userId: row.user_id, displayName: row.name, photoUrl: teamPhoto(row), headline: content.headline, country: content.country, areas: content.areas, levels: content.levels, languages: content.languages, modalities: content.modalities,
      verifiedCredentials: credentials.results.filter(item => item.user_id === row.user_id && credentialStatus(item.status, item.expires_on, today) === "verified").length,
      // Only when the person shows what they teach to the team: a private «teaching» section hides their courses too.
      courses: sections.includes("teaching") ? teams.results.filter(item => item.user_id === row.user_id).map(item => item.title) : [] };
  });
  const entries = all.filter(entry => (!q || fold([entry.displayName, entry.headline, ...entry.areas.map(item => item.label)].join(" ")).includes(q))
    && (!area || entry.areas.some(item => fold(item.label) === area || item.field === area))
    && (!level || entry.levels.includes(level as never))
    && (!language || entry.languages.some(item => item.code === language || item.code.startsWith(`${language}-`)))
    && (!modality || entry.modalities.includes(modality as never)));
  const count = <T,>(list: T[], key: (item: T) => string) => [...list.reduce((map, item) => map.set(key(item), (map.get(key(item)) || 0) + 1), new Map<string, number>())].map(([value, total]) => ({ value, total })).sort((a, b) => b.total - a.total || a.value.localeCompare(b.value, "es"));
  return reply({ entries, total: all.length, facets: {
    areas: count(all.flatMap(entry => entry.areas), item => item.label), languages: count(all.flatMap(entry => entry.languages), item => item.code.split("-")[0]),
    levels: count(all.flatMap(entry => entry.levels), item => item), modalities: count(all.flatMap(entry => entry.modalities), item => item),
  } });
}

/** GET /api/profiles/:id — the team page of one person: their published profile, as the team sees it. */
async function teamProfile(id: string, current: Member, db: Database) {
  const full = id === current.id || canReviewProfiles(current);
  const row = await db.prepare(`SELECT ${publishedColumns} ${publishedFrom} WHERE u.id=? AND m.organization_id=?`).bind(id, current.organizationId).first<Published>();
  if (!row || (!full && (row.status !== "published" || !row.active))) return reply({ error: "Este perfil no está publicado." }, 404);
  const [credentials, today] = await Promise.all([db.prepare(`SELECT ${credentialColumns} ${credentialFrom} WHERE c.user_id=? AND c.status='verified'`).bind(id).all<CredentialRow>(), todayFor(db, current.organizationId)]);
  // Everyone sees it as the team does; the person and the reviewers also see a hidden one, with its status and visibility.
  return reply({ profile: publicView(row, credentials.results, "organization", today, teamPhoto(row)), status: row.status, active: !!row.active, ...(full ? { visibility: storedVisibility(JSON.parse(row.visibility || "{}")) } : {}) });
}

/** ST-157: «Tu educador» in a section's student space — published profiles of its educators, learners' sections only. */
export async function learnerEducators(db: Database, groupId: string, organizationId: string): Promise<PublicProfile[]> {
  const rows = (await db.prepare(`SELECT ${publishedColumns} ${publishedFrom} JOIN section_educators se ON se.user_id=u.id AND se.group_id=? WHERE m.organization_id=? AND m.active=1 AND p.status='published' ORDER BY name`).bind(groupId, organizationId).all<Published>()).results;
  if (!rows.length) return [];
  const [credentials, today] = await Promise.all([db.prepare(`SELECT ${credentialColumns} ${credentialFrom} WHERE c.organization_id=? AND c.status='verified' AND c.user_id IN (${rows.map(() => "?").join(",")})`).bind(organizationId, ...rows.map(row => row.user_id)).all<CredentialRow>(), todayFor(db, organizationId)]);
  return rows.map(row => publicView(row, credentials.results, "learners", today, row.photo_sha256 ? `/api/student/educators/${row.user_id}/photo?v=${row.photo_sha256.slice(0, 12)}` : null));
}
/** GET /api/student/educators/:id/photo — the photo of an educator of the student's section with a published profile. */
export async function learnerEducatorPhoto(db: Database, groupId: string, organizationId: string, userId: string, bucket: R2Bucket) {
  const shown = await db.prepare("SELECT 1 AS ok FROM section_educators se JOIN staff_profiles p ON p.user_id=se.user_id AND p.status='published' JOIN memberships m ON m.user_id=se.user_id AND m.organization_id=? AND m.active=1 WHERE se.group_id=? AND se.user_id=?").bind(organizationId, groupId, userId).first();
  if (!shown) return reply({ error: "Esta foto no forma parte de tu sección." }, 404);
  return photoResponse(db, userId, organizationId, bucket);
}

const credentialPath = "credential-[a-z0-9-]+";
export const professionalPath = new RegExp(`^/api/(me/profile(/(submit|hide|show))?|me/credentials(/${credentialPath}(/(submit|withdraw))?)?|profile-reviews|profiles(/[a-z0-9-]+)?|organization/profile-review|members/[a-z0-9-]+/(profile/(approve|request-changes|hide|show)|credentials(/${credentialPath}/(verify|reject))?))$`);
export function professionalMethods(path: string): string[] | null {
  if (!professionalPath.test(path)) return null;
  if (path === "/api/me/profile") return ["GET", "PUT"];
  if (path === "/api/me/credentials") return ["GET", "POST"];
  if (/^\/api\/me\/credentials\/[a-z0-9-]+$/.test(path) || path === "/api/organization/profile-review") return ["PUT"];
  if (path === "/api/profile-reviews" || path.startsWith("/api/profiles") || path.endsWith("/credentials")) return ["GET"];
  return ["POST"];
}

export async function professional(path: string, method: string, input: unknown, url: URL, current: Member, db: Database): Promise<Response> {
  if (path === "/api/me/profile") {
    if (method === "PUT") return saveMine(input, current, db);
    const profile = await myProfile(current, db);
    return profile ? reply({ profile }) : reply({ error: "Tu cuenta no está disponible." }, 404);
  }
  if (path.startsWith("/api/me/profile/")) {
    await ensureRow(db, current.id, current.organizationId).run();
    return transition(path.split("/")[4] as ProfileAction, "self", current.id, input, current, db);
  }
  if (path.startsWith("/api/me/credentials")) return myCredentials(path, method, input, current, db);
  if (path === "/api/profile-reviews") return reviewQueue(current, db);
  if (path === "/api/profiles") return directory(url, current, db);
  if (path.startsWith("/api/profiles/")) return teamProfile(path.split("/")[3], current, db);
  if (path === "/api/organization/profile-review") {
    if (current.role !== "admin") return reply({ error: "Solo administración configura la revisión de perfiles." }, 403);
    const required = (input as Input)?.required;
    if (typeof required !== "boolean") return reply({ error: "Indica si los perfiles requieren revisión." }, 400);
    await db.batch([
      db.prepare("UPDATE organizations SET profile_review_required=? WHERE id=?").bind(required ? 1 : 0, current.organizationId),
      event(db, current, { action: "updated", targetType: "profile", targetId: current.organizationId, summary: required ? "Activó la revisión de perfiles antes de publicarlos" : "Desactivó la revisión de perfiles: se publican al enviarlos" }),
    ]);
    return reply({ reviewRequired: required });
  }
  const parts = path.split("/");
  if (parts[4] === "credentials") return memberCredentials(parts, method, input, current, db);
  // /api/members/:id/profile/(approve|request-changes|hide|show)
  if (!canReviewProfiles(current)) return reply({ error: "Solo administración revisa los perfiles." }, 403);
  if (parts[3] === current.id && (parts[5] === "approve" || parts[5] === "request-changes")) return reply({ error: "Otra persona de administración revisa tu perfil." }, 403);
  return transition(parts[5] === "request-changes" ? "request_changes" : parts[5] as ProfileAction, "admin", parts[3], input, current, db);
}
