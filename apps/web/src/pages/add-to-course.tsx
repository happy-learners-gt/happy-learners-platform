import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import type { Course, CourseRole } from "@happy-learners/contracts";
import { api, message } from "../api";
import { Modal, useFeedback } from "../ui/feedback";
import { Icon } from "../ui/icons";
import { Field } from "../ui/primitives";

/**
 * PPL-02 (docs/design/incorporacion-institucional.md): administration adds a person to a course's teaching team from
 * their incorporation. It reads the course as it is and sends its team with the person added, guarded by the course's
 * version, exactly as Curso › Configuración › Equipo docente does; the sections are still assigned in the course.
 */
export function AddToCourseDialog({ person, onClose, onAdded }: { person: { id: string; name: string }; onClose: () => void; onAdded: (course: string) => void }) {
  const { toast } = useFeedback();
  const [courses, setCourses] = useState<Course[] | null>(null), [courseId, setCourseId] = useState(""), [role, setRole] = useState<CourseRole>("co-teacher");
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  useEffect(() => {
    api<{ courses: Course[] }>("/courses").then(result => setCourses(result.courses
      .filter(course => course.status === "active" && !course.team?.some(member => member.userId === person.id))
      .sort((a, b) => a.title.localeCompare(b.title, "es", { numeric: true }))), cause => setError(message(cause)));
  }, [person.id]);
  const chosen = courses?.find(course => course.id === courseId);
  const hasLead = !!chosen?.team?.some(member => member.role === "lead");
  useEffect(() => { setRole(hasLead ? "co-teacher" : "lead"); }, [courseId, hasLead]);
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!chosen) return;
    setBusy(true); setError("");
    try {
      // The course as it is now: its version guards against a team changed meanwhile.
      const { course } = await api<{ course: Course }>(`/courses/${chosen.id}`);
      const team = (course.team || []).filter(member => member.userId !== person.id).map(member => ({ userId: member.userId, role: role === "lead" && member.role === "lead" ? "co-teacher" as const : member.role }));
      await api(`/courses/${chosen.id}/team`, "PUT", { members: [...team, { userId: person.id, role }], version: course.version });
      toast({ message: `${person.name} se sumó al equipo de ${chosen.title}. Asígnale secciones en el curso.` });
      onAdded(chosen.id);
    } catch (cause) { setError(message(cause)); setBusy(false); }
  }
  return <Modal title={`Agregar a ${person.name} a un curso`} onClose={onClose}>
    {!courses ? <p role="status" className="muted">Cargando cursos…</p> : !courses.length ? <p className="muted">{person.name} ya está en el equipo de todos los cursos activos.</p>
      : <form className="stack" onSubmit={submit}>
        {error && <p className="form-alert" role="alert"><Icon name="alert" size={18}/>{error}</p>}
        <fieldset className="stack" disabled={busy}>
          <Field label="Curso"><select required value={courseId} onChange={event => setCourseId(event.target.value)} data-autofocus>
            <option value="">Elige un curso…</option>{courses.map(course => <option key={course.id} value={course.id}>{course.title}</option>)}
          </select></Field>
          <Field label="Rol en el equipo" hint={hasLead ? "El curso ya tiene responsable: elegir «Responsable» hace que esa persona pase a colaborar." : "El curso no tiene responsable."}>
            <select value={role} onChange={event => setRole(event.target.value as CourseRole)} disabled={!chosen}>
              <option value="lead">Responsable</option><option value="co-teacher">Colabora</option>
            </select>
          </Field>
          <div className="button-row modal-actions"><button type="button" className="button secondary" onClick={onClose}>Cancelar</button><button className="button primary" disabled={!chosen}>{busy ? "Agregando…" : "Agregar al curso"}</button></div>
        </fieldset>
      </form>}
  </Modal>;
}
