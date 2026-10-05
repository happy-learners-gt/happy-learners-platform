import type { CourseAccess, CourseRole } from "@happy-learners/contracts";

/** Educators a section admits; enough for a main educator, support and substitutes. */
export const maxSectionEducators = 6;

/**
 * What a person can do in a course (DEC-023, DEC-024). The course defines what is taught: the lead decides and
 * publishes it and co-teachers prepare lessons for review. Each section is its own instance of the course, taught
 * only by the educators administration assigns to it, the lead included. Administration configures everything and
 * sees every section. Course roles add to the organization role. Null when the person has no access to the course.
 */
export function courseAccess(admin: boolean, role: CourseRole | null, assigned: string[]): CourseAccess | null {
  if (!admin && !role) return null;
  return {
    role, assigned,
    configure: admin,
    edit: role !== null,
    publish: role === "lead",
    sections: admin ? "all" : "assigned",
  };
}
export const seesSection = (access: CourseAccess, groupId: string) => access.sections === "all" || access.assigned.includes(groupId);
/** Only the section's own educators plan and teach its classes; seeing every section does not make administration teach them. */
export const teachesSection = (access: CourseAccess, groupId: string) => access.role !== null && access.assigned.includes(groupId);
