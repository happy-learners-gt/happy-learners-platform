import type { AcademicPeriod, AcademicYear, AcademicYearStatus, Member } from "@happy-learners/contracts";
import { academicYearEditable, academicYearInput, academicYearTransition, activationBlocker, nextAcademicYear } from "@happy-learners/domain";
import type { AcademicYearDraft } from "@happy-learners/domain";
import type { Database, Prepared } from "./storage";
import { todayFor } from "./classes";

/**
 * The organization's school year (ciclo lectivo) and its periods. Every member reads them (a section's schedule takes
 * the current year's dates as a suggestion); administration creates, edits, activates, closes and deletes drafts, and
 * opens the next year empty with the same pattern of periods. Rows live in academic_years and academic_periods (0048).
 */
const reply = (value: unknown, status = 200) => Response.json(value, { status });
const forbidden = () => reply({ error: "Solo administración gestiona el ciclo lectivo." }, 403);
const missing = () => reply({ error: "Ciclo lectivo no disponible." }, 404);
const changed = () => reply({ error: "El ciclo cambió mientras lo editabas. Recarga y vuelve a intentar." }, 409);
const itemPath = /^\/api\/academic-years\/(year-[a-f0-9-]{36})(?:\/(activate|close|next))?$/;

export function academicYearMethods(path: string): string[] | null {
  if (path === "/api/academic-years") return ["GET", "POST"];
  const match = itemPath.exec(path);
  if (!match) return null;
  return match[2] ? ["POST"] : ["PUT", "DELETE"];
}

type YearRow = Omit<AcademicYear, "periods">;
const yearColumns = "id,name,starts_on AS \"from\",ends_on AS until,status,period_kind AS periodKind,created_at AS createdAt,updated_at AS updatedAt,activated_at AS activatedAt,closed_at AS closedAt,program_id AS programId";

/** The organization's years, newest first, each with its periods in order. */
export async function academicYears(db: Database, organizationId: string, id?: string): Promise<AcademicYear[]> {
  const [years, periods] = await db.batch([
    db.prepare(`SELECT ${yearColumns} FROM academic_years WHERE organization_id=?${id ? " AND id=?" : ""} ORDER BY starts_on DESC,rowid DESC`).bind(...(id ? [organizationId, id] : [organizationId])),
    db.prepare(`SELECT p.year_id AS yearId,p.id,p.position,p.name,p.starts_on AS "from",p.ends_on AS until,p.weight FROM academic_periods p JOIN academic_years y ON y.id=p.year_id AND y.organization_id=p.organization_id
      WHERE p.organization_id=?${id ? " AND p.year_id=?" : ""} ORDER BY p.starts_on`).bind(...(id ? [organizationId, id] : [organizationId])),
  ]) as [YearRow[], (AcademicPeriod & { yearId: string })[]];
  return years.map(year => ({ ...year, periods: periods.filter(period => period.yearId === year.id).map(({ yearId: _, ...period }) => period) }));
}
/** The year in force today, if administration activated one. */
export const currentAcademicYear = async (db: Database, organizationId: string, programId: string | null = null) =>
  (await db.prepare(`SELECT ${yearColumns} FROM academic_years WHERE organization_id=? AND program_id IS ? AND status='current'`).bind(organizationId, programId).first<YearRow>());

/** The statements that write a year's periods: removed ones go, kept ones keep their id, new ones get one. */
function periodStatements(db: Database, organizationId: string, yearId: string, draft: AcademicYearDraft): Prepared[] {
  const kept = draft.periods.map(period => period.id).filter((id): id is string => !!id);
  return [
    db.prepare(`DELETE FROM academic_periods WHERE year_id=? AND organization_id=?${kept.length ? ` AND id NOT IN (${kept.map(() => "?").join(",")})` : ""}`).bind(yearId, organizationId, ...kept),
    ...draft.periods.map((period, index) => period.id
      ? db.prepare("UPDATE academic_periods SET position=?,name=?,starts_on=?,ends_on=?,weight=? WHERE id=? AND year_id=? AND organization_id=?").bind(index + 1, period.name, period.from, period.until, period.weight, period.id, yearId, organizationId)
      : db.prepare("INSERT INTO academic_periods(id,organization_id,year_id,position,name,starts_on,ends_on,weight) VALUES (?,?,?,?,?,?,?,?)").bind(`period-${crypto.randomUUID()}`, organizationId, yearId, index + 1, period.name, period.from, period.until, period.weight)),
  ];
}
const nameTaken = (db: Database, organizationId: string, programId: string | null, name: string, except: string) =>
  db.prepare("SELECT 1 FROM academic_years WHERE organization_id=? AND program_id IS ? AND lower(name)=lower(?) AND id<>?").bind(organizationId, programId, name, except).first();
