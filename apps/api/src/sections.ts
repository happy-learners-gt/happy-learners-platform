import type { ClassStatus, Member, Pacing, SectionEducator, SectionProgress, SectionSummary } from "@happy-learners/contracts";
import { pathIndicators, sectionIndicators } from "@happy-learners/domain";
import type { Database } from "./storage";
import { scheduleOf, todayFor } from "./classes";
import { configurationOf } from "./courses";
import { educatorConflicts } from "./conflicts";
import { scopedCourses } from "./permissions";

const reply = (data: unknown, status = 200) => Response.json(data, { status });

/**
 * Sections a person sees: every section for administration, every section of the courses in scope for coordination
 * (DEC-041) and security groups that grant it, otherwise those they teach (DEC-024).
 */
const visible = "g.organization_id=? AND (?=1 OR g.course_id IN (SELECT value FROM json_each(?)) OR EXISTS(SELECT 1 FROM section_educators e WHERE e.group_id=g.id AND e.user_id=?))";
const wideCourses = (db: Database, current: Member) => scopedCourses(db, current, ["classes.view", "sections.assign"]);

type Row = { id: string; courseId: string; name: string; status: "active" | "archived"; accessCode: string | null; weekdays: string | null; startsAt: string | null; durationMinutes: number | null; from: string | null; until: string | null; meetings: string | null; periodId: string | null; courseTitle: string; courseStatus: "active" | "archived"; pacing: Pacing; teaches: number };
type ClassRow = { id: string; groupId: string; status: ClassStatus; sessionDate: string; startsAt: string | null; marked: number; attended: number };

/**
 * GET /api/sections[/:id] — each section as its own instance of a course: who teaches it, its students, its schedule,
 * its next class and its progress, computed from the section's records only.
 */
