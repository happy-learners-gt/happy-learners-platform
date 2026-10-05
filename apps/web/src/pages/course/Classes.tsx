import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import type { ClassResource, ClassSession, ClassStatus, Course, Material } from "@happy-learners/contracts";
import { classStatusLabels } from "@happy-learners/domain";
import { api, message } from "../../api";
import { Link, useNavigation, useUnsavedChanges } from "../../navigation";
import { matches, plural, sessionDay } from "../../model";
import { Modal, useFeedback } from "../../ui/feedback";
import { Icon } from "../../ui/icons";
import { Menu } from "../../ui/Menu";
import type { MenuItem } from "../../ui/Menu";
import { Button, EmptyState, ErrorState, Field, Loading, PageHeader, PrimaryAction, Section, StatTiles, StatusBadge } from "../../ui/primitives";
import type { Tone } from "../../ui/primitives";
import { ResourcePreview } from "../resources";
import { useCourse } from "./context";
import type { GroupView } from "./Groups";

type Mark = "unmarked" | "present" | "late" | "absent" | "excused";
type Row = { learnerId: string; displayName: string; status: Mark };
type Detail = { session: ClassSession & { notes: string; resourceIds: string[] }; lesson: { id: string; title: string; revision: number; archived: boolean; shareCode: string | null } | null; resources: ClassResource[]; learners: Row[]; groupActive: boolean };
const markLabels: [Exclude<Mark, "unmarked">, string][] = [["present", "Presente"], ["late", "Tarde"], ["absent", "Ausente"], ["excused", "Justificada"]];
const statusTone: Record<ClassStatus, Tone> = { planned: "info", in_progress: "warning", completed: "success", cancelled: "neutral" };

export const classTime = (session: Pick<ClassSession, "startsAt" | "durationMinutes">) => [session.startsAt, session.durationMinutes ? `${session.durationMinutes} min` : ""].filter(Boolean).join(" · ");
/** A planned class whose day has passed was not recorded: it shows as pending, not as planned. */
export function classBadge(session: Pick<ClassSession, "status" | "sessionDate">, today: string) {
  if (session.status === "planned" && session.sessionDate < today) return <StatusBadge tone="danger">Sin registrar</StatusBadge>;
  return <StatusBadge tone={statusTone[session.status]}>{session.status === "planned" && session.sessionDate === today ? "Hoy" : classStatusLabels[session.status]}</StatusBadge>;
}
const rate = (session: ClassSession) => session.marked ? Math.round(100 * Number(session.attended) / Number(session.marked)) : null;

export function Classes({ sessionId }: { sessionId?: string }) {
  return sessionId ? <ClassDetail key={sessionId} id={sessionId}/> : <ClassList/>;
}

