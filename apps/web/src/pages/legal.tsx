import { useEffect, useId, useState } from "react";
import type { ChangeEvent, FormEvent } from "react";
import type { LegalAcceptance, LegalDocument, LegalKind, LegalSignature, PendingDocument, SignatureVerification } from "@happy-learners/contracts";
import { legalKinds, legalLabels, signedKinds } from "@happy-learners/domain";
import { agreementRequired, api, changed, consentRequired, message } from "../api";
import { useSession } from "../session";
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
type Mine = { documents: LegalDocument[]; pending: PendingDocument[]; agreement: PendingDocument | null; mine: LegalAcceptance[] };
const signs = (kind: LegalKind) => signedKinds.includes(kind);
const statement: Record<LegalKind, (version: number | null) => string> = {
  terms: version => `He leído y acepto la versión ${version} de los términos y condiciones.`,
  privacy: () => "",
  volunteer: version => `He leído y apruebo la versión ${version} del acuerdo de voluntariado ad honorem: mi actividad es voluntaria y sin remuneración económica.`,
};

/**
 * ST-153 (DEC-043): a simple electronic signature. The person types their full name and confirms their identity with
 * their password; the statement says what is signed and what is recorded.
 */
function SignatureFields({ what }: { what: string }) {
  return <fieldset className="signature-fields">
    <legend>Firma electrónica</legend>
    <p className="small">Firmo electrónicamente {what} escribiendo mi nombre completo y confirmando mi identidad con la contraseña de mi cuenta. Mi firma queda registrada con la versión del documento, su huella SHA-256 y la fecha, y puedo descargar su constancia.</p>
    <Field label="Nombre completo" hint="Tal como firmas: de 3 a 120 caracteres."><input name="fullName" required minLength={3} maxLength={120} autoComplete="name"/></Field>
    <Field label="Contraseña de tu cuenta"><input name="password" type="password" required maxLength={128} autoComplete="current-password"/></Field>
  </fieldset>;
}
const signatureOf = (form: HTMLFormElement) => { const data = new FormData(form); return { fullName: String(data.get("fullName") || ""), password: String(data.get("password") || "") }; };
/** The receipt of a signature, downloaded by the signer or administration. */
export function ReceiptLink({ id, compact }: { id: string; compact?: boolean }) {
  return <a className={`button secondary${compact ? " small" : ""}`} href={`/api/legal/signatures/${encodeURIComponent(id)}/receipt`} download><Icon name="download" size={16}/>Descargar constancia</a>;
}

/**
 * Shown instead of the app while the person has not accepted the terms or consented to the privacy policy in force
 * (ST-126, ST-127). Each version is read and accepted on its own; without both, the platform stays closed.
 */
