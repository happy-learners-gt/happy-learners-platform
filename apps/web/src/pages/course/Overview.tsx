import { useEffect, useState } from "react";
import type { SectionSummary } from "@happy-learners/contracts";
import { areaLabel, coverage, labelOf } from "@happy-learners/domain";
import { api } from "../../api";
import { Link } from "../../navigation";
import { courseStats, lessonState, newest, plural } from "../../model";
import { Icon } from "../../ui/icons";
import type { IconName } from "../../ui/icons";
import { LessonBadge } from "../../ui/LessonOutline";
import { EmptyState, PageHeader, PrimaryAction, Progress, Section, StatTiles, StatusBadge, Updated } from "../../ui/primitives";
import { useCourseActions } from "../Courses";
import { ActivityFeed, Avatar, roleLabel } from "../../ui/progress";
import { useCourse } from "./context";
import { sectionPath } from "../sections/context";
import { SectionCards } from "../sections/SectionCard";

export function Overview() {
  const { course, units, lessons, curriculum, access, writable, publisher, configurable, assignsTeam, reload, noun, settings, program, pacing, requirements } = useCourse();
  const teamEditable = assignsTeam;
  // Sections are instances of the course: administration sees all of them, each educator only their own (DEC-024).
  const [groups, setGroups] = useState<SectionSummary[] | null>(null), [today, setToday] = useState("");
  const actions = useCourseActions(reload);
  useEffect(() => {
    if (!settings.attendance) return;
    api<{ sections: SectionSummary[]; today: string }>("/sections").then(result => { setGroups(result.sections.filter(item => item.courseId === course.id && item.status === "active")); setToday(result.today); }).catch(() => setGroups([]));
  }, [course.id, course.status]);
  const base = `/cursos/${course.id}`;
  const stats = courseStats(units, lessons);
  const pending = newest(lessons.filter(lesson => ["draft", "changes"].includes(lessonState(lesson))));
  const activeUnits = units.filter(unit => unit.status === "active");
  const plan = coverage(curriculum, units, lessons);
  const firstTaught = groups?.find(group => access.assigned.includes(group.id));
  const quick: { href: string; label: string; icon: IconName; hue: string }[] = [
    ...(writable ? [{ href: `${base}/contenido`, label: "Nueva lección", icon: "plus" as const, hue: "violet" }, { href: `${base}/biblioteca`, label: "Agregar recurso", icon: "upload" as const, hue: "teal" }] : []),
    ...(settings.attendance && firstTaught ? [pacing === "self-paced" ? { href: `${sectionPath(firstTaught.id)}/avance`, label: `Ver el avance de ${firstTaught.name}`, icon: "check" as const, hue: "green" } : { href: `${sectionPath(firstTaught.id)}/clases`, label: `Planificar clases de ${firstTaught.name}`, icon: "calendar" as const, hue: "coral" }] : []),
    ...(configurable && settings.attendance ? [{ href: `${base}/secciones`, label: "Secciones del curso", icon: "users" as const, hue: "coral" }] : []),
    ...(configurable ? [{ href: `${base}/configuracion`, label: "Configuración", icon: "settings" as const, hue: "amber" }] : []),
  ];
  const mine = access.sections !== "all";
  // Each role starts where its work is: administration in the sections, the team in the content.
  const primary = configurable && settings.attendance ? <PrimaryAction href={`${base}/secciones`} icon="users">{groups?.length ? "Ver secciones" : "Crear secciones"}</PrimaryAction>
    : !writable ? undefined
    : activeUnits.length || !publisher ? <PrimaryAction href={`${base}/contenido`} icon="content">Ir al contenido</PrimaryAction>
    : <PrimaryAction href={`${base}/contenido?crear=unidad`} icon="plus">Crear la primera unidad</PrimaryAction>;
  return <>
    <PageHeader crumbs={[{ label: "Cursos", href: "/cursos" }, { label: course.title }]} title={course.title}
      description={course.objective || (configurable ? <span className="muted">Sin objetivo. <Link href={`${base}/configuracion`}>Agrégalo en Configuración</Link>.</span> : undefined)}
      meta={<><StatusBadge tone={course.status === "active" ? "success" : "neutral"}>{course.status === "active" ? "Activo" : "Archivado"}</StatusBadge>
        <ul className="course-facets" aria-label="Configuración académica">{program && <li className="is-program">{program.name}</li>}<li>{labelOf.format(course.format)}</li>{course.level !== "unspecified" && <li>{labelOf.level(course.level)}</li>}<li>{labelOf.modality(course.modality)}</li>{course.area && <li>{areaLabel(course.area)}</li>}</ul>
        <Updated value={course.updatedAt}/></>}
      primary={primary}/>
    {course.status === "archived" && <p className="notice"><Icon name="archive" size={18}/>Este curso está archivado: se puede consultar, pero no editar. Las lecciones publicadas siguen disponibles para estudiantes.{access.configure && <button type="button" className="button secondary small" onClick={() => void actions.setStatus(course, "active")}>Restaurar curso</button>}</p>}
    <StatTiles className="overview-kpis" items={[
      { label: "Lecciones publicadas", value: stats.lessons ? `${stats.published} de ${stats.lessons}` : "0", icon: "courses", hue: "sky" },
      { label: noun.Many, value: stats.units, icon: "content", hue: "violet" },
      { label: "Borradores", value: stats.drafts, icon: "edit", hue: "amber" },
      { label: "Cambios sin publicar", value: stats.changes, icon: "sparkles", hue: "pink" },
      ...(plan.summary.total ? [{ label: "Resultados trabajados", value: `${plan.summary.taught} de ${plan.summary.total}`, icon: "spark" as const, hue: "green" as const }] : []),
      ...(settings.attendance && groups ? [{ label: mine ? "Tus secciones" : "Secciones activas", value: groups.length, icon: "users" as const, hue: "coral" as const }] : []),
    ]}/>
    <div className="dashboard">
      <div className="dashboard-main">
        <Section title="Contenido" className="order-2" action={<Link href={`${base}/contenido`} className="section-link">Abrir contenido</Link>}>
          {activeUnits.length ? <>
            <Progress value={stats.published} max={stats.lessons} label="Lecciones publicadas"/>
            <ol className="unit-summary">{activeUnits.map((unit, index) => {
              const own = lessons.filter(lesson => lesson.courseUnitId === unit.id && lesson.status !== "archived");
              const done = own.filter(lesson => ["published", "changes"].includes(lessonState(lesson))).length;
              return <li key={unit.id}><span className="outline-number" aria-hidden="true">{index + 1}</span><Link href={`${base}/contenido#unidad-${unit.id}`}>{unit.name}</Link><span className="muted small">{own.length ? `${done} de ${plural(own.length, "lección publicada", "lecciones publicadas")}` : "Sin lecciones"}</span></li>;
            })}</ol>
          </> : <EmptyState compact icon="content" title={`Sin ${noun.many} todavía`} action={publisher && <Link className="button secondary small" href={`${base}/contenido?crear=unidad`}>Crear {noun.one}</Link>}>Organiza el curso en {noun.many} y agrega lecciones a cada {noun.one}.</EmptyState>}
        </Section>
        <Section title="Plan curricular" className="order-3" action={<Link href={`${base}/plan`} className="section-link">Abrir el plan</Link>}>
          {plan.summary.total ? <>
            <Progress value={plan.summary.assessed} max={plan.summary.total} label="Resultados trabajados y evaluados"/>
            <p className="muted small">{plural(plan.summary.taught, "resultado trabajado", "resultados trabajados")} en lecciones de {plan.summary.total}. {plan.summary.gaps ? <Link href={`${base}/plan`}>{plural(plan.summary.gaps, "resultado", "resultados")} con huecos por cubrir</Link> : "Sin huecos."}</p>
          </> : <EmptyState compact icon="spark" title="Sin resultados de aprendizaje" action={publisher && <Link className="button secondary small" href={`${base}/plan`}>Definir resultados</Link>}>Define qué podrán demostrar los estudiantes y alinea las lecciones a ello.</EmptyState>}
        </Section>
        {settings.attendance && <Section title={mine ? "Tus secciones" : "Secciones"} className="order-4" action={<Link href={`${base}/secciones`} className="section-link">{mine ? "Ver tus secciones" : "Ver secciones"}</Link>}>
          {groups === null ? <p className="muted">Cargando secciones…</p> : groups.length ? <>
            <SectionCards sections={groups.slice(0, 4)} today={today} showCourse={false}/>
            {groups.length > 4 && <Link href={`${base}/secciones`} className="section-link">Ver las {groups.length} secciones</Link>}
          </> : <EmptyState compact icon="users" title={mine ? "Sin secciones asignadas" : "Sin secciones"} action={configurable && <Link className="button secondary small" href={`${base}/secciones`}>Crear sección</Link>}>{access.configure ? "Crea una sección, inscribe a sus estudiantes, asigna sus educadores y configura su horario." : "Administración te asigna las secciones que impartes. Cada una tiene su propio cronograma y avance."}</EmptyState>}
        </Section>}
      </div>
      <div className="dashboard-side">
        {quick.length > 0 && <Section title="Accesos rápidos" className="order-1">
          <ul className="quick-list">{quick.map(item => <li key={item.href}><Link href={item.href}><span className={`quick-icon tone-${item.hue}`} aria-hidden="true"><Icon name={item.icon} size={18}/></span><span>{item.label}</span><Icon name="chevronRight" size={16}/></Link></li>)}</ul>
        </Section>}
        <Section title="Publicación pendiente" className="order-5" action={pending.length > 0 && <span className="count-badge">{pending.length}</span>}>
          {pending.length ? <ul className="link-list">{pending.slice(0, 5).map(lesson => <li key={lesson.id}><Link href={`${base}/lecciones/${lesson.id}`}>{lesson.title}</Link><LessonBadge lesson={lesson}/></li>)}</ul>
            : <EmptyState compact icon="check" title="Todo está publicado">{stats.lessons ? "Los estudiantes ven la última versión de cada lección." : "Cuando crees lecciones, las que falten por publicar aparecerán aquí."}</EmptyState>}
        </Section>
        {program && <Section title="Ruta en el programa" className="order-6" action={access.configure && <Link href={`/configuracion-academica?ruta=${program.id}`} className="section-link">{requirements.requires.length || requirements.unlocks.length ? "Editar requisitos" : "Definir requisitos"}</Link>}>
          {requirements.requires.length || requirements.unlocks.length ? <dl className="course-path">
            {requirements.requires.length > 0 && <div><dt>Requiere</dt><dd><ul className="link-list">{requirements.requires.map(item => <li key={item.id}><Link href={`/cursos/${item.id}`}>{item.title}</Link>{item.status === "archived" && <StatusBadge>Archivado</StatusBadge>}</li>)}</ul></dd></div>}
            {requirements.unlocks.length > 0 && <div><dt>Le siguen</dt><dd><ul className="link-list">{requirements.unlocks.map(item => <li key={item.id}><Link href={`/cursos/${item.id}`}>{item.title}</Link>{item.status === "archived" && <StatusBadge>Archivado</StatusBadge>}</li>)}</ul></dd></div>}
          </dl> : <p className="muted small">No requiere otros cursos de «{program.name}» y ningún curso lo requiere.</p>}
        </Section>}
        <Section title="Equipo docente" className="order-6" action={teamEditable && <Link href={`${base}/configuracion#equipo`} className="section-link">Gestionar equipo</Link>}>
          {course.team?.length ? <ul className="team-list">{course.team.map(person => <li key={person.userId}><Avatar name={person.name} size={32}/><div><strong>{person.name}</strong><span className="muted small">@{person.username}</span></div><StatusBadge tone={person.role === "lead" ? "info" : "neutral"}>{roleLabel[person.role]}</StatusBadge></li>)}</ul>
            : <EmptyState compact icon="users" title="Sin equipo asignado" action={teamEditable && <Link className="button secondary small" href={`${base}/configuracion#equipo`}>Asignar responsable</Link>}>{teamEditable ? "Asigna quién es responsable del curso y quién colabora." : "Administración asigna quién es responsable del curso y quién colabora."}</EmptyState>}
        </Section>
        <Section title="Actividad reciente" className="order-7">
          <ActivityFeed course={course.id} limit={6} empty="Las acciones del equipo en este curso aparecerán aquí."/>
        </Section>
      </div>
    </div>
  </>;
}
