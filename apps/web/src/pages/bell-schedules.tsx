import { useCallback, useEffect, useState } from "react";
import type { FormEvent } from "react";
import type { BellSchedule } from "@happy-learners/contracts";
import { bellBlocks, bellScheduleInput, bellTemplates, daysText, maxBellPeriods, weekdays } from "@happy-learners/domain";
import type { BellConfig } from "@happy-learners/domain";
import { api, message } from "../api";
import { Modal, useFeedback } from "../ui/feedback";
import { Icon } from "../ui/icons";
import { Menu } from "../ui/Menu";
import { ErrorState, Field, Loading, PrimaryAction, Section } from "../ui/primitives";

/** The organization's jornadas, for whoever needs their blocks (the section schedule editor too). */
export function useBellSchedules(enabled = true) {
  const [schedules, setSchedules] = useState<BellSchedule[] | null>(null), [error, setError] = useState("");
  const load = useCallback(() => api<{ schedules: BellSchedule[] }>("/bell-schedules").then(result => { setSchedules(result.schedules); setError(""); }, cause => setError(message(cause))), []);
  useEffect(() => { if (enabled) void load(); }, [load, enabled]);
  return { schedules, error, load, setSchedules };
}

/** The blocks of a day as a timeline: class periods and breaks with their times. */
export function BellTimeline({ blocks, label }: { blocks: BellSchedule["blocks"]; label: string }) {
  return <ol className="jornada-timeline" aria-label={label}>{blocks.map(block => <li key={block.key} className={`jornada-block is-${block.kind}`}>
    <span className="jornada-time">{block.startsAt}–{block.endsAt}</span><span>{block.label}</span>
  </li>)}</ol>;
}

/**
 * Jornadas (bell schedules): the class periods and breaks of a school day, generated from the entry time, the length of
 * each period, the passing time and the breaks. Sections take the times of their classes from these blocks.
 */
export function BellSchedules() {
  const { toast, confirm } = useFeedback();
  const { schedules, error, load, setSchedules } = useBellSchedules();
  const [editing, setEditing] = useState<BellSchedule | "new" | null>(null);
  async function remove(item: BellSchedule) {
    if (!await confirm({ title: `¿Quitar «${item.name}»?`, body: <p>Los horarios de las secciones conservan sus horas; solo deja de ofrecerse esta jornada.</p>, confirm: "Quitar jornada", danger: true })) return;
    try { setSchedules((await api<{ schedules: BellSchedule[] }>(`/bell-schedules/${item.id}`, "DELETE")).schedules); toast({ message: `«${item.name}» se quitó.` }); }
    catch (cause) { toast({ tone: "error", message: message(cause) }); }
  }
  return <Section title="Jornadas y periodos de clase" className="jornada-panel" action={<button type="button" className="button secondary small" onClick={() => setEditing("new")}><Icon name="plus" size={16}/>Nueva jornada</button>}>
    <p className="muted small">La hora de entrada, la duración de cada periodo, el tiempo entre periodos y los recesos. Al configurar el horario de una sección eliges sus periodos de la jornada.</p>
    {error ? <ErrorState error={error} retry={() => void load()}/> : !schedules ? <Loading label="Cargando jornadas…" lines={2}/>
      : !schedules.length ? <p className="muted small">Todavía no hay jornadas. Crea la primera, por ejemplo la matutina de 7:30 con periodos de 40 minutos.</p>
      : <ul className="jornada-list">{schedules.map(item => <li key={item.id}>
        <div className="academic-year-head">
          <Icon name="clock" size={18}/>
          <div><strong>{item.name}</strong><span className="muted small">{daysText(item.weekdays)} · {item.config.periods} periodos de {item.config.periodMinutes} min · {item.config.passingMinutes} min entre periodos · {item.blocks[0].startsAt} a {item.blocks[item.blocks.length - 1].endsAt}</span></div>
          <Menu label={`Acciones de ${item.name}`} items={[{ label: "Editar", icon: "edit", onSelect: () => setEditing(item) }, "separator", { label: "Quitar", danger: true, onSelect: () => void remove(item) }]}/>
        </div>
        <BellTimeline blocks={item.blocks} label={`Periodos de ${item.name}`}/>
      </li>)}</ul>}
    {editing && <BellDialog schedule={editing === "new" ? null : editing} onClose={() => setEditing(null)} onSaved={list => { setSchedules(list); setEditing(null); toast({ message: "Jornada guardada." }); }}/>}
  </Section>;
}

type Draft = { name: string; weekdays: number[]; startsAt: string; periodMinutes: string; passingMinutes: string; periods: string; breaks: { after: string; minutes: string; label: string }[] };
const toDraft = (item: { name: string; weekdays: number[]; config: BellConfig }): Draft => ({
  name: item.name, weekdays: item.weekdays, startsAt: item.config.startsAt, periodMinutes: String(item.config.periodMinutes), passingMinutes: String(item.config.passingMinutes), periods: String(item.config.periods),
  breaks: item.config.breaks.map(pause => ({ after: String(pause.after), minutes: String(pause.minutes), label: pause.label })),
});
const toBody = (draft: Draft) => ({ name: draft.name, weekdays: draft.weekdays, config: { startsAt: draft.startsAt, periodMinutes: Number(draft.periodMinutes), passingMinutes: Number(draft.passingMinutes), periods: Number(draft.periods), breaks: draft.breaks.map(pause => ({ after: Number(pause.after), minutes: Number(pause.minutes), label: pause.label })) } });

