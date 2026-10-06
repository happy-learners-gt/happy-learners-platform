import { useEffect, useState } from "react";
import type { SectionSummary } from "@happy-learners/contracts";
import { api, message } from "../../api";
import { Link, useNavigation } from "../../navigation";
import { useSession } from "../../session";
import { matches, plural, sessionDay } from "../../model";
import { Icon } from "../../ui/icons";
import { EmptyState, ErrorState, Loading, PageHeader, PrimaryAction, Section, StatusBadge } from "../../ui/primitives";
import { WeekGrid } from "../course/Timetable";
import { SectionCards } from "./SectionCard";
import { sectionPath } from "./context";

/**
 * /agenda — what is taught and when (DEC-031): the next classes, the week, and the sections behind them with their own
 * indicators. Each educator sees only the sections they teach; administration sees every section of the organization.
 * The sections themselves live in their course, in the menu and at /cursos/:id/secciones.
 */
export function Agenda() {
  const { member } = useSession();
  const admin = member.role === "admin";
  const { url, navigate } = useNavigation();
  const [sections, setSections] = useState<SectionSummary[] | null>(null), [today, setToday] = useState(""), [error, setError] = useState("");
  const query = url.searchParams.get("q") || "", course = url.searchParams.get("curso") || "";
  async function load() {
    setError("");
    try { const result = await api<{ sections: SectionSummary[]; today: string }>("/sections"); setSections(result.sections); setToday(result.today); }
    catch (cause) { setError(message(cause)); }
  }
  useEffect(() => { void load(); }, []);
  function filter(key: string, value: string) { const next = new URL(url); if (value) next.searchParams.set(key, value); else next.searchParams.delete(key); navigate(next.pathname + next.search, true); }
  const live = (sections || []).filter(item => item.status === "active" && item.course.status === "active");
  const taught = admin ? live : live.filter(item => item.teaches);
  const upcoming = taught.filter(item => item.next).sort((a, b) => `${a.next!.sessionDate} ${a.next!.startsAt || ""}`.localeCompare(`${b.next!.sessionDate} ${b.next!.startsAt || ""}`));
  const courses = [...new Map(live.map(item => [item.courseId, item.course.title])).entries()].sort((a, b) => a[1].localeCompare(b[1], "es"));
  const visible = live.filter(item => (!course || item.courseId === course) && matches(query, item.name, item.course.title));
  const closed = (sections || []).filter(item => !live.includes(item) && (!course || item.courseId === course));
  const header = <PageHeader title="Agenda"
    description={sections ? admin ? `Las próximas clases y la semana de toda la organización: ${plural(live.length, "sección activa", "secciones activas")} en ${plural(courses.length, "curso", "cursos")}.` : `Tus próximas clases, tu semana y las ${plural(live.length, "sección que impartes", "secciones que impartes")}.` : undefined}
    primary={upcoming[0] && <PrimaryAction href={`${sectionPath(upcoming[0].id)}/clases/${upcoming[0].next!.id}`} icon={upcoming[0].next!.status === "in_progress" ? "play" : "calendar"}>{upcoming[0].next!.status === "in_progress" ? "Continuar la clase en curso" : upcoming[0].next!.sessionDate === today ? "Abrir la clase de hoy" : "Ver la próxima clase"}</PrimaryAction>}/>;
  if (error) return <>{header}<ErrorState error={error} retry={() => void load()}/></>;
  if (!sections) return <>{header}<Loading label="Cargando la agenda…" lines={6}/></>;
  if (!sections.length) return <>{header}{admin
    ? <EmptyState icon="calendar" title="Aún no hay secciones" action={<Link href="/cursos" className="button primary">Ir a los cursos</Link>}>Las clases aparecen aquí cuando un curso tiene secciones con horario. Crea las secciones desde cada curso, en su página Secciones o con «+» en el menú.</EmptyState>
    : <EmptyState icon="calendar" title="Aún no tienes secciones asignadas">Administración asigna quién imparte cada sección. Cuando te asigne una, aquí verás sus clases y tu semana.</EmptyState>}</>;
  return <>
    {header}
    <div className="agenda-layout">
      <Section title="Próximas clases" className="agenda-next">
        {upcoming.length ? <ol className="agenda-list">{upcoming.slice(0, 8).map(item => {
          const next = item.next!;
          return <li key={item.id}><Link href={`${sectionPath(item.id)}/clases/${next.id}`}>
            <span className="agenda-when"><strong>{next.sessionDate === today ? "Hoy" : sessionDay(next.sessionDate, "short")}</strong>{next.startsAt && <span>{next.startsAt}</span>}</span>
            <span className="agenda-what"><strong>{item.name}</strong><span className="muted small">{item.course.title}</span></span>
            {next.status === "in_progress" ? <StatusBadge tone="warning">En curso</StatusBadge> : <Icon name="chevronRight" size={16}/>}
          </Link></li>;
        })}</ol> : <EmptyState compact icon="calendar" title="Sin clases próximas">{taught.some(item => item.pacing !== "self-paced") ? "Los periodos de los horarios terminaron o todas sus clases están registradas." : "Las secciones a tu ritmo no tienen clases: su avance se sigue en cada sección."}</EmptyState>}
      </Section>
      <WeekGrid title={admin ? "La semana" : "Tu semana"} sections={taught.map(item => ({ ...item, href: `${sectionPath(item.id)}/clases`, detail: item.course.title }))}/>
    </div>
    <section className="agenda-sections" aria-labelledby="agenda-sections">
      <h2 id="agenda-sections">{admin ? "Secciones" : "Tus secciones"}</h2>
      {(live.length > 4 || courses.length > 1) && <div className="toolbar" role="group" aria-label="Filtrar secciones">
        <div className="search-field"><Icon name="search" size={18}/><label htmlFor="section-search" className="sr-only">Buscar secciones</label><input id="section-search" type="search" value={query} onChange={event => filter("q", event.target.value)} placeholder="Buscar por sección o curso"/></div>
        {courses.length > 1 && <label className="select-inline"><span>Curso</span><select value={course} onChange={event => filter("curso", event.target.value)}><option value="">Todos</option>{courses.map(([id, title]) => <option key={id} value={id}>{title}</option>)}</select></label>}
      </div>}
      {visible.length ? <SectionCards sections={visible} today={today}/> : live.length ? <EmptyState icon="search" title="Ninguna sección coincide" action={<button type="button" className="button secondary" onClick={() => navigate(url.pathname, true)}>Quitar filtros</button>}>Prueba con otra palabra o elige otro curso.</EmptyState> : null}
      {closed.length > 0 && <details className="closed-groups"><summary>Secciones cerradas o de cursos archivados ({closed.length})</summary><SectionCards sections={closed} today={today}/></details>}
    </section>
  </>;
}
