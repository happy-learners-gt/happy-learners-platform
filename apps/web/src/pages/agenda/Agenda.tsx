import { useEffect, useRef, useState } from "react";
import type { AgendaKind, AgendaView, EffectivePreferences } from "@happy-learners/contracts";
import { orderedWeekdays, weekdays } from "@happy-learners/domain";
import { api, message } from "../../api";
import { Link, useNavigation } from "../../navigation";
import { plural, sessionDay } from "../../model";
import { classMoment, currentRegional, differentZone, personalToday, zoneName } from "../../regional";
import { useSession } from "../../session";
import { Drawer, useFeedback } from "../../ui/feedback";
import { Menu } from "../../ui/Menu";
import { EmptyState, ErrorState, Loading, PageHeader } from "../../ui/primitives";
import { CalendarSync } from "../sections/CalendarSync";

type ClassItem = {
  type: "class"; id: string; date: string; startsAt: string | null; durationMinutes: number | null;
  status: "planned" | "in_progress" | "completed" | "cancelled"; moved: boolean;
  sectionId: string; sectionName: string; courseId: string; courseTitle: string;
  lessons: { id: string; title: string }[]; attendance: { marked: number; total: number } | null;
  link: string; actions: { id: string; label: string; href: string }[];
};
type DatedItem = {
  type: "no-class" | "event"; id: string; title: string; from: string; until: string;
  part: "full" | "morning" | "afternoon"; category: string; scope: string; movesClasses: boolean; classesMoved: number;
};
type DueItem = {
  type: "due"; id: string; title: string; date: string; sectionId: string; sectionName: string; courseId: string; courseTitle: string;
  link: string; actions: { id: string; label: string; href: string }[];
};
type AgendaItem = ClassItem | DatedItem | DueItem;
type AgendaPayload = {
  from: string; until: string; scope: string; today: string; canWiden: boolean;
  scopes: { value: string; label: string }[]; items: AgendaItem[];
  rail: { next: ClassItem | null; breaks: { date: string; title: string; origin: string }[] };
};
const views: { id: AgendaView; label: string; query: string }[] = [
  { id: "day", label: "Día", query: "día" }, { id: "week", label: "Semana", query: "semana" },
  { id: "month", label: "Mes", query: "mes" }, { id: "year", label: "Año", query: "año" },
];
const kinds: { id: AgendaKind; label: string }[] = [
  { id: "class", label: "Clases" }, { id: "no-class", label: "Días sin clase" }, { id: "event", label: "Eventos" }, { id: "due", label: "Evaluaciones" },
];
const statusLabel = { planned: "Planificada", in_progress: "En curso", completed: "Impartida", cancelled: "Cancelada" } as const;
const partLabel = { full: "Día completo", morning: "Mañana", afternoon: "Tarde" } as const;
const addDays = (iso: string, days: number) => { const date = new Date(`${iso}T00:00:00Z`); date.setUTCDate(date.getUTCDate() + days); return date.toISOString().slice(0, 10); };
const weekday = (iso: string) => new Date(`${iso}T00:00:00Z`).getUTCDay();
const minutes = (time: string | null) => { const match = /^(\d{2}):(\d{2})/.exec(time || ""); return match ? Number(match[1]) * 60 + Number(match[2]) : 8 * 60; };
const monthStart = (iso: string) => `${iso.slice(0, 7)}-01`;
const monthEnd = (iso: string) => { const date = new Date(`${iso.slice(0, 7)}-01T00:00:00Z`); date.setUTCMonth(date.getUTCMonth() + 1); date.setUTCDate(0); return date.toISOString().slice(0, 10); };
function startOfWeek(iso: string, weekStart: number) { return addDays(iso, -((weekday(iso) - (weekStart % 7) + 7) % 7)); }
function monthCells(anchor: string, weekStart: number) {
  const from = startOfWeek(monthStart(anchor), weekStart);
  const days = Array.from({ length: 42 }, (_, index) => addDays(from, index));
  return { from, until: days[41], days };
}
function rangeOf(view: AgendaView, anchor: string, weekStart: number) {
  if (view === "day") return { from: anchor, until: anchor };
  if (view === "week") { const from = startOfWeek(anchor, weekStart); return { from, until: addDays(from, 6) }; }
  if (view === "month") { const grid = monthCells(anchor, weekStart); return { from: grid.from, until: grid.until }; }
  return { from: `${anchor.slice(0, 4)}-01-01`, until: `${anchor.slice(0, 4)}-12-31` };
}
function titleOf(view: AgendaView, anchor: string, range: { from: string; until: string }) {
  const locale = currentRegional().locale;
  const format = (iso: string, options: Intl.DateTimeFormatOptions) => {
    const [year, month, day] = iso.split("-").map(Number);
    return new Intl.DateTimeFormat(locale, { ...options, timeZone: "UTC" }).format(new Date(Date.UTC(year, month - 1, day, 12)));
  };
  const cap = (text: string) => text ? text.charAt(0).toLocaleUpperCase(locale) + text.slice(1) : text;
  if (view === "year") return anchor.slice(0, 4);
  if (view === "day") return cap(format(anchor, { weekday: "long", day: "numeric", month: "long", year: "numeric" }));
  if (view === "month") return `${cap(format(monthStart(anchor), { month: "long" }))} ${anchor.slice(0, 4)}`;
  const short = (iso: string) => format(iso, { day: "numeric", month: "short" }).replace(/\./g, "");
  const sameYear = range.from.slice(0, 4) === range.until.slice(0, 4);
  return sameYear ? `${short(range.from)} – ${short(range.until)} ${range.until.slice(0, 4)}` : `${short(range.from)} ${range.from.slice(0, 4)} – ${short(range.until)} ${range.until.slice(0, 4)}`;
}
/**
 * Classes of one day side by side when they overlap. With `max` (AGE-01, the week), a group of overlapping classes
 * shows at most `max` columns and the rest as a «+N» chip over the group, which opens the day.
 */
