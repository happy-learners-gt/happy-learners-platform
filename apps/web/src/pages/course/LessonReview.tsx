import { useEffect, useState } from "react";
import type { ClassGroup, Lesson, SequenceTemplate } from "@happy-learners/contracts";
import { classMinutesOf, lessonReview } from "@happy-learners/domain";
import type { LessonReview as Review, ReviewContext, ReviewStatus } from "@happy-learners/domain";
import { api } from "../../api";
import { Drawer } from "../../ui/feedback";
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

export function ReviewPanel({ review, onClose, onGoTo }: { review: Review; onClose: () => void; onGoTo: (activityId: string) => void }) {
  const failing = review.checks.filter(item => item.status === "fail" || item.status === "partial");
  return <Drawer title="Revisión de la lección" onClose={onClose}>
    <div className={`review-score is-${review.level}`}>
      <strong>{review.score}</strong><span>de 100 · calidad {levelLabel[review.level].toLowerCase()}</span>
    </div>
    <p className="muted">{failing.length ? `${failing.length} ${failing.length === 1 ? "criterio por mejorar" : "criterios por mejorar"}. ` : "Cumple todos los criterios que aplican. "}
      El puntaje sale de reglas fijas: la misma lección siempre obtiene el mismo resultado.</p>
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
