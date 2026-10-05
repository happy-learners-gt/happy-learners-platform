import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import type { ClassLesson, ClassLessonPlan, ClassResource, ClassSession, ClassStatus } from "@happy-learners/contracts";
import { classSequence, classStatusLabels, maxClassLessons } from "@happy-learners/domain";
import { api, message } from "../../api";
import { Link, useNavigation, useUnsavedChanges } from "../../navigation";
import { plural, sessionDay } from "../../model";
import { Modal, useFeedback } from "../../ui/feedback";
import { Icon } from "../../ui/icons";
import { Menu } from "../../ui/Menu";
import type { MenuItem } from "../../ui/Menu";
import { Button, EmptyState, ErrorState, Field, Loading, PageHeader, PrimaryAction, Section, StatTiles, StatusBadge } from "../../ui/primitives";
import type { Tone } from "../../ui/primitives";
import { ResourcePreview } from "../resources";
import { useCourse } from "./context";
import type { SectionView } from "./Sections";
import { useSection } from "../sections/context";

type Mark = "unmarked" | "present" | "late" | "absent" | "excused";
type Row = { learnerId: string; displayName: string; status: Mark };
type DetailLesson = ClassLesson & { currentRevision: number | null; archived: boolean; shareCode: string | null; activities: ClassLessonPlan["activities"]; resources: ClassResource[] };
type Detail = { session: ClassSession & { notes: string }; lessons: DetailLesson[]; resources: ClassResource[]; learners: Row[]; groupActive: boolean };
const markLabels: [Exclude<Mark, "unmarked">, string][] = [["present", "Presente"], ["late", "Tarde"], ["absent", "Ausente"], ["excused", "Justificada"]];
const statusTone: Record<ClassStatus, Tone> = { planned: "info", in_progress: "warning", completed: "success", cancelled: "neutral" };
const kindIcon = { text: "text", link: "link", file: "file" } as const;

export const classTime = (session: Pick<ClassSession, "startsAt" | "durationMinutes">) => [session.startsAt, session.durationMinutes ? `${session.durationMinutes} min` : ""].filter(Boolean).join(" · ");
/** A planned class whose day has passed was not recorded: it shows as pending, not as planned. */
export function classBadge(session: Pick<ClassSession, "status" | "sessionDate">, today: string) {
  if (session.status === "planned" && session.sessionDate < today) return <StatusBadge tone="danger">Sin registrar</StatusBadge>;
  return <StatusBadge tone={statusTone[session.status]}>{session.status === "planned" && session.sessionDate === today ? "Hoy" : classStatusLabels[session.status]}</StatusBadge>;
}
const rate = (session: ClassSession) => session.marked ? Math.round(100 * Number(session.attended) / Number(session.marked)) : null;
const byDate = (a: ClassSession, b: ClassSession) => a.sessionDate.localeCompare(b.sessionDate) || (a.startsAt || "").localeCompare(b.startsAt || "");
const unique = <T extends { id: string }>(items: T[]) => items.filter((item, index) => items.findIndex(other => other.id === item.id) === index);
const attendanceText = (session: ClassSession) => session.marked ? `${session.attended} de ${session.marked} presentes${rate(session) !== null ? ` (${rate(session)} %)` : ""}` : "";

export function Classes({ sessionId }: { sessionId?: string }) {
  return sessionId ? <ClassDetail key={sessionId} id={sessionId}/> : <Schedule/>;
}

/**
 * The schedule of classes of a section: the classes its timetable generates, each planned with its lessons,
 * activities, comments and resources, and tracked as it is taught with its attendance. Only this section's classes.
 */
