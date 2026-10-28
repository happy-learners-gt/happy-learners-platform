import { useCallback, useEffect, useState } from "react";
import type { FormEvent } from "react";
import type { AcademicYear, CalendarBreak, PeriodKind } from "@happy-learners/contracts";
import { academicYearLabels, maxGapDays, periodGaps, periodKindOf, periodKinds, splitPeriods } from "@happy-learners/domain";
import { api, message } from "../api";
import { plural, sessionDay } from "../model";
import { Modal, useFeedback } from "../ui/feedback";
import { Icon } from "../ui/icons";
import { Menu } from "../ui/Menu";
import type { MenuItem } from "../ui/Menu";
import { ErrorState, Field, Loading, Section, StatusBadge } from "../ui/primitives";
import type { Tone } from "../ui/primitives";

const tones: Record<AcademicYear["status"], Tone> = { draft: "info", current: "success", closed: "neutral" };
const span = (item: { from: string; until: string }) => `${sessionDay(item.from, "short")} – ${sessionDay(item.until, "short")}`;
const periodCount = (year: Pick<AcademicYear, "periodKind" | "periods">) => {
  const kind = periodKindOf(year.periodKind);
  return plural(year.periods.length, kind.label.toLocaleLowerCase("es"), kind.plural);
};

/** The school years the organization reads, newest first, and today in its time zone. */
export function useAcademicYears(enabled = true) {
  const [years, setYears] = useState<AcademicYear[] | null>(null), [today, setToday] = useState(""), [error, setError] = useState("");
  const load = useCallback(() => api<{ years: AcademicYear[]; today: string }>("/academic-years")
    .then(result => { setYears(result.years); setToday(result.today); setError(""); }, cause => setError(message(cause))), []);
  useEffect(() => { if (enabled) void load(); }, [load, enabled]);
  return { years, today, error, load };
}

/**
 * The organization's school year (ciclo lectivo) and its periods. Administration prepares a draft, activates it,
 * closes it and opens the next one empty with the same periods. Sections keep their own schedule dates.
 */
