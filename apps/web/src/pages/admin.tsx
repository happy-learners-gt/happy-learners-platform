import { useEffect, useMemo, useState } from "react";
import type { FormEvent, ReactNode } from "react";
import type { AcademicProfile, Contract, ContractPhase, CourseFormat, EffectivePreferences, CourseSettings, EducationLevel, EducationType, Member, Modality, OnboardingPerson, Organization, Pacing, StudyProgram, Taxonomy, TaxonomyTerm, Vocabulary } from "@happy-learners/contracts";
import { accountInput, areaLabel, contractPhaseLabels, courseFormats, coursePresets, derivedSettings, educationLevels, educationTypes, knowledgeAreas, labelOf, modalities, pacings, settingChoices, settingDefinitions, settingText, settingValue, suggestedLocales, timezoneGroups, utcOffset } from "@happy-learners/domain";
import { incorporationSteps } from "@happy-learners/domain";
import type { FreedomPolicy, SettingKey } from "@happy-learners/domain";
import { plural } from "../model";
import { Avatar } from "../ui/progress";
import { api, message } from "../api";
import { Link, useNavigation, useUnsavedChanges } from "../navigation";
import { useSession } from "../session";
import { Modal, useFeedback } from "../ui/feedback";
import { Icon } from "../ui/icons";
import { Menu } from "../ui/Menu";
import { GradingSchemes, schemeOptions, useGradingSchemes } from "./grading/Schemes";
import { EmptyState, ErrorState, Field, Loading, PageHeader, PrimaryAction, Section, StatusBadge } from "../ui/primitives";
import { FreedomChangeDialog, FreedomPolicyField } from "../ui/freedom";
import type { Tone } from "../ui/primitives";
import { CalendarSummary } from "./institutional-calendar";
import { CurriculumPackages } from "./curriculum-packages";
import { ProgramPathDialog } from "./programPath";
import { DepartureDialog, departureDay } from "./departure";
import { Invitations } from "./invitations";
import { ClosureRequests } from "./account";
import { ExpiringDocuments, PersonDetail } from "./profile";
import { CoordinationBadge, CoordinationDialog } from "./access";
import { OnboardingBadge, OnboardingFilter, useOnboardingPeople } from "./onboarding";
import type { OnboardingPersonStatus, ProfileReviewQueue } from "@happy-learners/contracts";
import { currentRegional } from "../regional";
import { localeLabel } from "./preferences";

function AdminOnly({ title, children }: { title: string; children: ReactNode }) {
  const { member } = useSession();
  if (member.role !== "admin") return <><PageHeader title={title}/><EmptyState icon="shield" title="Esta sección es para administración">Tu cuenta prepara cursos y lecciones. Pide a administración cualquier cambio de organización o permisos.</EmptyState></>;
  return <>{children}</>;
}

export function OrganizationSettings() {
  return <AdminOnly title="Organización"><OrganizationForm/></AdminOnly>;
}
function OrganizationForm() {
  const { organization, setOrganization, setPreferences } = useSession();
  const { guard } = useNavigation();
  const { toast } = useFeedback();
  const [dirty, setDirty] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState("");
  const [zone, setZone] = useState(organization?.timezone || "America/Guatemala");
  const zones = useMemo(() => timezoneGroups(organization?.timezone), [organization?.timezone]);
  useUnsavedChanges(dirty);
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError("");
    try {
      const result = await api<{ organization: Organization }>("/organization", "PUT", Object.fromEntries(new FormData(event.currentTarget))); setDirty(false); guard(false); setOrganization(result.organization);
      // ST-160: whoever follows the organization's zone or format sees the change at once, starting with this person.
      setPreferences((await api<{ preferences: EffectivePreferences }>("/me/preferences")).preferences);
      toast({ message: "Organización guardada." });
    }
    catch (cause) { setError(message(cause)); }
    finally { setBusy(false); }
  }
  return <>
    <PageHeader title="Organización" description="Nombre, zona, formato regional y respaldo. El año escolar se prepara en Calendario institucional."/>
    <div className="form-sheet account-cards">
    <form className="panel" onSubmit={save} onChange={() => setDirty(true)}>
      {error && <p className="form-alert" role="alert"><Icon name="alert" size={18}/>{error}</p>}
      <fieldset disabled={busy} className="stack">
        <div className="form-grid-12">
          <div className="form-span-6"><Field label="Nombre de la organización" hint="En la demostración usa un nombre ficticio."><input name="name" required minLength={3} maxLength={80} defaultValue={organization?.name || ""}/></Field></div>
          <div className="form-span-4"><Field label="Zona horaria" hint={`Hora local: ${new Intl.DateTimeFormat(currentRegional().locale, { timeZone: zone, hour: "numeric", minute: "2-digit", hourCycle: currentRegional().hourCycle }).format(new Date())} (${utcOffset(zone)}).`}>
            <select name="timezone" value={zone} onChange={event => setZone(event.target.value)}>
              {zones.map(group => <optgroup key={group.region} label={group.region}>{group.zones.map(item => <option key={item.id} value={item.id}>{item.id} ({item.offset})</option>)}</optgroup>)}
            </select>
          </Field></div>
          <div className="form-span-4"><Field label="Formato regional" hint="Fechas, horas y números de quien no elige otro formato.">
            <select name="locale" defaultValue={organization?.locale || "es"}>
              {[...new Set([organization?.locale || "es", ...suggestedLocales])].filter(tag => { try { return Intl.DateTimeFormat.supportedLocalesOf([tag]).length > 0; } catch { return false; } }).map(tag => <option key={tag} value={tag}>{localeLabel(tag)}</option>)}
            </select>
          </Field></div>
        </div>
        <div className="form-actions"><button className="button primary">{busy ? "Guardando…" : "Guardar organización"}</button></div>
      </fieldset>
    </form>
    {/* CAL-01: the school year, its periods and the class schedules moved to Calendario institucional. */}
    <CalendarSummary/>
    <Section title="Respaldo" action={<a className="button secondary small" href="/api/organization/backup" download><Icon name="download" size={16}/>Descargar respaldo</a>}>
      <p className="muted">Una copia en JSON de los cursos, las lecciones, las secciones, el calendario y los registros de la organización. No incluye contraseñas, sesiones ni el contenido de los documentos subidos. Guárdala en un lugar privado: contiene los nombres de los estudiantes.</p>
    </Section>
    </div>
  </>;
}