export async function sections(path: string, current: Member, db: Database) {
  const [id, sub] = [path.split("/")[3], path.split("/")[4]];
  if (sub === "progress") return progress(id, current, db);
  const scope = [current.organizationId, current.role === "admin" ? 1 : 0, JSON.stringify(await wideCourses(db, current)), current.id];
  const bound = id ? [...scope, id] : scope;
  // The visible sections first, then everything else by their ids: each query below is an index lookup by section
  // instead of filtering every section again (docs/operations/slo.md §4).
  const groups = (await db.prepare(`SELECT g.id,g.course_id AS courseId,g.name,g.status,g.access_code AS accessCode,g.schedule_weekdays AS weekdays,g.schedule_starts_at AS startsAt,g.schedule_duration AS durationMinutes,g.schedule_from AS "from",g.schedule_until AS until,g.schedule_meetings AS meetings,g.schedule_period_id AS periodId,
      c.title AS courseTitle,c.status AS courseStatus,COALESCE(sp.pacing,c.pacing) AS pacing,EXISTS(SELECT 1 FROM section_educators e WHERE e.group_id=g.id AND e.user_id=?) AS teaches
      FROM course_groups g JOIN courses c ON c.id=g.course_id AND c.organization_id=g.organization_id LEFT JOIN study_programs sp ON sp.id=c.program_id WHERE ${visible}${id ? " AND g.id=?" : ""} ORDER BY c.title,g.status,g.name,g.created_at`).bind(current.id, ...bound).all<Row>()).results;
  const ids = JSON.stringify(groups.map(group => group.id)), courseIds = JSON.stringify([...new Set(groups.map(group => group.courseId))]);
  const inScope = "IN (SELECT value FROM json_each(?))";
  const [learners, classes, planned, published, openings, educators, progressRows] = groups.length ? await db.batch([
    db.prepare(`SELECT group_id AS groupId,id FROM group_learners WHERE status='active' AND group_id ${inScope}`).bind(ids),
    // Each class keeps its attendance counts (migration 0075): no mark is read here.
    db.prepare(`SELECT s.id,s.group_id AS groupId,s.status,s.session_date AS sessionDate,s.starts_at AS startsAt,s.marked_count AS marked,s.attended_count AS attended
      FROM class_sessions s WHERE s.group_id ${inScope} ORDER BY s.session_date,s.starts_at`).bind(ids),
    db.prepare(`SELECT p.session_id AS sessionId,p.lesson_id AS lessonId,p.outcome FROM class_session_lessons p JOIN class_sessions s ON s.id=p.session_id WHERE s.group_id ${inScope}`).bind(ids),
    // From the units to their lessons (CROSS JOIN keeps that order): otherwise SQLite reads every lesson through `group_id IS NULL`.
    db.prepare(`SELECT u.course_id AS courseId,l.id FROM learning_units u CROSS JOIN lessons l ON l.course_unit_id=u.id WHERE u.status='active' AND l.archived=0 AND l.revision>0 AND l.group_id IS NULL AND u.course_id ${inScope}`).bind(courseIds),
    db.prepare(`SELECT group_id AS groupId,count(*) AS total FROM lesson_completions WHERE group_id ${inScope} GROUP BY group_id`).bind(ids),
    db.prepare(`SELECT e.group_id AS groupId,e.user_id AS userId,COALESCE(u.display_name,u.username) AS name,u.username FROM section_educators e JOIN users u ON u.id=e.user_id WHERE e.group_id ${inScope} ORDER BY name`).bind(ids),
    db.prepare(`SELECT group_id AS groupId,learner_id AS learnerId,lesson_id AS lessonId,completed_at IS NOT NULL AS completed FROM learner_progress WHERE group_id ${inScope}`).bind(ids),
  ]) as unknown as [{ groupId: string; id: string }[], ClassRow[], { sessionId: string; lessonId: string; outcome: string | null }[], { courseId: string; id: string }[], { groupId: string; total: number }[], (SectionEducator & { groupId: string })[], { groupId: string; learnerId: string; lessonId: string; completed: number }[]]
    : [[], [], [], [], [], [], []];
  if (id && !groups.length) return unassigned(db, id, current);
  const today = await todayFor(db, current.organizationId);
  const lessonsOf = new Map<string, string[]>(), completedOf = new Map<string, string[]>();
  for (const row of planned) {
    lessonsOf.set(row.sessionId, [...lessonsOf.get(row.sessionId) || [], row.lessonId]);
    if (row.outcome !== "partial" && row.outcome !== "not_reached") completedOf.set(row.sessionId, [...completedOf.get(row.sessionId) || [], row.lessonId]);
  }
  const list: SectionSummary[] = groups.map(({ weekdays, startsAt, durationMinutes, from, until, meetings, periodId, courseTitle, courseStatus, teaches, pacing, ...group }) => {
    // A tu ritmo: the section has no classes to follow, only how far each student got.
    const own = pacing === "scheduled" ? classes.filter(row => row.groupId === group.id) : [];
    const next = own.find(row => row.status === "in_progress") || own.find(row => row.status === "planned" && row.sessionDate >= today) || null;
    const lessonIds = published.filter(row => row.courseId === group.courseId).map(row => row.id), learnerIds = learners.filter(row => row.groupId === group.id).map(row => row.id);
    const indicators = sectionIndicators(own.map(row => ({ status: row.status, sessionDate: row.sessionDate, lessonIds: lessonsOf.get(row.id) || [], completedIds: completedOf.get(row.id) || [], marked: Number(row.marked), attended: Number(row.attended) })),
      lessonIds, learnerIds.length, today);
    const mine = progressRows.filter(row => row.groupId === group.id), completed = new Map<string, Set<string>>();
    for (const row of mine) if (row.completed) completed.set(row.learnerId, new Set([...completed.get(row.learnerId) || [], row.lessonId]));
    const path = pathIndicators(lessonIds, completed, new Set(mine.map(row => row.learnerId)), learnerIds);
    return {
      ...group, pacing, learnerCount: indicators.learners, schedule: pacing === "scheduled" ? scheduleOf({ weekdays, startsAt, durationMinutes, from, until, meetings, periodId }) : null,
      educators: educators.filter(row => row.groupId === group.id).map(({ groupId: _, ...person }) => person),
      course: { id: group.courseId, title: courseTitle, status: courseStatus },
      indicators: { ...indicators, ...path, openings: Number(openings.find(row => row.groupId === group.id)?.total || 0) },
      next: next && { id: next.id, sessionDate: next.sessionDate, startsAt: next.startsAt, status: next.status },
      teaches: !!teaches,
    };
  });
  if (!id) return reply({ sections: list, today });
  const settings = (await configurationOf(db, current.organizationId, list[0].courseId))?.settings;
  // Schedule conflicts name other courses' sections: administration, who assigns educators, sees them.
  const assigns = current.role === "admin" || (await scopedCourses(db, current, ["sections.assign"])).includes(list[0].courseId);
  const conflicts = assigns && list[0].status === "active" ? await educatorConflicts(db, current.organizationId, [id], today) : [];
  const educatorsWith = list[0].educators.map(person => { const own = conflicts.filter(item => item.userId === person.userId); return own.length ? { ...person, conflicts: own } : person; });
  return reply({ section: { ...list[0], educators: educatorsWith, workGroups: !!(settings?.attendance && settings.workGroups) }, today });
}

