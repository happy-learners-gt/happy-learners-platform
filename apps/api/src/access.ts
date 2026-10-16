import type { CourseAccess, CourseRole, Member } from "@happy-learners/contracts";
import { courseAccess, grantedIn } from "@happy-learners/domain";
import type { Database } from "./storage";

export const outsider = () => Response.json({ error: "Este curso no está asignado a tu cuenta. Administración asigna los cursos y sus secciones." }, { status: 403 });
export const forbidden = (error: string) => Response.json({ error }, { status: 403 });

/**
 * What the person can do in a course of their organization (DEC-023): undefined when the course is not there,
 * null when they have no access to it. Coordination and security groups add what they grant in the course's program
 * (ST-128, ST-135, DEC-041); administration's own rules do not change.
 */
export async function accessTo(db: Database, current: Member, courseId: string): Promise<CourseAccess | null | undefined> {
  const [course, team, sections] = await db.batch([
    db.prepare("SELECT id,program_id AS programId FROM courses WHERE id=? AND organization_id=?").bind(courseId, current.organizationId),
    db.prepare("SELECT role FROM course_members WHERE course_id=? AND organization_id=? AND user_id=?").bind(courseId, current.organizationId, current.id),
    db.prepare("SELECT group_id AS id FROM section_educators WHERE course_id=? AND organization_id=? AND user_id=? ORDER BY group_id").bind(courseId, current.organizationId, current.id),
  ]) as unknown as [{ id: string; programId: string | null }[], { role: CourseRole }[], { id: string }[]];
  if (!course.length) return undefined;
  const admin = current.role === "admin";
  return courseAccess(admin, team[0]?.role ?? null, sections.map(row => row.id), admin ? undefined : grantedIn(current.permissions, course[0].programId));
}

/**
 * Courses the person reaches: null means every course (administration), otherwise the courses of their teams and,
 * with coordination or a security group, every course of the programs in scope.
 */
export async function reachableCourses(db: Database, current: Member): Promise<Set<string> | null> {
  if (current.role === "admin") return null;
  const granted = Object.keys(current.permissions?.grants || {}).length > 0;
  const [team, courses] = await db.batch([
    db.prepare("SELECT course_id AS id FROM course_members WHERE organization_id=? AND user_id=?").bind(current.organizationId, current.id),
    ...(granted ? [db.prepare("SELECT id,program_id AS programId FROM courses WHERE organization_id=?").bind(current.organizationId)] : []),
  ]) as unknown as [{ id: string }[], { id: string; programId: string | null }[] | undefined];
  const reached = new Set(team.map(row => row.id));
  for (const course of courses || []) if (grantedIn(current.permissions, course.programId).size) reached.add(course.id);
  return reached;
}
