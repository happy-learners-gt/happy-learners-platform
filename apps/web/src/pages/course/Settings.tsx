import { useEffect, useState } from "react";
import type { CourseMember } from "@happy-learners/contracts";
import { api, message } from "../../api";
import { useFeedback } from "../../ui/feedback";
import { Icon } from "../../ui/icons";
import { Avatar, roleLabel } from "../../ui/progress";
import { Button, PageHeader, Section, StatusBadge } from "../../ui/primitives";
import { CourseForm, useCourseActions } from "../Courses";
import { useCourse } from "./context";

export function Settings() {
  const { course, reload, admin } = useCourse();
  const { toast } = useFeedback();
  const actions = useCourseActions(reload);
  const base = `/cursos/${course.id}`;
  const archived = course.status === "archived";
  const crumbs = [{ label: "Cursos", href: "/cursos" }, { label: course.title, href: base }, { label: "Configuración" }];
  if (admin) return <>
    <PageHeader crumbs={crumbs} title="Configuración" description="Administración decide quién forma el equipo docente del curso."/>
    <div className="reading stack-lg">{archived ? <p className="notice">Restaura el curso para cambiar su equipo.</p> : <TeamEditor/>}</div>
  </>;
  return <>
    <PageHeader crumbs={crumbs} title="Configuración" description="Nombre, objetivo, configuración académica y comportamiento del curso."/>
    <div className="reading stack-lg">
      {archived ? <p className="notice">Restaura el curso para editar sus datos.</p>
        : <CourseForm key={course.version} course={course} cancelHref={base} onSaved={async () => { await reload(); toast({ message: "Cambios del curso guardados." }); }}/>}
      {!archived && <TeamView/>}
      <Section title="Copiar o archivar" className="danger-zone">
        <div className="setting-row"><div><h3>Duplicar curso</h3><p className="muted">Crea una copia con su configuración, módulos, plan curricular, recursos y lecciones como borrador. No copia grupos ni asistencia.</p></div><Button icon="copy" onClick={() => void actions.duplicate(course)}>Duplicar</Button></div>
        <div className="setting-row"><div><h3>{archived ? "Restaurar curso" : "Archivar curso"}</h3><p className="muted">{archived ? "El curso vuelve a la lista de cursos activos y admite cambios." : "El curso deja de admitir cambios. Las lecciones publicadas siguen disponibles para estudiantes."}</p></div>
          {archived ? <Button icon="archive" onClick={() => void actions.setStatus(course, "active")}>Restaurar</Button> : <Button icon="archive" variant="danger" onClick={() => void actions.setStatus(course, "archived")}>Archivar</Button>}
        </div>
      </Section>
    </div>
  </>;
}

const teamNote = "La persona responsable responde por el curso y su avance; quienes colaboran preparan lecciones y registran clases. Solo el equipo del curso consulta y registra sus secciones, clases y asistencia.";

/** What educators see: the team, without controls. Administration changes it. */
function TeamView() {
  const { course } = useCourse();
  const team = course.team || [];
  return <section id="equipo" className="panel" aria-labelledby="team-title">
    <div className="panel-header"><h2 id="team-title">Equipo docente</h2></div>
    <p className="muted">{teamNote} Administración gestiona el equipo.</p>
    {team.length ? <ul className="team-list">{team.map(member => <li key={member.userId}>
      <Avatar name={member.name} size={32}/><div><strong>{member.name}</strong><span className="muted small">@{member.username}</span></div>
      <StatusBadge tone={member.role === "lead" ? "info" : "neutral"}>{roleLabel[member.role]}</StatusBadge>
    </li>)}</ul> : <p className="muted small">Sin equipo asignado.</p>}
  </section>;
}

type Person = { id: string; username: string; name: string; role: string };
/** The teaching team: one lead (who answers for the course) and co-teachers. Only administration edits it. */
function TeamEditor() {
  const { course, reload } = useCourse();
  const { toast } = useFeedback();
  const [people, setPeople] = useState<Person[]>([]), [team, setTeam] = useState<CourseMember[]>(course.team || []), [adding, setAdding] = useState(""), [busy, setBusy] = useState(false);
  useEffect(() => { api<{ people: Person[] }>("/people").then(result => setPeople(result.people)).catch(() => undefined); }, []);
  useEffect(() => { setTeam(course.team || []); }, [course.version]);
  const dirty = JSON.stringify(team.map(item => [item.userId, item.role])) !== JSON.stringify((course.team || []).map(item => [item.userId, item.role]));
  const available = people.filter(person => !team.some(member => member.userId === person.id));
  const setRole = (userId: string, role: CourseMember["role"]) => setTeam(current => current.map(member => member.userId === userId ? { ...member, role } : role === "lead" && member.role === "lead" ? { ...member, role: "co-teacher" } : member));
  function add() {
    const person = people.find(item => item.id === adding);
    if (!person) return;
    setTeam(current => [...current, { userId: person.id, username: person.username, name: person.name, role: current.some(member => member.role === "lead") ? "co-teacher" : "lead" }]);
    setAdding("");
  }
  async function save() {
    setBusy(true);
    try { await api(`/courses/${course.id}/team`, "PUT", { members: team.map(member => ({ userId: member.userId, role: member.role })), version: course.version }); await reload(); toast({ message: "Equipo docente actualizado." }); }
    catch (cause) { toast({ tone: "error", message: message(cause) }); }
    finally { setBusy(false); }
  }
  return <section id="equipo" className="panel" aria-labelledby="team-title">
    <div className="panel-header"><h2 id="team-title">Equipo docente</h2></div>
    <p className="muted">{teamNote}</p>
    {team.length ? <ul className="team-list">{team.map(member => <li key={member.userId}>
      <Avatar name={member.name} size={32}/><div><strong>{member.name}</strong><span className="muted small">@{member.username}</span></div>
      <label className="sr-only" htmlFor={`role-${member.userId}`}>Rol de {member.name}</label>
      <select id={`role-${member.userId}`} value={member.role} onChange={event => setRole(member.userId, event.target.value as CourseMember["role"])}>{(["lead", "co-teacher"] as const).map(role => <option key={role} value={role}>{roleLabel[role]}</option>)}</select>
      <button type="button" className="icon-button" aria-label={`Quitar a ${member.name} del equipo`} onClick={() => setTeam(current => current.filter(item => item.userId !== member.userId))}><Icon name="close"/></button>
    </li>)}</ul> : <p className="muted small">Sin equipo asignado.</p>}
    <div className="team-add">
      <label className="sr-only" htmlFor="team-add">Agregar persona al equipo</label>
      <select id="team-add" value={adding} onChange={event => setAdding(event.target.value)}><option value="">Agregar persona…</option>{available.map(person => <option key={person.id} value={person.id}>{person.name} (@{person.username})</option>)}</select>
      <Button icon="plus" onClick={add} disabled={!adding}>Agregar</Button>
      <Button variant="ghost" onClick={() => setTeam(course.team || [])} disabled={!dirty || busy}>Descartar</Button>
      <button type="button" className="button primary" onClick={() => void save()} disabled={!dirty || busy}>{busy ? "Guardando…" : "Guardar equipo"}</button>
    </div>
  </section>;
}
