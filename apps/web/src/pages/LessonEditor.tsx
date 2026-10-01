import { Fragment, lazy, Suspense, useCallback, useEffect, useRef, useState } from "react";
import type { Activity, Lesson, Material, Resource, RichTextDocument } from "@happy-learners/contracts";
import type { Editor } from "@tiptap/react";
import * as Y from "yjs";
import { api, ApiError, message, sessionRestored } from "../api";
import { CollaborationProvider } from "../collaboration";
import { seedMissingFields } from "../collab-seed";
import type { CollaborationStatus } from "../collaboration";
import { Link, useNavigation, useUnsavedChanges } from "../navigation";
import { useSession } from "../session";
import { activityHue, activityTypeLabel, draftOf, draftProblem, lessonBody, lessonState, lessonStateLabel, plural, timeAgo, usage } from "../model";
import type { LessonDraft } from "../model";
import { useFeedback } from "../ui/feedback";
import { Icon } from "../ui/icons";
import type { IconName } from "../ui/icons";
import { stateTone } from "../ui/LessonOutline";
import { Menu } from "../ui/Menu";
import { Breadcrumbs, Button, EmptyState, ErrorState, Field, Loading, PrimaryAction, StatusBadge } from "../ui/primitives";
import { useCourse } from "./course/context";
import { LessonPlayer } from "./StudentLesson";
import { FileViewer } from "../FileViewer";
const RichText = lazy(() => import("../RichText").then(module => ({ default: module.RichText })));
const RichToolbar = lazy(() => import("../RichText").then(module => ({ default: module.Toolbar })));

type Save = { state: "saved" | "pending" | "saving" | "error"; at?: string; error?: string };
const typeIcon: Record<NonNullable<Activity["type"]>, IconName> = { text: "text", resource: "library", question: "question" };
const AUTOSAVE_MS = 1000;

