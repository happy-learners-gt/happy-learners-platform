import { lazy, Suspense, useEffect, useRef, useState } from "react";
import type { ActivityBlock, Lesson, LessonNavigation, Material, Resource, StudentActivityGroups } from "@happy-learners/contracts";
import { blocksOf, groupings, phaseOf, purposes, sequenceOf } from "@happy-learners/domain";
import { api, message } from "../api";
import { FileViewer } from "../FileViewer";
import { blockHue, phaseHue, plural } from "../model";
import { Icon } from "../ui/icons";
const RichText = lazy(() => import("../RichText").then(module => ({ default: module.RichText })));

export function StudentLesson({ code }: { code: string }) {
  const [lesson, setLesson] = useState<Lesson | null>(null), [navigation, setNavigation] = useState<LessonNavigation | null>(null), [groups, setGroups] = useState<StudentActivityGroups[]>([]), [error, setError] = useState("");
  const shareCode = code.toUpperCase();
  useEffect(() => { api<{ lesson: Lesson; navigation?: LessonNavigation | null; groups?: StudentActivityGroups[] }>(`/share/${encodeURIComponent(shareCode)}`).then(result => { setLesson(result.lesson); setNavigation(result.navigation || null); setGroups(result.groups || []); }).catch(cause => setError(message(cause))); }, [shareCode]);
  if (error) return <div className="player"><PlayerBar/><main id="main" className="player-main"><div className="player-card player-center"><Icon name="alert" size={28}/><h1>No encontramos esta lección</h1><p>{error === "Lección no disponible." ? "Revisa el código con tu educador. Puede que la lección ya no esté publicada." : error}</p><a className="button primary" href="/">Volver al inicio</a></div></main></div>;
  if (!lesson) return <div className="player"><PlayerBar/><main id="main" className="player-main"><p role="status" className="player-center">Abriendo lección…</p></main></div>;
  return <LessonPlayer key={shareCode} lesson={lesson} navigation={navigation} groups={groups} fileUrl={id => `/api/share/${encodeURIComponent(shareCode)}/files/${id}`} complete={() => api<{ learner?: string | null }>(`/share/${encodeURIComponent(shareCode)}/complete`, "POST").then(result => result.learner || null)}/>;
}

function PlayerBar({ title, step, total }: { title?: string; step?: number; total?: number }) {
  return <header className="player-bar">
    <span className="brand-mark small" aria-hidden="true">hl</span>
    {title ? <span className="player-title">{title}</span> : <span className="player-title">Happy Learners</span>}
    {total !== undefined && step !== undefined && <div className="player-progress"><span>{step > total ? "Terminada" : step === 0 ? "Inicio" : `Actividad ${step} de ${total}`}</span>
      <div className="progress-track" role="progressbar" aria-label="Avance de la lección" aria-valuemin={0} aria-valuemax={total} aria-valuenow={Math.min(step, total)} aria-valuetext={step > total ? "Lección terminada" : `Actividad ${Math.max(step, 0)} de ${total}`}><span style={{ width: `${Math.min(step, total) / Math.max(total, 1) * 100}%` }}/></div></div>}
  </header>;
}

/**
 * One activity at a time: intro (step 0), activities (1…n) and completion (n+1).
 * In preview mode nothing is recorded and resources come from the course library.
 */
