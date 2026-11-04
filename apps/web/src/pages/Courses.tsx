import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import type { AcademicProfile, Course, CourseFormat, CourseProgress, CourseSettings, EducationLevel, EducationType, LearningUnit, Lesson, Modality, Pacing, StudyProgram, Taxonomy } from "@happy-learners/contracts";
import type { FreedomPolicy } from "@happy-learners/domain";
import { areaLabel, attentionLabels, courseAttention, courseFormats, coursePresets, derivedSettings, educationLevels, educationTypes, knowledgeAreas, labelOf, modalities, pacings, resolveSettings, settingChoices, settingDefinitions, settingText, settingValue, sourceLabel } from "@happy-learners/domain";
import type { SettingKey } from "@happy-learners/domain";
import { api, ApiError, message } from "../api";
import { Link, useNavigation, useUnsavedChanges } from "../navigation";
import { personalToday } from "../regional";
import { useSession } from "../session";
import { courseBody, courseStats, matches, newest, plural } from "../model";
import { FreedomChangeDialog, FreedomPolicyField } from "../ui/freedom";
import type { CourseStats } from "../model";
import { CourseCard } from "../ui/cards";
import { useFeedback } from "../ui/feedback";
import { Icon } from "../ui/icons";
import { Button, EmptyState, ErrorState, Field, Loading, PageHeader, PrimaryAction } from "../ui/primitives";
import { schemeOptions, useGradingSchemes } from "./grading/Schemes";
import { AiWrite } from "../ui/AiWrite";

export function useCourseActions(reload: () => Promise<void>) {
  const { toast, confirm } = useFeedback();
  const { navigate } = useNavigation();
  async function setStatus(course: Course, status: Course["status"]) {
    if (status === "archived" && !await confirm({ title: `¿Archivar «${course.title}»?`, body: <p>El curso sale de la lista de cursos activos y deja de admitir cambios. Los enlaces de lecciones ya publicadas siguen funcionando. Puedes restaurarlo cuando quieras.</p>, confirm: "Archivar curso", danger: true })) return;
    try { await api(`/courses/${course.id}`, "PUT", courseBody(course, { status })); await reload(); toast({ message: status === "archived" ? `«${course.title}» se archivó.` : `«${course.title}» se restauró.` }); }
    catch (error) { toast({ tone: "error", message: `${message(error)} Recarga la página e inténtalo de nuevo.` }); }
  }
  async function duplicate(course: Course) {
    if (!await confirm({ title: `¿Duplicar «${course.title}»?`, body: <p>Se crea una copia con su configuración, módulos, plan curricular, recursos y lecciones. Todas las lecciones de la copia quedan como borrador; las secciones, el horario, las clases y la asistencia no se copian.</p>, confirm: "Duplicar curso" })) return;
    toast({ tone: "info", message: "Creando la copia…" });
    try { const { id } = await api<{ id: string }>(`/courses/${course.id}/duplicate`, "POST"); await reload(); toast({ message: `Copia creada: «${course.title} (copia)», con el mismo equipo docente.`, action: { label: "Abrir", onSelect: () => navigate(`/cursos/${id}`) } }); }
    catch (error) { toast({ tone: "error", message: message(error) }); }
  }
  return { setStatus, duplicate };
}

/** Facets for the course list: each option shows how many courses it would leave. */
const facets: { key: string; param: string; label: string; value: (course: Course, program?: StudyProgram) => string | undefined; name: (value: string, programs: StudyProgram[], courses?: Course[]) => string }[] = [
  { key: "program", param: "programa", label: "Programa", value: course => course.programId || "none", name: (value, programs) => value === "none" ? "Sin programa" : programs.find(item => item.id === value)?.name || value },
  { key: "level", param: "nivel", label: "Nivel educativo", value: (course, program) => program?.level || course.level, name: value => labelOf.level(value as EducationLevel) },
  { key: "format", param: "formato", label: "Formato", value: course => course.format, name: value => labelOf.format(value as CourseFormat) },
  { key: "area", param: "area", label: "Área", value: course => course.area?.slice(0, 2), name: value => areaLabel(value) },
  { key: "lead", param: "responsable", label: "Responsable", value: course => course.team?.find(member => member.role === "lead")?.userId || "none", name: (value, _programs, courses) => value === "none" ? "Sin responsable" : courses?.flatMap(course => course.team || []).find(member => member.userId === value)?.name || value },
  { key: "modality", param: "modalidad", label: "Modalidad", value: (course, program) => program?.modality || course.modality, name: value => labelOf.modality(value as Modality) },
];

