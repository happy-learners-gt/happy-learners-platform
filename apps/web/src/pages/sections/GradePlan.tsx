import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import type { AssessmentActivity, AssessmentKind, Gradebook, GradingActivity, Rubric } from "@happy-learners/contracts";
import { assessmentKinds, assessmentTemplates, maxAssessmentActivities, planTotal, pointsInput, pointsScheme, rubricInput } from "@happy-learners/domain";
import { api, message } from "../../api";
import { Modal } from "../../ui/feedback";
import { Icon } from "../../ui/icons";
import { Field, PrimaryAction } from "../../ui/primitives";

type Person = { id: string; name: string };
type Row = {
  key: string; id?: string; title: string; kind: AssessmentKind; points: string; dueOn: string;
  categoryId: string; grading: GradingActivity["grading"]; extra: boolean; retakeOf: string;
  rubric: Rubric | null; combine: NonNullable<GradingActivity["panel"]>["combine"];
  evaluators: { userId: string; chair: boolean }[];
};
const decimal = (value: number) => String(value).replace(".", ",");
const gradings = [["points", "Puntos"], ["rubric", "Rúbrica"], ["pass-fail", "Aprobado o no"], ["level", "Nivel"], ["panel", "Tribunal"]] as const;
const combines = [["average", "Promedio"], ["median", "Mediana"], ["majority", "Mayoría"], ["chair", "Presidencia"]] as const;
let counter = 0;
const blankRubric = (): Rubric => ({ criteria: [{ id: "criterio-1", label: "Criterio", weight: 100, levels: [{ id: "alto", label: "Alto", points: 100 }, { id: "bajo", label: "Bajo", points: 0 }] }] });
const fresh = (item: { title: string; kind: AssessmentKind; points: number; dueOn?: string | null; categoryId?: string; grading?: Row["grading"]; extra?: boolean; retakeOf?: string | null; rubric?: Rubric | null; panel?: GradingActivity["panel"] }, categoryId: string): Row => ({
  key: `new-${++counter}`, title: item.title, kind: item.kind, points: decimal(item.points), dueOn: item.dueOn || "",
  categoryId: item.categoryId || categoryId, grading: item.grading || "points", extra: !!item.extra, retakeOf: item.retakeOf || "",
  rubric: item.rubric || null, combine: item.panel?.combine || "average", evaluators: [],
});

/**
 * The assessment plan (plan de evaluación) of the course for one period: activities whose points add up to 100,
 * shared by every section of the course. Starts from a template or another period's plan; activities that already
 * have scores stay and keep at least the points already given.
 */
