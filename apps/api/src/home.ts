import type { CourseProgress, Lesson, Member } from "@happy-learners/contracts";
import { coverage } from "@happy-learners/domain";
import type { Database } from "./storage";
import { coursesFor, curriculumFor, unitsFor } from "./courses";
import { reachableCourses } from "./access";
import { scopedCourses } from "./permissions";
import { teamsFor } from "./team";

const reply = (value: unknown, status = 200) => Response.json(value, { status });

/**
 * GET /api/progress — for every active course: content, curriculum coverage, attendance and last activity.
 * Feeds "Mis cursos" on the home page and the educators overview for administration.
 */
export async function progress(current: Member, db: Database) {
  const reachable = await reachableCourses(db, current);
  const courses = (await coursesFor(db, current.organizationId)).filter(course => course.status === "active" && (!reachable || reachable.has(course.id)));
  const teams = await teamsFor(db, current.organizationId);
  const lessonRows = (await db.prepare("SELECT l.id,l.content,l.course_unit_id AS unitId,l.archived,l.revision,l.draft_version AS draftVersion,l.published_version AS publishedVersion,c.id AS courseId FROM lessons l JOIN courses c ON c.legacy_program_id=l.program_id WHERE c.organization_id=?").bind(current.organizationId).all<{ id: string; content: string; unitId: string; archived: number; revision: number; draftVersion: number; publishedVersion: number; courseId: string }>()).results;
  // Classes and students count only in the sections the person sees: every one for administration, their own for
  // educators, and every section of the courses in scope for coordination (DEC-041).
  const own = current.role === "admin" ? "" : " AND (group_id IN (SELECT group_id FROM section_educators WHERE user_id=?) OR course_id IN (SELECT value FROM json_each(?)))";
  const mine = current.role === "admin" ? [] : [current.id, JSON.stringify(await scopedCourses(db, current, ["classes.view", "sections.assign"]))];
  const attendance = (await db.prepare(`SELECT s.course_id AS courseId,count(*) AS sessions,sum(s.attended_count) AS attended,sum(s.marked_count) AS marks FROM class_sessions s WHERE s.organization_id=? AND s.status IN ('in_progress','completed')${own.replace("group_id", "s.group_id").replace("OR course_id", "OR s.course_id")} GROUP BY s.course_id`).bind(current.organizationId, ...mine).all<{ courseId: string; sessions: number; attended: number; marks: number }>()).results;
  const learners = (await db.prepare(`SELECT course_id AS courseId,count(*) AS total FROM group_learners WHERE organization_id=? AND status='active'${own} GROUP BY course_id`).bind(current.organizationId, ...mine).all<{ courseId: string; total: number }>()).results;
  // Each course's newest event, read through the course index from the newest down, instead of grouping every event.
  const last = (await db.prepare(`SELECT c.value AS courseId,(SELECT occurred_at FROM activity_events WHERE course_id=c.value${own ? ` AND (target_type NOT IN ('group','session')${own.replace(" AND", " OR")})` : ""} ORDER BY occurred_at DESC LIMIT 1) AS at FROM json_each(?) c`)
    .bind(...mine, JSON.stringify(courses.map(course => course.id))).all<{ courseId: string; at: string | null }>()).results.filter(row => row.at);
  const result: CourseProgress[] = [];
  for (const course of courses) {
    const rows = lessonRows.filter(row => row.courseId === course.id && !row.archived);
    const lessons = rows.map(row => ({ ...JSON.parse(row.content), id: row.id, courseUnitId: row.unitId, status: row.revision ? "published" : "draft", revision: row.revision }) as Lesson);
    const [units, curriculum] = await Promise.all([unitsFor(db, course.id), curriculumFor(db, course.id)]);
    const plan = coverage(curriculum, units, lessons);
    const marks = attendance.find(row => row.courseId === course.id);
    result.push({
      courseId: course.id, title: course.title, team: teams.get(course.id) || [],
      lessons: rows.length, published: rows.filter(row => row.revision > 0).length, changes: rows.filter(row => row.revision > 0 && row.draftVersion !== row.publishedVersion).length,
      outcomes: plan.summary.total, taught: plan.summary.taught, assessed: plan.summary.assessed,
      sessions: marks?.sessions || 0, attendanceRate: marks?.marks ? Math.round(100 * marks.attended / marks.marks) : null,
      learners: learners.find(row => row.courseId === course.id)?.total || 0, lastActivity: last.find(row => row.courseId === course.id)?.at || null,
    });
  }
  return reply({ courses: result });
}