function Schedule() {
  const { course, teaches, configurable, noun } = useCourse();
  const { section: group, base: sectionBase, reload } = useSection();
  const { url, navigate } = useNavigation();
  const [sessions, setSessions] = useState<ClassSession[] | null>(null), [plans, setPlans] = useState<Record<string, ClassLessonPlan>>({}), [today, setToday] = useState(""), [error, setError] = useState("");
  const [adding, setAdding] = useState(url.searchParams.get("nueva") === "1"), [filling, setFilling] = useState(false), [planning, setPlanning] = useState<ClassSession | null>(null);
  const view = url.searchParams.get("vista") === "historial" ? "history" : url.searchParams.get("vista") === "proximas" ? "upcoming" : "all";
  const page = `${sectionBase}/clases`;
  async function load() {
    setError("");
    try {
      const s = await api<{ sessions: ClassSession[]; lessonPlans: Record<string, ClassLessonPlan>; today: string }>(`/courses/${course.id}/sessions`);
      setSessions(s.sessions.filter(session => session.groupId === group.id)); setPlans(s.lessonPlans); setToday(s.today);
    } catch (cause) { setError(message(cause)); }
  }
  useEffect(() => { if (course.status === "active") void load(); }, [course.id, group.id]);
  const changed = async () => { await load(); await reload(); };
  function filter(key: string, value: string) { const next = new URL(url); if (value) next.searchParams.set(key, value); else next.searchParams.delete(key); next.searchParams.delete("nueva"); navigate(next.pathname + next.search, true); }
  const writable = group.status === "active" && teaches(group.id);
  const header = <PageHeader crumbs={[{ label: "Secciones", href: "/secciones" }, { label: group.name, href: sectionBase }, { label: "Cronograma" }]} title="Cronograma"
    description={writable ? "Las clases de la sección se generan con su horario. Planifica en ellas las lecciones y comentarios; el día de la clase ábrela para pasar lista y finalizarla." : "Las clases de la sección, con lo planificado y lo impartido en cada una. Las planifica y registra quien imparte la sección."}
    actions={writable && <Button icon="plus" onClick={() => setAdding(true)}>Agregar clase</Button>}
    primary={writable && !!sessions?.length && <PrimaryAction icon="list" onClick={() => setFilling(true)}>Asignar lecciones en orden</PrimaryAction>}/>;
  const addDialog = adding && writable && <AddDialog groups={[group]} initialGroup={group.id} onClose={() => { setAdding(false); if (url.searchParams.has("nueva")) filter("nueva", ""); }}
    onSaved={async () => { setAdding(false); await changed(); }}/>;
  if (course.status !== "active") return <>{header}<EmptyState icon="archive" title="Curso archivado">Las clases vuelven a estar disponibles cuando administración restaura el curso.</EmptyState></>;
  if (error) return <>{header}<ErrorState error={error} retry={() => void load()}/></>;
  if (!sessions) return <>{header}<Loading label="Cargando el cronograma…" lines={6}/></>;
  const ofGroup = [...sessions].sort(byDate);
  const sequence = classSequence(ofGroup, group.schedule?.from);
  const isUpcoming = (session: ClassSession) => session.status === "in_progress" || (session.status === "planned" && session.sessionDate >= today);
  const upcoming = ofGroup.filter(isUpcoming), history = ofGroup.filter(session => !isUpcoming(session)).reverse();
  const held = ofGroup.filter(session => session.status !== "cancelled"), taught = held.filter(session => session.status === "completed");
  const marked = taught.reduce((sum, session) => sum + Number(session.marked || 0), 0), attended = taught.reduce((sum, session) => sum + Number(session.attended || 0), 0);
  const rows = view === "upcoming" ? upcoming : view === "history" ? history : ofGroup;
  const editable = writable;
  return <>
    {header}
    <div className="toolbar" role="group" aria-label="Mostrar clases">
      <fieldset className="segmented"><legend className="sr-only">Mostrar</legend>
        <label><input type="radio" name="class-view" checked={view === "all"} onChange={() => filter("vista", "")}/><span>Todo el periodo ({ofGroup.length})</span></label>
        <label><input type="radio" name="class-view" checked={view === "upcoming"} onChange={() => filter("vista", "proximas")}/><span>Próximas ({upcoming.length})</span></label>
        <label><input type="radio" name="class-view" checked={view === "history"} onChange={() => filter("vista", "historial")}/><span>Historial ({history.length})</span></label>
      </fieldset>
      {group.schedule && <span className="muted small">Horario: {group.schedule.from ? `del ${sessionDay(group.schedule.from, "short")} al ${sessionDay(group.schedule.until || group.schedule.from, "short")}` : ""} <Link href={`${sectionBase}/horario`}>Ver horario</Link></span>}
    </div>
    <StatTiles className="class-stats" items={[
      { label: "Clases planificadas", value: `${held.filter(session => session.lessons.length).length} de ${held.length}`, icon: "list", hue: "sky" },
      { label: "Impartidas", value: taught.length, icon: "check", hue: "green" },
      { label: "Asistencia promedio", value: marked ? `${Math.round(100 * attended / marked)} %` : "—", icon: "users", hue: "violet" },
      { label: "Sin registrar", value: held.filter(session => session.status === "planned" && session.sessionDate < today).length, icon: "alert", hue: "coral" },
    ]}/>
    {rows.length ? <div className="table-card" role="region" aria-label={`Cronograma de ${group.name}`} tabIndex={0}>
      <table className="schedule-table">
        <caption className="sr-only">Cronograma de clases de {group.name}: planificación y seguimiento</caption>
        <thead><tr><th scope="col">Fecha</th><th scope="col">{noun.One}</th><th scope="col">Lecciones</th><th scope="col">Actividades</th><th scope="col">Comentarios</th><th scope="col">Recursos</th><th scope="col">Seguimiento</th></tr></thead>
        <tbody>{rows.map(session => <ScheduleRow key={session.id} session={session} place={sequence.get(session.id)} extra={session.origin === "manual" && !!group.schedule && session.sessionDate >= group.schedule.from && session.sessionDate <= group.schedule.until} plans={plans} today={today} page={page} editable={editable} onPlan={() => setPlanning(session)}/>)}</tbody>
      </table>
    </div>
      : !ofGroup.length ? <EmptyState icon="calendar" title="Esta sección aún no tiene clases" action={configurable ? <Link className="button primary" href={`${sectionBase}/horario`}>Configurar horario</Link> : writable && <Button icon="plus" onClick={() => setAdding(true)}>Agregar clase</Button>}>
        {configurable ? "Configura su horario para generar su cronograma del periodo." : "Su cronograma se genera cuando administración configura el horario. También puedes agregar una clase suelta."}
      </EmptyState>
      : <EmptyState icon="calendar" title={view === "upcoming" ? "No hay clases próximas" : "Aún no hay clases en el historial"} action={configurable && view === "upcoming" && <Link className="button primary" href={`${sectionBase}/horario`}>Revisar el horario</Link>}>
        {view === "upcoming" ? "Amplía el periodo del horario de la sección o agrega una clase suelta." : "Las clases impartidas, canceladas o sin registrar aparecerán aquí."}
      </EmptyState>}
    {filling && <FillDialog groups={[group]} sessions={sessions} today={today} initialGroup={group.id} onClose={() => setFilling(false)} onDone={async () => { setFilling(false); await changed(); }}/>}
    {planning && <PlanDialog session={planning} onClose={() => setPlanning(null)} onSaved={async () => { setPlanning(null); await changed(); }}/>}
    {addDialog}
  </>;
}

