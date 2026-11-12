import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import { linkRequestedMessage, maxPasswordLength } from "@happy-learners/domain";
import { api, message } from "../api";
import { useNavigation } from "../navigation";
import { formatInstant } from "../regional";
import { Icon } from "../ui/icons";
import { MfaStep, type SignInAnswer } from "./mfa";

/**
 * REL-007 pages without a session: asking for a link from the sign-in page (ST-130, ST-134), signing in with it
 * (/entrar/<token>) and choosing a new password (/recuperar/<token>). Opening a page never uses the link; a button does.
 */
function Frame({ title, children }: { title: string; children: React.ReactNode }) {
  return <div className="login-page">
    <a className="skip-link" href="#main">Saltar al contenido</a>
    <main id="main" className="login-main">
      <div className="login-brand"><span className="brand-mark" aria-hidden="true">A</span><span>Acervum</span></div>
      <section className="login-card" aria-labelledby="link-title"><h1 id="link-title">{title}</h1>{children}</section>
    </main>
  </div>;
}
const Alert = ({ text }: { text: string }) => <p className="form-alert" role="alert"><Icon name="alert" size={18}/>{text}</p>;

/** The request on the sign-in page: the same answer whether or not the account exists. */
export function LinkRequest({ kind, onClose }: { kind: "link" | "recovery"; onClose: () => void }) {
  const [identifier, setIdentifier] = useState(""), [busy, setBusy] = useState(false), [error, setError] = useState(""), [sent, setSent] = useState(false);
  async function submit(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError("");
    try { await api(kind === "link" ? "/login/link" : "/account/recovery", "POST", { identifier }); setSent(true); }
    catch (cause) { setError(message(cause)); }
    finally { setBusy(false); }
  }
  const title = kind === "link" ? "Entrar con un enlace por correo" : "Recuperar la contraseña";
  return <section className="link-request" aria-labelledby={`${kind}-request-title`}>
    <h2 id={`${kind}-request-title`}>{title}</h2>
    {sent ? <p role="status"><Icon name="send" size={16}/> {linkRequestedMessage}</p> : <form onSubmit={submit} className="stack">
      <p className="muted small">{kind === "link" ? "Te enviamos un enlace de un solo uso que caduca en 15 minutos." : "Te enviamos un enlace de un solo uso que caduca en 30 minutos para elegir una contraseña nueva."}</p>
      {error && <Alert text={error}/>}
      <div className="field"><label htmlFor={`${kind}-identifier`}>Usuario o correo de acceso</label><input id={`${kind}-identifier`} autoComplete="username" maxLength={254} value={identifier} onChange={event => setIdentifier(event.target.value)} required/></div>
      <button className="button secondary full" disabled={busy}>{busy ? "Enviando…" : "Enviar enlace"}</button>
    </form>}
    <button type="button" className="button ghost full" onClick={onClose}>Volver a iniciar sesión</button>
  </section>;
}

type LinkPreview = { username: string; name: string; organization: string; expiresAt: string };
/** /entrar/<token>: who signs in, then one button. */
export function EnterWithLink({ token }: { token: string }) {
  const { navigate } = useNavigation();
  const [preview, setPreview] = useState<LinkPreview | null>(null), [error, setError] = useState(""), [busy, setBusy] = useState(false), [challenge, setChallenge] = useState<string | null>(null);
  useEffect(() => { api<{ link: LinkPreview }>(`/login/link/${token}`).then(result => setPreview(result.link), cause => setError(message(cause))); }, [token]);
  async function enter() {
    setBusy(true); setError("");
    try { const answer = await api<SignInAnswer>(`/login/link/${token}`, "POST"); if (answer.challenge) { setChallenge(answer.challenge); setBusy(false); } else window.location.assign("/inicio"); }
    catch (cause) { setError(message(cause)); setBusy(false); }
  }
  return <Frame title="Entrar con tu enlace">
    {challenge ? <MfaStep challenge={challenge} onDone={async () => window.location.assign("/inicio")} onCancel={() => navigate("/")}/>
      : error ? <><Alert text={error}/><button type="button" className="button secondary full" onClick={() => navigate("/")}>Ir a iniciar sesión</button></>
      : !preview ? <p role="status">Revisando el enlace…</p>
      : <>
        <p>Vas a entrar como <strong>{preview.name}</strong> (@{preview.username}) en {preview.organization}.</p>
        <p className="muted small">El enlace funciona una vez y caduca el {formatInstant(preview.expiresAt)}.</p>
        <button type="button" className="button primary full" disabled={busy} onClick={() => void enter()}>{busy ? "Entrando…" : "Entrar"}</button>
      </>}
  </Frame>;
}

type RecoveryPreview = LinkPreview & { minimum: number };
/** /recuperar/<token>: a new password, twice. Every open session closes. */
export function RecoverPassword({ token }: { token: string }) {
  const { navigate } = useNavigation();
  const [preview, setPreview] = useState<RecoveryPreview | null>(null), [error, setError] = useState(""), [busy, setBusy] = useState(false), [done, setDone] = useState(false);
  const [next, setNext] = useState(""), [repeat, setRepeat] = useState("");
  useEffect(() => { api<{ recovery: RecoveryPreview }>(`/account/recovery/${token}`).then(result => setPreview(result.recovery), cause => setError(message(cause))); }, [token]);
  async function submit(event: FormEvent) {
    event.preventDefault(); setError("");
    if (next !== repeat) { setError("Las contraseñas no coinciden."); return; }
    setBusy(true);
    try { await api(`/account/recovery/${token}`, "POST", { password: next }); setDone(true); }
    catch (cause) { setError(message(cause)); }
    finally { setBusy(false); }
  }
  return <Frame title="Elige una contraseña nueva">
    {done ? <><p role="status">Tu contraseña cambió y tus sesiones abiertas se cerraron. Ya puedes entrar con ella.</p><button type="button" className="button primary full" onClick={() => navigate("/")}>Iniciar sesión</button></>
      : !preview ? (error ? <><Alert text={error}/><button type="button" className="button secondary full" onClick={() => navigate("/")}>Ir a iniciar sesión</button></> : <p role="status">Revisando el enlace…</p>)
      : <form onSubmit={submit}>
        <p>Cuenta <strong>@{preview.username}</strong> en {preview.organization}. El enlace caduca el {formatInstant(preview.expiresAt)}.</p>
        {error && <Alert text={error}/>}
        <div className="field"><label htmlFor="recovery-password">Contraseña nueva</label><input id="recovery-password" type="password" autoComplete="new-password" minLength={preview.minimum} maxLength={maxPasswordLength} aria-describedby="recovery-hint" value={next} onChange={event => setNext(event.target.value)} required/>
          <small id="recovery-hint" className="hint">Al menos {preview.minimum} caracteres. Una frase que recuerdes funciona bien; no uses una contraseña de otro sitio.</small></div>
        <div className="field"><label htmlFor="recovery-repeat">Repite la contraseña nueva</label><input id="recovery-repeat" type="password" autoComplete="new-password" maxLength={maxPasswordLength} value={repeat} onChange={event => setRepeat(event.target.value)} required/></div>
        <button className="button primary full" disabled={busy}>{busy ? "Guardando…" : "Guardar contraseña"}</button>
      </form>}
  </Frame>;
}
