import { useCallback, useEffect, useState } from "react";
import type { BookMapView } from "@happy-learners/contracts";
import type { IndexEntry, OutlineNode } from "@happy-learners/domain";
import { resourceTypeLabel } from "@happy-learners/domain";
import { api, message } from "../../api";
import { useNavigation } from "../../navigation";
import { useFeedback } from "../../ui/feedback";
import { Icon } from "../../ui/icons";
import { Button, EmptyState, ErrorState, Field, Loading, PageHeader, PrimaryAction } from "../../ui/primitives";
import { Tabs } from "../../ui/Tabs";
import { useCourse } from "./context";
import { MapStep } from "./Assistant";
import { ResourceDrawer } from "./ResourceDrawer";
import type { CourseResource } from "./course-resource";
import { indexStateLabel, licenseLabel, roleText } from "./course-resource";

type IndexView = { entries: IndexEntry[] };
type Reading = { id: string; resourceId: string; unitName: string; chapter: string | null; pages: string; required: boolean; note: string; groupId: string | null };

export function ResourcePage({ resourceId }: { resourceId: string }) {
  const { course, lessons, writable } = useCourse();
  const { url, navigate } = useNavigation();
  const { toast } = useFeedback();
  const [resource, setResource] = useState<CourseResource | null>(null);
  const [error, setError] = useState("");
  const [editing, setEditing] = useState(false);
  const tab = url.searchParams.get("vista") || "ficha";
  const base = `/cursos/${course.id}`;
  const load = useCallback(() => api<{ resource: CourseResource }>(`/courses/${course.id}/resources/${resourceId}`).then(result => setResource(result.resource)).catch(cause => setError(message(cause))), [course.id, resourceId]);
  useEffect(() => { setResource(null); setError(""); void load(); }, [load]);
  function setTab(value: string) { const next = new URL(url); if (value === "ficha") next.searchParams.delete("vista"); else next.searchParams.set("vista", value); navigate(next.pathname + next.search, true); }
  if (error) return <><PageHeader title="Recurso"/><ErrorState error={error} retry={() => { setError(""); void load(); }}/></>;
  if (!resource) return <><PageHeader title="Recurso"/><Loading label="Abriendo el recurso…" lines={6}/></>;
  return <>
    <PageHeader crumbs={[{ label: "Cursos", href: "/cursos" }, { label: course.title, href: base }, { label: "Recursos", href: `${base}/biblioteca` }, { label: resource.title }]} title={resource.title}
      description={`${resourceTypeLabel[resource.type]} · ${roleText(resource.role)} · ${resource.status === "archived" ? "Archivado" : indexStateLabel(resource)}`}
      actions={resource.fileId ? <Button icon="download" href={`/api/courses/${course.id}/files/${resource.fileId}/content`}>Abrir</Button> : resource.metadata.url ? <Button icon="link" href={String(resource.metadata.url)}>Abrir</Button> : undefined}
      primary={writable && resource.status !== "archived" && <PrimaryAction icon="edit" onClick={() => setEditing(true)}>Editar ficha</PrimaryAction>}/>
    <Tabs label="Recurso" value={tab} onChange={setTab} items={[{ value: "ficha", label: "Ficha" }, { value: "indice", label: "Índice" }, { value: "mapa", label: "Mapa al plan" }, { value: "uso", label: "Uso" }]}>
      {tab === "ficha" && <Ficha resource={resource}/>}
      {tab === "indice" && <IndexPanel courseId={course.id} resource={resource} writable={writable} onChanged={load}/>}
      {tab === "mapa" && <MapPanel courseId={course.id} resource={resource}/>}
      {tab === "uso" && <Usage courseId={course.id} resource={resource} lessons={lessons}/>}
    </Tabs>
    {editing && <ResourceDrawer courseId={course.id} item={resource} onClose={() => setEditing(false)} onSaved={async text => { setEditing(false); await load(); toast({ message: text }); }}/>}
  </>;
}

function Ficha({ resource }: { resource: CourseResource }) {
  const { toast } = useFeedback();
  const people = resource.authors.map(author => author.kind === "institution" ? author.name : `${author.family}, ${author.given}`.replace(/, $/, "")).join("; ");
  return <div className="resource-ficha">
    <dl>
      <div><dt>Autoría</dt><dd>{people || "Sin autoría"}</dd></div>
      <div><dt>Año</dt><dd>{resource.year || "s. f."}</dd></div>
      {Object.entries(resource.metadata).filter(([, value]) => value !== null && value !== "").map(([key, value]) => <div key={key}><dt>{key}</dt><dd>{String(value)}</dd></div>)}
      <div><dt>Licencia</dt><dd>{licenseLabel[resource.license] || resource.license}</dd></div>
      <div><dt>Compartir</dt><dd>{resource.shareable ? "Se puede compartir con estudiantes" : "No se comparte con estudiantes"}</dd></div>
    </dl>
    <p className="resource-citation">{resource.citation}{resource.manual ? " (cita escrita a mano)" : ""}</p>
    <button type="button" className="button secondary small" onClick={() => void navigator.clipboard.writeText(resource.citation).then(() => toast({ message: "Cita copiada." }), () => toast({ tone: "error", message: "No se pudo copiar." }))}><Icon name="copy" size={16}/>Copiar</button>
  </div>;
}

