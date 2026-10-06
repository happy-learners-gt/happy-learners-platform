import { useEffect, useState } from "react";
import type { ClassResource, StudentClass, StudentPathLesson, StudentSpace as Space } from "@happy-learners/contracts";
import { api, ApiError, message } from "../api";
import { Link, useNavigation } from "../navigation";
import { sessionDay } from "../model";
import { Icon } from "../ui/icons";
import { EmptyState, ErrorState, Loading, Progress, StatusBadge } from "../ui/primitives";

/** The group's space for learners: next class, its lesson and resources, and earlier classes. Read-only, no account. */
export function StudentSpace() {
  const { navigate } = useNavigation();
  const [space, setSpace] = useState<Space | null>(null), [error, setError] = useState(""), [missing, setMissing] = useState(false);
  async function load() {
    setError("");
    try { setSpace(await api<Space>("/student/space")); }
    catch (cause) { if (cause instanceof ApiError && cause.status === 401) setMissing(true); else setError(message(cause)); }
  }
  useEffect(() => { void load(); }, []);
  async function leave() { await api("/student/logout", "POST").catch(() => undefined); navigate("/inicio"); }
  if (missing) return <main id="main" className="student-page"><EmptyState level={1} icon="users" title="Escribe el código de tu sección" action={<Link className="button primary" href="/inicio">Ir al inicio</Link>}>El acceso terminó o el código cambió. Pídele el código actual a tu educador.</EmptyState></main>;
  if (error) return <main id="main" className="student-page"><h1>Mi sección</h1><ErrorState error={error} retry={() => void load()}/></main>;
  if (!space) return <main id="main" className="student-page"><p role="status" className="sr-only">Abriendo tu sección…</p><Loading label="Abriendo tu sección…" lines={6}/></main>;
  if (space.pacing === "self-paced") return <SelfPaced space={space} reload={load} leave={leave}/>;
  return <main id="main" className="student-page">
    <div className="student-top">
      <span className="welcome-date">{space.organization}</span>
      <button type="button" className="button ghost small" onClick={() => void leave()}><Icon name="logout" size={16}/>Salir</button>
    </div>
    <header><h1>{space.group.name}</h1><p className="page-description">{space.course.title}</p></header>
    <section className="student-next" aria-labelledby="next-title">
      <span className="eyebrow">Próxima clase</span>
      {space.next ? <ClassCard item={space.next} today={space.today} headingId="next-title" big/> : <><h2 id="next-title">No hay clases programadas</h2><p className="muted">Cuando tu educador programe la siguiente clase, aparecerá aquí con su lección y sus recursos.</p></>}
    </section>
    {space.lessons.length > 0 && <section aria-labelledby="lessons-title" className="stack">
      <h2 id="lessons-title">Lecciones de tus clases</h2>
      <ul className="student-resources">{space.lessons.map(lesson => <li key={lesson.shareCode}><Link href={`/aprender/${lesson.shareCode}`}><Icon name="play" size={16}/>{lesson.title}</Link></li>)}</ul>
    </section>}
    {space.upcoming.length > 0 && <section aria-labelledby="upcoming-title" className="stack">
      <h2 id="upcoming-title">Después</h2>
      <ol className="student-classes">{space.upcoming.map(item => <li key={item.id}><ClassCard item={item} today={space.today}/></li>)}</ol>
    </section>}
    {space.recent.length > 0 && <section aria-labelledby="recent-title" className="stack">
      <h2 id="recent-title">Clases anteriores</h2>
      <ol className="student-classes">{space.recent.map(item => <li key={item.id}><ClassCard item={item} today={space.today}/></li>)}</ol>
    </section>}
    <p className="login-privacy"><Icon name="shield" size={16}/>Solo ves las clases de tu sección. No guardamos tu nombre ni tus datos.</p>
  </main>;
}

/**
 * A tu ritmo (DEC-027): no classes. The student picks their name from the section's list and works through the
 * whole published course, module by module, continuing where they left off.
 */
