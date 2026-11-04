import { Fragment, useEffect, useId, useState } from "react";
import type { FormEvent } from "react";
import type { AccessEvent, GrantablePermission, PermissionArea, PermissionGrant, PermissionKey, ProgramScope, SecurityGroup } from "@happy-learners/contracts";
import type { BuiltInRole, PermissionDefinition, Reach } from "@happy-learners/domain";
import { api, message } from "../api";
import { Link, useNavigation } from "../navigation";
import { useSession } from "../session";
import { timeAgo } from "../model";
import { Modal, useFeedback } from "../ui/feedback";
import { Icon } from "../ui/icons";
import { Menu } from "../ui/Menu";
import { EmptyState, ErrorState, Field, Loading, PageHeader, PrimaryAction, Section, StatusBadge } from "../ui/primitives";

type Program = { id: string; name: string; status: string };
type Matrix = {
  areas: { key: PermissionArea; label: string }[]; catalog: PermissionDefinition[];
  roles: { key: BuiltInRole; label: string; description: string; reach: Partial<Record<PermissionKey, Reach>> }[]; reachLabels: Record<Reach, string>;
  groups: SecurityGroup[]; coordinators: { userId: string; name: string; username: string; scope: ProgramScope }[]; programs: Program[]; events: AccessEvent[];
};

/** «Todos los programas» or the names of the programs of a scope. */
export function scopeText(scope: ProgramScope, programs: Program[]) {
  if ("all" in scope) return "Todos los programas";
  return scope.programs.map(id => programs.find(program => program.id === id)?.name || "Programa no disponible").join(", ");
}

/** All programs, or a list of them (DEC-041). Archived programs stay listed only when already chosen. */
function ScopePicker({ legend, programs, value, onChange }: { legend: string; programs: Program[]; value: ProgramScope | null; onChange: (scope: ProgramScope | null) => void }) {
  const id = useId(), all = !!value && "all" in value, chosen = value && "programs" in value ? value.programs : [];
  const listed = programs.filter(program => program.status === "active" || chosen.includes(program.id));
  const toggle = (programId: string, on: boolean) => {
    const next = on ? [...chosen, programId] : chosen.filter(item => item !== programId);
    onChange(next.length ? { programs: next } : { programs: [] });
  };
  return <fieldset className="choice-field scope-picker">
    <legend>{legend}</legend>
    <label className="switch"><input type="radio" name={`${id}-kind`} checked={all} onChange={() => onChange({ all: true })}/><span>Todos los programas</span></label>
    <label className="switch"><input type="radio" name={`${id}-kind`} checked={!all} onChange={() => onChange({ programs: chosen })}/><span>Solo los programas elegidos</span></label>
    {!all && <ul className="scope-programs" aria-label="Programas del alcance">{listed.map(program => <li key={program.id}>
      <label className="switch"><input type="checkbox" checked={chosen.includes(program.id)} onChange={event => toggle(program.id, event.target.checked)}/><span>{program.name}{program.status !== "active" ? " (archivado)" : ""}</span></label>
    </li>)}</ul>}
  </fieldset>;
}
const validScope = (scope: ProgramScope | null): scope is ProgramScope => !!scope && ("all" in scope || scope.programs.length > 0);

/**
 * ST-128: administration assigns, changes or removes the academic coordination profile of an educator, with its scope.
 * Saving closes the person's open sessions.
 */
