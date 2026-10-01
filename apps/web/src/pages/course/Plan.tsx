import { useState } from "react";
import type { FormEvent } from "react";
import type { CognitiveLevel, Competency, LearningOutcome, Lesson } from "@happy-learners/contracts";
import { assesses, activityOutcomes, cognitiveLevels, coverage, defaultSequence, lessonOutcomes } from "@happy-learners/domain";
import type { OutcomeCoverage } from "@happy-learners/domain";
import { api, message } from "../../api";
import { Link, useNavigation } from "../../navigation";
import { plural } from "../../model";
import { Modal, useFeedback } from "../../ui/feedback";
import { Icon } from "../../ui/icons";
import { Menu } from "../../ui/Menu";
import { Button, EmptyState, Field, PageHeader, PrimaryAction, Section, StatTiles, StatusBadge } from "../../ui/primitives";
import { useCourse } from "./context";

const levelLabel = Object.fromEntries(cognitiveLevels.map(level => [level.value, level.label])) as Record<CognitiveLevel, string>;
type Editing = { kind: "competency"; item?: Competency } | { kind: "outcome"; item?: LearningOutcome; competencyId?: string };

/**
 * The course plan: competencies, the learning outcomes that evidence them, and a coverage map showing where
 * each outcome is planned (units), worked on (lessons) and checked (assessing activities), with what is missing.
 */