export function CourseList() {
  const { member } = useSession();
  const admin = member.role === "admin";
  const { url, navigate } = useNavigation();
  const [courses, setCourses] = useState<Course[] | null>(null), [programs, setPrograms] = useState<StudyProgram[]>([]), [stats, setStats] = useState<Record<string, CourseStats>>({}), [error, setError] = useState("");
  const query = url.searchParams.get("q") || "", archived = url.searchParams.get("estado") === "archivados";
  async function load() {
    setError("");
    try {
      const [{ courses }, { lessons }, { programs }] = await Promise.all([api<{ courses: Course[] }>("/courses"), api<{ lessons: Lesson[] }>("/lessons?drafts=1"), api<{ programs: StudyProgram[] }>("/programs")]);
      setCourses(courses); setPrograms(programs);
      // CUR-03: the list brings each course's active units; no request per course (25 in the demonstration).
      setStats(Object.fromEntries(courses.map(course => [course.id, { ...courseStats([], lessons.filter(lesson => lesson.courseId === course.id)), units: course.unitCount ?? 0 }])));
    } catch (cause) { setError(message(cause)); }
  }
  useEffect(() => { void load(); }, []);
  const actions = useCourseActions(load);
  function filter(key: string, value: string) { const next = new URL(url); if (value) next.searchParams.set(key, value); else next.searchParams.delete(key); navigate(next.pathname + next.search, true); }
  const programOf = (course: Course) => programs.find(item => item.id === course.programId);
  const active = courses?.filter(course => course.status === "active").length || 0;
  const pool = (courses || []).filter(course => (archived ? course.status === "archived" : course.status === "active") && matches(query, course.title, course.objective));
  const selected = (facet: typeof facets[number]) => url.searchParams.get(facet.param) || "";
  const passes = (course: Course, skip?: string) => facets.every(facet => facet.key === skip || !selected(facet) || facet.value(course, programOf(course)) === selected(facet));
  // CUR-02: most recent (default), by name, or those that need attention first with their reasons (HOME-01).
  const order = (["nombre", "atencion"] as const).find(value => value === url.searchParams.get("orden")) || "recientes";
  const [progress, setProgress] = useState<CourseProgress[] | null>(null);
  useEffect(() => { if (order === "atencion" && !progress) api<{ courses: CourseProgress[] }>("/progress").then(result => setProgress(result.courses), () => setProgress([])); }, [order]);
  const reasonsOf = new Map((order === "atencion" && progress ? progress : []).map(item => [item.courseId, courseAttention(item, personalToday())]));
  const weightOf = (course: Course) => (reasonsOf.get(course.id) || []).length;
  const filteredPool = pool.filter(course => passes(course));
  const visible = order === "nombre" ? [...filteredPool].sort((a, b) => a.title.localeCompare(b.title, "es", { numeric: true }))
    : order === "atencion" ? newest(filteredPool).sort((a, b) => weightOf(b) - weightOf(a)) : newest(filteredPool);
  const filtered = facets.some(selected);
  // CUR-01: a list of rows on phones unless the address says otherwise; cards elsewhere.
  const [narrow] = useState(() => typeof window !== "undefined" && window.matchMedia?.("(max-width: 720px)").matches);
  const view = url.searchParams.get("vista") === "lista" || (!url.searchParams.get("vista") && narrow) ? "lista" : "tarjetas";
  // In the list, grouped by program when there is more than one and none is chosen; independent courses last. Cards
  // stay in one grid: with several programs of one or two courses, groups would leave rows half empty.
  const groupNames = new Map(visible.map(course => [course.programId || "", programOf(course)?.name || "Sin programa"]));
  const groups = view === "lista" && !selected(facets[0]) && groupNames.size > 1
    ? [...groupNames.entries()].sort(([a, x], [b, y]) => (a ? 0 : 1) - (b ? 0 : 1) || x.localeCompare(y, "es")).map(([id, name]) => ({ id, name, courses: visible.filter(course => (course.programId || "") === id) }))
    : [{ id: "all", name: "", courses: visible }];
  const menuOf = (course: Course) => admin ? [
    { label: "Abrir", icon: "arrowRight" as const, onSelect: () => navigate(`/cursos/${course.id}`) },
    { label: "Editar configuración", icon: "settings" as const, onSelect: () => navigate(`/cursos/${course.id}/configuracion`) },
    { label: "Duplicar", icon: "copy" as const, onSelect: () => void actions.duplicate(course) },
    "separator" as const,
    course.status === "active" ? { label: "Archivar", icon: "archive" as const, danger: true, onSelect: () => void actions.setStatus(course, "archived") } : { label: "Restaurar", icon: "archive" as const, onSelect: () => void actions.setStatus(course, "active") },
  ] : undefined;
  const list = (items: Course[]) => <div className={view === "lista" ? "card-grid course-rows" : "card-grid"}>{items.map(course => <CourseCard key={course.id} course={course} program={programOf(course)} stats={stats[course.id]} row={view === "lista"} menu={menuOf(course)}
    reasons={order === "atencion" ? (reasonsOf.get(course.id) || []).map(reason => attentionLabels[reason]) : undefined}/>)}</div>;
  return <>
    <PageHeader title="Cursos" description={courses ? archived ? plural(courses.length - active, "curso archivado", "cursos archivados") : admin ? plural(active, "curso activo", "cursos activos") : `${plural(active, "curso asignado", "cursos asignados")} a tu cuenta` : undefined} primary={admin && (!courses || courses.length > 0) && <PrimaryAction href="/cursos/nuevo" icon="plus">Crear curso</PrimaryAction>}/>
    <div className="toolbar" role="group" aria-label="Filtrar cursos">
      <div className="search-field"><Icon name="search" size={18}/><label htmlFor="course-search" className="sr-only">Buscar cursos</label><input id="course-search" type="search" value={query} onChange={event => filter("q", event.target.value)} placeholder="Buscar por nombre u objetivo"/></div>
      <fieldset className="segmented"><legend className="sr-only">Estado</legend>
        {[["", "Activos"], ["archivados", "Archivados"]].map(([value, label]) => <label key={label}><input type="radio" name="course-status" checked={(url.searchParams.get("estado") || "") === value} onChange={() => filter("estado", value)}/><span>{label}</span></label>)}
      </fieldset>
      <label className="select-inline"><span>Ordenar</span><select value={order} onChange={event => filter("orden", event.target.value === "recientes" ? "" : event.target.value)}>
        <option value="recientes">Recientes</option><option value="nombre">Por nombre</option><option value="atencion">Necesitan atención</option>
      </select></label>
      <fieldset className="segmented"><legend className="sr-only">Vista</legend>
        {[["tarjetas", "Tarjetas"], ["lista", "Lista"]].map(([value, label]) => <label key={value}><input type="radio" name="course-view" checked={view === value} onChange={() => filter("vista", value)}/><span>{label}</span></label>)}
      </fieldset>
    </div>
    {courses && courses.length > 1 && <div className="facet-bar" role="group" aria-label="Filtrar por configuración académica">
      {facets.map(facet => {
        // Counts follow the other active filters, so every option says what it would leave.
        const counts = new Map<string, number>();
        for (const course of pool.filter(item => passes(item, facet.key))) { const value = facet.value(course, programOf(course)); if (value) counts.set(value, (counts.get(value) || 0) + 1); }
        if (counts.size < 2 && !selected(facet)) return null;
        return <label key={facet.key} className="facet"><span>{facet.label}</span><select value={selected(facet)} onChange={event => filter(facet.param, event.target.value)}>
          <option value="">Todos</option>{[...counts.entries()].sort((x, y) => facet.name(x[0], programs, courses).localeCompare(facet.name(y[0], programs, courses), "es")).map(([value, count]) => <option key={value} value={value}>{facet.name(value, programs, courses)} ({count})</option>)}
        </select></label>;
      })}
      {filtered && <Button variant="ghost" icon="close" onClick={() => { const next = new URL(url); facets.forEach(facet => next.searchParams.delete(facet.param)); navigate(next.pathname + next.search, true); }}>Quitar filtros</Button>}
    </div>}
    {error ? <ErrorState error={error} retry={() => void load()}/> : !courses ? <Loading label="Cargando cursos…" cards={3}/> :
      visible.length ? (groups.length > 1 ? <div className="stack-lg">{groups.map(group => <section key={group.id} className="course-group" aria-labelledby={`course-group-${group.id || "none"}`}>
        <h2 id={`course-group-${group.id || "none"}`} className="course-group-title">{group.name} <span className="muted">({group.courses.length})</span></h2>
        {list(group.courses)}
      </section>)}</div> : list(visible))
      : query || filtered ? <EmptyState icon="search" title="Ningún curso coincide con la búsqueda y los filtros" action={<Button onClick={() => navigate(url.pathname, true)}>Limpiar búsqueda y filtros</Button>}>Prueba con otra palabra o quita algún filtro.</EmptyState>
      : archived ? <EmptyState icon="archive" title="No hay cursos archivados">Los cursos que archives aparecerán aquí y podrás restaurarlos.</EmptyState>
      : admin ? <EmptyState icon="courses" title="Crea tu primer curso" action={<PrimaryAction href="/cursos/nuevo" icon="plus">Crear curso</PrimaryAction>}>Un curso reúne módulos, lecciones y recursos. Puede ser una asignatura, un taller o un curso libre.</EmptyState>
      : <EmptyState icon="courses" title="Aún no tienes cursos asignados">Administración crea los cursos y te asigna como responsable o colaborador. Aquí aparecerán los cursos en los que participas.</EmptyState>}
  </>;
}

