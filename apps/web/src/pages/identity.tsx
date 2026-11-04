import { useEffect, useMemo, useState } from "react";
import type { FormEvent, ReactNode } from "react";
import type { ProviderKey } from "@happy-learners/domain";
import { providerNames, securityEventTypes } from "@happy-learners/domain";
import { api, ApiError, message } from "../api";
import { Link, useNavigation } from "../navigation";
import { useSession } from "../session";
import { formatInstant } from "../regional";
import { Drawer, Modal, useFeedback } from "../ui/feedback";
import { Icon } from "../ui/icons";
import type { IconName } from "../ui/icons";
import { EmptyState, ErrorState, Loading, PageHeader, Progress, Section, StatTiles, StatusBadge } from "../ui/primitives";
import type { Tone } from "../ui/primitives";
import { AccessMatrix } from "./access";
import { InstitutionProvider } from "./providers";
import { Audit, Policy, SecurityLog } from "./security";
import { OrganizationTokens } from "./tokens";

/**
 * Gobierno › Identidad y acceso (docs/design/identidad-y-acceso.md §2): one place for who enters, how, with which
 * permissions and what happened, like Entra or Okta, sized for a school. Administration only.
 */
export const identitySections = [
  { id: "resumen", label: "Resumen", icon: "overview" },
  { id: "personas", label: "Personas", icon: "users" },
  { id: "roles", label: "Roles y grupos", icon: "shield" },
  { id: "politicas", label: "Políticas", icon: "settings" },
  { id: "inicio-de-sesion", label: "Inicio de sesión", icon: "link" },
  { id: "integraciones", label: "Integraciones", icon: "grid" },
  { id: "registros", label: "Registros", icon: "list" },
  { id: "revisiones", label: "Revisiones de acceso", icon: "check" },
] as const;
export type IdentitySection = (typeof identitySections)[number]["id"];
export const isIdentitySection = (value: string | undefined): value is IdentitySection => !!value && identitySections.some(item => item.id === value);

export function IdentityHub({ section }: { section: IdentitySection }) {
  const { member } = useSession();
  if (member.role !== "admin") return <><PageHeader title="Identidad y acceso"/><EmptyState icon="shield" title="Esta sección es para administración">Tu propia seguridad está en Mi cuenta › Seguridad.</EmptyState></>;
  const current = identitySections.find(item => item.id === section)!;
  return <div className="account-hub identity-hub">
    <nav className="account-nav" aria-label="Identidad y acceso">
      <p className="account-nav-title">Identidad y acceso</p>
      <ul>{identitySections.map(item => <li key={item.id}>
        <Link href={`/identidad/${item.id}`} className="account-nav-link" aria-current={section === item.id ? "page" : undefined}>
          <Icon name={item.icon as IconName} size={18} filled={section === item.id}/><span>{item.label}</span>
        </Link>
      </li>)}</ul>
    </nav>
    <div className="account-hub-main">
      <PageHeader title={current.label} description={descriptions[section]}/>
      {content(section)}
    </div>
  </div>;
}
const descriptions: Record<IdentitySection, string> = {
  resumen: "Qué tan protegida está la organización y qué hacer primero.",
  personas: "Quién tiene acceso, con qué métodos entra y qué necesita atención.",
  roles: "Qué puede hacer cada rol y cada grupo de seguridad.",
  politicas: "Las reglas que siguen todas las contraseñas, métodos y sesiones.",
  "inicio-de-sesion": "Las cuentas externas con las que se puede entrar.",
  integraciones: "Los tokens que conectan otras herramientas, de solo lectura.",
  registros: "Cada inicio de sesión y cambio de seguridad, sellado y verificable.",
  revisiones: "Confirma persona por persona quién conserva el acceso.",
};
function content(section: IdentitySection): ReactNode {
  switch (section) {
    case "resumen": return <Overview/>;
    case "personas": return <People/>;
    case "roles": return <AccessMatrix base="/identidad/roles" embedded/>;
    case "politicas": return <Policy/>;
    case "inicio-de-sesion": return <SignInMethods/>;
    case "integraciones": return <Section title="Tokens de integración"><OrganizationTokens/></Section>;
    case "registros": return <Logs/>;
    case "revisiones": return <Reviews/>;
  }
}

