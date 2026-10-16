import { useEffect, useMemo, useState } from "react";
import type { FormEvent, ReactNode } from "react";
import type { AcademicProfile, CourseFormat, CourseSettings, EducationLevel, EducationType, Member, Modality, ModuleLabel, Organization, Pacing, SequenceTemplate, StudyProgram, Taxonomy, TaxonomyTerm, Vocabulary } from "@happy-learners/contracts";
import { accountInput, areaLabel, courseFormats, coursePresets, derivedSettings, educationLevels, educationTypes, knowledgeAreas, labelOf, modalities, moduleLabels, moduleNoun, pacings, sequenceOf, sequenceTemplates, settingDefinitions, timezoneGroups, utcOffset } from "@happy-learners/domain";
import type { SettingKey } from "@happy-learners/domain";
import { plural, timeAgo } from "../model";
import { ActivityFeed, Avatar, CourseProgressList, useProgress } from "../ui/progress";
import { api, message } from "../api";
import { useNavigation, useUnsavedChanges } from "../navigation";
import { useSession } from "../session";
import { Modal, useFeedback } from "../ui/feedback";
import { Icon } from "../ui/icons";
import { Menu } from "../ui/Menu";
import { EmptyState, ErrorState, Field, Loading, PageHeader, PrimaryAction, Section, StatusBadge } from "../ui/primitives";
import { DaysOff } from "./calendar";
import { ProgramPathDialog } from "./programPath";
import { Invitations } from "./invitations";

function AdminOnly({ title, children }: { title: string; children: ReactNode }) {
  const { member } = useSession();
  if (member.role !== "admin") return <><PageHeader title={title}/><EmptyState icon="shield" title="Esta sección es para administración">Tu cuenta prepara cursos y lecciones. Pide a administración cualquier cambio de organización o permisos.</EmptyState></>;
  return <>{children}</>;
}

export function OrganizationSettings() {
  return <AdminOnly title="Organización"><OrganizationForm/></AdminOnly>;
}
function OrganizationForm() {
  const { organization, setOrganization } = useSession();
  const { guard } = useNavigation();
  const { toast } = useFeedback();
  const [dirty, setDirty] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState("");
  const [zone, setZone] = useState(organization?.timezone || "America/Guatemala");
  const zones = useMemo(() => timezoneGroups(organization?.timezone), [organization?.timezone]);
  useUnsavedChanges(dirty);
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError("");
    try { const result = await api<{ organization: Organization }>("/organization", "PUT", Object.fromEntries(new FormData(event.currentTarget))); setDirty(false); guard(false); setOrganization(result.organization); toast({ message: "Organización guardada." }); }
    catch (cause) { setError(message(cause)); }
    finally { setBusy(false); }
  }
  return <>
    <PageHeader title="Organización" description="Nombre, zona horaria y calendario de días sin clase del espacio compartido."/>
    <form className="form-card reading" onSubmit={save} onChange={() => setDirty(true)}>
      {error && <p className="form-alert" role="alert"><Icon name="alert" size={18}/>{error}</p>}
      <fieldset disabled={busy} className="stack">
        <Field label="Nombre de la organización" hint="En la demostración usa un nombre ficticio."><input name="name" required minLength={3} maxLength={80} defaultValue={organization?.name || ""}/></Field>
        <Field label="Zona horaria" hint={`Hora local: ${new Intl.DateTimeFormat("es-GT", { timeZone: zone, hour: "2-digit", minute: "2-digit" }).format(new Date())} (${utcOffset(zone)}). El día de hoy y las fechas de las clases se calculan en esta zona.`}>
          <select name="timezone" value={zone} onChange={event => setZone(event.target.value)}>
            {zones.map(group => <optgroup key={group.region} label={group.region}>{group.zones.map(item => <option key={item.id} value={item.id}>{item.id} ({item.offset})</option>)}</optgroup>)}
          </select>
        </Field>
        <div className="form-actions"><button className="button primary">{busy ? "Guardando…" : "Guardar organización"}</button></div>
      </fieldset>
    </form>
    <div className="reading"><DaysOff writable/></div>
    <div className="reading">
      <Section title="Respaldo" action={<a className="button secondary small" href="/api/organization/backup" download><Icon name="download" size={16}/>Descargar respaldo</a>}>
        <p className="muted">Una copia en JSON de los cursos, las lecciones, las secciones, el calendario y los registros de la organización. No incluye contraseñas, sesiones ni el contenido de los documentos subidos. Guárdala en un lugar privado: contiene los nombres de los estudiantes.</p>
      </Section>
    </div>
  </>;
}

