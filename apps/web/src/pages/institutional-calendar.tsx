import { useCallback, useEffect, useState } from "react";
import type { FormEvent } from "react";
import type {
  CalendarCategory, DateRule, InstitutionalCalendar, InstitutionalCalendarEvent,
  InstitutionalCalendarRule,
} from "@happy-learners/contracts";
import { occurrences, ruleSummary } from "@happy-learners/domain";
import { api, message } from "../api";
import { Link, useNavigation } from "../navigation";
import { plural, sessionDay } from "../model";
import { useSession } from "../session";
import { useWorkspace } from "../workspace";
import { Drawer, useFeedback } from "../ui/feedback";
import { Icon } from "../ui/icons";
import { Menu } from "../ui/Menu";
import { Button, EmptyState, ErrorState, Field, Loading, PageHeader, PrimaryAction, Section } from "../ui/primitives";

type Catalog = { calendars: InstitutionalCalendar[]; categories: CalendarCategory[] };
type Plan = { create: InstitutionalCalendarEvent[]; update: InstitutionalCalendarEvent[]; keep: InstitutionalCalendarEvent[] };
const months = ["Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio", "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"];
const parts = { full: "Día completo", morning: "Mañana", afternoon: "Tarde" } as const;
const todayYear = () => new Date().getFullYear();
const rangeOf = (year: number) => ({ from: `${year}-01-01`, until: `${year}-12-31` });
function settingsPath(programId: string | null, sectionId: string | null, year: number) {
  const query = new URLSearchParams({ año: String(year) });
  if (programId) query.set("programa", programId);
  if (sectionId) query.set("seccion", sectionId);
  return `${programId || sectionId ? "/configuracion-academica/calendario" : "/organizacion/calendario"}?${query}`;
}

