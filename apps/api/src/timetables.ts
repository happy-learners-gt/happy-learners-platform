import type { Member, SectionSchedule, StaffAvailabilitySlot } from "@happy-learners/contracts";
import { fixtureRulesTranslator, ruleText, rulesPromptVersion, solveTimetable, solverRule } from "@happy-learners/domain";
import type { FixedMeeting, RuleContext, RulesTranslator, SolverBlock, SolverRule } from "@happy-learners/domain";
import type { Database } from "./storage";
import { tracked } from "./ai-runs";
import { saveSchedule, scheduleOf } from "./classes";
import { openAiRulesTranslator, openAiSettings } from "./openai";

/**
 * Organización › Horarios (1.4.3, docs/design/asistente-ia.md §6d), administration only. GET /api/timetables gives the
 * school days, the active sections with their educators and the current cycle's dates; POST /api/timetables/solve
 * places the chosen sections' weekly meetings with the deterministic solver (other sections' schedules stay fixed);
 * POST /api/timetables/apply saves each section's schedule as the schedule page would; POST /api/timetables/rules turns
 * a rule written in words into rules to confirm.
 */
const reply = (value: unknown, status = 200) => Response.json(value, { status });
export const timetableMethods = (path: string) => path === "/api/timetables" ? ["GET"] : /^\/api\/timetables\/(solve|apply|rules)$/.test(path) ? ["POST"] : null;

type SectionRow = { id: string; name: string; courseId: string; courseTitle: string; weekdays: string | null; startsAt: string | null; durationMinutes: number | null; from: string | null; until: string | null; meetings: string | null; periodId: string | null };
async function setup(db: Database, organizationId: string) {
  const [bells, sections, educators, year] = await db.batch([
    db.prepare("SELECT id,name,weekdays,blocks FROM bell_schedules WHERE organization_id=? ORDER BY name").bind(organizationId),
    db.prepare(`SELECT g.id,g.name,g.course_id AS courseId,c.title AS courseTitle,g.schedule_weekdays AS weekdays,g.schedule_starts_at AS startsAt,g.schedule_duration AS durationMinutes,
        g.schedule_from AS "from",g.schedule_until AS until,g.schedule_meetings AS meetings,g.schedule_period_id AS periodId
      FROM course_groups g JOIN courses c ON c.id=g.course_id AND c.status='active' WHERE g.organization_id=? AND g.status='active' ORDER BY c.title,g.name`).bind(organizationId),
    db.prepare(`SELECT e.group_id AS groupId,u.id,COALESCE(u.display_name,u.username) AS name,COALESCE(p.availability,'[]') AS availability
      FROM section_educators e JOIN users u ON u.id=e.user_id LEFT JOIN staff_profiles p ON p.user_id=u.id WHERE e.organization_id=?`).bind(organizationId),
    db.prepare("SELECT starts_on AS \"from\",ends_on AS until FROM academic_years WHERE organization_id=? AND status='current' AND program_id IS NULL LIMIT 1").bind(organizationId),
  ]) as unknown as [{ id: string; name: string; weekdays: string; blocks: string }[], SectionRow[], { groupId: string; id: string; name: string; availability: string }[], { from: string; until: string }[]];
  return { bells, sections, educators, year: year[0] || null };
}
/** A school day's weekdays as stored («1,2,3,4,5» or «12345»). */
const daysOf = (stored: string) => (stored.match(/[0-6]/g) || []).map(Number);
const meetingsOf = (schedule: SectionSchedule | null) => !schedule ? [] : schedule.meetings?.length ? schedule.meetings : schedule.weekdays.map(weekday => ({ weekday, startsAt: schedule.startsAt, durationMinutes: schedule.durationMinutes }));

