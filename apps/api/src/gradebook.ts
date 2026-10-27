import type { AcademicYear, Gradebook, GradebookPeriod, GradeEntry, Member } from "@happy-learners/contracts";
import { gradeResult, maxGradeChanges, scoreInput } from "@happy-learners/domain";
import type { GradingPolicy } from "@happy-learners/domain";
import type { Database } from "./storage";
import { configurationOf } from "./courses";
import { scopedCourses } from "./permissions";
import { event } from "./team";

/**
 * The minimal gradebook (libreta) of a section: GET /api/sections/:id/grades[?year=], PUT the same path with
 * { grades: [{ learnerId, periodId, score|null }] }, and POST/DELETE /api/sections/:id/grades/periods/:periodId/lock.
 * Whoever sees the section reads it; administration and the section's educators write the scores of the current
 * year's open periods and lock a period; only administration reopens one. Scores belong to the roster's student ids.
 */
const reply = (value: unknown, status = 200) => Response.json(value, { status });
const gradesPath = /^\/api\/sections\/([a-z0-9-]+)\/grades$/;
const lockPath = /^\/api\/sections\/([a-z0-9-]+)\/grades\/periods\/(period-[a-f0-9-]{36})\/lock$/;

export function gradebookMethods(path: string): string[] | null {
  if (gradesPath.test(path)) return ["GET", "PUT"];
  if (lockPath.test(path)) return ["POST", "DELETE"];
  return null;
}

type SectionRow = Gradebook["section"] & { courseStatus: "active" | "archived"; teaches: number };
type Access = { section: SectionRow; write: boolean };

/** The section and what the person may do with its scores, or the response that refuses it. */
async function access(db: Database, current: Member, groupId: string): Promise<Access | Response> {
  const section = await db.prepare(`SELECT g.id,g.name,g.course_id AS courseId,c.title AS courseTitle,g.status,c.status AS courseStatus,
    EXISTS(SELECT 1 FROM section_educators e WHERE e.group_id=g.id AND e.user_id=?) AS teaches
    FROM course_groups g JOIN courses c ON c.id=g.course_id AND c.organization_id=g.organization_id WHERE g.id=? AND g.organization_id=?`).bind(current.id, groupId, current.organizationId).first<SectionRow>();
  if (!section) return reply({ error: "La sección no está disponible." }, 404);
  const admin = current.role === "admin", teaches = !!section.teaches;
  if (!admin && !teaches && !(await scopedCourses(db, current, ["classes.view", "sections.assign"])).includes(section.courseId)) return reply({ error: "Esta sección no está asignada a tu cuenta. Administración asigna quién imparte cada sección." }, 403);
  return { section, write: (admin || teaches) && section.status === "active" && section.courseStatus === "active" };
}

