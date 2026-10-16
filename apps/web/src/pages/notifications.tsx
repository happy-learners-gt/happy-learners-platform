import { useEffect, useState } from "react";
import type { NotificationDelivery, NotificationKind, NotificationRecord, NotificationSetting } from "@happy-learners/contracts";
import { api, message } from "../api";
import { useSession } from "../session";
import { useFeedback } from "../ui/feedback";
import { Icon } from "../ui/icons";
import { EmptyState, ErrorState, Field, Loading, PageHeader, Section, StatusBadge } from "../ui/primitives";
import type { Tone } from "../ui/primitives";

/**
 * ST-124: e-mail notifications. Each person chooses which notices they receive in «Mi perfil»; administration marks
 * the mandatory ones and consults every message sent, with its recipient, reason and status.
 */
const statusLabels: Record<NotificationDelivery, [string, Tone]> = {
  queued: ["En cola", "info"], sent: ["Enviado", "success"], failed: ["Falló", "danger"], not_configured: ["Correo sin configurar", "warning"],
  deferred: ["Diferido", "warning"], no_address: ["Sin correo", "neutral"],
};
const dateTime = (value: string) => new Date(value).toLocaleString("es-GT", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });

function Delivery({ item }: { item: NotificationRecord }) {
  const [label, tone] = statusLabels[item.status];
  return <><StatusBadge tone={tone}>{label}</StatusBadge>{item.mandatory && <><br/><span className="muted small">Obligatorio</span></>}</>;
}

function History({ items, labels, admin }: { items: NotificationRecord[]; labels: Record<string, string>; admin: boolean }) {
  return <div className="table-card" role="region" aria-label={admin ? "Notificaciones enviadas" : "Tus avisos recientes"} tabIndex={0}><table className="members-table">
    <caption className="sr-only">{admin ? "Notificaciones por correo: destinatario, motivo y estado" : "Tus avisos por correo recientes: motivo y estado"}</caption>
    <thead><tr><th scope="col">Fecha</th>{admin && <th scope="col">Destinatario</th>}<th scope="col">Aviso</th><th scope="col">Motivo</th><th scope="col">Estado</th></tr></thead>
    <tbody>{items.map(item => <tr key={item.id}>
      <td><time dateTime={item.createdAt}>{dateTime(item.createdAt)}</time></td>
      {admin && <th scope="row"><span>{item.personName}</span><br/><span className="muted small">{item.recipient || "Sin correo registrado"}</span></th>}
      <td>{labels[item.type] || item.type}</td>
      <td>{item.reason}{item.status === "failed" && item.error && <><br/><span className="muted small">{item.error}</span></>}</td>
      <td><Delivery item={item}/></td>
    </tr>)}</tbody>
  </table></div>;
}

/** «Notificaciones» inside «Mi perfil»: one switch per type; mandatory ones are shown on and locked. */
export function MyNotifications() {
  const { toast } = useFeedback();
  const [data, setData] = useState<{ settings: NotificationSetting[]; history: NotificationRecord[]; hasAddress: boolean } | null>(null), [error, setError] = useState(""), [busy, setBusy] = useState("");
  const load = () => { setError(""); api<NonNullable<typeof data>>("/notifications/preferences").then(setData).catch(cause => setError(message(cause))); };
  useEffect(load, []);
  async function change(type: NotificationKind, enabled: boolean, label: string) {
    setBusy(type);
    const before = data;
    // The switch answers at once; the saved state replaces it, or the previous one returns on an error.
    setData(current => current && { ...current, settings: current.settings.map(item => item.type === type ? { ...item, enabled } : item) });
    try { setData(await api<NonNullable<typeof data>>("/notifications/preferences", "PUT", { preferences: { [type]: enabled } })); toast({ message: `${enabled ? "Recibirás" : "Ya no recibirás"} avisos de «${label}».` }); }
    catch (cause) { setData(before); toast({ tone: "error", message: message(cause) }); }
    finally { setBusy(""); }
  }
  const labels = Object.fromEntries((data?.settings || []).map(item => [item.type, item.label]));
  return <section id="notificaciones" className="panel" aria-labelledby="notifications-title">
    <div className="panel-header"><h2 id="notifications-title">Notificaciones por correo</h2></div>
    {error ? <ErrorState error={error} retry={load}/> : !data ? <Loading label="Cargando tus notificaciones…" lines={3}/> : <div className="stack">
      <p className="muted small">Elige qué cambios te avisamos por correo. Los avisos obligatorios los define administración y no se pueden desactivar.</p>
      {!data.hasAddress && <p className="form-alert" role="status"><Icon name="alert" size={18}/>No tienes un correo registrado: agrega tu correo de contacto en este perfil para recibir los avisos.</p>}
      <ul className="scope-programs" aria-label="Tipos de aviso">{data.settings.map(item => <li key={item.type}>
        <label className="switch"><input type="checkbox" checked={item.enabled} disabled={item.mandatory} aria-busy={busy === item.type || undefined} onChange={event => void change(item.type, event.target.checked, item.label)}/>
          <span><strong>{item.label}</strong>{item.mandatory && <> <StatusBadge tone="info">Obligatorio</StatusBadge></>} <span className="muted small">{item.description}</span></span></label>
      </li>)}</ul>
      <h3>Tus avisos recientes</h3>
      {data.history.length ? <History items={data.history} labels={labels} admin={false}/> : <p className="muted">Todavía no te hemos enviado avisos.</p>}
    </div>}
  </section>;
}

