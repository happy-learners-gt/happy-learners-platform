import { useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";
import type { BellSchedule, ClassSession, SectionSchedule } from "@happy-learners/contracts";
import { meetingFromBlocks, meetingsOf, scheduleDates, scheduleSuggestion } from "@happy-learners/domain";
import { api, message } from "../../api";
import { Link } from "../../navigation";
import { plural, sessionDay } from "../../model";
import { useFeedback } from "../../ui/feedback";
import { Icon } from "../../ui/icons";
import { EmptyState, ErrorState, Field, Loading, PageHeader, PrimaryAction, Section } from "../../ui/primitives";
import { useCourse } from "./context";
import { sectionCrumbs, useSection } from "../sections/context";
import { DaysOff, useBreaks } from "../calendar";
import { useAcademicYears } from "../academic-years";
import { useBellSchedules } from "../bell-schedules";
import { classMoment, currentRegional, differentZone, formatClock, formatClockRange, weekOrder, zoneName } from "../../regional";

const addDays = (day: string, days: number) => { const date = new Date(`${day}T00:00:00Z`); date.setUTCDate(date.getUTCDate() + days); return date.toISOString().slice(0, 10); };
const addMonths = (day: string, months: number) => { const date = new Date(`${day}T00:00:00Z`); date.setUTCMonth(date.getUTCMonth() + months); return date.toISOString().slice(0, 10); };
const endTime = (start: string, minutes: number) => { const [hours, mins] = start.split(":").map(Number), total = hours * 60 + mins + minutes; return `${String(Math.floor(total / 60) % 24).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`; };
const lower = (text: string) => text.charAt(0).toLocaleLowerCase("es") + text.slice(1);
const durations = [30, 40, 45, 50, 60, 80, 90, 120];
type Values = { weekdays: number[]; startsAt: string; durationMinutes: string; from: string; until: string; perDay: boolean; times: Record<number, { startsAt: string; durationMinutes: string }> };
/** Each day's time: «Lunes 07:30–09:00, miércoles 10:00–10:40». */
const meetingsText = (schedule: SectionSchedule) => meetingsOf(schedule).map((item, index) => `${index ? lower(dayList([item.weekday])) : dayList([item.weekday])} ${formatClockRange(item.startsAt, endTime(item.startsAt, item.durationMinutes))}`).join(", ");

/**
 * ST-160: a weekly schedule is set in the organization's zone (DEC-035). When the person reads another zone, the
 * sentence adds the start in theirs, on a sample day (offsets change with daylight saving time).
 */
function zoneHint(startsAt: string, day: string) {
  if (!differentZone() || !day) return "";
  const when = classMoment(day, startsAt);
  return ` (hora de la organización; en tu zona, ${when.clock}${when.day > day ? " del día siguiente" : when.day < day ? " del día anterior" : ""})`;
}

/** "Lunes y miércoles" */
export function dayList(days: number[], style: "long" | "short" = "long") {
  const names = weekOrder().filter(([day]) => days.includes(day)).map(([, name, short]) => lower(style === "long" ? name : short));
  const text = names.length > 1 ? `${names.slice(0, -1).join(", ")} y ${names[names.length - 1]}` : names[0] || "";
  return text.charAt(0).toLocaleUpperCase("es") + text.slice(1);
}

/**
 * Horario: when the section meets and for how long. It reads as a sentence and a week; administration edits it
 * with a preview of the classes it will generate, and manages the days without class next to it.
 */
export function Timetable() {
  const { course, configurable } = useCourse();
  const { section, base, reload } = useSection();
  const [sessions, setSessions] = useState<ClassSession[] | null>(null), [today, setToday] = useState(""), [error, setError] = useState("");
  const [editing, setEditing] = useState(false);
  const breaks = useBreaks(section.id, course.status === "active");
  async function load() {
    setError("");
    try {
      const result = await api<{ sessions: ClassSession[]; today: string }>(`/courses/${course.id}/sessions`);
      setSessions(result.sessions.filter(session => session.groupId === section.id)); setToday(result.today);
    } catch (cause) { setError(message(cause)); }
  }
  useEffect(() => { if (course.status === "active") void load(); }, [course.id, section.id]);
  const schedule = section.schedule, writable = configurable && section.status === "active";
  const refresh = async () => { await Promise.all([load(), reload(), breaks.load()]); };
  const header = <PageHeader crumbs={sectionCrumbs(section, { label: "Horario" })} title="Horario"
    description={schedule ? <>{schedule.meetings?.length ? meetingsText(schedule) : <>{dayList(schedule.weekdays)}, de {formatClock(schedule.startsAt)} a {formatClock(endTime(schedule.startsAt, schedule.durationMinutes))}</>}{zoneHint(schedule.startsAt, today)}. {writable ? "Al cambiarlo, las clases pendientes se reprograman solas." : "Administración lo configura; tú planificas cada clase en el cronograma."}</>
      : writable ? "Elige los días, la hora y el periodo. Las clases de la sección se programan solas." : "Administración configura el horario de la sección; tú planificas cada clase en el cronograma."}
    primary={writable && schedule && !editing && sessions && <PrimaryAction icon="edit" onClick={() => setEditing(true)}>Editar horario</PrimaryAction>}/>;
  if (course.status !== "active") return <>{header}<EmptyState icon="archive" title="Curso archivado">El horario vuelve a estar disponible cuando administración restaura el curso.</EmptyState></>;
  if (error) return <>{header}<ErrorState error={error} retry={() => void load()}/></>;
  if (!sessions) return <>{header}<Loading label="Cargando horario…" cards={1}/></>;
  if (section.status !== "active") return <>{header}<EmptyState icon="archive" title="Sección cerrada">Conserva su historial de clases. Administración puede reactivarla para volver a programar clases.</EmptyState></>;
  return <>
    {header}
    <div className="dashboard timetable-layout">
      <div className="dashboard-main">
        {writable && (editing || !schedule)
          ? <ScheduleEditor schedule={schedule} sessions={sessions} today={today} breaks={breaks.breaks || []} onDone={async saved => { setEditing(false); if (saved) await refresh(); }}/>
          : schedule ? <ScheduleSummary schedule={schedule} sessions={sessions} today={today} base={base}/>
          : <EmptyState icon="clock" title="La sección aún no tiene horario">Cuando administración lo configure, sus clases aparecerán en el <Link href={`${base}/clases`}>cronograma</Link>. También puedes agregar clases a mano desde ahí.</EmptyState>}
      </div>
      <div className="dashboard-side">
        <DaysOff section={section} writable={writable} data={breaks} onChanged={async () => { await Promise.all([load(), reload()]); }}/>
      </div>
    </div>
  </>;
}

/** The section's week at a glance: which days it meets, from when to when, and what the period holds. */
function ScheduleSummary({ schedule, sessions, today, base }: { schedule: SectionSchedule; sessions: ClassSession[]; today: string; base: string }) {
  const { section } = useSection();
  const pending = sessions.filter(session => session.status === "planned" && session.sessionDate >= today);
  const taught = sessions.filter(session => session.status === "completed").length;
  const ended = schedule.until < today, next = section.next;
  return <Section title={`Semana de ${section.name}`} className="timetable" action={<Link href={`${base}/clases`} className="section-link">Ver cronograma</Link>}>
    <Week days={schedule.weekdays} time={formatClockRange(schedule.startsAt, endTime(schedule.startsAt, schedule.durationMinutes))} times={schedule.meetings?.length ? Object.fromEntries(schedule.meetings.map(item => [item.weekday, formatClockRange(item.startsAt, endTime(item.startsAt, item.durationMinutes))])) : undefined}/>
    {ended && <p className="notice"><Icon name="info" size={18}/>El periodo terminó el {lower(sessionDay(schedule.until))}. Para seguir con clases, se programa un nuevo periodo.</p>}
    <dl className="schedule-facts">
      <div><dt>Periodo</dt><dd>{sessionDay(schedule.from, "short")} – {sessionDay(schedule.until, "short")}</dd></div>
      <div><dt>Duración</dt><dd>{schedule.meetings?.length ? meetingsOf(schedule).map(item => `${item.durationMinutes}`).join(" / ") + " min según el día" : `${schedule.durationMinutes} min por clase`}</dd></div>
      <div><dt>Próxima clase</dt><dd>{next ? (() => { const when = classMoment(next.sessionDate, next.startsAt); return <Link href={`${base}/clases/${next.id}`}>{sessionDay(when.day, "short")}{when.clock ? `, ${when.clock}` : ""}</Link>; })() : "Sin clases próximas"}</dd></div>
      <div><dt>Clases</dt><dd>{plural(pending.length, "pendiente", "pendientes")} · {plural(taught, "impartida", "impartidas")}</dd></div>
    </dl>
  </Section>;
}

/** Monday to Sunday, with the class days marked and their time. */
function Week({ days, time, times }: { days: number[]; time?: string; times?: Record<number, string> }) {
  return <ol className="week-strip" aria-label="Días de clase">{weekOrder().map(([day, name, short]) => {
    const on = days.includes(day);
    return <li key={day} className={on ? "is-on" : undefined}><abbr title={name}>{short}</abbr>{on ? <span>{times?.[day] ?? time}</span> : <span className="sr-only">sin clase</span>}<span className="sr-only">{on ? `: ${name}, clase` : `: ${name}`}</span></li>;
  })}</ol>;
}

/** Administration sets the days, time and period, and sees what will be generated before saving. */
function ScheduleEditor({ schedule, sessions, today, breaks, onDone }: { schedule?: SectionSchedule | null; sessions: ClassSession[]; today: string; breaks: { title: string; from: string; until: string }[]; onDone: (saved: boolean) => Promise<void> }) {
  const { course } = useCourse();
  const { section } = useSection();
  const { toast, confirm } = useFeedback();
  const [values, setValues] = useState<Values>(() => schedule
    ? { weekdays: schedule.weekdays, startsAt: schedule.startsAt, durationMinutes: String(schedule.durationMinutes), from: schedule.from, until: schedule.until, perDay: !!schedule.meetings?.length,
      times: Object.fromEntries(meetingsOf(schedule).map(item => [item.weekday, { startsAt: item.startsAt, durationMinutes: String(item.durationMinutes) }])) }
    : { weekdays: [], startsAt: "08:00", durationMinutes: "45", from: today, until: addMonths(today, 3), perDay: false, times: {} });
  const { schedules: jornadas } = useBellSchedules();
  const [jornadaId, setJornadaId] = useState("");
  const jornada = jornadas?.find(item => item.id === jornadaId) || null;
  const timeOf = (day: number) => values.times[day] || { startsAt: values.startsAt, durationMinutes: values.durationMinutes };
  const setTime = (day: number, patch: Partial<{ startsAt: string; durationMinutes: string }>) => setValues(current => ({ ...current, times: { ...current.times, [day]: { ...(current.times[day] || { startsAt: current.startsAt, durationMinutes: current.durationMinutes }), ...patch } } }));
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  // A new schedule suggests the current school year's dates; they stay the section's own and can be changed.
  const { years } = useAcademicYears(), datesTouched = useRef(!!schedule);
  const set = (patch: Partial<Values>) => { if ("from" in patch || "until" in patch) datesTouched.current = true; setValues(current => ({ ...current, ...patch })); };
  const currentYear = years?.find(year => year.status === "current"), suggestion = scheduleSuggestion(currentYear, today);
  useEffect(() => { if (suggestion && !datesTouched.current) setValues(current => ({ ...current, ...suggestion })); }, [suggestion?.from, suggestion?.until]);
  const path = `/courses/${course.id}/groups/${section.id}/schedule`;
  const minutes = Number(values.durationMinutes) || 0;
  const perDayValid = !values.perDay || values.weekdays.every(day => /^\d{2}:\d{2}$/.test(timeOf(day).startsAt) && Number(timeOf(day).durationMinutes) >= 5);
  const valid = values.weekdays.length > 0 && values.from && values.until && values.until >= values.from && minutes >= 5 && perDayValid;
  const dates = valid ? scheduleDates(values, today) : [], kept = valid ? scheduleDates(values, today, breaks) : [];
  const skipped = dates.length - kept.length;
  const pending = sessions.filter(session => session.origin === "schedule" && session.status === "planned" && session.sessionDate >= today).length;
  const options = durations.includes(minutes) || !minutes ? durations : [...durations, minutes].sort((a, b) => a - b);
  async function save(event: FormEvent) {
    event.preventDefault();
    setBusy(true); setError("");
    try {
      const { perDay: _, times: __, ...single } = values;
      const body = values.perDay
        ? { from: values.from, until: values.until, meetings: values.weekdays.map(day => ({ weekday: day, startsAt: timeOf(day).startsAt, durationMinutes: Number(timeOf(day).durationMinutes) })) }
        : { ...single, durationMinutes: minutes };
      const result = await api<{ classes: number }>(path, "PUT", body);
      toast({ message: `Horario guardado: ${plural(result.classes, "clase pendiente", "clases pendientes")} en el cronograma.` });
      await onDone(true);
    } catch (cause) { setError(message(cause)); setBusy(false); }
  }
  async function remove() {
    if (!await confirm({ title: `¿Quitar el horario de «${section.name}»?`, body: <p>Se eliminan {plural(pending, "clase pendiente generada", "clases pendientes generadas")} por el horario. Las clases impartidas y las agregadas a mano se conservan.</p>, confirm: "Quitar horario", danger: true })) return;
    setBusy(true);
    try { await api(path, "DELETE"); toast({ message: "Horario quitado." }); await onDone(true); }
    catch (cause) { toast({ tone: "error", message: message(cause) }); setBusy(false); }
  }
  return <Section title={schedule ? "Editar horario" : "Configurar horario"} className="schedule-editor">
    <form className="stack" onSubmit={save} aria-label={`Horario de ${section.name}`}>
      {error && <p className="form-alert" role="alert"><Icon name="alert" size={18}/>{error}</p>}
      <fieldset disabled={busy} className="stack">
        <fieldset className="day-toggles"><legend>¿Qué días hay clase?</legend>
          {weekOrder().map(([day, name, short]) => <label key={day} title={name}><input type="checkbox" checked={values.weekdays.includes(day)} aria-label={name} onChange={() => set({ weekdays: values.weekdays.includes(day) ? values.weekdays.filter(value => value !== day) : [...values.weekdays, day] })}/><span aria-hidden="true">{short}</span></label>)}
        </fieldset>
        <div className="schedule-mode" role="radiogroup" aria-label="Hora de las clases">
          <label><input type="radio" name="schedule-mode" checked={!values.perDay} onChange={() => set({ perDay: false })}/>La misma hora todos los días</label>
          <label><input type="radio" name="schedule-mode" checked={values.perDay} onChange={() => set({ perDay: true })}/>Una hora por día</label>
          {!!jornadas?.length && <label className="schedule-jornada"><span>Periodos de la jornada</span><select value={jornadaId} onChange={event => setJornadaId(event.target.value)}><option value="">Sin jornada</option>{jornadas.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>}
        </div>
        {!values.perDay ? <div className="field-row">
          {jornada && <BlockPicker jornada={jornada} label="Periodos" onPick={meeting => set({ startsAt: meeting.startsAt, durationMinutes: String(meeting.durationMinutes) })}/>}
          <Field label="Hora" hint={minutes ? `Termina a las ${endTime(values.startsAt || "00:00", minutes)}.` : undefined}><input type="time" value={values.startsAt} onChange={event => set({ startsAt: event.target.value })} required/></Field>
          <Field label="Duración"><select value={values.durationMinutes} onChange={event => set({ durationMinutes: event.target.value })}>{options.map(value => <option key={value} value={value}>{value < 60 || value % 60 ? `${value} min` : `${value / 60} h`}</option>)}</select></Field>
        </div>
          : !values.weekdays.length ? <p className="muted small">Elige los días de clase para darle a cada uno su hora.</p>
          : <div className="meeting-table-wrap"><table className="meeting-table"><thead><tr><th scope="col">Día</th>{jornada && <th scope="col">Periodos</th>}<th scope="col">Hora</th><th scope="col">Minutos</th><th scope="col">Termina</th></tr></thead>
            <tbody>{weekOrder().filter(([day]) => values.weekdays.includes(day)).map(([day, name]) => {
              const time = timeOf(day), length = Number(time.durationMinutes) || 0;
              return <tr key={day}>
                <th scope="row">{name}</th>
                {jornada && <td><BlockPicker jornada={jornada} label={`Periodos del ${lower(name)}`} onPick={meeting => setTime(day, { startsAt: meeting.startsAt, durationMinutes: String(meeting.durationMinutes) })}/></td>}
                <td><input type="time" aria-label={`Hora del ${lower(name)}`} value={time.startsAt} onChange={event => setTime(day, { startsAt: event.target.value })} required/></td>
                <td><input type="number" className="meeting-minutes" aria-label={`Minutos del ${lower(name)}`} min={5} max={480} step={5} value={time.durationMinutes} onChange={event => setTime(day, { durationMinutes: event.target.value })}/></td>
                <td className="muted">{length >= 5 && time.startsAt ? endTime(time.startsAt, length) : "—"}</td>
              </tr>;
            })}</tbody></table></div>}
        <div className="field-row">
          <Field label="Desde"><input type="date" value={values.from} onChange={event => set({ from: event.target.value, ...(values.until && event.target.value > values.until ? { until: addMonths(event.target.value, 3) } : {}) })} required/></Field>
          <Field label="Hasta"><input type="date" value={values.until} min={values.from} onChange={event => set({ until: event.target.value })} required/></Field>
        </div>
        <div className="period-shortcuts" role="group" aria-label="Duración del periodo">
          <span className="muted small">Periodo de</span>
          {currentYear && suggestion && <button type="button" className="chip-button" aria-pressed={values.from === suggestion.from && values.until === suggestion.until} onClick={() => set(suggestion)}>{currentYear.name}</button>}
          {[[1, "1 mes"], [3, "3 meses"], [6, "6 meses"], [10, "10 meses"]].map(([months, label]) => <button key={label} type="button" className="chip-button" aria-pressed={values.from ? values.until === addDays(addMonths(values.from, months as number), -1) : false} onClick={() => set({ until: addDays(addMonths(values.from || today, months as number), -1) })}>{label}</button>)}
        </div>
        <div className="schedule-preview" role="status">
          <Icon name="calendar" size={20}/>
          {!values.weekdays.length ? <p>Elige al menos un día de clase.</p>
            : !valid ? <p>Revisa el periodo: la fecha final va después de la inicial.</p>
            : <div>
              <p><strong>{kept.length ? plural(kept.length, "clase", "clases") : "Ninguna clase"}</strong>{kept.length ? <>: {values.perDay ? lower(values.weekdays.length ? weekOrder().filter(([day]) => values.weekdays.includes(day)).map(([day, name]) => `${lower(name)} ${formatClock(timeOf(day).startsAt)}`).join(", ") : "") : <>{lower(dayList(values.weekdays))} de {formatClock(values.startsAt)} a {formatClock(endTime(values.startsAt, minutes))}</>}, del {lower(sessionDay(kept[0], "short"))} al {lower(sessionDay(kept[kept.length - 1], "short"))}.</> : " en el periodo elegido a partir de hoy."}</p>
              {skipped > 0 && <p className="muted small">{plural(skipped, "día cae", "días caen")} en días sin clase y no se programa{skipped === 1 ? "" : "n"}.</p>}
              {schedule && pending > 0 && <p className="muted small">Se reprograman {plural(pending, "clase pendiente", "clases pendientes")} del horario actual; sus lecciones pasan, en orden, a las nuevas fechas. Lo impartido, en curso, cancelado o agregado a mano no cambia.</p>}
            </div>}
        </div>
        <div className="button-row">
          <button className="button primary" disabled={!valid || !kept.length}>{busy ? "Guardando…" : schedule ? "Actualizar horario" : "Guardar horario"}</button>
          {schedule && <button type="button" className="button ghost" onClick={() => void onDone(false)}>Cancelar</button>}
          {schedule && <button type="button" className="button ghost danger-text push-end" onClick={() => void remove()}><Icon name="close" size={16}/>Quitar horario</button>}
        </div>
      </fieldset>
    </form>
  </Section>;
}

type WeekSection = { id: string; name: string; schedule?: SectionSchedule | null; href: string; detail?: string };

/** The weekly class times of the given sections, Monday to Friday plus any other day they meet. */
export function WeekGrid({ title, sections }: { title: string; sections: WeekSection[] }) {
  const scheduled = sections.filter(section => section.schedule);
  if (!scheduled.length) return null;
  const days = weekOrder().filter(([day]) => day >= 1 && day <= 5 || scheduled.some(section => section.schedule!.weekdays.includes(day)));
  return <section className="timetable" aria-labelledby="week-title">
    <h2 id="week-title">{title}</h2>
    {differentZone() && <p className="muted small">Horario semanal en la hora de la organización ({zoneName(currentRegional().organizationTimezone)}).</p>}
    <div className="timetable-grid" style={{ ["--days" as string]: days.length }}>{days.map(([day, name]) => {
      const at = (section: WeekSection) => meetingsOf(section.schedule!).find(item => item.weekday === day)!;
      const slots = scheduled.filter(section => section.schedule!.weekdays.includes(day)).sort((a, b) => at(a).startsAt.localeCompare(at(b).startsAt));
      return <div key={day} className="timetable-day"><h3>{name}</h3>
        {slots.length ? <ul>{slots.map(section => <li key={section.id}><Link href={section.href}><strong>{formatClock(at(section).startsAt)}</strong><span>{section.name}</span><span className="muted small">{section.detail ? `${section.detail} · ` : ""}{at(section).durationMinutes} min</span></Link></li>)}</ul> : <p className="muted small">Sin clases</p>}
      </div>;
    })}</div>
  </section>;
}

/** «Periodo 3» reads «P3» in the narrow pickers; the full name stays in Organización. */
const short = (label: string) => label.replace(/^Periodo (\d+)$/, "P$1");
/** Picks consecutive class periods of a jornada (from the start of one to the end of another); a double period becomes one longer class. */
function BlockPicker({ jornada, label, onPick }: { jornada: BellSchedule; label: string; onPick: (meeting: { startsAt: string; durationMinutes: number }) => void }) {
  const classes = jornada.blocks.filter(block => block.kind === "class");
  const [from, setFrom] = useState(""), [to, setTo] = useState("");
  function pick(start: string, end: string) {
    setFrom(start); setTo(end);
    const meeting = start && end ? meetingFromBlocks(jornada.blocks, start, end) : null;
    if (meeting) onPick(meeting);
  }
  return <span className="block-picker" role="group" aria-label={label}>
    <select aria-label={`${label}: desde`} value={from} onChange={event => { const start = event.target.value; const end = to && classes.findIndex(item => item.key === to) >= classes.findIndex(item => item.key === start) ? to : start; pick(start, end); }}>
      <option value="">Desde…</option>{classes.map(block => <option key={block.key} value={block.key}>{short(block.label)} · {block.startsAt}</option>)}
    </select>
    <select aria-label={`${label}: hasta`} value={to} disabled={!from} onChange={event => pick(from, event.target.value)}>
      {classes.filter((_, index) => index >= classes.findIndex(item => item.key === from)).map(block => <option key={block.key} value={block.key}>{short(block.label)} · {block.endsAt}</option>)}
    </select>
  </span>;
}