type Placed = { item: ClassItem; lane: number; lanes: number; more?: ClassItem[] };
function placedClasses(classes: ClassItem[], max = Infinity): Placed[] {
  const startOf = (item: ClassItem) => minutes(classMoment(item.date, item.startsAt).time);
  const endOf = (item: ClassItem) => startOf(item) + (item.durationMinutes || 45);
  const sorted = [...classes].sort((a, b) => startOf(a) - startOf(b) || a.id.localeCompare(b.id));
  const result: Placed[] = [];
  let cluster: { item: ClassItem; lane: number }[] = [], laneEnds: number[] = [], clusterEnd = -1;
  const flush = () => {
    const lanes = Math.max(1, ...cluster.map(entry => entry.lane + 1));
    if (lanes <= max) for (const entry of cluster) result.push({ ...entry, lanes });
    else {
      const kept = cluster.filter(entry => entry.lane < max), rest = cluster.filter(entry => entry.lane >= max).map(entry => entry.item);
      for (const entry of kept) result.push({ ...entry, lanes: max });
      result.push({ item: rest[0], lane: max - 1, lanes: max, more: rest });
    }
    cluster = []; laneEnds = []; clusterEnd = -1;
  };
  for (const item of sorted) {
    const start = startOf(item), end = endOf(item);
    if (cluster.length && start >= clusterEnd) flush();
    let lane = laneEnds.findIndex(until => until <= start);
    if (lane < 0) { lane = laneEnds.length; laneEnds.push(end); } else laneEnds[lane] = end;
    cluster.push({ item, lane });
    clusterEnd = Math.max(clusterEnd, end);
  }
  if (cluster.length) flush();
  return result;
}
function useNarrow() {
  const [narrow, setNarrow] = useState(() => typeof matchMedia === "function" && matchMedia("(max-width: 760px)").matches);
  useEffect(() => {
    if (typeof matchMedia !== "function") return undefined;
    const query = matchMedia("(max-width: 760px)");
    const apply = () => setNarrow(query.matches);
    apply();
    query.addEventListener("change", apply);
    return () => query.removeEventListener("change", apply);
  }, []);
  return narrow;
}
const covers = (item: DatedItem, day: string) => day >= item.from && day <= item.until;
const classDay = (item: ClassItem) => classMoment(item.date, item.startsAt).day;
const onDay = (item: AgendaItem, day: string) => item.type === "class" ? classDay(item) === day : item.type === "due" ? item.date === day : covers(item, day);

