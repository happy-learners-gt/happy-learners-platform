import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import { fromBase64Url, toBase64Url } from "@happy-learners/domain";
import { api, message } from "../api";
import { formatInstant } from "../regional";
import { useFeedback } from "../ui/feedback";
import { Icon } from "../ui/icons";
import type { SignInAnswer } from "./mfa";

/**
 * ST-132: passkeys in the browser. The Worker sends the WebAuthn options with binary fields in base64url; the browser
 * creates or uses the credential (fingerprint, face or PIN) and its answer goes back the same way.
 */
const buffer = (text: string) => fromBase64Url(text)!.buffer as ArrayBuffer;
const text = (data: ArrayBuffer | null) => data ? toBase64Url(new Uint8Array(data)) : null;
type Descriptor = { type: "public-key"; id: string; transports?: AuthenticatorTransport[] };
const descriptors = (list?: Descriptor[]) => list?.map(item => ({ ...item, id: buffer(item.id) }));
export const passkeysAvailable = () => typeof window !== "undefined" && !!window.PublicKeyCredential && !!navigator.credentials;

async function create(options: Record<string, unknown> & { challenge: string; user: { id: string; name: string; displayName: string }; excludeCredentials?: Descriptor[] }) {
  const credential = await navigator.credentials.create({ publicKey: { ...options, challenge: buffer(options.challenge), user: { ...options.user, id: buffer(options.user.id) }, excludeCredentials: descriptors(options.excludeCredentials) } as PublicKeyCredentialCreationOptions }) as PublicKeyCredential | null;
  if (!credential) throw new Error("No se creó la passkey.");
  const response = credential.response as AuthenticatorAttestationResponse;
  return { id: credential.id, rawId: text(credential.rawId), type: credential.type, response: { clientDataJSON: text(response.clientDataJSON), attestationObject: text(response.attestationObject), transports: response.getTransports?.() || [] } };
}
async function get(options: Record<string, unknown> & { challenge: string; allowCredentials?: Descriptor[] }) {
  const credential = await navigator.credentials.get({ publicKey: { ...options, challenge: buffer(options.challenge), allowCredentials: descriptors(options.allowCredentials) } as PublicKeyCredentialRequestOptions }) as PublicKeyCredential | null;
  if (!credential) throw new Error("No se usó la passkey.");
  const response = credential.response as AuthenticatorAssertionResponse;
  return { id: credential.id, rawId: text(credential.rawId), type: credential.type, response: { clientDataJSON: text(response.clientDataJSON), authenticatorData: text(response.authenticatorData), signature: text(response.signature), userHandle: text(response.userHandle) } };
}
/** The browser's own errors, in words: cancelled, timed out, or not supported here. */
const browserError = (cause: unknown) => cause instanceof DOMException
  ? cause.name === "NotAllowedError" ? "Se canceló o se agotó el tiempo. Vuelve a intentar." : cause.name === "InvalidStateError" ? "Esta passkey ya está registrada en este dispositivo." : "Este navegador no pudo usar la passkey."
  : message(cause);

/** Signing in with a passkey of the account typed on the sign-in page. */
export async function signInWithPasskey(identifier: string): Promise<SignInAnswer> {
  const { publicKey } = await api<{ publicKey: Record<string, unknown> & { challenge: string; allowCredentials?: Descriptor[] } }>("/login/passkey/options", "POST", { identifier });
  let credential;
  try { credential = await get(publicKey); } catch (cause) { throw new Error(browserError(cause)); }
  return api<SignInAnswer>("/login/passkey", "POST", { credential });
}

type Passkey = { id: string; name: string; createdAt: string; lastUsedAt: string | null; synced: boolean };
/** Mi cuenta › Cuenta y seguridad: the person's passkeys. */
export function PasskeySettings() {
  const { toast, confirm } = useFeedback();
  const [list, setList] = useState<Passkey[] | null>(null), [error, setError] = useState(""), [adding, setAdding] = useState(false), [name, setName] = useState(""), [busy, setBusy] = useState(false);
  const load = () => api<{ passkeys: Passkey[] }>("/me/passkeys").then(result => setList(result.passkeys), cause => setError(message(cause)));
  useEffect(() => { void load(); }, []);
  async function add(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError("");
    try {
      const { publicKey } = await api<{ publicKey: Parameters<typeof create>[0] }>("/me/passkeys/options", "POST");
      let credential;
      try { credential = await create(publicKey); } catch (cause) { throw new Error(browserError(cause)); }
      await api("/me/passkeys", "POST", { name, credential });
      setAdding(false); setName(""); await load(); toast({ message: `Passkey «${name.trim()}» registrada. Ya puedes entrar con ella.` });
    } catch (cause) { setError(message(cause)); }
    finally { setBusy(false); }
  }
  async function remove(item: Passkey) {
    if (!await confirm({ title: `¿Eliminar la passkey «${item.name}»?`, body: "Ya no podrás entrar con ella. Si está guardada en tu dispositivo o en tu gestor de contraseñas, bórrala también allí.", confirm: "Eliminar", danger: true })) return;
    try { await api(`/me/passkeys/${item.id}`, "DELETE"); await load(); toast({ message: "Passkey eliminada." }); } catch (cause) { toast({ tone: "error", message: message(cause) }); }
  }
  if (!passkeysAvailable()) return <p className="muted">Este navegador no admite passkeys.</p>;
  return <div className="stack">
    <p className="muted small">Una passkey te deja entrar con la huella, el rostro o el PIN de tu dispositivo, sin contraseña ni código. Cuenta como los dos pasos.</p>
    {error && <p className="form-alert" role="alert"><Icon name="alert" size={18}/>{error}</p>}
    {list && (list.length ? <ul className="plain-list passkey-list">{list.map(item => <li key={item.id}>
      <span><strong>{item.name}</strong>{item.synced && <span className="muted small"> · sincronizada</span>}<br/><span className="muted small">Registrada el {formatInstant(item.createdAt)}{item.lastUsedAt ? ` · usada el ${formatInstant(item.lastUsedAt)}` : " · sin usar"}</span></span>
      <button type="button" className="button ghost small" onClick={() => void remove(item)}>Eliminar</button>
    </li>)}</ul> : <p className="muted">Aún no tienes passkeys.</p>)}
    {adding ? <form onSubmit={add} className="stack" aria-label="Agregar una passkey">
      <div className="field"><label htmlFor="passkey-name">Nombre de la passkey</label><input id="passkey-name" maxLength={60} placeholder="Ej. Teléfono" value={name} onChange={event => setName(event.target.value)} required/></div>
      <div className="button-row"><button type="button" className="button secondary" onClick={() => setAdding(false)}>Cancelar</button><button className="button primary" disabled={busy}>{busy ? "Esperando al dispositivo…" : "Crear passkey"}</button></div>
    </form> : <div className="button-row"><button type="button" className="button secondary small" onClick={() => setAdding(true)}><Icon name="plus" size={16}/>Agregar passkey</button></div>}
  </div>;
}
