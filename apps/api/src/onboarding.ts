import type { CourseRole, Member, OnboardingPerson, OnboardingState, PendingDocument } from "@happy-learners/contracts";
import { declareStep, missingSteps, nextStep, onboardingStatus, onboardingStepStates, pendingAgreement, pendingDocuments, profileGaps } from "@happy-learners/domain";
import type { OnboardingFacts, ProfileFacts } from "@happy-learners/domain";
import type { Database } from "./storage";
import { event } from "./team";

/**
 * Guided onboarding (ST-122).
 *   GET  /api/onboarding                 — the signed-in person: steps, next step, their courses and sections
 *   POST /api/onboarding/steps/:step     — the person marks `welcome`, `tour`, or leaves an optional `agreement` for later
 *   GET  /api/onboarding/people          — administration: each person's status and missing steps
 * The password, terms and privacy, profile and signed agreement are derived from the data, never declared.
 */
const reply = (value: unknown, status = 200) => Response.json(value, { status });

type Record = { userId: string; startedAt: string; welcomeAt: string | null; agreementSkippedAt: string | null; tourAt: string | null; completedAt: string | null };
const recordColumns = "o.user_id AS userId,o.started_at AS startedAt,o.welcome_at AS welcomeAt,o.agreement_skipped_at AS agreementSkippedAt,o.tour_at AS tourAt,o.completed_at AS completedAt";
type ProfileRow = { userId: string; phone: string | null; contactEmail: string | null; specialties: string };
const profileOf = (row: ProfileRow | undefined): ProfileFacts | null => row ? { phone: row.phone, contactEmail: row.contactEmail, specialties: JSON.parse(row.specialties) as string[] } : null;

/** New accounts start their onboarding in the same batch that creates them (POST /api/members, an accepted invitation). */
export function startOnboarding(db: Database, userId: string, organizationId: string, at: string) {
  return db.prepare("INSERT INTO onboarding(user_id,organization_id,started_at) VALUES (?,?,?)").bind(userId, organizationId, at);
}

/** Whether the signed-in person still has to go through the welcome; accounts without a record predate it. */
export async function onboardingPending(db: Database, current: Member): Promise<boolean> {
  return !!await db.prepare("SELECT 1 AS pending FROM onboarding WHERE user_id=? AND organization_id=? AND completed_at IS NULL").bind(current.id, current.organizationId).first();
}

/** Every fact the steps are derived from, for one person or for the whole organization. */
async function factsOf(db: Database, organizationId: string, userId?: string) {
  const one = userId ? " AND m.user_id=?" : "", ids = userId ? [userId] : [];
  const [people, published, accepted, profiles, teaching, records, organization, contracts] = await db.batch([
    db.prepare(`SELECT u.id,u.username,COALESCE(u.display_name,u.username) AS name,CASE m.role WHEN 'instructor' THEN 'educator' ELSE m.role END AS role,m.active,u.must_change_password AS temporary FROM users u JOIN memberships m ON m.user_id=u.id WHERE m.organization_id=?${one} ORDER BY name`).bind(organizationId, ...ids),
    db.prepare("SELECT id,kind,version,title FROM legal_documents WHERE organization_id=? AND status='published'").bind(organizationId),
    db.prepare(`SELECT a.user_id AS userId,a.document_id AS id FROM legal_acceptances a JOIN memberships m ON m.user_id=a.user_id WHERE a.organization_id=? AND a.withdrawn_at IS NULL${one}`).bind(organizationId, ...ids),
    db.prepare(`SELECT p.user_id AS userId,p.phone,p.contact_email AS contactEmail,p.specialties FROM staff_profiles p JOIN memberships m ON m.user_id=p.user_id WHERE p.organization_id=?${one}`).bind(organizationId, ...ids),
    db.prepare(`SELECT DISTINCT e.user_id AS userId FROM section_educators e JOIN course_groups g ON g.id=e.group_id AND g.status='active' JOIN courses c ON c.id=g.course_id AND c.status='active' JOIN memberships m ON m.user_id=e.user_id WHERE e.organization_id=?${one}`).bind(organizationId, ...ids),
    db.prepare(`SELECT ${recordColumns} FROM onboarding o JOIN memberships m ON m.user_id=o.user_id WHERE o.organization_id=?${one}`).bind(organizationId, ...ids),
    // DEC-046: where a contract is required, the agreement step is the contract: signed, or sent and waiting.
    db.prepare("SELECT contract_required AS required FROM organizations WHERE id=?").bind(organizationId),
    db.prepare(`SELECT c.user_id AS userId,c.id,c.title,c.status FROM contracts c JOIN memberships m ON m.user_id=c.user_id WHERE c.organization_id=? AND c.status IN ('sent','active','terminated')${one} ORDER BY c.created_at DESC`).bind(organizationId, ...ids),
  ]) as unknown as [{ id: string; username: string; name: string; role: "admin" | "educator"; active: number; temporary: number }[], PendingDocument[], { userId: string; id: string }[], ProfileRow[], { userId: string }[], Record[], { required: number }[], { userId: string; id: string; title: string; status: string }[]];
  const required = !!organization[0]?.required;
  const teaches = new Set(teaching.map(row => row.userId));
  return people.map(person => {
    const mine = accepted.filter(row => row.userId === person.id).map(row => row.id);
    const record = records.find(row => row.userId === person.id) || null;
    const agreement = required ? null : pendingAgreement(published, mine);
    const theirs = contracts.filter(row => row.userId === person.id);
    const waiting = theirs.find(row => row.status === "sent");
    const facts: OnboardingFacts = {
      role: person.role, temporaryPassword: !!person.temporary, legalPending: pendingDocuments(published, mine).length > 0,
      profile: profileOf(profiles.find(row => row.userId === person.id)),
      agreementPublished: required || published.some(item => item.kind === "volunteer"),
      agreementSigned: required ? theirs.some(row => row.status !== "sent") : !agreement, teaches: teaches.has(person.id),
      welcomeAt: record?.welcomeAt || null, agreementSkippedAt: record?.agreementSkippedAt || null, tourAt: record?.tourAt || null,
    };
    return { person, record, facts, agreement, contract: required && waiting ? { id: waiting.id, title: waiting.title } : null, steps: onboardingStepStates(facts) };
  });
}

