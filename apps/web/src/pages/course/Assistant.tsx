import { useCallback, useEffect, useMemo, useState } from "react";
import type { FormEvent } from "react";
import type { BookMapView, CourseProposals, Lesson, ProposalItemStatus, SectionSummary } from "@happy-learners/contracts";
import { lessonOutcomes, mapSourceLabels, maxProposalItems, pagesLabel, proposalStatusLabels, richPlainText, sequenceOf } from "@happy-learners/domain";
import { api, message } from "../../api";
import { Link, useNavigation } from "../../navigation";
import { plural } from "../../model";
import { useFeedback } from "../../ui/feedback";
import { Icon } from "../../ui/icons";
import { Tabs } from "../../ui/Tabs";
import { EmptyState, ErrorState, Field, Loading, PageHeader, PrimaryAction, Section, StatTiles, StatusBadge } from "../../ui/primitives";
import type { Tone } from "../../ui/primitives";
import { metadataBody } from "./Content";
import { useCourse } from "./context";

/**
 * /cursos/:id/asistente — «Planificar con IA»: one place for the whole flow, in the order a teacher works.
 *   Libro → Mapa → Propuestas → Revisión → Calendario
 * The current step follows the course's state; each step has one main action and says what comes next. Proposals are
 * drafts with their provenance; nothing is published without a person, and the calendar uses the existing
 * «Asignar lecciones en orden» of the section's schedule.
 */
type Step = "libro" | "mapa" | "propuestas" | "revision" | "calendario";
const stepLabels: Record<Step, string> = { libro: "Libro", mapa: "Mapa del libro", propuestas: "Propuestas", revision: "Revisión", calendario: "Calendario" };
const steps = Object.keys(stepLabels) as Step[];
const itemTones: Record<ProposalItemStatus, Tone> = { queued: "neutral", running: "info", done: "success", error: "danger" };

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

/** A lesson the assistant proposed that nobody has published yet. */
export const isProposal = (lesson: Pick<Lesson, "generated" | "revision" | "status">) => !!lesson.generated && !(lesson.revision || 0) && lesson.status !== "archived";

