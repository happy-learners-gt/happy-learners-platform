import { useEffect, useState } from "react";
import type { FormEvent, ReactNode } from "react";
import type { Contract, HoursReport, HoursRow, HoursState, HoursTotal } from "@happy-learners/contracts";
import type { HoursPay, HoursPeriod } from "@happy-learners/domain";
import { engagementLabels, formatCents, formatMinutes, hoursPay, hoursPayable, hoursPeriodRange as periodRange, periodLabels, personContract, hoursStateLabels, maxAdjustedMinutes, maxAdjustmentReason, maxBatchAdjustments, minAdjustmentReason } from "@happy-learners/domain";
import { api, message } from "../api";
import { useNavigation } from "../navigation";
import { useSession } from "../session";
import { fullDate, sessionDay } from "../model";
import { Modal, useFeedback } from "../ui/feedback";
import { Icon } from "../ui/icons";
import { Button, EmptyState, ErrorState, Field, Loading, PageHeader, Section, StatTiles, StatusBadge } from "../ui/primitives";
import type { Tone } from "../ui/primitives";
import { formatInstantTime, personalToday } from "../regional";
import { Tabs } from "../ui/Tabs";

/** The filters live in the address, in Spanish, and map to the API's parameters. */
const keys = { desde: "from", hasta: "to", curso: "course", seccion: "section", persona: "person" } as const;
const stateTone: Record<HoursState, Tone> = { counted: "success", no_start: "neutral", review: "warning", adjusted: "info" };
const time = (value: string | null) => value ? formatInstantTime(value) : "—";

/**
 * HRS-01 (docs/transformacion/flujos.md F4): the page opens on a period, not on every class ever. `periodo` names a
 * preset; explicit dates («desde», «hasta») are the custom period and win over it.
 */
const periods = [
  { value: "30-dias", label: "Últimos 30 días" }, { value: "mes", label: "Este mes" }, { value: "mes-anterior", label: "Mes anterior" },
  { value: "todo", label: "Todo el historial" }, { value: "personalizado", label: "Personalizado" },
] as const satisfies readonly { value: HoursPeriod | "personalizado"; label: string }[];
type Period = typeof periods[number]["value"];
const pageSize = 25;
type Show = "todas" | "revisar";
type Totalled = "people" | "courses" | "sections";

/** Whether the report covers exactly one calendar month: a monthly amount can then be read per effective hour. */
function wholeMonth(filter: HoursReport["filter"]) {
  if (!filter.from || !filter.to || !filter.from.endsWith("-01") || filter.from.slice(0, 7) !== filter.to.slice(0, 7)) return false;
  const [year, month] = filter.from.split("-").map(Number);
  return Number(filter.to.slice(8)) === new Date(Date.UTC(year, month, 0)).getUTCDate();
}
/** HRS-03 (AP-08): the contract's reading of the hours, as administration sees it; a reference, not payroll. */
function PayCell({ pay, engagement }: { pay: HoursPay; engagement?: string }) {
  switch (pay.kind) {
    case "no-contract": return <span className="muted">Sin contrato vigente</span>;
    case "none": return <span>Ad honorem</span>;
    case "hourly": return <span className="stack-tight"><span>{pay.payable ? formatCents(pay.cents, pay.currency) : `Referencia: ${formatCents(pay.cents, pay.currency)}`}</span>
      <span className="muted small">{formatMinutes(pay.minutes)} × {formatCents(pay.rateCents, pay.currency)} por hora{pay.payable ? "" : ` (${engagement || "contrato"})`}</span></span>;
    case "per-session": return <span className="stack-tight"><span>Referencia: {formatCents(pay.cents, pay.currency)}</span>
      <span className="muted small">{pay.classes === 1 ? "1 clase" : `${pay.classes} clases`} × {formatCents(pay.rateCents, pay.currency)}</span></span>;
    case "fixed": return <span className="stack-tight"><span>{formatCents(pay.amountCents, pay.currency)} {periodLabels[pay.period]}</span>
      <span className="muted small">{pay.perHourCents !== null ? `≈ ${formatCents(pay.perHourCents, pay.currency)} por hora efectiva en el mes` : pay.period === "month" ? "Elige un mes completo para verlo por hora" : "Monto fijo"}</span></span>;
  }
}