/** The section exists but is not assigned to the person: say so instead of pretending it is not there. */
async function unassigned(db: Database, id: string, current: Member) {
  const exists = await db.prepare("SELECT id FROM course_groups WHERE id=? AND organization_id=?").bind(id, current.organizationId).first();
  return exists ? reply({ error: "Esta sección no está asignada a tu cuenta. Administración asigna quién imparte cada sección." }, 403) : reply({ error: "La sección no está disponible." }, 404);
}

/**
 * GET /api/sections/:id/progress — A tu ritmo (DEC-027): each student of the section and the published lessons they
 * opened and completed, in the course's content order. Same access as the section.
 */
async function progress(id: string, current: Member, db: Database) {
  const group = await db.prepare(`SELECT g.id,g.course_id AS courseId FROM course_groups g WHERE ${visible} AND g.id=?`).bind(current.organizationId, current.role === "admin" ? 1 : 0, JSON.stringify(await wideCourses(db, current)), current.id, id).first<{ id: string; courseId: string }>();
  if (!group) return unassigned(db, id, current);
  const [lessons, learners, rows] = await db.batch([
    db.prepare("SELECT l.id,COALESCE(json_extract(l.published_content,'$.title'),'Lección') AS title,u.name AS unitName FROM lessons l JOIN learning_units u ON u.id=l.course_unit_id WHERE u.course_id=? AND u.status='active' AND l.archived=0 AND l.revision>0 ORDER BY u.position,l.position,l.id").bind(group.courseId),
    db.prepare("SELECT id,display_name AS name FROM group_learners WHERE group_id=? AND status='active' ORDER BY display_name,id").bind(group.id),
    db.prepare("SELECT learner_id AS learnerId,lesson_id AS lessonId,opened_at AS openedAt,completed_at AS completedAt FROM learner_progress WHERE group_id=?").bind(group.id),
  ]) as unknown as [SectionProgress["lessons"], { id: string; name: string }[], { learnerId: string; lessonId: string; openedAt: string; completedAt: string | null }[]];
  const published = new Set(lessons.map(lesson => lesson.id));
  const result: SectionProgress = {
    lessons,
    learners: learners.map(learner => {
      const own = rows.filter(row => row.learnerId === learner.id && published.has(row.lessonId));
      const last = own.flatMap(row => [row.openedAt, row.completedAt || ""]).sort().pop() || null;
      return { ...learner, opened: own.map(row => row.lessonId), completed: own.filter(row => row.completedAt).map(row => row.lessonId), lastActivity: last };
    }),
  };
  return reply(result);
}
