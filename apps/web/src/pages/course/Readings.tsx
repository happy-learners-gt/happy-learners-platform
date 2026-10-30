import { useEffect, useState } from "react";
import type { LearningUnit } from "@happy-learners/contracts";
import { api, message } from "../../api";
import { Modal, useFeedback } from "../../ui/feedback";
import { Icon } from "../../ui/icons";
import { Field } from "../../ui/primitives";
import { FreedomChip } from "../../ui/freedom";
import type { CourseResource } from "./course-resource";

type Reading = { id: string; unitId: string; unitName: string; groupId: string | null; resourceId: string; title: string; chapter: string | null; pages: string; required: boolean; note: string; own?: boolean };

/** On a section's Resumen or Avance: how many required readings the students marked. */
export function ReadingProgress({ sectionId }: { sectionId: string }) {
  const [data, setData] = useState<{ progress: { percent: number | null }; readings: { id: string; title: string; required: boolean }[]; learners: { id: string; name: string; read: string[] }[] } | null>(null);
  useEffect(() => { api<NonNullable<typeof data>>(`/sections/${sectionId}/readings`).then(setData).catch(() => setData(null)); }, [sectionId]);
  const required = data?.readings.filter(item => item.required) || [];
  if (!data || !required.length || data.progress.percent === null) return null;
  return <section className="resource-reading-progress"><h3>Lecturas obligatorias: {data.progress.percent}% leídas</h3>
    <ul>{data.learners.map(learner => <li key={learner.id}>{learner.name}: {required.filter(item => learner.read.includes(item.id)).length} de {required.length}</li>)}</ul>
  </section>;
}

/** The readings of a course, or of one section (its own plus the course's), with the resources a reading can use. */
export function useReadings(courseId: string, sectionId?: string) {
  const [rows, setRows] = useState<Reading[] | null>(null);
  const [resources, setResources] = useState<CourseResource[]>([]);
  async function load() {
    const [readings, listed] = await Promise.all([
      api<{ readings: Reading[] }>(sectionId ? `/sections/${sectionId}/readings` : `/courses/${courseId}/readings`),
      api<{ resources: CourseResource[] }>(`/courses/${courseId}/resources`),
    ]);
    setRows(sectionId ? readings.readings : readings.readings.filter(item => !item.groupId));
    setResources(listed.resources.filter(item => item.status !== "archived"));
  }
  useEffect(() => { void load().catch(() => setRows([])); }, [courseId, sectionId]);
  return { rows, resources, reload: load, courseId, sectionId };
}
export type ReadingsData = ReturnType<typeof useReadings>;

/** A unit's readings, inside its card in Contenido or in the section's plan (docs/design/recursos-didacticos.md §4). */
export function UnitReadings({ unit, data, canEdit }: { unit: LearningUnit; data: ReadingsData; canEdit: boolean }) {
  const { toast } = useFeedback();
  const [adding, setAdding] = useState(false);
  if (!data.rows || unit.status !== "active") return null;
  const mine = data.rows.filter(item => item.unitId === unit.id);
  if (!mine.length && !canEdit) return null;
  return <section className="resource-readings" aria-labelledby={`lecturas-${unit.id}`}>
    <header>
      <h3 id={`lecturas-${unit.id}`}>Lecturas<span className="sr-only"> de {unit.name}</span></h3>
      {canEdit && <button type="button" className="button ghost small" onClick={() => setAdding(true)}><Icon name="plus" size={16}/>Agregar lectura<span className="sr-only"> en {unit.name}</span></button>}
    </header>
    {mine.length ? <ul>{mine.map(item => <li key={item.id}>{item.groupId && <FreedomChip mark="own"/>}<strong>{item.title}</strong>{item.chapter ? ` · ${item.chapter}` : ""}{item.pages ? ` · ${item.pages}` : ""} · {item.required ? "Obligatoria" : "Recomendada"}{item.note ? ` · ${item.note}` : ""}</li>)}</ul>
      : <p className="muted small">Sin lecturas.</p>}
    {adding && <AddReading courseId={data.courseId} unitId={unit.id} sectionId={data.sectionId} resources={data.resources} onClose={() => setAdding(false)} onSaved={async () => { setAdding(false); await data.reload(); toast({ message: "Lectura agregada." }); }}/>}
  </section>;
}

function AddReading({ courseId, unitId, sectionId, resources, onClose, onSaved }: { courseId: string; unitId: string; sectionId?: string; resources: CourseResource[]; onClose: () => void; onSaved: () => Promise<void> }) {
  const { toast } = useFeedback();
  const [busy, setBusy] = useState(false);
  return <Modal title="Agregar lectura" onClose={onClose}>
    <form className="stack" onSubmit={event => {
      event.preventDefault();
      const data = new FormData(event.currentTarget);
      setBusy(true);
      void api(`/courses/${courseId}/readings`, "POST", { unitId, resourceId: data.get("resourceId"), pages: data.get("pages"), required: data.get("required") === "on", note: data.get("note"), ...(sectionId ? { groupId: sectionId } : {}) })
        .then(() => onSaved()).catch(cause => { toast({ tone: "error", message: message(cause) }); setBusy(false); });
    }}>
      <Field label="Recurso"><select name="resourceId" required><option value="">Elige un recurso</option>{resources.map(item => <option key={item.id} value={item.id}>{item.title}</option>)}</select></Field>
      <Field label="Capítulo o páginas" optional><input name="pages" maxLength={80} placeholder="Cap. 3, págs. 41–58"/></Field>
      <label className="switch"><input type="checkbox" name="required" defaultChecked/><span>Obligatoria</span></label>
      <Field label="Nota" optional><input name="note" maxLength={300}/></Field>
      <div className="modal-actions"><button type="button" className="button ghost" onClick={onClose}>Cancelar</button><button className="button primary" disabled={busy}>{busy ? "Guardando…" : "Agregar lectura"}</button></div>
    </form>
  </Modal>;
}