/**
 * ST-152: «Horas efectivas» (administration: every person) and «Mis horas» (anyone else: their own classes). The
 * hours of each completed class run from its start to its completion; filters by period, course, section and person,
 * CSV export, and administration's corrections with a reason.
 */
export function HoursPage() {
  const { member } = useSession(), { url, navigate } = useNavigation(), { toast } = useFeedback();
  const admin = member.role === "admin";
  const [report, setReport] = useState<HoursReport | null>(null), [error, setError] = useState(""), [adjusting, setAdjusting] = useState<HoursRow | null>(null), [batch, setBatch] = useState<HoursRow[] | null>(null);
  const custom = !!(url.searchParams.get("desde") || url.searchParams.get("hasta"));
  const requested = url.searchParams.get("periodo") as Period | null;
  const period: Period = custom ? "personalizado" : periods.some(item => item.value === requested) && requested !== "personalizado" ? requested! : "30-dias";
  const range = custom ? null : periodRange(period, personalToday());
  // HRS-03: administration reads every contract; anyone else only theirs.
  const [contracts, setContracts] = useState<Contract[]>([]);
  useEffect(() => { api<{ contracts: Contract[] }>(admin ? "/contracts" : "/me/contracts").then(result => setContracts(result.contracts), () => setContracts([])); }, [admin]);
  const [show, setShow] = useState<Show>("todas"), [shown, setShown] = useState(pageSize), [totalled, setTotalled] = useState<Totalled>(admin ? "people" : "courses");
  const query = new URLSearchParams([
    ...(range ? [["from", range.from], ["to", range.to]] : []),
    ...Object.entries(keys).flatMap(([local, remote]) => { const value = url.searchParams.get(local); return value ? [[remote, value]] : []; }),
  ]).toString();
  useEffect(() => { setShown(pageSize); }, [query, show]);
  const load = async () => { setError(""); try { setReport(await api<HoursReport>(`/hours${query ? `?${query}` : ""}`)); } catch (cause) { setError(message(cause)); } };
  useEffect(() => { void load(); }, [query]);
  // HRS-04: opened without a period, an empty last 30 days moves to the latest month with classes, and says so.
  const explicit = ["periodo", "desde", "hasta"].some(key => url.searchParams.has(key));
  const monthOf = (day: string) => { const [year, month] = day.split("-").map(Number); return { from: `${day.slice(0, 7)}-01`, to: `${day.slice(0, 7)}-${String(new Date(Date.UTC(year, month, 0)).getUTCDate()).padStart(2, "0")}` }; };
  const showMonth = (day: string, automatic: boolean) => {
    const next = new URL(url), month = monthOf(day);
    next.searchParams.delete("periodo"); next.searchParams.set("desde", month.from); next.searchParams.set("hasta", month.to);
    if (automatic) next.searchParams.set("ultimo", "1"); else next.searchParams.delete("ultimo");
    navigate(next.pathname + next.search, true);
  };
  useEffect(() => { if (!explicit && report && !report.rows.length && report.latestDay) showMonth(report.latestDay, true); }, [report]);
  const monthName = (day: string) => new Intl.DateTimeFormat("es", { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(`${day.slice(0, 7)}-01T00:00:00Z`));
  function filter(key: keyof typeof keys, value: string) {
    const next = new URL(url); if (value) next.searchParams.set(key, value); else next.searchParams.delete(key);
    if (key === "curso") next.searchParams.delete("seccion");
    if (key === "desde" || key === "hasta") next.searchParams.delete("periodo");
    navigate(next.pathname + next.search, true);
  }
  function choosePeriod(value: Period) {
    const next = new URL(url);
    next.searchParams.delete("desde"); next.searchParams.delete("hasta");
    if (value === "personalizado") { const preset = periodRange(period, personalToday()); if (preset) { next.searchParams.set("desde", preset.from); next.searchParams.set("hasta", preset.to); } next.searchParams.delete("periodo"); }
    else if (value === "30-dias") next.searchParams.delete("periodo"); else next.searchParams.set("periodo", value);
    navigate(next.pathname + next.search, true);
  }
  const title = admin ? "Horas efectivas" : "Mis horas";
  const header = <PageHeader title={title} description={admin ? "Las horas que cada educador imparte, desde que comienza cada clase hasta que la finaliza. Reconocen el voluntariado ad honorem y ayudan a equilibrar la carga." : "Las horas que impartes, desde que comienzas cada clase hasta que la finalizas. Reconocen tu voluntariado ad honorem."}
    actions={<a className="button secondary" href={`/api/hours/export${query ? `?${query}` : ""}`} download><Icon name="download" size={18}/><span>Exportar CSV</span></a>}/>;
  if (error && !report) return <>{header}<ErrorState error={error} retry={() => void load()}/></>;
  if (!report) return <>{header}<Loading label="Cargando las horas…" lines={6}/></>;
  const value = (key: keyof typeof keys) => url.searchParams.get(key) || "";
  const course = value("curso"), sections = report.options.sections.filter(item => !course || item.courseId === course);
  const toReview = (row: HoursRow) => row.state === "review" || row.state === "no_start";
  const counted = report.rows.filter(row => row.minutes > 0).length, pending = report.rows.filter(toReview).length;
  const any = Object.keys(keys).some(key => url.searchParams.get(key)) || !!url.searchParams.get("periodo");
  const listed = show === "revisar" ? report.rows.filter(toReview) : report.rows;
  // HRS-02: the classes «por revisar» that a batch can correct with their planned duration.
  const batchable = admin ? report.rows.filter(row => toReview(row) && !!row.plannedMinutes && !!row.educatorId).slice(0, maxBatchAdjustments) : [];
  const totals = { people: report.totals.people, courses: report.totals.courses, sections: report.totals.sections };
  const month = wholeMonth(report.filter);
  const payOf = (userId: string) => {
    const contract = personContract(contracts, userId), own = report.rows.filter(row => row.educatorId === userId);
    return { contract, pay: hoursPay(contract, { minutes: own.reduce((sum, row) => sum + row.minutes, 0), classes: own.filter(row => row.minutes > 0).length }, month) };
  };
  const mine = !admin ? payOf(member.id) : null, minePay = mine?.contract && hoursPayable(mine.contract) && mine.pay.kind === "hourly" ? mine.pay : null;
  return <>
    {header}
    <div className="class-filters" role="group" aria-label="Filtrar horas">
      <Field label="Periodo"><select value={period} onChange={event => choosePeriod(event.target.value as Period)}>
        {periods.map(item => <option key={item.value} value={item.value}>{item.label}</option>)}
      </select></Field>
      {period === "personalizado" && <><Field label="Desde"><input type="date" value={value("desde")} max={value("hasta") || undefined} onChange={event => filter("desde", event.target.value)}/></Field>
      <Field label="Hasta" error={error || undefined}><input type="date" value={value("hasta")} min={value("desde") || undefined} onChange={event => filter("hasta", event.target.value)}/></Field></>}
      <Field label="Curso"><select value={course} onChange={event => filter("curso", event.target.value)}>
        <option value="">Todos los cursos</option>{report.options.courses.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
      </select></Field>
      <Field label="Sección"><select value={value("seccion")} onChange={event => filter("seccion", event.target.value)}>
        <option value="">Todas las secciones</option>{sections.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
      </select></Field>
      {admin && <Field label="Educador"><select value={value("persona")} onChange={event => filter("persona", event.target.value)}>
        <option value="">Todas las personas</option>{report.options.people.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
      </select></Field>}
      {any && <Button icon="close" variant="ghost" onClick={() => navigate(url.pathname, true)}>Limpiar filtros</Button>}
    </div>
    <StatTiles items={[
      { label: "Horas efectivas", value: formatMinutes(report.minutes), icon: "clock", hue: "violet" },
      { label: "Clases que suman", value: counted, icon: "check", hue: "green" },
      { label: "Por revisar", value: pending, icon: "alert", hue: "amber" },
      ...(minePay ? [{ label: "Según tu contrato", value: formatCents(minePay.cents, minePay.currency), icon: "file" as const, hue: "teal" as const }] : []),
    ]}/>
    {minePay && <p className="muted small">{formatMinutes(minePay.minutes)} × {formatCents(minePay.rateCents, minePay.currency)} por hora, con tu contrato vigente. Es una referencia: el pago lo confirma administración.</p>}
    {report.truncated && <p className="message-bar warning" role="status"><Icon name="alert" size={18}/>
      <span>Hay más clases de las que se suman de una vez: se muestran las más recientes y los totales son parciales. Elige un periodo para ver sumas completas.</span></p>}
    {url.searchParams.get("ultimo") === "1" && report.rows.length > 0 && <p className="message-bar" role="status"><Icon name="info" size={18}/><span>Los últimos 30 días no tienen clases finalizadas: se muestra {monthName(value("desde"))}, el último mes con clases.</span></p>}
    {range && <p className="muted small">Del {sessionDay(range.from, "short")} al {sessionDay(range.to, "short")}.</p>}
    <p className="muted small">Solo suman las clases finalizadas. Una clase cancelada o sin finalizar no suma horas; una sin registro de inicio o de más de 8 h suma 0 hasta que administración la corrige. Fechas y horas en {report.timezone}.</p>
    {!report.rows.length ? <EmptyState icon="clock" title="No hay clases finalizadas en este filtro"
      // After a break the period is empty but the history is not: one step to see it.
      action={report.latestDay ? <Button variant="secondary" onClick={() => showMonth(report.latestDay!, false)}>{`Ver ${monthName(report.latestDay)}, el último mes con clases`}</Button>
        : range && report.options.courses.length > 0 ? <Button variant="secondary" onClick={() => choosePeriod("todo")}>Ver todo el historial</Button> : undefined}>
      {admin ? "Las horas aparecen cuando un educador comienza y finaliza una clase." : "Tus horas aparecen cuando comienzas y finalizas una clase."}</EmptyState> : <>
      <Section title="Totales">
        <Tabs label="Totales por" value={totalled} onChange={setTotalled} items={[
          ...(admin ? [{ value: "people" as const, label: "Por educador" }] : []), { value: "courses" as const, label: "Por curso" }, { value: "sections" as const, label: "Por sección" },
        ]}>
          <Totals label={totalled === "people" ? "Educador" : totalled === "courses" ? "Curso" : "Sección"} items={totals[totalled]}
            pay={admin && totalled === "people" ? id => { const { contract, pay } = payOf(id); return <PayCell pay={pay} engagement={contract ? engagementLabels[contract.engagement].toLowerCase() : undefined}/>; } : undefined}/>
          {admin && totalled === "people" && <p className="muted small">«Según contrato» lee las horas de este filtro con el contrato vigente de cada persona. Solo los contratos por hora que no son de empleo, voluntariado ni servicios profesionales dan un monto por horas registradas; el resto es una referencia. No es un cálculo de nómina.</p>}
        </Tabs>
      </Section>
      <Section title="Clases impartidas" action={pending > 0 ? <div className="chips" role="group" aria-label="Mostrar">
        {([["todas", `Todas (${report.rows.length})`], ["revisar", `Por revisar (${pending})`]] as const).map(([value, label]) =>
          <button key={value} type="button" className="chip-button" aria-pressed={show === value} onClick={() => setShow(value)}>{label}</button>)}
      </div> : undefined}>
        <div className="table-card" role="region" aria-label="Clases impartidas" tabIndex={0}><table className="members-table hours-table" aria-label="Clases impartidas">
          <thead><tr><th scope="col">Fecha</th><th scope="col">Curso y sección</th>{admin && <th scope="col">Educador</th>}<th scope="col">Inicio y fin</th><th scope="col">Horas</th><th scope="col">Estado</th>{admin && <th scope="col"><span className="sr-only">Acciones</span></th>}</tr></thead>
          <tbody>{listed.slice(0, shown).map(row => <tr key={row.sessionId}>
            <th scope="row">{sessionDay(row.day, "short")}</th>
            <td>{row.courseTitle}<br/><span className="muted small">{row.sectionName}</span></td>
            {admin && <td>{row.educatorName || "Sin registro"}</td>}
            <td>{time(row.startedAt)} – {time(row.completedAt)}</td>
            <td>{formatMinutes(row.minutes)}{row.state === "adjusted" && row.computedMinutes !== row.minutes && <><br/><span className="muted small">Calculadas: {formatMinutes(row.computedMinutes)}</span></>}</td>
            <td><StatusBadge tone={stateTone[row.state]}>{hoursStateLabels[row.state]}</StatusBadge>
              {row.adjustment && <p className="muted small" title={fullDate(row.adjustment.adjustedAt)}>Motivo: {row.adjustment.reason}</p>}</td>
            {admin && <td><Button variant="ghost" icon="edit" aria-label={`Corregir las horas de la clase del ${sessionDay(row.day, "short")} en ${row.sectionName}`} onClick={() => setAdjusting(row)}>Corregir</Button></td>}
          </tr>)}</tbody>
        </table></div>
        {show === "revisar" && batchable.length > 0 && <div className="button-row"><Button variant="secondary" icon="check" onClick={() => setBatch(batchable)}>
          {batchable.length === 1 ? "Corregir 1 clase con su duración planificada" : `Corregir ${batchable.length} clases con su duración planificada`}</Button></div>}
        {listed.length > shown && <div className="button-row"><Button variant="secondary" onClick={() => setShown(shown + pageSize)}>Mostrar {Math.min(pageSize, listed.length - shown)} más de {listed.length - shown}</Button></div>}
      </Section>
    </>}
    {batch && <BatchDialog rows={batch} onClose={() => setBatch(null)} onDone={async text => { setBatch(null); toast({ message: text }); await load(); }}/>}
    {adjusting && <AdjustDialog row={adjusting} onClose={() => setAdjusting(null)} onDone={async text => { setAdjusting(null); toast({ message: text }); await load(); }}/>}
  </>;
}

function Totals({ label, items, pay }: { label: string; items: HoursTotal[]; pay?: (id: string) => ReactNode }) {
  return <div className="table-card" role="region" aria-label={`Horas por ${label.toLowerCase()}`} tabIndex={0}><table className="members-table" aria-label={`Horas por ${label.toLowerCase()}`}>
    <thead><tr><th scope="col">{label}</th><th scope="col">Clases</th><th scope="col">Horas</th>{pay && <th scope="col">Según contrato</th>}</tr></thead>
    <tbody>{items.map(item => <tr key={item.id}><th scope="row">{item.name}</th><td>{item.classes}</td><td>{formatMinutes(item.minutes)}</td>{pay && <td>{pay(item.id)}</td>}</tr>)}</tbody>
  </table></div>;
}

/** HRS-02: the classes «por revisar» get their planned duration at once, with one reason; each keeps its correction. */
function BatchDialog({ rows, onClose, onDone }: { rows: HoursRow[]; onClose: () => void; onDone: (text: string) => Promise<void> }) {
  const [reason, setReason] = useState(""), [busy, setBusy] = useState(false), [error, setError] = useState("");
  const minutes = rows.reduce((sum, row) => sum + (row.plannedMinutes || 0), 0), valid = reason.trim().length >= minAdjustmentReason;
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!valid) return;
    setBusy(true); setError("");
    try {
      const result = await api<{ corrected: number; skipped: number; minutes: number }>("/hours/adjustments", "POST", { sessionIds: rows.map(row => row.sessionId), reason });
      await onDone(`${result.corrected === 1 ? "1 clase corregida" : `${result.corrected} clases corregidas`} (${formatMinutes(result.minutes)}).${result.skipped ? ` ${result.skipped} ya no estaban por revisar.` : ""} Quedó en la actividad.`);
    } catch (cause) { setError(message(cause)); setBusy(false); }
  }
  return <Modal title="Corregir con la duración planificada" onClose={onClose}>
    <form className="stack" onSubmit={submit} aria-label="Corregir con la duración planificada"><fieldset className="stack" disabled={busy}>
      {error && <p className="form-alert" role="alert"><Icon name="alert" size={18}/>{error}</p>}
      <p>{rows.length === 1 ? "1 clase por revisar suma" : `${rows.length} clases por revisar suman`} {formatMinutes(minutes)} con la duración que tenían planificada. Cada una conserva a su educador y su corrección queda en el historial; después puedes corregir cualquiera de a una.</p>
      <Field label="Motivo de la corrección" hint={`De ${minAdjustmentReason} a ${maxAdjustmentReason} caracteres. Queda en la actividad.`}>
        <textarea rows={3} required minLength={minAdjustmentReason} maxLength={maxAdjustmentReason} value={reason} onChange={event => setReason(event.target.value)}/>
      </Field>
      <div className="modal-actions">
        <button type="button" className="button ghost" onClick={onClose}>Cancelar</button>
        <button className="button primary" disabled={!valid}>{busy ? "Guardando…" : "Corregir clases"}</button>
      </div>
    </fieldset></form>
  </Modal>;
}

/** Administration corrects the minutes or the person of a completed class; the reason is mandatory and goes to the activity. */
function AdjustDialog({ row, onClose, onDone }: { row: HoursRow; onClose: () => void; onDone: (text: string) => Promise<void> }) {
  const [minutes, setMinutes] = useState(String(row.minutes)), [educatorId, setEducatorId] = useState(row.educatorId || ""), [reason, setReason] = useState("");
  const [people, setPeople] = useState<{ id: string; name: string; username: string }[]>([]), [busy, setBusy] = useState(false), [error, setError] = useState("");
  useEffect(() => { api<{ people: { id: string; name: string; username: string }[] }>("/people").then(result => setPeople(result.people), cause => setError(message(cause))); }, []);
  const number = Number(minutes), validMinutes = minutes.trim() !== "" && Number.isInteger(number) && number >= 0 && number <= maxAdjustedMinutes;
  const validReason = reason.trim().length >= minAdjustmentReason;
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!validMinutes || !validReason || !educatorId) return;
    setBusy(true); setError("");
    try { await api(`/hours/${row.sessionId}/adjustment`, "POST", { minutes: number, educatorId, reason }); await onDone(`Horas corregidas: ${formatMinutes(number)}. La corrección quedó en la actividad.`); }
    catch (cause) { setError(message(cause)); setBusy(false); }
  }
  const known = people.some(person => person.id === row.educatorId);
  return <Modal title="Corregir las horas de la clase" onClose={onClose}>
    <form className="stack" onSubmit={submit} aria-label="Corregir las horas de la clase"><fieldset className="stack" disabled={busy}>
      {error && <p className="form-alert" role="alert"><Icon name="alert" size={18}/>{error}</p>}
      <p>{row.courseTitle} · {row.sectionName}, {sessionDay(row.day)}. Calculadas: {formatMinutes(row.computedMinutes)} ({hoursStateLabels[row.state].toLowerCase()}).</p>
      <Field label="Minutos efectivos" hint={`Número entero de 0 a ${maxAdjustedMinutes}.`} error={minutes && !validMinutes ? `Escribe un número entero de 0 a ${maxAdjustedMinutes}.` : undefined}>
        <input type="number" inputMode="numeric" min={0} max={maxAdjustedMinutes} step={1} required value={minutes} onChange={event => setMinutes(event.target.value)}/>
      </Field>
      <Field label="Educador que impartió la clase">
        <select required value={educatorId} onChange={event => setEducatorId(event.target.value)}>
          <option value="">Elige una persona</option>
          {row.educatorId && !known && <option value={row.educatorId}>{row.educatorName || row.educatorId}</option>}
          {people.map(person => <option key={person.id} value={person.id}>{person.name} (@{person.username})</option>)}
        </select>
      </Field>
      <Field label="Motivo de la corrección" hint={`De ${minAdjustmentReason} a ${maxAdjustmentReason} caracteres. Queda en la actividad.`}>
        <textarea rows={3} required minLength={minAdjustmentReason} maxLength={maxAdjustmentReason} value={reason} onChange={event => setReason(event.target.value)}/>
      </Field>
      <div className="modal-actions">
        <button type="button" className="button ghost" onClick={onClose}>Cancelar</button>
        <button className="button primary" disabled={!validMinutes || !validReason || !educatorId}>{busy ? "Guardando…" : "Guardar corrección"}</button>
      </div>
    </fieldset></form>
  </Modal>;
}