export function AcademicYears() {
  const { toast, confirm } = useFeedback();
  const { years, error, load } = useAcademicYears();
  const [editing, setEditing] = useState<AcademicYear | "new" | null>(null);
  const [breaks, setBreaks] = useState<CalendarBreak[]>([]), [marking, setMarking] = useState("");
  const loadBreaks = useCallback(() => api<{ breaks: CalendarBreak[] }>("/calendar").then(result => setBreaks(result.breaks.filter(item => !item.groupId)), () => setBreaks([])), []);
  useEffect(() => { void loadBreaks(); }, [loadBreaks]);
  // The vacations between periods that no organization-wide day without class covers yet.
  const uncovered = (year: AcademicYear) => periodGaps(year.periods).filter(gap => !breaks.some(item => item.from <= gap.from && gap.until <= item.until));
  async function markGaps(year: AcademicYear) {
    const gaps = uncovered(year);
    if (!await confirm({ title: "¿Marcar las vacaciones como días sin clase?", body: <p>{plural(gaps.length, "intervalo", "intervalos")} entre periodos de «{year.name}» quedan sin clase para toda la organización. Las clases pendientes de esos días pasan, con sus lecciones, a las siguientes fechas de cada sección.</p>, confirm: "Marcar sin clase" })) return;
    setMarking(year.id);
    try {
      let moved = 0;
      for (const gap of gaps) moved += (await api<{ removed: number }>("/calendar", "POST", { title: `Vacaciones entre ${gap.after.toLocaleLowerCase("es")} y ${gap.before.toLocaleLowerCase("es")}`, from: gap.from, until: gap.until })).removed;
      toast({ message: `${plural(gaps.length, "intervalo marcado", "intervalos marcados")} sin clase${moved ? `; ${plural(moved, "clase pendiente se movió", "clases pendientes se movieron")}` : ""}.` });
      await loadBreaks();
    } catch (cause) { toast({ tone: "error", message: message(cause) }); await loadBreaks(); }
    finally { setMarking(""); }
  }
  async function act(year: AcademicYear, action: "activate" | "close" | "next" | "delete") {
    const questions = {
      activate: { title: `¿Activar «${year.name}»?`, body: <p>Pasa a ser el ciclo vigente de la organización. Al configurar el horario de una sección se sugerirán sus fechas.</p>, confirm: "Activar ciclo" },
      close: { title: `¿Cerrar «${year.name}»?`, body: <p>El ciclo y sus periodos quedan como historial y ya no se editan. Cerrar el ciclo no promueve estudiantes ni cambia los horarios de las secciones.</p>, confirm: "Cerrar ciclo", danger: true },
      delete: { title: `¿Eliminar «${year.name}»?`, body: <p>Se elimina el borrador con sus periodos.</p>, confirm: "Eliminar", danger: true },
      next: null,
    }[action];
    if (questions && !await confirm(questions)) return;
    try {
      if (action === "delete") { await api(`/academic-years/${year.id}`, "DELETE"); toast({ message: `«${year.name}» se eliminó.` }); }
      else {
        const result = await api<{ year: AcademicYear }>(`/academic-years/${year.id}/${action}`, "POST");
        toast({ message: action === "next" ? `Se creó «${result.year.name}» en borrador, con ${periodCount(result.year)} y sin estudiantes ni notas.` : action === "activate" ? `«${year.name}» es el ciclo vigente.` : `«${year.name}» se cerró.` });
      }
      await load();
    } catch (cause) { toast({ tone: "error", message: message(cause) }); }
  }
  const actions = (year: AcademicYear): MenuItem[] => [
    ...(year.status !== "closed" ? [{ label: "Editar", icon: "edit" as const, onSelect: () => setEditing(year) }] : []),
    ...(year.status === "draft" ? [{ label: "Activar", icon: "check" as const, onSelect: () => void act(year, "activate") }] : []),
    ...(year.status === "current" ? [{ label: "Cerrar ciclo", icon: "archive" as const, onSelect: () => void act(year, "close") }] : []),
    ...(year.status !== "draft" ? [{ label: "Crear el siguiente ciclo", icon: "copy" as const, onSelect: () => void act(year, "next") }] : []),
    ...(year.status === "draft" ? ["separator" as const, { label: "Eliminar", danger: true, onSelect: () => void act(year, "delete") }] : []),
  ];
  return <Section title="Ciclo lectivo" className="academic-years-panel" action={<button type="button" className="button secondary small" onClick={() => setEditing("new")}><Icon name="plus" size={16}/>Nuevo ciclo</button>}>
    <p className="muted small">El ciclo lectivo de la organización y sus periodos. El horario de cada sección conserva sus propias fechas; al configurarlo se sugieren las del ciclo vigente.</p>
    {error ? <ErrorState error={error} retry={() => void load()}/> : !years ? <Loading label="Cargando ciclos lectivos…" lines={2}/>
      : !years.length ? <p className="muted small">Todavía no hay ciclos. Crea el primero, por ejemplo «Ciclo 2027» con cuatro bimestres.</p>
      : <ul className="academic-years">{years.map(year => <li key={year.id} className={year.status === "closed" ? "is-past" : undefined}>
        <div className="academic-year-head">
          <Icon name="calendar" size={18}/>
          <div><strong>{year.name}</strong><span className="muted small">{span(year)} · {periodCount(year)}</span></div>
          <StatusBadge tone={tones[year.status]}>{academicYearLabels[year.status]}</StatusBadge>
          <Menu label={`Acciones de ${year.name}`} items={actions(year)}/>
        </div>
        {year.periods.length > 0 && <YearCalendar year={year} breaks={breaks}/>}
        {year.status !== "closed" && uncovered(year).length > 0 && <div className="year-gaps-action">
          <span className="muted small">{plural(uncovered(year).length, "intervalo entre periodos aún tiene", "intervalos entre periodos aún tienen")} clase.</span>
          <button type="button" className="button ghost small" disabled={!!marking} onClick={() => void markGaps(year)}><Icon name="calendar" size={16}/>{marking === year.id ? "Marcando…" : "Marcar las vacaciones sin clase"}</button>
        </div>}
      </li>)}</ul>}
    {editing && <YearDialog year={editing === "new" ? null : editing} onClose={() => setEditing(null)} onSaved={async saved => { setEditing(null); toast({ message: `«${saved.name}» se guardó.` }); await load(); }}/>}
  </Section>;
}

