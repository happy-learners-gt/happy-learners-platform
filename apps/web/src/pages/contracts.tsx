import { useEffect, useRef, useState } from "react";
import type { ChangeEvent, FormEvent } from "react";
import type { CompensationKind, Contract, ContractEngagement, ContractPhase, ContractTemplate, ContractTemplateVersion, ContractTermField, ContractTerms, ContractVerification, Member, RichTextDocument, WorkLocation } from "@happy-learners/contracts";
import {
  compensationAllowed, compensationKinds, compensationLabels, compensationPeriods, compensationSummary, contractEngagements,
  contractPhaseLabels, contractTermFields, contractVariables, contractValues, engagementLabels, locationLabels, mergeContract,
  periodLabels, workLocations,
} from "@happy-learners/domain";
import type { Editor } from "@tiptap/react";
import { api, message } from "../api";
import { Link, useNavigation, useUnsavedChanges } from "../navigation";
import { useSession } from "../session";
import { RichText } from "../RichText";
import { Drawer, Modal, useFeedback } from "../ui/feedback";
import { Icon } from "../ui/icons";
import { EmptyState, ErrorState, Field, Loading, PageHeader, PrimaryAction, Section, StatusBadge } from "../ui/primitives";
import type { Tone } from "../ui/primitives";
import { StatusSteps } from "../ui/StatusSteps";
import type { StatusStep } from "../ui/StatusSteps";
import { LegalSettings } from "./legal";
import { ReceiptLink } from "./my-contracts";

const tabs = [
  { id: "plantillas", label: "Plantillas", href: "/contratos" },
  { id: "contratos", label: "Contratos", href: "/contratos#contratos" },
  { id: "politicas", label: "Políticas", href: "/contratos#politicas" },
  { id: "ajustes", label: "Ajustes", href: "/contratos#ajustes" },
] as const;
type Tab = (typeof tabs)[number]["id"];
const tabOf = (hash: string): Tab => ({ "": "plantillas", "#plantillas": "plantillas", "#contratos": "contratos", "#politicas": "politicas", "#ajustes": "ajustes" } as const)[hash] || "plantillas";

const phaseTone: Record<ContractPhase, Tone> = {
  draft: "neutral", "awaiting-signature": "warning", scheduled: "info", "in-force": "success", ending: "warning",
  expired: "neutral", declined: "danger", voided: "neutral", terminated: "neutral", superseded: "neutral",
};
const filterPhases: ContractPhase[] = ["awaiting-signature", "in-force", "scheduled", "ending", "expired", "terminated", "declined", "voided", "superseded", "draft"];
const fieldLabels: Record<ContractTermField, string> = {
  role: "Puesto", compensation: "Remuneración", term: "Plazo", weeklyHours: "Horas semanales",
  noticeDays: "Días de preaviso", probationDays: "Periodo de prueba", location: "Modalidad", notes: "Notas",
};
const variableLabels: Record<(typeof contractVariables)[number], string> = {
  "persona.nombre": "Nombre de la persona", "persona.correo": "Correo", "organizacion.nombre": "Organización",
  "contrato.tipo": "Tipo de relación", "contrato.puesto": "Puesto", "contrato.inicio": "Inicio", "contrato.fin": "Fin",
  "contrato.remuneracion": "Remuneración", "contrato.horas_semanales": "Horas semanales", "contrato.preaviso": "Preaviso",
  "contrato.periodo_prueba": "Periodo de prueba", "contrato.modalidad": "Modalidad",
};

const starterBody = (engagement: ContractEngagement): RichTextDocument => ({
  type: "doc",
  content: [
    { type: "heading", attrs: { level: 2 }, content: [{ type: "text", text: "Objeto" }] },
    { type: "paragraph", content: [{ type: "text", text: "{{persona.nombre}} se incorpora a {{organizacion.nombre}} en una {{contrato.tipo}} como {{contrato.puesto}}, a partir del {{contrato.inicio}}." }] },
    { type: "heading", attrs: { level: 2 }, content: [{ type: "text", text: "Condiciones" }] },
    { type: "paragraph", content: [{ type: "text", text: engagement === "volunteer" ? "La actividad es ad honorem: {{contrato.remuneracion}}." : "La remuneración es {{contrato.remuneracion}}." }] },
  ],
});
export const defaultTerms = (engagement: ContractEngagement): ContractTerms => ({
  role: "Educador",
  compensation: engagement === "volunteer" ? { kind: "none" } : { kind: engagement === "employment" ? "fixed" : "per-session", amount: "150", currency: "GTQ", ...(engagement === "employment" ? { period: "month" as const } : {}) },
  term: engagement === "employment" ? { kind: "fixed", months: 10 } : { kind: "indefinite" },
  weeklyHours: 6, location: "hybrid",
});

