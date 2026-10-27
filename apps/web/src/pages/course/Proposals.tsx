import { useCallback, useEffect, useState } from "react";
import type { FormEvent } from "react";
import type { AcademicYear, CourseProposals, ProposalItemStatus, SectionSummary } from "@happy-learners/contracts";
import { maxProposalItems, pagesLabel, proposalStatusLabels } from "@happy-learners/domain";
import { api, message } from "../../api";
import { Link } from "../../navigation";
import { plural } from "../../model";
import { Modal, useFeedback } from "../../ui/feedback";
import { Icon } from "../../ui/icons";
import { EmptyState, ErrorState, Field, Loading, PageHeader, Section, StatusBadge } from "../../ui/primitives";
import type { Tone } from "../../ui/primitives";
import { useCourse } from "./context";

const tones: Record<ProposalItemStatus, Tone> = { queued: "neutral", running: "info", done: "success", error: "danger" };

/** Reads a PDF's text page by page in the browser with pdf.js; the platform never parses PDFs on the server. */
async function readBook(courseId: string, fileId: string, onPage: (page: number, total: number) => void) {
  const response = await fetch(`/api/courses/${courseId}/files/${fileId}/content`, { credentials: "same-origin" });
  if (!response.ok) throw new Error("No se pudo descargar el libro. Vuelve a intentar.");
  const pdfjs = await import("pdfjs-dist");
  pdfjs.GlobalWorkerOptions.workerSrc = new URL("pdfjs-dist/build/pdf.worker.min.mjs", import.meta.url).toString();
  const loading = pdfjs.getDocument({ data: new Uint8Array(await response.arrayBuffer()), enableXfa: false });
  try {
    const pdf = await loading.promise, pages: { page: number; text: string }[] = [];
    if (pdf.numPages > 1000) throw new Error("El libro tiene más de 1000 páginas. Sube solo la parte que usa el curso.");
    for (let page = 1; page <= pdf.numPages; page++) {
      onPage(page, pdf.numPages);
      const content = await (await pdf.getPage(page)).getTextContent();
      pages.push({ page, text: content.items.map(item => "str" in item ? item.str : "").join(" ") });
    }
    return pages;
  } finally { void loading.destroy(); }
}

/**
 * /cursos/:id/propuestas — «Proponer lecciones»: what the course still needs, reading the main book's text, choosing
 * the indicators and the module, and following each proposal (en cola, en curso, listo, error). Proposals are drafts.
 */
