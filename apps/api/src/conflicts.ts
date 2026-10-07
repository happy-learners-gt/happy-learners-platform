import type { EducatorConflict } from "@happy-learners/contracts";
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
  if (!rows.length) return [];
  const confirmations = (await db.prepare(`SELECT o.group_id AS groupId,o.other_group_id AS otherGroupId,o.user_id AS userId,o.reason,o.confirmed_at AS confirmedAt,COALESCE(u.display_name,u.username) AS confirmedBy
    FROM educator_conflict_overrides o JOIN users u ON u.id=o.confirmed_by WHERE o.organization_id=? AND o.user_id IN (${[...new Set(rows.map(row => row.userId))].map(() => "?").join(",")}) ORDER BY o.confirmed_at DESC`)
    .bind(organizationId, ...new Set(rows.map(row => row.userId))).all<{ groupId: string; otherGroupId: string; userId: string; reason: string; confirmedAt: string; confirmedBy: string }>()).results;
  // A confirmation covers the pair of sections in either direction: it was given knowing both schedules.
  return rows.map(row => {
    const found = confirmations.find(item => item.userId === row.userId && ((item.groupId === row.groupId && item.otherGroupId === row.otherGroupId) || (item.groupId === row.otherGroupId && item.otherGroupId === row.groupId)));
    return { ...row, overlaps: Number(row.overlaps), confirmation: found ? { reason: found.reason, confirmedAt: found.confirmedAt, confirmedBy: found.confirmedBy } : null };
  });
}