function ClassList() {
  const { course, writable } = useCourse();
  const { url, navigate } = useNavigation();
  const [groups, setGroups] = useState<GroupView[] | null>(null), [sessions, setSessions] = useState<ClassSession[]>([]), [today, setToday] = useState(""), [error, setError] = useState("");
  const [planning, setPlanning] = useState(url.searchParams.get("nueva") === "1");
  const [all, setAll] = useState(false);
  const view = url.searchParams.get("vista") === "historial" ? "history" : "upcoming", groupFilter = url.searchParams.get("grupo") || "";
  const base = `/courses/${course.id}`, page = `/cursos/${course.id}/clases`;
  async function load() {
    setError("");
    try {
      const [g, s] = await Promise.all([api<{ groups: GroupView[] }>(`${base}/groups`), api<{ sessions: ClassSession[]; today: string }>(`${base}/sessions`)]);
      setGroups(g.groups); setSessions(s.sessions); setToday(s.today);
    } catch (cause) { setError(message(cause)); }
  }
  useEffect(() => { if (course.status === "active") void load(); }, [course.id]);
  useEffect(() => setAll(false), [view, groupFilter]);
  function filter(key: string, value: string) { const next = new URL(url); if (value) next.searchParams.set(key, value); else next.searchParams.delete(key); next.searchParams.delete("nueva"); navigate(next.pathname + next.search, true); }
  const activeGroups = (groups || []).filter(group => group.status === "active");
  const header = <PageHeader crumbs={[{ label: "Cursos", href: "/cursos" }, { label: course.title, href: `/cursos/${course.id}` }, { label: "Clases" }]} title="Clases"
    description="Planifica cada clase con su lección y sus recursos. Al impartirla pasas lista y la finalizas desde la misma página."
    primary={writable && activeGroups.length > 0 && <PrimaryAction icon="plus" onClick={() => setPlanning(true)}>Planificar clase</PrimaryAction>}/>;
  if (course.status !== "active") return <>{header}<EmptyState icon="archive" title="Curso archivado">Restaura el curso desde Configuración para consultar sus clases.</EmptyState></>;
  if (error) return <>{header}<ErrorState error={error} retry={() => void load()}/></>;
  if (!groups) return <>{header}<Loading label="Cargando clases…" lines={6}/></>;
  if (!activeGroups.length && !sessions.length) return <>{header}<EmptyState icon="users" title="Primero crea un grupo" action={<Link className="button primary" href={`/cursos/${course.id}/grupos`}>Ir a Grupos</Link>}>Cada clase pertenece a un grupo. Crea uno y agrega a sus participantes.</EmptyState></>;
  const ofGroup = sessions.filter(session => !groupFilter || session.groupId === groupFilter);
  const upcoming = ofGroup.filter(session => session.status === "in_progress" || (session.status === "planned" && session.sessionDate >= today))
    .sort((a, b) => a.sessionDate.localeCompare(b.sessionDate) || (a.startsAt || "").localeCompare(b.startsAt || ""));
  const history = ofGroup.filter(session => !upcoming.includes(session));
  const taught = history.filter(session => session.status === "completed");
  const marked = taught.reduce((sum, session) => sum + Number(session.marked || 0), 0), attended = taught.reduce((sum, session) => sum + Number(session.attended || 0), 0);
  const pendingCount = history.filter(session => session.status === "planned").length;
  const full = view === "upcoming" ? upcoming : history, list = all ? full : full.slice(0, 10);
  return <>
    {header}
    <StatTiles className="class-stats" items={[
      { label: "Próximas", value: upcoming.length, icon: "calendar", hue: "sky" },
      { label: "Impartidas", value: taught.length, icon: "check", hue: "green" },
      { label: "Asistencia promedio", value: marked ? `${Math.round(100 * attended / marked)} %` : "—", icon: "users", hue: "violet" },
      { label: "Sin registrar", value: pendingCount, icon: "alert", hue: "coral" },
    ]}/>
    <div className="toolbar" role="group" aria-label="Filtrar clases">
      <fieldset className="segmented"><legend className="sr-only">Mostrar</legend>
        <label><input type="radio" name="class-view" checked={view === "upcoming"} onChange={() => filter("vista", "")}/><span>Próximas ({upcoming.length})</span></label>
        <label><input type="radio" name="class-view" checked={view === "history"} onChange={() => filter("vista", "historial")}/><span>Historial ({history.length})</span></label>
      </fieldset>
      <label className="select-inline"><span>Grupo</span><select value={groupFilter} onChange={event => filter("grupo", event.target.value)}><option value="">Todos</option>{groups.map(group => <option key={group.id} value={group.id}>{group.name}{group.status === "archived" ? " (cerrado)" : ""}</option>)}</select></label>
    </div>
    {list.length ? <ol className="class-list" aria-label={view === "upcoming" ? "Próximas clases" : "Historial de clases"}>{list.map(session => <li key={session.id}>
      <span className="date-chip" aria-hidden="true"><strong>{session.sessionDate.slice(8)}</strong>{sessionDay(session.sessionDate, "short").replace(/^\d+\s*/, "")}</span>
      <div className="class-row-main">
        <Link href={`${page}/${session.id}`} className="class-row-title">{sessionDay(session.sessionDate)}{session.startsAt ? `, ${session.startsAt}` : ""}<span className="sr-only"> · {session.groupName}</span></Link>
        <span className="muted">{session.groupName} · {session.lessonTitle || "Sin lección"}{session.durationMinutes ? ` · ${session.durationMinutes} min` : ""}</span>
        {session.status === "completed" && <span className="muted small">{session.attended} de {session.marked} presentes{rate(session) !== null ? ` (${rate(session)} %)` : ""}{session.lessonRevision ? ` · publicación ${session.lessonRevision}` : ""}{session.taughtByName ? ` · impartió ${session.taughtByName}` : ""}</span>}
      </div>
      {classBadge(session, today)}
    </li>)}</ol>
      : <EmptyState icon="calendar" title={view === "upcoming" ? "No hay clases próximas" : "Aún no hay clases en el historial"} action={writable && view === "upcoming" && activeGroups.length > 0 && <PrimaryAction icon="plus" onClick={() => setPlanning(true)}>Planificar clase</PrimaryAction>}>
        {view === "upcoming" ? "Planifica la siguiente clase con su fecha, lección y recursos." : "Las clases impartidas, canceladas o sin registrar aparecerán aquí."}
      </EmptyState>}
    {full.length > list.length && <Button variant="ghost" icon="chevronDown" onClick={() => setAll(true)}>Mostrar {full.length - list.length} más</Button>}
    {planning && <PlanDialog groups={activeGroups} initialGroup={url.searchParams.get("grupo") || ""} onClose={() => { setPlanning(false); if (url.searchParams.has("nueva")) filter("nueva", ""); }}
      onSaved={async id => { setPlanning(false); navigate(`${page}/${id}`); }}/>}
  </>;
}

