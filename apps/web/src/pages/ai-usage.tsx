import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import type { AiBudget, AiPrice, AiRun, AiTotals, AiUsageSummary } from "@happy-learners/domain";
import { aiCapabilities, aiDecidedTasks, aiTaskLabels, aiTasks } from "@happy-learners/domain";
import { api, message } from "../api";
import { useNavigation } from "../navigation";
import { formatInstant } from "../regional";
import { Modal, useFeedback } from "../ui/feedback";
import { Icon } from "../ui/icons";
import { Button, EmptyState, ErrorState, Field, Loading, PageHeader, Section, StatTiles, StatusBadge } from "../ui/primitives";
import type { Tone } from "../ui/primitives";

/**
 * Organización › Inteligencia artificial (1.4.0, docs/design/asistente-ia.md §6a; AIG-5): first what the AI does for
 * the institution, where, who decides and how much of what it proposes is used this month; then what it consumed and
 * cost at the prices administration sets, by task, course and person, and the latest runs. No text is kept.
 */
type Later = { proposals: { proposed: number; used: number; discarded: number }; bookMap: { reviewed: number; kept: number; changed: number } };
type Usage = { engine: "openai" | "fixture" | null; budget: AiBudget; later: Later; month: string; previousMonth: string; summary: AiUsageSummary; previous: AiTotals; prices: AiPrice[]; unpriced: string[]; recent: (AiRun & { cost: number | null })[] };

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

/** «Qué hace la IA»: every capability, also those not used this month, with its use and how much of it was used. */
function Capabilities({ summary, later }: { summary: AiUsageSummary; later: Later }) {
  return <div className="table-card" role="region" aria-label="Qué hace la IA" tabIndex={0}><table className="members-table ai-usage-table ai-capabilities">
    <caption className="sr-only">Qué hace la IA</caption>
    <thead><tr><th scope="col">Capacidad</th><th scope="col">Dónde</th><th scope="col">Quién decide</th><th scope="col">Ejecuciones</th><th scope="col">Propuestas usadas</th></tr></thead>
    <tbody>{aiTasks.map(task => {
      const row = summary.byTask.find(item => item.task === task), capability = aiCapabilities[task];
      return <tr key={task}>
        <th scope="row"><strong>{aiTaskLabels[task]}</strong><span className="muted small">{capability.does}</span></th>
        <td>{capability.where}</td><td>{capability.decides}</td>
        <td>{row ? number(row.runs) : "—"}</td>
        <td>{task === "lesson-review-explain" ? <span className="muted">No aplica</span>
          : task === "lesson-proposal" ? (later.proposals.proposed ? <>{`${number(later.proposals.used)} de ${number(later.proposals.proposed)} publicadas`}{later.proposals.discarded > 0 && <span className="muted small">{` · ${number(later.proposals.discarded)} descartadas`}</span>}</> : "—")
          : task === "book-map" ? (later.bookMap.reviewed ? <>{`${number(later.bookMap.kept)} de ${number(later.bookMap.reviewed)} confirmadas tal cual`}{later.bookMap.changed > 0 && <span className="muted small">{` · ${number(later.bookMap.changed)} corregidas`}</span>}</> : "—")
          : !aiDecidedTasks.includes(task) ? <span className="muted">No se mide aún</span> : row ? used(row) : "—"}</td>
      </tr>;
    })}</tbody>
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
  const header = <PageHeader title="Inteligencia artificial"
    description="Qué hace la IA en la organización, cuánto de lo que propone se usa y cuánto cuesta. La IA propone y una persona decide; nunca se guarda el texto que se le envía ni lo que responde."
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
    {!usage.engine && <p className="message-bar warning" role="status"><Icon name="alert" size={18}/>
      <span>La IA no está configurada en esta organización: sus funciones aparecen, pero responden que no está disponible.</span></p>}
    {/* AIG-6: past 80 % of the month's budget, administration is told before the AI stops. */}
    {usage.budget.level !== "ok" && <p className="message-bar warning" role="status"><Icon name="alert" size={18}/>
      <span>{usage.budget.level === "exhausted"
        ? `Se usó el presupuesto de IA de este mes (${usd(usage.budget.spent)} de ${usd(usage.budget.budget)}): la IA responde que no está disponible y las propuestas en cola esperan al mes próximo.`
        : `Se usó el ${Math.round(usage.budget.spent / usage.budget.budget * 100)} % del presupuesto de IA de este mes (${usd(usage.budget.spent)} de ${usd(usage.budget.budget)}).`}</span></p>}
    {usage.unpriced.length > 0 && <p className="message-bar warning" role="status"><Icon name="alert" size={18}/>
      <span>Sin precio registrado: {usage.unpriced.join(", ")}. Su costo aparece como «No disponible».</span>
      <Button variant="ghost" onClick={() => setPricing(usage.unpriced[0])}>Registrar precio</Button></p>}
    <StatTiles items={[
      { label: "Ejecuciones", value: number(summary.total.runs), icon: "sparkles", hue: "violet" },
      { label: "Propuestas usadas", value: acceptance(summary.total), icon: "check", hue: "teal" },
      { label: "Costo estimado", value: usd(summary.total.cost), icon: "spark", hue: "green" },
      { label: "Presupuesto de este mes", value: `${usd(usage.budget.spent)} de ${usd(usage.budget.budget)}`, icon: "clock", hue: "amber" },
      { label: "Con error", value: number(summary.total.errors), icon: "alert", hue: "coral" },
    ]}/>
    <p className="muted">{change === null ? `En ${monthName(usage.previousMonth)} no hubo ejecuciones.` : `${change >= 0 ? `${change} % más` : `${-change} % menos`} ejecuciones que en ${monthName(usage.previousMonth)} (${number(previous.runs)}, ${usd(previous.cost)}).`}</p>
    <Section title="Qué hace la IA">
      <p className="muted">«Propuestas usadas» cuenta, de lo que la IA propuso, cuánto aceptó la persona que lo pidió. Las propuestas de lecciones se cuentan como usadas al publicarse y el mapa al plan cuando el equipo confirma las páginas que la IA propuso.</p>
      <Capabilities summary={summary} later={usage.later}/>
    </Section>
    {summary.total.runs === 0 ? <EmptyState icon="sparkles" title="Sin uso de IA este mes">Aquí aparecerán el consumo y el costo de cada tarea, curso y persona.</EmptyState> : <>
      <Section title="Consumo y costo por tarea"><Breakdown title="Tarea" rows={summary.byTask}/></Section>
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