export function Members() {
  return <AdminOnly title="Educadores"><MemberList/></AdminOnly>;
}
type MemberStats = Member & { leads: number; coTeaches: number; sections: number; lessonsCreated: number; publications: number; attendance: number; events: number; lastActivity: string | null; departedOn?: string };
const educatorTabs = [
  { id: "personas", label: "Personas", href: "/educadores" },
  { id: "invitaciones", label: "Invitaciones", href: "/educadores#invitaciones" },
  { id: "contratos", label: "Contratos", href: "/contratos#contratos" },
  { id: "incorporacion", label: "Incorporación", href: "/educadores#incorporacion" },
  { id: "cierres", label: "Cierres de cuenta", href: "/educadores#cierres" },
  { id: "documentos", label: "Documentos por vencer", href: "/educadores#documentos" },
] as const;
type EducatorTab = Exclude<(typeof educatorTabs)[number]["id"], "contratos">;
const educatorTabOf = (hash: string): EducatorTab => ({
  "": "personas", "#personas": "personas", "#invitaciones": "invitaciones", "#incorporacion": "incorporacion", "#cierres": "cierres", "#documentos": "documentos",
} as const)[hash] || "personas";
const contractTone: Record<ContractPhase, Tone> = {
  draft: "neutral", "awaiting-signature": "warning", scheduled: "info", "in-force": "success", ending: "warning",
  expired: "neutral", declined: "danger", voided: "neutral", terminated: "neutral", superseded: "neutral",
};
const contractRank: Record<ContractPhase, number> = {
  "in-force": 0, ending: 1, "awaiting-signature": 2, scheduled: 3, draft: 4, expired: 5, terminated: 6, declined: 7, voided: 8, superseded: 9,
};
function currentContractOf(contracts: Contract[], userId: string) {
  return contracts.filter(item => item.userId === userId).sort((a, b) => contractRank[a.phase] - contractRank[b.phase] || b.createdAt.localeCompare(a.createdAt))[0];
}
function loadLabel(member: Pick<MemberStats, "leads" | "coTeaches" | "sections">) {
  const courses = (member.leads || 0) + (member.coTeaches || 0);
  const summary = `${courses === 1 ? "1 curso" : `${courses} cursos`} · ${member.sections === 1 ? "1 sección" : `${member.sections || 0} secciones`}`;
  const detail = [member.leads ? `responsable de ${member.leads}` : "", member.coTeaches ? `colabora en ${member.coTeaches}` : ""].filter(Boolean).join(" · ");
  return { summary: courses || member.sections ? summary : "", detail };
}

