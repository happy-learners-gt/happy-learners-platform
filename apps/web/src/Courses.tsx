import { useEffect, useState } from "react";
import type { FormEvent, ReactNode } from "react";
import type { Course, LearningUnit, Lesson, Material, Member, Taxonomy, TaxonomyTerm, Vocabulary } from "@happy-learners/contracts";
import { courseProfiles, unitLabels } from "@happy-learners/domain";
import { api } from "./api";
import { Link, useNavigation, useUnsavedChanges } from "./navigation";
import { Workspace } from "./Workspace";

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
    {!loading && !error && !visible.length && <div className="empty-state"><h2>{courses.length ? "No hay cursos con esos filtros" : "Prepara tu primer curso"}</h2><p>Puede ser un taller breve, una asignatura o un recorrido guiado. No requiere nivel de inglés ni programa académico.</p></div>}
    <div className="course-grid">{visible.map(c => <article className="course-card" key={c.id}><span className="eyebrow">{courseProfiles.find(p => p.value === c.profile)?.label}</span><h2><Link href={`/cursos/${c.id}`}>{c.title}</Link></h2><p>{c.objective || "Define el objetivo y organiza el contenido del curso."}</p><TermBadges ids={c.termIds} taxonomy={taxonomy}/><footer><Updated value={c.updatedAt}/><Link href={`/cursos/${c.id}`} className="secondary" aria-label={`Abrir curso: ${c.title}`}>Abrir curso<span className="sr-only">: {c.title}</span></Link></footer></article>)}</div>
    <p className="form-note">Los materiales anteriores y sus enlaces se conservan. <Link href="/biblioteca">Consultar recursos heredados</Link>.</p>
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
    <nav className="content-tabs" aria-label="Navegación del curso"><Link href={base} aria-current={area === "contenido" ? "page" : undefined}>Contenido</Link><Link href={`${base}/materiales`} aria-current={area === "materiales" ? "page" : undefined}>Materiales</Link>{editor && <><Link href={`${base}/lecciones`} aria-current={area === "lecciones" ? "page" : undefined}>Lecciones</Link><Link href={`${base}/configuracion`} aria-current={area === "configuracion" ? "page" : undefined}>Configuración</Link></>}</nav>
    {course.status === "archived" && <p className="alert">Curso archivado. Los enlaces públicos se conservan. {editor && <Link href={`${base}/configuracion`}>Restaurar desde configuración</Link>}</p>}
    {area === "contenido" && <CourseOutline course={course} units={units} lessons={lessons} writable={writable} load={load}/>}
    {notice && <p className="alert success" role="status">{notice}</p>}
    {area === "configuracion" && editor && <CourseForm key={course.version} course={course} saved={async () => { await load(); setNotice("Curso guardado."); }}/>}
    {area === "materiales" && <CourseMaterials course={course} writable={writable}/>}
    {area === "lecciones" && !writable && <p>La edición requiere un curso activo y acceso de educador.</p>}
    {area === "configuracion" && !editor && <p role="alert">Solo educadores pueden editar la configuración del curso.</p>}
    {area === "lecciones" && writable && <Workspace key={id} member={member} section="lessons" course={course}/>}
    {!['contenido','configuracion','materiales','lecciones'].includes(area) && <p role="alert">Esa sección no existe. Abre Contenido para continuar.</p>}
  </>;
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
      <ol className="course-items">{lessons.filter(l => l.courseUnitId === unit.id).map(lesson => <li key={lesson.id}><div><Link href={writable ? `/cursos/${course.id}/lecciones?editar=${lesson.id}` : `/contenido/publicadas/${lesson.id}`}>{lesson.title}</Link><small>{lesson.duration} minutos · {lesson.activities.length} actividades</small></div><span className="pill">{lesson.status === "archived" ? "Archivada" : lesson.revision ? `Publicada${lesson.hasDraft ? " · cambios en borrador" : ""}` : "Borrador"}</span></li>)}</ol>
      {writable && unit.status === "active" && <footer><Link href={`/cursos/${course.id}/lecciones?nueva=1&unidad=${unit.id}`}>+ Preparar lección aquí</Link></footer>}
    </section>)}</div>
  </section>;
}