const duplicateName = (name: string) => reply({ error: `Ya existe un ciclo llamado «${name}». Usa otro nombre.` }, 409);

async function create(db: Database, current: Member, draft: AcademicYearDraft, programId: string | null = null) {
  if (programId && !await db.prepare("SELECT id FROM study_programs WHERE id=? AND organization_id=?").bind(programId, current.organizationId).first())
    return reply({ error: "Elige un programa de tu organización." }, 400);
  if (await nameTaken(db, current.organizationId, programId, draft.name, "")) return duplicateName(draft.name);
  const id = `year-${crypto.randomUUID()}`, now = new Date().toISOString();
  const ok = await db.guardedBatch(db.prepare("SELECT 1 WHERE NOT EXISTS (SELECT 1 FROM academic_years WHERE organization_id=? AND program_id IS ? AND lower(name)=lower(?))").bind(current.organizationId, programId, draft.name), [
    db.prepare("INSERT INTO academic_years(id,organization_id,name,starts_on,ends_on,period_kind,status,created_by,created_at,updated_at,program_id) VALUES (?,?,?,?,?,?,'draft',?,?,?,?)")
      .bind(id, current.organizationId, draft.name, draft.from, draft.until, draft.periodKind, current.id, now, now, programId),
    ...periodStatements(db, current.organizationId, id, draft),
  ]);
  if (!ok) return duplicateName(draft.name);
  return reply({ year: (await academicYears(db, current.organizationId, id))[0] }, 201);
}

