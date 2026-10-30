import { useEffect, useState } from "react";
import type { SectionDifference } from "@happy-learners/domain";
import { api, message } from "../../api";
import { Link } from "../../navigation";
import { Drawer, useFeedback } from "../../ui/feedback";
import { ErrorState, Field, Loading } from "../../ui/primitives";
import { useCourse } from "./context";

/** Curso › Secciones › Diferencias: what each section added, hid, reordered or replaced. */
export function SectionDifferences() {
  const { course } = useCourse();
  const { toast } = useFeedback();
  const [rows, setRows] = useState<SectionDifference[] | null>(null), [error, setError] = useState(""), [open, setOpen] = useState<SectionDifference | null>(null), [comment, setComment] = useState(""), [busy, setBusy] = useState(false);
  async function reload() {
    const result = await api<{ sections: SectionDifference[] }>(`/courses/${course.id}/sections/differences`);
    setRows(result.sections);
    setOpen(current => current ? result.sections.find(row => row.id === current.id) || null : null);
  }
  useEffect(() => {
    void reload().catch(cause => setError(message(cause)));
  }, [course.id]);
  async function review(item: { id: string; type: "lesson" | "activity" }, decision: "approve" | "return") {
    if (!open) return;
    if (decision === "return" && !comment.trim()) { toast({ tone: "error", message: "Escribe qué falta ajustar." }); return; }
    setBusy(true);
    try {
      await api(`/sections/${open.id}/reviews`, "POST", { itemType: item.type, itemId: item.id, decision, comment: comment.trim() });
      setComment("");
      await reload();
      toast({ message: decision === "approve" ? "Quedó aprobada." : "Se devolvió con el comentario." });
    } catch (cause) { toast({ tone: "error", message: message(cause) }); }
    finally { setBusy(false); }
  }
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
      <h3>Propuestas al curso</h3>
      {open.detail.proposals.length ? <ul className="freedom-list">{open.detail.proposals.map(item => <li key={item.id}>Propuso 1 {item.type === "lesson" ? "lección" : item.type === "unit" ? "unidad" : "actividad"} al curso · {item.status === "accepted" ? "aceptada" : item.status === "rejected" ? "rechazada" : "pendiente"}</li>)}</ul> : <p className="muted">Sin propuestas.</p>}
      {(open.detail.reviews || []).length > 0 && <>
        <h3>En revisión</h3>
        <ul className="freedom-list">{open.detail.reviews.map(item => <li key={item.id} className="freedom-row">
          <span className="freedom-title">{item.title}</span>
          {item.status === "pending" && <><button type="button" className="button small" disabled={busy} onClick={() => void review(item, "approve")}>Aprobar</button><button type="button" className="button ghost small" disabled={busy} onClick={() => void review(item, "return")}>Devolver</button></>}
        </li>)}</ul>
        <Field label="Comentario al devolver"><textarea value={comment} maxLength={600} rows={2} onChange={event => setComment(event.target.value)}/></Field>
      </>}
      <h3>Cobertura del núcleo</h3>
      <p>{open.coreTaught} lecciones impartidas · {open.outcomes} resultados{open.behind ? " · por detrás de lo esperado a la fecha" : ""}</p>
    </Drawer>}
  </>;
}
