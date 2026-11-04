import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import type { AccessPolicy, SecurityEventType } from "@happy-learners/domain";
import { policyLimits, securityEventTypes, securityMethods, securityOutcomes } from "@happy-learners/domain";
import { api, message } from "../api";
import { Link, useNavigation } from "../navigation";
import { useSession } from "../session";
import { formatInstant } from "../regional";
import { useFeedback } from "../ui/feedback";
import { OrganizationTokens } from "./tokens";
import { InstitutionProvider } from "./providers";
import { Icon } from "../ui/icons";
import { EmptyState, ErrorState, Field, Loading, PageHeader, Section, StatusBadge } from "../ui/primitives";
import type { Tone } from "../ui/primitives";

/**
 * Gobierno › Seguridad (REL-007): the security log of the organization (ST-137) with its sealed chain (ST-186), and
 * the audit of critical actions and role changes (ST-068). Administration only (ST-184).
 */
type Event = { id: string; type: SecurityEventType; outcome: keyof typeof securityOutcomes; actorId: string | null; subjectId: string | null; actorName: string | null; subjectName: string | null; method: string | null; detail: string | null; device: string | null; country: string | null; occurredAt: string };
type Chain = { ok: boolean; events: number; head: string; anchor: string; checkedAt: string; brokenAt: { id: string; occurredAt: string } | null; reason?: "event" | "head" };
type Person = { id: string; displayName: string; username: string };
type AuditEvent = { id: string; action: string; targetType: string; targetId: string; summary: string; occurredAt: string; actorName: string };
type RoleChange = { id: string; role: string; active: boolean; occurredAt: string; actorName: string | null; memberName: string | null };
type Filters = { persona: string; tipo: string; desde: string; hasta: string; objeto: string };

const securityTabs = [
  { id: "registro", label: "Registro de seguridad", href: "/seguridad" },
  { id: "auditoria", label: "Auditoría", href: "/seguridad#auditoria" },
  { id: "politicas", label: "Política de acceso", href: "/seguridad#politicas" },
  { id: "proveedor", label: "Proveedor institucional", href: "/seguridad#proveedor" },
  { id: "tokens", label: "Tokens", href: "/seguridad#tokens" },
] as const;
type SecurityTab = (typeof securityTabs)[number]["id"];
const outcomeTone: Record<string, Tone> = { succeeded: "success", failed: "danger", info: "neutral" };
const query = (filters: Partial<Filters>, extra: Record<string, string> = {}) => new URLSearchParams(Object.entries({ ...filters, ...extra }).filter(([, value]) => value)).toString();

export function SecurityPage() {
  const { member } = useSession();
  if (member.role !== "admin") return <><PageHeader title="Seguridad"/><EmptyState icon="shield" title="Esta sección es para administración">El registro de seguridad y la auditoría solo los consulta administración.</EmptyState></>;
  return <Security/>;
}

function Security() {
  const { url } = useNavigation();
  const tab: SecurityTab = securityTabs.find(item => `#${item.id}` === url.hash)?.id || "registro";
  const [people, setPeople] = useState<Person[]>([]);
  useEffect(() => { api<{ members: Person[] }>("/members").then(result => setPeople(result.members), () => setPeople([])); }, []);
  return <>
    <PageHeader title="Seguridad" description="Quién entró, quién falló y qué cambió en los accesos de la organización. Cada evento queda sellado y la cadena se puede verificar."
      actions={<a className="button secondary" href="/api/security/access-review" download><Icon name="download" size={16}/>Revisión de accesos</a>}/>
    <nav className="tabs scrollable-tabs" aria-label="Secciones de seguridad">
      {securityTabs.map(item => <Link key={item.id} href={item.href} className="tab" aria-current={tab === item.id ? "page" : undefined}>{item.label}</Link>)}
    </nav>
    {tab === "registro" ? <SecurityLog people={people}/> : tab === "auditoria" ? <Audit people={people}/> : tab === "tokens" ? <Section title="Tokens de integración"><OrganizationTokens/></Section> : tab === "proveedor" ? <Section title="Proveedor institucional"><InstitutionProvider/></Section> : <Policy/>}
  </>;
}