export function Members() {
  return <AdminOnly title="Educadores"><MemberList/></AdminOnly>;
}
type MemberStats = Member & { leads: number; coTeaches: number; lessonsCreated: number; publications: number; attendance: number; events: number; lastActivity: string | null };
/** People of the organization, what each one does and how their courses are progressing. */
function MemberList() {
  const { toast, confirm } = useFeedback();
  const [members, setMembers] = useState<MemberStats[] | null>(null), [error, setError] = useState(""), [busy, setBusy] = useState(""), [person, setPerson] = useState("");
  const [adding, setAdding] = useState(false), [inviting, setInviting] = useState(false), [issued, setIssued] = useState<Issued | null>(null), [revision, setRevision] = useState(0);
  const progress = useProgress();
  const load = async () => { setError(""); try { setMembers((await api<{ members: MemberStats[] }>("/members")).members); setRevision(value => value + 1); } catch (cause) { setError(message(cause)); } };
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
  const header = <PageHeader title="Educadores" description="Quién puede entrar, qué hace cada persona y cómo avanzan los cursos. Los estudiantes no necesitan cuenta."
    primary={members && <PrimaryAction icon="plus" onClick={() => setAdding(true)}>Agregar cuenta</PrimaryAction>}
    actions={members && <button type="button" className="button secondary" onClick={() => setInviting(true)}><Icon name="send" size={16}/>Invitar por correo</button>}/>;
  if (error) return <>{header}<ErrorState error={error} retry={() => void load()}/></>;
  if (!members) return <>{header}<Loading label="Cargando equipo…"/></>;
  const titles = Object.fromEntries((progress.courses || []).map(item => [item.courseId, item.title]));
  const selected = members.find(member => member.id === person);
  return <>
    {header}
    <div className="table-card" role="region" aria-label="Personas de la organización" tabIndex={0}><table className="members-table">
      <caption className="sr-only">Personas de la organización y su actividad</caption>
      <thead><tr><th scope="col">Persona</th><th scope="col">Rol</th><th scope="col">Cursos</th><th scope="col">Lecciones</th><th scope="col">Clases registradas</th><th scope="col">Última actividad</th><th scope="col">Acceso</th><th scope="col"><span className="sr-only">Acciones</span></th></tr></thead>
      <tbody>{members.map(member => {
        const owner = member.id === "user-0", name = member.displayName || member.username;
        return <tr key={member.id}>
          <th scope="row"><span className="person-cell"><Avatar name={name} size={30}/><span><button type="button" className="link-button" onClick={() => setPerson(person === member.id ? "" : member.id)} aria-pressed={person === member.id}>{name}</button><span className="muted small">@{member.username}{member.email ? ` · ${member.email}` : ""}</span></span></span></th>
          <td>{member.role === "admin" ? "Administración" : "Educador"}</td>
          <td>{member.leads || member.coTeaches ? <>{member.leads ? `responsable de ${member.leads}` : ""}{member.leads && member.coTeaches ? " · " : ""}{member.coTeaches ? `colabora en ${member.coTeaches}` : ""}</> : <span className="muted">—</span>}</td>
          <td>{member.lessonsCreated ? `${member.lessonsCreated} creadas · ${member.publications} publicaciones` : <span className="muted">—</span>}</td>
          <td>{member.attendance || <span className="muted">—</span>}</td>
          <td>{member.lastActivity ? <time dateTime={member.lastActivity}>{timeAgo(member.lastActivity)}</time> : <span className="muted">Sin actividad</span>}</td>
          <td><StatusBadge tone={!member.active ? "neutral" : member.mustChangePassword ? "warning" : "success"}>{!member.active ? "Sin acceso" : member.mustChangePassword ? "Contraseña temporal" : "Activo"}</StatusBadge></td>
          <td className="cell-actions">{owner ? <span className="muted small">Cuenta principal</span> : <Menu label={`Acciones de ${name}`} items={[
            { label: member.role === "admin" ? "Cambiar a educador" : "Cambiar a administración", icon: "users", disabled: busy === member.id, onSelect: () => void update(member, { role: member.role === "admin" ? "educator" : "admin" }) },
            { label: "Restablecer contraseña", icon: "undo", disabled: busy === member.id, onSelect: () => void reset(member) },
            { label: member.active ? "Quitar acceso" : "Dar acceso", icon: "shield", danger: member.active, disabled: busy === member.id, onSelect: () => void update(member, { active: !member.active }) },
          ]}/>}</td>
        </tr>;
      })}</tbody>
    </table></div>
    <Invitations inviting={inviting} onInviting={setInviting} onChanged={() => void load()}/>
    <div className="admin-grid">
      <Section title="Avance por curso">
        {progress.error ? <ErrorState error={progress.error} retry={() => void progress.reload()}/> : !progress.courses ? <Loading label="Calculando avance…" lines={4}/> : <CourseProgressList courses={progress.courses}/>}
      </Section>
      <Section title={selected ? `Actividad de ${selected.displayName || selected.username}` : "Actividad reciente de la organización"} action={selected && <button type="button" className="link-button" onClick={() => setPerson("")}>Ver toda</button>}>
        <ActivityFeed key={`${person}-${revision}`} actor={person || undefined} limit={15} courseTitles={titles}/>
      </Section>
    </div>
    {adding && <AccountDialog onClose={() => setAdding(false)} onCreated={async result => { setAdding(false); setIssued(result); await load(); }}/>}
    {issued && <TemporaryPassword issued={issued} onClose={() => setIssued(null)}/>}
  </>;
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
    <TaxonomyEditor/>
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
          program.status === "active" ? { label: "Archivar", icon: "archive", danger: true, onSelect: () => void setStatus(program, "archived") } : { label: "Restaurar", icon: "archive", onSelect: () => void setStatus(program, "active") },
        ]}/>
      </li>)}</ul>}
    {editing && <ProgramDialog item={editing.item} onClose={() => setEditing(null)} onSave={save}/>}
    {pathOf && <ProgramPathDialog program={pathOf} onClose={() => navigate("/configuracion-academica", true)}/>}
  </section>;
}

