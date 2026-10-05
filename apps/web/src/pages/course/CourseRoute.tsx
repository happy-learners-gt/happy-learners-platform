import { lazy, Suspense, useEffect } from "react";
import { useNavigation } from "../../navigation";
import { AppShell } from "../../ui/Shell";
import type { SidebarModel } from "../../ui/Shell";
import { EmptyState, ErrorState, Loading, PageHeader } from "../../ui/primitives";
import { Link } from "../../navigation";
import { hueFor } from "../../model";
import { CourseProvider, capabilities, courseConfiguration, useCourseLoader } from "./context";
import { Overview } from "./Overview";
import { Content } from "./Content";
import { CourseLibrary } from "./CourseLibrary";
import { Sections } from "./Sections";
import { Timetable } from "./Timetable";
import { Classes } from "./Classes";
import { Settings } from "./Settings";
import { Plan } from "./Plan";
const LessonEditor = lazy(() => import("../LessonEditor").then(module => ({ default: module.LessonEditor })));

const areas = ["", "plan", "contenido", "biblioteca", "clases", "asignaciones", "horario", "configuracion", "lecciones"];

export function CourseRoute({ id, area, item }: { id: string; area: string; item?: string }) {
  const { url, navigate } = useNavigation();
  const { state, load } = useCourseLoader(id);
  const base = `/cursos/${id}`;
  // v0.2.2 locations: Materiales, Editar lecciones (?editar=) and Preparar lección (?nueva=).
  useEffect(() => {
    if (area === "materiales") navigate(`${base}/biblioteca`, true);
    // v0.8.4: groups are the course's sections (Asignaciones); the lessons of each class are planned in Clases.
    else if (area === "grupos") navigate(`${base}/asignaciones${url.hash}`, true);
    else if (area === "cronograma") navigate(`${base}/clases`, true);
    // v0.8: attendance is taken inside each class.
    else if (area === "asistencia") navigate(`${base}/clases${item ? `/${item}` : ""}${url.search}`, true);
    else if (area === "lecciones" && !item) {
      const lesson = url.searchParams.get("editar");
      navigate(lesson ? `${base}/lecciones/${lesson}` : `${base}/contenido${url.searchParams.get("unidad") ? `?unidad=${url.searchParams.get("unidad")}` : ""}`, true);
    }
  }, [area, item, url.search]);
  const course = state.status === "ready" ? state.data.course : null;
  const configuration = state.status === "ready" ? courseConfiguration(state.data.course, state.data.program) : null;
  // Sections, schedule, classes and attendance appear when the course's configuration enables them; the server shows each person their own sections.
  const attendance = !!configuration?.settings.attendance;
  const classroomArea = ["clases", "asignaciones", "horario"].includes(area);
  const current = area === "lecciones" ? "contenido" : area;
  const sidebar: SidebarModel = {
    label: "Navegación del curso",
    back: { href: "/cursos", label: "Todos los cursos" },
    subtitle: course?.status === "archived" ? "Curso archivado" : "Curso",
    title: course?.title || "Cargando curso…",
    hue: hueFor(id),
    items: [
      { href: base, label: "Resumen", icon: "overview" as const, hue: "violet" as const, active: current === "" },
      ...(attendance ? [
        { href: `${base}/clases`, label: "Clases", icon: "calendar" as const, hue: "coral" as const, active: current === "clases" },
        { href: `${base}/asignaciones`, label: "Asignaciones", icon: "users" as const, hue: "pink" as const, active: current === "asignaciones" },
        { href: `${base}/horario`, label: "Horario", icon: "clock" as const, hue: "violet" as const, active: current === "horario" },
      ] : []),
      { href: `${base}/contenido`, label: "Contenido", icon: "content" as const, hue: "sky" as const, active: current === "contenido" },
      { href: `${base}/plan`, label: "Plan curricular", icon: "spark" as const, hue: "green" as const, active: current === "plan" },
      { href: `${base}/biblioteca`, label: "Biblioteca del curso", icon: "library" as const, hue: "teal" as const, active: current === "biblioteca" },
      { href: `${base}/configuracion`, label: "Configuración", icon: "settings" as const, hue: "amber" as const, active: current === "configuracion" },
    ],
  };
  let body;
  if (state.status === "loading" || area === "materiales" || area === "asistencia" || area === "grupos" || area === "cronograma" || (area === "lecciones" && !item)) body = <><PageHeader title={<span className="skeleton-title">Cargando curso</span>}/><Loading label="Abriendo curso…" lines={6}/></>;
  else if (state.status === "error") body = state.code === 404
    ? <EmptyState level={1} icon="courses" title="Este curso no está disponible" action={<Link href="/cursos" className="button primary">Ver todos los cursos</Link>}>Puede que el enlace haya cambiado o que el curso pertenezca a otra organización.</EmptyState>
    : state.code === 403 ? <EmptyState level={1} icon="shield" title="Este curso no está asignado a tu cuenta" action={<Link href="/cursos" className="button primary">Ver mis cursos</Link>}>Administración asigna los cursos y sus secciones. Si debes impartirlo o colaborar en él, pídele que te agregue a su equipo.</EmptyState>
    : <><PageHeader title="No se pudo abrir el curso"/><ErrorState error={state.error} retry={() => void load()}/></>;
  else if (!areas.includes(area) || (classroomArea && !attendance)) body = <EmptyState level={1} icon="info" title="Esta sección no existe" action={<Link href={base} className="button primary">Ir al resumen del curso</Link>}>Usa el menú del curso para elegir otra sección.</EmptyState>;
  else {
    const data = { ...state.data, ...configuration!, ...capabilities(state.data.course), reload: load };
    body = <CourseProvider data={data}>
      {area === "" && <Overview/>}
      {area === "plan" && <Plan/>}
      {area === "contenido" && <Content/>}
      {area === "biblioteca" && <CourseLibrary/>}
      {area === "asignaciones" && <Sections/>}
      {area === "horario" && <Timetable/>}
      {area === "clases" && <Classes sessionId={item}/>}
      {area === "configuracion" && <Settings/>}
      {area === "lecciones" && item && <Suspense fallback={<Loading label="Abriendo editor…" lines={8}/>}><LessonEditor key={item} lessonId={item}/></Suspense>}
    </CourseProvider>;
  }
  return <AppShell sidebar={sidebar}>{body}</AppShell>;
}