export function ContractsPage() {
  const { member } = useSession();
  const { url } = useNavigation();
  const tab = tabOf(url.hash);
  const [creatingTemplate, setCreatingTemplate] = useState(false), [creatingContract, setCreatingContract] = useState(false), [editingTemplate, setEditingTemplate] = useState(false);
  // PPL-01: «Crear contrato» from a person's incorporation opens the dialog with that person chosen.
  const persona = url.searchParams.get("persona") || undefined;
  useEffect(() => { if (persona && tab === "contratos") setCreatingContract(true); }, [persona, tab]);
  if (member.role !== "admin") return <><PageHeader title="Contratos y políticas"/><EmptyState icon="shield" title="Esta sección es para administración">Pide a administración cualquier cambio de plantillas, contratos o políticas.</EmptyState></>;
  const primary = tab === "plantillas" && !editingTemplate
    ? <PrimaryAction icon="plus" onClick={() => setCreatingTemplate(true)}>Nueva plantilla</PrimaryAction>
    : tab === "contratos" ? <PrimaryAction icon="plus" onClick={() => setCreatingContract(true)}>Nuevo contrato</PrimaryAction> : undefined;
  return <>
    <PageHeader title="Contratos y políticas" description="Plantillas, contratos del equipo, términos y privacidad." primary={primary}/>
    <nav className="tabs scrollable-tabs" aria-label="Secciones de contratos">
      {tabs.map(item => <Link key={item.id} href={item.href} className="tab" aria-current={tab === item.id ? "page" : undefined}>{item.label}</Link>)}
    </nav>
    {tab === "plantillas" && <TemplatesTab creating={creatingTemplate} onCreating={setCreatingTemplate} onEditing={setEditingTemplate}/>}
    {tab === "contratos" && <ContractsTab creating={creatingContract} onCreating={setCreatingContract} preferred={persona}/>}
    {tab === "politicas" && <LegalSettings/>}
    {tab === "ajustes" && <SettingsTab/>}
  </>;
}

function TemplatesTab({ creating, onCreating, onEditing }: { creating: boolean; onCreating: (value: boolean) => void; onEditing: (value: boolean) => void }) {
  const { toast } = useFeedback();
  const [templates, setTemplates] = useState<ContractTemplate[] | null>(null), [error, setError] = useState("");
  const [editing, setEditing] = useState<ContractTemplate | null>(null);
  const load = () => { setError(""); api<{ templates: ContractTemplate[] }>("/contract-templates").then(result => setTemplates(result.templates)).catch(cause => setError(message(cause))); };
  useEffect(load, []);
  useEffect(() => { onEditing(!!editing); return () => onEditing(false); }, [editing, onEditing]);
  if (error) return <ErrorState error={error} retry={load}/>;
  if (!templates) return <Loading label="Cargando plantillas…" lines={4}/>;
  if (editing) return <TemplateEditor template={editing} onClose={() => { setEditing(null); load(); }}/>;
  return <>
    {!templates.length ? <EmptyState icon="file" title="Aún no hay plantillas" action={<button type="button" className="button primary" onClick={() => onCreating(true)}>Crear la primera</button>}>Una plantilla fija el tipo de relación, las cláusulas y las condiciones por omisión. Luego la usas en cada contrato.</EmptyState>
      : <ul className="template-grid">{templates.map(item => <li key={item.id} className="panel">
        <div className="panel-header"><h2>{item.name}</h2>{item.status === "archived" ? <StatusBadge>Archivada</StatusBadge> : item.current ? <StatusBadge tone="success">Versión {item.current.version}</StatusBadge> : <StatusBadge>Sin publicar</StatusBadge>}</div>
        <p className="muted small">{engagementLabels[item.engagement]}{item.description ? ` · ${item.description}` : ""}</p>
        <p className="small">{item.contracts ? `${item.contracts} ${item.contracts === 1 ? "contrato" : "contratos"}` : "Sin contratos"}{item.draft ? " · hay un borrador" : ""}</p>
        <div className="form-actions"><button type="button" className="button secondary small" onClick={() => setEditing(item)}>Abrir editor</button>
          <button type="button" className="button ghost small" onClick={() => void api(`/contract-templates/${item.id}`, "PUT", { status: item.status === "archived" ? "active" : "archived" }).then(() => { toast({ message: item.status === "archived" ? "Plantilla restaurada." : "Plantilla archivada." }); load(); }, cause => toast({ tone: "error", message: message(cause) }))}>{item.status === "archived" ? "Restaurar" : "Archivar"}</button></div>
      </li>)}</ul>}
    {creating && <CreateTemplateDialog onClose={() => onCreating(false)} onCreated={template => { onCreating(false); setEditing(template); }}/>}
  </>;
}

