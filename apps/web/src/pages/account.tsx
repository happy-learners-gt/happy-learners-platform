import { useEffect, useState } from "react";
import type { FormEvent, ReactNode } from "react";
import type { AccountNoticeDelivery, AccountOverview, AccountSession, ClosureRequest, EmailChangeIssued, EmailChangePreview, MyClosure, SignInRecord } from "@happy-learners/contracts";
import { acceptablePassword, closureLabels, emailChangeHours, maxClosureReason, maxPasswordLength, minPasswordLength, normalizeEmail, personalDataSections } from "@happy-learners/domain";
import { api, ApiError, message } from "../api";
import { fullDate, timeAgo } from "../model";
import { useSession } from "../session";
import { Modal, useFeedback } from "../ui/feedback";
import { Icon } from "../ui/icons";
import { EmptyState, ErrorState, Field, Loading, PageHeader, Section, StatusBadge } from "../ui/primitives";
import type { Tone } from "../ui/primitives";

/**
 * ST-158, ST-159: «Cuenta», reached from the menu with the person's name. Correo (verified change), Contraseña,
 * Sesiones activas (close one or all the others), Historial de accesos, Mis datos (JSON download) and Cerrar la cuenta
 * (a request administration attends by recording the departure, ST-123). Security notices are always sent.
 */
