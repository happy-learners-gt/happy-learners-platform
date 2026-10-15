import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import type { LegalAcceptance, LegalDocument, LegalKind, PendingDocument } from "@happy-learners/contracts";
import { legalKinds, legalLabels } from "@happy-learners/domain";
import { api, consentRequired, message } from "../api";
import { Link, useNavigation, useUnsavedChanges } from "../navigation";
import { fullDate } from "../model";
import { Modal, useFeedback } from "../ui/feedback";
import { Icon } from "../ui/icons";
import { EmptyState, ErrorState, Field, Loading, StatusBadge } from "../ui/primitives";

/** Plain text written by administration, shown as paragraphs; it is never read as markup. */
function LegalText({ body, label }: { body: string; label: string }) {
  return <div className="legal-text" role="region" aria-label={label} tabIndex={0}>{body.split(/\n{2,}/).map((paragraph, index) => <p key={index}>{paragraph}</p>)}</div>;
}
const versionOf = (document: Pick<LegalDocument, "version" | "publishedAt">) => `Versión ${document.version}${document.publishedAt ? ` · publicada el ${fullDate(document.publishedAt)}` : ""}`;
type Mine = { documents: LegalDocument[]; pending: PendingDocument[]; mine: LegalAcceptance[] };

/**
 * Shown instead of the app while the person has not accepted the terms or consented to the privacy policy in force
 * (ST-126, ST-127). Each version is read and accepted on its own; without both, the platform stays closed.
 */
export function ConsentGate({ pending, organizationId, onAccepted, onLogout }: { pending: PendingDocument[]; organizationId: string; onAccepted: () => Promise<void>; onLogout: () => void }) {
  const [documents, setDocuments] = useState<LegalDocument[] | null>(null), [error, setError] = useState(""), [busy, setBusy] = useState(false);
  const [checked, setChecked] = useState<string[]>([]);
  const load = () => { setError(""); api<Mine>("/legal").then(result => setDocuments(result.documents.filter(item => pending.some(entry => entry.id === item.id)))).catch(cause => setError(message(cause))); };
  useEffect(load, [pending.map(item => item.id).join()]);
  async function accept(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError("");
    try { await api("/legal/accept", "POST", { documentIds: checked }); await onAccepted(); }
    catch (cause) { setError(message(cause)); setBusy(false); }
  }
  return <div className="login-page">
    <a className="skip-link" href="#main">Saltar al contenido</a>
    <main id="main" className="login-main">
      <div className="login-brand"><span className="brand-mark" aria-hidden="true">hl</span><span>Happy Learners</span></div>
      <section className="login-card legal-card" aria-labelledby="consent-title">
        <h1 id="consent-title">Acepta los términos y la política de privacidad</h1>
        <p>Para usar la plataforma necesitas aceptar la versión vigente de cada documento. Tu aceptación queda registrada con su versión y su fecha.</p>
        {error && <p className="form-alert" role="alert"><Icon name="alert" size={18}/>{error}</p>}
        {!documents ? !error && <Loading label="Cargando documentos…" lines={6}/> : <form onSubmit={accept} className="stack">
          {documents.map(document => <fieldset key={document.id} className="legal-document">
            <legend>{document.title}</legend>
            <p className="muted small">{legalLabels[document.kind]} · {versionOf(document)}</p>
            <LegalText body={document.body} label={`Texto de ${document.title}`}/>
            <label className="legal-check"><input type="checkbox" checked={checked.includes(document.id)} onChange={event => setChecked(current => event.target.checked ? [...current, document.id] : current.filter(id => id !== document.id))}/>
              <span>{document.kind === "privacy" ? document.consent : `He leído y acepto la versión ${document.version} de los términos y condiciones.`}</span></label>
          </fieldset>)}
          <div className="form-actions"><button type="button" className="button ghost" onClick={onLogout}>Cerrar sesión</button><button className="button primary" disabled={busy || checked.length !== documents.length}>{busy ? "Guardando…" : "Aceptar y continuar"}</button></div>
        </form>}
        <p className="muted small"><a href={`/privacidad?organizacion=${encodeURIComponent(organizationId)}`} target="_blank" rel="noopener">Abrir la política de privacidad en otra pestaña</a></p>
      </section>
    </main>
  </div>;
}

