import { useState } from "react";
import type { FormEvent } from "react";
import type { AssessmentActivity, AssessmentKind, Gradebook } from "@happy-learners/contracts";
import { assessmentKinds, assessmentTemplates, maxAssessmentActivities, planTotal, pointsInput } from "@happy-learners/domain";
import { api, message } from "../../api";
import { Modal } from "../../ui/feedback";
import { Icon } from "../../ui/icons";
import { PrimaryAction } from "../../ui/primitives";

type Row = { key: string; id?: string; title: string; kind: AssessmentKind; points: string; dueOn: string };
const decimal = (value: number) => String(value).replace(".", ",");
let counter = 0;
const fresh = (item: { title: string; kind: AssessmentKind; points: number; dueOn?: string | null }): Row => ({ key: `new-${++counter}`, title: item.title, kind: item.kind, points: decimal(item.points), dueOn: item.dueOn || "" });

/**
 * The assessment plan (plan de evaluación) of the course for one period: activities whose points add up to 100,
 * shared by every section of the course. Starts from a template or another period's plan; activities that already
 * have scores stay and keep at least the points already given.
 */
export function GradePlanDialog({ book, periodId, sectionId, onSaved, onClose }: { book: Gradebook; periodId: string; sectionId: string; onSaved: (book: Gradebook) => void; onClose: () => void }) {
  const period = book.periods.find(item => item.id === periodId)!;
  const own = book.activities.filter(item => item.periodId === periodId);
  const scored = new Set(book.scores.map(score => score.activityId));
  const [rows, setRows] = useState<Row[]>(() => own.map((item: AssessmentActivity) => ({ key: item.id, id: item.id, title: item.title, kind: item.kind, points: decimal(item.points), dueOn: item.dueOn || "" })));
  const [error, setError] = useState(""), [busy, setBusy] = useState(false);
  const others = book.periods.filter(item => item.id !== periodId && book.activities.some(activity => activity.periodId === item.id));
  const parsed = rows.map(row => pointsInput(row.points, 100));
  const total = planTotal(parsed.map(points => ({ points: typeof points === "number" ? points : 0 })));
  const invalid = rows.some((row, index) => !row.title.trim() || !parsed[index]);
  const set = (key: string, patch: Partial<Row>) => setRows(current => current.map(row => row.key === key ? { ...row, ...patch } : row));
  const move = (index: number, step: number) => setRows(current => { const next = [...current], [item] = next.splice(index, 1); next.splice(index + step, 0, item); return next; });
  // A template or another period replaces the activities without scores; the scored ones stay first.
  function start(items: { title: string; kind: AssessmentKind; points: number; dueOn?: string | null }[]) {
    setRows(current => [...current.filter(row => row.id && scored.has(row.id)), ...items.map(fresh)]);
  }
  async function save(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError("");
    try {
      const activities = rows.map((row, index) => ({ ...(row.id ? { id: row.id } : {}), title: row.title.trim(), kind: row.kind, points: parsed[index], dueOn: row.dueOn || null }));
      const result = await api<{ gradebook: Gradebook }>(`/sections/${sectionId}/grades/periods/${periodId}/plan`, "PUT", { activities });
      onSaved(result.gradebook);
    } catch (cause) { setError(message(cause)); }
    finally { setBusy(false); }
  }
  return <Modal wide title={`Plan de evaluación · ${period.name}`} onClose={onClose}>
    <form className="stack" onSubmit={save} aria-label={`Plan de evaluación de ${period.name}`}>
      <p className="muted small">El plan es del curso «{book.section.courseTitle}» y vale para todas sus secciones. La nota del periodo es la suma de los puntos que gana cada estudiante; el plan completo suma 100.</p>
      {error && <p className="form-alert" role="alert"><Icon name="alert" size={18}/>{error}</p>}
      <div className="button-row plan-start">
        <label><span className="sr-only">Empezar con una plantilla</span>
          <select value="" onChange={event => { const template = assessmentTemplates.find(item => item.id === event.target.value); if (template) start(template.activities); }}>
            <option value="">Empezar con una plantilla…</option>
            {assessmentTemplates.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}
          </select></label>
        {others.length > 0 && <label><span className="sr-only">Copiar de otro periodo</span>
          <select value="" onChange={event => start(book.activities.filter(item => item.periodId === event.target.value))}>
            <option value="">Copiar el plan de…</option>
            {others.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
          </select></label>}
      </div>
      {!rows.length ? <p className="muted">Sin actividades: el periodo se califica con una sola nota de 0 a 100. Elige una plantilla o agrega actividades.</p>
        : <table className="plan-table">
          <thead><tr><th scope="col">Actividad</th><th scope="col">Tipo</th><th scope="col">Puntos</th><th scope="col">Fecha <span className="muted">(opcional)</span></th><th scope="col"><span className="sr-only">Acciones</span></th></tr></thead>
          <tbody>{rows.map((row, index) => {
            const locked = !!row.id && scored.has(row.id);
            return <tr key={row.key}>
              <td><input value={row.title} maxLength={120} aria-label={`Nombre de la actividad ${index + 1}`} aria-invalid={!row.title.trim()} onChange={event => set(row.key, { title: event.target.value })}/></td>
              <td><select value={row.kind} aria-label={`Tipo de ${row.title || `la actividad ${index + 1}`}`} onChange={event => set(row.key, { kind: event.target.value as AssessmentKind })}>{assessmentKinds.map(kind => <option key={kind.value} value={kind.value}>{kind.label}</option>)}</select></td>
              <td><input className="plan-points" inputMode="decimal" value={row.points} aria-label={`Puntos de ${row.title || `la actividad ${index + 1}`}`} aria-invalid={!parsed[index]} onChange={event => set(row.key, { points: event.target.value })}/></td>
              <td><input type="date" value={row.dueOn} min={period.from} max={period.until} aria-label={`Fecha de ${row.title || `la actividad ${index + 1}`}`} onChange={event => set(row.key, { dueOn: event.target.value })}/></td>
              <td className="plan-actions">
                <button type="button" className="icon-button" aria-label={`Subir ${row.title}`} disabled={index === 0} onClick={() => move(index, -1)}><Icon name="back" size={16} className="rotate-up"/></button>
                <button type="button" className="icon-button" aria-label={`Bajar ${row.title}`} disabled={index === rows.length - 1} onClick={() => move(index, 1)}><Icon name="back" size={16} className="rotate-down"/></button>
                <button type="button" className="icon-button" aria-label={`Quitar ${row.title}`} disabled={locked} title={locked ? "Ya tiene punteos: se queda en el plan." : undefined} onClick={() => setRows(current => current.filter(item => item.key !== row.key))}><Icon name="close" size={16}/></button>
              </td>
            </tr>;
          })}</tbody>
        </table>}
      <div className="plan-total" role="status">
        <strong className={total === 100 ? "tone-ok" : total > 100 ? "tone-bad" : ""}>Suma {decimal(total)} de 100 puntos</strong>
        {total < 100 && rows.length > 0 && <span className="muted small"> · faltan {decimal(planTotal([{ points: 100 - total }]))} para entregar el periodo</span>}
        {total > 100 && <span className="muted small"> · quita {decimal(planTotal([{ points: total - 100 }]))}</span>}
      </div>
      <div className="button-row">
        <PrimaryAction type="submit" icon="check" busy={busy} disabled={busy || invalid || total > 100}>{busy ? "Guardando…" : "Guardar el plan"}</PrimaryAction>
        <button type="button" className="button secondary" disabled={rows.length >= maxAssessmentActivities} onClick={() => setRows(current => [...current, fresh({ title: "", kind: "task", points: Math.max(0, Math.min(100, planTotal([{ points: 100 - total }]))) || 10 })])}><Icon name="plus" size={16}/>Agregar actividad</button>
        <button type="button" className="button ghost" onClick={onClose}>Cancelar</button>
      </div>
    </form>
  </Modal>;
}