/** Free tags for library resources (search and filters). Course configuration uses standard dimensions instead. */
export function TermChoices({ taxonomy, selected, onChange }: { taxonomy: Taxonomy; selected: string[]; onChange: (ids: string[]) => void }) {
  const groups = taxonomy.vocabularies.map(vocabulary => ({ vocabulary, terms: taxonomy.terms.filter(term => term.vocabularyId === vocabulary.id && ((vocabulary.status === "active" && term.status === "active") || selected.includes(term.id))) })).filter(group => group.terms.length);
  if (!groups.length) return null;
  return <fieldset className="choice-group"><legend>Etiquetas <span className="optional">(opcional)</span></legend>
    {groups.map(({ vocabulary, terms }) => <div key={vocabulary.id} className="choice-row"><span className="choice-label">{vocabulary.name}</span><div className="chips">{terms.map(term => <label key={term.id} className="chip"><input type="checkbox" checked={selected.includes(term.id)} onChange={event => onChange(event.target.checked ? [...selected, term.id] : selected.filter(id => id !== term.id))}/><span>{term.name}{term.status === "archived" ? " (archivada)" : ""}</span></label>)}</div></div>)}
  </fieldset>;
}

type Dimensions = AcademicProfile & { format: CourseFormat; area: string; programId: string };
/**
 * Create and configure a course: a starting template, an optional program, the standard dimensions and
 * the resulting behaviour, where every setting shows its value and where it comes from.
 */