type PublicPolicy = { organization: { id: string; name: string }; document: Pick<LegalDocument, "kind" | "version" | "title" | "body" | "consent" | "publishedAt"> };
/** /privacidad: the privacy policy in force of each organization, readable without signing in (ST-127). */
export function PrivacyPage() {
  const { url } = useNavigation();
  const organization = url.searchParams.get("organizacion");
  const [policies, setPolicies] = useState<PublicPolicy[] | null>(null), [error, setError] = useState("");
  useEffect(() => { api<{ policies: PublicPolicy[] }>(`/public/privacy${organization ? `?organization=${encodeURIComponent(organization)}` : ""}`).then(result => setPolicies(result.policies)).catch(cause => setError(message(cause))); }, [organization]);
  return <div className="login-page">
    <a className="skip-link" href="#main">Saltar al contenido</a>
    <main id="main" className="login-main">
      <div className="login-brand"><span className="brand-mark" aria-hidden="true">hl</span><span>Happy Learners</span></div>
      <article className="login-card legal-card" aria-labelledby="privacy-title">
        <h1 id="privacy-title">Política de privacidad</h1>
        {error ? <ErrorState title="No pudimos abrir la política" error={error}/> : !policies ? <Loading label="Cargando la política de privacidad…" lines={6}/>
          : !policies.length ? <p>Ninguna organización ha publicado todavía su política de privacidad.</p>
          : policies.map(policy => <section key={policy.organization.id} className="legal-document" aria-labelledby={`policy-${policy.organization.id}`}>
            <h2 id={`policy-${policy.organization.id}`}>{policy.document.title}</h2>
            <p className="muted small">{policy.organization.name} · {versionOf(policy.document)}</p>
            <LegalText body={policy.document.body} label={`Texto de ${policy.document.title} de ${policy.organization.name}`}/>
            {policy.document.consent && <p className="legal-consent"><strong>Consentimiento informado:</strong> {policy.document.consent}</p>}
          </section>)}
        <Link href="/" className="button secondary">Ir a iniciar sesión</Link>
      </article>
    </main>
  </div>;
}

/** In Ayuda: the versions the person accepted and, for privacy, withdrawing the consent (ST-127). */
export function MyConsent() {
  const { toast } = useFeedback();
  const [data, setData] = useState<Mine | null>(null), [error, setError] = useState(""), [withdrawing, setWithdrawing] = useState<LegalAcceptance | null>(null), [busy, setBusy] = useState(false);
  const load = () => { setError(""); api<Mine>("/legal").then(setData).catch(cause => setError(message(cause))); };
  useEffect(load, []);
  if (error) return <ErrorState error={error} retry={load}/>;
  if (!data) return <Loading label="Cargando tus consentimientos…" lines={2}/>;
  if (!data.documents.length) return <p>Tu organización todavía no publica términos ni política de privacidad.</p>;
  async function withdraw() {
    if (!withdrawing) return;
    setBusy(true);
    try { await api("/legal/withdraw", "POST", { documentId: withdrawing.documentId }); setWithdrawing(null); toast({ message: "Retiraste tu consentimiento. Queda registrado con su fecha." }); dispatchEvent(new CustomEvent(consentRequired)); }
    catch (cause) { toast({ tone: "error", message: message(cause) }); setBusy(false); }
  }
  return <>
    <ul className="legal-mine">{data.documents.map(document => {
      const record = data.mine.find(item => item.documentId === document.id && !item.withdrawnAt);
      return <li key={document.id}>
        <span><strong>{document.title}</strong><span className="muted small">{legalLabels[document.kind]} · versión {document.version}{record ? ` · aceptada el ${fullDate(record.acceptedAt)}` : ""}</span></span>
        {document.kind === "privacy" && record && <button type="button" className="button secondary small" onClick={() => setWithdrawing(record)}>Retirar consentimiento</button>}
      </li>;
    })}</ul>
    {withdrawing && <Modal title="Retirar tu consentimiento" onClose={() => setWithdrawing(null)} footer={<><button type="button" className="button ghost" onClick={() => setWithdrawing(null)}>Cancelar</button><button type="button" className="button danger" disabled={busy} onClick={() => void withdraw()}>{busy ? "Retirando…" : "Retirar consentimiento"}</button></>}>
      <p>Tu retiro queda registrado con su fecha. Sin tu consentimiento no puedes usar la plataforma: se te pedirá de nuevo al continuar, y puedes volver a darlo cuando quieras.</p>
    </Modal>}
  </>;
}