function SelfPaced({ space, reload, leave }: { space: Space; reload: () => Promise<void>; leave: () => Promise<void> }) {
  const { navigate } = useNavigation();
  const [browsing, setBrowsing] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState("");
  async function identify(learnerId: string | null) {
    setBusy(true); setError("");
    try { await api("/student/identity", "POST", { learnerId }); setBrowsing(false); await reload(); }
    catch (cause) { setError(message(cause)); }
    finally { setBusy(false); }
  }
  async function open(lesson: StudentPathLesson) {
    if (space.learner) await api("/student/progress", "POST", { shareCode: lesson.shareCode }).catch(() => undefined);
    navigate(`/aprender/${lesson.shareCode}`);
  }
  const lessons = space.path.flatMap(unit => unit.lessons), completed = lessons.filter(lesson => lesson.completed).length;
  const next = lessons.find(lesson => !lesson.completed) || null, started = lessons.some(lesson => lesson.opened);
  const choosing = !space.learner && space.roster.length > 0 && !browsing;
  return <main id="main" className="student-page">
    <div className="student-top">
      <span className="welcome-date">{space.organization}</span>
      <button type="button" className="button ghost small" onClick={() => void leave()}><Icon name="logout" size={16}/>Salir</button>
    </div>
    <header><h1>{space.group.name}</h1><p className="page-description">{space.course.title} · A tu ritmo</p></header>
    {error && <p className="form-alert" role="alert"><Icon name="alert" size={18}/>{error}</p>}
    {choosing ? <section className="student-next" aria-labelledby="who-title">
      <h2 id="who-title">¿Quién eres?</h2>
      <p className="muted">Elige tu nombre de la lista de la sección. Así tu avance queda guardado y tu educador puede acompañarte.</p>
      <ul className="student-roster">{space.roster.map(person => <li key={person.id}><button type="button" className="button secondary" disabled={busy} onClick={() => void identify(person.id)}><Icon name="user" size={16}/>{person.name}</button></li>)}</ul>
      <p><button type="button" className="link-button" onClick={() => setBrowsing(true)}>No aparezco en la lista: ver las lecciones sin guardar mi avance</button></p>
    </section> : <>
      <section className="student-next" aria-labelledby="next-title">
        <span className="eyebrow">{space.learner ? `Hola, ${space.learner.name}` : "Tu curso"}</span>
        {!lessons.length ? <><h2 id="next-title">Aún no hay lecciones publicadas</h2><p className="muted">Cuando tu educador publique las lecciones del curso, aparecerán aquí en orden.</p></>
          : next ? <>
            <h2 id="next-title">{started ? "Continúa donde te quedaste" : "Empieza el curso"}</h2>
            <p className="button-row"><button type="button" className="button primary" onClick={() => void open(next)}><Icon name="play" size={16}/>{next.opened ? "Continuar" : "Abrir"} lección: {next.title}</button></p>
          </> : <><h2 id="next-title">¡Terminaste todas las lecciones!</h2><p className="muted">Puedes repasar cualquiera cuando quieras.</p></>}
        {space.learner && lessons.length > 0 && <Progress value={completed} max={lessons.length} label="Lecciones terminadas"/>}
        {space.learner && <p className="muted small">Estudias como {space.learner.name}. <button type="button" className="link-button" disabled={busy} onClick={() => void identify(null)}>No soy yo</button></p>}
      </section>
      {space.path.map(unit => <section key={unit.id} className="stack" aria-labelledby={`unit-${unit.id}`}>
        <h2 id={`unit-${unit.id}`}>{unit.name}</h2>
        <ol className="student-path">{unit.lessons.map(lesson => <li key={lesson.shareCode} className={lesson.completed ? "is-done" : lesson.opened ? "is-open" : undefined}>
          <span className="path-mark" aria-hidden="true">{lesson.completed ? <Icon name="check" size={14}/> : lesson.opened ? <Icon name="clock" size={14}/> : null}</span>
          <button type="button" className="link-button" onClick={() => void open(lesson)}>{lesson.title}</button>
          {space.learner && <span className="muted small">{lesson.completed ? "Terminada" : lesson.opened ? "En curso" : "Pendiente"}</span>}
        </li>)}</ol>
      </section>)}
    </>}
    <p className="login-privacy"><Icon name="shield" size={16}/>{space.learner ? "Tu avance se guarda con tu nombre de la lista de la sección para que tu educador te acompañe. Tus respuestas se quedan en este dispositivo." : "Solo ves las lecciones de tu sección. No guardamos tu nombre ni tus datos."}</p>
  </main>;
}

function ClassCard({ item, today, headingId, big }: { item: StudentClass; today: string; headingId?: string; big?: boolean }) {
  const Heading = big ? "h2" : "h3";
  return <>
    <Heading id={headingId}>{item.sessionDate === today ? "Hoy" : sessionDay(item.sessionDate)}{item.startsAt ? `, ${item.startsAt}` : ""}{item.status === "in_progress" && <> <StatusBadge tone="warning">En curso</StatusBadge></>}</Heading>
    {item.lessons.length ? <p className="button-row">{item.lessons.map((lesson, index) => <Link key={lesson.shareCode} className={big && !index ? "button primary" : "button secondary small"} href={`/aprender/${lesson.shareCode}`}><Icon name="play" size={16}/>Abrir lección: {lesson.title}</Link>)}</p> : big && <p className="muted">Las lecciones de esta clase aún no están disponibles.</p>}
    {big && item.resources.length > 0 && <ul className="student-resources" aria-label="Recursos de la clase">{item.resources.map(resource => <li key={resource.id}><ResourceLink resource={resource}/></li>)}</ul>}
  </>;
}

function ResourceLink({ resource }: { resource: ClassResource }) {
  const [open, setOpen] = useState(false);
  if (resource.kind === "link" && resource.content) return <><a href={resource.content} target="_blank" rel="noopener noreferrer"><Icon name="link" size={16}/>{resource.title}<span className="sr-only"> (se abre en otra pestaña)</span></a>{resource.description && <p>{resource.description}</p>}</>;
  if (resource.kind === "file") return <><a href={`/api/student/files/${resource.id}`} download={resource.fileName || resource.title}><Icon name="download" size={16}/>{resource.title}</a><p>Documento{resource.fileName ? ` · ${resource.fileName}` : ""}</p></>;
  return <><button type="button" className="link-button" aria-expanded={open} onClick={() => setOpen(!open)}><Icon name="text" size={16}/>{resource.title}</button>{resource.description && <p>{resource.description}</p>}{open && <p className="student-text">{resource.content}</p>}</>;
}