export function Assistant() {
  const { course, lessons, reload, publisher } = useCourse();
  const { url, navigate } = useNavigation();
  const base = `/cursos/${course.id}`, path = `/courses/${course.id}`;
  const [proposals, setProposals] = useState<CourseProposals | null>(null), [map, setMap] = useState<BookMapView | null>(null), [error, setError] = useState("");
  const load = useCallback(() => Promise.all([api<CourseProposals>(`${path}/proposals`), api<BookMapView>(`${path}/book-map`)])
    .then(([nextProposals, nextMap]) => { setProposals(nextProposals); setMap(nextMap); setError(""); }, cause => setError(message(cause))), [path]);
  useEffect(() => { void load(); }, [load]);
  // While proposals or the map review run in the background, the page follows them; new drafts reach the content.
  const running = !!proposals?.jobs.some(job => job.items.some(item => item.status === "queued" || item.status === "running")) || !!map?.outcomes.some(row => row.aiStatus === "queued" || row.aiStatus === "running");
  useEffect(() => {
    if (!running) return;
    const timer = setInterval(() => { void load().then(() => reload()); }, 2500);
    return () => clearInterval(timer);
  }, [running, load, reload]);

  const drafts = useMemo(() => lessons.filter(isProposal), [lessons]);
  const covered = useCallback((outcomeId: string) => lessons.filter(lesson => lesson.status !== "archived" && lessonOutcomes(lesson).includes(outcomeId)), [lessons]);
  const gaps = proposals ? proposals.outcomes.filter(outcome => !covered(outcome.id).length).map(outcome => outcome.id) : [];
  const bookReady = !!proposals && proposals.bookText === "ready" && !proposals.blockers.length;
  const mapDone = !!map && map.summary.total > 0 && map.summary.confirmed === map.summary.total;
  const done: Record<Step, boolean> = { libro: bookReady, mapa: mapDone, propuestas: bookReady && mapDone && !gaps.length, revision: bookReady && !drafts.length && lessons.some(lesson => lesson.generated && (lesson.revision || 0) > 0), calendario: false };
  const suggested: Step = !bookReady ? "libro" : !mapDone ? "mapa" : drafts.length ? "revision" : gaps.length ? "propuestas" : "calendario";
  const requested = url.searchParams.get("paso") as Step | null;
  const step: Step = requested && steps.includes(requested) ? requested : suggested;
  const go = (next: Step) => { const target = new URL(url); target.searchParams.set("paso", next); navigate(target.pathname + target.search, true); };

  const header = <PageHeader crumbs={[{ label: "Cursos", href: "/cursos" }, { label: course.title, href: base }, { label: "Planificar con IA" }]} title="Planificar con IA"
    description="Del libro principal y los indicadores del plan a lecciones revisadas y programadas en el calendario de tus secciones. La IA propone; tú decides."/>;
  if (error) return <>{header}<ErrorState error={error} retry={() => void load()}/></>;
  if (!proposals || !map) return <>{header}<Loading label="Revisando el curso…" lines={6}/></>;
  // One navigation: each step is a tab that says whether it is done or how much is waiting in it.
  const badge = (item: Step) => done[item] && item !== step ? <span className="tab-done" aria-label="(completo)"><Icon name="check" size={14}/></span>
    : item === "revision" && drafts.length ? <span className="tab-badge">{drafts.length}</span> : item === "propuestas" && bookReady && gaps.length ? <span className="tab-badge">{gaps.length}</span> : null;
  return <>
    {header}
    <Tabs label="Pasos de la planificación" value={step} onChange={go} items={steps.map((item, index) => ({ value: item, label: `${index + 1}. ${stepLabels[item]}`, badge: badge(item) }))}>
      {step === "libro" && <BookStep data={proposals} reload={load} next={() => go("mapa")}/>}
      {step === "mapa" && <MapStep map={map} path={`${path}/book-map`} setMap={setMap} canEdit={map.canEdit} next={() => go("propuestas")}/>}
      {step === "propuestas" && <ProposeStep data={proposals} setData={setProposals} gaps={gaps} covered={covered} canPropose={proposals.canPropose} next={() => go("revision")} reload={reload}/>}
      {step === "revision" && <ReviewStep drafts={drafts} data={proposals} reload={reload} publisher={publisher} next={() => go("calendario")}/>}
      {step === "calendario" && <CalendarStep courseId={course.id} published={lessons.filter(lesson => (lesson.revision || 0) > 0 && lesson.status !== "archived").length}/>}
    </Tabs>
  </>;
}

