import { useEffect, useState } from "react";
import type { AtomicMark, MyPanel, Rubric } from "@happy-learners/contracts";
import { api, message } from "../../api";
import { EmptyState, ErrorState, Loading, PageHeader, PrimaryAction } from "../../ui/primitives";

/** Each panel member records only their own mark. The combined result appears when everyone has marked. */
export function MyPanelsPage() {
  const [panels, setPanels] = useState<MyPanel[] | null>(null), [error, setError] = useState("");
  const load = () => api<{ panels: MyPanel[] }>("/me/panels").then(result => { setPanels(result.panels); setError(""); }).catch(cause => setError(message(cause)));
  useEffect(() => { void load(); }, []);
  return <>
    <PageHeader title="Mis tribunales" description="Actividades en las que formas parte del tribunal. Registras tu marca; las de las demás personas aparecen solo cuando el tribunal está completo."/>
    {error ? <ErrorState error={error} retry={() => void load()}/> : !panels ? <Loading label="Cargando tribunales…" lines={4}/> : !panels.length
      ? <EmptyState icon="team" title="No tienes tribunales asignados">Cuando un curso te incluya en un tribunal, la actividad aparecerá aquí.</EmptyState>
      : <ul className="stack">{panels.map(panel => <PanelCard key={`${panel.sectionId}:${panel.activityId}`} panel={panel} onSaved={load}/>)}</ul>}
  </>;
}

function PanelCard({ panel, onSaved }: { panel: MyPanel; onSaved: () => Promise<void> }) {
  const [drafts, setDrafts] = useState<Record<string, AtomicMark>>({}), [busy, setBusy] = useState("");
  async function save(learnerId: string) {
    const mark = drafts[learnerId] || panel.learners.find(item => item.id === learnerId)?.mark;
    if (!mark) return;
    setBusy(learnerId);
    try {
      await api(`/sections/${panel.sectionId}/grades/activities/${panel.activityId}/panel`, "PUT", { learnerId, mark });
      setDrafts(current => { const next = { ...current }; delete next[learnerId]; return next; });
      await onSaved();
    }
    finally { setBusy(""); }
  }
  return <li className="panel">
    <div className="panel-header panel-heading"><h2>{panel.title}</h2><p className="muted small">{panel.courseTitle} · {panel.sectionName} · {panel.periodName} · {panel.evaluators} personas</p></div>
    <ul className="stack">{panel.learners.map(learner => {
      const mark = drafts[learner.id] || learner.mark || { kind: "points" as const, value: 0 };
      return <li key={learner.id} className="panel lit panel-mark">
        <strong>{learner.name}</strong>
        {panel.rubric ? <RubricChoices rubric={panel.rubric} mark={mark} onChange={next => setDrafts(current => ({ ...current, [learner.id]: next }))}/> : <label className="field"><span>Tu marca</span><input className="grade-input" inputMode="decimal" aria-label={`Tu marca para ${learner.name}`} value={mark.kind === "points" ? mark.value : ""} onChange={event => setDrafts(current => ({ ...current, [learner.id]: { kind: "points", value: Number(event.target.value) } }))}/></label>}
        <p>Tribunal: <strong>{learner.combined === null ? "Pendiente" : learner.combined}</strong></p>
        <PrimaryAction type="button" className="small" busy={busy === learner.id} disabled={busy === learner.id || !drafts[learner.id]} onClick={() => void save(learner.id)}>Guardar</PrimaryAction>
      </li>;
    })}</ul>
  </li>;
}

function RubricChoices({ rubric, mark, onChange }: { rubric: Rubric; mark: AtomicMark; onChange: (mark: AtomicMark) => void }) {
  const choices = mark.kind === "rubric" ? mark.choices : {};
  return <div className="stack">{rubric.criteria.map(criterion => <label key={criterion.id} className="field"><span>{criterion.label}</span>
    <select aria-label={criterion.label} value={choices[criterion.id] || ""} onChange={event => onChange({ kind: "rubric", choices: { ...choices, [criterion.id]: event.target.value } })}>
      <option value="">Elegir nivel…</option>
      {criterion.levels.map(level => <option key={level.id} value={level.id}>{level.label} · {level.points}</option>)}
    </select>
  </label>)}</div>;
}