function PeopleField({ people, value }: { people: Person[]; value: string }) {
  return <Field label="Persona"><select name="persona" defaultValue={value}>
    <option value="">Todas</option>
    {people.map(person => <option key={person.id} value={person.id}>{person.displayName} (@{person.username})</option>)}
  </select></Field>;
}
function DateFields({ filters }: { filters: Filters }) {
  return <><Field label="Desde"><input type="date" name="desde" defaultValue={filters.desde}/></Field><Field label="Hasta"><input type="date" name="hasta" defaultValue={filters.hasta}/></Field></>;
}
const readForm = (event: FormEvent<HTMLFormElement>) => { event.preventDefault(); return Object.fromEntries(new FormData(event.currentTarget)) as unknown as Filters; };
const empty: Filters = { persona: "", tipo: "", desde: "", hasta: "", objeto: "" };

function SecurityLog({ people }: { people: Person[] }) {
  const [filters, setFilters] = useState<Filters>(empty), [events, setEvents] = useState<Event[] | null>(null), [more, setMore] = useState(false);
  const [error, setError] = useState(""), [chain, setChain] = useState<Chain | null>(null), [checking, setChecking] = useState(false);
  const load = async (next: Filters, before?: string) => {
    setError("");
    try {
      const result = await api<{ events: Event[]; more: boolean }>(`/security/events?${query({ persona: next.persona, tipo: next.tipo, desde: next.desde, hasta: next.hasta }, before ? { antes: before } : {})}`);
      setEvents(current => before && current ? [...current, ...result.events] : result.events); setMore(result.more);
    } catch (cause) { setError(message(cause)); }
  };
  useEffect(() => { void load(empty); }, []);
  async function verify() {
    setChecking(true);
    try { setChain((await api<{ chain: Chain }>("/security/chain")).chain); } catch (cause) { setError(message(cause)); }
    setChecking(false);
  }
  const exportHref = `/api/security/events/export?${query({ persona: filters.persona, tipo: filters.tipo, desde: filters.desde, hasta: filters.hasta })}`;
  return <>
    <Section title="Integridad del registro" action={<button type="button" className="button secondary small" onClick={() => void verify()} disabled={checking}><Icon name="shield" size={16}/>{checking ? "Verificando…" : "Verificar la cadena"}</button>}>
      {chain ? <p role="status">{chain.ok
        ? <><StatusBadge tone="success">Íntegro</StatusBadge> {chain.events} eventos verificados el {formatInstant(chain.checkedAt)}. Último sello: <code className="small">{chain.head.slice(0, 16)}…</code></>
        : <><StatusBadge tone="danger">Alterado</StatusBadge> {chain.reason === "head" ? "Faltan los eventos más recientes de la cadena." : `La cadena se rompe en el evento del ${formatInstant(chain.brokenAt?.occurredAt)}.`} Avisa al responsable técnico.</>}</p>
        : <p className="muted small">Cada evento se sella con la huella del anterior. Verificar recalcula toda la cadena: si un evento se cambió, se borró o se agregó por fuera, aparece aquí. Los eventos se conservan 365 días.</p>}
    </Section>
    <Section title="Eventos">
      <form className="class-filters" aria-label="Filtros del registro" onSubmit={event => { const next = readForm(event); setFilters(next); setEvents(null); void load(next); }}>
        <PeopleField people={people} value={filters.persona}/>
        <Field label="Tipo de evento"><select name="tipo" defaultValue={filters.tipo}>
          <option value="">Todos</option>
          {Object.entries(securityEventTypes).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
        </select></Field>
        <DateFields filters={filters}/>
        <div className="button-row"><button className="button primary small">Filtrar</button><a className="button secondary small" href={exportHref} download><Icon name="download" size={16}/>Exportar CSV</a></div>
      </form>
      {error ? <ErrorState error={error} retry={() => void load(filters)}/> : !events ? <Loading label="Cargando el registro…"/> : !events.length
        ? <EmptyState compact icon="shield" title="Sin eventos con estos filtros">Cambia la persona, el tipo o las fechas.</EmptyState>
        : <div className="table-card" role="region" aria-label="Eventos de seguridad" tabIndex={0}><table className="members-table security-table">
          <caption className="sr-only">Eventos de seguridad, del más reciente al más antiguo</caption>
          <thead><tr><th scope="col">Fecha</th><th scope="col">Evento</th><th scope="col">Persona</th><th scope="col">Método</th><th scope="col">Dispositivo</th><th scope="col">Detalle</th></tr></thead>
          <tbody>{events.map(item => <tr key={item.id}>
            <td data-label="Fecha"><time dateTime={item.occurredAt}>{formatInstant(item.occurredAt)}</time></td>
            <td data-label="Evento"><StatusBadge tone={outcomeTone[item.outcome]}>{securityOutcomes[item.outcome]}</StatusBadge> {securityEventTypes[item.type] || item.type}</td>
            <td data-label="Persona">{item.subjectName || <span className="muted">Sin cuenta</span>}{item.actorName && item.actorId !== item.subjectId && <span className="muted small"> · por {item.actorName}</span>}</td>
            <td data-label="Método">{item.method ? securityMethods[item.method] || item.method : <span className="muted">—</span>}</td>
            <td data-label="Dispositivo">{item.device || <span className="muted">—</span>}{item.country && <span className="muted small"> · {item.country}</span>}</td>
            <td data-label="Detalle">{item.detail || <span className="muted">—</span>}</td>
          </tr>)}</tbody>
        </table></div>}
      {more && events && <button type="button" className="button secondary small" onClick={() => void load(filters, events[events.length - 1].occurredAt)}>Ver más antiguos</button>}
      <p className="muted small">El registro no guarda contraseñas, códigos, tokens ni direcciones IP: solo un resumen del dispositivo y el país.</p>
    </Section>
  </>;
}

function Audit({ people }: { people: Person[] }) {
  const [filters, setFilters] = useState<Filters>(empty), [error, setError] = useState("");
  const [data, setData] = useState<{ events: AuditEvent[]; more: boolean; roleChanges: RoleChange[]; objects: Record<string, string> } | null>(null);
  const load = async (next: Filters, before?: string) => {
    setError("");
    try {
      const result = await api<NonNullable<typeof data>>(`/security/audit?${query({ persona: next.persona, objeto: next.objeto, desde: next.desde, hasta: next.hasta }, before ? { antes: before } : {})}`);
      setData(current => before && current ? { ...result, events: [...current.events, ...result.events] } : result);
    } catch (cause) { setError(message(cause)); }
  };
  useEffect(() => { void load(empty); }, []);
  return <>
    <Section title="Acciones críticas">
      <form className="class-filters" aria-label="Filtros de la auditoría" onSubmit={event => { const next = readForm(event); setFilters(next); setData(null); void load(next); }}>
        <PeopleField people={people} value={filters.persona}/>
        <Field label="Objeto"><select name="objeto" defaultValue={filters.objeto}>
          <option value="">Todos</option>
          {Object.entries(data?.objects || {}).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
        </select></Field>
        <DateFields filters={filters}/>
        <div className="button-row"><button className="button primary small">Filtrar</button></div>
      </form>
      {error ? <ErrorState error={error} retry={() => void load(filters)}/> : !data ? <Loading label="Cargando la auditoría…"/> : !data.events.length
        ? <EmptyState compact icon="shield" title="Sin acciones con estos filtros">Cambia la persona, el objeto o las fechas.</EmptyState>
        : <ol className="plain-list access-events">{data.events.map(item => <li key={item.id}><span>{item.summary}</span> <span className="muted small">{data.objects[item.targetType] || item.targetType} · {item.actorName} · <time dateTime={item.occurredAt}>{formatInstant(item.occurredAt)}</time></span></li>)}</ol>}
      {data?.more && <button type="button" className="button secondary small" onClick={() => void load(filters, data.events[data.events.length - 1].occurredAt)}>Ver más antiguas</button>}
    </Section>
    <Section title="Cambios de rol y de acceso">
      {data && (data.roleChanges.length
        ? <ol className="plain-list access-events">{data.roleChanges.map(item => <li key={item.id}><span>{item.memberName || "Cuenta"}: {item.role === "admin" ? "Administración" : "Educador"}, {item.active ? "con acceso" : "sin acceso"}</span> <span className="muted small">{item.actorName || "—"} · <time dateTime={item.occurredAt}>{formatInstant(item.occurredAt)}</time></span></li>)}</ol>
        : <p className="muted">Sin cambios de rol con estos filtros.</p>)}
      <p className="muted small">La auditoría cubre toda la organización y solo la consulta administración. Los permisos de grupos y coordinación están en <Link href="/roles-y-accesos#historial">Roles y accesos › Historial</Link>.</p>
    </Section>
  </>;
}

/** ST-134, ST-130, ST-136: what every password, link and session of the organization follows. */
function Policy() {
  const { toast } = useFeedback();
  const [policy, setPolicy] = useState<AccessPolicy | null>(null), [error, setError] = useState(""), [busy, setBusy] = useState(false);
  const load = async () => { setError(""); try { setPolicy((await api<{ policy: AccessPolicy }>("/security/policy")).policy); } catch (cause) { setError(message(cause)); } };
  useEffect(() => { void load(); }, []);
  if (error && !policy) return <ErrorState error={error} retry={() => void load()}/>;
  if (!policy) return <Loading label="Cargando la política…"/>;
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError("");
    const form = new FormData(event.currentTarget);
    try {
      const result = await api<{ policy: AccessPolicy; changed: boolean }>("/security/policy", "PUT", {
        ...policy, minPasswordLength: Number(form.get("minPasswordLength")), sessionHours: Number(form.get("sessionHours")),
        breachedCheck: form.get("breachedCheck") === "on", linkSignIn: form.get("linkSignIn") === "on", mfaAdmin: form.get("mfaAdmin") === "on", mfaEducator: form.get("mfaEducator") === "on",
      });
      setPolicy(result.policy); toast({ message: result.changed ? "Política de acceso guardada. Queda en el registro de seguridad." : "No había cambios." });
    } catch (cause) { setError(message(cause)); }
    finally { setBusy(false); }
  }
  return <Section title="Política de acceso">
    <form className="stack policy-form" aria-label="Política de acceso" onSubmit={submit}><fieldset className="stack" disabled={busy}>
      {error && <p className="form-alert" role="alert"><Icon name="alert" size={18}/>{error}</p>}
      <Field label="Longitud mínima de las contraseñas" hint={`De ${policyLimits.minPasswordLength[0]} a ${policyLimits.minPasswordLength[1]} caracteres. Se aplica al elegir o cambiar una contraseña.`}>
        <input type="number" name="minPasswordLength" min={policyLimits.minPasswordLength[0]} max={policyLimits.minPasswordLength[1]} defaultValue={policy.minPasswordLength} required/></Field>
      <label className="switch"><input type="checkbox" name="breachedCheck" defaultChecked={policy.breachedCheck}/><span><strong>Rechazar contraseñas filtradas</strong> <span className="muted small">Se compara con las filtraciones conocidas de Have I Been Pwned sin enviar la contraseña: solo los primeros 5 caracteres de su huella SHA-1.</span></span></label>
      <Field label="Duración de las sesiones (horas)" hint={`De ${policyLimits.sessionHours[0]} a ${policyLimits.sessionHours[1]}. Se aplica a las sesiones que se abran desde ahora.`}>
        <input type="number" name="sessionHours" min={policyLimits.sessionHours[0]} max={policyLimits.sessionHours[1]} defaultValue={policy.sessionHours} required/></Field>
      <label className="switch"><input type="checkbox" name="linkSignIn" defaultChecked={policy.linkSignIn}/><span><strong>Permitir entrar con un enlace por correo</strong> <span className="muted small">Enlace de un solo uso que caduca en 15 minutos, solo a cuentas con correo de acceso confirmado.</span></span></label>
      <fieldset className="choice-field"><legend>Exigir la verificación en dos pasos</legend>
        <label className="switch"><input type="checkbox" name="mfaAdmin" defaultChecked={policy.mfaAdmin}/><span>A administración</span></label>
        <label className="switch"><input type="checkbox" name="mfaEducator" defaultChecked={policy.mfaEducator}/><span>A educadores</span></label>
        <p className="muted small">Quien no la tenga la configura en su siguiente solicitud y no puede usar nada más hasta hacerlo. Una passkey cuenta como los dos pasos.</p>
      </fieldset>
      <p className="muted small">Diez intentos fallidos en 15 minutos bloquean la cuenta 15 minutos; recuperar la contraseña la desbloquea. Todo queda en el registro de seguridad.</p>
      <div className="button-row"><button className="button primary">{busy ? "Guardando…" : "Guardar política"}</button></div>
    </fieldset></form>
  </Section>;
}
