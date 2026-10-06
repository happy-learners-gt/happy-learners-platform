import type { CourseRequirements, Member, ProgramPath, StudyProgram } from "@happy-learners/contracts";
import { createsCycle, prerequisiteInput, prerequisiteStages } from "@happy-learners/domain";
import type { Requirement } from "@happy-learners/domain";
import type { Database } from "./storage";
import { event } from "./team";

const reply = (data: unknown, status = 200) => Response.json(data, { status });

async function programCourses(db: Database, organizationId: string, programId: string) {
  return (await db.prepare("SELECT id,title,status FROM courses WHERE organization_id=? AND program_id=? ORDER BY title COLLATE NOCASE,id").bind(organizationId, programId).all<{ id: string; title: string; status: "active" | "archived" }>()).results;
}
async function requirementsIn(db: Database, organizationId: string, courseIds: string[]): Promise<Requirement[]> {
  if (!courseIds.length) return [];
  const marks = courseIds.map(() => "?").join(",");
  return (await db.prepare(`SELECT course_id AS courseId,required_course_id AS requiredId FROM course_prerequisites WHERE organization_id=? AND course_id IN (${marks}) AND required_course_id IN (${marks})`).bind(organizationId, ...courseIds, ...courseIds).all<Requirement>()).results;
}
async function pathOf(db: Database, organizationId: string, programId: string): Promise<ProgramPath> {
  const courses = await programCourses(db, organizationId, programId);
  const requirements = await requirementsIn(db, organizationId, courses.map(course => course.id));
  return { courses, requirements, stages: prerequisiteStages(courses.map(course => course.id), requirements) };
}

/**
 * GET/PUT /api/programs/:id/prerequisites (DEC-029): the program as a path. Everyone reads it; administration
 * decides which courses of the program each course requires, without cycles.
 */
export async function programPrerequisites(method: string, input: unknown, current: Member, db: Database, program: StudyProgram) {
  if (method === "GET") return reply(await pathOf(db, current.organizationId, program.id));
  if (current.role !== "admin") return reply({ error: "Solo administración define los requisitos entre los cursos de un programa." }, 403);
  const value = prerequisiteInput(input);
  if (!value) return reply({ error: "Elige el curso y hasta 10 cursos distintos que requiere." }, 400);
  const courses = await programCourses(db, current.organizationId, program.id);
  const course = courses.find(item => item.id === value.courseId);
  if (!course || value.requiredIds.some(id => !courses.some(item => item.id === id))) return reply({ error: `Elige cursos del programa «${program.name}».` }, 400);
  const requirements = await requirementsIn(db, current.organizationId, courses.map(item => item.id));
  if (createsCycle(requirements, course.id, value.requiredIds)) return reply({ error: "Un curso no puede requerir un curso que depende de él: los requisitos formarían un ciclo." }, 409);
  const before = requirements.filter(item => item.courseId === course.id).map(item => item.requiredId);
  if (before.length === value.requiredIds.length && before.every(id => value.requiredIds.includes(id))) return reply(await pathOf(db, current.organizationId, program.id));
  const titles = value.requiredIds.map(id => courses.find(item => item.id === id)!.title);
  await db.batch([
    db.prepare("DELETE FROM course_prerequisites WHERE course_id=?").bind(course.id),
    ...value.requiredIds.map(id => db.prepare("INSERT INTO course_prerequisites(organization_id,course_id,required_course_id) VALUES (?,?,?)").bind(current.organizationId, course.id, id)),
    event(db, current, { action: "updated", targetType: "course", targetId: course.id, courseId: course.id, summary: titles.length ? `Definió que «${course.title}» requiere ${titles.map(title => `«${title}»`).join(", ")}` : `Quitó los requisitos de «${course.title}»` }),
  ]);
  return reply(await pathOf(db, current.organizationId, program.id));
}

/** What a course of a program requires and what requires it. */
export async function courseRequirements(db: Database, organizationId: string, courseId: string, programId?: string | null): Promise<CourseRequirements> {
  if (!programId) return { requires: [], unlocks: [] };
  const [requires, unlocks] = await db.batch([
    db.prepare("SELECT c.id,c.title,c.status FROM course_prerequisites p JOIN courses c ON c.id=p.required_course_id AND c.program_id=? WHERE p.organization_id=? AND p.course_id=? ORDER BY c.title COLLATE NOCASE").bind(programId, organizationId, courseId),
    db.prepare("SELECT c.id,c.title,c.status FROM course_prerequisites p JOIN courses c ON c.id=p.course_id AND c.program_id=? WHERE p.organization_id=? AND p.required_course_id=? ORDER BY c.title COLLATE NOCASE").bind(programId, organizationId, courseId),
  ]) as unknown as [CourseRequirements["requires"], CourseRequirements["unlocks"]];
  return { requires, unlocks };
}

/** A course that leaves its program leaves its requirements in that program too. */
export const leaveProgram = (db: Database, courseId: string) => db.prepare("DELETE FROM course_prerequisites WHERE course_id=? OR required_course_id=?").bind(courseId, courseId);