export function ConsentGate({ pending, organizationId, onAccepted, onLogout }: { pending: PendingDocument[]; organizationId: string; onAccepted: () => Promise<void>; onLogout: () => void }) {
  const [documents, setDocuments] = useState<LegalDocument[] | null>(null), [error, setError] = useState(""), [busy, setBusy] = useState(false);
  const [checked, setChecked] = useState<string[]>([]);
  const load = () => { setError(""); api<Mine>("/legal").then(result => setDocuments(result.documents.filter(item => pending.some(entry => entry.id === item.id)))).catch(cause => setError(message(cause))); };
  useEffect(load, [pending.map(item => item.id).join()]);
  const signing = !!documents?.some(document => signs(document.kind));
  async function accept(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError("");
    try { await api("/legal/accept", "POST", { documentIds: checked, ...(signing ? { signature: signatureOf(event.currentTarget) } : {}) }); await onAccepted(); }
    catch (cause) { setError(message(cause)); setBusy(false); }
  }
  return <div className="login-page">
    <a className="skip-link" href="#main">Saltar al contenido</a>
    <main id="main" className="login-main">
      <div className="login-brand"><span className="brand-mark" aria-hidden="true">hl</span><span>Happy Learners</span></div>
      <section className="login-card legal-card" aria-labelledby="consent-title">
        <h1 id="consent-title">Acepta los términos y la política de privacidad</h1>
        <p>Para usar la plataforma necesitas aceptar la versión vigente de cada documento. Tu aceptación queda registrada con su versión y su fecha{signing ? "; la de los términos y condiciones, además, con tu firma electrónica" : ""}.</p>
        {error && <p className="form-alert" role="alert"><Icon name="alert" size={18}/>{error}</p>}
        {!documents ? !error && <Loading label="Cargando documentos…" lines={6}/> : <form onSubmit={accept} className="stack">
          {documents.map(document => <fieldset key={document.id} className="legal-document">
            <legend>{document.title}</legend>
            <p className="muted small">{legalLabels[document.kind]} · {versionOf(document)}</p>
            <LegalText body={document.body} label={`Texto de ${document.title}`}/>
            <label className="legal-check"><input type="checkbox" checked={checked.includes(document.id)} onChange={event => setChecked(current => event.target.checked ? [...current, document.id] : current.filter(id => id !== document.id))}/>
              <span>{document.kind === "privacy" ? document.consent : statement[document.kind](document.version)}</span></label>
          </fieldset>)}
          {signing && <SignatureFields what="la aceptación de los términos y condiciones"/>}
          <div className="form-actions"><button type="button" className="button ghost" onClick={onLogout}>Cerrar sesión</button><button className="button primary" disabled={busy || checked.length !== documents.length}>{busy ? "Guardando…" : signing ? "Firmar y continuar" : "Aceptar y continuar"}</button></div>
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
  const [signing, setSigning] = useState<LegalDocument | null>(null);
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
        <span><strong>{document.title}</strong><span className="muted small">{legalLabels[document.kind]} · versión {document.version}{record ? ` · ${record.signatureId ? `firmada como «${record.signedName}»` : "aceptada"} el ${fullDate(record.acceptedAt)}` : signs(document.kind) ? " · sin firmar" : ""}</span></span>
        {document.kind === "privacy" && record && <button type="button" className="button secondary small" onClick={() => setWithdrawing(record)}>Retirar consentimiento</button>}
        {signs(document.kind) && (record?.signatureId ? <ReceiptLink id={record.signatureId} compact/> : record ? <StatusBadge>Sin firma</StatusBadge>
          : <button type="button" className="button primary small" onClick={() => setSigning(document)}>Leer y firmar</button>)}
      </li>;
    })}</ul>
    {signing && <SignDialog document={signing} onClose={() => setSigning(null)} onSigned={load}/>}
    {withdrawing && <Modal title="Retirar tu consentimiento" onClose={() => setWithdrawing(null)} footer={<><button type="button" className="button ghost" onClick={() => setWithdrawing(null)}>Cancelar</button><button type="button" className="button danger" disabled={busy} onClick={() => void withdraw()}>{busy ? "Retirando…" : "Retirar consentimiento"}</button></>}>
      <p>Tu retiro queda registrado con su fecha. Sin tu consentimiento no puedes usar la plataforma: se te pedirá de nuevo al continuar, y puedes volver a darlo cuando quieras.</p>
    </Modal>}
  </>;
}

/** Organización › Términos y privacidad: drafts, publication, every version and who accepted which one (ST-126, ST-127). */
export function LegalSettings() {
  const [documents, setDocuments] = useState<LegalDocument[] | null>(null), [records, setRecords] = useState<{ acceptances: LegalAcceptance[]; people: Person[] } | null>(null), [error, setError] = useState("");
  const [signatures, setSignatures] = useState<LegalSignature[] | null>(null);
  const load = () => { setError(""); Promise.all([api<{ documents: LegalDocument[] }>("/legal/documents"), api<{ acceptances: LegalAcceptance[]; people: Person[] }>("/legal/acceptances"), api<{ signatures: LegalSignature[] }>("/legal/signatures")]).then(([list, accepted, signed]) => { setDocuments(list.documents); setRecords(accepted); setSignatures(signed.signatures); }).catch(cause => setError(message(cause))); };
  useEffect(load, []);
  return <section className="panel admin-section reading" aria-labelledby="legal-title">
    <div className="panel-header"><h2 id="legal-title">Términos y privacidad</h2></div>
    <p className="muted">Redacta un borrador y publícalo como nueva versión. Al publicarla, cada persona debe aceptar los términos y la política en su siguiente ingreso, y cada educador firma el acuerdo de voluntariado ad honorem antes de impartir clases. Los términos y el acuerdo se firman electrónicamente con el nombre completo y la contraseña. Las versiones anteriores se conservan y no se pueden modificar. La política vigente se puede leer sin iniciar sesión en <a href="/privacidad" target="_blank" rel="noopener">/privacidad</a>.</p>
    {error ? <ErrorState error={error} retry={load}/> : !documents || !records ? <Loading label="Cargando términos y privacidad…" lines={4}/> : <>
      {legalKinds.map(kind => <LegalKindEditor key={kind} kind={kind} documents={documents.filter(item => item.kind === kind)} onChange={list => { setDocuments(list); load(); }}/>)}
      <Acceptances documents={documents} acceptances={records.acceptances} people={records.people}/>
      {signatures && <Signatures signatures={signatures}/>}
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
      toast({ message: `${legalLabels[kind]}: versión ${result.documents.find(item => item.kind === kind && item.status === "published")?.version} publicada. ${kind === "volunteer" ? "Cada educador la firmará antes de impartir clases." : "Cada persona la aceptará en su siguiente ingreso."}` });
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
      <p>«{draft.title}» será la versión {(current?.version || 0) + 1}. {kind === "volunteer" ? "Cada educador deberá firmarla antes de impartir su próxima clase." : "Cada persona, incluida tu cuenta, deberá aceptarla en su siguiente ingreso."} Después de publicarla no se puede modificar.</p>
    </Modal>}
  </section>;
}

