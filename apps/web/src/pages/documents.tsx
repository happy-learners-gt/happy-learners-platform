import { useEffect, useRef, useState } from "react";
import { applySuggestion } from "@happy-learners/domain";
import type { FieldSuggestion, ReportKind, ReportKindSpec, ReportTemplate, TemplateBlock } from "@happy-learners/domain";
import { api, message, sendFile } from "../api";
import { Link, useNavigation } from "../navigation";
import { formatInstant } from "../regional";
import { Modal, useFeedback } from "../ui/feedback";
import { Icon } from "../ui/icons";
import { Button, EmptyState, ErrorState, Field, Loading, PageHeader, PrimaryAction, Section, StatusBadge } from "../ui/primitives";
import { AiWrite } from "../ui/AiWrite";

/**
 * Organización › Documentos (1.5.0, docs/design/constructor-de-reportes.md): templates of the organization's documents
 * and their designer, with blocks, properties, versions and a preview with real data. Administration only.
 */
type TemplateView = { id: string; kind: ReportKind; programId: string | null; programName: string | null; name: string; draft: ReportTemplate; publishedVersion: number | null; updatedAt: string };
type ImageView = { id: string; name: string; width: number; height: number };
const blockLabels: Record<TemplateBlock["type"], string> = { title: "Título", text: "Texto", fields: "Campos", table: "Tabla de datos", image: "Imagen", signatures: "Firmas", "page-break": "Salto de página" };
const newId = () => `b-${crypto.randomUUID().slice(0, 8)}`;

export function DocumentsPage() {
  const { navigate } = useNavigation();
  const [templates, setTemplates] = useState<TemplateView[] | null>(null), [kinds, setKinds] = useState<Record<ReportKind, ReportKindSpec> | null>(null), [error, setError] = useState("");
  const [creating, setCreating] = useState(false), [programs, setPrograms] = useState<{ id: string; name: string }[]>([]);
  useEffect(() => {
    void api<{ templates: TemplateView[]; kinds: Record<ReportKind, ReportKindSpec> }>("/report-templates").then(data => { setTemplates(data.templates); setKinds(data.kinds); }, cause => setError(message(cause)));
    void api<{ programs: { id: string; name: string }[] }>("/programs").then(data => setPrograms(data.programs)).catch(() => setPrograms([]));
  }, []);
  const header = <PageHeader title="Documentos"
    description="Las plantillas de la boleta y la constancia, con el membrete de la institución. Sin plantilla publicada, los documentos conservan su formato de siempre."
    primary={<PrimaryAction icon="plus" onClick={() => setCreating(true)}>Nueva plantilla</PrimaryAction>}/>;
  if (error) return <>{header}<ErrorState error={error}/></>;
  if (!templates || !kinds) return <>{header}<Loading label="Cargando plantillas…" lines={4}/></>;
  return <>
    {header}
    {templates.length ? <ul className="document-list">{templates.map(item => <li key={item.id}>
      <div><Link href={`/organizacion/documentos/${item.id}`}><strong>{item.name}</strong></Link>
        <span className="muted"> · {kinds[item.kind].label} · {item.programName ? `Programa ${item.programName}` : "Toda la organización"}</span></div>
      {item.publishedVersion ? <StatusBadge tone="success">Publicada v{item.publishedVersion}</StatusBadge> : <StatusBadge tone="warning">Borrador</StatusBadge>}
    </li>)}</ul> : <EmptyState icon="file" title="Aún no hay plantillas">La boleta y la constancia se generan con su formato de siempre. Crea una plantilla para usar el membrete y el diseño de la institución.</EmptyState>}
    {creating && <Modal title="Nueva plantilla" onClose={() => setCreating(false)}>
      <form className="stack" onSubmit={event => {
        event.preventDefault();
        const data = new FormData(event.currentTarget);
        void api<{ template: TemplateView }>("/report-templates", "POST", { kind: data.get("kind"), programId: data.get("programId") || null, name: data.get("name") })
          .then(result => navigate(`/organizacion/documentos/${result.template.id}`), cause => setError(message(cause)));
      }}>
        <Field label="Documento"><select name="kind">{(Object.keys(kinds) as ReportKind[]).map(kind => <option key={kind} value={kind}>{kinds[kind].label}</option>)}</select></Field>
        <Field label="Nombre" optional><input name="name" maxLength={120}/></Field>
        <Field label="Alcance" hint="La plantilla de un programa reemplaza la de la organización para sus secciones."><select name="programId"><option value="">Toda la organización</option>{programs.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></Field>
        <div className="modal-actions"><Button variant="ghost" onClick={() => setCreating(false)}>Cancelar</Button><button className="button primary">Crear y diseñar</button></div>
      </form>
    </Modal>}
  </>;
}

/** PNG or JPEG in, JPEG out (on white): the PDF engine embeds JPEG. */
async function asJpeg(file: File): Promise<Blob> {
  const bitmap = await createImageBitmap(file);
  const canvas = document.createElement("canvas"); canvas.width = bitmap.width; canvas.height = bitmap.height;
  const context = canvas.getContext("2d")!; context.fillStyle = "#fff"; context.fillRect(0, 0, canvas.width, canvas.height); context.drawImage(bitmap, 0, 0);
  return new Promise((resolve, reject) => canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error("No se pudo leer la imagen.")), "image/jpeg", 0.9));
}