export function GradePlanDialog({ book, periodId, sectionId, onSaved, onClose }: { book: Gradebook; periodId: string; sectionId: string; onSaved: (book: Gradebook) => void; onClose: () => void }) {
  const period = book.periods.find(item => item.id === periodId)!;
  const scheme = book.scheme || pointsScheme;
  const categoryId = scheme.categories[0]?.id || "general";
  const own = book.activities.filter(item => item.periodId === periodId);
  const scored = new Set(book.scores.map(score => score.activityId));
  const [people, setPeople] = useState<Person[]>([]);
  const [rows, setRows] = useState<Row[]>(() => own.map((item: AssessmentActivity) => ({
    key: item.id, id: item.id, title: item.title, kind: item.kind, points: decimal(item.points), dueOn: item.dueOn || "",
    categoryId: item.categoryId || categoryId, grading: item.grading || "points", extra: !!item.extra, retakeOf: item.retakeOf || "",
    rubric: item.rubric || null, combine: item.panel?.combine || "average",
    evaluators: (book.evaluators || []).filter(person => person.activityId === item.id).map(person => ({ userId: person.userId, chair: person.chair })),
  })));
  const [error, setError] = useState(""), [busy, setBusy] = useState(false);
  useEffect(() => { api<{ people?: Person[] }>("/people").then(result => setPeople(Array.isArray(result.people) ? result.people : [])).catch(() => undefined); }, []);
  const others = book.periods.filter(item => item.id !== periodId && book.activities.some(activity => activity.periodId === item.id));
  const parsed = rows.map(row => pointsInput(row.points, 100));
  const counted = rows.map((row, index) => ({ points: row.extra || row.retakeOf ? 0 : typeof parsed[index] === "number" ? parsed[index] : 0 }));
  const total = planTotal(counted);
  const pointsOnly = scheme.method === "points";
  const invalid = rows.some((row, index) => !row.title.trim() || !parsed[index] || (row.grading === "rubric" && (!row.rubric || "error" in rubricInput(row.rubric))) || (row.grading === "panel" && row.evaluators.filter(person => person.chair).length !== 1));
  const set = (key: string, patch: Partial<Row>) => setRows(current => current.map(row => row.key === key ? { ...row, ...patch } : row));
  const move = (index: number, step: number) => setRows(current => { const next = [...current], [item] = next.splice(index, 1); next.splice(index + step, 0, item); return next; });
  // A template or another period replaces the activities without scores; the scored ones stay first.
  function start(items: { title: string; kind: AssessmentKind; points: number; dueOn?: string | null }[]) {
    setRows(current => [...current.filter(row => row.id && scored.has(row.id)), ...items.map(item => fresh(item, categoryId))]);
  }
  async function save(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError("");
    try {
      const activities = rows.map((row, index) => ({
        ...(row.id ? { id: row.id } : {}), title: row.title.trim(), kind: row.kind, points: parsed[index], dueOn: row.dueOn || null,
        categoryId: row.categoryId, grading: row.grading, extra: row.extra, retakeOf: row.retakeOf || null,
        ...(row.grading === "rubric" || (row.grading === "panel" && row.rubric) ? { rubric: row.rubric } : {}),
        ...(row.grading === "panel" ? { panel: { combine: row.combine } } : {}),
      }));
      let result = await api<{ gradebook: Gradebook }>(`/sections/${sectionId}/grades/periods/${periodId}/plan`, "PUT", { activities });
      for (const row of rows.filter(item => item.grading === "panel")) {
        const activity = result.gradebook.activities.find(item => item.periodId === periodId && (item.id === row.id || item.title === row.title.trim()));
        if (activity && row.evaluators.length) result = await api<{ gradebook: Gradebook }>(`/sections/${sectionId}/grades/activities/${activity.id}/evaluators`, "PUT", { evaluators: row.evaluators });
      }
      onSaved(result.gradebook);
    } catch (cause) { setError(message(cause)); }
    finally { setBusy(false); }
  }
  return <Modal wide title={`Plan de evaluación · ${period.name}`} onClose={onClose}>
    <form className="stack" onSubmit={save} aria-label={`Plan de evaluación de ${period.name}`}>
      <p className="muted small">El plan es del curso «{book.section.courseTitle}» y vale para todas sus secciones. El esquema «{scheme.name}» decide cómo se calcula cada actividad.{pointsOnly ? " Con puntos acumulados, el plan completo suma 100." : ""}</p>
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
          <thead><tr><th scope="col">Actividad</th><th scope="col">Tipo</th><th scope="col">Puntos</th><th scope="col">Categoría</th><th scope="col">Evaluación</th><th scope="col">Fecha <span className="muted">(opcional)</span></th><th scope="col"><span className="sr-only">Acciones</span></th></tr></thead>
          <tbody>{rows.map((row, index) => {
            const locked = !!row.id && scored.has(row.id);
            const name = row.title || `la actividad ${index + 1}`;
            return <tr key={row.key}>
              <td><input value={row.title} maxLength={120} aria-label={`Nombre de la actividad ${index + 1}`} aria-invalid={!row.title.trim()} onChange={event => set(row.key, { title: event.target.value })}/></td>
              <td><select value={row.kind} aria-label={`Tipo de ${name}`} onChange={event => set(row.key, { kind: event.target.value as AssessmentKind })}>{assessmentKinds.map(kind => <option key={kind.value} value={kind.value}>{kind.label}</option>)}</select></td>
              <td><input className="plan-points" inputMode="decimal" value={row.points} aria-label={`Puntos de ${name}`} aria-invalid={!parsed[index]} onChange={event => set(row.key, { points: event.target.value })}/></td>
              <td><select value={row.categoryId} aria-label={`Categoría de ${name}`} onChange={event => set(row.key, { categoryId: event.target.value })}>{scheme.categories.map(category => <option key={category.id} value={category.id}>{category.label}</option>)}</select></td>
              <td><select value={row.grading} aria-label={`Evaluación de ${name}`} onChange={event => set(row.key, { grading: event.target.value as Row["grading"], rubric: event.target.value === "rubric" ? row.rubric || blankRubric() : row.rubric })}>{gradings.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select>
                <label className="lock"><input type="checkbox" checked={row.extra} onChange={event => set(row.key, { extra: event.target.checked })}/><span>Puntos extra</span></label>
                <select aria-label={`Reposición de ${name}`} value={row.retakeOf} onChange={event => set(row.key, { retakeOf: event.target.value })}><option value="">No es reposición</option>{rows.filter(item => item.id && item.id !== row.id).map(item => <option key={item.id} value={item.id}>Reposición de {item.title}</option>)}</select>
              </td>
              <td><input type="date" value={row.dueOn} min={period.from} max={period.until} aria-label={`Fecha de ${name}`} onChange={event => set(row.key, { dueOn: event.target.value })}/>
                {(row.grading === "rubric" || (row.grading === "panel" && row.rubric)) && row.rubric && <RubricEditor rubric={row.rubric} onChange={rubric => set(row.key, { rubric })}/>}
                {row.grading === "panel" && <PanelEditor people={people} combine={row.combine} evaluators={row.evaluators} onCombine={combine => set(row.key, { combine })} onEvaluators={evaluators => set(row.key, { evaluators })}/>}
              </td>
              <td className="plan-actions">
                <button type="button" className="icon-button" aria-label={`Subir ${row.title}`} disabled={index === 0} onClick={() => move(index, -1)}><Icon name="back" size={16} className="rotate-up"/></button>
                <button type="button" className="icon-button" aria-label={`Bajar ${row.title}`} disabled={index === rows.length - 1} onClick={() => move(index, 1)}><Icon name="back" size={16} className="rotate-down"/></button>
                <button type="button" className="icon-button" aria-label={`Quitar ${row.title}`} disabled={locked} title={locked ? "Ya tiene punteos: se queda en el plan." : undefined} onClick={() => setRows(current => current.filter(item => item.key !== row.key))}><Icon name="close" size={16}/></button>
              </td>
            </tr>;
          })}</tbody>
        </table>}
      {pointsOnly && <div className="plan-total" role="status">
        <strong className={total === 100 ? "tone-ok" : total > 100 ? "tone-bad" : ""}>Suma {decimal(total)} de 100 puntos</strong>
        {total < 100 && rows.length > 0 && <span className="muted small"> · faltan {decimal(planTotal([{ points: 100 - total }]))} para entregar el periodo</span>}
        {total > 100 && <span className="muted small"> · quita {decimal(planTotal([{ points: total - 100 }]))}</span>}
      </div>}
      <div className="button-row">
        <PrimaryAction type="submit" icon="check" busy={busy} disabled={busy || invalid || (pointsOnly && total > 100)}>{busy ? "Guardando…" : "Guardar el plan"}</PrimaryAction>
        <button type="button" className="button secondary" disabled={rows.length >= maxAssessmentActivities} onClick={() => setRows(current => [...current, fresh({ title: "", kind: "task", points: Math.max(0, Math.min(100, planTotal([{ points: 100 - total }]))) || 10 }, categoryId)])}><Icon name="plus" size={16}/>Agregar actividad</button>
        <button type="button" className="button ghost" onClick={onClose}>Cancelar</button>
      </div>
    </form>
  </Modal>;
}

