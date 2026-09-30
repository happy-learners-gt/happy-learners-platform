import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import type { Course, LearningUnit, Lesson, Taxonomy } from "@happy-learners/contracts";
import { courseProfiles } from "@happy-learners/domain";
import { api, message } from "../api";
import { Link, useNavigation, useUnsavedChanges } from "../navigation";
import { isEducator, useSession } from "../session";
import { courseBody, courseStats, duplicateCourse, matches, newest, plural } from "../model";
import type { CourseStats } from "../model";
import { CourseCard } from "../ui/cards";
import { useFeedback } from "../ui/feedback";
import { Icon } from "../ui/icons";
import { Button, EmptyState, ErrorState, Field, Loading, PageHeader, PrimaryAction } from "../ui/primitives";

export function useCourseActions(reload: () => Promise<void>) {
  const { toast, confirm } = useFeedback();
  const { navigate } = useNavigation();
  async function setStatus(course: Course, status: Course["status"]) {
    if (status === "archived" && !await confirm({ title: `¿Archivar «${course.title}»?`, body: <p>El curso sale de la lista de cursos activos y deja de admitir cambios. Los enlaces de lecciones ya publicadas siguen funcionando. Puedes restaurarlo cuando quieras.</p>, confirm: "Archivar curso", danger: true })) return;
    try { await api(`/courses/${course.id}`, "PUT", courseBody(course, { status })); await reload(); toast({ message: status === "archived" ? `«${course.title}» se archivó.` : `«${course.title}» se restauró.` }); }
    catch (error) { toast({ tone: "error", message: `${message(error)} Recarga la página e inténtalo de nuevo.` }); }
  }
  async function duplicate(course: Course) {
    if (!await confirm({ title: `¿Duplicar «${course.title}»?`, body: <p>Se crea una copia con sus unidades, recursos y lecciones. Todas las lecciones de la copia quedan como borrador; los grupos y la asistencia no se copian.</p>, confirm: "Duplicar curso" })) return;
    toast({ tone: "info", message: "Creando la copia…" });
    try { const id = await duplicateCourse(course); await reload(); toast({ message: `Copia creada: «${course.title} (copia)».`, action: { label: "Abrir", onSelect: () => navigate(`/cursos/${id}`) } }); }
    catch (error) { await reload(); toast({ tone: "error", message: `La copia quedó incompleta: ${message(error)} Revísala en la lista de cursos o archívala.` }); }
  }
  return { setStatus, duplicate };
}

export function CourseList() {
  const { member } = useSession();
  const educator = isEducator(member);
  const { url, navigate } = useNavigation();
  const [courses, setCourses] = useState<Course[] | null>(null), [stats, setStats] = useState<Record<string, CourseStats>>({}), [error, setError] = useState("");
  const query = url.searchParams.get("q") || "", archived = url.searchParams.get("estado") === "archivados";
  async function load() {
    setError("");
    try {
      const [{ courses }, { lessons }] = await Promise.all([api<{ courses: Course[] }>("/courses"), api<{ lessons: Lesson[] }>(educator ? "/lessons?drafts=1" : "/lessons")]);
      setCourses(courses);
      const details = await Promise.all(courses.map(course => api<{ units: LearningUnit[] }>(`/courses/${course.id}`).then(detail => [course.id, courseStats(detail.units, lessons.filter(lesson => lesson.courseId === course.id))] as const)));
      setStats(Object.fromEntries(details));
    } catch (cause) { setError(message(cause)); }
  }
  useEffect(() => { void load(); }, []);
  const actions = useCourseActions(load);
  function filter(key: string, value: string) { const next = new URL(url); if (value) next.searchParams.set(key, value); else next.searchParams.delete(key); navigate(next.pathname + next.search, true); }
  const active = courses?.filter(course => course.status === "active").length || 0;
  const visible = newest((courses || []).filter(course => (archived ? course.status === "archived" : course.status === "active") && matches(query, course.title, course.objective)));
  return <>
    <PageHeader title="Cursos" description={courses ? `${plural(active, "curso activo", "cursos activos")}` : undefined} primary={educator && (!courses || courses.length > 0) && <PrimaryAction href="/cursos/nuevo" icon="plus">Crear curso</PrimaryAction>}/>
    <div className="toolbar" role="group" aria-label="Filtrar cursos">
      <div className="search-field"><Icon name="search" size={18}/><label htmlFor="course-search" className="sr-only">Buscar cursos</label><input id="course-search" type="search" value={query} onChange={event => filter("q", event.target.value)} placeholder="Buscar por nombre u objetivo"/></div>
      <fieldset className="segmented"><legend className="sr-only">Estado</legend>
        {[["", "Activos"], ["archivados", "Archivados"]].map(([value, label]) => <label key={label}><input type="radio" name="course-status" checked={(url.searchParams.get("estado") || "") === value} onChange={() => filter("estado", value)}/><span>{label}</span></label>)}
      </fieldset>
      {courses && <p className="toolbar-count" aria-live="polite">{plural(visible.length, "resultado", "resultados")}</p>}
    </div>
    {error ? <ErrorState error={error} retry={() => void load()}/> : !courses ? <Loading label="Cargando cursos…" cards={3}/> :
      visible.length ? <div className="card-grid">{visible.map(course => <CourseCard key={course.id} course={course} stats={stats[course.id]} menu={educator ? [
        { label: "Abrir", icon: "arrowRight", onSelect: () => navigate(`/cursos/${course.id}`) },
        { label: "Editar configuración", icon: "settings", onSelect: () => navigate(`/cursos/${course.id}/configuracion`) },
        { label: "Duplicar", icon: "copy", onSelect: () => void actions.duplicate(course) },
        "separator",
        course.status === "active" ? { label: "Archivar", icon: "archive", danger: true, onSelect: () => void actions.setStatus(course, "archived") } : { label: "Restaurar", icon: "archive", onSelect: () => void actions.setStatus(course, "active") },
      ] : undefined}/>)}</div>
      : query ? <EmptyState icon="search" title={`No hay cursos que coincidan con «${query}»`} action={<Button onClick={() => filter("q", "")}>Limpiar búsqueda</Button>}>Prueba con otra palabra del nombre o del objetivo.</EmptyState>
      : archived ? <EmptyState icon="archive" title="No hay cursos archivados">Los cursos que archives aparecerán aquí y podrás restaurarlos.</EmptyState>
      : <EmptyState icon="courses" title="Crea tu primer curso" action={educator && <PrimaryAction href="/cursos/nuevo" icon="plus">Crear curso</PrimaryAction>}>Un curso reúne unidades, lecciones y recursos. Puede ser una asignatura, un taller o un recorrido breve.</EmptyState>}
  </>;
}

