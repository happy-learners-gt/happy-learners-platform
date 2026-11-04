import { useEffect, useRef, useState } from "react";
import type { ClipboardEvent, FormEvent, KeyboardEvent } from "react";
import { encode } from "uqr";
import { api, message, setConfirmer } from "../api";
import { passkeysAvailable, usePasskey } from "../pages/passkeys";
import { Modal } from "./feedback";
import { Icon } from "./icons";

/**
 * Pieces of Identidad y acceso (docs/design/identidad-y-acceso.md): a QR drawn as SVG (no HTML injected), the six-box
 * code that accepts pasting and sends itself, and the confirmation that the shell shows when a sensitive change asks
 * for it (passkey first, then the app's code, then the password).
 */
export function QrCode({ value, label, size = 196 }: { value: string; label: string; size?: number }) {
  const { data, size: modules } = encode(value, { ecc: "M", border: 2 });
  const cells: string[] = [];
  data.forEach((row, y) => row.forEach((on, x) => { if (on) cells.push(`M${x} ${y}h1v1h-1z`); }));
  return <svg className="qr-code" role="img" aria-label={label} width={size} height={size} viewBox={`0 0 ${modules} ${modules}`} shapeRendering="crispEdges">
    <rect width={modules} height={modules} fill="#ffffff"/><path d={cells.join("")} fill="#000000"/>
  </svg>;
}

/** Six digits, one per box; typing or pasting moves on, and the last digit sends the code. */
export function CodeInput({ label, onComplete, disabled, error }: { label: string; onComplete: (code: string) => void; disabled?: boolean; error?: string }) {
  const [digits, setDigits] = useState(["", "", "", "", "", ""]), boxes = useRef<(HTMLInputElement | null)[]>([]);
  useEffect(() => { if (error) { setDigits(["", "", "", "", "", ""]); boxes.current[0]?.focus(); } }, [error]);
  useEffect(() => { boxes.current[0]?.focus(); }, []);
  const set = (next: string[]) => { setDigits(next); if (next.every(Boolean)) onComplete(next.join("")); };
  const type = (index: number, value: string) => {
    const clean = value.replace(/\D/g, "");
    if (!clean) { const next = [...digits]; next[index] = ""; setDigits(next); return; }
    const next = [...digits]; [...clean].slice(0, 6 - index).forEach((digit, offset) => { next[index + offset] = digit; });
    set(next); boxes.current[Math.min(index + clean.length, 5)]?.focus();
  };
  const paste = (event: ClipboardEvent<HTMLInputElement>) => { const text = event.clipboardData.getData("text").replace(/\D/g, "").slice(0, 6); if (text.length) { event.preventDefault(); type(0, text); } };
  const key = (index: number, event: KeyboardEvent<HTMLInputElement>) => { if (event.key === "Backspace" && !digits[index] && index > 0) boxes.current[index - 1]?.focus(); };
  return <fieldset className="code-input" disabled={disabled}>
    <legend>{label}</legend>
    <div className="code-boxes">{digits.map((digit, index) => <input key={index} ref={element => { boxes.current[index] = element; }} inputMode="numeric" autoComplete={index === 0 ? "one-time-code" : "off"}
      aria-label={`Dígito ${index + 1} de 6`} maxLength={index === 0 ? 6 : 1} value={digit} onChange={event => type(index, event.target.value)} onPaste={paste} onKeyDown={event => key(index, event)}/>)}</div>
    {error && <p className="field-error" role="alert">{error}</p>}
  </fieldset>;
}

type Ways = { passkey: boolean; code: boolean };
/** «Confirma que eres tú»: one tap with a passkey when there is one; otherwise the app's code or the password. */
function ConfirmIdentity({ onDone }: { onDone: (ok: boolean) => void }) {
  const [ways, setWays] = useState<Ways | null>(null), [mode, setMode] = useState<"passkey" | "code" | "password">("password");
  const [password, setPassword] = useState(""), [error, setError] = useState(""), [busy, setBusy] = useState(false);
  const passkey = usePasskey();
  useEffect(() => {
    api<{ mfa: { enabled: boolean } }>("/me/mfa").then(async result => {
      const keys = passkeysAvailable() ? await api<{ passkeys: unknown[] }>("/me/passkeys").then(list => list.passkeys.length > 0, () => false) : false;
      const found = { passkey: keys, code: result.mfa.enabled };
      setWays(found); setMode(found.passkey ? "passkey" : found.code ? "code" : "password");
    }, () => setWays({ passkey: false, code: false }));
  }, []);
  async function confirm(body: Record<string, unknown>) {
    setBusy(true); setError("");
    try { await api("/me/confirm", "POST", body); onDone(true); }
    catch (cause) { setError(message(cause)); setBusy(false); }
  }
  async function withPasskey() {
    setBusy(true); setError("");
    try { await confirm({ credential: await passkey.confirm() }); } catch (cause) { setError(message(cause)); setBusy(false); }
  }
  return <Modal title="Confirma que eres tú" onClose={() => onDone(false)}>
    <div className="stack">
      <p className="muted">Para este cambio necesitamos confirmar tu identidad. No te lo volveremos a pedir en los próximos 10 minutos.</p>
      {error && <p className="form-alert" role="alert"><Icon name="alert" size={18}/>{error}</p>}
      {!ways ? <p role="status" className="muted">Cargando…</p> : mode === "passkey" ? <button type="button" className="button primary full" disabled={busy} onClick={() => void withPasskey()}><Icon name="shield" size={16}/>{busy ? "Esperando al dispositivo…" : "Confirmar con tu passkey"}</button>
        : mode === "code" ? <CodeInput label="Código de tu aplicación de autenticación" disabled={busy} error={error} onComplete={code => void confirm({ code })}/>
        : <form className="stack" onSubmit={(event: FormEvent) => { event.preventDefault(); void confirm({ password }); }}>
          <div className="field"><label htmlFor="confirm-password">Tu contraseña</label><input id="confirm-password" type="password" autoComplete="current-password" data-autofocus maxLength={128} value={password} onChange={event => setPassword(event.target.value)} required/></div>
          <button className="button primary full" disabled={busy}>{busy ? "Confirmando…" : "Confirmar"}</button>
        </form>}
      {ways && <div className="login-alternatives">
        {ways.passkey && mode !== "passkey" && <button type="button" className="link-button" onClick={() => setMode("passkey")}>Usar una passkey</button>}
        {ways.code && mode !== "code" && <button type="button" className="link-button" onClick={() => setMode("code")}>Usar el código de la aplicación</button>}
        {mode !== "password" && <button type="button" className="link-button" onClick={() => setMode("password")}>Usar la contraseña</button>}
      </div>}
    </div>
  </Modal>;
}

/** Mounted once in the signed-in shell: answers the api's requests for confirmation. */
export function ConfirmationHost() {
  const [pending, setPending] = useState<((ok: boolean) => void) | null>(null);
  useEffect(() => {
    setConfirmer(() => new Promise<boolean>(resolve => setPending(() => resolve)));
    return () => setConfirmer(null);
  }, []);
  return pending ? <ConfirmIdentity onDone={ok => { pending(ok); setPending(null); }}/> : null;
}

/** Saves text as a file the person keeps (recovery codes). */
export function download(name: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: "text/plain;charset=utf-8" }));
  const link = document.createElement("a"); link.href = url; link.download = name; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