/** Organización › Términos y privacidad: drafts, publication, every version and who accepted which one (ST-126, ST-127). */
export function LegalSettings() {
  const [documents, setDocuments] = useState<LegalDocument[] | null>(null), [records, setRecords] = useState<{ acceptances: LegalAcceptance[]; people: { id: string; name: string }[] } | null>(null), [error, setError] = useState("");
  const load = () => { setError(""); Promise.all([api<{ documents: LegalDocument[] }>("/legal/documents"), api<{ acceptances: LegalAcceptance[]; people: { id: string; name: string }[] }>("/legal/acceptances")]).then(([list, accepted]) => { setDocuments(list.documents); setRecords(accepted); }).catch(cause => setError(message(cause))); };
  useEffect(load, []);
  return <section className="panel admin-section reading" aria-labelledby="legal-title">
    <div className="panel-header"><h2 id="legal-title">Términos y privacidad</h2></div>
    <p className="muted">Redacta un borrador y publícalo como nueva versión. Al publicarla, cada persona debe aceptarla en su siguiente ingreso. Las versiones anteriores se conservan y no se pueden modificar. La política vigente se puede leer sin iniciar sesión en <a href="/privacidad" target="_blank" rel="noopener">/privacidad</a>.</p>
    {error ? <ErrorState error={error} retry={load}/> : !documents || !records ? <Loading label="Cargando términos y privacidad…" lines={4}/> : <>
      {legalKinds.map(kind => <LegalKindEditor key={kind} kind={kind} documents={documents.filter(item => item.kind === kind)} onChange={list => { setDocuments(list); load(); }}/>)}
      <Acceptances documents={documents} acceptances={records.acceptances} people={records.people}/>
    </>}
  </section>;
}

function LegalKindEditor({ kind, documents, onChange }: { kind: LegalKind; documents: LegalDocument[]; onChange: (documents: LegalDocument[]) => void }) {
  const { toast } = useFeedback();
  const draft = documents.find(item => item.status === "draft"), published = documents.filter(item => item.status === "published"), current = published[0];
  const [dirty, setDirty] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState(""), [confirming, setConfirming] = useState(false);
  const base = draft || current;
  useUnsavedChanges(dirty);
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError("");
    try { const result = await api<{ documents: LegalDocument[] }>(`/legal/documents/${kind}`, "PUT", Object.fromEntries(new FormData(event.currentTarget))); setDirty(false); onChange(result.documents); toast({ message: "Borrador guardado. Publícalo cuando esté listo." }); }
    catch (cause) { setError(message(cause)); }
    finally { setBusy(false); }
  }
  async function publish() {
    setBusy(true);
    try {
      const result = await api<{ documents: LegalDocument[] }>(`/legal/documents/${kind}/publish`, "POST");
      setConfirming(false); onChange(result.documents);
      toast({ message: `${legalLabels[kind]}: versión ${result.documents.find(item => item.kind === kind && item.status === "published")?.version} publicada. Cada persona la aceptará en su siguiente ingreso.` });
      // Administration accepts it too before continuing.
      dispatchEvent(new CustomEvent(consentRequired));
    } catch (cause) { toast({ tone: "error", message: message(cause) }); }
    finally { setBusy(false); }
  }
  const titleId = `legal-${kind}-title`;
  return <section className="legal-kind" aria-labelledby={titleId}>
    <div className="panel-header"><h3 id={titleId}>{legalLabels[kind]}</h3>{current ? <StatusBadge tone="success">Vigente: versión {current.version}</StatusBadge> : <StatusBadge>Sin publicar</StatusBadge>}</div>
    <form className="stack" onSubmit={save} onChange={() => setDirty(true)} aria-label={`Borrador de ${legalLabels[kind].toLowerCase()}`}>
      {error && <p className="form-alert" role="alert"><Icon name="alert" size={18}/>{error}</p>}
      <fieldset disabled={busy} className="stack">
        <Field label={`Título de ${legalLabels[kind].toLowerCase()}`}><input name="title" required minLength={3} maxLength={120} defaultValue={base?.title || legalLabels[kind]}/></Field>
        <Field label={`Texto de ${legalLabels[kind].toLowerCase()}`} hint="Texto sin formato. Separa los párrafos con una línea en blanco."><textarea name="body" required minLength={20} maxLength={60000} rows={8} defaultValue={base?.body || ""}/></Field>
        {kind === "privacy" && <Field label="Texto del consentimiento" hint="Lo que cada persona acepta al marcar la casilla, en una sola línea."><input name="consent" required minLength={10} maxLength={1000} defaultValue={base?.consent || "Doy mi consentimiento informado para el tratamiento de mis datos según esta política."}/></Field>}
        <div className="form-actions">
          {draft && <span className="muted small">Borrador guardado el {fullDate(draft.updatedAt)}</span>}
          <button className="button secondary">{busy ? "Guardando…" : "Guardar borrador"}</button>
          <button type="button" className="button primary" disabled={!draft || dirty} onClick={() => setConfirming(true)}>Publicar nueva versión</button>
        </div>
      </fieldset>
    </form>
    {published.length > 0 && <details className="reference"><summary>Versiones publicadas ({published.length})</summary>
      <ul className="legal-versions">{published.map(item => <li key={item.id}><details><summary>Versión {item.version} · {item.title} · {fullDate(item.publishedAt || "")}{item.publishedBy ? ` · ${item.publishedBy}` : ""}</summary>
        <LegalText body={item.body} label={`Texto de la versión ${item.version}`}/>{item.consent && <p className="legal-consent"><strong>Consentimiento:</strong> {item.consent}</p>}
      </details></li>)}</ul>
    </details>}
    {confirming && draft && <Modal title={`Publicar ${legalLabels[kind].toLowerCase()}`} onClose={() => setConfirming(false)} footer={<><button type="button" className="button ghost" onClick={() => setConfirming(false)}>Cancelar</button><button type="button" className="button primary" disabled={busy} onClick={() => void publish()}>{busy ? "Publicando…" : `Publicar versión ${(current?.version || 0) + 1}`}</button></>}>
      <p>«{draft.title}» será la versión {(current?.version || 0) + 1}. Cada persona, incluida tu cuenta, deberá aceptarla en su siguiente ingreso. Después de publicarla no se puede modificar.</p>
    </Modal>}
  </section>;
}

