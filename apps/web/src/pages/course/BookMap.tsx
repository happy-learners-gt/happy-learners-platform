import { useCallback, useEffect, useState } from "react";
import type { BookMapView } from "@happy-learners/contracts";
import { mapSourceLabels, pagesLabel, proposalStatusLabels } from "@happy-learners/domain";
import { api, message } from "../../api";
import { Link } from "../../navigation";
import { useFeedback } from "../../ui/feedback";
import { Icon } from "../../ui/icons";
import { EmptyState, ErrorState, Loading, PageHeader, Section, StatTiles, StatusBadge } from "../../ui/primitives";
import { useCourse } from "./context";

type Row = BookMapView["outcomes"][number];
const pagesText = (pages: number[]) => pages.join(", ");

/**
 * /cursos/:id/mapa-del-libro — which pages of the main book work on each indicator of the plan. The search proposes
 * pages, the AI review confirms them with a quote verified on each page, and the team confirms or corrects them.
 * Lesson proposals use the confirmed pages.
 */
export function BookMap() {
  const { course } = useCourse();
  const { toast } = useFeedback();
  const [data, setData] = useState<BookMapView | null>(null), [error, setError] = useState(""), [busy, setBusy] = useState("");
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const base = `/cursos/${course.id}`, path = `/courses/${course.id}/book-map`;
  const load = useCallback(() => api<BookMapView>(path).then(result => { setData(result); setError(""); }, cause => setError(message(cause))), [path]);
  useEffect(() => { void load(); }, [load]);
  const checking = !!data?.outcomes.some(row => row.aiStatus === "queued" || row.aiStatus === "running");
  useEffect(() => {
    if (!checking) return;
    const timer = setInterval(() => { void api<BookMapView>(path).then(setData, () => undefined); }, 2000);
    return () => clearInterval(timer);
  }, [checking, path]);
  const header = <PageHeader crumbs={[{ label: "Cursos", href: "/cursos" }, { label: course.title, href: base }, { label: "Proponer lecciones", href: `${base}/propuestas` }, { label: "Mapa del libro" }]} title="Mapa del libro"
    description="Qué páginas del libro principal trabajan cada indicador del plan curricular. Las propuestas de lecciones usan las páginas que confirmes."/>;
  if (error) return <>{header}<ErrorState error={error} retry={() => void load()}/></>;
  if (!data) return <>{header}<Loading label="Cargando el mapa del libro…" lines={6}/></>;
  if (!data.book) return <>{header}<EmptyState icon="library" title="Primero lee el libro principal" action={<Link className="button primary" href={`${base}/propuestas`}>Ir a Proponer lecciones</Link>}>El mapa necesita el texto del libro principal en PDF. Léelo desde «Proponer lecciones».</EmptyState></>;

  async function run(label: string, work: () => Promise<BookMapView>, done: string) {
    setBusy(label);
    try { setData(await work()); toast({ message: done }); }
    catch (cause) { toast({ tone: "error", message: message(cause) }); }
    finally { setBusy(""); }
  }
  const save = (row: Row, pages: string) => run(row.outcomeId, () => api<BookMapView>(`${path}/outcomes/${row.outcomeId}`, "PUT", { pages }), pages.trim() ? `Páginas de ${row.code || "el indicador"} confirmadas.` : `Marcaste que el libro no trata ${row.code || "el indicador"}.`)
    .then(() => setDrafts(current => { const next = { ...current }; delete next[row.outcomeId]; return next; }));
  const { summary } = data, searched = data.outcomes.some(row => row.status);
  return <>
    {header}
    <StatTiles items={[
      { label: "Indicadores", value: summary.total, icon: "spark", hue: "violet" },
      { label: "Con páginas", value: summary.mapped - summary.uncovered, icon: "library", hue: "sky" },
      { label: "Confirmados", value: summary.confirmed, icon: "check", hue: "green" },
      { label: "Sin cobertura en el libro", value: summary.uncovered, icon: "alert", hue: "coral" },
    ]}/>
    <Section title={`${data.book.title} · ${data.book.pages} páginas`} action={data.canEdit && <div className="button-row">
      <button type="button" className="button secondary small" disabled={!!busy || checking} onClick={() => void run("search", () => api<BookMapView>(path, "POST", {}), "Se buscaron las páginas de cada indicador.")}><Icon name="search" size={16}/>{searched ? "Buscar de nuevo" : "Buscar en el libro"}</button>
      {data.mapper && searched && <button type="button" className="button secondary small" disabled={!!busy || checking} onClick={() => void run("check", () => api<BookMapView>(`${path}/check`, "POST", {}), "La IA revisa las páginas: verás el avance aquí.")}><Icon name="sparkles" size={16}/>{checking ? "Revisando…" : data.mapper === "fixture" ? "Revisar (generador de prueba)" : "Revisar con IA"}</button>}
      {searched && <button type="button" className="button primary small" disabled={!!busy || checking} onClick={() => void run("confirm", () => api<BookMapView>(`${path}/confirm`, "POST", {}), "Se confirmaron los indicadores pendientes.")}><Icon name="check" size={16}/>Confirmar todo</button>}
    </div>}>
      <p className="muted small">La búsqueda propone páginas por las palabras del indicador y de sus contenidos. La revisión con IA solo acepta una página si cita una frase que de verdad está en ella. Tú confirmas o corriges: escribe páginas como «12, 15-17», o deja vacío si el libro no trata el indicador.</p>
      {!searched ? <EmptyState compact icon="search" title="Aún no hay mapa">Usa «Buscar en el libro» para proponer las páginas de cada indicador.</EmptyState>
        : <div className="coverage-scroll" role="region" aria-label="Mapa del libro" tabIndex={0}><table className="coverage-table book-map">
          <thead><tr><th scope="col">Indicador</th><th scope="col">Páginas y evidencia</th><th scope="col">Estado</th><th scope="col">Revisión</th></tr></thead>
          <tbody>{data.outcomes.map(row => {
            const draft = drafts[row.outcomeId] ?? pagesText(row.pages), running = row.aiStatus === "queued" || row.aiStatus === "running";
            return <tr key={row.outcomeId}>
              <th scope="row">{row.code && <strong>{row.code} </strong>}{row.statement}</th>
              <td>
                {row.pages.length ? <strong>{pagesLabel(row.pages)}</strong> : row.status ? <span className="muted">El libro no lo trata</span> : <span className="muted">Sin buscar</span>}
                {row.evidence.map(item => <p key={item.page} className="small quote">p. {item.page}: «{item.quote}»</p>)}
                {row.candidates.length > 0 && <p className="muted small">Candidatas: {row.candidates.map(item => item.page).join(", ")}</p>}
              </td>
              <td><div className="badge-row start">
                {row.status && <StatusBadge tone={row.status === "confirmed" ? "success" : "neutral"}>{row.status === "confirmed" ? "Confirmado" : "Por confirmar"}</StatusBadge>}
                {row.source && <StatusBadge tone="info">{mapSourceLabels[row.source]}</StatusBadge>}
                {row.aiStatus !== "none" && row.aiStatus !== "done" && <StatusBadge tone={row.aiStatus === "error" ? "danger" : "warning"}>IA: {proposalStatusLabels[row.aiStatus].toLocaleLowerCase("es")}</StatusBadge>}
              </div>{row.aiError && <p className="muted small">{row.aiError}</p>}</td>
              <td>{data.canEdit && row.status && <div className="map-edit">
                <input className="map-pages" aria-label={`Páginas de ${row.code || row.statement}`} value={draft} placeholder="Sin páginas" disabled={running || !!busy} onChange={event => setDrafts({ ...drafts, [row.outcomeId]: event.target.value })}/>
                <button type="button" className="button secondary small" disabled={running || !!busy} onClick={() => void save(row, draft)}>Confirmar</button>
              </div>}</td>
            </tr>;
          })}</tbody>
        </table></div>}
    </Section>
  </>;
}