/** One class of the schedule: when, what is planned for it and how it went. */
function ScheduleRow({ session, place, extra, plans, today, page, editable, onPlan }: { session: ClassSession; place?: { week: number; number: number | null }; extra: boolean; plans: Record<string, ClassLessonPlan>; today: string; page: string; editable: boolean; onPlan: () => void }) {
  const { noun } = useCourse();
  const modules = [...new Set(session.lessons.map(lesson => lesson.unitTitle).filter(Boolean))];
  const activities = session.lessons.flatMap(lesson => plans[lesson.id]?.activities || []);
  const resources = unique(session.lessons.flatMap(lesson => plans[lesson.id]?.resources || []));
  const day = sessionDay(session.sessionDate);
  const none = <span className="muted">—</span>;
  return <tr className={session.sessionDate === today ? "is-today" : session.status === "cancelled" ? "is-cancelled" : undefined}>
    <th scope="row" data-label="Fecha"><div className="cell-date">
      <Link href={`${page}/${session.id}`} className="class-row-title">{sessionDay(session.sessionDate, "short")}{session.startsAt ? `, ${session.startsAt}` : ""}</Link>
      <span className="muted small">{place?.number ? `Clase ${place.number} · ` : ""}Semana {place?.week ?? 1}{extra ? " · adicional" : ""}</span>
    </div></th>
    <td data-label={noun.One}>{modules.length ? modules.join(" · ") : none}</td>
    <td data-label="Lecciones">{session.lessons.length ? <ol className="cell-list">{session.lessons.map(lesson => <li key={lesson.id}>{lesson.title}{!lesson.available && <> <LessonWarning id={lesson.id}/></>}</li>)}</ol> : <span className="muted">Sin lección</span>}</td>
    <td data-label="Actividades">{activities.length ? <ul className="cell-list">{activities.slice(0, 4).map((activity, index) => <li key={index}>{activity.title}{activity.minutes ? <span className="muted nowrap"> · {activity.minutes} min</span> : null}</li>)}{activities.length > 4 && <li className="muted">y {activities.length - 4} más</li>}</ul> : none}</td>
    <td data-label="Comentarios">{session.notes ? <p className="cell-notes">{session.notes}</p> : none}</td>
    <td data-label="Recursos">{resources.length ? <ul className="cell-list">{resources.slice(0, 4).map(resource => <li key={resource.id}><Icon name={kindIcon[resource.kind]} size={14}/>{resource.title}</li>)}{resources.length > 4 && <li className="muted">y {resources.length - 4} más</li>}</ul> : none}</td>
    <td data-label="Seguimiento"><div className="cell-status">
      {classBadge(session, today)}{attendanceText(session) && <span className="muted small">{attendanceText(session)}</span>}
      {editable && session.status !== "cancelled" && <Button className="small" icon="edit" onClick={onPlan}>{session.status === "completed" ? "Comentar" : "Planificar"}<span className="sr-only"> la clase del {day}</span></Button>}
    </div></td>
  </tr>;
}

/** A lesson students cannot open: still a draft, or archived and in need of a replacement (ST-029). */
function LessonWarning({ id }: { id: string }) {
  const { lessons } = useCourse();
  const lesson = lessons.find(item => item.id === id);
  return lesson && lesson.status !== "archived" && !lesson.revision ? <StatusBadge tone="neutral">Borrador: aún no la ven los estudiantes</StatusBadge> : <StatusBadge tone="warning">Requiere sustitución</StatusBadge>;
}

