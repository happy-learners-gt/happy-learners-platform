import { useEffect, useState } from "react";
import type { ActivityEvent, CourseMember, CourseProgress } from "@happy-learners/contracts";
import { api, message } from "../api";
import { Link } from "../navigation";
import { hueFor, plural, timeAgo } from "../model";
import { Icon } from "./icons";
import type { IconName } from "./icons";
import { EmptyState, ErrorState, Skeleton, StatusBadge } from "./primitives";

const targetIcon: Record<ActivityEvent["targetType"], IconName> = { course: "courses", program: "grid", module: "content", lesson: "edit", resource: "library", competency: "spark", outcome: "spark", group: "users", session: "calendar", team: "users" };
const initials = (name: string) => name.split(/\s+/).filter(Boolean).slice(0, 2).map(part => part[0]).join("").toUpperCase();

/** A person's initials on their colour; the name is always next to it or in the accessible label. */
export function Avatar({ name, size = 28 }: { name: string; size?: number }) {
  return <span className={`avatar tone-${hueFor(name)}`} style={{ width: size, height: size, fontSize: size * .4 }} aria-hidden="true">{initials(name)}</span>;
}

export const roleLabel: Record<CourseMember["role"], string> = { lead: "Responsable", "co-teacher": "Colabora" };
export function TeamLine({ team }: { team?: CourseMember[] }) {
  if (!team?.length) return <span className="muted small">Sin equipo asignado</span>;
  const lead = team.find(member => member.role === "lead"), others = team.length - (lead ? 1 : 0);
  return <span className="team-line">{lead && <><Avatar name={lead.name} size={22}/><span>{lead.name}</span></>}{others > 0 && <span className="muted">{lead ? ` + ${others}` : plural(others, "persona", "personas")}</span>}</span>;
}

/**
 * Who did what, newest first: from the activity log. Filter by course or person.
 */
export function ActivityFeed({ course, actor, mine, limit = 8, courseTitles, empty = "Todavía no hay actividad registrada." }: { course?: string; actor?: string; mine?: boolean; limit?: number; courseTitles?: Record<string, string>; empty?: string }) {
  const [events, setEvents] = useState<ActivityEvent[] | null>(null), [error, setError] = useState("");
  const query = new URLSearchParams({ limit: String(limit), ...(course ? { course } : {}), ...(actor ? { actor } : {}), ...(mine ? { mine: "1" } : {}) });
  const load = () => api<{ events: ActivityEvent[] }>(`/activity?${query}`).then(result => setEvents(result.events)).catch(cause => setError(message(cause)));
  useEffect(() => { void load(); }, [course, actor, mine, limit]);
  if (error) return <ErrorState error={error} retry={() => void load()}/>;
  if (!events) return <Skeleton lines={4}/>;
  if (!events.length) return <p className="muted">{empty}</p>;
  return <ol className="activity-feed people">{events.map(entry => <li key={entry.id}>
    <Avatar name={entry.actorName}/>
    <div><span><strong>{entry.actorName}</strong> <span className="feed-summary">{entry.summary.charAt(0).toLowerCase() + entry.summary.slice(1)}</span></span>
      <span className="muted small"><Icon name={targetIcon[entry.targetType]} size={12}/>{entry.courseId && courseTitles?.[entry.courseId] && !course ? <>{" "}<Link href={`/cursos/${entry.courseId}`}>{courseTitles[entry.courseId]}</Link></> : null}</span></div>
    <time className="muted small" dateTime={entry.occurredAt} title={new Date(entry.occurredAt).toLocaleString("es-GT")}>{timeAgo(entry.occurredAt)}</time>
  </li>)}</ol>;
}

function Bar({ label, value, max, text }: { label: string; value: number; max: number; text: string }) {
  const percent = max ? Math.round(100 * value / max) : 0;
  return <div className="mini-progress"><span className="muted small">{label}</span><div className="progress-track" role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent} aria-valuetext={text}><span style={{ width: `${percent}%` }}/></div><span className="small">{text}</span></div>;
}

/** One row per course: content published, outcomes evaluated, attendance and last activity. */
export function CourseProgressList({ courses, userId, compact }: { courses: CourseProgress[]; userId?: string; compact?: boolean }) {
  if (!courses.length) return <EmptyState compact icon="courses" title="Sin cursos asignados">Cuando formes parte del equipo de un curso, su avance aparecerá aquí.</EmptyState>;
  return <ul className={`progress-list${compact ? " compact" : ""}`}>{courses.map(item => {
    const role = userId ? item.team.find(member => member.userId === userId)?.role : undefined;
    return <li key={item.courseId} className={`tone-${hueFor(item.courseId)}`}>
      <div className="progress-head">
        <Link href={`/cursos/${item.courseId}`} className="progress-title">{item.title}</Link>
        {role ? <StatusBadge tone={role === "lead" ? "info" : "neutral"}>{roleLabel[role]}</StatusBadge> : <TeamLine team={item.team}/>}
      </div>
      <div className="progress-bars">
        <Bar label="Lecciones publicadas" value={item.published} max={item.lessons} text={`${item.published} de ${item.lessons}`}/>
        <Bar label="Resultados evaluados" value={item.assessed} max={item.outcomes} text={item.outcomes ? `${item.assessed} de ${item.outcomes}` : "Sin plan"}/>
        <Bar label="Asistencia" value={item.attendanceRate || 0} max={100} text={item.attendanceRate === null ? "Sin clases" : `${item.attendanceRate} % · ${plural(item.sessions, "clase", "clases")}`}/>
      </div>
      <p className="muted small">{plural(item.learners, "estudiante asignado", "estudiantes asignados")}{item.changes ? ` · ${plural(item.changes, "lección con cambios", "lecciones con cambios")} sin publicar` : ""}{item.lastActivity ? ` · actividad ${timeAgo(item.lastActivity)}` : ""}</p>
    </li>;
  })}</ul>;
}

/** Loads progress for every active course (optionally only those a person teaches). */
export function useProgress(userId?: string) {
  const [courses, setCourses] = useState<CourseProgress[] | null>(null), [error, setError] = useState("");
  const load = () => api<{ courses: CourseProgress[] }>("/progress").then(result => setCourses(userId ? result.courses.filter(item => item.team.some(member => member.userId === userId)) : result.courses)).catch(cause => setError(message(cause)));
  useEffect(() => { void load(); }, [userId]);
  return { courses, error, reload: load };
}
