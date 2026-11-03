import type { ContractPhase, OnboardingPerson } from "@happy-learners/contracts";

/**
 * What administration still has to do so a person can teach (PPL-01, docs/design/incorporacion-institucional.md),
 * from what Educadores already loads. Administration's own accounts only go through the welcome and the profile.
 */
export type IncorporationStepId = "welcome" | "profile" | "contract" | "team" | "sections";
export type IncorporationAction = "review-profile" | "create-contract" | "open-courses";
export interface IncorporationStep { id: IncorporationStepId; label: string; done: boolean; detail: string; action: IncorporationAction | null }
export interface IncorporationInput {
  role: "admin" | "educator"; onboarding: OnboardingPerson | undefined; profilePending: boolean;
  contract: ContractPhase | null; leads: number; coTeaches: number; sections: number;
}

const signed: ContractPhase[] = ["in-force", "ending", "scheduled"];
const plural = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`;

export function incorporationSteps(input: IncorporationInput): IncorporationStep[] {
  const welcome = input.onboarding?.status === "complete";
  const steps: IncorporationStep[] = [
    { id: "welcome", label: "Bienvenida", done: welcome, action: null,
      detail: welcome ? "Completa" : input.onboarding?.status === "in_progress" ? "Esperando a la persona: la empezó" : "Esperando a la persona" },
    { id: "profile", label: "Perfil revisado", done: !input.profilePending, action: input.profilePending ? "review-profile" : null,
      detail: input.profilePending ? "Tiene una versión esperando aprobación" : "Sin cambios por revisar" },
  ];
  if (input.role === "admin") return steps;
  const contract = !!input.contract && signed.includes(input.contract), awaiting = input.contract === "awaiting-signature";
  const courses = input.leads + input.coTeaches;
  steps.push(
    { id: "contract", label: "Contrato", done: contract, action: contract || awaiting ? null : "create-contract",
      detail: contract ? input.contract === "scheduled" ? "Firmado, empieza después" : "Vigente" : awaiting ? "Esperando su firma" : input.contract === "draft" ? "En borrador" : "Sin contrato vigente" },
    { id: "team", label: "Equipo de un curso", done: courses > 0, action: courses > 0 ? null : "open-courses",
      detail: courses ? [input.leads ? `responsable de ${plural(input.leads, "curso", "cursos")}` : "", input.coTeaches ? `colabora en ${plural(input.coTeaches, "curso", "cursos")}` : ""].filter(Boolean).join(" · ") : "En ningún equipo" },
    { id: "sections", label: "Secciones", done: input.sections > 0, action: input.sections > 0 ? null : "open-courses",
      detail: input.sections ? `Imparte ${plural(input.sections, "sección", "secciones")}` : "No imparte secciones" },
  );
  return steps;
}
