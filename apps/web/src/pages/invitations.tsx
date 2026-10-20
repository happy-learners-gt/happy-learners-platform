import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import type { ContractOffer, ContractTemplate, ContractTerms, DeliveryStatus, Invitation, InvitationPreview, RichTextDocument } from "@happy-learners/contracts";
import {
  acceptablePassword, compensationSummary, contractValues, engagementLabels, invitationInput, localDay, locationLabels,
  maxPasswordLength, mergeContract, minPasswordLength, roleLabel, usernamePattern,
} from "@happy-learners/domain";
import { api, ApiError, message } from "../api";
import { fullDate } from "../model";
import { useNavigation } from "../navigation";
import { useSession } from "../session";
import { RichText } from "../RichText";
import { Modal, useFeedback } from "../ui/feedback";
import { Icon } from "../ui/icons";
import { Menu } from "../ui/Menu";
import { Avatar } from "../ui/progress";
import { ErrorState, Field, Loading, Section, StatusBadge } from "../ui/primitives";
import type { Tone } from "../ui/primitives";
import { StatusSteps } from "../ui/StatusSteps";
import type { StatusStep } from "../ui/StatusSteps";
import { defaultTerms, TermsFields } from "./contracts";

/**
 * ST-121: invitations by e-mail on the Educadores page. Every invitation returns its link, so administration can copy
 * and share it when the message could not be sent (DEC-042).
 */
type Issued = { name: string; email: string; link: string; delivery: DeliveryStatus; resent: boolean };
const statusLabel: Record<Invitation["status"], [string, Tone]> = { pending: ["Pendiente", "info"], accepted: ["Aceptada", "success"], revoked: ["Revocada", "neutral"], expired: ["Caducada", "warning"] };
const deliveryLabel: Record<DeliveryStatus, [string, Tone]> = { queued: ["En cola", "info"], sent: ["Enviado", "success"], failed: ["No se envió", "danger"], not_configured: ["Sin envío configurado", "warning"], deferred: ["Pospuesto (tope diario)", "warning"] };
const deliveryNote: Record<DeliveryStatus, string> = {
  sent: "Enviamos el correo con el enlace.",
  queued: "El correo está en cola. Si no llega, comparte el enlace.",
  failed: "No pudimos enviar el correo. Comparte el enlace por un medio privado o usa «Reintentar envío» más tarde.",
  not_configured: "No se pudo enviar el correo: el envío no está configurado en este espacio. Comparte el enlace por un medio privado.",
  deferred: "Se alcanzó el tope diario de correos y el mensaje no salió hoy. Comparte el enlace por un medio privado.",
};