function IndexPanel({ courseId, resource, writable, onChanged }: { courseId: string; resource: CourseResource; writable: boolean; onChanged: () => Promise<void> }) {
  const { toast } = useFeedback();
  const [entries, setEntries] = useState<IndexEntry[] | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState("");
  const video = resource.type === "video";
  useEffect(() => {
    let live = true;
    api<IndexView>(`/courses/${courseId}/resources/${resource.id}/index`).then(result => {
      if (live) setEntries(current => current?.length && !result.entries.length ? current : result.entries);
    }).catch(cause => { if (live) setError(message(cause)); });
    return () => { live = false; };
  }, [courseId, resource.id]);
  async function run(label: string, work: () => Promise<IndexView>, done: string) {
    setBusy(label); setError("");
    try { setEntries((await work()).entries); toast({ message: done }); await onChanged(); }
    catch (cause) { setError(message(cause)); }
    finally { setBusy(""); }
  }
  async function extract() {
    setBusy("outline");
    try {
      const outline = await readOutline(courseId, resource.fileId!);
      await run("outline", () => api(`/courses/${courseId}/resources/${resource.id}/index`, "POST", { source: "outline", outline }), outline.length ? "Índice extraído del PDF." : "Ese PDF no trae un esquema. Escribe el índice a mano.");
    } catch (cause) { setError(message(cause)); setBusy(""); }
  }
  function add(parentId: string | null) {
    setEntries([...(entries || []), { id: `manual-${Date.now()}`, parentId, position: entries?.length || 0, title: "", startPage: null, endPage: null, startSeconds: null, endSeconds: null, source: "manual" }]);
  }
  const depth = (entry: IndexEntry, guard = 0): number => {
    if (!entry.parentId || guard > 8) return 0;
    const parent = entries?.find(item => item.id === entry.parentId);
    return parent ? 1 + depth(parent, guard + 1) : 0;
  };
  return <div className="stack">
    {error && <p className="form-alert" role="alert"><Icon name="alert" size={18}/>{error}</p>}
    {writable && <div className="button-row">
      {resource.fileId && resource.mediaType === "application/pdf" && <Button icon="library" busy={busy === "outline"} onClick={() => void extract()}>Extraer del PDF</Button>}
      {resource.fileId && <Button icon="sparkles" busy={busy === "detected"} onClick={() => void run("detected", () => api(`/courses/${courseId}/resources/${resource.id}/index`, "POST", { source: "detected" }), "Títulos propuestos desde el texto.")}>Proponer desde el texto</Button>}
      <Button icon="plus" onClick={() => add(null)}>Capítulo</Button>
    </div>}
    {!entries ? <Loading label="Cargando el índice…" lines={3}/> : entries.length ? <ol className="resource-index">{entries.map(entry => <li key={entry.id} style={{ marginLeft: `${depth(entry) * 24}px` }}>
      <input aria-label={`Título de ${entry.title || "capítulo"}`} value={entry.title} disabled={!writable} onChange={event => setEntries(entries.map(item => item.id === entry.id ? { ...item, title: event.target.value } : item))}/>
      {video ? <>
        <Field label="Inicio (s)"><input inputMode="numeric" value={entry.startSeconds ?? ""} disabled={!writable} onChange={event => setEntries(entries.map(item => item.id === entry.id ? { ...item, startSeconds: event.target.value === "" ? null : Number(event.target.value) } : item))}/></Field>
        <Field label="Fin (s)"><input inputMode="numeric" value={entry.endSeconds ?? ""} disabled={!writable} onChange={event => setEntries(entries.map(item => item.id === entry.id ? { ...item, endSeconds: event.target.value === "" ? null : Number(event.target.value) } : item))}/></Field>
      </> : <>
        <Field label="Desde"><input inputMode="numeric" value={entry.startPage ?? ""} disabled={!writable} onChange={event => setEntries(entries.map(item => item.id === entry.id ? { ...item, startPage: event.target.value === "" ? null : Number(event.target.value) } : item))}/></Field>
        <Field label="Hasta"><input inputMode="numeric" value={entry.endPage ?? ""} disabled={!writable} onChange={event => setEntries(entries.map(item => item.id === entry.id ? { ...item, endPage: event.target.value === "" ? null : Number(event.target.value) } : item))}/></Field>
      </>}
      {writable && <button type="button" className="button ghost small" onClick={() => add(entry.id)}>Subcapítulo</button>}
    </li>)}</ol> : <EmptyState compact icon="content" title="Sin índice">Extrae el esquema del PDF, propón títulos desde el texto o escribe los capítulos.</EmptyState>}
    {writable && !!entries?.length && <PrimaryAction icon="check" busy={busy === "save"} disabled={!!busy} onClick={() => void run("save", () => api(`/courses/${courseId}/resources/${resource.id}/index`, "PUT", { entries: entries.map((entry, position) => ({ ...entry, position, source: "manual" })) }), "Índice guardado.")}>Guardar índice</PrimaryAction>}
  </div>;
}

