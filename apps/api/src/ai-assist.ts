import type { Activity, Member, SequenceTemplate } from "@happy-learners/contracts";
import {
  checkedChanges, classMinutesOf, educationLevels, fixtureImprover, fixtureWriter, improveInput, improvePromptVersion, lessonReview, writeInput, writePromptVersion, writtenText,
} from "@happy-learners/domain";
import type { AiWriter, LessonImprover } from "@happy-learners/domain";
import type { Database } from "./storage";
import { accessTo } from "./access";
import { aiAllowed, aiLimited, tracked } from "./ai-runs";
import { openAiImprover, openAiSettings, openAiWriter } from "./openai";

/**
 * Assisted improvement and writing (1.4.1, docs/design/asistente-ia.md §6c and §6e). POST /api/lessons/:id/improve takes
 * the editor's draft, reviews it here with the same rules as the browser, asks for changes and returns the ones that
 * make sense; nothing is saved (the editor applies what the person accepts to the draft). POST /api/ai/write proposes
 * a text for a field. Both go through the harness.
 */
const reply = (value: unknown, status = 200) => Response.json(value, { status });
const improvePath = /^\/api\/lessons\/([a-z0-9-]+)\/improve$/;
export const aiAssistMethods = (path: string) => improvePath.test(path) || path === "/api/ai/write" ? ["POST"] : null;
/**
 * The editor's draft as it is now: unlike saving, an activity may still be empty (that is what improving is for).
 * Only the shape is checked, and the sizes the prompt can take.
 */
function draftActivities(value: unknown): Activity[] | null {
  if (!Array.isArray(value) || value.length > 30) return null;
  const ok = value.every(item => item && typeof item === "object" && typeof item.title === "string" && item.title.length <= 160 && Number.isInteger(item.minutes) && item.minutes >= 0 && item.minutes <= 240
    && (item.id === undefined || (typeof item.id === "string" && item.id.length <= 100)) && (item.instructions === undefined || (typeof item.instructions === "string" && item.instructions.length <= 4000))
    && (item.blocks === undefined || (Array.isArray(item.blocks) && item.blocks.length <= 12 && item.blocks.every((block: unknown) => block && typeof block === "object"))));
  return ok ? value as Activity[] : null;
}
const notConfigured = () => reply({ error: "La IA no está configurada en esta organización." }, 503);
const unavailable = () => reply({ error: "La IA no respondió. Vuelve a intentar en unos minutos." }, 502);

function generators(env: Env): { improver: LessonImprover; writer: AiWriter; model: string } | null {
  const settings = openAiSettings(env);
  if (settings) return { improver: openAiImprover(settings), writer: openAiWriter(settings), model: settings.model };
  return env.LESSON_GENERATOR === "fixture" ? { improver: fixtureImprover, writer: fixtureWriter, model: "fixture" } : null;
}

/** What a course's reviews need, read the same way the browser does. */
async function reviewBasis(db: Database, organizationId: string, courseId: string) {
  const [outcomes, groups, indexed] = await db.batch([
    db.prepare("SELECT count(*) AS total FROM course_outcomes WHERE course_id=? AND status='active'").bind(courseId),
    db.prepare("SELECT status,schedule_duration AS durationMinutes,schedule_meetings AS meetings FROM course_groups WHERE course_id=? AND organization_id=?").bind(courseId, organizationId),
    db.prepare(`SELECT 1 AS found FROM course_resources r JOIN course_files f ON f.id=r.file_id
      WHERE r.course_id=? AND r.organization_id=? AND r.status!='archived' AND EXISTS (SELECT 1 FROM resource_index i WHERE i.resource_id=r.id)
        AND EXISTS (SELECT 1 FROM book_maps m WHERE m.course_id=r.course_id AND m.sha256=f.sha256 AND m.status='confirmed') LIMIT 1`).bind(courseId, organizationId),
  ]) as unknown as [{ total: number }[], { status: string; durationMinutes: number | null; meetings: string | null }[], { found: number }[]];
  const sections = groups.map(group => ({ status: group.status, schedule: group.durationMinutes ? { durationMinutes: group.durationMinutes, meetings: group.meetings ? JSON.parse(group.meetings) as { durationMinutes: number }[] : [] } : null }));
  return { courseOutcomes: outcomes[0]?.total || 0, indexedResources: indexed.length > 0, classMinutes: classMinutesOf(sections) };
}