export function Proposals() {
  const { course, reload } = useCourse();
  const { toast } = useFeedback();
  const [data, setData] = useState<CourseProposals | null>(null), [error, setError] = useState("");
  const [reading, setReading] = useState(""), [busy, setBusy] = useState(false), [formError, setFormError] = useState("");
  const [unitId, setUnitId] = useState(""), [minutes, setMinutes] = useState("45"), [picked, setPicked] = useState<Set<string>>(new Set());
  const base = `/cursos/${course.id}`, path = `/courses/${course.id}/proposals`;
  const load = useCallback(() => api<CourseProposals>(path).then(result => { setData(result); setError(""); }, cause => setError(message(cause))), [path]);
  useEffect(() => { void load(); }, [load]);
  const pending = !!data?.jobs.some(job => job.items.some(item => item.status === "queued" || item.status === "running"));
  // While proposals are queued or running, the page follows them; drafts appear in the course's content.
  useEffect(() => {
    if (!pending) return;
    const timer = setInterval(() => { void api<CourseProposals>(path).then(result => { setData(result); if (!result.jobs.some(job => job.items.some(item => item.status === "queued" || item.status === "running"))) void reload(); }, () => undefined); }, 2000);
    return () => clearInterval(timer);
  }, [pending, path, reload]);
  useEffect(() => { if (data && !unitId && data.units[0]) setUnitId(data.units[0].id); }, [data, unitId]);
  const header = <PageHeader crumbs={[{ label: "Cursos", href: "/cursos" }, { label: course.title, href: base }, { label: "Proponer lecciones" }]} title="Proponer lecciones"
    description="Borradores de lecciones a partir del libro principal y de los indicadores del plan curricular, siguiendo la secuencia didáctica del curso. Revísalos y publícalos como cualquier lección."/>;
  if (error) return <>{header}<ErrorState error={error} retry={() => void load()}/></>;
  if (!data) return <>{header}<Loading label="Revisando el curso…" lines={5}/></>;

  async function read() {
    if (!data?.book) return;
    setFormError("");
    try {
      const pages = await readBook(course.id, data.book.fileId, (page, total) => setReading(`Leyendo la página ${page} de ${total}…`));
      setReading("Guardando el texto…");
      const result = await api<{ pages: number }>(`${path}/book-text`, "PUT", { fileId: data.book.fileId, sha256: data.book.sha256, pages });
      toast({ message: `Se leyó el texto del libro: ${plural(result.pages, "página", "páginas")}.` });
    } catch (cause) { setFormError(message(cause)); }
    finally { setReading(""); await load(); }
  }
  async function propose(event: FormEvent) {
    event.preventDefault(); setBusy(true); setFormError("");
    try {
      const result = await api<CourseProposals & { skipped: number }>(path, "POST", { unitId, outcomeIds: [...picked], minutes: Number(minutes) });
      setData(result); setPicked(new Set());
      toast({ message: `Se pidieron ${plural(result.jobs[0].items.length, "propuesta", "propuestas")}${result.skipped ? ` (${result.skipped} ya existían)` : ""}. Aparecerán como borradores en el contenido.` });
    } catch (cause) { setFormError(message(cause)); }
    finally { setBusy(false); }
  }
  async function retry(jobId: string) {
    try { setData(await api<CourseProposals>(`${path}/${jobId}/retry`, "POST")); toast({ message: "Las propuestas con error volvieron a la cola." }); }
    catch (cause) { toast({ tone: "error", message: message(cause) }); }
  }
  const textReady = data.bookText === "ready";
  const needsText = !!data.book && (data.bookText === "missing" || data.bookText === "stale");
  const checks: [boolean, string][] = [
    [data.outcomes.length > 0, data.outcomes.length ? `${plural(data.outcomes.length, "indicador", "indicadores")} en el plan curricular` : "Sin indicadores en el plan curricular"],
    [true, `Secuencia didáctica: ${data.sequence.label}`],
    [!!data.book, data.book ? `Libro principal: ${data.book.title}` : "Sin libro principal en la bibliografía"],
    [textReady, textReady ? `Texto del libro leído (${plural(data.book!.pages, "página", "páginas")})` : data.bookText === "no_text" ? "El PDF no tiene texto que se pueda leer" : "Falta leer el texto del libro"],
    [data.units.length > 0, data.units.length ? `${plural(data.units.length, "módulo", "módulos")} para recibir las lecciones` : "Sin módulos en el contenido"],
    [!!data.generator, data.generator === "openai" ? "Generador: OpenAI" : data.generator === "fixture" ? "Generador de prueba local (fixture): propuestas de ejemplo sin IA" : "Generación no configurada en este entorno"],
  ];
  return <>
    {header}
    <Section title="Antes de proponer">
      <ul className="readiness">{checks.map(([ok, text]) => <li key={text} className={ok ? "is-ok" : "is-missing"}><Icon name={ok ? "check" : "alert"} size={16}/>{text}</li>)}</ul>
      {data.blockers.filter(item => !item.includes("texto que se pueda leer")).map(item => <p key={item} className="muted small">{item}</p>)}
      {data.bookText === "no_text" && <p className="form-alert" role="alert"><Icon name="alert" size={18}/>{data.blockers.find(item => item.includes("texto que se pueda leer"))}</p>}
      {needsText && data.canPropose && <div className="button-row"><button type="button" className="button secondary" disabled={!!reading} onClick={() => void read()}><Icon name="library" size={16}/>{reading || (data.bookText === "stale" ? "Volver a leer el libro" : "Leer el texto del libro")}</button><span className="muted small">El libro se lee en tu navegador; no sale de la plataforma.</span></div>}
      {!data.outcomes.length && <p className="small"><Link href={`${base}/plan`}>Ir al plan curricular</Link></p>}
      {textReady && <p className="small"><Link href={`${base}/mapa-del-libro`}>Revisar el mapa del libro</Link>: qué páginas trabaja cada indicador. Las propuestas usan las páginas que confirmes ahí.</p>}
    </Section>
    {formError && <p className="form-alert" role="alert"><Icon name="alert" size={18}/>{formError}</p>}
    {data.canPropose && textReady && !data.blockers.length && <Section title="Elegir indicadores">
      <form className="stack" onSubmit={propose} aria-label="Proponer lecciones">
        <fieldset disabled={busy} className="stack">
          <div className="field-row">
            <Field label="Módulo que recibe las lecciones"><select value={unitId} onChange={event => setUnitId(event.target.value)}>{data.units.map(unit => <option key={unit.id} value={unit.id}>{unit.name}</option>)}</select></Field>
            <Field label="Duración de cada clase (minutos)"><input type="number" min={10} max={300} value={minutes} onChange={event => setMinutes(event.target.value)} required/></Field>
          </div>
          <fieldset className="stack proposal-outcomes"><legend>Una lección por indicador (hasta {maxProposalItems})</legend>
            {data.outcomes.map(outcome => <label key={outcome.id} className="package-indicator"><input type="checkbox" checked={picked.has(outcome.id)} disabled={!picked.has(outcome.id) && picked.size >= maxProposalItems}
              onChange={() => setPicked(current => { const next = new Set(current); if (next.has(outcome.id)) next.delete(outcome.id); else next.add(outcome.id); return next; })}/>
              <span>{outcome.code && <strong>{outcome.code} </strong>}{outcome.statement}</span></label>)}
          </fieldset>
          <div className="button-row"><button className="button primary" disabled={!picked.size || !unitId}>{busy ? "Pidiendo…" : picked.size ? `Proponer ${plural(picked.size, "lección", "lecciones")}` : "Elige indicadores"}</button></div>
        </fieldset>
      </form>
    </Section>}
    <Section title="Propuestas">
      {!data.jobs.length ? <EmptyState compact icon="spark" title="Aún no hay propuestas">Cuando pidas propuestas, aquí verás su avance: en cola, en curso, listo o error.</EmptyState>
        : <ul className="proposal-jobs">{data.jobs.map(job => <li key={job.id}>
          <p className="small muted">{job.unitName} · pidió {job.requestedBy} · {new Date(job.createdAt).toLocaleString("es-GT")} · {job.generator === "fixture" ? "generador de prueba" : "OpenAI"}</p>
          <ul className="proposal-items">{job.items.map(item => <li key={item.id}>
            <StatusBadge tone={tones[item.status]}>{proposalStatusLabels[item.status]}</StatusBadge>
            <div>
              {item.lessonId ? <Link href={`${base}/lecciones/${item.lessonId}`}>{item.lessonTitle || item.statement}</Link> : <span>{item.statement}</span>}
              <span className="muted small">{item.pages.length ? `Libro, ${pagesLabel(item.pages)}` : "Sin páginas del libro"}{item.error ? ` · ${item.error}` : ""}</span>
            </div>
          </li>)}</ul>
          {data.canPropose && job.items.some(item => item.status === "error" && item.pages.length) && <button type="button" className="button ghost small" onClick={() => void retry(job.id)}><Icon name="undo" size={16}/>Reintentar las que tuvieron error</button>}
        </li>)}</ul>}
    </Section>
  </>;
}

