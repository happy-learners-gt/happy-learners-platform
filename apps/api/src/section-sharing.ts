import type { CourseAccess, Member } from "@happy-learners/contracts";
import { teachesSection } from "@happy-learners/domain";
import type { Database } from "./storage";
import { forbidden } from "./access";
import { freedomPolicyOf, freedomReviewOf } from "./freedom-plan";
import { reviewersOf } from "./notifications";
import { notify, type Notifier } from "./notify";
import { recordEvent } from "./activity";

const reply = (value: unknown, status = 200) => Response.json(value, { status });
type SectionRow = { id: string; name: string; courseId: string; status: string };
type Kind = "unit" | "lesson" | "activity";

const reachable = (current: Member, access: CourseAccess, groupId: string) =>
  current.role === "admin" || access.sections === "all" || access.review || teachesSection(access, groupId);

/** A section's own unit, copies to other sections, and proposals the lead accepts or rejects. */
export async function sectionSharing(area: string, method: string, input: unknown, current: Member, db: Database, section: SectionRow, access: CourseAccess, notifier?: Notifier): Promise<Response | null> {
  if (area === "units" && method === "POST") return ownUnit(db, current, section, input);
  if (area === "copies" && method === "POST") return copyTo(db, current, section, access, input, notifier);
  if (area === "proposals" && method === "POST") return propose(db, current, section, access, input, notifier);
  if (area === "reviews" && method === "POST") return reviewItem(db, current, section, access, input, notifier);
  return null;
}

export async function courseProposals(courseId: string, proposalId: string | null, method: string, input: unknown, current: Member, db: Database, access: CourseAccess, notifier?: Notifier): Promise<Response> {
  if (current.role !== "admin" && !access.publish && !access.review) return forbidden("Las propuestas las ve la persona responsable del curso.");
  if (method === "GET" && !proposalId) return reply({ proposals: await listProposals(db, current.organizationId, courseId) });
  if (method === "POST" && proposalId) return decideProposal(db, current, courseId, proposalId, input, notifier);
  return reply({ error: "La propuesta no está disponible." }, 404);
}

async function ownUnit(db: Database, current: Member, section: SectionRow, input: unknown) {
  const body = input && typeof input === "object" ? input as Record<string, unknown> : null;
  const name = typeof body?.name === "string" ? body.name.trim() : "";
  const objective = typeof body?.objective === "string" ? body.objective.trim() : "";
  if (!name || name.length > 160 || objective.length > 1000) return reply({ error: "Escribe el nombre de la unidad, de hasta 160 caracteres." }, 400);
  const position = ((await db.prepare("SELECT COALESCE(MAX(position),-1) AS position FROM learning_units WHERE course_id=? AND (group_id IS NULL OR group_id=?)").bind(section.courseId, section.id).first<{ position: number }>())?.position ?? -1) + 1;
  const id = `learning-unit-${crypto.randomUUID()}`;
  const now = new Date().toISOString();
  await db.prepare("INSERT INTO learning_units(id,course_id,name,objective,position,status,updated_at,group_id) VALUES (?,?,?,?,?,'active',?,?)").bind(id, section.courseId, name, objective, position, now, section.id).run();
  await recordEvent(db, current, { action: "created", targetType: "course", targetId: section.courseId, courseId: section.courseId, groupId: section.id, summary: `Creó la unidad propia «${name}» en «${section.name}»` });
  return reply({ id, name }, 201);
}