/** People of the organization, split into tabs so the page stays one screen tall. */
function MemberList() {
  const { toast, confirm } = useFeedback();
  const { url, navigate } = useNavigation();
  const [members, setMembers] = useState<MemberStats[] | null>(null), [error, setError] = useState(""), [busy, setBusy] = useState("");
  const [adding, setAdding] = useState(false), [inviting, setInviting] = useState(false), [issued, setIssued] = useState<Issued | null>(null), [revision, setRevision] = useState(0);
  const [leaving, setLeaving] = useState<{ id: string; name: string } | null>(null), { member: me } = useSession();
  // PPL-01: the name and «Perfil y expediente» open the profile; the incorporation column and tab open the incorporation.
  const [detail, setDetail] = useState<{ id: string; name: string; tab?: "incorporation" } | null>(null);
  const [coordinating, setCoordinating] = useState<MemberStats | null>(null);
  const [contracts, setContracts] = useState<Contract[]>([]), [pendingProfiles, setPendingProfiles] = useState<ReadonlySet<string>>(new Set());
  const onboarding = useOnboardingPeople(revision), [onboardingFilter, setOnboardingFilter] = useState<OnboardingPersonStatus | "">("");
  const tab = educatorTabOf(url.hash);
  const load = async () => {
    setError("");
    try {
      const [people, listed, reviews] = await Promise.all([
        api<{ members: MemberStats[] }>("/members"),
        api<{ contracts: Contract[] }>("/contracts").catch(() => ({ contracts: [] as Contract[] })),
        // PPL-01: who has a profile waiting for approval, for each person's incorporation.
        api<ProfileReviewQueue>("/profile-reviews").catch(() => null),
      ]);
      setMembers(people.members); setContracts(listed.contracts); setPendingProfiles(new Set(reviews?.profiles.map(item => item.userId) || [])); setRevision(value => value + 1);
    } catch (cause) { setError(message(cause)); }
  };
  useEffect(() => { void load(); }, []);
  async function update(member: Member, patch: Partial<Member>) {
    setBusy(member.id);
    try { await api(`/members/${member.id}`, "PUT", { role: patch.role || member.role, active: patch.active ?? member.active }); await load(); toast({ message: `Permisos de ${member.displayName || member.username} guardados. Sus sesiones abiertas se cerraron.` }); }
    catch (cause) { toast({ tone: "error", message: message(cause) }); }
    finally { setBusy(""); }
  }
  async function reset(member: Member) {
    const name = member.displayName || member.username;
    if (!await confirm({ title: `¿Restablecer la contraseña de ${name}?`, body: "Su contraseña actual deja de funcionar y sus sesiones abiertas se cierran. Recibirás una contraseña temporal para entregarle; al entrar, elegirá una propia.", confirm: "Restablecer contraseña", danger: true })) return;
    setBusy(member.id);
    try { const result = await api<{ temporaryPassword: string }>(`/members/${member.id}/password`, "POST"); setIssued({ name, username: member.username, password: result.temporaryPassword, created: false }); await load(); }
    catch (cause) { toast({ tone: "error", message: message(cause) }); }
    finally { setBusy(""); }
  }
  const invite = () => { navigate("/educadores#invitaciones"); setInviting(true); };
  const header = <PageHeader title="Educadores" description="Quién forma el equipo, su contrato y su incorporación. Los estudiantes no necesitan cuenta."
    primary={members && <PrimaryAction icon="plus" onClick={() => setAdding(true)}>Agregar cuenta</PrimaryAction>}
    actions={members && <button type="button" className="button secondary" onClick={invite}><Icon name="send" size={16}/>Invitar por correo</button>}/>;
  const tabs = <nav className="tabs scrollable-tabs" aria-label="Secciones de educadores">
    {educatorTabs.map(item => <Link key={item.id} href={item.href} className="tab" aria-current={item.id === "contratos" ? undefined : tab === item.id ? "page" : undefined}>{item.label}</Link>)}
  </nav>;
  const incorporationOf = (id: string) => {
    const person = members?.find(item => item.id === id);
    return person ? incorporationSteps({ role: person.role, onboarding: onboarding?.get(id), profilePending: pendingProfiles.has(id),
      contract: currentContractOf(contracts, id)?.phase || null, leads: person.leads || 0, coTeaches: person.coTeaches || 0, sections: person.sections || 0 }) : undefined;
  };
  if (error) return <>{header}{tabs}<ErrorState error={error} retry={() => void load()}/></>;
  if (!members) return <>{header}{tabs}<Loading label="Cargando equipo…"/></>;
  const visible = members.filter(member => !onboardingFilter || onboarding?.get(member.id)?.status === onboardingFilter);
  return <>
    {header}
    {tabs}
    {tab === "personas" && <>
      <div className="table-toolbar"><OnboardingFilter value={onboardingFilter} onChange={setOnboardingFilter}/></div>
      <div className="table-card" role="region" aria-label="Personas de la organización" tabIndex={0}><table className="members-table">
        <caption className="sr-only">Personas de la organización, su carga, su contrato y su acceso</caption>
        <thead><tr><th scope="col">Persona</th><th scope="col">Rol</th><th scope="col">Carga</th><th scope="col">Contrato</th><th scope="col">Incorporación</th><th scope="col">Acceso</th><th scope="col"><span className="sr-only">Acciones</span></th></tr></thead>
        <tbody>{visible.map(member => {
          const owner = member.id === "user-0", name = member.displayName || member.username, load = loadLabel(member);
          const contract = currentContractOf(contracts, member.id);
          return <tr key={member.id}>
            <th scope="row" className="cell-person"><span className="person-cell"><Avatar name={name} size={30}/><span>
              <span className="person-name-line"><button type="button" className="link-button" onClick={() => setDetail({ id: member.id, name })}>{name}</button>{owner && <StatusBadge>Cuenta principal</StatusBadge>}</span>
              <span className="person-username muted small">@{member.username}{member.email ? ` · ${member.email}` : ""}</span>
            </span></span></th>
            <td>{member.role === "admin" ? "Administración" : "Educador"}{member.coordination && <><br/><CoordinationBadge scope={member.coordination}/></>}</td>
            <td className="cell-load">{load.summary ? <><span>{load.summary}</span>{load.detail && <span className="muted small">{load.detail}</span>}</> : <span className="muted">—</span>}</td>
            <td>{contract ? <StatusBadge tone={contractTone[contract.phase]}>{contractPhaseLabels[contract.phase]}</StatusBadge> : <span className="muted">—</span>}</td>
            <td>{onboarding ? <button type="button" className="cell-button" aria-label={`Qué le falta a ${name}`} onClick={() => setDetail({ id: member.id, name, tab: "incorporation" })}><OnboardingBadge person={onboarding.get(member.id)} compact/></button> : <span className="muted">…</span>}</td>
            <td><StatusBadge tone={!member.active ? "neutral" : member.mustChangePassword ? "warning" : "success"}>{!member.active ? "Sin acceso" : member.mustChangePassword ? "Contraseña temporal" : "Activo"}</StatusBadge>{member.departedOn && <span className="muted small departed-on">Salió el {departureDay(member.departedOn)}</span>}</td>
            <td className="cell-actions">{owner ? <Menu label={`Acciones de ${name}`} items={[{ label: "Perfil y expediente", icon: "user", onSelect: () => setDetail({ id: member.id, name }) }]}/> : <Menu label={`Acciones de ${name}`} items={[
              { label: "Perfil y expediente", icon: "user", onSelect: () => setDetail({ id: member.id, name }) },
              { label: member.role === "admin" ? "Cambiar a educador" : "Cambiar a administración", icon: "users", disabled: busy === member.id, onSelect: () => void update(member, { role: member.role === "admin" ? "educator" : "admin" }) },
              ...(member.role === "educator" && member.active ? [{ label: member.coordination ? "Cambiar la coordinación académica" : "Asignar coordinación académica", icon: "shield" as const, disabled: busy === member.id, onSelect: () => setCoordinating(member) }] : []),
              { label: "Restablecer contraseña", icon: "undo", disabled: busy === member.id, onSelect: () => void reset(member) },
              { label: member.active ? "Quitar acceso" : "Dar acceso", icon: "shield", danger: member.active, disabled: busy === member.id, onSelect: () => void update(member, { active: !member.active }) },
              ...(member.id !== me.id && (member.active || !member.departedOn) ? [{ label: "Registrar salida", icon: "logout" as const, danger: true, disabled: busy === member.id, onSelect: () => setLeaving({ id: member.id, name }) }] : []),
            ]}/>}</td>
          </tr>;
        })}</tbody>
      </table></div>
    </>}
    {(tab === "invitaciones" || inviting) && <Invitations inviting={inviting} onInviting={setInviting} onChanged={() => void load()}/>}
    {tab === "incorporacion" && <OnboardingPeople members={members} people={onboarding} filter={onboardingFilter} onFilter={setOnboardingFilter} onOpen={person => setDetail({ ...person, tab: "incorporation" })}/>}
    {tab === "cierres" && <ClosureRequests revision={revision} onDeparture={setLeaving}/>}
    {tab === "documentos" && <ExpiringDocuments onOpen={setDetail} revision={revision}/>}
    {adding && <AccountDialog onClose={() => setAdding(false)} onCreated={async result => { setAdding(false); setIssued(result); await load(); }}/>}
    {coordinating && <CoordinationDialog person={{ id: coordinating.id, name: coordinating.displayName || coordinating.username }} current={coordinating.coordination || null} onClose={() => setCoordinating(null)} onDone={async text => { setCoordinating(null); await load(); toast({ message: text }); }}/>}
    {issued && <TemporaryPassword issued={issued} onClose={() => setIssued(null)}/>}
    {detail && <PersonDetail person={detail} incorporation={incorporationOf(detail.id)} initialTab={detail.tab} onChanged={() => void load()} onClose={() => { setDetail(null); void load(); }}/>}
    {leaving && <DepartureDialog person={leaving} onClose={() => setLeaving(null)} onDone={async date => { const name = leaving.name; setLeaving(null); await load(); toast({ message: `Salida de ${name} registrada el ${departureDay(date)}. Ya no puede entrar.` }); }}/>}
  </>;
}

