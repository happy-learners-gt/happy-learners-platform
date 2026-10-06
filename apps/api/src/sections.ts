import type { ClassStatus, Member, SectionEducator, SectionSummary } from "@happy-learners/contracts";
import { sectionIndicators } from "@happy-learners/domain";
import type { Database } from "./storage";
import { scheduleOf, todayFor } from "./classes";

const reply = (data: unknown, status = 200) => Response.json(data, { status });

/** Sections a person sees: every section for administration, otherwise those they teach (DEC-024). */
const visible = "g.organization_id=? AND (?=1 OR EXISTS(SELECT 1 FROM section_educators e WHERE e.group_id=g.id AND e.user_id=?))";

type Row = { id: string; courseId: string; name: string; status: "active" | "archived"; accessCode: string | null; weekdays: string | null; startsAt: string | null; durationMinutes: number | null; from: string | null; until: string | null; courseTitle: string; courseStatus: "active" | "archived"; teaches: number };
type ClassRow = { id: string; groupId: string; status: ClassStatus; sessionDate: string; startsAt: string | null; marked: number; attended: number };

/**
 * GET /api/sections[/:id] — each section as its own instance of a course: who teaches it, its students, its schedule,
 * its next class and its progress, computed from the section's records only.
 */
export async function sections(path: string, current: Member, db: Database) {
  const id = path.split("/")[3];
  const scope = [current.organizationId, current.role === "admin" ? 1 : 0, current.id];
  const inScope = `IN (SELECT g.id FROM course_groups g WHERE ${visible}${id ? " AND g.id=?" : ""})`;
  const bound = id ? [...scope, id] : scope;
  const [groups, learners, classes, planned, published, openings, educators] = await db.batch([
    db.prepare(`SELECT g.id,g.course_id AS courseId,g.name,g.status,g.access_code AS accessCode,g.schedule_weekdays AS weekdays,g.schedule_starts_at AS startsAt,g.schedule_duration AS durationMinutes,g.schedule_from AS "from",g.schedule_until AS until,
      c.title AS courseTitle,c.status AS courseStatus,EXISTS(SELECT 1 FROM section_educators e WHERE e.group_id=g.id AND e.user_id=?) AS teaches
      FROM course_groups g JOIN courses c ON c.id=g.course_id AND c.organization_id=g.organization_id WHERE ${visible}${id ? " AND g.id=?" : ""} ORDER BY c.title,g.status,g.name,g.created_at`).bind(current.id, ...bound),
    db.prepare(`SELECT group_id AS groupId,count(*) AS total FROM group_learners WHERE status='active' AND group_id ${inScope} GROUP BY group_id`).bind(...bound),
    db.prepare(`SELECT s.id,s.group_id AS groupId,s.status,s.session_date AS sessionDate,s.starts_at AS startsAt,
      (SELECT count(*) FROM attendance_marks m WHERE m.session_id=s.id) AS marked,(SELECT count(*) FROM attendance_marks m WHERE m.session_id=s.id AND m.status IN ('present','late')) AS attended
      FROM class_sessions s WHERE s.group_id ${inScope} ORDER BY s.session_date,s.starts_at`).bind(...bound),
    db.prepare(`SELECT p.session_id AS sessionId,p.lesson_id AS lessonId,p.outcome FROM class_session_lessons p JOIN class_sessions s ON s.id=p.session_id WHERE s.group_id ${inScope}`).bind(...bound),
    db.prepare(`SELECT u.course_id AS courseId,l.id FROM lessons l JOIN learning_units u ON u.id=l.course_unit_id WHERE u.status='active' AND l.archived=0 AND l.revision>0 AND u.course_id IN (SELECT g.course_id FROM course_groups g WHERE ${visible}${id ? " AND g.id=?" : ""})`).bind(...bound),
    db.prepare(`SELECT group_id AS groupId,count(*) AS total FROM lesson_completions WHERE group_id ${inScope} GROUP BY group_id`).bind(...bound),
    db.prepare(`SELECT e.group_id AS groupId,e.user_id AS userId,COALESCE(u.display_name,u.username) AS name,u.username FROM section_educators e JOIN users u ON u.id=e.user_id WHERE e.group_id ${inScope} ORDER BY name`).bind(...bound),
  ]) as unknown as [Row[], { groupId: string; total: number }[], ClassRow[], { sessionId: string; lessonId: string; outcome: string | null }[], { courseId: string; id: string }[], { groupId: string; total: number }[], (SectionEducator & { groupId: string })[]];
  if (id && !groups.length) {
    // The section exists but is not assigned to the person: say so instead of pretending it is not there.
    const exists = await db.prepare("SELECT id FROM course_groups WHERE id=? AND organization_id=?").bind(id, current.organizationId).first();
    return exists ? reply({ error: "Esta sección no está asignada a tu cuenta. Administración asigna quién imparte cada sección." }, 403) : reply({ error: "La sección no está disponible." }, 404);
  }
  const today = await todayFor(db, current.organizationId);
  const lessonsOf = new Map<string, string[]>(), completedOf = new Map<string, string[]>();
  for (const row of planned) {
    lessonsOf.set(row.sessionId, [...lessonsOf.get(row.sessionId) || [], row.lessonId]);
    if (row.outcome !== "partial" && row.outcome !== "not_reached") completedOf.set(row.sessionId, [...completedOf.get(row.sessionId) || [], row.lessonId]);
  }
  const list: SectionSummary[] = groups.map(({ weekdays, startsAt, durationMinutes, from, until, courseTitle, courseStatus, teaches, ...group }) => {
    const own = classes.filter(row => row.groupId === group.id);
    const next = own.find(row => row.status === "in_progress") || own.find(row => row.status === "planned" && row.sessionDate >= today) || null;
    const indicators = sectionIndicators(own.map(row => ({ status: row.status, sessionDate: row.sessionDate, lessonIds: lessonsOf.get(row.id) || [], completedIds: completedOf.get(row.id) || [], marked: Number(row.marked), attended: Number(row.attended) })),
      published.filter(row => row.courseId === group.courseId).map(row => row.id), Number(learners.find(row => row.groupId === group.id)?.total || 0), today);
    return {
      ...group, learnerCount: indicators.learners, schedule: scheduleOf({ weekdays, startsAt, durationMinutes, from, until }),
      educators: educators.filter(row => row.groupId === group.id).map(({ groupId: _, ...person }) => person),
      course: { id: group.courseId, title: courseTitle, status: courseStatus },
      indicators: { ...indicators, openings: Number(openings.find(row => row.groupId === group.id)?.total || 0) },
      next: next && { id: next.id, sessionDate: next.sessionDate, startsAt: next.startsAt, status: next.status },
      teaches: !!teaches,
    };
  });
  return id ? reply({ section: list[0], today }) : reply({ sections: list, today });
}