type PlanValues = { groupId?: string; sessionDate: string; startsAt: string; durationMinutes: string; lessonId: string; notes: string; resourceIds: string[] };
/** Plans a new class or edits the plan of an existing one. */
function PlanDialog({ groups, initialGroup, detail, onClose, onSaved }: { groups?: GroupView[]; initialGroup?: string; detail?: Detail; onClose: () => void; onSaved: (id: string) => Promise<void> }) {
  const { course, lessons } = useCourse();
  const { toast } = useFeedback();
  const session = detail?.session;
  const [values, setValues] = useState<PlanValues>(() => session
    ? { sessionDate: session.sessionDate, startsAt: session.startsAt || "", durationMinutes: session.durationMinutes ? String(session.durationMinutes) : "", lessonId: session.lessonId || "", notes: session.notes, resourceIds: session.resourceIds }
    : { groupId: groups?.some(group => group.id === initialGroup) ? initialGroup : groups?.[0]?.id, sessionDate: new Date().toLocaleDateString("en-CA"), startsAt: "", durationMinutes: "45", lessonId: "", notes: "", resourceIds: [] });
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  const set = (patch: Partial<PlanValues>) => setValues(current => ({ ...current, ...patch }));
  const available = lessons.filter(lesson => lesson.status !== "archived" || lesson.id === session?.lessonId);
  async function submit(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError("");
    const body = { ...values, durationMinutes: values.durationMinutes ? Number(values.durationMinutes) : null, ...(session ? { version: session.version } : {}) };
    try {
      if (session) { await api(`/courses/${course.id}/sessions/${session.id}`, "PUT", body); toast({ message: "Planificación guardada." }); await onSaved(session.id); }
      else { const { id } = await api<{ id: string }>(`/courses/${course.id}/sessions`, "POST", body); toast({ message: "Clase planificada. Ábrela el día de la clase para pasar lista." }); await onSaved(id); }
    } catch (cause) { setError(message(cause)); setBusy(false); }
  }
  return <Modal title={session ? "Editar planificación" : "Planificar clase"} onClose={onClose} wide>
    <form className="stack" onSubmit={submit}>
      {error && <p className="form-alert" role="alert"><Icon name="alert" size={18}/>{error}</p>}
      <fieldset disabled={busy} className="stack">
        {!session && <Field label="Grupo"><select value={values.groupId} onChange={event => set({ groupId: event.target.value })} required>{groups!.map(group => <option key={group.id} value={group.id}>{group.name} · {plural(group.learnerCount, "participante", "participantes")}</option>)}</select></Field>}
        <div className="field-row">
          <Field label="Fecha"><input type="date" value={values.sessionDate} onChange={event => set({ sessionDate: event.target.value })} required/></Field>
          <Field label="Hora" optional><input type="time" value={values.startsAt} onChange={event => set({ startsAt: event.target.value })}/></Field>
          <Field label="Duración (min)" optional><input type="number" min={5} max={480} step={5} value={values.durationMinutes} onChange={event => set({ durationMinutes: event.target.value })}/></Field>
        </div>
        <Field label="Lección" optional hint="Los estudiantes la ven cuando está publicada.">
          <select value={values.lessonId} onChange={event => set({ lessonId: event.target.value })}><option value="">Sin lección</option>{available.map(lesson => <option key={lesson.id} value={lesson.id}>{lesson.title}{lesson.revision ? "" : " (borrador)"}</option>)}</select>
        </Field>
        <ResourcePicker selected={values.resourceIds} onChange={resourceIds => set({ resourceIds })}/>
        <Field label="Notas para el equipo" optional hint="Solo las ve el equipo docente. No escribas datos personales de los participantes."><textarea rows={3} maxLength={2000} value={values.notes} onChange={event => set({ notes: event.target.value })}/></Field>
        <div className="modal-actions"><button type="button" className="button ghost" onClick={onClose}>Cancelar</button><button className="button primary">{busy ? "Guardando…" : session ? "Guardar planificación" : "Planificar clase"}</button></div>
      </fieldset>
    </form>
  </Modal>;
}

