import { fromBase64Url, toBase64Url } from "@happy-learners/domain";
import { api } from "../api";
import type { SignInAnswer } from "./mfa";

/**
 * ST-132: passkeys in the browser. The Worker sends the WebAuthn options with binary fields in base64url; the browser
 * creates or uses the credential (fingerprint, face or PIN) and its answer goes back the same way. Creating one is a
 * single click: the device names it, and it can be renamed afterwards.
 */
const buffer = (text: string) => fromBase64Url(text)!.buffer as ArrayBuffer;
const text = (data: ArrayBuffer | null) => data ? toBase64Url(new Uint8Array(data)) : null;
type Descriptor = { type: "public-key"; id: string; transports?: AuthenticatorTransport[] };
type RequestOptions = Record<string, unknown> & { challenge: string; allowCredentials?: Descriptor[] };
const descriptors = (list?: Descriptor[]) => list?.map(item => ({ ...item, id: buffer(item.id) }));
export const passkeysAvailable = () => typeof window !== "undefined" && !!window.PublicKeyCredential && !!navigator.credentials;
/** Whether this device itself can hold a passkey (Windows Hello, Touch ID, Android), to suggest creating one. */
export const platformPasskeys = async () => passkeysAvailable() && !!await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable?.().catch(() => false);

async function create(options: Record<string, unknown> & { challenge: string; user: { id: string; name: string; displayName: string }; excludeCredentials?: Descriptor[] }) {
  const credential = await navigator.credentials.create({ publicKey: { ...options, challenge: buffer(options.challenge), user: { ...options.user, id: buffer(options.user.id) }, excludeCredentials: descriptors(options.excludeCredentials) } as PublicKeyCredentialCreationOptions }) as PublicKeyCredential | null;
  if (!credential) throw new Error("No se creó la passkey.");
  const response = credential.response as AuthenticatorAttestationResponse;
  return { id: credential.id, rawId: text(credential.rawId), type: credential.type, response: { clientDataJSON: text(response.clientDataJSON), attestationObject: text(response.attestationObject), transports: response.getTransports?.() || [] } };
}
async function get(options: RequestOptions) {
  const credential = await navigator.credentials.get({ publicKey: { ...options, challenge: buffer(options.challenge), allowCredentials: descriptors(options.allowCredentials) } as PublicKeyCredentialRequestOptions }) as PublicKeyCredential | null;
  if (!credential) throw new Error("No se usó la passkey.");
  const response = credential.response as AuthenticatorAssertionResponse;
  return { id: credential.id, rawId: text(credential.rawId), type: credential.type, response: { clientDataJSON: text(response.clientDataJSON), authenticatorData: text(response.authenticatorData), signature: text(response.signature), userHandle: text(response.userHandle) } };
}
/** The browser's own errors, in words: cancelled, timed out, already there, or not supported here. */
const browserError = (cause: unknown) => cause instanceof DOMException
  ? cause.name === "NotAllowedError" ? "Se canceló o se agotó el tiempo. Vuelve a intentar." : cause.name === "InvalidStateError" ? "Este dispositivo ya tiene una passkey de tu cuenta." : "Este navegador no pudo usar la passkey."
  : cause instanceof Error ? cause.message : "No se pudo usar la passkey.";
const device = async <T,>(work: () => Promise<T>) => { try { return await work(); } catch (cause) { throw new Error(browserError(cause)); } };

export function usePasskey() {
  return {
    /** Creates a passkey on this device for the signed-in person; the server names it after the device. */
    create: async () => {
      const { publicKey } = await api<{ publicKey: Parameters<typeof create>[0] }>("/me/passkeys/options", "POST");
      const credential = await device(() => create(publicKey));
      return (await api<{ passkey: { id: string; name: string } }>("/me/passkeys", "POST", { credential })).passkey;
    },
    /** An assertion of one of the person's own passkeys, to confirm a sensitive change. */
    confirm: async () => device(async () => get((await api<{ publicKey: RequestOptions }>("/me/confirm/options", "POST")).publicKey)),
  };
}

/** Signing in with a passkey: of the account typed, or, with nothing typed, any passkey of this site the device offers. */
export async function signInWithPasskey(identifier: string): Promise<SignInAnswer> {
  const { publicKey } = await api<{ publicKey: RequestOptions }>("/login/passkey/options", "POST", identifier ? { identifier } : {});
  const credential = await device(() => get(publicKey));
  return api<SignInAnswer>("/login/passkey", "POST", { credential });
}
