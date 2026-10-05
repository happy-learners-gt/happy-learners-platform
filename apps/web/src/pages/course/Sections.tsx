import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import type { GroupLearner, SectionEducator, SectionSchedule, SectionSummary } from "@happy-learners/contracts";
import { maxSectionEducators } from "@happy-learners/domain";
import { api, message } from "../../api";
import { Link, useNavigation } from "../../navigation";
import { useFeedback } from "../../ui/feedback";
import { Icon } from "../../ui/icons";
import { Avatar } from "../../ui/progress";
import { Menu } from "../../ui/Menu";
import { InlineName } from "../../ui/LessonOutline";
import { EmptyState, ErrorState, Loading, PageHeader, PrimaryAction } from "../../ui/primitives";
import { useCourse } from "./context";
import { SectionCards } from "../sections/SectionCard";
import { sectionPath, useSection } from "../sections/context";

/** A section of the course: its educators, assigned students, access code and schedule. */
export type SectionView = { id: string; name: string; status: "active" | "archived"; learnerCount: number; learners?: GroupLearner[]; educators: SectionEducator[]; accessCode?: string | null; schedule?: SectionSchedule | null };

/**
 * Secciones of a course: each one is its own instance of the course (DEC-024). Administration creates them and
 * sees all of them; each educator sees only the sections they teach.
 */
export function CourseSections() {
  const { course, configurable, access } = useCourse();
  const { navigate } = useNavigation();
  const { toast } = useFeedback();
  const [sections, setSections] = useState<SectionSummary[] | null>(null), [today, setToday] = useState(""), [error, setError] = useState("");
  const [creating, setCreating] = useState(false), [busy, setBusy] = useState(false);
  async function load() {
    setError("");
    try { const result = await api<{ sections: SectionSummary[]; today: string }>("/sections"); setSections(result.sections.filter(item => item.courseId === course.id)); setToday(result.today); }
    catch (cause) { setError(message(cause)); }
  }
  useEffect(() => { void load(); }, [course.id]);
  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const name = String(new FormData(event.currentTarget).get("name") || "").trim();
    setBusy(true);
    try {
      const { id } = await api<{ id: string }>(`/courses/${course.id}/groups`, "POST", { name });
      toast({ message: `Sección «${name}» creada. Asígnale sus educadores, sus estudiantes y su horario.` });
      navigate(sectionPath(id));
    } catch (cause) { toast({ tone: "error", message: message(cause) }); setBusy(false); }
  }
  const mine = access.sections !== "all";
  const header = <PageHeader crumbs={[{ label: "Cursos", href: "/cursos" }, { label: course.title, href: `/cursos/${course.id}` }, { label: "Secciones" }]} title={mine ? "Mis secciones del curso" : "Secciones"}
    description={mine ? "Las secciones de este curso que impartes. Cada una tiene sus estudiantes, su horario, su cronograma y su propio avance." : "Cada sección es una impartición del curso: sigue su plan y su contenido, con sus propios educadores, estudiantes, horario, clases y avance."}
    primary={configurable && course.status === "active" && sections !== null && <PrimaryAction icon="plus" onClick={() => setCreating(true)}>Nueva sección</PrimaryAction>}/>;
  if (error) return <>{header}<ErrorState error={error} retry={() => void load()}/></>;
  if (!sections) return <>{header}<Loading label="Cargando secciones…" lines={4}/></>;
  const open = sections.filter(item => item.status === "active"), closed = sections.filter(item => item.status === "archived");
  return <>
    {header}
    {(creating || (!sections.length && configurable)) && course.status === "active" && configurable && <form className="inline-form" aria-label="Nueva sección" onSubmit={create}>
      <h2>Nueva sección</h2>
      <fieldset disabled={busy}>
        <div className="field"><label htmlFor="group-name">Nombre de la sección</label><input id="group-name" name="name" required maxLength={100} placeholder="Ej. 3.º A, sección de los martes" autoFocus={creating}/></div>
        <div className="inline-form-actions"><button className="button primary">Crear sección</button>{sections.length > 0 && <button type="button" className="button ghost" onClick={() => setCreating(false)}>Cancelar</button>}</div>
      </fieldset>
    </form>}
    {open.length ? <SectionCards sections={open} today={today} showCourse={false}/>
      : !configurable && <EmptyState icon="users" title={mine ? "No tienes secciones asignadas en este curso" : "Este curso no tiene secciones"}>Administración crea las secciones y asigna quién imparte cada una.</EmptyState>}
    {closed.length > 0 && <details className="closed-groups"><summary>Secciones cerradas ({closed.length})</summary><SectionCards sections={closed} today={today} showCourse={false}/></details>}
  </>;
}