/** Libro: what the course needs, and the main book's text read in the browser. */
function BookStep({ data, reload, next }: { data: CourseProposals; reload: () => Promise<void>; next: () => void }) {
  const { toast } = useFeedback();
  const [reading, setReading] = useState(""), [error, setError] = useState("");
  const { course } = useCourse();
  const base = `/cursos/${course.id}`;
  async function read() {
    if (!data.book) return;
    setError("");
    try {
      const pages = await readBook(course.id, data.book.fileId, (page, total) => setReading(`Leyendo la página ${page} de ${total}…`));
      setReading("Guardando el texto…");
      const result = await api<{ pages: number }>(`/courses/${course.id}/proposals/book-text`, "PUT", { fileId: data.book.fileId, sha256: data.book.sha256, pages });
      toast({ message: `Se leyó el texto del libro: ${plural(result.pages, "página", "páginas")}.` });
    } catch (cause) { setError(message(cause)); }
    finally { setReading(""); await reload(); }
  }
  const textReady = data.bookText === "ready", needsText = !!data.book && (data.bookText === "missing" || data.bookText === "stale");
  const checks: [boolean, string, string | null][] = [
    [data.outcomes.length > 0, data.outcomes.length ? `${plural(data.outcomes.length, "indicador", "indicadores")} en el plan curricular` : "Agrega indicadores al plan curricular", data.outcomes.length ? null : `${base}/plan`],
    [true, `Secuencia didáctica del curso: ${data.sequence.label}`, null],
    [!!data.book, data.book ? `Libro principal: ${data.book.title}` : "Marca un libro principal en PDF en la bibliografía", data.book ? null : `${base}/biblioteca`],
    [textReady, textReady ? `Texto del libro leído (${plural(data.book!.pages, "página", "páginas")})` : data.bookText === "no_text" ? "El PDF no tiene texto que se pueda leer" : "Falta leer el texto del libro", null],
    [data.units.length > 0, data.units.length ? `${plural(data.units.length, "módulo", "módulos")} para recibir las lecciones` : "Crea un módulo en el contenido", data.units.length ? null : `${base}/contenido`],
    [!!data.generator, data.generator === "openai" ? "Generador: OpenAI" : data.generator === "fixture" ? "Generador de prueba local (sin IA)" : "La generación no está configurada en este entorno", null],
  ];
  return <Section title="El libro y lo que el curso necesita">
    <ul className="readiness">{checks.map(([ok, text, href]) => <li key={text} className={ok ? "is-ok" : "is-missing"}><Icon name={ok ? "check" : "alert"} size={16}/>{href ? <Link href={href}>{text}</Link> : text}</li>)}</ul>
    {error && <p className="form-alert" role="alert"><Icon name="alert" size={18}/>{error}</p>}
    {data.bookText === "no_text" && <p className="form-alert" role="alert"><Icon name="alert" size={18}/>El PDF del libro principal no tiene texto que se pueda leer (parece escaneado). Sube una versión con texto; la plataforma no hace reconocimiento de imágenes.</p>}
    <div className="button-row">
      {needsText && data.canPropose ? <PrimaryAction icon="library" busy={!!reading} disabled={!!reading} onClick={() => void read()}>{reading || (data.bookText === "stale" ? "Volver a leer el libro" : "Leer el texto del libro")}</PrimaryAction>
        : textReady && !data.blockers.length && <PrimaryAction icon="chevronRight" onClick={next}>Siguiente: mapa del libro</PrimaryAction>}
      {needsText && <span className="muted small">El libro se lee en tu navegador; no sale de la plataforma.</span>}
    </div>
  </Section>;
}