export async function academicYearsApi(path: string, method: string, input: unknown, current: Member, db: Database): Promise<Response> {
  if (path === "/api/academic-years" && method === "GET") return reply({ years: await academicYears(db, current.organizationId), today: await todayFor(db, current.organizationId) });
  if (current.role !== "admin") return forbidden();
  if (path === "/api/academic-years") {
    const programId = typeof (input as Record<string, unknown> | null)?.programId === "string" ? String((input as Record<string, unknown>).programId) : null;
    const draft = academicYearInput(input);
    if ("error" in draft) return reply(draft, 400);
    if (draft.periods.some(period => period.id)) return reply({ error: "Revisa los periodos: uno no es válido." }, 400);
    return create(db, current, draft, programId);
  }
  const [, id, action] = itemPath.exec(path)!;
  const found = (await academicYears(db, current.organizationId, id))[0];
  if (!found) return missing();
  const now = new Date().toISOString();
  if (action === "next") {
    const draft = academicYearInput(nextAcademicYear(found));
    if ("error" in draft) return reply({ error: `No se pudo preparar el siguiente ciclo: ${draft.error}` }, 409);
    return create(db, current, draft, found.programId || null);
  }
  if (action === "activate") {
    const anotherCurrent = !!await currentAcademicYear(db, current.organizationId, found.programId || null);
    const blocked = activationBlocker(found, anotherCurrent);
    if (blocked) return reply({ error: blocked }, 409);
    const ok = await db.guardedBatch(db.prepare("SELECT 1 FROM academic_years y WHERE y.id=? AND y.organization_id=? AND y.status='draft' AND EXISTS (SELECT 1 FROM academic_periods p WHERE p.year_id=y.id) AND NOT EXISTS (SELECT 1 FROM academic_years o WHERE o.organization_id=y.organization_id AND o.program_id IS y.program_id AND o.status='current')").bind(id, current.organizationId), [
      db.prepare("UPDATE academic_years SET status=?,activated_at=?,updated_at=? WHERE id=? AND organization_id=? AND status='draft'").bind(academicYearTransition(found.status, "activate")!, now, now, id, current.organizationId),
    ]);
    if (!ok) return changed();
    return reply({ year: (await academicYears(db, current.organizationId, id))[0] });
  }
  if (action === "close") {
    const next = academicYearTransition(found.status, "close");
    if (!next) return reply({ error: found.status === "closed" ? "Este ciclo ya está cerrado." : "Solo se cierra el ciclo vigente." }, 409);
    // Closing ends the year's records; it promotes nobody and copies nothing to the next year.
    const ok = await db.guardedBatch(db.prepare("SELECT 1 FROM academic_years WHERE id=? AND organization_id=? AND status='current'").bind(id, current.organizationId), [
      db.prepare("UPDATE academic_years SET status=?,closed_at=max(?,activated_at),updated_at=? WHERE id=? AND organization_id=? AND status='current'").bind(next, now, now, id, current.organizationId),
    ]);
    if (!ok) return changed();
    return reply({ year: (await academicYears(db, current.organizationId, id))[0] });
  }
  if (method === "DELETE") {
    if (found.status !== "draft") return reply({ error: "Solo se elimina un ciclo en borrador. Un ciclo vigente se cierra." }, 409);
    const ok = await db.guardedBatch(db.prepare("SELECT 1 FROM academic_years WHERE id=? AND organization_id=? AND status='draft'").bind(id, current.organizationId), [
      db.prepare("DELETE FROM academic_periods WHERE year_id=? AND organization_id=?").bind(id, current.organizationId),
      db.prepare("DELETE FROM academic_years WHERE id=? AND organization_id=? AND status='draft'").bind(id, current.organizationId),
    ]);
    if (!ok) return changed();
    return reply({ ok: true });
  }
  if (!academicYearEditable(found.status)) return reply({ error: "Un ciclo cerrado ya no se edita." }, 409);
  const draft = academicYearInput(input);
  if ("error" in draft) return reply(draft, 400);
  if (found.status === "current" && !draft.periods.length) return reply({ error: "El ciclo vigente necesita al menos un periodo." }, 400);
  const own = new Set(found.periods.map(period => period.id));
  if (draft.periods.some(period => period.id && !own.has(period.id))) return reply({ error: "Revisa los periodos: uno no es de este ciclo." }, 400);
  // A period where grades were recorded stays (0049).
  const kept = new Set(draft.periods.map(period => period.id)), removed = found.periods.filter(period => !kept.has(period.id));
  const graded = removed.length ? await db.prepare(`SELECT p.name FROM academic_periods p WHERE p.id IN (${removed.map(() => "?").join(",")}) AND (EXISTS (SELECT 1 FROM section_grades g WHERE g.period_id=p.id) OR EXISTS (SELECT 1 FROM assessment_activities a WHERE a.period_id=p.id)) LIMIT 1`).bind(...removed.map(period => period.id)).first<{ name: string }>() : null;
  if (graded) return reply({ error: `«${graded.name}» ya tiene notas registradas: no se puede quitar.` }, 409);
  if (await nameTaken(db, current.organizationId, found.programId || null, draft.name, id)) return duplicateName(draft.name);
  const status: AcademicYearStatus = found.status;
  const ok = await db.guardedBatch(db.prepare("SELECT 1 FROM academic_years y WHERE y.id=? AND y.organization_id=? AND y.status=? AND NOT EXISTS (SELECT 1 FROM academic_years o WHERE o.organization_id=y.organization_id AND o.program_id IS y.program_id AND lower(o.name)=lower(?) AND o.id<>y.id)").bind(id, current.organizationId, status, draft.name), [
    db.prepare("UPDATE academic_years SET name=?,starts_on=?,ends_on=?,period_kind=?,updated_at=? WHERE id=? AND organization_id=? AND status=?").bind(draft.name, draft.from, draft.until, draft.periodKind, now, id, current.organizationId, status),
    ...periodStatements(db, current.organizationId, id, draft),
  ]);
  if (!ok) return changed();
  return reply({ year: (await academicYears(db, current.organizationId, id))[0] });
}