function CreateTemplateDialog({ onClose, onCreated }: { onClose: () => void; onCreated: (template: ContractTemplate) => void }) {
  const [busy, setBusy] = useState(false), [error, setError] = useState(""), [engagement, setEngagement] = useState<ContractEngagement>("volunteer");
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError("");
    const data = Object.fromEntries(new FormData(event.currentTarget));
    try {
      const result = await api<{ template: ContractTemplate }>("/contract-templates", "POST", {
        template: { name: data.name, engagement, description: data.description },
        version: { title: String(data.name), body: starterBody(engagement), defaults: defaultTerms(engagement), editable: engagement === "volunteer" ? ["role", "term", "weeklyHours", "location", "notes"] : ["role", "compensation", "term", "weeklyHours", "location", "notes"] },
      });
      onCreated(result.template);
    } catch (cause) { setError(message(cause)); setBusy(false); }
  }
  return <Modal title="Nueva plantilla" onClose={onClose}>
    <form className="stack" onSubmit={submit}><fieldset className="stack" disabled={busy}>
      {error && <p className="form-alert" role="alert"><Icon name="alert" size={18}/>{error}</p>}
      <Field label="Nombre"><input name="name" required minLength={3} maxLength={120} autoComplete="off"/></Field>
      <Field label="Tipo de relación"><select name="engagement" value={engagement} onChange={event => setEngagement(event.target.value as ContractEngagement)}>{contractEngagements.map(item => <option key={item} value={item}>{engagementLabels[item]}</option>)}</select></Field>
      <Field label="Descripción" optional><input name="description" maxLength={500}/></Field>
      <div className="modal-actions"><button type="button" className="button ghost" onClick={onClose}>Cancelar</button><button className="button primary">{busy ? "Creando…" : "Crear y editar"}</button></div>
    </fieldset></form>
  </Modal>;
}

function TemplateEditor({ template, onClose }: { template: ContractTemplate; onClose: () => void }) {
  const { toast } = useFeedback();
  const { organization } = useSession();
  const source = template.draft || template.current;
  const editor = useRef<Editor | null>(null);
  const [title, setTitle] = useState(source?.title || template.name);
  const [body, setBody] = useState<RichTextDocument>(source?.body || starterBody(template.engagement));
  const [defaults, setDefaults] = useState<ContractTerms>(source?.defaults || defaultTerms(template.engagement));
  const [editable, setEditable] = useState<ContractTermField[]>(source?.editable || ["role", "term", "weeklyHours", "location", "notes"]);
  const [dirty, setDirty] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState("");
  const [preview, setPreview] = useState(false), [publishing, setPublishing] = useState(false), [effectiveFrom, setEffectiveFrom] = useState("");
  const [history, setHistory] = useState<ContractTemplateVersion[] | null>(null);
  useUnsavedChanges(dirty);
  useEffect(() => { api<{ history: ContractTemplateVersion[] }>(`/contract-templates/${template.id}`).then(result => setHistory(result.history)).catch(() => setHistory([])); }, [template.id]);
  const mark = () => setDirty(true);
  async function save() {
    setBusy(true); setError("");
    try {
      await api(`/contract-templates/${template.id}/draft`, "PUT", { title, body, defaults, editable });
      setDirty(false); toast({ message: "Borrador guardado." });
    } catch (cause) { setError(message(cause)); }
    finally { setBusy(false); }
  }
  async function publish() {
    setBusy(true); setError("");
    try {
      if (dirty) await api(`/contract-templates/${template.id}/draft`, "PUT", { title, body, defaults, editable });
      await api(`/contract-templates/${template.id}/publish`, "POST", { effectiveFrom: effectiveFrom || undefined });
      setDirty(false); setPublishing(false); toast({ message: "Versión publicada. Los contratos nuevos usarán esta plantilla." }); onClose();
    } catch (cause) { setError(message(cause)); }
    finally { setBusy(false); }
  }
  const sample = mergeContract(body, contractValues({
    partyName: "Ana López", partyEmail: "ana.lopez@ejemplo.test", organization: organization?.name || "la organización",
    engagement: template.engagement, terms: defaults, startDate: "2026-11-01", endDate: defaults.term.kind === "fixed" ? "2027-08-31" : null,
    formatDate: date => date,
  }));
  return <div className="template-editor">
    <div className="stack">
      <p><button type="button" className="link-button" onClick={onClose}>Volver a plantillas</button></p>
      <h2>{template.name}</h2>
      <p className="muted small">{engagementLabels[template.engagement]}{template.current ? ` · vigente: versión ${template.current.version}` : " · sin versión publicada"}</p>
      {error && <p className="form-alert" role="alert"><Icon name="alert" size={18}/>{error}</p>}
      <Field label="Título del documento"><input value={title} maxLength={160} onChange={event => { setTitle(event.target.value); mark(); }}/></Field>
      <div className="field">
        <span className="field-label">Cláusulas</span>
        <RichText value={body} onChange={doc => { setBody(doc); mark(); }} onReady={current => { editor.current = current; }} label="Cláusulas de la plantilla" placeholder="Escribe las cláusulas. Inserta variables desde el panel."/>
      </div>
      <div className="form-actions">
        <button type="button" className="button secondary" disabled={busy} onClick={() => void save()}>{busy ? "Guardando…" : "Guardar borrador"}</button>
        <button type="button" className="button secondary" onClick={() => setPreview(true)}>Vista previa</button>
        <button type="button" className="button primary" disabled={busy} onClick={() => setPublishing(true)}>Publicar</button>
      </div>
    </div>
    <aside className="template-editor-side" aria-label="Variables y condiciones">
      <Section title="Variables">
        <p className="muted small">Se reemplazan al enviar el contrato. Pulsa una para insertarla en el cursor.</p>
        <ul className="variable-list">{contractVariables.map(key => <li key={key}>
          <button type="button" className="button ghost small" onClick={() => editor.current?.chain().focus().insertContent(`{{${key}}}`).run()}>{variableLabels[key]}</button>
          <code>{`{{${key}}}`}</code>
        </li>)}</ul>
      </Section>
      <Section title="Condiciones por omisión">
        <TermsFields engagement={template.engagement} value={defaults} onChange={next => { setDefaults(next); mark(); }}/>
      </Section>
      <Section title="Campos editables por contrato">
        <ul className="plain-list">{contractTermFields.filter(field => field !== "compensation" || template.engagement !== "volunteer").map(field => <li key={field}>
          <label className="legal-check"><input type="checkbox" checked={editable.includes(field)} onChange={event => { setEditable(current => event.target.checked ? [...current, field] : current.filter(item => item !== field)); mark(); }}/><span>{fieldLabels[field]}</span></label>
        </li>)}</ul>
      </Section>
      {history && history.length > 0 && <Section title="Historial de versiones">
        <ol className="plain-list">{history.map(item => <li key={item.id} className="muted small">Versión {item.version} · {item.title}{item.effectiveFrom ? ` · desde ${item.effectiveFrom}` : ""}{item.publishedBy ? ` · ${item.publishedBy}` : ""}</li>)}</ol>
      </Section>}
    </aside>
    {preview && <Modal title="Vista previa" onClose={() => setPreview(false)} wide footer={<button type="button" className="button primary" onClick={() => setPreview(false)}>Cerrar</button>}>
      <p className="muted small">Con datos de ejemplo. El contrato real combina las variables de la persona.</p>
      <RichText value={sample} editable={false} toolbar={false} label="Vista previa del contrato"/>
      <p className="small">{compensationSummary(defaults)} · {defaults.term.kind === "fixed" ? `plazo de ${defaults.term.months || "—"} meses` : "plazo indefinido"}</p>
    </Modal>}
    {publishing && <Modal title="Publicar plantilla" onClose={() => setPublishing(false)} footer={<><button type="button" className="button ghost" onClick={() => setPublishing(false)}>Cancelar</button><button type="button" className="button primary" disabled={busy} onClick={() => void publish()}>{busy ? "Publicando…" : "Publicar versión"}</button></>}>
      <p>Esta versión quedará vigente para los contratos que prepares a partir de su fecha. El texto publicado no se edita; para cambiarlo, crea un borrador nuevo.</p>
      <Field label="Vigente desde" hint="Hoy o después."><input type="date" value={effectiveFrom} onChange={event => setEffectiveFrom(event.target.value)}/></Field>
    </Modal>}
  </div>;
}

