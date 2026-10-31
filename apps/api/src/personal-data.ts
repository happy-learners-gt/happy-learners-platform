import type { Member } from "@happy-learners/contracts";
import { personalDataFile, personalDataFormat, personalDataSections } from "@happy-learners/domain";
import type { Database } from "./storage";
import { event } from "./activity";
import { ownHours } from "./hours";

/**
 * ST-159: GET /api/me/export — «Exportar mis datos» as a JSON download with the person's own records only: their
 * account, profile, staff-file metadata, preferences, consents, signatures, hours, activity, security records and
 * closure requests. Never another person's contact data, never students, never secrets: no password hashes, no token
 * hashes, no file contents, no storage keys. Downloading it is recorded in the activity.
 * Released together in v1.1.1: the professional profile with its versions (ST-154, ST-156), the credentials (ST-155),
 * the regional, appearance and notification preferences with the bell (ST-160, ST-161) and the digests join here. Who
 * reviewed or verified (another person) is left out; the decision and its note are the person's own.
 */
const ms = (value: number) => new Date(value).toISOString();
const parse = (text: string | null, fallback: unknown) => { try { return text ? JSON.parse(text) : fallback; } catch { return fallback; } };

export async function exportMyData(current: Member, db: Database, tokenHash: string) {
  const id = current.id, org = current.organizationId, now = new Date();
  const [account, profile, documents, preferences, consents, signatures, activity, sessions, signIns, emailChanges, closures, notices, versions, credentials, regional, delivery, inbox] = await db.batch([
    db.prepare(`SELECT u.id,u.username,COALESCE(u.display_name,u.username) AS displayName,CASE m.role WHEN 'instructor' THEN 'educator' ELSE m.role END AS role,m.active,u.email,
      o.id AS organizationId,o.name AS organization,o.timezone FROM users u JOIN memberships m ON m.user_id=u.id AND m.organization_id=? JOIN organizations o ON o.id=m.organization_id WHERE u.id=?`).bind(org, id),
    db.prepare("SELECT phone,contact_email AS contactEmail,education,specialties,availability,photo_key IS NOT NULL AS hasPhoto,updated_at AS updatedAt,draft,visibility,status,draft_version AS draftVersion,hidden_by AS hiddenBy,status_changed_at AS statusChangedAt FROM staff_profiles WHERE user_id=? AND organization_id=?").bind(id, org),
    db.prepare("SELECT id,type,title,issued_on AS issuedOn,expires_on AS expiresOn,media_type AS mediaType,size_bytes AS sizeBytes,sha256,uploaded_at AS uploadedAt,uploaded_by=user_id AS selfUploaded FROM staff_documents WHERE user_id=? AND organization_id=? AND withdrawn_at IS NULL ORDER BY uploaded_at").bind(id, org),
    db.prepare("SELECT type,channel,enabled,updated_at AS updatedAt FROM notification_preferences WHERE user_id=? AND organization_id=? ORDER BY type,channel").bind(id, org),
    db.prepare("SELECT d.kind,d.version,d.title,a.accepted_at AS acceptedAt,a.withdrawn_at AS withdrawnAt FROM legal_acceptances a JOIN legal_documents d ON d.id=a.document_id WHERE a.user_id=? AND a.organization_id=? ORDER BY a.accepted_at").bind(id, org),
    db.prepare("SELECT s.id,d.kind,d.version,d.title,s.signed_name AS signedName,s.username,s.document_sha256 AS documentSha256,s.signature_sha256 AS signatureSha256,s.signed_at AS signedAt FROM legal_signatures s JOIN legal_documents d ON d.id=s.document_id WHERE s.user_id=? AND s.organization_id=? ORDER BY s.signed_at").bind(id, org),
    db.prepare("SELECT id,action,target_type AS targetType,target_id AS targetId,course_id AS courseId,group_id AS sectionId,summary,occurred_at AS occurredAt FROM activity_events WHERE actor_id=? AND organization_id=? ORDER BY occurred_at DESC,id LIMIT 5000").bind(id, org),
    db.prepare("SELECT id,device,country,method,created_at AS createdAt,last_used_at AS lastUsedAt,expires_at AS expiresAt,token_hash=? AS current FROM sessions WHERE user_id=? AND expires_at>? ORDER BY last_used_at DESC").bind(tokenHash, id, now.getTime()),
    db.prepare("SELECT outcome,method,device,country,occurred_at AS occurredAt FROM sign_in_events WHERE user_id=? AND organization_id=? ORDER BY occurred_at DESC").bind(id, org),
    db.prepare("SELECT previous_email AS previousEmail,new_email AS newEmail,CASE WHEN status='pending' AND expires_at<=? THEN 'expired' ELSE status END AS status,requested_at AS requestedAt,expires_at AS expiresAt,verified_at AS verifiedAt,cancelled_at AS cancelledAt FROM email_changes WHERE user_id=? AND organization_id=? ORDER BY requested_at").bind(now.toISOString(), id, org),
    db.prepare("SELECT c.status,c.reason,c.requested_at AS requestedAt,c.started_at AS startedAt,c.completed_at AS completedAt,c.cancelled_at AS cancelledAt FROM account_closures c WHERE c.user_id=? AND c.organization_id=? ORDER BY c.requested_at").bind(id, org),
    // The messages addressed to the person (their own address), without bodies: subject, reason and delivery.
    db.prepare("SELECT kind,notification_type AS type,subject,reason,status,created_at AS createdAt,sent_at AS sentAt FROM mail_outbox WHERE user_id=? AND organization_id=? AND kind IN ('notification','account','digest') ORDER BY created_at").bind(id, org),
    db.prepare("SELECT version,status,content,submitted_at AS submittedAt,decided_at AS decidedAt,decision_note AS decisionNote,published_at AS publishedAt FROM staff_profile_versions WHERE user_id=? AND organization_id=? ORDER BY version").bind(id, org),
    db.prepare(`SELECT id,type,name,issuer,country,issued_on AS issuedOn,expires_on AS expiresOn,credential_code AS credentialCode,verification_url AS verificationUrl,document_id AS documentId,status,
      rejection_reason AS rejectionReason,submitted_at AS submittedAt,decided_at AS decidedAt,created_at AS createdAt,updated_at AS updatedAt FROM staff_credentials WHERE user_id=? AND organization_id=? ORDER BY created_at`).bind(id, org),
    db.prepare("SELECT language,locale,timezone,week_start AS weekStart,hour_cycle AS hourCycle,home_page AS homePage,theme,text_scale AS textScale,high_contrast AS highContrast,motion,density,updated_at AS updatedAt FROM user_preferences WHERE user_id=? AND organization_id=?").bind(id, org),
    db.prepare("SELECT email_frequency AS frequency,digest_time AS digestTime,quiet_start AS quietStart,quiet_end AS quietEnd,updated_at AS updatedAt FROM notification_settings WHERE user_id=? AND organization_id=?").bind(id, org),
    db.prepare("SELECT type,reason,path,mandatory,created_at AS createdAt,read_at AS readAt FROM notification_inbox WHERE user_id=? AND organization_id=? ORDER BY created_at").bind(id, org),
  ]) as unknown as Record<string, unknown>[][];
  const person = account[0] as { username: string; active: number; organizationId: string; organization: string | null; timezone: string | null } & Record<string, unknown> | undefined;
  if (!person) return Response.json({ error: "Tu cuenta no está disponible." }, { status: 404 });
  const { rows: hours, timezone } = await ownHours(db, current);
  const own = profile[0] as Record<string, unknown> | undefined;
  const { organizationId, organization, timezone: organizationTimezone, ...identity } = person;
  const data = {
    format: personalDataFormat, generatedAt: now.toISOString(),
    sections: personalDataSections.map(({ key, label, description }) => ({ key, label, description })),
    account: { ...identity, active: !!person.active, organization: { id: organizationId, name: organization, timezone: organizationTimezone } },
    profile: own ? {
      ...own, specialties: parse(own.specialties as string, []), availability: parse(own.availability as string, []), hasPhoto: !!own.hasPhoto,
      draft: parse(own.draft as string, {}), visibility: parse(own.visibility as string, {}),
      versions: versions.map(row => ({ ...row, content: parse(row.content as string, {}) })),
    } : null,
    credentials: { staffDocuments: documents.map(row => ({ ...row, selfUploaded: !!row.selfUploaded })), credentials },
    preferences: {
      regional: regional[0] ? { ...regional[0], highContrast: !!regional[0].highContrast } : null, delivery: delivery[0] || null,
      notifications: preferences.map(row => ({ ...row, enabled: !!row.enabled })), inbox: inbox.map(row => ({ ...row, mandatory: !!row.mandatory })),
    },
    consents, signatures,
    hours: { timezone, minutes: hours.reduce((sum, row) => sum + row.minutes, 0), classes: hours.map(row => ({ courseTitle: row.courseTitle, sectionName: row.sectionName, day: row.day, startedAt: row.startedAt, completedAt: row.completedAt, minutes: row.minutes, state: row.state })) },
    activity,
    security: {
      sessions: sessions.map(row => ({ ...row, createdAt: ms(row.createdAt as number), lastUsedAt: ms(row.lastUsedAt as number), expiresAt: ms(row.expiresAt as number), current: !!row.current })),
      signIns, emailChanges, notices,
    },
    closures,
  };
  await event(db, current, { action: "recorded", targetType: "account", targetId: current.id, summary: "Descargó una copia de sus datos" }).run();
  return new Response(JSON.stringify(data, null, 2), { headers: { "Content-Type": "application/json; charset=utf-8", "Content-Disposition": `attachment; filename="${personalDataFile(person.username, now.toISOString().slice(0, 10))}"` } });
}