type Row = { key: string; id: string | null; name: string; from: string; until: string; weight: string };
let rowKey = 0;
const row = (value: Omit<Row, "key" | "weight"> & { weight: number | string }): Row => ({ ...value, weight: String(value.weight), key: `row-${++rowKey}` });

function YearDialog({ year, onClose, onSaved }: { year: AcademicYear | null; onClose: () => void; onSaved: (year: AcademicYear) => Promise<void> }) {
  const { confirm } = useFeedback();
  const [values, setValues] = useState({ name: year?.name || "", from: year?.from || "", until: year?.until || "", periodKind: year?.periodKind || "bimester" as PeriodKind });
  const [periods, setPeriods] = useState<Row[]>(() => (year?.periods || []).map(period => row(period)));
  const [busy, setBusy] = useState(false), [error, setError] = useState(""), [gap, setGap] = useState("0");
  const kind = periodKindOf(values.periodKind);
  const setPeriod = (key: string, patch: Partial<Row>) => setPeriods(current => current.map(item => item.key === key ? { ...item, ...patch } : item));
  async function divide() {
    if (periods.length && !await confirm({ title: "¿Reemplazar los periodos?", body: <p>Los periodos actuales se sustituyen por {plural(kind.count, kind.label.toLocaleLowerCase("es"), kind.plural)} de duración parecida.</p>, confirm: "Reemplazar" })) return;
    setPeriods(splitPeriods(values.from, values.until, values.periodKind, kind.count, Number(gap) || 0).map(period => row(period)));
  }
  async function submit(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError("");
    try {
      const body = { ...values, periods: periods.map(({ id, name, from, until, weight }) => ({ ...(id ? { id } : {}), name, from, until, weight: Number(weight) || 1 })) };
      const result = await api<{ year: AcademicYear }>(year ? `/academic-years/${year.id}` : "/academic-years", year ? "PUT" : "POST", body);
      await onSaved(result.year);
    } catch (cause) { setError(message(cause)); setBusy(false); }
  }
  const datesReady = !!values.from && !!values.until && values.until > values.from;
  return <Modal title={year ? `Editar «${year.name}»` : "Nuevo ciclo lectivo"} onClose={onClose} wide>
    <form className="stack" onSubmit={submit} aria-label={year ? `Editar ${year.name}` : "Nuevo ciclo lectivo"}>
      {error && <p className="form-alert" role="alert"><Icon name="alert" size={18}/>{error}</p>}
      <fieldset disabled={busy} className="stack">
        <Field label="Nombre" hint="Por ejemplo: Ciclo 2027."><input value={values.name} required minLength={3} maxLength={80} placeholder="Ciclo 2027" onChange={event => setValues({ ...values, name: event.target.value })}/></Field>
        <div className="field-row">
          <Field label="Inicio del ciclo"><input type="date" value={values.from} onChange={event => setValues({ ...values, from: event.target.value })} required/></Field>
          <Field label="Fin del ciclo"><input type="date" value={values.until} min={values.from} onChange={event => setValues({ ...values, until: event.target.value })} required/></Field>
          <Field label="Se divide en"><select value={values.periodKind} onChange={event => setValues({ ...values, periodKind: event.target.value as PeriodKind })}>{periodKinds.map(option => <option key={option.key} value={option.key}>{option.plural.charAt(0).toLocaleUpperCase("es") + option.plural.slice(1)}</option>)}</select></Field>
        </div>
        <fieldset className="stack period-rows">
          <legend>Periodos</legend>
          <p className="muted small">El peso solo cuenta en los cursos que promedian los periodos de forma ponderada.</p>
          {periods.length ? periods.map((period, index) => <div key={period.key} className="period-row">
            <Field label={`Nombre del periodo ${index + 1}`}><input value={period.name} required maxLength={60} onChange={event => setPeriod(period.key, { name: event.target.value })}/></Field>
            <Field label="Desde"><input type="date" value={period.from} min={values.from} max={values.until} onChange={event => setPeriod(period.key, { from: event.target.value })} required/></Field>
            <Field label="Hasta"><input type="date" value={period.until} min={period.from || values.from} max={values.until} onChange={event => setPeriod(period.key, { until: event.target.value })} required/></Field>
            <Field label="Peso"><input type="number" inputMode="numeric" min={1} max={100} step={1} value={period.weight} onChange={event => setPeriod(period.key, { weight: event.target.value })} required/></Field>
            <button type="button" className="icon-button" aria-label={`Quitar ${period.name || `el periodo ${index + 1}`}`} onClick={() => setPeriods(periods.filter(item => item.key !== period.key))}><Icon name="close" size={16}/></button>
          </div>) : <p className="muted small">Sin periodos. Reparte el ciclo automáticamente o agrégalos uno por uno.</p>}
          {periodGaps(periods.filter(item => item.from && item.until)).map(item => <p key={item.from} className="muted small period-gap"><Icon name="sun" size={14}/>Entre {item.after.toLocaleLowerCase("es")} y {item.before.toLocaleLowerCase("es")}: {plural(item.days, "día", "días")} de vacaciones ({span(item)}).</p>)}
          <div className="button-row">
            <label className="gap-field"><span>Días de vacaciones entre periodos</span><input type="number" inputMode="numeric" min={0} max={maxGapDays} step={1} value={gap} onChange={event => setGap(event.target.value)}/></label>
            <button type="button" className="button secondary small" disabled={!datesReady} onClick={() => void divide()}><Icon name="grid" size={16}/>Repartir en {plural(kind.count, kind.label.toLocaleLowerCase("es"), kind.plural)}</button>
            <button type="button" className="button ghost small" disabled={periods.length >= 12} onClick={() => setPeriods([...periods, row({ id: null, name: "", from: "", until: "", weight: 1 })])}><Icon name="plus" size={16}/>Agregar periodo</button>
          </div>
        </fieldset>
        <div className="button-row"><button className="button primary">{busy ? "Guardando…" : year ? "Guardar cambios" : "Crear ciclo"}</button><button type="button" className="button ghost" onClick={onClose}>Cancelar</button></div>
      </fieldset>
    </form>
  </Modal>;
}