async function copyTo(db: Database, current: Member, section: SectionRow, access: CourseAccess, input: unknown, notifier?: Notifier) {
  const body = input && typeof input === "object" ? input as Record<string, unknown> : null;
  const itemType = kindOf(body?.itemType);
  const itemId = typeof body?.itemId === "string" ? body.itemId : "";
  const sectionIds = Array.isArray(body?.sectionIds) ? body.sectionIds.filter((id): id is string => typeof id === "string") : [];
  if (!itemType || !itemId || !sectionIds.length) return reply({ error: "Elige qué copiar y al menos una sección." }, 400);
  const copies: string[] = [];
  for (const destination of sectionIds) {
    if (destination === section.id) return reply({ error: "La copia va a otra sección." }, 400);
    if (!reachable(current, access, destination)) return forbidden("Solo puedes copiar a una sección que impartes, o a una de tu alcance.");
    const target = await db.prepare("SELECT id,name,course_id AS courseId,status FROM course_groups WHERE id=? AND organization_id=? AND course_id=?").bind(destination, current.organizationId, section.courseId).first<SectionRow>();
    if (!target || target.status !== "active") return reply({ error: "Elige una sección activa de este curso." }, 400);
    const id = await duplicate(db, current, section, target, itemType, itemId, notifier);
    if (typeof id !== "string") return id;
    copies.push(id);
  }
  await recordEvent(db, current, { action: "created", targetType: "course", targetId: section.courseId, courseId: section.courseId, groupId: section.id, summary: `Copió un elemento de «${section.name}» a ${copies.length} ${copies.length === 1 ? "sección" : "secciones"}` });
  return reply({ copies }, 201);
}

async function propose(db: Database, current: Member, section: SectionRow, access: CourseAccess, input: unknown, notifier?: Notifier) {
  if (!teachesSection(access, section.id) && current.role !== "admin") return forbidden("Quien imparte la sección propone lo propio al curso.");
  const body = input && typeof input === "object" ? input as Record<string, unknown> : null;
  const itemType = kindOf(body?.itemType);
  const itemId = typeof body?.itemId === "string" ? body.itemId : "";
  if (!itemType || !itemId) return reply({ error: "Elige la lección, la unidad o la actividad propia." }, 400);
  const title = await ownTitle(db, section, itemType, itemId);
  if (!title) return reply({ error: "Solo se propone algo propio de esta sección." }, 404);
  const id = `proposal-${crypto.randomUUID()}`;
  const now = new Date().toISOString();
  await db.prepare("INSERT INTO section_proposals(id,group_id,item_type,item_id,status,comment,created_by,decided_by,created_at,decided_at,result_id) VALUES (?,?,?,?,'pending',NULL,?,NULL,?,NULL,NULL)")
    .bind(id, section.id, itemType, itemId, current.id, now).run();
  const course = await courseTitle(db, section.courseId);
  await notify(db, notifier, current, (await reviewersOf(db, current.organizationId, section.courseId)).map(userId => ({
    userId, facts: { type: "review_submitted" as const, course, lesson: title, actor: current.displayName || current.username }, targetId: id, path: `/cursos/${section.courseId}/contenido`,
  })));
  await recordEvent(db, current, { action: "created", targetType: "course", targetId: section.courseId, courseId: section.courseId, groupId: section.id, summary: `Propuso «${title}» de «${section.name}» al curso` });
  return reply({ id }, 201);
}

