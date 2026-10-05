import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import type { ClassSession, GroupLearner } from "@happy-learners/contracts";
import { api, message } from "../../api";
import { Link, useNavigation } from "../../navigation";
import { plural, sessionDay } from "../../model";
import { useFeedback } from "../../ui/feedback";
import { Icon } from "../../ui/icons";
import { Menu } from "../../ui/Menu";
import { InlineName } from "../../ui/LessonOutline";
import { EmptyState, ErrorState, Loading, PageHeader, PrimaryAction } from "../../ui/primitives";
import { useCourse } from "./context";

export type GroupView = { id: string; name: string; status: "active" | "archived"; learnerCount: number; learners: GroupLearner[]; accessCode?: string | null };

export function Groups() {
  const { course, writable } = useCourse();
  const { navigate } = useNavigation();
  const { toast, confirm } = useFeedback();
  const [groups, setGroups] = useState<GroupView[] | null>(null), [sessions, setSessions] = useState<ClassSession[]>([]), [today, setToday] = useState(""), [error, setError] = useState("");
  const [creating, setCreating] = useState(false), [busy, setBusy] = useState(false), [renaming, setRenaming] = useState<string | null>(null);
  const base = `/courses/${course.id}`, page = `/cursos/${course.id}`;
  async function load() {
    setError("");
    try {
      const [g, s] = await Promise.all([api<{ groups: GroupView[] }>(`${base}/groups`), api<{ sessions: ClassSession[]; today: string }>(`${base}/sessions`)]);
      setGroups(g.groups); setSessions(s.sessions); setToday(s.today);
    } catch (cause) { setError(message(cause)); }
  }
  useEffect(() => { if (course.status === "active") void load(); }, [course.id]);
  async function run(action: () => Promise<unknown>, done: string) {
    setBusy(true);
    try { await action(); await load(); toast({ message: done }); return true; }
    catch (cause) { toast({ tone: "error", message: message(cause) }); return false; }
    finally { setBusy(false); }
  }
  async function submit(event: FormEvent<HTMLFormElement>, path: string, field: string, done: (value: string) => string) {
    event.preventDefault();
    const form = event.currentTarget, value = String(new FormData(form).get(field) || "").trim();
    const ok = await run(() => api(path, "POST", { [field]: value }), done(value));
    if (ok) { form.reset(); form.querySelector<HTMLInputElement>("input")?.focus(); }
    return ok;
  }
  async function setStatus(group: GroupView, status: "active" | "archived") {
    if (status === "archived" && !await confirm({ title: `¿Cerrar «${group.name}»?`, body: <p>El grupo conserva su lista, sus clases y su asistencia, pero no recibe clases nuevas. Su código de acceso deja de funcionar. Puedes reactivarlo después.</p>, confirm: "Cerrar grupo", danger: true })) return;
    await run(() => api(`${base}/groups/${group.id}`, "PUT", { status }), status === "archived" ? `«${group.name}» se cerró.` : `«${group.name}» está activo de nuevo.`);
  }
  async function code(group: GroupView, remove = false) {
    if (group.accessCode && !await confirm({ title: remove ? "¿Desactivar el código?" : "¿Cambiar el código?", body: <p>Quienes entraron con el código actual pierden el acceso al grupo{remove ? "" : " y deben usar el nuevo"}.</p>, confirm: remove ? "Desactivar" : "Cambiar código", danger: remove })) return;
    await run(() => api(`${base}/groups/${group.id}/code`, remove ? "DELETE" : "POST"), remove ? "Código desactivado." : "Código listo. Compártelo con el grupo.");
  }
  async function withdraw(group: GroupView, learner: GroupLearner) {
    if (!await confirm({ title: `¿Retirar a ${learner.displayName}?`, body: <p>Sale de la lista de las próximas clases. Su asistencia ya registrada se conserva.</p>, confirm: "Retirar", danger: true })) return;
    await run(() => api(`${base}/groups/${group.id}/learners/${learner.id}`, "PUT", { status: "archived" }), `${learner.displayName} se retiró de ${group.name}.`);
  }
  const header = <PageHeader crumbs={[{ label: "Cursos", href: "/cursos" }, { label: course.title, href: page }, { label: "Grupos" }]} title="Grupos"
    description="Cada grupo tiene su lista, su código para estudiantes y sus clases."
    primary={writable && groups !== null && <PrimaryAction icon="plus" onClick={() => setCreating(true)}>Crear grupo</PrimaryAction>}/>;
  if (course.status !== "active") return <>{header}<EmptyState icon="archive" title="Curso archivado">Restaura el curso desde Configuración para consultar sus grupos.</EmptyState></>;
  if (error) return <>{header}<ErrorState error={error} retry={() => void load()}/></>;
  if (!groups) return <>{header}<Loading label="Cargando grupos…" cards={2}/></>;
  const active = groups.filter(group => group.status === "active"), closed = groups.filter(group => group.status === "archived");
  return <>
    {header}
    {(creating || !groups.length) && writable && <form className="inline-form" aria-label="Nuevo grupo" onSubmit={async event => { if (await submit(event, `${base}/groups`, "name", name => `Grupo «${name}» creado. Agrega a sus participantes.`)) setCreating(false); }}>
      <h2>Nuevo grupo</h2>
      <fieldset disabled={busy}>
        <div className="field"><label htmlFor="group-name">Nombre del grupo</label><input id="group-name" name="name" required maxLength={100} placeholder="Ej. 3.º A, grupo de los martes" autoFocus={creating}/></div>
        <div className="inline-form-actions"><button className="button primary">Crear grupo</button>{groups.length > 0 && <button type="button" className="button ghost" onClick={() => setCreating(false)}>Cancelar</button>}</div>
      </fieldset>
    </form>}
    {!groups.length && !writable && <EmptyState icon="users" title="Este curso no tiene grupos"/>}
    <div className="group-grid">{active.map(group => {
      const own = sessions.filter(session => session.groupId === group.id);
      const next = own.filter(session => session.status === "in_progress" || (session.status === "planned" && session.sessionDate >= today)).sort((a, b) => a.sessionDate.localeCompare(b.sessionDate) || (a.startsAt || "").localeCompare(b.startsAt || ""))[0];
      const recent = own.filter(session => session.status === "completed").slice(0, 3);
      return <article key={group.id} id={`grupo-${group.id}`} className="group-card" aria-labelledby={`title-${group.id}`}>
        <header>
          <div>{renaming === group.id
            ? <InlineName value={group.name} label="Nombre del grupo" onSave={name => run(() => api(`${base}/groups/${group.id}`, "PUT", { name }), "Grupo renombrado.")} onDone={() => setRenaming(null)}/>
            : <h2 id={`title-${group.id}`}>{group.name}</h2>}<p className="muted">{plural(group.learnerCount, "participante", "participantes")}</p></div>
          {writable && <div className="button-row">
            <button type="button" className="button secondary small" onClick={() => navigate(`${page}/clases?nueva=1&grupo=${group.id}`)}><Icon name="calendar" size={16}/>Planificar clase</button>
            <Menu label={`Acciones del grupo ${group.name}`} items={[{ label: "Renombrar", icon: "edit", onSelect: () => setRenaming(group.id) }, "separator", { label: "Cerrar grupo", icon: "archive", danger: true, onSelect: () => void setStatus(group, "archived") }]}/>
          </div>}
        </header>
        <p className="muted small">{next ? <>Próxima clase: <Link href={`${page}/clases/${next.id}`}>{sessionDay(next.sessionDate)}{next.startsAt ? `, ${next.startsAt}` : ""}</Link>{next.lessonTitle ? ` · ${next.lessonTitle}` : ""}</> : "Sin clases planificadas."}</p>
        {group.learners.length ? <ol className="roster">{group.learners.map((learner, index) => <li key={learner.id}>
          <span className="roster-number" aria-hidden="true">{String(index + 1).padStart(2, "0")}</span>
          {renaming === learner.id
            ? <InlineName value={learner.displayName} label={`Nombre de lista de ${learner.displayName}`} onSave={displayName => run(() => api(`${base}/groups/${group.id}/learners/${learner.id}`, "PUT", { displayName }), "Nombre actualizado.")} onDone={() => setRenaming(null)}/>
            : <span>{learner.displayName}</span>}
          {writable && <Menu label={`Acciones de ${learner.displayName}`} items={[{ label: "Editar nombre", icon: "edit", onSelect: () => setRenaming(learner.id) }, { label: "Retirar del grupo", icon: "archive", danger: true, onSelect: () => void withdraw(group, learner) }]}/>}
        </li>)}</ol> : <p className="muted">Agrega a los participantes para poder pasar lista.</p>}
        {writable && <form className="add-row" aria-label={`Agregar participante a ${group.name}`} onSubmit={event => void submit(event, `${base}/groups/${group.id}/learners`, "displayName", name => `${name} se agregó a ${group.name}.`)}>
          <label htmlFor={`learner-${group.id}`} className="sr-only">Nombre o código de lista para {group.name}</label>
          <input id={`learner-${group.id}`} name="displayName" required maxLength={80} placeholder="Nombre o código" disabled={busy}/>
          <button className="button secondary" disabled={busy}><Icon name="plus" size={16}/>Agregar</button>
        </form>}
        <div className="group-sessions"><h3>Código para estudiantes</h3>
          {group.accessCode ? <div className="group-code"><code aria-label={`Código del grupo ${group.name}`}>{group.accessCode}</code>
            <button type="button" className="button ghost small" onClick={() => void navigator.clipboard?.writeText(group.accessCode!).then(() => toast({ message: "Código copiado." }))}><Icon name="copy" size={16}/>Copiar</button>
            {writable && <Menu label={`Opciones del código de ${group.name}`} items={[{ label: "Cambiar código", icon: "undo", onSelect: () => void code(group) }, { label: "Desactivar código", icon: "close", danger: true, onSelect: () => void code(group, true) }]}/>}
          </div> : <p className="muted small">Sin código. {writable && <button type="button" className="link-button" disabled={busy} onClick={() => void code(group)}>Generar código</button>}</p>}
          <p className="muted small">Con el código, el grupo ve sus próximas clases, lecciones y recursos. No necesita cuenta ni datos personales.</p>
        </div>
        <div className="group-sessions"><h3>Clases impartidas</h3>{recent.length ? <ul>{recent.map(session => <li key={session.id}><Link href={`${page}/clases/${session.id}`}>{sessionDay(session.sessionDate)}</Link></li>)}</ul> : <p className="muted">Aún no hay clases impartidas.</p>}
          {own.length > 0 && <Link className="section-link" href={`${page}/clases?vista=historial&grupo=${group.id}`}>Ver historial del grupo</Link>}</div>
      </article>;
    })}</div>
    {closed.length > 0 && <details className="closed-groups"><summary>Grupos cerrados ({closed.length})</summary>
      <ul className="link-list">{closed.map(group => <li key={group.id}><span>{group.name}</span><span className="muted">{plural(group.learnerCount, "participante", "participantes")}</span>
        <Link className="section-link" href={`${page}/clases?vista=historial&grupo=${group.id}`}>Historial</Link>
        {writable && <button type="button" className="button secondary small" disabled={busy} onClick={() => void setStatus(group, "active")}>Reactivar</button>}</li>)}</ul>
    </details>}
    <p className="privacy-note"><Icon name="shield" size={16}/>Usa solo un nombre de lista o un código. No agregues correos, teléfonos, fechas de nacimiento ni notas personales.</p>
  </>;
}
