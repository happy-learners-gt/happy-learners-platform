import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import type { ProviderKey } from "@happy-learners/domain";
import { providerNames } from "@happy-learners/domain";
import { api, message } from "../api";
import { useNavigation } from "../navigation";
import { formatInstant } from "../regional";
import { useFeedback } from "../ui/feedback";
import { Icon } from "../ui/icons";
import { ErrorState, Field, Loading, StatusBadge } from "../ui/primitives";

/**
 * ST-129, ST-131, ST-138 in the browser: the providers on the sign-in page, the accounts a person links in Mi cuenta,
 * and the institution's provider in Seguridad. The round trip happens in the provider's page; the Worker comes back
 * here with the result in the address.
 */
const outcomes: Record<string, string> = {
  "sin-cuenta": "Esa cuenta no está vinculada a ninguna persona activa de tu organización. Entra con tu contraseña y vincúlala desde Mi cuenta.",
  "otro-navegador": "El inicio de sesión empezó en otro navegador o ventana. Vuelve a intentarlo desde aquí.", caducado: "El inicio de sesión caducó. Vuelve a intentarlo.",
  cancelado: "Se canceló en el proveedor.", dominio: "El correo de esa cuenta no es de los dominios de tu organización.", "ya-vinculada": "Esa cuenta ya está vinculada, o ya tienes una de ese proveedor.",
  error: "No pudimos completar el inicio con el proveedor. Vuelve a intentar.",
};
export const providerOutcome = (code: string | null) => code ? outcomes[code] || outcomes.error : "";

/** The buttons under the sign-in form; each needs who one is, typed above. */
export function ProviderButtons({ identifier, onError }: { identifier: string; onError: (text: string) => void }) {
  const [providers, setProviders] = useState<ProviderKey[]>([]), [busy, setBusy] = useState("");
  useEffect(() => { api<{ providers: ProviderKey[] }>("/login/providers").then(result => setProviders(result.providers), () => setProviders([])); }, []);
  async function go(key: ProviderKey) {
    if (!identifier.trim()) { onError(key === "sso" ? "Escribe tu correo institucional en Usuario." : "Escribe tu usuario o tu correo para entrar con tu cuenta vinculada."); return; }
    setBusy(key);
    try { window.location.assign((await api<{ url: string }>(`/login/provider/${key}`, "POST", { identifier: identifier.trim() })).url); }
    catch (cause) { onError(message(cause)); setBusy(""); }
  }
  return <div className="provider-buttons" role="group" aria-label="Entrar con otra cuenta">
    {providers.map(key => <button key={key} type="button" className="button secondary" disabled={!!busy} onClick={() => void go(key)}>{busy === key ? "Abriendo…" : `Entrar con ${providerNames[key]}`}</button>)}
    <button type="button" className="button secondary" disabled={!!busy} onClick={() => void go("sso")}>{busy === "sso" ? "Abriendo…" : "Entrar con la cuenta de tu institución"}</button>
  </div>;
}