/** Mapa: which pages work on each indicator; the AI only accepts a page with a quote that is on it. */
export function MapStep({ map, path, setMap, canEdit, next, resourceId }: { map: BookMapView; path: string; setMap: (map: BookMapView) => void; canEdit: boolean; next?: () => void; resourceId?: string }) {
  const at = (suffix = "") => `${path}${suffix}${resourceId ? `?resourceId=${encodeURIComponent(resourceId)}` : ""}`;
  const { toast } = useFeedback();
  const [busy, setBusy] = useState(""), [drafts, setDrafts] = useState<Record<string, string>>({});
  async function run(label: string, work: () => Promise<BookMapView>, done: string) {
    setBusy(label);
    try { setMap(await work()); toast({ message: done }); } catch (cause) { toast({ tone: "error", message: message(cause) }); } finally { setBusy(""); }
  }
  if (!map.book) return <EmptyState icon="library" title={resourceId ? "Este recurso no tiene un PDF" : "Primero lee el libro principal"}>{resourceId ? "Sin archivo no hay páginas que mapear. Escribe el índice a mano y asigna sus capítulos." : "El mapa necesita el texto del libro principal. Vuelve al paso «Libro»."}</EmptyState>;
  const searched = map.outcomes.some(row => row.status), checking = map.outcomes.some(row => row.aiStatus === "queued" || row.aiStatus === "running");
  const pending = map.outcomes.filter(row => row.status === "proposed").length, { summary } = map;
  const save = (outcomeId: string, code: string | null, pages: string) => run(outcomeId, () => api<BookMapView>(at(`/outcomes/${outcomeId}`), "PUT", { pages }), pages.trim() ? `Páginas de ${code || "el indicador"} confirmadas.` : `Marcaste que el libro no trata ${code || "el indicador"}.`)
    .then(() => setDrafts(current => { const copy = { ...current }; delete copy[outcomeId]; return copy; }));
  // One main action at a time: search, then review with AI, then confirm, then go on.
  const canSearch = map.bookText === "ready";
  const primary = !canEdit ? null : !canSearch ? null : !searched ? <PrimaryAction icon="search" busy={busy === "search"} disabled={!!busy} onClick={() => void run("search", () => api<BookMapView>(at(), "POST", {}), "Se buscaron las páginas de cada indicador.")}>Buscar en el libro</PrimaryAction>
    : checking ? <PrimaryAction icon="sparkles" busy disabled>La IA revisa las páginas…</PrimaryAction>
    : pending && map.mapper && map.outcomes.some(row => row.status === "proposed" && row.source === "lexical" && row.candidates.length) ? <PrimaryAction icon="sparkles" busy={busy === "check"} disabled={!!busy} onClick={() => void run("check", () => api<BookMapView>(at("/check"), "POST", {}), "La IA revisa las páginas: verás el avance aquí.")}>Revisar con IA</PrimaryAction>
    : pending ? <PrimaryAction icon="check" busy={busy === "confirm"} disabled={!!busy} onClick={() => void run("confirm", () => api<BookMapView>(at("/confirm"), "POST", {}), "Se confirmó el mapa del libro.")}>Confirmar el mapa ({pending})</PrimaryAction>
    : next ? <PrimaryAction icon="chevronRight" onClick={next}>Siguiente: propuestas</PrimaryAction> : null;
  return <Section title={`${map.book.title} · ${map.book.pages} páginas`} action={canEdit && searched && !checking && <button type="button" className="button ghost small" disabled={!!busy} onClick={() => void run("search", () => api<BookMapView>(at(), "POST", {}), "Se buscaron de nuevo las páginas sin confirmar.")}><Icon name="search" size={16}/>Buscar de nuevo</button>}>
    <StatTiles items={[
      { label: "Indicadores", value: summary.total, icon: "spark", hue: "violet" },
      { label: "Con páginas", value: summary.mapped - summary.uncovered, icon: "library", hue: "sky" },
      { label: "Confirmados", value: summary.confirmed, icon: "check", hue: "green" },
      { label: "Sin cobertura en el libro", value: summary.uncovered, icon: "alert", hue: "coral" },
    ]}/>
    <p className="muted small">La búsqueda propone páginas por las palabras del indicador y de sus contenidos del CNB. La IA solo acepta una página si cita una frase que de verdad está en ella. Tú confirmas o corriges: escribe páginas como «12, 15-17», o deja vacío si el libro no trata el indicador.</p>
    {searched && <div className="coverage-scroll" role="region" aria-label="Mapa del libro" tabIndex={0}><table className="coverage-table book-map">
      <thead><tr><th scope="col">Indicador</th><th scope="col">Páginas y evidencia</th><th scope="col">Estado</th>{canEdit && <th scope="col">Revisión</th>}</tr></thead>
      <tbody>{map.outcomes.map(row => {
        const draft = drafts[row.outcomeId] ?? row.pages.join(", "), rowBusy = row.aiStatus === "queued" || row.aiStatus === "running";
        return <tr key={row.outcomeId}>
          <th scope="row">{row.code && <strong>{row.code} </strong>}{row.statement}</th>
          <td>
            {row.pages.length ? <strong>{pagesLabel(row.pages)}</strong> : row.status ? <span className="muted">El libro no lo trata</span> : <span className="muted">Sin buscar</span>}
            {row.evidence.map(item => <p key={item.page} className="small quote">p. {item.page}: «{item.quote}»</p>)}
            {row.candidates.length > 0 && row.source !== "teacher" && <p className="muted small">Candidatas: {row.candidates.map(item => item.page).join(", ")}</p>}
          </td>
          <td><div className="badge-row start">
            {row.status && <StatusBadge tone={row.status === "confirmed" ? "success" : "neutral"}>{row.status === "confirmed" ? "Confirmado" : "Por confirmar"}</StatusBadge>}
            {row.source && <StatusBadge tone="info">{mapSourceLabels[row.source]}</StatusBadge>}
            {rowBusy && <StatusBadge tone="warning">IA: {proposalStatusLabels[row.aiStatus as "queued" | "running"].toLocaleLowerCase("es")}</StatusBadge>}
            {row.aiStatus === "error" && <StatusBadge tone="danger">IA: error</StatusBadge>}
          </div>{row.aiError && <p className="muted small">{row.aiError}</p>}</td>
          {canEdit && <td>{(row.status || !canSearch) && <div className="map-edit">
            <input className="map-pages" aria-label={`Páginas de ${row.code || row.statement}`} value={draft} placeholder="Sin páginas" disabled={rowBusy || !!busy} onChange={event => setDrafts({ ...drafts, [row.outcomeId]: event.target.value })}/>
            <button type="button" className="button secondary small" disabled={rowBusy || !!busy} onClick={() => void save(row.outcomeId, row.code, draft)}>Confirmar</button>
          </div>}</td>}
        </tr>;
      })}</tbody>
    </table></div>}
    <div className="button-row">{primary}</div>
  </Section>;
}