function OnboardingPeople({ members, people, filter, onFilter, onOpen }: {
  members: MemberStats[]; people: Map<string, OnboardingPerson> | null;
  filter: OnboardingPersonStatus | ""; onFilter: (value: OnboardingPersonStatus | "") => void; onOpen: (person: { id: string; name: string }) => void;
}) {
  const rows = members.filter(member => !filter || people?.get(member.id)?.status === filter);
  return <Section title="Incorporación">
    <div className="table-toolbar"><OnboardingFilter value={filter} onChange={onFilter}/></div>
    {!people ? <Loading label="Cargando incorporación…" lines={3}/> : !rows.length
      ? <EmptyState compact icon="users" title={filter ? "Nadie coincide con este filtro" : "Sin personas"}>{filter ? "Prueba con otro estado o elige «Todas»." : "Cuando alguien se incorpore, verás aquí en qué paso va."}</EmptyState>
      : <div className="table-card" role="region" aria-label="Incorporación de cada persona" tabIndex={0}><table className="members-table">
        <caption className="sr-only">Estado de la incorporación de cada persona</caption>
        <thead><tr><th scope="col">Persona</th><th scope="col">Rol</th><th scope="col">Incorporación</th><th scope="col">Acceso</th></tr></thead>
        <tbody>{rows.map(member => {
          const name = member.displayName || member.username;
          return <tr key={member.id}>
            <th scope="row"><span className="person-cell"><Avatar name={name} size={30}/><span><button type="button" className="link-button" onClick={() => onOpen({ id: member.id, name })}>{name}</button><span className="muted small">@{member.username}</span></span></span></th>
            <td>{member.role === "admin" ? "Administración" : "Educador"}</td>
            <td><OnboardingBadge person={people.get(member.id)}/></td>
            <td><StatusBadge tone={!member.active ? "neutral" : member.mustChangePassword ? "warning" : "success"}>{!member.active ? "Sin acceso" : member.mustChangePassword ? "Contraseña temporal" : "Activo"}</StatusBadge></td>
          </tr>;
        })}</tbody>
      </table></div>}
  </Section>;
}

