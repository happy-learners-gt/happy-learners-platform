import { useCallback, useEffect, useState } from "react";
import type { FormEvent } from "react";
import type { CalendarBreak } from "@happy-learners/contracts";
import { api, message } from "../api";
import { plural, sessionDay } from "../model";
import { useFeedback } from "../ui/feedback";
import { Icon } from "../ui/icons";
import { ErrorState, Field, Loading, Section, StatusBadge } from "../ui/primitives";

export const breakSpan = (item: Pick<CalendarBreak, "from" | "until">) => item.from === item.until ? sessionDay(item.from) : `Del ${sessionDay(item.from, "short")} al ${sessionDay(item.until, "short")}`;

export type Breaks = { breaks: CalendarBreak[] | null; today: string; error: string; load: () => Promise<void> };
/** The days without class that apply to a section (the organization's and its own), or the organization's alone. */
export function useBreaks(sectionId?: string, enabled = true): Breaks {
  const [breaks, setBreaks] = useState<CalendarBreak[] | null>(null), [today, setToday] = useState(""), [error, setError] = useState("");
  const load = useCallback(() => api<{ breaks: CalendarBreak[]; today: string }>(`/calendar${sectionId ? `?section=${sectionId}` : ""}`)
    .then(result => { setBreaks(result.breaks); setToday(result.today); setError(""); }, cause => setError(message(cause))), [sectionId]);
  useEffect(() => { if (enabled) void load(); }, [load, enabled]);
  return { breaks, today, error, load };
}

/**
 * Days without class (DEC-026): holidays, days off and whole weeks. The organization's apply to every section; a
 * section can add its own. Administration adds and removes them, and the schedules they touch skip those days,
 * moving what their classes had planned to the next class days.
 */
export function DaysOff({ section, writable, onChanged, data }: { section?: { id: string; name: string }; writable: boolean; onChanged?: () => Promise<void> | void; data?: Breaks }) {
  const { toast, confirm } = useFeedback();
  const own = useBreaks(section?.id, !data);
  const { breaks, today, error, load } = data || own;
  const [values, setValues] = useState({ title: "", from: "", until: "" }), [adding, setAdding] = useState(false), [busy, setBusy] = useState(false), [formError, setFormError] = useState(""), [showPast, setShowPast] = useState(false);
  const changed = (result: { sections: number; removed: number; added: number }, text: string) => {
    const moved = result.removed || result.added;
    toast({ message: `${text}${moved ? ` Se reprogramaron las clases pendientes de ${plural(result.sections, "sección", "secciones")}; lo planificado pasó a sus siguientes clases.` : ""}` });
  };
  async function add(event: FormEvent) {
    event.preventDefault(); setBusy(true); setFormError("");
    try {
      const result = await api<{ break: CalendarBreak; sections: number; removed: number; added: number }>("/calendar", "POST", { ...values, until: values.until || values.from, ...(section ? { groupId: section.id } : {}) });
      changed(result, `${breakSpan(result.break)}: sin clase.`);
      setValues({ title: "", from: "", until: "" }); setAdding(false);
      await load(); await onChanged?.();
    } catch (cause) { setFormError(message(cause)); }
    finally { setBusy(false); }
  }
  async function remove(item: CalendarBreak) {
    if (!await confirm({ title: `¿Quitar «${item.title}»?`, body: <p>{breakSpan(item)} vuelve a tener clase. Los horarios que lo incluyen generan de nuevo esas clases y lo planificado se reacomoda en orden.</p>, confirm: "Quitar", danger: true })) return;
    try {
      const result = await api<{ sections: number; removed: number; added: number }>(`/calendar/${item.id}`, "DELETE");
      changed(result, `«${item.title}» se quitó.`);
      await load(); await onChanged?.();
    } catch (cause) { toast({ tone: "error", message: message(cause) }); }
  }
  const mine = (item: CalendarBreak) => section ? item.groupId === section.id : !item.groupId;
  const upcoming = (breaks || []).filter(item => item.until >= today);
  const visible = showPast ? breaks || [] : upcoming, past = (breaks || []).length - upcoming.length;
  const showForm = writable && adding;
  return <Section title="Días sin clase" className="days-off-panel" action={writable && !showForm && <button type="button" className="button secondary small" onClick={() => setAdding(true)}><Icon name="plus" size={16}/>Agregar</button>}>
    <p className="muted small">{section ? "Feriados, asuetos y vacaciones de la organización y de la sección. Esos días no hay clase y lo planificado pasa a la siguiente." : "Feriados, asuetos y vacaciones de toda la organización. Ninguna sección genera clases esos días; cada sección puede agregar los suyos en su horario."}</p>
    {error ? <ErrorState error={error} retry={() => void load()}/> : !breaks ? <Loading label="Cargando días sin clase…" lines={2}/>
      : visible.length ? <ul className="days-off">{visible.map(item => <li key={item.id} className={item.until < today ? "is-past" : undefined}>
        <Icon name="calendar" size={18}/>
        <div><strong>{item.title}</strong><span className="muted small">{breakSpan(item)}</span></div>
        {section && <StatusBadge tone={item.groupId ? "info" : "neutral"}>{item.groupId ? "Esta sección" : "Organización"}</StatusBadge>}
        {writable && mine(item) && <button type="button" className="icon-button" onClick={() => void remove(item)} aria-label={`Quitar «${item.title}»`}><Icon name="close" size={16}/></button>}
      </li>)}</ul>
      : !showForm && <p className="muted small">No hay días sin clase próximos.</p>}
    {past > 0 && <button type="button" className="link-button small" onClick={() => setShowPast(!showPast)}>{showPast ? "Ocultar los anteriores" : `Ver los anteriores (${past})`}</button>}
    {showForm && <form className="stack days-off-form" onSubmit={add} aria-label={section ? `Agregar días sin clase a ${section.name}` : "Agregar días sin clase a la organización"}>
      {formError && <p className="form-alert" role="alert"><Icon name="alert" size={18}/>{formError}</p>}
      <fieldset disabled={busy} className="stack">
        <Field label="Motivo"><input value={values.title} maxLength={120} placeholder="Feriado, asueto, vacaciones…" onChange={event => setValues({ ...values, title: event.target.value })} required autoFocus={adding}/></Field>
        <div className="field-row">
          <Field label="Desde"><input type="date" value={values.from} onChange={event => setValues({ ...values, from: event.target.value })} required/></Field>
          <Field label="Hasta" optional hint="Vacío si es un solo día."><input type="date" value={values.until} min={values.from} onChange={event => setValues({ ...values, until: event.target.value })}/></Field>
        </div>
        <div className="button-row"><button className="button primary">{busy ? "Agregando…" : "Agregar días sin clase"}</button>{adding && <button type="button" className="button ghost" onClick={() => { setAdding(false); setFormError(""); }}>Cancelar</button>}</div>
      </fieldset>
    </form>}
  </Section>;
}
