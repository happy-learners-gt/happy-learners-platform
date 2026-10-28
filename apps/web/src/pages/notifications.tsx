import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import type { EmailFrequency, NotificationChannel, NotificationDelivery, NotificationKind, NotificationMatrixRow, NotificationPreferences, NotificationRecord, NotificationSetting } from "@happy-learners/contracts";
import { channelLabels, emailFrequencies, emailFrequencyLabels, notificationCatalog, notificationChannels } from "@happy-learners/domain";
import { api, message } from "../api";
import { Link, useUnsavedChanges } from "../navigation";
import { useSession } from "../session";
import { formatInstant, weekOrder, zoneName } from "../regional";
import { useFeedback } from "../ui/feedback";
import { Icon } from "../ui/icons";
import { EmptyState, ErrorState, Field, Loading, PageHeader, Section, StatusBadge } from "../ui/primitives";
import type { Tone } from "../ui/primitives";

/**
 * ST-124, ST-161: notifications. Each person chooses what they receive, on which channel and how often in
 * «Preferencias»; administration marks the mandatory ones and consults every message sent, with its recipient, reason
 * and status.
 */
const statusLabels: Record<NotificationDelivery, [string, Tone]> = {
  queued: ["En cola", "info"], sent: ["Enviado", "success"], failed: ["Falló", "danger"], not_configured: ["Correo sin configurar", "warning"],
  deferred: ["Diferido", "warning"], no_address: ["Sin correo", "neutral"], scheduled: ["Programado", "info"], digested: ["En un resumen", "success"],
};
const dateTime = (value: string) => formatInstant(value);

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
      <td>{item.reason}{item.status === "failed" && item.error && <><br/><span className="muted small">{item.error}</span></>}{item.status === "scheduled" && item.deliverAfter && <><br/><span className="muted small">Sale el {formatInstant(item.deliverAfter)}</span></>}</td>
      <td><Delivery item={item}/></td>
    </tr>)}</tbody>
  </table></div>;
}

/**
 * «Notificaciones» in Preferencias (ST-161, extends ST-124): the event × channel matrix, how often e-mail arrives and
 * the quiet hours. Locked rows (account notices, or mandatory for the organization) stay on and say why.
 */