async function reviewItem(db: Database, current: Member, section: SectionRow, access: CourseAccess, input: unknown, notifier?: Notifier) {
  if (current.role !== "admin" && !access.publish && !access.review) return forbidden("La persona responsable del curso aprueba lo propio.");
  const body = input && typeof input === "object" ? input as Record<string, unknown> : null;
  const itemType = kindOf(body?.itemType);
  const itemId = typeof body?.itemId === "string" ? body.itemId : "";
  const decision = body?.decision === "approve" || body?.decision === "return" ? body.decision : null;
  const comment = typeof body?.comment === "string" ? body.comment.trim() : "";
  if (!itemType || !itemId || !decision) return reply({ error: "Elige qué revisar." }, 400);
  if (decision === "return" && (!comment || comment.length > 600)) return reply({ error: "Escribe qué falta ajustar, en hasta 600 caracteres." }, 400);
  const now = new Date().toISOString();
  if (itemType === "activity") {
    const row = await db.prepare("SELECT title,created_by AS createdBy FROM assessment_activities WHERE id=? AND group_id=? AND review_status='pending'").bind(itemId, section.id).first<{ title: string; createdBy: string }>();
    if (!row) return reply({ error: "Esa actividad ya no está en revisión." }, 409);
    await db.prepare("UPDATE assessment_activities SET review_status=?,updated_at=? WHERE id=?").bind(decision === "approve" ? null : "returned", now, itemId).run();
    await tell(db, notifier, current, section, row.createdBy, row.title, decision, comment);
    return reply({ ok: true });
  }
  if (itemType === "lesson") {
    const pending = await db.prepare("SELECT requested_by AS id FROM lesson_reviews WHERE lesson_id=? AND status='pending'").bind(itemId).first<{ id: string }>();
    if (!pending) return reply({ error: "Esa lección ya no está en revisión." }, 409);
    if (decision === "return") {
      await db.prepare("UPDATE lesson_reviews SET status='returned',decided_by=?,decided_at=?,decision_note=? WHERE lesson_id=? AND status='pending'").bind(current.id, now, comment, itemId).run();
    } else {
      await db.prepare("UPDATE lesson_reviews SET status='approved',decided_by=?,decided_at=? WHERE lesson_id=? AND status='pending'").bind(current.id, now, itemId).run();
      await db.prepare("UPDATE lessons SET status='published',revision=CASE WHEN revision<1 THEN 1 ELSE revision END,published_content=content,published_version=draft_version,updated_at=? WHERE id=? AND group_id=?").bind(now, itemId, section.id).run();
    }
    const title = await ownTitle(db, section, "lesson", itemId);
    await tell(db, notifier, current, section, pending.id, title || "Lección", decision, comment);
    return reply({ ok: true });
  }
  return reply({ error: "Una unidad propia no pasa por revisión." }, 400);
}

async function decideProposal(db: Database, current: Member, courseId: string, proposalId: string, input: unknown, notifier?: Notifier) {
  const body = input && typeof input === "object" ? input as Record<string, unknown> : null;
  const decision = body?.decision === "accept" || body?.decision === "reject" ? body.decision : null;
  const comment = typeof body?.comment === "string" ? body.comment.trim() : "";
  if (!decision) return reply({ error: "Acepta o rechaza la propuesta." }, 400);
  if (decision === "reject" && (!comment || comment.length > 600)) return reply({ error: "Escribe por qué la rechazas, en hasta 600 caracteres." }, 400);
  const proposal = await db.prepare("SELECT id,group_id AS groupId,item_type AS itemType,item_id AS itemId,status,created_by AS createdBy FROM section_proposals WHERE id=? AND status='pending'").bind(proposalId).first<{ id: string; groupId: string; itemType: Kind; itemId: string; status: string; createdBy: string }>();
  if (!proposal) return reply({ error: "Esa propuesta ya fue decidida." }, 409);
  const section = await db.prepare("SELECT id,name,course_id AS courseId,status FROM course_groups WHERE id=? AND course_id=? AND organization_id=?").bind(proposal.groupId, courseId, current.organizationId).first<SectionRow>();
  if (!section) return reply({ error: "La propuesta no es de este curso." }, 404);
  const now = new Date().toISOString();
  const title = await ownTitle(db, section, proposal.itemType, proposal.itemId) || "Elemento";
  if (decision === "reject") {
    await db.prepare("UPDATE section_proposals SET status='rejected',comment=?,decided_by=?,decided_at=? WHERE id=? AND status='pending'").bind(comment, current.id, now, proposal.id).run();
    await tell(db, notifier, current, section, proposal.createdBy, title, "return", comment);
    await recordEvent(db, current, { action: "updated", targetType: "course", targetId: courseId, courseId, groupId: section.id, summary: `Rechazó la propuesta «${title}» de «${section.name}»` });
    return reply({ ok: true });
  }
  const core = body?.core === true;
  const graded = proposal.itemType === "activity" && await db.prepare("SELECT 1 AS ok FROM assessment_scores WHERE activity_id=? AND group_id=?").bind(proposal.itemId, section.id).first();
  const keepOwn = graded ? true : body?.keepOwn !== false;
  const resultId = await adopt(db, current, section, proposal.itemType, proposal.itemId, core);
  if (typeof resultId !== "string") return resultId;
  if (!keepOwn) await retire(db, section, proposal.itemType, proposal.itemId, now);
  await db.prepare("UPDATE section_proposals SET status='accepted',comment=?,decided_by=?,decided_at=?,result_id=? WHERE id=?").bind(comment || null, current.id, now, resultId, proposal.id).run();
  await tell(db, notifier, current, section, proposal.createdBy, title, "approve", comment);
  await recordEvent(db, current, { action: "updated", targetType: "course", targetId: courseId, courseId, groupId: section.id, summary: `Aceptó la propuesta «${title}» de «${section.name}»` });
  return reply({ id: resultId, kept: keepOwn });
}