export function CoordinationDialog({ person, current, onClose, onDone }: { person: { id: string; name: string }; current: ProgramScope | null; onClose: () => void; onDone: (text: string) => Promise<void> }) {
  const [programs, setPrograms] = useState<Program[] | null>(null), [scope, setScope] = useState<ProgramScope | null>(current || { programs: [] });
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  useEffect(() => { api<{ programs: Program[] }>("/programs").then(result => setPrograms(result.programs), cause => setError(message(cause))); }, []);
  async function save(enabled: boolean, event?: FormEvent) {
    event?.preventDefault();
    if (enabled && !validScope(scope)) { setError("Elige todos los programas o al menos un programa."); return; }
    setBusy(true); setError("");
    try {
      await api(`/members/${person.id}/coordination`, "PUT", enabled ? { enabled, scope } : { enabled });
      await onDone(enabled ? `${person.name} tiene la coordinación académica de ${scopeText(scope!, programs || []).toLowerCase()}. Sus sesiones abiertas se cerraron.` : `${person.name} ya no tiene la coordinación académica. Sus sesiones abiertas se cerraron.`);
    } catch (cause) { setError(message(cause)); setBusy(false); }
  }
  const title = `Coordinación académica de ${person.name}`;
  return <Modal title={title} onClose={onClose} wide>
    {!programs && !error ? <Loading label="Cargando programas…" lines={3}/> : <form className="stack" aria-label={title} onSubmit={event => void save(true, event)}><fieldset className="stack" disabled={busy}>
      {error && <p className="form-alert" role="alert"><Icon name="alert" size={18}/>{error}</p>}
      <p>En los programas de su alcance, la coordinación consulta todos los cursos, secciones, cronogramas, asistencia y avance; revisa, devuelve con observaciones y publica lecciones como la persona responsable; y asigna a la persona responsable, a quienes colaboran y a quienes imparten cada sección.</p>
      <p className="muted small">No configura la organización ni gestiona cuentas, roles, invitaciones, respaldo, términos o privacidad. Al guardar, sus sesiones abiertas se cierran y el cambio queda en la actividad.</p>
      <ScopePicker legend="Alcance" programs={programs || []} value={scope} onChange={setScope}/>
      <div className="button-row modal-actions">
        {current && <button type="button" className="button danger" onClick={() => void save(false)}>Retirar coordinación</button>}
        <button type="button" className="button secondary" onClick={onClose}>Cancelar</button>
        <button className="button primary" disabled={!validScope(scope)}>{busy ? "Guardando…" : current ? "Guardar alcance" : "Asignar coordinación"}</button>
      </div>
    </fieldset></form>}
  </Modal>;
}

/** ST-135: the access matrix, the security groups and the audit of every change. Administration only. */
export function AccessPage() {
  const { member } = useSession();
  if (member.role !== "admin") return <><PageHeader title="Roles y accesos"/><EmptyState icon="shield" title="Esta sección es para administración">Pide a administración cualquier cambio de accesos.</EmptyState></>;
  return <AccessMatrix/>;
}