type Recommendation = { id: string; severity: "high" | "medium" | "low"; title: string; detail: string; count: number; people?: string[]; action: { kind: string; label: string; filter?: string } };
type OverviewData = { score: number; recommendations: Recommendation[]; metrics: Record<string, number>; lastReview: string | null; openReviews: number; provider: { status: string; name: string } | null; sealedAt: string | null };
const severity: Record<Recommendation["severity"], [string, Tone]> = { high: ["Alta", "danger"], medium: ["Media", "warning"], low: ["Baja", "info"] };

/** The score as a ring, with its meaning in words. */
function ScoreRing({ score }: { score: number }) {
  const radius = 52, length = 2 * Math.PI * radius, tone = score >= 80 ? "good" : score >= 50 ? "fair" : "poor";
  return <div className={`score-ring is-${tone}`} role="img" aria-label={`Puntuación de seguridad: ${score} de 100`}>
    <svg viewBox="0 0 120 120" aria-hidden="true"><circle cx="60" cy="60" r={radius} className="score-track"/><circle cx="60" cy="60" r={radius} className="score-value" strokeDasharray={`${length * score / 100} ${length}`} transform="rotate(-90 60 60)"/></svg>
    <span className="score-number">{score}<small>/100</small></span>
  </div>;
}

function Overview() {
  const { toast } = useFeedback();
  const { navigate } = useNavigation();
  const [data, setData] = useState<OverviewData | null>(null), [error, setError] = useState(""), [busy, setBusy] = useState("");
  const load = async () => { setError(""); try { setData(await api<OverviewData>("/identity/overview")); } catch (cause) { setError(message(cause)); } };
  useEffect(() => { void load(); }, []);
  if (error) return <ErrorState error={error} retry={() => void load()}/>;
  if (!data) return <Loading label="Calculando la seguridad de la organización…" cards={3}/>;
  async function act(item: Recommendation) {
    const go: Record<string, string> = { people: `/identidad/personas${item.action.filter ? `?filtro=${item.action.filter}` : ""}`, review: "/identidad/revisiones", provider: "/identidad/inicio-de-sesion", tokens: "/identidad/integraciones", logs: "/identidad/registros" };
    if (item.action.kind !== "policy") { navigate(go[item.action.kind]); return; }
    // The policy recommendations apply in place.
    setBusy(item.id);
    try {
      const { policy } = await api<{ policy: Record<string, unknown> }>("/security/policy");
      await api("/security/policy", "PUT", { ...policy, ...(item.id === "require-mfa-admin" ? { mfaAdmin: true } : { breachedCheck: true }) });
      toast({ message: item.id === "require-mfa-admin" ? "Listo: administración configurará su segundo método en su siguiente acceso." : "Listo: las contraseñas filtradas se rechazan." });
      await load();
    } catch (cause) {
      toast({ tone: "error", message: cause instanceof ApiError && cause.detail.code === "SELF_MFA_FIRST" ? "Primero protege tu propia cuenta con una passkey o una aplicación (Mi cuenta › Seguridad); si no, quedarías sin poder seguir." : message(cause) });
    } finally { setBusy(""); }
  }
  const m = data.metrics;
  return <>
    <div className="posture">
      <ScoreRing score={data.score}/>
      <div className="posture-text">
        <h2>{data.score >= 80 ? "La organización está bien protegida" : data.score >= 50 ? "Hay mejoras importantes por hacer" : "La organización depende de contraseñas"}</h2>
        <p className="muted">La puntuación pesa más a administración, luego cómo entra cada persona, la política y la revisión de accesos. Cada recomendación cumplida la sube.</p>
      </div>
    </div>
    <StatTiles items={[
      { label: "Personas con acceso", value: m.people, icon: "users", hue: "violet" }, { label: "Con passkey", value: m.passkeys, icon: "shield", hue: "green" },
      { label: "Con aplicación de autenticación", value: m.mfa, icon: "clock", hue: "sky" }, { label: "Solo contraseña", value: m.passwordOnly, icon: "alert", hue: "amber" },
      { label: "Inicios en 24 h", value: m.signIns24h, icon: "check", hue: "teal" }, { label: "Fallos en 24 h", value: m.failed24h, icon: "alert", hue: "coral" },
    ]}/>
    <Section title={data.recommendations.length ? `Recomendaciones (${data.recommendations.length})` : "Recomendaciones"}>
      {data.recommendations.length ? <ul className="recommendations">{data.recommendations.map(item => <li key={item.id} className={`recommendation is-${item.severity}`}>
        <div className="recommendation-text">
          <span className="recommendation-title"><StatusBadge tone={severity[item.severity][1]}>{severity[item.severity][0]}</StatusBadge><strong>{item.title}</strong></span>
          <p className="muted small">{item.detail}</p>
          {item.people?.length ? <p className="small">{item.people.join(", ")}{item.count > item.people.length ? ` y ${item.count - item.people.length} más` : ""}</p> : null}
        </div>
        <button type="button" className={item.severity === "high" ? "button primary small" : "button secondary small"} disabled={busy === item.id} onClick={() => void act(item)}>{busy === item.id ? "Aplicando…" : item.action.label}</button>
      </li>)}</ul> : <EmptyState compact icon="shield" title="Nada pendiente">La organización cumple todas las recomendaciones.</EmptyState>}
    </Section>
  </>;
}