type Person = { id: string; name: string; role?: string };
function Acceptances({ documents, acceptances, people: everyone }: { documents: LegalDocument[]; acceptances: LegalAcceptance[]; people: Person[] }) {
  const current = legalKinds.map(kind => documents.find(item => item.kind === kind && item.status === "published")).filter((item): item is LegalDocument => !!item);
  return <section className="legal-kind" aria-labelledby="legal-records-title">
    <div className="panel-header"><h3 id="legal-records-title">Aceptaciones</h3></div>
    {current.map(document => {
      // The volunteer agreement is signed by educators; the terms and the privacy policy, by everyone.
      const people = document.kind === "volunteer" ? everyone.filter(person => person.role !== "admin") : everyone;
      const missing = people.filter(person => !acceptances.some(item => item.documentId === document.id && item.userId === person.id && !item.withdrawnAt));
      return <p key={document.id} className="small">{legalLabels[document.kind]}, versión {document.version}: {people.length - missing.length} de {people.length} personas la aceptaron.{missing.length ? ` Pendientes: ${missing.map(person => person.name).join(", ")}.` : ""}</p>;
    })}
    {!acceptances.length ? <EmptyState compact icon="shield" title="Sin aceptaciones">Aparecerán aquí cuando cada persona acepte una versión publicada.</EmptyState>
      : <div className="table-card" role="region" aria-label="Registro de aceptaciones" tabIndex={0}><table className="members-table">
        <caption className="sr-only">Quién aceptó qué versión y cuándo</caption>
        <thead><tr><th scope="col">Persona</th><th scope="col">Documento</th><th scope="col">Versión</th><th scope="col">Aceptó</th><th scope="col">Firma</th><th scope="col">Estado</th></tr></thead>
        <tbody>{acceptances.map(item => <tr key={item.id}>
          <th scope="row">{item.name}</th><td>{legalLabels[item.kind]}</td><td>{item.version}</td><td><time dateTime={item.acceptedAt}>{fullDate(item.acceptedAt)}</time></td>
          <td>{item.signatureId ? `Firmada como «${item.signedName}»` : signs(item.kind) ? <StatusBadge>Sin firma</StatusBadge> : "Consentimiento"}</td>
          <td>{item.withdrawnAt ? <StatusBadge tone="warning">Retirado el {fullDate(item.withdrawnAt)}</StatusBadge> : <StatusBadge tone="success">Aceptada</StatusBadge>}</td>
        </tr>)}</tbody>
      </table></div>}
  </section>;
}