export function Plan() {
  const { course, units, lessons, curriculum, writable, reload } = useCourse();
  const { toast, confirm } = useFeedback();
  const { navigate } = useNavigation();
  const [editing, setEditing] = useState<Editing | null>(null), [creating, setCreating] = useState<OutcomeCoverage | null>(null), [showArchived, setShowArchived] = useState(false);
  const base = `/cursos/${course.id}`;
  const map = coverage(curriculum, units, lessons);
  const codeOf = new Map(map.outcomes.map(item => [item.outcome.id, item.code]));
  const coverageOf = new Map(map.outcomes.map(item => [item.outcome.id, item]));
  const ordered = [...curriculum.outcomes].sort((a, b) => a.position - b.position);
  const visible = (status: string) => showArchived || status === "active";
  const archived = curriculum.outcomes.filter(o => o.status === "archived").length + curriculum.competencies.filter(c => c.status === "archived").length;

  async function run(work: () => Promise<unknown>, success: string) {
    try { await work(); await reload(); toast({ message: success }); return true; }
    catch (error) { toast({ tone: "error", message: `${message(error)} Vuelve a intentar.` }); await reload(); return false; }
  }
  const saveOutcome = (outcome: LearningOutcome, patch: Partial<LearningOutcome>) => api(`/courses/${course.id}/outcomes/${outcome.id}`, "PUT", { statement: outcome.statement, level: outcome.level, evidence: outcome.evidence, competencyId: outcome.competencyId || null, status: outcome.status, ...patch, version: course.version });
  async function archiveOutcome(outcome: LearningOutcome) {
    const archiving = outcome.status === "active";
    if (archiving && !await confirm({ title: `¿Archivar ${codeOf.get(outcome.id)}?`, body: <p>Deja de contarse en la cobertura y no se puede elegir en lecciones nuevas. Las lecciones que ya lo trabajan lo conservan.</p>, confirm: "Archivar resultado", danger: true })) return;
    await run(() => saveOutcome(outcome, { status: archiving ? "archived" : "active" }), archiving ? "Resultado archivado." : "Resultado restaurado.");
  }
  async function archiveCompetency(competency: Competency) {
    const archiving = competency.status === "active";
    if (archiving && !await confirm({ title: `¿Archivar «${competency.name}»?`, body: <p>Sus resultados de aprendizaje siguen activos; puedes moverlos a otra competencia.</p>, confirm: "Archivar competencia", danger: true })) return;
    await run(() => api(`/courses/${course.id}/competencies/${competency.id}`, "PUT", { name: competency.name, description: competency.description, status: archiving ? "archived" : "active", version: course.version }), archiving ? "Competencia archivada." : "Competencia restaurada.");
  }
  async function moveOutcome(outcome: LearningOutcome, delta: number) {
    const ids = ordered.map(o => o.id), index = ids.indexOf(outcome.id);
    [ids[index], ids[index + delta]] = [ids[index + delta], ids[index]];
    await run(() => api(`/courses/${course.id}/outcomes/order`, "PUT", { ids, version: course.version }), "Orden actualizado. Los códigos siguen el nuevo orden.");
  }
  async function togglePlan(unitId: string, outcomeId: string) {
    const planned = curriculum.unitOutcomes.filter(link => link.unitId === unitId).map(link => link.outcomeId);
    const next = planned.includes(outcomeId) ? planned.filter(id => id !== outcomeId) : [...planned, outcomeId];
    const unit = units.find(item => item.id === unitId)!;
    await run(() => api(`/courses/${course.id}/units/${unitId}/outcomes`, "PUT", { outcomeIds: next, version: course.version }), `${codeOf.get(outcomeId)} ${next.includes(outcomeId) ? "planificado en" : "ya no se planifica en"} ${unit.name}.`);
  }

  const outcomeRow = (outcome: LearningOutcome, index: number) => {
    const item = coverageOf.get(outcome.id);
    return <li key={outcome.id} className={`outcome-row${outcome.status === "archived" ? " is-archived" : ""}`}>
      <span className="outcome-code" aria-hidden="true">{item?.code || "—"}</span>
      <div className="outcome-text">
        <strong><span className="sr-only">{item ? `${item.code}: ` : "Archivado: "}</span>{outcome.statement}</strong>
        <span className="muted small">{levelLabel[outcome.level]}{outcome.evidence ? ` · Evidencia: ${outcome.evidence}` : ""}</span>
      </div>
      {item ? <CoverageBadge item={item}/> : <StatusBadge>Archivado</StatusBadge>}
      {writable && <Menu label={`Acciones de ${item?.code || "resultado archivado"}`} items={[
        { label: "Editar", icon: "edit", onSelect: () => setEditing({ kind: "outcome", item: outcome }) },
        { label: "Subir", icon: "up", disabled: index === 0, onSelect: () => void moveOutcome(outcome, -1) },
        { label: "Bajar", icon: "down", disabled: index === ordered.length - 1, onSelect: () => void moveOutcome(outcome, 1) },
        "separator",
        { label: outcome.status === "active" ? "Archivar" : "Restaurar", icon: "archive", danger: outcome.status === "active", onSelect: () => void archiveOutcome(outcome) },
      ]}/>}
    </li>;
  };
  const groups = [
    ...curriculum.competencies.filter(c => visible(c.status)).map(competency => ({ competency, outcomes: ordered.filter(o => o.competencyId === competency.id && visible(o.status)) })),
    { competency: null, outcomes: ordered.filter(o => (!o.competencyId || !curriculum.competencies.some(c => c.id === o.competencyId && visible(c.status))) && visible(o.status)) },
  ].filter(group => group.competency || group.outcomes.length);
  const activeUnits = map.units;

  return <>
    <PageHeader crumbs={[{ label: "Cursos", href: "/cursos" }, { label: course.title, href: base }, { label: "Plan curricular" }]} title="Plan curricular"
      description="Qué desarrolla el curso, qué podrán demostrar los estudiantes y dónde se trabaja y evalúa cada resultado."
      actions={writable && <Button icon="plus" onClick={() => setEditing({ kind: "competency" })}>Nueva competencia</Button>}
      primary={writable ? <PrimaryAction icon="plus" onClick={() => setEditing({ kind: "outcome" })}>Nuevo resultado</PrimaryAction> : undefined}/>
    {map.summary.total > 0 && <StatTiles className="plan-stats" items={[
      { label: "Resultados", value: map.summary.total, icon: "spark", hue: "violet" },
      { label: "Trabajados en lecciones", value: map.summary.taught, icon: "content", hue: "sky" },
      { label: "Evaluados", value: map.summary.assessed, icon: "check", hue: "green" },
      { label: "Resultados con huecos", value: map.summary.gaps, icon: "alert", hue: "coral" },
    ]}/>}
    {!curriculum.outcomes.length && !curriculum.competencies.length ? <EmptyState icon="spark" title="Define lo que aprenderán"
      action={writable && <div className="plan-empty-actions"><Button icon="plus" onClick={() => setEditing({ kind: "competency" })}>Nueva competencia</Button><PrimaryAction icon="plus" onClick={() => setEditing({ kind: "outcome" })}>Nuevo resultado</PrimaryAction></div>}>
      Escribe los resultados de aprendizaje del curso: lo que cada estudiante podrá demostrar al terminar. Después planifícalos en las unidades y alinea cada lección; el mapa de cobertura te mostrará qué falta.
    </EmptyState> : <>
      <Section title="Competencias y resultados de aprendizaje" action={archived > 0 && <label className="switch"><input type="checkbox" checked={showArchived} onChange={event => setShowArchived(event.target.checked)}/><span>Mostrar archivados ({archived})</span></label>}>
        <div className="competency-list">{groups.map(({ competency, outcomes }) => <article key={competency?.id || "none"} className={`competency-card${competency?.status === "archived" ? " is-archived" : ""}`} aria-labelledby={`competency-${competency?.id || "none"}`}>
          <header className="competency-head">
            <div><h3 id={`competency-${competency?.id || "none"}`}>{competency ? competency.name : "Sin competencia"}{competency?.status === "archived" && <span className="muted"> · archivada</span>}</h3>
              {competency?.description && <p className="muted">{competency.description}</p>}</div>
            {writable && competency && <Menu label={`Acciones de la competencia ${competency.name}`} items={[
              { label: "Agregar resultado", icon: "plus", disabled: competency.status !== "active", onSelect: () => setEditing({ kind: "outcome", competencyId: competency.id }) },
              { label: "Editar", icon: "edit", onSelect: () => setEditing({ kind: "competency", item: competency }) },
              "separator",
              { label: competency.status === "active" ? "Archivar" : "Restaurar", icon: "archive", danger: competency.status === "active", onSelect: () => void archiveCompetency(competency) },
            ]}/>}
          </header>
          {outcomes.length ? <ol className="outcome-list">{outcomes.map(outcome => outcomeRow(outcome, ordered.indexOf(outcome)))}</ol>
            : <p className="muted small">Sin resultados todavía.{writable && competency?.status === "active" && <> <button type="button" className="link-button" onClick={() => setEditing({ kind: "outcome", competencyId: competency.id })}>Agregar resultado</button></>}</p>}
        </article>)}</div>
      </Section>
      {map.outcomes.length > 0 && <Section title="Mapa de cobertura">
        <p className="muted">Cada fila es un resultado y cada columna una unidad. {writable ? "Marca en qué unidades se planifica; " : ""}las lecciones alineadas cuentan como trabajado y las preguntas o actividades de evaluación como evaluado.</p>
        {activeUnits.length ? <div className="coverage-scroll" role="region" aria-label="Mapa de cobertura" tabIndex={0}>
          <table className="coverage-table">
            <thead><tr><th scope="col">Resultado</th>{activeUnits.map(({ unit }) => <th key={unit.id} scope="col">{unit.name}</th>)}<th scope="col">Estado</th></tr></thead>
            <tbody>{map.outcomes.map(item => <tr key={item.outcome.id}>
              <th scope="row"><div className="row-outcome"><span className="outcome-code" aria-hidden="true">{item.code}</span><span><span className="sr-only">{item.code}: </span>{item.outcome.statement}</span></div></th>
              {activeUnits.map(({ unit }) => <td key={unit.id}><Cell item={item} unitId={unit.id} unitName={unit.name} lessons={lessons} writable={writable} onToggle={() => void togglePlan(unit.id, item.outcome.id)}/></td>)}
              <td><GapAction item={item} lessons={lessons} base={base} writable={writable} onCreate={() => setCreating(item)}/></td>
            </tr>)}</tbody>
            {activeUnits.some(item => item.missing.length) && <tfoot><tr><th scope="row">Pendiente en la unidad</th>{activeUnits.map(item => <td key={item.unit.id}>{item.missing.length ? <span className="gap-text"><Icon name="alert" size={14}/>Falta trabajar {item.missing.map(id => codeOf.get(id)).join(", ")}</span> : <span className="muted small">Al día</span>}</td>)}<td/></tr></tfoot>}
          </table>
        </div> : <EmptyState compact icon="content" title="Sin unidades" action={writable && <Link className="button secondary small" href={`${base}/contenido?crear=unidad`}>Crear unidad</Link>}>Crea unidades en el contenido para planificar dónde se trabaja cada resultado.</EmptyState>}
      </Section>}
    </>}
    {editing?.kind === "competency" && <CompetencyDialog item={editing.item} onClose={() => setEditing(null)} onSave={async data => {
      const ok = await run(() => api(`/courses/${course.id}/competencies${editing.item ? `/${editing.item.id}` : ""}`, editing.item ? "PUT" : "POST", { ...data, status: editing.item?.status || "active", version: course.version }), editing.item ? "Competencia actualizada." : "Competencia creada. Agrégale resultados de aprendizaje.");
      if (ok) setEditing(null);
    }}/>}
    {editing?.kind === "outcome" && <OutcomeDialog item={editing.item} competencyId={editing.competencyId} competencies={curriculum.competencies} onClose={() => setEditing(null)} onSave={async data => {
      const ok = await run(() => api(`/courses/${course.id}/outcomes${editing.item ? `/${editing.item.id}` : ""}`, editing.item ? "PUT" : "POST", { ...data, status: editing.item?.status || "active", version: course.version }), editing.item ? "Resultado actualizado. Las lecciones publicadas muestran el texto anterior hasta que vuelvas a publicarlas." : "Resultado creado. Planifícalo en una unidad del mapa de cobertura.");
      if (ok) setEditing(null);
    }}/>}
    {creating && <CreateLessonDialog item={creating} onClose={() => setCreating(null)} onCreate={async (title, objective, unitId) => {
      try {
        const { lesson } = await api<{ lesson: Lesson }>("/lessons", "POST", { title, objective, courseId: course.id, courseUnitId: unitId, duration: 20, instructions: "", sequence: defaultSequence[course.profile], outcomeIds: [creating.outcome.id] });
        await reload();
        toast({ message: `Lección creada y alineada a ${creating.code}. Agrega sus actividades.` });
        navigate(`${base}/lecciones/${lesson.id}`);
      } catch (error) { toast({ tone: "error", message: `${message(error)} Revisa el título y el objetivo.` }); }
    }}/>}
  </>;
}

