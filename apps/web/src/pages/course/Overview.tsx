import { useEffect, useState } from "react";
import type { ClassSession } from "@happy-learners/contracts";
import { areaLabel, coverage, labelOf } from "@happy-learners/domain";
import { api } from "../../api";
import { Link } from "../../navigation";
import { courseStats, lessonState, newest, plural, sessionDay, today } from "../../model";
import { Icon } from "../../ui/icons";
import { LessonBadge } from "../../ui/LessonOutline";
import { EmptyState, PageHeader, PrimaryAction, Progress, Section, StatTiles, StatusBadge, Updated } from "../../ui/primitives";
import { useCourseActions } from "../Courses";
import { useCourse } from "./context";
import type { GroupView } from "./Groups";

export function Overview() {
  const { course, units, lessons, materials, curriculum, educator, writable, reload, noun, settings, program } = useCourse();
  const [groups, setGroups] = useState<GroupView[] | null>(null), [sessions, setSessions] = useState<ClassSession[]>([]);
  const actions = useCourseActions(reload);
  useEffect(() => {
    if (!educator || course.status !== "active" || !settings.attendance) return;
    api<{ groups: GroupView[] }>(`/courses/${course.id}/groups`).then(result => setGroups(result.groups)).catch(() => setGroups([]));
    api<{ sessions: ClassSession[] }>(`/courses/${course.id}/sessions`).then(result => setSessions(result.sessions)).catch(() => undefined);
  }, [course.id, educator, course.status]);
  const base = `/cursos/${course.id}`;
  const stats = courseStats(units, lessons);
  const pending = newest(lessons.filter(lesson => ["draft", "changes"].includes(lessonState(lesson))));
  const activeUnits = units.filter(unit => unit.status === "active");
  const recent = newest([
    ...lessons.filter(lesson => lesson.status !== "archived").map(lesson => ({ id: lesson.id, title: lesson.title, kind: "Lección", href: educator ? `${base}/lecciones/${lesson.id}` : `${base}/contenido`, updatedAt: lesson.updatedAt })),
    ...materials.filter(item => item.status !== "archived").map(item => ({ id: item.id, title: item.title, kind: "Recurso", href: `${base}/biblioteca`, updatedAt: item.updatedAt })),
  ]).slice(0, 5);
  const plan = coverage(curriculum, units, lessons);
  const next = sessions.filter(session => session.sessionDate >= today()).sort((a, b) => a.sessionDate.localeCompare(b.sessionDate))[0];
  const primary = !writable ? undefined : activeUnits.length
    ? <PrimaryAction href={`${base}/contenido`} icon="content">Ir al contenido</PrimaryAction>
    : <PrimaryAction href={`${base}/contenido?crear=unidad`} icon="plus">Crear la primera unidad</PrimaryAction>;
  return <>
    <PageHeader crumbs={[{ label: "Cursos", href: "/cursos" }, { label: course.title }]} title={course.title}
      description={course.objective || (writable ? <span className="muted">Sin objetivo. <Link href={`${base}/configuracion`}>Agrégalo en Configuración</Link>.</span> : undefined)}
      meta={<><StatusBadge tone={course.status === "active" ? "success" : "neutral"}>{course.status === "active" ? "Activo" : "Archivado"}</StatusBadge>
        <ul className="course-facets" aria-label="Configuración académica">{program && <li className="is-program">{program.name}</li>}<li>{labelOf.format(course.format)}</li>{course.level !== "unspecified" && <li>{labelOf.level(course.level)}</li>}<li>{labelOf.modality(course.modality)}</li>{course.area && <li>{areaLabel(course.area)}</li>}</ul>
        <Updated value={course.updatedAt}/></>}
      primary={primary}/>
    {course.status === "archived" && <p className="notice"><Icon name="archive" size={18}/>Este curso está archivado: se puede consultar, pero no editar. Las lecciones publicadas siguen disponibles para estudiantes.{educator && <button type="button" className="button secondary small" onClick={() => void actions.setStatus(course, "active")}>Restaurar curso</button>}</p>}
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
        </> : <EmptyState compact icon="spark" title="Sin resultados de aprendizaje" action={writable && <Link className="button secondary small" href={`${base}/plan`}>Definir resultados</Link>}>Define qué podrán demostrar los estudiantes y alinea las lecciones a ello.</EmptyState>}
      </Section>
      <Section title="Contenido" action={<Link href={`${base}/contenido`} className="section-link">Abrir contenido</Link>}>
        {activeUnits.length ? <ol className="unit-summary">{activeUnits.map((unit, index) => {
          const count = lessons.filter(lesson => lesson.courseUnitId === unit.id && lesson.status !== "archived").length;
          return <li key={unit.id}><span className="outline-number" aria-hidden="true">{index + 1}</span><Link href={`${base}/contenido#unidad-${unit.id}`}>{unit.name}</Link><span className="muted">{plural(count, "lección", "lecciones")}</span></li>;
        })}</ol> : <EmptyState compact icon="content" title="Sin unidades todavía" action={writable && <Link className="button secondary small" href={`${base}/contenido?crear=unidad`}>Crear unidad</Link>}>Organiza el curso en unidades y agrega lecciones a cada una.</EmptyState>}
      </Section>
      {educator && settings.attendance && <Section title="Grupos" action={<Link href={`${base}/grupos`} className="section-link">Ver grupos</Link>}>
        {groups === null ? <p className="muted">{course.status === "active" ? "Cargando grupos…" : "Restaura el curso para consultar sus grupos."}</p> : groups.length ? <>
          <ul className="link-list">{groups.slice(0, 4).map(group => <li key={group.id}><Link href={`${base}/grupos#grupo-${group.id}`}>{group.name}</Link><span className="muted">{plural(group.learnerCount, "participante", "participantes")}</span></li>)}</ul>
          {next ? <p className="muted small">Próxima clase: {sessionDay(next.sessionDate)} · {next.groupName}</p> : <p className="muted small">No hay clases próximas. <Link href={`${base}/asistencia`}>Registrar una clase</Link></p>}
        </> : <EmptyState compact icon="users" title="Sin grupos" action={writable && <Link className="button secondary small" href={`${base}/grupos`}>Crear grupo</Link>}>Crea un grupo para registrar la asistencia de cada clase.</EmptyState>}
      </Section>}
      <Section title="Actividad reciente">
        {recent.length ? <ol className="activity-feed">{recent.map(item => <li key={item.id}><span className="feed-icon" aria-hidden="true"><Icon name={item.kind === "Lección" ? "content" : "library"} size={16}/></span><div><Link href={item.href}>{item.title}</Link><span>{item.kind}</span></div><Updated value={item.updatedAt} prefix=""/></li>)}</ol> : <p className="muted">Sin cambios recientes.</p>}
      </Section>
      {writable && <Section title="Accesos rápidos" className="span-2 quick-wide">
        <ul className="quick-actions">
          <li><Link href={`${base}/contenido`}><Icon name="plus" size={18}/>Nueva lección</Link></li>
          <li><Link href={`${base}/biblioteca`}><Icon name="upload" size={18}/>Agregar recurso</Link></li>
          {settings.attendance && <li><Link href={`${base}/asistencia`}><Icon name="calendar" size={18}/>Registrar asistencia</Link></li>}
          <li><Link href={`${base}/configuracion`}><Icon name="settings" size={18}/>Configuración</Link></li>
        </ul>
      </Section>}
    </div>
  </>;
}
