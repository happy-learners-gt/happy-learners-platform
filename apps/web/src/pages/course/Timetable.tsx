import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import type { ClassSession, SectionSchedule } from "@happy-learners/contracts";
import { scheduleSummary, weekdays } from "@happy-learners/domain";
import { api, message } from "../../api";
import { Link } from "../../navigation";
import { plural, sessionDay } from "../../model";
import { useFeedback } from "../../ui/feedback";
import { Icon } from "../../ui/icons";
import { Menu } from "../../ui/Menu";
import { EmptyState, ErrorState, Field, Loading, PageHeader } from "../../ui/primitives";
import { useCourse } from "./context";
import type { SectionView } from "./Sections";

const addDays = (day: string, days: number) => { const date = new Date(`${day}T00:00:00Z`); date.setUTCDate(date.getUTCDate() + days); return date.toISOString().slice(0, 10); };
type Values = { weekdays: number[]; startsAt: string; durationMinutes: string; from: string; until: string };

/** Horario: the weekly class times of each section. Saving one generates the section's classes for its period. */
export function Timetable() {
  const { course } = useCourse();
  const [groups, setGroups] = useState<SectionView[] | null>(null), [sessions, setSessions] = useState<ClassSession[]>([]), [today, setToday] = useState(""), [error, setError] = useState("");
  const base = `/courses/${course.id}`, page = `/cursos/${course.id}`;
  async function load() {
    setError("");
    try {
      const [g, s] = await Promise.all([api<{ groups: SectionView[] }>(`${base}/groups`), api<{ sessions: ClassSession[]; today: string }>(`${base}/sessions`)]);
      setGroups(g.groups); setSessions(s.sessions); setToday(s.today);
    } catch (cause) { setError(message(cause)); }
  }
  useEffect(() => { if (course.status === "active") void load(); }, [course.id]);
  const header = <PageHeader crumbs={[{ label: "Cursos", href: "/cursos" }, { label: course.title, href: page }, { label: "Horario" }]} title="Horario"
    description="Los días, la hora y el periodo de clases de cada sección. Al guardar el horario se generan todas sus clases, que luego planificas con sus lecciones en Clases."/>;
  if (course.status !== "active") return <>{header}<EmptyState icon="archive" title="Curso archivado">Restaura el curso desde Configuración para consultar su horario.</EmptyState></>;
  if (error) return <>{header}<ErrorState error={error} retry={() => void load()}/></>;
  if (!groups) return <>{header}<Loading label="Cargando horario…" cards={2}/></>;
  const active = groups.filter(group => group.status === "active");
  if (!active.length) return <>{header}<EmptyState icon="users" title="Primero crea una sección" action={<Link className="button primary" href={`${page}/asignaciones`}>Ir a Asignaciones</Link>}>Cada sección del curso tiene su propio horario.</EmptyState></>;
  const scheduled = active.filter(group => group.schedule);
  const days = weekdays.filter(([day]) => day >= 1 && day <= 5 || scheduled.some(group => group.schedule!.weekdays.includes(day)));
  return <>
    {header}
    {scheduled.length > 0 && <section className="timetable" aria-labelledby="week-title">
      <h2 id="week-title">Semana del curso</h2>
      <div className="timetable-grid" style={{ ["--days" as string]: days.length }}>{days.map(([day, name]) => {
        const slots = scheduled.filter(group => group.schedule!.weekdays.includes(day)).sort((a, b) => a.schedule!.startsAt.localeCompare(b.schedule!.startsAt));
        return <div key={day} className="timetable-day"><h3>{name}</h3>
          {slots.length ? <ul>{slots.map(group => <li key={group.id}><a href={`#horario-${group.id}`}><strong>{group.schedule!.startsAt}</strong><span>{group.name}</span><span className="muted small">{group.schedule!.durationMinutes} min</span></a></li>)}</ul> : <p className="muted small">Sin clases</p>}
        </div>;
      })}</div>
    </section>}
    <div className="group-grid">{active.map(group => <ScheduleCard key={group.id} group={group} today={today} sessions={sessions.filter(session => session.groupId === group.id)} onSaved={load}/>)}</div>
    <p className="privacy-note"><Icon name="info" size={16}/>Cambiar un horario rehace solo las clases generadas que aún no comienzan. Las clases impartidas, en curso, canceladas o agregadas a mano se conservan, y las lecciones ya planificadas siguen en el mismo orden.</p>
  </>;
}