/** Administration: which notices are mandatory, and every notification with its recipient, reason and status. */
export function NotificationsAdmin() {
  const { member } = useSession();
  if (member.role !== "admin") return <><PageHeader title="Notificaciones"/><EmptyState icon="shield" title="Esta sección es para administración">Elige qué avisos recibes en Mi perfil.</EmptyState></>;
  return <>
    <PageHeader title="Notificaciones" description="Qué avisos por correo son obligatorios y el registro de cada envío: destinatario, motivo y estado."/>
    <div className="reading stack"><Policy/><SentLog/></div>
  </>;
}

function Policy() {
  const { toast } = useFeedback();
  const [settings, setSettings] = useState<Omit<NotificationSetting, "enabled">[] | null>(null), [chosen, setChosen] = useState<NotificationKind[]>([]), [error, setError] = useState(""), [busy, setBusy] = useState(false);
  const apply = (list: Omit<NotificationSetting, "enabled">[]) => { setSettings(list); setChosen(list.filter(item => item.mandatory).map(item => item.type)); };
  const load = () => { setError(""); api<{ settings: Omit<NotificationSetting, "enabled">[] }>("/notifications/policy").then(result => apply(result.settings)).catch(cause => setError(message(cause))); };
  useEffect(load, []);
  async function save() {
    setBusy(true);
    try { apply((await api<{ settings: Omit<NotificationSetting, "enabled">[] }>("/notifications/policy", "PUT", { mandatory: chosen })).settings); toast({ message: "Avisos obligatorios guardados." }); }
    catch (cause) { toast({ tone: "error", message: message(cause) }); }
    finally { setBusy(false); }
  }
  const dirty = !!settings && settings.some(item => item.mandatory !== chosen.includes(item.type));
  return <Section title="Avisos obligatorios">
    {error ? <ErrorState error={error} retry={load}/> : !settings ? <Loading label="Cargando avisos…" lines={3}/> : <div className="stack">
      <p className="muted small">Un aviso obligatorio llega a todas las personas aunque lo hayan desactivado, y tiene prioridad cuando se acerca el tope diario de correos.</p>
      <ul className="scope-programs" aria-label="Avisos obligatorios">{settings.map(item => <li key={item.type}>
        <label className="switch"><input type="checkbox" checked={chosen.includes(item.type)} onChange={event => setChosen(current => event.target.checked ? [...current, item.type] : current.filter(type => type !== item.type))}/>
          <span><strong>{item.label}</strong> <span className="muted small">{item.audience}</span></span></label>
      </li>)}</ul>
      <div className="form-actions"><button type="button" className="button primary" disabled={!dirty || busy} onClick={() => void save()}>{busy ? "Guardando…" : "Guardar avisos obligatorios"}</button></div>
    </div>}
  </Section>;
}

function SentLog() {
  const [filters, setFilters] = useState({ person: "", type: "", status: "" });
  const [data, setData] = useState<{ notifications: NotificationRecord[]; people: { id: string; name: string }[]; mailConfigured: boolean } | null>(null), [error, setError] = useState("");
  const [labels, setLabels] = useState<Record<string, string>>({});
  const load = () => {
    setError("");
    const query = new URLSearchParams(Object.entries(filters).filter(([, value]) => value));
    api<NonNullable<typeof data>>(`/notifications/log${query.size ? `?${query}` : ""}`).then(setData).catch(cause => setError(message(cause)));
  };
  useEffect(load, [filters.person, filters.type, filters.status]);
  useEffect(() => { api<{ settings: NotificationSetting[] }>("/notifications/policy").then(result => setLabels(Object.fromEntries(result.settings.map(item => [item.type, item.label])))).catch(() => undefined); }, []);
  const set = (key: keyof typeof filters) => (value: string) => setFilters(current => ({ ...current, [key]: value }));
  return <Section title="Notificaciones enviadas">
    <div className="field-grid">
      <Field label="Persona"><select value={filters.person} onChange={event => set("person")(event.target.value)}><option value="">Todas</option>{data?.people.map(person => <option key={person.id} value={person.id}>{person.name}</option>)}</select></Field>
      <Field label="Aviso"><select value={filters.type} onChange={event => set("type")(event.target.value)}><option value="">Todos</option>{Object.entries(labels).map(([type, label]) => <option key={type} value={type}>{label}</option>)}</select></Field>
      <Field label="Estado"><select value={filters.status} onChange={event => set("status")(event.target.value)}><option value="">Todos</option>{Object.entries(statusLabels).map(([status, [label]]) => <option key={status} value={status}>{label}</option>)}</select></Field>
    </div>
    {error ? <ErrorState error={error} retry={load}/> : !data ? <Loading label="Cargando envíos…" lines={3}/> : <>
      {!data.mailConfigured && <p className="muted small">El envío de correo no está configurado: los avisos quedan registrados como «Correo sin configurar».</p>}
      {data.notifications.length ? <History items={data.notifications} labels={labels} admin/> : <p className="muted">No hay notificaciones con estos filtros.</p>}
    </>}
  </Section>;
}