/** The institutional, program or section calendar: twelve months plus rules and generation for its own level. */
export function InstitutionalCalendarPage() {
  const { member } = useSession();
  const { url, navigate } = useNavigation();
  const { courses, sections, programs } = useWorkspace(member.id);
  const { toast } = useFeedback();
  const requestedYear = Number(url.searchParams.get("año"));
  const [year, setYear] = useState(Number.isInteger(requestedYear) && requestedYear >= 1583 && requestedYear <= 4099 ? requestedYear : todayYear());
  const [catalog, setCatalog] = useState<Catalog | null>(null), [events, setEvents] = useState<InstitutionalCalendarEvent[] | null>(null);
  const [error, setError] = useState(""), [eventDialog, setEventDialog] = useState<InstitutionalCalendarEvent | "new" | null>(null);
  const [ruleDialog, setRuleDialog] = useState<InstitutionalCalendarRule | "new" | null>(null), [generating, setGenerating] = useState(false);
  const programId = url.searchParams.get("programa"), sectionId = url.searchParams.get("seccion");
  const selected = catalog?.calendars.find(item => sectionId ? item.scope === "section" && item.scopeId === sectionId
    : programId ? item.scope === "program" && item.scopeId === programId : item.scope === "organization");
  const selectedProgram = selected?.scope === "program" ? selected.scopeId : selected?.scope === "section"
    ? courses?.find(course => course.id === sections?.find(section => section.id === selected.scopeId)?.courseId)?.programId || null : null;
  const grant = member.permissions?.grants["sections.assign"] || member.permissions?.coordination;
  const writable = member.role === "admin" || !!selected && selected.scope !== "organization" && !!grant
    && ("all" in grant || !!selectedProgram && grant.programs.includes(selectedProgram));
  const rules = selected?.rules || [];

  const loadCatalog = useCallback(async () => {
    try { setCatalog(await api<Catalog>("/calendars")); setError(""); }
    catch (cause) { setError(message(cause)); }
  }, []);
  const loadEvents = useCallback(async () => {
    const range = rangeOf(year), query = new URLSearchParams(range);
    if (sectionId) query.set("section", sectionId);
    else if (programId) query.set("program", programId);
    try { setEvents((await api<{ events: InstitutionalCalendarEvent[] }>(`/calendars/view?${query}`)).events); setError(""); }
    catch (cause) { setError(message(cause)); }
  }, [year, sectionId, programId]);
  useEffect(() => { void loadCatalog(); }, [loadCatalog]);
  useEffect(() => { setEvents(null); void loadEvents(); }, [loadEvents]);
  useEffect(() => { if (requestedYear === year) return; navigate(settingsPath(programId, sectionId, year), true); }, [year]);

  const ownGenerated = (events || []).filter(item => item.calendarId === selected?.id && item.year === year);
  const needsGeneration = rules.some(rule => !ownGenerated.some(event => event.ruleId === rule.id));
  const ownEvents = (events || []).filter(item => item.calendarId === selected?.id);
  const titles = Object.fromEntries(rules.map(item => [item.id, item.rule.title]));
  const programName = programs?.find(item => item.id === programId)?.name;
  const refresh = async () => { await Promise.all([loadCatalog(), loadEvents()]); };
  async function template() {
    if (!selected) return;
    try {
      const result = await api<{ added: number }>(`/calendars/${selected.id}/templates/guatemala`, "POST");
      toast({ message: result.added ? `${plural(result.added, "regla agregada", "reglas agregadas")}. Revísalas: la plantilla es una referencia y no afirma la ley vigente.` : "La plantilla ya estaba completa. Revísala: no afirma la ley vigente." });
      await refresh();
    } catch (cause) { toast({ tone: "error", message: message(cause) }); }
  }
  async function updateOccurrence(event: InstitutionalCalendarEvent, status: "active" | "skipped") {
    if (!selected) return;
    try {
      await api(`/calendars/${selected.id}/events/${event.id}`, "PUT", { ...event, status });
      toast({ message: status === "skipped" ? `«${event.title}» se omitió solo en ${year}.` : `«${event.title}» vuelve a estar activo.` });
      await loadEvents();
    } catch (cause) { toast({ tone: "error", message: message(cause) }); }
  }
  const grouped = ownEvents.reduce<Record<string, InstitutionalCalendarEvent[]>>((groups, event) => {
    const key = event.categoryLabel || "Evento";
    return { ...groups, [key]: [...(groups[key] || []), event] };
  }, {});

  return <>
    <PageHeader title={programId ? `Calendario de ${programName || "programa"}` : "Calendario institucional"}
      description={<>Estas fechas se consultan en la agenda. <Link href="/agenda?vista=año">Ver en la agenda</Link></>}
      actions={writable && selected && <Menu label="Más acciones del calendario" text="Más acciones" items={[
        { label: "Agregar evento", icon: "plus", onSelect: () => setEventDialog("new") },
        { label: "Agregar regla", icon: "calendar", onSelect: () => setRuleDialog("new") },
        "separator",
        { label: "Aplicar plantilla de Guatemala", icon: "copy", onSelect: () => void template() },
      ]}/>}/>
    {error ? <ErrorState error={error} retry={() => void refresh()}/> : !catalog || !events ? <Loading label="Cargando calendario…" cards={3}/>
      : <div className="agenda-config">
        <Section title="Asuetos y fechas recurrentes" action={writable ? <div className="agenda-section-actions"><button type="button" className="button secondary small" onClick={() => setRuleDialog("new")}><Icon name="plus" size={16}/>Agregar</button><Menu label="Más acciones de los asuetos" items={[{ label: "Usar plantilla", icon: "copy", onSelect: () => void template() }]}/></div> : undefined}>
          <p className="muted small">Cada regla dice, en palabras, cuándo cae. Las fechas son las de {year}. La plantilla de Guatemala es una referencia y no afirma la ley vigente.</p>
          <RulesPanel rules={rules} titles={titles} writable={writable} year={year} onEdit={setRuleDialog}/>
        </Section>
        <Section title="Eventos de este año" action={writable ? <button type="button" className="button secondary small" onClick={() => setEventDialog("new")}><Icon name="plus" size={16}/>Agregar</button> : undefined}>
          <Field label="Año"><select value={year} onChange={event => setYear(Number(event.target.value))}>{[...new Set([year, ...Array.from({ length: 7 }, (_, index) => todayYear() - 2 + index)])].sort((a, b) => a - b).map(value => <option key={value}>{value}</option>)}</select></Field>
          {ownEvents.length ? Object.entries(grouped).map(([category, list]) => <div key={category} className="agenda-event-group"><h3>{category}</h3><ul>{list.map(event => <li key={event.id} className={`agenda-event${event.status === "skipped" ? " is-skipped" : ""}`}>
            <div><strong>{event.title}</strong><span>{event.from === event.until ? sessionDay(event.from, "short") : `${sessionDay(event.from, "short")} – ${sessionDay(event.until, "short")}`}{event.part !== "full" ? ` · ${parts[event.part]}` : ""}{event.noClass ? " · Sin clase" : ""}{event.status === "skipped" ? " · Omitido" : ""}</span></div>
            {writable && <Menu label={`Acciones de ${event.title}`} items={[
              { label: event.ruleId ? "Mover esta ocurrencia" : "Editar", icon: "edit", onSelect: () => setEventDialog(event) },
              ...(event.ruleId ? [{ label: event.status === "skipped" ? "Restaurar ocurrencia" : "Saltar esta ocurrencia", icon: "calendar" as const, onSelect: () => void updateOccurrence(event, event.status === "skipped" ? "active" : "skipped") }] : []),
            ]}/>}
          </li>)}</ul></div>) : <EmptyState compact icon="calendar" title="Sin eventos en este año">Agrega uno o genera el año a partir de las reglas.</EmptyState>}
        </Section>
        <Section title="Preparar el año siguiente">
          <p className="muted small">Generar crea las fechas que faltan, actualiza las que cambiaron y conserva las que moviste u omitiste.</p>
          {writable && selected && rules.length > 0 && needsGeneration && <PrimaryAction icon="spark" onClick={() => setGenerating(true)}>Generar {year}</PrimaryAction>}
          {writable && selected && rules.length > 0 && !needsGeneration && <PrimaryAction icon="spark" onClick={() => { setYear(year + 1); setGenerating(true); }}>Generar {year + 1}</PrimaryAction>}
        </Section>
      </div>}
    {eventDialog && selected && catalog && <EventDialog calendar={selected} event={eventDialog === "new" ? null : eventDialog} categories={catalog.categories}
      onClose={() => setEventDialog(null)} onSaved={async moved => { setEventDialog(null); toast({ message: `Evento guardado.${moved ? ` ${plural(moved, "clase pendiente se movió", "clases pendientes se movieron")}.` : ""}` }); await loadEvents(); }}/>}
    {ruleDialog && selected && catalog && <RuleDialog calendar={selected} value={ruleDialog === "new" ? null : ruleDialog} categories={catalog.categories} rules={rules} year={year}
      onClose={() => setRuleDialog(null)} onSaved={async () => { setRuleDialog(null); toast({ message: "Regla guardada. Genera el año para aplicar sus fechas." }); await loadCatalog(); }}/>}
    {generating && selected && <GenerateDialog calendar={selected} year={year} onClose={() => setGenerating(false)}
      onGenerated={async result => { setGenerating(false); toast({ message: `${plural(result.created, "evento creado", "eventos creados")}, ${result.updated} actualizados y ${result.kept} conservados.` }); await loadEvents(); }}/>}
  </>;
}

