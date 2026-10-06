import { useCallback, useEffect, useState } from "react";
import type { SectionSummary } from "@happy-learners/contracts";
import { scheduleSummary } from "@happy-learners/domain";
import { api, message } from "../../api";
import { Link } from "../../navigation";
import { useSession } from "../../session";
import { hueFor, plural, sessionDay } from "../../model";
import { AppShell } from "../../ui/Shell";
import type { SidebarModel } from "../../ui/Shell";
import { useFeedback } from "../../ui/feedback";
import { Icon } from "../../ui/icons";
import { Menu } from "../../ui/Menu";
import { InlineName } from "../../ui/LessonOutline";
import { ActivityFeed } from "../../ui/progress";
import { EmptyState, ErrorState, Loading, PageHeader, PrimaryAction, Progress, Section, StatTiles, StatusBadge } from "../../ui/primitives";
import { CourseProvider, capabilities, courseConfiguration, useCourse, useCourseLoader } from "../course/context";
import { Classes } from "../course/Classes";
import { SectionEducators, SectionStudents } from "../course/Sections";
import { Timetable } from "../course/Timetable";
import { SectionProvider, sectionPath, useSection } from "./context";

const areas = ["", "clases", "estudiantes", "horario"];
type State = { status: "loading" } | { status: "error"; error: string; code: number } | { status: "ready"; section: SectionSummary; today: string };

/**
 * /secciones/:id — a section as its own instance of a course (DEC-024): its summary, its schedule of classes, its
 * students and its timetable, with the course's lessons at hand. Administration reaches every section; each
 * educator only the sections they teach.
 */
export function SectionRoute({ id, area, item }: { id: string; area: string; item?: string }) {
  const { member } = useSession();
  const [state, setState] = useState<State>({ status: "loading" });
  const load = useCallback(async () => {
    try { const result = await api<{ section: SectionSummary; today: string }>(`/sections/${id}`); setState({ status: "ready", section: result.section, today: result.today }); }
    catch (cause) { setState({ status: "error", error: message(cause), code: (cause as { status?: number }).status || 0 }); }
  }, [id]);
  useEffect(() => { setState({ status: "loading" }); void load(); }, [load]);
  const base = sectionPath(id);
  const section = state.status === "ready" ? state.section : null;
  const sidebar: SidebarModel = {
    label: "Navegación de la sección",
    back: { href: "/secciones", label: member.role === "admin" ? "Todas las secciones" : "Mis secciones" },
    subtitle: section ? section.course.title : "Sección",
    title: section?.name || "Cargando sección…",
    hue: hueFor(section?.courseId || id),
    items: [
      { href: base, label: "Resumen", icon: "overview", hue: "violet", active: area === "" },
      { href: `${base}/clases`, label: "Cronograma", icon: "calendar", hue: "coral", active: area === "clases" },
      { href: `${base}/estudiantes`, label: "Estudiantes", icon: "users", hue: "pink", active: area === "estudiantes" },
      { href: `${base}/horario`, label: "Horario", icon: "clock", hue: "violet", active: area === "horario" },
      ...(section ? [{ href: `/cursos/${section.courseId}`, label: "Curso: plan y contenido", icon: "courses" as const, hue: "sky" as const, active: false }] : []),
    ],
  };
  let body;
  if (state.status === "loading") body = <><PageHeader title={<span className="skeleton-title">Cargando sección</span>}/><Loading label="Abriendo sección…" lines={6}/></>;
  else if (state.status === "error") body = state.code === 403
    ? <EmptyState level={1} icon="shield" title="Esta sección no está asignada a tu cuenta" action={<Link href="/secciones" className="button primary">Ver mis secciones</Link>}>Administración asigna quién imparte cada sección. Si debes impartirla, pídele que te asigne.</EmptyState>
    : state.code === 404 ? <EmptyState level={1} icon="users" title="Esta sección no está disponible" action={<Link href="/secciones" className="button primary">Ver las secciones</Link>}>Puede que el enlace haya cambiado o que la sección pertenezca a otra organización.</EmptyState>
    : <><PageHeader title="No se pudo abrir la sección"/><ErrorState error={state.error} retry={() => void load()}/></>;
  else if (!areas.includes(area)) body = <EmptyState level={1} icon="info" title="Esta página no existe" action={<Link href={base} className="button primary">Ir al resumen de la sección</Link>}>Usa el menú de la sección para elegir otra página.</EmptyState>;
  else body = <SectionWithCourse key={state.section.courseId} section={state.section} today={state.today} base={base} reload={load} area={area} item={item}/>;
  return <AppShell sidebar={sidebar}>{body}</AppShell>;
}