/** Gives the upcoming classes of a section without lessons the next published lessons, in content order. */
function FillDialog({ groups, sessions, today, initialGroup, onClose, onDone }: { groups: Pick<SectionView, "id" | "name">[]; sessions: ClassSession[]; today: string; initialGroup: string; onClose: () => void; onDone: () => Promise<void> }) {
  const { course } = useCourse();
  const { toast } = useFeedback();
  const [groupId, setGroupId] = useState(groups.some(group => group.id === initialGroup) ? initialGroup : groups[0]?.id || ""), [perClass, setPerClass] = useState("1"), [busy, setBusy] = useState(false), [error, setError] = useState("");
  const empty = sessions.filter(session => session.groupId === groupId && session.status === "planned" && session.sessionDate >= today && !session.lessons.length).length;
  async function submit(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError("");
    try {
      const { assigned, classes } = await api<{ assigned: number; classes: number }>(`/courses/${course.id}/groups/${groupId}/lessons`, "POST", { perClass: Number(perClass) });
      toast({ message: assigned ? `Se planificaron ${plural(assigned, "lección", "lecciones")} en ${plural(classes, "clase", "clases")}, en orden.` : "No quedan lecciones publicadas por asignar a esta sección." });
      await onDone();
    } catch (cause) { setError(message(cause)); setBusy(false); }
  }
  return <Modal title="Asignar lecciones en orden" onClose={onClose}>
    <form className="stack" onSubmit={submit}>
      {error && <p className="form-alert" role="alert"><Icon name="alert" size={18}/>{error}</p>}
      <fieldset disabled={busy} className="stack">
        {groups.length > 1 && <Field label="Sección"><select value={groupId} onChange={event => setGroupId(event.target.value)} required>{groups.map(group => <option key={group.id} value={group.id}>{group.name}</option>)}</select></Field>}
        <Field label="Lecciones por clase" hint="Usa más de una cuando el horario es extenso y se cubren varias lecciones en la misma clase."><select value={perClass} onChange={event => setPerClass(event.target.value)}><option value="1">1 lección</option><option value="2">2 lecciones</option><option value="3">3 lecciones</option></select></Field>
        <p className="muted">{empty ? `${plural(empty, "clase próxima no tiene", "clases próximas no tienen")} lecciones.` : "Todas las clases próximas de esta sección tienen lecciones."} Se usan las lecciones publicadas en el orden de Contenido y se omiten las que la sección ya tiene en una clase. Las clases que ya tienen lecciones no cambian.</p>
        <div className="modal-actions"><button type="button" className="button ghost" onClick={onClose}>Cancelar</button><button className="button primary" disabled={!empty}>{busy ? "Asignando…" : "Asignar lecciones"}</button></div>
      </fieldset>
    </form>
  </Modal>;
}

/** Picks the lessons of a class, in the order they are worked on: none, one, or several in a long class. */
function LessonPicker({ value, onChange, current, locked }: { value: string[]; onChange: (ids: string[]) => void; current: ClassLesson[]; locked?: boolean }) {
  const { lessons, units } = useCourse();
  const title = (id: string) => lessons.find(item => item.id === id)?.title || current.find(item => item.id === id)?.title || "Lección";
  const groups = units.filter(unit => unit.status === "active").sort((a, b) => a.position - b.position)
    .map(unit => ({ unit, items: lessons.filter(lesson => lesson.courseUnitId === unit.id && lesson.status !== "archived" && !!lesson.revision && !value.includes(lesson.id)).sort((a, b) => (a.position || 0) - (b.position || 0)) }))
    .filter(group => group.items.length);
  const move = (index: number, delta: number) => { const next = [...value]; [next[index], next[index + delta]] = [next[index + delta], next[index]]; onChange(next); };
  return <fieldset className="lesson-picker">
    <legend>Lecciones <span className="optional">(opcional)</span></legend>
    {value.length ? <ol className="lesson-picker-list">{value.map((id, index) => <li key={id}>
      <span className="roster-number" aria-hidden="true">{index + 1}</span><span>{title(id)}</span>
      {!locked && <span className="button-row">
        <button type="button" className="icon-button" disabled={!index} onClick={() => move(index, -1)} aria-label={`Subir «${title(id)}»`}><Icon name="up" size={16}/></button>
        <button type="button" className="icon-button" disabled={index === value.length - 1} onClick={() => move(index, 1)} aria-label={`Bajar «${title(id)}»`}><Icon name="down" size={16}/></button>
        <button type="button" className="icon-button" onClick={() => onChange(value.filter(item => item !== id))} aria-label={`Quitar «${title(id)}»`}><Icon name="close" size={16}/></button>
      </span>}
    </li>)}</ol> : <p className="muted small">Sin lecciones: la clase queda en el cronograma y puedes planificarla después.</p>}
    {locked ? <p className="muted small">Una clase impartida conserva las lecciones que trabajó.</p>
      : value.length < maxClassLessons && <label className="select-inline"><span>Agregar lección</span><select value="" onChange={event => event.target.value && onChange([...value, event.target.value])}>
        <option value="">Elige una lección publicada</option>
        {groups.map(({ unit, items }) => <optgroup key={unit.id} label={unit.name}>{items.map(lesson => <option key={lesson.id} value={lesson.id}>{lesson.title}</option>)}</optgroup>)}
      </select></label>}
  </fieldset>;
}

