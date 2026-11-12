import type { Member } from "@happy-learners/contracts";
import { calendarFeed, feedWindow, localDay, tokenPattern, tokenPrefix } from "@happy-learners/domain";
import type { FeedClass } from "@happy-learners/domain";
import type { Database } from "./storage";
import { digest, newToken } from "./auth";
import { taughtClasses, timezoneOf } from "./classes";
import { preferencesFor } from "./preferences";

/**
 * Calendar subscription (ST-125). The link carries a 256-bit secret whose first letter names the organization's store,
 * like session tokens; only its SHA-256 is kept. GET /api/feeds/calendar says whether a link exists; POST creates or
 * regenerates it and returns it once (the previous one stops working). GET /api/feeds/calendar/<token>.ics is the feed.
 */
export const feedPath = /^\/api\/feeds\/calendar\/([a-z]_[a-f0-9]{64})\.ics$/;
const linkOf = (origin: string, token: string) => `${origin}/api/feeds/calendar/${token}.ics`;

export async function feedLink(method: string, url: URL, current: Member, db: Database) {
  if (method === "POST") {
    const token = tokenPrefix(current.organizationId) + newToken(), createdAt = new Date().toISOString();
    await db.prepare("INSERT INTO calendar_feeds(user_id,organization_id,token_hash,created_at) VALUES (?,?,?,?) ON CONFLICT(user_id) DO UPDATE SET token_hash=excluded.token_hash,organization_id=excluded.organization_id,created_at=excluded.created_at")
      .bind(current.id, current.organizationId, await digest(token), createdAt).run();
    const link = linkOf(url.origin, token);
    return Response.json({ active: true, createdAt, url: link, webcal: link.replace(/^https?:/, "webcal:") }, { status: 201 });
  }
  const row = await db.prepare("SELECT created_at AS createdAt FROM calendar_feeds WHERE user_id=? AND organization_id=?").bind(current.id, current.organizationId).first<{ createdAt: string }>();
  return Response.json({ active: !!row, createdAt: row?.createdAt || null });
}

const missing = () => Response.json({ error: "Este enlace de calendario no existe o fue reemplazado." }, { status: 404 });

/** The feed: the classes of the sections the person teaches, while their membership is active. */
export async function feed(token: string, url: URL, scope: string, db: Database) {
  if (!tokenPattern.test(token)) return missing();
  const owner = await db.prepare("SELECT f.user_id AS userId,f.organization_id AS organizationId,o.name FROM calendar_feeds f JOIN memberships m ON m.user_id=f.user_id AND m.organization_id=f.organization_id AND m.active=1 JOIN organizations o ON o.id=f.organization_id WHERE f.token_hash=? AND f.organization_id=?")
    .bind(await digest(token), scope).first<{ userId: string; organizationId: string; name: string | null }>();
  if (!owner) return missing();
  // ST-160: the window follows the owner's day and the calendar announces their zone; classes keep the organization's.
  const [timezone, own] = await Promise.all([timezoneOf(db, owner.organizationId), preferencesFor(db, owner.userId, owner.organizationId)]);
  const window = feedWindow(localDay(own.timezone));
  const classes = (await db.prepare(`SELECT s.id,s.group_id AS groupId,s.session_date AS sessionDate,s.starts_at AS startsAt,s.duration_minutes AS durationMinutes,s.status,s.version,s.updated_at AS updatedAt,c.title AS courseTitle,g.name AS groupName
    FROM class_sessions s JOIN course_groups g ON g.id=s.group_id ${taughtClasses} AND s.session_date BETWEEN ? AND ? ORDER BY s.session_date,s.starts_at,s.id LIMIT 2000`)
    .bind(owner.userId, owner.organizationId, window.from, window.until).all<FeedClass>()).results;
  const body = calendarFeed({ name: `Mis clases · ${owner.name || "Acervum"}`, timezone, displayTimezone: own.timezone, origin: url.origin, classes });
  return new Response(body, { headers: { "Content-Type": "text/calendar; charset=utf-8", "Content-Disposition": 'inline; filename="mis-clases.ics"' } });
}
