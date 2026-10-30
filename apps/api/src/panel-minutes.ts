import type { AtomicMark, Member } from "@happy-learners/contracts";
import { combineLabels, defaultTemplate, markValue, minuteCanonical, minuteClosed, minuteSignatureCanonical, signedNameInput, signingProblem } from "@happy-learners/domain";
import type { GradingActivity, MinuteContent, ReportRecord } from "@happy-learners/domain";
import type { Database } from "./storage";
import { digest } from "./auth";
import { confirmIdentity } from "./legal";
import { activeTemplate, generate, pdfResponse } from "./reports";

/**
 * Panel minutes (1.5.1, docs/design/constructor-de-reportes.md §4). POST /api/panel-minutes/sign {activityId, sectionId,
 * learnerId, signature: {fullName, password}} signs the minutes of a student the panel has fully marked, creating them
 * (content frozen, SHA-256) on the first signature; the chair signs last. GET /api/panel-minutes/:id.pdf draws them with
 * the published «Acta de tribunal» template or the default one, for the panel, the section's educators and
 * administration. Once signed by anyone, the student's marks for that activity are locked (gradebook.ts).
 */
const reply = (value: unknown, status = 200) => Response.json(value, { status });
const pdfPath = /^\/api\/panel-minutes\/(minute-[a-f0-9-]{36})\.pdf$/;
export const panelMinuteMethods = (path: string) => path === "/api/panel-minutes/sign" ? ["POST"] : pdfPath.test(path) ? ["GET"] : null;
const decimal = (value: number) => new Intl.NumberFormat("es", { maximumFractionDigits: 2 }).format(value);

type Row = { activityId: string; title: string; points: number; rubric: string | null; panel: string | null; periodId: string; courseId: string; courseTitle: string; sectionName: string; periodName: string; levels: string | null };
/** The minutes' content from the current marks, or the reason they cannot be signed yet. */
async function contentOf(db: Database, organizationId: string, activityId: string, sectionId: string, learnerId: string, minuteId: string): Promise<MinuteContent | string> {
  const row = await db.prepare(`SELECT a.id AS activityId,a.title,a.points,a.rubric,a.panel,a.period_id AS periodId,c.id AS courseId,c.title AS courseTitle,g.name AS sectionName,p.name AS periodName
    FROM assessment_activities a JOIN courses c ON c.id=a.course_id AND c.organization_id=a.organization_id JOIN course_groups g ON g.course_id=c.id AND g.id=?
    JOIN academic_periods p ON p.id=a.period_id WHERE a.id=? AND a.organization_id=? AND a.grading='panel'`).bind(sectionId, activityId, organizationId).first<Row>();
  if (!row) return "La evaluación no tiene tribunal.";
  const [learner, evaluators, marks] = await db.batch([
    db.prepare("SELECT id,display_name AS name FROM group_learners WHERE id=? AND group_id=? AND organization_id=?").bind(learnerId, sectionId, organizationId),
    db.prepare("SELECT e.user_id AS userId,COALESCE(u.display_name,u.username) AS name,e.chair FROM assessment_evaluators e JOIN users u ON u.id=e.user_id WHERE e.activity_id=? ORDER BY e.chair DESC,name").bind(activityId),
    db.prepare("SELECT evaluator_id AS evaluatorId,mark FROM assessment_marks WHERE activity_id=? AND learner_id=? AND evaluator_id IS NOT NULL").bind(activityId, learnerId),
  ]) as unknown as [{ id: string; name: string }[], { userId: string; name: string; chair: number }[], { evaluatorId: string; mark: string }[]];
  if (!learner[0]) return "Ese estudiante no está en la lista de la sección.";
  if (!evaluators.length || evaluators.some(item => !marks.some(mark => mark.evaluatorId === item.userId))) return "El tribunal aún no termina de calificar a este estudiante.";
  const panel = row.panel ? JSON.parse(row.panel) as { combine: string } : { combine: "average" };
  const activity = { id: row.activityId, periodId: row.periodId, categoryId: "general", title: row.title, points: row.points, grading: "panel", panel, ...(row.rubric ? { rubric: JSON.parse(row.rubric) } : {}) } as GradingActivity;
  const single = (mark: AtomicMark) => mark.kind === "points" ? decimal(mark.value) : mark.kind === "pass" ? (mark.value ? "Aprobado" : "No aprobado") : mark.kind === "level" ? mark.value
    : (() => { const value = markValue({ ...activity, grading: "rubric" } as GradingActivity, mark); return value === null ? "—" : decimal(value); })();
  const combined = markValue(activity, { kind: "panel", marks: marks.map(item => ({ evaluator: item.evaluatorId, mark: JSON.parse(item.mark) as AtomicMark })) });
  return {
    minuteId, organizationId, activityId, activityTitle: row.title, points: row.points, courseTitle: row.courseTitle, sectionName: row.sectionName, periodName: row.periodName,
    learnerId, learnerName: learner[0].name, combine: panel.combine, result: combined === null ? "—" : `${decimal(combined)} de ${decimal(row.points)}`,
    evaluators: evaluators.map(item => ({ userId: item.userId, name: item.name, chair: !!item.chair, mark: single(JSON.parse(marks.find(mark => mark.evaluatorId === item.userId)!.mark) as AtomicMark) })),
  };
}

