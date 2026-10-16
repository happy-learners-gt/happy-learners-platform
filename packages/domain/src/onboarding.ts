import type { OnboardingPersonStatus, OnboardingStep, OnboardingStepState } from "@happy-learners/contracts";

/**
 * Guided onboarding on the first sign-in (ST-122). Pure rules: which steps a person goes through, which ones count as
 * done, which can be left for later, what comes next and how administration reads the result.
 *
 * Order: own password (ST-093) → terms and privacy, signed (ST-126, ST-127, ST-153) → welcome (what the role can do)
 * → profile → volunteer agreement (ST-151, educators only, while one is published) → introduction to their courses and
 * sections. The first two are gates of their own before the welcome opens.
 */
export const onboardingSteps: readonly OnboardingStep[] = ["password", "legal", "welcome", "profile", "agreement", "tour"];
export const onboardingStepLabels: Record<OnboardingStep, string> = {
  password: "Contraseña propia",
  legal: "Términos y privacidad",
  welcome: "Qué puedes hacer",
  profile: "Perfil completo",
  agreement: "Acuerdo de voluntariado",
  tour: "Tus cursos y secciones",
};
/** Steps the person marks by doing them in the welcome; every other one is derived from the real data. */
export const declaredSteps: readonly OnboardingStep[] = ["welcome", "agreement", "tour"];
export const onboardingStatusLabels: Record<OnboardingPersonStatus, string> = { pending: "Pendiente", in_progress: "En curso", complete: "Completa" };

export interface ProfileFacts { phone: string | null; contactEmail: string | null; specialties: readonly string[] }
/**
 * «Perfil completo» (ST-122): the name (always present), a way to reach the person — a phone or a contact e-mail — and,
 * for educators, at least one specialty. Photo, education and availability are optional.
 */
export function profileComplete(role: "admin" | "educator", profile: ProfileFacts | null): boolean {
  if (!profile) return false;
  const contact = !!profile.phone?.trim() || !!profile.contactEmail?.trim();
  return contact && (role === "admin" || profile.specialties.some(item => item.trim().length > 0));
}
/** What is missing for the profile to count as complete, as the person reads it. */
export function profileGaps(role: "admin" | "educator", profile: ProfileFacts | null): string[] {
  const gaps: string[] = [];
  if (!profile?.phone?.trim() && !profile?.contactEmail?.trim()) gaps.push("Un teléfono o un correo de contacto");
  if (role === "educator" && !profile?.specialties.some(item => item.trim().length > 0)) gaps.push("Al menos una especialidad");
  return gaps;
}

export interface OnboardingFacts {
  role: "admin" | "educator";
  /** The account still signs in with a temporary password. */
  temporaryPassword: boolean;
  /** Terms or privacy versions in force not yet accepted. */
  legalPending: boolean;
  profile: ProfileFacts | null;
  /** A volunteer agreement is published in the organization. */
  agreementPublished: boolean;
  /** The person signed the volunteer agreement in force. */
  agreementSigned: boolean;
  /** The person teaches at least one active section: then the agreement is required before going on. */
  teaches: boolean;
  welcomeAt: string | null;
  agreementSkippedAt: string | null;
  tourAt: string | null;
}

/**
 * Every applicable step with whether it is done. The volunteer agreement applies to educators while one is published;
 * it is optional (it can be signed later from the banner) unless the person already teaches a section, since teaching
 * waits for it anyway.
 */
export function onboardingStepStates(facts: OnboardingFacts): OnboardingStepState[] {
  const steps: OnboardingStepState[] = [
    { key: "password", label: onboardingStepLabels.password, done: !facts.temporaryPassword, optional: false },
    { key: "legal", label: onboardingStepLabels.legal, done: !facts.legalPending, optional: false },
    { key: "welcome", label: onboardingStepLabels.welcome, done: !!facts.welcomeAt, optional: false },
    { key: "profile", label: onboardingStepLabels.profile, done: profileComplete(facts.role, facts.profile), optional: false },
  ];
  if (facts.role === "educator" && facts.agreementPublished) {
    const optional = !facts.teaches;
    steps.push({ key: "agreement", label: onboardingStepLabels.agreement, done: facts.agreementSigned || (optional && !!facts.agreementSkippedAt), optional, ...(facts.agreementSigned ? {} : optional && facts.agreementSkippedAt ? { skipped: true } : {}) });
  }
  steps.push({ key: "tour", label: onboardingStepLabels.tour, done: !!facts.tourAt, optional: false });
  return steps;
}
/** The first step not done yet, or null when all are. */
export const nextStep = (steps: readonly OnboardingStepState[]): OnboardingStep | null => steps.find(step => !step.done)?.key || null;
/** The steps still missing, in order. */
export const missingSteps = (steps: readonly OnboardingStepState[]): OnboardingStep[] => steps.filter(step => !step.done).map(step => step.key);

export type StepRefusal = "unknown" | "derived" | "required" | "order";
/**
 * Whether the person may mark `step` now. Derived steps are refused: they are done by changing the password, accepting
 * the documents, saving the profile or signing. The agreement is only "left for later" while optional. Each declared
 * step needs the steps before it: the welcome after the gates, the introduction after everything else.
 */
export function declareStep(step: string, steps: readonly OnboardingStepState[]): StepRefusal | null {
  if (!(onboardingSteps as readonly string[]).includes(step)) return "unknown";
  if (!(declaredSteps as readonly string[]).includes(step)) return "derived";
  const index = steps.findIndex(item => item.key === step);
  if (index < 0) return "unknown";
  if (step === "agreement" && !steps[index].optional) return "required";
  if (steps.slice(0, index).some(item => !item.done)) return "order";
  return null;
}

/**
 * How administration reads a person's onboarding: complete once it was completed (or the account predates it);
 * pending while the person has not opened the welcome yet; in progress in between.
 */
export function onboardingStatus(record: { completedAt: string | null; welcomeAt: string | null } | null): OnboardingPersonStatus {
  if (!record || record.completedAt) return "complete";
  return record.welcomeAt ? "in_progress" : "pending";
}
