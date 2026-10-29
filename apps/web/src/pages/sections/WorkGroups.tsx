import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import type { GroupActivity, GroupLearner, SectionWorkGroups, WorkGroup } from "@happy-learners/contracts";
import { groupings, wholeSection } from "@happy-learners/domain";
import { api, message } from "../../api";
import { Link } from "../../navigation";
import { plural } from "../../model";
import { Modal, useFeedback } from "../../ui/feedback";
import { Icon } from "../../ui/icons";
import { Button, EmptyState, ErrorState, Field, Loading, PageHeader, PrimaryAction, Section } from "../../ui/primitives";
import { useCourse } from "../course/context";
import { sectionCrumbs, useSection } from "./context";
import { GroupSets, type GroupActivityRow } from "./GroupSets";

type Data = SectionWorkGroups & { learners: GroupLearner[] };

/**
 * Grupos of a section (DEC-028): the section's students are the universe. The whole section is the default group;
 * its educators form smaller groups from its list and choose which of them do each activity in pairs or teams.
 */
export function SectionWorkGroupsPage() {
  const { course, configurable, teaches, settings } = useCourse();
  const { section, base } = useSection();
  const { toast } = useFeedback();
  const [data, setData] = useState<Data | null>(null), [error, setError] = useState("");
  const [editing, setEditing] = useState<WorkGroup | "new" | null>(null), [assigning, setAssigning] = useState<GroupActivity | null>(null), [forming, setForming] = useState(false), [revision, setRevision] = useState(0), [shared, setShared] = useState<GroupActivityRow[]>([]), [sets, setSets] = useState<{ id: string; name: string }[]>([]);
  const path = `/courses/${course.id}/groups/${section.id}`;
  const enabled = settings.attendance && settings.workGroups;
  const writable = enabled && (configurable || teaches(section.id)) && section.status === "active" && course.status === "active";
  async function load() {
    setError("");
    try {
      const [groups, { group }] = await Promise.all([api<SectionWorkGroups>(`${path}/work-groups`), api<{ group: { learners: GroupLearner[] } }>(path)]);
      setData({ ...groups, learners: group.learners });
    } catch (cause) { setError(message(cause)); }
  }
  useEffect(() => { void load(); }, [section.id]);
  const header = <PageHeader crumbs={sectionCrumbs(section, { label: "Grupos" })} title="Grupos de trabajo"
    description="Forma los grupos de la sección una vez y úsalos en las actividades de las lecciones y en las evaluaciones en grupos."
    primary={writable && data ? <PrimaryAction icon="team" onClick={() => setForming(true)}>Formar grupos</PrimaryAction> : undefined}/>;
  if (!enabled) return <>{header}<EmptyState icon="team" title="Los grupos de trabajo están desactivados" action={configurable && <Link className="button secondary" href={`/cursos/${course.id}/configuracion`}>Abrir la configuración</Link>}>Actívalos en la configuración del curso (o de su programa) para formar grupos en cada sección y asignarlos a las actividades.</EmptyState></>;
  if (error) return <>{header}<ErrorState error={error} retry={() => void load()}/></>;
  if (!data) return <>{header}<Loading label="Cargando grupos…" lines={5}/></>;
  async function chooseSet(activityId: string, setId: string) {
    if (!setId) return;
    try { await api(`/sections/${section.id}/group-sets/assignments`, "PUT", { kind: "assessment", activityId, setId }); setRevision(value => value + 1); toast({ message: "Conjunto elegido." }); }
    catch (cause) { toast({ tone: "error", message: message(cause) }); }
  }
  return <>
    {header}
    <GroupSets sectionId={section.id} courseId={course.id} learners={data.learners} workGroups={data.workGroups} writable={writable} forming={forming} onForming={setForming} revision={revision} onNewGroup={() => setEditing("new")} onActivities={rows => { setShared(rows); }} onSets={setSets} onToast={(text, error) => toast(error ? { tone: "error", message: text } : { message: text })}/>
    <Section title="Actividades en grupos">
      {!data.activities.length && !shared.some(item => item.kind === "assessment") ? <EmptyState compact icon="team" title="Todavía no hay actividades en grupos">En el editor de lecciones, elige «En parejas» o «En equipos» y publica la lección. En Evaluación, marca una actividad como «En grupos».</EmptyState>
        : <div className="coverage-scroll" role="region" aria-label="Actividades en grupos" tabIndex={0}>
          <table className="coverage-table group-activities">
            <thead><tr><th scope="col">Actividad</th><th scope="col">Dónde</th><th scope="col">La trabajan</th>{writable && <th scope="col"><span className="sr-only">Acciones</span></th>}</tr></thead>
            <tbody>
              {data.activities.map(activity => <tr key={`${activity.lessonId}:${activity.activityId}`}>
                <th scope="row">{activity.title}<span className="muted small">{activity.lessonTitle} · {activity.unitName}</span></th>
                <td data-label="Dónde">{groupings.find(item => item.value === activity.grouping)?.label}</td>
                <td data-label="La trabajan">{activity.workGroupIds.length ? data.workGroups.filter(group => activity.workGroupIds.includes(group.id)).map(group => group.name).join(", ") : <span className="muted">{wholeSection}</span>}</td>
                {writable && <td><Button icon="team" className="small" onClick={() => setAssigning(activity)} aria-label={`Asignar grupos a ${activity.title}`}>Asignar</Button></td>}
              </tr>)}
              {shared.filter(item => item.kind === "assessment").map(activity => <tr key={activity.activityId}>
                <th scope="row">{activity.title}<span className="muted small">{activity.detail}</span></th>
                <td data-label="Dónde">Evaluación</td>
                <td data-label="La trabajan">{activity.setId ? sets.find(item => item.id === activity.setId)?.name || "Conjunto elegido" : <Link href={`/secciones/${section.id}/grupos`}>Elige los grupos</Link>}</td>
                {writable && <td><label className="sr-only" htmlFor={`set-${activity.activityId}`}>Conjunto de {activity.title}</label>
                  <select id={`set-${activity.activityId}`} value={activity.setId || ""} onChange={event => void chooseSet(activity.activityId, event.target.value)}>
                    <option value="">Elige un conjunto</option>
                    {sets.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
                  </select>
                </td>}
              </tr>)}
            </tbody>
          </table>
        </div>}
    </Section>
    {editing && <GroupDialog path={path} group={editing === "new" ? null : editing} learners={data.learners} groups={data.workGroups} onClose={() => setEditing(null)} onSaved={async name => { setEditing(null); await load(); setRevision(value => value + 1); toast({ message: editing === "new" ? `«${name}» quedó formado.` : `«${name}» se actualizó.` }); }}/>}
    {assigning && <AssignDialog path={path} activity={assigning} groups={data.workGroups} onClose={() => setAssigning(null)} onSaved={async () => { setAssigning(null); await load(); toast({ message: `Grupos de «${assigning.title}» actualizados.` }); }}/>}
  </>;
}

function GroupDialog({ path, group, learners, groups, onClose, onSaved }: { path: string; group: WorkGroup | null; learners: GroupLearner[]; groups: WorkGroup[]; onClose: () => void; onSaved: (name: string) => Promise<void> }) {
  const [name, setName] = useState(group?.name || `Grupo ${groups.length + 1}`), [chosen, setChosen] = useState<string[]>(group?.learnerIds || []);
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  const toggle = (id: string) => setChosen(current => current.includes(id) ? current.filter(item => item !== id) : [...current, id]);
  async function submit(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError("");
    try { await api(group ? `${path}/work-groups/${group.id}` : `${path}/work-groups`, group ? "PUT" : "POST", { name: name.trim(), learnerIds: chosen }); await onSaved(name.trim()); }
    catch (cause) { setError(message(cause)); setBusy(false); }
  }
  const elsewhere = (id: string) => groups.filter(item => item.id !== group?.id && item.learnerIds.includes(id)).map(item => item.name);
  return <Modal title={group ? `Editar «${group.name}»` : "Nuevo grupo"} onClose={onClose} wide>
    <form className="stack" onSubmit={submit}>
      {error && <p className="form-alert" role="alert"><Icon name="alert" size={18}/>{error}</p>}
      <fieldset disabled={busy} className="stack">
        <Field label="Nombre del grupo"><input value={name} maxLength={60} onChange={event => setName(event.target.value)} required autoFocus/></Field>
        <fieldset className="stack">
          <legend>Integrantes <span className="muted small">· {plural(chosen.length, "elegido", "elegidos")}</span></legend>
          {learners.length ? <ul className="chips">{learners.map(learner => {
            const other = elsewhere(learner.id);
            return <li key={learner.id} className="chip" title={other.length ? `También en ${other.join(", ")}` : undefined}>
              <input type="checkbox" checked={chosen.includes(learner.id)} onChange={() => toggle(learner.id)} aria-label={other.length ? `${learner.displayName} (también en ${other.join(", ")})` : learner.displayName}/>
              <span>{learner.displayName}{other.length > 0 && <small className="chip-note">· {other.join(", ")}</small>}</span>
            </li>;
          })}</ul> : <p className="muted">La sección aún no tiene estudiantes.</p>}
        </fieldset>
        <div className="modal-actions"><button type="button" className="button ghost" onClick={onClose}>Cancelar</button><button className="button primary">{busy ? "Guardando…" : group ? "Guardar grupo" : "Formar grupo"}</button></div>
      </fieldset>
    </form>
  </Modal>;
}

function AssignDialog({ path, activity, groups, onClose, onSaved }: { path: string; activity: GroupActivity; groups: WorkGroup[]; onClose: () => void; onSaved: () => Promise<void> }) {
  const [chosen, setChosen] = useState<string[]>(activity.workGroupIds), [busy, setBusy] = useState(false), [error, setError] = useState("");
  const toggle = (id: string) => setChosen(current => current.includes(id) ? current.filter(item => item !== id) : [...current, id]);
  async function submit(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError("");
    try { await api(`${path}/activity-groups`, "PUT", { lessonId: activity.lessonId, activityId: activity.activityId, workGroupIds: chosen }); await onSaved(); }
    catch (cause) { setError(message(cause)); setBusy(false); }
  }
  return <Modal title={`¿Quién trabaja «${activity.title}»?`} onClose={onClose}>
    <form className="stack" onSubmit={submit}>
      {error && <p className="form-alert" role="alert"><Icon name="alert" size={18}/>{error}</p>}
      <fieldset disabled={busy} className="stack">
        <p className="muted">{activity.lessonTitle} · {groupings.find(item => item.value === activity.grouping)?.label}</p>
        <ul className="chips">
          <li className="chip"><input type="radio" checked={!chosen.length} onChange={() => setChosen([])} aria-label={wholeSection}/><span>{wholeSection}</span></li>
          {groups.map(group => <li key={group.id} className="chip"><input type="checkbox" checked={chosen.includes(group.id)} onChange={() => toggle(group.id)} aria-label={group.name}/><span>{group.name}<small className="chip-note">· {group.learnerIds.length}</small></span></li>)}
        </ul>
        {!groups.length && <p className="muted small">La sección aún no tiene grupos: la actividad la trabaja {wholeSection.toLowerCase()}. Forma grupos con «Nuevo grupo».</p>}
        <div className="modal-actions"><button type="button" className="button ghost" onClick={onClose}>Cancelar</button><button className="button primary">{busy ? "Guardando…" : "Guardar"}</button></div>
      </fieldset>
    </form>
  </Modal>;
}