type PersonRow = {
  id: string; username: string; name: string; email: string | null; role: "admin" | "educator"; active: boolean; strength: "phishing-resistant" | "mfa" | "password";
  methods: { mfa: boolean; passkeys: number; providers: ProviderKey[]; recoveryLeft: number }; lastSignIn: string | null; failed7: number; sessions: number; tokens: number; groups: string[]; risks: string[];
};
const strengthLabel: Record<PersonRow["strength"], [string, Tone]> = { "phishing-resistant": ["Passkey", "success"], mfa: ["Dos pasos", "info"], password: ["Solo contraseña", "warning"] };
const riskLabel: Record<string, string> = { "admin-without-mfa": "Administración sin segundo método", "mfa-required-missing": "Falta el método exigido", "failed-sign-ins": "Intentos fallidos", inactive: "Inactiva 90 días", "temporary-password": "Contraseña temporal" };
const filters = [
  { id: "", label: "Todas" }, { id: "risk", label: "Con atención" }, { id: "password-only", label: "Solo contraseña" }, { id: "admin", label: "Administración" },
  { id: "admin-without-mfa", label: "Administración sin segundo método" }, { id: "failed-sign-ins", label: "Intentos fallidos" }, { id: "mfa-required-missing", label: "Falta el método exigido" }, { id: "inactive", label: "Inactivas" }, { id: "no-access", label: "Sin acceso" },
];
const matches = (person: PersonRow, filter: string) => !filter ? true : filter === "risk" ? person.risks.length > 0 : filter === "password-only" ? person.active && person.strength === "password"
  : filter === "admin" ? person.role === "admin" : filter === "no-access" ? !person.active : person.risks.includes(filter);

