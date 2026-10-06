import { useEffect, useState } from "react";
import type { ProgramPath, StudyProgram } from "@happy-learners/contracts";
import { dependents } from "@happy-learners/domain";
import { api, message } from "../api";
import { Link } from "../navigation";
import { Modal, useFeedback } from "../ui/feedback";
import { Icon } from "../ui/icons";
import { EmptyState, ErrorState, Loading, StatusBadge } from "../ui/primitives";

/**
 * The program as a path (DEC-029): which courses of the program each course requires, shown in stages. A course
 * goes one stage after the latest course it requires; a course cannot require one that depends on it.
 */
export function ProgramPathDialog({ program, onClose }: { program: StudyProgram; onClose: () => void }) {
  const { toast } = useFeedback();
  const [path, setPath] = useState<ProgramPath | null>(null), [error, setError] = useState("");
  const [editing, setEditing] = useState<string | null>(null), [chosen, setChosen] = useState<string[]>([]), [busy, setBusy] = useState(false);
  const url = `/programs/${program.id}/prerequisites`;
  const load = () => api<ProgramPath>(url).then(setPath).catch(cause => setError(message(cause)));
  useEffect(() => { void load(); }, [program.id]);
  const title = (id: string) => path?.courses.find(course => course.id === id)?.title || "";
  const required = (id: string) => path?.courses.filter(course => path.requirements.some(item => item.courseId === id && item.requiredId === course.id)).map(course => course.id) || [];
  function edit(id: string) { setEditing(id); setChosen(required(id)); }
  async function save(id: string) {
    setBusy(true);
    try { setPath(await api<ProgramPath>(url, "PUT", { courseId: id, requiredIds: chosen })); setEditing(null); toast({ message: `Requisitos de «${title(id)}» guardados.` }); }
    catch (cause) { toast({ tone: "error", message: message(cause) }); }
    finally { setBusy(false); }
  }
  return <Modal title={`Ruta de «${program.name}»`} onClose={onClose} wide>
    <div className="stack">
      <p className="muted">Indica qué cursos del programa requiere cada curso. La ruta se ordena en etapas: cada curso va después de los cursos que requiere. Los requisitos orientan la planificación; no impiden abrir un curso.</p>
      {error ? <ErrorState error={error} retry={() => void load()}/> : !path ? <Loading label="Cargando la ruta…" lines={4}/>
        : path.courses.length < 2 ? <EmptyState compact icon="courses" title="El programa necesita al menos dos cursos">Asigna cursos al programa desde su configuración para definir qué requiere cada uno.</EmptyState>
        : <ol className="program-stages">{path.stages.map((stage, index) => <li key={index}>
          <h3>Etapa {index + 1}</h3>
          <ul>{stage.map(id => {
            const course = path.courses.find(item => item.id === id)!, needs = required(id);
            const blocked = dependents(path.requirements, id);
            return <li key={id} className="program-course">
              <div className="program-course-head">
                <div><Link href={`/cursos/${id}`}>{course.title}</Link>{course.status === "archived" && <> <StatusBadge>Archivado</StatusBadge></>}
                  <p className="muted small">{needs.length ? `Requiere ${needs.map(title).join(", ")}` : "Sin requisitos"}</p></div>
                {editing !== id && <button type="button" className="button secondary small" disabled={!!editing} onClick={() => edit(id)} aria-label={`Editar requisitos de ${course.title}`}><Icon name="edit" size={16}/>Requisitos</button>}
              </div>
              {editing === id && <fieldset className="stack" disabled={busy}>
                <legend className="small">Cursos que requiere «{course.title}»</legend>
                <ul className="chips">{path.courses.filter(item => item.id !== id).map(item => {
                  const cycle = blocked.has(item.id);
                  return <li key={item.id} className="chip" title={cycle ? `${item.title} requiere este curso` : undefined}>
                    <input type="checkbox" disabled={cycle} checked={chosen.includes(item.id)} aria-label={cycle ? `${item.title} (ya requiere este curso)` : item.title}
                      onChange={() => setChosen(current => current.includes(item.id) ? current.filter(other => other !== item.id) : [...current, item.id])}/>
                    <span>{item.title}</span>
                  </li>;
                })}</ul>
                <div className="button-row"><button type="button" className="button ghost small" onClick={() => setEditing(null)}>Cancelar</button><button type="button" className="button primary small" onClick={() => void save(id)}>{busy ? "Guardando…" : "Guardar requisitos"}</button></div>
              </fieldset>}
            </li>;
          })}</ul>
        </li>)}</ol>}
      <div className="modal-actions"><button type="button" className="button primary" onClick={onClose}>Listo</button></div>
    </div>
  </Modal>;
}