async function duplicate(db: Database, current: Member, source: SectionRow, target: SectionRow, itemType: Kind, itemId: string, notifier?: Notifier): Promise<string | Response> {
  const review = await freedomReviewOf(db, current.organizationId, source.courseId);
  if (itemType === "unit") return copyUnit(db, current, source, target, itemId, review, notifier);
  if (itemType === "lesson") return copyLesson(db, current, source, target, itemId, null, review, notifier);
  return copyActivity(db, current, source, target, itemId, review);
}

async function copyUnit(db: Database, current: Member, source: SectionRow, target: SectionRow, unitId: string, review: boolean, notifier?: Notifier) {
  const unit = await db.prepare("SELECT name,objective FROM learning_units WHERE id=? AND course_id=? AND group_id=?").bind(unitId, source.courseId, source.id).first<{ name: string; objective: string }>();
  if (!unit) return reply({ error: "Solo se copia una unidad propia de esta sección." }, 404);
  const created = await ownUnit(db, current, target, { name: unit.name, objective: unit.objective });
  if (!created.ok) return created;
  const copy = await created.json() as { id: string };
  const lessons = (await db.prepare("SELECT id FROM lessons WHERE course_unit_id=? AND group_id=? AND archived=0").bind(unitId, source.id).all<{ id: string }>()).results;
  for (const lesson of lessons) {
    const copied = await copyLesson(db, current, source, target, lesson.id, copy.id, review, notifier);
    if (typeof copied !== "string") return copied;
  }
  return copy.id;
}

