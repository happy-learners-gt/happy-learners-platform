import { useEffect, useState } from "react";
import type { ClassSession, Course, LearningUnit, Lesson, ReviewItem, SectionSummary } from "@happy-learners/contracts";
import { api, message } from "../api";
import { Link } from "../navigation";
import { useSession } from "../session";
import { courseStats, lessonNames, lessonState, newest, plural, sessionDay, timeAgo } from "../model";
import type { CourseStats } from "../model";
import { CourseCard } from "../ui/cards";
import { Icon } from "../ui/icons";
import type { IconName } from "../ui/icons";
import { LessonBadge } from "../ui/LessonOutline";
import { EmptyState, ErrorState, Loading, PrimaryAction, Section, StatTiles, StatusBadge, Updated } from "../ui/primitives";
import { ActivityFeed, CourseProgressList, useProgress } from "../ui/progress";
import { SectionCards } from "./sections/SectionCard";
import { sectionPath } from "./sections/context";
import { classBadge } from "./course/Classes";

type Data = { courses: Course[]; lessons: Lesson[]; stats: Record<string, CourseStats>; units: Record<string, LearningUnit[]>; upcoming: ClassSession[]; today: string; toReview: ReviewItem[]; sent: ReviewItem[]; sections: SectionSummary[] };