function Acceptances({ documents, acceptances, people }: { documents: LegalDocument[]; acceptances: LegalAcceptance[]; people: { id: string; name: string }[] }) {
  const current = legalKinds.map(kind => documents.find(item => item.kind === kind && item.status === "published")).filter((item): item is LegalDocument => !!item);
  return <section className="legal-kind" aria-labelledby="legal-records-title">
    <div className="panel-header"><h3 id="legal-records-title">Aceptaciones</h3></div>
    {current.map(document => {
      const missing = people.filter(person => !acceptances.some(item => item.documentId === document.id && item.userId === person.id && !item.withdrawnAt));
      return <p key={document.id} className="small">{legalLabels[document.kind]}, versión {document.version}: {people.length - missing.length} de {people.length} personas la aceptaron.{missing.length ? ` Pendientes: ${missing.map(person => person.name).join(", ")}.` : ""}</p>;
    })}
    {!acceptances.length ? <EmptyState compact icon="shield" title="Sin aceptaciones">Aparecerán aquí cuando cada persona acepte una versión publicada.</EmptyState>
      : <div className="table-card" role="region" aria-label="Registro de aceptaciones" tabIndex={0}><table className="members-table">
        <caption className="sr-only">Quién aceptó qué versión y cuándo</caption>
        <thead><tr><th scope="col">Persona</th><th scope="col">Documento</th><th scope="col">Versión</th><th scope="col">Aceptó</th><th scope="col">Estado</th></tr></thead>
        <tbody>{acceptances.map(item => <tr key={item.id}>
          <th scope="row">{item.name}</th><td>{legalLabels[item.kind]}</td><td>{item.version}</td><td><time dateTime={item.acceptedAt}>{fullDate(item.acceptedAt)}</time></td>
          <td>{item.withdrawnAt ? <StatusBadge tone="warning">Retirado el {fullDate(item.withdrawnAt)}</StatusBadge> : <StatusBadge tone="success">Aceptada</StatusBadge>}</td>
        </tr>)}</tbody>
      </table></div>}
  </section>;
}