const deliveryNote: Record<AccountNoticeDelivery, string> = {
  sent: "Te enviamos un enlace a la nueva dirección. Ábrelo para confirmarla.",
  queued: "El correo está en cola. Si no llega, vuelve a pedir el cambio.",
  failed: "No pudimos enviar el correo. Abre el enlace de abajo desde un navegador donde puedas consultar esa dirección.",
  not_configured: "Este espacio no tiene configurado el envío de correo. Copia el enlace y ábrelo para confirmar la nueva dirección.",
  deferred: "Se alcanzó el tope diario de correos y el mensaje no salió hoy. Copia el enlace y ábrelo para confirmar la nueva dirección.",
  no_address: "No hay una dirección a la que enviar el enlace.",
};
const countries = (() => { try { return new Intl.DisplayNames(["es"], { type: "region" }); } catch { return null; } })();
const countryName = (code: string | null) => !code ? "Desconocido" : countries?.of(code) || code;
const shortDate = (value: string) => new Date(value).toLocaleString("es-GT", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
const sections: [string, string][] = [["correo", "Correo"], ["contrasena", "Contraseña"], ["sesiones", "Sesiones activas"], ["accesos", "Historial de accesos"], ["datos", "Mis datos"], ["cierre", "Cerrar la cuenta"]];

export function AccountPage() {
  const { member } = useSession();
  const [overview, setOverview] = useState<AccountOverview | null>(null), [error, setError] = useState(""), [revision, setRevision] = useState(0);
  const load = () => { setError(""); api<{ account: AccountOverview }>("/me/account").then(result => setOverview(result.account)).catch(cause => setError(message(cause))); };
  useEffect(load, [revision]);
  const refresh = () => setRevision(value => value + 1);
  return <>
    <PageHeader title="Cuenta" description="Cómo entras a Happy Learners y qué guardamos de tu acceso: tu correo, tu contraseña, dónde está abierta tu sesión y tus datos."/>
    <div className="reading stack account-page">
      <nav className="account-toc" aria-label="Secciones de la cuenta"><ul>{sections.map(([id, label]) => <li key={id}><a href={`#${id}`}>{label}</a></li>)}</ul></nav>
      {error ? <ErrorState error={error} retry={load}/> : !overview ? <Loading label="Cargando tu cuenta…" lines={3}/> : <EmailSection overview={overview} onChanged={refresh}/>}
      <PasswordSection username={member.username} onChanged={refresh}/>
      <SessionsSection revision={revision} onChanged={refresh}/>
      <SignInHistory revision={revision}/>
      <MyData/>
      <CloseAccount/>
    </div>
  </>;
}

function Anchored({ id, title, action, className, children }: { id: string; title: string; action?: ReactNode; className?: string; children: ReactNode }) {
  return <div id={id} className="account-anchor"><Section title={title} action={action} className={className}>{children}</Section></div>;
}

function EmailSection({ overview, onChanged }: { overview: AccountOverview; onChanged: () => void }) {
  const { toast, confirm } = useFeedback();
  const [changing, setChanging] = useState(false), [issued, setIssued] = useState<EmailChangeIssued | null>(null), [busy, setBusy] = useState(false);
  const pending = overview.pendingEmail;
  async function cancel() {
    if (!await confirm({ title: "¿Cancelar el cambio de correo?", body: `El enlace enviado a ${pending!.newEmail} deja de funcionar y tu correo de acceso sigue siendo el actual.`, confirm: "Cancelar el cambio", cancel: "Conservar", danger: true })) return;
    setBusy(true);
    try { await api("/me/account/email", "DELETE"); toast({ message: "Cambio de correo cancelado." }); onChanged(); }
    catch (cause) { toast({ tone: "error", message: message(cause) }); }
    finally { setBusy(false); }
  }
  return <Anchored id="correo" title="Correo" action={<button type="button" className="button secondary small" onClick={() => setChanging(true)}><Icon name="edit" size={16}/>{overview.email ? "Cambiar correo" : "Agregar correo"}</button>}>
    <dl className="profile-facts">
      <dt>Usuario</dt><dd>@{overview.username} <span className="muted small">· no se puede cambiar</span></dd>
      <dt>Correo de acceso</dt><dd>{overview.email || <span className="muted">Sin correo de acceso</span>}</dd>
      <dt>Organización</dt><dd>{overview.organization}</dd>
    </dl>
    <p className="muted small">A este correo llegan los avisos de seguridad de tu cuenta (siempre, no se pueden desactivar) y tus notificaciones. Un cambio solo se aplica cuando confirmas el enlace que enviamos a la nueva dirección; avisamos también a la anterior.</p>
    {pending && <div className="notice warning" role="status"><Icon name="clock" size={18}/><div>
      <p><strong>Pendiente de confirmar:</strong> {pending.newEmail} (el enlace caduca el {fullDate(pending.expiresAt)})</p>
      <button type="button" className="button secondary small" disabled={busy} onClick={() => void cancel()}>Cancelar el cambio</button>
    </div></div>}
    {changing && <EmailDialog current={overview.email} onClose={() => setChanging(false)} onIssued={result => { setChanging(false); setIssued(result); onChanged(); }}/>}
    {issued && <EmailIssued issued={issued} onClose={() => setIssued(null)}/>}
  </Anchored>;
}

function EmailDialog({ current, onClose, onIssued }: { current: string | null; onClose: () => void; onIssued: (issued: EmailChangeIssued) => void }) {
  const [email, setEmail] = useState(""), [password, setPassword] = useState(""), [busy, setBusy] = useState(false), [error, setError] = useState("");
  async function submit(event: FormEvent) {
    event.preventDefault(); setError("");
    const address = normalizeEmail(email);
    if (!address) { setError("Escribe un correo válido."); return; }
    if (address === current) { setError("Ese ya es tu correo de acceso."); return; }
    setBusy(true);
    try { onIssued(await api<EmailChangeIssued>("/me/account/email", "POST", { email: address, currentPassword: password })); }
    catch (cause) { setError(message(cause)); setBusy(false); }
  }
  return <Modal title={current ? "Cambiar correo de acceso" : "Agregar correo de acceso"} onClose={onClose}>
    <form className="stack" onSubmit={submit}><fieldset className="stack" disabled={busy}>
      {error && <p className="form-alert" role="alert"><Icon name="alert" size={18}/>{error}</p>}
      <Field label="Nuevo correo" hint={`Te enviaremos un enlace para confirmarlo; caduca en ${emailChangeHours} horas.`}><input type="email" value={email} onChange={event => setEmail(event.target.value)} required maxLength={254} autoComplete="email" autoCapitalize="none" spellCheck={false}/></Field>
      <Field label="Contraseña actual" hint="Para confirmar que eres tú."><input type="password" value={password} onChange={event => setPassword(event.target.value)} required maxLength={maxPasswordLength} autoComplete="current-password"/></Field>
      <div className="modal-actions"><button type="button" className="button ghost" onClick={onClose}>Cancelar</button><button className="button primary">{busy ? "Enviando…" : "Enviar enlace"}</button></div>
    </fieldset></form>
  </Modal>;
}

/** The result of a change request; when the message could not leave, the link to copy (DEC-042). */
function EmailIssued({ issued, onClose }: { issued: EmailChangeIssued; onClose: () => void }) {
  const { toast } = useFeedback();
  const sent = issued.delivery === "sent";
  return <Modal title="Confirma tu nuevo correo" onClose={onClose} footer={<button type="button" className="button primary" data-autofocus onClick={onClose}>Listo</button>}>
    <div className="stack">
      <p>Pediste usar <strong>{issued.change.newEmail}</strong> como correo de acceso. Hasta que lo confirmes, tu correo actual sigue igual.</p>
      <div className={`notice${sent ? "" : " warning"}`} role="status"><Icon name={sent ? "check" : "alert"} size={18}/><p>{deliveryNote[issued.delivery]}</p></div>
      {issued.link && <>
        <Field label="Enlace de confirmación" hint={`Funciona una sola vez y caduca en ${emailChangeHours} horas. No lo compartas: confirma el cambio de tu correo.`}>
          <input readOnly value={issued.link} onFocus={event => event.currentTarget.select()}/>
        </Field>
        <div className="form-actions">
          <button type="button" className="button secondary small" onClick={() => void navigator.clipboard?.writeText(issued.link!).then(() => toast({ message: "Enlace copiado." }), () => toast({ tone: "error", message: "No se pudo copiar. Selecciónalo y cópialo a mano." }))}><Icon name="copy" size={16}/>Copiar enlace</button>
        </div>
      </>}
    </div>
  </Modal>;
}

function PasswordSection({ username, onChanged }: { username: string; onChanged: () => void }) {
  const { toast } = useFeedback();
  const [current, setCurrent] = useState(""), [next, setNext] = useState(""), [repeat, setRepeat] = useState(""), [busy, setBusy] = useState(false), [error, setError] = useState("");
  async function submit(event: FormEvent) {
    event.preventDefault(); setError("");
    if (next !== repeat) { setError("Las contraseñas nuevas no coinciden."); return; }
    if (!acceptablePassword(next, username, current)) { setError(`Usa de ${minPasswordLength} a ${maxPasswordLength} caracteres variados, distintos de tu usuario y de tu contraseña actual.`); return; }
    setBusy(true);
    try { await api("/account/password", "POST", { currentPassword: current, newPassword: next }); setCurrent(""); setNext(""); setRepeat(""); toast({ message: "Contraseña cambiada. Se cerraron tus otras sesiones." }); onChanged(); }
    catch (cause) { setError(message(cause)); }
    finally { setBusy(false); }
  }
  return <Anchored id="contrasena" title="Contraseña">
    <p className="muted small">Al cambiarla se cierran tus sesiones en otros dispositivos; esta sigue abierta. Si tienes correo de acceso, te avisamos del cambio.</p>
    <form className="stack" onSubmit={submit} aria-label="Cambiar contraseña"><fieldset className="stack" disabled={busy}>
      {error && <p className="form-alert" role="alert"><Icon name="alert" size={18}/>{error}</p>}
      <Field label="Contraseña actual"><input type="password" value={current} onChange={event => setCurrent(event.target.value)} required maxLength={maxPasswordLength} autoComplete="current-password"/></Field>
      <div className="field-grid">
        <Field label="Nueva contraseña" hint={`Al menos ${minPasswordLength} caracteres. Una frase que recuerdes funciona bien.`}><input type="password" value={next} onChange={event => setNext(event.target.value)} required minLength={minPasswordLength} maxLength={maxPasswordLength} autoComplete="new-password"/></Field>
        <Field label="Repite la nueva contraseña"><input type="password" value={repeat} onChange={event => setRepeat(event.target.value)} required maxLength={maxPasswordLength} autoComplete="new-password"/></Field>
      </div>
      <div className="form-actions"><button className="button primary">{busy ? "Guardando…" : "Cambiar contraseña"}</button></div>
    </fieldset></form>
  </Anchored>;
}

function SessionsSection({ revision, onChanged }: { revision: number; onChanged: () => void }) {
  const { toast, confirm } = useFeedback();
  const [sessions, setSessions] = useState<AccountSession[] | null>(null), [error, setError] = useState(""), [busy, setBusy] = useState("");
  const load = () => { setError(""); api<{ sessions: AccountSession[] }>("/me/account/sessions").then(result => setSessions(result.sessions)).catch(cause => setError(message(cause))); };
  useEffect(load, [revision]);
  const others = sessions?.filter(session => !session.current) || [];
  async function close(session: AccountSession) {
    if (!await confirm({ title: `¿Cerrar la sesión en ${session.device}?`, body: "Quien la esté usando tendrá que volver a entrar con tu usuario y contraseña.", confirm: "Cerrar sesión", danger: true })) return;
    setBusy(session.id);
    try { await api(`/me/account/sessions/${session.id}`, "DELETE"); toast({ message: `Sesión en ${session.device} cerrada.` }); onChanged(); }
    catch (cause) { toast({ tone: "error", message: message(cause) }); load(); }
    finally { setBusy(""); }
  }
  async function closeOthers() {
    if (!await confirm({ title: "¿Cerrar todas las demás sesiones?", body: `Se cerrará${others.length === 1 ? " 1 sesión" : `n ${others.length} sesiones`} en otros dispositivos o navegadores. Esta sigue abierta.`, confirm: "Cerrar las demás", danger: true })) return;
    setBusy("others");
    try { const result = await api<{ closed: number }>("/me/account/sessions/others", "DELETE"); toast({ message: result.closed === 1 ? "Se cerró 1 sesión." : `Se cerraron ${result.closed} sesiones.` }); onChanged(); }
    catch (cause) { toast({ tone: "error", message: message(cause) }); }
    finally { setBusy(""); }
  }
  return <Anchored id="sesiones" title="Sesiones activas" action={others.length > 0 && <button type="button" className="button secondary small" disabled={busy === "others"} onClick={() => void closeOthers()}><Icon name="logout" size={16}/>Cerrar las demás sesiones</button>}>
    <p className="muted small">Dónde está abierta tu cuenta. Cada sesión dura hasta 8 horas. Si no reconoces una, ciérrala y cambia tu contraseña.</p>
    {error ? <ErrorState error={error} retry={load}/> : !sessions ? <Loading label="Cargando sesiones…" lines={2}/> : <div className="table-card" role="region" aria-label="Lista de sesiones activas" tabIndex={0}><table className="members-table account-table">
      <caption className="sr-only">Tus sesiones abiertas: dispositivo, país, inicio y último uso</caption>
      <thead><tr><th scope="col">Dispositivo</th><th scope="col">País</th><th scope="col">Inició</th><th scope="col">Último uso</th><th scope="col"><span className="sr-only">Acciones</span></th></tr></thead>
      <tbody>{sessions.map(session => <tr key={session.id}>
        <th scope="row"><span className="device-cell"><Icon name={/iPhone|Android/.test(session.device) ? "present" : "grid"} size={18}/><span><span>{session.device}</span>{session.current && <> <StatusBadge tone="success">Esta sesión</StatusBadge></>}{session.method === "invitation" && <span className="muted small"> · al aceptar la invitación</span>}</span></span></th>
        <td>{countryName(session.country)}</td>
        <td><time dateTime={session.createdAt} title={fullDate(session.createdAt)}>{shortDate(session.createdAt)}</time></td>
        <td>{session.current ? <span>Ahora</span> : <time dateTime={session.lastUsedAt} title={fullDate(session.lastUsedAt)}>{timeAgo(session.lastUsedAt)}</time>}</td>
        <td className="cell-actions">{session.current ? <span className="muted small">Sesión actual</span>
          : <button type="button" className="button ghost small" disabled={busy === session.id} aria-label={`Cerrar la sesión en ${session.device}`} onClick={() => void close(session)}><Icon name="logout" size={16}/>Cerrar</button>}</td>
      </tr>)}</tbody>
    </table></div>}
  </Anchored>;
}

const outcomeLabel: Record<SignInRecord["outcome"], [string, Tone]> = { succeeded: ["Correcto", "success"], failed: ["Contraseña incorrecta", "danger"] };
function SignInHistory({ revision }: { revision: number }) {
  const [logins, setLogins] = useState<SignInRecord[] | null>(null), [limit, setLimit] = useState(30), [error, setError] = useState("");
  const load = () => { setError(""); api<{ logins: SignInRecord[]; limit: number }>("/me/account/logins").then(result => { setLogins(result.logins); setLimit(result.limit); }).catch(cause => setError(message(cause))); };
  useEffect(load, [revision]);
  const failed = logins?.filter(item => item.outcome === "failed").length || 0;
  return <Anchored id="accesos" title="Historial de accesos">
    <p className="muted small">Los últimos {limit} intentos de entrar con tu usuario, correctos o no. No guardamos tu dirección IP: solo el dispositivo y el país aproximado.</p>
    {failed > 0 && <div className="notice warning" role="status"><Icon name="alert" size={18}/><p>{failed === 1 ? "Hay 1 intento" : `Hay ${failed} intentos`} con contraseña incorrecta. Si no fuiste tú, cambia tu contraseña y cierra las sesiones que no reconozcas.</p></div>}
    {error ? <ErrorState error={error} retry={load}/> : !logins ? <Loading label="Cargando historial…" lines={2}/> : !logins.length
      ? <EmptyState compact icon="shield" title="Sin accesos registrados">Aquí aparecerán tus próximos inicios de sesión.</EmptyState>
      : <div className="table-card" role="region" aria-label="Lista de accesos recientes" tabIndex={0}><table className="members-table account-table">
        <caption className="sr-only">Tus inicios de sesión recientes: fecha, resultado, dispositivo y país</caption>
        <thead><tr><th scope="col">Fecha</th><th scope="col">Resultado</th><th scope="col">Dispositivo</th><th scope="col">País</th></tr></thead>
        <tbody>{logins.map(item => <tr key={item.id}>
          <th scope="row"><time dateTime={item.occurredAt}>{shortDate(item.occurredAt)}</time></th>
          <td><StatusBadge tone={outcomeLabel[item.outcome][1]}>{outcomeLabel[item.outcome][0]}</StatusBadge>{item.method === "invitation" && <span className="muted small"> · invitación</span>}</td>
          <td>{item.device}</td>
          <td>{countryName(item.country)}</td>
        </tr>)}</tbody>
      </table></div>}
  </Anchored>;
}

function MyData() {
  return <Anchored id="datos" title="Mis datos" action={<a className="button secondary small" href="/api/me/export" download><Icon name="download" size={16}/>Descargar mis datos</a>}>
    <p className="muted small">Una copia en JSON de lo que la plataforma guarda sobre ti. Solo incluye tus propios registros: nada de otras personas ni de estudiantes, ni contraseñas, ni el contenido de tus documentos. Guárdala en un lugar privado.</p>
    <ul className="data-sections">{personalDataSections.map(item => <li key={item.key}><strong>{item.label}</strong><span className="muted small">{item.description}</span></li>)}</ul>
  </Anchored>;
}

const closureTone: Record<ClosureRequest["status"], Tone> = { requested: "warning", in_progress: "info", completed: "neutral", cancelled: "neutral" };
function CloseAccount() {
  const { toast, confirm } = useFeedback();
  const [state, setState] = useState<MyClosure | null>(null), [error, setError] = useState(""), [reason, setReason] = useState(""), [busy, setBusy] = useState(false);
  const load = () => { setError(""); api<MyClosure>("/me/closure").then(setState).catch(cause => setError(message(cause))); };
  useEffect(load, []);
  const open = state?.closure && (state.closure.status === "requested" || state.closure.status === "in_progress") ? state.closure : null;
  async function request(event: FormEvent) {
    event.preventDefault();
    if (!await confirm({ title: "¿Pedir el cierre de tu cuenta?", body: "Administración recibirá tu solicitud. Mientras no la inicie, puedes cancelarla desde aquí.", confirm: "Solicitar el cierre", danger: true })) return;
    setBusy(true);
    try { setState(await api<MyClosure>("/me/closure", "POST", { reason })); setReason(""); toast({ message: "Solicitud enviada a administración." }); }
    catch (cause) { toast({ tone: "error", message: message(cause) }); }
    finally { setBusy(false); }
  }
  async function cancel() {
    if (!await confirm({ title: "¿Cancelar tu solicitud de cierre?", body: "Tu cuenta seguirá abierta como hasta ahora.", confirm: "Cancelar la solicitud", cancel: "Conservar la solicitud" })) return;
    setBusy(true);
    try { setState(await api<MyClosure>("/me/closure", "DELETE")); toast({ message: "Solicitud de cierre cancelada. Tu cuenta sigue abierta." }); }
    catch (cause) { toast({ tone: "error", message: message(cause) }); load(); }
    finally { setBusy(false); }
  }
  return <Anchored id="cierre" title="Cerrar la cuenta" className="danger-zone">
    <p className="muted small">Al cerrar tu cuenta, administración registra tu salida: ya no podrás entrar, tus cursos y secciones pasan a otras personas y lo que hiciste se conserva en la organización. Antes, descarga tus datos.</p>
    {error ? <ErrorState error={error} retry={load}/> : !state ? <Loading label="Cargando…" lines={2}/> : state.blocked ? <p className="notice" role="status"><Icon name="info" size={18}/>{state.blocked}</p>
      : open ? <div className="stack">
        <p><StatusBadge tone={closureTone[open.status]}>{closureLabels[open.status]}</StatusBadge> Solicitud del {fullDate(open.requestedAt)}</p>
        {open.status === "requested" ? <><p className="muted small">Administración aún no la inicia. Puedes cancelarla.</p>
          <div className="form-actions"><button type="button" className="button secondary" disabled={busy} onClick={() => void cancel()}>Cancelar la solicitud</button></div></>
          : <p className="muted small">El {fullDate(open.startedAt!)}, {open.startedBy || "administración"} inició el cierre. Si quieres conservar tu cuenta, habla con administración.</p>}
      </div>
      : <form className="stack" onSubmit={request} aria-label="Solicitar el cierre de la cuenta"><fieldset className="stack" disabled={busy}>
        <Field label="Motivo" optional hint={`Solo lo lee administración. Hasta ${maxClosureReason} caracteres.`}><textarea value={reason} onChange={event => setReason(event.target.value)} rows={3} maxLength={maxClosureReason}/></Field>
        <div className="form-actions"><button className="button danger">{busy ? "Enviando…" : "Solicitar el cierre"}</button></div>
      </fieldset></form>}
    {state && state.history.some(item => item.id !== open?.id) && <details className="closure-history"><summary>Solicitudes anteriores</summary>
      <ul className="plain-list">{state.history.filter(item => item.id !== open?.id).map(item => <li key={item.id}><StatusBadge tone={closureTone[item.status]}>{closureLabels[item.status]}</StatusBadge> <span className="small">Pedida el {fullDate(item.requestedAt)}{item.cancelledAt ? `, cancelada el ${fullDate(item.cancelledAt)}` : ""}</span></li>)}</ul>
    </details>}
  </Anchored>;
}

/**
 * Administration (Educadores): the requests to close an account. Starting one moves it to «En curso» and opens the
 * departure (ST-123); recording the departure completes it.
 */
export function ClosureRequests({ revision, onDeparture }: { revision: number; onDeparture: (person: { id: string; name: string }) => void }) {
  const { toast, confirm } = useFeedback();
  const { member } = useSession();
  const [items, setItems] = useState<ClosureRequest[] | null>(null), [error, setError] = useState(""), [busy, setBusy] = useState("");
  const load = () => { setError(""); api<{ closures: ClosureRequest[] }>("/closures").then(result => setItems(result.closures)).catch(cause => setError(message(cause))); };
  useEffect(load, [revision]);
  async function start(item: ClosureRequest) {
    if (!await confirm({ title: `¿Iniciar el cierre de la cuenta de ${item.personName}?`, body: "La persona ya no podrá cancelar su solicitud. A continuación registra su salida: ahí eliges quién recibe sus cursos y secciones.", confirm: "Iniciar el cierre" })) return;
    setBusy(item.id);
    try { await api(`/closures/${item.id}/start`, "POST"); load(); onDeparture({ id: item.userId, name: item.personName }); }
    catch (cause) { toast({ tone: "error", message: message(cause) }); load(); }
    finally { setBusy(""); }
  }
  const open = items?.filter(item => item.status === "requested" || item.status === "in_progress") || [];
  return <div id="cierres" className="account-anchor"><Section title="Solicitudes de cierre de cuenta" action={open.length > 0 && <StatusBadge tone="warning">{open.length === 1 ? "1 pendiente" : `${open.length} pendientes`}</StatusBadge>}>
    {error ? <ErrorState error={error} retry={load}/> : !items ? <Loading label="Cargando solicitudes…" lines={2}/> : !items.length
      ? <p className="muted">Nadie ha pedido cerrar su cuenta.</p>
      : <div className="table-card" role="region" aria-label="Lista de solicitudes de cierre" tabIndex={0}><table className="members-table">
        <caption className="sr-only">Solicitudes de cierre de cuenta, su estado y su motivo</caption>
        <thead><tr><th scope="col">Persona</th><th scope="col">Pedida</th><th scope="col">Motivo</th><th scope="col">Estado</th><th scope="col"><span className="sr-only">Acciones</span></th></tr></thead>
        <tbody>{items.map(item => <tr key={item.id}>
          <th scope="row"><span>{item.personName}</span><br/><span className="muted small">@{item.username}</span></th>
          <td><time dateTime={item.requestedAt}>{shortDate(item.requestedAt)}</time></td>
          <td className="pre-line">{item.reason || <span className="muted">Sin motivo</span>}</td>
          <td><StatusBadge tone={closureTone[item.status]}>{closureLabels[item.status]}</StatusBadge>
            {item.status === "in_progress" && item.startedBy && <><br/><span className="muted small">Iniciado por {item.startedBy}</span></>}
            {item.status === "completed" && item.departedOn && <><br/><span className="muted small">Salida registrada</span></>}
            {item.status === "cancelled" && <><br/><span className="muted small">Cancelada por la persona</span></>}</td>
          <td className="cell-actions">{item.userId === member.id ? <span className="muted small">La atiende otra persona</span>
            : item.status === "requested" ? <button type="button" className="button secondary small" disabled={busy === item.id} onClick={() => void start(item)}>Iniciar el cierre</button>
            : item.status === "in_progress" ? <button type="button" className="button secondary small" onClick={() => onDeparture({ id: item.userId, name: item.personName })}><Icon name="logout" size={16}/>Registrar salida</button> : null}</td>
        </tr>)}</tbody>
      </table></div>}
  </Section></div>;
}

/** Public page /cuenta/correo/<token>: confirms the new sign-in e-mail, signed in or not. */
export function ConfirmEmail({ token }: { token: string }) {
  const [preview, setPreview] = useState<EmailChangePreview | null>(null), [problem, setProblem] = useState<{ title: string; text: string } | null>(null);
  const [done, setDone] = useState<string | null>(null), [busy, setBusy] = useState(false);
  const fail = (cause: unknown) => {
    const code = cause instanceof ApiError ? String(cause.detail.code || "") : "";
    const title = code === "EMAIL_CHANGE_EXPIRED" ? "Este enlace caducó" : code === "EMAIL_CHANGE_USED" ? "Este correo ya está confirmado" : code === "EMAIL_CHANGE_CANCELLED" ? "Este cambio se canceló" : code === "EMAIL_CHANGE_NOT_FOUND" ? "Enlace no válido" : "No pudimos confirmar el correo";
    setProblem({ title, text: message(cause) });
  };
  useEffect(() => { api<{ change: EmailChangePreview }>(`/account/email/${encodeURIComponent(token)}`).then(result => setPreview(result.change), fail); }, [token]);
  async function confirmIt() {
    setBusy(true);
    try { const result = await api<{ email: string }>(`/account/email/${encodeURIComponent(token)}`, "POST"); setDone(result.email); }
    catch (cause) { fail(cause); }
    finally { setBusy(false); }
  }
  return <div className="login-page">
    <a className="skip-link" href="#main">Saltar al contenido</a>
    <main id="main" className="login-main">
      <div className="login-brand"><span className="brand-mark" aria-hidden="true">hl</span><span>Happy Learners</span></div>
      <section className="login-card" aria-labelledby="email-title">
        {problem ? <>
          <h1 id="email-title">{problem.title}</h1>
          <p className="form-alert" role="alert"><Icon name="alert" size={18}/>{problem.text}</p>
          <a className="button secondary full" href="/mi-cuenta/cuenta">Ir a mi cuenta</a>
        </> : done ? <>
          <h1 id="email-title">Correo confirmado</h1>
          <p role="status"><Icon name="check" size={18}/> Desde ahora tu correo de acceso es <strong>{done}</strong>. Avisamos del cambio a tu dirección anterior.</p>
          <a className="button primary full" href="/mi-cuenta/cuenta">Ir a mi cuenta</a>
        </> : !preview ? <><h1 id="email-title">Confirmar correo</h1><p role="status">Abriendo el enlace…</p></> : <>
          <h1 id="email-title">Confirma tu nuevo correo</h1>
          <p>La cuenta <strong>@{preview.username}</strong> de {preview.organization} usará <strong>{preview.newEmail}</strong> como correo de acceso (el enlace caduca el {fullDate(preview.expiresAt)}).</p>
          <button type="button" className="button primary full" disabled={busy} onClick={() => void confirmIt()}>{busy ? "Confirmando…" : "Confirmar correo"}</button>
          <a className="button ghost full" href="/inicio">Ahora no</a>
        </>}
      </section>
    </main>
  </div>;
}