type Issued = { name: string; username: string; password: string; created: boolean };
/** ST-093: a new account with a name, username and role; the server answers with its temporary password. */
function AccountDialog({ onClose, onCreated }: { onClose: () => void; onCreated: (issued: Issued) => Promise<void> }) {
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setError("");
    const account = accountInput(Object.fromEntries(new FormData(event.currentTarget)));
    if (!account) { setError("Revisa el nombre (2 a 80 caracteres) y el usuario (3 a 32 letras minúsculas, números, puntos o guiones)."); return; }
    setBusy(true);
    try { const result = await api<{ member: Member; temporaryPassword: string }>("/members", "POST", account); await onCreated({ name: account.displayName, username: account.username, password: result.temporaryPassword, created: true }); }
    catch (cause) { setError(message(cause)); setBusy(false); }
  }
  return <Modal title="Agregar cuenta" onClose={onClose}>
    <form className="stack" onSubmit={submit}><fieldset className="stack" disabled={busy}>
      {error && <p className="form-alert" role="alert"><Icon name="alert" size={18}/>{error}</p>}
      <Field label="Nombre" hint="Como aparecerá en los cursos y en la actividad."><input name="displayName" required minLength={2} maxLength={80} autoComplete="off"/></Field>
      <Field label="Usuario" hint="Con el que entrará: letras minúsculas, números, puntos o guiones; por ejemplo, ana.lopez."><input name="username" required minLength={3} maxLength={32} pattern="[a-z0-9][a-z0-9._\-]{1,30}[a-z0-9]" autoCapitalize="none" autoComplete="off" spellCheck={false}/></Field>
      <Field label="Rol"><select name="role" defaultValue="educator"><option value="educator">Educador: prepara e imparte sus cursos</option><option value="admin">Administración: configura la organización y su equipo</option></select></Field>
      <div className="modal-actions"><button type="button" className="button ghost" onClick={onClose}>Cancelar</button><button className="button primary">{busy ? "Creando…" : "Crear cuenta"}</button></div>
    </fieldset></form>
  </Modal>;
}

/** The temporary password, shown once: administration hands it over privately and the person replaces it at sign-in. */
function TemporaryPassword({ issued, onClose }: { issued: Issued; onClose: () => void }) {
  const { toast } = useFeedback();
  return <Modal title={issued.created ? "Cuenta creada" : "Contraseña restablecida"} onClose={onClose} footer={<button type="button" className="button primary" data-autofocus onClick={onClose}>Listo, ya la guardé</button>}>
    <div className="stack">
      <p>{issued.created ? <>La cuenta de <strong>{issued.name}</strong> está lista.</> : <>La contraseña anterior de <strong>{issued.name}</strong> ya no funciona.</>} Entrega estos datos por un medio privado:</p>
      <dl className="credentials"><dt>Usuario</dt><dd><code>{issued.username}</code></dd><dt>Contraseña temporal</dt><dd><code aria-label="Contraseña temporal">{issued.password}</code></dd></dl>
      <button type="button" className="button secondary small" onClick={() => void navigator.clipboard?.writeText(issued.password).then(() => toast({ message: "Contraseña temporal copiada." }), () => toast({ tone: "error", message: "No se pudo copiar. Selecciónala y cópiala a mano." }))}><Icon name="copy" size={16}/>Copiar contraseña</button>
      <div className="notice warning" role="note"><Icon name="alert" size={18}/><p>Esta contraseña no se volverá a mostrar. Al entrar por primera vez, {issued.name} deberá elegir una propia.</p></div>
    </div>
  </Modal>;
}

export function AcademicSettings() {
  return <AdminOnly title="Configuración académica"><PageHeader title="Configuración académica" description="Programas que agrupan cursos y comparten su configuración, etiquetas para la biblioteca y los estándares con que se describe cada curso."/>
    <ProgramEditor/>
    <GradingSchemes/>
    <TaxonomyEditor/>
    <CurriculumPackages/>
    <StandardsReference/>
  </AdminOnly>;
}

/**
 * Study programs. A program gives its courses a type, level, modality and pacing, a default format and field,
 * and values for settings; a fixed setting cannot be changed by its courses.
 */
