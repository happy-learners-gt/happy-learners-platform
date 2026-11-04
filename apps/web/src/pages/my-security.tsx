import { useEffect, useState } from "react";
import type { ProviderKey } from "@happy-learners/domain";
import { providerNames } from "@happy-learners/domain";
import { api, message } from "../api";
import { useNavigation } from "../navigation";
import { useSession } from "../session";
import { formatInstant } from "../regional";
import { Modal, useFeedback } from "../ui/feedback";
import { Icon } from "../ui/icons";
import type { IconName } from "../ui/icons";
import { CodeInput, download, QrCode } from "../ui/identity-kit";
import { Menu } from "../ui/Menu";
import { ErrorState, Loading, PageHeader, Section, StatusBadge } from "../ui/primitives";
import { PasswordDialog, SessionsSection, SignInHistory } from "./account";
import { passkeysAvailable, platformPasskeys, usePasskey } from "./passkeys";
import { providerOutcome } from "./providers";
import { MyTokens } from "./tokens";

/**
 * Mi cuenta › Seguridad (docs/design/identidad-y-acceso.md §1): how the account is protected, every sign-in method in
 * one list with its action, «Agregar un método» with the passkey first, devices and recent activity. Sensitive changes
 * do not ask for the password inside the confirmation window; outside it, one confirmation and the change goes on.
 */
type Passkey = { id: string; name: string; createdAt: string; lastUsedAt: string | null; synced: boolean };
type Linked = { provider: ProviderKey; email: string | null; linkedAt: string; lastUsedAt: string | null };
type State = { mfa: { enabled: boolean; enabledAt: string | null; recoveryCodesLeft: number; required: boolean }; passkeys: Passkey[]; linked: Linked[]; available: ProviderKey[] };