function People() {
  const { url, navigate } = useNavigation();
  const [list, setList] = useState<PersonRow[] | null>(null), [error, setError] = useState(""), [query, setQuery] = useState(""), [revision, setRevision] = useState(0);
  const filter = url.searchParams.get("filtro") || "", open = url.searchParams.get("persona");
  useEffect(() => { api<{ people: PersonRow[] }>("/identity/people").then(result => setList(result.people), cause => setError(message(cause))); }, [revision]);
  const visible = useMemo(() => (list || []).filter(person => matches(person, filter) && (!query.trim() || `${person.name} ${person.username} ${person.email || ""}`.toLowerCase().includes(query.trim().toLowerCase()))), [list, filter, query]);
  if (error) return <ErrorState error={error} retry={() => setRevision(value => value + 1)}/>;
  if (!list) return <Loading label="Cargando personas…"/>;
  const params = (next: Record<string, string | null>) => { const search = new URLSearchParams(url.search); for (const [key, value] of Object.entries(next)) value ? search.set(key, value) : search.delete(key); return `/identidad/personas${search.toString() ? `?${search}` : ""}`; };
  return <>
    <div className="class-filters">
      <div className="field"><label htmlFor="people-search">Buscar</label><input id="people-search" type="search" value={query} onChange={event => setQuery(event.target.value)} placeholder="Nombre, usuario o correo"/></div>
      <div className="field"><label htmlFor="people-filter">Mostrar</label><select id="people-filter" value={filter} onChange={event => navigate(params({ filtro: event.target.value || null }), true)}>{filters.map(item => <option key={item.id} value={item.id}>{item.label} ({list.filter(person => matches(person, item.id)).length})</option>)}</select></div>
    </div>
    {visible.length ? <div className="table-card" role="region" aria-label="Personas y su acceso" tabIndex={0}><table className="members-table identity-table">
      <caption className="sr-only">Personas, su rol, cómo entran y qué necesita atención</caption>
      <thead><tr><th scope="col">Persona</th><th scope="col">Rol</th><th scope="col">Cómo entra</th><th scope="col">Último acceso</th><th scope="col">Atención</th></tr></thead>
      <tbody>{visible.map(person => <tr key={person.id}>
        <th scope="row"><button type="button" className="link-button" onClick={() => navigate(params({ persona: person.id }))}>{person.name}</button><br/><span className="muted small">@{person.username}{person.active ? "" : " · sin acceso"}</span></th>
        <td data-label="Rol">{person.role === "admin" ? "Administración" : "Educador"}</td>
        <td data-label="Cómo entra"><StatusBadge tone={strengthLabel[person.strength][1]}>{strengthLabel[person.strength][0]}</StatusBadge>{person.methods.providers.length > 0 && <span className="muted small"> · {person.methods.providers.map(key => providerNames[key]).join(", ")}</span>}</td>
        <td data-label="Último acceso">{person.lastSignIn ? formatInstant(person.lastSignIn) : <span className="muted">Nunca</span>}</td>
        <td data-label="Atención">{person.risks.length ? person.risks.map(risk => <StatusBadge key={risk} tone={risk === "admin-without-mfa" || risk === "failed-sign-ins" ? "danger" : "warning"}>{riskLabel[risk]}</StatusBadge>) : <span className="muted">—</span>}</td>
      </tr>)}</tbody>
    </table></div> : <EmptyState compact icon="users" title="Nadie con este filtro">Cambia el filtro o la búsqueda.</EmptyState>}
    {open && <PersonPanel id={open} onClose={() => navigate(params({ persona: null }), true)} onChanged={() => setRevision(value => value + 1)}/>}
  </>;
}