type Editing = { kind: "group"; group?: SecurityGroup } | { kind: "permissions"; group: SecurityGroup } | { kind: "members"; group: SecurityGroup };
/** ACC-01 (docs/transformacion/auditoria.md §8): one tab per thing administered, as Educadores and Contratos. */
const accessTabs = [
  { id: "matriz", label: "Matriz", href: "/roles-y-accesos" },
  { id: "grupos", label: "Grupos de seguridad", href: "/roles-y-accesos#grupos" },
  { id: "coordinacion", label: "Coordinación", href: "/roles-y-accesos#coordinacion" },
  { id: "historial", label: "Historial", href: "/roles-y-accesos#historial" },
] as const;
type AccessTab = (typeof accessTabs)[number]["id"];
function AccessMatrix() {
  const { toast, confirm } = useFeedback();
  const { url, navigate } = useNavigation();
  const tab: AccessTab = accessTabs.find(item => `#${item.id}` === url.hash)?.id || "matriz";
  const [data, setData] = useState<Matrix | null>(null), [error, setError] = useState(""), [editing, setEditing] = useState<Editing | null>(null), [area, setArea] = useState("");
  const load = async () => { setError(""); try { setData(await api<Matrix>("/access/matrix")); } catch (cause) { setError(message(cause)); } };
  useEffect(() => { void load(); }, []);
  const header = <PageHeader title="Roles y accesos" description="Qué puede hacer cada rol y cada grupo de seguridad, por área. Los cambios se aplican en la siguiente solicitud de cada persona y quedan en el historial."
    primary={data && <PrimaryAction icon="plus" onClick={() => setEditing({ kind: "group" })}>Crear grupo</PrimaryAction>}/>;
  if (error) return <>{header}<ErrorState error={error} retry={() => void load()}/></>;
  if (!data) return <>{header}<Loading label="Cargando la matriz de accesos…"/></>;
  // A group just created or changed is shown where its actions are.
  const done = async (text: string) => { setEditing(null); await load(); toast({ message: text }); if (tab !== "grupos") navigate("/roles-y-accesos#grupos", true); };
  const counts: Partial<Record<AccessTab, number>> = { grupos: data.groups.length, coordinacion: data.coordinators.length };
  async function remove(group: SecurityGroup) {
    if (!await confirm({ title: `¿Eliminar el grupo «${group.name}»?`, body: `${group.members.length ? `${group.members.length === 1 ? "La persona del grupo pierde" : `Las ${group.members.length} personas del grupo pierden`} sus permisos en su siguiente solicitud.` : "El grupo no tiene personas."} El historial conserva el registro.`, confirm: "Eliminar grupo", danger: true })) return;
    try { await api(`/access/groups/${group.id}`, "DELETE"); await done(`Grupo «${group.name}» eliminado.`); } catch (cause) { toast({ tone: "error", message: message(cause) }); }
  }
  const cell = (reach: Reach | undefined) => reach ? <span>{data.reachLabels[reach]}</span> : <span className="muted"><span aria-hidden="true">—</span><span className="sr-only">No</span></span>;
  const grantOf = (group: SecurityGroup, key: PermissionKey) => group.grants.find(grant => grant.permission === key);
  return <>
    {header}
    <nav className="tabs scrollable-tabs" aria-label="Secciones de roles y accesos">
      {accessTabs.map(item => <Link key={item.id} href={item.href} className="tab" aria-current={tab === item.id ? "page" : undefined}>{item.id in counts ? `${item.label} (${counts[item.id]})` : item.label}</Link>)}
    </nav>
    {tab === "matriz" && <>
    <div className="chips" role="group" aria-label="Área">
      {[{ key: "", label: "Todas" }, ...data.areas].map(item => <button key={item.key} type="button" className="chip-button" aria-pressed={area === item.key} onClick={() => setArea(item.key)}>{item.label}</button>)}
    </div>
    <div className="table-card" role="region" aria-label="Matriz de accesos" tabIndex={0}><table className="access-table">
      <caption className="sr-only">Permisos por área para cada rol y grupo de seguridad</caption>
      <thead><tr><th scope="col">Permiso</th>{data.roles.map(role => <th key={role.key} scope="col" title={role.description}>{role.label}</th>)}{data.groups.map(group => <th key={group.id} scope="col">{group.name}</th>)}</tr></thead>
      <tbody>{data.areas.filter(item => !area || item.key === area).map(area => <Fragment key={area.key}>
        <tr className="access-area"><th scope="colgroup" colSpan={1 + data.roles.length + data.groups.length}>{area.label}</th></tr>
        {data.catalog.filter(item => item.area === area.key).map(item => <tr key={item.key}>
          <th scope="row"><span className="access-permission"><strong>{item.label}</strong><span className="muted small">{item.description}</span>{!item.grantable && <span className="muted small">Solo administración</span>}</span></th>
          {data.roles.map(role => <td key={role.key}>{cell(role.reach[item.key])}</td>)}
          {data.groups.map(group => { const grant = grantOf(group, item.key); return <td key={group.id}>{grant ? scopeText(grant.scope, data.programs) : cell(undefined)}</td>; })}
        </tr>)}
      </Fragment>)}</tbody>
    </table></div>
    </>}
    {tab === "grupos" && <Section title="Grupos de seguridad">
        {data.groups.length ? <ul className="access-groups">{data.groups.map(group => <li key={group.id} className="panel">
          <div className="access-group-head"><div><h3>{group.name}</h3>{group.description && <p className="muted small">{group.description}</p>}</div>
            <Menu label={`Acciones del grupo ${group.name}`} items={[
              { label: "Permisos y alcance", icon: "shield", onSelect: () => setEditing({ kind: "permissions", group }) },
              { label: "Personas del grupo", icon: "users", onSelect: () => setEditing({ kind: "members", group }) },
              { label: "Renombrar", icon: "edit", onSelect: () => setEditing({ kind: "group", group }) },
              "separator",
              { label: "Eliminar grupo", icon: "archive", danger: true, onSelect: () => void remove(group) },
            ]}/></div>
          <p className="small">{group.grants.length ? group.grants.map(grant => `${data.catalog.find(item => item.key === grant.permission)?.label} (${scopeText(grant.scope, data.programs).toLowerCase()})`).join(" · ") : <span className="muted">Sin permisos todavía.</span>}</p>
          <p className="small">{group.members.length ? group.members.map(person => person.name).join(", ") : <span className="muted">Sin personas todavía.</span>}</p>
        </li>)}</ul> : <EmptyState compact icon="shield" title="Aún no hay grupos de seguridad" action={<button type="button" className="button secondary small" onClick={() => setEditing({ kind: "group" })}>Crear grupo</button>}>Un grupo reúne a educadores que necesitan un permiso adicional en algunos programas, por ejemplo consultar la actividad.</EmptyState>}
      </Section>}
    {tab === "coordinacion" && <Section title="Coordinación académica" action={<Link href="/educadores" className="section-link">Asignar en Educadores</Link>}>
        {data.coordinators.length ? <ul className="plain-list">{data.coordinators.map(person => <li key={person.userId}><strong>{person.name}</strong> <span className="muted small">@{person.username}</span><br/><span className="small">{scopeText(person.scope, data.programs)}</span></li>)}</ul>
          : <p className="muted">Nadie tiene la coordinación académica. Asígnala a un educador desde Educadores.</p>}
      </Section>}
    {tab === "historial" && <Section title="Historial de cambios">
      {data.events.length ? <ol className="plain-list access-events">{data.events.map(item => <li key={item.id}><span>{item.summary}</span> <span className="muted small">{item.actorName} · <time dateTime={item.occurredAt}>{timeAgo(item.occurredAt)}</time></span></li>)}</ol>
        : <p className="muted">Aún no hay cambios en los accesos.</p>}
    </Section>}
    {editing?.kind === "group" && <GroupDialog group={editing.group} onClose={() => setEditing(null)} onDone={done}/>}
    {editing?.kind === "permissions" && <PermissionsDialog group={editing.group} catalog={data.catalog} areas={data.areas} programs={data.programs} onClose={() => setEditing(null)} onDone={done}/>}
    {editing?.kind === "members" && <MembersDialog group={editing.group} onClose={() => setEditing(null)} onDone={done}/>}
  </>;
}