function FieldPicker({ spec, onPick }: { spec: ReportKindSpec; onPick: (key: string) => void }) {
  return <select aria-label="Insertar campo" value="" onChange={event => { if (event.target.value) onPick(event.target.value); }}>
    <option value="">Insertar campo…</option>{spec.fields.map(field => <option key={field.key} value={field.key}>{field.label}</option>)}
  </select>;
}

/** «Sugerir campos» (1.5.2): parts of the text that are data, each proposed with its field and accepted one by one. */
function SuggestFields({ templateId, sectionId, text, onApply }: { templateId: string; sectionId: string; text: string; onApply: (text: string) => void }) {
  const [suggestions, setSuggestions] = useState<FieldSuggestion[] | null>(null), [busy, setBusy] = useState(false), [error, setError] = useState(""), [notice, setNotice] = useState("");
  async function ask() {
    setBusy(true); setError(""); setNotice(""); setSuggestions(null);
    try {
      const answer = await api<{ suggestions: FieldSuggestion[]; notice?: string }>(`/report-templates/${templateId}/suggest-fields`, "POST", { text, ...(sectionId ? { sectionId } : {}) });
      setSuggestions(answer.suggestions); setNotice(answer.notice || "");
    }
    catch (cause) { setError(message(cause)); }
    finally { setBusy(false); }
  }
  const drop = (item: FieldSuggestion) => setSuggestions(current => current && current.filter(other => other !== item));
  return <div className="ai-write">
    <div className="ai-write-actions"><Icon name="sparkles" size={16}/>
      <button type="button" className="button ghost small" disabled={busy || !text.trim()} onClick={() => void ask()}>{busy ? "Buscando datos…" : "Sugerir campos"}</button>
      <span className="hint">Reconoce los datos de la sección de la vista previa.</span>
    </div>
    {error && <p className="field-error" role="alert">{error}</p>}
    {suggestions && <div className="ai-write-proposal" role="region" aria-label="Campos sugeridos">
      {notice && <p className="muted">{notice}</p>}
      {!suggestions.length ? <p>No hay datos del texto para convertir en campos.</p> : <ul className="suggested-fields">{suggestions.map(item => <li key={`${item.original}-${item.field}`}>
        <span>«{item.original}» → <strong>{item.label}</strong> <code>{`{{${item.field}}}`}</code></span>
        <span className="ai-write-actions">
          <button type="button" className="button primary small" aria-label={`Usar ${item.label} en lugar de «${item.original}»`} onClick={() => { onApply(applySuggestion(text, item)); drop(item); }}>Usar</button>
          <button type="button" className="button ghost small" aria-label={`Descartar ${item.label}`} onClick={() => drop(item)}>Descartar</button>
        </span>
      </li>)}</ul>}
    </div>}
  </div>;
}

