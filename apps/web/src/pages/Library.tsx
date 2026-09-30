import { useEffect, useState } from "react";
import type { Course, Lesson, Material, Resource } from "@happy-learners/contracts";
import { api, message } from "../api";
import { useNavigation } from "../navigation";
import { isEducator, useSession } from "../session";
import { matches, newest, plural, usage } from "../model";
import { ResourceCard } from "../ui/cards";
import type { LibraryItem } from "../ui/cards";
import { Icon } from "../ui/icons";
import { Button, EmptyState, ErrorState, Loading, PageHeader } from "../ui/primitives";
import { legacyItem, ResourcePreview } from "./resources";

/** Every resource of the organization in one place; editing happens in each course's library. */
export function Library() {
  const { member } = useSession();
  const { url, navigate } = useNavigation();
  const [data, setData] = useState<{ items: LibraryItem[]; courses: Course[]; lessons: Lesson[] } | null>(null), [error, setError] = useState("");
  const [preview, setPreview] = useState<LibraryItem | null>(null);
  const query = url.searchParams.get("q") || "", type = url.searchParams.get("tipo") || "", courseFilter = url.searchParams.get("curso") || "";
  async function load() {
    setError("");
    try {
      const [{ courses }, { lessons }, { resources }] = await Promise.all([api<{ courses: Course[] }>("/courses"), api<{ lessons: Lesson[] }>(isEducator(member) ? "/lessons?drafts=1" : "/lessons"), api<{ resources: Resource[] }>("/resources")]);
      const perCourse = await Promise.all(courses.map(course => api<{ materials: Material[] }>(`/courses/${course.id}/materials`).then(result => result.materials.map(item => ({ ...item, courseTitle: course.title, usedIn: usage(item.id, lessons).length })))));
      setData({ courses, lessons, items: [...perCourse.flat(), ...resources.filter(resource => resource.status !== "archived").map(resource => ({ ...legacyItem(resource, usage(resource.id, lessons).length), courseTitle: "General" }))] });
    } catch (cause) { setError(message(cause)); }
  }
  useEffect(() => { void load(); }, []);
  function filter(key: string, value: string) { const next = new URL(url); if (value) next.searchParams.set(key, value); else next.searchParams.delete(key); navigate(next.pathname + next.search, true); }
  const header = <PageHeader title="Biblioteca" description="Los recursos de todos tus cursos. Para agregar o editar, abre la biblioteca de cada curso."/>;
  if (error) return <>{header}<ErrorState error={error} retry={() => void load()}/></>;
  if (!data) return <>{header}<Loading label="Cargando biblioteca…" lines={6}/></>;
  const visible = newest(data.items.filter(item => item.status !== "archived" && (!type || item.kind === type) && (!courseFilter || item.courseId === courseFilter || (courseFilter === "general" && item.legacy)) && matches(query, item.title, item.description, item.fileName, item.courseTitle)));
  return <>
    {header}
    <div className="toolbar" role="group" aria-label="Filtrar recursos">
      <div className="search-field"><Icon name="search" size={18}/><label htmlFor="global-library-search" className="sr-only">Buscar en la biblioteca</label><input id="global-library-search" type="search" value={query} onChange={event => filter("q", event.target.value)} placeholder="Buscar recursos"/></div>
      <label className="select-inline"><span>Tipo</span><select value={type} onChange={event => filter("tipo", event.target.value)}><option value="">Todos</option><option value="text">Texto</option><option value="link">Enlace</option><option value="file">Documento</option></select></label>
      <label className="select-inline"><span>Curso</span><select value={courseFilter} onChange={event => filter("curso", event.target.value)}><option value="">Todos</option>{data.courses.map(course => <option key={course.id} value={course.id}>{course.title}</option>)}<option value="general">Recursos generales</option></select></label>
    </div>
    <p className="toolbar-count" aria-live="polite">{plural(visible.length, "recurso", "recursos")}</p>
    {visible.length ? <div className="resource-list">{visible.map(item => <ResourceCard key={`${item.courseId}-${item.id}`} item={item} onOpen={() => setPreview(item)} menu={[
      { label: "Vista previa", icon: "eye", onSelect: () => setPreview(item) },
      ...(!item.legacy ? [{ label: "Abrir en su curso", icon: "arrowRight" as const, onSelect: () => navigate(`/cursos/${item.courseId}/biblioteca`) }] : []),
    ]}/>)}</div>
      : data.items.length ? <EmptyState icon="search" title="No hay recursos con esos filtros" action={<Button onClick={() => navigate("/biblioteca", true)}>Limpiar filtros</Button>}/>
      : <EmptyState icon="library" title="Aún no hay recursos">Abre un curso y usa “Agregar recurso” en su biblioteca.</EmptyState>}
    {preview && <ResourcePreview item={preview} lessons={usage(preview.id, data.lessons)} onClose={() => setPreview(null)}/>}
  </>;
}