/** Propuestas: the gaps of the plan, preselected, and each proposal's progress. */
function ProposeStep({ data, setData, gaps, covered, canPropose, next, reload }: { data: CourseProposals; setData: (data: CourseProposals) => void; gaps: string[]; covered: (outcomeId: string) => Lesson[]; canPropose: boolean; next: () => void; reload: () => Promise<void> }) {
  const { toast } = useFeedback();
  const { url } = useNavigation();
  const { course } = useCourse();
  // Entries from the plan (?indicador=) and the content (?modulo=) arrive with their selection made.
  const requested = (url.searchParams.get("indicador") || "").split(",").filter(id => data.outcomes.some(outcome => outcome.id === id));
  const [picked, setPicked] = useState<Set<string>>(() => new Set(requested.length ? requested : gaps.slice(0, maxProposalItems)));
  const [unitId, setUnitId] = useState(() => data.units.find(unit => unit.id === url.searchParams.get("modulo"))?.id || "plan");
  const [minutes, setMinutes] = useState("45"), [busy, setBusy] = useState(false), [error, setError] = useState("");
  const ready = data.bookText === "ready" && !data.blockers.length;
  async function propose(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError("");
    try {
      const result = await api<CourseProposals & { skipped: number }>(`/courses/${course.id}/proposals`, "POST", { unitId, outcomeIds: [...picked], minutes: Number(minutes) });
      setData(result); setPicked(new Set());
      const asked = picked.size - result.skipped;
      toast({ message: `Se pidieron ${plural(asked, "propuesta", "propuestas")}${result.skipped ? ` (${result.skipped} ya existían)` : ""}. Verás su avance aquí.` });
    } catch (cause) { setError(message(cause)); }
    finally { setBusy(false); }
  }
  async function retry(jobId: string) {
    try { setData(await api<CourseProposals>(`/courses/${course.id}/proposals/${jobId}/retry`, "POST", {})); toast({ message: "Las propuestas con error volvieron a la cola." }); }
    catch (cause) { toast({ tone: "error", message: message(cause) }); }
  }
  const coverageText = (outcomeId: string) => {
    const lessons = covered(outcomeId), published = lessons.filter(lesson => (lesson.revision || 0) > 0).length, drafts = lessons.length - published;
    return !lessons.length ? "Sin lección" : [published && plural(published, "lección publicada", "lecciones publicadas"), drafts && plural(drafts, "borrador", "borradores")].filter(Boolean).join(" · ");
  };
  const running = data.jobs.some(job => job.items.some(item => item.status === "queued" || item.status === "running"));
  const finished = data.jobs.reduce((sum, job) => sum + job.items.filter(item => item.status === "done").length, 0);
  if (!ready) return <EmptyState icon="library" title="Completa el paso «Libro»">Las propuestas necesitan el texto del libro principal y los demás requisitos.</EmptyState>;
  return <>
    {canPropose && <Section title="Elegir indicadores">
      <form className="stack" onSubmit={propose} aria-label="Proponer lecciones">
        {error && <p className="form-alert" role="alert"><Icon name="alert" size={18}/>{error}</p>}
        <fieldset disabled={busy || running} className="stack">
          <div className="field-row">
            <Field label="Módulo que recibe las lecciones" hint={unitId === "plan" ? "Cada lección va al módulo donde el plan curricular trabaja su indicador." : undefined}><select value={unitId} onChange={event => setUnitId(event.target.value)}><option value="plan">Según el plan curricular</option>{data.units.map(unit => <option key={unit.id} value={unit.id}>{unit.name}</option>)}</select></Field>
            <Field label="Duración de cada clase (minutos)"><input type="number" min={10} max={300} value={minutes} onChange={event => setMinutes(event.target.value)} required/></Field>
          </div>
          <fieldset className="stack proposal-outcomes"><legend>Una lección por indicador (hasta {maxProposalItems})</legend>
            <div className="button-row"><span className="muted small">{gaps.length ? `${plural(gaps.length, "indicador aún no tiene", "indicadores aún no tienen")} ninguna lección; ya están elegidos.` : "Todos los indicadores tienen alguna lección."}</span>
              {gaps.length > 0 && <button type="button" className="button ghost small" onClick={() => setPicked(new Set(gaps.slice(0, maxProposalItems)))}><Icon name="check" size={16}/>Elegir los que faltan</button>}</div>
            {data.outcomes.map(outcome => <label key={outcome.id} className="package-indicator"><input type="checkbox" checked={picked.has(outcome.id)} disabled={!picked.has(outcome.id) && picked.size >= maxProposalItems}
              onChange={() => setPicked(current => { const copy = new Set(current); if (copy.has(outcome.id)) copy.delete(outcome.id); else copy.add(outcome.id); return copy; })}/>
              <span>{outcome.code && <strong>{outcome.code} </strong>}{outcome.statement}<span className={`coverage-note${covered(outcome.id).some(lesson => (lesson.revision || 0) > 0) ? " is-covered" : ""}`}>{coverageText(outcome.id)}</span></span></label>)}
          </fieldset>
          <div className="button-row">
            {running ? <PrimaryAction icon="sparkles" busy disabled>Generando propuestas…</PrimaryAction>
              : finished && !picked.size ? <PrimaryAction icon="chevronRight" onClick={next}>Siguiente: revisar las propuestas</PrimaryAction>
              : <PrimaryAction type="submit" icon="sparkles" busy={busy} disabled={!picked.size || !unitId || busy}>{picked.size ? `Proponer ${plural(picked.size, "lección", "lecciones")}` : "Elige indicadores"}</PrimaryAction>}
          </div>
        </fieldset>
      </form>
    </Section>}
    <Section title="Avance">
      {!data.jobs.length ? <EmptyState compact icon="spark" title="Aún no hay propuestas">Cada propuesta pasa por en cola, en curso y listo; si el libro no trata un indicador, lo dice en lugar de inventar.</EmptyState>
        : <ul className="proposal-jobs">{data.jobs.slice(0, 5).map(job => <li key={job.id}>
          <p className="small muted">{job.unitName} · pidió {job.requestedBy} · {new Date(job.createdAt).toLocaleString("es-GT")} · {job.generator === "fixture" ? "generador de prueba" : "OpenAI"}</p>
          <ul className="proposal-items">{job.items.map(item => <li key={item.id}>
            <StatusBadge tone={itemTones[item.status]}>{proposalStatusLabels[item.status]}</StatusBadge>
            <div>
              {item.lessonId ? <Link href={`/cursos/${course.id}/lecciones/${item.lessonId}`}>{item.lessonTitle || item.statement}</Link> : <span>{item.statement}</span>}
              <span className="muted small">{item.pages.length ? `Libro, ${pagesLabel(item.pages)}` : "Sin páginas del libro"}{item.error ? ` · ${item.error}` : ""}</span>
            </div>
          </li>)}</ul>
          {canPropose && job.items.some(item => item.status === "error" && item.pages.length) && <button type="button" className="button ghost small" onClick={() => void retry(job.id).then(reload)}><Icon name="undo" size={16}/>Reintentar las que tuvieron error</button>}
        </li>)}</ul>}
    </Section>
  </>;
}