type PersonDetail = PersonRow & {
  passkeys: { id: string; name: string; createdAt: string; lastUsedAt: string | null; synced: boolean }[]; identities: { provider: ProviderKey; email: string | null; linkedAt: string }[];
  tokens: { id: string; name: string; expiresAt: string; lastUsedAt: string | null }[]; sessions: { id: string; device: string | null; country: string | null; method: string; lastUsedAt: string }[];
  events: { id: string; type: string; outcome: string; method: string | null; detail: string | null; device: string | null; occurredAt: string }[]; coordination: string | null;
};
/** One person's whole picture, with every security action administration can take on it. */
function PersonPanel({ id, onClose, onChanged }: { id: string; onClose: () => void; onChanged: () => void }) {
  const { toast, confirm } = useFeedback();
  const { member } = useSession();
  const [person, setPerson] = useState<PersonDetail | null>(null), [error, setError] = useState(""), [issued, setIssued] = useState<string | null>(null), [busy, setBusy] = useState("");
  const load = async () => { try { setPerson((await api<{ person: PersonDetail }>(`/identity/people/${id}`)).person); } catch (cause) { setError(message(cause)); } };
  useEffect(() => { void load(); }, [id]);
  async function act(key: string, question: { title: string; body: string; confirm: string }, work: () => Promise<unknown>, done: string) {
    if (!await confirm({ ...question, danger: true })) return;
    setBusy(key);
    try { await work(); toast({ message: done }); await load(); onChanged(); } catch (cause) { toast({ tone: "error", message: message(cause) }); }
    finally { setBusy(""); }
  }
  const self = id === member.id, owner = id === "user-0";
  return <Drawer title={person ? person.name : "Persona"} onClose={onClose} wide>
    {error ? <ErrorState error={error} retry={() => void load()}/> : !person ? <Loading label="Cargando…" lines={6}/> : <div className="stack person-panel">
      <div className="person-panel-head">
        <span className="muted">@{person.username}{person.email ? ` · ${person.email}` : ""}</span>
        <span className="badges"><StatusBadge tone={person.active ? "success" : "neutral"}>{person.active ? "Con acceso" : "Sin acceso"}</StatusBadge><StatusBadge>{person.role === "admin" ? "Administración" : "Educador"}</StatusBadge><StatusBadge tone={strengthLabel[person.strength][1]}>{strengthLabel[person.strength][0]}</StatusBadge></span>
        {person.risks.length > 0 && <p className="small">{person.risks.map(risk => riskLabel[risk]).join(" · ")}</p>}
      </div>
      <Section title="Métodos de inicio de sesión">
        <ul className="method-list">
          {person.passkeys.map(item => <li key={item.id} className="method-row"><span className="method-icon" aria-hidden="true"><Icon name="shield" size={18}/></span><span className="method-text"><strong>{item.name}</strong><span className="muted small">Passkey · creada el {formatInstant(item.createdAt)}{item.lastUsedAt ? ` · usada el ${formatInstant(item.lastUsedAt)}` : ""}</span></span></li>)}
          {person.methods.mfa && <li className="method-row"><span className="method-icon" aria-hidden="true"><Icon name="clock" size={18}/></span><span className="method-text"><strong>Aplicación de autenticación</strong><span className="muted small">{person.methods.recoveryLeft} códigos de recuperación sin usar</span></span>
            {!self && <button type="button" className="button ghost small" disabled={!!busy} onClick={() => void act("mfa", { title: `¿Restablecer la verificación en dos pasos de ${person.name}?`, body: "Su aplicación y sus códigos dejan de funcionar y sus sesiones se cierran. Hazlo solo si confirmaste que es la persona.", confirm: "Restablecer" }, () => api(`/security/people/${id}/mfa`, "DELETE"), "Verificación restablecida.")}>Restablecer</button>}</li>}
          {person.identities.map(item => <li key={item.provider} className="method-row"><span className="method-icon" aria-hidden="true"><Icon name="link" size={18}/></span><span className="method-text"><strong>{providerNames[item.provider]}</strong><span className="muted small">{item.email || "Cuenta vinculada"} · desde el {formatInstant(item.linkedAt)}</span></span>
            <button type="button" className="button ghost small" disabled={!!busy} onClick={() => void act(item.provider, { title: `¿Desvincular ${providerNames[item.provider]}?`, body: "Ya no podrá entrar con esa cuenta.", confirm: "Desvincular" }, () => api(`/security/people/${id}/identities/${item.provider}`, "DELETE"), "Cuenta desvinculada.")}>Desvincular</button></li>)}
          <li className="method-row"><span className="method-icon" aria-hidden="true"><Icon name="text" size={18}/></span><span className="method-text"><strong>Contraseña</strong><span className="muted small">{person.risks.includes("temporary-password") ? "Temporal, sin cambiar todavía" : "Elegida por la persona"}</span></span>
            {!self && !owner && <button type="button" className="button ghost small" disabled={!!busy} onClick={() => void act("password", { title: `¿Restablecer la contraseña de ${person.name}?`, body: "Su contraseña deja de funcionar y sus sesiones se cierran. Recibirás una temporal para entregarle.", confirm: "Restablecer" }, async () => setIssued((await api<{ temporaryPassword: string }>(`/members/${id}/password`, "POST")).temporaryPassword), "Contraseña restablecida.")}>Restablecer</button>}</li>
        </ul>
        {issued && <p className="panel" role="status">Contraseña temporal para entregar una sola vez: <code>{issued}</code></p>}
      </Section>
      <Section title={`Sesiones abiertas (${person.sessions.length})`} action={!self && person.sessions.length > 0 && <button type="button" className="button secondary small" disabled={!!busy} onClick={() => void act("sessions", { title: `¿Cerrar las sesiones de ${person.name}?`, body: "Sale de todos sus dispositivos; su contraseña y sus accesos no cambian.", confirm: "Cerrar sesiones" }, () => api(`/security/people/${id}/sessions`, "DELETE"), "Sesiones cerradas.")}><Icon name="logout" size={16}/>Cerrar todas</button>}>
        {person.sessions.length ? <ul className="plain-list">{person.sessions.map(item => <li key={item.id}>{item.device || "Dispositivo sin identificar"}{item.country ? ` · ${item.country}` : ""} <span className="muted small">· último uso {formatInstant(item.lastUsedAt)}</span></li>)}</ul> : <p className="muted">No tiene sesiones abiertas.</p>}
      </Section>
      <Section title="Roles y grupos" action={<Link href="/identidad/roles#grupos" className="section-link">Grupos</Link>}>
        <p>{person.role === "admin" ? "Administración: todos los accesos." : "Educador"}{person.coordination ? ` · coordinación ${person.coordination === "*" ? "de todos los programas" : "de algunos programas"}` : ""}{person.groups.length ? ` · grupos: ${person.groups.join(", ")}` : ""}</p>
        {person.tokens.length > 0 && <p className="small">{person.tokens.length === 1 ? "1 token de integración activo" : `${person.tokens.length} tokens de integración activos`} · <Link href="/identidad/integraciones">Ver</Link></p>}
      </Section>
      <Section title="Actividad de seguridad" action={<Link href={`/identidad/registros?persona=${id}`} className="section-link">Ver todo</Link>}>
        {person.events.length ? <ol className="plain-list access-events">{person.events.slice(0, 12).map(item => <li key={item.id}><span><StatusBadge tone={item.outcome === "failed" ? "danger" : item.outcome === "succeeded" ? "success" : "neutral"}>{item.outcome === "failed" ? "Fallido" : item.outcome === "succeeded" ? "Correcto" : "Registro"}</StatusBadge> {securityEventTypes[item.type as keyof typeof securityEventTypes] || item.type}</span> <span className="muted small">{item.detail ? `${item.detail} · ` : ""}{formatInstant(item.occurredAt)}</span></li>)}</ol> : <p className="muted">Sin actividad.</p>}
      </Section>
    </div>}
  </Drawer>;
}

