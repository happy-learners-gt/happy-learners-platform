import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import type { LessonAssignment } from "@happy-learners/contracts";
import { api, message } from "../../api";
import { Link } from "../../navigation";
import { sessionDay, today } from "../../model";
import { Modal, useFeedback } from "../../ui/feedback";
import { Icon } from "../../ui/icons";
import { EmptyState, ErrorState, Field, Loading, PageHeader, PrimaryAction, StatusBadge } from "../../ui/primitives";
import type { Tone } from "../../ui/primitives";
import { useCourse } from "./context";
import { MissingLink, OpenPublication } from "../../ui/assignments";
import type { GroupView } from "./Groups";

type Option = { id: string; title: string; unit?: string };
const period: Record<LessonAssignment["period"], [string, Tone]> = { active: ["Vigente", "success"], upcoming: ["Programada", "info"], ended: ["Finalizada", "neutral"] };

/** "Del 5 de oct. al 30 de oct." or "Desde el 5 de oct." */
export function validity(assignment: Pick<LessonAssignment, "startsOn" | "endsOn">) {
  const start = sessionDay(assignment.startsOn, "short");
  return assignment.endsOn ? `Del ${start} al ${sessionDay(assignment.endsOn, "short")}` : `Desde el ${start}`;
}

export function Schedule() {
  const { course, lessons, units, writable } = useCourse();
  const { toast } = useFeedback();
  const [groups, setGroups] = useState<GroupView[] | null>(null), [items, setItems] = useState<LessonAssignment[]>([]), [error, setError] = useState("");
  const [creating, setCreating] = useState<string | null>(null), [busy, setBusy] = useState("");
  // The organization's calendar day, not the browser's: periods are evaluated in the organization's time zone.
  const [orgToday, setOrgToday] = useState(today());
  const base = `/courses/${course.id}`, page = `/cursos/${course.id}`;
  // Only what students can open is offered: published lessons that are not archived.
  const published: Option[] = lessons.filter(lesson => lesson.status === "published" && lesson.revision)
    .map(lesson => ({ id: lesson.id, title: lesson.title, unit: units.find(unit => unit.id === lesson.courseUnitId)?.name }));
  async function load() {
    setError("");
    try {
      const [g, a] = await Promise.all([api<{ groups: GroupView[] }>(`${base}/groups`), api<{ assignments: LessonAssignment[]; today: string }>(`${base}/assignments`)]);
      setGroups(g.groups.filter(group => group.status === "active")); setItems(a.assignments); setOrgToday(a.today);
    } catch (cause) { setError(message(cause)); }
  }
  useEffect(() => { if (course.status === "active") void load(); }, [course.id]);
  async function change(assignment: LessonAssignment, body: Record<string, string>, done: string) {
    setBusy(assignment.id);
    try { await api(`${base}/assignments/${assignment.id}`, "PUT", body); await load(); toast({ message: done }); }
    catch (cause) { toast({ tone: "error", message: message(cause) }); }
    finally { setBusy(""); }
  }
  const canAssign = writable && !!groups?.length && published.length > 0;
  const header = <PageHeader crumbs={[{ label: "Cursos", href: "/cursos" }, { label: course.title, href: page }, { label: "Cronograma" }]} title="Cronograma"
    description="Programa qué lección publicada usa cada grupo y durante qué fechas. Si la lección cambia o se archiva, aquí lo verás."
    primary={canAssign && <PrimaryAction icon="plus" onClick={() => setCreating("")}>Programar lección</PrimaryAction>}/>;
  if (course.status !== "active") return <>{header}<EmptyState icon="archive" title="Curso archivado">Restaura el curso desde Configuración para gestionar su cronograma.</EmptyState></>;
  if (error) return <>{header}<ErrorState error={error} retry={() => void load()}/></>;
  if (!groups) return <>{header}<Loading label="Cargando cronograma…" lines={5}/></>;
  if (!groups.length) return <>{header}<EmptyState icon="users" title="Primero crea un grupo" action={<Link className="button primary" href={`${page}/grupos`}>Ir a Grupos</Link>}>El cronograma se organiza por grupo. Crea uno para empezar.</EmptyState></>;
  return <>
    {header}
    {/* No published lesson is a different situation from a group without assignments. */}
    {!published.length && <div className="notice warning" role="status"><Icon name="alert" size={18}/><div><strong>Este curso no tiene lecciones publicadas</strong><p>Publica una lección desde Contenido para poder programarla.</p><Link className="button secondary small" href={`${page}/contenido`}>Ir a Contenido</Link></div></div>}
    <div className="assignment-groups">{groups.map(group => {
      const own = items.filter(item => item.groupId === group.id);
      return <section key={group.id} className="panel assignment-group" aria-labelledby={`assign-${group.id}`}>
        <div className="panel-header"><h2 id={`assign-${group.id}`}>{group.name}</h2>
          {canAssign && <button type="button" className="button secondary small" onClick={() => setCreating(group.id)}><Icon name="plus" size={16}/>Programar para {group.name}</button>}</div>
        {own.length ? <ul className="assignment-list">{own.map(item => {
          const [label, tone] = period[item.period];
          return <li key={item.id} className={`assignment-row${item.requiresSubstitution ? " needs-action" : ""}`} aria-busy={busy === item.id || undefined}>
            <div className="assignment-main">
              <strong>{item.lessonTitle}</strong>
              <span className="muted small">{[item.unitName, validity(item)].filter(Boolean).join(" · ")}</span>
            </div>
            <div className="assignment-state">
              <StatusBadge tone={tone}>{label}</StatusBadge>
              {item.availability === "current" && <StatusBadge tone="success">Publicación {item.assignedRevision}</StatusBadge>}
              {item.availability === "updated" && <StatusBadge tone="info">Publicación {item.publishedRevision} (programada la {item.assignedRevision})</StatusBadge>}
              {item.availability === "unavailable" && <StatusBadge tone="danger">Requiere sustitución</StatusBadge>}
            </div>
            {item.availability === "updated" && <p className="assignment-note"><Icon name="info" size={16}/>La lección se volvió a publicar. El grupo ya recibe la publicación {item.publishedRevision}.</p>}
            {item.availability !== "unavailable" && !item.effective && <MissingLink assignment={item}/>}
            {item.availability === "unavailable" && <p className="assignment-note danger"><Icon name="alert" size={16}/>La lección programada ya no tiene una publicación vigente: fue archivada o retirada. Sustitúyela por otra lección publicada.</p>}
            <div className="assignment-actions">
              <OpenPublication assignment={item}/>
              {writable && <>
              {item.availability === "updated" && <button type="button" className="button secondary small" disabled={!!busy} onClick={() => void change(item, { action: "adopt" }, `Confirmaste la publicación ${item.publishedRevision} para ${group.name}.`)}><Icon name="check" size={16}/>Confirmar publicación vigente</button>}
              {item.availability === "unavailable" && published.length > 0 && <Substitute item={item} options={published} disabled={!!busy} onSubmit={lessonId => change(item, { action: "substitute", lessonId }, `Cronograma de ${group.name} actualizado.`)}/>}
              <button type="button" className="button ghost small" disabled={!!busy} onClick={() => void change(item, { action: "withdraw" }, `«${item.lessonTitle}» se retiró de ${group.name}.`)}>Retirar</button>
              </>}
            </div>
          </li>;
        })}</ul> : <p className="muted">Este grupo aún no tiene lecciones en el cronograma.</p>}
      </section>;
    })}</div>
    {creating !== null && <NewAssignment groups={groups} initialGroup={creating} lessons={published} today={orgToday} onClose={() => setCreating(null)} onCreate={async () => { await load(); setCreating(null); }}/>}
  </>;
}