function ProgramEditor() {
  const { toast } = useFeedback();
  const [programs, setPrograms] = useState<StudyProgram[] | null>(null), [error, setError] = useState(""), [editing, setEditing] = useState<{ item?: StudyProgram } | null>(null);
  const { url, navigate } = useNavigation();
  const pathOf = programs?.find(item => item.id === url.searchParams.get("ruta"));
  const load = () => api<{ programs: StudyProgram[] }>("/programs").then(result => setPrograms(result.programs)).catch(cause => setError(message(cause)));
  useEffect(() => { void load(); }, []);
  async function save(body: Record<string, unknown>) {
    try {
      const result = await api<{ programs: StudyProgram[] }>(`/programs${editing?.item ? `/${editing.item.id}` : ""}`, editing?.item ? "PUT" : "POST", { ...body, version: editing?.item?.version });
      setPrograms(result.programs); setEditing(null);
      toast({ message: editing?.item ? "Programa actualizado. Sus cursos siguen la nueva configuración." : "Programa creado. Asígnalo a cursos desde su configuración." });
    } catch (cause) { toast({ tone: "error", message: message(cause) }); }
  }
  async function setStatus(program: StudyProgram, status: StudyProgram["status"]) {
    try {
      const { id: _id, courseCount: _count, updatedAt: _updated, ...rest } = program;
      const result = await api<{ programs: StudyProgram[] }>(`/programs/${program.id}`, "PUT", { ...rest, status });
      setPrograms(result.programs); toast({ message: status === "archived" ? `«${program.name}» se archivó. Sus cursos conservan su configuración.` : `«${program.name}» se restauró.` });
    } catch (cause) { toast({ tone: "error", message: message(cause) }); }
  }
  return <section className="panel admin-section" aria-labelledby="programs-title">
    <div className="panel-header"><h2 id="programs-title">Programas</h2><button type="button" className="button primary small" onClick={() => setEditing({})}><Icon name="plus" size={16}/>Crear programa</button></div>
    <p className="muted">Un programa es un conjunto de cursos, como un grado escolar, una carrera o una ruta de idiomas. Sus cursos heredan su configuración.</p>
    {error ? <ErrorState error={error} retry={() => void load()}/> : !programs ? <Loading label="Cargando programas…" lines={3}/> : !programs.length
      ? <EmptyState compact icon="grid" title="Sin programas">Los cursos independientes no necesitan programa. Crea uno cuando varios cursos compartan nivel, modalidad y reglas.</EmptyState>
      : <ul className="program-list">{programs.map(program => <li key={program.id} className={program.status === "archived" ? "is-archived" : undefined}>
        <div className="program-text">
          <strong>{program.name}</strong>{program.status === "archived" && <StatusBadge>Archivado</StatusBadge>}
          {program.description && <p className="muted small">{program.description}</p>}
          <ul className="course-facets"><li>{labelOf.type(program.educationType)}</li>{program.level !== "unspecified" && <li>{labelOf.level(program.level)}</li>}<li>{labelOf.modality(program.modality)}</li><li>{labelOf.pacing(program.pacing)}</li>{program.area && <li>{areaLabel(program.area)}</li>}</ul>
          {program.locked.length > 0 && <p className="muted small">Fija: {program.locked.map(key => settingDefinitions.find(item => item.key === key)!.label.toLowerCase()).join(", ")}.</p>}
        </div>
        <span className="muted small">{plural(program.courseCount || 0, "curso", "cursos")}</span>
        <Menu label={`Acciones de ${program.name}`} items={[
          { label: "Editar", icon: "edit", onSelect: () => setEditing({ item: program }) },
          { label: "Requisitos entre cursos", icon: "list", onSelect: () => navigate(`/configuracion-academica?ruta=${program.id}`) },
          { label: "Calendario del programa", icon: "calendar", onSelect: () => navigate(`/configuracion-academica/calendario?programa=${program.id}`) },
          program.status === "active" ? { label: "Archivar", icon: "archive", danger: true, onSelect: () => void setStatus(program, "archived") } : { label: "Restaurar", icon: "archive", onSelect: () => void setStatus(program, "active") },
        ]}/>
      </li>)}</ul>}
    {editing && <ProgramDialog item={editing.item} onClose={() => setEditing(null)} onSave={save}/>}
    {pathOf && <ProgramPathDialog program={pathOf} onClose={() => navigate("/configuracion-academica", true)}/>}
  </section>;
}