function ProgramDialog({ item, onClose, onSave }: { item?: StudyProgram; onClose: () => void; onSave: (body: Record<string, unknown>) => Promise<void> }) {
  const [profile, setProfile] = useState<AcademicProfile & { format: CourseFormat; area: string }>(item ? { educationType: item.educationType, level: item.level, modality: item.modality, pacing: item.pacing, format: item.format, area: item.area || "" } : { ...coursePresets[2].values, area: "" });
  const [settings, setSettings] = useState<CourseSettings>(item?.settings || {}), [locked, setLocked] = useState<SettingKey[]>(item?.locked || []), [busy, setBusy] = useState(false);
  const derived = derivedSettings(profile);
  const change = (patch: Partial<typeof profile>) => setProfile(current => { const next = { ...current, ...patch }; if (next.educationType === "formal" && next.level === "unspecified") next.level = "primary"; return next; });
  function setSetting(key: SettingKey, value: string) {
    setSettings(current => { const next = { ...current } as Record<string, unknown>; if (value === "") delete next[key]; else next[key] = value === "true" ? true : value === "false" ? false : value; return next as CourseSettings; });
    if (value === "") setLocked(current => current.filter(item => item !== key));
  }
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true);
    const form = new FormData(event.currentTarget);
    await onSave({ name: form.get("name"), description: form.get("description"), ...profile, area: profile.area || null, settings, locked, status: item?.status || "active" });
    setBusy(false);
  }
  const text = (key: SettingKey, value: unknown) => key === "moduleLabel" ? moduleNoun(value as ModuleLabel).Many : key === "defaultSequence" ? sequenceOf(value as SequenceTemplate).label : value ? "Sí" : "No";
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
        <ul className="settings-list">{settingDefinitions.map(definition => {
          const key = definition.key;
          const options: [string, string][] = key === "moduleLabel" ? moduleLabels.map(option => [option.value, moduleNoun(option.value).Many]) : key === "defaultSequence" ? sequenceTemplates.map(option => [option.value, option.label]) : [["true", "Sí"], ["false", "No"]];
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
      </fieldset>
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
