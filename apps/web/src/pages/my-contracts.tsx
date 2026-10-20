import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import type { Contract, ContractPhase } from "@happy-learners/contracts";
import { compensationSummary, contractPhaseLabels, engagementLabels, locationLabels } from "@happy-learners/domain";
import { api, changed, contractRequired, message } from "../api";
import { Link, useNavigation } from "../navigation";
import { RichText } from "../RichText";
import { Modal, useFeedback } from "../ui/feedback";
import { Icon } from "../ui/icons";
import { EmptyState, ErrorState, Field, Loading, PageHeader, Section, StatusBadge } from "../ui/primitives";
import type { Tone } from "../ui/primitives";
import { StatusSteps } from "../ui/StatusSteps";
import type { StatusStep } from "../ui/StatusSteps";

const phaseTone: Record<ContractPhase, Tone> = {
  draft: "neutral", "awaiting-signature": "warning", scheduled: "info", "in-force": "success", ending: "warning",
  expired: "neutral", declined: "danger", voided: "neutral", terminated: "neutral", superseded: "neutral",
};

function contractSteps(contract: Contract): StatusStep[] {
  const signed = ["active", "terminated", "superseded", "expired"].includes(contract.status) || ["in-force", "ending", "expired", "terminated", "superseded"].includes(contract.phase);
  if (contract.status === "declined") return [{ id: "sent", label: "Enviado", state: "done" }, { id: "declined", label: "Rechazado", state: "current" }];
  if (contract.status === "voided") return [{ id: "sent", label: "Enviado", state: "done" }, { id: "voided", label: "Anulado", state: "current" }];
  return [
    { id: "sent", label: "Enviado", state: contract.status === "sent" ? "current" : "done" },
    { id: "signed", label: "Firmado", state: signed ? "done" : contract.status === "sent" ? "todo" : "current" },
    { id: "force", label: "Vigente", state: ["in-force", "ending"].includes(contract.phase) ? "current" : ["expired", "terminated", "superseded"].includes(contract.phase) ? "done" : "todo" },
  ];
}

export function ContractTermsSummary({ contract }: { contract: Pick<Contract, "terms" | "startDate" | "endDate" | "engagement"> }) {
  return <div className="stack">
    <p className="small">{engagementLabels[contract.engagement]} · {contract.terms.role} · {compensationSummary(contract.terms)}</p>
    <p className="muted small">Del {contract.startDate} al {contract.endDate || "plazo indefinido"}{contract.terms.weeklyHours ? ` · ${contract.terms.weeklyHours} h semanales` : ""}{contract.terms.location ? ` · ${locationLabels[contract.terms.location]}` : ""}</p>
  </div>;
}

export function ReceiptLink({ id, compact }: { id: string; compact?: boolean }) {
  return <a className={`button secondary${compact ? " small" : ""}`} href={`/api/contracts/${encodeURIComponent(id)}/receipt`} download><Icon name="download" size={16}/>Descargar constancia</a>;
}

export function SignContractDialog({ contract, onClose, onSigned }: { contract: Contract; onClose: () => void; onSigned: (contract: Contract) => void }) {
  const [busy, setBusy] = useState(false), [error, setError] = useState(""), [signed, setSigned] = useState<Contract | null>(null);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError("");
    const data = Object.fromEntries(new FormData(event.currentTarget));
    try {
      const result = await api<{ contract: Contract }>(`/contracts/${contract.id}/sign`, "POST", { signature: { fullName: data.fullName, password: data.password } });
      setSigned(result.contract);
      onSigned(result.contract);
    } catch (cause) { setError(message(cause)); setBusy(false); }
  }
  return <Modal title={signed ? "Firma registrada" : "Firmar contrato"} onClose={onClose} footer={signed ? <button type="button" className="button primary" onClick={onClose}>Cerrar</button> : undefined}>
    {signed ? <div className="stack">
      <p role="status">Firmaste «{signed.title}». La constancia incluye la huella SHA-256 del documento y las de ambas firmas, para que administración pueda verificarla.</p>
      <ReceiptLink id={signed.id}/>
    </div> : <form className="stack" onSubmit={submit}><fieldset className="stack" disabled={busy}>
      <p className="muted small">Firmas «{contract.title}» escribiendo tu nombre completo y confirmando tu identidad con la contraseña de tu cuenta.</p>
      {error && <p className="form-alert" role="alert"><Icon name="alert" size={18}/>{error}</p>}
      <Field label="Nombre completo"><input name="fullName" required minLength={3} maxLength={120} autoComplete="name"/></Field>
      <Field label="Contraseña de tu cuenta"><input name="password" type="password" required maxLength={128} autoComplete="current-password"/></Field>
      <div className="modal-actions"><button type="button" className="button ghost" onClick={onClose}>Cancelar</button><button className="button primary">{busy ? "Firmando…" : "Firmar"}</button></div>
    </fieldset></form>}
  </Modal>;
}

