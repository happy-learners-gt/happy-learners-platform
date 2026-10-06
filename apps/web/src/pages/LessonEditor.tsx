import { lazy, Suspense, useCallback, useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";
import type { Activity, ActivityBlock, LearningOutcome, Lesson, Material, Resource, RichTextDocument, SequenceTemplate } from "@happy-learners/contracts";
import { blockKinds, groupings, outcomeCodes, phaseOf, publishChecklist, purposes, resourceIdsOf, sequenceOf, sequenceTemplates, studentActivities, suggestedResources } from "@happy-learners/domain";
import type { CheckItem } from "@happy-learners/domain";
import type { Phase } from "@happy-learners/domain";
import type { Editor } from "@tiptap/react";
import * as Y from "yjs";
import { api, ApiError, message, sessionExpired, sessionRestored } from "../api";
import { CollaborationProvider } from "../collaboration";
import { seedMissingFields } from "../collab-seed";
import { hasStructure, observeStructure, readStructure, recordSaved, savedVersion, seedStructure, writeStructure } from "../lesson-structure";
import type { CollaborationStatus } from "../collaboration";
import { Link, useNavigation, useUnsavedChanges } from "../navigation";
import { useSession } from "../session";
import { blockHue, blockKindLabel, changeSequence, draftOf, draftProblem, lessonBody, lessonState, lessonStateLabel, newBlock, orderByPhase, phaseHue, plural, timeAgo, usage } from "../model";
import type { LessonDraft } from "../model";
import { Modal, useFeedback } from "../ui/feedback";
import { Icon } from "../ui/icons";
import type { IconName } from "../ui/icons";
import { stateTone } from "../ui/LessonOutline";
import { Menu } from "../ui/Menu";
import { moveItem, SortHandle } from "../ui/Sortable";
import { Breadcrumbs, Button, EmptyState, ErrorState, Field, Loading, PrimaryAction, StatusBadge } from "../ui/primitives";
import { useCourse } from "./course/context";
import { LessonPlayer } from "./StudentLesson";
import { FileViewer } from "../FileViewer";
const RichText = lazy(() => import("../RichText").then(module => ({ default: module.RichText })));
const RichToolbar = lazy(() => import("../RichText").then(module => ({ default: module.Toolbar })));

type Save = { state: "saved" | "pending" | "saving" | "error"; at?: string; error?: string };
export const kindIcon: Record<ActivityBlock["kind"], IconName> = { text: "text", resource: "library", question: "question", "teacher-note": "edit" };
const newTitle: Record<ActivityBlock["kind"], string> = { text: "Nueva actividad", resource: "Recurso", question: "Pregunta", "teacher-note": "Nueva actividad" };
const AUTOSAVE_MS = 1000;
/** Jumps instead of animating for people who ask the system for reduced motion. */
const scrollBehavior = (): ScrollBehavior => matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth";

export function LessonEditor({ lessonId }: { lessonId: string }) {
  const { course, units, lessons, materials, legacyResources, curriculum, writable, publisher, reload, noun, settings } = useCourse();
  const { member } = useSession();
  const { url, navigate } = useNavigation();
  const { toast, confirm } = useFeedback();
  const [lesson, setLesson] = useState<Lesson | null>(null), [draft, setDraft] = useState<LessonDraft | null>(null), [loadError, setLoadError] = useState<ApiError | null>(null);
  const [save, setSave] = useState<Save>({ state: "saved" });
  const [selected, setSelected] = useState("details"), [publishing, setPublishing] = useState(false), [activeEditor, setActiveEditor] = useState<Editor | null>(null), [reviewing, setReviewing] = useState<"send" | "return" | null>(null);
  const [collaboration, setCollaboration] = useState<CollaborationProvider | null>(null), [collabStatus, setCollabStatus] = useState<CollaborationStatus>("closed"), [editors, setEditors] = useState<string[]>([]);
  const [, tick] = useState(0);
  const version = useRef<number | undefined>(undefined), changes = useRef(0), savedChanges = useRef(0), dirtyKeys = useRef(new Set<keyof LessonDraft>()), conflicts = useRef(0);
  const inFlight = useRef<Promise<boolean> | null>(null), draftRef = useRef<LessonDraft | null>(null);
  const providerRef = useRef<CollaborationProvider | null>(null), lessonRef = useRef<Lesson | null>(null), shared = useRef(false), [structureLive, setStructureLive] = useState(false);
  // What this editor last shared with the room, the drafts read from it, and whether the room changed during an edit here.
  const synced = useRef<LessonDraft | null>(null), fromRoom = useRef(new WeakSet<LessonDraft>()), behind = useRef(false);
  const saveRef = useRef(save);
  draftRef.current = draft; saveRef.current = save; lessonRef.current = lesson;
  const preview = url.searchParams.get("vista") === "previa";
  const base = `/cursos/${course.id}`;

  const open = useCallback(async () => {
    setLoadError(null);
    try {
      const { lesson: loaded } = await api<{ lesson: Lesson }>(`/lessons/${lessonId}?draft=1`);
      if (loaded.courseId !== course.id) throw new ApiError("Esta lección pertenece a otro curso.", 404);
      setLesson(loaded); setDraft(draftOf(loaded)); version.current = loaded.draftVersion; setSave({ state: "saved", at: loaded.updatedAt });
    } catch (error) { setLoadError(error instanceof ApiError ? error : new ApiError(message(error), 0)); }
  }, [lessonId, course.id]);
  useEffect(() => { void open(); }, [open]);

  // Live co-editing of the rich text and of the structure: details, order and activities merge as people work.
  useEffect(() => {
    if (!lesson?.id || !writable || preview) return;
    const provider = new CollaborationProvider(new Y.Doc(), course.id, lesson.id, member.username), doc = provider.doc;
    setCollaboration(provider); providerRef.current = provider;
    const adoptVersion = () => { const room = savedVersion(doc); if (room !== null && room > (version.current ?? 0)) version.current = room; };
    const offStatus = provider.subscribe(status => {
      const local = draftRef.current;
      if (status === "live" && local) {
        seedMissingFields(doc, local.activities);
        if (!shared.current && lessonRef.current) {
          const saved = draftOf(lessonRef.current), at = version.current ?? 0, room = savedVersion(doc);
          // A room without structure takes the saved lesson; so does one older than it (changed while nobody was editing).
          if (!hasStructure(doc)) seedStructure(doc, saved, lessonRef.current.id, at);
          else if (room === null || room < at) { writeStructure(doc, saved); recordSaved(doc, at); }
          // Then the room's state, with what was changed here before connecting.
          const merged = readStructure(doc, local) as Record<string, unknown>;
          for (const key of dirtyKeys.current) merged[key] = local[key];
          writeStructure(doc, merged as LessonDraft); synced.current = merged as LessonDraft; fromRoom.current.add(synced.current); setDraft(synced.current); adoptVersion();
          shared.current = true; setStructureLive(true);
        }
      }
      setCollabStatus(status);
    });
    const offStructure = observeStructure(doc, () => {
      if (!shared.current) return;
      adoptVersion();
      // An edit made here that has not reached the room yet goes first; the effect below then reads the room again.
      setDraft(current => {
        if (!current) return current;
        if (current !== synced.current && !fromRoom.current.has(current)) { behind.current = true; return current; }
        const next = readStructure(doc, current);
        fromRoom.current.add(next);
        return next;
      });
    });
    // Other open editors, including other sessions of the same shared demo account.
    const offPresence = provider.subscribePresence(() => setEditors([...provider.awareness.getStates().entries()].flatMap(([client, state]) => client !== provider.awareness.clientID && typeof state.user?.name === "string" ? [state.user.name as string] : [])));
    return () => { offStatus(); offStructure(); offPresence(); provider.destroy(); providerRef.current = null; shared.current = false; synced.current = null; behind.current = false; setStructureLive(false); setCollaboration(null); setCollabStatus("closed"); };
  }, [lesson?.id, writable, preview, course.id, member.username]);
  // Each change made here reaches the room, also while reconnecting: it merges when the connection returns.
  useEffect(() => {
    if (!structureLive || !collaboration || !draft) return;
    if (fromRoom.current.has(draft)) { synced.current = draft; return; }
    writeStructure(collaboration.doc, draft, synced.current || undefined);
    synced.current = draft;
    if (!behind.current) return;
    behind.current = false;
    const next = readStructure(collaboration.doc, draft);
    fromRoom.current.add(next); setDraft(next);
  }, [draft, structureLive, collaboration]);
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
      if (providerRef.current && shared.current && saved.draftVersion !== undefined) recordSaved(providerRef.current.doc, saved.draftVersion);
      setLesson(saved);
      if (changes.current === count) { dirtyKeys.current.clear(); setSave({ state: "saved", at: saved.updatedAt || new Date().toISOString() }); }
      else setSave({ state: "pending" });
      return true;
    } catch (error) {
      if (error instanceof ApiError && error.status === 409 && conflicts.current < (shared.current ? 5 : 2)) {
        conflicts.current++;
        try {
          const { lesson: latest } = await api<{ lesson: Lesson }>(`/lessons/${lessonId}?draft=1`);
          version.current = latest.draftVersion; setLesson(latest);
          // With the structure in the room, this draft already holds what the others saved: send it again.
          // Otherwise take their version and reapply only the fields changed here.
          if (!shared.current) {
            const local = draftRef.current!, rebased = draftOf(latest) as Record<string, unknown>;
            for (const key of dirtyKeys.current) rebased[key] = local[key];
            setDraft(rebased as LessonDraft);
          }
          setSave({ state: "pending" });
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
  // A live-editing connection refused because the session ended never reports a 401 to the page:
  // if changes wait too long for it, check the session so the sign-in prompt appears.
  useEffect(() => {
    if (save.state !== "pending" || problem || collabReady) return;
    const timer = setTimeout(() => {
      void fetch("/api/session", { credentials: "same-origin", cache: "no-store" }).then(response => { if (response.status === 401) dispatchEvent(new CustomEvent(sessionExpired)); }).catch(() => undefined);
    }, 4000);
    return () => clearTimeout(timer);
  }, [save.state, problem, collabReady]);
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
  /**
   * Activity changes apply to the latest draft, not the one of the last render: editors report changes
   * asynchronously (collaboration sync, late input), and a stale copy would undo edits made meanwhile.
   */
  function updateActivities(change: (activities: Activity[]) => Activity[]) {
    if (!writable) return;
    dirtyKeys.current.add("activities");
    changes.current++;
    setDraft(current => current && { ...current, activities: orderByPhase(change(current.activities), current.sequence) });
    setSave({ state: "pending" });
  }
  const setActivities = (activities: Activity[]) => updateActivities(() => activities);
  const updateActivity = (id: string, patch: Partial<Activity> | ((activity: Activity) => Partial<Activity>)) =>
    updateActivities(list => list.map(activity => activity.id === id ? { ...activity, ...(typeof patch === "function" ? patch(activity) : patch) } : activity));
  const updateBlocks = (id: string, change: (blocks: ActivityBlock[]) => ActivityBlock[]) => updateActivity(id, activity => ({ blocks: change(activity.blocks || []) }));
  const updateBlock = (activity: Activity, blockId: string, patch: Partial<ActivityBlock>) => updateBlocks(activity.id!, blocks => blocks.map(block => block.id === blockId ? { ...block, ...patch } : block));
  /** Brings a new card or block into view and focuses it, unless focus already moved (typing elsewhere wins). */
  const focusCard = (id: string, selector = "[contenteditable=true]") => {
    const origin = document.activeElement;
    setTimeout(() => {
      const card = document.getElementById(`card-${id}`);
      card?.scrollIntoView({ behavior: scrollBehavior(), block: "center" });
      if (document.activeElement !== origin && document.activeElement !== document.body) return;
      [...card?.querySelectorAll<HTMLElement>(selector) || []].pop()?.focus({ preventScroll: true });
    }, 120);
  };
  /** A new activity starts with one block in the chosen moment, after the activities already there. */
  function addActivity(kind: ActivityBlock["kind"], phase: string) {
    const id = `activity-${crypto.randomUUID()}`;
    setActivities([...draft!.activities, { id, title: newTitle[kind], minutes: 5, instructions: "", phase, blocks: [newBlock(kind)] }]);
    setSelected(id);
    focusCard(id);
  }
  function addBlock(activity: Activity, kind: ActivityBlock["kind"]) {
    updateBlocks(activity.id!, blocks => [...blocks, newBlock(kind)]);
    focusCard(activity.id!, kind === "resource" ? "select" : "[contenteditable=true]");
  }
  function moveBlock(activity: Activity, from: number, to: number) {
    updateBlocks(activity.id!, current => moveItem(current, from, to));
  }
  async function removeBlock(activity: Activity, block: ActivityBlock) {
    const filled = block.kind === "resource" ? !!block.resourceId : !!block.richContent || !!block.instructions?.trim();
    if (filled && !await confirm({ title: `¿Quitar ${blockKindLabel[block.kind].toLowerCase()}?`, body: <p>Se quita de «{activity.title || "la actividad"}» en el borrador. La versión publicada no cambia hasta que publiques.</p>, confirm: "Quitar bloque", danger: true })) return;
    updateBlocks(activity.id!, blocks => blocks.filter(item => item.id !== block.id));
  }
  /** Up and down move inside a moment; at its edge the activity passes to the previous or next moment. */
  function canMove(index: number, delta: number) {
    const list = draft!.activities, phases = sequenceOf(draft!.sequence).phases.map(phase => phase.id);
    const at = phases.indexOf(phaseOf(list[index], draft!.sequence));
    return list[index + delta]?.phase === list[index].phase || (delta < 0 ? at > 0 : at < phases.length - 1);
  }
  function moveActivity(index: number, delta: number) {
    const template = sequenceOf(draft!.sequence), list = [...draft!.activities], current = list[index];
    if (list[index + delta]?.phase === current.phase) {
      [list[index], list[index + delta]] = [list[index + delta], list[index]];
      setActivities(list);
      toast({ tone: "info", message: `«${current.title}» ahora es la actividad ${index + delta + 1} de ${list.length}.` });
      return;
    }
    const target = template.phases[template.phases.findIndex(phase => phase.id === current.phase) + delta];
    if (!target) return;
    list[index] = { ...current, phase: target.id };
    setActivities(list);
    toast({ tone: "info", message: `«${current.title}» pasó a ${target.label}.` });
  }
  /** Places an activity at a position among those of its own moment. */
  function placeActivity(activity: Activity, to: number) {
    const list = draft!.activities, phase = phaseOf(activity, draft!.sequence);
    const siblings = list.filter(item => phaseOf(item, draft!.sequence) === phase);
    const ordered = moveItem(siblings, siblings.indexOf(activity), to);
    let next = 0;
    const result = list.map(item => phaseOf(item, draft!.sequence) === phase ? ordered[next++] : item);
    setActivities(result);
    toast({ tone: "info", message: `«${activity.title}» ahora es la actividad ${result.indexOf(activity) + 1} de ${result.length}.` });
  }
  function moveToPhase(activity: Activity, phase: Phase) {
    setActivities([...draft!.activities.filter(item => item.id !== activity.id), { ...activity, phase: phase.id }]);
    toast({ tone: "info", message: `«${activity.title}» pasó al final de ${phase.label}.` });
    focusCard(activity.id!, "input");
  }
  async function removeActivity(activity: Activity) {
    if (!await confirm({ title: `¿Eliminar «${activity.title || "actividad sin título"}»?`, body: <p>La actividad se quita del borrador. La versión publicada no cambia hasta que publiques.</p>, confirm: "Eliminar actividad", danger: true })) return;
    const index = draft!.activities.indexOf(activity);
    const list = draft!.activities.filter(item => item.id !== activity.id);
    updateActivities(current => current.filter(item => item.id !== activity.id));
    setSelected(list[Math.max(0, index - 1)]?.id || "details");
  }
  function changeTemplate(sequence: SequenceTemplate) {
    update({ sequence, activities: changeSequence(draft!.activities, draft!.sequence, sequence) });
    if (draft!.activities.length) toast({ tone: "info", message: `Las actividades se ordenaron en los momentos de «${sequenceOf(sequence).label}». Revisa que cada una esté donde corresponde.` });
  }
  /** The same checks guard publishing and sending to review: the lead receives lessons ready to publish. */
  async function ready(verb: "publicar" | "enviar") {
    if (problem) { toast({ tone: "error", message: problem.message }); setSelected(problem.target === "title" ? "details" : problem.target); return false; }
    if (!draft!.activities.length) { toast({ tone: "error", message: `Agrega al menos una actividad antes de ${verb}.` }); return false; }
    // What the course's configuration requires blocks publishing; the rest are recommendations.
    const items = publishChecklist(draftLesson(), curriculum), required = requiredChecks(settings);
    const missing = items.find(item => !item.ok && required.has(item.id));
    if (missing) { toast({ tone: "error", message: `Este curso exige: ${missing.label.toLowerCase()}. ${missing.hint}` }); goTo("details"); return false; }
    const open = items.filter(item => !item.ok);
    if (open.length && !await confirm({ title: verb === "publicar" ? "¿Publicar con recomendaciones pendientes?" : "¿Enviar con recomendaciones pendientes?", body: <><p>Antes de {verb === "publicar" ? "publicar" : "enviar a revisión"}, revisa:</p><ul className="check-list">{open.map(item => <li key={item.id}><Icon name="info" size={16}/><span><strong>{item.label}.</strong> {item.hint}</span></li>)}</ul></>, confirm: verb === "publicar" ? "Publicar de todos modos" : "Continuar", cancel: "Revisar" })) { goTo("details"); return false; }
    return true;
  }
  async function refresh() {
    const { lesson: fresh } = await api<{ lesson: Lesson }>(`/lessons/${lessonId}?draft=1`);
    setLesson(fresh); version.current = fresh.draftVersion;
    return fresh;
  }
  async function publish() {
    if (!await ready("publicar")) return;
    setPublishing(true);
    try {
      if (!await flush()) throw new Error("No pudimos guardar los últimos cambios.");
      const approving = lesson?.review?.status === "pending";
      // Publishes exactly the version on screen: if someone saved a change since, the server asks to review it first.
      await api(`/lessons/${lessonId}/publish?draftVersion=${version.current}`, "POST");
      const fresh = await refresh();
      void reload();
      toast({ message: approving ? "Revisión aprobada y lección publicada. Los estudiantes ya ven esta versión." : "Lección publicada. Los estudiantes ya ven esta versión.", action: fresh.shareCode ? { label: "Copiar enlace", onSelect: () => void copyLink(fresh.shareCode!) } : undefined });
    } catch (error) { toast({ tone: "error", message: `${message(error)} Revisa las actividades y vuelve a intentar.` }); }
    finally { setPublishing(false); }
  }
  async function sendToReview() {
    if (!await ready("enviar")) return;
    if (!await flush()) { toast({ tone: "error", message: "No pudimos guardar los últimos cambios. Vuelve a intentar." }); return; }
    setReviewing("send");
  }
  async function decide(kind: "send" | "return", note: string) {
    await api(kind === "send" ? `/lessons/${lessonId}/review` : `/lessons/${lessonId}/review/return`, "POST", { note });
    await refresh(); void reload(); setReviewing(null);
    toast({ message: kind === "send" ? "Lección enviada a revisión. La persona responsable del curso la publicará." : "Lección devuelta con tus comentarios." });
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

  function draftLesson(): Lesson { return { ...lesson!, title: draft!.title, objective: draft!.objective, duration: draft!.duration, sequence: draft!.sequence, outcomeIds: draft!.outcomeIds, activities: draft!.activities, courseUnitId: draft!.unitId }; }
  function toggleOutcome(id: string) {
    const outcomeIds = draft!.outcomeIds.includes(id) ? draft!.outcomeIds.filter(item => item !== id) : [...draft!.outcomeIds, id];
    // Activities can only name outcomes of their lesson.
    update({ outcomeIds });
    if (!outcomeIds.includes(id)) updateActivities(list => list.map(activity => activity.outcomeIds?.includes(id) ? { ...activity, outcomeIds: activity.outcomeIds.filter(item => item !== id) } : activity));
  }

  if (loadError) return loadError.status === 404
    ? <EmptyState icon="content" title="No encontramos esta lección" action={<Link className="button primary" href={`${base}/contenido`}>Volver al contenido</Link>}>Puede que se haya movido a otro curso.</EmptyState>
    : <ErrorState title="No pudimos abrir la lección" error={loadError.message} retry={() => void open()}/>;
  if (!lesson || !draft) return <Loading label="Abriendo lección…" lines={8}/>;

  const unit = units.find(item => item.id === draft.unitId);
  const linked = resourceIdsOf(draft.activities);
  const codes = outcomeCodes(curriculum.outcomes);
  // Outcomes a lesson can choose: the active ones, plus archived ones it already names.
  const choosable = curriculum.outcomes.filter(o => codes.has(o.id) || draft.outcomeIds.includes(o.id)).sort((a, b) => a.position - b.position);
  const plannedHere = new Set(curriculum.unitOutcomes.filter(link => link.unitId === draft.unitId).map(link => link.outcomeId));
  const checklist = publishChecklist(draftLesson(), curriculum);
  const suggested = suggestedResources(draftLesson(), lessons, resourceIdsOf);
  const available = [...materials.filter(item => item.status !== "archived" || linked.includes(item.id)), ...legacyResources.filter(item => usage(item.id, lessons).length || linked.includes(item.id))];
  const unsaved = changes.current > 0 && save.state !== "saved";
  const serverState = lessonState(lesson);
  const state = draft.archived ? "archived" : serverState === "published" && unsaved ? "changes" : serverState;
  const template = sequenceOf(draft.sequence), structured = template.value !== "free";
  const minutes = draft.activities.reduce((sum, activity) => sum + (activity.minutes || 0), 0);
  // Students never see teacher notes, in the preview either.
  const previewLesson: Lesson = { ...draftLesson(), program: unit?.name || lesson.program, activities: studentActivities(draft.activities),
    outcomes: draft.outcomeIds.filter(id => codes.has(id)).map(id => ({ id, code: codes.get(id)!, statement: curriculum.outcomes.find(o => o.id === id)!.statement })).sort((a, b) => a.code.localeCompare(b.code, "es", { numeric: true })) };
  if (preview) return <div className="editor-preview">
    <LessonPlayer lesson={previewLesson} preview resources={available} fileUrl={id => `/api/courses/${course.id}/files/${id}/content`} onExit={() => navigate(`${base}/lecciones/${lessonId}`, true)}/>
  </div>;

  const review = lesson.review, pendingReview = review?.status === "pending";
  // The lead publishes; the rest of the team sends the lesson to review. Archiving and restoring are the lead's.
  const primary = !writable ? undefined
    : state === "archived" ? publisher ? <PrimaryAction icon="archive" onClick={() => void archive(false)}>Restaurar lección</PrimaryAction> : undefined
    : publisher && pendingReview ? <PrimaryAction icon="check" busy={publishing} disabled={publishing} onClick={() => void publish()}>{publishing ? "Publicando…" : "Aprobar y publicar"}</PrimaryAction>
    : state === "published" && lesson.shareCode ? <PrimaryAction icon="copy" onClick={() => void copyLink(lesson.shareCode!)}>Copiar enlace</PrimaryAction>
    : publisher ? <PrimaryAction icon="check" busy={publishing} disabled={publishing} onClick={() => void publish()}>{publishing ? "Publicando…" : pendingReview ? "Aprobar y publicar" : state === "changes" ? "Publicar cambios" : "Publicar"}</PrimaryAction>
    : pendingReview ? undefined
    : <PrimaryAction icon="send" onClick={() => void sendToReview()}>{review?.status === "returned" ? "Volver a enviar a revisión" : "Enviar a revisión"}</PrimaryAction>;
  const goTo = (id: string, focus = true) => {
    setSelected(id);
    const card = document.getElementById(id === "details" ? "lesson-details" : `card-${id}`);
    card?.scrollIntoView({ behavior: scrollBehavior(), block: "start" });
    if (focus) setTimeout(() => card?.querySelector<HTMLElement>("input, textarea, [contenteditable=true]")?.focus({ preventScroll: true }), 250);
  };
  const reviewProblem = () => problem && goTo(problem.target === "title" ? "details" : problem.target);
  const phases = template.phases.map((phase, order) => ({ phase, order, activities: draft.activities.filter(activity => phaseOf(activity, draft.sequence) === phase.id) }));
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
            ...(publisher && pendingReview ? [{ label: "Devolver con comentarios", icon: "undo" as const, onSelect: () => setReviewing("return") }] : []),
            ...(writable && !publisher && pendingReview ? [{ label: "Actualizar el envío", icon: "send" as const, onSelect: () => void sendToReview() }] : []),
            ...(publisher && !draft.archived ? ["separator" as const, { label: "Archivar lección", icon: "archive" as const, danger: true, onSelect: () => void archive(true) }] : []),
          ]}/>
          </div>
        </div>
      </div>
      {writable && state === "changes" && !review && <p className="draft-note"><Icon name="info" size={16}/>Tus cambios se guardan como borrador. Los estudiantes siguen viendo la versión publicada hasta que {publisher ? <>elijas <strong>Publicar cambios</strong></> : "la persona responsable del curso los publique"}.</p>}
      {review && !draft.archived && <ReviewBanner review={review} publisher={publisher} writable={writable} onReturn={() => setReviewing("return")}/>}
      {editors.length > 0 && <p className="presence"><Icon name="users" size={16}/>También editando: {[...new Set(editors)].map(name => name === member.username ? `${name} (otra sesión)` : name).join(", ")}</p>}
      {!writable && <p className="notice"><Icon name="info" size={18}/>{course.status === "archived" ? "El curso está archivado: la lección se muestra en modo lectura." : "Estás viendo el borrador más reciente. Solo el equipo docente del curso edita sus lecciones."}</p>}
      {reviewing && <ReviewDialog kind={reviewing} onClose={() => setReviewing(null)} onSubmit={note => decide(reviewing, note)}/>}
    </header>
    <div className="editor-layout">
      <nav className="activity-outline" aria-label="Estructura de la lección">
        <button type="button" className="outline-item tone-violet" aria-current={selected === "details" ? "true" : undefined} onClick={() => goTo("details")}><span className="outline-number type-chip" aria-hidden="true"><Icon name="info" size={16}/></span><span><strong>Detalles</strong><small>Objetivo, secuencia y duración</small></span></button>
        {phases.map(({ phase, order, activities }) => <div key={phase.id} className={`outline-phase tone-${phaseHue(order)}`}>
          <h2 className="outline-heading">{structured ? phase.label : "Actividades"} <span className="muted">({activities.length})</span></h2>
          {activities.length ? <ol className="activity-list">{activities.map(activity => { const index = draft.activities.indexOf(activity), first = activity.blocks![0]; return <li key={activity.id} className={selected === activity.id ? "is-selected" : undefined}>
            <button type="button" className="outline-item" aria-current={selected === activity.id ? "true" : undefined} onClick={() => goTo(activity.id!)}>
              <span className="outline-number type-chip" aria-hidden="true">{index + 1}</span>
              <span><strong>{activity.title || "Sin título"}</strong><small><Icon name={kindIcon[first?.kind || "text"]} size={12}/>{purposes.find(item => item.value === activity.purpose)?.label || blockKindLabel[first?.kind || "text"]} · {activity.minutes} min</small></span>
            </button>
            {writable && <SortHandle id={`activity-${activity.id}`} className="reorder" label={`Reordenar actividad ${index + 1}: ${activity.title}`} index={activities.indexOf(activity)} count={activities.length}
              onMove={to => placeActivity(activity, to)} onStep={delta => { if (!canMove(index, delta)) return false; moveActivity(index, delta); return true; }}/>}
          </li>; })}</ol> : <p className="muted small outline-empty">{structured ? "Sin actividades." : "Aún no hay actividades."}</p>}
        </div>)}
      </nav>
      <div className="lesson-canvas">
        {writable && <div className="canvas-toolbar"><Suspense fallback={null}><RichToolbar editor={activeEditor}/></Suspense></div>}
        <section id="lesson-details" className="canvas-card details-card tone-violet" aria-labelledby="details-title" onFocusCapture={() => setSelected("details")}>
          <div className="card-head"><span className="type-chip" aria-hidden="true"><Icon name="info" size={16}/></span><h2 id="details-title">Detalles de la lección</h2></div>
          <fieldset className="stack" disabled={!writable}>
            <Field label="Objetivo" hint="Qué podrán hacer los estudiantes al terminar. Lo ven al abrir la lección."><textarea rows={2} maxLength={1000} value={draft.objective} onChange={event => update({ objective: event.target.value })}/></Field>
            <Field label="Secuencia didáctica" hint={structured ? `${template.description} Momentos: ${template.phases.map(phase => phase.label).join(" → ")}.` : template.description}>
              <select value={draft.sequence} onChange={event => changeTemplate(event.target.value as SequenceTemplate)}>{sequenceTemplates.map(item => <option key={item.value} value={item.value}>{item.label}</option>)}</select>
            </Field>
            <div className="field-row">
              <Field label={noun.One}><select value={draft.unitId} onChange={event => update({ unitId: event.target.value })}>{units.filter(item => item.status === "active" || item.id === draft.unitId).map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></Field>
              <Field label="Duración (minutos)" hint={draft.activities.length ? `Las actividades suman ${minutes} min.` : undefined}><input type="number" min={1} max={300} value={draft.duration} onChange={event => update({ duration: Math.max(1, Math.min(300, Number(event.target.value) || 1)) })}/></Field>
            </div>
            <fieldset className="outcome-picker">
              <legend>Resultados de aprendizaje</legend>
              {choosable.length ? <>
                <p className="muted small">Qué resultados del curso desarrolla esta lección. Los estudiantes los ven al empezar.</p>
                <ul>{choosable.map(outcome => <li key={outcome.id}><label className={draft.outcomeIds.includes(outcome.id) ? "is-selected" : undefined}>
                  <input type="checkbox" checked={draft.outcomeIds.includes(outcome.id)} onChange={() => toggleOutcome(outcome.id)}/>
                  <span className="outcome-code" aria-hidden="true">{codes.get(outcome.id) || "—"}</span>
                  <span><span className="sr-only">{codes.get(outcome.id) || "Archivado"}: </span>{outcome.statement}{plannedHere.has(outcome.id) && <small className="planned-tag">{`Planificado en ${noun.this}`}</small>}{!codes.has(outcome.id) && <small className="planned-tag">Archivado</small>}</span>
                </label></li>)}</ul>
              </> : <p className="muted small">El curso aún no tiene resultados de aprendizaje. <Link href={`${base}/plan`}>Defínelos en el plan curricular</Link> para alinear esta lección.</p>}
            </fieldset>
          </fieldset>
          {writable && <Checklist items={checklist} required={requiredChecks(settings)} planHref={`${base}/plan`} settingsHref={`${base}/configuracion`}/>}
          <div className="publish-info">
            {lesson.revision && lesson.shareCode ? <>
              <p><strong>Publicación {lesson.revision}.</strong> {state === "changes" ? "Tienes cambios en borrador que los estudiantes aún no ven." : "Los estudiantes ven esta versión."}</p>
              <p className="share-row"><span>Código <strong>{lesson.shareCode}</strong></span><a href={`/aprender/${lesson.shareCode}`} target="_blank" rel="noopener noreferrer">Abrir como estudiante</a><button type="button" className="button ghost small" onClick={() => void copyLink(lesson.shareCode!)}><Icon name="copy" size={16}/>Copiar enlace</button></p>
              <p className="muted small">Terminada {plural(lesson.completions || 0, "vez", "veces")}. Solo se cuenta el total, sin nombres ni respuestas.</p>
            </> : <p className="muted">Es un borrador: todo se guarda solo y nadie lo ve hasta que publiques.</p>}
          </div>
        </section>
        {phases.map(({ phase, order, activities }) => <section key={phase.id} className={`phase-section tone-${phaseHue(order)}${structured ? "" : " is-free"}`} aria-labelledby={`phase-${phase.id}`}>
          <header className={structured ? "phase-head" : "sr-only"}>
            {structured && <span className="phase-index" aria-hidden="true">{order + 1}</span>}
            <div><h2 id={`phase-${phase.id}`}>{phase.label}</h2>{phase.hint && <p>{phase.hint}</p>}</div>
            {structured && <span className="phase-meta">{plural(activities.length, "actividad", "actividades")} · {activities.reduce((sum, activity) => sum + activity.minutes, 0)} min</span>}
          </header>
          {activities.map(activity => { const index = draft.activities.indexOf(activity); return <ActivityCard key={activity.id} activity={activity} index={index} total={draft.activities.length} phase={structured ? phase : undefined} phases={structured ? template.phases : []} writable={writable} resources={available} suggested={suggested} courseId={course.id}
            outcomes={draft.outcomeIds.flatMap(id => { const outcome = curriculum.outcomes.find(o => o.id === id); return outcome ? [{ outcome, code: codes.get(id) || "—" }] : []; })}
            collaboration={collaboration} username={member.username} onFocus={() => setSelected(activity.id!)} onEditorFocus={setActiveEditor}
            canMove={delta => canMove(index, delta)} onMove={delta => moveActivity(index, delta)} onMoveTo={target => moveToPhase(activity, target)}
            onChange={patch => updateActivity(activity.id!, patch)} onBlock={(blockId, patch) => updateBlock(activity, blockId, patch)}
            onRemote={(blockId, doc) => setDraft(value => value && { ...value, activities: value.activities.map(item => item.id === activity.id ? { ...item, blocks: item.blocks!.map(block => block.id === blockId ? { ...block, richContent: doc } : block) } : item) })}
            onAddBlock={kind => addBlock(activity, kind)} onMoveBlock={(blockIndex, to) => moveBlock(activity, blockIndex, to)} onRemoveBlock={block => void removeBlock(activity, block)} onRemove={() => void removeActivity(activity)}/>; })}
          {writable ? <AddActivity label={structured ? `Agregar actividad a ${phase.label}` : "Agregar actividad"} empty={!activities.length} onAdd={kind => addActivity(kind, phase.id)}/>
            : !activities.length && <p className="muted small">Sin actividades en este momento.</p>}
        </section>)}
        {!draft.activities.length && !structured && <EmptyState icon="content" title="Agrega la primera actividad">Empieza con un texto para explicar, un recurso de la biblioteca o una pregunta para comprobar lo aprendido.</EmptyState>}
      </div>
    </div>
  </div>;
}

/** Each moment ends with a way to add an activity there, starting from the kind of block it needs first. */
function AddActivity({ label, empty, onAdd }: { label: string; empty: boolean; onAdd: (kind: ActivityBlock["kind"]) => void }) {
  return <div className={`insert-bar${empty ? " is-empty" : ""}`} role="group" aria-label={label}>
    <span className="insert-label"><Icon name="plus" size={16}/>{empty ? "Empieza con" : "Agregar"}</span>
    {(["text", "resource", "question"] as const).map(kind => <button key={kind} type="button" className={`insert-option tone-${blockHue[kind]}`} onClick={() => onAdd(kind)}>
      <Icon name={kindIcon[kind]} size={16}/><span>{kind === "text" ? "Contenido" : blockKindLabel[kind]}</span>
    </button>)}
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

type CardProps = {
  activity: Activity; index: number; total: number; phase?: Phase; phases: Phase[]; writable: boolean; resources: (Material | Resource)[]; suggested: string[]; courseId: string;
  outcomes: { outcome: LearningOutcome; code: string }[];
  collaboration: CollaborationProvider | null; username: string; onFocus: () => void; onEditorFocus: (editor: Editor) => void;
  canMove: (delta: number) => boolean; onMove: (delta: number) => void; onMoveTo: (phase: Phase) => void;
  onChange: (patch: Partial<Activity>) => void; onBlock: (blockId: string, patch: Partial<ActivityBlock>) => void; onRemote: (blockId: string, doc: RichTextDocument) => void;
  onAddBlock: (kind: ActivityBlock["kind"]) => void; onMoveBlock: (from: number, to: number) => void; onRemoveBlock: (block: ActivityBlock) => void; onRemove: () => void;
};

/**
 * An activity is one thing the class does: what for (purpose), how (grouping), how long, and its ordered blocks:
 * text, a library resource, a question or a note only the teacher sees.
 */
function ActivityCard({ activity, index, total, phase, phases, writable, resources, suggested, outcomes, courseId, collaboration, username, onFocus, onEditorFocus, canMove, onMove, onMoveTo, onChange, onBlock, onRemote, onAddBlock, onMoveBlock, onRemoveBlock, onRemove }: CardProps) {
  const number = index + 1, blocks = activity.blocks || [];
  const learnerBlocks = blocks.filter(block => block.kind !== "teacher-note").length;
  return <section id={`card-${activity.id}`} className="canvas-card activity-card" aria-label={`Actividad ${number}: ${activity.title || "sin título"}`} onFocusCapture={onFocus}>
    <div className="card-head">
      <span className="type-chip" aria-hidden="true">{number}</span>
      <span className="card-kind">{phase ? `${phase.label} · ` : ""}Actividad {number} de {total}</span>
      <label className="sr-only" htmlFor={`title-${activity.id}`}>Título de la actividad {number}</label>
      <input id={`title-${activity.id}`} className="card-title" value={activity.title} maxLength={160} readOnly={!writable} placeholder="Título de la actividad" onChange={event => onChange({ title: event.target.value })}/>
      <label className="card-minutes"><input type="number" min={1} max={120} value={activity.minutes} readOnly={!writable} aria-label={`Minutos de la actividad ${number}`} onChange={event => onChange({ minutes: Math.max(1, Math.min(120, Number(event.target.value) || 1)) })}/><span aria-hidden="true">min</span></label>
      {writable && <Menu label={`Acciones de la actividad ${number}`} items={[
        { label: "Mover arriba", icon: "chevronUp", disabled: !canMove(-1), onSelect: () => onMove(-1) },
        { label: "Mover abajo", icon: "chevronDown", disabled: !canMove(1), onSelect: () => onMove(1) },
        ...(phases.length ? ["separator" as const, ...phases.filter(item => item.id !== phase?.id).map(item => ({ label: `Mover a ${item.label}`, icon: "arrowRight" as const, onSelect: () => onMoveTo(item) }))] : []),
        "separator",
        { label: "Eliminar actividad", icon: "close", danger: true, onSelect: onRemove },
      ]}/>}
    </div>
    <div className="activity-meta">
      <label className="meta-select"><span>Propósito</span><select value={activity.purpose || ""} disabled={!writable} aria-label={`Propósito de la actividad ${number}`} onChange={event => onChange({ purpose: (event.target.value || undefined) as Activity["purpose"] })}><option value="">Sin indicar</option>{purposes.map(item => <option key={item.value} value={item.value}>{item.label}</option>)}</select></label>
      <label className="meta-select"><span>Organización</span><select value={activity.grouping || ""} disabled={!writable} aria-label={`Organización de la actividad ${number}`} onChange={event => onChange({ grouping: (event.target.value || undefined) as Activity["grouping"] })}><option value="">Sin indicar</option>{groupings.map(item => <option key={item.value} value={item.value}>{item.label}</option>)}</select></label>
      {outcomes.length > 0 && <div className="meta-outcomes" role="group" aria-label={`Resultados que trabaja la actividad ${number}`}>
        <span>Trabaja</span>
        {outcomes.map(({ outcome, code }) => { const on = !!activity.outcomeIds?.includes(outcome.id); return <button key={outcome.id} type="button" className="outcome-chip" aria-pressed={on} disabled={!writable} title={outcome.statement}
          aria-label={`${code}: ${outcome.statement}`} onClick={() => onChange({ outcomeIds: on ? activity.outcomeIds!.filter(id => id !== outcome.id) : [...activity.outcomeIds || [], outcome.id] })}>{on && <Icon name="check" size={12}/>}{code}</button>; })}
        {!activity.outcomeIds?.length && <span className="muted small">Todos los de la lección</span>}
      </div>}
    </div>
    <ol className="block-list">{blocks.map((block, blockIndex) => <li key={block.id}>
      <BlockEditor block={block} number={number} position={blockIndex} count={blocks.length} removable={blocks.length > 1 && (block.kind === "teacher-note" || learnerBlocks > 1)} writable={writable} resources={resources} suggested={suggested} courseId={courseId}
        collaboration={collaboration} username={username} onEditorFocus={onEditorFocus} onChange={patch => onBlock(block.id, patch)} onRemote={doc => onRemote(block.id, doc)}
        onMove={to => onMoveBlock(blockIndex, to)} onRemove={() => onRemoveBlock(block)}/>
    </li>)}</ol>
    {writable && blocks.length < 12 && <div className="add-block" role="group" aria-label={`Agregar a la actividad ${number}`}>
      <span className="insert-label">Agregar bloque</span>
      {blockKinds.map(kind => <button key={kind.value} type="button" className={`insert-option tone-${blockHue[kind.value]}`} onClick={() => onAddBlock(kind.value)}><Icon name={kindIcon[kind.value]} size={16}/><span>{kind.label}</span></button>)}
    </div>}
  </section>;
}

const blockPlaceholder: Record<ActivityBlock["kind"], string> = {
  text: "Escribe las instrucciones o el contenido…", resource: "Indica qué hacer con el recurso (opcional)…",
  question: "Escribe la pregunta…", "teacher-note": "Indicaciones para quien da la clase: materiales, tiempos, errores frecuentes…",
};

function BlockEditor({ block, number, position, count, removable, writable, resources, suggested, courseId, collaboration, username, onEditorFocus, onChange, onRemote, onMove, onRemove }: {
  block: ActivityBlock; number: number; position: number; count: number; removable: boolean; writable: boolean; resources: (Material | Resource)[]; suggested: string[]; courseId: string;
  collaboration: CollaborationProvider | null; username: string; onEditorFocus: (editor: Editor) => void;
  onChange: (patch: Partial<ActivityBlock>) => void; onRemote: (doc: RichTextDocument) => void; onMove: (to: number) => void; onRemove: () => void;
}) {
  const [showFile, setShowFile] = useState(false);
  const options = block.options || [];
  const resource = resources.find(item => item.id === block.resourceId);
  const suffix = position > 0 ? ` (bloque ${position + 1})` : "";
  const label = { text: `Contenido de la actividad ${number}`, resource: `Indicación del recurso de la actividad ${number}`, question: `Pregunta de la actividad ${number}`, "teacher-note": `Nota para el docente de la actividad ${number}` }[block.kind] + suffix;
  return <div className={`block block-${block.kind} tone-${blockHue[block.kind]}`}>
    <div className="block-head">
      {writable && count > 1 && <SortHandle id={`block-${block.id}`} label={`Reordenar ${blockKindLabel[block.kind].toLowerCase()} de la actividad ${number}${suffix}`} index={position} count={count} onMove={onMove}/>}
      <Icon name={kindIcon[block.kind]} size={16}/><span className="block-kind">{blockKindLabel[block.kind]}</span>
      {block.kind === "teacher-note" && <span className="block-private"><Icon name="eye" size={14}/>Solo docentes: los estudiantes no la ven</span>}
      {writable && count > 1 && <span className="block-actions">
        <button type="button" className="icon-button small" aria-label={`Quitar ${blockKindLabel[block.kind].toLowerCase()} de la actividad ${number}${suffix}`} disabled={!removable} onClick={onRemove}><Icon name="close" size={16}/></button>
      </span>}
    </div>
    {block.kind === "resource" && <div className="card-resource">
      {resources.length ? <Field label={`Recurso de la actividad ${number}${suffix}`} hint={<>El estudiante lo ve dentro de esta actividad. <Link href={`/cursos/${courseId}/biblioteca`}>Abrir la biblioteca del curso</Link></>}>
        <select value={block.resourceId || ""} disabled={!writable} onChange={event => { setShowFile(false); onChange({ resourceId: event.target.value }); }}><option value="">Elige un recurso</option>{(() => {
          const option = (item: Material | Resource) => <option key={item.id} value={item.id}>{item.title}{item.status === "archived" ? " (archivado)" : item.status === "draft" ? " (borrador)" : ""}</option>;
          const top = suggested.flatMap(id => resources.filter(item => item.id === id && item.status !== "archived"));
          // Suggestions: resources other lessons use for the same outcomes.
          return top.length ? <><optgroup label="Sugeridos por los resultados de la lección">{top.map(option)}</optgroup><optgroup label="Biblioteca del curso">{resources.filter(item => !top.includes(item)).map(option)}</optgroup></> : resources.map(option);
        })()}</select>
      </Field> : <p className="notice"><Icon name="library" size={18}/>La biblioteca del curso está vacía. <Link href={`/cursos/${courseId}/biblioteca`}>Agrega un recurso</Link> y vuelve a esta actividad.</p>}
      {resource && (resource.kind === "file" && "fileId" in resource && resource.fileId
        ? showFile ? <FileViewer url={`/api/courses/${courseId}/files/${resource.fileId}/content`} name={resource.fileName || resource.title}/> : <button type="button" className="resource-peek" onClick={() => setShowFile(true)}><Icon name="eye" size={18}/><span><strong>{resource.fileName || resource.title}</strong><small>Ver el archivo aquí</small></span></button>
        : resource.kind === "link" ? <a className="resource-peek" href={resource.content} target="_blank" rel="noopener noreferrer"><Icon name="link" size={18}/><span><strong>{resource.title}</strong><small>{resource.content}</small></span></a>
        : <div className="resource-peek is-text"><Icon name="text" size={18}/><span><strong>{resource.title}</strong><small className="preserve-lines">{resource.content}</small></span></div>)}
    </div>}
    <Suspense fallback={<p role="status">Cargando editor…</p>}>
      <RichText key={block.id} value={block.richContent} fallbackText={block.instructions} label={label} editable={writable} toolbar={false} onEditorFocus={onEditorFocus} placeholder={blockPlaceholder[block.kind]}
        collaboration={collaboration ? { document: collaboration.doc, field: block.id, provider: collaboration } : undefined} username={username}
        onChange={richContent => onChange({ richContent, instructions: "" })} onRemoteChange={onRemote}/>
    </Suspense>
    {block.kind === "question" && <fieldset className="options" disabled={!writable}><legend>Opciones de respuesta</legend>
      <p className="muted small">Marca la respuesta correcta. Entre 2 y 6 opciones.</p>
      <ol>{options.map((option, choice) => <li key={choice}>
        <label className="correct"><input type="radio" name={`correct-${block.id}`} checked={block.answer === choice} onChange={() => onChange({ answer: choice })}/><span className="sr-only">Respuesta correcta: opción {choice + 1}</span></label>
        <label htmlFor={`option-${block.id}-${choice}`} className="sr-only">Opción {choice + 1}</label>
        <input id={`option-${block.id}-${choice}`} value={option} maxLength={200} placeholder={`Opción ${choice + 1}`} onChange={event => onChange({ options: options.map((item, i) => i === choice ? event.target.value : item) })}/>
        <button type="button" className="icon-button small" aria-label={`Quitar opción ${choice + 1}`} disabled={options.length <= 2} onClick={() => onChange({ options: options.filter((_, i) => i !== choice), answer: block.answer === choice ? 0 : (block.answer || 0) > choice ? (block.answer || 0) - 1 : block.answer })}><Icon name="close" size={16}/></button>
      </li>)}</ol>
      {options.length < 6 && <button type="button" className="button ghost small" onClick={() => onChange({ options: [...options, ""] })}><Icon name="plus" size={16}/>Agregar opción</button>}
    </fieldset>}
  </div>;
}

/** Recommendations before publishing; each open item says what to do. */
/** Checks the course's configuration turns into requirements. */
const requiredChecks = (settings: { outcomesRequired: boolean; assessmentRequired: boolean }) => new Set<CheckItem["id"]>([...(settings.outcomesRequired ? ["outcomes" as const] : []), ...(settings.assessmentRequired ? ["assessment" as const] : [])]);

function Checklist({ items, required, planHref, settingsHref }: { items: CheckItem[]; required: Set<CheckItem["id"]>; planHref: string; settingsHref: string }) {
  const done = items.filter(item => item.ok).length;
  return <section className="checklist" aria-labelledby="checklist-title">
    <h3 id="checklist-title">Antes de publicar <span className="muted">· {done} de {items.length}</span></h3>
    <ul>{items.map(item => <li key={item.id} className={item.ok ? "is-ok" : "is-open"}>
      <Icon name={item.ok ? "check" : "info"} size={16}/>
      <span><strong>{item.label}</strong>{required.has(item.id) && <Link className="required-tag" href={settingsHref} title="Lo exige la configuración del curso">Obligatorio</Link>}<span className="muted small"> · {item.hint}</span>{!item.ok && item.id === "outcomes" && item.hint.includes("plan curricular") && <> <Link href={planHref}>Abrir el plan</Link></>}</span>
      <span className="sr-only">{item.ok ? "Listo" : "Pendiente"}</span>
    </li>)}</ul>
  </section>;
}

/** Where the lesson's review stands: waiting for the lead, or returned with what to change. */
function ReviewBanner({ review, publisher, writable, onReturn }: { review: NonNullable<Lesson["review"]>; publisher: boolean; writable: boolean; onReturn: () => void }) {
  if (review.status === "returned") return <div className="review-banner is-returned" role="status">
    <Icon name="undo" size={18}/><div><strong>{review.decidedByName || "La persona responsable"} devolvió la lección {timeAgo(review.decidedAt || review.requestedAt)}.</strong>
      {review.decisionNote && <p>«{review.decisionNote}»</p>}
      {writable && !publisher && <p className="muted small">Haz los ajustes y vuelve a enviarla a revisión.</p>}</div>
  </div>;
  return <div className="review-banner" role="status">
    <Icon name="send" size={18}/><div><strong>{review.requestedByName} la envió a revisión {timeAgo(review.requestedAt)}.</strong>
      {review.note && <p>«{review.note}»</p>}
      <p className="muted small">{publisher ? "Revisa el borrador y elige Aprobar y publicar, o devuélvela con tus comentarios." : "La persona responsable del curso la publicará. Si sigues editando, tus cambios se incluyen en la revisión."}</p></div>
    {publisher && <Button icon="undo" onClick={onReturn}>Devolver</Button>}
  </div>;
}

function ReviewDialog({ kind, onClose, onSubmit }: { kind: "send" | "return"; onClose: () => void; onSubmit: (note: string) => Promise<void> }) {
  const [note, setNote] = useState(""), [busy, setBusy] = useState(false), [error, setError] = useState("");
  const send = kind === "send";
  async function submit(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError("");
    try { await onSubmit(note.trim()); } catch (cause) { setError(message(cause)); setBusy(false); }
  }
  return <Modal title={send ? "Enviar a revisión" : "Devolver con comentarios"} onClose={onClose}>
    <form className="stack" onSubmit={submit}>
      {error && <p className="form-alert" role="alert"><Icon name="alert" size={18}/>{error}</p>}
      <fieldset disabled={busy} className="stack">
        <p className="muted">{send ? "La persona responsable del curso revisa el borrador y lo publica, o te lo devuelve con comentarios." : "La lección vuelve a quien la envió, con tus comentarios. La versión publicada no cambia."}</p>
        <Field label={send ? "Nota para la persona responsable" : "Qué debe cambiar"} optional={send}><textarea rows={3} maxLength={600} value={note} required={!send} autoFocus onChange={event => setNote(event.target.value)} placeholder={send ? "Ej. Agregué la actividad de cierre y la rúbrica." : "Ej. Falta una pregunta que evalúe el resultado 2."}/></Field>
        <div className="modal-actions"><button type="button" className="button ghost" onClick={onClose}>Cancelar</button><button className="button primary">{busy ? "Enviando…" : send ? "Enviar a revisión" : "Devolver"}</button></div>
      </fieldset>
    </form>
  </Modal>;
}
