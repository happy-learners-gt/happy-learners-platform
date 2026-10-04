import { useEffect, useState } from "react";
import type { LessonAssignment } from "@happy-learners/contracts";
import { api, message } from "../api";
import { Link } from "../navigation";
import { sessionDay } from "../model";
import { Icon } from "./icons";
import { EmptyState, ErrorState, Skeleton, StatusBadge } from "./primitives";

/** Opens what the group receives today: the current publication, never a draft (ST-029). */
export function OpenPublication({ assignment, className = "button secondary small" }: { assignment: LessonAssignment; className?: string }) {
  if (!assignment.effective) return null;
  return <a className={className} href={`/aprender/${encodeURIComponent(assignment.effective.shareCode)}`} target="_blank" rel="noopener"
    aria-label={`Abrir «${assignment.lessonTitle}», publicación ${assignment.effective.revision}`}>
    <Icon name="play" size={16}/>Abrir lección · publicación {assignment.effective.revision}
  </a>;
}

/** A lesson published before sharing existed has no link yet; saving and publishing it again creates one. */
export function MissingLink({ assignment }: { assignment: LessonAssignment }) {
  return <p className="assignment-note"><Icon name="info" size={16}/>Esta publicación aún no tiene enlace para estudiantes. <Link href={`/cursos/${assignment.courseId}/lecciones/${assignment.lessonId}`}>Abre la lección</Link>, guarda un cambio y publícala de nuevo para generarlo.</p>;
}

/** The educator's current assignments with the publication each one resolves to. */
export function CurrentAssignments() {
  const [items, setItems] = useState<LessonAssignment[] | null>(null), [error, setError] = useState("");
  const load = () => api<{ assignments: LessonAssignment[] }>("/assignments").then(result => setItems(result.assignments)).catch(cause => setError(message(cause)));
  useEffect(() => { void load(); }, []);
  if (error) return <ErrorState error={error} retry={() => void load()}/>;
  if (!items) return <Skeleton lines={3}/>;
  if (!items.length) return <EmptyState compact icon="list" title="Sin asignaciones vigentes">Cuando un grupo de tus cursos tenga una lección asignada para hoy, aparecerá aquí.</EmptyState>;
  return <ul className="current-assignments">{items.map(item => <li key={item.id} className={item.effective ? undefined : "needs-action"}>
    <div>
      <strong>{item.lessonTitle}</strong>
      <span className="muted small">{item.groupName} · {item.courseTitle}{item.endsOn ? ` · hasta el ${sessionDay(item.endsOn, "short")}` : ""}</span>
    </div>
    {item.effective ? <OpenPublication assignment={item}/> : item.availability === "unavailable" ? <>
      <StatusBadge tone="danger">Sin versión válida</StatusBadge>
      <p className="assignment-note danger"><Icon name="alert" size={16}/>La lección asignada ya no tiene una publicación vigente. <Link href={`/cursos/${item.courseId}/asignaciones`}>Sustitúyela en Asignaciones</Link>.</p>
    </> : <MissingLink assignment={item}/>}
  </li>)}</ul>;
}