function DeclineContractDialog({ contract, onClose, onDeclined }: { contract: Contract; onClose: () => void; onDeclined: (contract: Contract) => void }) {
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError("");
    const reason = String(new FormData(event.currentTarget).get("reason") || "");
    try {
      const result = await api<{ contract: Contract }>(`/contracts/${contract.id}/decline`, "POST", { reason });
      onDeclined(result.contract);
    } catch (cause) { setError(message(cause)); setBusy(false); }
  }
  return <Modal title="Rechazar contrato" onClose={onClose}>
    <form className="stack" onSubmit={submit}><fieldset className="stack" disabled={busy}>
      <p>Cuenta a administración por qué no firmas «{contract.title}». El contrato quedará rechazado.</p>
      {error && <p className="form-alert" role="alert"><Icon name="alert" size={18}/>{error}</p>}
      <Field label="Motivo"><textarea name="reason" required minLength={3} maxLength={500} rows={3}/></Field>
      <div className="modal-actions"><button type="button" className="button ghost" onClick={onClose}>Cancelar</button><button className="button danger">Rechazar</button></div>
    </fieldset></form>
  </Modal>;
}

export function MyContractsPage() {
  const { url } = useNavigation();
  const { toast } = useFeedback();
  const [contracts, setContracts] = useState<Contract[] | null>(null), [error, setError] = useState("");
  const [open, setOpen] = useState<string | null>(url.hash.replace(/^#/, "") || null);
  const [signing, setSigning] = useState<Contract | null>(null), [declining, setDeclining] = useState<Contract | null>(null);
  const load = () => { setError(""); api<{ contracts: Contract[] }>("/me/contracts").then(result => setContracts(result.contracts)).catch(cause => setError(message(cause))); };
  useEffect(load, []);
  useEffect(() => {
    const id = url.hash.replace(/^#/, "");
    if (id) setOpen(id);
  }, [url.hash]);
  useEffect(() => {
    if (!open) return;
    document.getElementById(open)?.scrollIntoView({ block: "start" });
  }, [open, contracts]);
  const replace = (next: Contract) => { setContracts(current => (current || []).map(item => item.id === next.id ? next : item)); };
  if (error) return <><PageHeader title="Contratos" description="Tus acuerdos con la organización: vigencia, condiciones y firma."/><ErrorState error={error} retry={load}/></>;
  if (!contracts) return <><PageHeader title="Contratos" description="Tus acuerdos con la organización: vigencia, condiciones y firma."/><Loading label="Cargando tus contratos…" lines={4}/></>;
  return <>
    <PageHeader title="Contratos" description="Tus acuerdos con la organización: vigencia, condiciones y firma."/>
    {!contracts.length ? <EmptyState icon="file" title="Aún no tienes contratos">Cuando administración te envíe un contrato, lo verás aquí para leerlo y firmarlo.</EmptyState>
      : <ul className="contract-cards">{contracts.map(item => {
        const expanded = open === item.id;
        return <li key={item.id} id={item.id} className="panel">
          <div className="panel-header">
            <h2>{item.title}</h2>
            <StatusBadge tone={phaseTone[item.phase]}>{contractPhaseLabels[item.phase]}</StatusBadge>
          </div>
          <StatusSteps label={`Fases de ${item.title}`} steps={contractSteps(item)}/>
          <ContractTermsSummary contract={item}/>
          <div className="form-actions">
            <button type="button" className="button secondary small" onClick={() => setOpen(expanded ? null : item.id)} aria-expanded={expanded}>{expanded ? "Ocultar documento" : "Ver documento"}</button>
            {item.status === "sent" && <button type="button" className="button primary small" onClick={() => setSigning(item)}>Firmar</button>}
            {item.status === "sent" && <button type="button" className="button ghost small" onClick={() => setDeclining(item)}>Rechazar</button>}
            {item.documentSha256 && <ReceiptLink id={item.id} compact/>}
          </div>
          {expanded && <div className="contract-offer">
            {item.body && <RichText value={item.body} editable={false} toolbar={false} label={`Documento de ${item.title}`}/>}
            <Section title="Firmas">
              <p className="small">Organización: {item.organizationSignature ? `${item.organizationSignature.name} · ${item.organizationSignature.signedAt.slice(0, 10)}` : "Pendiente"}</p>
              <p className="small">Tú: {item.memberSignature ? `${item.memberSignature.name} · ${item.memberSignature.signedAt.slice(0, 10)}` : "Pendiente"}</p>
            </Section>
            {item.closeReason && <p className="muted small">Cierre: {item.closeReason}</p>}
          </div>}
        </li>;
      })}</ul>}
    {signing && <SignContractDialog contract={signing} onClose={() => setSigning(null)} onSigned={next => { replace(next); toast({ message: "Contrato firmado." }); }}/>}
    {declining && <DeclineContractDialog contract={declining} onClose={() => setDeclining(null)} onDeclined={next => { replace(next); setDeclining(null); toast({ message: "Contrato rechazado." }); }}/>}
  </>;
}

function pendingOf(contracts: Contract[]) {
  return contracts.filter(item => item.status === "sent");
}

/** Banner on every page while a contract waits for the person's signature. */
export function ContractBanner() {
  const { url } = useNavigation();
  const [pending, setPending] = useState<Contract[]>([]);
  const load = () => { api<{ contracts: Contract[] }>("/me/contracts").then(result => setPending(pendingOf(result.contracts))).catch(() => undefined); };
  useEffect(() => {
    load();
    const refresh = (event: Event) => {
      if (event.type === changed && !String((event as CustomEvent<string>).detail).includes("contract")) return;
      load();
    };
    addEventListener(contractRequired, refresh); addEventListener(changed, refresh);
    return () => { removeEventListener(contractRequired, refresh); removeEventListener(changed, refresh); };
  }, []);
  const first = pending[0];
  if (!first || url.pathname.startsWith("/mi-cuenta/contratos")) return null;
  return <div className="message-bar warning" role="region" aria-label="Contrato pendiente de firma"><Icon name="shield" size={20}/><div>
    <strong>Firma tu contrato «{first.title}»</strong>
    <p>Antes de impartir clases, lee y firma el contrato que te envió administración.{pending.length > 1 ? ` Tienes ${pending.length} contratos por firmar.` : ""}</p>
    <Link className="button primary small" href={`/mi-cuenta/contratos#${first.id}`}>Leer y firmar</Link>
  </div></div>;
}

/** Card on Inicio when a contract is waiting for a signature. */
export function PendingContractHomeCard() {
  const [pending, setPending] = useState<Contract[] | null>(null);
  useEffect(() => { api<{ contracts: Contract[] }>("/me/contracts").then(result => setPending(pendingOf(result.contracts))).catch(() => setPending([])); }, []);
  const first = pending?.[0];
  if (!first) return null;
  return <Section title="Contrato por firmar" className="order-1">
    <div className="continue-card">
      <div className="continue-text">
        <span className="eyebrow">Pendiente de tu firma</span>
        <h3>{first.title}</h3>
        <p className="continue-meta"><StatusBadge tone="warning">{contractPhaseLabels[first.phase]}</StatusBadge> · {first.terms.role}</p>
      </div>
      <Link className="button primary" href={`/mi-cuenta/contratos#${first.id}`}>Leer y firmar<Icon name="arrowRight" size={18}/></Link>
    </div>
  </Section>;
}

export function ContractRequiredDialog({ message: text, contractId, onClose }: { message: string; contractId: string | null; onClose: () => void }) {
  return <Modal title="Necesitas un contrato vigente" onClose={onClose} footer={<Link className="button primary" href={contractId ? `/mi-cuenta/contratos#${contractId}` : "/mi-cuenta/contratos"} onClick={onClose}>Ir a tus contratos</Link>}>
    <p>{text}</p>
  </Modal>;
}