/** «PDF de entrega»: a module's published lessons for one section and period, downloaded as a PDF. */
export function DeliveryDialog({ courseId, units, onClose }: { courseId: string; units: { id: string; name: string }[]; onClose: () => void }) {
  const [sections, setSections] = useState<SectionSummary[] | null>(null), [year, setYear] = useState<AcademicYear | null>(null);
  const [values, setValues] = useState({ unit: units[0]?.id || "", section: "", period: "" }), [error, setError] = useState(""), [busy, setBusy] = useState(false);
  useEffect(() => {
    void api<{ sections: SectionSummary[] }>("/sections").then(result => { const own = result.sections.filter(item => item.courseId === courseId); setSections(own); setValues(current => ({ ...current, section: own[0]?.id || "" })); }, cause => setError(message(cause)));
    void api<{ years: AcademicYear[] }>("/academic-years").then(result => setYear(result.years.find(item => item.status === "current") || null), () => setYear(null));
  }, [courseId]);
  async function download(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError("");
    const query = new URLSearchParams({ section: values.section, ...(values.period ? { period: values.period } : {}) });
    try {
      const response = await fetch(`/api/courses/${courseId}/units/${values.unit}/delivery.pdf?${query}`, { credentials: "same-origin" });
      if (!response.ok) throw new Error(((await response.json().catch(() => ({}))) as { error?: string }).error || "No se pudo generar el PDF.");
      const link = document.createElement("a"), href = URL.createObjectURL(await response.blob());
      link.href = href; link.download = /filename="([^"]+)"/.exec(response.headers.get("Content-Disposition") || "")?.[1] || "entrega.pdf"; link.click();
      setTimeout(() => URL.revokeObjectURL(href), 10_000);
      onClose();
    } catch (cause) { setError(message(cause)); }
    finally { setBusy(false); }
  }
  return <Modal title="PDF de entrega" onClose={onClose}>
    <form className="stack" onSubmit={download} aria-label="Descargar el PDF de entrega">
      <p className="muted small">Incluye solo las lecciones publicadas del módulo, nunca los borradores, con el membrete de la organización, la sección, el ciclo y el periodo.</p>
      {error && <p className="form-alert" role="alert"><Icon name="alert" size={18}/>{error}</p>}
      {!sections ? <Loading label="Cargando secciones…" lines={2}/> : !sections.length ? <p className="muted">El curso no tiene secciones que puedas ver.</p> : <fieldset disabled={busy} className="stack">
        <Field label="Módulo"><select value={values.unit} onChange={event => setValues({ ...values, unit: event.target.value })}>{units.map(unit => <option key={unit.id} value={unit.id}>{unit.name}</option>)}</select></Field>
        <Field label="Sección"><select value={values.section} onChange={event => setValues({ ...values, section: event.target.value })}>{sections.map(section => <option key={section.id} value={section.id}>{section.name}</option>)}</select></Field>
        <Field label="Periodo" optional hint={year ? `Del ${year.name}. Sin elegir, el periodo de hoy.` : "No hay un ciclo lectivo vigente."}><select value={values.period} disabled={!year} onChange={event => setValues({ ...values, period: event.target.value })}><option value="">El de hoy</option>{year?.periods.map(period => <option key={period.id} value={period.id}>{period.name}</option>)}</select></Field>
        <div className="button-row"><button className="button primary" disabled={!values.section || !values.unit}><Icon name="download" size={16}/>{busy ? "Generando…" : "Descargar PDF"}</button><button type="button" className="button ghost" onClick={onClose}>Cancelar</button></div>
      </fieldset>}
    </form>
  </Modal>;
}