/** Plans a class of the schedule: its lessons and comments; a pending class can also move to another day or time. */
function PlanDialog({ session, onClose, onSaved }: { session: ClassSession; onClose: () => void; onSaved: () => Promise<void> }) {
  const { course } = useCourse();
  const { toast } = useFeedback();
  const [values, setValues] = useState({ sessionDate: session.sessionDate, startsAt: session.startsAt || "", durationMinutes: session.durationMinutes ? String(session.durationMinutes) : "", lessonIds: session.lessons.map(lesson => lesson.id), notes: session.notes || "" });
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  const set = (patch: Partial<typeof values>) => setValues(current => ({ ...current, ...patch }));
  const pending = session.status === "planned";
  async function submit(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError("");
    try {
      await api(`/courses/${course.id}/sessions/${session.id}`, "PUT", { ...values, startsAt: values.startsAt || null, durationMinutes: values.durationMinutes ? Number(values.durationMinutes) : null, version: session.version });
      toast({ message: "Planificación guardada." }); await onSaved();
    } catch (cause) { setError(message(cause)); setBusy(false); }
  }
  return <Modal title={`Planificar la clase del ${sessionDay(session.sessionDate)}`} onClose={onClose} wide>
    <form className="stack" onSubmit={submit}>
      {error && <p className="form-alert" role="alert"><Icon name="alert" size={18}/>{error}</p>}
      <fieldset disabled={busy} className="stack">
        <p className="muted">{session.groupName}{classTime(session) ? ` · ${classTime(session)}` : ""} · {classStatusLabels[session.status]}</p>
        {pending && <details className="disclosure">
          <summary>Cambiar fecha u hora</summary>
          <div className="field-row">
            <Field label="Fecha"><input type="date" value={values.sessionDate} onChange={event => set({ sessionDate: event.target.value })} required/></Field>
            <Field label="Hora" optional><input type="time" value={values.startsAt} onChange={event => set({ startsAt: event.target.value })}/></Field>
            <Field label="Duración (min)" optional><input type="number" min={5} max={480} step={5} value={values.durationMinutes} onChange={event => set({ durationMinutes: event.target.value })}/></Field>
          </div>
        </details>}
        <LessonPicker value={values.lessonIds} onChange={lessonIds => set({ lessonIds })} current={session.lessons} locked={session.status === "completed"}/>
        <Field label="Comentarios" optional hint="Qué se trabajará o qué quedó pendiente. Solo los ve el equipo docente; no escribas datos personales de los estudiantes."><textarea rows={3} maxLength={2000} value={values.notes} onChange={event => set({ notes: event.target.value })}/></Field>
        <div className="modal-actions"><button type="button" className="button ghost" onClick={onClose}>Cancelar</button><button className="button primary">{busy ? "Guardando…" : "Guardar planificación"}</button></div>
      </fieldset>
    </form>
  </Modal>;
}

/** Adds a class outside the timetable, such as a make-up or a review: it takes the section's time unless another is given. */
function AddDialog({ groups, initialGroup, onClose, onSaved }: { groups: Pick<SectionView, "id" | "name" | "learnerCount" | "schedule">[]; initialGroup: string; onClose: () => void; onSaved: (groupId: string) => Promise<void> }) {
  const { course } = useCourse();
  const { toast } = useFeedback();
  const [values, setValues] = useState({ groupId: groups.some(group => group.id === initialGroup) ? initialGroup : groups[0]?.id || "", sessionDate: new Date().toLocaleDateString("en-CA"), startsAt: "", durationMinutes: "", lessonIds: [] as string[], notes: "" });
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  const set = (patch: Partial<typeof values>) => setValues(current => ({ ...current, ...patch }));
  const schedule = groups.find(group => group.id === values.groupId)?.schedule;
  async function submit(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError("");
    try {
      await api(`/courses/${course.id}/sessions`, "POST", { ...values, startsAt: values.startsAt || null, durationMinutes: values.durationMinutes ? Number(values.durationMinutes) : null });
      toast({ message: "Clase agregada al cronograma." }); await onSaved(values.groupId);
    } catch (cause) { setError(message(cause)); setBusy(false); }
  }
  return <Modal title="Agregar clase" onClose={onClose} wide>
    <form className="stack" onSubmit={submit}>
      {error && <p className="form-alert" role="alert"><Icon name="alert" size={18}/>{error}</p>}
      <fieldset disabled={busy} className="stack">
        <p className="muted">Las clases del horario ya están en el cronograma. Agrega aquí una clase adicional, como una recuperación o un repaso.</p>
        <div className="field-row">
          {groups.length > 1 && <Field label="Sección"><select value={values.groupId} onChange={event => set({ groupId: event.target.value })} required>{groups.map(group => <option key={group.id} value={group.id}>{group.name} · {plural(group.learnerCount, "estudiante", "estudiantes")}</option>)}</select></Field>}
          <Field label="Fecha" hint={schedule ? `Toma la hora del horario: ${schedule.startsAt}, ${schedule.durationMinutes} min.` : "La sección no tiene horario: indica la hora si la conoces."}><input type="date" value={values.sessionDate} onChange={event => set({ sessionDate: event.target.value })} required/></Field>
        </div>
        <details className="disclosure" open={!schedule}>
          <summary>{schedule ? "Otra hora o duración" : "Hora y duración"}</summary>
          <div className="field-row">
            <Field label="Hora" optional><input type="time" value={values.startsAt} onChange={event => set({ startsAt: event.target.value })}/></Field>
            <Field label="Duración (min)" optional><input type="number" min={5} max={480} step={5} value={values.durationMinutes} onChange={event => set({ durationMinutes: event.target.value })}/></Field>
          </div>
        </details>
        <LessonPicker value={values.lessonIds} onChange={lessonIds => set({ lessonIds })} current={[]}/>
        <Field label="Comentarios" optional hint="Solo los ve el equipo docente. No escribas datos personales de los estudiantes."><textarea rows={3} maxLength={2000} value={values.notes} onChange={event => set({ notes: event.target.value })}/></Field>
        <div className="modal-actions"><button type="button" className="button ghost" onClick={onClose}>Cancelar</button><button className="button primary">{busy ? "Agregando…" : "Agregar clase"}</button></div>
      </fieldset>
    </form>
  </Modal>;
}

