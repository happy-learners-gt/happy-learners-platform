import type { Member, ProgramScope } from "@happy-learners/contracts";
import { meetingOn } from "@happy-learners/domain";
import { scheduleOf, todayFor, timezoneOf } from "./classes";
import type { Database } from "./storage";

/**
 * The agenda (1.3.4). One read of everything dated in a range: classes at their real time, days without class,
 * the other institutional events, and assessment deliveries. `mine` is the sections the person teaches;
 * administration and coordination may widen to the organization, a program or a section in their scope.
 * A class is "movida" when its time no longer matches the section's schedule, or when it is the first class
 * after a no-class day that covered the previous meeting. Nothing here is stored as a new status.
 */
const reply = (value: unknown, status = 200) => Response.json(value, { status });
const dayPattern = /^\d{4}-\d{2}-\d{2}$/;
const idPattern = /^[a-z0-9-]{1,80}$/;

export function agendaMethods(path: string) {
  return path === "/api/agenda" ? ["GET"] : null;
}

type ScopeKind = "mine" | "organization" | "program" | "section";
type ResolvedScope = { kind: ScopeKind; id: string | null; value: string };
type SectionRow = { id: string; name: string; courseId: string; courseTitle: string; programId: string | null; schedule: ReturnType<typeof scheduleOf> };
type ClassRow = {
  id: string; sectionId: string; date: string; startsAt: string | null; durationMinutes: number | null;
  status: "planned" | "in_progress" | "completed" | "cancelled"; origin: string;
  sectionName: string; courseId: string; courseTitle: string; programId: string | null; total: number; marked: number;
};
type EventRow = {
  id: string; title: string; from: string; until: string; part: "full" | "morning" | "afternoon"; noClass: number; status: string;
  scope: "organization" | "program" | "section"; scopeId: string | null; category: string; categoryKey: string;
  programName: string | null; sectionName: string | null;
};
type DueRow = { id: string; title: string; date: string; courseId: string; courseTitle: string; sectionId: string; sectionName: string };