export function LessonPlayer({ lesson, fileUrl, complete, preview, resources, onExit, navigation, groups = [] }: { lesson: Lesson; fileUrl: (fileId: string) => string; complete?: () => Promise<string | null>; preview?: boolean; resources?: (Material | Resource)[]; onExit?: () => void; navigation?: LessonNavigation | null; groups?: StudentActivityGroups[] }) {
  const [step, setStep] = useState(0), [answers, setAnswers] = useState<Record<string, number>>({});
  const [busy, setBusy] = useState(false), [error, setError] = useState(""), [done, setDone] = useState(false), [learner, setLearner] = useState<string | null>(null);
  const heading = useRef<HTMLHeadingElement>(null), first = useRef(true);
  const total = lesson.activities.length;
  useEffect(() => { if (first.current) { first.current = false; return; } heading.current?.focus(); window.scrollTo(0, 0); }, [step]);
  const library = resources || lesson.resources || [];
  async function finish() {
    if (preview || !complete) { setDone(true); setStep(total + 1); return; }
    setBusy(true); setError("");
    try { setLearner(await complete()); setDone(true); setStep(total + 1); }
    catch (cause) { setError(`${message(cause)} Tu avance sigue en pantalla; vuelve a intentar.`); }
    finally { setBusy(false); }
  }
  const activity = step >= 1 && step <= total ? lesson.activities[step - 1] : null;
  const template = sequenceOf(lesson.sequence), structured = template.value !== "free";
  // Teacher notes are removed before publishing; filtering again keeps older snapshots and previews safe.
  const blocks = activity ? blocksOf(activity).filter(block => block.kind !== "teacher-note") : [];
  const phaseIndex = activity ? template.phases.findIndex(phase => phase.id === phaseOf(activity, lesson.sequence)) : -1;
  // Documents, presentations and video get the full width of the screen instead of the reading column.
  const wide = blocks.some(block => block.kind === "resource" && library.some(item => item.id === block.resourceId && item.kind === "file"));
  const moments = structured ? template.phases.map(phase => ({ phase, count: lesson.activities.filter(item => phaseOf(item, lesson.sequence) === phase.id).length })).filter(item => item.count) : [];
  const tags = activity ? [purposes.find(item => item.value === activity.purpose)?.label, groupings.find(item => item.value === activity.grouping)?.label].filter(Boolean) : [];
  return <div className={`player${preview ? " is-preview" : ""}`}>
    <PlayerBar title={lesson.title} step={step} total={total}/>
    {preview && <div className="preview-banner" role="note"><Icon name="eye" size={16}/><span>Vista previa del borrador. No se registra nada.</span>{onExit && <button type="button" className="button secondary small" onClick={onExit}>Volver a editar</button>}</div>}
    <main id={preview ? undefined : "main"} className={`player-main${wide ? " is-wide" : ""}`}>
      {step === 0 && <article className="player-card player-intro">
        <span className="eyebrow">{lesson.program}</span>
        <h1 ref={heading} tabIndex={-1}>{lesson.title}</h1>
        <section className="player-objective"><h2>Lo que aprenderás</h2><p>{lesson.objective}</p>
          {!!lesson.outcomes?.length && <><p className="player-outcomes-intro">Al terminar podrás:</p><ul className="player-outcomes">{lesson.outcomes.map(outcome => <li key={outcome.id}><Icon name="check" size={16}/>{outcome.statement}</li>)}</ul></>}
        </section>
        {moments.length > 0 && <section className="player-moments" aria-labelledby="moments-title"><h2 id="moments-title">Así será la lección</h2>
          <ol>{moments.map(({ phase, count }) => <li key={phase.id} className={`tone-${phaseHue(template.phases.indexOf(phase))}`}><strong>{phase.label}</strong><span>{plural(count, "actividad", "actividades")}</span></li>)}</ol>
        </section>}
        <p className="player-meta"><Icon name="clock" size={16}/>{lesson.duration} minutos · {plural(total, "actividad", "actividades")}</p>
        {navigation && <ModuleNavigation navigation={navigation}/>}
      </article>}
      {activity && <article className={`player-card tone-${structured ? phaseHue(phaseIndex) : blockHue[blocks[0]?.kind || "text"]}`} aria-labelledby="activity-title">
        <span className="player-chip">{structured ? `${template.phases[phaseIndex].label} · ` : ""}Actividad {step} de {total} · {activity.minutes} min</span>
        <h1 id="activity-title" ref={heading} tabIndex={-1}>{activity.title}</h1>
        {tags.length > 0 && <p className="player-tags">{tags.map(tag => <span key={tag}>{tag}</span>)}</p>}
        {activity && <ActivityGroups groups={groups.find(item => item.activityId === activity.id)?.groups}/>}
        {blocks.map(block => <PlayerBlock key={block.id} block={block} library={library} fileUrl={fileUrl} answer={answers[block.id]} onAnswer={choice => setAnswers({ ...answers, [block.id]: choice })}/>)}
      </article>}
      {step > total && <article className="player-card player-center">
        <span className="done-icon" aria-hidden="true"><Icon name="check" size={32}/></span>
        <h1 ref={heading} tabIndex={-1}>¡Terminaste la lección!</h1>
        <p role="status">{done && !preview ? learner ? `¡Bien hecho, ${learner}! La lección quedó terminada en tu avance; tus respuestas se quedan en este dispositivo.` : "¡Gracias por participar! Contamos la lección como terminada, sin guardar tu nombre ni tus respuestas." : "En la versión publicada, aquí se cuenta la lección como terminada."}</p>
        {navigation?.next && <a className="button primary" href={`/aprender/${encodeURIComponent(navigation.next.shareCode)}`}>Siguiente lección: {navigation.next.title}<Icon name="arrowRight" size={18}/></a>}
        {learner && <a className="button secondary" href="/estudiante"><Icon name="back" size={18}/>Volver a mi sección</a>}
        <button type="button" className="button secondary" onClick={() => { setAnswers({}); setStep(0); }}>Repasar desde el inicio</button>
        {navigation && !navigation.next && <p className="muted">Es la última lección publicada de {navigation.moduleName}.</p>}
      </article>}
      {error && <p className="form-alert player-error" role="alert"><Icon name="alert" size={18}/>{error}</p>}
      {step <= total && <p className="player-privacy"><Icon name="shield" size={14}/>Sin cuenta ni datos personales. Tus respuestas se quedan en este dispositivo.</p>}
    </main>
    {step <= total && <nav className="player-nav" aria-label="Avance de la lección">
      <button type="button" className="button secondary" disabled={step === 0} onClick={() => setStep(step - 1)}><Icon name="arrowLeft" size={18}/>Anterior</button>
      {step === 0 ? <button type="button" className="button primary" onClick={() => setStep(1)} disabled={!total}>Empezar<Icon name="arrowRight" size={18}/></button>
        : step < total ? <button type="button" className="button primary" onClick={() => setStep(step + 1)}>Siguiente<Icon name="arrowRight" size={18}/></button>
        : <button type="button" className="button primary" disabled={busy} onClick={() => void finish()}>{busy ? "Guardando…" : "Terminar lección"}<Icon name="check" size={18}/></button>}
    </nav>}
  </div>;
}

