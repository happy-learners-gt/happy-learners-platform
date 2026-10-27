import { useState } from "react";
import type { Material } from "@happy-learners/contracts";
import { api, archiveCourseFile, message } from "../../api";
import { useNavigation } from "../../navigation";
import { matches, newest, plural, usage } from "../../model";
import { ResourceCard } from "../../ui/cards";
import type { LibraryItem } from "../../ui/cards";
import { useFeedback } from "../../ui/feedback";
import { Icon } from "../../ui/icons";
import type { MenuItem } from "../../ui/Menu";
import { Button, EmptyState, PageHeader, PrimaryAction } from "../../ui/primitives";
import { legacyItem, ResourceForm, ResourcePreview } from "../resources";
import { useCourse } from "./context";
import { CourseBibliography, useBibliography } from "./Bibliography";

export function CourseLibrary() {
  const { course, materials, legacyResources, lessons, writable, reload } = useCourse();
  const { url, navigate } = useNavigation();
  const { toast, confirm } = useFeedback();
  const [preview, setPreview] = useState<LibraryItem | null>(null), [form, setForm] = useState<Material | "new" | null>(null), [adding, setAdding] = useState<string | null>(null);
  const bibliography = useBibliography(course.id);
  const referenced = new Set(bibliography.data?.references.map(reference => reference.itemId));
  const query = url.searchParams.get("q") || "", type = url.searchParams.get("tipo") || "", view = url.searchParams.get("vista") === "cuadricula" ? "grid" : "list";
  const showArchived = url.searchParams.get("archivados") === "1";
  function filter(key: string, value: string) { const next = new URL(url); if (value) next.searchParams.set(key, value); else next.searchParams.delete(key); navigate(next.pathname + next.search, true); }
  const linkedLegacy = legacyResources.filter(resource => usage(resource.id, lessons).length).map(resource => legacyItem(resource, usage(resource.id, lessons).length));
  const items: LibraryItem[] = [...materials.map(item => ({ ...item, usedIn: usage(item.id, lessons).length })), ...linkedLegacy];
  const archivedCount = items.filter(item => item.status === "archived").length;
  const visible = newest(items.filter(item => (showArchived || item.status !== "archived") && (!type || item.kind === type) && matches(query, item.title, item.description, item.fileName)));
  async function archive(item: LibraryItem) {
    const used = usage(item.id, lessons).length;
    if (!await confirm({ title: `¿Archivar «${item.title}»?`, body: <p>{used ? `Se usa en ${plural(used, "lección", "lecciones")}. ` : ""}Las lecciones ya publicadas conservan su copia. No podrás agregarlo a nuevas actividades mientras esté archivado.</p>, confirm: "Archivar recurso", danger: true })) return;
    try {
      if (item.kind === "file" && item.fileId) await archiveCourseFile(course.id, item.fileId);
      else await api(`/courses/${course.id}/materials/${item.id}`, "PUT", { title: item.title, description: item.description, kind: item.kind, content: item.content, status: "archived", termIds: item.termIds, version: item.version });
      await reload(); await bibliography.load(); toast({ message: `«${item.title}» se archivó.` });
    } catch (error) { toast({ tone: "error", message: `${message(error)} Recarga la página e inténtalo de nuevo.` }); }
  }
  function menu(item: LibraryItem): MenuItem[] {
    return [
      { label: "Vista previa", icon: "eye", onSelect: () => setPreview(item) },
      ...(writable && !item.legacy && item.kind !== "file" ? [{ label: "Editar", icon: "edit" as const, onSelect: () => setForm(item) }] : []),
      ...(bibliography.data?.canManage && !item.legacy && item.status !== "archived" && !referenced.has(item.fileId || item.id) ? [{ label: "Agregar a la bibliografía", icon: "library" as const, onSelect: () => setAdding(item.fileId || item.id) }] : []),
      ...(item.kind === "file" && item.fileId ? [{ label: "Descargar", icon: "download" as const, onSelect: () => { const link = document.createElement("a"); link.href = `/api/courses/${course.id}/files/${item.fileId}/content`; link.download = item.fileName || item.title; link.click(); } }] : []),
      ...(writable && !item.legacy && item.status !== "archived" ? ["separator" as const, { label: "Archivar", icon: "archive" as const, danger: true, onSelect: () => void archive(item) }] : []),
    ];
  }
  const base = `/cursos/${course.id}`;
  return <>
    <PageHeader crumbs={[{ label: "Cursos", href: "/cursos" }, { label: course.title, href: base }, { label: "Biblioteca del curso" }]} title="Biblioteca del curso"
      description="Textos, enlaces y documentos para usar como recursos en las actividades."
      primary={writable && items.length > 0 && <PrimaryAction icon="plus" onClick={() => setForm("new")}>Agregar recurso</PrimaryAction>}/>
    <CourseBibliography courseId={course.id} items={materials} bibliography={bibliography} adding={adding} onAdding={setAdding}/>
    <div className="toolbar" role="group" aria-label="Filtrar recursos">
      <div className="search-field"><Icon name="search" size={18}/><label htmlFor="library-search" className="sr-only">Buscar recursos</label><input id="library-search" type="search" value={query} onChange={event => filter("q", event.target.value)} placeholder="Buscar por título o archivo"/></div>
      <label className="select-inline"><span>Tipo</span><select value={type} onChange={event => filter("tipo", event.target.value)}><option value="">Todos</option><option value="text">Texto</option><option value="link">Enlace</option><option value="file">Documento</option></select></label>
      {(archivedCount > 0 || showArchived) && <label className="switch"><input type="checkbox" checked={showArchived} onChange={event => filter("archivados", event.target.checked ? "1" : "")}/><span>Archivados ({archivedCount})</span></label>}
      <fieldset className="segmented icons"><legend className="sr-only">Vista</legend>
        <label><input type="radio" name="library-view" checked={view === "list"} onChange={() => filter("vista", "")}/><span><Icon name="list" size={18}/><span className="sr-only">Lista</span></span></label>
        <label><input type="radio" name="library-view" checked={view === "grid"} onChange={() => filter("vista", "cuadricula")}/><span><Icon name="grid" size={18}/><span className="sr-only">Cuadrícula</span></span></label>
      </fieldset>
    </div>
    <p className="toolbar-count" aria-live="polite">{plural(visible.length, "recurso", "recursos")}</p>
    {visible.length ? <div className={view === "grid" ? "resource-grid" : "resource-list"}>{visible.map(item => <ResourceCard key={item.id} item={item} onOpen={() => setPreview(item)} menu={menu(item)}/>)}</div>
      : items.length ? <EmptyState icon="search" title="No hay recursos con esos filtros" action={<Button onClick={() => navigate(url.pathname, true)}>Limpiar filtros</Button>}>Prueba con otro tipo o con otra palabra.</EmptyState>
      : <EmptyState icon="library" title="La biblioteca del curso está vacía" action={writable && <PrimaryAction icon="plus" onClick={() => setForm("new")}>Agregar recurso</PrimaryAction>}>Agrega un texto, un enlace o un documento Office para usarlo en las lecciones.</EmptyState>}
    {preview && <ResourcePreview item={preview} lessons={usage(preview.id, lessons)} onClose={() => setPreview(null)} onEdit={writable && !preview.legacy && preview.kind !== "file" ? () => { setForm(preview); setPreview(null); } : undefined}/>}
    {form && <ResourceForm courseId={course.id} item={form === "new" ? undefined : form} onClose={() => setForm(null)} onSaved={async text => { await reload(); await bibliography.load(); setForm(null); toast({ message: text }); }}/>}
  </>;
}