async function copyLesson(db: Database, current: Member, source: SectionRow, target: SectionRow, lessonId: string, unitId: string | null, review: boolean, notifier?: Notifier): Promise<string | Response> {
  const row = await db.prepare("SELECT content,program_id AS programId,unit_id AS unitId,course_unit_id AS courseUnitId FROM lessons WHERE id=? AND group_id=? AND archived=0").bind(lessonId, source.id).first<{ content: string; programId: string; unitId: string | null; courseUnitId: string }>();
  if (!row) return reply({ error: "Solo se copia una lección propia de esta sección." }, 404);
  const now = new Date().toISOString();
  const sourceUnit = await db.prepare("SELECT group_id AS groupId,name,objective FROM learning_units WHERE id=?").bind(row.courseUnitId).first<{ groupId: string | null; name: string; objective: string }>();
  let courseUnitId = unitId || (sourceUnit?.groupId ? null : row.courseUnitId);
  if (!courseUnitId && sourceUnit?.groupId) {
    courseUnitId = `learning-unit-${crypto.randomUUID()}`;
    const unitPosition = ((await db.prepare("SELECT COALESCE(MAX(position),-1) AS position FROM learning_units WHERE course_id=? AND (group_id IS NULL OR group_id=?)").bind(target.courseId, target.id).first<{ position: number }>())?.position ?? -1) + 1;
    await db.prepare("INSERT INTO learning_units(id,course_id,name,objective,position,status,updated_at,group_id) VALUES (?,?,?,?,?,'active',?,?)").bind(courseUnitId, target.courseId, sourceUnit.name, sourceUnit.objective, unitPosition, now, target.id).run();
  }
  if (!courseUnitId) return reply({ error: "Copia la unidad propia: la lección no tiene una unidad del curso." }, 400);
  const content = JSON.parse(row.content) as { title: string; shareCode?: string };
  const id = `lesson-${crypto.randomUUID()}`;
  content.shareCode = content.shareCode ? `${content.shareCode.slice(0, 4)}${crypto.randomUUID().replaceAll("-", "").slice(0, 12).toUpperCase()}` : undefined;
  const position = ((await db.prepare("SELECT COALESCE(MAX(position),-1) AS position FROM lessons WHERE course_unit_id=? AND (group_id IS NULL OR group_id=?)").bind(courseUnitId, target.id).first<{ position: number }>())?.position ?? -1) + 1;
  await db.prepare("INSERT INTO lessons(id,program_id,status,content,unit_id,course_unit_id,position,updated_at,group_id,is_core) VALUES (?,?,'draft',?,?,?,?,?,?,0)").bind(id, row.programId, JSON.stringify({ ...content, id }), row.unitId, courseUnitId, position, now, target.id).run();
  if (review) await openReview(db, current, target, id, content.title, notifier);
  return id;
}

async function copyActivity(db: Database, current: Member, source: SectionRow, target: SectionRow, activityId: string, review: boolean): Promise<string | Response> {
  const row = await db.prepare("SELECT period_id AS periodId,title,kind,points,due_on AS dueOn,category_id AS categoryId,grading,extra,rubric,panel,group_mode AS groupMode,peer_min AS peerMin,peer_max AS peerMax FROM assessment_activities WHERE id=? AND group_id=? AND organization_id=?").bind(activityId, source.id, current.organizationId).first<{ periodId: string; title: string; kind: string; points: number; dueOn: string | null; categoryId: string; grading: string; extra: number; rubric: string | null; panel: string | null; groupMode: string; peerMin: number; peerMax: number }>();
  if (!row) return reply({ error: "Solo se copia una actividad propia de esta sección." }, 404);
  const id = `assessment-${crypto.randomUUID()}`;
  const now = new Date().toISOString();
  const position = ((await db.prepare("SELECT COALESCE(MAX(position),-1) AS position FROM assessment_activities WHERE course_id=? AND period_id=?").bind(target.courseId, row.periodId).first<{ position: number }>())?.position ?? -1) + 1;
  await db.prepare(`INSERT INTO assessment_activities(position,title,kind,points,due_on,category_id,grading,extra,retake_of,rubric,panel,group_mode,peer_min,peer_max,updated_at,id,organization_id,course_id,period_id,created_by,created_at,group_id,is_core,review_status)
    VALUES (?,?,?,?,?,?,?,?,NULL,?,?,?,?,?,?,?,?,?,?,?,?,?,0,?)`).bind(position, row.title, row.kind, row.points, row.dueOn, row.categoryId, row.grading, row.extra, row.rubric, row.panel, row.groupMode, row.peerMin, row.peerMax, now, id, current.organizationId, target.courseId, row.periodId, current.id, now, target.id, review ? "pending" : null).run();
  const policy = await freedomPolicyOf(db, current.organizationId, target.courseId);
  if (policy === "free") {
    const replaces = await db.prepare("SELECT replaces FROM section_content_overrides WHERE group_id=? AND item_type='activity' AND item_id=? AND replaces IS NOT NULL").bind(source.id, activityId).first<{ replaces: string }>();
    if (replaces && !review) await db.prepare("INSERT INTO section_content_overrides(group_id,item_type,item_id,position,hidden,replaces,updated_by,updated_at) VALUES (?,'activity',?,NULL,0,?,?,?)").bind(target.id, id, replaces.replaces, current.id, now).run();
  }
  return id;
}