/** Which of the section's groups do the activity (DEC-028), and who is in the student's own group. */
function ActivityGroups({ groups }: { groups?: StudentActivityGroups["groups"] }) {
  if (!groups?.length) return null;
  const mine = groups.filter(group => group.mine);
  return <div className="player-teams" role="note">
    <Icon name="team" size={18}/>
    <div>
      {mine.map(group => <p key={group.name}><strong>Trabajas en {group.name}</strong>{group.members?.length ? `: ${group.members.join(", ")}` : ""}</p>)}
      <p className={mine.length ? "muted small" : undefined}>{groups.length === 1 ? `La trabaja ${groups[0].name}.` : `La trabajan ${groups.map(group => group.name).join(", ")}.`}</p>
    </div>
  </div>;
}

/** Position in the module and links to the published lessons around this one (ST-032). */
function ModuleNavigation({ navigation }: { navigation: LessonNavigation }) {
  const link = (target: { title: string; shareCode: string }) => `/aprender/${encodeURIComponent(target.shareCode)}`;
  return <nav className="module-nav" aria-label={`Lecciones de ${navigation.moduleName}`}>
    <p className="module-position"><Icon name="list" size={16}/>Lección {navigation.position} de {navigation.total} en {navigation.moduleName}</p>
    <div className="module-links">
      {navigation.previous ? <a className="button ghost small" href={link(navigation.previous)} aria-label={`Lección anterior: ${navigation.previous.title}`}><Icon name="arrowLeft" size={16}/>{navigation.previous.title}</a> : <span/>}
      {navigation.next && <a className="button secondary small" href={link(navigation.next)} aria-label={`Siguiente lección: ${navigation.next.title}`}>{navigation.next.title}<Icon name="arrowRight" size={16}/></a>}
    </div>
  </nav>;
}

function PlayerBlock({ block, library, fileUrl, answer, onAnswer }: { block: ActivityBlock; library: (Material | Resource)[]; fileUrl: (fileId: string) => string; answer?: number; onAnswer: (choice: number) => void }) {
  const text = block.richContent ? <Suspense fallback={<p role="status">Abriendo contenido…</p>}><RichText value={block.richContent} fallbackText={block.instructions} editable={false}/></Suspense>
    : block.instructions?.trim() ? <p className="preserve-lines">{block.instructions}</p> : null;
  if (block.kind === "question") return <fieldset className="player-question">
    <legend className="sr-only">Pregunta</legend>
    {text && <div className="player-content">{text}</div>}
    <p className="player-question-hint">Elige una respuesta</p>
    {block.options?.map((option, choice) => <label key={choice} className={answer === choice ? "is-selected" : undefined}><input type="radio" name={`answer-${block.id}`} checked={answer === choice} onChange={() => onAnswer(choice)}/><span>{option}</span></label>)}
    {answer !== undefined && <p role="status" className={`answer-feedback ${answer === block.answer ? "correct" : "retry"}`}><Icon name={answer === block.answer ? "check" : "info"} size={18}/>{answer === block.answer ? "¡Correcto!" : "Todavía no. Vuelve a leer e intenta otra vez."}</p>}
  </fieldset>;
  return <>
    {text && <div className="player-content">{text}</div>}
    {block.kind === "resource" && library.filter(item => item.id === block.resourceId).map(item => <section key={item.id} className="player-resource" aria-label={`Recurso: ${item.title}`}>
      <h2>{item.title}</h2>{item.description && ("fileId" in item ? !item.fileId : true) && <p className="muted">{item.description}</p>}
      {item.kind === "link" ? <a className="button secondary" href={item.content} target="_blank" rel="noopener noreferrer"><Icon name="link" size={18}/>Abrir el recurso en otra pestaña</a>
        : "fileId" in item && item.kind === "file" && item.fileId ? <FileViewer url={fileUrl(item.fileId)} name={item.fileName || item.title}/>
        : <p className="preserve-lines player-text">{item.content}</p>}
    </section>)}
  </>;
}
