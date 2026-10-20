import { Icon } from "./icons";

export type StepState = "done" | "current" | "todo";
export type StatusStep = { id: string; label: string; state: StepState };

/** Compact timeline of an object's states. The current step is the next action the person should take. */
export function StatusSteps({ label, steps }: { label: string; steps: StatusStep[] }) {
  return <ol className="status-steps" aria-label={label}>
    {steps.map(step => <li key={step.id} className={`status-step is-${step.state}`}>
      <span className="status-step-mark" aria-hidden="true">{step.state === "done" ? <Icon name="check" size={12}/> : null}</span>
      <span className="status-step-label">{step.label}{step.state === "current" ? <span className="sr-only"> (actual)</span> : step.state === "done" ? <span className="sr-only"> (hecho)</span> : ""}</span>
    </li>)}
  </ol>;
}
