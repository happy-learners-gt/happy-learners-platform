import { useCallback, useEffect, useState } from "react";
import { resourceRoleLabel, resourceRoles, resourceTypeLabel, resourceTypes } from "@happy-learners/domain";
import type { ResourceRole, ResourceType } from "@happy-learners/domain";
import { api, message } from "../../api";
import { Link, useNavigation } from "../../navigation";
import { matches } from "../../model";
import { ResourcePreview } from "../resources";
import type { LibraryItem } from "../../ui/cards";
import { Modal, useFeedback } from "../../ui/feedback";
import { Icon } from "../../ui/icons";
import { Menu } from "../../ui/Menu";
import { Button, EmptyState, ErrorState, Loading, PageHeader, PrimaryAction } from "../../ui/primitives";
import { useCourse } from "./context";
import { ResourceDrawer } from "./ResourceDrawer";
import type { CourseResource } from "./course-resource";
import { indexStateLabel, roleText } from "./course-resource";

type List = { resources: CourseResource[]; canManage: boolean };
type Apa = { text: string; html: string; entries: { role: ResourceRole; citation: string; manual: boolean }[] };

export function CourseLibrary() {
  const { course, lessons, writable } = useCourse();
  const { url, navigate } = useNavigation();
  const { toast, confirm } = useFeedback();
  const [data, setData] = useState<List | null>(null);
  const [error, setError] = useState("");
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<CourseResource | null>(null);
  const [preview, setPreview] = useState<CourseResource | null>(null);
  const [apa, setApa] = useState<Apa | null>(null);
  const base = `/cursos/${course.id}`;
  const load = useCallback(() => api<List>(`/courses/${course.id}/resources`).then(setData).catch(cause => setError(message(cause))), [course.id]);
  useEffect(() => { void load(); }, [load]);
  const query = url.searchParams.get("q") || "";
  const type = url.searchParams.get("tipo") || "";
  const role = url.searchParams.get("rol") || "";
  const state = url.searchParams.get("estado") || "";
  const view = url.searchParams.get("vista") === "cuadricula" ? "grid" : "list";
  const showArchived = url.searchParams.get("archivados") === "1";
  function filter(key: string, value: string) { const next = new URL(url); if (value) next.searchParams.set(key, value); else next.searchParams.delete(key); navigate(next.pathname + next.search, true); }
  if (error) return <><PageHeader title="Recursos"/><ErrorState error={error} retry={() => { setError(""); void load(); }}/></>;
  if (!data) return <><PageHeader title="Recursos"/><Loading label="Cargando recursos…" lines={6}/></>;
  const items = data.resources;
  const archivedCount = items.filter(item => item.status === "archived").length;
  const visible = items.filter(item => (showArchived || item.status !== "archived")
    && (!type || item.type === type) && (!role || item.role === role) && (!state || item.indexState === state)
    && matches(query, item.title, item.citation, item.fileName || ""));
  const withRole = items.filter(item => item.role && item.status !== "archived").length;
  const indexed = items.filter(item => item.indexState === "mapped" && item.status !== "archived").length;
  const active = items.filter(item => item.status !== "archived").length;
  async function archive(item: CourseResource) {
    if (!await confirm({ title: `¿Archivar «${item.title}»?`, body: <p>Deja de mostrarse en Recursos. Las lecciones ya publicadas conservan su copia.</p>, confirm: "Archivar recurso", danger: true })) return;
    try { await api(`/courses/${course.id}/resources/${item.id}`, "DELETE"); await load(); toast({ message: `«${item.title}» se archivó.` }); }
    catch (cause) { toast({ tone: "error", message: message(cause) }); }
  }
  async function openApa() {
    try { setApa(await api<Apa>(`/courses/${course.id}/bibliography?format=apa7`)); }
    catch (cause) { toast({ tone: "error", message: message(cause) }); }
  }
  const previewItem = preview?.fileId ? { id: preview.id, courseId: course.id, title: preview.title, description: "", kind: "file" as const, content: "", status: preview.status, version: 1, updatedAt: preview.updatedAt, termIds: [], usedIn: lessons.filter(lesson => lesson.activities.some(activity => activity.resourceId === preview.fileId || activity.blocks?.some(block => block.resourceId === preview.fileId))).length, fileId: preview.fileId, fileName: preview.fileName, mediaType: preview.mediaType } satisfies LibraryItem : null;
  return <>
    <PageHeader crumbs={[{ label: "Cursos", href: "/cursos" }, { label: course.title, href: base }, { label: "Recursos" }]} title="Recursos"
      description="La biblioteca del curso, con la ficha de cada recurso. La bibliografía es la de los que tienen un rol."
      actions={<Button icon="library" onClick={() => void openApa()}>Bibliografía APA</Button>}
      primary={writable && <PrimaryAction icon="plus" onClick={() => setAdding(true)}>Agregar recurso</PrimaryAction>}/>
    <p className="resource-count" aria-live="polite">{active} recursos · {withRole} en la bibliografía · {indexed} indexados</p>
    <div className="toolbar resource-toolbar" role="group" aria-label="Filtrar recursos">
      <div className="search-field"><Icon name="search" size={18}/><label htmlFor="library-search" className="sr-only">Buscar recursos</label><input id="library-search" type="search" value={query} onChange={event => filter("q", event.target.value)} placeholder="Buscar…"/></div>
      <label className="select-inline"><span>Tipo</span><select value={type} onChange={event => filter("tipo", event.target.value)}><option value="">Todos</option>{resourceTypes.map(value => <option key={value} value={value}>{resourceTypeLabel[value]}</option>)}</select></label>
      <label className="select-inline"><span>Rol</span><select value={role} onChange={event => filter("rol", event.target.value)}><option value="">Todos</option>{resourceRoles.map(value => <option key={value} value={value}>{resourceRoleLabel[value]}</option>)}</select></label>
      <label className="select-inline"><span>Estado</span><select value={state} onChange={event => filter("estado", event.target.value)}><option value="">Todos</option><option value="none">Sin índice</option><option value="ready">Índice listo</option><option value="mapped">Indexado</option></select></label>
      {(archivedCount > 0 || showArchived) && <label className="switch"><input type="checkbox" checked={showArchived} onChange={event => filter("archivados", event.target.checked ? "1" : "")}/><span>Archivados ({archivedCount})</span></label>}
      <fieldset className="segmented icons"><legend className="sr-only">Vista</legend>
        <label><input type="radio" name="library-view" checked={view === "list"} onChange={() => filter("vista", "")}/><span><Icon name="list" size={18}/><span className="sr-only">Lista</span></span></label>
        <label><input type="radio" name="library-view" checked={view === "grid"} onChange={() => filter("vista", "cuadricula")}/><span><Icon name="grid" size={18}/><span className="sr-only">Cuadrícula</span></span></label>
      </fieldset>
    </div>
    {visible.length ? <div className={view === "grid" ? "resource-grid" : "resource-list"}>{visible.map(item => <article key={item.id} className={`resource-row${item.status === "archived" ? " is-archived" : ""}`}>
      <div className="resource-row-main">
        <h3><Link href={`${base}/biblioteca/${item.id}`}>{item.title}</Link>{item.role === "primary" && <span className="resource-star" aria-hidden="true"> ★</span>}</h3>
        <p className="resource-meta"><span>{resourceTypeLabel[item.type]}</span><span>{roleText(item.role)}</span><span>{item.status === "archived" ? "Archivado" : indexStateLabel(item)}</span></p>
        {item.role && <p className="resource-citation">{item.citation}{item.manual ? " (cita escrita a mano)" : ""}</p>}
      </div>
      <div className="resource-row-actions">
        {item.fileId && <button type="button" className="button ghost small" aria-label={`Vista previa de ${item.title}`} onClick={() => setPreview(item)}><Icon name="eye" size={16}/>Vista previa</button>}
        {writable && <button type="button" className="button ghost small" aria-label={`Editar ficha de ${item.title}`} onClick={() => setEditing(item)}>Editar ficha</button>}
        <Menu label={`Acciones del recurso ${item.title}`} items={[
          { label: "Abrir", icon: "arrowRight", onSelect: () => navigate(`${base}/biblioteca/${item.id}`) },
          ...(writable && item.status !== "archived" ? ["separator" as const, { label: "Archivar", icon: "archive" as const, danger: true, onSelect: () => void archive(item) }] : []),
        ]}/>
      </div>
    </article>)}</div>
      : items.length ? <EmptyState icon="search" title="No hay recursos con esos filtros" action={<Button onClick={() => navigate(url.pathname, true)}>Limpiar filtros</Button>}/>
      : <EmptyState icon="library" title="Este curso aún no tiene recursos">Agrega un archivo, un enlace, un texto o solo la referencia de un libro físico.</EmptyState>}
    {(adding || editing) && <ResourceDrawer courseId={course.id} item={editing || undefined} onClose={() => { setAdding(false); setEditing(null); }} onSaved={async text => { await load(); setAdding(false); setEditing(null); toast({ message: text }); }}/>}
    {previewItem && <ResourcePreview item={previewItem} lessons={lessons.filter(lesson => lesson.activities.some(activity => activity.resourceId === preview?.fileId || activity.blocks?.some(block => block.resourceId === preview?.fileId)))} onClose={() => setPreview(null)}/>}
    {apa && <ApaDialog apa={apa} onClose={() => setApa(null)}/>}
  </>;
}

