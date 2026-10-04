import type { LessonAssignment, Member } from "@happy-learners/contracts";
import { assignmentAvailability, assignmentPeriod, assignmentPeriodError, effectivePublication } from "@happy-learners/domain";
import type { Database } from "./storage";
import { event } from "./team";

const reply = (data: unknown, status = 200) => Response.json(data, { status });
type Row = {
  id: string; course_id: string; group_id: string; group_name: string; lesson_id: string; title: string | null; unit_name: string | null;
  starts_on: string; ends_on: string | null; status: "active" | "withdrawn"; assigned_revision: number;
  archived: number; published: number; revision: number; share_code: string | null; course_title?: string;
};
type LessonFacts = { id: string; title: string; revision: number; archived: number; published: number };

/** Today in the organization's time zone, as a calendar day. */
export async function organizationToday(db: Database, organizationId: string) {
  const zone = (await db.prepare("SELECT timezone FROM organizations WHERE id=?").bind(organizationId).first<{ timezone: string | null }>())?.timezone || "America/Guatemala";
  return new Intl.DateTimeFormat("en-CA", { timeZone: zone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}

const assignmentQuery = `SELECT a.id,a.course_id,a.group_id,g.name AS group_name,a.lesson_id,
  json_extract(COALESCE(l.published_content,l.content),'$.title') AS title,u.name AS unit_name,a.starts_on,a.ends_on,a.status,
  a.assigned_revision,l.archived,(l.published_content IS NOT NULL) AS published,l.revision,
  json_extract(l.published_content,'$.shareCode') AS share_code,c.title AS course_title
  FROM lesson_assignments a JOIN course_groups g ON g.id=a.group_id JOIN lessons l ON l.id=a.lesson_id JOIN courses c ON c.id=a.course_id
  LEFT JOIN learning_units u ON u.id=l.course_unit_id
  WHERE a.organization_id=?`;

export function assignmentView(row: Row, today: string): LessonAssignment {
  const availability = assignmentAvailability({ archived: !!row.archived, published: !!row.published, revision: row.revision }, row.assigned_revision);
  return {
    id: row.id, courseId: row.course_id, groupId: row.group_id, groupName: row.group_name, lessonId: row.lesson_id,
    lessonTitle: row.title || "Lección sin título", ...(row.unit_name ? { unitName: row.unit_name } : {}),
    startsOn: row.starts_on, endsOn: row.ends_on, status: row.status, assignedRevision: row.assigned_revision,
    publishedRevision: availability === "unavailable" ? null : row.revision, availability,
    period: assignmentPeriod(row.starts_on, row.ends_on, today), requiresSubstitution: availability === "unavailable",
    // Resolved from the published snapshot only; draft content is never read here.
    effective: effectivePublication({ archived: !!row.archived, published: !!row.published, revision: row.revision, shareCode: row.share_code }),
    ...(row.course_title ? { courseTitle: row.course_title } : {}),
  };
}

export async function assignmentsFor(db: Database, organizationId: string, courseId: string) {
  const today = await organizationToday(db, organizationId);
  const rows = await db.prepare(assignmentQuery + " AND a.course_id=? AND a.status='active' ORDER BY g.name,a.starts_on,title,a.id").bind(organizationId, courseId).all<Row>();
  return { today, assignments: rows.results.map(row => assignmentView(row, today)) };
}

/** GET /api/assignments — current assignments of the courses whose teaching team includes the educator (ST-029). */
export async function currentAssignments(current: Member, db: Database) {
  if (current.role !== "educator") return reply({ error: "Solo educadores consultan sus asignaciones." }, 403);
  const today = await organizationToday(db, current.organizationId);
  const rows = await db.prepare(assignmentQuery + " AND a.status='active' AND c.status='active' AND g.status='active' AND a.starts_on<=? AND (a.ends_on IS NULL OR a.ends_on>=?) AND EXISTS(SELECT 1 FROM course_members m WHERE m.course_id=a.course_id AND m.user_id=?) ORDER BY c.title,g.name,title,a.id")
    .bind(current.organizationId, today, today, current.id).all<Row>();
  return reply({ today, assignments: rows.results.map(row => assignmentView(row, today)) });
}

async function publishedLesson(db: Database, courseId: string, lessonId: unknown) {
  if (typeof lessonId !== "string" || !lessonId) return { error: reply({ error: "Selecciona una lección publicada." }, 400) };
  const lesson = await db.prepare("SELECT l.id,json_extract(COALESCE(l.published_content,l.content),'$.title') AS title,l.revision,l.archived,(l.published_content IS NOT NULL) AS published FROM lessons l JOIN learning_units u ON u.id=l.course_unit_id WHERE l.id=? AND u.course_id=?").bind(lessonId, courseId).first<LessonFacts>();
  if (!lesson) return { error: reply({ error: "La lección seleccionada no pertenece a este curso." }, 400) };
  // Only content students can open may be assigned: never a draft, an unpublished or an archived lesson.
  if (lesson.archived || !lesson.published || lesson.revision < 1) return { error: reply({ error: "Solo se pueden asignar lecciones publicadas. Publica la lección antes de asignarla." }, 400) };
  return { lesson };
}

/** /api/courses/:course/assignments[/:assignment] — educators of the organization; the caller checked the course. */
export async function assignments(parts: string[], method: string, input: unknown, current: Member, db: Database, courseId: string) {
  const now = new Date().toISOString();
  if (parts.length === 5) {
    if (method === "GET") return reply(await assignmentsFor(db, current.organizationId, courseId));
    const value = input as Record<string, unknown> | null;
    const group = await db.prepare("SELECT id,name FROM course_groups WHERE id=? AND course_id=? AND organization_id=? AND status='active'").bind(String(value?.groupId || ""), courseId, current.organizationId).first<{ id: string; name: string }>();
    if (!group) return reply({ error: "Selecciona un grupo activo de este curso." }, 400);
    const { lesson, error } = await publishedLesson(db, courseId, value?.lessonId);
    if (error) return error;
    const periodError = assignmentPeriodError(value?.startsOn, value?.endsOn);
    if (periodError) return reply({ error: periodError }, 400);
    const endsOn = typeof value?.endsOn === "string" && value.endsOn ? value.endsOn : null;
    if (await db.prepare("SELECT id FROM lesson_assignments WHERE group_id=? AND lesson_id=? AND status='active'").bind(group.id, lesson!.id).first())
      return reply({ error: `«${lesson!.title}» ya está asignada a ${group.name}. Retira la asignación actual para cambiar sus fechas.` }, 409);
    const id = `assignment-${crypto.randomUUID()}`;
    await db.batch([
      db.prepare("INSERT INTO lesson_assignments(id,organization_id,course_id,group_id,lesson_id,starts_on,ends_on,assigned_revision,status,created_by,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,'active',?,?,?)")
        .bind(id, current.organizationId, courseId, group.id, lesson!.id, String(value!.startsOn), endsOn, lesson!.revision, current.id, now, now),
      event(db, current, { action: "assigned", targetType: "lesson", targetId: lesson!.id, courseId, summary: `Asignó «${lesson!.title}» a ${group.name}` }),
    ]);
    return reply({ id }, 201);
  }
  if (parts.length !== 6 || method !== "PUT") return reply({ error: "Ruta no disponible." }, 404);
  const row = await db.prepare(assignmentQuery + " AND a.course_id=? AND a.id=? AND a.status='active'").bind(current.organizationId, courseId, parts[5]).first<Row>();
  if (!row) return reply({ error: "La asignación no está disponible en este curso." }, 404);
  const value = input as Record<string, unknown> | null;
  const title = row.title || "la lección";
  if (value?.action === "withdraw") {
    await db.batch([
      db.prepare("UPDATE lesson_assignments SET status='withdrawn',updated_at=? WHERE id=? AND status='active'").bind(now, row.id),
      event(db, current, { action: "updated", targetType: "lesson", targetId: row.lesson_id, courseId, summary: `Retiró «${title}» de ${row.group_name}` }),
    ]);
    return reply({ ok: true });
  }
  if (value?.action === "adopt") {
    // Acknowledges the newer publication the group already receives.
    if (row.archived || !row.published || row.revision <= row.assigned_revision) return reply({ error: "No hay una publicación más reciente que confirmar." }, 409);
    await db.batch([
      db.prepare("UPDATE lesson_assignments SET assigned_revision=?,updated_at=? WHERE id=?").bind(row.revision, now, row.id),
      event(db, current, { action: "updated", targetType: "lesson", targetId: row.lesson_id, courseId, summary: `Confirmó la publicación ${row.revision} de «${title}» para ${row.group_name}` }),
    ]);
    return reply({ ok: true });
  }
  if (value?.action === "substitute") {
    const { lesson, error } = await publishedLesson(db, courseId, value.lessonId);
    if (error) return error;
    if (lesson!.id !== row.lesson_id && await db.prepare("SELECT id FROM lesson_assignments WHERE group_id=? AND lesson_id=? AND status='active'").bind(row.group_id, lesson!.id).first())
      return reply({ error: `«${lesson!.title}» ya está asignada a ${row.group_name}.` }, 409);
    await db.batch([
      db.prepare("UPDATE lesson_assignments SET lesson_id=?,assigned_revision=?,updated_at=? WHERE id=?").bind(lesson!.id, lesson!.revision, now, row.id),
      event(db, current, { action: "assigned", targetType: "lesson", targetId: lesson!.id, courseId, summary: `Sustituyó «${title}» por «${lesson!.title}» en ${row.group_name}` }),
    ]);
    return reply({ ok: true });
  }
  return reply({ error: "Acción no reconocida." }, 400);
}