async function gradebook(db: Database, current: Member, { section, write }: Access, yearId?: string | null): Promise<Gradebook> {
  const years = (await db.prepare("SELECT id,name,status,starts_on AS \"from\",ends_on AS until FROM academic_years WHERE organization_id=? AND status IN ('current','closed') ORDER BY starts_on DESC,rowid DESC")
    .bind(current.organizationId).all<Pick<AcademicYear, "id" | "name" | "status" | "from" | "until">>()).results;
  const year = years.find(item => item.id === yearId) || years.find(item => item.status === "current") || years[0] || null;
  const configuration = await configurationOf(db, current.organizationId, section.courseId);
  const settings = configuration!.settings;
  const policy: GradingPolicy = { scale: settings.gradeScale, passingGrade: settings.passingGrade, letterThresholds: settings.letterThresholds, average: settings.gradeAverage };
  const { teaches: _, courseStatus: __, ...shown } = section;
  const open = !!year && year.status === "current";
  const base = { section: shown, years: years.map(({ id, name, status }) => ({ id, name, status })), policy, canEdit: write && open, canLock: write && open, canUnlock: current.role === "admin" && open };
  if (!year) return { ...base, year: null, periods: [], learners: [], grades: [], results: [] };
  const [periods, learners, grades] = await db.batch([
    db.prepare(`SELECT p.id,p.position,p.name,p.starts_on AS "from",p.ends_on AS until,p.weight,l.locked_at AS lockedAt,COALESCE(u.display_name,u.username) AS lockedBy
      FROM academic_periods p LEFT JOIN section_period_locks l ON l.period_id=p.id AND l.group_id=? LEFT JOIN users u ON u.id=l.locked_by WHERE p.year_id=? AND p.organization_id=? ORDER BY p.starts_on`).bind(section.id, year.id, current.organizationId),
    db.prepare("SELECT id,display_name AS name FROM group_learners WHERE group_id=? AND organization_id=? AND status='active' ORDER BY display_name COLLATE NOCASE,created_at,id").bind(section.id, current.organizationId),
    db.prepare("SELECT g.learner_id AS learnerId,g.period_id AS periodId,g.score FROM section_grades g JOIN academic_periods p ON p.id=g.period_id WHERE g.group_id=? AND g.organization_id=? AND p.year_id=?").bind(section.id, current.organizationId, year.id),
  ]) as unknown as [(Omit<GradebookPeriod, "locked">)[], { id: string; name: string }[], GradeEntry[]];
  const listed = periods.map(period => ({ ...period, locked: !!period.lockedAt || year.status === "closed" }));
  const shownGrades = grades.filter(grade => learners.some(learner => learner.id === grade.learnerId));
  const results = learners.map(learner => ({ learnerId: learner.id, ...gradeResult(listed.map(period => ({ score: shownGrades.find(grade => grade.learnerId === learner.id && grade.periodId === period.id)?.score ?? null, weight: period.weight })), policy) }));
  return { ...base, year: { id: year.id, name: year.name, from: year.from, until: year.until, status: year.status }, periods: listed, learners, grades: shownGrades, results };
}

type Change = { learnerId: string; periodId: string; score: number | null };
function changesInput(input: unknown): Change[] | string {
  const list = input && typeof input === "object" ? (input as Record<string, unknown>).grades : undefined;
  if (!Array.isArray(list) || !list.length) return "Escribe al menos una nota.";
  if (list.length > maxGradeChanges) return `Guarda hasta ${maxGradeChanges} notas a la vez.`;
  const changes: Change[] = [];
  for (const raw of list) {
    const item = raw && typeof raw === "object" ? raw as Record<string, unknown> : {};
    if (typeof item.learnerId !== "string" || typeof item.periodId !== "string") return "Revisa las notas: falta el estudiante o el periodo.";
    const score = scoreInput(item.score);
    if (score === undefined) return "Las notas van de 0 a 100, con un decimal como máximo.";
    changes.push({ learnerId: item.learnerId, periodId: item.periodId, score });
  }
  if (new Set(changes.map(change => `${change.learnerId}:${change.periodId}`)).size !== changes.length) return "Revisa las notas: hay una repetida.";
  return changes;
}

