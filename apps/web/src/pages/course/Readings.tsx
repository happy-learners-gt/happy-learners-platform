import { useEffect, useState } from "react";
import type { LearningUnit } from "@happy-learners/contracts";
import { api, message } from "../../api";
import { Modal, useFeedback } from "../../ui/feedback";
import { Icon } from "../../ui/icons";
import { Field, Section } from "../../ui/primitives";
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

/** Lecturas of a course, or of one section (its own plus the course's). */
export function Readings({ courseId, units, sectionId, canEdit }: { courseId: string; units: LearningUnit[]; sectionId?: string; canEdit: boolean }) {
  const { toast } = useFeedback();
  const [rows, setRows] = useState<Reading[] | null>(null);
  const [resources, setResources] = useState<CourseResource[]>([]);
  const [adding, setAdding] = useState<string | null>(null);
  const active = units.filter(unit => unit.status === "active");
  async function load() {
    const [readings, listed] = await Promise.all([
      api<{ readings: Reading[] }>(sectionId ? `/sections/${sectionId}/readings` : `/courses/${courseId}/readings`),
      api<{ resources: CourseResource[] }>(`/courses/${courseId}/resources`),
    ]);
    setRows(sectionId ? readings.readings : readings.readings.filter(item => !item.groupId));
    setResources(listed.resources.filter(item => item.status !== "archived"));
  }
  useEffect(() => { void load().catch(() => setRows([])); }, [courseId, sectionId]);
  if (!active.length || !rows) return null;
  return <Section title="Lecturas">
    {active.map(unit => {
      const mine = rows.filter(item => item.unitId === unit.id);
      return <article key={unit.id} className="resource-readings">
        {/* The unit's name is not a heading: Contenido already has one per unit. */}
        <header><strong className="resource-readings-unit">{unit.name}</strong>{canEdit && <button type="button" className="button secondary small" onClick={() => setAdding(unit.id)}><Icon name="plus" size={16}/>Agregar lectura</button>}</header>
        {mine.length ? <ul>{mine.map(item => <li key={item.id}>{item.groupId && <FreedomChip mark="own"/>}<strong>{item.title}</strong>{item.chapter ? ` · ${item.chapter}` : ""}{item.pages ? ` · ${item.pages}` : ""} · {item.required ? "Obligatoria" : "Recomendada"}{item.note ? ` · ${item.note}` : ""}</li>)}</ul>
          : <p className="muted small">Sin lecturas.</p>}
      </article>;
    })}
    {adding && <AddReading courseId={courseId} unitId={adding} sectionId={sectionId} resources={resources} onClose={() => setAdding(null)} onSaved={async () => { setAdding(null); await load(); toast({ message: "Lectura agregada." }); }}/>}
  </Section>;
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
