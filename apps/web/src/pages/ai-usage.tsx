import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import type { AiPrice, AiRun, AiTotals, AiUsageSummary } from "@happy-learners/domain";
import { aiTaskLabels } from "@happy-learners/domain";
import { api, message } from "../api";
import { useNavigation } from "../navigation";
import { formatInstant } from "../regional";
import { Modal, useFeedback } from "../ui/feedback";
import { Icon } from "../ui/icons";
import { Button, EmptyState, ErrorState, Field, Loading, PageHeader, Section, StatTiles, StatusBadge } from "../ui/primitives";
import type { Tone } from "../ui/primitives";

/**
 * Organización › Uso de IA (1.4.0, docs/design/asistente-ia.md §6a): what the organization's AI did this month, by
 * task, course and person, what it cost at the prices administration sets, and the latest runs. No text is kept.
 */
type Usage = { month: string; previousMonth: string; summary: AiUsageSummary; previous: AiTotals; prices: AiPrice[]; unpriced: string[]; recent: (AiRun & { cost: number | null })[] };

const monthName = (month: string) => new Intl.DateTimeFormat("es", { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(`${month}-01T00:00:00Z`));
const capitalized = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);
const shift = (month: string, by: number) => { const date = new Date(`${month}-01T00:00:00Z`); date.setUTCMonth(date.getUTCMonth() + by); return date.toISOString().slice(0, 7); };
const number = (value: number) => new Intl.NumberFormat("es").format(value);
export const usd = (value: number | null) => value === null ? "No disponible" : new Intl.NumberFormat("es", { style: "currency", currency: "USD", minimumFractionDigits: value > 0 && value < 0.01 ? 4 : 2 }).format(value);
/** AIG-4: share of what the AI proposed that people used, over the answers they decided on. */
const acceptance = (totals: AiTotals) => totals.acceptance === null ? "—" : `${Math.round(totals.acceptance * 100)} %`;
const used = (totals: AiTotals) => totals.acceptance === null ? "—" : `${acceptance(totals)} (${number(totals.acceptedItems)} de ${number(totals.proposedItems)})`;
const seconds = (ms: number) => `${new Intl.NumberFormat("es", { maximumFractionDigits: 1 }).format(ms / 1000)} s`;
const statusOf: Record<AiRun["status"], [string, Tone]> = { ok: ["Correcta", "success"], error: ["Error", "danger"], transient: ["Se reintenta", "warning"], refused: ["Rechazada", "warning"], incomplete: ["Incompleta", "warning"] };

function Breakdown({ title, rows }: { title: string; rows: (AiTotals & { label: string })[] }) {
  return <div className="table-card" role="region" aria-label={title} tabIndex={0}><table className="ai-usage-table">
    <caption className="sr-only">{title}</caption>
    <thead><tr><th scope="col">{title}</th><th scope="col">Ejecuciones</th><th scope="col">Errores</th><th scope="col">Propuestas usadas</th><th scope="col">Tokens</th><th scope="col">Costo estimado</th><th scope="col">Duración media</th></tr></thead>
    <tbody>{rows.map(row => <tr key={row.label}>
      <th scope="row">{row.label}</th><td>{number(row.runs)}</td><td>{row.errors ? number(row.errors) : "—"}</td>
      <td>{used(row)}</td>
      <td>{number(row.inputTokens + row.outputTokens)}</td><td>{usd(row.cost)}</td><td>{seconds(row.averageMs)}</td>
    </tr>)}</tbody>
  </table></div>;
}

function PriceDialog({ model, onClose, onSaved }: { model: string; onClose: () => void; onSaved: (prices: AiPrice[]) => void }) {
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    setBusy(true); setError("");
    try {
      const result = await api<{ prices: AiPrice[] }>("/organization/ai-prices", "POST", Object.fromEntries(data.entries()));
      onSaved(result.prices);
    } catch (cause) { setError(message(cause)); }
    finally { setBusy(false); }
  }
  return <Modal title="Precio de un modelo" onClose={onClose}>
    <form className="stack" onSubmit={save}>
      <p className="muted">El costo se calcula con el precio vigente en la fecha de cada ejecución. Copia los montos de la página de precios del proveedor.</p>
      <Field label="Modelo"><input name="model" defaultValue={model} required maxLength={80}/></Field>
      <Field label="Rige desde"><input name="effectiveFrom" type="date" required defaultValue={new Date().toISOString().slice(0, 10)}/></Field>
      <div className="ai-price-fields">
        <Field label="Entrada (USD por millón de tokens)"><input name="inputPerMillion" inputMode="decimal" required/></Field>
        <Field label="Salida (USD por millón de tokens)"><input name="outputPerMillion" inputMode="decimal" required/></Field>
      </div>
      {error && <p className="field-error" role="alert">{error}</p>}
      <div className="modal-actions"><Button variant="ghost" onClick={onClose}>Cancelar</Button><button className="button primary" disabled={busy}>Guardar precio</button></div>
    </form>
  </Modal>;
}

