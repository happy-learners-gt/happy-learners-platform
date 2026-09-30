import { useEffect, useState } from "react";
import type { FormEvent, ReactNode } from "react";
import type { ClassSession, Course, GroupLearner, LearningUnit, Lesson, Material, Member, Taxonomy, TaxonomyTerm, Vocabulary } from "@happy-learners/contracts";
import { courseProfiles, unitLabels } from "@happy-learners/domain";
import { api } from "./api";
import { Link, useNavigation, useUnsavedChanges } from "./navigation";
import { Workspace } from "./Workspace";
import { OfficePreview } from "./OfficePreview";

const emptyTaxonomy: Taxonomy = { vocabularies: [], terms: [] };
const message = (error: unknown) => error instanceof Error ? error.message : "No se pudieron guardar los cambios.";
function Field({ name, label, children }: { name: string; label: string; children: ReactNode }) {
  return <div className="field"><label htmlFor={name}>{label}</label>{children}</div>;
}
function Updated({ value }: { value: string }) { return <small>Actualizado: {new Date(value).toLocaleString("es-GT")}</small>; }
function TermChoices({ taxonomy, selected, onChange }: { taxonomy: Taxonomy; selected: string[]; onChange: (ids: string[]) => void }) {
  return <fieldset className="classification"><legend>Clasificación opcional</legend><p>No cambia los permisos ni los requisitos de aprendizaje.</p>{taxonomy.vocabularies.map(vocabulary => {
    const terms = taxonomy.terms.filter(t => t.vocabularyId === vocabulary.id && ((vocabulary.status === "active" && t.status === "active") || selected.includes(t.id)));
    return terms.length ? <fieldset key={vocabulary.id}><legend>{vocabulary.name}</legend><div className="term-choices">{terms.map(t => <label key={t.id}><input type="checkbox" checked={selected.includes(t.id)} onChange={e => onChange(e.target.checked ? [...selected, t.id] : selected.filter(id => id !== t.id))}/><span>{t.name}{t.status === "archived" || vocabulary.status === "archived" ? " (archivado)" : ""}</span></label>)}</div></fieldset> : null;
  })}{!taxonomy.terms.length && <p>Administración puede configurar vocabularios. Puedes guardar sin clasificar.</p>}</fieldset>;
}
function TermBadges({ ids, taxonomy }: { ids: string[]; taxonomy: Taxonomy }) {
  return <div className="term-badges">{ids.map(id => { const term = taxonomy.terms.find(t => t.id === id); return term ? <span className="pill" key={id}>{term.name}{term.status === "archived" ? " · archivado" : ""}</span> : null; })}</div>;
}