async function adopt(db: Database, current: Member, section: SectionRow, itemType: Kind, itemId: string, core: boolean): Promise<string | Response> {
  if (itemType === "lesson") {
    const place = await db.prepare("SELECT l.course_unit_id AS unitId,u.group_id AS groupId,u.name,u.objective FROM lessons l JOIN learning_units u ON u.id=l.course_unit_id WHERE l.id=? AND l.group_id=?").bind(itemId, section.id).first<{ unitId: string; groupId: string | null; name: string; objective: string }>();
    let unitId: string | null = null;
    if (place?.groupId) {
      unitId = `learning-unit-${crypto.randomUUID()}`;
      const position = ((await db.prepare("SELECT COALESCE(MAX(position),-1) AS position FROM learning_units WHERE course_id=? AND group_id IS NULL").bind(section.courseId).first<{ position: number }>())?.position ?? -1) + 1;
      await db.prepare("INSERT INTO learning_units(id,course_id,name,objective,position,status,updated_at,group_id) VALUES (?,?,?,?,?,'active',?,NULL)").bind(unitId, section.courseId, place.name, place.objective, position, new Date().toISOString()).run();
    }
    const copied = await copyLesson(db, current, section, { ...section, id: section.id }, itemId, unitId, false);
    if (typeof copied !== "string") return copied;
    await db.prepare("UPDATE lessons SET group_id=NULL,is_core=? WHERE id=?").bind(core ? 1 : 0, copied).run();
    return copied;
  }
  if (itemType === "activity") {
    const copied = await copyActivity(db, current, section, section, itemId, false);
    if (typeof copied !== "string") return copied;
    await db.prepare("UPDATE assessment_activities SET group_id=NULL,is_core=?,review_status=NULL WHERE id=?").bind(core ? 1 : 0, copied).run();
    return copied;
  }
  const unit = await db.prepare("SELECT name,objective FROM learning_units WHERE id=? AND group_id=?").bind(itemId, section.id).first<{ name: string; objective: string }>();
  if (!unit) return reply({ error: "La unidad ya no es de la sección." }, 404);
  const id = `learning-unit-${crypto.randomUUID()}`;
  const position = ((await db.prepare("SELECT COALESCE(MAX(position),-1) AS position FROM learning_units WHERE course_id=? AND group_id IS NULL").bind(section.courseId).first<{ position: number }>())?.position ?? -1) + 1;
  await db.prepare("INSERT INTO learning_units(id,course_id,name,objective,position,status,updated_at,group_id) VALUES (?,?,?,?,?,'active',?,NULL)").bind(id, section.courseId, unit.name, unit.objective, position, new Date().toISOString()).run();
  return id;
}

async function retire(db: Database, section: SectionRow, itemType: Kind, itemId: string, now: string) {
  if (itemType === "lesson") await db.prepare("UPDATE lessons SET archived=1,updated_at=? WHERE id=? AND group_id=?").bind(now, itemId, section.id).run();
  else if (itemType === "activity") await db.prepare("DELETE FROM assessment_activities WHERE id=? AND group_id=?").bind(itemId, section.id).run();
  else await db.prepare("UPDATE learning_units SET status='archived',updated_at=? WHERE id=? AND group_id=?").bind(now, itemId, section.id).run();
}

