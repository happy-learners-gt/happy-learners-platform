import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import type { ClassSession } from "@happy-learners/contracts";
import { api, message } from "../../api";
import { Link, useNavigation, useUnsavedChanges } from "../../navigation";
import { plural, sessionDay, today } from "../../model";
import { Modal, useFeedback } from "../../ui/feedback";
import { Icon } from "../../ui/icons";
import { EmptyState, ErrorState, Field, Loading, PageHeader, PrimaryAction, StatusBadge } from "../../ui/primitives";
import { useCourse } from "./context";
import type { GroupView } from "./Groups";

type Mark = "unmarked" | "present" | "late" | "absent" | "excused";
type Row = { learnerId: string; displayName: string; status: Mark };
const marks: [Exclude<Mark, "unmarked">, string][] = [["present", "Presente"], ["late", "Tarde"], ["absent", "Ausente"], ["excused", "Justificada"]];

export function Attendance({ sessionId }: { sessionId?: string }) {
  const { course, lessons, writable } = useCourse();
  const { url, navigate } = useNavigation();
  const [groups, setGroups] = useState<GroupView[] | null>(null), [sessions, setSessions] = useState<ClassSession[]>([]), [error, setError] = useState("");
  const [creating, setCreating] = useState(url.searchParams.get("nueva") === "1");
  const base = `/courses/${course.id}`, page = `/cursos/${course.id}/asistencia`;
  async function load() {
    setError("");
    try { const [g, s] = await Promise.all([api<{ groups: GroupView[] }>(`${base}/groups`), api<{ sessions: ClassSession[] }>(`${base}/sessions`)]); setGroups(g.groups); setSessions(s.sessions); }
    catch (cause) { setError(message(cause)); }
  }
  useEffect(() => { if (course.status === "active") void load(); }, [course.id]);
  const selected = sessions.find(session => session.id === sessionId);
  const activeGroups = (groups || []).filter(group => group.status === "active");
  const header = <PageHeader crumbs={[{ label: "Cursos", href: "/cursos" }, { label: course.title, href: `/cursos/${course.id}` }, { label: "Asistencia", href: sessionId ? page : undefined }, ...(selected ? [{ label: sessionDay(selected.sessionDate) }] : [])]}
    title="Asistencia" description="Registra la clase del día y marca a cada participante. Solo el equipo docente del curso ve estos registros."
    primary={writable && groups !== null && activeGroups.length > 0 && sessions.length > 0 && <PrimaryAction icon="plus" onClick={() => setCreating(true)}>Registrar clase</PrimaryAction>}/>;
  if (course.status !== "active") return <>{header}<EmptyState icon="archive" title="Curso archivado">Restaura el curso desde Configuración para registrar asistencia.</EmptyState></>;
  if (error) return <>{header}<ErrorState error={error} retry={() => void load()}/></>;
  if (!groups) return <>{header}<Loading label="Cargando clases…" lines={5}/></>;
  if (!activeGroups.length) return <>{header}<EmptyState icon="users" title="Primero crea un grupo" action={<Link className="button primary" href={`/cursos/${course.id}/grupos`}>Ir a Grupos</Link>}>La asistencia se registra por grupo. Crea uno y agrega a sus participantes.</EmptyState></>;
  return <>
    {header}
    <div className="attendance-layout">
      <nav className="session-nav" aria-label="Clases registradas">
        <h2>Clases</h2>
        {sessions.length ? <ul>{sessions.map(session => <li key={session.id}><Link href={`${page}/${session.id}`} aria-current={session.id === sessionId ? "page" : undefined}>
          <strong>{sessionDay(session.sessionDate)}</strong><span>{session.groupName}{session.sessionDate === today() ? " · Hoy" : ""}</span>
        </Link></li>)}</ul> : <p className="muted">Aún no hay clases registradas.</p>}
      </nav>
      <div className="session-detail">
        {selected ? <Sheet key={selected.id} session={selected} lessonTitle={lessons.find(lesson => lesson.id === selected.lessonId)?.title} writable={writable}/>
          : sessionId ? <EmptyState compact icon="calendar" title="No encontramos esa clase" action={<Link className="button secondary" href={page}>Ver todas las clases</Link>}/>
          : <EmptyState icon="calendar" title={sessions.length ? "Elige una clase" : "Registra tu primera clase"} action={writable && <PrimaryAction icon="plus" onClick={() => setCreating(true)}>Registrar clase</PrimaryAction>}>{sessions.length ? "Selecciona una fecha de la lista para revisar o corregir la asistencia." : "Elige el grupo y la fecha. Después marcarás a cada participante."}</EmptyState>}
      </div>
    </div>
    {creating && <NewSession groups={activeGroups} initialGroup={url.searchParams.get("grupo") || ""} lessons={lessons.filter(lesson => lesson.revision && lesson.status !== "archived").map(lesson => ({ id: lesson.id, title: lesson.title }))}
      onClose={() => setCreating(false)} onCreate={async id => { await load(); setCreating(false); navigate(`${page}/${id}`, true); }}/>}
  </>;
}