export function Courses({ member }: { member: Member }) {
  const { url } = useNavigation();
  const parts = url.pathname.split("/").filter(Boolean);
  if (parts[1] === "nuevo") return member.role === "educator" ? <CourseForm/> : <p role="alert">Solo educadores pueden crear cursos.</p>;
  if (parts[1]) return <CoursePage key={parts[1]} id={parts[1]} area={parts[2] || "contenido"} member={member}/>;
  return <CourseList member={member}/>;
}
function CourseList({ member }: { member: Member }) {
  const { url, navigate } = useNavigation();
  const [courses, setCourses] = useState<Course[]>([]), [taxonomy, setTaxonomy] = useState<Taxonomy>(emptyTaxonomy);
  const [loading, setLoading] = useState(true), [error, setError] = useState("");
  const query = url.searchParams.get("q") || "", archived = url.searchParams.get("archivo") === "1";
  useEffect(() => {
    let active = true;
    Promise.all([api<{ courses: Course[] }>("/courses"), api<Taxonomy>("/taxonomy")]).then(([c, t]) => { if (active) { setCourses(c.courses); setTaxonomy(t); } }).catch(e => { if (active) setError(message(e)); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);
  function filter(key: string, value: string) { const next = new URL(url); value ? next.searchParams.set(key, value) : next.searchParams.delete(key); navigate(next.pathname + next.search, true); }
  const search = (value: string) => value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase("es");
  const visible = courses.filter(c => (archived ? c.status === "archived" : c.status === "active") && search(`${c.title} ${c.objective}`).includes(search(query)));
  return <><div className="page-heading"><div><span className="eyebrow">Preparar · Organizar · Enseñar</span><h1>Cursos</h1><p>Cada curso reúne su objetivo, secuencia de aprendizaje y materiales.</p></div>{member.role === "educator" && <Link href="/cursos/nuevo" className="primary">Crear curso</Link>}</div>
    <div className="course-filters"><Field name="course-search" label="Buscar cursos"><input id="course-search" type="search" value={query} onChange={e => filter("q", e.target.value)} placeholder="Título u objetivo"/></Field><Field name="course-archive" label="Mostrar"><select id="course-archive" value={archived ? "1" : ""} onChange={e => filter("archivo", e.target.value)}><option value="">Cursos activos</option><option value="1">Archivo</option></select></Field></div>
    {error && <p className="alert error" role="alert">{error}</p>}{loading && <p role="status">Cargando cursos…</p>}
    {!loading && !error && !visible.length && <div className="empty-state"><h2>{courses.length ? "No hay cursos con esos filtros" : "Prepara tu primer curso"}</h2><p>Puede ser un taller breve, una asignatura o un recorrido guiado. No depende de una materia o nivel escolar específicos.</p></div>}
    <div className="course-grid">{visible.map(c => <article className="course-card" key={c.id}><span className="eyebrow">{courseProfiles.find(p => p.value === c.profile)?.label}</span><h2><Link href={`/cursos/${c.id}`}>{c.title}</Link></h2><p>{c.objective || "Define el objetivo y organiza el contenido del curso."}</p><TermBadges ids={c.termIds} taxonomy={taxonomy}/><footer><Updated value={c.updatedAt}/><Link href={`/cursos/${c.id}`} className="secondary" aria-label={`Abrir curso: ${c.title}`}>Abrir curso<span className="sr-only">: {c.title}</span></Link></footer></article>)}</div>
    <p className="form-note">Prepara secuencias, materiales, grupos y asistencia dentro de cada curso. Los registros anteriores se conservan.</p>
  </>;
}

function CourseForm({ course, saved }: { course?: Course; saved?: () => Promise<void> }) {
  const { navigate } = useNavigation();
  const [taxonomy, setTaxonomy] = useState<Taxonomy>(emptyTaxonomy), [terms, setTerms] = useState(course?.termIds || []);
  const [profile, setProfile] = useState(course?.profile || "free"), [label, setLabel] = useState(course?.unitLabel || "Temas");
  const [dirty, setDirty] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState("");
  const [destination, setDestination] = useState("");
  useUnsavedChanges(dirty);
  useEffect(() => { api<Taxonomy>("/taxonomy").then(setTaxonomy).catch(e => setError(message(e))); }, []);
  useEffect(() => { if (destination && !dirty) navigate(destination); }, [destination, dirty]);
  async function save(e: FormEvent<HTMLFormElement>) {
    e.preventDefault(); const data = Object.fromEntries(new FormData(e.currentTarget)); setBusy(true); setError("");
    try { const result = await api<{ id: string }>(course ? `/courses/${course.id}` : "/courses", course ? "PUT" : "POST", { ...data, profile, unitLabel: label, status: data.status || "active", termIds: terms, version: course?.version }); setDirty(false); if (saved) await saved(); else setDestination(`/cursos/${result.id}`); }
    catch (e) { setError(message(e)); } finally { setBusy(false); }
  }
  return <><div className="page-heading"><div><h1>{course ? "Configuración del curso" : "Crear curso"}</h1><p>Empieza por el propósito. El perfil propone vocabulario, no reglas de aprobación.</p></div></div>{error && <p role="alert" className="alert error">{error}</p>}<form className="form-card course-form" onSubmit={save} onChange={() => setDirty(true)}><fieldset disabled={busy} className="workspace-fields">
    <Field name="course-title" label="Nombre del curso"><input id="course-title" name="title" required maxLength={160} defaultValue={course?.title}/></Field>
    <Field name="course-objective" label="¿Qué aprenderán?"><textarea id="course-objective" name="objective" maxLength={1000} defaultValue={course?.objective}/></Field>
    <div className="filter-grid"><Field name="course-profile" label="Punto de partida"><select id="course-profile" value={profile} onChange={e => { const p = courseProfiles.find(p => p.value === e.target.value)!; setProfile(p.value); setLabel(p.unitLabel); }}>{courseProfiles.map(p => <option key={p.value} value={p.value}>{p.label}</option>)}</select></Field><Field name="course-unit-label" label="Nombre de las agrupaciones"><select id="course-unit-label" value={label} onChange={e => setLabel(e.target.value as Course["unitLabel"])}>{unitLabels.map(l => <option key={l}>{l}</option>)}</select></Field></div>
    <TermChoices taxonomy={taxonomy} selected={terms} onChange={ids => { setTerms(ids); setDirty(true); }}/>
    {course && <Field name="course-status" label="Estado del curso"><select id="course-status" name="status" defaultValue={course.status}><option value="active">Activo</option><option value="archived">Archivado</option></select></Field>}
    <p className="form-note">Archivar organiza el espacio de autoría. No retira automáticamente las lecciones públicas ni elimina sus datos.</p>
    <div className="button-row"><button className="primary">{busy ? "Guardando…" : course ? "Guardar curso" : "Crear curso"}</button><Link href={course ? `/cursos/${course.id}` : "/cursos"}>Cancelar</Link></div>
  </fieldset></form></>;
}

function CoursePage({ id, area, member }: { id: string; area: string; member: Member }) {
  const [course, setCourse] = useState<Course | null>(null), [units, setUnits] = useState<LearningUnit[]>([]), [lessons, setLessons] = useState<Lesson[]>([]);
  const [error, setError] = useState(""), [notice, setNotice] = useState("");
  const editor = member.role === "educator";
  const load = async () => {
    const [c, l] = await Promise.all([api<{ course: Course; units: LearningUnit[] }>(`/courses/${id}`), api<{ lessons: Lesson[] }>(`/lessons?${editor ? "drafts=1&" : ""}course=${id}`)]);
    setCourse(c.course); setUnits(c.units); setLessons(l.lessons); setError("");
  };
  useEffect(() => { setNotice(""); void load().catch(e => setError(message(e))); }, [id, area]);
  useEffect(() => { if (course) { const heading = document.querySelector<HTMLElement>("main h1"); if (heading) { heading.tabIndex = -1; heading.focus({ preventScroll: true }); document.title = `${course.title} · Happy Learners`; } } }, [id, area, !!course]);
  if (error) return <div className="empty-state"><h1>No se pudo abrir el curso</h1><p role="alert">{error}</p><Link href="/cursos">Volver a cursos</Link></div>;
  if (!course) return <p role="status">Abriendo curso…</p>;
  const base = `/cursos/${course.id}`;
  const writable = editor && course.status === "active";
  return <><nav className="breadcrumbs" aria-label="Ubicación"><Link href="/cursos">Cursos</Link><span aria-hidden="true">/</span><Link href={base}>{course.title}</Link></nav>
    {area !== "configuracion" && <div className="page-heading"><div><span className="eyebrow">{courseProfiles.find(p => p.value === course.profile)?.label}{course.status === "archived" ? " · Archivado" : ""}</span><h1>{course.title}</h1><p>{course.objective || "Define el objetivo en la configuración del curso."}</p></div>{writable && area === "contenido" && <Link className="primary" href={`${base}/lecciones?nueva=1`}>Preparar lección</Link>}</div>}
    <nav className="content-tabs course-tabs" aria-label="Espacios del curso"><Link href={base} aria-current={area === "contenido" ? "page" : undefined}>Preparar</Link><Link href={`${base}/materiales`} aria-current={area === "materiales" ? "page" : undefined}>Materiales</Link>{editor && <><Link href={`${base}/lecciones`} aria-current={area === "lecciones" ? "page" : undefined}>Editar lecciones</Link><Link href={`${base}/grupos`} aria-current={area === "grupos" ? "page" : undefined}>Grupos</Link><Link href={`${base}/asistencia`} aria-current={area === "asistencia" ? "page" : undefined}>Asistencia</Link><Link href={`${base}/configuracion`} aria-current={area === "configuracion" ? "page" : undefined}>Ajustes</Link></>}</nav>
    {course.status === "archived" && <p className="alert">Curso archivado. Los enlaces públicos se conservan. {editor && <Link href={`${base}/configuracion`}>Restaurar desde configuración</Link>}</p>}
    {area === "contenido" && <CourseOutline course={course} units={units} lessons={lessons} writable={writable} load={load}/>}
    {notice && <p className="alert success" role="status">{notice}</p>}
    {area === "configuracion" && editor && <CourseForm key={course.version} course={course} saved={async () => { await load(); setNotice("Curso guardado."); }}/>}
    {area === "materiales" && <CourseMaterials course={course} writable={writable}/>}
    {area === "grupos" && editor && <CourseGroups course={course} writable={writable}/>}
    {area === "asistencia" && editor && <CourseAttendance course={course} writable={writable} lessons={lessons}/>}
    {area === "lecciones" && !writable && <p>La edición requiere un curso activo y acceso de educador.</p>}
    {area === "configuracion" && !editor && <p role="alert">Solo educadores pueden editar la configuración del curso.</p>}
    {area === "lecciones" && writable && <Workspace key={id} member={member} section="lessons" course={course}/>}
    {!['contenido','configuracion','materiales','lecciones','grupos','asistencia'].includes(area) && <p role="alert">Esa sección no existe. Vuelve a Preparar para continuar.</p>}
  </>;
}

type GroupView = { id: string; name: string; status: "active" | "archived"; learnerCount: number; learners: GroupLearner[] };
function CourseGroups({ course, writable }: { course: Course; writable: boolean }) {
  const [groups, setGroups] = useState<GroupView[]>([]), [error, setError] = useState(""), [busy, setBusy] = useState(false), [notice, setNotice] = useState("");
  const load = async () => setGroups((await api<{ groups: GroupView[] }>(`/courses/${course.id}/groups`)).groups);
  useEffect(() => { void load().catch(e => setError(message(e))); }, [course.id]);
  async function submit(event: FormEvent<HTMLFormElement>, url: string, method: "POST" = "POST") {
    event.preventDefault(); const form = event.currentTarget; const data = Object.fromEntries(new FormData(form)); setBusy(true); setError(""); setNotice("");
    try { await api(url, method, data); form.reset(); await load(); setNotice("Guardado. El grupo conserva solo el nombre de lista necesario para asistencia."); }
    catch (e) { setError(message(e)); } finally { setBusy(false); }
  }
  return <section className="classroom-page"><div className="section-heading"><div><span className="eyebrow">Personas · Organización</span><h2>Grupos del curso</h2><p>Usa una lista para preparar clases y registrar asistencia.</p></div></div>
    {error && <p className="alert error" role="alert">{error}</p>}{notice && <p className="alert success" role="status">{notice}</p>}
    {writable && <form className="inline-create" onSubmit={event => void submit(event, `/courses/${course.id}/groups`)}><Field name="group-name" label="Nombre del grupo"><input id="group-name" name="name" required maxLength={100} placeholder="Ej. Grupo de los martes"/></Field><button className="primary" disabled={busy}>Crear grupo</button></form>}
    {!groups.length && <div className="empty-state"><h3>Comienza con un grupo</h3><p>Después agrega los nombres o identificadores de lista mínimos para tomar asistencia.</p></div>}
    <div className="group-list">{groups.map(group => <article className="group-card" key={group.id}><header><div><span className="eyebrow">{group.learnerCount} participantes</span><h3>{group.name}</h3></div><span className="pill">Activo</span></header><ul>{group.learners.map(learner => <li key={learner.id}>{learner.displayName}</li>)}</ul>{writable && group.status === "active" && <form className="add-person" onSubmit={event => void submit(event, `/courses/${course.id}/groups/${group.id}/learners`)}><Field name={`learner-${group.id}`} label="Añadir a la lista"><input id={`learner-${group.id}`} name="displayName" required maxLength={80} placeholder="Nombre o código de lista"/></Field><button disabled={busy}>Añadir</button></form>}</article>)}</div>
    <p className="privacy-note">No agregues fecha de nacimiento, contacto ni notas sensibles. Para una demostración usa identificadores ficticios.</p>
  </section>;
}

type AttendanceRow = { learnerId: string; displayName: string; status: "unmarked" | "present" | "late" | "absent" | "excused" };
function CourseAttendance({ course, writable, lessons }: { course: Course; writable: boolean; lessons: Lesson[] }) {
  const [groups, setGroups] = useState<GroupView[]>([]), [sessions, setSessions] = useState<ClassSession[]>([]), [selected, setSelected] = useState(""), [rows, setRows] = useState<AttendanceRow[]>([]), [error, setError] = useState(""), [notice, setNotice] = useState(""), [busy, setBusy] = useState(false);
  const base = `/courses/${course.id}`;
  async function loadSessions() { setSessions((await api<{ sessions: ClassSession[] }>(`${base}/sessions`)).sessions); }
  useEffect(() => { Promise.all([api<{ groups: GroupView[] }>(`${base}/groups`), loadSessions()]).then(([g]) => setGroups(g.groups)).catch(e => setError(message(e))); }, [course.id]);
  useEffect(() => { if (!selected) { setRows([]); return; } api<{ learners: AttendanceRow[] }>(`${base}/sessions/${selected}/attendance`).then(d => setRows(d.learners)).catch(e => setError(message(e))); }, [selected, course.id]);
  async function createSession(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const data = Object.fromEntries(new FormData(event.currentTarget)); setBusy(true); setError("");
    try { const result = await api<{ id: string }>(`${base}/sessions`, "POST", data); await loadSessions(); setSelected(result.id); setNotice("Clase creada. Registra el estado de cada participante para guardar asistencia."); }
    catch (e) { setError(message(e)); } finally { setBusy(false); }
  }
  async function saveAttendance() {
    setBusy(true); setError(""); setNotice("");
    try { await api(`${base}/sessions/${selected}/attendance`, "PUT", { marks: rows.map(row => ({ learnerId: row.learnerId, status: row.status })) }); setNotice("Asistencia guardada."); }
    catch (e) { setError(message(e)); } finally { setBusy(false); }
  }
  const allMarked = rows.length > 0 && rows.every(row => row.status !== "unmarked");
  return <section className="classroom-page"><div className="section-heading"><div><span className="eyebrow">Impartir · Seguimiento</span><h2>Asistencia</h2><p>Registra quién participó en cada clase. No se recopilan datos de contacto.</p></div></div>
    {error && <p className="alert error" role="alert">{error}</p>}{notice && <p className="alert success" role="status">{notice}</p>}
    {writable && <form className="session-create" onSubmit={createSession}><h3>Preparar una clase</h3><div className="filter-grid"><Field name="session-group" label="Grupo"><select id="session-group" name="groupId" required defaultValue=""><option value="" disabled>Selecciona un grupo</option>{groups.filter(g => g.status === "active").map(group => <option value={group.id} key={group.id}>{group.name}</option>)}</select></Field><Field name="session-date" label="Fecha"><input id="session-date" name="sessionDate" type="date" required defaultValue={new Date().toLocaleDateString("en-CA")}/></Field><Field name="session-lesson" label="Lección (opcional)"><select id="session-lesson" name="lessonId" defaultValue=""><option value="">Sin vincular</option>{lessons.filter(l => l.revision && l.status !== "archived").map(l => <option key={l.id} value={l.id}>{l.title}</option>)}</select></Field></div><button className="primary" disabled={busy || !groups.some(g => g.status === "active")}>Crear clase y pasar lista</button>{!groups.length && <small>Primero crea un grupo en la sección Grupos.</small>}</form>}
    <Field name="attendance-session" label="Clase"><select id="attendance-session" value={selected} onChange={event => setSelected(event.target.value)}><option value="">Selecciona una clase para registrar o revisar</option>{sessions.map(session => <option key={session.id} value={session.id}>{session.sessionDate} · {session.groupName}</option>)}</select></Field>
    {selected && <div className="attendance-sheet"><div className="section-heading"><div><h3>Lista de participantes</h3><p>Marca cada estado; los campos sin revisar no se guardan como ausencias.</p></div></div>{!rows.length && <p>No hay participantes activos en este grupo.</p>}<ul>{rows.map((row, index) => <li key={row.learnerId}><span className="attendance-number">{String(index + 1).padStart(2, "0")}</span><strong>{row.displayName}</strong><select aria-label={`Asistencia de ${row.displayName}`} value={row.status} onChange={event => setRows(current => current.map(item => item.learnerId === row.learnerId ? { ...item, status: event.target.value as AttendanceRow["status"] } : item))}><option value="unmarked">Sin marcar</option><option value="present">Presente</option><option value="late">Llegó tarde</option><option value="absent">Ausente</option><option value="excused">Justificada</option></select></li>)}</ul>{writable && <button className="primary" disabled={busy || !allMarked} onClick={() => void saveAttendance()}>Guardar asistencia</button>}</div>}
    <div className="attendance-history"><h3>Clases recientes</h3>{sessions.length ? <ul>{sessions.slice(0, 8).map(session => <li key={session.id}><button className="text-button" onClick={() => setSelected(session.id)}>{session.sessionDate} · {session.groupName || "Grupo"}</button></li>)}</ul> : <p>Aún no hay clases registradas.</p>}</div>
  </section>;
}

function CourseOutline({ course, units, lessons, writable, load }: { course: Course; units: LearningUnit[]; lessons: Lesson[]; writable: boolean; load: () => Promise<void> }) {
  const [editing, setEditing] = useState<LearningUnit | "new" | null>(null), [dirty, setDirty] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState("");
  useUnsavedChanges(dirty);
  function open(unit: LearningUnit | "new") { if (!dirty || window.confirm("¿Descartar los cambios sin guardar?")) { setDirty(false); setEditing(unit); } }
  async function work(job: () => Promise<void>, form = false) { setBusy(true); setError(""); try { await job(); if (form) { setDirty(false); setEditing(null); } await load(); } catch (e) { setError(message(e)); } finally { setBusy(false); } }
  function reorder(index: number, delta: number) { const ids = units.map(u => u.id); [ids[index], ids[index + delta]] = [ids[index + delta], ids[index]]; void work(async () => { await api(`/courses/${course.id}/units/order`, "PUT", { version: course.version, ids }); }); }
  const old = editing && editing !== "new" ? editing : null;
  return <section><div className="section-heading"><div><h2>{course.unitLabel}</h2><p>Organiza la secuencia de aprendizaje. El orden no crea prerrequisitos.</p></div>{writable && <button onClick={() => open("new")} disabled={busy}>Añadir agrupación</button>}</div>{error && <p role="alert" className="alert error">{error}</p>}
    {editing && <form className="editor-card" key={old?.id || "new"} onChange={() => setDirty(true)} onSubmit={e => { e.preventDefault(); const data = Object.fromEntries(new FormData(e.currentTarget)); void work(async () => { await api(`/courses/${course.id}/units${old ? `/${old.id}` : ""}`, old ? "PUT" : "POST", { ...data, version: course.version }); }, true); }}><fieldset disabled={busy} className="workspace-fields"><h3>{old ? "Editar agrupación" : "Nueva agrupación"}</h3><Field name="unit-name" label="Nombre de la agrupación"><input id="unit-name" name="name" required maxLength={100} defaultValue={old?.name}/></Field><Field name="unit-objective" label="Objetivo de la agrupación"><textarea id="unit-objective" name="objective" maxLength={1000} defaultValue={old?.objective}/></Field><Field name="unit-status" label="Estado de la agrupación"><select id="unit-status" name="status" defaultValue={old?.status || "active"}><option value="active">Activa</option><option value="archived">Archivada</option></select></Field><div className="button-row"><button className="primary">Guardar agrupación</button><button type="button" onClick={() => { if (!dirty || window.confirm("¿Descartar los cambios sin guardar?")) { setDirty(false); setEditing(null); } }}>Cancelar</button></div></fieldset></form>}
    {!units.length && <div className="empty-state"><h3>Construye el recorrido del curso</h3><p>Añade un tema, una experiencia o una práctica. Después prepara sus lecciones y materiales.</p></div>}
    <div className="course-outline">{units.map((unit, index) => <section className="course-unit" key={unit.id}><header><div><span className="eyebrow">{course.unitLabel} · {index + 1}{unit.status === "archived" ? " · Archivada" : ""}</span><h3>{unit.name}</h3><p>{unit.objective}</p></div>{writable && <div className="button-row"><button onClick={() => open(unit)} disabled={busy}>Editar<span className="sr-only"> {unit.name}</span></button><button aria-label={`Subir ${unit.name}`} disabled={busy || index === 0} onClick={() => reorder(index, -1)}>↑</button><button aria-label={`Bajar ${unit.name}`} disabled={busy || index === units.length - 1} onClick={() => reorder(index, 1)}>↓</button></div>}</header>
      <ol className="course-items">{lessons.filter(l => l.courseUnitId === unit.id).map(lesson => <li key={lesson.id}><div><Link href={writable ? `/cursos/${course.id}/lecciones?editar=${lesson.id}` : `/?code=${encodeURIComponent(lesson.shareCode || "")}`} target={writable ? undefined : "_blank"}>{lesson.title}</Link><small>{lesson.duration} minutos · {lesson.activities.length} actividades</small></div><span className="pill">{lesson.status === "archived" ? "Archivada" : lesson.revision ? `Publicada${lesson.hasDraft ? " · cambios en borrador" : ""}` : "Borrador"}</span></li>)}</ol>
      {writable && unit.status === "active" && <footer><Link href={`/cursos/${course.id}/lecciones?nueva=1&unidad=${unit.id}`}>+ Preparar lección aquí</Link></footer>}
    </section>)}</div>
  </section>;
}

function CourseMaterials({ course, writable }: { course: Course; writable: boolean }) {
  const [rows, setRows] = useState<Material[]>([]), [taxonomy, setTaxonomy] = useState<Taxonomy>(emptyTaxonomy), [query, setQuery] = useState("");
  const [editing, setEditing] = useState<Material | "new" | null>(null), [terms, setTerms] = useState<string[]>([]);
  const [dirty, setDirty] = useState(false), [busy, setBusy] = useState(false), [uploading, setUploading] = useState(false), [error, setError] = useState(""), [notice, setNotice] = useState(""), [preview, setPreview] = useState<string | null>(null);
  useUnsavedChanges(dirty);
  const load = async () => { const [m, t] = await Promise.all([api<{ materials: Material[] }>(`/courses/${course.id}/materials`), api<Taxonomy>("/taxonomy")]); setRows(m.materials); setTaxonomy(t); };
  useEffect(() => { void load().catch(e => setError(message(e))); }, [course.id]);
  function open(item: Material | "new") { if (dirty && !window.confirm("¿Descartar los cambios sin guardar?")) return; setEditing(item); setTerms(item === "new" ? [] : item.termIds); setDirty(false); }
  const old = editing && editing !== "new" ? editing : null;
  async function save(e: FormEvent<HTMLFormElement>) {
    e.preventDefault(); const data = Object.fromEntries(new FormData(e.currentTarget)); setBusy(true); setError("");
    try { await api(`/courses/${course.id}/materials${old ? `/${old.id}` : ""}`, old ? "PUT" : "POST", { ...data, version: old?.version, termIds: terms }); setDirty(false); setEditing(null); await load(); setNotice("Material guardado. Las publicaciones anteriores conservan su versión."); } catch (e) { setError(message(e)); } finally { setBusy(false); }
  }
  async function upload(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget, input = form.elements.namedItem("course-office-file");
    const file = input instanceof HTMLInputElement ? input.files?.[0] : undefined;
    if (!file) return;
    if (file.size < 1 || file.size > 15 * 1024 * 1024) { setError("Elige un documento de hasta 15 MB."); return; }
    const extension = file.name.split(".").pop()?.toLowerCase();
    const mediaTypes: Record<string, string> = { docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation", xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" };
    if (!extension || !mediaTypes[extension]) { setError("Formatos disponibles: DOCX, PPTX y XLSX."); return; }
    setUploading(true); setError(""); setNotice("");
    try {
      const response = await fetch(`/api/courses/${course.id}/files`, { method: "POST", credentials: "same-origin", cache: "no-store", signal: AbortSignal.timeout(45_000), headers: { "Content-Type": mediaTypes[extension], "X-File-Name": encodeURIComponent(file.name), "Idempotency-Key": crypto.randomUUID() }, body: file });
      const result = await response.json() as { error?: string };
      if (!response.ok) throw new Error(result.error || "No se pudo guardar el archivo.");
      await load(); form.reset(); setNotice("Documento agregado al espacio privado del curso.");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "No se pudo subir el documento."); }
    finally { setUploading(false); }
  }
  async function archiveFile(item: Material) {
    if (!item.fileId || !window.confirm(`¿Archivar “${item.fileName}”? Las lecciones ya publicadas conservarán su acceso.`)) return;
    setBusy(true); setError("");
    try { const response = await fetch(`/api/courses/${course.id}/files/${item.fileId}/archive`, { method: "POST", credentials: "same-origin", cache: "no-store", signal: AbortSignal.timeout(15_000) }); const result = await response.json() as { error?: string }; if (!response.ok) throw new Error(result.error || "No se pudo archivar el archivo."); await load(); setNotice("Documento archivado. Las publicaciones anteriores permanecen disponibles."); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "No se pudo archivar el documento."); }
    finally { setBusy(false); }
  }
  const filtered = rows.filter(r => `${r.title} ${r.description}`.toLocaleLowerCase("es").includes(query.toLocaleLowerCase("es")));
  return <section><div className="section-heading"><div><h2>Materiales del curso</h2><p>Textos, enlaces y documentos de apoyo que puedes reutilizar en distintas lecciones.</p></div>{writable && <button className="primary" disabled={busy || uploading} onClick={() => open("new")}>Crear material</button>}</div>{error && <p role="alert" className="alert error">{error}</p>}{notice && <p role="status" className="alert success">{notice}</p>}
    {writable && <form className="file-upload-card" onSubmit={upload}><div><h3>Agregar un documento de clase</h3><p>Guarda presentaciones, documentos y hojas de trabajo para volver a usarlos en el curso. Límite: 15 MB por archivo.</p></div><label htmlFor="course-office-file">Archivo DOCX, PPTX o XLSX</label><input id="course-office-file" name="course-office-file" type="file" accept=".docx,.pptx,.xlsx,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.openxmlformats-officedocument.presentationml.presentation,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" required/><button className="primary" disabled={uploading}>{uploading ? "Subiendo documento…" : "Subir al curso"}</button><small>El archivo es privado. Solo se entrega a estudiantes si forma parte de una lección publicada.</small></form>}
    {editing && <form className="editor-card" key={old?.id || "new"} onSubmit={save} onChange={() => setDirty(true)}><fieldset disabled={busy} className="workspace-fields"><h3>{old ? "Editar material" : "Nuevo material"}</h3><Field name="material-title" label="Título del material"><input id="material-title" name="title" required maxLength={160} defaultValue={old?.title}/></Field><Field name="material-description" label="Descripción breve"><textarea id="material-description" name="description" required maxLength={1000} defaultValue={old?.description}/></Field><Field name="material-kind" label="Tipo de material"><select id="material-kind" name="kind" defaultValue={old?.kind || "text"}><option value="text">Texto</option><option value="link">Enlace</option></select></Field><Field name="material-content" label="Texto o dirección del material"><textarea id="material-content" name="content" required maxLength={8000} defaultValue={old?.content}/></Field><TermChoices taxonomy={taxonomy} selected={terms} onChange={ids => { setTerms(ids); setDirty(true); }}/><Field name="material-status" label="Estado del material"><select id="material-status" name="status" defaultValue={old?.status || "draft"}><option value="draft">Borrador</option><option value="published">Disponible en el curso</option><option value="archived">Archivado</option></select></Field><p>Disponible no significa público. El estudiante lo recibe cuando se publica una lección que lo utiliza.</p><div className="button-row"><button className="primary">Guardar material</button><button type="button" onClick={() => { if (!dirty || window.confirm("¿Descartar los cambios sin guardar?")) { setDirty(false); setEditing(null); } }}>Cancelar</button></div></fieldset></form>}
    <Field name="material-search" label="Buscar materiales"><input id="material-search" type="search" value={query} onChange={e => setQuery(e.target.value)}/></Field>
    {!filtered.length && <p className="empty-state">No hay materiales con esos criterios. Puedes crear una lección de texto sin materiales adicionales.</p>}
    <div className="material-list">{filtered.map(item => <article className="editor-card" key={item.id}><div className="section-heading"><h3>{item.title}</h3><span className="pill">{item.status === "archived" ? "Archivado" : item.status === "draft" ? "Borrador" : "Disponible"}</span></div><p>{item.description}</p><TermBadges ids={item.termIds} taxonomy={taxonomy}/>{item.kind === "file" && item.fileId ? <div className="button-row"><button type="button" aria-expanded={preview === item.id} onClick={() => setPreview(preview === item.id ? null : item.id)}>{preview === item.id ? "Cerrar vista previa" : `Vista previa ${item.fileName}`}</button><a href={`/api/courses/${course.id}/files/${item.fileId}/content`} download={item.fileName}>Descargar original</a>{writable && item.status !== "archived" && <button type="button" disabled={busy} onClick={() => void archiveFile(item)}>Archivar</button>}</div> : <details><summary>Ver {item.kind === "link" ? "enlace" : "texto"}</summary>{item.kind === "link" ? <a href={item.content} target="_blank" rel="noopener noreferrer">Abrir material en otra pestaña</a> : <p className="preserve-lines">{item.content}</p>}</details>}{preview === item.id && item.fileId && <OfficePreview key={item.id} url={`/api/courses/${course.id}/files/${item.fileId}/content`} name={item.fileName || item.title} mediaType={item.mediaType}/>}<Updated value={item.updatedAt}/>{writable && item.kind !== "file" && <button disabled={busy} onClick={() => open(item)}>Editar material<span className="sr-only"> {item.title}</span></button>}</article>)}</div>
  </section>;
}

export function Taxonomies() {
  const [taxonomy, setTaxonomy] = useState<Taxonomy>(emptyTaxonomy), [editing, setEditing] = useState<{ kind: "vocabulary" | "term"; item?: Vocabulary | TaxonomyTerm; parent?: string } | null>(null);
  const [dirty, setDirty] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState(""), [notice, setNotice] = useState("");
  useUnsavedChanges(dirty);
  useEffect(() => { api<Taxonomy>("/taxonomy").then(setTaxonomy).catch(e => setError(message(e))); }, []);
  function open(value: NonNullable<typeof editing>) { if (dirty && !window.confirm("¿Descartar los cambios sin guardar?")) return; setEditing(value); setDirty(false); }
  async function save(e: FormEvent<HTMLFormElement>) {
    e.preventDefault(); if (!editing) return; const data = Object.fromEntries(new FormData(e.currentTarget)); setBusy(true); setError("");
    try { const result = await api<Taxonomy>(`/${editing.kind === "term" ? "terms" : "vocabularies"}${editing.item ? `/${editing.item.id}` : ""}`, editing.item ? "PUT" : "POST", { ...data, vocabularyId: editing.parent, version: editing.item?.version }); setTaxonomy(result); setDirty(false); setEditing(null); setNotice("Clasificación guardada. Los contenidos existentes conservan sus referencias."); } catch (e) { setError(message(e)); } finally { setBusy(false); }
  }
  return <><div className="page-heading"><div><span className="eyebrow">Administración</span><h1>Clasificaciones</h1><p>Configura vocabularios para todas las disciplinas. Son opcionales y no establecen requisitos académicos.</p></div><button className="primary" disabled={busy} onClick={() => open({ kind: "vocabulary" })}>Crear vocabulario</button></div>{error && <p role="alert" className="alert error">{error}</p>}{notice && <p role="status" className="alert success">{notice}</p>}
    {editing && <form className="editor-card" key={editing.item?.id || editing.parent || "new"} onSubmit={save} onChange={() => setDirty(true)}><fieldset disabled={busy} className="workspace-fields"><h2>{editing.item ? "Editar" : "Crear"} {editing.kind === "term" ? "término" : "vocabulario"}</h2><Field name="taxonomy-name" label="Nombre"><input id="taxonomy-name" name="name" required maxLength={80} defaultValue={editing.item?.name}/></Field><Field name="taxonomy-status" label="Estado"><select id="taxonomy-status" name="status" defaultValue={editing.item?.status || "active"}><option value="active">Activo</option><option value="archived">Archivado</option></select></Field><div className="button-row"><button className="primary">Guardar clasificación</button><button type="button" onClick={() => { if (!dirty || window.confirm("¿Descartar los cambios sin guardar?")) { setDirty(false); setEditing(null); } }}>Cancelar</button></div></fieldset></form>}
    {taxonomy.vocabularies.map(v => <section className="editor-card" key={v.id}><div className="section-heading"><h2>{v.name}{v.status === "archived" ? " · Archivado" : ""}</h2><div className="button-row"><button disabled={busy} onClick={() => open({ kind: "vocabulary", item: v })}>Editar {v.name}</button><button disabled={busy || v.status !== "active"} onClick={() => open({ kind: "term", parent: v.id })}>Añadir término a {v.name}</button></div></div><ul className="taxonomy-list">{taxonomy.terms.filter(t => t.vocabularyId === v.id).map(t => <li key={t.id}><span>{t.name}{t.status === "archived" ? " · Archivado" : ""}</span><button disabled={busy || v.status !== "active"} onClick={() => open({ kind: "term", item: t, parent: v.id })}>Editar<span className="sr-only"> {t.name}</span></button></li>)}</ul></section>)}
  </>;
}