/** The section works with its course's lessons, units and settings: loaded once for all of the section's pages. */
function SectionWithCourse({ section, today, base, reload, area, item }: { section: SectionSummary; today: string; base: string; reload: () => Promise<void>; area: string; item?: string }) {
  const { state, load } = useCourseLoader(section.courseId);
  if (state.status === "loading") return <><PageHeader title={<span className="skeleton-title">{section.name}</span>}/><Loading label="Abriendo sección…" lines={6}/></>;
  if (state.status === "error") return <><PageHeader title="No se pudo abrir la sección"/><ErrorState error={state.error} retry={() => void load()}/></>;
  const data = { ...state.data, ...courseConfiguration(state.data.course, state.data.program), ...capabilities(state.data.course), reload: load };
  return <CourseProvider data={data}><SectionProvider value={{ section, today, base, reload }}>
    {!data.settings.attendance && <p className="notice"><Icon name="info" size={18}/>La asistencia está desactivada en la configuración del curso: la sección se consulta, pero no recibe clases ni marcas nuevas.</p>}
    {area === "" && <SectionOverview/>}
    {area === "clases" && <Classes sessionId={item}/>}
    {area === "estudiantes" && <SectionStudents/>}
    {area === "horario" && <Timetable/>}
  </SectionProvider></CourseProvider>;
}