function BellDialog({ schedule, onClose, onSaved }: { schedule: BellSchedule | null; onClose: () => void; onSaved: (list: BellSchedule[]) => void }) {
  const [draft, setDraft] = useState<Draft>(() => toDraft(schedule || bellTemplates[0].draft));
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  const checked = bellScheduleInput(toBody(draft));
  const blocks = "error" in checked ? null : bellBlocks(checked.config);
  const set = (patch: Partial<Draft>) => setDraft(current => ({ ...current, ...patch }));
  const setBreak = (index: number, patch: Partial<Draft["breaks"][number]>) => set({ breaks: draft.breaks.map((item, at) => at === index ? { ...item, ...patch } : item) });
  async function save(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError("");
    try { onSaved((await api<{ schedules: BellSchedule[] }>(schedule ? `/bell-schedules/${schedule.id}` : "/bell-schedules", schedule ? "PUT" : "POST", toBody(draft))).schedules); }
    catch (cause) { setError(message(cause)); setBusy(false); }
  }
  const periods = Number(draft.periods) || 0;
  return <Modal wide title={schedule ? `Editar «${schedule.name}»` : "Nueva jornada"} onClose={onClose}>
    <form className="stack" onSubmit={save} aria-label={schedule ? `Editar ${schedule.name}` : "Nueva jornada"}>
      {error && <p className="form-alert" role="alert"><Icon name="alert" size={18}/>{error}</p>}
      {!schedule && <label><span className="sr-only">Empezar con una plantilla</span><select value="" onChange={event => { const template = bellTemplates.find(item => item.id === event.target.value); if (template) setDraft(toDraft(template.draft)); }}>
        <option value="">Empezar con una plantilla…</option>{bellTemplates.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}
      </select></label>}
      <fieldset disabled={busy} className="stack">
        <Field label="Nombre"><input value={draft.name} maxLength={80} required onChange={event => set({ name: event.target.value })}/></Field>
        <fieldset className="day-toggles"><legend>Días en que aplica</legend>
          {weekdays.map(([day, name, short]) => <label key={day} title={name}><input type="checkbox" checked={draft.weekdays.includes(day)} aria-label={name} onChange={() => set({ weekdays: draft.weekdays.includes(day) ? draft.weekdays.filter(value => value !== day) : [...draft.weekdays, day] })}/><span aria-hidden="true">{short}</span></label>)}
        </fieldset>
        <div className="field-row">
          <Field label="Hora de entrada"><input type="time" value={draft.startsAt} required onChange={event => set({ startsAt: event.target.value })}/></Field>
          <Field label="Periodos"><input type="number" min={1} max={maxBellPeriods} value={draft.periods} onChange={event => set({ periods: event.target.value })}/></Field>
          <Field label="Duración del periodo" hint="En minutos."><input type="number" min={20} max={180} step={5} value={draft.periodMinutes} onChange={event => set({ periodMinutes: event.target.value })}/></Field>
          <Field label="Tiempo entre periodos" hint="Minutos para cambiar de clase."><input type="number" min={0} max={30} value={draft.passingMinutes} onChange={event => set({ passingMinutes: event.target.value })}/></Field>
        </div>
        <fieldset className="stack jornada-breaks"><legend>Recesos</legend>
          {draft.breaks.map((pause, index) => <div key={index} className="field-row jornada-break">
            <Field label={`Nombre del receso ${index + 1}`}><input value={pause.label} maxLength={40} onChange={event => setBreak(index, { label: event.target.value })}/></Field>
            <Field label="Después del periodo"><select value={pause.after} onChange={event => setBreak(index, { after: event.target.value })}>{Array.from({ length: Math.max(0, periods - 1) }, (_, at) => <option key={at} value={at + 1}>{at + 1}</option>)}</select></Field>
            <Field label="Minutos"><input type="number" min={5} max={120} step={5} value={pause.minutes} onChange={event => setBreak(index, { minutes: event.target.value })}/></Field>
            <button type="button" className="icon-button" aria-label={`Quitar ${pause.label || `el receso ${index + 1}`}`} onClick={() => set({ breaks: draft.breaks.filter((_, at) => at !== index) })}><Icon name="close" size={16}/></button>
          </div>)}
          <div><button type="button" className="button ghost small" disabled={periods < 2} onClick={() => set({ breaks: [...draft.breaks, { after: String(Math.min(periods - 1, Math.max(1, Math.floor(periods / 2)))), minutes: "20", label: "Recreo" }] })}><Icon name="plus" size={16}/>Agregar receso</button></div>
        </fieldset>
        <div className="jornada-preview" role="status">
          {blocks ? <><p className="small"><strong>{blocks[0].startsAt} a {blocks[blocks.length - 1].endsAt}</strong> · {periods} periodos</p><BellTimeline blocks={blocks} label="Vista previa de la jornada"/></> : <p className="form-alert">{"error" in checked ? checked.error : ""}</p>}
        </div>
        <div className="button-row">
          <PrimaryAction type="submit" icon="check" busy={busy} disabled={busy || !blocks}>{busy ? "Guardando…" : schedule ? "Guardar cambios" : "Crear jornada"}</PrimaryAction>
          <button type="button" className="button ghost" onClick={onClose}>Cancelar</button>
        </div>
      </fieldset>
    </form>
  </Modal>;
}
