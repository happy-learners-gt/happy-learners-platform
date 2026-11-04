import { useEffect, useState } from "react";
import type { Course, Lesson, Material, Resource, Taxonomy } from "@happy-learners/contracts";
import { areaLabel } from "@happy-learners/domain";
import { api, message } from "../api";
import { Link, useNavigation } from "../navigation";
import { isEducator, useSession } from "../session";
import { matches, newest, plural, usage } from "../model";
import { ResourceCard } from "../ui/cards";
import type { LibraryItem } from "../ui/cards";
import { Icon } from "../ui/icons";
import { useFeedback } from "../ui/feedback";
import { Button, EmptyState, ErrorState, Loading, PageHeader, PrimaryAction } from "../ui/primitives";
import { legacyItem, ResourceForm, ResourcePreview } from "./resources";

/** Every resource of the organization in one place: find, preview, add and edit without leaving the library. */
export function Library() {
  const { member } = useSession();
  const educator = isEducator(member);
  const { toast } = useFeedback();
  const [form, setForm] = useState<LibraryItem | "new" | null>(null);
  const { url, navigate } = useNavigation();
  const [data, setData] = useState<{ items: LibraryItem[]; courses: Course[]; lessons: Lesson[]; taxonomy: Taxonomy } | null>(null), [error, setError] = useState("");
  const [preview, setPreview] = useState<LibraryItem | null>(null);
  const query = url.searchParams.get("q") || "", type = url.searchParams.get("tipo") || "", courseFilter = url.searchParams.get("curso") || "", tag = url.searchParams.get("etiqueta") || "", area = url.searchParams.get("area") || "";
  async function load() {
    setError("");
    try {
      const [{ courses }, { lessons }, { resources }, taxonomy] = await Promise.all([api<{ courses: Course[] }>("/courses"), api<{ lessons: Lesson[] }>("/lessons?drafts=1"), api<{ resources: Resource[] }>("/resources"), api<Taxonomy>("/taxonomy").catch(() => ({ vocabularies: [], terms: [] }))]);
      const perCourse = await Promise.all(courses.map(course => api<{ materials: Material[] }>(`/courses/${course.id}/materials`).then(result => result.materials.map(item => ({ ...item, courseTitle: course.title, usedIn: usage(item.id, lessons).length })))));
      setData({ courses, lessons, taxonomy, items: [...perCourse.flat(), ...resources.filter(resource => resource.status !== "archived").map(resource => ({ ...legacyItem(resource, usage(resource.id, lessons).length), courseTitle: "General" }))] });
    } catch (cause) { setError(message(cause)); }
  }
  useEffect(() => { void load(); }, []);
  function filter(key: string, value: string) { const next = new URL(url); if (value) next.searchParams.set(key, value); else next.searchParams.delete(key); navigate(next.pathname + next.search, true); }
  const header = <PageHeader title="Biblioteca" description="Textos, enlaces y documentos de todos los cursos. Úsalos en lecciones y clases de cualquier curso." primary={educator && data && data.courses.some(course => course.status === "active") && <PrimaryAction icon="plus" onClick={() => setForm("new")}>Agregar recurso</PrimaryAction>}/>;
  if (error) return <>{header}<ErrorState error={error} retry={() => void load()}/></>;
  if (!data) return <>{header}<Loading label="Cargando biblioteca…" lines={6}/></>;
  const editable = (item: LibraryItem) => data.courses.some(course => course.id === item.courseId && course.status === "active");
  const areaOf = (item: LibraryItem) => data.courses.find(course => course.id === item.courseId)?.area?.slice(0, 2);
  // Each filter counts what the other active filters leave, so no option leads to an empty list by surprise.
  const base = (skip?: "tag" | "area") => data.items.filter(item => item.status !== "archived" && (!type || item.kind === type) && (!courseFilter || item.courseId === courseFilter || (courseFilter === "general" && item.legacy)) && matches(query, item.title, item.description, item.fileName, item.courseTitle)
    && (skip === "tag" || !tag || item.termIds.includes(tag)) && (skip === "area" || !area || areaOf(item) === area));
  const visible = newest(base());
  const tagCounts = new Map<string, number>(), areaCounts = new Map<string, number>();
  base("tag").forEach(item => item.termIds.forEach(id => tagCounts.set(id, (tagCounts.get(id) || 0) + 1)));
  base("area").forEach(item => { const code = areaOf(item); if (code) areaCounts.set(code, (areaCounts.get(code) || 0) + 1); });
  const termName = (id: string) => { const term = data.taxonomy.terms.find(item => item.id === id); const group = data.taxonomy.vocabularies.find(item => item.id === term?.vocabularyId); return term ? `${group ? `${group.name}: ` : ""}${term.name}` : id; };
  return <>
    {header}
    <div className="toolbar" role="group" aria-label="Filtrar recursos">
      <div className="search-field"><Icon name="search" size={18}/><label htmlFor="global-library-search" className="sr-only">Buscar en la biblioteca</label><input id="global-library-search" type="search" value={query} onChange={event => filter("q", event.target.value)} placeholder="Buscar recursos"/></div>
      <label className="select-inline"><span>Tipo</span><select value={type} onChange={event => filter("tipo", event.target.value)}><option value="">Todos</option><option value="text">Texto</option><option value="link">Enlace</option><option value="file">Documento</option></select></label>
      <label className="select-inline"><span>Curso</span><select value={courseFilter} onChange={event => filter("curso", event.target.value)}><option value="">Todos</option>{data.courses.map(course => <option key={course.id} value={course.id}>{course.title}</option>)}<option value="general">Recursos generales</option></select></label>
      {(tagCounts.size > 0 || tag) && <label className="select-inline"><span>Etiqueta</span><select value={tag} onChange={event => filter("etiqueta", event.target.value)}><option value="">Todas</option>{[...tagCounts.entries()].sort((a, b) => termName(a[0]).localeCompare(termName(b[0]), "es")).map(([id, count]) => <option key={id} value={id}>{termName(id)} ({count})</option>)}</select></label>}
      {(areaCounts.size > 1 || area) && <label className="select-inline"><span>Área</span><select value={area} onChange={event => filter("area", event.target.value)}><option value="">Todas</option>{[...areaCounts.entries()].map(([code, count]) => <option key={code} value={code}>{areaLabel(code)} ({count})</option>)}</select></label>}
    </div>
    <p className="toolbar-count" aria-live="polite">{plural(visible.length, "recurso", "recursos")}</p>
    {visible.some(item => item.legacy) && <p className="muted small">«General · solo lectura»: recursos de la biblioteca anterior, disponibles en cualquier curso; ya no se editan. Los demás pertenecen a un curso y se editan desde él.</p>}
    {visible.length ? <div className="resource-list">{visible.map(item => <ResourceCard key={`${item.courseId}-${item.id}`} item={item} onOpen={() => setPreview(item)}
      // LIB-02: where it is used, in the list itself: the first two lessons and how many more.
      extra={(() => { const used = usage(item.id, data.lessons); return used.length ? <p className="resource-usage small"><span className="muted">En: </span>{used.slice(0, 2).map((lesson, index) => <span key={lesson.id}>{index ? ", " : ""}<Link href={`/cursos/${lesson.courseId}/lecciones/${lesson.id}`}>{lesson.title}</Link></span>)}{used.length > 2 ? <span className="muted">{` y ${used.length - 2} más`}</span> : null}</p> : null; })()}
      menu={[
      { label: "Vista previa", icon: "eye", onSelect: () => setPreview(item) },
      ...(educator && !item.legacy && item.kind !== "file" && editable(item) ? [{ label: "Editar", icon: "edit" as const, onSelect: () => setForm(item) }] : []),
      ...(!item.legacy ? [{ label: "Abrir en su curso", icon: "arrowRight" as const, onSelect: () => navigate(`/cursos/${item.courseId}/biblioteca`) }] : []),
    ]}/>)}</div>
      : data.items.length ? <EmptyState icon="search" title="No hay recursos con esos filtros" action={<Button onClick={() => navigate("/biblioteca", true)}>Limpiar filtros</Button>}/>
      : <EmptyState icon="library" title="Aún no hay recursos" action={educator && <PrimaryAction icon="plus" onClick={() => setForm("new")}>Agregar recurso</PrimaryAction>}>Agrega un texto, un enlace o un documento para usarlo en lecciones y clases.</EmptyState>}
    {preview && <ResourcePreview item={preview} lessons={usage(preview.id, data.lessons)} onClose={() => setPreview(null)} onEdit={educator && !preview.legacy && preview.kind !== "file" && editable(preview) ? () => { setForm(preview); setPreview(null); } : undefined}/>}
    {form && <ResourceForm courses={data.courses.filter(course => course.status === "active")} item={form === "new" ? undefined : form} courseId={form === "new" ? undefined : form.courseId} onClose={() => setForm(null)} onSaved={async text => { setForm(null); await load(); toast({ message: text }); }}/>}
  </>;
}