export function MyNotifications() {
  const { toast } = useFeedback();
  const [data, setData] = useState<NotificationPreferences | null>(null), [error, setError] = useState(""), [busy, setBusy] = useState("");
  const load = () => { setError(""); api<NotificationPreferences>("/me/notification-preferences").then(setData).catch(cause => setError(message(cause))); };
  useEffect(load, []);
  async function change(row: NotificationMatrixRow, channel: NotificationChannel, enabled: boolean) {
    const key = `${row.type}:${channel}`;
    setBusy(key);
    const before = data;
    // The switch answers at once; the saved state replaces it, or the previous one returns on an error.
    setData(current => current && { ...current, events: current.events.map(item => item.type === row.type ? { ...item, channels: { ...item.channels, [channel]: enabled } } : item) });
    try {
      setData(await api<NotificationPreferences>("/me/notification-preferences", "PUT", { channels: { [row.type]: { [channel]: enabled } } }));
      toast({ message: `${enabled ? "Recibirás" : "Ya no recibirás"} «${row.label}» ${channel === "email" ? "por correo" : "en la aplicación"}.` });
    } catch (cause) { setData(before); toast({ tone: "error", message: message(cause) }); }
    finally { setBusy(""); }
  }
  const labels = Object.fromEntries((data?.events || []).map(item => [item.type, item.label]));
  if (error) return <ErrorState error={error} retry={load}/>;
  if (!data) return <Loading label="Cargando tus notificaciones…" lines={4}/>;
  const groups: [string, NotificationMatrixRow[]][] = [["Tu trabajo", data.events.filter(item => item.locked !== "system")], ["Cuenta y términos", data.events.filter(item => item.locked === "system")]];
  return <div id="notificaciones" className="stack-lg">
    <section className="panel" aria-labelledby="matrix-title">
      <div className="panel-header"><h2 id="matrix-title">Qué te avisamos y por dónde</h2></div>
      <p className="muted small">«En la aplicación» aparece en la campana de la barra superior. Los avisos obligatorios no se pueden desactivar: los de la cuenta y los términos protegen tu acceso, y administración puede marcar otros como obligatorios.</p>
      {!data.hasAddress && <p className="form-alert" role="status"><Icon name="alert" size={18}/>No tienes un correo registrado: agrégalo en <Link href="/mi-cuenta/cuenta">Cuenta y seguridad</Link> para recibir los avisos por correo.</p>}
      <div className="table-card" role="region" aria-label="Avisos por canal" tabIndex={0}><table className="members-table notification-matrix">
        <caption className="sr-only">Para cada aviso, si lo recibes en la aplicación y por correo</caption>
        <thead><tr><th scope="col">Aviso</th>{notificationChannels.map(channel => <th key={channel} scope="col" className="matrix-channel">{channelLabels[channel]}</th>)}</tr></thead>
        {groups.map(([title, rows]) => rows.length > 0 && <tbody key={title}>
          <tr className="matrix-group"><th scope="rowgroup" colSpan={3}>{title}</th></tr>
          {rows.map(row => <tr key={row.type}>
            <th scope="row"><strong>{row.label}</strong>{row.locked && <> <StatusBadge tone="info">Obligatorio</StatusBadge></>}<br/>
              <span className="muted small">{row.description}{row.locked === "policy" ? " Administración lo marcó como obligatorio." : row.locked === "system" ? " Aviso de la cuenta: siempre activo." : ""}</span></th>
            {notificationChannels.map(channel => <td key={channel} className="matrix-channel">
              <label className="switch matrix-switch"><input type="checkbox" role="switch" checked={row.channels[channel]} disabled={!!row.locked} aria-busy={busy === `${row.type}:${channel}` || undefined}
                aria-label={`${row.label}: ${channelLabels[channel]}`} onChange={event => void change(row, channel, event.target.checked)}/></label>
            </td>)}
          </tr>)}
        </tbody>)}
      </table></div>
    </section>
    <EmailDelivery data={data} onSaved={setData}/>
    <section className="panel" aria-labelledby="history-title">
      <div className="panel-header"><h2 id="history-title">Tus avisos por correo recientes</h2></div>
      {data.history.length ? <History items={data.history} labels={labels} admin={false}/> : <p className="muted">Todavía no te hemos enviado avisos.</p>}
    </section>
  </div>;
}

