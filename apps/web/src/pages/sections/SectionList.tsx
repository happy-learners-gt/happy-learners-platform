import { useEffect, useState } from "react";
import type { SectionSummary } from "@happy-learners/contracts";
import { api, message } from "../../api";
import { Link, useNavigation } from "../../navigation";
import { useSession } from "../../session";
import { matches, plural } from "../../model";
import { Icon } from "../../ui/icons";
import { EmptyState, ErrorState, Loading, PageHeader } from "../../ui/primitives";
import { WeekGrid } from "../course/Timetable";
import { SectionCards } from "./SectionCard";
import { sectionPath } from "./context";

/**
 * /secciones — the sections a person works with (DEC-024). Each educator sees only the sections they teach, with
 * each one's own indicators; administration sees every section of the organization, by course.
 */
export function SectionList() {
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
  const courses = [...new Map(live.map(item => [item.courseId, item.course.title])).entries()].sort((a, b) => a[1].localeCompare(b[1], "es"));
  const visible = live.filter(item => (!course || item.courseId === course) && matches(query, item.name, item.course.title));
  const closed = (sections || []).filter(item => !live.includes(item) && (!course || item.courseId === course));
  const header = <PageHeader title={admin ? "Secciones" : "Mis secciones"}
    description={sections ? admin ? `${plural(live.length, "sección activa", "secciones activas")} en ${plural(courses.length, "curso", "cursos")}` : `${plural(live.length, "sección asignada", "secciones asignadas")} a tu cuenta. Cada una con sus estudiantes, su cronograma y su propio avance.` : undefined}/>;
  if (error) return <>{header}<ErrorState error={error} retry={() => void load()}/></>;
  if (!sections) return <>{header}<Loading label="Cargando secciones…" lines={6}/></>;
  if (!sections.length) return <>{header}{admin
    ? <EmptyState icon="users" title="Aún no hay secciones" action={<Link className="button primary" href="/cursos">Ir a Cursos</Link>}>Las secciones se crean desde cada curso: abre un curso y elige Secciones.</EmptyState>
    : <EmptyState icon="users" title="Aún no tienes secciones asignadas">Administración asigna quién imparte cada sección. Cuando te asigne una, aparecerá aquí con su cronograma.</EmptyState>}</>;
  return <>
    {header}
    {(live.length > 4 || courses.length > 1) && <div className="toolbar" role="group" aria-label="Filtrar secciones">
      <div className="search-field"><Icon name="search" size={18}/><label htmlFor="section-search" className="sr-only">Buscar secciones</label><input id="section-search" type="search" value={query} onChange={event => filter("q", event.target.value)} placeholder="Buscar por sección o curso"/></div>
      {courses.length > 1 && <label className="select-inline"><span>Curso</span><select value={course} onChange={event => filter("curso", event.target.value)}><option value="">Todos</option>{courses.map(([id, title]) => <option key={id} value={id}>{title}</option>)}</select></label>}
    </div>}
    {visible.length ? <SectionCards sections={visible} today={today}/> : live.length ? <EmptyState icon="search" title="Ninguna sección coincide" action={<button type="button" className="button secondary" onClick={() => navigate(url.pathname, true)}>Quitar filtros</button>}>Prueba con otra palabra o elige otro curso.</EmptyState> : null}
    {!admin && <WeekGrid title="Mi semana" sections={live.filter(item => item.teaches).map(item => ({ ...item, href: `${sectionPath(item.id)}/clases`, detail: item.course.title }))}/>}
    {closed.length > 0 && <details className="closed-groups"><summary>Secciones cerradas o de cursos archivados ({closed.length})</summary><SectionCards sections={closed} today={today}/></details>}
  </>;
}
