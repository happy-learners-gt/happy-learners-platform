import type { ActivityEvent, Member } from "@happy-learners/contracts";
import type { Database } from "./storage";

/**
 * The activity log (Plataforma, docs/architecture/contextos.md): every context writes its entries here. It depends on
 * nothing but the database, so writing an entry never pulls in course teams or permissions.
 */
export type EventInput = Pick<ActivityEvent, "action" | "targetType" | "targetId" | "summary"> & { courseId?: string | null; groupId?: string | null };

/**
 * One audit entry: who did what, on which course and section. Written after the operation succeeds. Never before the
 * organization's latest entry (QA-04): the Worker's clock may read a few milliseconds behind the previous request,
 * and the log is read newest first. One indexed row read (activity_events_organization).
 */
export function event(db: Database, current: Member, entry: EventInput) {
  return db.prepare(`INSERT INTO activity_events(id,organization_id,actor_id,action,target_type,target_id,course_id,group_id,summary,occurred_at)
      VALUES (?,?,?,?,?,?,?,?,?,max(?,COALESCE((SELECT max(occurred_at) FROM activity_events WHERE organization_id=?),'')))`)
    .bind(`event-${crypto.randomUUID()}`, current.organizationId, current.id, entry.action, entry.targetType, entry.targetId, entry.courseId || null, entry.groupId ?? (entry.targetType === "group" ? entry.targetId : null), entry.summary.slice(0, 240), new Date().toISOString(), current.organizationId);
}
export const recordEvent = (db: Database, current: Member, entry: EventInput) => event(db, current, entry).run();
