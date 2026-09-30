import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import type { ClassSession, GroupLearner } from "@happy-learners/contracts";
import { api, message } from "../../api";
import { Link, useNavigation } from "../../navigation";
import { plural, sessionDay } from "../../model";
import { useFeedback } from "../../ui/feedback";
import { Icon } from "../../ui/icons";
import { EmptyState, ErrorState, Loading, PageHeader, PrimaryAction } from "../../ui/primitives";
import { useCourse } from "./context";

export type GroupView = { id: string; name: string; status: "active" | "archived"; learnerCount: number; learners: GroupLearner[] };

export function Groups() {
  const { course, writable } = useCourse();
  const { navigate } = useNavigation();
  const { toast } = useFeedback();
  const [groups, setGroups] = useState<GroupView[] | null>(null), [sessions, setSessions] = useState<ClassSession[]>([]), [error, setError] = useState("");
  const [creating, setCreating] = useState(false), [busy, setBusy] = useState(false);
  const base = `/courses/${course.id}`, page = `/cursos/${course.id}`;
  async function load() {
    setError("");
    try {
      const [g, s] = await Promise.all([api<{ groups: GroupView[] }>(`${base}/groups`), api<{ sessions: ClassSession[] }>(`${base}/sessions`)]);
      setGroups(g.groups); setSessions(s.sessions);
    } catch (cause) { setError(message(cause)); }
  }
  useEffect(() => { if (course.status === "active") void load(); }, [course.id]);
  async function submit(event: FormEvent<HTMLFormElement>, path: string, field: string, done: (value: string) => string) {
    event.preventDefault();
    const form = event.currentTarget, value = String(new FormData(form).get(field) || "").trim();
    setBusy(true);
    try { await api(path, "POST", { [field]: value }); form.reset(); await load(); toast({ message: done(value) }); form.querySelector<HTMLInputElement>("input")?.focus(); return true; }
    catch (cause) { toast({ tone: "error", message: `${message(cause)} Revisa el nombre e inténtalo de nuevo.` }); return false; }
    finally { setBusy(false); }
  }
  const header = <PageHeader crumbs={[{ label: "Cursos", href: "/cursos" }, { label: course.title, href: page }, { label: "Grupos" }]} title="Grupos"
    description="Cada grupo tiene su lista y sus clases. Desde un grupo registras la clase del día y pasas lista."
    primary={writable && groups !== null && <PrimaryAction icon="plus" onClick={() => setCreating(true)}>Crear grupo</PrimaryAction>}/>;
  if (course.status !== "active") return <>{header}<EmptyState icon="archive" title="Curso archivado">Restaura el curso desde Configuración para consultar sus grupos.</EmptyState></>;
  if (error) return <>{header}<ErrorState error={error} retry={() => void load()}/></>;
  if (!groups) return <>{header}<Loading label="Cargando grupos…" cards={2}/></>;
  return <>
    {header}
    {(creating || !groups.length) && writable && <form className="inline-form" aria-label="Nuevo grupo" onSubmit={async event => { if (await submit(event, `${base}/groups`, "name", name => `Grupo «${name}» creado. Agrega a sus participantes.`)) setCreating(false); }}>
      <h2>Nuevo grupo</h2>
      <fieldset disabled={busy}>
        <div className="field"><label htmlFor="group-name">Nombre del grupo</label><input id="group-name" name="name" required maxLength={100} placeholder="Ej. Grupo de los martes" autoFocus={creating}/></div>
        <div className="inline-form-actions"><button className="button primary">Crear grupo</button>{groups.length > 0 && <button type="button" className="button ghost" onClick={() => setCreating(false)}>Cancelar</button>}</div>
      </fieldset>
    </form>}
    {!groups.length && !writable && <EmptyState icon="users" title="Este curso no tiene grupos"/>}
    <div className="group-grid">{groups.map(group => {
      const recent = sessions.filter(session => session.groupId === group.id).slice(0, 3);
      return <article key={group.id} id={`grupo-${group.id}`} className="group-card" aria-labelledby={`title-${group.id}`}>
        <header><div><h2 id={`title-${group.id}`}>{group.name}</h2><p className="muted">{plural(group.learnerCount, "participante", "participantes")}</p></div>
          {writable && <button type="button" className="button secondary small" disabled={!group.learnerCount} onClick={() => navigate(`${page}/asistencia?grupo=${group.id}&nueva=1`)}><Icon name="calendar" size={16}/>Registrar clase</button>}
        </header>
        {group.learners.length ? <ol className="roster">{group.learners.map((learner, index) => <li key={learner.id}><span className="roster-number" aria-hidden="true">{String(index + 1).padStart(2, "0")}</span><span>{learner.displayName}</span></li>)}</ol> : <p className="muted">Agrega a los participantes para poder pasar lista.</p>}
        {writable && <form className="add-row" aria-label={`Agregar participante a ${group.name}`} onSubmit={event => void submit(event, `${base}/groups/${group.id}/learners`, "displayName", name => `${name} se agregó a ${group.name}.`)}>
          <label htmlFor={`learner-${group.id}`} className="sr-only">Nombre o código de lista para {group.name}</label>
          <input id={`learner-${group.id}`} name="displayName" required maxLength={80} placeholder="Nombre o código" disabled={busy}/>
          <button className="button secondary" disabled={busy}><Icon name="plus" size={16}/>Agregar</button>
        </form>}
        <div className="group-sessions"><h3>Clases recientes</h3>{recent.length ? <ul>{recent.map(session => <li key={session.id}><Link href={`${page}/asistencia/${session.id}`}>{sessionDay(session.sessionDate)}</Link></li>)}</ul> : <p className="muted">Sin clases registradas.</p>}</div>
      </article>;
    })}</div>
    <p className="privacy-note"><Icon name="shield" size={16}/>Usa solo un nombre de lista o un código. No agregues correos, teléfonos, fechas de nacimiento ni notas personales.</p>
  </>;
}
