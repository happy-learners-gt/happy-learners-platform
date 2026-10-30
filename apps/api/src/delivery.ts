import type { Lesson, Member } from "@happy-learners/contracts";
import { pdfFile, richPlainText, sequenceOf } from "@happy-learners/domain";
import type { PdfBlock } from "@happy-learners/domain";
import type { Database } from "./storage";
import { scopedCourses } from "./permissions";
import { effectiveLessonIds } from "./freedom-plan";

/**
 * GET /api/courses/:id/units/:unitId/delivery.pdf?section=:groupId[&period=:periodId] — the delivery copy of a module
 * for one section: only what is published (each lesson's published version, never its draft), under a letterhead with
 * the organization, the section's educators, course, section, school year, period and when it was generated, and the
 * footer «Copia de entrega. No redistribuir. Generado en Happy Learners.». Whoever sees the section downloads it.
 */
const reply = (value: unknown, status = 200) => Response.json(value, { status });
const deliveryPath = /^\/api\/courses\/([a-z0-9-]+)\/units\/([a-z0-9-]+)\/delivery\.pdf$/;
export const deliveryFooter = "Copia de entrega. No redistribuir. Generado en Happy Learners.";
export const deliveryMethods = (path: string) => deliveryPath.test(path) ? ["GET"] : null;

const phaseLabel = (lesson: Lesson, phase?: string) => sequenceOf(lesson.sequence).phases.find(item => item.id === phase)?.label;
/** The blocks of one published lesson: title, objective, duration, outcomes and each activity with what it asks. */
function lessonBlocks(lesson: Lesson, index: number, outcomes: Map<string, string>): PdfBlock[] {
  const blocks: PdfBlock[] = [
    { text: `${index + 1}. ${lesson.title}`, bold: true, size: 13, space: index ? 14 : 4 },
    { text: `Objetivo: ${lesson.objective}`, space: 2 },
    { text: `Duración: ${lesson.duration} minutos`, size: 9.5 },
  ];
  const named = [...new Set([...(lesson.outcomeIds || []), ...lesson.activities.flatMap(activity => activity.outcomeIds || [])])].map(id => outcomes.get(id)).filter(Boolean) as string[];
  if (named.length) blocks.push({ text: "Resultados de aprendizaje:", bold: true, size: 9.5, space: 4 }, ...named.map(text => ({ text: `• ${text}`, size: 9.5, indent: 10 })));
  blocks.push({ text: "Actividades:", bold: true, size: 10.5, space: 6 });
  lesson.activities.forEach((activity, position) => {
    const moment = phaseLabel(lesson, activity.phase);
    blocks.push({ text: `${position + 1}. ${activity.title} (${[moment, `${activity.minutes} min`].filter(Boolean).join(" · ")})`, bold: true, size: 10, indent: 10, space: 3 });
    const parts = activity.blocks || [{ id: "", kind: activity.type === "question" ? "question" : activity.type === "resource" ? "resource" : "text", instructions: activity.instructions, richContent: activity.richContent, options: activity.options }];
    for (const block of parts) {
      if (block.kind === "teacher-note") continue;
      const text = block.richContent ? richPlainText(block.richContent) : block.instructions || "";
      if (text.trim()) blocks.push({ text: text.trim(), indent: 22 });
      if (block.kind === "question" && block.options) blocks.push(...block.options.map((option, choice) => ({ text: `${String.fromCharCode(97 + choice)}) ${option}`, indent: 32, size: 10 })));
    }
  });
  return blocks;
}