type Connection = { name: string; issuer: string; clientId: string; domains: string[]; defaultRole: "educator" | "admin"; adminGroup: string | null; status: "draft" | "tested" | "active"; testedAt: string | null; version: number; callback: string };
const statusLabel = { draft: ["Sin probar", "warning"], tested: ["Probado, inactivo", "info"], active: ["Activo", "success"] } as const;
/** Seguridad › Proveedor institucional (ST-138): configure, test with an account of the institution, then activate. */
export function InstitutionProvider() {
  const { toast, confirm } = useFeedback();
  const { url, navigate } = useNavigation();
  const [data, setData] = useState<{ connection: Connection | null; callback: string } | null>(null), [error, setError] = useState(""), [busy, setBusy] = useState(false);
  const load = async () => { setError(""); try { setData(await api("/security/sso")); } catch (cause) { setError(message(cause)); } };
  useEffect(() => { void load(); }, []);
  useEffect(() => {
    const result = url.searchParams.get("prueba");
    if (!result) return;
    toast(result === "correcta" ? { message: "Prueba correcta. Ya puedes activar el proveedor." } : { tone: "error", message: providerOutcome(result) });
    navigate("/identidad/inicio-de-sesion", true);
  }, [url.search]);
  if (error && !data) return <ErrorState error={error} retry={() => void load()}/>;
  if (!data) return <Loading label="Cargando el proveedor…"/>;
  const connection = data.connection;
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError("");
    const form = Object.fromEntries(new FormData(event.currentTarget)) as Record<string, string>;
    try {
      await api("/security/sso", "PUT", { name: form.name, issuer: form.issuer, clientId: form.clientId, clientSecret: form.clientSecret, domains: form.domains.split(/[,\s]+/).filter(Boolean), defaultRole: form.defaultRole, adminGroup: form.adminGroup, version: connection?.version || 0 });
      await load(); toast({ message: "Proveedor guardado. Pruébalo con una cuenta de la institución." });
    } catch (cause) { setError(message(cause)); }
    finally { setBusy(false); }
  }
  async function test() {
    try { window.location.assign((await api<{ url: string }>("/security/sso/test", "POST")).url); } catch (cause) { setError(message(cause)); }
  }
  async function activate(active: boolean) {
    try { await api("/security/sso/activate", "POST", { version: connection!.version, active }); await load(); toast({ message: active ? "Proveedor activado: el equipo ya puede entrar con su cuenta institucional." : "Proveedor desactivado." }); }
    catch (cause) { setError(message(cause)); }
  }
  async function remove() {
    if (!await confirm({ title: "¿Eliminar el proveedor institucional?", body: "Nadie podrá entrar con su cuenta institucional; sus contraseñas y passkeys siguen funcionando.", confirm: "Eliminar", danger: true })) return;
    try { await api("/security/sso", "DELETE"); await load(); toast({ message: "Proveedor eliminado." }); } catch (cause) { setError(message(cause)); }
  }
  return <div className="stack">
    <p className="muted small">Conecta el proveedor de identidad de la institución (Okta, Microsoft Entra ID u otro con OpenID Connect). Registra en él una aplicación web con esta dirección de retorno: <code>{data.callback}</code>. Solo entran personas activas de la organización cuyo correo de acceso sea de los dominios que indiques.</p>
    {connection && <p><StatusBadge tone={statusLabel[connection.status][1]}>{statusLabel[connection.status][0]}</StatusBadge>{connection.testedAt && <span className="muted small"> · probado el {formatInstant(connection.testedAt)}</span>}</p>}
    {error && <p className="form-alert" role="alert"><Icon name="alert" size={18}/>{error}</p>}
    <form className="stack policy-form" aria-label="Proveedor institucional" onSubmit={save}><fieldset className="stack" disabled={busy}>
      <Field label="Nombre"><input name="name" required minLength={2} maxLength={80} defaultValue={connection?.name} placeholder="Ej. Microsoft Entra ID de la escuela"/></Field>
      <Field label="Emisor (issuer)" hint="Ej. https://login.microsoftonline.com/<tenant>/v2.0 o https://<dominio>.okta.com/oauth2/default"><input name="issuer" type="url" required maxLength={300} defaultValue={connection?.issuer}/></Field>
      <Field label="Identificador de cliente"><input name="clientId" required maxLength={255} defaultValue={connection?.clientId}/></Field>
      <Field label="Secreto de cliente" hint={connection ? "Déjalo vacío para conservar el actual. No se vuelve a mostrar." : "Se guarda cifrado y no se vuelve a mostrar."}><input name="clientSecret" type="password" autoComplete="off" maxLength={2000} required={!connection}/></Field>
      <Field label="Dominios de correo" hint="Separados por comas, ej. escuela.edu.gt"><input name="domains" required defaultValue={connection?.domains.join(", ")}/></Field>
      <Field label="Rol por defecto"><select name="defaultRole" defaultValue={connection?.defaultRole || "educator"}><option value="educator">Educador</option><option value="admin">Administración</option></select></Field>
      <Field label="Grupo de administración" optional hint="Quien llegue con este grupo entra como administración; los demás, con el rol por defecto. Vacío: cada persona conserva su rol."><input name="adminGroup" maxLength={255} defaultValue={connection?.adminGroup || ""}/></Field>
      <div className="button-row"><button className="button primary">{busy ? "Guardando…" : "Guardar"}</button>
        {connection && <button type="button" className="button secondary" onClick={() => void test()}>Probar con una cuenta</button>}
        {connection && connection.status !== "draft" && <button type="button" className="button secondary" onClick={() => void activate(connection.status !== "active")}>{connection.status === "active" ? "Desactivar" : "Activar"}</button>}
        {connection && <button type="button" className="button ghost" onClick={() => void remove()}>Eliminar</button>}</div>
    </fieldset></form>
  </div>;
}