function ScheduleCard({ group, today, sessions, onSaved }: { group: SectionView; today: string; sessions: ClassSession[]; onSaved: () => Promise<void> }) {
  const { course, writable } = useCourse();
  const { toast, confirm } = useFeedback();
  const initial = (schedule?: SectionSchedule | null): Values => schedule
    ? { weekdays: schedule.weekdays, startsAt: schedule.startsAt, durationMinutes: String(schedule.durationMinutes), from: schedule.from, until: schedule.until }
    : { weekdays: [], startsAt: "08:00", durationMinutes: "45", from: today, until: addDays(today, 90) };
  const [values, setValues] = useState<Values>(() => initial(group.schedule)), [busy, setBusy] = useState(false), [error, setError] = useState("");
  useEffect(() => setValues(initial(group.schedule)), [group.schedule?.weekdays.join(), group.schedule?.startsAt, group.schedule?.durationMinutes, group.schedule?.from, group.schedule?.until]);
  const set = (patch: Partial<Values>) => setValues(current => ({ ...current, ...patch }));
  const pending = sessions.filter(session => session.origin === "schedule" && session.status === "planned" && session.sessionDate >= today);
  const taught = sessions.filter(session => session.status === "completed").length;
  const path = `/courses/${course.id}/groups/${group.id}/schedule`;
  async function save(event: FormEvent) {
    event.preventDefault();
    if (group.schedule && pending.length && !await confirm({ title: `¿Actualizar el horario de «${group.name}»?`, body: <p>Se rehacen {plural(pending.length, "clase pendiente generada", "clases pendientes generadas")} por el horario. Sus lecciones pasan, en el mismo orden, a las nuevas fechas.</p>, confirm: "Actualizar horario" })) return;
    setBusy(true); setError("");
    try {
      const result = await api<{ classes: number }>(path, "PUT", { ...values, durationMinutes: Number(values.durationMinutes) });
      toast({ message: `Horario guardado: ${plural(result.classes, "clase pendiente", "clases pendientes")} en Clases.` });
      await onSaved();
    } catch (cause) { setError(message(cause)); }
    finally { setBusy(false); }
  }
  async function remove() {
    if (!await confirm({ title: `¿Quitar el horario de «${group.name}»?`, body: <p>Se eliminan {plural(pending.length, "clase pendiente generada", "clases pendientes generadas")} por el horario. Las clases impartidas y las agregadas a mano se conservan.</p>, confirm: "Quitar horario", danger: true })) return;
    setBusy(true);
    try { await api(path, "DELETE"); toast({ message: "Horario quitado." }); await onSaved(); }
    catch (cause) { toast({ tone: "error", message: message(cause) }); }
    finally { setBusy(false); }
  }
  const last = pending.reduce<string>((latest, session) => session.sessionDate > latest ? session.sessionDate : latest, "");
  return <article id={`horario-${group.id}`} className="group-card" aria-labelledby={`schedule-${group.id}`}>
    <header>
      <div><h2 id={`schedule-${group.id}`}>{group.name}</h2><p className="muted">{group.schedule ? scheduleSummary(group.schedule) : "Sin horario"}</p></div>
      {writable && group.schedule && <Menu label={`Opciones del horario de ${group.name}`} items={[{ label: "Quitar horario", icon: "close", danger: true, onSelect: () => void remove() }]}/>}
    </header>
    {group.schedule && <p className="muted small">{plural(pending.length, "clase pendiente", "clases pendientes")}{last ? ` hasta el ${sessionDay(last).replace(/^./, letter => letter.toLowerCase())}` : ""} · {plural(taught, "impartida", "impartidas")} · <Link href={`/cursos/${course.id}/clases?seccion=${group.id}`}>Ver clases</Link></p>}
    {writable ? <form className="stack" onSubmit={save} aria-label={`Horario de ${group.name}`}>
      {error && <p className="form-alert" role="alert"><Icon name="alert" size={18}/>{error}</p>}
      <fieldset disabled={busy} className="stack">
        <fieldset className="segmented wide weekday-picker"><legend>Días de clase</legend>
          {weekdays.map(([day, name, short]) => <label key={day} title={name}><input type="checkbox" checked={values.weekdays.includes(day)} aria-label={name} onChange={() => set({ weekdays: values.weekdays.includes(day) ? values.weekdays.filter(value => value !== day) : [...values.weekdays, day] })}/><span aria-hidden="true">{short}</span></label>)}
        </fieldset>
        <div className="field-row">
          <Field label="Hora"><input type="time" value={values.startsAt} onChange={event => set({ startsAt: event.target.value })} required/></Field>
          <Field label="Duración (min)"><input type="number" min={5} max={480} step={5} value={values.durationMinutes} onChange={event => set({ durationMinutes: event.target.value })} required/></Field>
        </div>
        <div className="field-row">
          <Field label="Desde"><input type="date" value={values.from} onChange={event => set({ from: event.target.value })} required/></Field>
          <Field label="Hasta"><input type="date" value={values.until} min={values.from} onChange={event => set({ until: event.target.value })} required/></Field>
        </div>
        <div className="button-row"><button className="button primary" disabled={!values.weekdays.length}>{busy ? "Guardando…" : group.schedule ? "Actualizar horario" : "Guardar horario"}</button>
          {!values.weekdays.length && <span className="muted small">Elige al menos un día.</span>}</div>
      </fieldset>
    </form> : !group.schedule && <p className="muted">El equipo docente aún no configura el horario de esta sección.</p>}
  </article>;
}