/** Resumen of a section: its own indicators, its next class, who teaches it and what happened in it. */
function SectionOverview() {
  const { course, configurable, teaches } = useCourse();
  const { section, today, base, reload } = useSection();
  const { toast, confirm } = useFeedback();
  const [renaming, setRenaming] = useState(false);
  const stats = section.indicators, next = section.next;
  const path = `/courses/${course.id}/groups/${section.id}`;
  const editable = configurable && course.status === "active";
  async function update(body: Record<string, string>, done: string) {
    try { await api(path, "PUT", body); await reload(); toast({ message: done }); return true; }
    catch (cause) { toast({ tone: "error", message: message(cause) }); return false; }
  }
  async function setStatus(status: "active" | "archived") {
    if (status === "archived" && !await confirm({ title: `¿Cerrar «${section.name}»?`, body: <p>La sección conserva su lista, sus clases y su asistencia, pero no recibe clases nuevas. Su código de acceso deja de funcionar. Puedes reactivarla después.</p>, confirm: "Cerrar sección", danger: true })) return;
    await update({ status }, status === "archived" ? `«${section.name}» se cerró.` : `«${section.name}» está activa de nuevo.`);
  }
  const primary = next && teaches(section.id) ? <PrimaryAction href={`${base}/clases/${next.id}`} icon={next.status === "in_progress" ? "play" : "calendar"}>{next.status === "in_progress" ? "Continuar la clase en curso" : next.sessionDate === today ? "Abrir la clase de hoy" : "Ver la próxima clase"}</PrimaryAction>
    : editable && !section.schedule && section.status === "active" ? <PrimaryAction href={`${base}/horario`} icon="clock">Configurar horario</PrimaryAction> : undefined;
  return <>
    <PageHeader crumbs={[{ label: "Secciones", href: "/secciones" }, { label: section.name }]} title={section.name}
      description={<>Sección de <Link href={`/cursos/${course.id}`}>{course.title}</Link> · {section.schedule ? scheduleSummary(section.schedule) : "sin horario"}</>}
      meta={section.status === "archived" ? <StatusBadge>Cerrada</StatusBadge> : <StatusBadge tone="success">Activa</StatusBadge>}
      actions={editable && <Menu label={`Acciones de la sección ${section.name}`} items={section.status === "active"
        ? [{ label: "Renombrar", icon: "edit", onSelect: () => setRenaming(true) }, "separator", { label: "Cerrar sección", icon: "archive", danger: true, onSelect: () => void setStatus("archived") }]
        : [{ label: "Reactivar sección", icon: "undo", onSelect: () => void setStatus("active") }]}/>}
      primary={primary}/>
    {renaming && <div className="inline-form"><InlineName value={section.name} label="Nombre de la sección" onSave={name => update({ name }, "Sección renombrada.")} onDone={() => setRenaming(false)}/></div>}
    <StatTiles className="overview-kpis" items={[
      { label: "Estudiantes", value: stats.learners, icon: "users", hue: "pink" },
      { label: "Clases impartidas", value: `${stats.taught} de ${stats.classes}`, icon: "check", hue: "green" },
      { label: "Asistencia promedio", value: stats.attendanceRate === null ? "—" : `${stats.attendanceRate} %`, icon: "users", hue: "violet" },
      { label: "Sin registrar", value: stats.unrecorded, icon: "alert", hue: "coral" },
    ]}/>
    <div className="dashboard">
      <div className="dashboard-main">
        <Section title="Avance del curso en la sección" className="order-2">
          <Progress value={stats.lessonsTaught} max={stats.lessonsPublished} label="Lecciones impartidas"/>
          <Progress value={stats.lessonsPlanned} max={stats.lessonsPublished} label="Lecciones planificadas en el cronograma"/>
          <p className="muted small">Cuenta solo las clases de esta sección, sobre las lecciones publicadas del curso. {stats.openings ? `Sus estudiantes abrieron lecciones con el código de la sección ${plural(stats.openings, "vez", "veces")}.` : "Aún no hay lecciones abiertas con el código de la sección."}</p>
        </Section>
        <Section title="Actividad de la sección" className="order-3">
          <ActivityFeed section={section.id} limit={6} empty="Lo que se registre en esta sección y sus clases aparecerá aquí."/>
        </Section>
      </div>
      <div className="dashboard-side">
        <Section title="Próxima clase" className="order-1" action={<Link href={`${base}/clases`} className="section-link">Ver cronograma</Link>}>
          {next ? <p><Link href={`${base}/clases/${next.id}`}>{sessionDay(next.sessionDate)}{next.startsAt ? `, ${next.startsAt}` : ""}</Link>{next.status === "in_progress" && <> <StatusBadge tone="warning">En curso</StatusBadge></>}</p>
            : <EmptyState compact icon="calendar" title="Sin clases próximas" action={editable && <Link className="button secondary small" href={`${base}/horario`}>{section.schedule ? "Revisar el horario" : "Configurar horario"}</Link>}>{section.schedule ? "El periodo del horario terminó o todas sus clases están registradas." : "El cronograma se genera cuando administración configura el horario de la sección."}</EmptyState>}
          {stats.upcoming > 1 && <p className="muted small">{plural(stats.upcoming, "clase pendiente", "clases pendientes")} en el periodo.</p>}
        </Section>
        <Section title="Imparten la sección" className="order-4">
          <SectionEducators/>
        </Section>
        <Section title="Estudiantes" className="order-5" action={<Link href={`${base}/estudiantes`} className="section-link">Ver la lista</Link>}>
          <p>{plural(stats.learners, "estudiante asignado", "estudiantes asignados")}.</p>
          <p className="muted small">{section.accessCode ? <>Código para estudiantes: <code>{section.accessCode}</code></> : "La sección aún no tiene código para estudiantes."}</p>
        </Section>
      </div>
    </div>
  </>;
}