type PickerItem = { id: string; title: string; kind: Material["kind"]; courseTitle: string };
/** Chooses resources of the library in order: this course first, then, on request, the rest of the organization. */
function ResourcePicker({ selected, onChange }: { selected: string[]; onChange: (ids: string[]) => void }) {
  const { course, materials, legacyResources } = useCourse();
  const own: PickerItem[] = [...materials.filter(item => item.status !== "archived").map(item => ({ id: item.id, title: item.title, kind: item.kind, courseTitle: course.title })),
    ...legacyResources.filter(item => item.status !== "archived").map(item => ({ id: item.id, title: item.title, kind: (item.kind === "link" ? "link" : "text") as Material["kind"], courseTitle: "Recursos generales" }))];
  const [others, setOthers] = useState<PickerItem[] | null>(null), [query, setQuery] = useState("");
  async function loadOthers() {
    const { courses } = await api<{ courses: Course[] }>("/courses");
    const lists = await Promise.all(courses.filter(item => item.id !== course.id && item.status === "active").map(item => api<{ materials: Material[] }>(`/courses/${item.id}/materials`).then(result => result.materials.filter(material => material.status !== "archived").map(material => ({ id: material.id, title: material.title, kind: material.kind, courseTitle: item.title })))));
    setOthers(lists.flat());
  }
  const items = [...own, ...(others || [])];
  const visible = items.filter(item => selected.includes(item.id) || matches(query, item.title, item.courseTitle));
  const toggle = (id: string) => onChange(selected.includes(id) ? selected.filter(value => value !== id) : [...selected, id]);
  return <fieldset className="resource-picker">
    <legend>Recursos de la biblioteca <span className="muted">({selected.length} {selected.length === 1 ? "elegido" : "elegidos"})</span></legend>
    <div className="search-field"><Icon name="search" size={18}/><label htmlFor="picker-search" className="sr-only">Buscar recursos</label><input id="picker-search" type="search" value={query} onChange={event => setQuery(event.target.value)} placeholder="Buscar por título o curso"/></div>
    {visible.length ? <ul>{visible.map(item => <li key={item.id}><label><input type="checkbox" checked={selected.includes(item.id)} onChange={() => toggle(item.id)}/><span><strong>{item.title}</strong><span className="muted small">{{ text: "Texto", link: "Enlace", file: "Documento" }[item.kind]} · {item.courseTitle}</span></span></label></li>)}</ul>
      : <p className="muted small">{items.length ? "Ningún recurso coincide con la búsqueda." : "La biblioteca de este curso está vacía."} <Link href={`/cursos/${course.id}/biblioteca`}>Agregar recursos</Link></p>}
    {others === null && <Button variant="ghost" className="small" icon="library" onClick={() => void loadOthers().catch(() => setOthers([]))}>Mostrar recursos de otros cursos</Button>}
  </fieldset>;
}