/** ST-153, ST-151: reading a document and signing it with the full name and the password, then its receipt. */
export function SignDialog({ document, onClose, onSigned }: { document: LegalDocument; onClose: () => void; onSigned: () => void }) {
  const formId = useId();
  const [busy, setBusy] = useState(false), [error, setError] = useState(""), [signed, setSigned] = useState<string | null>(null);
  const label = legalLabels[document.kind].toLowerCase();
  async function sign(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError("");
    try {
      const result = await api<{ signatures: string[] }>("/legal/accept", "POST", { documentIds: [document.id], signature: signatureOf(event.currentTarget) });
      setSigned(result.signatures[0] || ""); onSigned();
    } catch (cause) { setError(message(cause)); }
    finally { setBusy(false); }
  }
  return <Modal title={signed !== null ? "Firma registrada" : `Firmar ${label}`} onClose={onClose} wide footer={signed !== null ? <button type="button" className="button primary" onClick={onClose}>Cerrar</button>
    : <><button type="button" className="button ghost" onClick={onClose}>Cancelar</button><button form={formId} className="button primary" disabled={busy}>{busy ? "Firmando…" : "Firmar"}</button></>}>
    {signed !== null ? <div className="stack">
      <p role="status">Firmaste la versión {document.version} de {label}. La constancia incluye la huella SHA-256 del documento y la de tu firma, para que administración pueda verificarla.</p>
      {signed && <p><ReceiptLink id={signed}/></p>}
    </div> : <form id={formId} className="stack" onSubmit={sign} aria-label={`Firmar ${label}`}>
      <p className="muted small">{legalLabels[document.kind]} · {versionOf(document)}</p>
      <LegalText body={document.body} label={`Texto de ${document.title}`}/>
      <p className="legal-consent">{statement[document.kind](document.version)}</p>
      {error && <p className="form-alert" role="alert"><Icon name="alert" size={18}/>{error}</p>}
      <SignatureFields what={`la versión ${document.version} de ${document.kind === "volunteer" ? "mi acuerdo de voluntariado ad honorem" : label}`}/>
    </form>}
  </Modal>;
}

/**
 * ST-151 CA2: while the volunteer agreement in force is not signed, an educator sees why classes cannot be taught yet
 * and signs it from here. Organizations without a published agreement show nothing.
 */
export function AgreementBanner() {
  const { member } = useSession();
  const [data, setData] = useState<Mine | null>(null), [signing, setSigning] = useState<LegalDocument | null>(null);
  const load = () => { api<Mine>("/legal").then(setData).catch(() => undefined); };
  useEffect(() => {
    if (member.role === "admin") return;
    load();
    const refresh = (event: Event) => { const path = (event as CustomEvent<string>).detail; if (event.type !== changed || String(path).startsWith("/legal")) load(); };
    addEventListener(agreementRequired, refresh); addEventListener(consentRequired, refresh); addEventListener(changed, refresh);
    return () => { removeEventListener(agreementRequired, refresh); removeEventListener(consentRequired, refresh); removeEventListener(changed, refresh); };
  }, [member.id, member.role]);
  const agreement = data?.agreement ? data.documents.find(item => item.id === data.agreement!.id) : undefined;
  return <>
    {agreement && !signing && <div className="message-bar warning" role="region" aria-label="Acuerdo de voluntariado pendiente"><Icon name="shield" size={20}/><div>
      <strong>Firma tu acuerdo de voluntariado ad honorem</strong>
      <p>Antes de impartir clases, aprueba la versión {agreement.version} del acuerdo: deja constancia de que tu actividad es voluntaria y sin remuneración económica.</p>
      <button type="button" className="button primary small" onClick={() => setSigning(agreement)}>Leer y firmar el acuerdo</button>
    </div></div>}
    {signing && <SignDialog document={signing} onClose={() => setSigning(null)} onSigned={load}/>}
  </>;
}

const verificationTone: Record<SignatureVerification["status"], "success" | "danger" | "warning"> = { valid: "success", document_mismatch: "danger", receipt_mismatch: "danger", unknown: "warning" };
const verificationLabel: Record<SignatureVerification["status"], string> = { valid: "Firma válida", document_mismatch: "El documento no coincide", receipt_mismatch: "Constancia modificada", unknown: "Firma desconocida" };
/** The data block of a downloaded receipt (or the same fields as JSON). */
function receiptFields(text: string): Record<string, unknown> | null {
  try { return JSON.parse(text) as Record<string, unknown>; } catch { /* Not JSON: read it as the receipt's HTML. */ }
  const block = new DOMParser().parseFromString(text, "text/html").getElementById("hl-constancia")?.textContent;
  try { return block ? JSON.parse(block) as Record<string, unknown> : null; } catch { return null; }
}

