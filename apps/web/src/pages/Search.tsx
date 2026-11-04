import { useEffect, useState } from "react";
import type { Course, Lesson, Material } from "@happy-learners/contracts";
import { api, message } from "../api";
import { Link, useNavigation } from "../navigation";
import { matches, plural, resourceKindLabel } from "../model";
import { LessonBadge } from "../ui/LessonOutline";
import { EmptyState, ErrorState, Loading, PageHeader, Section } from "../ui/primitives";

type Index = { courses: Course[]; lessons: Lesson[]; resources: (Material & { courseTitle: string })[] };

export function Search() {
  const { url } = useNavigation();
  const query = url.searchParams.get("q") || "";
  const [index, setIndex] = useState<Index | null>(null), [error, setError] = useState("");
  async function load() {
    setError("");
    try {
      // PERF-05: the materials of every course in one request.
      const [{ courses }, { lessons }, { materials }] = await Promise.all([api<{ courses: Course[] }>("/courses"), api<{ lessons: Lesson[] }>("/lessons?drafts=1"), api<{ materials: Material[] }>("/materials")]);
      const titles = new Map(courses.map(course => [course.id, course.title]));
      setIndex({ courses, lessons, resources: materials.filter(item => titles.has(item.courseId || "")).map(item => ({ ...item, courseTitle: titles.get(item.courseId || "")! })) });
    } catch (cause) { setError(message(cause)); }
  }
  useEffect(() => { void load(); }, []);
  const header = <PageHeader title={query ? `Resultados para «${query}»` : "Buscar"} crumbs={[{ label: "Inicio", href: "/inicio" }, { label: "Buscar" }]}/>;
  if (error) return <>{header}<ErrorState error={error} retry={() => void load()}/></>;
  if (!index) return <>{header}<Loading label="Buscando…"/></>;
  if (!query.trim()) return <>{header}<EmptyState icon="search" title="Escribe lo que buscas">Usa el buscador de la barra superior. Encuentra cursos, lecciones y recursos por su nombre.</EmptyState></>;
  const title = (id?: string) => index.courses.find(course => course.id === id)?.title || "";
  const courses = index.courses.filter(course => matches(query, course.title, course.objective));
  const lessons = index.lessons.filter(lesson => lesson.status !== "archived" && matches(query, lesson.title, lesson.objective));
  const resources = index.resources.filter(item => item.status !== "archived" && matches(query, item.title, item.description, item.fileName));
  const total = courses.length + lessons.length + resources.length;
  return <>
    {header}
    <p className="toolbar-count" aria-live="polite">{plural(total, "resultado", "resultados")}</p>
    {!total && <EmptyState icon="search" title="Sin resultados">Revisa la ortografía o prueba con una palabra más corta.</EmptyState>}
    <div className="stack-lg">
      {courses.length > 0 && <Section title={`Cursos (${courses.length})`}><ul className="result-list">{courses.map(course => <li key={course.id}><Link href={`/cursos/${course.id}`}>{course.title}</Link><span className="muted">{course.objective}</span></li>)}</ul></Section>}
      {lessons.length > 0 && <Section title={`Lecciones (${lessons.length})`}><ul className="result-list">{lessons.map(lesson => <li key={lesson.id}><Link href={`/cursos/${lesson.courseId}/lecciones/${lesson.id}`}>{lesson.title}</Link><span className="muted">{title(lesson.courseId)}</span><LessonBadge lesson={lesson}/></li>)}</ul></Section>}
      {resources.length > 0 && <Section title={`Recursos (${resources.length})`}><ul className="result-list">{resources.map(item => <li key={item.id}><Link href={`/cursos/${item.courseId}/biblioteca?q=${encodeURIComponent(item.title)}`}>{item.title}</Link><span className="muted">{resourceKindLabel[item.kind]} · {item.courseTitle}</span></li>)}</ul></Section>}
    </div>
  </>;
}
