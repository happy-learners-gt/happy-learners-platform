import type { CourseAccess, CourseRole } from "@happy-learners/contracts";

/** Educators a section admits; enough for a main educator, support and substitutes. */
export const maxSectionEducators = 6;

/**
 * What a person can do in a course (DEC-023): administration answers who teaches, when and to whom; the lead
 * answers what is taught; co-teachers prepare lessons for review and teach the sections assigned to them.
 * Course roles add to the organization role, so an administrator on a team also has that team role.
 * Null when the person has no access to the course at all.
 */
export function courseAccess(admin: boolean, role: CourseRole | null, assigned: string[]): CourseAccess | null {
  if (!admin && !role) return null;
  return {
    role, assigned,
    configure: admin,
    edit: role !== null,
    publish: role === "lead",
    teach: role === "lead" ? "all" : role ? "assigned" : null,
    sections: admin || role === "lead" ? "all" : "assigned",
  };
}
export const seesSection = (access: CourseAccess, groupId: string) => access.sections === "all" || access.assigned.includes(groupId);
export const teachesSection = (access: CourseAccess, groupId: string) => access.teach === "all" || (access.teach === "assigned" && access.assigned.includes(groupId));