/** A class on the day it is taught: its lessons and resources at hand, the roll, and finishing it. */
function ClassDetail({ id }: { id: string }) {
  const { course, teaches, lessons: courseLessons, noun } = useCourse();
  const { section, base: sectionBase, reload } = useSection();
  const { toast, confirm } = useFeedback();
  const [detail, setDetail] = useState<Detail | null>(null), [error, setError] = useState(""), [busy, setBusy] = useState(false), [editing, setEditing] = useState(false);
  const [preview, setPreview] = useState<ClassResource | null>(null);
  const path = `/courses/${course.id}/sessions/${id}`, page = `${sectionBase}/clases`;
  async function load() {
    setError("");
    try {
      const value = await api<Detail>(path);
      // A class always opens inside its own section.
      if (value.session.groupId !== section.id) { setError("404"); return; }
      setDetail(value);
    } catch (cause) { setError(message(cause)); }
  }
  useEffect(() => { void load(); }, [id]);
  const crumbs = [{ label: "Secciones", href: "/secciones" }, { label: section.name, href: sectionBase }, { label: "Cronograma", href: page }];
  if (error) return <><PageHeader crumbs={crumbs} title="Clase"/>{/404/.test(error) || error.includes("no está disponible") ? <EmptyState icon="calendar" title="No encontramos esa clase" action={<Link className="button secondary" href={page}>Ver el cronograma</Link>}/> : <ErrorState error={error} retry={() => void load()}/>}</>;
  if (!detail) return <><PageHeader crumbs={crumbs} title={<span className="skeleton-title">Clase</span>}/><Loading label="Abriendo clase…" lines={6}/></>;
  const { session, lessons, resources } = detail;
  const editable = teaches(session.groupId) && detail.groupActive;
  async function act(action: "start" | "complete" | "cancel" | "restore") {
    if (action === "cancel" && !await confirm({ title: "¿Cancelar esta clase?", body: <p>Queda en el cronograma como cancelada y deja de aparecer en las próximas clases de la sección y de sus estudiantes. Puedes reprogramarla después.</p>, confirm: "Cancelar clase", cancel: "Volver", danger: true })) return;
    setBusy(true);
    try {
      await api(`${path}/${action}`, "POST");
      toast({ message: { start: "Clase en curso. Pasa lista cuando estés listo.", complete: "Clase finalizada. Queda registrada en el cronograma.", cancel: "Clase cancelada.", restore: "Clase reprogramada." }[action] });
      await Promise.all([load(), reload()]);
    } catch (cause) { toast({ tone: "error", message: message(cause) }); }
    finally { setBusy(false); }
  }
  const primary = !editable ? undefined
    : session.status === "planned" ? <PrimaryAction icon="play" busy={busy} onClick={() => void act("start")}>Comenzar clase</PrimaryAction>
    : session.status === "in_progress" ? <PrimaryAction icon="check" busy={busy} onClick={() => void act("complete")}>Finalizar clase</PrimaryAction>
    : session.status === "cancelled" ? <PrimaryAction icon="calendar" busy={busy} onClick={() => void act("restore")}>Reprogramar</PrimaryAction> : undefined;
  const menu: MenuItem[] = editable && session.status === "planned" ? [{ label: "Cancelar clase", icon: "close", danger: true, onSelect: () => void act("cancel") }] : [];
  const modules = [...new Set(lessons.map(lesson => lesson.unitTitle).filter(Boolean))];
  return <>
    <PageHeader crumbs={[...crumbs, { label: sessionDay(session.sessionDate) }]} title={`${sessionDay(session.sessionDate)}${session.startsAt ? `, ${session.startsAt}` : ""}`}
      description={<>{session.groupName}{session.durationMinutes ? ` · ${session.durationMinutes} min` : ""}{modules.length ? ` · ${noun.One}: ${modules.join(", ")}` : ""}{session.taughtByName ? ` · impartió ${session.taughtByName}` : ""}</>}
      meta={classBadge(session, new Date().toLocaleDateString("en-CA"))}
      actions={<>{editable && session.status !== "cancelled" && <Button icon="edit" onClick={() => setEditing(true)}>{session.status === "completed" ? "Editar comentarios" : "Planificar"}</Button>}{menu.length > 0 && <Menu label="Más acciones de la clase" items={menu}/>}</>}
      primary={primary}/>
    {!detail.groupActive && <p className="notice"><Icon name="info" size={18}/>La sección está cerrada: la clase se consulta, pero no se modifica.</p>}
    <div className="class-layout">
      <div className="class-main">
        {session.status === "cancelled" ? <EmptyState icon="calendar" title="Clase cancelada">Reprográmala para planificarla de nuevo y pasar lista.</EmptyState>
          : <Sheet sessionId={session.id} status={session.status} initial={detail.learners} writable={editable} onSaved={async () => { await Promise.all([load(), reload()]); }}/>}
      </div>
      <div className="class-side">
        <Section title={lessons.length > 1 ? `Lecciones de la clase (${lessons.length})` : "Lección"}>
          {lessons.length ? <ol className="class-lessons">{lessons.map(lesson => <li key={lesson.id} className="class-lesson">
            <strong>{lesson.title}</strong>
            <span className="muted small">{lesson.archived ? "Archivada: requiere sustitución" : lesson.currentRevision ? `Publicación ${lesson.currentRevision}` : "Borrador: los estudiantes aún no la ven"}{lesson.revision && lesson.revision !== lesson.currentRevision ? ` · en clase se usó la publicación ${lesson.revision}` : ""}</span>
            {lesson.activities.length > 0 && <ul className="cell-list">{lesson.activities.map((activity, index) => <li key={index}>{activity.title}{activity.minutes ? <span className="muted"> · {activity.minutes} min</span> : null}</li>)}</ul>}
            <div className="button-row">
              {courseLessons.some(item => item.id === lesson.id) && <Link className="button secondary small" href={`/cursos/${course.id}/lecciones/${lesson.id}`}><Icon name="edit" size={16}/>Abrir lección</Link>}
              {lesson.shareCode && <a className="button ghost small" href={`/aprender/${lesson.shareCode}`} target="_blank" rel="noopener"><Icon name="present" size={16}/>Presentar</a>}
            </div>
          </li>)}</ol> : <p className="muted">Sin lecciones. {editable && session.status !== "cancelled" && <button type="button" className="link-button" onClick={() => setEditing(true)}>Planificar la clase</button>}</p>}
        </Section>
        <Section title={`Recursos (${resources.length})`}>
          {resources.length ? <ul className="class-resources">{resources.map(item => <li key={item.id}>
            <button type="button" className="link-button" onClick={() => setPreview(item)}><Icon name={kindIcon[item.kind]} size={16}/>{item.title}</button>
            {!item.available && <StatusBadge tone="warning">No disponible para estudiantes</StatusBadge>}
          </li>)}</ul> : <p className="muted">{lessons.length ? "Las lecciones no usan recursos de la biblioteca." : "Los recursos llegan con las lecciones."}</p>}
          {lessons.length > 0 && editable && <p className="muted small">Se agregan o quitan en cada lección, desde Contenido.</p>}
        </Section>
        <Notes detail={detail} editable={editable && session.status !== "cancelled"} onSaved={load}/>
      </div>
    </div>
    {editing && <PlanDialog session={session} onClose={() => setEditing(false)} onSaved={async () => { setEditing(false); await load(); }}/>}
    {preview && <ResourcePreview item={{ ...preview, courseId: preview.courseId || course.id, content: preview.content || "", status: preview.available ? "published" : "draft", version: 1, updatedAt: "", termIds: [], usedIn: 0, fileId: preview.kind === "file" ? preview.id : undefined }} lessons={[]} onClose={() => setPreview(null)}/>}
  </>;
}