function Substitute({ item, options, disabled, onSubmit }: { item: LessonAssignment; options: Option[]; disabled: boolean; onSubmit: (lessonId: string) => Promise<void> }) {
  const [value, setValue] = useState(options.find(option => option.id !== item.lessonId)?.id || options[0].id);
  return <form className="substitute" aria-label={`Sustituir ${item.lessonTitle}`} onSubmit={event => { event.preventDefault(); void onSubmit(value); }}>
    <label htmlFor={`substitute-${item.id}`} className="sr-only">Lección publicada que sustituye a {item.lessonTitle}</label>
    <select id={`substitute-${item.id}`} value={value} onChange={event => setValue(event.target.value)} disabled={disabled}>{options.map(option => <option key={option.id} value={option.id}>{option.title}</option>)}</select>
    <button className="button primary small" disabled={disabled}>Sustituir</button>
  </form>;
}

function NewAssignment({ groups, initialGroup, lessons, today, onClose, onCreate }: { groups: GroupView[]; initialGroup: string; lessons: Option[]; today: string; onClose: () => void; onCreate: () => Promise<void> }) {
  const { course } = useCourse();
  const { toast } = useFeedback();
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError("");
    const data = Object.fromEntries(new FormData(event.currentTarget)) as Record<string, string>;
    try {
      await api(`/courses/${course.id}/assignments`, "POST", data);
      toast({ message: `Lección programada para ${groups.find(group => group.id === data.groupId)?.name}.` });
      await onCreate();
    } catch (cause) { setError(message(cause)); setBusy(false); }
  }
  return <Modal title="Programar lección" onClose={onClose}>
    <form className="stack" onSubmit={submit}>
      {error && <p className="form-alert" role="alert"><Icon name="alert" size={18}/>{error}</p>}
      <fieldset disabled={busy} className="stack">
        <Field label="Grupo"><select name="groupId" required defaultValue={groups.some(group => group.id === initialGroup) ? initialGroup : groups[0]?.id}>{groups.map(group => <option key={group.id} value={group.id}>{group.name}</option>)}</select></Field>
        <Field label="Lección" hint="Solo lecciones publicadas."><select name="lessonId" required defaultValue={lessons[0]?.id}>{lessons.map(lesson => <option key={lesson.id} value={lesson.id}>{lesson.unit ? `${lesson.title} · ${lesson.unit}` : lesson.title}</option>)}</select></Field>
        <div className="field-row">
          <Field label="Desde"><input name="startsOn" type="date" required defaultValue={today}/></Field>
          <Field label="Hasta" optional hint="Déjalo vacío si no tiene fecha de término."><input name="endsOn" type="date"/></Field>
        </div>
        <div className="modal-actions"><button type="button" className="button ghost" onClick={onClose}>Cancelar</button><button className="button primary">{busy ? "Programando…" : "Programar"}</button></div>
      </fieldset>
    </form>
  </Modal>;
}
