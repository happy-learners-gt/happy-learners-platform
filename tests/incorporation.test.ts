import { expect, it } from "vitest";
import type { OnboardingPerson } from "@happy-learners/contracts";
import { incorporationSteps } from "@happy-learners/domain";

const onboarding = (status: OnboardingPerson["status"]): OnboardingPerson => ({ userId: "u", name: "Ana", username: "ana", role: "educator", active: true, status, startedAt: null, completedAt: null, steps: [], missing: [] });
const base = { role: "educator" as const, onboarding: onboarding("complete"), profilePending: false, contract: "in-force" as const, leads: 1, coTeaches: 1, sections: 2 };

it("PPL-01 an educator ready to teach has every step done and nothing to act on", () => {
  const steps = incorporationSteps(base);
  expect(steps.map(step => [step.id, step.done, step.action])).toEqual([["welcome", true, null], ["profile", true, null], ["contract", true, null], ["team", true, null], ["sections", true, null]]);
  expect(steps.find(step => step.id === "team")!.detail).toBe("responsable de 1 curso · colabora en 1 curso");
});

it("PPL-01 offers the next action for what administration can do, and waits on the person otherwise", () => {
  const steps = incorporationSteps({ ...base, onboarding: onboarding("in_progress"), profilePending: true, contract: null, leads: 0, coTeaches: 0, sections: 0 });
  expect(steps.map(step => [step.id, step.done, step.action])).toEqual([["welcome", false, null], ["profile", false, "review-profile"], ["contract", false, "create-contract"], ["team", false, "open-courses"], ["sections", false, "open-courses"]]);
  // A contract sent and not signed yet waits on the person: no second contract is offered.
  expect(incorporationSteps({ ...base, contract: "awaiting-signature" }).find(step => step.id === "contract")).toMatchObject({ done: false, action: null, detail: "Esperando su firma" });
  // An expired contract counts as none.
  expect(incorporationSteps({ ...base, contract: "expired" }).find(step => step.id === "contract")).toMatchObject({ done: false, action: "create-contract" });
  expect(incorporationSteps({ ...base, contract: "scheduled" }).find(step => step.id === "contract")).toMatchObject({ done: true, detail: "Firmado, empieza después" });
});

it("PPL-01 administration only goes through the welcome and the profile", () => {
  expect(incorporationSteps({ ...base, role: "admin", contract: null, leads: 0, coTeaches: 0, sections: 0 }).map(step => step.id)).toEqual(["welcome", "profile"]);
});
