import { useCallback, useEffect, useState } from "react";
import type { FormEvent } from "react";
import type { AcademicYear, PeriodKind } from "@happy-learners/contracts";
import { academicYearLabels, periodKindOf, periodKinds, splitPeriods } from "@happy-learners/domain";
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
        {year.periods.length > 0 && <ol className="period-list" aria-label={`Periodos de ${year.name}`}>{year.periods.map(period => <li key={period.id}><strong>{period.name}</strong> <span className="muted">{span(period)}</span></li>)}</ol>}
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
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  const kind = periodKindOf(values.periodKind);
  const setPeriod = (key: string, patch: Partial<Row>) => setPeriods(current => current.map(item => item.key === key ? { ...item, ...patch } : item));
  async function divide() {
    if (periods.length && !await confirm({ title: "¿Reemplazar los periodos?", body: <p>Los periodos actuales se sustituyen por {plural(kind.count, kind.label.toLocaleLowerCase("es"), kind.plural)} de duración parecida.</p>, confirm: "Reemplazar" })) return;
    setPeriods(splitPeriods(values.from, values.until, values.periodKind).map(period => row(period)));
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
          <div className="button-row">
            <button type="button" className="button secondary small" disabled={!datesReady} onClick={() => void divide()}><Icon name="grid" size={16}/>Repartir en {plural(kind.count, kind.label.toLocaleLowerCase("es"), kind.plural)}</button>
            <button type="button" className="button ghost small" disabled={periods.length >= 12} onClick={() => setPeriods([...periods, row({ id: null, name: "", from: "", until: "", weight: 1 })])}><Icon name="plus" size={16}/>Agregar periodo</button>
          </div>
        </fieldset>
        <div className="button-row"><button className="button primary">{busy ? "Guardando…" : year ? "Guardar cambios" : "Crear ciclo"}</button><button type="button" className="button ghost" onClick={onClose}>Cancelar</button></div>
      </fieldset>
    </form>
  </Modal>;
}