export async function grades(path: string, method: string, input: unknown, url: URL, current: Member, db: Database): Promise<Response> {
  const lock = lockPath.exec(path), groupId = lock ? lock[1] : gradesPath.exec(path)![1];
  const allowed = await access(db, current, groupId);
  if (allowed instanceof Response) return allowed;
  const { section } = allowed;
  if (method === "GET") return reply({ gradebook: await gradebook(db, current, allowed, url.searchParams.get("year")) });
  if (!allowed.write) return reply({ error: section.status !== "active" || section.courseStatus !== "active" ? "La sección está cerrada: sus notas ya no cambian." : "Solo administración y quienes imparten la sección registran sus notas." }, 403);
  const year = await db.prepare("SELECT id,name FROM academic_years WHERE organization_id=? AND status='current'").bind(current.organizationId).first<{ id: string; name: string }>();
  if (!year) return reply({ error: "No hay un ciclo lectivo vigente. Administración lo activa en Organización." }, 409);
  const periods = (await db.prepare(`SELECT p.id,p.name,l.locked_at AS lockedAt FROM academic_periods p LEFT JOIN section_period_locks l ON l.period_id=p.id AND l.group_id=? WHERE p.year_id=? AND p.organization_id=?`)
    .bind(groupId, year.id, current.organizationId).all<{ id: string; name: string; lockedAt: string | null }>()).results;
  const now = new Date().toISOString();

  if (lock) {
    const period = periods.find(item => item.id === lock[2]);
    if (!period) return reply({ error: "Ese periodo no es del ciclo vigente." }, 404);
    if (method === "POST") {
      if (period.lockedAt) return reply({ error: `Las notas de «${period.name}» ya están cerradas.` }, 409);
      await db.batch([
        db.prepare("INSERT INTO section_period_locks(group_id,organization_id,period_id,locked_by,locked_at) VALUES (?,?,?,?,?) ON CONFLICT(group_id,period_id) DO NOTHING").bind(groupId, current.organizationId, period.id, current.id, now),
        event(db, current, { action: "updated", targetType: "group", targetId: groupId, courseId: section.courseId, summary: `Cerró las notas de «${period.name}» en «${section.name}»` }),
      ]);
    } else {
      if (current.role !== "admin") return reply({ error: "Solo administración reabre las notas de un periodo." }, 403);
      if (!period.lockedAt) return reply({ error: `Las notas de «${period.name}» están abiertas.` }, 409);
      await db.batch([
        db.prepare("DELETE FROM section_period_locks WHERE group_id=? AND period_id=? AND organization_id=?").bind(groupId, period.id, current.organizationId),
        event(db, current, { action: "restored", targetType: "group", targetId: groupId, courseId: section.courseId, summary: `Reabrió las notas de «${period.name}» en «${section.name}»` }),
      ]);
    }
    return reply({ gradebook: await gradebook(db, current, allowed) });
  }

  const changes = changesInput(input);
  if (typeof changes === "string") return reply({ error: changes }, 400);
  const learners = new Set((await db.prepare("SELECT id FROM group_learners WHERE group_id=? AND organization_id=? AND status='active'").bind(groupId, current.organizationId).all<{ id: string }>()).results.map(row => row.id));
  if (changes.some(change => !learners.has(change.learnerId))) return reply({ error: "Revisa las notas: un estudiante no está en la lista de la sección." }, 400);
  const touched = [...new Set(changes.map(change => change.periodId))].map(id => periods.find(period => period.id === id));
  if (touched.some(period => !period)) return reply({ error: "Revisa las notas: un periodo no es del ciclo vigente." }, 400);
  const closed = touched.find(period => period!.lockedAt);
  if (closed) return reply({ error: `Las notas de «${closed.name}» están cerradas. Administración puede reabrirlas.` }, 409);
  const ids = touched.map(period => period!.id);
  // Compare-and-write: the year is still current and none of the periods was locked in between.
  const ok = await db.guardedBatch(db.prepare(`SELECT 1 FROM academic_years WHERE id=? AND status='current' AND NOT EXISTS (SELECT 1 FROM section_period_locks WHERE group_id=? AND period_id IN (${ids.map(() => "?").join(",")}))`).bind(year.id, groupId, ...ids), [
    ...changes.map(change => change.score === null
      ? db.prepare("DELETE FROM section_grades WHERE learner_id=? AND period_id=? AND group_id=? AND organization_id=?").bind(change.learnerId, change.periodId, groupId, current.organizationId)
      : db.prepare("INSERT INTO section_grades(id,organization_id,group_id,learner_id,period_id,score,updated_by,updated_at) VALUES (?,?,?,?,?,?,?,?) ON CONFLICT(learner_id,period_id) DO UPDATE SET score=excluded.score,updated_by=excluded.updated_by,updated_at=excluded.updated_at")
        .bind(`grade-${crypto.randomUUID()}`, current.organizationId, groupId, change.learnerId, change.periodId, change.score, current.id, now)),
    // The activity says that scores changed, never which ones.
    event(db, current, { action: "recorded", targetType: "group", targetId: groupId, courseId: section.courseId, summary: `Registró notas en «${section.name}» (${changes.length === 1 ? "1 cambio" : `${changes.length} cambios`})` }),
  ]);
  if (!ok) return reply({ error: "Las notas cambiaron de estado mientras las editabas. Recarga y vuelve a intentar." }, 409);
  return reply({ gradebook: await gradebook(db, current, allowed) });
}
