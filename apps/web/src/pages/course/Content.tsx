import { useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";
import type { LearningUnit, Lesson } from "@happy-learners/contracts";
import { api, message } from "../../api";
import { useNavigation } from "../../navigation";
import { courseStats, draftOf, lessonBody, plural } from "../../model";
import { Modal, useFeedback } from "../../ui/feedback";
import { Icon } from "../../ui/icons";
import { LessonOutline } from "../../ui/LessonOutline";
import type { OutlineActions } from "../../ui/LessonOutline";
import { Button, EmptyState, Field, PageHeader, PrimaryAction } from "../../ui/primitives";
import { useCourse } from "./context";

/** Renames and archives change only lesson metadata, so activities are omitted and kept by the API. */
function metadataBody(courseId: string, lesson: Lesson, patch: { title?: string; archived?: boolean }) {
  const { activities: _, ...body } = lessonBody(courseId, { ...draftOf(lesson), ...patch }, lesson.draftVersion);
  return body;
}

export function Content() {
  const { course, units, lessons, writable, reload, settings, noun } = useCourse();
  const { url, navigate } = useNavigation();
  const { toast, confirm } = useFeedback();
  const [expanded, setExpanded] = useState(() => new Set(units.map(unit => unit.id)));
  const [showArchived, setShowArchived] = useState(false);
  const [creating, setCreating] = useState(url.searchParams.get("crear") === "unidad" || (writable && !units.length));
  const [editing, setEditing] = useState<LearningUnit | null>(null), [busy, setBusy] = useState(false);
  const [focusUnit, setFocusUnit] = useState<string>();
  const base = `/cursos/${course.id}`;
  const stats = courseStats(units, lessons);
  const archivedCount = units.filter(unit => unit.status === "archived").length + lessons.filter(lesson => lesson.status === "archived").length;
  // Units created after the page opened start expanded; units the educator collapsed stay collapsed.
  const seen = useRef(new Set(units.map(unit => unit.id)));
  useEffect(() => {
    const fresh = units.filter(unit => !seen.current.has(unit.id)).map(unit => unit.id);
    fresh.forEach(id => seen.current.add(id));
    if (fresh.length) setExpanded(current => new Set([...current, ...fresh]));
  }, [units]);
  useEffect(() => {
    const target = url.hash.slice(1) || (url.searchParams.get("unidad") ? `unidad-${url.searchParams.get("unidad")}` : "");
    if (target) document.getElementById(target)?.scrollIntoView({ block: "start" });
  }, []);

  async function run(work: () => Promise<unknown>, done: string, recovery = "Recarga la página e inténtalo de nuevo.") {
    setBusy(true);
    try { await work(); await reload(); if (done) toast({ message: done }); return true; }
    catch (error) { toast({ tone: "error", message: `${message(error)} ${recovery}` }); await reload().catch(() => undefined); return false; }
    finally { setBusy(false); }
  }
  const unitBody = (unit: LearningUnit, patch: Partial<LearningUnit>) => ({ name: unit.name, objective: unit.objective, status: unit.status, ...patch, version: course.version });
  const actions: OutlineActions = {
    renameUnit: (unit, name) => run(() => api(`/courses/${course.id}/units/${unit.id}`, "PUT", unitBody(unit, { name })), `${noun.One} ${noun.renamed}.`),
    editUnit: unit => setEditing(unit),
    moveUnit: (unit, delta) => {
      const ids = units.map(item => item.id), index = ids.indexOf(unit.id);
      [ids[index], ids[index + delta]] = [ids[index + delta], ids[index]];
      void run(() => api(`/courses/${course.id}/units/order`, "PUT", { version: course.version, ids }), `«${unit.name}» ahora es ${noun.the} ${index + delta + 1} de ${ids.length}.`);
    },
    archiveUnit: async unit => {
      const archiving = unit.status === "active";
      if (archiving && !await confirm({ title: `¿Archivar ${noun.the} «${unit.name}»?`, body: <p>{noun.The} y sus lecciones dejan de mostrarse en el contenido. Las lecciones ya publicadas siguen disponibles para estudiantes. Puedes restaurar{noun.it} desde “Mostrar archivados”.</p>, confirm: `Archivar ${noun.one}`, danger: true })) return;
      void run(() => api(`/courses/${course.id}/units/${unit.id}`, "PUT", unitBody(unit, { status: archiving ? "archived" : "active" })), archiving ? `«${unit.name}» se archivó.` : `«${unit.name}» se restauró.`);
    },
    createLesson: async (unit, title, objective) => {
      try {
        const { lesson } = await api<{ lesson: Lesson }>("/lessons", "POST", { title, objective, courseId: course.id, courseUnitId: unit.id, duration: 20, instructions: "", sequence: settings.defaultSequence });
        await reload();
        toast({ message: "Lección creada como borrador. Agrega sus actividades." });
        navigate(`${base}/lecciones/${lesson.id}`);
        return true;
      } catch (error) { toast({ tone: "error", message: `${message(error)} Revisa el título y el objetivo.` }); return false; }
    },
    renameLesson: (lesson, title) => run(() => api(`/lessons/${lesson.id}`, "PUT", metadataBody(course.id, lesson, { title })), "Lección renombrada. Publica los cambios para que los vean los estudiantes."),
    moveLesson: (lesson, delta) => {
      const ids = lessons.filter(item => item.courseUnitId === lesson.courseUnitId).map(item => item.id), index = ids.indexOf(lesson.id);
      [ids[index], ids[index + delta]] = [ids[index + delta], ids[index]];
      void run(() => api("/lessons/order", "PUT", { courseUnitId: lesson.courseUnitId, ids }), `«${lesson.title}» ahora es la lección ${index + delta + 1} de ${ids.length}.`);
    },
    archiveLesson: async lesson => {
      const archiving = lesson.status !== "archived";
      if (archiving && !await confirm({ title: `¿Archivar «${lesson.title}»?`, body: <p>La lección deja de estar disponible para estudiantes y sale del contenido. Su historial se conserva y puedes restaurarla.</p>, confirm: "Archivar lección", danger: true })) return;
      void run(() => api(`/lessons/${lesson.id}`, "PUT", metadataBody(course.id, lesson, { archived: archiving })), archiving ? `«${lesson.title}» se archivó.` : `«${lesson.title}» se restauró como borrador.`);
    },
    duplicateLesson: async lesson => {
      try {
        const { lesson: copy } = await api<{ lesson: Lesson }>(`/lessons/${lesson.id}/duplicate`, "POST");
        await reload();
        toast({ message: `Copia creada como borrador: «${copy.title}». El original no cambia.`, action: { label: "Abrir", onSelect: () => navigate(`${base}/lecciones/${copy.id}`) } });
      } catch (error) { toast({ tone: "error", message: message(error) }); }
    },
    previewLesson: lesson => { if (lesson.revision && lesson.shareCode && lesson.status !== "archived") window.open(`/aprender/${lesson.shareCode}`, "_blank", "noopener"); else navigate(`${base}/lecciones/${lesson.id}?vista=previa`); },
    openLesson: lesson => navigate(`${base}/lecciones/${lesson.id}`),
  };
  async function createUnit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget, data = new FormData(form);
    const name = String(data.get("name")).trim();
    let created = "";
    const ok = await run(async () => { created = (await api<{ id: string }>(`/courses/${course.id}/units`, "POST", { name, objective: String(data.get("objective") || "").trim(), status: "active", version: course.version })).id; }, `${noun.One} «${name}» ${noun.created}. Agrega su primera lección.`);
    if (ok) { form.reset(); setCreating(false); setFocusUnit(created); setTimeout(() => document.getElementById(`unidad-${created}`)?.querySelector<HTMLElement>(".add-lesson")?.focus(), 50); }
  }
  return <>
    <PageHeader crumbs={[{ label: "Cursos", href: "/cursos" }, { label: course.title, href: base }, { label: "Contenido" }]} title="Contenido"
      description={`${plural(stats.units, noun.one, noun.many)} · ${plural(stats.lessons, "lección", "lecciones")} · ${stats.published} publicadas`}
      actions={units.length > 0 && <Button variant="ghost" onClick={() => setExpanded(expanded.size ? new Set() : new Set(units.map(unit => unit.id)))}>{expanded.size ? "Contraer todo" : "Expandir todo"}</Button>}
      primary={writable && units.length > 0 && <PrimaryAction icon="plus" onClick={() => { setCreating(true); setTimeout(() => document.getElementById("new-unit-name")?.focus(), 0); }}>{`Crear ${noun.one}`}</PrimaryAction>}/>
    {!writable && <p className="notice"><Icon name="info" size={18}/>{course.status === "archived" ? "El curso está archivado. Restáuralo desde Configuración para editar su contenido." : "Consulta el contenido publicado. Solo educadores pueden editarlo."}</p>}
    {(archivedCount > 0 || showArchived) && <label className="switch"><input type="checkbox" checked={showArchived} onChange={event => setShowArchived(event.target.checked)}/><span>Mostrar archivados ({archivedCount})</span></label>}
    {units.length ? <LessonOutline courseId={course.id} units={units} lessons={lessons} writable={writable && !busy} noun={noun} showArchived={showArchived} actions={actions} expanded={expanded} setExpanded={setExpanded} focusUnit={focusUnit}/>
      : !creating && <EmptyState icon="content" title={`Este curso aún no tiene ${noun.many}`} action={writable && <PrimaryAction icon="plus" onClick={() => setCreating(true)}>{`Crear ${noun.one}`}</PrimaryAction>}>{`${noun.A} agrupa lecciones sobre un mismo tema. Por ejemplo: “Greetings” o “Colores”.`}</EmptyState>}
    {writable && creating && <form className="inline-form unit-form" onSubmit={createUnit} aria-label={noun.New} onKeyDown={event => { if (event.key === "Escape" && units.length) setCreating(false); }}>
      <h2>{noun.New}</h2>
      <fieldset disabled={busy}>
        <div className="field"><label htmlFor="new-unit-name">{`Nombre ${noun.ofThe}`}</label><input id="new-unit-name" name="name" required maxLength={100} autoFocus={!units.length} placeholder="Ej. Greetings"/></div>
        <div className="field"><label htmlFor="new-unit-objective">Objetivo <span className="optional">(opcional)</span></label><input id="new-unit-objective" name="objective" maxLength={1000} placeholder={`¿Qué lograrán en ${noun.this}?`}/></div>
        <div className="inline-form-actions"><button className="button primary">{`Crear ${noun.one}`}</button>{units.length > 0 && <button type="button" className="button ghost" onClick={() => setCreating(false)}>Cancelar</button>}</div>
      </fieldset>
    </form>}
    {editing && <Modal title={`Editar ${noun.one}`} onClose={() => setEditing(null)}>
      <form className="stack" onSubmit={async event => {
        event.preventDefault(); const data = new FormData(event.currentTarget);
        if (await run(() => api(`/courses/${course.id}/units/${editing.id}`, "PUT", unitBody(editing, { name: String(data.get("name")).trim(), objective: String(data.get("objective")).trim() })), `${noun.One} ${noun.saved}.`)) setEditing(null);
      }}>
        <Field label={`Nombre ${noun.ofThe}`}><input name="name" required maxLength={100} defaultValue={editing.name}/></Field>
        <Field label="Objetivo" optional><textarea name="objective" maxLength={1000} rows={3} defaultValue={editing.objective}/></Field>
        <div className="modal-actions"><button type="button" className="button ghost" onClick={() => setEditing(null)}>Cancelar</button><button className="button primary" disabled={busy}>{`Guardar ${noun.one}`}</button></div>
      </form>
    </Modal>}
  </>;
}
