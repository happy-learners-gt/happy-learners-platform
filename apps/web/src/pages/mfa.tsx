import { useState } from "react";
import type { FormEvent } from "react";
import type { Member } from "@happy-learners/contracts";
import { api, message } from "../api";
import { CodeInput } from "../ui/identity-kit";
import { Icon } from "../ui/icons";
import { AuthenticatorWizard, RecoveryCodes } from "./my-security";
import { passkeysAvailable, usePasskey } from "./passkeys";

/**
 * ST-133 in the browser: the step after the password (or a link), and the screen shown while the organization
 * requires a second factor the person does not have yet. Setting it up lives in Mi cuenta › Seguridad.
 */
const Alert = ({ text }: { text: string }) => <p className="form-alert" role="alert"><Icon name="alert" size={18}/>{text}</p>;
export type SignInAnswer = { ok?: true; mfa?: "required"; challenge?: string };

/** The code from the authenticator app (six boxes that send themselves), or a recovery code instead. */
export function MfaStep({ challenge, onDone, onCancel }: { challenge: string; onDone: () => Promise<void>; onCancel: () => void }) {
  const [recovery, setRecovery] = useState(false), [code, setCode] = useState(""), [busy, setBusy] = useState(false), [error, setError] = useState("");
  async function send(body: Record<string, string>) {
    setBusy(true); setError("");
    try { await api("/login/mfa", "POST", { challenge, ...body }); await onDone(); }
    catch (cause) { setError(message(cause)); setBusy(false); }
  }
  return <div className="stack" role="group" aria-label="Verificación en dos pasos">
    <h2 className="mfa-title">Verificación en dos pasos</h2>
    {recovery ? <form className="stack" onSubmit={(event: FormEvent) => { event.preventDefault(); void send({ recoveryCode: code }); }}>
      <p className="muted small">Escribe uno de tus códigos de recuperación. Cada código funciona una sola vez.</p>
      {error && <Alert text={error}/>}
      <div className="field"><label htmlFor="mfa-code">Código de recuperación</label><input id="mfa-code" data-autofocus autoComplete="off" maxLength={11} value={code} onChange={event => setCode(event.target.value.trim())} required/></div>
      <button className="button primary full" disabled={busy}>{busy ? "Verificando…" : "Verificar"}</button>
    </form> : <CodeInput label="Código de tu aplicación de autenticación" disabled={busy} error={error} onComplete={value => void send({ code: value })}/>}
    <button type="button" className="link-button" onClick={() => { setRecovery(!recovery); setCode(""); setError(""); }}>{recovery ? "Usar el código de la aplicación" : "Usar un código de recuperación"}</button>
    <button type="button" className="button ghost full" onClick={onCancel}>Cancelar</button>
  </div>;
}

/** While the policy requires a second method and the person has none: a passkey in one tap, or the app. */
export function MfaRequired({ member, onDone, onLeave }: { member: Member; onDone: () => Promise<void>; onLeave: () => void }) {
  const passkey = usePasskey();
  const [wizard, setWizard] = useState(false), [codes, setCodes] = useState<string[] | null>(null), [busy, setBusy] = useState(false), [error, setError] = useState("");
  async function createPasskey() {
    setBusy(true); setError("");
    try { await passkey.create(); await onDone(); } catch (cause) { setError(message(cause)); setBusy(false); }
  }
  return <div className="login-page">
    <a className="skip-link" href="#main">Saltar al contenido</a>
    <main id="main" className="login-main">
      <div className="login-brand"><span className="brand-mark" aria-hidden="true">hl</span><span>Happy Learners</span></div>
      <section className="login-card" aria-labelledby="mfa-required-title">
        <h1 id="mfa-required-title">Protege tu cuenta</h1>
        <p>Hola, {member.displayName || member.username}. Tu organización pide un segundo método además de la contraseña. Elige uno; toma menos de un minuto.</p>
        {error && <Alert text={error}/>}
        {passkeysAvailable() && <button type="button" className="method-choice is-recommended" disabled={busy} onClick={() => void createPasskey()}>
          <Icon name="shield" size={24}/><span><strong>{busy ? "Esperando al dispositivo…" : "Crear una passkey"}</strong><span>Recomendado: entras con tu huella, rostro o PIN, sin contraseña ni códigos.</span></span></button>}
        <button type="button" className="method-choice" onClick={() => setWizard(true)}>
          <Icon name="clock" size={24}/><span><strong>Usar una aplicación de autenticación</strong><span>Escaneas un código y escribes los 6 dígitos que muestra.</span></span></button>
        <button type="button" className="button ghost full" onClick={onLeave}>Salir</button>
      </section>
    </main>
    {wizard && <AuthenticatorWizard onClose={() => setWizard(false)} onDone={recovery => { setWizard(false); setCodes(recovery); }}/>}
    {codes && <RecoveryCodes codes={codes} onDone={() => void onDone()}/>}
  </div>;
}
