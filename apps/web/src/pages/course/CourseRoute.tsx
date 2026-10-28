import { lazy, Suspense, useEffect } from "react";
import { useNavigation } from "../../navigation";
import { api } from "../../api";
import { EmptyState, ErrorState, Loading, PageHeader } from "../../ui/primitives";
import { Link } from "../../navigation";
import { CourseProvider, capabilities, courseConfiguration, useCourseLoader } from "./context";
import { Overview } from "./Overview";
import { Content } from "./Content";
import { CourseLibrary } from "./CourseLibrary";
import { Assistant } from "./Assistant";
import { CourseSections } from "./Sections";
import { Settings } from "./Settings";
import { Plan } from "./Plan";
import { sectionPath } from "../sections/context";
const LessonEditor = lazy(() => import("../LessonEditor").then(module => ({ default: module.LessonEditor })));

const areas = ["", "plan", "contenido", "biblioteca", "secciones", "configuracion", "lecciones", "asistente"];
/** Locations from before v0.8.7, when classes, sections and schedules lived inside the course (DEC-024). */
const sectionAreas = ["clases", "asignaciones", "horario", "grupos", "cronograma", "asistencia"];

/** /cursos/:id — the course as the definition of what is taught: its plan, content, library, team and sections. */
export function CourseRoute({ id, area, item }: { id: string; area: string; item?: string }) {
  const { url, navigate } = useNavigation();
  const { state, load } = useCourseLoader(id);
  const base = `/cursos/${id}`;
  // v0.2.2 locations: Materiales, Editar lecciones (?editar=) and Preparar lección (?nueva=).
  useEffect(() => {
    if (area === "materiales") navigate(`${base}/biblioteca`, true);
    // 1.2.0 locations of the assistant's steps.
    else if (area === "propuestas") navigate(`${base}/asistente?paso=propuestas`, true);
    else if (area === "mapa-del-libro") navigate(`${base}/asistente?paso=mapa`, true);
    else if (sectionAreas.includes(area)) void redirectToSection(id, area, item, url).then(target => navigate(target, true));
    else if (area === "lecciones" && !item) {
      const lesson = url.searchParams.get("editar");
      navigate(lesson ? `${base}/lecciones/${lesson}` : `${base}/contenido${url.searchParams.get("unidad") ? `?unidad=${url.searchParams.get("unidad")}` : ""}`, true);
    }
  }, [area, item, url.search]);
  const course = state.status === "ready" ? state.data.course : null;
  const configuration = state.status === "ready" ? courseConfiguration(state.data.course, state.data.program) : null;
  // Sections appear when the course's configuration enables attendance; the server shows each person their own sections.
  const attendance = !!configuration?.settings.attendance;
  let body;
  if (state.status === "loading" || area === "materiales" || area === "propuestas" || area === "mapa-del-libro" || sectionAreas.includes(area) || (area === "lecciones" && !item)) body = <><PageHeader title={<span className="skeleton-title">Cargando curso</span>}/><Loading label="Abriendo curso…" lines={6}/></>;
  else if (state.status === "error") body = state.code === 404
    ? <EmptyState level={1} icon="courses" title="Este curso no está disponible" action={<Link href="/cursos" className="button primary">Ver todos los cursos</Link>}>Puede que el enlace haya cambiado o que el curso pertenezca a otra organización.</EmptyState>
    : state.code === 403 ? <EmptyState level={1} icon="shield" title="Este curso no está asignado a tu cuenta" action={<Link href="/cursos" className="button primary">Ver mis cursos</Link>}>Administración asigna los cursos y sus secciones. Si debes impartirlo o colaborar en él, pídele que te agregue a su equipo.</EmptyState>
    : <><PageHeader title="No se pudo abrir el curso"/><ErrorState error={state.error} retry={() => void load()}/></>;
  else if (!areas.includes(area) || (area === "secciones" && !attendance)) body = <EmptyState level={1} icon="info" title="Esta sección no existe" action={<Link href={base} className="button primary">Ir al resumen del curso</Link>}>Usa el menú del curso para elegir otra sección.</EmptyState>;
  else {
    const data = { ...state.data, ...configuration!, ...capabilities(state.data.course), reload: load };
    body = <CourseProvider data={data}>
      {area === "" && <Overview/>}
      {area === "plan" && <Plan/>}
      {area === "contenido" && <Content/>}
      {area === "biblioteca" && <CourseLibrary/>}
      {area === "asistente" && <Assistant/>}
      {area === "secciones" && <CourseSections/>}
      {area === "configuracion" && <Settings/>}
      {area === "lecciones" && item && <Suspense fallback={<Loading label="Abriendo editor…" lines={8}/>}><LessonEditor key={item} lessonId={item}/></Suspense>}
    </CourseProvider>;
  }
  return body;
}

/** Where a former course location lives now: the section it named, the section of the class it named, or the course's sections. */
async function redirectToSection(courseId: string, area: string, item: string | undefined, url: URL) {
  const sections = `/cursos/${courseId}/secciones`;
  if (item && (area === "clases" || area === "asistencia")) {
    const group = await api<{ session: { groupId: string } }>(`/courses/${courseId}/sessions/${item}`).then(result => result.session.groupId, () => null);
    return group ? `${sectionPath(group)}/clases/${item}` : sections;
  }
  const named = url.searchParams.get("seccion") || /^#(?:seccion|horario)-(.+)$/.exec(url.hash)?.[1];
  if (!named) return sections;
  const view = url.searchParams.get("vista");
  return `${sectionPath(named)}${area === "horario" ? "/horario" : area === "asignaciones" || area === "grupos" ? "/estudiantes" : `/clases${view ? `?vista=${view}` : ""}`}`;
}