/** The agenda: day, week, month and year of the classes, days without class, events and deliveries. */
export function Agenda() {
  const { member, preferences, setPreferences } = useSession();
  const { url, navigate } = useNavigation();
  const { toast } = useFeedback();
  const narrow = useNarrow();
  const admin = member.role === "admin";
  const requested = url.searchParams.get("vista");
  const fromUrl = views.find(item => item.query === requested)?.id;
  const view = fromUrl || preferences?.agendaView || (narrow ? "day" : "week");
  const anchor = /^\d{4}-\d{2}-\d{2}$/.test(url.searchParams.get("fecha") || "") ? url.searchParams.get("fecha")! : personalToday();
  // Without «ver», the API picks the scope (IA-03): its answer says which one, and the selector shows it.
  const scope = url.searchParams.get("ver") || "";
  const weekStart = preferences?.weekStart || 1;
  const show = new Set(preferences?.agendaShow || kinds.map(item => item.id));
  const [data, setData] = useState<AgendaPayload | null>(null), [error, setError] = useState(""), [selected, setSelected] = useState<AgendaItem | null>(null), [subscribe, setSubscribe] = useState(false);
  const datePicker = useRef<HTMLInputElement>(null);
  const range = rangeOf(view, anchor, weekStart);

  useEffect(() => {
    const query = new URLSearchParams({ from: addDays(range.from, -1), until: addDays(range.until, 1), ...scope ? { scope } : {} });
    let live = true;
    setError("");
    api<AgendaPayload>(`/agenda?${query}`).then(result => { if (live) setData(result); }, cause => { if (live) setError(message(cause)); });
    return () => { live = false; };
  }, [range.from, range.until, scope]);

  function visit(patch: { fecha?: string; vista?: AgendaView; ver?: string }) {
    const next = new URL(url);
    if (patch.fecha) next.searchParams.set("fecha", patch.fecha);
    if (patch.vista) next.searchParams.set("vista", views.find(item => item.id === patch.vista)!.query);
    if (patch.ver) next.searchParams.set("ver", patch.ver);
    navigate(`${next.pathname}${next.search}`, true);
  }
  async function remember(change: Partial<Pick<EffectivePreferences, "agendaView" | "agendaShow">>, done: string) {
    try { setPreferences((await api<{ preferences: EffectivePreferences }>("/me/preferences", "PUT", change)).preferences); }
    catch (cause) { toast({ tone: "error", message: message(cause) }); return; }
    toast({ message: done });
  }
  function chooseView(next: AgendaView) {
    visit({ vista: next, fecha: anchor });
    if (preferences && preferences.agendaView !== next) void remember({ agendaView: next }, "Vista de la agenda guardada.");
  }
  function toggleKind(kind: AgendaKind) {
    const next = show.has(kind) ? [...show].filter(item => item !== kind) : [...show, kind];
    void remember({ agendaShow: next as AgendaKind[] }, "Filtros de la agenda guardados.");
  }
  const items = (data?.items || []).filter(item => show.has(item.type) && (item.type === "class" || item.type === "due" ? item.date >= addDays(range.from, -1) : true));
  const visible = items.filter(item => { const day = item.type === "class" ? classDay(item) : item.type === "due" ? item.date : item.from; return day <= range.until && (item.type === "no-class" || item.type === "event" ? item.until >= range.from : day >= range.from); });
  const step = view === "year" ? 365 : view === "month" ? 30 : view === "week" ? 7 : 1;
  const zoneNote = differentZone() ? ` Horas en tu zona: ${zoneName()}.` : "";
  const title = titleOf(view, anchor, range);
  const previous = view === "year" ? `${Number(anchor.slice(0, 4)) - 1}-01-01` : view === "month" ? addDays(monthStart(anchor), -1).slice(0, 7) + "-01" : addDays(anchor, -step);
  const following = view === "year" ? `${Number(anchor.slice(0, 4)) + 1}-01-01` : view === "month" ? addDays(monthEnd(anchor), 1) : addDays(anchor, step);
  const viewName = views.find(item => item.id === view)!.label.toLocaleLowerCase("es");

  return <>
    <PageHeader title="Agenda" description={`Clases, días sin clase, eventos y entregas.${zoneNote}`}/>
    <div className="agenda-toolbar">
      <div className="agenda-bar">
        <div className="agenda-nav" role="group" aria-label="Fecha">
          <button type="button" className="button secondary" onClick={() => visit({ fecha: personalToday() })}>Hoy</button>
          <button type="button" className="button ghost" aria-label={`${viewName === "día" ? "Día" : views.find(item => item.id === view)!.label} anterior`} onClick={() => visit({ fecha: previous })}>‹</button>
          <button type="button" className="button ghost" aria-label={`${views.find(item => item.id === view)!.label} siguiente`} onClick={() => visit({ fecha: following })}>›</button>
          <button type="button" className="agenda-title" onClick={() => { const field = datePicker.current; field?.focus(); if (field && "showPicker" in field) void field.showPicker(); }}>{title}</button>
          <input ref={datePicker} className="agenda-date" type="date" aria-label="Elegir fecha" value={anchor} onChange={event => event.target.value && visit({ fecha: event.target.value })}/>
        </div>
        <div role="tablist" aria-label="Vista" className="agenda-views">
          {views.map(item => <button key={item.id} type="button" role="tab" aria-selected={view === item.id} className={view === item.id ? "is-selected" : ""} onClick={() => chooseView(item.id)}>{item.label}</button>)}
        </div>
        <Menu label="Más acciones de la agenda" items={[{ label: "Suscribirme", icon: "calendar", onSelect: () => setSubscribe(true) }]}/>
      </div>
      <div className="agenda-tools">
        {data?.canWiden && <label className="agenda-scope">Ver<select value={data.scopes.some(item => item.value === data.scope) ? data.scope : "mine"} onChange={event => visit({ ver: event.target.value })}>
          {data.scopes.map(item => <option key={item.value} value={item.value}>{item.label}</option>)}
        </select></label>}
        <div className="agenda-filters" role="group" aria-label="Mostrar">
          <span>Mostrar</span>
          {kinds.map(item => <button key={item.id} type="button" className="chip-button" aria-pressed={show.has(item.id)} onClick={() => toggleKind(item.id)}>{item.label}</button>)}
        </div>
      </div>
    </div>
    {error ? <ErrorState error={error} retry={() => visit({ fecha: anchor })}/> : !data ? <Loading label="Cargando la agenda…" cards={2}/> : <div className="agenda-body">
      <div className="agenda-main">
        {view === "day" && <DayList day={anchor} items={visible} onOpen={setSelected}/>}
        {view === "week" && <WeekView admin={admin} from={range.from} items={visible} onOpen={setSelected} openDay={day => visit({ fecha: day, vista: "day" })}/>}
        {view === "month" && <MonthView anchor={anchor} weekStart={weekStart} items={visible} onOpen={setSelected} openDay={day => visit({ fecha: day, vista: "day" })}/>}
        {view === "year" && <YearView year={anchor.slice(0, 4)} items={visible} weekStart={weekStart} onMonth={month => visit({ fecha: `${anchor.slice(0, 4)}-${month}-01`, vista: "month" })}/>}
      </div>
      <Rail next={show.has("class") ? data.rail.next : null} breaks={show.has("no-class") ? data.rail.breaks : []} onOpen={setSelected}/>
    </div>}
    {selected && <ItemPanel item={selected} onClose={() => setSelected(null)}/>}
    {subscribe && <Drawer title="Suscribirme" onClose={() => setSubscribe(false)}><div className="agenda-subscribe"><CalendarSync/></div></Drawer>}
  </>;
}

