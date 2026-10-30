import type { ReactNode } from "react";
import { createPortal } from "react-dom";
import { freedomPolicies, freedomPolicyLabel, policyChange } from "@happy-learners/domain";
import type { FreedomPolicy } from "@happy-learners/domain";
import { Modal } from "./feedback";

const copy: Record<FreedomPolicy, string> = {
  shared: "Todas las secciones siguen el mismo contenido, en el mismo orden, y el mismo plan de evaluación.",
  flexible: "Lo marcado como núcleo es obligatorio. Cada sección puede agregar lecciones y actividades propias, reordenar y ocultar lo que no es núcleo.",
  free: "Como la anterior y, además, una sección puede reemplazar una actividad de evaluación del núcleo por otra de la misma categoría y con los mismos puntos. Los resultados de aprendizaje del núcleo siguen siendo obligatorios.",
};

export type FreedomMark = "core" | "own" | "hidden" | "replaces";

/** The same chip on every screen: Núcleo, Propia de la sección, Oculta en esta sección, Reemplaza a «…». */
export function FreedomChip({ mark, replaced }: { mark: FreedomMark; replaced?: string | null }) {
  const text = mark === "core" ? "Núcleo" : mark === "own" ? "Propia de la sección" : mark === "hidden" ? "Oculta en esta sección" : `Reemplaza a «${replaced || "…"}»`;
  return <span className={`freedom-chip freedom-chip-${mark === "replaces" ? "own" : mark}`}>{mark === "core" && <span className="freedom-lock" aria-hidden="true">🔒</span>}{text}</span>;
}

/** Radios for «Libertad de cátedra». The parent confirms the change before the value moves. */
export function FreedomPolicyField({ value, disabled, lockedBy, name, onChoose }: { value: FreedomPolicy; disabled?: boolean; lockedBy?: string; name: string; onChoose: (next: FreedomPolicy) => void }) {
  return <fieldset className="freedom-policy" disabled={disabled}>
    <legend>Libertad de cátedra</legend>
    {freedomPolicies.map(policy => <label key={policy} className="freedom-choice">
      <input type="radio" name={name} value={policy} checked={value === policy} onChange={() => value !== policy && onChoose(policy)}/>
      <span><strong>{freedomPolicyLabel[policy]}</strong><small>{copy[policy]}</small></span>
    </label>)}
    {lockedBy && <p className="freedom-locked">Fijado por el programa «{lockedBy}»</p>}
  </fieldset>;
}

/** What the change will do. Stays open when notes block it and lists the sections and activities. */
export function FreedomChangeDialog({ from, to, blocked, busy, onClose, onConfirm }: {
  from: FreedomPolicy; to: FreedomPolicy; blocked: { message: string; affected: { section: string; activity: string }[] } | null; busy: boolean; onClose: () => void; onConfirm: () => void;
}) {
  const preview = policyChange(from, to, []);
  const message = blocked?.message || (preview.ok ? preview.message : preview.message);
  return createPortal(<Modal title={`¿Cambiar a «${freedomPolicyLabel[to]}»?`} onClose={onClose} footer={<>
    <button type="button" className="button secondary" onClick={onClose}>{blocked ? "Entendido" : "Cancelar"}</button>
    {!blocked && <button type="button" className="button primary" disabled={busy} onClick={onConfirm}>{busy ? "Guardando…" : "Cambiar política"}</button>}
  </>}>
    <p>{message}</p>
    {blocked && blocked.affected.length > 0 && <ul className="freedom-list">{blocked.affected.map(item => <li key={`${item.section}:${item.activity}`}>{item.section} · {item.activity}</li>)}</ul>}
  </Modal>, document.body);
}

export function FreedomMarks({ mark, replaced }: { mark?: FreedomMark | null; replaced?: string | null }): ReactNode {
  if (!mark) return null;
  return <FreedomChip mark={mark} replaced={replaced}/>;
}