function ClassDetail({ id }: { id: string }) {
  const { course, writable, lessons } = useCourse();
  const { toast, confirm } = useFeedback();
  const [detail, setDetail] = useState<Detail | null>(null), [error, setError] = useState(""), [busy, setBusy] = useState(false), [editing, setEditing] = useState(false);
  const [preview, setPreview] = useState<ClassResource | null>(null);
  const path = `/courses/${course.id}/sessions/${id}`, page = `/cursos/${course.id}/clases`;
  async function load() {
    setError("");
    try { setDetail(await api<Detail>(path)); } catch (cause) { setError(message(cause)); }
  }
  useEffect(() => { void load(); }, [id]);
  const crumbs = [{ label: "Cursos", href: "/cursos" }, { label: course.title, href: `/cursos/${course.id}` }, { label: "Clases", href: page }];
  if (error) return <><PageHeader crumbs={crumbs} title="Clase"/>{/404/.test(error) || error.includes("no está disponible") ? <EmptyState icon="calendar" title="No encontramos esa clase" action={<Link className="button secondary" href={page}>Ver todas las clases</Link>}/> : <ErrorState error={error} retry={() => void load()}/>}</>;
  if (!detail) return <><PageHeader crumbs={crumbs} title={<span className="skeleton-title">Clase</span>}/><Loading label="Abriendo clase…" lines={6}/></>;
  const { session, lesson, resources } = detail;
  const editable = writable && detail.groupActive;
  async function act(action: "start" | "complete" | "cancel" | "restore") {
    if (action === "cancel" && !await confirm({ title: "¿Cancelar esta clase?", body: <p>Deja de aparecer en las próximas clases del grupo y de sus estudiantes. Puedes reprogramarla después.</p>, confirm: "Cancelar clase", cancel: "Volver", danger: true })) return;
    setBusy(true);
    try {
      await api(`${path}/${action}`, "POST");
      toast({ message: { start: "Clase en curso. Pasa lista cuando estés listo.", complete: "Clase finalizada. Su registro queda en el historial.", cancel: "Clase cancelada.", restore: "Clase reprogramada." }[action] });
      await load();
    } catch (cause) { toast({ tone: "error", message: message(cause) }); }
    finally { setBusy(false); }
  }
  const primary = !editable ? undefined
    : session.status === "planned" ? <PrimaryAction icon="play" busy={busy} onClick={() => void act("start")}>Comenzar clase</PrimaryAction>
    : session.status === "in_progress" ? <PrimaryAction icon="check" busy={busy} onClick={() => void act("complete")}>Finalizar clase</PrimaryAction>
    : session.status === "cancelled" ? <PrimaryAction icon="calendar" busy={busy} onClick={() => void act("restore")}>Reprogramar</PrimaryAction> : undefined;
  const menu: MenuItem[] = editable && session.status === "planned" ? [{ label: "Cancelar clase", icon: "close", danger: true, onSelect: () => void act("cancel") }] : [];
  const lessonState = lessons.find(item => item.id === session.lessonId);
  return <>
    <PageHeader crumbs={[...crumbs, { label: sessionDay(session.sessionDate) }]} title={`${sessionDay(session.sessionDate)}${session.startsAt ? `, ${session.startsAt}` : ""}`}
      description={<>{session.groupName}{session.durationMinutes ? ` · ${session.durationMinutes} min` : ""}{session.taughtByName ? ` · impartió ${session.taughtByName}` : ""}</>}
      meta={classBadge(session, new Date().toLocaleDateString("en-CA"))}
      actions={<>{editable && session.status !== "cancelled" && <Button icon="edit" onClick={() => setEditing(true)}>Editar planificación</Button>}{menu.length > 0 && <Menu label="Más acciones de la clase" items={menu}/>}</>}
      primary={primary}/>
    {!detail.groupActive && <p className="notice"><Icon name="info" size={18}/>El grupo está cerrado: la clase se consulta, pero no se modifica.</p>}
    <div className="class-layout">
      <div className="class-main">
        {session.status === "cancelled" ? <EmptyState icon="calendar" title="Clase cancelada">Reprográmala para planificarla de nuevo y pasar lista.</EmptyState>
          : <Sheet sessionId={session.id} status={session.status} initial={detail.learners} writable={editable} groupId={session.groupId} onSaved={load}/>}
      </div>
      <div className="class-side">
        <Section title="Lección">
          {lesson ? <div className="class-lesson">
            <strong>{lesson.title}</strong>
            <span className="muted small">{lesson.archived ? "Archivada" : lesson.revision ? `Publicación ${lesson.revision}` : "Borrador: los estudiantes aún no la ven"}{session.lessonRevision && session.lessonRevision !== lesson.revision ? ` · en clase se usó la publicación ${session.lessonRevision}` : ""}</span>
            <div className="button-row">
              {lessonState && <Link className="button secondary small" href={`/cursos/${course.id}/lecciones/${lesson.id}`}><Icon name="edit" size={16}/>Abrir lección</Link>}
              {lesson.shareCode && <a className="button ghost small" href={`/aprender/${lesson.shareCode}`} target="_blank" rel="noopener"><Icon name="present" size={16}/>Presentar</a>}
            </div>
          </div> : <p className="muted">Sin lección. {editable && session.status !== "cancelled" && <button type="button" className="link-button" onClick={() => setEditing(true)}>Elegir una lección</button>}</p>}
        </Section>
        <Section title={`Recursos (${resources.length})`}>
          {resources.length ? <ul className="class-resources">{resources.map(item => <li key={item.id}>
            <button type="button" className="link-button" onClick={() => setPreview(item)}><Icon name={item.kind === "link" ? "link" : item.kind === "file" ? "file" : "text"} size={16}/>{item.title}</button>
            {!item.available && <StatusBadge tone="warning">No disponible para estudiantes</StatusBadge>}
          </li>)}</ul> : <p className="muted">Sin recursos. {editable && session.status !== "cancelled" && <button type="button" className="link-button" onClick={() => setEditing(true)}>Agregar desde la biblioteca</button>}</p>}
        </Section>
        <Notes detail={detail} editable={editable && session.status !== "cancelled"} onSaved={load}/>
      </div>
    </div>
    {editing && <PlanDialog detail={detail} onClose={() => setEditing(false)} onSaved={async () => { setEditing(false); await load(); }}/>}
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
      await api(`/courses/${course.id}/sessions/${session.id}`, "PUT", { sessionDate: session.sessionDate, startsAt: session.startsAt, durationMinutes: session.durationMinutes, lessonId: session.lessonId, resourceIds: session.resourceIds, notes, version: session.version });
      toast({ message: "Notas guardadas." }); await onSaved();
    } catch (cause) { toast({ tone: "error", message: message(cause) }); }
    finally { setBusy(false); }
  }
  return <Section title="Notas de la clase">
    {editable ? <div className="stack">
      <label htmlFor="class-notes" className="sr-only">Notas de la clase</label>
      <textarea id="class-notes" rows={4} maxLength={2000} value={notes} onChange={event => setNotes(event.target.value)} placeholder="Qué se trabajó, qué quedó pendiente para la próxima clase"/>
      <div className="button-row"><button type="button" className="button secondary small" disabled={!dirty || busy} onClick={() => void save()}>{busy ? "Guardando…" : "Guardar notas"}</button><span className="muted small">Solo las ve el equipo docente.</span></div>
    </div> : session.notes ? <p className="preserve-lines">{session.notes}</p> : <p className="muted">Sin notas.</p>}
  </Section>;
}