function DayList({ day, items, onOpen }: { day: string; items: AgendaItem[]; onOpen: (item: AgendaItem) => void }) {
  const mine = items.filter(item => onDay(item, day));
  const classes = mine.filter((item): item is ClassItem => item.type === "class");
  const rest = mine.filter(item => item.type !== "class");
  const hours = Array.from({ length: 12 }, (_, index) => index + 7);
  return <section className="agenda-day" aria-label="El día">
    {rest.map(item => item.type === "no-class" ? <p key={item.id} className="agenda-off">{item.title}</p> : <button key={`${item.type}-${item.id}`} type="button" className={item.type === "due" ? "agenda-mark" : "agenda-chip"} onClick={() => onOpen(item)}>{item.title}</button>)}
    {classes.length ? <div className="agenda-day-board"><div className="agenda-hours">{hours.map(hour => <span key={hour}>{String(hour).padStart(2, "0")}:00</span>)}</div><div className="agenda-day-column">{placedClasses(classes).map(entry => <ClassBlock key={entry.item.id} {...entry} onOpen={onOpen}/>)}</div></div>
      : !rest.length && <EmptyState compact icon="calendar" title="Nada en este día">Las clases, los eventos y las entregas de este día aparecen aquí.</EmptyState>}
  </section>;
}