function ApaDialog({ apa, onClose }: { apa: Apa; onClose: () => void }) {
  const { toast } = useFeedback();
  const groups = (["primary", "required", "recommended", "support"] as const).map(role => ({ role, entries: apa.entries.filter(entry => entry.role === role) })).filter(group => group.entries.length);
  async function copy() {
    try { await navigator.clipboard.writeText(apa.text); toast({ message: "Bibliografía copiada." }); }
    catch { toast({ tone: "error", message: "No se pudo copiar. Selecciona el texto." }); }
  }
  function download() {
    const link = document.createElement("a");
    link.href = URL.createObjectURL(new Blob([apa.text], { type: "text/plain" }));
    link.download = "bibliografia-apa.txt";
    link.click();
    URL.revokeObjectURL(link.href);
  }
  return <Modal title="Bibliografía APA" onClose={onClose} wide footer={<>
    <button type="button" className="button secondary" onClick={() => void copy()}><Icon name="copy" size={16}/>Copiar</button>
    <button type="button" className="button secondary" onClick={download}><Icon name="download" size={16}/>Descargar</button>
    <button type="button" className="button primary" onClick={onClose}>Cerrar</button>
  </>}>
    {groups.length ? groups.map(group => <section key={group.role} className="resource-apa"><h3>{resourceRoleLabel[group.role]}</h3><ol>{group.entries.map((entry, index) => <li key={index}>{entry.citation}{entry.manual ? " (cita escrita a mano)" : ""}</li>)}</ol></section>)
      : <p className="muted">Ningún recurso tiene un rol todavía. Asigna uno en su ficha para incluirlo aquí.</p>}
  </Modal>;
}
