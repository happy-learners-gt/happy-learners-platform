import { useCallback, useEffect, useState } from "react";
import type { FormEvent } from "react";
import type { BibliographyReference, BibliographyRole, Material } from "@happy-learners/contracts";
import { bibliographyRoleLabel, bibliographyRoles, maxCitation, primaryBlocker } from "@happy-learners/domain";
import { api, message } from "../../api";
import { Modal, useFeedback } from "../../ui/feedback";
import { Icon } from "../../ui/icons";
import { Menu } from "../../ui/Menu";
import type { MenuItem } from "../../ui/Menu";
import { ErrorState, Field, Loading, Section, StatusBadge } from "../../ui/primitives";

type Data = { references: BibliographyReference[]; canManage: boolean };
/** The course's references and whether the person manages them (administration and the course's team). */
export function useBibliography(courseId: string) {
  const [data, setData] = useState<Data | null>(null), [error, setError] = useState("");
  const load = useCallback(() => api<Data>(`/courses/${courseId}/bibliography`).then(result => { setData(result); setError(""); }, cause => setError(message(cause))), [courseId]);
  useEffect(() => { void load(); }, [load]);
  return { data, error, load, setData };
}
export type Bibliography = ReturnType<typeof useBibliography>;

const kindLabel: Record<Material["kind"], string> = { text: "Texto", link: "Enlace", file: "Documento" };
const statusNote: Partial<Record<Material["status"], string>> = { draft: "Borrador", archived: "Archivado" };

/**
 * «Bibliografía del curso»: references to items of the course's library, each with a role, and the course's main
 * book. The library keeps the files (R2) and texts; the bibliography only points to them.
 */
export function CourseBibliography({ courseId, items, bibliography, adding, onAdding }: { courseId: string; items: Material[]; bibliography: Bibliography; adding: string | null; onAdding: (itemId: string | null) => void }) {
  const { toast, confirm } = useFeedback();
  const { data, error, load, setData } = bibliography;
  const [editing, setEditing] = useState<BibliographyReference | null>(null);
  async function change(reference: BibliographyReference, body: { role: BibliographyRole; citation: string; primary: boolean }, done: string) {
    try { setData(await api<Data>(`/courses/${courseId}/bibliography/${reference.id}`, "PUT", body)); toast({ message: done }); }
    catch (cause) { toast({ tone: "error", message: message(cause) }); }
  }
  async function makePrimary(reference: BibliographyReference) {
    const current = data?.references.find(item => item.primary);
    if (current && !await confirm({ title: `¿Usar «${reference.title}» como libro principal?`, body: <p>Reemplaza a «{current.title}», que queda en la bibliografía como texto.</p>, confirm: "Usar como principal" })) return;
    await change(reference, { role: "text", citation: reference.citation, primary: true }, `«${reference.title}» es el libro principal del curso.`);
  }
  async function remove(reference: BibliographyReference) {
    if (!await confirm({ title: `¿Quitar «${reference.title}» de la bibliografía?`, body: <p>{reference.primary ? "El curso se queda sin libro principal. " : ""}El recurso sigue en la biblioteca del curso.</p>, confirm: "Quitar", danger: true })) return;
    try { await api(`/courses/${courseId}/bibliography/${reference.id}`, "DELETE"); await load(); toast({ message: `«${reference.title}» se quitó de la bibliografía.` }); }
    catch (cause) { toast({ tone: "error", message: message(cause) }); }
  }
  const actions = (reference: BibliographyReference): MenuItem[] => [
    ...(!reference.primary && reference.status === "published" ? [{ label: "Marcar como libro principal", icon: "check" as const, onSelect: () => void makePrimary(reference) }] : []),
    ...(reference.primary ? [{ label: "Dejar de usar como principal", icon: "undo" as const, onSelect: () => void change(reference, { role: reference.role, citation: reference.citation, primary: false }, `El curso ya no tiene libro principal.`) }] : []),
    { label: "Editar rol y cita", icon: "edit" as const, onSelect: () => setEditing(reference) },
    "separator",
    { label: "Quitar de la bibliografía", danger: true, onSelect: () => void remove(reference) },
  ];
  const referenced = new Set(data?.references.map(reference => reference.itemId));
  const available = items.filter(item => item.status !== "archived" && !referenced.has(item.fileId || item.id));
  return <Section title="Bibliografía del curso" className="bibliography-panel" action={data?.canManage && <button type="button" className="button secondary small" disabled={!available.length} onClick={() => onAdding("")}><Icon name="plus" size={16}/>Agregar referencia</button>}>
    <p className="muted small">Los libros y materiales que el curso sigue, tomados de su biblioteca. El libro principal es el texto base del curso; solo puede haber uno.</p>
    {error ? <ErrorState error={error} retry={() => void load()}/> : !data ? <Loading label="Cargando bibliografía…" lines={2}/>
      : !data.references.length ? <p className="muted small">{data.canManage ? (items.length ? "Aún no hay referencias. Agrega un recurso de la biblioteca, por ejemplo el libro de texto en PDF." : "Sube o agrega primero el libro a la biblioteca del curso y después agrégalo aquí.") : "El curso aún no tiene bibliografía."}</p>
      : <ul className="bibliography">{data.references.map(reference => <li key={reference.id} className={reference.primary ? "is-primary" : undefined}>
        <Icon name={reference.kind === "file" ? "file" : reference.kind === "link" ? "link" : "text"} size={18}/>
        <div>
          <strong>{reference.title}</strong>
          <span className="muted small">{[kindLabel[reference.kind], reference.fileName, reference.citation].filter(Boolean).join(" · ")}</span>
        </div>
        <div className="badge-row">
          {reference.primary && <StatusBadge tone="success">Libro principal</StatusBadge>}
          <StatusBadge tone="info">{bibliographyRoleLabel(reference.role)}</StatusBadge>
          {statusNote[reference.status] && <StatusBadge tone="warning">{statusNote[reference.status]}</StatusBadge>}
        </div>
        {data.canManage ? <Menu label={`Acciones de ${reference.title}`} items={actions(reference)}/> : <span/>}
      </li>)}</ul>}
    {adding !== null && data?.canManage && <ReferenceDialog courseId={courseId} items={available} itemId={adding} hasPrimary={data.references.some(reference => reference.primary)} onClose={() => onAdding(null)}
      onSaved={result => { setData(result); onAdding(null); toast({ message: "Referencia agregada a la bibliografía." }); }}/>}
    {editing && <ReferenceDialog courseId={courseId} reference={editing} items={[]} hasPrimary={false} onClose={() => setEditing(null)}
      onSaved={result => { setData(result); setEditing(null); toast({ message: "Referencia actualizada." }); }}/>}
  </Section>;
}