/** Estudiantes of a section: its roster and the code its students use. Administration manages both; its educators consult them. */
export function SectionStudents() {
  const { course, configurable } = useCourse();
  const { section, base, reload } = useSection();
  const { toast, confirm } = useFeedback();
  const [learners, setLearners] = useState<GroupLearner[] | null>(null), [code, setCode] = useState<string | null>(section.accessCode ?? null), [error, setError] = useState("");
  const [busy, setBusy] = useState(false), [renaming, setRenaming] = useState<string | null>(null);
  const path = `/courses/${course.id}/groups/${section.id}`;
  const writable = configurable && section.status === "active";
  async function load() {
    setError("");
    try { const { group } = await api<{ group: SectionView & { learners: GroupLearner[] } }>(path); setLearners(group.learners); setCode(group.accessCode ?? null); }
    catch (cause) { setError(message(cause)); }
  }
  useEffect(() => { void load(); }, [section.id]);
  async function run(action: () => Promise<unknown>, done: string) {
    setBusy(true);
    try { await action(); await Promise.all([load(), reload()]); toast({ message: done }); return true; }
    catch (cause) { toast({ tone: "error", message: message(cause) }); return false; }
    finally { setBusy(false); }
  }
  async function add(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget, displayName = String(new FormData(form).get("displayName") || "").trim();
    if (await run(() => api(`${path}/learners`, "POST", { displayName }), `${displayName} quedó asignado a ${section.name}.`)) { form.reset(); form.querySelector<HTMLInputElement>("input")?.focus(); }
  }
  async function withdraw(learner: GroupLearner) {
    if (!await confirm({ title: `¿Retirar a ${learner.displayName}?`, body: <p>Deja de estar asignado a la sección y sale de la lista de las próximas clases. Su asistencia ya registrada se conserva.</p>, confirm: "Retirar", danger: true })) return;
    await run(() => api(`${path}/learners/${learner.id}`, "PUT", { status: "archived" }), `${learner.displayName} se retiró de ${section.name}.`);
  }
  async function changeCode(remove = false) {
    if (code && !await confirm({ title: remove ? "¿Desactivar el código?" : "¿Cambiar el código?", body: <p>Quienes entraron con el código actual pierden el acceso a la sección{remove ? "" : " y deben usar el nuevo"}.</p>, confirm: remove ? "Desactivar" : "Cambiar código", danger: remove })) return;
    await run(() => api(`${path}/code`, remove ? "DELETE" : "POST"), remove ? "Código desactivado." : "Código listo. Compártelo con la sección.");
  }
  const header = <PageHeader crumbs={[{ label: "Secciones", href: "/secciones" }, { label: section.name, href: base }, { label: "Estudiantes" }]} title="Estudiantes"
    description={writable ? "La lista de la sección y el código con el que sus estudiantes ven sus clases. Solo estos estudiantes aparecen al pasar lista." : "La lista de la sección y el código con el que sus estudiantes ven sus clases. Administración la gestiona."}/>;
  if (error) return <>{header}<ErrorState error={error} retry={() => void load()}/></>;
  if (!learners) return <>{header}<Loading label="Cargando estudiantes…" lines={6}/></>;
  return <>
    {header}
    <div className="group-grid">
      <article className="group-card" aria-labelledby="roster-title">
        <header><div><h2 id="roster-title">Lista de la sección</h2><p className="muted">{learners.length === 1 ? "1 estudiante asignado" : `${learners.length} estudiantes asignados`}</p></div></header>
        {learners.length ? <ol className="roster">{learners.map((learner, index) => <li key={learner.id}>
          <span className="roster-number" aria-hidden="true">{String(index + 1).padStart(2, "0")}</span>
          {renaming === learner.id
            ? <InlineName value={learner.displayName} label={`Nombre de lista de ${learner.displayName}`} onSave={displayName => run(() => api(`${path}/learners/${learner.id}`, "PUT", { displayName }), "Nombre actualizado.")} onDone={() => setRenaming(null)}/>
            : <span>{learner.displayName}</span>}
          {writable && <Menu label={`Acciones de ${learner.displayName}`} items={[{ label: "Editar nombre", icon: "edit", onSelect: () => setRenaming(learner.id) }, { label: "Retirar de la sección", icon: "archive", danger: true, onSelect: () => void withdraw(learner) }]}/>}
        </li>)}</ol> : <p className="muted">{writable ? "Asigna a los estudiantes de la sección para poder pasar lista." : "Administración aún no asigna estudiantes a esta sección."}</p>}
        {writable && <form className="add-row" aria-label={`Asignar estudiante a ${section.name}`} onSubmit={add}>
          <label htmlFor="learner-name" className="sr-only">Nombre o código de lista para {section.name}</label>
          <input id="learner-name" name="displayName" required maxLength={80} placeholder="Nombre o código" disabled={busy}/>
          <button className="button secondary" disabled={busy}><Icon name="plus" size={16}/>Asignar</button>
        </form>}
      </article>
      <article className="group-card" aria-labelledby="code-title">
        <header><div><h2 id="code-title">Código para estudiantes</h2></div></header>
        {code ? <div className="group-code"><code aria-label={`Código de la sección ${section.name}`}>{code}</code>
          <button type="button" className="button ghost small" onClick={() => void navigator.clipboard?.writeText(code).then(() => toast({ message: "Código copiado." }))}><Icon name="copy" size={16}/>Copiar</button>
          {writable && <Menu label={`Opciones del código de ${section.name}`} items={[{ label: "Cambiar código", icon: "undo", onSelect: () => void changeCode() }, { label: "Desactivar código", icon: "close", danger: true, onSelect: () => void changeCode(true) }]}/>}
        </div> : <p className="muted small">Sin código. {writable && <button type="button" className="link-button" disabled={busy} onClick={() => void changeCode()}>Generar código</button>}</p>}
        <p className="muted small">Con el código, los estudiantes de la sección ven sus próximas clases, lecciones y recursos. No necesitan cuenta ni datos personales.</p>
      </article>
    </div>
    <p className="privacy-note"><Icon name="shield" size={16}/>Usa solo un nombre de lista o un código. No agregues correos, teléfonos, fechas de nacimiento ni notas personales.</p>
  </>;
}

