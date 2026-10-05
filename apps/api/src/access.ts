import type { CourseAccess, CourseRole, Member } from "@happy-learners/contracts";
import { courseAccess } from "@happy-learners/domain";
import type { Database } from "./storage";

export const outsider = () => Response.json({ error: "Este curso no está asignado a tu cuenta. Administración asigna los cursos y sus secciones." }, { status: 403 });
export const forbidden = (error: string) => Response.json({ error }, { status: 403 });

/**
 * What the person can do in a course of their organization (DEC-023): undefined when the course is not there,
 * null when they have no access to it.
 */
export async function accessTo(db: Database, current: Member, courseId: string): Promise<CourseAccess | null | undefined> {
  const [course, team, sections] = await db.batch([
    db.prepare("SELECT id FROM courses WHERE id=? AND organization_id=?").bind(courseId, current.organizationId),
    db.prepare("SELECT role FROM course_members WHERE course_id=? AND organization_id=? AND user_id=?").bind(courseId, current.organizationId, current.id),
    db.prepare("SELECT group_id AS id FROM section_educators WHERE course_id=? AND organization_id=? AND user_id=? ORDER BY group_id").bind(courseId, current.organizationId, current.id),
  ]) as unknown as [{ id: string }[], { role: CourseRole }[], { id: string }[]];
  if (!course.length) return undefined;
  return courseAccess(current.role === "admin", team[0]?.role ?? null, sections.map(row => row.id));
}

/** Courses the person reaches: null means every course (administration), otherwise the courses of their teams. */
export async function reachableCourses(db: Database, current: Member): Promise<Set<string> | null> {
  if (current.role === "admin") return null;
  const rows = (await db.prepare("SELECT course_id AS id FROM course_members WHERE organization_id=? AND user_id=?").bind(current.organizationId, current.id).all<{ id: string }>()).results;
  return new Set(rows.map(row => row.id));
}