function BlockProperties({ block, spec, images, templateId, sectionId, onChange }: { block: TemplateBlock; spec: ReportKindSpec; images: ImageView[]; templateId: string; sectionId: string; onChange: (block: TemplateBlock) => void }) {
  const alignField = (value: string | undefined, set: (align: "left" | "center" | "right") => void) => <Field label="Alineación"><select value={value || "left"} onChange={event => set(event.target.value as "left")}><option value="left">Izquierda</option><option value="center">Centro</option><option value="right">Derecha</option></select></Field>;
  switch (block.type) {
    case "title": case "text": return <div className="stack">
      <Field label="Texto" hint="Los campos se insertan desde la lista y se llenan con los datos de cada documento."><textarea data-ai-write={`document-${block.id}`} rows={block.type === "title" ? 2 : 6} value={block.text} onChange={event => onChange({ ...block, text: event.target.value })}/></Field>
      {block.type === "text" && <AiWrite field="document-text" target={`document-${block.id}`} label="Texto"/>}
      <SuggestFields key={block.id} templateId={templateId} sectionId={sectionId} text={block.text} onApply={text => onChange({ ...block, text })}/>
      <FieldPicker spec={spec} onPick={key => onChange({ ...block, text: `${block.text}{{${key}}}` })}/>
      {alignField(block.align, align => onChange({ ...block, align }))}
      {block.type === "text" && <label className="check"><input type="checkbox" checked={!!block.italic} onChange={event => onChange({ ...block, italic: event.target.checked })}/><span>Cursiva</span></label>}
    </div>;
    case "fields": return <div className="stack">{block.pairs.map((pair, index) => <div key={index} className="document-pair">
      <Field label={`Etiqueta ${index + 1}`}><input value={pair.label} maxLength={80} onChange={event => onChange({ ...block, pairs: block.pairs.map((item, at) => at === index ? { ...item, label: event.target.value } : item) })}/></Field>
      <Field label="Campo"><select value={pair.field} onChange={event => onChange({ ...block, pairs: block.pairs.map((item, at) => at === index ? { ...item, field: event.target.value } : item) })}>{spec.fields.map(field => <option key={field.key} value={field.key}>{field.label}</option>)}</select></Field>
      <Button variant="ghost" onClick={() => onChange({ ...block, pairs: block.pairs.filter((_, at) => at !== index) })}>Quitar</Button>
    </div>)}<Button icon="plus" onClick={() => onChange({ ...block, pairs: [...block.pairs, { label: spec.fields[0].label, field: spec.fields[0].key }] })}>Agregar campo</Button></div>;
    case "table": {
      const dataset = spec.datasets.find(item => item.key === block.dataset) || spec.datasets[0];
      return <div className="stack">
        <Field label="Datos"><select value={block.dataset} onChange={event => { const next = spec.datasets.find(item => item.key === event.target.value)!; onChange({ ...block, dataset: next.key, columns: next.columns.map(column => ({ field: column.key, label: column.label, width: 1 })) }); }}>{spec.datasets.map(item => <option key={item.key} value={item.key}>{item.label}</option>)}</select></Field>
        <fieldset className="document-columns"><legend>Columnas</legend>{dataset.columns.map(column => { const chosen = block.columns.find(item => item.field === column.key); return <label key={column.key} className="check">
          <input type="checkbox" checked={!!chosen} onChange={event => onChange({ ...block, columns: event.target.checked ? [...block.columns, { field: column.key, label: column.label, width: 1 }] : block.columns.filter(item => item.field !== column.key) })}/><span>{column.label}</span>
        </label>; })}</fieldset>
        <label className="check"><input type="checkbox" checked={block.borders !== false} onChange={event => onChange({ ...block, borders: event.target.checked })}/><span>Bordes</span></label>
        <label className="check"><input type="checkbox" checked={block.shade !== false} onChange={event => onChange({ ...block, shade: event.target.checked })}/><span>Encabezado sombreado</span></label>
      </div>;
    }
    case "image": return <div className="stack">
      <Field label="Imagen"><select value={block.imageId} onChange={event => onChange({ ...block, imageId: event.target.value })}>{images.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></Field>
      <Field label="Ancho (mm)"><input type="number" min={5} max={180} value={block.widthMm} onChange={event => onChange({ ...block, widthMm: Number(event.target.value) })}/></Field>
      {alignField(block.align, align => onChange({ ...block, align }))}
    </div>;
    case "signatures": return <div className="stack">{block.lines.map((line, index) => <div key={index} className="document-pair">
      <Field label={`Firma ${index + 1}`}><input value={line.name} maxLength={80} onChange={event => onChange({ ...block, lines: block.lines.map((item, at) => at === index ? { ...item, name: event.target.value } : item) })}/></Field>
      <Field label="Cargo"><input value={line.role} maxLength={80} onChange={event => onChange({ ...block, lines: block.lines.map((item, at) => at === index ? { ...item, role: event.target.value } : item) })}/></Field>
      <Button variant="ghost" onClick={() => onChange({ ...block, lines: block.lines.filter((_, at) => at !== index) })}>Quitar</Button>
    </div>)}{block.lines.length < 4 && <Button icon="plus" onClick={() => onChange({ ...block, lines: [...block.lines, { name: "Nombre", role: "Cargo" }] })}>Agregar firma</Button>}</div>;
    case "page-break": return <p className="muted">El bloque siguiente empieza en una página nueva.</p>;
  }
}

export function DocumentDesigner({ id }: { id: string }) {
  const { toast } = useFeedback();
  const [template, setTemplate] = useState<TemplateView | null>(null), [draft, setDraft] = useState<ReportTemplate | null>(null), [kinds, setKinds] = useState<Record<ReportKind, ReportKindSpec> | null>(null);
  const [versions, setVersions] = useState<{ version: number; publishedAt: string; publishedBy: string }[]>([]), [images, setImages] = useState<ImageView[]>([]), [sections, setSections] = useState<{ id: string; name: string; course: { title: string } }[]>([]);
  const [selected, setSelected] = useState<string>("documento"), [error, setError] = useState(""), [busy, setBusy] = useState(""), [dirty, setDirty] = useState(false);
  const [preview, setPreview] = useState<string | null>(null), [previewSection, setPreviewSection] = useState(""), [history, setHistory] = useState(false);
  const upload = useRef<HTMLInputElement>(null);
  useEffect(() => {
    void Promise.all([api<{ template: TemplateView; versions: typeof versions }>(`/report-templates/${id}`), api<{ kinds: Record<ReportKind, ReportKindSpec> }>("/report-templates"), api<{ images: ImageView[] }>("/report-images"), api<{ sections: { id: string; name: string; course: { title: string } }[] }>("/sections")])
      .then(([one, all, files, list]) => { setTemplate(one.template); setDraft(one.template.draft); setVersions(one.versions); setKinds(all.kinds); setImages(files.images); setSections(list.sections); setPreviewSection(list.sections[0]?.id || ""); }, cause => setError(message(cause)));
  }, [id]);
  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview); }, [preview]);
  const header = <PageHeader crumbs={[{ label: "Documentos", href: "/organizacion/documentos" }, { label: template?.name || "Plantilla" }]} title={template?.name || "Plantilla"}
    description={template ? `${template.publishedVersion ? `Publicada v${template.publishedVersion}` : "Sin publicar"}${dirty ? " · Cambios sin guardar" : ""}` : undefined}
    actions={template && <><Button icon="clock" onClick={() => setHistory(true)}>Historial</Button><Button busy={busy === "save"} disabled={!!busy || !dirty} onClick={() => void save()}>Guardar</Button></>}
    primary={template && <PrimaryAction icon="send" busy={busy === "publish"} disabled={!!busy} onClick={() => void publish()}>Publicar</PrimaryAction>}/>;
  if (error) return <>{header}<ErrorState error={error}/></>;
  if (!template || !draft || !kinds) return <>{header}<Loading label="Abriendo la plantilla…" lines={8}/></>;
  const spec = kinds[template.kind];
  const change = (next: ReportTemplate) => { setDraft(next); setDirty(true); };
  const block = draft.blocks.find(item => item.id === selected);
  async function save() {
    setBusy("save");
    try { const result = await api<{ template: TemplateView }>(`/report-templates/${id}`, "PUT", { draft }); setTemplate(result.template); setDirty(false); toast({ message: "Plantilla guardada." }); return true; }
    catch (cause) { toast({ tone: "error", message: message(cause) }); return false; }
    finally { setBusy(""); }
  }
  async function publish() {
    if (dirty && !await save()) return;
    setBusy("publish");
    try { const result = await api<{ template: TemplateView; versions: typeof versions }>(`/report-templates/${id}/publish`, "POST"); setTemplate(result.template); setVersions(result.versions); toast({ message: `Publicada la versión ${result.template.publishedVersion}. Los documentos nuevos la usan.` }); }
    catch (cause) { toast({ tone: "error", message: message(cause) }); }
    finally { setBusy(""); }
  }
  async function showPreview() {
    setBusy("preview");
    try {
      const response = await fetch(`/api/report-templates/${id}/preview`, { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ draft, sectionId: previewSection }) });
      if (!response.ok) throw new Error(((await response.json().catch(() => ({}))) as { error?: string }).error || "No se pudo generar la vista previa.");
      setPreview(URL.createObjectURL(await response.blob()));
    } catch (cause) { toast({ tone: "error", message: message(cause) }); }
    finally { setBusy(""); }
  }
  async function addImage(file: File) {
    setBusy("image");
    try {
      const result = await sendFile<{ image: ImageView }>("/report-images", "POST", await asJpeg(file), { "Content-Type": "image/jpeg", "X-File-Name": encodeURIComponent(file.name) });
      setImages([result.image, ...images]); change({ ...draft!, logoId: draft!.logoId || result.image.id }); toast({ message: "Imagen agregada." });
    } catch (cause) { toast({ tone: "error", message: message(cause) }); }
    finally { setBusy(""); }
  }
  function add(type: TemplateBlock["type"]) {
    const created: TemplateBlock = type === "title" ? { id: newId(), type, text: "Título" } : type === "text" ? { id: newId(), type, text: "Texto del documento." }
      : type === "fields" ? { id: newId(), type, pairs: [{ label: spec.fields[0].label, field: spec.fields[0].key }] }
      : type === "table" ? { id: newId(), type, dataset: spec.datasets[0].key, columns: spec.datasets[0].columns.map(column => ({ field: column.key, label: column.label, width: 1 })), borders: true, shade: true }
      : type === "image" ? { id: newId(), type, imageId: images[0].id, widthMm: 30 } : type === "signatures" ? { id: newId(), type, lines: [{ name: "Nombre", role: "Cargo" }] } : { id: newId(), type: "page-break" };
    change({ ...draft!, blocks: [...draft!.blocks, created] }); setSelected(created.id);
  }
  const move = (index: number, by: number) => { const blocks = [...draft.blocks]; const [item] = blocks.splice(index, 1); blocks.splice(index + by, 0, item); change({ ...draft, blocks }); };
  const summary = (item: TemplateBlock) => item.type === "title" || item.type === "text" ? item.text.slice(0, 90) : item.type === "fields" ? item.pairs.map(pair => pair.label).join(" · ") : item.type === "table" ? item.columns.map(column => column.label).join(" · ")
    : item.type === "image" ? images.find(image => image.id === item.imageId)?.name || "Imagen" : item.type === "signatures" ? item.lines.map(line => line.name).join(" · ") : "—";
  return <>
    {header}
    <div className="document-designer">
      <section className="document-palette" aria-label="Bloques">
        <h2>Bloques</h2>
        {(Object.keys(blockLabels) as TemplateBlock["type"][]).filter(type => (type !== "table" || spec.datasets.length) && (type !== "image" || images.length)).map(type => <button key={type} type="button" className="button ghost" onClick={() => add(type)}><Icon name="plus" size={16}/>{blockLabels[type]}</button>)}
        <input ref={upload} type="file" accept="image/png,image/jpeg" hidden onChange={event => { const file = event.target.files?.[0]; if (file) void addImage(file); event.target.value = ""; }}/>
        <Button icon="upload" busy={busy === "image"} onClick={() => upload.current?.click()}>Subir imagen</Button>
      </section>
      <section className="document-sheet" aria-label="Hoja">
        <button type="button" className={`document-block${selected === "documento" ? " is-selected" : ""}`} onClick={() => setSelected("documento")}>
          <strong>Encabezado y página</strong><span className="muted">{draft.header.join(" · ") || "Sin encabezado"}</span>
        </button>
        <ol>{draft.blocks.map((item, index) => <li key={item.id} className={`document-block${selected === item.id ? " is-selected" : ""}`}>
          <button type="button" className="document-block-main" onClick={() => setSelected(item.id)}><strong>{blockLabels[item.type]}</strong><span className="muted">{summary(item)}</span></button>
          <div className="document-block-tools">
            <button type="button" className="button ghost small" aria-label={`Subir ${blockLabels[item.type]} ${index + 1}`} disabled={index === 0} onClick={() => move(index, -1)}><Icon name="chevronUp" size={16}/></button>
            <button type="button" className="button ghost small" aria-label={`Bajar ${blockLabels[item.type]} ${index + 1}`} disabled={index === draft.blocks.length - 1} onClick={() => move(index, 1)}><Icon name="chevronDown" size={16}/></button>
            <button type="button" className="button ghost small" aria-label={`Quitar ${blockLabels[item.type]} ${index + 1}`} disabled={draft.blocks.length === 1} onClick={() => { change({ ...draft, blocks: draft.blocks.filter(other => other.id !== item.id) }); setSelected("documento"); }}><Icon name="close" size={16}/></button>
          </div>
        </li>)}</ol>
      </section>
      <section className="document-properties" aria-label="Propiedades">
        <h2>{block ? blockLabels[block.type] : "Encabezado y página"}</h2>
        {block ? <BlockProperties block={block} spec={spec} images={images} templateId={id} sectionId={previewSection} onChange={next => change({ ...draft, blocks: draft.blocks.map(item => item.id === next.id ? next : item) })}/> : <div className="stack">
          <Field label="Tamaño"><select value={draft.page.size} onChange={event => change({ ...draft, page: { ...draft.page, size: event.target.value as "letter" } })}><option value="letter">Carta</option><option value="legal">Oficio</option><option value="a4">A4</option></select></Field>
          <Field label="Orientación"><select value={draft.page.orientation} onChange={event => change({ ...draft, page: { ...draft.page, orientation: event.target.value as "portrait" } })}><option value="portrait">Vertical</option><option value="landscape">Horizontal</option></select></Field>
          <Field label="Logotipo"><select value={draft.logoId || ""} onChange={event => change({ ...draft, logoId: event.target.value || null })}><option value="">Sin logotipo</option>{images.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></Field>
          {[0, 1, 2].map(line => <Field key={line} label={`Encabezado, línea ${line + 1}`} optional={line > 0}><input value={draft.header[line] || ""} maxLength={160} onChange={event => { const next = [...draft.header]; next[line] = event.target.value; change({ ...draft, header: next.filter((item, at) => item || at < line).map(item => item || "") }); }}/></Field>)}
          <Field label="Pie de página" optional><input value={draft.footer} maxLength={200} onChange={event => change({ ...draft, footer: event.target.value })}/></Field>
        </div>}
      </section>
    </div>
    <Section title="Vista previa" className="document-preview-panel" action={<div className="document-preview-tools">
      <select aria-label="Sección de la vista previa" value={previewSection} onChange={event => setPreviewSection(event.target.value)}>{sections.map(item => <option key={item.id} value={item.id}>{item.course.title} · {item.name}</option>)}</select>
      <Button icon="eye" busy={busy === "preview"} disabled={!previewSection || !!busy} onClick={() => void showPreview()}>Ver con datos reales</Button>
    </div>}>
      {preview ? <><iframe className="document-preview" title="Vista previa del documento" src={preview}/><p><a href={preview} target="_blank" rel="noopener">Abrir el PDF en otra pestaña</a></p></> : <p className="muted">Elige una sección y genera la vista previa: es el PDF real, con los datos de la sección y sin registrar el documento.</p>}
    </Section>
    {history && <Modal title="Historial de versiones" onClose={() => setHistory(false)}>
      {versions.length ? <ul className="document-versions">{versions.map(item => <li key={item.version}>
        <span><strong>v{item.version}</strong> · {formatInstant(item.publishedAt)} · {item.publishedBy}</span>
        <Button variant="ghost" onClick={() => void api<{ template: TemplateView }>(`/report-templates/${id}/restore?version=${item.version}`, "POST").then(result => { setDraft(result.template.draft); setDirty(false); setHistory(false); toast({ message: `El borrador vuelve a la versión ${item.version}.` }); }, cause => toast({ tone: "error", message: message(cause) }))}>Restaurar como borrador</Button>
      </li>)}</ul> : <p className="muted">Aún no se ha publicado ninguna versión.</p>}
    </Modal>}
  </>;
}
