import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import { api, message } from "../api";
import { formatInstant } from "../regional";
import { useFeedback } from "../ui/feedback";
import { Icon } from "../ui/icons";
import { EmptyState, ErrorState, Loading, StatusBadge } from "../ui/primitives";

/** ST-136: integration tokens: the person's own in Mi cuenta and all of the organization in Seguridad. */
type Token = { id: string; name: string; scope: "read"; createdAt: string; expiresAt: string; lastUsedAt: string | null; revokedAt: string | null; owner: string; status: "active" | "expired" | "revoked" };
const statusOf = { active: ["Activo", "success"], expired: ["Caducado", "neutral"], revoked: ["Revocado", "neutral"] } as const;

function TokenTable({ tokens, owner, onRevoke }: { tokens: Token[]; owner?: boolean; onRevoke: (token: Token) => void }) {
  return <div className="table-card" role="region" aria-label="Tokens de integración" tabIndex={0}><table className="members-table">
    <caption className="sr-only">Tokens de integración, su alcance, caducidad y último uso</caption>
    <thead><tr><th scope="col">Nombre</th>{owner && <th scope="col">Persona</th>}<th scope="col">Estado</th><th scope="col">Caduca</th><th scope="col">Último uso</th><th scope="col"><span className="sr-only">Acciones</span></th></tr></thead>
    <tbody>{tokens.map(token => <tr key={token.id}>
      <th scope="row">{token.name}<br/><span className="muted small">Solo lectura</span></th>
      {owner && <td data-label="Persona">{token.owner}</td>}
      <td data-label="Estado"><StatusBadge tone={statusOf[token.status][1]}>{statusOf[token.status][0]}</StatusBadge></td>
      <td data-label="Caduca">{formatInstant(token.expiresAt)}</td>
      <td data-label="Último uso">{token.lastUsedAt ? formatInstant(token.lastUsedAt) : <span className="muted">Sin usar</span>}</td>
      <td className="cell-actions">{token.status === "active" && <button type="button" className="button ghost small" onClick={() => onRevoke(token)}>Revocar</button>}</td>
    </tr>)}</tbody>
  </table></div>;
}

function useRevoke(base: string, reload: () => Promise<void>) {
  const { toast, confirm } = useFeedback();
  return async (token: Token) => {
    if (!await confirm({ title: `¿Revocar el token «${token.name}»?`, body: "Deja de funcionar de inmediato en la integración que lo usa.", confirm: "Revocar", danger: true })) return;
    try { await api(`${base}/${token.id}`, "DELETE"); await reload(); toast({ message: "Token revocado." }); } catch (cause) { toast({ tone: "error", message: message(cause) }); }
  };
}

/** Mi cuenta: create (shown once), list and revoke. */
export function MyTokens() {
  const [list, setList] = useState<Token[] | null>(null), [error, setError] = useState(""), [creating, setCreating] = useState(false), [issued, setIssued] = useState<string | null>(null), [busy, setBusy] = useState(false);
  const load = async () => { try { setList((await api<{ tokens: Token[] }>("/me/tokens")).tokens); } catch (cause) { setError(message(cause)); } };
  useEffect(() => { void load(); }, []);
  const revoke = useRevoke("/me/tokens", load);
  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError("");
    const form = new FormData(event.currentTarget);
    try { setIssued((await api<{ token: string }>("/me/tokens", "POST", { name: form.get("name"), days: Number(form.get("days")) })).token); setCreating(false); await load(); }
    catch (cause) { setError(message(cause)); }
    finally { setBusy(false); }
  }
  return <div className="stack">
    <p className="muted small">Para conectar otra herramienta con lo que tú puedes leer (cursos, secciones, agenda). Solo lee: no cambia nada ni abre tu cuenta, la seguridad, las personas ni el respaldo.</p>
    {error && <p className="form-alert" role="alert"><Icon name="alert" size={18}/>{error}</p>}
    {issued && <div className="panel stack" role="status"><p><strong>Copia el token ahora:</strong> no se vuelve a mostrar.</p><p className="mfa-key"><code>{issued}</code> <button type="button" className="button ghost small" onClick={() => void navigator.clipboard?.writeText(issued)}><Icon name="copy" size={16}/>Copiar</button></p>
      <p className="muted small">Úsalo en el encabezado <code>Authorization: Bearer …</code>.</p><button type="button" className="button secondary small" onClick={() => setIssued(null)}>Listo</button></div>}
    {list && (list.length ? <TokenTable tokens={list} onRevoke={token => void revoke(token)}/> : <p className="muted">No tienes tokens de integración.</p>)}
    {creating ? <form onSubmit={create} className="stack" aria-label="Crear un token de integración">
      <div className="field"><label htmlFor="token-name">Nombre</label><input id="token-name" name="name" minLength={2} maxLength={60} placeholder="Ej. Tablero de asistencia" required/></div>
      <div className="field"><label htmlFor="token-days">Caduca en</label><select id="token-days" name="days" defaultValue="30"><option value="7">7 días</option><option value="30">30 días</option><option value="90">90 días</option></select></div>
      <div className="button-row"><button type="button" className="button secondary" onClick={() => setCreating(false)}>Cancelar</button><button className="button primary" disabled={busy}>{busy ? "Creando…" : "Crear token"}</button></div>
    </form> : <div className="button-row"><button type="button" className="button secondary small" onClick={() => setCreating(true)}><Icon name="plus" size={16}/>Crear token</button></div>}
  </div>;
}

/** Seguridad › Tokens: every token of the organization, to revoke what should not be there. */
export function OrganizationTokens() {
  const [list, setList] = useState<Token[] | null>(null), [error, setError] = useState("");
  const load = async () => { setError(""); try { setList((await api<{ tokens: Token[] }>("/security/tokens")).tokens); } catch (cause) { setError(message(cause)); } };
  useEffect(() => { void load(); }, []);
  const revoke = useRevoke("/security/tokens", load);
  if (error) return <ErrorState error={error} retry={() => void load()}/>;
  if (!list) return <Loading label="Cargando los tokens…"/>;
  return list.length ? <TokenTable tokens={list} owner onRevoke={token => void revoke(token)}/> : <EmptyState compact icon="shield" title="Nadie tiene tokens de integración">Cada persona los crea en Mi cuenta para conectar otra herramienta; aquí se ven y se revocan.</EmptyState>;
}
