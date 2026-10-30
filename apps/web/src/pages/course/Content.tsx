import { useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";
import type { LearningUnit, Lesson } from "@happy-learners/contracts";
import { api, message } from "../../api";
import { Link, useNavigation } from "../../navigation";
import { courseStats, draftOf, lessonBody, plural } from "../../model";
import { Modal, useFeedback } from "../../ui/feedback";
import { Icon } from "../../ui/icons";
import { LessonOutline } from "../../ui/LessonOutline";
import { DeliveryDialog } from "./Delivery";
import type { OutlineActions } from "../../ui/LessonOutline";
import { Button, EmptyState, Field, PageHeader, PrimaryAction } from "../../ui/primitives";
import { moveItem } from "../../ui/Sortable";
import { useCourse } from "./context";

/** Renames and archives change only lesson metadata, so activities are omitted and kept by the API. */
export function metadataBody(courseId: string, lesson: Lesson, patch: { title?: string; archived?: boolean }) {
  const { activities: _, ...body } = lessonBody(courseId, { ...draftOf(lesson), ...patch }, lesson.draftVersion);
  return body;
}

export function Content() {
  const { course, units, lessons, writable, publisher, reload, settings, noun } = useCourse();
  const { url, navigate } = useNavigation();
  const { toast, confirm } = useFeedback();
  const [expanded, setExpanded] = useState(() => new Set(units.map(unit => unit.id)));
  const [showArchived, setShowArchived] = useState(false);
  const [creating, setCreating] = useState(url.searchParams.get("crear") === "unidad" || (publisher && !units.length));
  const [editing, setEditing] = useState<LearningUnit | null>(null), [busy, setBusy] = useState(false);
  const [focusUnit, setFocusUnit] = useState<string>();
  const [delivering, setDelivering] = useState(false);
  const base = `/cursos/${course.id}`;
  const stats = courseStats(units, lessons);
  const adapt = settings.sectionFreedom !== "shared";
  const coreCount = lessons.filter(lesson => lesson.status !== "archived" && lesson.isCore !== false).length;
  async function markCore(body: { lessons?: { id: string; core: boolean }[]; units?: { id: string; core: boolean }[] }, done: string) {
    try {
      const result = await api<{ message: string }>(`/courses/${course.id}/core`, "PUT", body);
      await reload();
      toast({ message: result.message || done });
    } catch (error) { toast({ tone: "error", message: message(error) }); }
  }
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
    moveUnit: (unit, to) => {
      const ids = moveItem(units.map(item => item.id), units.indexOf(unit), to);
      void run(() => api(`/courses/${course.id}/units/order`, "PUT", { version: course.version, ids }), `«${unit.name}» ahora es ${noun.the} ${to + 1} de ${ids.length}.`);
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
    moveLesson: (lesson, to) => {
      const siblings = lessons.filter(item => item.courseUnitId === lesson.courseUnitId).map(item => item.id);
      const ids = moveItem(siblings, siblings.indexOf(lesson.id), to);
      void run(() => api("/lessons/order", "PUT", { courseUnitId: lesson.courseUnitId, ids }), `«${lesson.title}» ahora es la lección ${to + 1} de ${ids.length}.`);
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
    proposeForUnit: unit => navigate(`${base}/asistente?paso=propuestas&modulo=${unit.id}`),
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
    {delivering && <DeliveryDialog courseId={course.id} units={units.filter(unit => unit.status === "active")} onClose={() => setDelivering(false)}/>}
    <PageHeader crumbs={[{ label: "Cursos", href: "/cursos" }, { label: course.title, href: base }, { label: "Contenido" }]} title="Contenido"
      description={`${plural(stats.units, noun.one, noun.many)} · ${plural(stats.lessons, "lección", "lecciones")} · ${stats.published} publicadas${adapt ? ` · ${coreCount} en el núcleo` : ""}`}
      actions={units.length > 0 && <>{writable && <Button icon="sparkles" href={`${base}/asistente`}>Planificar con IA</Button>}<Button icon="download" onClick={() => setDelivering(true)}>PDF de entrega</Button><Button variant="ghost" onClick={() => setExpanded(expanded.size ? new Set() : new Set(units.map(unit => unit.id)))}>{expanded.size ? "Contraer todo" : "Expandir todo"}</Button></>}
      primary={publisher && units.length > 0 && <PrimaryAction icon="plus" onClick={() => creating ? document.getElementById("new-unit-name")?.focus() : setCreating(true)}>{`Crear ${noun.one}`}</PrimaryAction>}/>
    {!writable && <p className="notice"><Icon name="info" size={18}/>{course.status === "archived" ? "El curso está archivado. Administración puede restaurarlo desde Configuración." : "Consulta el contenido del curso. Su equipo docente lo prepara y su responsable lo publica."}</p>}
    {writable && !publisher && <p className="notice"><Icon name="info" size={18}/>Prepara y edita lecciones; cuando una esté lista, envíala a revisión. La persona responsable del curso la publica y organiza {noun.theMany}.</p>}
    {(archivedCount > 0 || showArchived) && <label className="switch"><input type="checkbox" checked={showArchived} onChange={event => setShowArchived(event.target.checked)}/><span>Mostrar archivados ({archivedCount})</span></label>}
    {adapt && <p className="freedom-notice"><Icon name="info" size={18}/><span>Las secciones pueden adaptar lo que no es núcleo. <Link href={`${base}/secciones?vista=diferencias`}>Ver diferencias entre secciones</Link></span></p>}
    {units.length ? <LessonOutline courseId={course.id} units={units} lessons={lessons} writable={writable && !busy} organize={publisher && !busy} noun={noun} showArchived={showArchived} actions={actions} expanded={expanded} setExpanded={setExpanded} focusUnit={focusUnit}
      core={adapt ? { isCore: lesson => lesson.isCore !== false, ...(publisher ? { markLesson: (lesson: Lesson, next: boolean) => void markCore({ lessons: [{ id: lesson.id, core: next }] }, next ? "Quedó en el núcleo." : "Salió del núcleo."), markUnit: (unit: LearningUnit, next: boolean) => void markCore({ units: [{ id: unit.id, core: next }] }, next ? "La unidad quedó en el núcleo." : "La unidad salió del núcleo.") } : {}) } : undefined}/>
      : !creating && <EmptyState icon="content" title={`Este curso aún no tiene ${noun.many}`} action={publisher && <PrimaryAction icon="plus" onClick={() => setCreating(true)}>{`Crear ${noun.one}`}</PrimaryAction>}>{`${noun.A} agrupa lecciones sobre un mismo tema. Por ejemplo: “Greetings” o “Colores”.`}</EmptyState>}
    {publisher && creating && <form className="inline-form unit-form" onSubmit={createUnit} aria-label={noun.New} onKeyDown={event => { if (event.key === "Escape" && units.length) setCreating(false); }}>
      <h2>{noun.New}</h2>
      <fieldset disabled={busy}>
        <div className="field"><label htmlFor="new-unit-name">{`Nombre ${noun.ofThe}`}</label><input id="new-unit-name" name="name" required maxLength={100} autoFocus placeholder="Ej. Greetings"/></div>
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
