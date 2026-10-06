import type { SectionSummary } from "@happy-learners/contracts";
import { scheduleSummary } from "@happy-learners/domain";
import { Link } from "../../navigation";
import { hueFor, plural, sessionDay } from "../../model";
import { StatusBadge } from "../../ui/primitives";
import { sectionPath } from "./context";

function Bar({ label, value, max, text }: { label: string; value: number; max: number; text: string }) {
  const percent = max ? Math.round(100 * value / max) : 0;
  return <div className="mini-progress"><span className="muted small">{label}</span><div className="progress-track" role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent} aria-valuetext={text}><span style={{ width: `${percent}%` }}/></div><span className="small">{text}</span></div>;
}

/** A section with its own indicators: what it has taught of its course, its attendance and its next class. */
export function SectionCard({ section, today, showCourse = true }: { section: SectionSummary; today: string; showCourse?: boolean }) {
  const { indicators: stats, next } = section;
  const closed = section.status === "archived" || section.course.status === "archived";
  return <li className={`progress-item section-card tone-${hueFor(section.courseId)}`}>
    <div className="progress-head">
      <div>
        <Link href={sectionPath(section.id)} className="progress-title">{section.name}</Link>
        {showCourse && <span className="muted small section-course">{section.course.title}</span>}
      </div>
      {closed ? <StatusBadge>{section.status === "archived" ? "Cerrada" : "Curso archivado"}</StatusBadge> : stats.unrecorded > 0 && <StatusBadge tone="danger">{plural(stats.unrecorded, "clase sin registrar", "clases sin registrar")}</StatusBadge>}
    </div>
    {section.pacing === "self-paced" ? <div className="progress-bars">
      <Bar label="Avance promedio" value={stats.pathAverage || 0} max={100} text={stats.pathAverage === null ? "Sin lecciones" : `${stats.pathAverage} %`}/>
      <Bar label="Empezaron" value={stats.started} max={stats.learners} text={stats.learners ? `${stats.started} de ${stats.learners}` : "Sin estudiantes"}/>
      <Bar label="Terminaron el curso" value={stats.finished} max={stats.learners} text={stats.learners ? `${stats.finished} de ${stats.learners}` : "Sin estudiantes"}/>
    </div> : <div className="progress-bars">
      <Bar label="Lecciones impartidas" value={stats.lessonsTaught} max={stats.lessonsPublished} text={stats.lessonsPublished ? `${stats.lessonsTaught} de ${stats.lessonsPublished}` : "Sin lecciones publicadas"}/>
      <Bar label="Clases impartidas" value={stats.taught} max={stats.classes} text={stats.classes ? `${stats.taught} de ${stats.classes}` : "Sin clases"}/>
      <Bar label="Asistencia" value={stats.attendanceRate || 0} max={100} text={stats.attendanceRate === null ? "Sin registrar" : `${stats.attendanceRate} %`}/>
    </div>}
    <p className="muted small">
      {plural(stats.learners, "estudiante", "estudiantes")} · {section.pacing === "self-paced" ? "a tu ritmo" : section.schedule ? scheduleSummary(section.schedule) : "sin horario"}
      {next && !closed ? <> · {next.status === "in_progress" ? "clase en curso" : next.sessionDate === today ? "clase hoy" : "próxima clase"}: <Link href={`${sectionPath(section.id)}/clases/${next.id}`}>{sessionDay(next.sessionDate, "short")}{next.startsAt ? `, ${next.startsAt}` : ""}</Link></> : null}
    </p>
  </li>;
}

export function SectionCards({ sections, today, showCourse }: { sections: SectionSummary[]; today: string; showCourse?: boolean }) {
  return <ul className="progress-list section-list">{sections.map(section => <SectionCard key={section.id} section={section} today={today} showCourse={showCourse}/>)}</ul>;
}