export async function timetables(path: string, method: string, input: unknown, current: Member, db: Database, env: Env): Promise<Response> {
  if (current.role !== "admin") return reply({ error: "Solo administración genera los horarios de la organización." }, 403);
  const data = await setup(db, current.organizationId);
  const educatorsOf = (groupId: string) => data.educators.filter(row => row.groupId === groupId);
  const context: RuleContext = { sections: data.sections.map(row => ({ id: row.id, name: `${row.courseTitle} · ${row.name}` })), educators: [...new Map(data.educators.map(row => [row.id, { id: row.id, name: row.name }])).values()] };
  if (method === "GET") return reply({
    bellSchedules: data.bells.map(row => ({ id: row.id, name: row.name, weekdays: daysOf(row.weekdays), blocks: JSON.parse(row.blocks) as SolverBlock[] })),
    sections: data.sections.map(row => ({ id: row.id, name: row.name, courseId: row.courseId, courseTitle: row.courseTitle, educators: educatorsOf(row.id).map(({ id, name }) => ({ id, name })), meetingsPerWeek: meetingsOf(scheduleOf(row)).length })),
    educators: context.educators, year: data.year,
  });
  const body = input && typeof input === "object" ? input as Record<string, unknown> : {};

  if (path.endsWith("/rules")) {
    const text = typeof body.text === "string" ? body.text.trim() : "";
    if (!text || text.length > 1000) return reply({ error: "Escribe la regla, hasta 1000 caracteres." }, 400);
    const settings = openAiSettings(env);
    const translator: RulesTranslator | null = settings ? openAiRulesTranslator(settings) : env.LESSON_GENERATOR === "fixture" ? fixtureRulesTranslator : null;
    if (!translator) return reply({ error: "La IA no está configurada en esta organización." }, 503);
    try {
      const request = { text, context };
      const output = await tracked(db, { organizationId: current.organizationId, userId: current.id, courseId: null, task: "rules-to-constraints", promptVersion: rulesPromptVersion, generator: translator.kind, model: settings ? settings.model : "fixture", inputChars: JSON.stringify(request).length },
        observe => translator.translate(request, observe));
      const rules = output.rules.map(rule => solverRule(rule, context)).filter((rule): rule is SolverRule => !!rule);
      return reply({ rules: rules.map(rule => ({ rule, text: ruleText(rule, context) })), dropped: output.rules.length - rules.length });
    } catch { return reply({ error: "La IA no respondió. Vuelve a intentar en unos minutos." }, 502); }
  }

  const chosen = Array.isArray(body.sections) ? body.sections as { id?: unknown; meetingsPerWeek?: unknown; blocksPerMeeting?: unknown }[] : [];
  if (path.endsWith("/solve")) {
    const bell = data.bells.find(row => row.id === body.bellScheduleId);
    if (!bell) return reply({ error: "Elige la jornada con sus periodos." }, 400);
    const sections = chosen.map(item => {
      const row = data.sections.find(section => section.id === item.id);
      const meetings = Number(item.meetingsPerWeek), size = Number(item.blocksPerMeeting);
      return row && Number.isInteger(meetings) && meetings >= 1 && meetings <= 7 && Number.isInteger(size) && size >= 1 && size <= 4
        ? { id: row.id, name: `${row.courseTitle} · ${row.name}`, educatorIds: educatorsOf(row.id).map(educator => educator.id), meetingsPerWeek: meetings, blocksPerMeeting: size } : null;
    });
    if (!sections.length || sections.some(item => !item) || new Set(sections.map(item => item!.id)).size !== sections.length) return reply({ error: "Elige las secciones, cada una con 1 a 7 clases por semana de 1 a 4 periodos." }, 400);
    const rules = (Array.isArray(body.rules) ? body.rules : []).map(rule => solverRule(rule, context));
    if (rules.some(rule => !rule)) return reply({ error: "Una regla nombra una sección o un docente que no existe, o no es válida." }, 400);
    const included = new Set(sections.map(item => item!.id));
    const fixed: FixedMeeting[] = data.sections.filter(row => !included.has(row.id)).flatMap(row => meetingsOf(scheduleOf(row)).map(meeting => ({ sectionId: row.id, name: `${row.courseTitle} · ${row.name}`, educatorIds: educatorsOf(row.id).map(educator => educator.id), ...meeting })));
    const days = daysOf(bell.weekdays).map(weekday => ({ weekday, blocks: JSON.parse(bell.blocks) as SolverBlock[] }));
    const educators = context.educators.map(item => ({ ...item, availability: JSON.parse(data.educators.find(row => row.id === item.id)!.availability) as StaffAvailabilitySlot[] }));
    return reply({ result: solveTimetable({ days, sections: sections as NonNullable<typeof sections[number]>[], educators, rules: rules as SolverRule[], fixed }), names: Object.fromEntries(context.sections.map(item => [item.id, item.name])) });
  }

  // Apply: each section's meetings become its schedule for the dates given, as the schedule page saves it.
  const meetings = Array.isArray(body.meetings) ? body.meetings as { sectionId?: unknown; weekday?: unknown; startsAt?: unknown; durationMinutes?: unknown }[] : [];
  const ids = [...new Set(meetings.map(item => item.sectionId))];
  if (!ids.length || ids.some(id => !data.sections.some(row => row.id === id))) return reply({ error: "Genera el horario antes de aplicarlo." }, 400);
  const results: { sectionId: string; name: string; ok: boolean; classes?: number; error?: string }[] = [];
  for (const id of ids as string[]) {
    const row = data.sections.find(section => section.id === id)!;
    const own = meetings.filter(item => item.sectionId === id).map(item => ({ weekday: Number(item.weekday), startsAt: String(item.startsAt), durationMinutes: Number(item.durationMinutes) }));
    const response = await saveSchedule("PUT", { weekdays: own.map(item => item.weekday), startsAt: own[0].startsAt, durationMinutes: own[0].durationMinutes, meetings: own, from: body.from, until: body.until }, current, db, row.courseId, { id: row.id, name: row.name });
    const answer = await response.json() as { classes?: number; error?: string };
    results.push({ sectionId: id, name: `${row.courseTitle} · ${row.name}`, ok: response.ok, ...(response.ok ? { classes: answer.classes } : { error: answer.error }) });
  }
  return reply({ results }, results.every(item => item.ok) ? 200 : 207);
}