/** Frequency of e-mail, the digest time and the quiet hours, saved together. */
function EmailDelivery({ data, onSaved }: { data: NotificationPreferences; onSaved: (value: NotificationPreferences) => void }) {
  const { toast } = useFeedback();
  const { preferences } = useSession();
  const [frequency, setFrequency] = useState<EmailFrequency>(data.delivery.frequency), [digestTime, setDigestTime] = useState(data.delivery.digestTime);
  const [quiet, setQuiet] = useState(!!data.delivery.quietHours), [start, setStart] = useState(data.delivery.quietHours?.start || "21:00"), [end, setEnd] = useState(data.delivery.quietHours?.end || "07:00");
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  const dirty = frequency !== data.delivery.frequency || digestTime !== data.delivery.digestTime || quiet !== !!data.delivery.quietHours || (quiet && (start !== data.delivery.quietHours?.start || end !== data.delivery.quietHours?.end));
  useUnsavedChanges(dirty);
  const firstDay = weekOrder()[0][1].toLocaleLowerCase("es");
  async function save(event: FormEvent) {
    event.preventDefault();
    if (quiet && start === end) { setError("El horario de silencio debe empezar y terminar a horas distintas."); return; }
    setBusy(true); setError("");
    try { onSaved(await api<NotificationPreferences>("/me/notification-preferences", "PUT", { frequency, digestTime, quietHours: quiet ? { start, end } : null })); toast({ message: "Frecuencia y horario de silencio guardados." }); }
    catch (cause) { setError(message(cause)); }
    finally { setBusy(false); }
  }
  return <form className="panel" aria-labelledby="delivery-title" onSubmit={save} noValidate>
    <div className="panel-header"><h2 id="delivery-title">Frecuencia del correo</h2></div>
    <fieldset className="choice-field">
      <legend>Con qué frecuencia recibir los correos</legend>
      <div className="segmented" role="radiogroup" aria-label="Con qué frecuencia recibir los correos">
        {emailFrequencies.map(value => <label key={value}><input type="radio" name="frequency" value={value} checked={frequency === value} onChange={() => setFrequency(value)}/><span>{emailFrequencyLabels[value]}</span></label>)}
      </div>
      <p className="muted small">{frequencyHint[frequency]}</p>
    </fieldset>
    {(frequency === "daily" || frequency === "weekly") && <div className="form-grid-12">
      <div className="form-span-4"><Field label="Hora del resumen" hint={frequency === "weekly" ? `Cada ${firstDay}, el primer día de tu semana, en tu zona (${zoneName(data.timezone)}).` : `Cada día, en tu zona (${zoneName(data.timezone)}).`}>
        <input type="time" value={digestTime} step={900} required onChange={event => setDigestTime(event.target.value)}/>
      </Field></div>
    </div>}
    <div className="toggle-row">
      <label className="switch"><input type="checkbox" role="switch" checked={quiet} onChange={event => setQuiet(event.target.checked)} aria-describedby="quiet-hint"/><strong>Horario de silencio</strong></label>
      <p id="quiet-hint" className="muted small">Los correos opcionales que lleguen en ese horario esperan a que termine. Los avisos obligatorios llegan igual, y la campana de la aplicación nunca espera.</p>
    </div>
    {quiet && <div className="form-grid-12">
      <div className="form-span-4"><Field label="Desde"><input type="time" value={start} step={900} required onChange={event => setStart(event.target.value)}/></Field></div>
      <div className="form-span-4"><Field label="Hasta" hint={`Hora de ${zoneName(data.timezone)}.`}><input type="time" value={end} step={900} required onChange={event => setEnd(event.target.value)}/></Field></div>
    </div>}
    {data.scheduled > 0 && <p className="notice"><Icon name="clock" size={18}/><span>{data.scheduled === 1 ? "Un correo espera" : `${data.scheduled} correos esperan`} el próximo envío{data.nextDelivery ? `: ${formatInstant(data.nextDelivery, "long")}` : ""}.</span></p>}
    {error && <p className="form-alert" role="alert"><Icon name="alert" size={18}/>{error}</p>}
    <div className="form-actions"><button type="submit" className="button primary" disabled={!dirty || busy}>{busy ? "Guardando…" : "Guardar frecuencia"}</button>
      {preferences && preferences.timezone !== data.timezone && <span className="muted small">Zona: {data.timezone}</span>}</div>
  </form>;
}
const frequencyHint: Record<EmailFrequency, string> = {
  immediate: "Un correo por cada aviso, en cuanto ocurre.", daily: "Un solo correo al día con todos los avisos pendientes.",
  weekly: "Un solo correo a la semana con todos los avisos pendientes.", never: "Solo los avisos obligatorios. Los demás siguen en la campana si la tienes activa.",
};

/** Administration: which notices are mandatory, and every notification with its recipient, reason and status. */
export function NotificationsAdmin() {
  const { member } = useSession();
  if (member.role !== "admin") return <><PageHeader title="Notificaciones"/><EmptyState icon="shield" title="Esta sección es para administración">Elige qué avisos recibes en Preferencias.</EmptyState></>;
  return <>
    <PageHeader title="Notificaciones" description="Qué avisos por correo son obligatorios y el registro de cada envío: destinatario, motivo y estado."/>
    <div className="stack"><Policy/><SentLog/></div>
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
      <p className="muted small">Un aviso obligatorio llega a todas las personas aunque lo hayan desactivado, en la aplicación y por correo, sin esperar al resumen ni al horario de silencio, y tiene prioridad cuando se acerca el tope diario de correos. Los avisos de la cuenta y de los términos son obligatorios siempre.</p>
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
  const labels: Record<string, string> = Object.fromEntries(notificationCatalog.map(item => [item.type, item.label]));
  const load = () => {
    setError("");
    const query = new URLSearchParams(Object.entries(filters).filter(([, value]) => value));
    api<NonNullable<typeof data>>(`/notifications/log${query.size ? `?${query}` : ""}`).then(setData).catch(cause => setError(message(cause)));
  };
  useEffect(load, [filters.person, filters.type, filters.status]);
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
