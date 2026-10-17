import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import type { DepartureInput, DeparturePerson, DeparturePreview } from "@happy-learners/contracts";
import { departureDate, maxDepartureReason } from "@happy-learners/domain";
import { api, ApiError, message } from "../api";
import { Modal } from "../ui/feedback";
import { Icon } from "../ui/icons";
import { ErrorState, Field, Loading } from "../ui/primitives";
import { formatDay } from "../regional";

/** A calendar day (AAAA-MM-DD) in words, without a timezone shift: «15 de octubre de 2026». */
export function departureDay(value: string) {
  return formatDay(value, "full");
}

/** The people to choose from, the course team first: they already know the course. */
function PeopleOptions({ people, first }: { people: DeparturePerson[]; first?: DeparturePerson[] }) {
  const team = new Set((first || []).map(person => person.id));
  const known = people.filter(person => team.has(person.id)), rest = people.filter(person => !team.has(person.id));
  const option = (person: DeparturePerson) => <option key={person.id} value={person.id}>{person.name} (@{person.username})</option>;
  return <>
    <option value="">Elige una persona</option>
    {known.length > 0 && <optgroup label="Equipo del curso">{known.map(option)}</optgroup>}
    {rest.length > 0 && (known.length ? <optgroup label="Otras personas">{rest.map(option)}</optgroup> : rest.map(option))}
  </>;
}

/**
 * ST-123: administration records that a person left. Before confirming, each course they lead gets a new lead and each
 * section only they teach gets someone to teach it; co-teaching and shared sections end on their own.
 */