function ProgramDialog({ item, onClose, onSave }: { item?: StudyProgram; onClose: () => void; onSave: (body: Record<string, unknown>) => Promise<void> }) {
  const [profile, setProfile] = useState<AcademicProfile & { format: CourseFormat; area: string }>(item ? { educationType: item.educationType, level: item.level, modality: item.modality, pacing: item.pacing, format: item.format, area: item.area || "" } : { ...coursePresets[2].values, area: "" });
  const [settings, setSettings] = useState<CourseSettings>(item?.settings || {}), [locked, setLocked] = useState<SettingKey[]>(item?.locked || []), [busy, setBusy] = useState(false), [pendingPolicy, setPendingPolicy] = useState<FreedomPolicy | null>(null);
  const derived = derivedSettings(profile);
  const schemes = useGradingSchemes();
  const change = (patch: Partial<typeof profile>) => setProfile(current => { const next = { ...current, ...patch }; if (next.educationType === "formal" && next.level === "unspecified") next.level = "primary"; return next; });
  function setSetting(key: SettingKey, value: string) {
    setSettings(current => { const next = { ...current } as Record<string, unknown>; const parsed = settingValue(key, value); if (parsed === undefined) delete next[key]; else next[key] = parsed; return next as CourseSettings; });
    if (value === "") setLocked(current => current.filter(item => item !== key));
  }
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true);
    const form = new FormData(event.currentTarget);
    await onSave({ name: form.get("name"), description: form.get("description"), ...profile, area: profile.area || null, settings, locked, status: item?.status || "active" });
    setBusy(false);
  }
  const text = settingText;
  return <Modal title={item ? "Editar programa" : "Crear programa"} onClose={onClose} wide>
    <form className="stack" onSubmit={submit}><fieldset className="stack" disabled={busy}>
      <Field label="Nombre" hint="Por ejemplo: Primaria bilingüe, Inglés para adultos, Licenciatura en Educación."><input name="name" required maxLength={120} defaultValue={item?.name}/></Field>
      <Field label="Descripción" optional><textarea name="description" rows={2} maxLength={1000} defaultValue={item?.description}/></Field>
      <div className="field-grid">
        <Field label="Tipo de educación"><select value={profile.educationType} onChange={event => change({ educationType: event.target.value as EducationType })}>{educationTypes.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}</select></Field>
        <Field label="Nivel educativo" hint={educationLevels.find(option => option.value === profile.level)?.hint}><select value={profile.level} onChange={event => change({ level: event.target.value as EducationLevel })}>{educationLevels.map(option => <option key={option.value} value={option.value} disabled={option.value === "unspecified" && profile.educationType === "formal"}>{option.code === "—" ? option.label : `${option.label} (${option.code})`}</option>)}</select></Field>
        <Field label="Modalidad"><select value={profile.modality} onChange={event => change({ modality: event.target.value as Modality })}>{modalities.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}</select></Field>
        <Field label="Ritmo"><select value={profile.pacing} onChange={event => change({ pacing: event.target.value as Pacing })}>{pacings.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}</select></Field>
        <Field label="Formato de sus cursos" hint="Valor inicial de los cursos nuevos del programa."><select value={profile.format} onChange={event => change({ format: event.target.value as CourseFormat })}>{courseFormats.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}</select></Field>
        <Field label="Área de conocimiento" optional><select value={profile.area} onChange={event => change({ area: event.target.value })}><option value="">Sin área</option>{knowledgeAreas.map(area => <optgroup key={area.code} label={area.label}><option value={area.code}>{area.label} (general)</option>{area.fields.length > 1 && area.fields.map(field => <option key={field.code} value={field.code}>{field.label}</option>)}</optgroup>)}</select></Field>
      </div>
      <fieldset className="config-section"><legend>Ajustes para sus cursos</legend>
        <p className="muted small">Sin valor, cada curso usa lo que corresponde a su tipo. Con valor, es el punto de partida de sus cursos; si lo fijas, ningún curso del programa puede cambiarlo.</p>
        <ul className="settings-list">{settingDefinitions.filter(definition => definition.key !== "sectionFreedom" && definition.key !== "sectionFreedomReview").map(definition => {
          const key = definition.key;
          const options = key === "gradingSchemeId" ? schemeOptions(schemes, settings[key]) : settingChoices(key, settings[key]);
          return <li key={key} className="setting-item">
            <div><strong id={`program-setting-${key}`}>{definition.label}</strong><p className="muted small">{definition.description}</p></div>
            <div className="setting-control">
              <select aria-labelledby={`program-setting-${key}`} value={settings[key] === undefined ? "" : String(settings[key])} onChange={event => setSetting(key, event.target.value)}>
                <option value="">Automático: {text(key, derived[key])}</option>{options.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
              </select>
              <label className="lock"><input type="checkbox" disabled={settings[key] === undefined} checked={locked.includes(key)} onChange={event => setLocked(current => event.target.checked ? [...current, key] : current.filter(entry => entry !== key))}/><span>Fijar para sus cursos</span></label>
            </div>
          </li>;
        })}</ul>
        <FreedomPolicyField name="program-section-freedom" value={settings.sectionFreedom || derived.sectionFreedom} onChoose={setPendingPolicy}
          review={settings.sectionFreedomReview === true} onReview={checked => setSetting("sectionFreedomReview", checked ? "true" : "false")}/>
        <label className="lock"><input type="checkbox" disabled={settings.sectionFreedom === undefined} checked={locked.includes("sectionFreedom")} onChange={event => setLocked(current => event.target.checked ? [...current, "sectionFreedom"] : current.filter(entry => entry !== "sectionFreedom"))}/><span>Fijar para los cursos del programa</span></label>
        {(settings.sectionFreedom === "flexible" || settings.sectionFreedom === "free" || (!settings.sectionFreedom && (derived.sectionFreedom === "flexible" || derived.sectionFreedom === "free"))) && <label className="lock"><input type="checkbox" disabled={settings.sectionFreedomReview === undefined} checked={locked.includes("sectionFreedomReview")} onChange={event => setLocked(current => event.target.checked ? [...current, "sectionFreedomReview"] : current.filter(entry => entry !== "sectionFreedomReview"))}/><span>Fijar para los cursos del programa</span></label>}
      </fieldset>
      {pendingPolicy && <FreedomChangeDialog from={settings.sectionFreedom || derived.sectionFreedom} to={pendingPolicy} blocked={null} busy={false} onClose={() => setPendingPolicy(null)} onConfirm={() => { setSetting("sectionFreedom", pendingPolicy); setPendingPolicy(null); }}/>}
      <div className="modal-actions"><button type="button" className="button ghost" onClick={onClose}>Cancelar</button><button className="button primary">{busy ? "Guardando…" : "Guardar programa"}</button></div>
    </fieldset></form>
  </Modal>;
}

