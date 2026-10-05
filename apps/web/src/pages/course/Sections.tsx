import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import type { ClassSession, GroupLearner, SectionEducator, SectionSchedule } from "@happy-learners/contracts";
import { maxSectionEducators, scheduleSummary } from "@happy-learners/domain";
import { api, message } from "../../api";
import { Link } from "../../navigation";
import { lessonNames, plural, sessionDay } from "../../model";
import { useFeedback } from "../../ui/feedback";
import { Icon } from "../../ui/icons";
import { Avatar } from "../../ui/progress";
import { Menu } from "../../ui/Menu";
import { InlineName } from "../../ui/LessonOutline";
import { EmptyState, ErrorState, Loading, PageHeader, PrimaryAction } from "../../ui/primitives";
import { useCourse } from "./context";

/** A section of the course: its educators, assigned students, access code and schedule. */
export type SectionView = { id: string; name: string; status: "active" | "archived"; learnerCount: number; learners: GroupLearner[]; educators: SectionEducator[]; accessCode?: string | null; schedule?: SectionSchedule | null };
type Person = { id: string; username: string; name: string };

/** Asignaciones: who teaches each section and which students it has. Administration manages them; the team consults its own sections. */
export function Sections() {
  const { course, configurable: writable, access, reload } = useCourse();
    const { toast, confirm } = useFeedback();
  const [groups, setGroups] = useState<SectionView[] | null>(null), [sessions, setSessions] = useState<ClassSession[]>([]), [today, setToday] = useState(""), [error, setError] = useState("");
  const [creating, setCreating] = useState(false), [busy, setBusy] = useState(false), [renaming, setRenaming] = useState<string | null>(null);
  const base = `/courses/${course.id}`, page = `/cursos/${course.id}`;
  const [people, setPeople] = useState<Person[]>([]);
  useEffect(() => { if (writable) api<{ people: Person[] }>("/people").then(result => setPeople(result.people)).catch(() => undefined); }, [writable]);
  async function load() {
    setError("");
    try {
      const [g, s] = await Promise.all([api<{ groups: SectionView[] }>(`${base}/groups`), api<{ sessions: ClassSession[]; today: string }>(`${base}/sessions`)]);
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
  async function setStatus(group: SectionView, status: "active" | "archived") {
    if (status === "archived" && !await confirm({ title: `¿Cerrar «${group.name}»?`, body: <p>La sección conserva su lista, sus clases y su asistencia, pero no recibe clases nuevas. Su código de acceso deja de funcionar. Puedes reactivarla después.</p>, confirm: "Cerrar sección", danger: true })) return;
    await run(() => api(`${base}/groups/${group.id}`, "PUT", { status }), status === "archived" ? `«${group.name}» se cerró.` : `«${group.name}» está activa de nuevo.`);
  }
  async function code(group: SectionView, remove = false) {
    if (group.accessCode && !await confirm({ title: remove ? "¿Desactivar el código?" : "¿Cambiar el código?", body: <p>Quienes entraron con el código actual pierden el acceso a la sección{remove ? "" : " y deben usar el nuevo"}.</p>, confirm: remove ? "Desactivar" : "Cambiar código", danger: remove })) return;
    await run(() => api(`${base}/groups/${group.id}/code`, remove ? "DELETE" : "POST"), remove ? "Código desactivado." : "Código listo. Compártelo con la sección.");
  }
  async function assign(group: SectionView, userIds: string[], done: string) {
    const joining = userIds.some(id => !course.team?.some(member => member.userId === id));
    if (await run(() => api(`${base}/groups/${group.id}/educators`, "PUT", { userIds }), joining ? `${done} También se sumó al equipo del curso como colaborador.` : done) && joining) await reload();
  }
  async function withdraw(group: SectionView, learner: GroupLearner) {
    if (!await confirm({ title: `¿Retirar a ${learner.displayName}?`, body: <p>Deja de estar asignado a la sección y sale de la lista de las próximas clases. Su asistencia ya registrada se conserva.</p>, confirm: "Retirar", danger: true })) return;
    await run(() => api(`${base}/groups/${group.id}/learners/${learner.id}`, "PUT", { status: "archived" }), `${learner.displayName} se retiró de ${group.name}.`);
  }
  const header = <PageHeader crumbs={[{ label: "Cursos", href: "/cursos" }, { label: course.title, href: page }, { label: "Asignaciones" }]} title="Asignaciones"
    description={writable ? "Cada sección tiene sus educadores, su lista de estudiantes, su código de acceso y su horario." : access.sections === "all" ? "Las secciones del curso con sus educadores, estudiantes y horario. Administración las gestiona." : "Las secciones que impartes, con sus estudiantes y su horario. Administración las gestiona."}
    primary={writable && groups !== null && <PrimaryAction icon="plus" onClick={() => setCreating(true)}>Nueva sección</PrimaryAction>}/>;
  if (course.status !== "active") return <>{header}<EmptyState icon="archive" title="Curso archivado">Las asignaciones vuelven a estar disponibles cuando administración restaura el curso.</EmptyState></>;
  if (error) return <>{header}<ErrorState error={error} retry={() => void load()}/></>;
  if (!groups) return <>{header}<Loading label="Cargando asignaciones…" cards={2}/></>;
  const active = groups.filter(group => group.status === "active"), closed = groups.filter(group => group.status === "archived");
  return <>
    {header}
    {(creating || !groups.length) && writable && <form className="inline-form" aria-label="Nueva sección" onSubmit={async event => { if (await submit(event, `${base}/groups`, "name", name => `Sección «${name}» creada. Asígnale sus educadores y estudiantes.`)) setCreating(false); }}>
      <h2>Nueva sección</h2>
      <fieldset disabled={busy}>
        <div className="field"><label htmlFor="group-name">Nombre de la sección</label><input id="group-name" name="name" required maxLength={100} placeholder="Ej. 3.º A, sección de los martes" autoFocus={creating}/></div>
        <div className="inline-form-actions"><button className="button primary">Crear sección</button>{groups.length > 0 && <button type="button" className="button ghost" onClick={() => setCreating(false)}>Cancelar</button>}</div>
      </fieldset>
    </form>}
    {!groups.length && !writable && <EmptyState icon="users" title={access.sections === "all" ? "Este curso no tiene secciones" : "No tienes secciones asignadas en este curso"}>Administración crea las secciones y asigna a sus educadores.</EmptyState>}
    <div className="group-grid">{active.map(group => {
      const own = sessions.filter(session => session.groupId === group.id);
      const next = own.filter(session => session.status === "in_progress" || (session.status === "planned" && session.sessionDate >= today)).sort((a, b) => a.sessionDate.localeCompare(b.sessionDate) || (a.startsAt || "").localeCompare(b.startsAt || ""))[0];
      const recent = own.filter(session => session.status === "completed").slice(0, 3);
      return <article key={group.id} id={`seccion-${group.id}`} className="group-card" aria-labelledby={`title-${group.id}`}>
        <header>
          <div>{renaming === group.id
            ? <InlineName value={group.name} label="Nombre de la sección" onSave={name => run(() => api(`${base}/groups/${group.id}`, "PUT", { name }), "Sección renombrada.")} onDone={() => setRenaming(null)}/>
            : <h2 id={`title-${group.id}`}>{group.name}</h2>}<p className="muted">{plural(group.learnerCount, "estudiante asignado", "estudiantes asignados")}</p></div>
          <div className="button-row">
            <Link className="button secondary small" href={`${page}/clases?seccion=${group.id}`}><Icon name="calendar" size={16}/>Ver clases</Link>
            {writable && <Menu label={`Acciones de la sección ${group.name}`} items={[{ label: "Renombrar", icon: "edit", onSelect: () => setRenaming(group.id) }, "separator", { label: "Cerrar sección", icon: "archive", danger: true, onSelect: () => void setStatus(group, "archived") }]}/>}
          </div>
        </header>
        <Educators group={group} people={people} editable={writable} busy={busy} onChange={(ids, done) => void assign(group, ids, done)}/>
        <p className="muted small"><Icon name="clock" size={14}/> {group.schedule ? <>Horario: <Link href={`${page}/horario#horario-${group.id}`}>{scheduleSummary(group.schedule)}</Link></> : <>Sin horario. {writable && <Link href={`${page}/horario#horario-${group.id}`}>Configurar horario</Link>}</>}</p>
        <p className="muted small">{next ? <>Próxima clase: <Link href={`${page}/clases/${next.id}`}>{sessionDay(next.sessionDate)}{next.startsAt ? `, ${next.startsAt}` : ""}</Link>{next.lessons.length ? ` · ${lessonNames(next)}` : ""}</> : "Sin clases próximas."}</p>
        {group.learners.length ? <ol className="roster">{group.learners.map((learner, index) => <li key={learner.id}>
          <span className="roster-number" aria-hidden="true">{String(index + 1).padStart(2, "0")}</span>
          {renaming === learner.id
            ? <InlineName value={learner.displayName} label={`Nombre de lista de ${learner.displayName}`} onSave={displayName => run(() => api(`${base}/groups/${group.id}/learners/${learner.id}`, "PUT", { displayName }), "Nombre actualizado.")} onDone={() => setRenaming(null)}/>
            : <span>{learner.displayName}</span>}
          {writable && <Menu label={`Acciones de ${learner.displayName}`} items={[{ label: "Editar nombre", icon: "edit", onSelect: () => setRenaming(learner.id) }, { label: "Retirar de la sección", icon: "archive", danger: true, onSelect: () => void withdraw(group, learner) }]}/>}
        </li>)}</ol> : <p className="muted">{writable ? "Asigna a los estudiantes de la sección para poder pasar lista." : "Administración aún no asigna estudiantes a esta sección."}</p>}
        {writable && <form className="add-row" aria-label={`Asignar estudiante a ${group.name}`} onSubmit={event => void submit(event, `${base}/groups/${group.id}/learners`, "displayName", name => `${name} quedó asignado a ${group.name}.`)}>
          <label htmlFor={`learner-${group.id}`} className="sr-only">Nombre o código de lista para {group.name}</label>
          <input id={`learner-${group.id}`} name="displayName" required maxLength={80} placeholder="Nombre o código" disabled={busy}/>
          <button className="button secondary" disabled={busy}><Icon name="plus" size={16}/>Asignar</button>
        </form>}
        <div className="group-sessions"><h3>Código para estudiantes</h3>
          {group.accessCode ? <div className="group-code"><code aria-label={`Código de la sección ${group.name}`}>{group.accessCode}</code>
            <button type="button" className="button ghost small" onClick={() => void navigator.clipboard?.writeText(group.accessCode!).then(() => toast({ message: "Código copiado." }))}><Icon name="copy" size={16}/>Copiar</button>
            {writable && <Menu label={`Opciones del código de ${group.name}`} items={[{ label: "Cambiar código", icon: "undo", onSelect: () => void code(group) }, { label: "Desactivar código", icon: "close", danger: true, onSelect: () => void code(group, true) }]}/>}
          </div> : <p className="muted small">Sin código. {writable && <button type="button" className="link-button" disabled={busy} onClick={() => void code(group)}>Generar código</button>}</p>}
          <p className="muted small">Con el código, los estudiantes de la sección ven sus próximas clases, lecciones y recursos. No necesitan cuenta ni datos personales.</p>
        </div>
        <div className="group-sessions"><h3>Clases impartidas</h3>{recent.length ? <ul>{recent.map(session => <li key={session.id}><Link href={`${page}/clases/${session.id}`}>{sessionDay(session.sessionDate)}</Link></li>)}</ul> : <p className="muted">Aún no hay clases impartidas.</p>}
          {own.length > 0 && <Link className="section-link" href={`${page}/clases?vista=historial&seccion=${group.id}`}>Ver historial de la sección</Link>}</div>
      </article>;
    })}</div>
    {closed.length > 0 && <details className="closed-groups"><summary>Secciones cerradas ({closed.length})</summary>
      <ul className="link-list">{closed.map(group => <li key={group.id}><span>{group.name}</span><span className="muted">{plural(group.learnerCount, "estudiante", "estudiantes")}</span>
        <Link className="section-link" href={`${page}/clases?vista=historial&seccion=${group.id}`}>Historial</Link>
        {writable && <button type="button" className="button secondary small" disabled={busy} onClick={() => void setStatus(group, "active")}>Reactivar</button>}</li>)}</ul>
    </details>}
    <p className="privacy-note"><Icon name="shield" size={16}/>Usa solo un nombre de lista o un código. No agregues correos, teléfonos, fechas de nacimiento ni notas personales.</p>
  </>;
}

/** Who teaches the section. Administration adds or removes them; anyone not yet on the team joins it as a co-teacher. */
function Educators({ group, people, editable, busy, onChange }: { group: SectionView; people: Person[]; editable: boolean; busy: boolean; onChange: (userIds: string[], done: string) => void }) {
  const [adding, setAdding] = useState("");
  const ids = group.educators.map(item => item.userId);
  const available = people.filter(person => !ids.includes(person.id));
  return <div className="section-educators" aria-label={`Educadores de ${group.name}`}>
    <h3>Imparten la sección</h3>
    {group.educators.length ? <ul className="team-list compact">{group.educators.map(person => <li key={person.userId}>
      <Avatar name={person.name} size={28}/><div><strong>{person.name}</strong><span className="muted small">@{person.username}</span></div>
      {editable && <button type="button" className="icon-button" disabled={busy} aria-label={`Quitar a ${person.name} de ${group.name}`} onClick={() => onChange(ids.filter(id => id !== person.userId), `${person.name} ya no imparte ${group.name}.`)}><Icon name="close"/></button>}
    </li>)}</ul> : <p className="muted small">{editable ? "Asigna quién imparte la sección para que la vea en sus cursos y registre sus clases." : "Sin educadores asignados. La persona responsable del curso puede impartirla."}</p>}
    {editable && ids.length < maxSectionEducators && <form className="add-row" aria-label={`Asignar educador a ${group.name}`} onSubmit={event => { event.preventDefault(); const person = people.find(item => item.id === adding); if (person) { onChange([...ids, person.id], `${person.name} imparte ${group.name}.`); setAdding(""); } }}>
      <label className="sr-only" htmlFor={`educator-${group.id}`}>Educador para {group.name}</label>
      <select id={`educator-${group.id}`} value={adding} disabled={busy} onChange={event => setAdding(event.target.value)}><option value="">Asignar educador…</option>{available.map(person => <option key={person.id} value={person.id}>{person.name} (@{person.username})</option>)}</select>
      <button className="button secondary" disabled={busy || !adding}><Icon name="plus" size={16}/>Asignar</button>
    </form>}
  </div>;
}