function Sheet({ sessionId, status, initial, writable, groupId, onSaved }: { sessionId: string; status: ClassStatus; initial: Row[]; writable: boolean; groupId: string; onSaved: () => Promise<void> }) {
  const { course } = useCourse();
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
      <div><h2 id="sheet-title">{title}</h2><p className="muted">{status === "completed" ? "Puedes corregir una marca y volver a guardar." : status === "planned" ? "Al guardar la lista, la clase queda en curso." : "Marca a cada participante y guarda antes de finalizar."}</p></div>
      <StatusBadge tone={dirty ? "warning" : complete ? "success" : "neutral"}>{dirty ? "Cambios sin guardar" : complete ? "Guardada" : "Sin registrar"}</StatusBadge>
    </header>
    {!rows.length ? <EmptyState compact icon="users" title="Este grupo no tiene participantes" action={writable && <Link className="button secondary" href={`/cursos/${course.id}/grupos#grupo-${groupId}`}>Agregar participantes</Link>}/> : <>
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
        <p className="muted" aria-live="polite">{pending ? `Faltan ${plural(pending, "participante", "participantes")} por marcar.` : "Todos los participantes tienen un estado."}</p>
        <button type="button" className="button primary" disabled={busy || pending > 0 || !dirty} onClick={() => void save()}>{busy ? "Guardando…" : "Guardar asistencia"}</button>
      </div>}
    </>}
  </section>;
}
