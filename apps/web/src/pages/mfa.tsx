import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import type { Member } from "@happy-learners/contracts";
import { api, message } from "../api";
import { formatInstant } from "../regional";
import { useFeedback } from "../ui/feedback";
import { Icon } from "../ui/icons";

/**
 * ST-133: the second factor in the browser. The step after the password (or a link), setting it up with an
 * authenticator app and showing the recovery codes once, and the section of Mi cuenta that renews or turns it off.
 */
const Alert = ({ text }: { text: string }) => <p className="form-alert" role="alert"><Icon name="alert" size={18}/>{text}</p>;
export type SignInAnswer = { ok?: true; mfa?: "required"; challenge?: string };

/** The code from the authenticator app, or a recovery code instead. */
export function MfaStep({ challenge, onDone, onCancel }: { challenge: string; onDone: () => Promise<void>; onCancel: () => void }) {
  const [recovery, setRecovery] = useState(false), [code, setCode] = useState(""), [busy, setBusy] = useState(false), [error, setError] = useState("");
  async function submit(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError("");
    try { await api("/login/mfa", "POST", recovery ? { challenge, recoveryCode: code } : { challenge, code }); await onDone(); }
    catch (cause) { setError(message(cause)); setBusy(false); }
  }
  return <form onSubmit={submit} className="stack" aria-label="Verificación en dos pasos">
    <h2 className="mfa-title">Verificación en dos pasos</h2>
    <p className="muted small">{recovery ? "Escribe uno de tus códigos de recuperación. Cada código funciona una sola vez." : "Escribe el código de 6 dígitos que muestra tu aplicación de autenticación."}</p>
    {error && <Alert text={error}/>}
    <div className="field"><label htmlFor="mfa-code">{recovery ? "Código de recuperación" : "Código de verificación"}</label>
      <input id="mfa-code" data-autofocus autoComplete="one-time-code" inputMode={recovery ? "text" : "numeric"} maxLength={recovery ? 11 : 6} pattern={recovery ? undefined : "\\d{6}"} value={code} onChange={event => setCode(event.target.value.trim())} required/></div>
    <button className="button primary full" disabled={busy}>{busy ? "Verificando…" : "Verificar"}</button>
    <button type="button" className="link-button" onClick={() => { setRecovery(!recovery); setCode(""); setError(""); }}>{recovery ? "Usar el código de la aplicación" : "Usar un código de recuperación"}</button>
    <button type="button" className="button ghost full" onClick={onCancel}>Cancelar</button>
  </form>;
}

/** The recovery codes, shown once, to copy or print. */
function RecoveryCodes({ codes, onDone }: { codes: string[]; onDone: () => void }) {
  const [saved, setSaved] = useState(false);
  return <div className="stack" role="region" aria-label="Códigos de recuperación">
    <p><strong>Guarda estos códigos de recuperación.</strong> Te dejan entrar si pierdes tu teléfono; cada uno funciona una vez y no se vuelven a mostrar.</p>
    <ol className="recovery-codes">{codes.map(code => <li key={code}><code>{code}</code></li>)}</ol>
    <div className="button-row"><button type="button" className="button secondary small" onClick={() => void navigator.clipboard?.writeText(codes.join("\n"))}><Icon name="copy" size={16}/>Copiar</button>
      <button type="button" className="button secondary small" onClick={() => print()}><Icon name="download" size={16}/>Imprimir</button></div>
    <label className="switch"><input type="checkbox" checked={saved} onChange={event => setSaved(event.target.checked)}/><span>Ya guardé mis códigos en un lugar seguro</span></label>
    <button type="button" className="button primary" disabled={!saved} onClick={onDone}>Terminar</button>
  </div>;
}