function RulesPanel({ rules, titles, writable, year, onEdit }: { rules: InstitutionalCalendarRule[]; titles: Record<string, string>; writable: boolean; year: number; onEdit: (rule: InstitutionalCalendarRule | "new") => void }) {
  // Rules read in the order of the year: by their first date in it; the ones that do not apply go last.
  let resolved: { ruleId: string; from: string }[] = [];
  try { resolved = occurrences(rules.map(rule => rule.rule), year); } catch { resolved = []; }
  const firstDate = (item: InstitutionalCalendarRule) => resolved.find(date => date.ruleId === item.id)?.from;
  return rules.length ? <ul className="agenda-rule-list">{[...rules].sort((a, b) => (firstDate(a) || "9999").localeCompare(firstDate(b) || "9999") || a.rule.title.localeCompare(b.rule.title, "es")).map(item => {
      let dates = "";
      try { dates = occurrences(rules.map(rule => rule.rule), year).filter(date => date.ruleId === item.id).map(date => date.from === date.until ? sessionDay(date.from, "short") : `${sessionDay(date.from, "short")} – ${sessionDay(date.until, "short")}`).join(", "); } catch { dates = "Revisa la referencia de esta regla"; }
      return <li key={item.id}><div><strong>{item.rule.title}</strong><span>{ruleSummary(item.rule, titles)}</span><span className="muted small">{dates || `No aplica en ${year}`}{item.noClass ? " · sin clase" : ""}</span></div>{writable && <button type="button" className="icon-button" aria-label={`Editar ${item.rule.title}`} onClick={() => onEdit(item)}><Icon name="edit" size={16}/></button>}</li>;
    })}</ul> : <EmptyState compact icon="calendar" title="Sin reglas">Agrega una regla o usa la plantilla de Guatemala.</EmptyState>;
}