function ReferenceDialog({ courseId, reference, items, itemId, hasPrimary, onClose, onSaved }: { courseId: string; reference?: BibliographyReference; items: Material[]; itemId?: string; hasPrimary: boolean; onClose: () => void; onSaved: (data: Data) => void }) {
  const [values, setValues] = useState({ itemId: itemId || items[0]?.fileId || items[0]?.id || "", role: reference?.role || "text" as BibliographyRole, citation: reference?.citation || "", primary: reference?.primary || false });
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  const chosen = items.find(item => (item.fileId || item.id) === values.itemId);
  const blocked = values.primary ? primaryBlocker(reference ? reference.status : chosen?.status || "draft") : null;
  async function submit(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError("");
    try {
      const body = { role: values.role, citation: values.citation, primary: values.primary };
      onSaved(reference ? await api<Data>(`/courses/${courseId}/bibliography/${reference.id}`, "PUT", body) : await api<Data>(`/courses/${courseId}/bibliography`, "POST", { ...body, itemId: values.itemId }));
    } catch (cause) { setError(message(cause)); setBusy(false); }
  }
  return <Modal title={reference ? `Editar «${reference.title}»` : "Agregar a la bibliografía"} onClose={onClose}>
    <form className="stack" onSubmit={submit} aria-label={reference ? "Editar referencia" : "Agregar referencia"}>
      {error && <p className="form-alert" role="alert"><Icon name="alert" size={18}/>{error}</p>}
      <fieldset disabled={busy} className="stack">
        {!reference && <Field label="Recurso de la biblioteca" hint="Para subir un libro nuevo, usa «Agregar recurso» en la biblioteca y vuelve aquí.">
          <select value={values.itemId} onChange={event => setValues({ ...values, itemId: event.target.value })} required>
            {items.map(item => <option key={item.fileId || item.id} value={item.fileId || item.id}>{item.title}{item.fileName ? ` (${item.fileName})` : ""}{item.status === "draft" ? " · borrador" : ""}</option>)}
          </select>
        </Field>}
        <Field label="Rol"><select value={values.role} onChange={event => setValues({ ...values, role: event.target.value as BibliographyRole, primary: event.target.value === "text" && values.primary })}>
          {bibliographyRoles.map(role => <option key={role.value} value={role.value}>{role.label}: {role.description.toLocaleLowerCase("es")}</option>)}
        </select></Field>
        <Field label="Cita" optional hint="Autor, editorial y año, como la quieras ver en la bibliografía."><input value={values.citation} maxLength={maxCitation} onChange={event => setValues({ ...values, citation: event.target.value })}/></Field>
        <label className="switch"><input type="checkbox" checked={values.primary} disabled={values.role !== "text"} onChange={event => setValues({ ...values, primary: event.target.checked })}/><span>Libro principal del curso{hasPrimary && !reference?.primary ? " (reemplaza al actual)" : ""}</span></label>
        {blocked && <p className="muted small" role="status">{blocked}</p>}
        <div className="button-row"><button className="button primary" disabled={!!blocked || (!reference && !values.itemId)}>{busy ? "Guardando…" : reference ? "Guardar cambios" : "Agregar referencia"}</button><button type="button" className="button ghost" onClick={onClose}>Cancelar</button></div>
      </fieldset>
    </form>
  </Modal>;
}