function GroupDialog({ group, onClose, onDone }: { group?: SecurityGroup; onClose: () => void; onDone: (text: string) => Promise<void> }) {
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError("");
    const form = Object.fromEntries(new FormData(event.currentTarget)) as Record<string, string>;
    try {
      if (group) await api(`/access/groups/${group.id}`, "PUT", { ...form, version: group.version });
      else await api("/access/groups", "POST", form);
      await onDone(group ? "Grupo guardado." : `Grupo «${form.name.trim()}» creado. Asígnale permisos y personas.`);
    } catch (cause) { setError(message(cause)); setBusy(false); }
  }
  const title = group ? `Renombrar «${group.name}»` : "Nuevo grupo de seguridad";
  return <Modal title={title} onClose={onClose}><form className="stack" aria-label={title} onSubmit={submit}><fieldset className="stack" disabled={busy}>
    {error && <p className="form-alert" role="alert"><Icon name="alert" size={18}/>{error}</p>}
    <Field label="Nombre"><input name="name" required minLength={2} maxLength={80} defaultValue={group?.name} placeholder="Ej. Seguimiento de inglés"/></Field>
    <Field label="Descripción" optional><textarea name="description" rows={2} maxLength={300} defaultValue={group?.description}/></Field>
    <div className="button-row modal-actions"><button type="button" className="button secondary" onClick={onClose}>Cancelar</button><button className="button primary">{busy ? "Guardando…" : group ? "Guardar" : "Crear grupo"}</button></div>
  </fieldset></form></Modal>;
}

