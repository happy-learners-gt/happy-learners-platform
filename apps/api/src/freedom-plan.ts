import { coreCoverage, freedomPolicyLabel, policyChange, resolveSettings, sectionContent, sectionDifferences, type FreedomActivity, type FreedomLesson, type FreedomOverride, type FreedomPolicy, type SectionContent } from "@happy-learners/domain";
import type { Database } from "./storage";

const reply = (value: unknown, status = 200) => Response.json(value, { status });

type CourseBits = { educationType: "formal" | "non-formal"; level: string; modality: string; pacing: string; format: string; settings: string; programSettings: string | null; locked: string | null };

/** The policy the course actually follows: the program's lock, then the course, then «igual». */
export async function freedomPolicyOf(db: Database, organizationId: string, courseId: string): Promise<FreedomPolicy> {
  const row = await db.prepare(`SELECT c.education_type AS educationType,c.level,c.modality,c.pacing,c.format,c.settings,p.settings AS programSettings,p.locked
    FROM courses c LEFT JOIN study_programs p ON p.id=c.program_id WHERE c.id=? AND c.organization_id=?`).bind(courseId, organizationId).first<CourseBits>();
  if (!row) return "shared";
  const program = row.programSettings !== null ? { settings: JSON.parse(row.programSettings), locked: JSON.parse(row.locked || "[]"), educationType: row.educationType, level: row.level, modality: row.modality, pacing: row.pacing, format: row.format } : null;
  const course = { educationType: row.educationType, level: row.level, modality: row.modality, pacing: row.pacing, format: row.format, settings: JSON.parse(row.settings) };
  return resolveSettings(course as never, program as never).values.sectionFreedom ?? "shared";
}

type LessonRow = { id: string; unitId: string; position: number; core: number; groupId: string | null; title: string | null; outcomes: string | null; revision: number };
type ActivityRow = { id: string; periodId: string; categoryId: string; points: number; position: number; core: number; groupId: string | null; title: string };

function lessonOf(row: LessonRow): FreedomLesson {
  const outcomes = row.outcomes ? JSON.parse(row.outcomes) as unknown : [];
  return { id: row.id, unitId: row.unitId, position: row.position, core: row.core === 1, groupId: row.groupId, title: row.title || "Lección", outcomeIds: Array.isArray(outcomes) ? outcomes.filter((id): id is string => typeof id === "string") : [] };
}

/** Lessons, activities and adjustments of one section, resolved. `null` when the course is still «igual»: callers keep today's queries. */
export async function loadSection(db: Database, organizationId: string, courseId: string, groupId: string): Promise<{ policy: FreedomPolicy; plan: SectionContent } | { policy: "shared" }> {
  const policy = await freedomPolicyOf(db, organizationId, courseId);
  if (policy === "shared") return { policy };
  const [lessonRows, activityRows, overrideRows] = await db.batch([
    db.prepare(`SELECT l.id,l.course_unit_id AS unitId,l.position,l.is_core AS core,l.group_id AS groupId,json_extract(l.content,'$.title') AS title,json_extract(l.content,'$.outcomeIds') AS outcomes,l.revision
      FROM lessons l JOIN learning_units u ON u.id=l.course_unit_id WHERE u.course_id=? AND l.archived=0 AND (l.group_id IS NULL OR l.group_id=?)`).bind(courseId, groupId),
    db.prepare(`SELECT id,period_id AS periodId,category_id AS categoryId,points,position,is_core AS core,group_id AS groupId,title
      FROM assessment_activities WHERE course_id=? AND organization_id=? AND (group_id IS NULL OR group_id=?)`).bind(courseId, organizationId, groupId),
    db.prepare("SELECT item_type AS itemType,item_id AS itemId,position,hidden,replaces FROM section_content_overrides WHERE group_id=?").bind(groupId),
  ]) as unknown as [LessonRow[], ActivityRow[], { itemType: FreedomOverride["itemType"]; itemId: string; position: number | null; hidden: number; replaces: string | null }[]];
  const lessons = lessonRows.filter(row => row.groupId === null).map(lessonOf);
  const sectionLessons = lessonRows.filter(row => row.groupId === groupId).map(lessonOf);
  const activities: FreedomActivity[] = activityRows.filter(row => row.groupId === null).map(row => ({ ...row, core: row.core === 1, groupId: null }));
  const sectionActivities: FreedomActivity[] = activityRows.filter(row => row.groupId === groupId).map(row => ({ ...row, core: row.core === 1 }));
  const overrides: FreedomOverride[] = overrideRows.map(row => ({ itemType: row.itemType, itemId: row.itemId, position: row.position, hidden: row.hidden === 1, replaces: row.replaces }));
  const plan = sectionContent({ policy, lessons, sectionLessons, activities, sectionActivities, overrides });
  if (!plan.ok) return { policy, plan: { ok: true, lessons: lessons.map(item => ({ ...item, origin: "course" as const, hidden: false })), hiddenLessons: [], activities: activities.map(item => ({ ...item, origin: "course" as const, hidden: false, replaces: null, replacedTitle: null })), hiddenActivities: [], reordered: false } };
  return { policy, plan };
}