export function MySecurityPage() {
  const { toast, confirm } = useFeedback();
  const { url, navigate } = useNavigation();
  const passkey = usePasskey();
  const [state, setState] = useState<State | null>(null), [error, setError] = useState(""), [revision, setRevision] = useState(0);
  const [renaming, setRenaming] = useState<Passkey | null>(null);
  const [adding, setAdding] = useState(false), [wizard, setWizard] = useState(false), [codes, setCodes] = useState<string[] | null>(null), [busy, setBusy] = useState("");
  const load = async () => {
    setError("");
    try {
      const [mfa, keys, identities] = await Promise.all([api<{ mfa: State["mfa"] }>("/me/mfa"), api<{ passkeys: Passkey[] }>("/me/passkeys"), api<{ linked: Linked[]; available: ProviderKey[] }>("/me/identities")]);
      setState({ mfa: mfa.mfa, passkeys: keys.passkeys, linked: identities.linked, available: identities.available });
    } catch (cause) { setError(message(cause)); }
  };
  useEffect(() => { void load(); }, [revision]);
  // Back from linking an account with a provider.
  useEffect(() => {
    const result = url.searchParams.get("vinculo");
    if (!result) return;
    toast(result === "vinculada" ? { message: "Cuenta vinculada. Ya puedes entrar con ella." } : { tone: "error", message: providerOutcome(result) });
    navigate("/mi-cuenta/seguridad", true);
  }, [url.search]);
  const refresh = () => setRevision(value => value + 1);
  async function run(key: string, work: () => Promise<unknown>, done: string) {
    setBusy(key);
    try { await work(); refresh(); toast({ message: done }); } catch (cause) { toast({ tone: "error", message: message(cause) }); }
    finally { setBusy(""); }
  }
  const createPasskey = () => run("passkey", async () => { const created = await passkey.create(); setAdding(false); return created; }, "Passkey creada en este dispositivo. La próxima vez entra con tu huella, rostro o PIN.");
  if (error && !state) return <><PageHeader title="Seguridad"/><ErrorState error={error} retry={() => void load()}/></>;
  if (!state) return <><PageHeader title="Seguridad"/><Loading label="Cargando la seguridad de tu cuenta…"/></>;
  const strong = state.passkeys.length > 0 || state.mfa.enabled;
  const linkable = state.available.filter(key => !state.linked.some(item => item.provider === key));
  return <>
    <PageHeader title="Seguridad" description="Cómo entras a tu cuenta, desde dónde y qué pasó recientemente."/>
    <div className={`security-status ${strong ? "is-protected" : "is-weak"}`} role="status">
      <Icon name={strong ? "shield" : "alert"} size={28}/>
      <div><strong>{state.passkeys.length ? "Tu cuenta está protegida con una passkey" : state.mfa.enabled ? "Tu cuenta pide un segundo paso al entrar" : "Tu cuenta solo tiene contraseña"}</strong>
        <p>{strong ? "Una contraseña robada no basta para entrar." : state.mfa.required ? "Tu organización exige un segundo método. Agrega una passkey: es lo más rápido." : "Agrega una passkey: entras con tu huella, rostro o PIN, y nadie puede usarla desde otro sitio."}</p></div>
      {!state.passkeys.length && passkeysAvailable() && <button type="button" className="button primary" disabled={busy === "passkey"} onClick={() => void createPasskey()}>{busy === "passkey" ? "Esperando al dispositivo…" : "Crear passkey"}</button>}
    </div>

    <Section title="Métodos de inicio de sesión" action={<button type="button" className="button secondary small" onClick={() => setAdding(true)}><Icon name="plus" size={16}/>Agregar un método</button>}>
      <ul className="method-list">
        {state.passkeys.map(item => <MethodRow key={item.id} icon="shield" title={item.name} badge={<StatusBadge tone="success">Passkey</StatusBadge>}
          detail={`${item.synced ? "Sincronizada con tu cuenta del dispositivo · " : ""}Creada el ${formatInstant(item.createdAt)}${item.lastUsedAt ? ` · usada el ${formatInstant(item.lastUsedAt)}` : ""}`}
          actions={[{ label: "Cambiar el nombre", icon: "edit", onSelect: () => void rename(item) }, { label: "Eliminar", icon: "archive", danger: true, onSelect: () => void remove(item) }]}/>)}
        {state.mfa.enabled && <MethodRow icon="clock" title="Aplicación de autenticación" badge={<StatusBadge tone="success">Segundo paso</StatusBadge>} detail={`Activa desde el ${formatInstant(state.mfa.enabledAt)}`}
          actions={state.mfa.required ? [] : [{ label: "Quitar", icon: "archive", danger: true, onSelect: () => void disableApp() }]}/>}
        {state.mfa.enabled && <MethodRow icon="list" title="Códigos de recuperación" detail={`${state.mfa.recoveryCodesLeft} de 10 sin usar. Te dejan entrar si pierdes tu teléfono.`}
          badge={state.mfa.recoveryCodesLeft <= 3 ? <StatusBadge tone="warning">Quedan pocos</StatusBadge> : undefined} actions={[{ label: "Generar nuevos", icon: "undo", onSelect: () => void renewCodes() }]}/>}
        {state.linked.map(item => <MethodRow key={item.provider} icon="link" title={providerNames[item.provider]} badge={<StatusBadge tone="info">Cuenta vinculada</StatusBadge>}
          detail={`${item.email ? `${item.email} · ` : ""}desde el ${formatInstant(item.linkedAt)}`} actions={item.provider === "sso" ? [] : [{ label: "Desvincular", icon: "archive", danger: true, onSelect: () => void unlink(item.provider) }]}/>)}
        <PasswordRow/>
      </ul>
    </Section>
    <SessionsSection revision={revision} onChanged={refresh}/>
    <SignInHistory revision={revision}/>
    <Section title="Tokens de integración"><MyTokens/></Section>

    {adding && <Modal title="Agregar un método" onClose={() => setAdding(false)}>
      <ul className="method-choices">
        {passkeysAvailable() && <li><button type="button" className="method-choice is-recommended" disabled={busy === "passkey"} onClick={() => void createPasskey()}>
          <Icon name="shield" size={24}/><span><strong>Passkey <StatusBadge tone="success">Recomendado</StatusBadge></strong><span>Entra con la huella, el rostro o el PIN de este dispositivo. Sin contraseña ni códigos.</span></span></button></li>}
        {!state.mfa.enabled && <li><button type="button" className="method-choice" onClick={() => { setAdding(false); setWizard(true); }}>
          <Icon name="clock" size={24}/><span><strong>Aplicación de autenticación</strong><span>Microsoft Authenticator, Google Authenticator u otra: un código de 6 dígitos al entrar.</span></span></button></li>}
        {linkable.map(key => <li key={key}><button type="button" className="method-choice" disabled={busy === key} onClick={() => void link(key)}>
          <Icon name="link" size={24}/><span><strong>Cuenta de {providerNames[key]}</strong><span>Entra con tu cuenta de {providerNames[key]} después de escribir tu usuario.</span></span></button></li>)}
      </ul>
    </Modal>}
    {wizard && <AuthenticatorWizard onClose={() => setWizard(false)} onDone={recovery => { setWizard(false); setCodes(recovery); refresh(); }}/>}
    {renaming && <Modal title="Nombre de la passkey" onClose={() => setRenaming(null)}>
      <form className="stack" onSubmit={event => { event.preventDefault(); const name = String(new FormData(event.currentTarget).get("name") || "").trim(); setRenaming(null); if (name && name !== renaming.name) void run(renaming.id, () => api(`/me/passkeys/${renaming.id}`, "PUT", { name }), "Nombre guardado."); }}>
        <div className="field"><label htmlFor="passkey-name">Nombre</label><input id="passkey-name" name="name" data-autofocus maxLength={60} defaultValue={renaming.name} required/></div>
        <div className="button-row modal-actions"><button type="button" className="button ghost" onClick={() => setRenaming(null)}>Cancelar</button><button className="button primary">Guardar</button></div>
      </form>
    </Modal>}
    {codes && <RecoveryCodes codes={codes} onDone={() => { setCodes(null); toast({ message: "Listo: tu cuenta pide el código de la aplicación al entrar." }); }}/>}
  </>;

  async function rename(item: Passkey) { setRenaming(item); }
  async function remove(item: Passkey) {
    if (!await confirm({ title: `¿Eliminar la passkey «${item.name}»?`, body: "Ya no podrás entrar con ella. Si está guardada en tu dispositivo o en tu gestor de contraseñas, bórrala también allí.", confirm: "Eliminar", danger: true })) return;
    await run(item.id, () => api(`/me/passkeys/${item.id}`, "DELETE"), "Passkey eliminada.");
  }
  async function disableApp() {
    if (!await confirm({ title: "¿Quitar la aplicación de autenticación?", body: "Al entrar con tu contraseña ya no se pedirá un código. Tus códigos de recuperación dejan de funcionar.", confirm: "Quitar", danger: true })) return;
    await run("mfa", () => api("/me/mfa", "DELETE", {}), "Aplicación de autenticación quitada.");
  }
  async function renewCodes() {
    if (!await confirm({ title: "¿Generar códigos nuevos?", body: "Los anteriores dejan de funcionar.", confirm: "Generar" })) return;
    setBusy("codes");
    try { setCodes((await api<{ recoveryCodes: string[] }>("/me/mfa/recovery-codes", "POST", {})).recoveryCodes); refresh(); } catch (cause) { toast({ tone: "error", message: message(cause) }); }
    finally { setBusy(""); }
  }
  async function unlink(key: ProviderKey) {
    if (!await confirm({ title: `¿Desvincular tu cuenta de ${providerNames[key]}?`, body: "Ya no podrás entrar con ella.", confirm: "Desvincular", danger: true })) return;
    await run(key, () => api(`/me/identities/${key}`, "DELETE"), "Cuenta desvinculada.");
  }
  async function link(key: ProviderKey) {
    setBusy(key);
    try { window.location.assign((await api<{ url: string }>(`/me/identities/${key}`, "POST")).url); } catch (cause) { toast({ tone: "error", message: message(cause) }); setBusy(""); }
  }
}