export function TermChoices({ taxonomy, selected, onChange }: { taxonomy: Taxonomy; selected: string[]; onChange: (ids: string[]) => void }) {
  const groups = taxonomy.vocabularies.map(vocabulary => ({ vocabulary, terms: taxonomy.terms.filter(term => term.vocabularyId === vocabulary.id && ((vocabulary.status === "active" && term.status === "active") || selected.includes(term.id))) })).filter(group => group.terms.length);
  if (!groups.length) return null;
  return <fieldset className="choice-group"><legend>Clasificación <span className="optional">(opcional)</span></legend>
    {groups.map(({ vocabulary, terms }) => <div key={vocabulary.id} className="choice-row"><span className="choice-label">{vocabulary.name}</span><div className="chips">{terms.map(term => <label key={term.id} className="chip"><input type="checkbox" checked={selected.includes(term.id)} onChange={event => onChange(event.target.checked ? [...selected, term.id] : selected.filter(id => id !== term.id))}/><span>{term.name}{term.status === "archived" ? " (archivado)" : ""}</span></label>)}</div></div>)}
  </fieldset>;
}

/** Create and configure a course. unitLabel is kept as stored; the product always says "Unidad". */
export function CourseForm({ course, onSaved, cancelHref }: { course?: Course; onSaved: (id: string) => Promise<void> | void; cancelHref: string }) {
  const [taxonomy, setTaxonomy] = useState<Taxonomy>({ vocabularies: [], terms: [] }), [terms, setTerms] = useState(course?.termIds || []);
  const [dirty, setDirty] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState("");
  const { guard } = useNavigation();
  useUnsavedChanges(dirty);
  useEffect(() => { api<Taxonomy>("/taxonomy").then(setTaxonomy).catch(() => undefined); }, []);
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = Object.fromEntries(new FormData(event.currentTarget)) as Record<string, string>;
    setBusy(true); setError("");
    try {
      const body = { title: data.title, objective: data.objective, profile: data.profile, unitLabel: course?.unitLabel || "Unidades", status: course?.status || "active", termIds: terms, version: course?.version };
      const result = await api<{ id: string }>(course ? `/courses/${course.id}` : "/courses", course ? "PUT" : "POST", body);
      setDirty(false); guard(false);
      await onSaved(result.id);
    } catch (cause) { setError(message(cause)); }
    finally { setBusy(false); }
  }
  return <form className="form-card" onSubmit={save} onChange={() => setDirty(true)}>
    {error && <p className="form-alert" role="alert"><Icon name="alert" size={18}/>{error}</p>}
    <fieldset disabled={busy} className="stack">
      <Field label="Nombre del curso"><input name="title" required maxLength={160} defaultValue={course?.title} placeholder="Ej. Exploradores"/></Field>
      <Field label="Objetivo" optional hint="Qué podrá hacer el grupo al terminar. Aparece en el resumen del curso."><textarea name="objective" maxLength={1000} rows={3} defaultValue={course?.objective}/></Field>
      <Field label="Tipo de curso" hint="Solo orienta el tono del curso; no cambia permisos ni requisitos."><select name="profile" defaultValue={course?.profile || "free"}>{courseProfiles.map(profile => <option key={profile.value} value={profile.value}>{profile.label}</option>)}</select></Field>
      <TermChoices taxonomy={taxonomy} selected={terms} onChange={ids => { setTerms(ids); setDirty(true); }}/>
      <div className="form-actions"><button className="button primary">{busy ? "Guardando…" : course ? "Guardar cambios" : "Crear curso"}</button><Link href={cancelHref} className="button ghost">Cancelar</Link></div>
    </fieldset>
  </form>;
}

export function CreateCourse() {
  const { member } = useSession();
  const { navigate } = useNavigation();
  const { toast } = useFeedback();
  if (!isEducator(member)) return <><PageHeader title="Crear curso" crumbs={[{ label: "Cursos", href: "/cursos" }, { label: "Crear curso" }]}/><EmptyState icon="shield" title="Solo educadores pueden crear cursos">Administración configura la organización y los permisos.</EmptyState></>;
  return <>
    <PageHeader title="Crear curso" crumbs={[{ label: "Cursos", href: "/cursos" }, { label: "Crear curso" }]} description="Empieza por el nombre y el propósito. Después agregarás unidades y lecciones."/>
    <div className="reading"><CourseForm cancelHref="/cursos" onSaved={id => { toast({ message: "Curso creado. Agrega su primera unidad." }); navigate(`/cursos/${id}/contenido`); }}/></div>
  </>;
}