export function Invitations({ inviting, onInviting, onChanged }: { inviting: boolean; onInviting: (value: boolean) => void; onChanged: () => void }) {
  const { toast, confirm } = useFeedback();
  const [items, setItems] = useState<Invitation[] | null>(null), [error, setError] = useState(""), [busy, setBusy] = useState(""), [issued, setIssued] = useState<Issued | null>(null);
  const load = async () => { setError(""); try { setItems((await api<{ invitations: Invitation[] }>("/invitations")).invitations); } catch (cause) { setError(message(cause)); } };
  useEffect(() => { void load(); }, []);
  async function resend(item: Invitation) {
    setBusy(item.id);
    try { const result = await api<{ link: string; delivery: DeliveryStatus }>(`/invitations/${item.id}/resend`, "POST"); setIssued({ name: item.displayName, email: item.email, link: result.link, delivery: result.delivery, resent: true }); await load(); onChanged(); }
    catch (cause) { toast({ tone: "error", message: message(cause) }); }
    finally { setBusy(""); }
  }
  async function revoke(item: Invitation) {
    if (!await confirm({ title: `¿Revocar la invitación de ${item.displayName}?`, body: "El enlace deja de funcionar de inmediato. Podrás invitar de nuevo a esta dirección más adelante.", confirm: "Revocar invitación", danger: true })) return;
    setBusy(item.id);
    try { await api(`/invitations/${item.id}/revoke`, "POST"); await load(); onChanged(); toast({ message: `Invitación de ${item.displayName} revocada.` }); }
    catch (cause) { toast({ tone: "error", message: message(cause) }); }
    finally { setBusy(""); }
  }
  const open = items?.filter(item => item.status === "pending" || item.status === "expired") || [];
  return <Section title="Invitaciones">
    {error ? <ErrorState error={error} retry={() => void load()}/> : !items ? <Loading label="Cargando invitaciones…" lines={2}/> : !items.length
      ? <p className="muted">Todavía no hay invitaciones. Usa «Invitar por correo» para que alguien se incorpore con su rol.</p>
      : <div className="table-card" role="region" aria-label="Invitaciones" tabIndex={0}><table className="members-table">
        <caption className="sr-only">Invitaciones por correo, su estado y su envío</caption>
        <thead><tr><th scope="col">Persona</th><th scope="col">Rol</th><th scope="col">Contrato</th><th scope="col">Estado</th><th scope="col">Caduca</th><th scope="col">Correo</th><th scope="col"><span className="sr-only">Acciones</span></th></tr></thead>
        <tbody>{items.map(item => {
          const [label, tone] = statusLabel[item.status], delivery = item.delivery ? deliveryLabel[item.delivery] : null;
          const actionable = item.status === "pending" || item.status === "expired";
          return <tr key={item.id}>
            <th scope="row"><span className="person-cell"><Avatar name={item.displayName} size={30}/><span><span>{item.displayName}</span><span className="muted small">{item.email}</span></span></span></th>
            <td>{roleLabel(item.role)}</td>
            <td>{item.contractTitle ? <span>{item.contractTitle}</span> : <span className="muted">Sin contrato</span>}</td>
            <td><StatusBadge tone={tone}>{label}</StatusBadge></td>
            <td>{item.status === "accepted" && item.acceptedAt ? <span className="muted small">Aceptada el {fullDate(item.acceptedAt)}</span> : <time dateTime={item.expiresAt}>{fullDate(item.expiresAt)}</time>}</td>
            <td>{delivery ? <StatusBadge tone={delivery[1]}>{delivery[0]}</StatusBadge> : <span className="muted">—</span>}</td>
            <td className="cell-actions">{actionable ? <Menu label={`Acciones de la invitación de ${item.displayName}`} items={[
              { label: item.delivery === "failed" ? "Reintentar envío" : "Reenviar", icon: "send", disabled: busy === item.id, onSelect: () => void resend(item) },
              { label: "Revocar", icon: "close", danger: true, disabled: busy === item.id, onSelect: () => void revoke(item) },
            ]}/> : null}</td>
          </tr>;
        })}</tbody>
      </table></div>}
    {open.length > 0 && <p className="muted small">Reenviar crea un enlace nuevo con 7 días de vigencia; el anterior deja de funcionar.</p>}
    {inviting && <InviteDialog onClose={() => onInviting(false)} onCreated={async result => { onInviting(false); setIssued(result); await load(); onChanged(); }}/>}
    {issued && <IssuedLink issued={issued} onClose={() => setIssued(null)}/>}
  </Section>;
}

function inviteSteps(step: 1 | 2 | 3): StatusStep[] {
  return [
    { id: "persona", label: "Persona", state: step === 1 ? "current" : "done" },
    { id: "contrato", label: "Contrato", state: step === 2 ? "current" : step > 2 ? "done" : "todo" },
    { id: "firmar", label: "Firmar y enviar", state: step === 3 ? "current" : "todo" },
  ];
}