function RubricEditor({ rubric, onChange }: { rubric: Rubric; onChange: (rubric: Rubric) => void }) {
  const weight = rubric.criteria.reduce((sum, criterion) => sum + criterion.weight, 0);
  const setCriterion = (index: number, patch: Partial<Rubric["criteria"][number]>) => onChange({ criteria: rubric.criteria.map((item, itemIndex) => itemIndex === index ? { ...item, ...patch } : item) });
  return <fieldset className="config-section"><legend>Rúbrica</legend>
    {rubric.criteria.map((criterion, index) => <div key={criterion.id} className="stack">
      <div className="field-grid">
        <Field label="Criterio"><input aria-label={`Criterio ${index + 1}`} value={criterion.label} onChange={event => setCriterion(index, { label: event.target.value, id: event.target.value.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || `criterio-${index + 1}` })}/></Field>
        <Field label="Peso"><input inputMode="decimal" aria-label={`Peso de ${criterion.label}`} value={criterion.weight} onChange={event => setCriterion(index, { weight: Number(event.target.value) })}/></Field>
      </div>
      {criterion.levels.map((level, levelIndex) => <div key={level.id} className="field-grid">
        <Field label="Nivel"><input aria-label={`Nivel ${levelIndex + 1} de ${criterion.label}`} value={level.label} onChange={event => setCriterion(index, { levels: criterion.levels.map((item, itemIndex) => itemIndex === levelIndex ? { ...item, label: event.target.value } : item) })}/></Field>
        <Field label="Descriptor"><input aria-label={`Descriptor de ${level.label}`} value={level.label} onChange={event => setCriterion(index, { levels: criterion.levels.map((item, itemIndex) => itemIndex === levelIndex ? { ...item, label: event.target.value } : item) })}/></Field>
        <Field label="Puntos del nivel"><input inputMode="decimal" aria-label={`Puntos de ${level.label} en ${criterion.label}`} value={level.points} onChange={event => setCriterion(index, { levels: criterion.levels.map((item, itemIndex) => itemIndex === levelIndex ? { ...item, points: Number(event.target.value) } : item) })}/></Field>
      </div>)}
    </div>)}
    <p className={weight === 100 ? "muted small" : "form-alert"} role="status">Los pesos suman {weight}. Deben sumar 100.</p>
  </fieldset>;
}

