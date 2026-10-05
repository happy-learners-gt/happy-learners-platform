import { useEffect, useState } from "react";
import type { SectionSummary } from "@happy-learners/contracts";
import { areaLabel, coverage, labelOf, scheduleSummary } from "@happy-learners/domain";
import { api } from "../../api";
import { Link } from "../../navigation";
import { courseStats, lessonState, newest, plural, sessionDay } from "../../model";
import { Icon } from "../../ui/icons";
import { LessonBadge } from "../../ui/LessonOutline";
import { EmptyState, PageHeader, PrimaryAction, Progress, Section, StatTiles, StatusBadge, Updated } from "../../ui/primitives";
import { useCourseActions } from "../Courses";
import { ActivityFeed, Avatar, roleLabel } from "../../ui/progress";
import { useCourse } from "./context";
import { sectionPath } from "../sections/context";

export function Overview() {
  const { course, units, lessons, materials, curriculum, access, writable, publisher, configurable, reload, noun, settings, program } = useCourse();
  const teamEditable = configurable;
  // Sections are instances of the course: administration sees all of them, each educator only their own (DEC-024).
  const [groups, setGroups] = useState<SectionSummary[] | null>(null);
  const actions = useCourseActions(reload);
  useEffect(() => {
    if (!settings.attendance) return;
    api<{ sections: SectionSummary[] }>("/sections").then(result => setGroups(result.sections.filter(item => item.courseId === course.id && item.status === "active"))).catch(() => setGroups([]));
  }, [course.id, course.status]);
  const base = `/cursos/${course.id}`;
  const stats = courseStats(units, lessons);
  const pending = newest(lessons.filter(lesson => ["draft", "changes"].includes(lessonState(lesson))));
  const activeUnits = units.filter(unit => unit.status === "active");
  const recent = newest([
    ...lessons.filter(lesson => lesson.status !== "archived").map(lesson => ({ id: lesson.id, title: lesson.title, kind: "Lección", href: `${base}/lecciones/${lesson.id}`, updatedAt: lesson.updatedAt })),
    ...materials.filter(item => item.status !== "archived").map(item => ({ id: item.id, title: item.title, kind: "Recurso", href: `${base}/biblioteca`, updatedAt: item.updatedAt })),
  ]).slice(0, 5);
  const plan = coverage(curriculum, units, lessons);
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
    <div className="overview-grid">
      <Section title="Preparación" className="span-2">
        <Progress value={stats.published} max={stats.lessons} label="Lecciones publicadas"/>
        <StatTiles items={[
          { label: noun.Many, value: stats.units, icon: "content", hue: "violet" },
          { label: "Lecciones", value: stats.lessons, icon: "courses", hue: "sky" },
          { label: "Borradores", value: stats.drafts, icon: "edit", hue: "amber" },
          { label: "Cambios sin publicar", value: stats.changes, icon: "sparkles", hue: "pink" },
        ]}/>
      </Section>
      <Section title="Publicación pendiente" action={pending.length > 0 && <span className="count-badge">{pending.length}</span>}>
        {pending.length ? <ul className="link-list">{pending.slice(0, 5).map(lesson => <li key={lesson.id}><Link href={`${base}/lecciones/${lesson.id}`}>{lesson.title}</Link><LessonBadge lesson={lesson}/></li>)}</ul>
          : <EmptyState compact icon="check" title="Todo está publicado">{stats.lessons ? "Los estudiantes ven la última versión de cada lección." : "Cuando crees lecciones, las que falten por publicar aparecerán aquí."}</EmptyState>}
      </Section>
      <Section title="Plan curricular" action={<Link href={`${base}/plan`} className="section-link">Abrir el plan</Link>}>
        {plan.summary.total ? <>
          <Progress value={plan.summary.assessed} max={plan.summary.total} label="Resultados trabajados y evaluados"/>
          <p className="muted small">{plural(plan.summary.taught, "resultado trabajado", "resultados trabajados")} en lecciones de {plan.summary.total}. {plan.summary.gaps ? <Link href={`${base}/plan`}>{plural(plan.summary.gaps, "resultado", "resultados")} con huecos por cubrir</Link> : "Sin huecos."}</p>
        </> : <EmptyState compact icon="spark" title="Sin resultados de aprendizaje" action={publisher && <Link className="button secondary small" href={`${base}/plan`}>Definir resultados</Link>}>Define qué podrán demostrar los estudiantes y alinea las lecciones a ello.</EmptyState>}
      </Section>
      <Section title="Contenido" action={<Link href={`${base}/contenido`} className="section-link">Abrir contenido</Link>}>
        {activeUnits.length ? <ol className="unit-summary">{activeUnits.map((unit, index) => {
          const count = lessons.filter(lesson => lesson.courseUnitId === unit.id && lesson.status !== "archived").length;
          return <li key={unit.id}><span className="outline-number" aria-hidden="true">{index + 1}</span><Link href={`${base}/contenido#unidad-${unit.id}`}>{unit.name}</Link><span className="muted">{plural(count, "lección", "lecciones")}</span></li>;
        })}</ol> : <EmptyState compact icon="content" title="Sin unidades todavía" action={publisher && <Link className="button secondary small" href={`${base}/contenido?crear=unidad`}>Crear unidad</Link>}>Organiza el curso en unidades y agrega lecciones a cada una.</EmptyState>}
      </Section>
      {settings.attendance && <Section title={mine ? "Mis secciones" : "Secciones"} action={<Link href={`${base}/secciones`} className="section-link">{mine ? "Ver mis secciones" : "Ver secciones"}</Link>}>
        {groups === null ? <p className="muted">Cargando secciones…</p> : groups.length ? <ul className="link-list">{groups.slice(0, 5).map(group => <li key={group.id}>
          <Link href={sectionPath(group.id)}>{group.name}</Link>
          <span className="muted">{plural(group.indicators.learners, "estudiante", "estudiantes")}{group.schedule ? ` · ${scheduleSummary(group.schedule)}` : " · sin horario"}{group.next ? ` · próxima clase ${sessionDay(group.next.sessionDate, "short")}` : ""}</span>
        </li>)}</ul> : <EmptyState compact icon="users" title={mine ? "Sin secciones asignadas" : "Sin secciones"} action={configurable && <Link className="button secondary small" href={`${base}/secciones`}>Crear sección</Link>}>{configurable ? "Crea una sección, inscribe a sus estudiantes, asigna sus educadores y configura su horario." : "Administración te asigna las secciones que impartes. Cada una tiene su propio cronograma y avance."}</EmptyState>}
      </Section>}
      <Section title="Equipo docente" action={teamEditable && <Link href={`${base}/configuracion#equipo`} className="section-link">Gestionar equipo</Link>}>
        {course.team?.length ? <ul className="team-list">{course.team.map(person => <li key={person.userId}><Avatar name={person.name} size={32}/><div><strong>{person.name}</strong><span className="muted small">@{person.username}</span></div><StatusBadge tone={person.role === "lead" ? "info" : "neutral"}>{roleLabel[person.role]}</StatusBadge></li>)}</ul>
          : <EmptyState compact icon="users" title="Sin equipo asignado" action={teamEditable && <Link className="button secondary small" href={`${base}/configuracion#equipo`}>Asignar responsable</Link>}>{teamEditable ? "Asigna quién es responsable del curso y quién colabora." : "Administración asigna quién es responsable del curso y quién colabora."}</EmptyState>}
      </Section>
      <Section title="Actividad reciente">
        <ActivityFeed course={course.id} limit={6} empty="Las acciones del equipo en este curso aparecerán aquí."/>
      </Section>
      {(writable || configurable) && <Section title="Accesos rápidos" className="span-2 quick-wide">
        <ul className="quick-actions">
          {writable && <li><Link href={`${base}/contenido`}><Icon name="plus" size={18}/>Nueva lección</Link></li>}
          {writable && <li><Link href={`${base}/biblioteca`}><Icon name="upload" size={18}/>Agregar recurso</Link></li>}
          {settings.attendance && groups?.[0] && access.assigned.includes(groups[0].id) && <li><Link href={`${sectionPath(groups[0].id)}/clases`}><Icon name="calendar" size={18}/>Planificar clases de {groups[0].name}</Link></li>}
          {configurable && settings.attendance && <li><Link href={`${base}/secciones`}><Icon name="users" size={18}/>Secciones</Link></li>}
          {configurable && <li><Link href={`${base}/configuracion`}><Icon name="settings" size={18}/>Configuración</Link></li>}
        </ul>
      </Section>}
    </div>
  </>;
}
