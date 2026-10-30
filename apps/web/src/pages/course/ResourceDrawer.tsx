import { useState } from "react";
import type { FormEvent } from "react";
import { resourceFields, resourceLicenses, resourceRoles, resourceRoleLabel, resourceTypeLabel, resourceTypes } from "@happy-learners/domain";
import type { ResourceAuthor, ResourceKind, ResourceLicense, ResourceRole, ResourceType } from "@happy-learners/domain";
import { api, fileAccept, message, uploadCourseFile } from "../../api";
import { Drawer } from "../../ui/feedback";
import { Icon } from "../../ui/icons";
import { Field } from "../../ui/primitives";
import type { CourseResource } from "./course-resource";
import { kindLabel, licenseLabel } from "./course-resource";

const kinds = ["file", "link", "text", "reference"] as const;

/** Agregar recurso: what it is, then the record for its type. Editing opens on the record. */
export function ResourceDrawer({ courseId, item, onClose, onSaved }: { courseId: string; item?: CourseResource; onClose: () => void; onSaved: (text: string) => Promise<void> }) {
  const [step, setStep] = useState<1 | 2>(item ? 2 : 1);
  const [kind, setKind] = useState<ResourceKind>(item?.kind || "file");
  const [type, setType] = useState<ResourceType>(item?.type || "other");
  const [authors, setAuthors] = useState<ResourceAuthor[]>(item?.authors.length ? item.authors : [{ kind: "person", family: "", given: "" }]);
  const [role, setRole] = useState<ResourceRole | "">(item?.role || "");
  const [shareable, setShareable] = useState(!!item?.shareable);
  const [manual, setManual] = useState(!!item?.citationOverride);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [lookup, setLookup] = useState("");
  const fields = resourceFields(type);

  function fill(record: { type: ResourceType; title: string; authors: ResourceAuthor[]; year: number | null; metadata: Record<string, string | number | null> }) {
    setType(record.type);
    setAuthors(record.authors.length ? record.authors : authors);
    const form = document.getElementById("resource-ficha") as HTMLFormElement | null;
    if (!form) return;
    (form.elements.namedItem("title") as HTMLInputElement).value = record.title;
    if (record.year) (form.elements.namedItem("year") as HTMLInputElement).value = String(record.year);
    for (const [key, value] of Object.entries(record.metadata)) {
      const input = form.elements.namedItem(key) as HTMLInputElement | null;
      if (input && value !== null && value !== undefined) input.value = String(value);
    }
  }

  async function searchIdentifier() {
    const isbn = lookup.trim();
    if (!isbn) return;
    setBusy(true); setError("");
    try {
      const body = type === "article" || isbn.includes("/") ? { doi: isbn } : { isbn };
      const result = await api<{ record: { type: ResourceType; title: string; authors: ResourceAuthor[]; year: number | null; metadata: Record<string, string | number | null> } }>(`/courses/${courseId}/resources/lookup`, "POST", body);
      fill(result.record);
    } catch (cause) { setError(message(cause)); }
    finally { setBusy(false); }
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    setBusy(true); setError("");
    try {
      const metadata: Record<string, string> = {};
      for (const field of fields) {
        const value = String(data.get(field.key) || "").trim();
        if (value) metadata[field.key] = value;
      }
      const people = authors.map(author => author.kind === "institution" ? { ...author, name: author.name.trim() } : { ...author, family: author.family.trim(), given: author.given.trim() }).filter(author => author.kind === "institution" ? author.name : author.family);
      const body = {
        type, kind, title: String(data.get("title") || "").trim(), authors: people, year: String(data.get("year") || "").trim() || null,
        metadata, language: String(data.get("language") || "").trim(), license: String(data.get("license") || "reserved"), shareable,
        level: String(data.get("level") || "").trim(), area: String(data.get("area") || "").trim(), role: role || null,
        citationOverride: manual ? String(data.get("citationOverride") || "").trim() || null : null,
      };
      if (kind === "file" && !item) {
        const file = data.get("file");
        if (!(file instanceof File) || !file.size) throw new Error("Elige un archivo para subir.");
        await uploadCourseFile(courseId, file, file.name);
        if (body.title && people.length) {
          const listed = await api<{ resources: CourseResource[] }>(`/courses/${courseId}/resources`);
          const created = listed.resources.find(resource => resource.fileName === file.name);
          if (created) await api(`/courses/${courseId}/resources/${created.id}`, "PUT", { ...body, title: body.title || created.title });
        }
        await onSaved(`«${file.name}» se agregó a la biblioteca del curso.`);
        return;
      }
      if (item) await api(`/courses/${courseId}/resources/${item.id}`, "PUT", body);
      else await api(`/courses/${courseId}/resources`, "POST", body);
      await onSaved(item ? "Ficha guardada." : "Recurso agregado.");
    } catch (cause) { setError(message(cause)); }
    finally { setBusy(false); }
  }

  return <Drawer wide title={item ? "Editar ficha" : "Agregar recurso"} onClose={onClose}>
    <form id="resource-ficha" className="stack resource-form" onSubmit={submit}>
      {error && <p className="form-alert" role="alert"><Icon name="alert" size={18}/>{error}</p>}
      {step === 1 && <fieldset className="choice-field"><legend>Qué es</legend>
        <div className="segmented wide">{kinds.map(value => <label key={value}><input type="radio" name="kind" checked={kind === value} onChange={() => setKind(value)}/><span>{kindLabel[value]}</span></label>)}</div>
        <div className="modal-actions"><button type="button" className="button ghost" onClick={onClose}>Cancelar</button><button type="button" className="button primary" onClick={() => setStep(2)}>Continuar</button></div>
      </fieldset>}
      {step === 2 && <fieldset className="stack" disabled={busy}>
        <Field label="Tipo"><select value={type} onChange={event => setType(event.target.value as ResourceType)}>{resourceTypes.map(value => <option key={value} value={value}>{resourceTypeLabel[value]}</option>)}</select></Field>
        <Field label="Título"><input name="title" maxLength={200} defaultValue={item?.title} required={kind !== "file" || !!item}/></Field>
        <fieldset className="resource-authors"><legend>Autoría</legend>
          {authors.map((author, index) => <div key={index} className="resource-author">
            <label className="select-inline"><span className="sr-only">Tipo de autoría</span><select value={author.kind} onChange={event => setAuthors(authors.map((row, at) => at === index ? event.target.value === "institution" ? { kind: "institution", name: "" } : { kind: "person", family: "", given: "" } : row))}><option value="person">Persona</option><option value="institution">Institución</option></select></label>
            {author.kind === "person" ? <>
              <Field label="Apellido"><input value={author.family} maxLength={80} onChange={event => setAuthors(authors.map((row, at) => at === index && row.kind === "person" ? { ...row, family: event.target.value } : row))}/></Field>
              <Field label="Nombre"><input value={author.given} maxLength={80} onChange={event => setAuthors(authors.map((row, at) => at === index && row.kind === "person" ? { ...row, given: event.target.value } : row))}/></Field>
            </> : <Field label="Institución"><input value={author.name} maxLength={200} onChange={event => setAuthors(authors.map((row, at) => at === index && row.kind === "institution" ? { ...row, name: event.target.value } : row))}/></Field>}
          </div>)}
          <button type="button" className="button ghost small" onClick={() => setAuthors([...authors, { kind: "person", family: "", given: "" }])}>Agregar autor</button>
        </fieldset>
        <Field label="Año" optional><input name="year" inputMode="numeric" maxLength={4} defaultValue={item?.year ?? ""} placeholder="s. f."/></Field>
        {fields.map(field => <Field key={field.key} label={field.label} optional><input name={field.key} maxLength={300} defaultValue={item?.metadata[field.key] ?? ""}/></Field>)}
        {(type === "book" || type === "article" || type === "dataset") && <div className="resource-lookup">
          <Field label={type === "article" ? "DOI" : "ISBN o DOI"} optional><input value={lookup} onChange={event => setLookup(event.target.value)} placeholder={type === "article" ? "10.1000/…" : "978…"}/></Field>
          <button type="button" className="button secondary" disabled={busy || !lookup.trim()} onClick={() => void searchIdentifier()}>Completar la ficha</button>
        </div>}
        <Field label="Idioma" optional><input name="language" maxLength={40} defaultValue={item?.language || "es"}/></Field>
        <Field label="Licencia"><select name="license" defaultValue={item?.license || "reserved"}>{resourceLicenses.map(value => <option key={value} value={value}>{licenseLabel[value]}</option>)}</select></Field>
        <Field label="Nivel" optional><input name="level" maxLength={80} defaultValue={item?.level}/></Field>
        <Field label="Área" optional><input name="area" maxLength={80} defaultValue={item?.area}/></Field>
        <Field label="Rol" hint="Con un rol, el recurso entra en la bibliografía. El texto principal es uno por curso.">
          <select value={role} onChange={event => setRole(event.target.value as ResourceRole | "")}><option value="">Sin rol</option>{resourceRoles.map(value => <option key={value} value={value}>{resourceRoleLabel[value]}</option>)}</select>
        </Field>
        <label className="switch"><input type="checkbox" checked={shareable} onChange={event => setShareable(event.target.checked)}/><span>Se puede compartir con estudiantes</span></label>
        <label className="switch"><input type="checkbox" checked={manual} onChange={event => setManual(event.target.checked)}/><span>Escribir la cita a mano</span></label>
        {manual && <Field label="Cita escrita a mano"><textarea name="citationOverride" maxLength={500} rows={3} defaultValue={item?.citationOverride || ""}/></Field>}
        {kind === "file" && !item && <Field label="Archivo" hint="Presentaciones, documentos y hojas (PPTX, DOCX, XLSX) hasta 15 MB; PDF hasta 25 MB; video MP4 o WebM hasta 100 MB. Es privado: solo lo reciben estudiantes dentro de una lección publicada."><input name="file" type="file" accept={fileAccept} required/></Field>}
        <div className="modal-actions">
          {!item && <button type="button" className="button ghost" onClick={() => setStep(1)}>Atrás</button>}
          <button type="button" className="button ghost" onClick={onClose}>Cancelar</button>
          <button className="button primary">{busy ? (kind === "file" && !item ? "Subiendo…" : "Guardando…") : kind === "file" && !item ? "Subir documento" : item ? "Guardar ficha" : "Agregar recurso"}</button>
        </div>
      </fieldset>}
    </form>
  </Drawer>;
}
