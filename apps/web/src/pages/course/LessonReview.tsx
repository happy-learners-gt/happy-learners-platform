import { useEffect, useRef, useState } from "react";
import type { ClassGroup, Lesson, SequenceTemplate } from "@happy-learners/contracts";
import { classMinutesOf, lessonReview } from "@happy-learners/domain";
import type { ImproveChange, LessonReview as Review, ReviewContext, ReviewStatus } from "@happy-learners/domain";
import { api, message } from "../../api";
import { reportAiOutcome } from "../../ui/ai-outcome";
import { Drawer, useFeedback } from "../../ui/feedback";
import { Icon } from "../../ui/icons";
import type { CourseResource } from "./course-resource";

/**
 * Lesson review with a fact-based score (1.4.0, docs/design/asistente-ia.md §6b): the panel in the lesson editor and
 * the chip in Contenido. The score is computed in the browser from the domain function; nothing is stored.
 */
export type ReviewBasis = Omit<ReviewContext, "sequence">;

/** What a course's reviews need besides the lesson: its outcomes, whether it has indexed resources, its class length. */
export function useReviewBasis(courseId: string, courseOutcomes: number): ReviewBasis | null {
  const [basis, setBasis] = useState<Omit<ReviewBasis, "courseOutcomes"> | null>(null);
  useEffect(() => {
    let live = true;
    void Promise.all([
      api<{ groups: ClassGroup[] }>(`/courses/${courseId}/groups`).catch(() => ({ groups: [] as ClassGroup[] })),
      api<{ resources: CourseResource[] }>(`/courses/${courseId}/resources`).catch(() => ({ resources: [] as CourseResource[] })),
    ]).then(([groups, resources]) => {
      // An answer without its list counts as empty: the review still works, with what does not apply left out.
      if (live) setBasis({ classMinutes: classMinutesOf(groups.groups || []), indexedResources: (resources.resources || []).some(item => item.status !== "archived" && item.indexState === "mapped") });
    }, () => { if (live) setBasis({ classMinutes: null, indexedResources: false }); });
    return () => { live = false; };
  }, [courseId]);
  return basis && { ...basis, courseOutcomes };
}

export function reviewOf(lesson: Pick<Lesson, "objective" | "outcomeIds" | "materials" | "activities"> & { sequence?: SequenceTemplate }, basis: ReviewBasis): Review {
  return lessonReview({ objective: lesson.objective || "", outcomeIds: lesson.outcomeIds, materials: lesson.materials, activities: lesson.activities || [] }, { ...basis, sequence: lesson.sequence });
}

const levelLabel = { good: "Buena", fair: "Mejorable", poor: "Baja" } as const;
/** The score as a chip: green from 80, amber from 60, red below. */
export function QualityChip({ review }: { review: Review }) {
  return <span className={`review-chip is-${review.level}`} title={`Calidad ${levelLabel[review.level].toLowerCase()}: ${review.score} de 100`}>
    <span className="sr-only">Calidad </span>{review.score}
  </span>;
}

const statusText: Record<ReviewStatus, string> = { pass: "Cumple", partial: "Cumple en parte", fail: "No cumple", "n/a": "No aplica" };
const statusIcon: Record<ReviewStatus, "check" | "alert" | "info"> = { pass: "check", partial: "alert", fail: "alert", "n/a": "info" };

const fieldLabels: Record<NonNullable<ImproveChange["field"]>, string> = { objective: "Objetivo", title: "Título", instructions: "Instrucciones", minutes: "Minutos", purpose: "Propósito", grouping: "Agrupación", phase: "Momento" };
const valueLabels: Record<string, string> = { explain: "Explicar", explore: "Explorar", practice: "Practicar", assess: "Evaluar", reflect: "Reflexionar", individual: "Individual", pairs: "En parejas", teams: "En equipos", "whole-class": "Toda la clase" };
const shown = (value: string) => valueLabels[value] || value;
function changeTitle(change: ImproveChange) {
  if (change.kind === "objective") return "Objetivo de la lección";
  if (change.kind === "new-activity") return "Nueva actividad";
  return `${change.activityTitle ? `«${change.activityTitle}»` : "Actividad"} · ${fieldLabels[change.field!]}`;
}

