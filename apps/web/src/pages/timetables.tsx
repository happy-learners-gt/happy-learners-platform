import { useEffect, useState } from "react";
import type { SolverBlock, SolverResult, SolverRule } from "@happy-learners/domain";
import { ruleText, weekdayNames } from "@happy-learners/domain";
import { api, message } from "../api";
import { useFeedback } from "../ui/feedback";
import { Icon } from "../ui/icons";
import { Button, EmptyState, ErrorState, Field, Loading, PageHeader, PrimaryAction, Section, StatusBadge } from "../ui/primitives";

/**
 * Organización › Horarios (1.4.3, docs/design/asistente-ia.md §6d): the weekly timetable of the chosen sections, from
 * the school day's periods and rules. The solver decides; the AI only reads rules written in words, which the person
 * confirms. Nothing changes until «Aplicar a las secciones». Classrooms (1.5.3) are listed and edited here, and each
 * section's usual classroom is chosen in the sections table.
 */
type Setup = {
  bellSchedules: { id: string; name: string; weekdays: number[]; blocks: SolverBlock[] }[];
  sections: { id: string; name: string; courseTitle: string; educators: { id: string; name: string }[]; meetingsPerWeek: number; learners: number; classroomId: string | null }[];
  educators: { id: string; name: string }[]; year: { from: string; until: string } | null; classrooms: Classroom[];
};
type Classroom = { id: string; name: string; capacity: number };
type Choice = { included: boolean; meetingsPerWeek: number; blocksPerMeeting: number };
const dayLabel = (weekday: number) => weekdayNames[weekday].charAt(0).toUpperCase() + weekdayNames[weekday].slice(1);
const ruleKinds: { value: SolverRule["kind"]; label: string }[] = [
  { value: "unavailable", label: "Docente no disponible un día" }, { value: "max-daily", label: "Carga diaria máxima de un docente" },
  { value: "shared-students", label: "Secciones que comparten estudiantes" }, { value: "not-on", label: "Sección sin clase un día" }, { value: "preferred-days", label: "Días preferidos de una sección" },
];

