import { useEffect, useState } from "react";
import type { ClassResource, StudentClass, StudentSpace as Space } from "@happy-learners/contracts";
import { api, ApiError, message } from "../api";
import { Link, useNavigation } from "../navigation";
import { sessionDay } from "../model";
import { Icon } from "../ui/icons";
import { EmptyState, ErrorState, Loading, StatusBadge } from "../ui/primitives";

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
  if (missing) return <main id="main" className="student-page"><EmptyState level={1} icon="users" title="Escribe el código de tu grupo" action={<Link className="button primary" href="/inicio">Ir al inicio</Link>}>El acceso terminó o el código cambió. Pídele el código actual a tu educador.</EmptyState></main>;
  if (error) return <main id="main" className="student-page"><h1>Mi grupo</h1><ErrorState error={error} retry={() => void load()}/></main>;
  if (!space) return <main id="main" className="student-page"><p role="status" className="sr-only">Abriendo tu grupo…</p><Loading label="Abriendo tu grupo…" lines={6}/></main>;
  return <main id="main" className="student-page">
    <div className="student-top">
      <span className="welcome-date">{space.organization}</span>
      <button type="button" className="button ghost small" onClick={() => void leave()}><Icon name="logout" size={16}/>Salir</button>
    </div>
    <header><h1>{space.group.name}</h1><p className="page-description">{space.course.title}</p></header>
    <section className="student-next" aria-labelledby="next-title">
      <span className="eyebrow">Próxima clase</span>
      {space.next ? <ClassCard item={space.next} today={space.today} headingId="next-title" big/> : <><h2 id="next-title">No hay clases programadas</h2><p className="muted">Cuando tu educador planifique la siguiente clase, aparecerá aquí con sus recursos.</p></>}
    </section>
    {space.lessons.length > 0 && <section aria-labelledby="lessons-title" className="stack">
      <h2 id="lessons-title">Lecciones asignadas</h2>
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
    <p className="login-privacy"><Icon name="shield" size={16}/>Solo ves las clases de tu grupo. No guardamos tu nombre ni tus datos.</p>
  </main>;
}

function ClassCard({ item, today, headingId, big }: { item: StudentClass; today: string; headingId?: string; big?: boolean }) {
  const Heading = big ? "h2" : "h3";
  return <>
    <Heading id={headingId}>{item.sessionDate === today ? "Hoy" : sessionDay(item.sessionDate)}{item.startsAt ? `, ${item.startsAt}` : ""}{item.status === "in_progress" && <> <StatusBadge tone="warning">En curso</StatusBadge></>}</Heading>
    {item.lesson ? <p><Link className={big ? "button primary" : "button secondary small"} href={`/aprender/${item.lesson.shareCode}`}><Icon name="play" size={16}/>Abrir lección: {item.lesson.title}</Link></p> : big && <p className="muted">La lección de esta clase aún no está disponible.</p>}
    {big && item.resources.length > 0 && <ul className="student-resources" aria-label="Recursos de la clase">{item.resources.map(resource => <li key={resource.id}><ResourceLink resource={resource}/></li>)}</ul>}
  </>;
}

function ResourceLink({ resource }: { resource: ClassResource }) {
  const [open, setOpen] = useState(false);
  if (resource.kind === "link" && resource.content) return <><a href={resource.content} target="_blank" rel="noopener noreferrer"><Icon name="link" size={16}/>{resource.title}<span className="sr-only"> (se abre en otra pestaña)</span></a>{resource.description && <p>{resource.description}</p>}</>;
  if (resource.kind === "file") return <><a href={`/api/student/files/${resource.id}`} download={resource.fileName || resource.title}><Icon name="download" size={16}/>{resource.title}</a><p>Documento{resource.fileName ? ` · ${resource.fileName}` : ""}</p></>;
  return <><button type="button" className="link-button" aria-expanded={open} onClick={() => setOpen(!open)}><Icon name="text" size={16}/>{resource.title}</button>{resource.description && <p>{resource.description}</p>}{open && <p className="student-text">{resource.content}</p>}</>;
}
