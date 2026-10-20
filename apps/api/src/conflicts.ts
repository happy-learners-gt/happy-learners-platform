import type { EducatorConflict } from "@happy-learners/contracts";
import { outsideAvailability } from "@happy-learners/domain";
import type { Database } from "./storage";

const minuteOf = (column: string) => `(CAST(substr(${column},1,2) AS INTEGER)*60+CAST(substr(${column},4,2) AS INTEGER))`;
const open = "('planned','in_progress')";

/**
 * Upcoming classes of a section that overlap, on the same day, with a class of another active section taught by the
 * same educator. With `userIds`, the check is for those people as if they taught the section; otherwise for its
 * current educators. A class without a duration counts as starting at its time.
 */
export async function educatorConflicts(db: Database, organizationId: string, groupIds: string[], today: string, userIds?: string[]): Promise<EducatorConflict[]> {
  if (!groupIds.length || (userIds && !userIds.length)) return [];
  const people = userIds ? `se.user_id IN (${userIds.map(() => "?").join(",")})` : "se.user_id IN (SELECT user_id FROM section_educators me WHERE me.group_id=s.group_id)";
  const rows = (await db.prepare(`SELECT s.group_id AS groupId,se.user_id AS userId,COALESCE(u.display_name,u.username) AS name,o.group_id AS otherGroupId,g.name AS otherGroup,
      c.id AS otherCourseId,c.title AS otherCourse,count(*) AS overlaps,min(s.session_date) AS firstDate,min(s.starts_at) AS startsAt,min(o.starts_at) AS otherStartsAt
    FROM class_sessions s
    JOIN class_sessions o ON o.organization_id=s.organization_id AND o.session_date=s.session_date AND o.group_id<>s.group_id AND o.status IN ${open} AND o.starts_at IS NOT NULL
    JOIN section_educators se ON se.group_id=o.group_id
    JOIN users u ON u.id=se.user_id
    JOIN course_groups g ON g.id=o.group_id AND g.status='active'
    JOIN courses c ON c.id=g.course_id AND c.status='active'
    WHERE s.organization_id=? AND s.group_id IN (${groupIds.map(() => "?").join(",")}) AND s.status IN ${open} AND s.session_date>=? AND s.starts_at IS NOT NULL AND ${people}
      AND ${minuteOf("s.starts_at")} < ${minuteOf("o.starts_at")}+COALESCE(o.duration_minutes,1) AND ${minuteOf("o.starts_at")} < ${minuteOf("s.starts_at")}+COALESCE(s.duration_minutes,1)
    GROUP BY s.group_id,se.user_id,o.group_id ORDER BY name,firstDate`).bind(organizationId, ...groupIds, today, ...(userIds || [])).all<Omit<EducatorConflict, "confirmation">>()).results;
  // DEC-047: classes outside the availability the educator declared count like an overlap; the pair is the section
  // with itself, so the existing confirmations table records them.
  const gaps = await availabilityGaps(db, organizationId, groupIds, today, userIds);
  const all = [...rows.map(row => ({ ...row, kind: "overlap" as const })), ...gaps];
  if (!all.length) return [];
  const confirmations = (await db.prepare(`SELECT o.group_id AS groupId,o.other_group_id AS otherGroupId,o.user_id AS userId,o.reason,o.confirmed_at AS confirmedAt,COALESCE(u.display_name,u.username) AS confirmedBy
    FROM educator_conflict_overrides o JOIN users u ON u.id=o.confirmed_by WHERE o.organization_id=? AND o.user_id IN (${[...new Set(all.map(row => row.userId))].map(() => "?").join(",")}) ORDER BY o.confirmed_at DESC`)
    .bind(organizationId, ...new Set(all.map(row => row.userId))).all<{ groupId: string; otherGroupId: string; userId: string; reason: string; confirmedAt: string; confirmedBy: string }>()).results;
  // A confirmation covers the pair of sections in either direction: it was given knowing both schedules.
  return all.map(row => {
    const found = confirmations.find(item => item.userId === row.userId && ((item.groupId === row.groupId && item.otherGroupId === row.otherGroupId) || (item.groupId === row.otherGroupId && item.otherGroupId === row.groupId)));
    return { ...row, overlaps: Number(row.overlaps), confirmation: found ? { reason: found.reason, confirmedAt: found.confirmedAt, confirmedBy: found.confirmedBy } : null };
  });
}

/**
 * DEC-047: upcoming classes of a section that fall outside the weekly availability its educator declared in their
 * profile. Someone who declared nothing is not restricted; a class must fit whole within one slot of its weekday.
 */
async function availabilityGaps(db: Database, organizationId: string, groupIds: string[], today: string, userIds?: string[]): Promise<Omit<EducatorConflict, "confirmation">[]> {
  // The people being assigned (not in the section yet) or, without them, the section's current educators.
  const who = userIds ? `JOIN users u ON u.id IN (${userIds.map(() => "?").join(",")})` : "JOIN section_educators se ON se.group_id=s.group_id JOIN users u ON u.id=se.user_id";
  const rows = (await db.prepare(`SELECT s.group_id AS groupId,u.id AS userId,COALESCE(u.display_name,u.username) AS name,p.availability,s.session_date AS date,s.starts_at AS startsAt,s.duration_minutes AS minutes
    FROM class_sessions s ${who} JOIN staff_profiles p ON p.user_id=u.id AND p.availability IS NOT NULL AND p.availability<>'[]'
    WHERE s.organization_id=? AND s.group_id IN (${groupIds.map(() => "?").join(",")}) AND s.status IN ${open} AND s.session_date>=? AND s.starts_at IS NOT NULL
    ORDER BY s.session_date,s.starts_at`).bind(...(userIds || []), organizationId, ...groupIds, today).all<{ groupId: string; userId: string; name: string; availability: string; date: string; startsAt: string; minutes: number | null }>()).results;
  const gaps = new Map<string, Omit<EducatorConflict, "confirmation">>();
  for (const row of rows) {
    if (!outsideAvailability(JSON.parse(row.availability), row.date, row.startsAt, row.minutes)) continue;
    const key = `${row.groupId}|${row.userId}`, found = gaps.get(key);
    if (found) found.overlaps += 1;
    else gaps.set(key, { kind: "availability", groupId: row.groupId, userId: row.userId, name: row.name, otherGroupId: row.groupId, otherGroup: "", otherCourseId: "", otherCourse: "", overlaps: 1, firstDate: row.date, startsAt: row.startsAt, otherStartsAt: "" });
  }
  return [...gaps.values()];
}
