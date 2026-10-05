import { lazy, Suspense, useEffect } from "react";
import { useNavigation } from "../../navigation";
import { useSession } from "../../session";
import { AppShell } from "../../ui/Shell";
import type { SidebarModel } from "../../ui/Shell";
import { EmptyState, ErrorState, Loading, PageHeader } from "../../ui/primitives";
import { Link } from "../../navigation";
import { hueFor } from "../../model";
import { CourseProvider, courseConfiguration, useCourseLoader } from "./context";
import { Overview } from "./Overview";
import { Content } from "./Content";
import { CourseLibrary } from "./CourseLibrary";
import { Groups } from "./Groups";
import { Assignments } from "./Assignments";
import { Classes } from "./Classes";
import { Settings } from "./Settings";
import { Plan } from "./Plan";
const LessonEditor = lazy(() => import("../LessonEditor").then(module => ({ default: module.LessonEditor })));

const areas = ["", "plan", "contenido", "biblioteca", "clases", "grupos", "asignaciones", "configuracion", "lecciones"];
const educatorOnly = new Set(["clases", "grupos", "asignaciones", "configuracion"]);

export function CourseRoute({ id, area, item }: { id: string; area: string; item?: string }) {
  const { url, navigate } = useNavigation();
  const { state, load, educator, admin } = useCourseLoader(id);
  const { member } = useSession();
  const base = `/cursos/${id}`;
  // v0.2.2 locations: Materiales, Editar lecciones (?editar=) and Preparar lección (?nueva=).
  useEffect(() => {
    if (area === "materiales") navigate(`${base}/biblioteca`, true);
    // v0.8: attendance is taken inside each class.
    else if (area === "asistencia") navigate(`${base}/clases${item ? `/${item}` : ""}${url.search}`, true);
    else if (area === "lecciones" && !item) {
      const lesson = url.searchParams.get("editar");
      navigate(lesson ? `${base}/lecciones/${lesson}` : `${base}/contenido${url.searchParams.get("unidad") ? `?unidad=${url.searchParams.get("unidad")}` : ""}`, true);
    }
  }, [area, item, url.search]);
  const course = state.status === "ready" ? state.data.course : null;
  const configuration = state.status === "ready" ? courseConfiguration(state.data.course, state.data.program) : null;
  // Groups and attendance appear only when the course's configuration enables them, and only to its teaching team.
  const attendance = !!configuration?.settings.attendance;
  const classroom = educator && !!course?.team?.some(person => person.userId === member.id);
  const classroomArea = ["clases", "grupos", "asignaciones"].includes(area);
  const current = area === "lecciones" ? "contenido" : area;
  const sidebar: SidebarModel = {
    label: "Navegación del curso",
    back: { href: "/cursos", label: "Todos los cursos" },
    subtitle: course?.status === "archived" ? "Curso archivado" : "Curso",
    title: course?.title || "Cargando curso…",
    hue: hueFor(id),
    items: [
      { href: base, label: "Resumen", icon: "overview" as const, hue: "violet" as const, active: current === "" },
      ...(classroom && attendance ? [
        { href: `${base}/clases`, label: "Clases", icon: "calendar" as const, hue: "coral" as const, active: current === "clases" },
        { href: `${base}/grupos`, label: "Grupos", icon: "users" as const, hue: "pink" as const, active: current === "grupos" },
      ] : []),
      { href: `${base}/contenido`, label: "Contenido", icon: "content" as const, hue: "sky" as const, active: current === "contenido" },
      { href: `${base}/plan`, label: "Plan curricular", icon: "spark" as const, hue: "green" as const, active: current === "plan" },
      { href: `${base}/biblioteca`, label: "Biblioteca del curso", icon: "library" as const, hue: "teal" as const, active: current === "biblioteca" },
      ...(classroom && attendance ? [{ href: `${base}/asignaciones`, label: "Asignaciones", icon: "list" as const, hue: "violet" as const, active: current === "asignaciones" }] : []),
      ...(educator || admin ? [{ href: `${base}/configuracion`, label: "Configuración", icon: "settings" as const, hue: "amber" as const, active: current === "configuracion" }] : []),
    ],
  };
  let body;
  if (state.status === "loading" || area === "materiales" || area === "asistencia" || (area === "lecciones" && !item)) body = <><PageHeader title={<span className="skeleton-title">Cargando curso</span>}/><Loading label="Abriendo curso…" lines={6}/></>;
  else if (state.status === "error") body = state.code === 404
    ? <EmptyState level={1} icon="courses" title="Este curso no está disponible" action={<Link href="/cursos" className="button primary">Ver todos los cursos</Link>}>Puede que el enlace haya cambiado o que el curso pertenezca a otra organización.</EmptyState>
    : <><PageHeader title="No se pudo abrir el curso"/><ErrorState error={state.error} retry={() => void load()}/></>;
  else if (!areas.includes(area) || (educatorOnly.has(area) && !educator && !(area === "configuracion" && admin)) || (classroomArea && !attendance)) body = <EmptyState level={1} icon="info" title="Esta sección no existe" action={<Link href={base} className="button primary">Ir al resumen del curso</Link>}>Usa el menú del curso para elegir otra sección.</EmptyState>;
  else if (classroomArea && !classroom) body = <EmptyState level={1} icon="users" title="Solo el equipo docente del curso" action={<Link href={base} className="button primary">Ir al resumen del curso</Link>}>Las clases, los grupos, las asignaciones y la asistencia de este curso solo los consulta su equipo docente. Administración gestiona el equipo.</EmptyState>;
  else {
    const data = { ...state.data, ...configuration!, educator, admin, classroom, writable: educator && state.data.course.status === "active", reload: load };
    body = <CourseProvider data={data}>
      {area === "" && <Overview/>}
      {area === "plan" && <Plan/>}
      {area === "contenido" && <Content/>}
      {area === "biblioteca" && <CourseLibrary/>}
      {area === "grupos" && <Groups/>}
      {area === "asignaciones" && <Assignments/>}
      {area === "clases" && <Classes sessionId={item}/>}
      {area === "configuracion" && <Settings/>}
      {area === "lecciones" && item && <Suspense fallback={<Loading label="Abriendo editor…" lines={8}/>}><LessonEditor key={item} lessonId={item}/></Suspense>}
    </CourseProvider>;
  }
  return <AppShell sidebar={sidebar}>{body}</AppShell>;
}