/** Who teaches the section, chosen from the course's team (DEC-024). Administration adds or removes them. */
export function SectionEducators() {
  const { course, configurable } = useCourse();
  const { section, reload } = useSection();
  const { toast } = useFeedback();
  const [adding, setAdding] = useState(""), [busy, setBusy] = useState(false);
  const editable = configurable && section.status === "active";
  const ids = section.educators.map(item => item.userId);
  const available = (course.team || []).filter(person => !ids.includes(person.userId));
  async function save(userIds: string[], done: string) {
    setBusy(true);
    try { await api(`/courses/${course.id}/groups/${section.id}/educators`, "PUT", { userIds }); await reload(); toast({ message: done }); }
    catch (cause) { toast({ tone: "error", message: message(cause) }); }
    finally { setBusy(false); }
  }
  return <div className="section-educators" aria-label={`Educadores de ${section.name}`}>
    {section.educators.length ? <ul className="team-list compact">{section.educators.map(person => <li key={person.userId}>
      <Avatar name={person.name} size={28}/><div><strong>{person.name}</strong><span className="muted small">@{person.username}</span></div>
      {editable && <button type="button" className="icon-button" disabled={busy} aria-label={`Quitar a ${person.name} de ${section.name}`} onClick={() => void save(ids.filter(id => id !== person.userId), `${person.name} ya no imparte ${section.name}.`)}><Icon name="close"/></button>}
    </li>)}</ul> : <p className="muted small">{editable ? "Asigna quién imparte la sección para que la vea en sus secciones y registre sus clases." : "Sin educadores asignados."}</p>}
    {editable && ids.length < maxSectionEducators && (available.length ? <form className="add-row" aria-label={`Asignar educador a ${section.name}`} onSubmit={event => { event.preventDefault(); const person = available.find(item => item.userId === adding); if (person) { void save([...ids, person.userId], `${person.name} imparte ${section.name}.`); setAdding(""); } }}>
      <label className="sr-only" htmlFor={`educator-${section.id}`}>Educador para {section.name}</label>
      <select id={`educator-${section.id}`} value={adding} disabled={busy} onChange={event => setAdding(event.target.value)}><option value="">Asignar educador del equipo…</option>{available.map(person => <option key={person.userId} value={person.userId}>{person.name} (@{person.username})</option>)}</select>
      <button className="button secondary" disabled={busy || !adding}><Icon name="plus" size={16}/>Asignar</button>
    </form> : <p className="muted small">Todo el equipo docente imparte esta sección. Para sumar a alguien, <Link href={`/cursos/${course.id}/configuracion#equipo`}>agrégalo al equipo del curso</Link>.</p>)}
  </div>;
}