async function stateOf(db: Database, current: Member): Promise<OnboardingState> {
  const [found] = await factsOf(db, current.organizationId, current.id);
  const [courses, sections] = await db.batch([
    db.prepare("SELECT c.id,c.title,cm.role FROM course_members cm JOIN courses c ON c.id=cm.course_id AND c.organization_id=cm.organization_id WHERE cm.user_id=? AND cm.organization_id=? AND c.status='active' ORDER BY c.title").bind(current.id, current.organizationId),
    db.prepare("SELECT g.id,g.name,c.id AS courseId,c.title AS courseTitle FROM section_educators e JOIN course_groups g ON g.id=e.group_id AND g.status='active' JOIN courses c ON c.id=g.course_id AND c.status='active' WHERE e.user_id=? AND e.organization_id=? ORDER BY c.title,g.name").bind(current.id, current.organizationId),
  ]) as unknown as [{ id: string; title: string; role: CourseRole }[], { id: string; name: string; courseId: string; courseTitle: string }[]];
  const { record, facts, steps } = found;
  const applies = steps.some(step => step.key === "agreement" && !step.done);
  return {
    status: onboardingStatus(record), startedAt: record?.startedAt || null, completedAt: record ? record.completedAt : null,
    steps, next: record && !record.completedAt ? nextStep(steps) : null, profileGaps: profileGaps(facts.role, facts.profile),
    agreement: applies ? found.agreement : null, contract: applies ? found.contract : null, courses, sections,
  };
}

const refusals = {
  unknown: [404, "Ese paso de la incorporación no existe."],
  derived: [409, "Este paso se completa con tus datos: cambia tu contraseña, acepta los documentos, guarda tu perfil o firma el acuerdo."],
  required: [409, "Impartes al menos una sección: firma tu contrato o el acuerdo de voluntariado para continuar."],
  order: [409, "Completa antes los pasos anteriores de la incorporación."],
} as const;

export async function onboarding(path: string, method: string, current: Member, db: Database): Promise<Response> {
  if (path === "/api/onboarding/people") {
    if (current.role !== "admin") return reply({ error: "Solo administración consulta la incorporación del equipo." }, 403);
    const people: OnboardingPerson[] = (await factsOf(db, current.organizationId)).map(({ person, record, steps }) => ({
      userId: person.id, name: person.name, username: person.username, role: person.role, active: !!person.active,
      status: onboardingStatus(record), startedAt: record?.startedAt || null, completedAt: record ? record.completedAt : null,
      steps, missing: record && !record.completedAt ? missingSteps(steps) : [],
    }));
    return reply({ people });
  }
  if (path === "/api/onboarding") return reply({ onboarding: await stateOf(db, current) });
  const step = path.split("/")[4];
  const [found] = await factsOf(db, current.organizationId, current.id);
  if (!found?.record || found.record.completedAt) return reply({ error: "Tu incorporación ya está completa." }, 409);
  const refused = declareStep(step, found.steps);
  if (refused) { const [status, error] = refusals[refused]; return reply({ error, code: `ONBOARDING_${refused.toUpperCase()}` }, status); }
  const now = new Date().toISOString(), column = step === "welcome" ? "welcome_at" : step === "agreement" ? "agreement_skipped_at" : "tour_at";
  // Finishing the introduction completes the onboarding: every step before it is done (checked above).
  const completes = step === "tour";
  await db.batch([
    // Never before the start: the Worker's clock may read a few milliseconds behind the one that started it.
    db.prepare(`UPDATE onboarding SET ${column}=COALESCE(${column},max(?,started_at))${completes ? ",completed_at=COALESCE(completed_at,max(?,started_at))" : ""} WHERE user_id=? AND organization_id=? AND completed_at IS NULL`)
      .bind(now, ...(completes ? [now] : []), current.id, current.organizationId),
    ...(completes ? [event(db, current, { action: "updated", targetType: "account", targetId: current.id, summary: "Completó su incorporación" })] : []),
  ]);
  return reply({ onboarding: await stateOf(db, current) });
}
