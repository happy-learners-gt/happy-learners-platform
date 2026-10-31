import { useEffect, useState } from "react";
import type { AtomicMark, MyPanel, Rubric } from "@happy-learners/contracts";
import { api, message } from "../../api";
import { useSession } from "../../session";
import { Modal, useFeedback } from "../../ui/feedback";
import { Button, EmptyState, ErrorState, Field, Loading, PageHeader, PrimaryAction, StatusBadge } from "../../ui/primitives";

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
        {!learner.minute && <PrimaryAction type="button" className="small" busy={busy === learner.id} disabled={busy === learner.id || !drafts[learner.id]} onClick={() => void save(learner.id)}>Guardar</PrimaryAction>}
        {learner.combined !== null && <MinuteActions panel={panel} learner={learner} onSigned={onSaved}/>}
      </li>;
    })}</ul>
  </li>;
}

/** 1.5.1: the student's minutes, signed by every member with name and password; the chair signs last. */
function MinuteActions({ panel, learner, onSigned }: { panel: MyPanel; learner: MyPanel["learners"][number]; onSigned: () => Promise<void> }) {
  const { member } = useSession();
  const { toast } = useFeedback();
  const [signing, setSigning] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState("");
  const minute = learner.minute;
  const others = panel.evaluators - 1 - (minute ? minute.signed - (minute.mine ? 1 : 0) : 0);
  const waitsForOthers = !!panel.chair && !minute?.mine && others > 0;
  async function sign(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    setBusy(true); setError("");
    try {
      const result = await api<{ minute: { status: string } }>("/panel-minutes/sign", "POST", { activityId: panel.activityId, sectionId: panel.sectionId, learnerId: learner.id, signature: { fullName: data.get("fullName"), password: data.get("password") } });
      setSigning(false);
      toast({ message: result.minute.status === "signed" ? "Firmaste el acta. Ya la firmó todo el tribunal." : "Firmaste el acta." });
      await onSigned();
    } catch (cause) { setError(message(cause)); }
    finally { setBusy(false); }
  }
  return <div className="minute-actions">
    {minute ? <StatusBadge tone={minute.status === "signed" ? "success" : "info"}>{minute.status === "signed" ? "Acta firmada" : `Acta: ${minute.signed} de ${panel.evaluators} firmas`}</StatusBadge> : <StatusBadge tone="neutral">Acta sin firmas</StatusBadge>}
    {!minute?.mine && minute?.status !== "signed" && (waitsForOthers
      ? <span className="muted small">Presides el tribunal: firmas al final, cuando firmen los demás.</span>
      : <Button icon="edit" onClick={() => setSigning(true)}>Firmar acta<span className="sr-only"> de {learner.name}</span></Button>)}
    {minute && <a className="button ghost small" href={`/api/panel-minutes/${minute.id}.pdf`} download>Descargar acta<span className="sr-only"> de {learner.name}</span></a>}
    {signing && <Modal title={`Firmar el acta de ${learner.name}`} onClose={() => setSigning(false)}>
      <form className="stack" onSubmit={sign}>
        <p>{panel.title} · {panel.courseTitle} · {panel.sectionName}. Resultado del tribunal: <strong>{learner.combined}</strong>.</p>
        <p className="muted">Al firmar con tu nombre y tu contraseña, el acta guarda la marca de cada integrante y su huella; desde la primera firma, las calificaciones del tribunal para este estudiante quedan fijas.</p>
        <Field label="Tu nombre completo"><input name="fullName" required minLength={3} maxLength={120} defaultValue={member?.displayName || ""} autoComplete="name"/></Field>
        <Field label="Tu contraseña"><input name="password" type="password" required maxLength={128} autoComplete="current-password"/></Field>
        {error && <p className="field-error" role="alert">{error}</p>}
        <div className="modal-actions"><Button variant="ghost" onClick={() => setSigning(false)}>Cancelar</Button><button className="button primary" disabled={busy}>{busy ? "Firmando…" : "Firmar"}</button></div>
      </form>
    </Modal>}
  </div>;
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