/** Revisión: each proposal with its activities, published or discarded here; the editor is one click away. */
function ReviewStep({ drafts, data, reload, publisher, next }: { drafts: Lesson[]; data: CourseProposals; reload: () => Promise<void>; publisher: boolean; next: () => void }) {
  const { toast, confirm } = useFeedback();
  const { course } = useCourse();
  const [busy, setBusy] = useState("");
  const outcome = (id: string) => data.outcomes.find(item => item.id === id);
  async function publish(lesson: Lesson) {
    if (!await confirm({ title: `¿Publicar «${lesson.title}»?`, body: <p>Es una propuesta de IA. Publícala solo si revisaste sus actividades, su pregunta de evaluación y las páginas del libro que cita. Puedes editarla antes en el editor.</p>, confirm: "La revisé, publicar" })) return;
    setBusy(lesson.id);
    try { await api(`/lessons/${lesson.id}/publish`, "POST"); await reload(); toast({ message: `«${lesson.title}» se publicó.` }); }
    catch (cause) { toast({ tone: "error", message: message(cause) }); }
    finally { setBusy(""); }
  }
  async function discard(lesson: Lesson) {
    if (!await confirm({ title: `¿Descartar «${lesson.title}»?`, body: <p>La propuesta se archiva: deja el contenido del curso y puedes restaurarla desde los archivados.</p>, confirm: "Descartar", danger: true })) return;
    setBusy(lesson.id);
    try { await api(`/lessons/${lesson.id}`, "PUT", metadataBody(course.id, lesson, { archived: true })); await reload(); toast({ message: `«${lesson.title}» se descartó.` }); }
    catch (cause) { toast({ tone: "error", message: message(cause) }); }
    finally { setBusy(""); }
  }
  if (!drafts.length) return <EmptyState icon="check" title="No hay propuestas por revisar" action={<PrimaryAction icon="chevronRight" onClick={next}>Siguiente: calendario</PrimaryAction>}>Las propuestas publicadas ya están en el contenido del curso.</EmptyState>;
  return <Section title={`${plural(drafts.length, "propuesta por revisar", "propuestas por revisar")}`}>
    <p className="muted small">Lee cada propuesta: sus actividades siguen la secuencia didáctica del curso y citan las páginas del libro. {publisher ? "Publica las que apruebes o ábrelas en el editor para cambiarlas." : "Ábrelas en el editor y envíalas a revisión: la persona responsable del curso las publica."}</p>
    <ul className="ai-review-list">{drafts.map(lesson => {
      const phases = sequenceOf(lesson.sequence).phases, target = lesson.outcomeIds?.[0] ? outcome(lesson.outcomeIds[0]) : undefined;
      return <li key={lesson.id} className="ai-review-card">
        <div className="ai-review-head">
          <div>
            <strong>{lesson.title}</strong>
            <span className="muted small">{target ? `${target.code ? `${target.code} · ` : ""}${target.statement}` : ""}</span>
          </div>
          <StatusBadge tone="info">Propuesta de IA</StatusBadge>
        </div>
        <p className="small">{lesson.objective}</p>
        <ol className="ai-review-activities">{lesson.activities.map((activity, index) => {
          const text = (activity.blocks || []).filter(block => block.kind === "text").map(block => block.richContent ? richPlainText(block.richContent) : block.instructions || "").join(" ");
          const question = (activity.blocks || []).find(block => block.kind === "question");
          return <li key={activity.id || index}>
            <span className="muted small">{phases.find(phase => phase.id === activity.phase)?.label || ""} · {activity.minutes} min</span>
            <strong className="small">{activity.title}</strong>
            {text && <span className="small">{text.length > 220 ? `${text.slice(0, 220)}…` : text}</span>}
            {question && <span className="small"><Icon name="question" size={14}/> {question.richContent ? richPlainText(question.richContent) : question.instructions} ({question.options?.length || 0} opciones)</span>}
          </li>;
        })}</ol>
        <p className="muted small">{lesson.generated ? `${lesson.generated.source === "openai" ? `OpenAI (${lesson.generated.model})` : "Generador de prueba"} · libro, ${pagesLabel(lesson.generated.pages)} · ${new Date(lesson.generated.at).toLocaleString("es-GT")}` : ""}</p>
        <div className="button-row">
          {publisher && <button type="button" className="button primary small" disabled={!!busy} onClick={() => void publish(lesson)}><Icon name="check" size={16}/>Publicar</button>}
          <Link className="button secondary small" href={`/cursos/${course.id}/lecciones/${lesson.id}`}><Icon name="edit" size={16}/>Abrir en el editor</Link>
          {publisher && <button type="button" className="button ghost small" disabled={!!busy} onClick={() => void discard(lesson)}>Descartar</button>}
        </div>
      </li>;
    })}</ul>
  </Section>;
}

