import { useEffect, useState } from "react";
import type { SectionProgress } from "@happy-learners/contracts";
import { nextInPath } from "@happy-learners/domain";
import { api, message } from "../../api";
import { Link } from "../../navigation";
import { timeAgo } from "../../model";
import { EmptyState, ErrorState, Loading, PageHeader, Section, StatTiles } from "../../ui/primitives";
import { useSection } from "./context";

/**
 * Avance of a self-paced section (DEC-027): how far each student got in the course's published lessons, where each
 * one is, and which lessons the section finds harder. Students record it with the section code, under their name.
 */
export function SectionProgressPage() {
  const { section, base } = useSection();
  const [data, setData] = useState<SectionProgress | null>(null), [error, setError] = useState("");
  const load = () => api<SectionProgress>(`/sections/${section.id}/progress`).then(setData).catch(cause => setError(message(cause)));
  useEffect(() => { void load(); }, [section.id]);
  const crumbs = [{ label: "Docencia", href: "/secciones" }, { label: section.name, href: base }, { label: "Avance" }];
  const header = <PageHeader crumbs={crumbs} title="Avance" description="Cada estudiante recorre a su ritmo las lecciones publicadas del curso, en orden. Entra con el código de la sección y elige su nombre de la lista."/>;
  if (error) return <>{header}<ErrorState error={error} retry={() => void load()}/></>;
  if (!data) return <>{header}<Loading label="Cargando el avance…" lines={5}/></>;
  const total = data.lessons.length, title = new Map(data.lessons.map(lesson => [lesson.id, lesson.title]));
  const ids = data.lessons.map(lesson => lesson.id), stats = section.indicators;
  return <>
    {header}
    <StatTiles className="overview-kpis" items={[
      { label: "Estudiantes", value: stats.learners, icon: "users", hue: "pink" },
      { label: "Empezaron", value: stats.started, icon: "play", hue: "violet" },
      { label: "Terminaron el curso", value: stats.finished, icon: "check", hue: "green" },
      { label: "Avance promedio", value: stats.pathAverage === null ? "—" : `${stats.pathAverage} %`, icon: "overview", hue: "coral" },
    ]}/>
    <Section title="Por estudiante">
      {!data.learners.length ? <EmptyState compact icon="users" title="La sección aún no tiene estudiantes" action={<Link className="button secondary small" href={`${base}/estudiantes`}>Ver estudiantes</Link>}>Cuando administración inscriba estudiantes, cada uno podrá elegir su nombre al entrar con el código y su avance aparecerá aquí.</EmptyState>
        : !total ? <p className="muted">El curso aún no tiene lecciones publicadas.</p>
        : <div className="coverage-scroll" role="region" aria-label="Avance por estudiante" tabIndex={0}>
          <table className="coverage-table progress-table">
            <thead><tr><th scope="col">Estudiante</th><th scope="col">Lecciones terminadas</th><th scope="col">Sigue con</th><th scope="col">Última actividad</th></tr></thead>
            <tbody>{data.learners.map(learner => {
              const done = new Set(learner.completed), next = nextInPath(ids, done);
              return <tr key={learner.id}>
                <th scope="row">{learner.name}</th>
                <td><div className="row-progress"><div className="progress-track" role="progressbar" aria-label={`Lecciones terminadas por ${learner.name}`} aria-valuemin={0} aria-valuemax={total} aria-valuenow={learner.completed.length}><span style={{ width: `${Math.round(100 * learner.completed.length / total)}%` }}/></div><span className="small">{learner.completed.length} de {total}</span></div></td>
                <td>{next ? title.get(next) : <span className="muted">Terminó el curso</span>}</td>
                <td>{learner.lastActivity ? timeAgo(learner.lastActivity) : <span className="muted">Aún no empieza</span>}</td>
              </tr>;
            })}</tbody>
          </table>
        </div>}
    </Section>
    {total > 0 && data.learners.length > 0 && <Section title="Por lección">
      <p className="muted small">Cuántos estudiantes abrieron y terminaron cada lección. Una lección que muchos abren y pocos terminan puede necesitar apoyo.</p>
      <div className="coverage-scroll" role="region" aria-label="Avance por lección" tabIndex={0}>
        <table className="coverage-table progress-table">
          <thead><tr><th scope="col">Lección</th><th scope="col">Módulo</th><th scope="col">Estudiantes que la abrieron</th><th scope="col">Estudiantes que la terminaron</th></tr></thead>
          <tbody>{data.lessons.map(lesson => <tr key={lesson.id}>
            <th scope="row">{lesson.title}</th>
            <td>{lesson.unitName}</td>
            <td>{data.learners.filter(learner => learner.opened.includes(lesson.id)).length}</td>
            <td>{data.learners.filter(learner => learner.completed.includes(lesson.id)).length}</td>
          </tr>)}</tbody>
        </table>
      </div>
    </Section>}
  </>;
}