/** The improvement as a draft: each change with what it replaces, accepted or discarded one by one (1.4.1). */
type ImproveLoad = () => Promise<{ changes: ImproveChange[]; runId?: string }>;
function ImproveDraft({ load, apply }: { load: ImproveLoad; apply: (changes: ImproveChange[]) => void }) {
  const { toast } = useFeedback();
  const [changes, setChanges] = useState<ImproveChange[] | null>(null), [busy, setBusy] = useState(false), [error, setError] = useState("");
  // AIG-4: the answer being decided; reported once every change it proposed is accepted or discarded.
  const round = useRef<{ runId?: string; proposed: number; accepted: number } | null>(null);
  function decide(picked: ImproveChange[], accepted: boolean) {
    const left = (changes || []).filter(change => !picked.includes(change));
    if (round.current) {
      if (accepted) round.current.accepted += picked.length;
      if (!left.length) { reportAiOutcome(round.current.runId, round.current.proposed, round.current.accepted); round.current = null; }
    }
    setChanges(left);
  }
  async function ask() {
    setBusy(true); setError("");
    try {
      const { changes: proposed, runId } = await load();
      round.current = proposed.length ? { runId, proposed: proposed.length, accepted: 0 } : null;
      setChanges(proposed); if (!proposed.length) toast({ message: "La IA no encontró cambios que proponer." });
    }
    catch (cause) { setError(message(cause)); }
    finally { setBusy(false); }
  }
  const accept = (picked: ImproveChange[]) => { apply(picked); decide(picked, true); toast({ message: picked.length === 1 ? "Cambio aplicado al borrador." : `${picked.length} cambios aplicados al borrador.` }); };
  return <section className="improve-draft" aria-label="Mejora con IA">
    <header>
      <div><strong>Mejorar con IA</strong><p className="muted small">Propone cambios para lo que falla. Nada cambia hasta que aceptas; lo aceptado entra en el borrador.</p></div>
      {!changes?.length && <button type="button" className="button secondary" disabled={busy} onClick={() => void ask()}><Icon name="sparkles" size={16}/>{busy ? "Pensando…" : changes ? "Proponer de nuevo" : "Proponer mejoras"}</button>}
    </header>
    {error && <p className="field-error" role="alert">{error}</p>}
    {changes && changes.length > 0 && <>
      <ol className="improve-changes">{changes.map(change => <li key={change.id}>
        <strong>{changeTitle(change)}</strong>
        {change.kind !== "new-activity" && <p className="improve-before"><span className="sr-only">Antes: </span>{change.before ? shown(change.before) : <em>vacío</em>}</p>}
        <p className="improve-after"><span className="sr-only">Después: </span>{change.activity ? <>{change.activity.title} · {change.activity.minutes} min · {shown(change.activity.purpose)} · {shown(change.activity.grouping)}<br/>{change.activity.instructions}</> : shown(change.after)}</p>
        {change.reason && <p className="muted small">{change.reason}</p>}
        <div className="improve-actions">
          <button type="button" className="button primary small" onClick={() => accept([change])}>Aceptar<span className="sr-only"> {changeTitle(change)}</span></button>
          <button type="button" className="button ghost small" onClick={() => decide([change], false)}>Descartar<span className="sr-only"> {changeTitle(change)}</span></button>
        </div>
      </li>)}</ol>
      <div className="improve-all"><button type="button" className="button secondary" onClick={() => accept(changes)}>Aceptar todo ({changes.length})</button></div>
    </>}
  </section>;
}

export function ReviewPanel({ review, onClose, onGoTo, improve }: { review: Review; onClose: () => void; onGoTo: (activityId: string) => void; improve?: { load: ImproveLoad; apply: (changes: ImproveChange[]) => void } }) {
  const failing = review.checks.filter(item => item.status === "fail" || item.status === "partial");
  return <Drawer title="Revisión de la lección" onClose={onClose} wide={!!improve}>
    <div className={`review-score is-${review.level}`}>
      <strong>{review.score}</strong><span>de 100 · calidad {levelLabel[review.level].toLowerCase()}</span>
    </div>
    <p className="muted">{failing.length ? `${failing.length} ${failing.length === 1 ? "criterio por mejorar" : "criterios por mejorar"}. ` : "Cumple todos los criterios que aplican. "}
      El puntaje sale de reglas fijas: la misma lección siempre obtiene el mismo resultado.</p>
    {improve && failing.length > 0 && <ImproveDraft load={improve.load} apply={improve.apply}/>}
    <ol className="review-checks">{review.checks.map(item => <li key={item.id} className={`is-${item.status === "n/a" ? "na" : item.status}`}>
      <header>
        <Icon name={statusIcon[item.status]} size={18}/>
        <strong>{item.label}</strong>
        <span className="review-status">{statusText[item.status]}{item.status !== "n/a" && ` · ${item.weight} pts`}</span>
      </header>
      {item.suggestion && <p>{item.suggestion}</p>}
      <ul className="review-evidence">{item.evidence.map((evidence, index) => <li key={index}>
        {evidence.activityId && item.status !== "pass"
          ? <button type="button" className="link-button" onClick={() => onGoTo(evidence.activityId!)}>{evidence.text}</button>
          : evidence.text}
      </li>)}</ul>
    </li>)}</ol>
  </Drawer>;
}