function WeekView({ admin, from, items, onOpen, openDay }: { admin: boolean; from: string; items: AgendaItem[]; onOpen: (item: AgendaItem) => void; openDay: (day: string) => void }) {
  const days = Array.from({ length: 7 }, (_, index) => addDays(from, index));
  const hours = Array.from({ length: 12 }, (_, index) => index + 7);
  return <section className="agenda-week" aria-label={admin ? "La semana" : "Tu semana"}>
    <div className="agenda-week-grid">
      <div className="agenda-corner"/>
      {days.map(day => {
        const off = items.find((item): item is DatedItem => item.type === "no-class" && covers(item, day));
        const events = items.filter((item): item is DatedItem => item.type === "event" && covers(item, day));
        const dues = items.filter((item): item is DueItem => item.type === "due" && item.date === day);
        return <div key={day} className={`agenda-week-head${off ? " agenda-off" : ""}`}>
          <span>{weekdays.find(([value]) => value === weekday(day))?.[2]}</span>
          <strong>{Number(day.slice(8))}</strong>
          {off && <em>{off.title}</em>}
          {events.map(event => <button key={event.id} type="button" className="agenda-chip" onClick={() => onOpen(event)}>{event.title}</button>)}
          {dues.map(due => <button key={due.id} type="button" className="agenda-mark" onClick={() => onOpen(due)}>{due.title}</button>)}
        </div>;
      })}
      <div className="agenda-hours">{hours.map(hour => <span key={hour}>{String(hour).padStart(2, "0")}:00</span>)}</div>
      {days.map(day => {
        const off = items.some(item => item.type === "no-class" && covers(item, day));
        const classes = items.filter((item): item is ClassItem => item.type === "class" && classDay(item) === day);
        return <div key={`${day}-col`} className={`agenda-day-column${off ? " agenda-off" : ""}`}>
          {placedClasses(classes, 1).map(entry => entry.more ? <MoreClasses key={`${entry.item.id}-more`} {...entry} more={entry.more} onOpen={() => openDay(day)}/>
            : <ClassBlock key={entry.item.id} {...entry} onOpen={onOpen}/>)}
        </div>;
      })}
    </div>
  </section>;
}

