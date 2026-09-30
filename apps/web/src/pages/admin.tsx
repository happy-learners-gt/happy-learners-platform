import { useEffect, useState } from "react";
import type { FormEvent, ReactNode } from "react";
import type { Member, Organization, Taxonomy, TaxonomyTerm, Vocabulary } from "@happy-learners/contracts";
import { api, message } from "../api";
import { useNavigation, useUnsavedChanges } from "../navigation";
import { useSession } from "../session";
import { Modal, useFeedback } from "../ui/feedback";
import { Icon } from "../ui/icons";
import { Menu } from "../ui/Menu";
import { EmptyState, ErrorState, Field, Loading, PageHeader, PrimaryAction, StatusBadge } from "../ui/primitives";

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
  useUnsavedChanges(dirty);
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError("");
    try { const result = await api<{ organization: Organization }>("/organization", "PUT", Object.fromEntries(new FormData(event.currentTarget))); setDirty(false); guard(false); setOrganization(result.organization); toast({ message: "Organización guardada." }); }
    catch (cause) { setError(message(cause)); }
    finally { setBusy(false); }
  }
  return <>
    <PageHeader title="Organización" description="Nombre y zona horaria del espacio compartido."/>
    <form className="form-card reading" onSubmit={save} onChange={() => setDirty(true)}>
      {error && <p className="form-alert" role="alert"><Icon name="alert" size={18}/>{error}</p>}
      <fieldset disabled={busy} className="stack">
        <Field label="Nombre de la organización" hint="En la demostración usa un nombre ficticio."><input name="name" required minLength={3} maxLength={80} defaultValue={organization?.name || ""}/></Field>
        <Field label="Zona horaria"><select name="timezone" defaultValue={organization?.timezone}><option value="America/Guatemala">Guatemala</option><option value="America/Mexico_City">Ciudad de México</option><option value="America/Bogota">Bogotá</option></select></Field>
        <div className="form-actions"><button className="button primary">{busy ? "Guardando…" : "Guardar organización"}</button></div>
      </fieldset>
    </form>
  </>;
}

export function Members() {
  return <AdminOnly title="Educadores"><MemberList/></AdminOnly>;
}
function MemberList() {
  const { toast } = useFeedback();
  const [members, setMembers] = useState<Member[] | null>(null), [error, setError] = useState(""), [busy, setBusy] = useState("");
  const load = async () => { setError(""); try { setMembers((await api<{ members: Member[] }>("/members")).members); } catch (cause) { setError(message(cause)); } };
  useEffect(() => { void load(); }, []);
  async function update(member: Member, patch: Partial<Member>) {
    setBusy(member.id);
    try { await api(`/members/${member.id}`, "PUT", { role: patch.role || member.role, active: patch.active ?? member.active }); await load(); toast({ message: `Permisos de ${member.username} guardados. Sus sesiones abiertas se cerraron.` }); }
    catch (cause) { toast({ tone: "error", message: message(cause) }); }
    finally { setBusy(""); }
  }
  const header = <PageHeader title="Educadores" description="Quién puede entrar y qué puede hacer. Los estudiantes no necesitan cuenta."/>;
  if (error) return <>{header}<ErrorState error={error} retry={() => void load()}/></>;
  if (!members) return <>{header}<Loading label="Cargando equipo…"/></>;
  return <>
    {header}
    <div className="table-card"><table>
      <caption className="sr-only">Cuentas del equipo</caption>
      <thead><tr><th scope="col">Usuario</th><th scope="col">Rol</th><th scope="col">Acceso</th><th scope="col"><span className="sr-only">Acciones</span></th></tr></thead>
      <tbody>{members.map(member => {
        const owner = member.id === "user-0";
        return <tr key={member.id}>
          <th scope="row">{member.username}</th>
          <td>{member.role === "admin" ? "Administración" : "Educador"}</td>
          <td><StatusBadge tone={member.active ? "success" : "neutral"}>{member.active ? "Activo" : "Sin acceso"}</StatusBadge></td>
          <td className="cell-actions">{owner ? <span className="muted small">Cuenta principal</span> : <Menu label={`Acciones de ${member.username}`} items={[
            { label: member.role === "admin" ? "Cambiar a educador" : "Cambiar a administración", icon: "users", disabled: busy === member.id, onSelect: () => void update(member, { role: member.role === "admin" ? "educator" : "admin" }) },
            { label: member.active ? "Quitar acceso" : "Dar acceso", icon: "shield", danger: member.active, disabled: busy === member.id, onSelect: () => void update(member, { active: !member.active }) },
          ]}/>}</td>
        </tr>;
      })}</tbody>
    </table></div>
  </>;
}

