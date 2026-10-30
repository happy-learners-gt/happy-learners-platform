import { useEffect, useState } from "react";
import type { SectionDifference } from "@happy-learners/domain";
import { api, message } from "../../api";
import { Link } from "../../navigation";
import { Drawer } from "../../ui/feedback";
import { ErrorState, Loading } from "../../ui/primitives";
import { useCourse } from "./context";

/** Curso › Secciones › Diferencias: what each section added, hid, reordered or replaced. */
export function SectionDifferences() {
  const { course } = useCourse();
  const [rows, setRows] = useState<SectionDifference[] | null>(null), [error, setError] = useState(""), [open, setOpen] = useState<SectionDifference | null>(null);
  useEffect(() => {
    api<{ sections: SectionDifference[] }>(`/courses/${course.id}/sections/differences`).then(result => setRows(result.sections)).catch(cause => setError(message(cause)));
  }, [course.id]);
  if (error) return <ErrorState error={error}/>;
  if (!rows) return <Loading label="Comparando las secciones…" lines={4}/>;
  if (!rows.length) return <p className="muted">Este curso aún no tiene secciones activas.</p>;
  return <>
    <table className="freedom-table">
      <thead><tr>
        <th scope="col">Sección</th><th scope="col">Docente</th><th scope="col">Propias</th><th scope="col">Ocultas</th><th scope="col">Reordenó</th><th scope="col">Reemplazos</th><th scope="col">Núcleo impartido</th><th scope="col">Resultados</th>
      </tr></thead>
      <tbody>{rows.map(row => <tr key={row.id} onClick={() => setOpen(row)}>
        <th scope="row">{row.name}</th>
        <td>{row.educator || "Sin asignar"}</td>
        <td>{row.added}</td>
        <td>{row.hidden}</td>
        <td>{row.reordered ? "Sí" : "No"}</td>
        <td>{row.replacements || "—"}</td>
        <td>{row.coreTaught}{row.behind && <span className="freedom-warn" title="Por detrás de lo esperado">⚠<span className="sr-only"> Por detrás</span></span>}</td>
        <td>{row.outcomes}{row.behind && <span className="freedom-warn" title="Por detrás de lo esperado">⚠<span className="sr-only"> Por detrás</span></span>}</td>
      </tr>)}</tbody>
    </table>
    {open && <Drawer title={open.name} onClose={() => setOpen(null)}>
      <p className="muted">{open.educator || "Sin docente asignado"}</p>
      <h3>Agregó</h3>
      {open.detail.added.length ? <ul className="freedom-list">{open.detail.added.map(item => <li key={item.id}>{item.type === "lesson" ? <Link href={`/cursos/${course.id}/lecciones/${item.id}`}>{item.title}</Link> : item.title}</li>)}</ul> : <p className="muted">Nada propio.</p>}
      <h3>Ocultó</h3>
      {open.detail.hidden.length ? <ul className="freedom-list">{open.detail.hidden.map(item => <li key={item.id}>{item.title}</li>)}</ul> : <p className="muted">Nada oculto.</p>}
      <h3>Reemplazó</h3>
      {open.detail.replacements.length ? <ul className="freedom-list">{open.detail.replacements.map(item => <li key={item.id}>{item.title} reemplaza a «{item.replacedTitle}»</li>)}</ul> : <p className="muted">Sin reemplazos.</p>}
      <h3>Cobertura del núcleo</h3>
      <p>{open.coreTaught} lecciones impartidas · {open.outcomes} resultados{open.behind ? " · por detrás de lo esperado a la fecha" : ""}</p>
    </Drawer>}
  </>;
}