function ClassBlock({ item, lane, lanes, onOpen }: { item: ClassItem; lane: number; lanes: number; onOpen: (item: AgendaItem) => void }) {
  const when = classMoment(item.date, item.startsAt);
  const top = Math.min(96, Math.max(0, ((minutes(when.time) - 7 * 60) / (12 * 60)) * 100));
  const height = Math.max(8, ((item.durationMinutes || 45) / (12 * 60)) * 100);
  const state = `${item.moved ? "Movida" : statusLabel[item.status]}${item.status === "completed" ? " ✓" : ""}`;
  return <button type="button" className={`agenda-class is-${item.status}${item.moved ? " is-moved" : ""}`} style={{ top: `${top}%`, height: `${height}%`, left: `calc(${(lane / lanes) * 100}% + 2px)`, width: `calc(${100 / lanes}% - 4px)` }} onClick={() => onOpen(item)}>
    <span className="agenda-class-time"><span className="agenda-when">{when.time}</span>{` · ${item.sectionName}`}</span>
    <strong>{item.courseTitle}</strong>
    <span className="sr-only">{state}</span>
  </button>;
}

/** AGE-01: the classes that do not fit, as a «+N» chip at the start of their time; it opens the day. */
function MoreClasses({ item, more, onOpen }: Placed & { more: ClassItem[]; onOpen: () => void }) {
  const start = Math.min(...more.map(entry => minutes(classMoment(entry.date, entry.startsAt).time)));
  const top = Math.min(96, Math.max(0, ((start - 7 * 60) / (12 * 60)) * 100));
  return <button type="button" className="agenda-more" style={{ top: `calc(${top}% + 2px)` }} onClick={onOpen}
    aria-label={`${more.length === 1 ? "1 clase más" : `${more.length} clases más`} a la misma hora: ${more.map(entry => `${classMoment(entry.date, entry.startsAt).time} ${entry.courseTitle}`).join(", ")}. Ver el día`}>
    {`+${more.length}`}
  </button>;
}

function MonthView({ anchor, weekStart, items, onOpen, openDay }: { anchor: string; weekStart: number; items: AgendaItem[]; onOpen: (item: AgendaItem) => void; openDay: (day: string) => void }) {
  const { days } = monthCells(anchor, weekStart);
  const names = orderedWeekdays(weekdays, weekStart);
  return <section className="agenda-month" aria-label="El mes">
    <div className="agenda-month-grid">
      {names.map(([, , short]) => <span key={short} className="agenda-month-name">{short}</span>)}
      {days.map(day => {
        const mine = items.filter(item => onDay(item, day));
        const off = mine.find((item): item is DatedItem => item.type === "no-class");
        const extra = mine.length - 3;
        return <div key={day} className={`agenda-month-day${day.slice(0, 7) === anchor.slice(0, 7) ? "" : " is-outside"}${off ? " agenda-off" : ""}`}>
          <button type="button" className="agenda-month-number" onClick={() => openDay(day)}>{Number(day.slice(8))}</button>
          {off && <em>{off.title}</em>}
          {mine.filter(item => item.type !== "no-class").slice(0, 3).map(item => <button key={`${item.type}-${item.id}`} type="button" className={`agenda-chip is-${item.type}`} onClick={() => onOpen(item)}>{item.type === "class" ? item.courseTitle : item.title}</button>)}
          {extra > 0 && <span className="agenda-more">+{extra} más</span>}
        </div>;
      })}
    </div>
  </section>;
}

function YearView({ year, items, weekStart, onMonth }: { year: string; items: AgendaItem[]; weekStart: number; onMonth: (month: string) => void }) {
  const names = ["Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio", "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"];
  return <section className="agenda-year" aria-label={`El año ${year}`}>
    {names.map((name, index) => {
      const month = String(index + 1).padStart(2, "0");
      const start = startOfWeek(`${year}-${month}-01`, weekStart);
      const cells = Array.from({ length: 42 }, (_, cell) => addDays(start, cell));
      return <article key={month}><h3><button type="button" onClick={() => onMonth(month)}>{name}</button></h3>
        <div className="agenda-year-month">{cells.map(day => {
          const inside = day.slice(5, 7) === month;
          const marked = inside && items.some(item => onDay(item, day));
          return <span key={day} className={`${inside ? "" : "is-outside"}${marked ? " is-marked" : ""}`}>{inside ? Number(day.slice(8)) : ""}</span>;
        })}</div>
      </article>;
    })}
  </section>;
}