function EventDialog({ calendar, event, categories, onClose, onSaved }: { calendar: InstitutionalCalendar; event: InstitutionalCalendarEvent | null; categories: CalendarCategory[]; onClose: () => void; onSaved: (moved: number) => Promise<void> }) {
  const initialCategory = categories.find(item => item.id === event?.categoryId) || categories[0];
  const [values, setValues] = useState({ categoryId: initialCategory?.id || "", title: event?.title || "", from: event?.from || "", until: event?.until || "", part: event?.part || "full", noClass: event?.noClass ?? initialCategory?.noClassDefault ?? false, status: event?.status || "active" });
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  async function save(submit: FormEvent) {
    submit.preventDefault(); setBusy(true); setError("");
    try {
      const result = await api<{ removed?: number; added?: number }>(`/calendars/${calendar.id}/events${event ? `/${event.id}` : ""}`, event ? "PUT" : "POST", { ...values, until: values.until || values.from });
      await onSaved((result.removed || 0) + (result.added || 0));
    } catch (cause) { setError(message(cause)); setBusy(false); }
  }
  return <Drawer title={event ? event.ruleId ? "Mover ocurrencia" : "Editar evento" : "Agregar evento"} onClose={onClose}>
    <form className="stack" onSubmit={save}><fieldset className="stack" disabled={busy}>
      {error && <p className="form-alert" role="alert">{error}</p>}
      <Field label="Categoría"><select value={values.categoryId} onChange={change => { const category = categories.find(item => item.id === change.target.value); setValues({ ...values, categoryId: change.target.value, noClass: category?.noClassDefault || false }); }}>{categories.map(category => <option key={category.id} value={category.id}>{category.label}</option>)}</select></Field>
      <Field label="Título"><input value={values.title} required maxLength={120} onChange={change => setValues({ ...values, title: change.target.value })}/></Field>
      <div className="field-row"><Field label="Desde"><input type="date" value={values.from} required onChange={change => setValues({ ...values, from: change.target.value })}/></Field><Field label="Hasta" optional><input type="date" min={values.from} value={values.until} onChange={change => setValues({ ...values, until: change.target.value })}/></Field></div>
      <Field label="Parte del día"><select value={values.part} onChange={change => setValues({ ...values, part: change.target.value as typeof values.part })}>{Object.entries(parts).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></Field>
      <label className="check-row"><input type="checkbox" checked={values.noClass} onChange={change => setValues({ ...values, noClass: change.target.checked })}/><span>Sin clase</span></label>
      <div className="modal-actions"><button type="button" className="button ghost" onClick={onClose}>Cancelar</button><button className="button primary">{busy ? "Guardando…" : "Guardar evento"}</button></div>
    </fieldset></form>
  </Drawer>;
}

type AnchorKind = DateRule["anchor"]["kind"];
const defaultRule = (year: number): DateRule => ({ id: "draft", title: "", anchor: { kind: "fixed", month: 1, day: 1 }, days: 1, part: "full", fromYear: year });
function RuleDialog({ calendar, value, categories, rules, year, onClose, onSaved }: {
  calendar: InstitutionalCalendar; value: InstitutionalCalendarRule | null; categories: CalendarCategory[]; rules: InstitutionalCalendarRule[]; year: number; onClose: () => void; onSaved: () => Promise<void>;
}) {
  const { confirm } = useFeedback();
  const [rule, setRule] = useState<DateRule>(value?.rule || defaultRule(year));
  const category = categories.find(item => item.id === value?.categoryId) || categories[0];
  const [categoryId, setCategoryId] = useState(category?.id || ""), [noClass, setNoClass] = useState(value?.noClass ?? category?.noClassDefault ?? false);
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  const anchor = rule.anchor;
  const patchAnchor = (patch: Record<string, unknown>) => setRule({ ...rule, anchor: { ...anchor, ...patch } as DateRule["anchor"] });
  const kind = anchor.kind;
  const setKind = (next: AnchorKind) => setRule({ ...rule, anchor: next === "fixed" ? { kind: "fixed", month: 1, day: 1 } : next === "nth-weekday" ? { kind: "nth-weekday", month: 1, weekday: 1, n: 1 } : next === "easter" ? { kind: "easter", offset: 0 } : next === "relative" ? { kind: "relative", to: rules.find(item => item.id !== value?.id)?.id || "", offset: 0 } : { kind: "once", date: `${year}-01-01` } });
  let preview: ReturnType<typeof occurrences> = [], previewError = "";
  try { preview = occurrences([...rules.filter(item => item.id !== value?.id).map(item => item.rule), { ...rule, id: value?.id || "preview-rule" }], year).filter(item => item.ruleId === (value?.id || "preview-rule")); } catch (cause) { previewError = message(cause); }
  async function save(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError("");
    try {
      await api(`/calendars/${calendar.id}/rules${value ? `/${value.id}` : ""}`, value ? "PUT" : "POST", { categoryId, noClass, rule });
      await onSaved();
    } catch (cause) { setError(message(cause)); setBusy(false); }
  }
  async function remove() {
    if (!value || !await confirm({ title: `¿Eliminar «${value.rule.title}»?`, body: "También se eliminan las ocurrencias generadas por esta regla.", confirm: "Eliminar regla", danger: true })) return;
    setBusy(true);
    try { await api(`/calendars/${calendar.id}/rules/${value.id}`, "DELETE"); await onSaved(); } catch (cause) { setError(message(cause)); setBusy(false); }
  }
  return <Drawer title={value ? "Editar regla" : "Agregar regla"} onClose={onClose}>
    <form className="stack rule-editor" onSubmit={save}><fieldset className="stack" disabled={busy}>
      {error && <p className="form-alert" role="alert">{error}</p>}
      <div className="field-row"><Field label="Título"><input value={rule.title} required maxLength={120} onChange={event => setRule({ ...rule, title: event.target.value })}/></Field><Field label="Categoría"><select value={categoryId} onChange={event => { const selected = categories.find(item => item.id === event.target.value); setCategoryId(event.target.value); setNoClass(selected?.noClassDefault || false); }}>{categories.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}</select></Field></div>
      <Field label="Tipo de fecha"><select value={kind} onChange={event => setKind(event.target.value as AnchorKind)}><option value="fixed">Fecha fija</option><option value="nth-weekday">N-ésimo día de la semana</option><option value="easter">Relativa a Pascua</option><option value="relative">Relativa a otra regla</option><option value="once">Fecha única</option></select></Field>
      {kind === "fixed" && <div className="field-row"><Field label="Mes"><input name="month" type="number" min={1} max={12} value={anchor.month} onChange={event => patchAnchor({ month: Number(event.target.value) })}/></Field><Field label="Día"><input name="day" type="number" min={1} max={31} value={anchor.day} onChange={event => patchAnchor({ day: Number(event.target.value) })}/></Field></div>}
      {kind === "nth-weekday" && <div className="field-row"><Field label="Posición"><select value={anchor.n} onChange={event => patchAnchor({ n: Number(event.target.value) })}><option value={1}>Primer</option><option value={2}>Segundo</option><option value={3}>Tercer</option><option value={4}>Cuarto</option><option value={5}>Quinto</option><option value={-1}>Último</option></select></Field><Field label="Día"><select value={anchor.weekday} onChange={event => patchAnchor({ weekday: Number(event.target.value) })}>{["Domingo", "Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado"].map((day, index) => <option key={day} value={index}>{day}</option>)}</select></Field><Field label="Mes"><select value={anchor.month} onChange={event => patchAnchor({ month: Number(event.target.value) })}>{months.map((month, index) => <option key={month} value={index + 1}>{month}</option>)}</select></Field></div>}
      {kind === "easter" && <Field label="Días desde Pascua"><input type="number" min={-366} max={366} value={anchor.offset} onChange={event => patchAnchor({ offset: Number(event.target.value) })}/></Field>}
      {kind === "relative" && <div className="field-row"><Field label="Regla de referencia"><select value={anchor.to} required onChange={event => patchAnchor({ to: event.target.value })}><option value="">Elige una regla…</option>{rules.filter(item => item.id !== value?.id).map(item => <option key={item.id} value={item.id}>{item.rule.title}</option>)}</select></Field><Field label="Días antes o después"><input type="number" min={-366} max={366} value={anchor.offset} onChange={event => patchAnchor({ offset: Number(event.target.value) })}/></Field></div>}
      {kind === "once" && <Field label="Fecha única"><input type="date" value={anchor.date} onChange={event => patchAnchor({ date: event.target.value })}/></Field>}
      <div className="field-row"><Field label="Duración"><input type="number" min={1} max={366} value={rule.days || 1} onChange={event => setRule({ ...rule, days: Number(event.target.value) })}/></Field><Field label="Parte del día"><select value={rule.part || "full"} onChange={event => setRule({ ...rule, part: event.target.value as DateRule["part"] })}>{Object.entries(parts).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></Field></div>
      <details><summary>Traslado y vigencia</summary><div className="stack rule-advanced">
        <label className="check-row"><input type="checkbox" checked={!!rule.shift} onChange={event => setRule({ ...rule, shift: event.target.checked ? { when: [0, 6], to: "next", onto: [1, 2, 3, 4, 5] } : undefined })}/><span>Trasladar cuando cae en ciertos días</span></label>
        {rule.shift && <><Field label="Dirección"><select value={rule.shift.to} onChange={event => setRule({ ...rule, shift: { ...rule.shift!, to: event.target.value as NonNullable<DateRule["shift"]>["to"] } })}><option value="previous">Anterior</option><option value="next">Siguiente</option><option value="nearest">Más cercano</option></select></Field><Weekdays label="Se traslada si cae" selected={rule.shift.when} onChange={when => setRule({ ...rule, shift: { ...rule.shift!, when } })}/><Weekdays label="Puede caer en" selected={rule.shift.onto} onChange={onto => setRule({ ...rule, shift: { ...rule.shift!, onto } })}/></>}
        <div className="field-row"><Field label="Vigente desde" optional><input type="number" min={1583} max={4099} value={rule.fromYear || ""} onChange={event => setRule({ ...rule, fromYear: event.target.value ? Number(event.target.value) : undefined, onlyYear: undefined })}/></Field><Field label="Vigente hasta" optional><input type="number" min={1583} max={4099} value={rule.untilYear || ""} onChange={event => setRule({ ...rule, untilYear: event.target.value ? Number(event.target.value) : undefined, onlyYear: undefined })}/></Field><Field label="Solo este año" optional><input type="number" min={1583} max={4099} value={rule.onlyYear || ""} onChange={event => setRule({ ...rule, onlyYear: event.target.value ? Number(event.target.value) : undefined, fromYear: undefined, untilYear: undefined })}/></Field></div>
        <Field label="Años excluidos" optional hint="Separados por comas."><input defaultValue={rule.exceptYears?.join(", ") || ""} onBlur={event => setRule({ ...rule, exceptYears: event.target.value.split(",").map(item => Number(item.trim())).filter(Boolean) })}/></Field>
      </div></details>
      <label className="check-row"><input type="checkbox" checked={noClass} onChange={event => setNoClass(event.target.checked)}/><span>Sin clase</span></label>
      <div className="rule-live-preview" role="status"><strong>Vista previa de {year}</strong><span>{rule.title ? ruleSummary(rule, Object.fromEntries(rules.map(item => [item.id, item.rule.title]))) : "Completa el título y la fecha."}</span>{previewError ? <span className="field-error">{previewError}</span> : preview.map(item => <span key={item.from}>{item.from} · {item.from === item.until ? sessionDay(item.from) : `${sessionDay(item.from)} – ${sessionDay(item.until)}`}</span>)}</div>
      <div className="modal-actions">{value && <button type="button" className="button ghost danger-text push-end" onClick={() => void remove()}>Eliminar regla</button>}<button type="button" className="button ghost" onClick={onClose}>Cancelar</button><button className="button primary">{busy ? "Guardando…" : "Guardar regla"}</button></div>
    </fieldset></form>
  </Drawer>;
}

function Weekdays({ label, selected, onChange }: { label: string; selected: (0 | 1 | 2 | 3 | 4 | 5 | 6)[]; onChange: (days: (0 | 1 | 2 | 3 | 4 | 5 | 6)[]) => void }) {
  return <fieldset className="rule-weekdays"><legend>{label}</legend>{["D", "L", "M", "X", "J", "V", "S"].map((day, index) => <label key={`${label}-${day}`}><input type="checkbox" checked={selected.includes(index as 0)} onChange={() => onChange(selected.includes(index as 0) ? selected.filter(item => item !== index) : [...selected, index as 0])}/><span>{day}</span></label>)}</fieldset>;
}

function GenerateDialog({ calendar, year, onClose, onGenerated }: { calendar: InstitutionalCalendar; year: number; onClose: () => void; onGenerated: (result: { created: number; updated: number; kept: number }) => Promise<void> }) {
  const [plan, setPlan] = useState<Plan | null>(null), [error, setError] = useState(""), [busy, setBusy] = useState(false);
  useEffect(() => { api<{ plan: Plan }>(`/calendars/${calendar.id}/years/${year}/generate?preview=1`, "POST").then(result => setPlan(result.plan), cause => setError(message(cause))); }, [calendar.id, year]);
  async function generate() {
    setBusy(true);
    try { const result = await api<{ applied: { created: number; updated: number; kept: number } }>(`/calendars/${calendar.id}/years/${year}/generate`, "POST"); await onGenerated(result.applied); }
    catch (cause) { setError(message(cause)); setBusy(false); }
  }
  const group = (title: string, items: InstitutionalCalendarEvent[], empty: string) => <section><h3>{title} <span className="count-badge">{items.length}</span></h3>{items.length ? <ul>{items.map((item, index) => <li key={item.id || `${item.ruleId}-${index}`}><strong>{item.title}</strong><span>{sessionDay(item.from, "short")}{item.from !== item.until ? ` – ${sessionDay(item.until, "short")}` : ""}</span></li>)}</ul> : <p className="muted small">{empty}</p>}</section>;
  return <Drawer title={`Generar el año ${year}`} onClose={onClose}>
    {error ? <ErrorState error={error}/> : !plan ? <Loading label="Calculando vista previa…" lines={4}/> : <div className="stack generation-preview">
      <p className="muted">Revisa los cambios antes de confirmar. Las ocurrencias que moviste u omitiste a mano se conservan.</p>
      <div className="generation-groups">{group("Se crean", plan.create, "No se crean eventos.")}{group("Se actualizan", plan.update, "No se actualizan eventos.")}{group("Se conservan", plan.keep, "No hay eventos movidos u omitidos.")}</div>
      <div className="modal-actions"><Button variant="ghost" onClick={onClose}>Cancelar</Button><PrimaryAction busy={busy} disabled={busy} onClick={() => void generate()}>{busy ? "Generando…" : `Confirmar y generar ${year}`}</PrimaryAction></div>
    </div>}
  </Drawer>;
}

/** Compact organization summary that replaces the old editor of organization-wide days off. */
export function CalendarSummary() {
  const [items, setItems] = useState<InstitutionalCalendarEvent[] | null>(null);
  const now = new Date(), from = now.toISOString().slice(0, 10), until = new Date(Date.UTC(now.getUTCFullYear() + 1, now.getUTCMonth(), now.getUTCDate())).toISOString().slice(0, 10);
  useEffect(() => { api<{ events?: InstitutionalCalendarEvent[] }>(`/calendars/view?from=${from}&until=${until}`).then(result => setItems((result.events || []).filter(item => item.noClass && item.status === "active").slice(0, 5)), () => setItems([])); }, []);
  return <Section title="Calendario institucional" action={<Link href="/organizacion/calendario" className="section-link">Abrir calendario</Link>}>
    <p className="muted small">Próximos eventos sin clase de toda la organización.</p>
    {!items ? <Loading label="Cargando calendario…" lines={2}/> : items.length ? <ul className="calendar-summary">{items.map(item => <li key={item.id}><Icon name="calendar" size={18}/><div><strong>{item.title}</strong><span>{item.from === item.until ? sessionDay(item.from, "short") : `${sessionDay(item.from, "short")} – ${sessionDay(item.until, "short")}`}</span></div></li>)}</ul> : <p className="muted small">No hay eventos sin clase próximos.</p>}
  </Section>;
}
