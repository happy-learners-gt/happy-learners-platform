import { lazy, Suspense, useEffect, useRef, useState } from "react";
import type { Lesson, Material, Resource } from "@happy-learners/contracts";
import { api, message } from "../api";
import { FileViewer } from "../FileViewer";
import { activityHue, activityTypeLabel, plural } from "../model";
import { Icon } from "../ui/icons";
const RichText = lazy(() => import("../RichText").then(module => ({ default: module.RichText })));

export function StudentLesson({ code }: { code: string }) {
  const [lesson, setLesson] = useState<Lesson | null>(null), [error, setError] = useState("");
  const shareCode = code.toUpperCase();
  useEffect(() => { api<{ lesson: Lesson }>(`/share/${encodeURIComponent(shareCode)}`).then(result => setLesson(result.lesson)).catch(cause => setError(message(cause))); }, [shareCode]);
  if (error) return <div className="player"><PlayerBar/><main id="main" className="player-main"><div className="player-card player-center"><Icon name="alert" size={28}/><h1>No encontramos esta lección</h1><p>{error === "Lección no disponible." ? "Revisa el código con tu educador. Puede que la lección ya no esté publicada." : error}</p><a className="button primary" href="/">Volver al inicio</a></div></main></div>;
  if (!lesson) return <div className="player"><PlayerBar/><main id="main" className="player-main"><p role="status" className="player-center">Abriendo lección…</p></main></div>;
  return <LessonPlayer lesson={lesson} fileUrl={id => `/api/share/${encodeURIComponent(shareCode)}/files/${id}`} complete={() => api(`/share/${encodeURIComponent(shareCode)}/complete`, "POST").then(() => undefined)}/>;
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
export function LessonPlayer({ lesson, fileUrl, complete, preview, resources, onExit }: { lesson: Lesson; fileUrl: (fileId: string) => string; complete?: () => Promise<void>; preview?: boolean; resources?: (Material | Resource)[]; onExit?: () => void }) {
  const [step, setStep] = useState(0), [answers, setAnswers] = useState<Record<number, number>>({});
  const [busy, setBusy] = useState(false), [error, setError] = useState(""), [done, setDone] = useState(false);
  const heading = useRef<HTMLHeadingElement>(null), first = useRef(true);
  const total = lesson.activities.length;
  useEffect(() => { if (first.current) { first.current = false; return; } heading.current?.focus(); window.scrollTo(0, 0); }, [step]);
  const library = resources || lesson.resources || [];
  async function finish() {
    if (preview || !complete) { setDone(true); setStep(total + 1); return; }
    setBusy(true); setError("");
    try { await complete(); setDone(true); setStep(total + 1); }
    catch (cause) { setError(`${message(cause)} Tu avance sigue en pantalla; vuelve a intentar.`); }
    finally { setBusy(false); }
  }
  const activity = step >= 1 && step <= total ? lesson.activities[step - 1] : null;
  // Documents, presentations and video get the full width of the screen instead of the reading column.
  const wide = !!activity && activity.type === "resource" && library.some(item => item.id === activity.resourceId && item.kind === "file");
  const index = step - 1;
  return <div className={`player${preview ? " is-preview" : ""}`}>
    <PlayerBar title={lesson.title} step={step} total={total}/>
    {preview && <div className="preview-banner" role="note"><Icon name="eye" size={16}/><span>Vista previa del borrador. No se registra nada.</span>{onExit && <button type="button" className="button secondary small" onClick={onExit}>Volver a editar</button>}</div>}
    <main id={preview ? undefined : "main"} className={`player-main${wide ? " is-wide" : ""}`}>
      {step === 0 && <article className="player-card player-intro">
        <span className="eyebrow">{lesson.program}</span>
        <h1 ref={heading} tabIndex={-1}>{lesson.title}</h1>
        <section className="player-objective"><h2>Lo que aprenderás</h2><p>{lesson.objective}</p></section>
        <p className="player-meta"><Icon name="clock" size={16}/>{lesson.duration} minutos · {plural(total, "actividad", "actividades")}</p>
      </article>}
      {activity && <article className={`player-card tone-${activityHue[activity.type || "text"]}`} aria-labelledby="activity-title">
        <span className="player-chip">{activityTypeLabel[activity.type || "text"]} · Actividad {step} de {total} · {activity.minutes} min</span>
        <h1 id="activity-title" ref={heading} tabIndex={-1}>{activity.title}</h1>
        <div className="player-content">{activity.richContent ? <Suspense fallback={<p role="status">Abriendo contenido…</p>}><RichText value={activity.richContent} fallbackText={activity.instructions} editable={false}/></Suspense> : <p className="preserve-lines">{activity.instructions}</p>}</div>
        {activity.type === "resource" && library.filter(item => item.id === activity.resourceId).map(item => <section key={item.id} className="player-resource" aria-label={`Recurso: ${item.title}`}>
          <h2>{item.title}</h2>{item.description && ("fileId" in item ? !item.fileId : true) && <p className="muted">{item.description}</p>}
          {item.kind === "link" ? <a className="button secondary" href={item.content} target="_blank" rel="noopener noreferrer"><Icon name="link" size={18}/>Abrir el recurso en otra pestaña</a>
            : "fileId" in item && item.kind === "file" && item.fileId ? <FileViewer url={fileUrl(item.fileId)} name={item.fileName || item.title}/>
            : <p className="preserve-lines player-text">{item.content}</p>}
        </section>)}
        {activity.type === "question" && <fieldset className="player-question"><legend>Elige una respuesta</legend>
          {activity.options?.map((option, choice) => <label key={choice} className={answers[index] === choice ? "is-selected" : undefined}><input type="radio" name={`answer-${index}`} checked={answers[index] === choice} onChange={() => setAnswers({ ...answers, [index]: choice })}/><span>{option}</span></label>)}
          {answers[index] !== undefined && <p role="status" className={`answer-feedback ${answers[index] === activity.answer ? "correct" : "retry"}`}><Icon name={answers[index] === activity.answer ? "check" : "info"} size={18}/>{answers[index] === activity.answer ? "¡Correcto!" : "Todavía no. Vuelve a leer e intenta otra vez."}</p>}
        </fieldset>}
      </article>}
      {step > total && <article className="player-card player-center">
        <span className="done-icon" aria-hidden="true"><Icon name="check" size={32}/></span>
        <h1 ref={heading} tabIndex={-1}>¡Terminaste la lección!</h1>
        <p role="status">{done && !preview ? "¡Gracias por participar! Contamos la lección como terminada, sin guardar tu nombre ni tus respuestas." : "En la versión publicada, aquí se cuenta la lección como terminada."}</p>
        <button type="button" className="button secondary" onClick={() => { setAnswers({}); setStep(0); }}>Repasar desde el inicio</button>
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