function CoverageBadge({ item }: { item: OutcomeCoverage }) {
  const gap = item.gaps[0];
  if (gap === "no-unit") return <StatusBadge tone="warning">Sin planificar</StatusBadge>;
  if (gap === "no-lesson") return <StatusBadge tone="warning">Sin lecciones</StatusBadge>;
  if (gap === "no-assessment") return <StatusBadge tone="info">Sin evaluación</StatusBadge>;
  return <StatusBadge tone="success">Trabajado y evaluado</StatusBadge>;
}

function Cell({ item, unitId, unitName, lessons, writable, onToggle }: { item: OutcomeCoverage; unitId: string; unitName: string; lessons: Lesson[]; writable: boolean; onToggle: () => void }) {
  const planned = item.units.includes(unitId);
  const here = lessons.filter(lesson => lesson.courseUnitId === unitId && lesson.status !== "archived" && lessonOutcomes(lesson).includes(item.outcome.id));
  const assessed = here.some(lesson => lesson.activities.some(activity => assesses(activity) && activityOutcomes(activity, lesson).includes(item.outcome.id)));
  const state = <>
    {here.length > 0 && <span className="cell-taught"><Icon name="content" size={14}/>{plural(here.length, "lección", "lecciones")}</span>}
    {assessed && <span className="cell-assessed"><Icon name="check" size={14}/>Evaluado</span>}
  </>;
  return <div className={`coverage-cell${planned ? " is-planned" : ""}${here.length ? " is-taught" : ""}`}>
    {writable ? <button type="button" className="cell-plan" aria-pressed={planned} aria-label={`Planificar ${item.code} en ${unitName}`} onClick={onToggle}><Icon name={planned ? "check" : "plus"} size={14}/>{planned ? "Planificado" : "Planificar"}</button>
      : planned && <span className="cell-plan is-static">Planificado</span>}
    {state}
  </div>;
}