function Rail({ next, breaks, onOpen }: { next: ClassItem | null; breaks: { date: string; title: string; origin: string }[]; onOpen: (item: AgendaItem) => void }) {
  const when = next ? classMoment(next.date, next.startsAt) : null;
  const action = next?.actions[0];
  return <aside className="agenda-rail">
    <section aria-label="Hoy"><h2>Hoy</h2>
      {next && when ? <ol className="agenda-list"><li><Link href={next.link}>
        <span className="agenda-when"><strong>{when.day === personalToday() ? "Hoy" : sessionDay(when.day, "short")}</strong><span>{when.time}</span></span>
        <span className="agenda-what"><strong>{next.courseTitle}</strong><span className="muted small">{next.sectionName}</span></span>
      </Link>{action && <Link className="button primary small" href={action.href}>{action.label}</Link>}</li></ol>
        : <p className="muted small">No hay una clase próxima.</p>}
    </section>
    <section aria-label="Próximos días sin clase"><h2>Próximos días sin clase</h2>
      {breaks.length ? <ul className="agenda-breaks">{breaks.map(item => <li key={`${item.date}-${item.title}`}><strong>{sessionDay(item.date, "short")}</strong><span>{item.title}</span><em>{item.origin}</em></li>)}</ul>
        : <p className="muted small">No hay días sin clase próximos.</p>}
    </section>
  </aside>;
}

function ItemPanel({ item, onClose }: { item: AgendaItem; onClose: () => void }) {
  const title = item.type === "class" ? item.courseTitle : item.title;
  return <Drawer title={title} onClose={onClose}><div className="agenda-panel">
    {item.type === "class" && <ClassPanel item={item}/>}
    {(item.type === "event" || item.type === "no-class") && <EventPanel item={item}/>}
    {item.type === "due" && <DuePanel item={item}/>}
  </div></Drawer>;
}
function ClassPanel({ item }: { item: ClassItem }) {
  const when = classMoment(item.date, item.startsAt);
  return <>
    <p>{item.sectionName} · {sessionDay(when.day)}{when.time ? ` · ${when.time}` : ""}</p>
    <p><strong>{item.moved ? "Movida" : statusLabel[item.status]}</strong></p>
    {item.lessons.length ? <div><h3>Lecciones previstas</h3><ul>{item.lessons.map(lesson => <li key={lesson.id}>{lesson.title}</li>)}</ul></div> : <p className="muted">Sin lecciones previstas.</p>}
    {item.attendance && item.attendance.total > 0 && <p>Asistencia: {item.attendance.marked} de {item.attendance.total}.</p>}
    <div className="agenda-panel-actions">{item.actions.map(action => <Link key={action.id} className={`button ${action.id === "open" ? "primary" : "secondary"}`} href={action.href}>{action.label}</Link>)}</div>
  </>;
}
function EventPanel({ item }: { item: DatedItem }) {
  const same = item.from === item.until;
  return <>
    <p>{item.category} · {same ? sessionDay(item.from) : `${sessionDay(item.from)} – ${sessionDay(item.until)}`} · {partLabel[item.part]}</p>
    <p>{item.scope}</p>
    {item.movesClasses && <p>{item.classesMoved ? `Mueve ${plural(item.classesMoved, "clase pendiente", "clases pendientes")}.` : "No quedan clases pendientes en estas fechas."}</p>}
  </>;
}
function DuePanel({ item }: { item: DueItem }) {
  return <>
    <p>{item.sectionName} · {item.courseTitle}</p>
    <p>{sessionDay(item.date)}</p>
    <div className="agenda-panel-actions">{item.actions.map(action => <Link key={action.id} className="button primary" href={action.href}>{action.label}</Link>)}</div>
  </>;
}
