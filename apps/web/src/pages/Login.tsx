import { useState } from "react";
import type { FormEvent } from "react";
import { api, message } from "../api";
import { useNavigation } from "../navigation";
import { Modal } from "../ui/feedback";
import { Icon } from "../ui/icons";
import type { Member } from "@happy-learners/contracts";
import { acceptablePassword, groupCodePattern, maxPasswordLength, minPasswordLength } from "@happy-learners/domain";

function useLogin(onSuccess: () => Promise<void>, initial = "educador-demo") {
  const [username, setUsername] = useState(initial), [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  async function submit(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError("");
    try { await api("/login", "POST", { username, password }); setPassword(""); await onSuccess(); }
    catch (cause) { setError(message(cause)); }
    finally { setBusy(false); }
  }
  return { username, setUsername, password, setPassword, busy, error, submit };
}

export function Login({ onSignedIn }: { onSignedIn: () => Promise<void> }) {
  const form = useLogin(onSignedIn);
  const { navigate } = useNavigation();
  const [code, setCode] = useState(""), [codeError, setCodeError] = useState(""), [busy, setBusy] = useState(false);
  return <div className="login-page">
    <a className="skip-link" href="#main">Saltar al contenido</a>
    <main id="main" className="login-main">
      <div className="login-brand"><span className="brand-mark" aria-hidden="true">hl</span><span>Happy Learners</span></div>
      <section className="login-card" aria-labelledby="login-title">
        <h1 id="login-title">Iniciar sesión</h1>
        <p>Para educadores y administración.</p>
        {form.error && <p className="form-alert" role="alert"><Icon name="alert" size={18}/>{form.error}</p>}
        <form onSubmit={form.submit}>
          <div className="field"><label htmlFor="username">Usuario</label><input id="username" autoComplete="username" maxLength={64} value={form.username} onChange={event => form.setUsername(event.target.value)} required/></div>
          <div className="field"><label htmlFor="password">Contraseña</label><input id="password" type="password" autoComplete="current-password" maxLength={128} value={form.password} onChange={event => form.setPassword(event.target.value)} required/></div>
          <button className="button primary full" disabled={form.busy}>{form.busy ? "Entrando…" : "Entrar"}</button>
        </form>
        <details className="demo-help"><summary>Probar con cuentas de demostración</summary>
          <p><code>lucia.herrera</code> imparte Matemáticas 3.º; <code>educador-demo</code> prepara Exploradores. <code>marta.ruiz</code> coordina la organización.</p>
          <p>Como estudiante, entra con el código de sección <code>DG-MATE-3A</code>.</p>
          <p>Contraseña: <code>Aprender-2026!</code></p>
          <p>Las cuentas son compartidas: no escribas información personal real.</p>
        </details>
      </section>
      <form className="code-card" aria-labelledby="student-title" onSubmit={async event => {
        event.preventDefault();
        const value = code.trim().toUpperCase().replace(/\s+/g, "");
        if (!value) return;
        // Group codes open the group's space; any other code is a lesson's share code.
        if (!groupCodePattern.test(value)) { navigate(`/aprender/${encodeURIComponent(value)}`); return; }
        setBusy(true); setCodeError("");
        try { await api("/student/login", "POST", { code: value }); navigate("/estudiante"); }
        catch (cause) { setCodeError(message(cause)); setBusy(false); }
      }}>
        <div><h2 id="student-title">¿Eres estudiante?</h2><p>Escribe el código de tu sección o de una lección. No necesitas cuenta.</p></div>
        {codeError && <p className="form-alert" role="alert"><Icon name="alert" size={18}/>{codeError}</p>}
        <div className="code-row"><label htmlFor="lesson-code" className="sr-only">Código de sección o de lección</label><input id="lesson-code" required maxLength={40} value={code} onChange={event => setCode(event.target.value)} placeholder="Ej. DG-MATE-3A" autoCapitalize="characters"/><button className="button secondary" disabled={busy}>{busy ? "Abriendo…" : "Abrir"}</button></div>
      </form>
      <p className="login-privacy"><Icon name="shield" size={16}/>Sin expedientes ni datos personales de estudiantes.</p>
      <p className="login-privacy"><a href="/privacidad" onClick={event => { event.preventDefault(); navigate("/privacidad"); }}>Política de privacidad</a></p>
    </main>
  </div>;
}

/** Shown over the current page when the session ends, so unsaved work stays in place. */
export function SessionExpiredDialog({ username, onRestored, onLeave }: { username: string; onRestored: () => Promise<void>; onLeave: () => void }) {
  const form = useLogin(onRestored, username);
  return <Modal title="Tu sesión terminó" onClose={onLeave}>
    <p>Por seguridad, las sesiones duran hasta ocho horas. Vuelve a entrar para continuar; lo que tienes en pantalla se conserva.</p>
    {form.error && <p className="form-alert" role="alert"><Icon name="alert" size={18}/>{form.error}</p>}
    <form onSubmit={form.submit} className="stack">
      <div className="field"><label htmlFor="renew-username">Usuario</label><input id="renew-username" autoComplete="username" value={form.username} onChange={event => form.setUsername(event.target.value)} required/></div>
      <div className="field"><label htmlFor="renew-password">Contraseña</label><input id="renew-password" type="password" autoComplete="current-password" data-autofocus value={form.password} onChange={event => form.setPassword(event.target.value)} required/></div>
      <div className="modal-actions"><button type="button" className="button ghost" onClick={onLeave}>Salir</button><button className="button primary" disabled={form.busy}>{form.busy ? "Entrando…" : "Continuar"}</button></div>
    </form>
  </Modal>;
}

/** First sign-in with a temporary password (ST-093): the person chooses their own before using the app. */
export function ChangePassword({ member, onChanged, onLeave }: { member: Member; onChanged: () => Promise<void>; onLeave: () => void }) {
  const [current, setCurrent] = useState(""), [next, setNext] = useState(""), [repeat, setRepeat] = useState("");
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  async function submit(event: FormEvent) {
    event.preventDefault(); setError("");
    if (next !== repeat) { setError("Las contraseñas nuevas no coinciden."); return; }
    if (!acceptablePassword(next, member.username, current)) { setError(`Usa de ${minPasswordLength} a ${maxPasswordLength} caracteres variados, distintos de tu usuario y de la contraseña temporal.`); return; }
    setBusy(true);
    try { await api("/account/password", "POST", { currentPassword: current, newPassword: next }); setCurrent(""); setNext(""); setRepeat(""); await onChanged(); }
    catch (cause) { setError(message(cause)); setBusy(false); }
  }
  return <div className="login-page">
    <a className="skip-link" href="#main">Saltar al contenido</a>
    <main id="main" className="login-main">
      <div className="login-brand"><span className="brand-mark" aria-hidden="true">hl</span><span>Happy Learners</span></div>
      <section className="login-card" aria-labelledby="password-title">
        <h1 id="password-title">Cambia tu contraseña</h1>
        <p>Hola, {member.displayName || member.username}. Entraste con una contraseña temporal; elige una propia para continuar. Solo tú la conocerás.</p>
        {error && <p className="form-alert" role="alert"><Icon name="alert" size={18}/>{error}</p>}
        <form onSubmit={submit}>
          <div className="field"><label htmlFor="current-password">Contraseña temporal</label><input id="current-password" type="password" autoComplete="current-password" maxLength={maxPasswordLength} value={current} onChange={event => setCurrent(event.target.value)} required/></div>
          <div className="field"><label htmlFor="new-password">Nueva contraseña</label><input id="new-password" type="password" autoComplete="new-password" minLength={minPasswordLength} maxLength={maxPasswordLength} aria-describedby="new-password-hint" value={next} onChange={event => setNext(event.target.value)} required/>
            <small id="new-password-hint" className="hint">Al menos {minPasswordLength} caracteres. Una frase que recuerdes funciona bien.</small></div>
          <div className="field"><label htmlFor="repeat-password">Repite la nueva contraseña</label><input id="repeat-password" type="password" autoComplete="new-password" maxLength={maxPasswordLength} value={repeat} onChange={event => setRepeat(event.target.value)} required/></div>
          <button className="button primary full" disabled={busy}>{busy ? "Guardando…" : "Guardar y continuar"}</button>
          <button type="button" className="button ghost full" onClick={onLeave}>Salir</button>
        </form>
      </section>
    </main>
  </div>;
}