function GapAction({ item, lessons, base, writable, onCreate }: { item: OutcomeCoverage; lessons: Lesson[]; base: string; writable: boolean; onCreate: () => void }) {
  const gap = item.gaps.includes("no-lesson") ? "no-lesson" : item.gaps[0];
  if (gap === "no-lesson") return <div className="gap-action"><span className="gap-text"><Icon name="alert" size={14}/>{item.units.length ? "Ninguna lección lo trabaja" : "Sin unidad ni lecciones"}</span>{writable && <button type="button" className="button secondary small" onClick={onCreate}><Icon name="plus" size={16}/>Crear lección</button>}</div>;
  if (gap === "no-assessment") {
    const lesson = lessons.find(item2 => item2.id === item.lessons[0]);
    return <div className="gap-action"><span className="gap-text"><Icon name="info" size={14}/>Se trabaja pero no se comprueba</span>{writable && lesson && <Link className="button secondary small" href={`${base}/lecciones/${lesson.id}`}>Agregar evaluación en «{lesson.title}»</Link>}</div>;
  }
  return <span className="gap-ok"><Icon name="check" size={14}/>{item.published ? "Cubierto" : "Cubierto en borrador"}</span>;
}

function CompetencyDialog({ item, onClose, onSave }: { item?: Competency; onClose: () => void; onSave: (data: { name: string; description: string }) => Promise<void> }) {
  const [busy, setBusy] = useState(false);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true);
    const form = new FormData(event.currentTarget);
    await onSave({ name: String(form.get("name")), description: String(form.get("description")) });
    setBusy(false);
  }
  return <Modal title={item ? "Editar competencia" : "Nueva competencia"} onClose={onClose}>
    <form className="stack" onSubmit={submit}><fieldset className="stack" disabled={busy}>
      <Field label="Nombre" hint="Una capacidad amplia que el curso desarrolla. Por ejemplo: Comunicación oral, Pensamiento científico."><input name="name" required maxLength={120} defaultValue={item?.name}/></Field>
      <Field label="Descripción" optional><textarea name="description" rows={3} maxLength={600} defaultValue={item?.description}/></Field>
      <div className="modal-actions"><button type="button" className="button ghost" onClick={onClose}>Cancelar</button><button className="button primary">{busy ? "Guardando…" : "Guardar"}</button></div>
    </fieldset></form>
  </Modal>;
}