function PermissionsDialog({ group, catalog, areas, programs, onClose, onDone }: { group: SecurityGroup; catalog: PermissionDefinition[]; areas: Matrix["areas"]; programs: Program[]; onClose: () => void; onDone: (text: string) => Promise<void> }) {
  const [grants, setGrants] = useState<Record<string, ProgramScope | null>>(Object.fromEntries(group.grants.map(grant => [grant.permission, grant.scope])));
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  const chosen = Object.entries(grants).filter(([, scope]) => scope) as [GrantablePermission, ProgramScope][];
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (chosen.some(([, scope]) => !validScope(scope))) { setError("Cada permiso necesita todos los programas o al menos un programa."); return; }
    setBusy(true); setError("");
    try { await api(`/access/groups/${group.id}/permissions`, "PUT", { grants: chosen.map(([permission, scope]) => ({ permission, scope })) satisfies PermissionGrant[] }); await onDone(`Permisos de «${group.name}» guardados. Se aplican en la siguiente solicitud de cada persona.`); }
    catch (cause) { setError(message(cause)); setBusy(false); }
  }
  const title = `Permisos de «${group.name}»`;
  return <Modal title={title} onClose={onClose} wide><form className="stack" aria-label={title} onSubmit={submit}><fieldset className="stack" disabled={busy}>
    {error && <p className="form-alert" role="alert"><Icon name="alert" size={18}/>{error}</p>}
    <p className="muted small">Cualquier permiso deja ver los cursos de su alcance. Los permisos de administración no se otorgan a grupos.</p>
    {areas.filter(area => catalog.some(item => item.area === area.key && item.grantable)).map(area => <section key={area.key} className="stack" aria-label={area.label}>
      <h3>{area.label}</h3>
      {catalog.filter(item => item.area === area.key && item.grantable).map(item => <div key={item.key} className="access-grant">
        <label className="switch"><input type="checkbox" checked={!!grants[item.key]} onChange={event => setGrants(current => ({ ...current, [item.key]: event.target.checked ? { all: true } : null }))}/><span><strong>{item.label}</strong> <span className="muted small">{item.description}</span></span></label>
        {grants[item.key] && <ScopePicker legend={`Alcance de «${item.label}»`} programs={programs} value={grants[item.key]} onChange={scope => setGrants(current => ({ ...current, [item.key]: scope }))}/>}
      </div>)}
    </section>)}
    <div className="button-row modal-actions"><button type="button" className="button secondary" onClick={onClose}>Cancelar</button><button className="button primary">{busy ? "Guardando…" : "Guardar permisos"}</button></div>
  </fieldset></form></Modal>;
}

type Person = { id: string; username: string; name: string; role: string };
function MembersDialog({ group, onClose, onDone }: { group: SecurityGroup; onClose: () => void; onDone: (text: string) => Promise<void> }) {
  const [people, setPeople] = useState<Person[] | null>(null), [chosen, setChosen] = useState(group.members.map(person => person.userId));
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  useEffect(() => { api<{ people: Person[] }>("/people").then(result => setPeople(result.people.filter(person => person.role === "educator")), cause => setError(message(cause))); }, []);
  async function submit(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError("");
    try { await api(`/access/groups/${group.id}/members`, "PUT", { userIds: chosen }); await onDone(`Personas de «${group.name}» guardadas.`); }
    catch (cause) { setError(message(cause)); setBusy(false); }
  }
  const listed = [...(people || []), ...group.members.filter(member => !people?.some(person => person.id === member.userId)).map(member => ({ id: member.userId, username: member.username, name: member.name, role: "educator" }))];
  const title = `Personas de «${group.name}»`;
  return <Modal title={title} onClose={onClose}>{!people && !error ? <Loading label="Cargando educadores…" lines={3}/> : <form className="stack" aria-label={title} onSubmit={submit}><fieldset className="stack" disabled={busy}>
    {error && <p className="form-alert" role="alert"><Icon name="alert" size={18}/>{error}</p>}
    <fieldset className="choice-field"><legend>Educadores</legend>
      {listed.length ? <ul className="scope-programs">{listed.map(person => <li key={person.id}><label className="switch"><input type="checkbox" checked={chosen.includes(person.id)} onChange={event => setChosen(current => event.target.checked ? [...current, person.id] : current.filter(id => id !== person.id))}/><span>{person.name} <span className="muted small">@{person.username}</span></span></label></li>)}</ul>
        : <p className="muted">No hay educadores activos.</p>}
    </fieldset>
    <p className="muted small">Administración ya tiene todos los accesos, por eso no se agrega a grupos.</p>
    <div className="button-row modal-actions"><button type="button" className="button secondary" onClick={onClose}>Cancelar</button><button className="button primary">{busy ? "Guardando…" : "Guardar personas"}</button></div>
  </fieldset></form>}</Modal>;
}

/** The coordination badge in the list of people. */
export function CoordinationBadge({ scope }: { scope: ProgramScope }) {
  return <StatusBadge tone="info">{"all" in scope ? "Coordinación: todos los programas" : `Coordinación: ${scope.programs.length === 1 ? "1 programa" : `${scope.programs.length} programas`}`}</StatusBadge>;
}