function NewSession({ groups, initialGroup, lessons, onClose, onCreate }: { groups: GroupView[]; initialGroup: string; lessons: { id: string; title: string }[]; onClose: () => void; onCreate: (id: string) => Promise<void> }) {
  const { course } = useCourse();
  const { toast } = useFeedback();
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError("");
    try {
      const { id } = await api<{ id: string }>(`/courses/${course.id}/sessions`, "POST", Object.fromEntries(new FormData(event.currentTarget)));
      toast({ message: "Clase registrada. Marca la asistencia de cada participante." });
      await onCreate(id);
    } catch (cause) { setError(message(cause)); setBusy(false); }
  }
  return <Modal title="Registrar clase" onClose={onClose}>
    <form className="stack" onSubmit={submit}>
      {error && <p className="form-alert" role="alert"><Icon name="alert" size={18}/>{error}</p>}
      <fieldset disabled={busy} className="stack">
        <Field label="Grupo"><select name="groupId" required defaultValue={groups.some(group => group.id === initialGroup) ? initialGroup : groups[0]?.id}>{groups.map(group => <option key={group.id} value={group.id}>{group.name} · {plural(group.learnerCount, "participante", "participantes")}</option>)}</select></Field>
        <Field label="Fecha"><input name="sessionDate" type="date" required defaultValue={today()}/></Field>
        <Field label="Lección" optional hint="Solo lecciones publicadas."><select name="lessonId" defaultValue=""><option value="">Sin lección vinculada</option>{lessons.map(lesson => <option key={lesson.id} value={lesson.id}>{lesson.title}</option>)}</select></Field>
        <div className="modal-actions"><button type="button" className="button ghost" onClick={onClose}>Cancelar</button><button className="button primary">{busy ? "Registrando…" : "Registrar y pasar lista"}</button></div>
      </fieldset>
    </form>
  </Modal>;
}

function Sheet({ session, lessonTitle, writable }: { session: ClassSession; lessonTitle?: string; writable: boolean }) {
  const { course } = useCourse();
  const { toast } = useFeedback();
  const [rows, setRows] = useState<Row[] | null>(null), [saved, setSaved] = useState<Row[]>([]), [error, setError] = useState(""), [busy, setBusy] = useState(false);
  const path = `/courses/${course.id}/sessions/${session.id}/attendance`;
  async function load() {
    setError("");
    try { const { learners } = await api<{ learners: Row[] }>(path); setRows(learners); setSaved(learners); }
    catch (cause) { setError(message(cause)); }
  }
  useEffect(() => { void load(); }, [session.id]);
  const dirty = !!rows && rows.some((row, index) => row.status !== saved[index]?.status);
  useUnsavedChanges(dirty);
  if (error) return <ErrorState error={error} retry={() => void load()}/>;
  if (!rows) return <Loading label="Cargando lista…" lines={5}/>;
  const pending = rows.filter(row => row.status === "unmarked").length;
  const complete = saved.length > 0 && saved.every(row => row.status !== "unmarked");
  const set = (id: string, status: Mark) => setRows(current => current!.map(row => row.learnerId === id ? { ...row, status } : row));
  async function save() {
    setBusy(true);
    try {
      await api(path, "PUT", { marks: rows!.map(row => ({ learnerId: row.learnerId, status: row.status })) });
      setSaved(rows!);
      const summary = marks.map(([value, label]) => [label, rows!.filter(row => row.status === value).length] as const).filter(([, count]) => count).map(([label, count]) => `${count} ${label.toLowerCase()}`).join(", ");
      toast({ message: `Asistencia guardada: ${summary}.` });
    } catch (cause) { toast({ tone: "error", message: `${message(cause)} Tus marcas siguen en pantalla; vuelve a guardar.` }); }
    finally { setBusy(false); }
  }
  return <section className="sheet" aria-labelledby="sheet-title">
    <header className="sheet-header">
      <div><h2 id="sheet-title">{sessionDay(session.sessionDate)}</h2><p className="muted">{session.groupName}{lessonTitle ? ` · ${lessonTitle}` : ""}</p></div>
      <StatusBadge tone={dirty ? "warning" : complete ? "success" : "neutral"}>{dirty ? "Cambios sin guardar" : complete ? "Guardada" : "Sin registrar"}</StatusBadge>
    </header>
    {!rows.length ? <EmptyState compact icon="users" title="Este grupo no tiene participantes" action={<Link className="button secondary" href={`/cursos/${course.id}/grupos#grupo-${session.groupId}`}>Agregar participantes</Link>}/> : <>
      {writable && pending > 0 && <button type="button" className="button ghost small" onClick={() => setRows(rows.map(row => row.status === "unmarked" ? { ...row, status: "present" } : row))}><Icon name="check" size={16}/>Marcar {plural(pending, "pendiente", "pendientes")} como presente</button>}
      <ol className="attendance-list">{rows.map((row, index) => <li key={row.learnerId}>
        <span className="roster-number" aria-hidden="true">{String(index + 1).padStart(2, "0")}</span>
        <strong id={`learner-${row.learnerId}`}>{row.displayName}</strong>
        <div className="mark-group" role="radiogroup" aria-labelledby={`learner-${row.learnerId}`}>
          {marks.map(([value, label]) => <label key={value} className={`mark ${value}`}><input type="radio" name={`mark-${row.learnerId}`} value={value} checked={row.status === value} disabled={!writable} onChange={() => set(row.learnerId, value)}/><span>{label}</span></label>)}
        </div>
      </li>)}</ol>
      {writable && <div className="sheet-footer">
        <p className="muted" aria-live="polite">{pending ? `Faltan ${plural(pending, "participante", "participantes")} por marcar.` : "Todos los participantes tienen un estado."}</p>
        <button type="button" className="button primary" disabled={busy || pending > 0 || !dirty} onClick={() => void save()}>{busy ? "Guardando…" : "Guardar asistencia"}</button>
      </div>}
    </>}
  </section>;
}