export function TermsFields({ engagement, value, onChange, allowed }: { engagement: ContractEngagement; value: ContractTerms; onChange: (value: ContractTerms) => void; allowed?: readonly ContractTermField[] }) {
  const can = (field: ContractTermField) => !allowed || allowed.includes(field);
  const set = (patch: Partial<ContractTerms>) => onChange({ ...value, ...patch });
  const pay = value.compensation;
  const kinds = compensationKinds.filter(kind => compensationAllowed(engagement, kind));
  return <div className="stack">
    {can("role") && <Field label="Puesto"><input value={value.role} maxLength={120} onChange={event => set({ role: event.target.value })}/></Field>}
    {can("compensation") && engagement !== "volunteer" && <>
      <Field label="Remuneración"><select value={pay.kind} onChange={event => set({ compensation: { kind: event.target.value as CompensationKind, amount: pay.amount || "150", currency: pay.currency || "GTQ", period: pay.period || "month" } })}>
        {kinds.map(kind => <option key={kind} value={kind}>{compensationLabels[kind]}</option>)}
      </select></Field>
      {pay.kind !== "none" && <div className="form-grid-12">
        <div className="form-span-6"><Field label="Importe"><input inputMode="decimal" value={pay.amount || ""} onChange={event => set({ compensation: { ...pay, amount: event.target.value } })}/></Field></div>
        <div className="form-span-6"><Field label="Moneda"><input value={pay.currency || "GTQ"} maxLength={3} onChange={event => set({ compensation: { ...pay, currency: event.target.value.toUpperCase() } })}/></Field></div>
        {pay.kind === "fixed" && <div className="form-span-6"><Field label="Periodo"><select value={pay.period || "month"} onChange={event => set({ compensation: { ...pay, period: event.target.value as ContractTerms["compensation"]["period"] } })}>{compensationPeriods.map(item => <option key={item} value={item}>{periodLabels[item]}</option>)}</select></Field></div>}
      </div>}
    </>}
    {can("term") && <Field label="Plazo"><select value={value.term.kind} onChange={event => set({ term: { kind: event.target.value as "indefinite" | "fixed", months: value.term.months || 10 } })}>
      <option value="indefinite">Indefinido</option><option value="fixed">Plazo fijo</option>
    </select></Field>}
    {can("term") && value.term.kind === "fixed" && <Field label="Meses"><input type="number" min={1} max={120} value={value.term.months || 10} onChange={event => set({ term: { kind: "fixed", months: Number(event.target.value) } })}/></Field>}
    {can("weeklyHours") && <Field label="Horas semanales" optional><input type="number" min={0} max={80} value={value.weeklyHours ?? ""} onChange={event => set({ weeklyHours: event.target.value === "" ? undefined : Number(event.target.value) })}/></Field>}
    {can("noticeDays") && <Field label="Días de preaviso" optional><input type="number" min={0} max={365} value={value.noticeDays ?? ""} onChange={event => set({ noticeDays: event.target.value === "" ? undefined : Number(event.target.value) })}/></Field>}
    {can("probationDays") && <Field label="Periodo de prueba (días)" optional><input type="number" min={0} max={365} value={value.probationDays ?? ""} onChange={event => set({ probationDays: event.target.value === "" ? undefined : Number(event.target.value) })}/></Field>}
    {can("location") && <Field label="Modalidad" optional><select value={value.location || ""} onChange={event => set({ location: (event.target.value || undefined) as WorkLocation | undefined })}>
      <option value="">Sin indicar</option>{workLocations.map(item => <option key={item} value={item}>{locationLabels[item]}</option>)}
    </select></Field>}
    {can("notes") && <Field label="Notas" optional><textarea rows={2} maxLength={1000} value={value.notes || ""} onChange={event => set({ notes: event.target.value || undefined })}/></Field>}
  </div>;
}