function PanelEditor({ people, combine, evaluators, onCombine, onEvaluators }: { people: Person[]; combine: Row["combine"]; evaluators: Row["evaluators"]; onCombine: (combine: Row["combine"]) => void; onEvaluators: (evaluators: Row["evaluators"]) => void }) {
  function toggle(userId: string, on: boolean) {
    const next = on ? [...evaluators, { userId, chair: evaluators.length === 0 }] : evaluators.filter(item => item.userId !== userId);
    if (next.length && !next.some(item => item.chair)) next[0] = { ...next[0], chair: true };
    onEvaluators(next);
  }
  return <fieldset className="config-section"><legend>Tribunal</legend>
    <Field label="Cómo se combinan"><select aria-label="Cómo se combinan las marcas" value={combine} onChange={event => onCombine(event.target.value as Row["combine"])}>{combines.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></Field>
    <ul className="stack">{people.map(person => {
      const chosen = evaluators.find(item => item.userId === person.id);
      return <li key={person.id} className="choice-row"><label className="chip"><input type="checkbox" checked={!!chosen} onChange={event => toggle(person.id, event.target.checked)}/><span>{person.name}</span></label>{chosen && <label className="lock"><input type="radio" name={`chair-${person.id}`} checked={chosen.chair} onChange={() => onEvaluators(evaluators.map(item => ({ ...item, chair: item.userId === person.id })))}/><span>Presidencia</span></label>}</li>;
    })}</ul>
    {evaluators.filter(item => item.chair).length !== 1 && <p className="form-alert" role="alert">Elige integrantes y exactamente una presidencia.</p>}
  </fieldset>;
}