export function CourseForm({ course, onSaved, cancelHref, readOnly = false }: { course?: Course; onSaved: (id: string) => Promise<void> | void; cancelHref: string; readOnly?: boolean }) {
  const [programs, setPrograms] = useState<StudyProgram[]>([]), [people, setPeople] = useState<{ id: string; username: string; name: string }[]>([]);
  const [dims, setDims] = useState<Dimensions>(() => course
    ? { educationType: course.educationType, level: course.level, modality: course.modality, pacing: course.pacing, format: course.format, area: course.area || "", programId: course.programId || "" }
    : { ...coursePresets[0].values, area: "", programId: "" });
  const [settings, setSettings] = useState<CourseSettings>(course?.settings || {});
  const [dirty, setDirty] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState("");
  const [pendingPolicy, setPendingPolicy] = useState<FreedomPolicy | null>(null), [policyBlock, setPolicyBlock] = useState<{ message: string; affected: { section: string; activity: string }[] } | null>(null);
  const { guard } = useNavigation();
  useUnsavedChanges(dirty);
  useEffect(() => { api<{ programs: StudyProgram[] }>("/programs").then(result => setPrograms(result.programs)).catch(() => undefined); }, []);
  const schemes = useGradingSchemes();
  useEffect(() => { if (!course) api<{ people: typeof people }>("/people").then(result => setPeople(result.people)).catch(() => undefined); }, []);
  const program = programs.find(item => item.id === dims.programId) || null;
  const choosable = programs.filter(item => item.status === "active" || item.id === course?.programId);
  const profile = program ? { educationType: program.educationType, level: program.level, modality: program.modality, pacing: program.pacing } : dims;
  const resolved = resolveSettings({ ...profile, format: dims.format, settings }, program);
  const change = (patch: Partial<Dimensions>) => { setDims(current => {
    const next = { ...current, ...patch };
    if (next.educationType === "formal" && next.level === "unspecified") next.level = "primary";
    return next;
  }); setDirty(true); };
  function choose(programId: string) {
    const chosen = programs.find(item => item.id === programId);
    // A new course in a program starts with the program's format and field.
    change(chosen && !course ? { programId, format: chosen.format, area: chosen.area || "" } : { programId });
  }
  const setSetting = (key: SettingKey, value: string) => { setSettings(current => { const next = { ...current } as Record<string, unknown>; const parsed = settingValue(key, value); if (parsed === undefined) delete next[key]; else next[key] = parsed; return next as CourseSettings; }); setDirty(true); };
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = Object.fromEntries(new FormData(event.currentTarget)) as Record<string, string>;
    setBusy(true); setError("");
    try {
      const body = { title: data.title, objective: data.objective, status: course?.status || "active", programId: dims.programId || null, ...profile, format: dims.format, area: dims.area || null, settings, version: course?.version, ...(course ? {} : { leadId: data.leadId }) };
      const result = await api<{ id: string }>(course ? `/courses/${course.id}` : "/courses", course ? "PUT" : "POST", body);
      setDirty(false); guard(false);
      await onSaved(result.id);
    } catch (cause) { setError(message(cause)); }
    finally { setBusy(false); }
  }
  const valueText = settingText;
  const freedom = resolved.values.sectionFreedom;
  const freedomLocked = resolved.source.sectionFreedom === "program-locked";
  async function confirmPolicy() {
    if (!pendingPolicy) return;
    const next = { ...settings, sectionFreedom: pendingPolicy };
    if (!course) { setSetting("sectionFreedom", pendingPolicy); setPendingPolicy(null); setPolicyBlock(null); return; }
    const form = document.getElementById("course-form") as HTMLFormElement | null;
    const data = form ? Object.fromEntries(new FormData(form)) as Record<string, string> : {};
    setBusy(true); setError("");
    try {
      await api(`/courses/${course.id}`, "PUT", { title: data.title || course.title, objective: data.objective ?? course.objective, status: course.status, programId: dims.programId || null, ...profile, format: dims.format, area: dims.area || null, settings: next, version: course.version });
      setSettings(next); setDirty(false); guard(false); setPendingPolicy(null); setPolicyBlock(null);
      await onSaved(course.id);
    } catch (cause) {
      if (cause instanceof ApiError && cause.status === 409) {
        const affected = Array.isArray(cause.detail.affected) ? cause.detail.affected as { section: string; activity: string }[] : [];
        setPolicyBlock({ message: cause.message, affected });
      } else setError(message(cause));
    } finally { setBusy(false); }
  }
  return <><form id="course-form" className="form-card course-form" onSubmit={save} onChange={() => setDirty(true)}>
    {error && <p className="form-alert" role="alert"><Icon name="alert" size={18}/>{error}</p>}
    {readOnly && <p className="notice"><Icon name="info" size={18}/>Administración configura el curso. Si necesitas un cambio, pídeselo.</p>}
    <fieldset disabled={busy || readOnly} className="stack">
      <Field label="Nombre del curso"><input name="title" required maxLength={160} defaultValue={course?.title} placeholder="Ej. Exploradores"/></Field>
      <Field label="Objetivo" optional hint="Qué podrán hacer sus estudiantes al terminar. Aparece en el resumen del curso."><textarea data-ai-write="course-objective" name="objective" maxLength={1000} rows={3} defaultValue={course?.objective}/></Field>
      <AiWrite field="course-objective" target="course-objective" label="Objetivo" courseId={course?.id} context={{ course: course?.title }}/>
      {!course && <Field label="Responsable del curso" hint="Prepara y publica el contenido y el plan curricular. Después asignas a quienes imparten cada sección.">
        <select name="leadId" required defaultValue=""><option value="" disabled>Elige a la persona responsable…</option>{people.map(person => <option key={person.id} value={person.id}>{person.name} (@{person.username})</option>)}</select>
      </Field>}
      {!course && !program && <fieldset className="preset-picker"><legend>Punto de partida</legend>
        <p className="muted small">Llena la configuración de una vez; después puedes ajustar cada valor.</p>
        <div className="preset-grid">{coursePresets.map(preset => { const on = Object.entries(preset.values).every(([key, value]) => dims[key as keyof Dimensions] === value); return <label key={preset.id} className={`preset${on ? " is-selected" : ""}`}>
          <input type="radio" name="preset" checked={on} onChange={() => change(preset.values)}/><strong>{preset.label}</strong><small>{preset.description}</small>
        </label>; })}</div>
      </fieldset>}
      <section className="config-section" aria-labelledby="academic-title">
        <h2 id="academic-title">Configuración académica</h2>
        <Field label="Programa" optional hint={program ? "El tipo, el nivel, la modalidad y el ritmo vienen del programa." : "Un programa reúne cursos que comparten configuración. Sin programa, el curso es independiente."}>
          <select value={dims.programId} onChange={event => choose(event.target.value)}><option value="">Sin programa (curso independiente)</option>{choosable.map(item => <option key={item.id} value={item.id}>{item.name}{item.status === "archived" ? " (archivado)" : ""}</option>)}</select>
        </Field>
        {program ? <dl className="inherited">
          <div><dt>Tipo de educación</dt><dd>{labelOf.type(program.educationType)}</dd></div>
          <div><dt>Nivel educativo</dt><dd>{labelOf.level(program.level)}</dd></div>
          <div><dt>Modalidad</dt><dd>{labelOf.modality(program.modality)}</dd></div>
          <div><dt>Ritmo</dt><dd>{labelOf.pacing(program.pacing)}</dd></div>
        </dl> : <div className="field-grid">
          <Field label="Tipo de educación" hint={educationTypes.find(item => item.value === dims.educationType)?.hint}><select value={dims.educationType} onChange={event => change({ educationType: event.target.value as EducationType })}>{educationTypes.map(item => <option key={item.value} value={item.value}>{item.label}</option>)}</select></Field>
          <Field label="Nivel educativo" hint={educationLevels.find(item => item.value === dims.level)?.hint}><select value={dims.level} onChange={event => change({ level: event.target.value as EducationLevel })}>{educationLevels.map(item => <option key={item.value} value={item.value} disabled={item.value === "unspecified" && dims.educationType === "formal"}>{item.code === "—" ? item.label : `${item.label} (${item.code})`}</option>)}</select></Field>
          <Field label="Modalidad"><select value={dims.modality} onChange={event => change({ modality: event.target.value as Modality })}>{modalities.map(item => <option key={item.value} value={item.value}>{item.label}</option>)}</select></Field>
          <Field label="Ritmo" hint={pacings.find(item => item.value === dims.pacing)?.hint}><select value={dims.pacing} onChange={event => change({ pacing: event.target.value as Pacing })}>{pacings.map(item => <option key={item.value} value={item.value}>{item.label}</option>)}</select></Field>
        </div>}
        <div className="field-grid">
          <Field label="Formato" hint={courseFormats.find(item => item.value === dims.format)?.hint}><select value={dims.format} onChange={event => change({ format: event.target.value as CourseFormat })}>{courseFormats.map(item => <option key={item.value} value={item.value}>{item.label}</option>)}</select></Field>
          <Field label="Área de conocimiento" optional hint="Clasificación CINE-F 2013 de la UNESCO."><select value={dims.area} onChange={event => change({ area: event.target.value })}><option value="">Sin área</option>{knowledgeAreas.map(area => <optgroup key={area.code} label={area.label}>
            <option value={area.code}>{area.label} (general)</option>{area.fields.length > 1 && area.fields.map(field => <option key={field.code} value={field.code}>{field.label}</option>)}
          </optgroup>)}</select></Field>
        </div>
      </section>
      <section className="config-section" aria-labelledby="behaviour-title">
        <h2 id="behaviour-title">Comportamiento del curso</h2>
        <p className="muted small">Cada ajuste toma su valor del tipo de curso o del programa. Cámbialo solo si este curso necesita algo distinto.</p>
        <ul className="settings-list">{settingDefinitions.filter(definition => definition.key !== "sectionFreedom" && definition.key !== "sectionFreedomReview").map(definition => {
          const key = definition.key, source = resolved.source[key], locked = source === "program-locked";
          const inherited = program?.settings[key] !== undefined ? program.settings[key] : derivedSettings({ ...profile, format: dims.format })[key];
          const options = key === "gradingSchemeId" ? schemeOptions(schemes, settings[key]) : settingChoices(key, settings[key]);
          return <li key={key} className="setting-item">
            <div><strong id={`setting-${key}`}>{definition.label}</strong><p className="muted small">{definition.description}</p></div>
            <div className="setting-control">
              <select aria-labelledby={`setting-${key}`} disabled={locked} value={locked ? "" : settings[key] === undefined ? "" : String(settings[key])} onChange={event => setSetting(key, event.target.value)}>
                <option value="">{locked ? `${valueText(key, resolved.values[key])} (fijado)` : `${program?.settings[key] !== undefined ? "Del programa" : "Automático"}: ${valueText(key, inherited)}`}</option>
                {!locked && options.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
              </select>
              <span className={`source-tag source-${source}`}>{sourceLabel[source]}</span>
              {key === "gradingSchemeId" && course && <Link href={`/cursos/${course.id}/evaluacion`}>Ver cómo se calcula</Link>}
            </div>
          </li>;
        })}</ul>
        <FreedomPolicyField name="section-freedom" value={freedom} disabled={readOnly || freedomLocked} lockedBy={freedomLocked ? program?.name : undefined} onChoose={next => { setPolicyBlock(null); setPendingPolicy(next); }}
          review={settings.sectionFreedomReview === true} reviewLocked={readOnly || resolved.source.sectionFreedomReview === "program-locked"} onReview={checked => { setSettings(current => ({ ...current, sectionFreedomReview: checked })); setDirty(true); }}/>
      </section>
      {!readOnly && <div className="form-actions"><button className="button primary">{busy ? "Guardando…" : course ? "Guardar cambios" : "Crear curso"}</button><Link href={cancelHref} className="button ghost">Cancelar</Link></div>}
    </fieldset>
  </form>
  {pendingPolicy && <FreedomChangeDialog from={freedom} to={pendingPolicy} blocked={policyBlock} busy={busy} onClose={() => { setPendingPolicy(null); setPolicyBlock(null); }} onConfirm={() => void confirmPolicy()}/>}
  </>;
}

export function CreateCourse() {
  const { member } = useSession();
  const { navigate } = useNavigation();
  const { toast } = useFeedback();
  if (member.role !== "admin") return <><PageHeader title="Crear curso" crumbs={[{ label: "Cursos", href: "/cursos" }, { label: "Crear curso" }]}/><EmptyState icon="shield" title="Administración crea los cursos" action={<Link href="/cursos" className="button primary">Ver mis cursos</Link>}>Administración crea cada curso, sus secciones y su horario, y asigna a su equipo docente.</EmptyState></>;
  return <>
    <PageHeader title="Crear curso" crumbs={[{ label: "Cursos", href: "/cursos" }, { label: "Crear curso" }]} description="Empieza por el nombre, el propósito, el tipo de curso y su responsable. Después creas sus secciones, su horario y asignas a quienes las imparten."/>
    <div><CourseForm cancelHref="/cursos" onSaved={id => { toast({ message: "Curso creado. Desde su resumen creas sus secciones y asignas a quienes las imparten." }); navigate(`/cursos/${id}`); }}/></div>
  </>;
}