export function AiUsagePage() {
  const { url, navigate } = useNavigation();
  const { toast } = useFeedback();
  const month = /^\d{4}-\d{2}$/.test(url.searchParams.get("mes") || "") ? url.searchParams.get("mes")! : new Date().toISOString().slice(0, 7);
  const [usage, setUsage] = useState<Usage | null>(null), [error, setError] = useState(""), [pricing, setPricing] = useState<string | null>(null);
  useEffect(() => { setUsage(null); void api<Usage>(`/organization/ai-usage?mes=${month}`).then(setUsage, cause => setError(message(cause))); }, [month]);
  const go = (to: string) => navigate(`/organizacion/ia?mes=${to}`, true);
  const header = <PageHeader title="Uso de IA"
    description="Qué hizo la IA de la organización, para quién y cuánto costó. Nunca se guarda el texto que se le envía ni lo que responde."
    actions={<Button icon="plus" onClick={() => setPricing("")}>Registrar precio</Button>}/>;
  if (error) return <>{header}<ErrorState error={error}/></>;
  if (!usage) return <>{header}<Loading label="Sumando el uso del mes…" cards={4}/></>;
  const { summary, previous } = usage;
  const change = previous.runs ? Math.round((summary.total.runs - previous.runs) / previous.runs * 100) : null;
  return <>
    {header}
    <nav className="ai-usage-month" aria-label="Mes">
      <button type="button" className="button ghost small" aria-label="Mes anterior" onClick={() => go(shift(month, -1))}><Icon name="arrowLeft" size={16}/></button>
      <h2>{capitalized(monthName(usage.month))}</h2>
      <button type="button" className="button ghost small" aria-label="Mes siguiente" onClick={() => go(shift(month, 1))}><Icon name="arrowRight" size={16}/></button>
    </nav>
    {usage.unpriced.length > 0 && <p className="message-bar warning" role="status"><Icon name="alert" size={18}/>
      <span>Sin precio registrado: {usage.unpriced.join(", ")}. Su costo aparece como «No disponible».</span>
      <Button variant="ghost" onClick={() => setPricing(usage.unpriced[0])}>Registrar precio</Button></p>}
    <StatTiles items={[
      { label: "Ejecuciones", value: number(summary.total.runs), icon: "sparkles", hue: "violet" },
      { label: "Costo estimado", value: usd(summary.total.cost), icon: "spark", hue: "green" },
      { label: "Tokens", value: number(summary.total.inputTokens + summary.total.outputTokens), icon: "text", hue: "sky" },
      { label: "Propuestas usadas", value: acceptance(summary.total), icon: "check", hue: "teal" },
      { label: "Con error", value: number(summary.total.errors), icon: "alert", hue: "coral" },
    ]}/>
    <p className="muted">{change === null ? `En ${monthName(usage.previousMonth)} no hubo ejecuciones.` : `${change >= 0 ? `${change} % más` : `${-change} % menos`} ejecuciones que en ${monthName(usage.previousMonth)} (${number(previous.runs)}, ${usd(previous.cost)}).`}</p>
    {summary.total.runs === 0 ? <EmptyState icon="sparkles" title="Sin uso de IA este mes">Aquí aparecerán las propuestas de lecciones, las revisiones del mapa al plan y las demás tareas de IA.</EmptyState> : <>
      <Section title="Por tarea">
        <p className="muted">«Propuestas usadas» cuenta, de lo que la IA propuso al redactar, al mejorar lecciones, al sugerir campos de documentos y al interpretar reglas de horario, cuánto aceptó la persona. Las propuestas de lecciones y el mapa al plan aún no se miden.</p>
        <Breakdown title="Tarea" rows={summary.byTask}/>
      </Section>
      <Section title="Por curso"><Breakdown title="Curso" rows={summary.byCourse}/></Section>
      <Section title="Por persona"><Breakdown title="Persona" rows={summary.byPerson}/></Section>
      <Section title="Últimas ejecuciones">
        <div className="table-card" role="region" aria-label="Últimas ejecuciones" tabIndex={0}><table className="ai-usage-table">
          <thead><tr><th scope="col">Fecha</th><th scope="col">Tarea</th><th scope="col">Persona</th><th scope="col">Modelo</th><th scope="col">Tokens</th><th scope="col">Costo</th><th scope="col">Duración</th><th scope="col">Estado</th></tr></thead>
          <tbody>{usage.recent.map(run => <tr key={run.id}>
            <td>{formatInstant(run.createdAt)}</td><td>{aiTaskLabels[run.task]}</td><td>{run.userName || "Proceso automático"}</td>
            <td>{run.generator === "fixture" ? "Generador local" : run.model}</td>
            <td>{run.inputTokens === null ? "—" : number((run.inputTokens || 0) + (run.outputTokens || 0))}</td><td>{usd(run.cost)}</td><td>{seconds(run.durationMs)}</td>
            <td><StatusBadge tone={statusOf[run.status][1]}>{statusOf[run.status][0]}</StatusBadge></td>
          </tr>)}</tbody>
        </table></div>
      </Section>
    </>}
    <Section title="Precios">
      {usage.prices.length ? <ul className="ai-price-list">{usage.prices.map(price => <li key={`${price.model}-${price.effectiveFrom}`}>
        <strong>{price.model}</strong> desde el {price.effectiveFrom}: {usd(price.inputPerMillion)} de entrada y {usd(price.outputPerMillion)} de salida por millón de tokens
      </li>)}</ul> : <p className="muted">Aún no hay precios. Sin ellos, los tokens se registran y el costo aparece como «No disponible».</p>}
    </Section>
    {pricing !== null && <PriceDialog model={pricing} onClose={() => setPricing(null)} onSaved={prices => { setPricing(null); setUsage({ ...usage, prices }); toast({ message: "Precio guardado. Los costos se recalculan al volver a cargar." }); void api<Usage>(`/organization/ai-usage?mes=${month}`).then(setUsage); }}/>}
  </>;
}