function MapPanel({ courseId, resource }: { courseId: string; resource: CourseResource }) {
  const [map, setMap] = useState<BookMapView | null>(null);
  const [error, setError] = useState("");
  useEffect(() => { api<BookMapView>(`/courses/${courseId}/book-map?resourceId=${resource.id}`).then(setMap).catch(cause => setError(message(cause))); }, [courseId, resource.id]);
  if (error) return <ErrorState error={error} retry={() => setError("")}/>;
  if (!map) return <Loading label="Abriendo el mapa…" lines={4}/>;
  return <MapStep map={map} path={`/courses/${courseId}/book-map`} resourceId={resource.id} setMap={setMap} canEdit={map.canEdit}/>;
}

function Usage({ courseId, resource, lessons }: { courseId: string; resource: CourseResource; lessons: { id: string; title: string; courseUnitId?: string | null; activities: { resourceId?: string; blocks?: { resourceId?: string; chapter?: string; pages?: string }[] }[] }[] }) {
  const [readings, setReadings] = useState<Reading[] | null>(null);
  useEffect(() => { api<{ readings: Reading[] }>(`/courses/${courseId}/readings`).then(result => setReadings(result.readings.filter(item => item.resourceId === resource.id))).catch(() => setReadings([])); }, [courseId, resource.id]);
  const ids = new Set([resource.id, resource.fileId, resource.materialId].filter((id): id is string => !!id));
  const used = lessons.filter(lesson => lesson.activities.some(activity => (!!activity.resourceId && ids.has(activity.resourceId)) || activity.blocks?.some(block => !!block.resourceId && ids.has(block.resourceId))));
  const mine = readings || [];
  return <div className="stack">
    <p>Cubre {resource.coverage?.confirmed || 0} de {resource.coverage?.total || 0} resultados del plan.</p>
    <section><h3>Lecciones</h3>{used.length ? <ul>{used.map(lesson => <li key={lesson.id}>{lesson.title}</li>)}</ul> : <p className="muted">Todavía no está en una lección.</p>}</section>
    <section><h3>Lecturas</h3>{mine.length ? <ul>{mine.map(item => <li key={item.id}>{item.unitName}{item.chapter ? ` · ${item.chapter}` : ""}{item.pages ? ` · ${item.pages}` : ""}</li>)}</ul> : <p className="muted">Todavía no es una lectura de una unidad.</p>}</section>
  </div>;
}

async function readOutline(courseId: string, fileId: string): Promise<OutlineNode[]> {
  const response = await fetch(`/api/courses/${courseId}/files/${fileId}/content`, { credentials: "same-origin" });
  if (!response.ok) throw new Error("No se pudo abrir el PDF.");
  const pdfjs = await import("pdfjs-dist");
  pdfjs.GlobalWorkerOptions.workerSrc = new URL("pdfjs-dist/build/pdf.worker.min.mjs", import.meta.url).toString();
  const loading = pdfjs.getDocument({ data: new Uint8Array(await response.arrayBuffer()), enableXfa: false });
  try {
    const pdf = await loading.promise;
    const outline = await pdf.getOutline();
    if (!outline) return [];
    const pageOf = async (dest: unknown) => {
      try {
        const explicit = typeof dest === "string" ? await pdf.getDestination(dest) : dest;
        if (!explicit || !Array.isArray(explicit)) return null;
        const index = await pdf.getPageIndex(explicit[0]);
        return index + 1;
      } catch { return null; }
    };
    type PdfOutline = { title: string; dest: unknown; items?: PdfOutline[] };
    const walk = async (nodes: PdfOutline[]): Promise<OutlineNode[]> => Promise.all(nodes.map(async node => ({
      title: node.title, page: await pageOf(node.dest), children: node.items?.length ? await walk(node.items) : undefined,
    })));
    return walk(outline as PdfOutline[]);
  } finally { void loading.destroy(); }
}
