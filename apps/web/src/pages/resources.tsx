import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import type { Course, Lesson, Material, Resource, Taxonomy } from "@happy-learners/contracts";
import { api, fileAccept, message, uploadCourseFile } from "../api";
import { Link } from "../navigation";
import { resourceStatusLabel } from "../model";
import { FileViewer } from "../FileViewer";
import type { LibraryItem } from "../ui/cards";
import { Modal } from "../ui/feedback";
import { Icon } from "../ui/icons";
import { Field } from "../ui/primitives";
import { TermChoices } from "./Courses";

export function legacyItem(resource: Resource, usedIn: number): LibraryItem {
  return { id: resource.id, courseId: "", title: resource.title, description: resource.description, kind: resource.kind === "link" ? "link" : "text", content: resource.content, status: resource.status, version: 1, updatedAt: resource.updatedAt || "", termIds: [], usedIn, legacy: true };
}

export function ResourcePreview({ item, lessons, onClose, onEdit }: { item: LibraryItem; lessons: Lesson[]; onClose: () => void; onEdit?: () => void }) {
  const fileUrl = item.fileId ? `/api/courses/${item.courseId}/files/${item.fileId}/content` : "";
  const isFile = item.kind === "file" && !!item.fileId;
  return <Modal title={item.title} onClose={onClose} wide size={isFile ? "viewer" : undefined} footer={<>
    {item.kind === "link" && <a className="button secondary" href={item.content} target="_blank" rel="noopener noreferrer"><Icon name="link" size={18}/>Abrir enlace</a>}
    {onEdit && <button type="button" className="button secondary" onClick={onEdit}><Icon name="edit" size={18}/>Editar</button>}
    <button type="button" className="button primary" onClick={onClose}>Cerrar</button>
  </>}>
    {item.description && item.kind !== "file" && <p className="muted">{item.description}</p>}
    {isFile ? <FileViewer url={fileUrl} name={item.fileName || item.title} fill/>
      : item.kind === "link" ? <p className="preview-link"><Icon name="link" size={18}/><span>{item.content}</span></p>
      : <div className="preview-text">{item.content}</div>}
    <div className="usage"><h3>Uso en lecciones</h3>{lessons.length ? <ul>{lessons.map(lesson => <li key={lesson.id}><Link href={`/cursos/${lesson.courseId}/lecciones/${lesson.id}`}>{lesson.title}</Link></li>)}</ul> : <p className="muted">Aún no se usa en ninguna lección. Agrégalo como actividad “Recurso” desde el editor de lección.</p>}</div>
  </Modal>;
}

type Kind = "text" | "link" | "file";
/** Create a text/link resource or upload a document; edit text/link resources. Without a course, asks which one it belongs to. */
export function ResourceForm({ courseId: fixedCourse, courses, item, onClose, onSaved }: { courseId?: string; courses?: Course[]; item?: Material; onClose: () => void; onSaved: (text: string) => Promise<void> }) {
  const [kind, setKind] = useState<Kind>(item?.kind || "text");
  const [courseId, setCourseId] = useState(fixedCourse || item?.courseId || courses?.[0]?.id || "");
  const [taxonomy, setTaxonomy] = useState<Taxonomy>({ vocabularies: [], terms: [] }), [terms, setTerms] = useState(item?.termIds || []);
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  useEffect(() => { api<Taxonomy>("/taxonomy").then(setTaxonomy).catch(() => undefined); }, []);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget, data = new FormData(form);
    setBusy(true); setError("");
    try {
      if (kind === "file") {
        const file = data.get("file");
        if (!(file instanceof File) || !file.size) throw new Error("Elige un archivo para subir.");
        await uploadCourseFile(courseId, file, file.name);
        await onSaved(`«${file.name}» se agregó a la biblioteca del curso.`);
      } else {
        const body = { title: data.get("title"), description: data.get("description"), kind, content: data.get("content"), status: data.get("status"), termIds: terms, version: item?.version };
        await api(`/courses/${courseId}/materials${item ? `/${item.id}` : ""}`, item ? "PUT" : "POST", body);
        await onSaved(item ? "Recurso guardado. Las lecciones ya publicadas conservan la versión anterior hasta republicarlas." : "Recurso agregado a la biblioteca del curso.");
      }
    } catch (cause) { setError(message(cause)); }
    finally { setBusy(false); }
  }
  return <Modal title={item ? "Editar recurso" : "Agregar recurso"} onClose={onClose}>
    <form className="stack" onSubmit={submit}>
      {error && <p className="form-alert" role="alert"><Icon name="alert" size={18}/>{error}</p>}
      {!fixedCourse && !item && courses && <Field label="Curso" hint="El recurso vive en la biblioteca de ese curso y se puede usar en lecciones y clases de cualquier curso."><select value={courseId} onChange={event => setCourseId(event.target.value)} required>{courses.map(course => <option key={course.id} value={course.id}>{course.title}</option>)}</select></Field>}
      {!item && <fieldset className="choice-field"><legend>Tipo de recurso</legend><div className="segmented wide">
        {([["text", "Texto"], ["link", "Enlace"], ["file", "Documento"]] as const).map(([value, label]) => <label key={value}><input type="radio" name="kind" checked={kind === value} onChange={() => setKind(value)}/><span>{label}</span></label>)}
      </div></fieldset>}
      <fieldset disabled={busy} className="stack">
        {kind === "file" ? <Field label="Archivo" hint="Presentaciones, documentos y hojas (PPTX, DOCX, XLSX) hasta 15 MB; PDF hasta 25 MB; video MP4 o WebM hasta 100 MB. Es privado: solo lo reciben estudiantes dentro de una lección publicada."><input name="file" type="file" accept={fileAccept} required/></Field> : <>
          <Field label="Título"><input name="title" required maxLength={160} defaultValue={item?.title}/></Field>
          <Field label="Descripción breve"><input name="description" required maxLength={1000} defaultValue={item?.description} placeholder="Para qué sirve en clase"/></Field>
          {kind === "link"
            ? <Field label="Dirección web" hint="Empieza con https://"><input name="content" type="url" required maxLength={2000} defaultValue={item?.content} placeholder="https://"/></Field>
            : <Field label="Texto"><textarea name="content" required maxLength={8000} rows={6} defaultValue={item?.content}/></Field>}
          <TermChoices taxonomy={taxonomy} selected={terms} onChange={setTerms}/>
          <Field label="Estado" hint="“Disponible” permite usarlo en lecciones. No lo hace público: el estudiante lo ve solo dentro de una lección publicada.">
            <select name="status" defaultValue={item?.status || "published"}>{(["published", "draft", "archived"] as const).map(status => <option key={status} value={status}>{resourceStatusLabel(status)}</option>)}</select>
          </Field>
        </>}
        <div className="modal-actions"><button type="button" className="button ghost" onClick={onClose}>Cancelar</button><button className="button primary">{busy ? (kind === "file" ? "Subiendo…" : "Guardando…") : kind === "file" ? "Subir documento" : item ? "Guardar recurso" : "Agregar recurso"}</button></div>
      </fieldset>
    </form>
  </Modal>;
}