function SignInMethods() {
  const [providers, setProviders] = useState<ProviderKey[] | null>(null);
  useEffect(() => { api<{ providers: ProviderKey[] }>("/login/providers").then(result => setProviders(result.providers), () => setProviders([])); }, []);
  const card = (key: ProviderKey, note: string) => <li key={key} className="provider-card"><span className="method-icon" aria-hidden="true"><Icon name="link" size={20}/></span>
    <span className="method-text"><strong>{providerNames[key]}</strong><span className="muted small">{note}</span></span>
    <StatusBadge tone={providers?.includes(key) ? "success" : "neutral"}>{providers?.includes(key) ? "Disponible" : "Sin configurar"}</StatusBadge></li>;
  return <>
    <Section title="Formas de entrar del equipo">
      <ul className="method-list">
        <li className="provider-card"><span className="method-icon" aria-hidden="true"><Icon name="shield" size={20}/></span><span className="method-text"><strong>Passkeys</strong><span className="muted small">Huella, rostro o PIN del dispositivo. Siempre disponibles; cuentan como dos factores.</span></span><StatusBadge tone="success">Disponible</StatusBadge></li>
        {card("google", "Cuentas de Google o Google Workspace vinculadas por cada persona.")}
        {card("microsoft", "Cuentas personales o de Microsoft 365 vinculadas por cada persona.")}
        {card("apple", "Requiere una cuenta de pago de Apple Developer.")}
      </ul>
      <p className="muted small">Google, Microsoft y Apple se activan cuando el responsable de la plataforma registra la aplicación en cada proveedor (guía en la documentación de seguridad). Cada persona vincula su cuenta desde Mi cuenta › Seguridad.</p>
    </Section>
    <Section title="Proveedor de la institución"><InstitutionProvider/></Section>
  </>;
}

function Logs() {
  const { url } = useNavigation();
  const tab = url.hash === "#auditoria" ? "auditoria" : "registro";
  return <>
    <nav className="tabs scrollable-tabs" aria-label="Registros">
      <Link href={`/identidad/registros${url.search}`} className="tab" aria-current={tab === "registro" ? "page" : undefined}>Inicios y seguridad</Link>
      <Link href="/identidad/registros#auditoria" className="tab" aria-current={tab === "auditoria" ? "page" : undefined}>Auditoría</Link>
    </nav>
    {tab === "registro" ? <SecurityLog people={[]} initialPerson={url.searchParams.get("persona") || ""}/> : <Audit people={[]}/>}
  </>;
}