export function Home() {
  const { member, organization } = useSession();
  // Administration configures the organization and its courses; educators work in the courses assigned to them.
  const educator = member.role !== "admin";
  const progress = useProgress();
  const mine = progress.courses?.filter(item => item.team.some(person => person.userId === member.id));
  const [data, setData] = useState<Data | null>(null), [error, setError] = useState("");
  async function load() {
    setError("");
    try {
      const [{ courses }, { lessons }] = await Promise.all([api<{ courses: Course[] }>("/courses"), api<{ lessons: Lesson[] }>("/lessons?drafts=1")]);
      const active = newest(courses.filter(course => course.status === "active"));
      const details = await Promise.all(active.slice(0, 6).map(course => api<{ units: LearningUnit[] }>(`/courses/${course.id}`).then(detail => [course.id, detail.units] as const)));
      const units = Object.fromEntries(details);
      const stats = Object.fromEntries(details.map(([id, list]) => [id, courseStats(list, lessons.filter(lesson => lesson.courseId === id))]));
      const [classes, reviews, sections] = await Promise.all([
        api<{ classes: ClassSession[]; today: string }>("/classes").catch(() => ({ classes: [], today: "" })),
        educator ? api<{ toReview: ReviewItem[]; mine: ReviewItem[] }>("/reviews").catch(() => ({ toReview: [], mine: [] })) : { toReview: [], mine: [] },
        educator ? api<{ sections: SectionSummary[] }>("/sections").then(result => result.sections.filter(section => section.status === "active" && section.course.status === "active")).catch(() => []) : [],
      ]);
      setData({ courses, lessons, stats, units, upcoming: classes.classes.slice(0, 5), today: classes.today, toReview: reviews.toReview, sent: reviews.mine, sections });
    } catch (cause) { setError(message(cause)); }
  }
  useEffect(() => { void load(); }, []);
  const todayLabel = new Date().toLocaleDateString("es-GT", { weekday: "long", day: "numeric", month: "long" });
  // One primary action, inside the welcome banner.
  const banner = (summary?: string) => <header className="welcome-banner">
    <div className="welcome-text">
      <span className="welcome-date">{todayLabel.charAt(0).toUpperCase() + todayLabel.slice(1)}{organization?.name ? ` · ${organization.name}` : ""}</span>
      <h1>Inicio</h1>
      <p>Hola, {member.displayName || member.username}. {summary || "Esto es lo que sigue en tu espacio."}</p>
    </div>
    {educator ? <PrimaryAction href="/cursos" icon="courses" className="on-brand">Mis cursos</PrimaryAction> : <PrimaryAction href="/cursos/nuevo" icon="plus" className="on-brand">Crear curso</PrimaryAction>}
    <span className="welcome-shapes" aria-hidden="true"><span/><span/><span/></span>
  </header>;
  if (error) return <>{banner()}<ErrorState error={error} retry={() => void load()}/></>;
  if (!data) return <>{banner()}<Loading label="Cargando tu espacio…" cards={3}/></>;
  const courseTitle = (id?: string) => data.courses.find(course => course.id === id)?.title || "Curso";
  const unitName = (lesson: Lesson) => data.units[lesson.courseId || ""]?.find(unit => unit.id === lesson.courseUnitId)?.name;
  const live = data.lessons.filter(lesson => lesson.status !== "archived" && data.courses.some(course => course.id === lesson.courseId && course.status === "active"));
  const pending = newest(live.filter(lesson => ["draft", "changes"].includes(lessonState(lesson))));
  const counts = { draft: live.filter(lesson => lessonState(lesson) === "draft").length, changes: live.filter(lesson => lessonState(lesson) === "changes").length, published: live.filter(lesson => lessonState(lesson) === "published").length };
  const recentCourses = newest(data.courses.filter(course => course.status === "active")).slice(0, 3);
  const firstCourse = recentCourses[0];
  // Classes are planned in a section the educator teaches.
  const teaching = data.sections.find(section => section.teaches);
  const activity = newest([
    ...live.map(lesson => ({ id: lesson.id, title: lesson.title, detail: `Lección · ${courseTitle(lesson.courseId)}`, href: `/cursos/${lesson.courseId}/lecciones/${lesson.id}`, updatedAt: lesson.updatedAt, icon: "content" as IconName })),
    ...data.courses.map(course => ({ id: course.id, title: course.title, detail: "Curso", href: `/cursos/${course.id}`, updatedAt: course.updatedAt, icon: "courses" as IconName })),
  ]).slice(0, 6);
  const continueLesson = pending[0];
  const classesToday = data.upcoming.filter(session => session.sessionDate === data.today).length;
  const summary = [data.toReview.length ? plural(data.toReview.length, "lección por revisar", "lecciones por revisar") : "", pending.length ? plural(pending.length, "lección espera publicación", "lecciones esperan publicación") : "Todo está publicado", classesToday ? plural(classesToday, "clase hoy", "clases hoy") : ""].filter(Boolean).join(" · ") + ".";
  return <>
    {banner(educator ? summary : undefined)}
    {!organization?.configured && member.role === "admin" && <p className="notice"><Icon name="info" size={18}/>Configura el nombre de tu organización. <Link href="/organizacion">Abrir configuración</Link></p>}
    <div className="dashboard">
      <div className="dashboard-main">
        {data.toReview.length > 0 && <Section title={`Por revisar (${data.toReview.length})`} className="order-1">
          <p className="muted small">Lecciones que tu equipo envió para que las publiques.</p>
          <ul className="link-list">{data.toReview.map(item => <li key={item.id}>
            <Link href={`/cursos/${item.courseId}/lecciones/${item.lessonId}`}>{item.lessonTitle}</Link>
            <span className="link-list-meta">{item.courseTitle} · {item.requestedByName} · {timeAgo(item.requestedAt)}{item.note ? ` · «${item.note}»` : ""}</span>
          </li>)}</ul>
        </Section>}
        <Section title="Continuar trabajando" className="order-1">
          {continueLesson && educator ? <div className="continue-card">
            <div className="continue-text">
              <span className="eyebrow">{courseTitle(continueLesson.courseId)}{unitName(continueLesson) ? ` · ${unitName(continueLesson)}` : ""}</span>
              <h3>{continueLesson.title}</h3>
              <p className="continue-meta"><LessonBadge lesson={continueLesson}/><Updated value={continueLesson.updatedAt}/></p>
            </div>
            <Link className="button secondary" href={`/cursos/${continueLesson.courseId}/lecciones/${continueLesson.id}`}>Continuar<span className="sr-only"> con {continueLesson.title}</span><Icon name="arrowRight" size={18}/></Link>
          </div> : firstCourse ? <div className="continue-card">
            <div className="continue-text"><span className="eyebrow">Curso reciente</span><h3>{firstCourse.title}</h3><p className="continue-meta"><Updated value={firstCourse.updatedAt}/></p></div>
            <Link className="button secondary" href={`/cursos/${firstCourse.id}/contenido`}>Abrir contenido<Icon name="arrowRight" size={18}/></Link>
          </div> : <EmptyState compact icon="courses" title="Aún no hay cursos">{educator ? "Administración aún no te asigna cursos. Cuando lo haga, aparecerán aquí." : "Crea el primer curso y asigna a su equipo docente."}</EmptyState>}
          {educator && pending.length > 1 && <ul className="link-list">{pending.slice(1, 4).map(lesson => <li key={lesson.id}>
            <Link href={`/cursos/${lesson.courseId}/lecciones/${lesson.id}`}>{lesson.title}</Link><span className="link-list-meta">{courseTitle(lesson.courseId)} · {timeAgo(lesson.updatedAt)}</span><LessonBadge lesson={lesson}/>
          </li>)}</ul>}
        </Section>
        {educator && data.sections.length > 0 && <Section title="Mis secciones" className="order-2" action={<Link href="/secciones" className="section-link">Ver todas</Link>}>
          <p className="muted small">Indicadores de las secciones que impartes: avance del cronograma, clases dadas y asistencia.</p>
          <SectionCards sections={data.sections.slice(0, 4)} today={data.today} showCourse/>
        </Section>}
        <Section title={educator && mine?.length ? "Mis cursos" : "Avance de los cursos"} className="order-4" action={<Link href="/cursos" className="section-link">Ver todos</Link>}>
          {/* An educator sees the courses they teach; administration (or someone without courses) sees all. */}
          {progress.error ? <p className="form-alert" role="alert">{progress.error}</p> : !progress.courses ? <Loading label="Calculando avance…" lines={3}/>
            : <CourseProgressList courses={educator && mine?.length ? mine : progress.courses} userId={educator && mine?.length ? member.id : undefined}/>}
          {!recentCourses.length && <EmptyState compact icon="courses" title="Sin cursos activos" action={educator ? undefined : <PrimaryAction href="/cursos/nuevo" icon="plus">Crear curso</PrimaryAction>}/>}
        </Section>
        <Section title={educator && mine?.length ? "Actividad en mis cursos" : "Actividad reciente"} className="order-6">
          <ActivityFeed limit={8} mine={!!(educator && mine?.length)} courseTitles={Object.fromEntries(data.courses.map(course => [course.id, course.title]))}/>
        </Section>
      </div>
      <div className="dashboard-side">
        {(educator || data.upcoming.length > 0) && <Section title="Próximas clases" className="order-2">
          {data.upcoming.length ? <ul className="session-list">{data.upcoming.map(session => <li key={session.id}>
            <span className="date-chip" aria-hidden="true"><strong>{session.sessionDate.slice(8)}</strong>{sessionDay(session.sessionDate, "short").replace(/^\d+\s*/, "")}</span>
            <div><Link href={`${sectionPath(session.groupId)}/clases/${session.id}`}>{session.groupName || "Sección"}{session.startsAt ? ` · ${session.startsAt}` : ""}</Link><span>{session.courseTitle} · {lessonNames(session) || sessionDay(session.sessionDate)}</span></div>
            {(session.status === "in_progress" || session.sessionDate <= data.today) && classBadge(session, data.today)}
          </li>)}</ul> : <EmptyState compact icon="calendar" title="Sin clases próximas">Aquí aparecen las clases de las secciones que impartes. Administración configura su horario.</EmptyState>}
        </Section>}
        <Section title="Estado de las lecciones" className="order-3">
          <StatTiles className="stack-tiles" items={[
            { label: "Borradores", value: counts.draft, icon: "edit", hue: "amber" },
            { label: "Cambios sin publicar", value: counts.changes, icon: "sparkles", hue: "sky" },
            { label: "Publicadas", value: counts.published, icon: "check", hue: "green" },
          ]}/>
          {educator && pending.length > 0 && <p className="muted small">{plural(pending.length, "lección espera", "lecciones esperan")} publicación.</p>}
        </Section>
        {data.sent.length > 0 && <Section title="Mis envíos a revisión" className="order-3">
          <ul className="link-list">{data.sent.map(item => <li key={item.id}>
            <Link href={`/cursos/${item.courseId}/lecciones/${item.lessonId}`}>{item.lessonTitle}</Link>
            <span className="link-list-meta">{item.courseTitle} · {timeAgo(item.decidedAt || item.requestedAt)}{item.status === "returned" && item.decisionNote ? ` · «${item.decisionNote}»` : ""}</span>
            <StatusBadge tone={item.status === "pending" ? "info" : "warning"}>{item.status === "pending" ? "En revisión" : "Devuelta"}</StatusBadge>
          </li>)}</ul>
        </Section>}
        {educator && <Section title="Acciones rápidas" className="order-5">
          <ul className="quick-actions">
            {firstCourse && <li><Link href={`/cursos/${firstCourse.id}/contenido`}><Icon name="content" size={18}/>Nueva lección en {firstCourse.title}</Link></li>}
            {firstCourse && <li><Link href={`/cursos/${firstCourse.id}/biblioteca`}><Icon name="upload" size={18}/>Agregar un recurso</Link></li>}
            {teaching && <li><Link href={`${sectionPath(teaching.id)}/clases?nueva=1`}><Icon name="calendar" size={18}/>Planificar una clase</Link></li>}
            <li><Link href="/biblioteca"><Icon name="library" size={18}/>Abrir la biblioteca</Link></li>
          </ul>
        </Section>}
        {!educator && <Section title="Acciones rápidas" className="order-5">
          <ul className="quick-actions">
            <li><Link href="/cursos/nuevo"><Icon name="plus" size={18}/>Crear un curso</Link></li>
            <li><Link href="/educadores"><Icon name="users" size={18}/>Administrar educadores</Link></li>
            <li><Link href="/biblioteca"><Icon name="library" size={18}/>Abrir la biblioteca</Link></li>
          </ul>
        </Section>}
      </div>
    </div>
  </>;
}