type Row = { id: string; title: string; status: string; teaches: number };
export async function delivery(path: string, url: URL, current: Member, db: Database): Promise<Response> {
  const [, courseId, unitId] = deliveryPath.exec(path)!;
  const sectionId = url.searchParams.get("section") || "";
  const [course, unit, section] = await db.batch([
    db.prepare("SELECT id,title FROM courses WHERE id=? AND organization_id=?").bind(courseId, current.organizationId),
    db.prepare("SELECT id,name FROM learning_units WHERE id=? AND course_id=?").bind(unitId, courseId),
    db.prepare("SELECT g.id,g.name AS title,g.status,EXISTS(SELECT 1 FROM section_educators e WHERE e.group_id=g.id AND e.user_id=?) AS teaches FROM course_groups g WHERE g.id=? AND g.course_id=? AND g.organization_id=?").bind(current.id, sectionId, courseId, current.organizationId),
  ]) as unknown as [{ id: string; title: string }[], { id: string; name: string }[], Row[]];
  if (!course[0] || !unit[0]) return reply({ error: "Módulo no disponible." }, 404);
  if (!section[0]) return reply({ error: "Elige una sección del curso." }, 400);
  // Same reach as the section: administration, its educators, and coordination or groups that see its classes.
  if (current.role !== "admin" && !section[0].teaches && !(await scopedCourses(db, current, ["classes.view", "sections.assign"])).includes(courseId)) return reply({ error: "Esta sección no está asignada a tu cuenta." }, 403);

  const [lessons, educators, organization, year, outcomes] = await db.batch([
    db.prepare("SELECT id,group_id AS groupId,is_core AS core,published_content AS content FROM lessons WHERE course_unit_id=? AND archived=0 AND revision>0 AND published_content IS NOT NULL AND group_id IS NULL ORDER BY position,id").bind(unitId),
    db.prepare("SELECT COALESCE(u.display_name,u.username) AS name FROM section_educators e JOIN users u ON u.id=e.user_id WHERE e.group_id=? ORDER BY name").bind(sectionId),
    db.prepare("SELECT name,timezone FROM organizations WHERE id=?").bind(current.organizationId),
    db.prepare(`SELECT y.id,y.name FROM academic_years y JOIN courses c ON c.id=? AND c.organization_id=y.organization_id
      WHERE y.organization_id=? AND y.status='current' AND (y.program_id IS NULL OR y.program_id=c.program_id)
      ORDER BY CASE WHEN y.program_id IS NULL THEN 1 ELSE 0 END LIMIT 1`).bind(courseId, current.organizationId),
    db.prepare("SELECT id,statement FROM course_outcomes WHERE course_id=?").bind(courseId),
  ]) as unknown as [{ content: string }[], { name: string }[], { name: string | null; timezone: string }[], { id: string; name: string }[], { id: string; statement: string }[]];
  if (!lessons.length) return reply({ error: "Este módulo aún no tiene lecciones publicadas. Solo el contenido publicado entra en el PDF de entrega." }, 409);
  const zone = organization[0]?.timezone || "America/Guatemala", now = new Date();
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: zone, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
  const periods = year[0] ? (await db.prepare("SELECT id,name,starts_on AS \"from\",ends_on AS until FROM academic_periods WHERE year_id=? ORDER BY starts_on").bind(year[0].id).all<{ id: string; name: string; from: string; until: string }>()).results : [];
  const requested = url.searchParams.get("period");
  if (requested && !periods.some(period => period.id === requested)) return reply({ error: "Ese periodo no es del ciclo vigente." }, 400);
  const period = periods.find(item => item.id === requested) || periods.find(item => item.from <= today && today <= item.until) || null;
  const generated = new Intl.DateTimeFormat("es-GT", { timeZone: zone, dateStyle: "long", timeStyle: "short" }).format(now);
  const header = [
    organization[0]?.name || "Organización",
    `Docente: ${educators.map(row => row.name).join(", ") || "Sin asignar"} · Curso: ${course[0].title} · Sección: ${section[0].title}`,
    `Ciclo lectivo: ${year[0]?.name || "Sin ciclo vigente"} · Periodo: ${period?.name || "Sin periodo"} · Generado: ${generated} (${zone})`,
  ];
  const named = new Map(outcomes.map(row => [row.id, row.statement]));
  const effective = await effectiveLessonIds(db, current.organizationId, courseId, sectionId);
  const courseLessons = lessons as unknown as { id: string; content: string }[];
  const own = effective ? (await db.prepare("SELECT id,group_id AS groupId,is_core AS core,published_content AS content FROM lessons WHERE course_unit_id=? AND archived=0 AND revision>0 AND published_content IS NOT NULL AND group_id=?").bind(unitId, sectionId).all<{ id: string; groupId: string | null; core: number; content: string }>()).results : [];
  const byId = new Map([...courseLessons, ...own].map(row => [row.id, row]));
  const ordered = effective ? effective.filter(id => byId.has(id)).map(id => byId.get(id)!) : courseLessons;
  const published = ordered.map(row => {
    const lesson = JSON.parse(row.content) as Lesson;
    if (!effective) return lesson;
    const tagged = row as { groupId?: string | null; core?: number };
    const label = tagged.groupId ? " · Propia de la sección" : tagged.core ? " · Núcleo" : "";
    return { ...lesson, title: `${lesson.title}${label}` };
  });
  const file = pdfFile({
    title: `${course[0].title} · ${unit[0].name}`, header, footer: deliveryFooter,
    blocks: [{ text: unit[0].name, bold: true, size: 16 }, { text: `${published.length === 1 ? "1 lección publicada" : `${published.length} lecciones publicadas`}`, size: 9.5, space: 2 }, ...published.flatMap((lesson, index) => lessonBlocks(lesson, index, named))],
  });
  await db.prepare("INSERT INTO activity_events(id,organization_id,actor_id,action,target_type,target_id,course_id,group_id,summary,occurred_at) VALUES (?,?,?,'recorded','group',?,?,?,?,?)")
    .bind(`event-${crypto.randomUUID()}`, current.organizationId, current.id, sectionId, courseId, sectionId, `Generó el PDF de entrega de «${unit[0].name}» para «${section[0].title}»`.slice(0, 240), now.toISOString()).run();
  const name = `entrega-${`${course[0].title}-${unit[0].name}`.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 80)}.pdf`;
  return new Response(new TextEncoder().encode(file), { headers: { "Content-Type": "application/pdf", "Content-Disposition": `attachment; filename="${name}"`, "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" } });
}