/**
 * The year in one list: its periods in order, the vacations between them and the organization's days without class
 * that fall inside each period.
 */
function YearCalendar({ year, breaks }: { year: AcademicYear; breaks: CalendarBreak[] }) {
  const gaps = periodGaps(year.periods);
  const items = [
    ...year.periods.map(period => ({ key: period.id, from: period.from, node: <><strong>{period.name}</strong> <span className="muted">{span(period)}</span>
      {breaks.filter(item => item.from <= period.until && item.until >= period.from).map(item => <span key={item.id} className="calendar-chip">{item.title}: {item.from === item.until ? sessionDay(item.from, "short") : span(item)}</span>)}</> })),
    ...gaps.map(gap => ({ key: `gap-${gap.from}`, from: gap.from, gap: true, node: <span className="muted"><Icon name="sun" size={14}/> Vacaciones · {plural(gap.days, "día", "días")} ({span(gap)}){breaks.some(item => item.from <= gap.from && gap.until <= item.until) ? " · sin clase" : ""}</span> })),
  ].sort((a, b) => a.from.localeCompare(b.from));
  return <ol className="period-list year-calendar" aria-label={`Calendario de ${year.name}`}>{items.map(item => <li key={item.key} className={"gap" in item ? "is-gap" : undefined}>{item.node}</li>)}</ol>;
}