export async function aiAssist(path: string, method: string, input: unknown, current: Member, db: Database, env: Env): Promise<Response> {
  const engines = generators(env);
  const improve = improvePath.exec(path);
  if (improve) {
    const lesson = await db.prepare(`SELECT l.id,u.course_id AS courseId,l.archived,c.title AS courseTitle,c.level FROM lessons l JOIN learning_units u ON u.id=l.course_unit_id
      JOIN courses c ON c.id=u.course_id WHERE l.id=? AND c.organization_id=?`).bind(improve[1], current.organizationId)
      .first<{ id: string; courseId: string; archived: number; courseTitle: string; level: string }>();
    if (!lesson) return reply({ error: "Lección no disponible." }, 404);
    const access = await accessTo(db, current, lesson.courseId);
    if (!access?.edit || lesson.archived) return reply({ error: "Solo el equipo del curso mejora sus lecciones." }, 403);
    const draft = input && typeof input === "object" ? input as { objective?: unknown; activities?: unknown; sequence?: unknown; outcomeIds?: unknown; materials?: unknown } : {};
    const activities = draftActivities(draft.activities);
    if (typeof draft.objective !== "string" || draft.objective.length > 600 || !activities) return reply({ error: "Envía el borrador de la lección: objetivo y actividades." }, 400);
    if (!engines) return notConfigured();
    const basis = await reviewBasis(db, current.organizationId, lesson.courseId);
    const sequence = typeof draft.sequence === "string" ? draft.sequence as SequenceTemplate : undefined;
    const lessonDraft = { objective: draft.objective, activities, sequence, outcomeIds: Array.isArray(draft.outcomeIds) ? draft.outcomeIds.filter((id): id is string => typeof id === "string") : [], materials: Array.isArray(draft.materials) ? draft.materials.filter((item): item is string => typeof item === "string") : [] };
    const review = lessonReview(lessonDraft, { ...basis, sequence });
    const request = improveInput(lessonDraft, review, { course: lesson.courseTitle, grade: educationLevels.find(level => level.value === lesson.level)?.label || lesson.level, classMinutes: basis.classMinutes });
    if (!request.failing.length) return reply({ review, changes: [] });
    if (!await aiAllowed(db, current.id)) return aiLimited();
    try {
      const output = await tracked(db, {
        organizationId: current.organizationId, userId: current.id, courseId: lesson.courseId, task: "lesson-improve", promptVersion: improvePromptVersion,
        generator: engines.improver.kind, model: engines.model, inputChars: JSON.stringify(request).length,
      }, observe => engines.improver.improve(request, observe));
      return reply({ review, changes: checkedChanges(output, request) });
    } catch { return unavailable(); }
  }
  const request = writeInput(input);
  if ("error" in request) return reply(request, 400);
  const courseId = input && typeof input === "object" && typeof (input as { courseId?: unknown }).courseId === "string" ? (input as { courseId: string }).courseId : null;
  // A course named for the record must be one this person works with.
  if (courseId && !(await accessTo(db, current, courseId))) return reply({ error: "Este curso no está asignado a tu cuenta." }, 403);
  if (!engines) return notConfigured();
  if (!await aiAllowed(db, current.id)) return aiLimited();
  try {
    const output = await tracked(db, {
      organizationId: current.organizationId, userId: current.id, courseId, task: "write", promptVersion: writePromptVersion,
      generator: engines.writer.kind, model: engines.model, inputChars: JSON.stringify(request).length,
    }, observe => engines.writer.write(request, observe));
    const result = writtenText(output, request);
    return "error" in result ? reply(result, 422) : reply(result);
  } catch { return unavailable(); }
}