async function openReview(db: Database, current: Member, section: SectionRow, lessonId: string, title: string, notifier?: Notifier) {
  const now = new Date().toISOString();
  await db.prepare("INSERT INTO lesson_reviews(id,lesson_id,course_id,organization_id,status,note,requested_by,requested_at) VALUES (?,?,?,?,'pending','',?,?)")
    .bind(`review-${crypto.randomUUID()}`, lessonId, section.courseId, current.organizationId, current.id, now).run();
  await notify(db, notifier, current, (await reviewersOf(db, current.organizationId, section.courseId)).map(userId => ({
    userId, facts: { type: "review_submitted" as const, course: section.name, lesson: title, actor: current.displayName || current.username }, targetId: lessonId, path: `/cursos/${section.courseId}/secciones?vista=diferencias`,
  })));
}

async function tell(db: Database, notifier: Notifier | undefined, current: Member, section: SectionRow, userId: string, title: string, decision: "approve" | "return", comment: string) {
  const course = await courseTitle(db, section.courseId);
  await notify(db, notifier, current, [{
    userId, facts: { type: decision === "approve" ? "review_approved" as const : "review_returned" as const, course, lesson: title, actor: current.displayName || current.username },
    targetId: section.id, path: `/secciones/${section.id}/plan`,
  }]);
}

async function listProposals(db: Database, organizationId: string, courseId: string) {
  return (await db.prepare(`SELECT p.id,p.group_id AS groupId,g.name AS section,p.item_type AS itemType,p.item_id AS itemId,p.status,p.comment,p.result_id AS resultId,p.created_at AS createdAt,
    CASE p.item_type WHEN 'lesson' THEN (SELECT json_extract(content,'$.title') FROM lessons WHERE id=p.item_id) WHEN 'activity' THEN (SELECT title FROM assessment_activities WHERE id=p.item_id) ELSE (SELECT name FROM learning_units WHERE id=p.item_id) END AS title
    FROM section_proposals p JOIN course_groups g ON g.id=p.group_id WHERE g.course_id=? AND g.organization_id=? ORDER BY p.created_at DESC`).bind(courseId, organizationId).all()).results;
}

async function ownTitle(db: Database, section: SectionRow, itemType: Kind, itemId: string) {
  if (itemType === "lesson") return (await db.prepare("SELECT json_extract(content,'$.title') AS title FROM lessons WHERE id=? AND group_id=?").bind(itemId, section.id).first<{ title: string }>())?.title || null;
  if (itemType === "activity") return (await db.prepare("SELECT title FROM assessment_activities WHERE id=? AND group_id=?").bind(itemId, section.id).first<{ title: string }>())?.title || null;
  return (await db.prepare("SELECT name AS title FROM learning_units WHERE id=? AND group_id=?").bind(itemId, section.id).first<{ title: string }>())?.title || null;
}

async function courseTitle(db: Database, courseId: string) {
  return (await db.prepare("SELECT title FROM courses WHERE id=?").bind(courseId).first<{ title: string }>())?.title || "Curso";
}

const kindOf = (value: unknown): Kind | null => value === "unit" || value === "lesson" || value === "activity" ? value : null;

export async function proposalLines(db: Database, groupId: string) {
  const rows = (await db.prepare("SELECT id,item_type AS type,item_id AS itemId,status FROM section_proposals WHERE group_id=? ORDER BY created_at").bind(groupId).all<{ id: string; type: Kind; itemId: string; status: "pending" | "accepted" | "rejected" }>()).results;
  const titled = [];
  for (const row of rows) {
    const title = row.type === "lesson"
      ? (await db.prepare("SELECT json_extract(content,'$.title') AS title FROM lessons WHERE id=?").bind(row.itemId).first<{ title: string }>())?.title
      : row.type === "activity"
        ? (await db.prepare("SELECT title FROM assessment_activities WHERE id=?").bind(row.itemId).first<{ title: string }>())?.title
        : (await db.prepare("SELECT name AS title FROM learning_units WHERE id=?").bind(row.itemId).first<{ title: string }>())?.title;
    titled.push({ id: row.id, title: title || "Elemento", type: row.type, status: row.status });
  }
  return titled;
}