function RuleForm({ setup, onAdd }: { setup: Setup; onAdd: (rule: SolverRule) => void }) {
  const [kind, setKind] = useState<SolverRule["kind"]>("unavailable");
  const sectionOptions = setup.sections.map(item => <option key={item.id} value={item.id}>{item.courseTitle} · {item.name}</option>);
  const days = [1, 2, 3, 4, 5, 6, 0].map(day => <option key={day} value={day}>{dayLabel(day)}</option>);
  return <form className="timetable-rule-form" aria-label="Agregar regla" onSubmit={event => {
    event.preventDefault();
    const data = new FormData(event.currentTarget), value = (key: string) => String(data.get(key) || "");
    const rule: SolverRule = kind === "unavailable" ? { kind, educatorId: value("educatorId"), weekday: Number(value("weekday")), from: "00:00", to: "23:59" }
      : kind === "max-daily" ? { kind, educatorId: value("educatorId"), minutes: Number(value("minutes")) }
      : kind === "shared-students" ? { kind, sectionIds: data.getAll("sectionIds").map(String) }
      : kind === "not-on" ? { kind, sectionId: value("sectionId"), weekday: Number(value("weekday")) }
      : { kind, sectionId: value("sectionId"), weekdays: data.getAll("weekdays").map(Number) };
    onAdd(rule); event.currentTarget.reset();
  }}>
    <Field label="Tipo de regla"><select value={kind} onChange={event => setKind(event.target.value as SolverRule["kind"])}>{ruleKinds.map(item => <option key={item.value} value={item.value}>{item.label}</option>)}</select></Field>
    {(kind === "unavailable" || kind === "max-daily") && <Field label="Docente"><select name="educatorId" required>{setup.educators.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></Field>}
    {(kind === "not-on" || kind === "preferred-days") && <Field label="Sección"><select name="sectionId" required>{sectionOptions}</select></Field>}
    {(kind === "unavailable" || kind === "not-on") && <Field label="Día"><select name="weekday">{days}</select></Field>}
    {kind === "max-daily" && <Field label="Minutos de clase al día"><input name="minutes" type="number" min={30} max={720} step={5} required defaultValue={180}/></Field>}
    {kind === "shared-students" && <Field label="Secciones" hint="Mantén presionada Ctrl o ⌘ para elegir varias."><select name="sectionIds" multiple required size={6}>{sectionOptions}</select></Field>}
    {kind === "preferred-days" && <Field label="Días" hint="Mantén presionada Ctrl o ⌘ para elegir varios."><select name="weekdays" multiple required size={6}>{days}</select></Field>}
    <div className="button-row"><button className="button secondary"><Icon name="plus" size={16}/>Agregar regla</button></div>
  </form>;
}

function WrittenRules({ onAdd }: { onAdd: (rules: SolverRule[]) => void }) {
  const [text, setText] = useState(""), [busy, setBusy] = useState(false), [error, setError] = useState("");
  const [proposed, setProposed] = useState<{ rule: SolverRule; text: string; checked: boolean }[] | null>(null), [dropped, setDropped] = useState(0);
  async function read() {
    setBusy(true); setError("");
    try { const answer = await api<{ rules: { rule: SolverRule; text: string }[]; dropped: number }>("/timetables/rules", "POST", { text }); setProposed(answer.rules.map(item => ({ ...item, checked: true }))); setDropped(answer.dropped); }
    catch (cause) { setError(message(cause)); }
    finally { setBusy(false); }
  }
  return <div className="timetable-written">
    <Field label="Escribe una regla" hint="Por ejemplo: «La profesora Herrera no da clases los viernes» o «3.º A de Matemáticas y de Lenguaje comparten estudiantes». La IA la interpreta y tú confirmas."><textarea rows={3} maxLength={1000} value={text} onChange={event => setText(event.target.value)}/></Field>
    <div className="button-row"><Button icon="sparkles" busy={busy} disabled={!text.trim() || busy} onClick={() => void read()}>Interpretar</Button></div>
    {error && <p className="field-error" role="alert">{error}</p>}
    {proposed && <div className="timetable-proposed" role="region" aria-label="Reglas interpretadas">
      {proposed.length ? <ul>{proposed.map((item, index) => <li key={index}><label className="check"><input type="checkbox" checked={item.checked} onChange={event => setProposed(proposed.map((other, at) => at === index ? { ...other, checked: event.target.checked } : other))}/><span>{item.text}</span></label></li>)}</ul>
        : <p className="muted">No se reconoció ninguna regla con las secciones y docentes de la organización.</p>}
      {dropped > 0 && <p className="muted small">{dropped === 1 ? "Se omitió 1 parte que no corresponde a ninguna sección o docente." : `Se omitieron ${dropped} partes que no corresponden a ninguna sección o docente.`}</p>}
      {proposed.some(item => item.checked) && <div className="button-row"><button type="button" className="button primary small" onClick={() => { onAdd(proposed.filter(item => item.checked).map(item => item.rule)); setProposed(null); setText(""); }}>Agregar las marcadas</button></div>}
    </div>}
  </div>;
}

/** Organización › Horarios › Aulas (1.5.3): the classrooms with their capacity and the sections that use them. */
function Classrooms({ setup, onChange }: { setup: Setup; onChange: (setup: Setup) => void }) {
  const { toast } = useFeedback();
  const [editing, setEditing] = useState<string | null>(null), [busy, setBusy] = useState(false), [error, setError] = useState("");
  async function save(event: React.FormEvent<HTMLFormElement>, id: string | null) {
    event.preventDefault();
    const form = event.currentTarget, data = new FormData(form);
    setBusy(true); setError("");
    try {
      const { classroom } = await api<{ classroom: Classroom }>(id ? `/timetables/classrooms/${id}` : "/timetables/classrooms", id ? "PUT" : "POST", { name: data.get("name"), capacity: Number(data.get("capacity")) });
      const classrooms = id ? setup.classrooms.map(item => item.id === id ? classroom : item) : [...setup.classrooms, classroom];
      onChange({ ...setup, classrooms: classrooms.sort((a, b) => a.name.localeCompare(b.name, "es")) });
      setEditing(null);
      if (!id) form.reset();
      toast({ message: id ? "Aula guardada." : `Aula «${classroom.name}» agregada.` });
    } catch (cause) { setError(message(cause)); }
    finally { setBusy(false); }
  }
  async function archive(room: Classroom) {
    setBusy(true);
    try {
      await api(`/timetables/classrooms/${room.id}`, "DELETE");
      onChange({ ...setup, classrooms: setup.classrooms.filter(item => item.id !== room.id), sections: setup.sections.map(item => item.classroomId === room.id ? { ...item, classroomId: null } : item) });
      toast({ message: `Aula «${room.name}» archivada.` });
    } catch (cause) { toast({ tone: "error", message: message(cause) }); }
    finally { setBusy(false); }
  }
  const fields = (room?: Classroom) => <>
    <Field label="Nombre del aula"><input name="name" required maxLength={80} defaultValue={room?.name}/></Field>
    <Field label="Capacidad"><input name="capacity" type="number" required min={1} max={500} defaultValue={room?.capacity ?? 30}/></Field>
  </>;
  return <Section title="Aulas">
    <p className="muted">Con aulas registradas, cada sección recibe una para toda la semana: su aula habitual o la más pequeña con lugar para sus estudiantes. Un aula no tiene dos clases a la vez.</p>
    {setup.classrooms.length ? <ul className="timetable-rooms">{setup.classrooms.map(room => {
      const users = setup.sections.filter(item => item.classroomId === room.id).map(item => `${item.courseTitle} · ${item.name}`);
      return <li key={room.id}>{editing === room.id
        ? <form className="timetable-room-form" aria-label={`Editar ${room.name}`} onSubmit={event => void save(event, room.id)}>{fields(room)}
          <div className="button-row"><button className="button primary small" disabled={busy}>Guardar</button><button type="button" className="button ghost small" onClick={() => setEditing(null)}>Cancelar</button></div></form>
        : <><span><strong>{room.name}</strong> · {room.capacity} estudiantes · <span className="muted">{users.join(", ") || "sin secciones"}</span></span>
          <span className="button-row"><button type="button" className="button ghost small" onClick={() => setEditing(room.id)}>Editar<span className="sr-only"> {room.name}</span></button>
            <button type="button" className="button ghost small" disabled={busy} onClick={() => void archive(room)}>Archivar<span className="sr-only"> {room.name}</span></button></span></>}
      </li>;
    })}</ul> : <p className="muted">Sin aulas: el horario se genera sin asignar aulas.</p>}
    <form className="timetable-room-form" aria-label="Agregar aula" onSubmit={event => void save(event, null)}>{fields()}
      <div className="button-row"><button className="button secondary" disabled={busy}><Icon name="plus" size={16}/>Agregar aula</button></div></form>
    {error && <p className="field-error" role="alert">{error}</p>}
  </Section>;
}

function WeekGrid({ result, bell, names, rooms, educatorFilter, sectionsOf }: { result: SolverResult; bell: Setup["bellSchedules"][number]; names: Record<string, string>; rooms: Record<string, string>; educatorFilter: string; sectionsOf: (educatorId: string) => Set<string> }) {
  const days = [...bell.weekdays].sort((a, b) => ((a + 6) % 7) - ((b + 6) % 7));
  const shown = educatorFilter ? result.meetings.filter(item => sectionsOf(educatorFilter).has(item.sectionId)) : result.meetings;
  const at = (weekday: number, block: SolverBlock) => shown.filter(item => item.weekday === weekday && item.startsAt <= block.startsAt && block.startsAt < endOf(item));
  return <div className="table-card" role="region" aria-label="Horario semanal" tabIndex={0}><table className="timetable-grid">
    <thead><tr><th scope="col">Periodo</th>{days.map(day => <th key={day} scope="col">{dayLabel(day)}</th>)}</tr></thead>
    <tbody>{bell.blocks.map(block => <tr key={block.key} className={block.kind === "break" ? "is-break" : undefined}>
      <th scope="row">{block.startsAt}–{block.endsAt}</th>
      {block.kind === "break" ? <td colSpan={days.length} className="muted">{block.label || "Recreo"}</td> : days.map(day => <td key={day}>{at(day, block).map(item => <span key={item.sectionId} className="timetable-cell">{names[item.sectionId]}{item.classroomId && rooms[item.classroomId] ? <small>{rooms[item.classroomId]}</small> : null}</span>)}</td>)}
    </tr>)}</tbody>
  </table></div>;
}
const endOf = (item: { startsAt: string; durationMinutes: number }) => { const total = Number(item.startsAt.slice(0, 2)) * 60 + Number(item.startsAt.slice(3)) + item.durationMinutes; return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`; };

export function TimetablesPage() {
  const { toast } = useFeedback();
  const [setup, setSetup] = useState<Setup | null>(null), [error, setError] = useState("");
  const [bellId, setBellId] = useState(""), [choices, setChoices] = useState<Record<string, Choice>>({}), [rules, setRules] = useState<SolverRule[]>([]);
  const [result, setResult] = useState<{ result: SolverResult; names: Record<string, string>; classrooms?: Record<string, string> } | null>(null), [busy, setBusy] = useState(false), [filter, setFilter] = useState("");
  const [range, setRange] = useState({ from: "", until: "" }), [applied, setApplied] = useState<{ name: string; ok: boolean; classes?: number; error?: string }[] | null>(null);
  useEffect(() => {
    void api<Setup>("/timetables").then(data => {
      setSetup(data); setBellId(data.bellSchedules[0]?.id || "");
      setChoices(Object.fromEntries(data.sections.map(item => [item.id, { included: item.educators.length > 0, meetingsPerWeek: item.meetingsPerWeek || 3, blocksPerMeeting: 1 }])));
      setRange({ from: data.year?.from || "", until: data.year?.until || "" });
    }, cause => setError(message(cause)));
  }, []);
  const header = <PageHeader crumbs={[{ label: "Organización", href: "/organizacion" }, { label: "Horarios" }]} title="Horarios" description="Genera el horario semanal de las secciones con la jornada y las reglas. Nada cambia hasta que lo apliques."/>;
  if (error) return <>{header}<ErrorState error={error}/></>;
  if (!setup) return <>{header}<Loading label="Cargando secciones y jornadas…" lines={6}/></>;
  if (!setup.bellSchedules.length) return <>{header}<EmptyState icon="clock" title="Primero define una jornada">En <strong>Organización</strong>, crea la jornada con sus periodos y recreos; el horario se arma sobre ella.</EmptyState></>;
  const context = { sections: setup.sections.map(item => ({ id: item.id, name: `${item.courseTitle} · ${item.name}` })), educators: setup.educators };
  const bell = setup.bellSchedules.find(item => item.id === bellId)!;
  const included = setup.sections.filter(item => choices[item.id]?.included);
  const sectionsOf = (educatorId: string) => new Set(setup.sections.filter(item => item.educators.some(educator => educator.id === educatorId)).map(item => item.id));
  async function generate() {
    setBusy(true); setApplied(null);
    try { setResult(await api("/timetables/solve", "POST", { bellScheduleId: bellId, rules, sections: included.map(item => ({ id: item.id, meetingsPerWeek: choices[item.id].meetingsPerWeek, blocksPerMeeting: choices[item.id].blocksPerMeeting })) })); }
    catch (cause) { toast({ tone: "error", message: message(cause) }); }
    finally { setBusy(false); }
  }
  async function setRoom(sectionId: string, classroomId: string) {
    try {
      await api(`/timetables/sections/${sectionId}/classroom`, "PUT", { classroomId: classroomId || null });
      setSetup({ ...setup!, sections: setup!.sections.map(item => item.id === sectionId ? { ...item, classroomId: classroomId || null } : item) }); setResult(null);
    } catch (cause) { toast({ tone: "error", message: message(cause) }); }
  }
  async function apply() {
    if (!result) return;
    setBusy(true);
    try {
      const answer = await api<{ results: { name: string; ok: boolean; classes?: number; error?: string }[] }>("/timetables/apply", "POST", { from: range.from, until: range.until, meetings: result.result.meetings });
      setApplied(answer.results);
      toast({ message: answer.results.every(item => item.ok) ? `Horario aplicado a ${answer.results.length} secciones.` : "Algunas secciones no se actualizaron: revisa la lista." });
    } catch (cause) { toast({ tone: "error", message: message(cause) }); }
    finally { setBusy(false); }
  }
  return <>
    {header}
    <Section title="Jornada y secciones">
      <Field label="Jornada"><select value={bellId} onChange={event => { setBellId(event.target.value); setResult(null); }}>{setup.bellSchedules.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></Field>
      <div className="table-card" role="region" aria-label="Secciones del horario" tabIndex={0}><table className="timetable-sections">
        <thead><tr><th scope="col">Incluir</th><th scope="col">Sección</th><th scope="col">Docentes</th><th scope="col">Clases por semana</th><th scope="col">Periodos por clase</th>{setup.classrooms.length > 0 && <th scope="col">Aula habitual</th>}</tr></thead>
        <tbody>{setup.sections.map(item => { const choice = choices[item.id]; const label = `${item.courseTitle} · ${item.name}`; return <tr key={item.id}>
          <td><input type="checkbox" aria-label={`Incluir ${label}`} checked={choice.included} onChange={event => { setChoices({ ...choices, [item.id]: { ...choice, included: event.target.checked } }); setResult(null); }}/></td>
          <th scope="row">{label} <span className="muted small">· {item.learners} {item.learners === 1 ? "estudiante" : "estudiantes"}</span></th>
          <td>{item.educators.map(educator => educator.name).join(", ") || <span className="muted">Sin docente</span>}</td>
          <td><input type="number" min={1} max={7} aria-label={`Clases por semana de ${label}`} value={choice.meetingsPerWeek} disabled={!choice.included} onChange={event => { setChoices({ ...choices, [item.id]: { ...choice, meetingsPerWeek: Number(event.target.value) } }); setResult(null); }}/></td>
          <td><select aria-label={`Periodos por clase de ${label}`} value={choice.blocksPerMeeting} disabled={!choice.included} onChange={event => { setChoices({ ...choices, [item.id]: { ...choice, blocksPerMeeting: Number(event.target.value) } }); setResult(null); }}>{[1, 2, 3, 4].map(size => <option key={size} value={size}>{size}</option>)}</select></td>
          {setup.classrooms.length > 0 && <td><select aria-label={`Aula habitual de ${label}`} value={item.classroomId || ""} onChange={event => void setRoom(item.id, event.target.value)}>
            <option value="">La que quepa</option>{setup.classrooms.map(room => <option key={room.id} value={room.id}>{room.name} ({room.capacity})</option>)}</select></td>}
        </tr>; })}</tbody>
      </table></div>
    </Section>
    <Classrooms setup={setup} onChange={next => { setSetup(next); setResult(null); }}/>
    <Section title="Reglas">
      <p className="muted">Siempre se cumplen: ningún docente da dos clases a la vez, cada sección tiene a lo sumo una clase por día y se respeta la disponibilidad declarada en el perfil. Agrega las demás.</p>
      {rules.length ? <ul className="timetable-rules">{rules.map((rule, index) => <li key={index}><span>{ruleText(rule, context)}</span><button type="button" className="button ghost small" onClick={() => { setRules(rules.filter((_, at) => at !== index)); setResult(null); }}>Quitar<span className="sr-only"> la regla: {ruleText(rule, context)}</span></button></li>)}</ul> : <p className="muted">Sin reglas adicionales.</p>}
      <div className="timetable-rule-tools">
        <RuleForm setup={setup} onAdd={rule => { setRules([...rules, rule]); setResult(null); }}/>
        <WrittenRules onAdd={added => { setRules([...rules, ...added]); setResult(null); }}/>
      </div>
    </Section>
    <div className="button-row"><PrimaryAction icon="sparkles" busy={busy} disabled={busy || !included.length} onClick={() => void generate()}>Generar horario</PrimaryAction></div>
    {result && <Section title="Horario propuesto">
      {result.result.status === "solved"
        ? <p><StatusBadge tone="success">Sin choques</StatusBadge> {result.result.meetings.length} clases de {included.length} secciones.{result.result.preferredMissed ? ` ${result.result.preferredMissed} ${result.result.preferredMissed === 1 ? "clase quedó" : "clases quedaron"} fuera de los días preferidos.` : ""}</p>
        : <div className="message-bar warning" role="status"><Icon name="alert" size={18}/><div>
          <strong>{result.result.exhausted ? "No se encontró un horario completo en el tiempo de búsqueda." : "No hay un horario que cumpla todas las reglas."}</strong> Se muestra lo que sí se pudo ubicar.
          <ul>{result.result.unplaced.map(item => <li key={item.sectionId}><strong>{result.names[item.sectionId]}</strong>: {item.placed} de {item.needed} clases. {item.reasons.slice(0, 3).map(reason => `${reason.reason} (${reason.slots})`).join(" · ")}</li>)}</ul>
        </div></div>}
      <Field label="Ver el horario de"><select value={filter} onChange={event => setFilter(event.target.value)}><option value="">Todas las secciones</option>{setup.educators.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></Field>
      <WeekGrid result={result.result} bell={bell} names={result.names} rooms={result.classrooms || {}} educatorFilter={filter} sectionsOf={sectionsOf}/>
      {result.result.status === "solved" && <div className="timetable-apply">
        <div className="ai-price-fields"><Field label="Desde"><input type="date" value={range.from} onChange={event => setRange({ ...range, from: event.target.value })}/></Field><Field label="Hasta"><input type="date" value={range.until} onChange={event => setRange({ ...range, until: event.target.value })}/></Field></div>
        <p className="muted small">Cada sección toma este horario en esas fechas: sus clases pendientes se regeneran y conservan lo planificado, como al guardar su horario.</p>
        <div className="button-row"><button type="button" className="button primary" disabled={busy || !range.from || !range.until} onClick={() => void apply()}>Aplicar a las secciones</button></div>
      </div>}
      {applied && <ul className="timetable-applied">{applied.map(item => <li key={item.name}><StatusBadge tone={item.ok ? "success" : "danger"}>{item.ok ? "Aplicado" : "No se aplicó"}</StatusBadge> {item.name}{item.ok ? ` · ${item.classes} clases pendientes` : ` · ${item.error}`}</li>)}</ul>}
    </Section>}
  </>;
}