const addDays = (iso: string, days: number) => {
  const date = new Date(`${iso}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
};
const weekday = (iso: string) => new Date(`${iso}T00:00:00Z`).getUTCDay();
const span = (from: string, until: string) => Math.round((Date.parse(`${until}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);

function widenOf(current: Member): ProgramScope | null {
  if (current.role === "admin") return { all: true };
  const grants = current.permissions?.grants;
  const scopes = [current.permissions?.coordination, grants?.["sections.assign"], grants?.["classes.view"]].filter((item): item is ProgramScope => !!item && ("all" in item || item.programs.length > 0));
  if (!scopes.length) return null;
  if (scopes.some(item => "all" in item)) return { all: true };
  return { programs: [...new Set(scopes.flatMap(item => "programs" in item ? item.programs : []))].sort() };
}
const programAllowed = (scope: ProgramScope, programId: string | null) => "all" in scope || (!!programId && scope.programs.includes(programId));

function parseScope(raw: string): ResolvedScope | { error: string } {
  if (!raw || raw === "mine") return { kind: "mine", id: null, value: "mine" };
  if (raw === "organization") return { kind: "organization", id: null, value: "organization" };
  const match = /^(program|section):([a-z0-9-]{1,80})$/.exec(raw);
  if (!match || !idPattern.test(match[2])) return { error: "Elige un alcance válido." };
  return { kind: match[1] as "program" | "section", id: match[2], value: raw };
}

function previousSlot(date: string, days: number[]) {
  for (let step = 1; step <= 14; step += 1) {
    const day = addDays(date, -step);
    if (days.includes(weekday(day))) return day;
  }
  return null;
}
const hourOf = (time: string | null) => Number((/^(\d{2})/.exec(time || "") || [])[1] ?? 0);
function covers(event: Pick<EventRow, "from" | "until" | "part">, day: string, time: string | null) {
  if (day < event.from || day > event.until) return false;
  if (event.part === "full") return true;
  return event.part === "morning" ? hourOf(time) < 12 : hourOf(time) >= 12;
}
const affects = (event: EventRow, section: { id: string; programId: string | null }) => event.scope === "organization" || (event.scope === "program" ? event.scopeId === section.programId : event.scopeId === section.id);
const originOf = (event: EventRow) => event.scope === "organization" ? "Toda la organización" : event.scope === "program" ? `Programa ${event.programName || ""}`.trim() : `Sección ${event.sectionName || ""}`.trim();

function movedOf(row: ClassRow, section: SectionRow | undefined, events: EventRow[], classes: ClassRow[]) {
  if (row.status === "cancelled" || !section?.schedule) return false;
  const meeting = meetingOn(section.schedule, row.date);
  if (row.startsAt && (row.startsAt !== meeting.startsAt || (row.durationMinutes != null && row.durationMinutes !== meeting.durationMinutes))) return true;
  const previous = previousSlot(row.date, section.schedule.weekdays);
  if (!previous) return false;
  const slot = meetingOn(section.schedule, previous);
  const covered = events.some(event => event.noClass && affects(event, section) && covers(event, previous, slot.startsAt));
  if (!covered) return false;
  return !classes.some(other => other.sectionId === row.sectionId && other.date === previous && other.status !== "cancelled");
}

export async function agenda(url: URL, current: Member, db: Database) {
  const from = url.searchParams.get("from") || "", until = url.searchParams.get("until") || "";
  if (!dayPattern.test(from) || !dayPattern.test(until) || from > until) return reply({ error: "Indica un rango de fechas válido." }, 400);
  if (span(from, until) > 399) return reply({ error: "El rango puede ser de hasta 400 días." }, 400);
  const parsed = parseScope(url.searchParams.get("scope") || "mine");
  if ("error" in parsed) return reply(parsed, 400);
  const widen = widenOf(current);
  const today = await todayFor(db, current.organizationId);
  const zone = await timezoneOf(db, current.organizationId);
  const [programs, sectionRows, taught] = await Promise.all([
    db.prepare("SELECT id,name FROM study_programs WHERE organization_id=? AND status='active' ORDER BY name").bind(current.organizationId).all<{ id: string; name: string }>(),
    db.prepare(`SELECT g.id,g.name,g.course_id AS courseId,c.title AS courseTitle,c.program_id AS programId,g.schedule_weekdays AS weekdays,g.schedule_starts_at AS startsAt,g.schedule_duration AS durationMinutes,g.schedule_from AS "from",g.schedule_until AS until,g.schedule_meetings AS meetings
      FROM course_groups g JOIN courses c ON c.id=g.course_id WHERE g.organization_id=? AND g.status='active' ORDER BY c.title,g.name`).bind(current.organizationId).all<{ id: string; name: string; courseId: string; courseTitle: string; programId: string | null } & Parameters<typeof scheduleOf>[0]>(),
    db.prepare("SELECT group_id AS id FROM section_educators WHERE user_id=? AND organization_id=?").bind(current.id, current.organizationId).all<{ id: string }>(),
  ]);
  const taughtIds = new Set(taught.results.map(row => row.id));
  const sections: SectionRow[] = sectionRows.results.map(row => ({ id: row.id, name: row.name, courseId: row.courseId, courseTitle: row.courseTitle, programId: row.programId, schedule: scheduleOf(row) }));
  const knownProgram = programs.results.find(row => row.id === parsed.id);
  const knownSection = sections.find(row => row.id === parsed.id);
  if (parsed.kind === "program" && !knownProgram) return reply({ error: "Programa no disponible." }, 404);
  if (parsed.kind === "section" && !knownSection) return reply({ error: "Sección no disponible." }, 404);
  const allowed = (section: SectionRow) => taughtIds.has(section.id) || (!!widen && programAllowed(widen, section.programId));
  if (parsed.kind === "organization" && !(widen && "all" in widen)) return reply({ error: "No tienes permiso para ver ese alcance." }, 403);
  if (parsed.kind === "program" && !(widen && programAllowed(widen, parsed.id))) return reply({ error: "No tienes permiso para ver ese alcance." }, 403);
  if (parsed.kind === "section" && knownSection && !allowed(knownSection)) return reply({ error: "No tienes permiso para ver ese alcance." }, 403);
  const chosen = parsed.kind === "mine" ? sections.filter(section => taughtIds.has(section.id))
    : parsed.kind === "section" && knownSection ? [knownSection]
    : parsed.kind === "program" ? sections.filter(section => section.programId === parsed.id)
    : sections.filter(section => !widen || programAllowed(widen, section.programId));
  const scopes = !widen ? [] : [
    { value: "mine", label: "Mis secciones" },
    ...("all" in widen ? [{ value: "organization", label: "Toda la organización" }] : []),
    ...programs.results.filter(program => programAllowed(widen, program.id)).map(program => ({ value: `program:${program.id}`, label: program.name })),
    ...sections.filter(section => programAllowed(widen, section.programId)).map(section => ({ value: `section:${section.id}`, label: `${section.name} · ${section.courseTitle}` })),
  ];
  const empty = { from, until, scope: parsed.value, today, zone, canWiden: !!widen, scopes, items: [], rail: { next: null, breaks: [] } };
  if (!chosen.length && parsed.kind === "mine") return reply(empty);
  const sectionIds = chosen.map(section => section.id);
  const programIds = parsed.kind === "program" && parsed.id ? [parsed.id] : [...new Set(chosen.map(section => section.programId).filter((id): id is string => !!id))];
  const bySection = new Map(sections.map(section => [section.id, section]));
  const classQuery = await classesBetween(db, current.organizationId, sectionIds, addDays(from, -14), until);
  const visible = classQuery.filter(row => row.date >= from && row.date <= until);
  const events = await eventsBetween(db, current.organizationId, programIds, sectionIds, addDays(from, -14), until);
  const visibleEvents = events.filter(event => event.until >= from && event.from <= until && event.status !== "skipped");
  const lessonIds = visible.map(row => row.id);
  const lessons = await lessonsOf(db, lessonIds);
  const teaches = new Set(chosen.filter(section => taughtIds.has(section.id)).map(section => section.id));
  const items = [
    ...visible.map(row => classItem(row, bySection.get(row.sectionId), events, classQuery, lessons.get(row.id) || [], teaches.has(row.sectionId))),
    ...visibleEvents.map(event => eventItem(event, visible)),
    ...(await duesBetween(db, current.organizationId, chosen, from, until)).map(due => dueItem(due)),
  ];
  const rail = await railOf(db, current, chosen, programIds, sectionIds, today, bySection, teaches);
  return reply({ from, until, scope: parsed.value, today, zone, canWiden: !!widen, scopes, items, rail });
}

function classItem(row: ClassRow, section: SectionRow | undefined, events: EventRow[], classes: ClassRow[], lessons: { id: string; title: string }[], teaches: boolean) {
  const href = `/secciones/${row.sectionId}/clases/${row.id}`;
  const actions = [
    ...(teaches && row.status === "planned" ? [{ id: "start", label: "Iniciar", href }] : []),
    { id: "open", label: "Abrir la clase", href },
  ];
  return {
    type: "class" as const, id: row.id, date: row.date, startsAt: row.startsAt, durationMinutes: row.durationMinutes,
    status: row.status, moved: movedOf(row, section, events, classes), origin: row.origin,
    sectionId: row.sectionId, sectionName: row.sectionName, courseId: row.courseId, courseTitle: row.courseTitle,
    lessons, attendance: { marked: row.marked, total: row.total }, link: href, actions,
  };
}
function eventItem(event: EventRow, classes: ClassRow[]) {
  const moved = classes.filter(row => row.origin === "schedule" && (row.status === "planned" || row.status === "in_progress") && affects(event, { id: row.sectionId, programId: row.programId }) && covers(event, row.date, row.startsAt)).length;
  const shared = { id: event.id, title: event.title, from: event.from, until: event.until, part: event.part, category: event.category, categoryKey: event.categoryKey, scope: originOf(event), movesClasses: !!event.noClass, classesMoved: event.noClass ? moved : 0 };
  return event.noClass ? { type: "no-class" as const, ...shared } : { type: "event" as const, ...shared, allDay: true };
}
function dueItem(due: DueRow) {
  const href = `/secciones/${due.sectionId}/notas`;
  return {
    type: "due" as const, id: `${due.id}:${due.sectionId}`, title: due.title, date: due.date,
    sectionId: due.sectionId, sectionName: due.sectionName, courseId: due.courseId, courseTitle: due.courseTitle,
    link: href, actions: [{ id: "grade", label: "Ir a calificar", href }],
  };
}

async function railOf(db: Database, current: Member, sections: SectionRow[], programIds: string[], sectionIds: string[], today: string, bySection: Map<string, SectionRow>, teaches: Set<string>) {
  const horizon = addDays(today, 180);
  const upcoming = await classesBetween(db, current.organizationId, sectionIds, today, horizon);
  const nextRow = upcoming.filter(row => row.status === "planned" || row.status === "in_progress").sort((a, b) => a.date.localeCompare(b.date) || (a.startsAt || "").localeCompare(b.startsAt || ""))[0];
  const events = await eventsBetween(db, current.organizationId, programIds, sectionIds, today, horizon);
  const context = nextRow ? await classesBetween(db, current.organizationId, [nextRow.sectionId], addDays(nextRow.date, -14), nextRow.date) : [];
  const lessons = nextRow ? await lessonsOf(db, [nextRow.id]) : new Map();
  const next = nextRow ? classItem(nextRow, bySection.get(nextRow.sectionId), events, context, lessons.get(nextRow.id) || [], teaches.has(nextRow.sectionId)) : null;
  const breaks = events.filter(event => event.noClass && event.status !== "skipped" && event.until >= today)
    .sort((a, b) => a.from.localeCompare(b.from) || a.title.localeCompare(b.title))
    .slice(0, 8)
    .map(event => ({ date: event.from < today ? today : event.from, title: event.title, origin: originOf(event) }));
  return { next, breaks };
}

async function classesBetween(db: Database, organizationId: string, sectionIds: string[], from: string, until: string) {
  if (!sectionIds.length) return [] as ClassRow[];
  return (await db.prepare(`SELECT s.id,s.group_id AS sectionId,s.session_date AS date,s.starts_at AS startsAt,s.duration_minutes AS durationMinutes,s.status,s.origin,
    g.name AS sectionName,c.id AS courseId,c.title AS courseTitle,c.program_id AS programId,
    (SELECT count(*) FROM group_learners gl WHERE gl.group_id=s.group_id AND gl.status='active') AS total,
    (SELECT count(*) FROM attendance_marks m WHERE m.session_id=s.id) AS marked
    FROM class_sessions s JOIN course_groups g ON g.id=s.group_id JOIN courses c ON c.id=g.course_id
    WHERE s.organization_id=? AND s.session_date>=? AND s.session_date<=? AND s.group_id IN (${sectionIds.map(() => "?").join(",")})
    ORDER BY s.session_date,s.starts_at`).bind(organizationId, from, until, ...sectionIds).all<ClassRow>()).results;
}
async function lessonsOf(db: Database, sessionIds: string[]) {
  const grouped = new Map<string, { id: string; title: string }[]>();
  for (let index = 0; index < sessionIds.length; index += 80) {
    const ids = sessionIds.slice(index, index + 80);
    const rows = (await db.prepare(`SELECT p.session_id AS sessionId,l.id,COALESCE(json_extract(l.content,'$.title'),'Lección') AS title FROM class_session_lessons p JOIN lessons l ON l.id=p.lesson_id WHERE p.session_id IN (${ids.map(() => "?").join(",")}) ORDER BY p.position`).bind(...ids).all<{ sessionId: string; id: string; title: string }>()).results;
    for (const row of rows) grouped.set(row.sessionId, [...(grouped.get(row.sessionId) || []), { id: row.id, title: row.title }]);
  }
  return grouped;
}
async function eventsBetween(db: Database, organizationId: string, programIds: string[], sectionIds: string[], from: string, until: string) {
  const parts = ["c.scope='organization'"];
  const params: string[] = [];
  if (programIds.length) { parts.push(`(c.scope='program' AND c.scope_id IN (${programIds.map(() => "?").join(",")}))`); params.push(...programIds); }
  if (sectionIds.length) { parts.push(`(c.scope='section' AND c.scope_id IN (${sectionIds.map(() => "?").join(",")}))`); params.push(...sectionIds); }
  return (await db.prepare(`SELECT e.id,e.title,e.starts_on AS "from",e.ends_on AS until,e.part,e.no_class AS noClass,e.status,c.scope,c.scope_id AS scopeId,cat.label AS category,cat.key AS categoryKey,sp.name AS programName,sg.name AS sectionName
    FROM calendar_events e JOIN calendars c ON c.id=e.calendar_id JOIN calendar_categories cat ON cat.id=e.category_id
    LEFT JOIN study_programs sp ON c.scope='program' AND sp.id=c.scope_id LEFT JOIN course_groups sg ON c.scope='section' AND sg.id=c.scope_id
    WHERE e.organization_id=? AND e.ends_on>=? AND e.starts_on<=? AND (${parts.join(" OR ")})
    ORDER BY e.starts_on,e.title`).bind(organizationId, from, until, ...params).all<EventRow>()).results;
}
async function duesBetween(db: Database, organizationId: string, sections: SectionRow[], from: string, until: string) {
  const courseIds = [...new Set(sections.map(section => section.courseId))];
  if (!courseIds.length) return [] as DueRow[];
  const rows = (await db.prepare(`SELECT a.id,a.title,a.due_on AS date,a.course_id AS courseId,c.title AS courseTitle FROM assessment_activities a JOIN courses c ON c.id=a.course_id
    WHERE a.organization_id=? AND a.due_on>=? AND a.due_on<=? AND a.course_id IN (${courseIds.map(() => "?").join(",")}) ORDER BY a.due_on,a.position`).bind(organizationId, from, until, ...courseIds).all<Omit<DueRow, "sectionId" | "sectionName">>()).results;
  return rows.flatMap(due => sections.filter(section => section.courseId === due.courseId).map(section => ({ ...due, sectionId: section.id, sectionName: section.name })));
}