/** Setting up: the password, then the key for the app, then the first code; ends with the recovery codes. */
export function MfaSetup({ onDone, onCancel }: { onDone: () => void; onCancel?: () => void }) {
  const [password, setPassword] = useState(""), [setup, setSetup] = useState<{ key: string; uri: string } | null>(null), [code, setCode] = useState("");
  const [codes, setCodes] = useState<string[] | null>(null), [busy, setBusy] = useState(false), [error, setError] = useState("");
  async function start(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError("");
    try { setSetup((await api<{ setup: { key: string; uri: string } }>("/me/mfa/setup", "POST", { currentPassword: password })).setup); setPassword(""); }
    catch (cause) { setError(message(cause)); }
    finally { setBusy(false); }
  }
  async function enable(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError("");
    try { setCodes((await api<{ recoveryCodes: string[] }>("/me/mfa/enable", "POST", { code })).recoveryCodes); }
    catch (cause) { setError(message(cause)); }
    finally { setBusy(false); }
  }
  if (codes) return <RecoveryCodes codes={codes} onDone={onDone}/>;
  if (!setup) return <form onSubmit={start} className="stack" aria-label="Activar la verificación en dos pasos">
    <p>Necesitas una aplicación de autenticación en tu teléfono, como Microsoft Authenticator, Google Authenticator o la de tu gestor de contraseñas.</p>
    {error && <Alert text={error}/>}
    <div className="field"><label htmlFor="mfa-password">Tu contraseña actual</label><input id="mfa-password" type="password" autoComplete="current-password" maxLength={128} value={password} onChange={event => setPassword(event.target.value)} required/></div>
    <div className="button-row">{onCancel && <button type="button" className="button secondary" onClick={onCancel}>Cancelar</button>}<button className="button primary" disabled={busy}>{busy ? "Generando…" : "Continuar"}</button></div>
  </form>;
  return <form onSubmit={enable} className="stack" aria-label="Confirmar la verificación en dos pasos">
    <ol className="stack mfa-steps">
      <li>En tu aplicación, agrega una cuenta nueva. Desde el teléfono, puedes <a href={setup.uri}>abrir este enlace</a>; si no, escribe esta clave:
        <p className="mfa-key"><code aria-label="Clave para tu aplicación">{setup.key}</code> <button type="button" className="button ghost small" onClick={() => void navigator.clipboard?.writeText(setup.key.replaceAll(" ", ""))}><Icon name="copy" size={16}/>Copiar</button></p>
        <span className="muted small">Tipo: basada en el tiempo, 6 dígitos.</span></li>
      <li>Escribe el código de 6 dígitos que muestra la aplicación.</li>
    </ol>
    {error && <Alert text={error}/>}
    <div className="field"><label htmlFor="mfa-first-code">Código de verificación</label><input id="mfa-first-code" autoComplete="one-time-code" inputMode="numeric" maxLength={6} pattern="\d{6}" value={code} onChange={event => setCode(event.target.value.trim())} required/></div>
    <div className="button-row">{onCancel && <button type="button" className="button secondary" onClick={onCancel}>Cancelar</button>}<button className="button primary" disabled={busy}>{busy ? "Activando…" : "Activar"}</button></div>
  </form>;
}

/** When the policy requires it and the person has none: nothing else opens until it is set up. */
export function MfaRequired({ member, onDone, onLeave }: { member: Member; onDone: () => Promise<void>; onLeave: () => void }) {
  return <div className="login-page">
    <a className="skip-link" href="#main">Saltar al contenido</a>
    <main id="main" className="login-main">
      <div className="login-brand"><span className="brand-mark" aria-hidden="true">hl</span><span>Happy Learners</span></div>
      <section className="login-card is-wide" aria-labelledby="mfa-required-title">
        <h1 id="mfa-required-title">Activa la verificación en dos pasos</h1>
        <p>Hola, {member.displayName || member.username}. Tu organización la exige para tu rol: además de tu contraseña, pediremos un código de tu teléfono al entrar.</p>
        <MfaSetup onDone={() => void onDone()}/>
        <button type="button" className="button ghost full" onClick={onLeave}>Salir</button>
      </section>
    </main>
  </div>;
}