function ContractsTab({ creating, onCreating, preferred }: { creating: boolean; onCreating: (value: boolean) => void; preferred?: string }) {
  const { toast, confirm } = useFeedback();
  const [contracts, setContracts] = useState<Contract[] | null>(null), [templates, setTemplates] = useState<ContractTemplate[]>([]);
  const [people, setPeople] = useState<Member[]>([]);
  const [error, setError] = useState(""), [phase, setPhase] = useState(""), [person, setPerson] = useState(""), [template, setTemplate] = useState("");
  const [selected, setSelected] = useState<Contract | null>(null);
  const load = () => {
    setError("");
    Promise.all([api<{ contracts: Contract[] }>("/contracts"), api<{ templates: ContractTemplate[] }>("/contract-templates"), api<{ members: Member[] }>("/members")])
      .then(([listed, catalog, roster]) => { setContracts(listed.contracts); setTemplates(catalog.templates); setPeople(roster.members.filter(item => item.active !== false)); })
      .catch(cause => setError(message(cause)));
  };
  useEffect(load, []);
  const rows = (contracts || []).filter(item => (!phase || item.phase === phase) && (!person || item.userId === person) && (!template || item.templateId === template));
  if (error) return <ErrorState error={error} retry={load}/>;
  if (!contracts) return <Loading label="Cargando contratos…" lines={4}/>;
  return <>
    <div className="table-toolbar contract-filters">
      <label className="onboarding-filter"><span>Fase</span><select value={phase} onChange={event => setPhase(event.target.value)}><option value="">Todas</option>{filterPhases.map(item => <option key={item} value={item}>{contractPhaseLabels[item]}</option>)}</select></label>
      <label className="onboarding-filter"><span>Persona</span><select value={person} onChange={event => setPerson(event.target.value)}><option value="">Todas</option>{people.map(item => <option key={item.id} value={item.id}>{item.displayName || item.username}</option>)}</select></label>
      <label className="onboarding-filter"><span>Plantilla</span><select value={template} onChange={event => setTemplate(event.target.value)}><option value="">Todas</option>{templates.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
    </div>
    {!rows.length ? <EmptyState compact icon="file" title="Ningún contrato coincide">{contracts.length ? "Prueba otro filtro." : "Prepara un contrato desde una plantilla publicada."}</EmptyState>
      : <div className="table-card" role="region" aria-label="Contratos" tabIndex={0}><table className="members-table">
        <caption className="sr-only">Contratos del equipo, su fase y sus fechas</caption>
        <thead><tr><th scope="col">Persona</th><th scope="col">Documento</th><th scope="col">Fase</th><th scope="col">Inicio</th><th scope="col">Fin</th><th scope="col"><span className="sr-only">Abrir</span></th></tr></thead>
        <tbody>{rows.map(item => <tr key={item.id}>
          <th scope="row">{item.partyName}</th>
          <td>{item.title}</td>
          <td><StatusBadge tone={phaseTone[item.phase]}>{contractPhaseLabels[item.phase]}</StatusBadge></td>
          <td>{item.startDate}</td>
          <td>{item.endDate || "Indefinido"}</td>
          <td className="cell-actions"><button type="button" className="button ghost small" onClick={() => setSelected(item)}>Ver</button></td>
        </tr>)}</tbody>
      </table></div>}
    {selected && <ContractDetail contract={selected} onClose={() => setSelected(null)} onChanged={next => { setSelected(next); load(); }} onGone={() => { setSelected(null); load(); }} toast={toast} confirm={confirm}/>}
    {creating && <NewContractDialog people={people} templates={templates} preferred={preferred} onClose={() => onCreating(false)} onCreated={item => { onCreating(false); setSelected(item); load(); }}/>}
    <ContractVerify/>
  </>;
}

function contractSteps(contract: Contract): StatusStep[] {
  const order: { id: string; label: string; done: boolean; current: boolean }[] = [
    { id: "draft", label: "Borrador", done: contract.status !== "draft", current: contract.status === "draft" },
    { id: "sent", label: "Enviado", done: !["draft", "voided"].includes(contract.status) && contract.status !== "sent" ? true : contract.status === "sent" ? false : false, current: contract.status === "sent" },
    { id: "signed", label: "Firmado", done: ["active", "terminated", "superseded", "expired"].includes(contract.status) || ["in-force", "ending", "expired", "terminated", "superseded"].includes(contract.phase), current: contract.status === "active" && contract.phase === "scheduled" },
    { id: "force", label: "Vigente", done: ["in-force", "ending", "expired", "terminated", "superseded"].includes(contract.phase), current: contract.phase === "in-force" || contract.phase === "ending" },
  ];
  if (contract.status === "declined") return [{ id: "sent", label: "Enviado", state: "done" }, { id: "declined", label: "Rechazado", state: "current" }, { id: "force", label: "Vigente", state: "todo" }];
  if (contract.status === "voided") return [{ id: "draft", label: "Borrador", state: "done" }, { id: "voided", label: "Anulado", state: "current" }];
  return order.map(item => ({ id: item.id, label: item.label, state: item.done ? "done" : item.current ? "current" : "todo" }));
}

function ContractDetail({ contract, onClose, onChanged, onGone, toast, confirm }: {
  contract: Contract; onClose: () => void; onChanged: (contract: Contract) => void; onGone: () => void;
  toast: (input: { tone?: "error" | "info"; message: string }) => void; confirm: (input: { title: string; body?: string; confirm: string; danger?: boolean }) => Promise<boolean>;
}) {
  const [busy, setBusy] = useState(""), [signing, setSigning] = useState(false);
  async function act(path: string, body?: Record<string, unknown>, gone = false) {
    setBusy(path);
    try {
      const result = await api<{ contract?: Contract; ok?: boolean }>(`/contracts/${contract.id}${path}`, path === "" ? "DELETE" : "POST", body);
      toast({ message: "Contrato actualizado." });
      if (gone || !result.contract) onGone(); else onChanged(result.contract);
    } catch (cause) { toast({ tone: "error", message: message(cause) }); }
    finally { setBusy(""); setSigning(false); }
  }
  return <Drawer title={contract.title} onClose={onClose}>
    <div className="stack">
      <StatusSteps label="Fases del contrato" steps={contractSteps(contract)}/>
      <p><StatusBadge tone={phaseTone[contract.phase]}>{contractPhaseLabels[contract.phase]}</StatusBadge> · {engagementLabels[contract.engagement]} · {contract.partyName}</p>
      {contract.body && <RichText value={contract.body} editable={false} toolbar={false} label="Documento del contrato"/>}
      <Section title="Condiciones">
        <p className="small">{contract.terms.role} · {compensationSummary(contract.terms)}</p>
        <p className="muted small">Del {contract.startDate} al {contract.endDate || "plazo indefinido"}{contract.terms.weeklyHours ? ` · ${contract.terms.weeklyHours} h semanales` : ""}{contract.terms.location ? ` · ${locationLabels[contract.terms.location]}` : ""}</p>
      </Section>
      {contract.documentSha256 && <p className="muted small">Huella del documento: <code>{contract.documentSha256}</code></p>}
      <Section title="Firmas">
        <p className="small">Organización: {contract.organizationSignature ? `${contract.organizationSignature.name} · ${contract.organizationSignature.signedAt.slice(0, 10)}` : "Pendiente"}</p>
        <p className="small">Persona: {contract.memberSignature ? `${contract.memberSignature.name} · ${contract.memberSignature.signedAt.slice(0, 10)}` : "Pendiente"}</p>
        {contract.documentSha256 && <ReceiptLink id={contract.id} compact/>}
      </Section>
      {contract.closeReason && <p className="muted small">Cierre: {contract.closeReason}</p>}
      <div className="form-actions">
        {contract.status === "draft" && <button type="button" className="button primary" disabled={!!busy} onClick={() => setSigning(true)}>Enviar</button>}
        {contract.status === "draft" && <button type="button" className="button ghost" disabled={!!busy} onClick={async () => { if (await confirm({ title: "¿Descartar este borrador?", confirm: "Descartar", danger: true })) void act("", undefined, true); }}>Descartar borrador</button>}
        {(contract.status === "draft" || contract.status === "sent") && <button type="button" className="button danger" disabled={!!busy} onClick={() => { const why = window.prompt("Motivo de la anulación"); if (why) void act("/void", { reason: why }); }}>Anular</button>}
        {contract.status === "active" && <button type="button" className="button secondary" disabled={!!busy} onClick={() => { const date = window.prompt("Fecha de terminación (AAAA-MM-DD)", contract.startDate); const why = date ? window.prompt("Motivo de la terminación") : null; if (date && why) void act("/terminate", { terminationDate: date, reason: why }); }}>Terminar</button>}
        {contract.status === "active" && <button type="button" className="button secondary" disabled={!!busy} onClick={async () => {
          if (!await confirm({ title: "¿Preparar una enmienda?", body: "Se crea un borrador que, al firmarse, reemplaza este contrato.", confirm: "Preparar enmienda" })) return;
          void act("/amend", { templateId: contract.templateId, startDate: contract.startDate, endDate: contract.endDate, terms: {} });
        }}>Enmendar</button>}
      </div>
    </div>
    {signing && <SignAndSend onClose={() => setSigning(false)} onSubmit={signature => void act("/send", { signature })} busy={busy === "/send"}/>}
  </Drawer>;
}

function SignAndSend({ onClose, onSubmit, busy }: { onClose: () => void; onSubmit: (signature: { fullName: string; password: string }) => void; busy: boolean }) {
  const [error, setError] = useState("");
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = Object.fromEntries(new FormData(event.currentTarget));
    const fullName = String(data.fullName || ""), password = String(data.password || "");
    if (fullName.trim().length < 3 || !password) { setError("Escribe tu nombre completo y tu contraseña."); return; }
    onSubmit({ fullName, password });
  }
  return <Modal title="Firmar y enviar" onClose={onClose}>
    <form className="stack" onSubmit={submit}><fieldset className="stack" disabled={busy}>
      {error && <p className="form-alert" role="alert"><Icon name="alert" size={18}/>{error}</p>}
      <p className="muted small">Firmas en nombre de la organización. La persona recibirá el contrato para firmarlo.</p>
      <Field label="Nombre completo"><input name="fullName" required minLength={3} maxLength={120} autoComplete="name"/></Field>
      <Field label="Contraseña de tu cuenta"><input name="password" type="password" required maxLength={128} autoComplete="current-password"/></Field>
      <div className="modal-actions"><button type="button" className="button ghost" onClick={onClose}>Cancelar</button><button className="button primary">{busy ? "Enviando…" : "Firmar y enviar"}</button></div>
    </fieldset></form>
  </Modal>;
}