/** The standards behind the course dimensions, for reference. */
function StandardsReference() {
  return <section className="panel admin-section" aria-labelledby="standards-title">
    <div className="panel-header"><h2 id="standards-title">Estándares de referencia</h2></div>
    <p className="muted">Los cursos y programas se describen con clasificaciones internacionales de la UNESCO, para que la configuración sea comparable entre organizaciones y países.</p>
    <details className="reference"><summary>Niveles educativos · CINE 2011</summary>
      <table className="reference-table"><thead><tr><th scope="col">Código</th><th scope="col">Nivel</th><th scope="col">Equivale a</th></tr></thead>
        <tbody>{educationLevels.map(level => <tr key={level.value}><td>{level.code}</td><th scope="row">{level.label}</th><td>{level.hint}</td></tr>)}</tbody></table>
    </details>
    <details className="reference"><summary>Áreas de conocimiento · CINE-F 2013</summary>
      <ul className="reference-areas">{knowledgeAreas.map(area => <li key={area.code}><strong>{area.code} · {area.label}</strong><span className="muted small">{area.fields.map(field => `${field.code} ${field.label}`).join(" · ")}</span></li>)}</ul>
    </details>
  </section>;
}

type Editing = { kind: "vocabulary" | "term"; item?: Vocabulary | TaxonomyTerm; parent?: string };
function TaxonomyEditor() {
  const { toast } = useFeedback();
  const [taxonomy, setTaxonomy] = useState<Taxonomy | null>(null), [error, setError] = useState(""), [editing, setEditing] = useState<Editing | null>(null), [busy, setBusy] = useState(false);
  const load = () => api<Taxonomy>("/taxonomy").then(setTaxonomy).catch(cause => setError(message(cause)));
  useEffect(() => { void load(); }, []);
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!editing) return;
    setBusy(true);
    try {
      const result = await api<Taxonomy>(`/${editing.kind === "term" ? "terms" : "vocabularies"}${editing.item ? `/${editing.item.id}` : ""}`, editing.item ? "PUT" : "POST", { ...Object.fromEntries(new FormData(event.currentTarget)), vocabularyId: editing.parent, version: editing.item?.version });
      setTaxonomy(result); setEditing(null); toast({ message: "Etiquetas guardadas. Los recursos conservan las que ya tenían." });
    } catch (cause) { toast({ tone: "error", message: message(cause) }); }
    finally { setBusy(false); }
  }
  const header = <><div className="panel-header"><h2 id="tags-title">Etiquetas de la biblioteca</h2>{taxonomy && <button type="button" className="button secondary small" onClick={() => setEditing({ kind: "vocabulary" })}><Icon name="plus" size={16}/>Crear grupo de etiquetas</button>}</div>
    <p className="muted">Etiquetas libres para encontrar y filtrar recursos en la biblioteca. No cambian la configuración de los cursos.</p></>;
  const wrap = (children: ReactNode) => <section className="panel admin-section" aria-labelledby="tags-title">{header}{children}</section>;
  if (error) return wrap(<ErrorState error={error} retry={() => void load()}/>);
  if (!taxonomy) return wrap(<Loading label="Cargando etiquetas…" lines={3}/>);
  return wrap(<>
    {!taxonomy.vocabularies.length && <EmptyState compact icon="list" title="Sin etiquetas">Por ejemplo, un grupo “Habilidad” con Lectura, Escritura, Escucha y Conversación.</EmptyState>}
    <div className="tag-groups">{taxonomy.vocabularies.map(vocabulary => <div key={vocabulary.id} className="tag-group" role="group" aria-labelledby={`vocabulary-${vocabulary.id}`}>
      <div className="tag-group-head"><h3 id={`vocabulary-${vocabulary.id}`}>{vocabulary.name}</h3>{vocabulary.status === "archived" && <StatusBadge>Archivado</StatusBadge>}
        <Menu label={`Acciones de ${vocabulary.name}`} items={[
          { label: "Editar grupo", icon: "edit", onSelect: () => setEditing({ kind: "vocabulary", item: vocabulary }) },
          { label: "Agregar etiqueta", icon: "plus", disabled: vocabulary.status !== "active", onSelect: () => setEditing({ kind: "term", parent: vocabulary.id }) },
        ]}/>
      </div>
      <ul className="chips">{taxonomy.terms.filter(term => term.vocabularyId === vocabulary.id).map(term => <li key={term.id}><button type="button" className={`chip-button${term.status === "archived" ? " is-archived" : ""}`} aria-label={`Editar etiqueta ${term.name}${term.status === "archived" ? " (archivada)" : ""}`} disabled={vocabulary.status !== "active"} onClick={() => setEditing({ kind: "term", item: term, parent: vocabulary.id })}>{term.name}{term.status === "archived" ? " · archivada" : ""}</button></li>)}</ul>
    </div>)}</div>
    {editing && <Modal title={`${editing.item ? "Editar" : "Crear"} ${editing.kind === "term" ? "etiqueta" : "grupo de etiquetas"}`} onClose={() => setEditing(null)}>
      <form className="stack" onSubmit={save}>
        <fieldset disabled={busy} className="stack">
          <Field label="Nombre"><input name="name" required maxLength={80} defaultValue={editing.item?.name}/></Field>
          <Field label="Estado"><select name="status" defaultValue={editing.item?.status || "active"}><option value="active">Activo</option><option value="archived">Archivado</option></select></Field>
          <div className="modal-actions"><button type="button" className="button ghost" onClick={() => setEditing(null)}>Cancelar</button><button className="button primary">Guardar</button></div>
        </fieldset>
      </form>
    </Modal>}
  </>);
}