export function LessonEditor({ lessonId }: { lessonId: string }) {
  const { course, units, lessons, materials, legacyResources, writable, reload } = useCourse();
  const { member } = useSession();
  const { url, navigate } = useNavigation();
  const { toast, confirm } = useFeedback();
  const [lesson, setLesson] = useState<Lesson | null>(null), [draft, setDraft] = useState<LessonDraft | null>(null), [loadError, setLoadError] = useState<ApiError | null>(null);
  const [save, setSave] = useState<Save>({ state: "saved" });
  const [selected, setSelected] = useState("details"), [publishing, setPublishing] = useState(false), [activeEditor, setActiveEditor] = useState<Editor | null>(null);
  const [collaboration, setCollaboration] = useState<CollaborationProvider | null>(null), [collabStatus, setCollabStatus] = useState<CollaborationStatus>("closed"), [editors, setEditors] = useState<string[]>([]);
  const [, tick] = useState(0);
  const version = useRef<number | undefined>(undefined), changes = useRef(0), savedChanges = useRef(0), dirtyKeys = useRef(new Set<keyof LessonDraft>()), conflicts = useRef(0);
  const inFlight = useRef<Promise<boolean> | null>(null), draftRef = useRef<LessonDraft | null>(null);
  const saveRef = useRef(save);
  draftRef.current = draft; saveRef.current = save;
  const preview = url.searchParams.get("vista") === "previa";
  const base = `/cursos/${course.id}`;

  const open = useCallback(async () => {
    setLoadError(null);
    try {
      const { lesson: loaded } = await api<{ lesson: Lesson }>(writable ? `/lessons/${lessonId}?draft=1` : `/lessons/${lessonId}`);
      if (loaded.courseId !== course.id) throw new ApiError("Esta lección pertenece a otro curso.", 404);
      setLesson(loaded); setDraft(draftOf(loaded)); version.current = loaded.draftVersion; setSave({ state: "saved", at: loaded.updatedAt });
    } catch (error) { setLoadError(error instanceof ApiError ? error : new ApiError(message(error), 0)); }
  }, [lessonId, course.id, writable]);
  useEffect(() => { void open(); }, [open]);

  // Live co-editing of rich text; structure and metadata are saved with version control.
  useEffect(() => {
    if (!lesson?.id || !writable || preview) return;
    const provider = new CollaborationProvider(new Y.Doc(), course.id, lesson.id, member.username);
    setCollaboration(provider);
    const offStatus = provider.subscribe(status => {
      if (status === "live" && draftRef.current) seedMissingFields(provider.doc, draftRef.current.activities);
      setCollabStatus(status);
    });
    // Other open editors, including other sessions of the same shared demo account.
    const offPresence = provider.subscribePresence(() => setEditors([...provider.awareness.getStates().entries()].flatMap(([client, state]) => client !== provider.awareness.clientID && typeof state.user?.name === "string" ? [state.user.name as string] : [])));
    return () => { offStatus(); offPresence(); provider.destroy(); setCollaboration(null); setCollabStatus("closed"); };
  }, [lesson?.id, writable, preview, course.id, member.username]);
  useEffect(() => { const timer = setInterval(() => tick(value => value + 1), 30000); return () => clearInterval(timer); }, []);

  const problem = draft ? draftProblem(draft) : null;
  const collabReady = !collaboration || collabStatus === "live";

  const persist = useCallback(async (): Promise<boolean> => {
    const snapshot = draftRef.current;
    if (!snapshot || draftProblem(snapshot)) return false;
    const count = changes.current;
    setSave({ state: "saving" });
    try {
      const { lesson: saved } = await api<{ lesson: Lesson }>(`/lessons/${lessonId}`, "PUT", lessonBody(course.id, snapshot, version.current));
      version.current = saved.draftVersion; conflicts.current = 0; savedChanges.current = count;
      setLesson(saved);
      if (changes.current === count) { dirtyKeys.current.clear(); setSave({ state: "saved", at: saved.updatedAt || new Date().toISOString() }); }
      else setSave({ state: "pending" });
      return true;
    } catch (error) {
      if (error instanceof ApiError && error.status === 409 && conflicts.current < 2) {
        // Someone else saved first: take their version and reapply only the fields changed here.
        conflicts.current++;
        try {
          const { lesson: latest } = await api<{ lesson: Lesson }>(`/lessons/${lessonId}?draft=1`);
          const local = draftRef.current!, rebased = draftOf(latest) as Record<string, unknown>;
          for (const key of dirtyKeys.current) rebased[key] = local[key];
          version.current = latest.draftVersion; setLesson(latest); setDraft(rebased as LessonDraft); setSave({ state: "pending" });
        } catch (cause) { setSave({ state: "error", error: message(cause) }); }
        return false;
      }
      const text = error instanceof ApiError && error.status === 401 ? "Tu sesión terminó. Entra de nuevo y se guardará." : error instanceof ApiError && error.status === 409 ? "Otra persona está editando la estructura. Recarga para ver su versión." : `${message(error)} Tus cambios siguen en pantalla.`;
      setSave({ state: "error", error: text });
      return false;
    }
  }, [lessonId, course.id]);
  /** Waits for any save in progress and sends what is still pending; true when the server has the current draft. */
  const flush = useCallback(async () => {
    if (inFlight.current) await inFlight.current;
    if (savedChanges.current === changes.current) return true;
    inFlight.current = persist();
    const ok = await inFlight.current;
    inFlight.current = null;
    return ok && savedChanges.current === changes.current;
  }, [persist]);

  useEffect(() => {
    if (save.state !== "pending" || problem || !collabReady || inFlight.current) return;
    const timer = setTimeout(() => { inFlight.current = persist().finally(() => { inFlight.current = null; }) as Promise<boolean>; }, AUTOSAVE_MS);
    return () => clearTimeout(timer);
  }, [draft, save.state, problem, collabReady, persist]);
  useEffect(() => {
    const retry = () => setSave(current => current.state === "error" ? { state: "pending" } : current);
    addEventListener(sessionRestored, retry);
    return () => removeEventListener(sessionRestored, retry);
  }, []);
  // In-app navigation only asks when a change cannot be saved; closing the tab also asks while saving.
  useUnsavedChanges(!!draft && changes.current > 0 && (save.state === "error" || (save.state === "pending" && !!problem)));
  useEffect(() => {
    const leave = (event: BeforeUnloadEvent) => { if (save.state === "pending" || save.state === "saving") { event.preventDefault(); event.returnValue = ""; } };
    addEventListener("beforeunload", leave);
    return () => removeEventListener("beforeunload", leave);
  }, [save.state]);
  // Leaving the editor: save what can be saved, then refresh the course outline.
  useEffect(() => () => {
    const pending = draftRef.current && savedChanges.current !== changes.current && !draftProblem(draftRef.current);
    void (pending ? persist() : Promise.resolve(true)).finally(() => { void reload(); });
  }, []);

  function update(patch: Partial<LessonDraft>) {
    if (!writable) return;
    Object.keys(patch).forEach(key => dirtyKeys.current.add(key as keyof LessonDraft));
    changes.current++;
    setDraft(current => current && { ...current, ...patch });
    setSave({ state: "pending" });
  }
  function updateActivity(id: string, patch: Partial<Activity>) { update({ activities: draft!.activities.map(activity => activity.id === id ? { ...activity, ...patch } : activity) }); }
  function addActivity(type: NonNullable<Activity["type"]>, index = draft!.activities.length) {
    const id = `activity-${crypto.randomUUID()}`;
    const activity: Activity = { id, type, title: type === "question" ? "Pregunta" : type === "resource" ? "Recurso" : "Nueva actividad", instructions: "", minutes: 5, ...(type === "question" ? { options: ["", ""], answer: 0 } : {}) };
    const list = [...draft!.activities];
    list.splice(index, 0, activity);
    update({ activities: list });
    setSelected(id);
    // Land on the new card's content so writing can start right away.
    setTimeout(() => {
      const card = document.getElementById(`card-${id}`);
      card?.scrollIntoView({ behavior: "smooth", block: "center" });
      card?.querySelector<HTMLElement>("[contenteditable=true]")?.focus({ preventScroll: true });
    }, 120);
  }
  function moveActivity(index: number, delta: number) {
    const list = [...draft!.activities];
    [list[index], list[index + delta]] = [list[index + delta], list[index]];
    update({ activities: list });
    toast({ tone: "info", message: `«${list[index + delta].title}» ahora es la actividad ${index + delta + 1} de ${list.length}.` });
  }
  async function removeActivity(activity: Activity) {
    if (!await confirm({ title: `¿Eliminar «${activity.title || "actividad sin título"}»?`, body: <p>La actividad se quita del borrador. La versión publicada no cambia hasta que publiques.</p>, confirm: "Eliminar actividad", danger: true })) return;
    const index = draft!.activities.indexOf(activity);
    const list = draft!.activities.filter(item => item.id !== activity.id);
    update({ activities: list });
    setSelected(list[Math.max(0, index - 1)]?.id || "details");
  }
  async function publish() {
    if (problem) { toast({ tone: "error", message: problem.message }); setSelected(problem.target === "title" ? "details" : problem.target); return; }
    if (!draft!.activities.length) { toast({ tone: "error", message: "Agrega al menos una actividad antes de publicar." }); return; }
    setPublishing(true);
    try {
      if (!await flush()) throw new Error("No pudimos guardar los últimos cambios.");
      await api(`/lessons/${lessonId}/publish`, "POST");
      const { lesson: fresh } = await api<{ lesson: Lesson }>(`/lessons/${lessonId}?draft=1`);
      setLesson(fresh); version.current = fresh.draftVersion;
      toast({ message: "Lección publicada. Los estudiantes ya ven esta versión.", action: fresh.shareCode ? { label: "Copiar enlace", onSelect: () => void copyLink(fresh.shareCode!) } : undefined });
    } catch (error) { toast({ tone: "error", message: `${message(error)} Revisa las actividades y vuelve a intentar.` }); }
    finally { setPublishing(false); }
  }
  async function copyLink(code: string) {
    const link = `${location.origin}/aprender/${code}`;
    try { await navigator.clipboard.writeText(link); toast({ message: "Enlace copiado. Compártelo con tus estudiantes." }); }
    catch { toast({ tone: "info", message: `Copia este enlace: ${link}` }); }
  }
  async function archive(archived: boolean) {
    if (archived && !await confirm({ title: "¿Archivar esta lección?", body: <p>Deja de estar disponible para estudiantes y sale del contenido del curso. Puedes restaurarla después.</p>, confirm: "Archivar lección", danger: true })) return;
    update({ archived });
    setTimeout(() => { void flush().then(ok => ok && toast({ message: archived ? "Lección archivada." : "Lección restaurada como borrador." })); }, 0);
  }

  if (loadError) return loadError.status === 404
    ? <EmptyState icon="content" title="No encontramos esta lección" action={<Link className="button primary" href={`${base}/contenido`}>Volver al contenido</Link>}>Puede que se haya movido a otro curso.</EmptyState>
    : <ErrorState title="No pudimos abrir la lección" error={loadError.message} retry={() => void open()}/>;
  if (!lesson || !draft) return <Loading label="Abriendo lección…" lines={8}/>;

  const unit = units.find(item => item.id === draft.unitId);
  const available = [...materials.filter(item => item.status !== "archived" || draft.activities.some(activity => activity.resourceId === item.id)), ...legacyResources.filter(item => usage(item.id, lessons).length || draft.activities.some(activity => activity.resourceId === item.id))];
  const unsaved = changes.current > 0 && save.state !== "saved";
  const serverState = lessonState(lesson);
  const state = draft.archived ? "archived" : serverState === "published" && unsaved ? "changes" : serverState;
  const previewLesson: Lesson = { ...lesson, title: draft.title, objective: draft.objective, duration: draft.duration, program: unit?.name || lesson.program, activities: draft.activities };
  if (preview) return <div className="editor-preview">
    <LessonPlayer lesson={previewLesson} preview resources={available} fileUrl={id => `/api/courses/${course.id}/files/${id}/content`} onExit={() => navigate(`${base}/lecciones/${lessonId}`, true)}/>
  </div>;

  const primary = !writable ? undefined
    : state === "archived" ? <PrimaryAction icon="archive" onClick={() => void archive(false)}>Restaurar lección</PrimaryAction>
    : state === "published" && lesson.shareCode ? <PrimaryAction icon="copy" onClick={() => void copyLink(lesson.shareCode!)}>Copiar enlace</PrimaryAction>
    : <PrimaryAction icon="check" busy={publishing} disabled={publishing} onClick={() => void publish()}>{publishing ? "Publicando…" : state === "changes" ? "Publicar cambios" : "Publicar"}</PrimaryAction>;
  const goTo = (id: string, focus = true) => {
    setSelected(id);
    const card = document.getElementById(id === "details" ? "lesson-details" : `card-${id}`);
    card?.scrollIntoView({ behavior: "smooth", block: "start" });
    if (focus) setTimeout(() => card?.querySelector<HTMLElement>("input, textarea, [contenteditable=true]")?.focus({ preventScroll: true }), 250);
  };
  const reviewProblem = () => problem && goTo(problem.target === "title" ? "details" : problem.target);
  const insert = (index: number) => writable && <InsertBar index={index} total={draft.activities.length} onAdd={type => addActivity(type, index)}/>;
  return <div className="editor">
    <header className="editor-header">
      <Breadcrumbs items={[{ label: "Cursos", href: "/cursos" }, { label: course.title, href: base }, { label: "Contenido", href: `${base}/contenido` }, ...(unit ? [{ label: unit.name, href: `${base}/contenido#unidad-${unit.id}` }] : []), { label: draft.title || "Lección sin título" }]}/>
      <h1 className="sr-only">Editar lección: {draft.title}</h1>
      <div className="editor-title-row">
        <textarea className="title-input" aria-label="Título de la lección" rows={1} value={draft.title} maxLength={160} readOnly={!writable} onKeyDown={event => { if (event.key === "Enter") event.preventDefault(); }} onChange={event => update({ title: event.target.value.replace(/\s*\n\s*/g, " ") })} placeholder="Título de la lección"/>
        <div className="editor-actions">
          {writable && <SaveIndicator save={save} published={!!lesson.revision} problem={problem?.message} waiting={!collabReady && save.state === "pending"} failed={collabStatus === "failed"} onReview={reviewProblem} onRetry={() => setSave({ state: "pending" })}/>}
          <div className="editor-buttons">
          <StatusBadge tone={stateTone[state]}>{lessonStateLabel[state]}</StatusBadge>
          <Button icon="eye" onClick={() => navigate(`${base}/lecciones/${lessonId}?vista=previa`)}>Vista previa</Button>
          {primary}
          <Menu label="Más acciones de la lección" items={[
            ...(lesson.revision && lesson.shareCode && !draft.archived ? [{ label: "Abrir como estudiante", icon: "eye" as const, onSelect: () => window.open(`/aprender/${lesson.shareCode}`, "_blank", "noopener") }, { label: "Copiar enlace", icon: "copy" as const, onSelect: () => void copyLink(lesson.shareCode!) }] : []),
            { label: "Volver al contenido", icon: "back", onSelect: () => navigate(`${base}/contenido`) },
            ...(writable && !draft.archived ? ["separator" as const, { label: "Archivar lección", icon: "archive" as const, danger: true, onSelect: () => void archive(true) }] : []),
          ]}/>
          </div>
        </div>
      </div>
      {writable && state === "changes" && <p className="draft-note"><Icon name="info" size={16}/>Tus cambios se guardan como borrador. Los estudiantes siguen viendo la versión publicada hasta que elijas <strong>Publicar cambios</strong>.</p>}
      {editors.length > 0 && <p className="presence"><Icon name="users" size={16}/>También editando: {[...new Set(editors)].map(name => name === member.username ? `${name} (otra sesión)` : name).join(", ")}</p>}
      {!writable && <p className="notice"><Icon name="info" size={18}/>{course.status === "archived" ? "El curso está archivado: la lección se muestra en modo lectura." : "Estás viendo la versión publicada. Solo educadores pueden editarla."}</p>}
    </header>
    <div className="editor-layout">
      <nav className="activity-outline" aria-label="Estructura de la lección">
        <button type="button" className="outline-item tone-violet" aria-current={selected === "details" ? "true" : undefined} onClick={() => goTo("details")}><span className="outline-number type-chip" aria-hidden="true"><Icon name="info" size={16}/></span><span><strong>Detalles</strong><small>Objetivo, unidad y duración</small></span></button>
        <h2 className="outline-heading">Actividades <span className="muted">({draft.activities.length})</span></h2>
        {draft.activities.length ? <ol className="activity-list">{draft.activities.map((activity, index) => <li key={activity.id} className={`tone-${activityHue[activity.type || "text"]}${selected === activity.id ? " is-selected" : ""}`}>
          <button type="button" className="outline-item" aria-current={selected === activity.id ? "true" : undefined} onClick={() => goTo(activity.id!)}>
            <span className="outline-number type-chip" aria-hidden="true"><Icon name={typeIcon[activity.type || "text"]} size={16}/></span>
            <span><strong>{index + 1}. {activity.title || "Sin título"}</strong><small>{activityTypeLabel[activity.type || "text"]} · {activity.minutes} min</small></span>
          </button>
          {writable && <span className="reorder">
            <button type="button" className="icon-button small" aria-label={`Subir actividad ${index + 1}: ${activity.title}`} disabled={index === 0} onClick={() => moveActivity(index, -1)}><Icon name="up" size={16}/></button>
            <button type="button" className="icon-button small" aria-label={`Bajar actividad ${index + 1}: ${activity.title}`} disabled={index === draft.activities.length - 1} onClick={() => moveActivity(index, 1)}><Icon name="down" size={16}/></button>
          </span>}
        </li>)}</ol> : <p className="muted small">Aún no hay actividades.</p>}
      </nav>
      <div className="lesson-canvas">
        {writable && <div className="canvas-toolbar"><Suspense fallback={null}><RichToolbar editor={activeEditor}/></Suspense></div>}
        <section id="lesson-details" className="canvas-card details-card tone-violet" aria-labelledby="details-title" onFocusCapture={() => setSelected("details")}>
          <div className="card-head"><span className="type-chip" aria-hidden="true"><Icon name="info" size={16}/></span><h2 id="details-title">Detalles de la lección</h2></div>
          <fieldset className="stack" disabled={!writable}>
            <Field label="Objetivo" hint="Qué podrán hacer los estudiantes al terminar. Lo ven al abrir la lección."><textarea rows={2} maxLength={1000} value={draft.objective} onChange={event => update({ objective: event.target.value })}/></Field>
            <div className="field-row">
              <Field label="Unidad"><select value={draft.unitId} onChange={event => update({ unitId: event.target.value })}>{units.filter(item => item.status === "active" || item.id === draft.unitId).map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></Field>
              <Field label="Duración (minutos)"><input type="number" min={1} max={300} value={draft.duration} onChange={event => update({ duration: Math.max(1, Math.min(300, Number(event.target.value) || 1)) })}/></Field>
            </div>
          </fieldset>
          <div className="publish-info">
            {lesson.revision && lesson.shareCode ? <>
              <p><strong>Publicación {lesson.revision}.</strong> {state === "changes" ? "Tienes cambios en borrador que los estudiantes aún no ven." : "Los estudiantes ven esta versión."}</p>
              <p className="share-row"><span>Código <strong>{lesson.shareCode}</strong></span><a href={`/aprender/${lesson.shareCode}`} target="_blank" rel="noopener noreferrer">Abrir como estudiante</a><button type="button" className="button ghost small" onClick={() => void copyLink(lesson.shareCode!)}><Icon name="copy" size={16}/>Copiar enlace</button></p>
              <p className="muted small">Terminada {plural(lesson.completions || 0, "vez", "veces")}. Solo se cuenta el total, sin nombres ni respuestas.</p>
            </> : <p className="muted">Es un borrador: todo se guarda solo y nadie lo ve hasta que publiques.</p>}
          </div>
        </section>
        {insert(0)}
        {draft.activities.map((activity, index) => <Fragment key={activity.id}>
          <ActivityCard activity={activity} index={index} total={draft.activities.length} writable={writable} resources={available} courseId={course.id}
            collaboration={collaboration} username={member.username} onFocus={() => setSelected(activity.id!)} onEditorFocus={setActiveEditor}
            onChange={patch => updateActivity(activity.id!, patch)} onRemote={doc => setDraft(value => value && { ...value, activities: value.activities.map(item => item.id === activity.id ? { ...item, richContent: doc } : item) })}
            onMove={delta => moveActivity(index, delta)} onRemove={() => void removeActivity(activity)}/>
          {insert(index + 1)}
        </Fragment>)}
        {!draft.activities.length && <EmptyState icon="content" title="Agrega la primera actividad">Empieza con un contenido para explicar, un recurso de la biblioteca o una pregunta para comprobar lo aprendido.</EmptyState>}
      </div>
    </div>
  </div>;
}

/** Between two activities: insert content, a library resource or a question at exactly that point. */
function InsertBar({ index, total, onAdd }: { index: number; total: number; onAdd: (type: NonNullable<Activity["type"]>) => void }) {
  const last = index === total;
  return <div className={`insert-bar${last ? " is-last" : ""}`} role="group" aria-label={last ? "Agregar al final de la lección" : `Agregar antes de la actividad ${index + 1}`}>
    <span className="insert-line" aria-hidden="true"/>
    {(["text", "resource", "question"] as const).map(type => <button key={type} type="button" className={`insert-option tone-${activityHue[type]}`} onClick={() => onAdd(type)}>
      <Icon name={typeIcon[type]} size={16}/><span>{type === "text" ? "Contenido" : type === "resource" ? "Recurso" : "Pregunta"}</span>
    </button>)}
    <span className="insert-line" aria-hidden="true"/>
  </div>;
}

/** Every change is saved as a draft; students only see what has been published. */
function SaveIndicator({ save, published, problem, waiting, failed, onReview, onRetry }: { save: Save; published: boolean; problem?: string; waiting: boolean; failed: boolean; onReview: () => void; onRetry: () => void }) {
  let content;
  if (failed) content = <span className="save error"><Icon name="alert" size={16}/><span>Sin conexión con el editor. Recarga la página para guardar.</span></span>;
  else if (save.state === "saving") content = <span className="save saving"><span className="spinner" aria-hidden="true"/><span>Guardando borrador…</span></span>;
  else if (save.state === "error") content = <span className="save error"><Icon name="alert" size={16}/><span>No se guardó. {save.error} <button type="button" className="link-button" onClick={onRetry}>Reintentar</button></span></span>;
  else if (save.state === "pending" && problem) content = <span className="save warning"><Icon name="info" size={16}/><span>Sin guardar: {problem} <button type="button" className="link-button" onClick={onReview}>Revisar</button></span></span>;
  else if (save.state === "pending") content = <span className="save pending"><span>{waiting ? "Conectando para guardar…" : "Cambios sin guardar"}</span></span>;
  else content = <span className="save saved" title={published ? "Los estudiantes ven la versión publicada hasta que publiques los cambios." : "Nadie ve la lección hasta que la publiques."}><Icon name="check" size={16}/><span>Borrador guardado{save.at ? ` ${timeAgo(save.at)}` : ""}</span></span>;
  return <div className="save-indicator" role="status" aria-live="polite">{content}</div>;
}

function ActivityCard({ activity, index, total, writable, resources, courseId, collaboration, username, onFocus, onEditorFocus, onChange, onRemote, onMove, onRemove }: {
  activity: Activity; index: number; total: number; writable: boolean; resources: (Material | Resource)[]; courseId: string;
  collaboration: CollaborationProvider | null; username: string; onFocus: () => void; onEditorFocus: (editor: Editor) => void;
  onChange: (patch: Partial<Activity>) => void; onRemote: (doc: RichTextDocument) => void; onMove: (delta: number) => void; onRemove: () => void;
}) {
  const type = activity.type || "text";
  const options = activity.options || [];
  const number = index + 1;
  const [showFile, setShowFile] = useState(false);
  const resource = resources.find(item => item.id === activity.resourceId);
  const convert = (value: NonNullable<Activity["type"]>) => onChange({ type: value, ...(value === "question" && !activity.options?.length ? { options: ["", ""], answer: 0 } : {}) });
  return <section id={`card-${activity.id}`} className={`canvas-card activity-card tone-${activityHue[type]}`} aria-label={`Actividad ${number}: ${activity.title || "sin título"}`} onFocusCapture={onFocus}>
    <div className="card-head">
      <span className="type-chip" aria-hidden="true"><Icon name={typeIcon[type]} size={16}/></span>
      <span className="card-kind">{activityTypeLabel[type]} · {number} de {total}</span>
      <label className="sr-only" htmlFor={`title-${activity.id}`}>Título de la actividad {number}</label>
      <input id={`title-${activity.id}`} className="card-title" value={activity.title} maxLength={160} readOnly={!writable} placeholder="Título de la actividad" onChange={event => onChange({ title: event.target.value })}/>
      <label className="card-minutes"><input type="number" min={1} max={120} value={activity.minutes} readOnly={!writable} aria-label={`Minutos de la actividad ${number}`} onChange={event => onChange({ minutes: Math.max(1, Math.min(120, Number(event.target.value) || 1)) })}/><span aria-hidden="true">min</span></label>
      {writable && <Menu label={`Acciones de la actividad ${number}`} items={[
        { label: "Mover arriba", icon: "up", disabled: index === 0, onSelect: () => onMove(-1) },
        { label: "Mover abajo", icon: "down", disabled: index === total - 1, onSelect: () => onMove(1) },
        "separator",
        ...(["text", "resource", "question"] as const).filter(value => value !== type).map(value => ({ label: `Convertir en ${activityTypeLabel[value].toLowerCase()}`, icon: typeIcon[value], onSelect: () => convert(value) })),
        "separator",
        { label: "Eliminar actividad", icon: "close", danger: true, onSelect: onRemove },
      ]}/>}
    </div>
    <Suspense fallback={<p role="status">Cargando editor…</p>}>
      <RichText key={activity.id} value={activity.richContent} fallbackText={activity.instructions} label={`${type === "question" ? "Pregunta" : "Contenido"} de la actividad ${number}`} editable={writable} toolbar={false} onEditorFocus={onEditorFocus}
        placeholder={type === "question" ? "Escribe la pregunta…" : type === "resource" ? "Explica qué deben hacer con el recurso…" : "Escribe las instrucciones o el contenido…"}
        collaboration={collaboration && activity.id ? { document: collaboration.doc, field: activity.id, provider: collaboration } : undefined} username={username}
        onChange={richContent => onChange({ richContent, instructions: "" })} onRemoteChange={onRemote}/>
    </Suspense>
    {type === "resource" && <div className="card-resource">
      {resources.length ? <Field label={`Recurso de la actividad ${number}`} hint={<>El estudiante lo ve dentro de esta actividad. <Link href={`/cursos/${courseId}/biblioteca`}>Abrir la biblioteca del curso</Link></>}>
        <select value={activity.resourceId || ""} disabled={!writable} onChange={event => { setShowFile(false); onChange({ resourceId: event.target.value }); }}><option value="">Elige un recurso</option>{resources.map(item => <option key={item.id} value={item.id}>{item.title}{item.status === "archived" ? " (archivado)" : item.status === "draft" ? " (borrador)" : ""}</option>)}</select>
      </Field> : <p className="notice"><Icon name="library" size={18}/>La biblioteca del curso está vacía. <Link href={`/cursos/${courseId}/biblioteca`}>Agrega un recurso</Link> y vuelve a esta actividad.</p>}
      {resource && (resource.kind === "file" && "fileId" in resource && resource.fileId
        ? showFile ? <FileViewer url={`/api/courses/${courseId}/files/${resource.fileId}/content`} name={resource.fileName || resource.title}/> : <button type="button" className="resource-peek" onClick={() => setShowFile(true)}><Icon name="eye" size={18}/><span><strong>{resource.fileName || resource.title}</strong><small>Ver el archivo aquí</small></span></button>
        : resource.kind === "link" ? <a className="resource-peek" href={resource.content} target="_blank" rel="noopener noreferrer"><Icon name="link" size={18}/><span><strong>{resource.title}</strong><small>{resource.content}</small></span></a>
        : <div className="resource-peek is-text"><Icon name="text" size={18}/><span><strong>{resource.title}</strong><small className="preserve-lines">{resource.content}</small></span></div>)}
    </div>}
    {type === "question" && <fieldset className="options" disabled={!writable}><legend>Opciones de respuesta</legend>
      <p className="muted small">Marca la respuesta correcta. Entre 2 y 6 opciones.</p>
      <ol>{options.map((option, choice) => <li key={choice}>
        <label className="correct"><input type="radio" name={`correct-${activity.id}`} checked={activity.answer === choice} onChange={() => onChange({ answer: choice })}/><span className="sr-only">Respuesta correcta: opción {choice + 1}</span></label>
        <label htmlFor={`option-${activity.id}-${choice}`} className="sr-only">Opción {choice + 1}</label>
        <input id={`option-${activity.id}-${choice}`} value={option} maxLength={200} placeholder={`Opción ${choice + 1}`} onChange={event => onChange({ options: options.map((item, i) => i === choice ? event.target.value : item) })}/>
        <button type="button" className="icon-button small" aria-label={`Quitar opción ${choice + 1}`} disabled={options.length <= 2} onClick={() => onChange({ options: options.filter((_, i) => i !== choice), answer: activity.answer === choice ? 0 : (activity.answer || 0) > choice ? (activity.answer || 0) - 1 : activity.answer })}><Icon name="close" size={16}/></button>
      </li>)}</ol>
      {options.length < 6 && <button type="button" className="button ghost small" onClick={() => onChange({ options: [...options, ""] })}><Icon name="plus" size={16}/>Agregar opción</button>}
    </fieldset>}
  </section>;
}