type Action = { label: string; icon: IconName; danger?: boolean; onSelect: () => void };
function MethodRow({ icon, title, detail, badge, actions }: { icon: IconName; title: string; detail: string; badge?: React.ReactNode; actions: Action[] }) {
  return <li className="method-row">
    <span className="method-icon" aria-hidden="true"><Icon name={icon} size={20}/></span>
    <span className="method-text"><span className="method-title"><strong>{title}</strong>{badge}</span><span className="muted small">{detail}</span></span>
    {actions.length > 0 && <Menu label={`Acciones de ${title}`} items={actions}/>}
  </li>;
}
function PasswordRow() {
  const { member } = useSession();
  const [open, setOpen] = useState(false);
  return <>
    <MethodRow icon="text" title="Contraseña" detail="Al cambiarla se cierran tus sesiones en otros dispositivos." actions={[{ label: "Cambiar contraseña", icon: "edit", onSelect: () => setOpen(true) }]}/>
    {open && <PasswordDialog username={member.username} onClose={() => setOpen(false)} onChanged={() => setOpen(false)}/>}
  </>;
}

/** The authenticator app: scan, type the code; it sends itself. Then the recovery codes. */
export function AuthenticatorWizard({ onClose, onDone }: { onClose: () => void; onDone: (codes: string[]) => void }) {
  const [setup, setSetup] = useState<{ key: string; uri: string } | null>(null), [manual, setManual] = useState(false), [error, setError] = useState(""), [busy, setBusy] = useState(false);
  useEffect(() => { api<{ setup: { key: string; uri: string } }>("/me/mfa/setup", "POST", {}).then(result => setSetup(result.setup), cause => setError(message(cause))); }, []);
  async function enable(code: string) {
    setBusy(true); setError("");
    try { onDone((await api<{ recoveryCodes: string[] }>("/me/mfa/enable", "POST", { code })).recoveryCodes); }
    catch (cause) { setError(message(cause)); setBusy(false); }
  }
  return <Modal title="Aplicación de autenticación" onClose={onClose}>
    {!setup ? (error ? <p className="form-alert" role="alert"><Icon name="alert" size={18}/>{error}</p> : <p role="status" className="muted">Preparando…</p>) : <div className="stack authenticator">
      <ol className="authenticator-steps">
        <li>Abre tu aplicación de autenticación y elige <strong>agregar una cuenta</strong>.</li>
        <li>{manual ? "Escribe esta clave (basada en el tiempo, 6 dígitos):" : "Escanea este código:"}</li>
      </ol>
      {manual ? <p className="mfa-key"><code aria-label="Clave para tu aplicación">{setup.key}</code> <button type="button" className="button ghost small" onClick={() => void navigator.clipboard?.writeText(setup.key.replaceAll(" ", ""))}><Icon name="copy" size={16}/>Copiar</button></p>
        : <div className="qr-frame"><QrCode value={setup.uri} label="Código QR para tu aplicación de autenticación"/></div>}
      <div className="login-alternatives">
        <button type="button" className="link-button" onClick={() => setManual(!manual)}>{manual ? "Ver el código QR" : "¿No puedes escanear? Escribe la clave"}</button>
        <a className="link-button" href={setup.uri}>Abrir en esta aplicación</a>
      </div>
      <CodeInput label="Escribe el código que muestra la aplicación" disabled={busy} error={error} onComplete={code => void enable(code)}/>
    </div>}
  </Modal>;
}