/** Published lesson ids in the order the section follows. `null` when the course is «igual» and the usual query is enough. */
export async function effectiveLessonIds(db: Database, organizationId: string, courseId: string, groupId: string): Promise<string[] | null> {
  const loaded = await loadSection(db, organizationId, courseId, groupId);
  if (loaded.policy === "shared" || !("plan" in loaded)) return null;
  const published = new Set((await db.prepare(`SELECT l.id FROM lessons l JOIN learning_units u ON u.id=l.course_unit_id WHERE u.course_id=? AND l.archived=0 AND l.revision>0 AND (l.group_id IS NULL OR l.group_id=?)`).bind(courseId, groupId).all<{ id: string }>()).results.map(row => row.id));
  return loaded.plan.lessons.filter(lesson => published.has(lesson.id)).map(lesson => lesson.id);
}

/** Activity ids that count in this section. `null` when the course is «igual». */
export async function effectiveActivityIds(db: Database, organizationId: string, courseId: string, groupId: string): Promise<Set<string> | null> {
  const loaded = await loadSection(db, organizationId, courseId, groupId);
  if (loaded.policy === "shared" || !("plan" in loaded)) return null;
  return new Set(loaded.plan.activities.map(activity => activity.id));
}

/** Changing the policy is refused, with the sections and activities, when notes would be left behind. */
export async function rejectPolicyChange(db: Database, organizationId: string, courseId: string, from: FreedomPolicy, to: FreedomPolicy): Promise<Response | null> {
  if (from === to) return null;
  const graded = (await db.prepare(`SELECT g.name AS section,a.title AS activity,CASE WHEN o.replaces IS NOT NULL THEN 'replacement' ELSE 'own' END AS kind
    FROM (
      SELECT activity_id,group_id FROM assessment_scores WHERE organization_id=?
      UNION SELECT activity_id,group_id FROM assessment_marks WHERE organization_id=?
      UNION SELECT activity_id,group_id FROM assessment_group_marks WHERE organization_id=?
    ) s
    JOIN assessment_activities a ON a.id=s.activity_id AND a.course_id=?
    JOIN course_groups g ON g.id=s.group_id
    LEFT JOIN section_content_overrides o ON o.group_id=s.group_id AND o.item_type='activity' AND o.item_id=a.id AND o.replaces IS NOT NULL
    WHERE a.group_id IS NOT NULL OR o.replaces IS NOT NULL
    GROUP BY g.id,a.id`).bind(organizationId, organizationId, organizationId, courseId).all<{ section: string; activity: string; kind: "own" | "replacement" }>()).results;
  const decision = policyChange(from, to, graded);
  if (decision.ok) return null;
  return reply({ error: decision.message, affected: decision.affected }, 409);
}

export async function sectionCoverage(db: Database, organizationId: string, courseId: string, groupId: string, plan: SectionContent) {
  const [classes, outcomes, zone] = await db.batch([
    db.prepare(`SELECT s.id,s.session_date AS date,s.status,p.lesson_id AS lessonId FROM class_sessions s
      LEFT JOIN class_session_lessons p ON p.session_id=s.id WHERE s.group_id=? AND s.organization_id=? AND s.status<>'cancelled'`).bind(groupId, organizationId),
    db.prepare("SELECT id FROM course_outcomes WHERE course_id=? AND organization_id=? AND status='active'").bind(courseId, organizationId),
    db.prepare("SELECT timezone FROM organizations WHERE id=?").bind(organizationId),
  ]) as unknown as [{ id: string; date: string; status: string; lessonId: string | null }[], { id: string }[], { timezone: string | null }[]];
  const byClass = new Map<string, { date: string; cancelled: boolean; lessonIds: string[] }>();
  const taught = new Set<string>();
  for (const row of classes) {
    const item = byClass.get(row.id) || { date: row.date, cancelled: false, lessonIds: [] };
    if (row.lessonId) item.lessonIds.push(row.lessonId);
    if (row.status === "completed" && row.lessonId) taught.add(row.lessonId);
    byClass.set(row.id, item);
  }
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: zone[0]?.timezone || "America/Guatemala", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  const coreLessons = plan.lessons.filter(lesson => lesson.core && lesson.groupId === null);
  return coreCoverage(coreLessons, outcomes, [...byClass.values()], [...taught], today);
}

export async function courseDifferences(db: Database, organizationId: string, courseId: string) {
  const [sections, educators] = await db.batch([
    db.prepare("SELECT id,name FROM course_groups WHERE course_id=? AND organization_id=? AND status='active' ORDER BY name,id").bind(courseId, organizationId),
    db.prepare("SELECT e.group_id AS groupId,COALESCE(u.display_name,u.username) AS name FROM section_educators e JOIN users u ON u.id=e.user_id WHERE e.course_id=? AND e.organization_id=? ORDER BY name").bind(courseId, organizationId),
  ]) as unknown as [{ id: string; name: string }[], { groupId: string; name: string }[]];
  const names = new Map<string, string[]>();
  for (const educator of educators) names.set(educator.groupId, [...names.get(educator.groupId) || [], educator.name]);
  const differences = [];
  for (const section of sections) {
    const loaded = await loadSection(db, organizationId, courseId, section.id);
    if (loaded.policy === "shared" || !("plan" in loaded)) continue;
    const coverage = await sectionCoverage(db, organizationId, courseId, section.id, loaded.plan);
    const { plan } = loaded;
    differences.push(sectionDifferences([{ id: section.id, name: section.name, educator: (names.get(section.id) || []).join(", "), lessons: plan.lessons, hiddenLessons: plan.hiddenLessons, activities: plan.activities, hiddenActivities: plan.hiddenActivities, reordered: plan.reordered, coverage }])[0]);
  }
  return differences;
}

export function policyLabel(policy: FreedomPolicy) { return freedomPolicyLabel[policy]; }