function OutcomeDialog({ item, competencyId, competencies, onClose, onSave }: { item?: LearningOutcome; competencyId?: string; competencies: Competency[]; onClose: () => void; onSave: (data: { statement: string; level: CognitiveLevel; evidence: string; competencyId: string | null }) => Promise<void> }) {
  const [busy, setBusy] = useState(false), [level, setLevel] = useState<CognitiveLevel>(item?.level || "apply");
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true);
    const form = new FormData(event.currentTarget);
    await onSave({ statement: String(form.get("statement")), level, evidence: String(form.get("evidence")), competencyId: String(form.get("competencyId")) || null });
    setBusy(false);
  }
  const options = competencies.filter(c => c.status === "active" || c.id === item?.competencyId);
  return <Modal title={item ? "Editar resultado de aprendizaje" : "Nuevo resultado de aprendizaje"} onClose={onClose}>
    <form className="stack" onSubmit={submit}><fieldset className="stack" disabled={busy}>
      <Field label="Resultado de aprendizaje" hint={`Lo que el estudiante podrá demostrar. Empieza con un verbo observable; para «${levelLabel[level]}»: ${cognitiveLevels.find(l => l.value === level)!.verbs}.`}><textarea name="statement" rows={3} required maxLength={400} defaultValue={item?.statement}/></Field>
      <div className="field-row">
        <Field label="Nivel de pensamiento"><select value={level} onChange={event => setLevel(event.target.value as CognitiveLevel)}>{cognitiveLevels.map(l => <option key={l.value} value={l.value}>{l.label}</option>)}</select></Field>
        <Field label="Competencia" optional><select name="competencyId" defaultValue={item?.competencyId || competencyId || ""}><option value="">Sin competencia</option>{options.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select></Field>
      </div>
      <Field label="Evidencia" optional hint="Qué hará el estudiante para demostrarlo."><textarea name="evidence" rows={2} maxLength={400} defaultValue={item?.evidence}/></Field>
      <div className="modal-actions"><button type="button" className="button ghost" onClick={onClose}>Cancelar</button><button className="button primary">{busy ? "Guardando…" : "Guardar"}</button></div>
    </fieldset></form>
  </Modal>;
}

function CreateLessonDialog({ item, onClose, onCreate }: { item: OutcomeCoverage; onClose: () => void; onCreate: (title: string, objective: string, unitId: string) => Promise<void> }) {
  const { units } = useCourse();
  const [busy, setBusy] = useState(false);
  const active = units.filter(unit => unit.status === "active").sort((a, b) => Number(!item.units.includes(a.id)) - Number(!item.units.includes(b.id)) || a.position - b.position);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true);
    const form = new FormData(event.currentTarget);
    await onCreate(String(form.get("title")), String(form.get("objective")), String(form.get("unitId")));
    setBusy(false);
  }
  return <Modal title={`Nueva lección para ${item.code}`} onClose={onClose}>
    <form className="stack" onSubmit={submit}><fieldset className="stack" disabled={busy}>
      <p className="muted">La lección se crea como borrador alineada a «{item.outcome.statement}».</p>
      <Field label="Título de la lección"><input name="title" required maxLength={160}/></Field>
      <Field label="Objetivo" hint="Qué podrán hacer al terminar esta lección."><textarea name="objective" rows={2} required maxLength={1000} defaultValue={item.outcome.statement}/></Field>
      <Field label="Unidad" hint={item.units.length ? "Primero, las unidades donde está planificado." : undefined}><select name="unitId" required>{active.map(unit => <option key={unit.id} value={unit.id}>{unit.name}{item.units.includes(unit.id) ? " (planificado)" : ""}</option>)}</select></Field>
      <div className="modal-actions"><button type="button" className="button ghost" onClick={onClose}>Cancelar</button><button className="button primary">{busy ? "Creando…" : "Crear y editar"}</button></div>
    </fieldset></form>
  </Modal>;
}