/** The minutes of each student of an activity in a section, with who signed: for «Mis tribunales». */
export async function minutesOf(db: Database, organizationId: string, activityId: string, sectionId: string) {
  const rows = (await db.prepare(`SELECT m.id,m.learner_id AS learnerId,m.status,s.user_id AS userId FROM panel_minutes m LEFT JOIN panel_minute_signatures s ON s.minute_id=m.id
    WHERE m.activity_id=? AND m.group_id=? AND m.organization_id=?`).bind(activityId, sectionId, organizationId).all<{ id: string; learnerId: string; status: "open" | "signed"; userId: string | null }>()).results;
  const out = new Map<string, { id: string; status: "open" | "signed"; signed: string[] }>();
  for (const row of rows) { const entry = out.get(row.learnerId) || { id: row.id, status: row.status, signed: [] }; if (row.userId) entry.signed.push(row.userId); out.set(row.learnerId, entry); }
  return out;
}

/** The minutes as a document's data: its fields and the members with their signatures. */
export async function minuteRecord(db: Database, current: Member, minute: { id: string; content: string; sha: string; status: string }): Promise<ReportRecord> {
    const content = JSON.parse(minute.content) as MinuteContent;
    const signatures = (await db.prepare("SELECT user_id AS userId,signed_name AS signedName,signed_at AS signedAt,signature_sha256 AS sha FROM panel_minute_signatures WHERE minute_id=?").bind(minute.id).all<{ userId: string; signedName: string; signedAt: string; sha: string }>()).results;
    const organization = await db.prepare("SELECT name,timezone FROM organizations WHERE id=?").bind(current.organizationId).first<{ name: string; timezone: string }>();
    const zone = organization?.timezone || "America/Guatemala", when = (value: string) => new Intl.DateTimeFormat("es-GT", { timeZone: zone, dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
    return {
      fields: {
        "organizacion.nombre": organization?.name || "Organización", "fecha.hoy": new Intl.DateTimeFormat("es-GT", { timeZone: zone, dateStyle: "long" }).format(new Date()), "ciclo.nombre": "",
        "seccion.nombre": content.sectionName, "curso.nombre": content.courseTitle, "seccion.docentes": "", "estudiante.nombre": content.learnerName, "periodo.nombre": content.periodName,
        "actividad.nombre": content.activityTitle, "actividad.puntos": String(content.points), "tribunal.criterio": combineLabels[content.combine] || content.combine, "resultado.nota": content.result,
        "acta.estado": minute.status === "signed" ? "firmada por todo el tribunal" : `${signatures.length} de ${content.evaluators.length} firmas`, "acta.huella": minute.sha,
      },
      datasets: { integrantes: content.evaluators.map(item => { const signature = signatures.find(entry => entry.userId === item.userId); return { integrante: item.name, rol: item.chair ? "Preside" : "Integrante", calificacion: item.mark, firma: signature ? `${signature.signedName} · ${signature.sha.slice(0, 16)}…` : "Pendiente", fecha: signature ? when(signature.signedAt) : "" }; }) },
    };
}

export async function panelMinutes(path: string, method: string, input: unknown, current: Member, db: Database): Promise<Response> {
  const pdf = pdfPath.exec(path);
  if (pdf) {
    const minute = await db.prepare("SELECT id,activity_id AS activityId,group_id AS groupId,content,document_sha256 AS sha,status FROM panel_minutes WHERE id=? AND organization_id=?").bind(pdf[1], current.organizationId)
      .first<{ id: string; activityId: string; groupId: string; content: string; sha: string; status: string }>();
    if (!minute) return reply({ error: "El acta no existe." }, 404);
    const allowed = current.role === "admin" || await db.prepare("SELECT 1 FROM assessment_evaluators WHERE activity_id=? AND user_id=? UNION SELECT 1 FROM section_educators WHERE group_id=? AND user_id=?").bind(minute.activityId, current.id, minute.groupId, current.id).first();
    if (!allowed) return reply({ error: "Solo el tribunal, quienes imparten la sección y administración ven el acta." }, 403);
    const record = await minuteRecord(db, current, minute), content = JSON.parse(minute.content) as MinuteContent;
    const program = await db.prepare("SELECT c.program_id AS programId FROM course_groups g JOIN courses c ON c.id=g.course_id WHERE g.id=?").bind(minute.groupId).first<{ programId: string | null }>();
    const used = await activeTemplate(db, current.organizationId, "panel-minutes", program?.programId || null) || { id: null, version: null, template: defaultTemplate("panel-minutes") };
    const file = await generate(db, current, "panel-minutes", used, [record], `Acta de tribunal · ${content.learnerName}`, { type: "minute", id: minute.id });
    return pdfResponse(file, `acta-${content.learnerName.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 60)}.pdf`);
  }
  const body = input && typeof input === "object" ? input as Record<string, unknown> : {};
  const [activityId, sectionId, learnerId] = [body.activityId, body.sectionId, body.learnerId];
  if (typeof activityId !== "string" || typeof sectionId !== "string" || typeof learnerId !== "string") return reply({ error: "Elige la evaluación, la sección y el estudiante." }, 400);
  const signature = body.signature && typeof body.signature === "object" ? body.signature as Record<string, unknown> : {};
  const signedName = signedNameInput(signature.fullName), password = signature.password;
  if (!signedName || typeof password !== "string" || !password || password.length > 128) return reply({ error: "Para firmar, escribe tu nombre completo (de 3 a 120 caracteres) y tu contraseña.", code: "SIGNATURE_REQUIRED" }, 400);
  let minute = await db.prepare("SELECT id,content,document_sha256 AS sha,status FROM panel_minutes WHERE activity_id=? AND learner_id=? AND organization_id=?").bind(activityId, learnerId, current.organizationId).first<{ id: string; content: string; sha: string; status: string }>();
  const content = minute ? JSON.parse(minute.content) as MinuteContent : await contentOf(db, current.organizationId, activityId, sectionId, learnerId, `minute-${crypto.randomUUID()}`);
  if (typeof content === "string") return reply({ error: content }, content.startsWith("La evaluación") ? 404 : 409);
  if (minute?.status === "signed") return reply({ error: "El acta ya está firmada por todo el tribunal." }, 409);
  const signed = minute ? (await db.prepare("SELECT user_id AS userId FROM panel_minute_signatures WHERE minute_id=?").bind(minute.id).all<{ userId: string }>()).results.map(row => row.userId) : [];
  const problem = signingProblem(content, signed, current.id);
  if (problem) return reply({ error: problem }, content.evaluators.some(item => item.userId === current.id) ? 409 : 403);
  const refused = await confirmIdentity(db, current, password);
  if (refused) return refused;
  const now = new Date().toISOString(), sha = minute?.sha || await digest(minuteCanonical(content));
  if (!minute) {
    await db.prepare("INSERT INTO panel_minutes(id,organization_id,activity_id,group_id,learner_id,content,document_sha256,created_at) VALUES (?,?,?,?,?,?,?,?)").bind(content.minuteId, current.organizationId, activityId, sectionId, learnerId, JSON.stringify(content), sha, now).run();
    minute = { id: content.minuteId, content: JSON.stringify(content), sha, status: "open" };
  }
  const signatureSha = await digest(minuteSignatureCanonical({ minuteId: minute.id, userId: current.id, username: current.username, signedName, documentSha256: sha, signedAt: now }));
  const closes = minuteClosed(content, [...signed, current.id]);
  await db.batch([
    db.prepare("INSERT INTO panel_minute_signatures(minute_id,user_id,username,signed_name,signed_at,signature_sha256) VALUES (?,?,?,?,?,?)").bind(minute.id, current.id, current.username, signedName, now, signatureSha),
    ...(closes ? [db.prepare("UPDATE panel_minutes SET status='signed',closed_at=? WHERE id=?").bind(now, minute.id)] : []),
  ]);
  return reply({ minute: { id: minute.id, status: closes ? "signed" : "open", signed: signed.length + 1, total: content.evaluators.length, documentSha256: sha } }, 201);
}