export function DepartureDialog({ person, onClose, onDone }: { person: { id: string; name: string }; onClose: () => void; onDone: (date: string) => Promise<void> }) {
  const [preview, setPreview] = useState<DeparturePreview | null>(null), [loadError, setLoadError] = useState("");
  const [date, setDate] = useState(""), [reason, setReason] = useState(""), [conflictReason, setConflictReason] = useState("");
  const [courses, setCourses] = useState<Record<string, string>>({}), [sections, setSections] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false), [error, setError] = useState(""), [conflicts, setConflicts] = useState(false);
  const load = async () => {
    setLoadError("");
    try { const result = await api<DeparturePreview>(`/members/${person.id}/departure`); setPreview(result); setDate(result.today); }
    catch (cause) { setLoadError(message(cause)); }
  };
  useEffect(() => { void load(); }, [person.id]);

  const leads = preview?.courses.filter(course => course.role === "lead") || [], shared = preview?.courses.filter(course => course.role === "co-teacher") || [];
  const sole = preview?.sections.filter(section => section.required) || [], others = preview?.sections.filter(section => !section.required) || [];
  const pending = leads.filter(course => !courses[course.id]).length + sole.filter(section => !sections[section.id]).length;
  const validDate = !!preview && !!departureDate(date, preview.today);
  const ready = validDate && pending === 0 && (!conflicts || conflictReason.trim().length >= 3);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!ready) return;
    setBusy(true); setError("");
    const body: DepartureInput = { date, reason: reason.trim() || undefined, reassignments: { courses, sections }, ...(conflicts ? { conflictReason } : {}) };
    try { await api(`/members/${person.id}/departure`, "POST", body); await onDone(date); }
    catch (cause) {
      setError(message(cause));
      if (cause instanceof ApiError && Array.isArray(cause.detail.conflicts)) setConflicts(true);
      setBusy(false);
    }
  }

  const title = `Registrar la salida de ${person.name}`;
  if (loadError) return <Modal title={title} onClose={onClose}><ErrorState error={loadError} retry={() => void load()}/></Modal>;
  if (!preview) return <Modal title={title} onClose={onClose}><Loading label="Revisando sus cursos y secciones…" lines={3}/></Modal>;
  return <Modal title={title} onClose={onClose} wide>
    <form className="stack" onSubmit={submit} aria-label={title}><fieldset className="stack" disabled={busy}>
      {error && <p className="form-alert" role="alert"><Icon name="alert" size={18}/>{error}</p>}
      <p>Al confirmar, {person.name} pierde el acceso: se cierran sus sesiones y su enlace de calendario. Su cuenta, sus lecciones, sus clases registradas y su actividad se conservan.</p>
      {preview.lastDeparture && <p className="notice" role="note"><Icon name="info" size={18}/>Ya tiene una salida registrada el {departureDay(preview.lastDeparture.departedOn)}. Esta salida se registra aparte.</p>}
      <Field label="Fecha de salida" hint="Hoy o un día anterior." error={date && !validDate ? "Elige hoy o un día anterior." : undefined}>
        <input type="date" name="date" required max={preview.today} value={date} onChange={event => setDate(event.target.value)}/>
      </Field>
      <Field label="Motivo" optional hint="Solo lo ve administración; no aparece en la actividad.">
        <textarea name="reason" rows={2} maxLength={maxDepartureReason} value={reason} onChange={event => setReason(event.target.value)}/>
      </Field>

      {leads.length > 0 && <section className="stack" aria-labelledby="departure-courses">
        <h3 id="departure-courses">Cursos que dirige</h3>
        <p className="muted small">Cada curso necesita una persona responsable. Si eliges a alguien fuera del equipo, se suma como responsable.</p>
        {leads.map(course => <Field key={course.id} label={`Nueva persona responsable de «${course.title}»`}>
          <select required value={courses[course.id] || ""} onChange={event => setCourses({ ...courses, [course.id]: event.target.value })}><PeopleOptions people={preview.people} first={course.team}/></select>
        </Field>)}
      </section>}

      {sole.length > 0 && <section className="stack" aria-labelledby="departure-sections">
        <h3 id="departure-sections">Secciones que imparte sin otro educador</h3>
        <p className="muted small">Cada sección necesita quien la imparta. Si eliges a alguien fuera del equipo del curso, se suma como colaborador.</p>
        {sole.map(section => <Field key={section.id} label={`Quién imparte «${section.name}» (${section.courseTitle})`}>
          <select required value={sections[section.id] || ""} onChange={event => setSections({ ...sections, [section.id]: event.target.value })}><PeopleOptions people={preview.people} first={preview.courses.find(course => course.id === section.courseId)?.team}/></select>
        </Field>)}
      </section>}

      {(shared.length > 0 || others.length > 0) && <section className="stack" aria-labelledby="departure-automatic">
        <h3 id="departure-automatic">Se retira sin reasignar</h3>
        <ul className="departure-list">
          {shared.map(course => <li key={course.id}>Colabora en «{course.title}»: deja el equipo docente.</li>)}
          {others.map(section => <li key={section.id}>«{section.name}» ({section.courseTitle}): la siguen impartiendo {section.others.map(item => item.name).join(", ")}.</li>)}
        </ul>
      </section>}
      {!preview.courses.length && !preview.sections.length && <p className="muted">No dirige cursos ni imparte secciones activas: no hay nada que reasignar.</p>}

      {conflicts && <Field label="Motivo del choque de horario" hint="De 3 a 300 caracteres; queda registrado con la asignación.">
        <textarea name="conflictReason" rows={2} maxLength={300} required value={conflictReason} onChange={event => setConflictReason(event.target.value)}/>
      </Field>}

      <p className="muted small" aria-live="polite">{pending === 0 ? "Todo lo que dirige o imparte tiene quien lo continúe." : pending === 1 ? "Falta 1 reasignación para confirmar." : `Faltan ${pending} reasignaciones para confirmar.`}</p>
      <div className="modal-actions">
        <button type="button" className="button ghost" onClick={onClose}>Cancelar</button>
        <button className="button danger" disabled={!ready}>{busy ? "Registrando…" : "Registrar salida"}</button>
      </div>
    </fieldset></form>
  </Modal>;
}
