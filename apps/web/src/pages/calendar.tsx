import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import type { CalendarBreak } from "@happy-learners/contracts";
import { api, message } from "../api";
import { plural, sessionDay } from "../model";
import { useFeedback } from "../ui/feedback";
import { Icon } from "../ui/icons";
import { ErrorState, Field, Loading, Section, StatusBadge } from "../ui/primitives";

export const breakSpan = (item: Pick<CalendarBreak, "from" | "until">) => item.from === item.until ? sessionDay(item.from) : `Del ${sessionDay(item.from, "short")} al ${sessionDay(item.until, "short")}`;

/**
 * Days without class (DEC-026): holidays, days off and whole weeks. The organization's apply to every section; a
 * section can add its own. Administration adds and removes them, and the schedules they touch skip those days,
 * moving what their classes had planned to the next class days.
 */
export function DaysOff({ section, writable, onChanged }: { section?: { id: string; name: string }; writable: boolean; onChanged?: () => Promise<void> | void }) {
  const { toast, confirm } = useFeedback();
  const [breaks, setBreaks] = useState<CalendarBreak[] | null>(null), [today, setToday] = useState(""), [error, setError] = useState("");
  const [values, setValues] = useState({ title: "", from: "", until: "" }), [busy, setBusy] = useState(false), [formError, setFormError] = useState(""), [showPast, setShowPast] = useState(false);
  const load = () => api<{ breaks: CalendarBreak[]; today: string }>(`/calendar${section ? `?section=${section.id}` : ""}`).then(result => { setBreaks(result.breaks); setToday(result.today); }).catch(cause => setError(message(cause)));
  useEffect(() => { void load(); }, [section?.id]);
  const changed = (result: { sections: number; removed: number; added: number }, text: string) => {
    const moved = result.removed || result.added;
    toast({ message: `${text}${moved ? ` Se reprogramaron las clases pendientes de ${plural(result.sections, "sección", "secciones")}; lo planificado pasó a sus siguientes clases.` : ""}` });
  };
  async function add(event: FormEvent) {
    event.preventDefault(); setBusy(true); setFormError("");
    try {
      const result = await api<{ break: CalendarBreak; sections: number; removed: number; added: number }>("/calendar", "POST", { ...values, until: values.until || values.from, ...(section ? { groupId: section.id } : {}) });
      changed(result, `${breakSpan(result.break)}: sin clase.`);
      setValues({ title: "", from: "", until: "" });
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
  const own = (item: CalendarBreak) => section ? item.groupId === section.id : !item.groupId;
  const visible = (breaks || []).filter(item => showPast || item.until >= today);
  const past = (breaks || []).length - (breaks || []).filter(item => item.until >= today).length;
  return <Section title="Días sin clase" action={past > 0 && <button type="button" className="link-button" onClick={() => setShowPast(!showPast)}>{showPast ? "Ocultar anteriores" : `Ver anteriores (${past})`}</button>}>
    <p className="muted">{section ? "Feriados, asuetos y vacaciones en los que la sección no tiene clase: los de la organización y los propios de la sección. Su horario no genera clases esos días." : "Feriados, asuetos y vacaciones de toda la organización. Ninguna sección genera clases esos días; cada sección puede agregar los suyos en su horario."}</p>
    {error ? <ErrorState error={error} retry={() => void load()}/> : !breaks ? <Loading label="Cargando días sin clase…" lines={2}/>
      : visible.length ? <ul className="days-off">{visible.map(item => <li key={item.id}>
        <Icon name="calendar" size={18}/>
        <div><strong>{item.title}</strong><span className="muted small">{breakSpan(item)}</span></div>
        {section && <StatusBadge tone={item.groupId ? "info" : "neutral"}>{item.groupId ? "Esta sección" : "Organización"}</StatusBadge>}
        {writable && own(item) && <button type="button" className="icon-button" onClick={() => void remove(item)} aria-label={`Quitar «${item.title}»`}><Icon name="close" size={16}/></button>}
      </li>)}</ul>
      : <p className="muted small">No hay días sin clase próximos.</p>}
    {writable && <form className="stack days-off-form" onSubmit={add} aria-label={section ? `Agregar días sin clase a ${section.name}` : "Agregar días sin clase a la organización"}>
      {formError && <p className="form-alert" role="alert"><Icon name="alert" size={18}/>{formError}</p>}
      <fieldset disabled={busy} className="stack">
        <Field label="Motivo"><input value={values.title} maxLength={120} placeholder="Día de la Independencia, vacaciones de medio año…" onChange={event => setValues({ ...values, title: event.target.value })} required/></Field>
        <div className="field-row">
          <Field label="Desde"><input type="date" value={values.from} onChange={event => setValues({ ...values, from: event.target.value })} required/></Field>
          <Field label="Hasta" optional hint="Déjalo vacío si es un solo día."><input type="date" value={values.until} min={values.from} onChange={event => setValues({ ...values, until: event.target.value })}/></Field>
        </div>
        <div className="button-row"><button className="button secondary">{busy ? "Agregando…" : "Agregar días sin clase"}</button></div>
      </fieldset>
    </form>}
  </Section>;
}