function Notes({ detail, editable, onSaved }: { detail: Detail; editable: boolean; onSaved: () => Promise<void> }) {
  const { course } = useCourse();
  const { toast } = useFeedback();
  const { session } = detail;
  const [notes, setNotes] = useState(session.notes), [busy, setBusy] = useState(false);
  useEffect(() => setNotes(session.notes), [session.version]);
  const dirty = notes.trim() !== session.notes;
  useUnsavedChanges(dirty);
  async function save() {
    setBusy(true);
    try {
      await api(`/courses/${course.id}/sessions/${session.id}`, "PUT", { sessionDate: session.sessionDate, startsAt: session.startsAt ?? null, durationMinutes: session.durationMinutes ?? null, lessonIds: session.lessons.map(lesson => lesson.id), notes, version: session.version });
      toast({ message: "Comentarios guardados." }); await onSaved();
    } catch (cause) { toast({ tone: "error", message: message(cause) }); }
    finally { setBusy(false); }
  }
  return <Section title="Comentarios">
    {editable ? <div className="stack">
      <label htmlFor="class-notes" className="sr-only">Comentarios de la clase</label>
      <textarea id="class-notes" rows={4} maxLength={2000} value={notes} onChange={event => setNotes(event.target.value)} placeholder="Qué se trabajó, qué quedó pendiente para la próxima clase"/>
      <div className="button-row"><button type="button" className="button secondary small" disabled={!dirty || busy} onClick={() => void save()}>{busy ? "Guardando…" : "Guardar comentarios"}</button><span className="muted small">Solo los ve el equipo docente. Aparecen en el cronograma.</span></div>
    </div> : session.notes ? <p className="preserve-lines">{session.notes}</p> : <p className="muted">Sin comentarios.</p>}
  </Section>;
}