/** Organización › Firmas (ST-153 CA3, ST-151 CA3): who signed which version and when, departed people included, and verification. */
function Signatures({ signatures }: { signatures: LegalSignature[] }) {
  const [result, setResult] = useState<SignatureVerification | null>(null), [error, setError] = useState(""), [busy, setBusy] = useState(false);
  const [receipt, setReceipt] = useState<{ name: string; fields: Record<string, unknown> } | null>(null);
  async function verify(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setError(""); setResult(null);
    const id = String(new FormData(event.currentTarget).get("signatureId") || "").trim();
    if (!receipt && !id) { setError("Escribe el identificador de la firma o carga su constancia."); return; }
    setBusy(true);
    try { setResult(await api<SignatureVerification>("/legal/signatures/verify", "POST", receipt ? { receipt: receipt.fields } : { signatureId: id })); }
    catch (cause) { setError(message(cause)); }
    finally { setBusy(false); }
  }
  async function choose(event: ChangeEvent<HTMLInputElement>) {
    setError(""); setResult(null);
    const file = event.target.files?.[0];
    if (!file) { setReceipt(null); return; }
    const fields = file.size <= 2_000_000 ? receiptFields(await file.text()) : null;
    if (!fields) { setReceipt(null); setError("Ese archivo no es una constancia de firma de Happy Learners."); return; }
    setReceipt({ name: file.name, fields });
  }
  return <section className="legal-kind" aria-labelledby="legal-signatures-title">
    <div className="panel-header"><h3 id="legal-signatures-title">Firmas</h3></div>
    <p className="muted small">Firma electrónica simple: cuenta, contraseña, nombre escrito, fecha y huella SHA-256 del documento. Las firmas se conservan aunque la persona deje el equipo.</p>
    {!signatures.length ? <EmptyState compact icon="shield" title="Sin firmas">Aparecerán aquí cuando alguien firme los términos o el acuerdo de voluntariado.</EmptyState>
      : <div className="table-card" role="region" aria-label="Registro de firmas" tabIndex={0}><table className="members-table">
        <caption className="sr-only">Quién firmó qué versión y cuándo</caption>
        <thead><tr><th scope="col">Persona</th><th scope="col">Documento</th><th scope="col">Versión</th><th scope="col">Nombre firmado</th><th scope="col">Firmó</th><th scope="col">Constancia</th></tr></thead>
        <tbody>{signatures.map(item => <tr key={item.signatureId}>
          <th scope="row">{item.name}{!item.active && <> <StatusBadge tone="warning">{item.departedOn ? `Salió el ${fullDate(item.departedOn)}` : "Sin acceso"}</StatusBadge></>}</th>
          <td>{legalLabels[item.kind]}</td><td>{item.version}</td><td>{item.signedName}</td><td><time dateTime={item.signedAt}>{fullDate(item.signedAt)}</time></td>
          <td><ReceiptLink id={item.signatureId} compact/></td>
        </tr>)}</tbody>
      </table></div>}
    <form className="stack signature-verify" onSubmit={verify} aria-labelledby="legal-verify-title">
      <h4 id="legal-verify-title">Verificar una constancia</h4>
      <p className="muted small">Carga el archivo de la constancia o escribe el identificador de la firma. Se recalculan las huellas del documento guardado y de la firma.</p>
      <Field label="Archivo de la constancia" optional><input type="file" accept=".html,.htm,.json,text/html,application/json" onChange={event => void choose(event)}/></Field>
      <Field label="Identificador de la firma" optional hint="Empieza por «signature-». Se usa si no cargas un archivo."><input name="signatureId" maxLength={100} disabled={!!receipt}/></Field>
      {error && <p className="form-alert" role="alert"><Icon name="alert" size={18}/>{error}</p>}
      <div className="form-actions"><button className="button secondary" disabled={busy}>{busy ? "Verificando…" : "Verificar"}</button></div>
      <div role="status" aria-live="polite">{result && <div className="signature-result">
        <StatusBadge tone={verificationTone[result.status]}>{verificationLabel[result.status]}</StatusBadge>
        <p className="small">{result.message}</p>
        {result.signature && <p className="muted small">Huella del documento: <code>{result.signature.documentSha256}</code></p>}
      </div>}</div>
    </form>
  </section>;
}