type Status = { enabled: boolean; enabledAt: string | null; recoveryCodesLeft: number; required: boolean };
/** Mi cuenta › Cuenta y seguridad: the state of the factor and what can be done with it. */
export function MfaSettings() {
  const { toast } = useFeedback();
  const [status, setStatus] = useState<Status | null>(null), [mode, setMode] = useState<"setup" | "renew" | "off" | null>(null), [error, setError] = useState("");
  const [password, setPassword] = useState(""), [code, setCode] = useState(""), [codes, setCodes] = useState<string[] | null>(null), [busy, setBusy] = useState(false);
  const load = () => api<{ mfa: Status }>("/me/mfa").then(result => setStatus(result.mfa), cause => setError(message(cause)));
  useEffect(() => { void load(); }, []);
  async function confirm(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError("");
    try {
      if (mode === "renew") setCodes((await api<{ recoveryCodes: string[] }>("/me/mfa/recovery-codes", "POST", { currentPassword: password, code })).recoveryCodes);
      else { await api("/me/mfa", "DELETE", { currentPassword: password, code }); toast({ message: "Verificación en dos pasos desactivada." }); setMode(null); await load(); }
      setPassword(""); setCode("");
    } catch (cause) { setError(message(cause)); }
    finally { setBusy(false); }
  }
  if (!status) return error ? <Alert text={error}/> : <p className="muted" role="status">Cargando…</p>;
  if (codes) return <RecoveryCodes codes={codes} onDone={() => { setCodes(null); setMode(null); void load(); toast({ message: "Códigos de recuperación renovados." }); }}/>;
  if (mode === "setup") return <MfaSetup onCancel={() => setMode(null)} onDone={() => { setMode(null); void load(); toast({ message: "Verificación en dos pasos activada. Tus otras sesiones se cerraron." }); }}/>;
  return <div className="stack">
    <p>{status.enabled ? <><strong>Activa</strong> desde el {formatInstant(status.enabledAt)}. Te quedan {status.recoveryCodesLeft} códigos de recuperación.</> : "Desactivada. Actívala para que una contraseña robada no baste para entrar."}
      {status.required && <span className="muted small"> Tu organización la exige para tu rol.</span>}</p>
    {mode ? <form onSubmit={confirm} className="stack" aria-label={mode === "renew" ? "Renovar los códigos de recuperación" : "Desactivar la verificación en dos pasos"}>
      {error && <Alert text={error}/>}
      <div className="field"><label htmlFor="mfa-confirm-password">Tu contraseña actual</label><input id="mfa-confirm-password" type="password" autoComplete="current-password" maxLength={128} value={password} onChange={event => setPassword(event.target.value)} required/></div>
      <div className="field"><label htmlFor="mfa-confirm-code">Código de tu aplicación</label><input id="mfa-confirm-code" autoComplete="one-time-code" inputMode="numeric" maxLength={6} pattern="\d{6}" value={code} onChange={event => setCode(event.target.value.trim())} required/></div>
      <div className="button-row"><button type="button" className="button secondary" onClick={() => { setMode(null); setError(""); }}>Cancelar</button>
        <button className={mode === "off" ? "button danger" : "button primary"} disabled={busy}>{busy ? "Guardando…" : mode === "renew" ? "Renovar códigos" : "Desactivar"}</button></div>
    </form> : <div className="button-row">
      {status.enabled ? <><button type="button" className="button secondary small" onClick={() => setMode("renew")}>Renovar códigos de recuperación</button>
        {!status.required && <button type="button" className="button ghost small" onClick={() => setMode("off")}>Desactivar</button>}</>
        : <button type="button" className="button primary small" onClick={() => setMode("setup")}><Icon name="shield" size={16}/>Activar la verificación en dos pasos</button>}
    </div>}
  </div>;
}