function Sheet({ sessionId, status, initial, writable, onSaved }: { sessionId: string; status: ClassStatus; initial: Row[]; writable: boolean; onSaved: () => Promise<void> }) {
  const { course, configurable } = useCourse();
  const { base } = useSection();
  const { toast } = useFeedback();
  const [rows, setRows] = useState<Row[]>(initial), [saved, setSaved] = useState<Row[]>(initial), [busy, setBusy] = useState(false);
  useEffect(() => { setRows(initial); setSaved(initial); }, [initial]);
  const dirty = rows.some((row, index) => row.status !== saved[index]?.status);
  useUnsavedChanges(dirty);
  const pending = rows.filter(row => row.status === "unmarked").length;
  const complete = saved.length > 0 && saved.every(row => row.status !== "unmarked");
  const set = (id: string, value: Mark) => setRows(current => current.map(row => row.learnerId === id ? { ...row, status: value } : row));
  const counts = markLabels.map(([value, label]) => [label, rows.filter(row => row.status === value).length] as const);
  async function save() {
    setBusy(true);
    try {
      await api(`/courses/${course.id}/sessions/${sessionId}/attendance`, "PUT", { marks: rows.map(row => ({ learnerId: row.learnerId, status: row.status })) });
      setSaved(rows);
      toast({ message: `Asistencia guardada: ${counts.filter(([, count]) => count).map(([label, count]) => `${count} ${label.toLowerCase()}`).join(", ")}.` });
      await onSaved();
    } catch (cause) { toast({ tone: "error", message: `${message(cause)} Tus marcas siguen en pantalla; vuelve a guardar.` }); }
    finally { setBusy(false); }
  }
  const title = status === "completed" ? "Asistencia registrada" : "Pasar lista";
  return <section className="sheet" aria-labelledby="sheet-title">
    <header className="sheet-header">
      <div><h2 id="sheet-title">{title}</h2><p className="muted">{status === "completed" ? "Puedes corregir una marca y volver a guardar." : status === "planned" ? "Al guardar la lista, la clase queda en curso." : "Marca a cada estudiante y guarda antes de finalizar."}</p></div>
      <StatusBadge tone={dirty ? "warning" : complete ? "success" : "neutral"}>{dirty ? "Cambios sin guardar" : complete ? "Guardada" : "Sin registrar"}</StatusBadge>
    </header>
    {!rows.length ? <EmptyState compact icon="users" title="Esta sección no tiene estudiantes" action={configurable && <Link className="button secondary" href={`${base}/estudiantes`}>Asignar estudiantes</Link>}>{configurable ? undefined : "Administración asigna los estudiantes de la sección."}</EmptyState> : <>
      <p className="attendance-counts" aria-live="polite">{counts.map(([label, count]) => <span key={label}><strong>{count}</strong> {label.toLowerCase()}</span>)}</p>
      {writable && pending > 0 && <button type="button" className="button ghost small" onClick={() => setRows(rows.map(row => row.status === "unmarked" ? { ...row, status: "present" } : row))}><Icon name="check" size={16}/>Marcar {plural(pending, "pendiente", "pendientes")} como presente</button>}
      <ol className="attendance-list">{rows.map((row, index) => <li key={row.learnerId}>
        <span className="roster-number" aria-hidden="true">{String(index + 1).padStart(2, "0")}</span>
        <strong id={`learner-${row.learnerId}`}>{row.displayName}</strong>
        <div className="mark-group" role="radiogroup" aria-labelledby={`learner-${row.learnerId}`}>
          {markLabels.map(([value, label]) => <label key={value} className={`mark ${value}`}><input type="radio" name={`mark-${row.learnerId}`} value={value} checked={row.status === value} disabled={!writable} onChange={() => set(row.learnerId, value)}/><span>{label}</span></label>)}
        </div>
      </li>)}</ol>
      {writable && <div className="sheet-footer">
        <p className="muted" aria-live="polite">{pending ? `Faltan ${plural(pending, "estudiante", "estudiantes")} por marcar.` : "Todos los estudiantes tienen un estado."}</p>
        <button type="button" className="button primary" disabled={busy || pending > 0 || !dirty} onClick={() => void save()}>{busy ? "Guardando…" : "Guardar asistencia"}</button>
      </div>}
    </>}
  </section>;
}