function CourseMaterials({ course, writable }: { course: Course; writable: boolean }) {
  const [rows, setRows] = useState<Material[]>([]), [taxonomy, setTaxonomy] = useState<Taxonomy>(emptyTaxonomy), [query, setQuery] = useState("");
  const [editing, setEditing] = useState<Material | "new" | null>(null), [terms, setTerms] = useState<string[]>([]);
  const [dirty, setDirty] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState(""), [notice, setNotice] = useState("");
  useUnsavedChanges(dirty);
  const load = async () => { const [m, t] = await Promise.all([api<{ materials: Material[] }>(`/courses/${course.id}/materials`), api<Taxonomy>("/taxonomy")]); setRows(m.materials); setTaxonomy(t); };
  useEffect(() => { void load().catch(e => setError(message(e))); }, [course.id]);
  function open(item: Material | "new") { if (dirty && !window.confirm("¿Descartar los cambios sin guardar?")) return; setEditing(item); setTerms(item === "new" ? [] : item.termIds); setDirty(false); }
  const old = editing && editing !== "new" ? editing : null;
  async function save(e: FormEvent<HTMLFormElement>) {
    e.preventDefault(); const data = Object.fromEntries(new FormData(e.currentTarget)); setBusy(true); setError("");
    try { await api(`/courses/${course.id}/materials${old ? `/${old.id}` : ""}`, old ? "PUT" : "POST", { ...data, version: old?.version, termIds: terms }); setDirty(false); setEditing(null); await load(); setNotice("Material guardado. Las publicaciones anteriores conservan su versión."); } catch (e) { setError(message(e)); } finally { setBusy(false); }
  }
  const filtered = rows.filter(r => `${r.title} ${r.description}`.toLocaleLowerCase("es").includes(query.toLocaleLowerCase("es")));
  return <section><div className="section-heading"><div><h2>Materiales del curso</h2><p>Textos y enlaces para utilizar dentro de sus lecciones.</p></div>{writable && <button className="primary" disabled={busy} onClick={() => open("new")}>Crear material</button>}</div>{error && <p role="alert" className="alert error">{error}</p>}{notice && <p role="status" className="alert success">{notice}</p>}
    {editing && <form className="editor-card" key={old?.id || "new"} onSubmit={save} onChange={() => setDirty(true)}><fieldset disabled={busy} className="workspace-fields"><h3>{old ? "Editar material" : "Nuevo material"}</h3><Field name="material-title" label="Título del material"><input id="material-title" name="title" required maxLength={160} defaultValue={old?.title}/></Field><Field name="material-description" label="Descripción breve"><textarea id="material-description" name="description" required maxLength={1000} defaultValue={old?.description}/></Field><Field name="material-kind" label="Tipo de material"><select id="material-kind" name="kind" defaultValue={old?.kind || "text"}><option value="text">Texto</option><option value="link">Enlace</option></select></Field><Field name="material-content" label="Texto o dirección del material"><textarea id="material-content" name="content" required maxLength={8000} defaultValue={old?.content}/></Field><TermChoices taxonomy={taxonomy} selected={terms} onChange={ids => { setTerms(ids); setDirty(true); }}/><Field name="material-status" label="Estado del material"><select id="material-status" name="status" defaultValue={old?.status || "draft"}><option value="draft">Borrador</option><option value="published">Disponible en el curso</option><option value="archived">Archivado</option></select></Field><p>Disponible no significa público. El estudiante lo recibe cuando se publica una lección que lo utiliza.</p><div className="button-row"><button className="primary">Guardar material</button><button type="button" onClick={() => { if (!dirty || window.confirm("¿Descartar los cambios sin guardar?")) { setDirty(false); setEditing(null); } }}>Cancelar</button></div></fieldset></form>}
    <Field name="material-search" label="Buscar materiales"><input id="material-search" type="search" value={query} onChange={e => setQuery(e.target.value)}/></Field>
    {!filtered.length && <p className="empty-state">No hay materiales con esos criterios. Puedes crear una lección de texto sin materiales adicionales.</p>}
    <div className="material-list">{filtered.map(item => <article className="editor-card" key={item.id}><div className="section-heading"><h3>{item.title}</h3><span className="pill">{item.status === "archived" ? "Archivado" : item.status === "draft" ? "Borrador" : "Disponible"}</span></div><p>{item.description}</p><TermBadges ids={item.termIds} taxonomy={taxonomy}/><details><summary>Ver {item.kind === "link" ? "enlace" : "texto"}</summary>{item.kind === "link" ? <a href={item.content} target="_blank" rel="noopener noreferrer">Abrir material en otra pestaña</a> : <p className="preserve-lines">{item.content}</p>}</details><Updated value={item.updatedAt}/>{writable && <button disabled={busy} onClick={() => open(item)}>Editar material<span className="sr-only"> {item.title}</span></button>}</article>)}</div>
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