type Review = { id: string; name: string; status: "open" | "completed" | "cancelled"; dueOn: string; createdAt: string; completedAt: string | null; createdBy: string; total: number; decided: number; removed: number };
type ReviewItem = { userId: string; role: string; decision: "keep" | "remove" | null; note: string | null; decidedAt: string | null; decidedBy: string | null; appliedAt: string | null; person: PersonRow | null };
function Reviews() {
  const { url, navigate } = useNavigation();
  const [list, setList] = useState<Review[] | null>(null), [error, setError] = useState(""), [creating, setCreating] = useState(false), [revision, setRevision] = useState(0);
  const open = url.searchParams.get("revision");
  useEffect(() => { api<{ reviews: Review[] }>("/identity/reviews").then(result => setList(result.reviews), cause => setError(message(cause))); }, [revision]);
  if (open) return <ReviewDetail id={open} onBack={() => { navigate("/identidad/revisiones"); setRevision(value => value + 1); }}/>;
  if (error) return <ErrorState error={error} retry={() => setRevision(value => value + 1)}/>;
  if (!list) return <Loading label="Cargando revisiones…"/>;
  const current = list.find(item => item.status === "open");
  return <>
    <div className="hub-section-head"><p className="muted">Cada persona con acceso se confirma o se le quita. Al completar la revisión, los accesos marcados para quitar terminan y todo queda en los registros. Se recomienda cada 90 días.</p>
      {!current && <button type="button" className="button primary" onClick={() => setCreating(true)}><Icon name="plus" size={16}/>Iniciar revisión</button>}</div>
    {list.length ? <ul className="review-list">{list.map(item => <li key={item.id} className="panel">
      <div><strong><Link href={`/identidad/revisiones?revision=${item.id}`}>{item.name}</Link></strong> <StatusBadge tone={item.status === "open" ? "info" : item.status === "completed" ? "success" : "neutral"}>{item.status === "open" ? "Abierta" : item.status === "completed" ? "Completada" : "Cancelada"}</StatusBadge>
        <p className="muted small">{item.status === "completed" ? `Completada el ${formatInstant(item.completedAt)} · ${item.removed === 1 ? "1 acceso retirado" : `${item.removed} accesos retirados`}` : `Fecha límite ${item.dueOn} · iniciada por ${item.createdBy}`}</p></div>
      <Progress value={item.decided} max={item.total} label={`${item.decided} de ${item.total} decididas`}/>
    </li>)}</ul> : <EmptyState icon="check" title="Aún no hay revisiones" action={<button type="button" className="button primary" onClick={() => setCreating(true)}>Iniciar la primera</button>}>Confirma quién conserva el acceso a la plataforma.</EmptyState>}
    {creating && <NewReview onClose={() => setCreating(false)} onCreated={id => { setCreating(false); navigate(`/identidad/revisiones?revision=${id}`); }}/>}
  </>;
}
function NewReview({ onClose, onCreated }: { onClose: () => void; onCreated: (id: string) => void }) {
  const month = new Intl.DateTimeFormat("es", { month: "long", year: "numeric" }).format(new Date());
  const due = new Date(Date.now() + 14 * 86400000).toISOString().slice(0, 10);
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError("");
    const form = Object.fromEntries(new FormData(event.currentTarget)) as Record<string, string>;
    try { onCreated((await api<{ id: string }>("/identity/reviews", "POST", { name: form.name, dueOn: form.dueOn })).id); } catch (cause) { setError(message(cause)); setBusy(false); }
  }
  return <Modal title="Iniciar una revisión de accesos" onClose={onClose}><form className="stack" onSubmit={submit}><fieldset className="stack" disabled={busy}>
    {error && <p className="form-alert" role="alert"><Icon name="alert" size={18}/>{error}</p>}
    <div className="field"><label htmlFor="review-name">Nombre</label><input id="review-name" name="name" required minLength={2} maxLength={80} defaultValue={`Revisión de ${month}`}/></div>
    <div className="field"><label htmlFor="review-due">Fecha límite</label><input id="review-due" name="dueOn" type="date" required defaultValue={due}/></div>
    <p className="muted small">Incluye a todas las personas que hoy tienen acceso.</p>
    <div className="button-row modal-actions"><button type="button" className="button ghost" onClick={onClose}>Cancelar</button><button className="button primary">{busy ? "Iniciando…" : "Iniciar"}</button></div>
  </fieldset></form></Modal>;
}
function ReviewDetail({ id, onBack }: { id: string; onBack: () => void }) {
  const { toast, confirm } = useFeedback();
  const { member } = useSession();
  const [review, setReview] = useState<(Review & { items: ReviewItem[] }) | null>(null), [error, setError] = useState(""), [busy, setBusy] = useState("");
  const load = async () => { try { setReview((await api<{ review: Review & { items: ReviewItem[] } }>(`/identity/reviews/${id}`)).review); } catch (cause) { setError(message(cause)); } };
  useEffect(() => { void load(); }, [id]);
  if (error) return <ErrorState error={error} retry={() => void load()}/>;
  if (!review) return <Loading label="Cargando la revisión…"/>;
  const decided = review.items.filter(item => item.decision).length, removals = review.items.filter(item => item.decision === "remove").length, editable = review.status === "open";
  async function decide(item: ReviewItem, decision: "keep" | "remove") {
    setBusy(item.userId);
    try { await api(`/identity/reviews/${id}/items/${item.userId}`, "PUT", { decision: item.decision === decision ? null : decision }); await load(); } catch (cause) { toast({ tone: "error", message: message(cause) }); }
    finally { setBusy(""); }
  }
  async function complete() {
    if (!await confirm({ title: `¿Completar «${review!.name}»?`, body: removals ? `${removals === 1 ? "Se quitará el acceso a 1 persona" : `Se quitará el acceso a ${removals} personas`}: sus sesiones, tokens y enlace de calendario terminan. Lo que hicieron se conserva.` : "Todas las personas conservan su acceso.", confirm: "Completar", danger: removals > 0 })) return;
    setBusy("complete");
    try { const result = await api<{ removed: number }>(`/identity/reviews/${id}/complete`, "POST"); toast({ message: `Revisión completada${result.removed ? `: ${result.removed === 1 ? "1 acceso retirado" : `${result.removed} accesos retirados`}` : ""}.` }); await load(); }
    catch (cause) { toast({ tone: "error", message: message(cause) }); }
    finally { setBusy(""); }
  }
  return <>
    <div className="hub-section-head"><div><button type="button" className="link-button" onClick={onBack}>← Revisiones</button><h2>{review.name}</h2><p className="muted small">{editable ? `Fecha límite ${review.dueOn}` : `Completada el ${formatInstant(review.completedAt)}`}</p></div>
      {editable && <button type="button" className="button primary" disabled={decided < review.items.length || busy === "complete"} onClick={() => void complete()}>{busy === "complete" ? "Completando…" : "Completar revisión"}</button>}</div>
    <Progress value={decided} max={review.items.length} label={`${decided} de ${review.items.length} decididas${removals ? ` · ${removals} por quitar` : ""}`}/>
    {editable && <div className="button-row"><button type="button" className="button secondary small" disabled={!!busy} onClick={() => void Promise.all(review.items.filter(item => !item.decision).map(item => api(`/identity/reviews/${id}/items/${item.userId}`, "PUT", { decision: "keep" }))).then(load)}>Mantener a quienes faltan</button></div>}
    <div className="table-card" role="region" aria-label="Personas de la revisión" tabIndex={0}><table className="members-table identity-table">
      <caption className="sr-only">Cada persona con su acceso y la decisión</caption>
      <thead><tr><th scope="col">Persona</th><th scope="col">Último acceso</th><th scope="col">Cómo entra</th><th scope="col">Decisión</th></tr></thead>
      <tbody>{review.items.map(item => <tr key={item.userId}>
        <th scope="row">{item.person?.name || item.userId}<br/><span className="muted small">{item.role === "admin" ? "Administración" : "Educador"}{item.person?.risks.includes("inactive") ? " · inactiva 90 días" : ""}</span></th>
        <td data-label="Último acceso">{item.person?.lastSignIn ? formatInstant(item.person.lastSignIn) : <span className="muted">Nunca</span>}</td>
        <td data-label="Cómo entra">{item.person ? <StatusBadge tone={strengthLabel[item.person.strength][1]}>{strengthLabel[item.person.strength][0]}</StatusBadge> : "—"}</td>
        <td data-label="Decisión">{editable ? <div className="segmented" role="group" aria-label={`Decisión sobre ${item.person?.name || item.userId}`}>
          <button type="button" aria-pressed={item.decision === "keep"} disabled={busy === item.userId} onClick={() => void decide(item, "keep")}>Mantener</button>
          <button type="button" aria-pressed={item.decision === "remove"} disabled={busy === item.userId || item.userId === member.id || item.userId === "user-0"} onClick={() => void decide(item, "remove")}>Quitar acceso</button>
        </div> : <StatusBadge tone={item.decision === "remove" ? "warning" : "success"}>{item.decision === "remove" ? "Acceso retirado" : "Mantenido"}</StatusBadge>}</td>
      </tr>)}</tbody>
    </table></div>
  </>;
}