export function Taxonomies() {
  return <AdminOnly title="Clasificaciones"><TaxonomyEditor/></AdminOnly>;
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
      setTaxonomy(result); setEditing(null); toast({ message: "Clasificación guardada. Los contenidos existentes conservan sus referencias." });
    } catch (cause) { toast({ tone: "error", message: message(cause) }); }
    finally { setBusy(false); }
  }
  const header = <PageHeader title="Clasificaciones" description="Vocabularios opcionales para ordenar cursos y recursos. No establecen requisitos." primary={taxonomy && <PrimaryAction icon="plus" onClick={() => setEditing({ kind: "vocabulary" })}>Crear vocabulario</PrimaryAction>}/>;
  if (error) return <>{header}<ErrorState error={error} retry={() => void load()}/></>;
  if (!taxonomy) return <>{header}<Loading label="Cargando clasificaciones…"/></>;
  return <>
    {header}
    {!taxonomy.vocabularies.length && <EmptyState icon="list" title="Sin vocabularios" action={<PrimaryAction icon="plus" onClick={() => setEditing({ kind: "vocabulary" })}>Crear vocabulario</PrimaryAction>}>Por ejemplo, “Disciplina” con los términos Artes, Ciencias e Idiomas.</EmptyState>}
    <div className="stack">{taxonomy.vocabularies.map(vocabulary => <section key={vocabulary.id} className="panel" aria-labelledby={`vocabulary-${vocabulary.id}`}>
      <div className="panel-header"><h2 id={`vocabulary-${vocabulary.id}`}>{vocabulary.name}</h2>{vocabulary.status === "archived" && <StatusBadge>Archivado</StatusBadge>}
        <Menu label={`Acciones de ${vocabulary.name}`} items={[
          { label: "Editar vocabulario", icon: "edit", onSelect: () => setEditing({ kind: "vocabulary", item: vocabulary }) },
          { label: "Agregar término", icon: "plus", disabled: vocabulary.status !== "active", onSelect: () => setEditing({ kind: "term", parent: vocabulary.id }) },
        ]}/>
      </div>
      <ul className="chips">{taxonomy.terms.filter(term => term.vocabularyId === vocabulary.id).map(term => <li key={term.id}><button type="button" className={`chip-button${term.status === "archived" ? " is-archived" : ""}`} aria-label={`Editar término ${term.name}${term.status === "archived" ? " (archivado)" : ""}`} disabled={vocabulary.status !== "active"} onClick={() => setEditing({ kind: "term", item: term, parent: vocabulary.id })}>{term.name}{term.status === "archived" ? " · archivado" : ""}</button></li>)}</ul>
    </section>)}</div>
    {editing && <Modal title={`${editing.item ? "Editar" : "Crear"} ${editing.kind === "term" ? "término" : "vocabulario"}`} onClose={() => setEditing(null)}>
      <form className="stack" onSubmit={save}>
        <fieldset disabled={busy} className="stack">
          <Field label="Nombre"><input name="name" required maxLength={80} defaultValue={editing.item?.name}/></Field>
          <Field label="Estado"><select name="status" defaultValue={editing.item?.status || "active"}><option value="active">Activo</option><option value="archived">Archivado</option></select></Field>
          <div className="modal-actions"><button type="button" className="button ghost" onClick={() => setEditing(null)}>Cancelar</button><button className="button primary">Guardar</button></div>
        </fieldset>
      </form>
    </Modal>}
  </>;
}