function NewContractDialog({ people, templates, preferred, onClose, onCreated }: { people: Member[]; templates: ContractTemplate[]; preferred?: string; onClose: () => void; onCreated: (contract: Contract) => void }) {
  const published = templates.filter(item => item.status === "active" && item.current);
  const [templateId, setTemplateId] = useState(published[0]?.id || ""), [userId, setUserId] = useState((people.some(item => item.id === preferred) ? preferred : people[0]?.id) || "");
  // The people may arrive after the dialog opens: choose the preferred one, or the first, once they do.
  useEffect(() => { if (!userId && people.length) setUserId(people.some(item => item.id === preferred) ? preferred! : people[0].id); }, [people.length]);
  const chosen = published.find(item => item.id === templateId);
  const [terms, setTerms] = useState<ContractTerms>(chosen?.current?.defaults || defaultTerms("volunteer"));
  const [startDate, setStartDate] = useState(""), [endDate, setEndDate] = useState("");
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  useEffect(() => { if (chosen?.current) setTerms(chosen.current.defaults); }, [templateId]);
  async function submit(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError("");
    const allowed = chosen?.current?.editable || [];
    const changes = Object.fromEntries(allowed.map(field => [field, terms[field]]));
    try {
      const result = await api<{ contract: Contract }>("/contracts", "POST", { templateId, userId, startDate, endDate: endDate || undefined, terms: changes });
      onCreated(result.contract);
    } catch (cause) { setError(message(cause)); setBusy(false); }
  }
  return <Modal title="Nuevo contrato" onClose={onClose} wide>
    <form className="stack" onSubmit={submit}><fieldset className="stack" disabled={busy}>
      {error && <p className="form-alert" role="alert"><Icon name="alert" size={18}/>{error}</p>}
      {!published.length ? <p className="muted">Publica una plantilla antes de preparar un contrato.</p> : <>
        <div className="form-grid-12">
          <div className="form-span-6"><Field label="Persona"><select value={userId} onChange={event => setUserId(event.target.value)}>{people.map(item => <option key={item.id} value={item.id}>{item.displayName || item.username}</option>)}</select></Field></div>
          <div className="form-span-6"><Field label="Plantilla"><select value={templateId} onChange={event => setTemplateId(event.target.value)}>{published.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></Field></div>
          <div className="form-span-6"><Field label="Inicio"><input type="date" required value={startDate} onChange={event => setStartDate(event.target.value)}/></Field></div>
          <div className="form-span-6"><Field label="Fin" optional><input type="date" value={endDate} onChange={event => setEndDate(event.target.value)}/></Field></div>
        </div>
        {chosen?.current && <TermsFields engagement={chosen.engagement} value={terms} onChange={setTerms} allowed={chosen.current.editable}/>}
      </>}
      <div className="modal-actions"><button type="button" className="button ghost" onClick={onClose}>Cancelar</button><button className="button primary" disabled={!published.length}>{busy ? "Creando…" : "Crear borrador"}</button></div>
    </fieldset></form>
  </Modal>;
}

const verificationTone: Record<ContractVerification["status"], "success" | "danger" | "warning"> = { valid: "success", document_mismatch: "danger", receipt_mismatch: "danger", unknown: "warning" };
const verificationLabel: Record<ContractVerification["status"], string> = { valid: "Contrato válido", document_mismatch: "El documento no coincide", receipt_mismatch: "Constancia modificada", unknown: "Contrato desconocido" };
function receiptFields(text: string): Record<string, unknown> | null {
  try { return JSON.parse(text) as Record<string, unknown>; } catch { /* Not JSON: read it as the receipt's HTML. */ }
  const block = new DOMParser().parseFromString(text, "text/html").getElementById("hl-constancia")?.textContent;
  try { return block ? JSON.parse(block) as Record<string, unknown> : null; } catch { return null; }
}

function ContractVerify() {
  const [result, setResult] = useState<ContractVerification | null>(null), [error, setError] = useState(""), [busy, setBusy] = useState(false);
  const [receipt, setReceipt] = useState<{ name: string; fields: Record<string, unknown> } | null>(null);
  async function verify(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setError(""); setResult(null);
    const id = String(new FormData(event.currentTarget).get("contractId") || "").trim();
    if (!receipt && !id) { setError("Escribe el identificador del contrato o carga su constancia."); return; }
    setBusy(true);
    try { setResult(await api<ContractVerification>("/contracts/verify", "POST", receipt ? { receipt: receipt.fields } : { contractId: id })); }
    catch (cause) { setError(message(cause)); }
    finally { setBusy(false); }
  }
  async function choose(event: ChangeEvent<HTMLInputElement>) {
    setError(""); setResult(null);
    const file = event.target.files?.[0];
    if (!file) { setReceipt(null); return; }
    const fields = file.size <= 2_000_000 ? receiptFields(await file.text()) : null;
    if (!fields) { setReceipt(null); setError("Ese archivo no es una constancia de contrato de Happy Learners."); return; }
    setReceipt({ name: file.name, fields });
  }
  return <form className="stack signature-verify" onSubmit={verify} aria-labelledby="contract-verify-title">
    <h2 id="contract-verify-title">Verificar una constancia</h2>
    <p className="muted small">Carga el archivo de la constancia o escribe el identificador del contrato. Se recalculan las huellas del documento y de cada firma.</p>
    <Field label="Archivo de la constancia" optional><input type="file" accept=".html,.htm,.json,text/html,application/json" onChange={event => void choose(event)}/></Field>
    <Field label="Identificador del contrato" optional hint="Empieza por «contract-». Se usa si no cargas un archivo."><input name="contractId" maxLength={100} disabled={!!receipt}/></Field>
    {error && <p className="form-alert" role="alert"><Icon name="alert" size={18}/>{error}</p>}
    <div className="form-actions"><button className="button secondary" disabled={busy}>{busy ? "Verificando…" : "Verificar"}</button></div>
    <div role="status" aria-live="polite">{result && <div className="signature-result">
      <StatusBadge tone={verificationTone[result.status]}>{verificationLabel[result.status]}</StatusBadge>
      <p className="small">{result.message}</p>
      {result.contract?.documentSha256 && <p className="muted small">Huella del documento: <code>{result.contract.documentSha256}</code></p>}
    </div>}</div>
  </form>;
}

function SettingsTab() {
  const { toast } = useFeedback();
  const [required, setRequired] = useState<boolean | null>(null), [busy, setBusy] = useState(false), [error, setError] = useState("");
  useEffect(() => { api<{ required: boolean }>("/contract-settings").then(result => setRequired(result.required)).catch(cause => setError(message(cause))); }, []);
  async function save(value: boolean) {
    setBusy(true); setError("");
    try { const result = await api<{ required: boolean }>("/contract-settings", "PUT", { required: value }); setRequired(result.required); toast({ message: value ? "Ahora se exige un contrato vigente para impartir clases." : "Ya no se exige un contrato para impartir clases." }); }
    catch (cause) { setError(message(cause)); }
    finally { setBusy(false); }
  }
  return <Section title="Ajustes de contratos">
    {error && <p className="form-alert" role="alert"><Icon name="alert" size={18}/>{error}</p>}
    {required === null && !error ? <Loading label="Cargando ajustes…" lines={2}/> : <label className="legal-check">
      <input type="checkbox" checked={!!required} disabled={busy} onChange={event => void save(event.target.checked)}/>
      <span>Exigir un contrato vigente para impartir clases</span>
    </label>}
    <p className="muted small">Si lo activas, quien imparte una clase necesita un contrato vigente. Publica al menos una plantilla antes de exigirlo.</p>
  </Section>;
}
