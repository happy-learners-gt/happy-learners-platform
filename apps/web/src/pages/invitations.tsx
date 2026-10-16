import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import type { DeliveryStatus, Invitation, InvitationPreview } from "@happy-learners/contracts";
import { acceptablePassword, invitationInput, maxPasswordLength, minPasswordLength, roleLabel, usernamePattern } from "@happy-learners/domain";
import { api, ApiError, message } from "../api";
import { fullDate } from "../model";
import { useNavigation } from "../navigation";
import { Modal, useFeedback } from "../ui/feedback";
import { Icon } from "../ui/icons";
import { Menu } from "../ui/Menu";
import { Avatar } from "../ui/progress";
import { ErrorState, Field, Loading, Section, StatusBadge } from "../ui/primitives";
import type { Tone } from "../ui/primitives";

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
        <thead><tr><th scope="col">Persona</th><th scope="col">Rol</th><th scope="col">Estado</th><th scope="col">Caduca</th><th scope="col">Correo</th><th scope="col"><span className="sr-only">Acciones</span></th></tr></thead>
        <tbody>{items.map(item => {
          const [label, tone] = statusLabel[item.status], delivery = item.delivery ? deliveryLabel[item.delivery] : null;
          const actionable = item.status === "pending" || item.status === "expired";
          return <tr key={item.id}>
            <th scope="row"><span className="person-cell"><Avatar name={item.displayName} size={30}/><span><span>{item.displayName}</span><span className="muted small">{item.email}</span></span></span></th>
            <td>{roleLabel(item.role)}</td>
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

function InviteDialog({ onClose, onCreated }: { onClose: () => void; onCreated: (issued: Issued) => Promise<void> }) {
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setError("");
    const value = invitationInput(Object.fromEntries(new FormData(event.currentTarget)));
    if (!value) { setError("Revisa el correo y el nombre (2 a 80 caracteres)."); return; }
    setBusy(true);
    try { const result = await api<{ link: string; delivery: DeliveryStatus }>("/invitations", "POST", value); await onCreated({ name: value.displayName, email: value.email, link: result.link, delivery: result.delivery, resent: false }); }
    catch (cause) { setError(message(cause)); setBusy(false); }
  }
  return <Modal title="Invitar por correo" onClose={onClose}>
    <form className="stack" onSubmit={submit}><fieldset className="stack" disabled={busy}>
      {error && <p className="form-alert" role="alert"><Icon name="alert" size={18}/>{error}</p>}
      <Field label="Correo" hint="Recibirá un enlace que caduca en 7 días."><input name="email" type="email" required maxLength={254} autoComplete="off" autoCapitalize="none" spellCheck={false}/></Field>
      <Field label="Nombre" hint="Como aparecerá en los cursos y en la actividad."><input name="displayName" required minLength={2} maxLength={80} autoComplete="off"/></Field>
      <Field label="Rol"><select name="role" defaultValue="educator"><option value="educator">Educador: prepara e imparte sus cursos</option><option value="admin">Administración: configura la organización y su equipo</option></select></Field>
      <div className="modal-actions"><button type="button" className="button ghost" onClick={onClose}>Cancelar</button><button className="button primary">{busy ? "Enviando…" : "Enviar invitación"}</button></div>
    </fieldset></form>
  </Modal>;
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

/** Public page /invitacion/<token>: the invited person chooses a username and password and enters signed in. */
export function AcceptInvitation({ token }: { token: string }) {
  const { navigate } = useNavigation();
  const [preview, setPreview] = useState<InvitationPreview | null>(null), [problem, setProblem] = useState<{ title: string; text: string } | null>(null);
  const [username, setUsername] = useState(""), [password, setPassword] = useState(""), [repeat, setRepeat] = useState("");
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
    setBusy(true);
    try { await api(`/invitations/accept/${encodeURIComponent(token)}`, "POST", { username: user, password }); setPassword(""); setRepeat(""); navigate("/inicio", true); }
    catch (cause) { if (cause instanceof ApiError && cause.status === 410) fail(cause); else setError(message(cause)); setBusy(false); }
  }
  return <div className="login-page">
    <a className="skip-link" href="#main">Saltar al contenido</a>
    <main id="main" className="login-main">
      <div className="login-brand"><span className="brand-mark" aria-hidden="true">hl</span><span>Happy Learners</span></div>
      <section className="login-card" aria-labelledby="invitation-title">
        {problem ? <>
          <h1 id="invitation-title">{problem.title}</h1>
          <p className="form-alert" role="alert"><Icon name="alert" size={18}/>{problem.text}</p>
          <a className="button secondary full" href="/inicio">Ir a iniciar sesión</a>
        </> : !preview ? <><h1 id="invitation-title">Invitación</h1><p role="status">Abriendo la invitación…</p></> : <>
          <h1 id="invitation-title">Únete a {preview.organization}</h1>
          <p>Hola, {preview.displayName}. Te invitaron con el rol <strong>{roleLabel(preview.role)}</strong>. Elige tu usuario y contraseña; la invitación caduca el {fullDate(preview.expiresAt)}.</p>
          {error && <p className="form-alert" role="alert"><Icon name="alert" size={18}/>{error}</p>}
          <form onSubmit={submit}>
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