function InviteDialog({ onClose, onCreated }: { onClose: () => void; onCreated: (issued: Issued) => Promise<void> }) {
  const { organization } = useSession();
  const today = localDay(organization?.timezone || "America/Guatemala");
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [email, setEmail] = useState(""), [displayName, setDisplayName] = useState(""), [role, setRole] = useState<"educator" | "admin">("educator");
  const [required, setRequired] = useState(false), [templates, setTemplates] = useState<ContractTemplate[] | null>(null);
  const [templateId, setTemplateId] = useState(""), [terms, setTerms] = useState<ContractTerms>(defaultTerms("volunteer"));
  const [startDate, setStartDate] = useState(today), [endDate, setEndDate] = useState("");
  const [fullName, setFullName] = useState(""), [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  useEffect(() => {
    Promise.all([api<{ required: boolean }>("/contract-settings"), api<{ templates: ContractTemplate[] }>("/contract-templates")])
      .then(([settings, catalog]) => {
        setRequired(settings.required);
        const published = catalog.templates.filter(item => item.status === "active" && item.current);
        setTemplates(published);
        if (published[0]?.current) { setTemplateId(published[0].id); setTerms(published[0].current.defaults); }
      })
      .catch(cause => { setTemplates([]); setError(message(cause)); });
  }, []);
  const chosen = (templates || []).find(item => item.id === templateId);
  const mustContract = required && role === "educator";
  const person = () => invitationInput({ email, displayName, role });
  function chooseTemplate(id: string) {
    const next = (templates || []).find(item => item.id === id);
    setTemplateId(id);
    if (next?.current) setTerms(next.current.defaults);
  }
  function goContract() {
    if (!person()) { setError("Revisa el correo y el nombre (2 a 80 caracteres)."); return; }
    setError(""); setStep(2);
  }
  async function sendPlain() {
    const value = person();
    if (!value) { setError("Revisa el correo y el nombre (2 a 80 caracteres)."); return; }
    if (mustContract) { setError("Esta organización exige un contrato: elige la plantilla y sus condiciones."); return; }
    setBusy(true); setError("");
    try {
      const result = await api<{ link: string; delivery: DeliveryStatus }>("/invitations", "POST", value);
      await onCreated({ name: value.displayName, email: value.email, link: result.link, delivery: result.delivery, resent: false });
    } catch (cause) { setError(message(cause)); setBusy(false); }
  }
  function goSign() {
    if (!chosen?.current) { setError("Elige una plantilla publicada."); return; }
    if (!startDate) { setError("Indica la fecha de inicio."); return; }
    setError(""); setStep(3);
  }
  async function sendSigned() {
    const value = person();
    if (!value) { setError("Revisa el correo y el nombre (2 a 80 caracteres)."); return; }
    if (!chosen?.current) { setError("Elige una plantilla publicada."); return; }
    if (fullName.trim().length < 3 || !password) { setError("Escribe tu nombre completo y tu contraseña."); return; }
    const allowed = chosen.current.editable || [];
    const changes = Object.fromEntries(allowed.map(field => [field, terms[field]]));
    setBusy(true); setError("");
    try {
      const result = await api<{ link: string; delivery: DeliveryStatus }>("/invitations", "POST", {
        ...value, contract: { templateId, startDate, endDate: endDate || undefined, terms: changes }, signature: { fullName, password },
      });
      await onCreated({ name: value.displayName, email: value.email, link: result.link, delivery: result.delivery, resent: false });
    } catch (cause) { setError(message(cause)); setBusy(false); }
  }
  const preview = chosen?.current ? mergeContract(chosen.current.body, contractValues({
    partyName: displayName.trim() || "La persona invitada", partyEmail: email.trim() || null,
    organization: organization?.name || "Happy Learners", engagement: chosen.engagement, terms,
    startDate: startDate || today, endDate: endDate || null, formatDate: date => date,
  })) : null;
  return <Modal title="Invitar por correo" onClose={onClose} wide>
    <div className="stack">
      <StatusSteps label="Pasos de la invitación" steps={inviteSteps(step)}/>
      {error && <p className="form-alert" role="alert"><Icon name="alert" size={18}/>{error}</p>}
      {step === 1 && <fieldset className="stack" disabled={busy}>
        <Field label="Correo" hint="Recibirá un enlace que caduca en 7 días."><input type="email" required maxLength={254} autoComplete="off" autoCapitalize="none" spellCheck={false} value={email} onChange={event => setEmail(event.target.value)}/></Field>
        <Field label="Nombre" hint="Como aparecerá en los cursos y en la actividad."><input required minLength={2} maxLength={80} autoComplete="off" value={displayName} onChange={event => setDisplayName(event.target.value)}/></Field>
        <Field label="Rol"><select value={role} onChange={event => setRole(event.target.value as "educator" | "admin")}><option value="educator">Educador: prepara e imparte sus cursos</option><option value="admin">Administración: configura la organización y su equipo</option></select></Field>
        <div className="modal-actions"><button type="button" className="button ghost" onClick={onClose}>Cancelar</button><button type="button" className="button primary" onClick={goContract}>Continuar</button></div>
      </fieldset>}
      {step === 2 && <fieldset className="stack" disabled={busy}>
        {templates === null ? <Loading label="Cargando plantillas…" lines={3}/> : !templates.length
          ? <p className="muted">{mustContract ? "Publica una plantilla en Contratos y políticas antes de invitar a un educador." : "Aún no hay plantillas publicadas. Puedes enviar la invitación sin contrato."}</p>
          : <>
            <div className="form-grid-12">
              <div className="form-span-12"><Field label="Plantilla"><select value={templateId} onChange={event => chooseTemplate(event.target.value)}>{templates.map(item => <option key={item.id} value={item.id}>{item.name} · {engagementLabels[item.engagement]}</option>)}</select></Field></div>
              <div className="form-span-6"><Field label="Inicio"><input type="date" required value={startDate} onChange={event => setStartDate(event.target.value)}/></Field></div>
              <div className="form-span-6"><Field label="Fin" optional><input type="date" value={endDate} onChange={event => setEndDate(event.target.value)}/></Field></div>
            </div>
            {chosen?.current && <TermsFields engagement={chosen.engagement} value={terms} onChange={setTerms} allowed={chosen.current.editable}/>}
            {preview && <Section title="Vista previa del documento">
              <ContractOfferView body={preview} terms={terms} startDate={startDate || today} endDate={endDate || null} engagement={chosen!.engagement}/>
            </Section>}
          </>}
        <div className="modal-actions">
          <button type="button" className="button ghost" onClick={() => { setError(""); setStep(1); }}>Atrás</button>
          {!mustContract && <button type="button" className="button secondary" onClick={() => void sendPlain()}>{busy ? "Enviando…" : "Enviar sin contrato"}</button>}
          <button type="button" className="button primary" disabled={!chosen?.current} onClick={goSign}>Continuar</button>
        </div>
      </fieldset>}
      {step === 3 && <fieldset className="stack" disabled={busy}>
        <p className="muted small">Firmas en nombre de la organización. Quien reciba el enlace leerá el contrato y lo firmará al crear su cuenta.</p>
        <Field label="Nombre completo"><input required minLength={3} maxLength={120} autoComplete="name" value={fullName} onChange={event => setFullName(event.target.value)}/></Field>
        <Field label="Contraseña de tu cuenta"><input type="password" required maxLength={128} autoComplete="current-password" value={password} onChange={event => setPassword(event.target.value)}/></Field>
        <div className="modal-actions">
          <button type="button" className="button ghost" onClick={() => { setError(""); setStep(2); }}>Atrás</button>
          <button type="button" className="button primary" onClick={() => void sendSigned()}>{busy ? "Enviando…" : "Firmar y enviar"}</button>
        </div>
      </fieldset>}
    </div>
  </Modal>;
}

function ContractOfferView({ body, terms, startDate, endDate, engagement, signature }: {
  body: RichTextDocument | null; terms: ContractTerms; startDate: string; endDate: string | null; engagement: ContractOffer["engagement"];
  signature?: ContractOffer["organizationSignature"];
}) {
  return <div className="contract-offer">
    <p className="muted small">{engagementLabels[engagement]}</p>
    {body && <RichText value={body} editable={false} toolbar={false} label="Documento del contrato"/>}
    <Section title="Condiciones">
      <p className="small">{terms.role} · {compensationSummary(terms)}</p>
      <p className="muted small">Del {startDate} al {endDate || "plazo indefinido"}{terms.weeklyHours ? ` · ${terms.weeklyHours} h semanales` : ""}{terms.location ? ` · ${locationLabels[terms.location]}` : ""}</p>
    </Section>
    {signature && <p className="small">Firma de la organización: {signature.name} · {signature.signedAt.slice(0, 10)}</p>}
  </div>;
}

/** The result: whether the message left, and the link to copy (the documented fallback). */
function IssuedLink({ issued, onClose }: { issued: Issued; onClose: () => void }) {
  const { toast } = useFeedback();
  const sent = issued.delivery === "sent";
  return <Modal title={issued.resent ? "Invitación reenviada" : "Invitación creada"} onClose={onClose} footer={<button type="button" className="button primary" data-autofocus onClick={onClose}>Listo</button>}>
    <div className="stack">
      <p>Invitación para <strong>{issued.name}</strong> ({issued.email}).</p>
      <div className={`notice${sent ? "" : " warning"}`} role="status"><Icon name={sent ? "check" : "alert"} size={18}/><p>{deliveryNote[issued.delivery]}</p></div>
      <Field label="Enlace de invitación" hint="Funciona una sola vez y caduca en 7 días. Quien lo tenga puede crear la cuenta: compártelo solo con esta persona.">
        <input readOnly value={issued.link} onFocus={event => event.currentTarget.select()}/>
      </Field>
      <button type="button" className="button secondary small" onClick={() => void navigator.clipboard?.writeText(issued.link).then(() => toast({ message: "Enlace copiado." }), () => toast({ tone: "error", message: "No se pudo copiar. Selecciónalo y cópialo a mano." }))}><Icon name="copy" size={16}/>Copiar enlace</button>
    </div>
  </Modal>;
}

/** Public page /invitacion/<token>: the invited person reads the contract (if any), chooses a username and password and enters signed in. */
export function AcceptInvitation({ token }: { token: string }) {
  const { navigate } = useNavigation();
  const [preview, setPreview] = useState<InvitationPreview | null>(null), [problem, setProblem] = useState<{ title: string; text: string } | null>(null);
  const [username, setUsername] = useState(""), [password, setPassword] = useState(""), [repeat, setRepeat] = useState("");
  const [fullName, setFullName] = useState(""), [accepted, setAccepted] = useState(false);
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  const fail = (cause: unknown) => {
    const code = cause instanceof ApiError ? String(cause.detail.code || "") : "";
    const title = code === "INVITATION_EXPIRED" ? "Esta invitación caducó" : code === "INVITATION_REVOKED" ? "Esta invitación fue revocada" : code === "INVITATION_USED" ? "Esta invitación ya se usó" : code === "INVITATION_NOT_FOUND" ? "Invitación no válida" : "No pudimos abrir la invitación";
    setProblem({ title, text: message(cause) });
  };
  useEffect(() => { api<{ invitation: InvitationPreview }>(`/invitations/accept/${encodeURIComponent(token)}`).then(result => setPreview(result.invitation), fail); }, [token]);
  async function submit(event: FormEvent) {
    event.preventDefault(); setError("");
    const user = username.trim().toLowerCase();
    if (!usernamePattern.test(user)) { setError("Elige un usuario de 3 a 32 letras minúsculas, números, puntos o guiones."); return; }
    if (password !== repeat) { setError("Las contraseñas no coinciden."); return; }
    if (!acceptablePassword(password, user)) { setError(`Usa de ${minPasswordLength} a ${maxPasswordLength} caracteres variados, distintos de tu usuario.`); return; }
    if (preview?.contract && (!accepted || fullName.trim().length < 3)) { setError("Lee el contrato, marca que lo aceptas y escribe tu nombre completo para firmarlo."); return; }
    setBusy(true);
    try {
      await api(`/invitations/accept/${encodeURIComponent(token)}`, "POST", preview?.contract
        ? { username: user, password, signature: { fullName, accept: true } }
        : { username: user, password });
      setPassword(""); setRepeat(""); navigate("/inicio", true);
    } catch (cause) { if (cause instanceof ApiError && cause.status === 410) fail(cause); else setError(message(cause)); setBusy(false); }
  }
  const offer = preview?.contract;
  return <div className="login-page">
    <a className="skip-link" href="#main">Saltar al contenido</a>
    <main id="main" className={`login-main${offer ? " is-invitation" : ""}`}>
      <div className="login-brand"><span className="brand-mark" aria-hidden="true">hl</span><span>Happy Learners</span></div>
      <section className={`login-card${offer ? " is-wide" : ""}`} aria-labelledby="invitation-title">
        {problem ? <>
          <h1 id="invitation-title">{problem.title}</h1>
          <p className="form-alert" role="alert"><Icon name="alert" size={18}/>{problem.text}</p>
          <a className="button secondary full" href="/inicio">Ir a iniciar sesión</a>
        </> : !preview ? <><h1 id="invitation-title">Invitación</h1><p role="status">Abriendo la invitación…</p></> : <>
          <h1 id="invitation-title">Únete a {preview.organization}</h1>
          <p>Hola, {preview.displayName}. Te invitaron con el rol <strong>{roleLabel(preview.role)}</strong>. Elige tu usuario y contraseña; la invitación caduca el {fullDate(preview.expiresAt)}.</p>
          {offer && <>
            <h2>{offer.title}</h2>
            <ContractOfferView body={offer.body} terms={offer.terms} startDate={offer.startDate} endDate={offer.endDate} engagement={offer.engagement} signature={offer.organizationSignature}/>
          </>}
          {error && <p className="form-alert" role="alert"><Icon name="alert" size={18}/>{error}</p>}
          <form onSubmit={submit}>
            {offer && <>
              <label className="legal-check"><input type="checkbox" checked={accepted} onChange={event => setAccepted(event.target.checked)}/><span>He leído y acepto</span></label>
              <div className="field"><label htmlFor="invite-fullname">Nombre completo</label><input id="invite-fullname" autoComplete="name" minLength={3} maxLength={120} value={fullName} onChange={event => setFullName(event.target.value)} required/></div>
            </>}
            <div className="field"><label htmlFor="invite-username">Usuario</label><input id="invite-username" autoComplete="username" minLength={3} maxLength={32} autoCapitalize="none" spellCheck={false} aria-describedby="invite-username-hint" value={username} onChange={event => setUsername(event.target.value)} required/>
              <small id="invite-username-hint" className="hint">Letras minúsculas, números, puntos o guiones; por ejemplo, ana.lopez.</small></div>
            <div className="field"><label htmlFor="invite-password">Contraseña</label><input id="invite-password" type="password" autoComplete="new-password" minLength={minPasswordLength} maxLength={maxPasswordLength} aria-describedby="invite-password-hint" value={password} onChange={event => setPassword(event.target.value)} required/>
              <small id="invite-password-hint" className="hint">Al menos {minPasswordLength} caracteres. Una frase que recuerdes funciona bien.</small></div>
            <div className="field"><label htmlFor="invite-repeat">Repite la contraseña</label><input id="invite-repeat" type="password" autoComplete="new-password" maxLength={maxPasswordLength} value={repeat} onChange={event => setRepeat(event.target.value)} required/></div>
            <button className="button primary full" disabled={busy}>{busy ? "Creando tu cuenta…" : "Crear cuenta y entrar"}</button>
          </form>
        </>}
      </section>
    </main>
  </div>;
}