/** The recovery codes, shown once: download, copy or print, then confirm they are kept. */
export function RecoveryCodes({ codes, onDone }: { codes: string[]; onDone: () => void }) {
  const [saved, setSaved] = useState(false);
  const text = `Códigos de recuperación de Happy Learners\nCada código funciona una sola vez.\n\n${codes.join("\n")}\n`;
  return <Modal title="Guarda tus códigos de recuperación" onClose={() => saved && onDone()}>
    <div className="stack">
      <p>Te dejan entrar si pierdes tu teléfono. Cada uno funciona una vez y no se vuelven a mostrar.</p>
      <ol className="recovery-codes">{codes.map(code => <li key={code}><code>{code}</code></li>)}</ol>
      <div className="button-row">
        <button type="button" className="button secondary small" onClick={() => { download("codigos-de-recuperacion-happy-learners.txt", text); setSaved(true); }}><Icon name="download" size={16}/>Descargar</button>
        <button type="button" className="button secondary small" onClick={() => { void navigator.clipboard?.writeText(codes.join("\n")); setSaved(true); }}><Icon name="copy" size={16}/>Copiar</button>
        <button type="button" className="button secondary small" onClick={() => { print(); setSaved(true); }}><Icon name="file" size={16}/>Imprimir</button>
      </div>
      <label className="switch"><input type="checkbox" checked={saved} onChange={event => setSaved(event.target.checked)}/><span>Ya guardé mis códigos en un lugar seguro</span></label>
      <div className="button-row modal-actions"><button type="button" className="button primary" disabled={!saved} onClick={onDone}>Terminar</button></div>
    </div>
  </Modal>;
}

/**
 * After signing in with a password on a device that can hold a passkey: one suggestion to create one. «Ahora no»
 * waits until the next sign-in; «No volver a preguntar» remembers it on this device.
 */
export function PasskeyNudge({ userId, security }: { userId: string; security: { method: string; passkeys: number } | null }) {
  const { toast } = useFeedback();
  const passkey = usePasskey();
  const key = `hl:passkey-nudge:${userId}`;
  const [open, setOpen] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState("");
  useEffect(() => {
    if (!security || security.method !== "password" || security.passkeys > 0 || localStorage.getItem(key) || sessionStorage.getItem(key)) return;
    void platformPasskeys().then(setOpen);
  }, [security?.method, security?.passkeys]);
  if (!open) return null;
  const later = (forever: boolean) => { (forever ? localStorage : sessionStorage).setItem(key, "1"); setOpen(false); };
  async function create() {
    setBusy(true); setError("");
    try { await passkey.create(); later(true); toast({ message: "Passkey creada. La próxima vez entra con tu huella, rostro o PIN." }); }
    catch (cause) { setError(message(cause)); setBusy(false); }
  }
  return <Modal title="Entra más rápido la próxima vez" onClose={() => later(false)}>
    <div className="stack">
      <p>Crea una passkey en este dispositivo: entras con tu huella, tu rostro o tu PIN, sin escribir la contraseña. Es más segura, porque nadie puede usarla desde otro sitio.</p>
      {error && <p className="form-alert" role="alert"><Icon name="alert" size={18}/>{error}</p>}
      <div className="button-row modal-actions">
        <button type="button" className="button ghost" onClick={() => later(true)}>No volver a preguntar</button>
        <button type="button" className="button secondary" onClick={() => later(false)}>Ahora no</button>
        <button type="button" className="button primary" disabled={busy} onClick={() => void create()}>{busy ? "Esperando al dispositivo…" : "Crear passkey"}</button>
      </div>
    </div>
  </Modal>;
}