/** Calendario: the published lessons, in content order, into the next classes of a section's schedule. */
function CalendarStep({ courseId, published }: { courseId: string; published: number }) {
  const { toast } = useFeedback();
  const [sections, setSections] = useState<SectionSummary[] | null>(null), [sectionId, setSectionId] = useState(""), [busy, setBusy] = useState(false), [result, setResult] = useState<{ assigned: number; classes: number } | null>(null);
  useEffect(() => { void api<{ sections: SectionSummary[] }>("/sections").then(data => { const own = data.sections.filter(item => item.courseId === courseId && item.status === "active" && item.schedule); setSections(own); setSectionId(own[0]?.id || ""); }, () => setSections([])); }, [courseId]);
  async function assign() {
    setBusy(true);
    try {
      const done = await api<{ assigned: number; classes: number }>(`/courses/${courseId}/groups/${sectionId}/lessons`, "POST", { perClass: 1 });
      setResult(done);
      toast({ message: done.assigned ? `Se planificaron ${plural(done.assigned, "lección", "lecciones")} en ${plural(done.classes, "clase", "clases")}, en orden.` : "No quedan lecciones publicadas por asignar a las próximas clases." });
    } catch (cause) { toast({ tone: "error", message: message(cause) }); }
    finally { setBusy(false); }
  }
  if (!sections) return <Loading label="Cargando secciones…" lines={2}/>;
  if (!sections.length) return <EmptyState icon="calendar" title="El curso no tiene secciones con horario">Configura el horario de una sección para programar las lecciones en sus clases.</EmptyState>;
  return <Section title="Programar en el calendario">
    <p className="muted small">Las {plural(published, "lección publicada", "lecciones publicadas")} del curso se asignan, en el orden del contenido, a las próximas clases sin lección del horario de la sección. Puedes moverlas después en el cronograma.</p>
    <div className="field-row"><Field label="Sección"><select value={sectionId} onChange={event => { setSectionId(event.target.value); setResult(null); }}>{sections.map(section => <option key={section.id} value={section.id}>{section.name}</option>)}</select></Field></div>
    <div className="button-row">
      {result ? <Link className="button primary" href={`/secciones/${sectionId}/clases`}><Icon name="calendar" size={16}/>Ver el cronograma</Link>
        : <PrimaryAction icon="list" busy={busy} disabled={busy || !sectionId || !published} onClick={() => void assign()}>Asignar lecciones en orden</PrimaryAction>}
    </div>
  </Section>;
}
