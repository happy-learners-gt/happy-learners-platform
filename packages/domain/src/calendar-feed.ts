/**
 * Calendar subscription (ST-125): the classes a person teaches as an iCalendar feed (RFC 5545) that Google Calendar,
 * Outlook and Apple Calendar refresh on their own. Times are written in UTC («Z»), which every client reads the same
 * way, so the feed needs no VTIMEZONE; the organization's zone is only used to place each class on the timeline.
 */
export interface FeedClass {
  id: string;
  groupId: string;
  sessionDate: string;
  startsAt: string | null;
  durationMinutes: number | null;
  status: "planned" | "in_progress" | "completed" | "cancelled";
  version: number;
  updatedAt: string | null;
  courseTitle: string;
  groupName: string;
}
/**
 * `timezone` is the organization's, where classes are stored (DEC-035); `displayTimezone` is the person's (ST-160),
 * announced to the calendar as its default zone. Events are in UTC either way.
 */
export interface FeedInput { name: string; timezone: string; displayTimezone?: string; origin: string; classes: FeedClass[]; now?: Date }

/** From 30 days ago to 180 days ahead: what a calendar needs to plan the week and look back at the month. */
export const feedDaysBack = 30, feedDaysAhead = 180;
const addDays = (day: string, days: number) => new Date(Date.parse(`${day}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
export const feedWindow = (today: string) => ({ from: addDays(today, -feedDaysBack), until: addDays(today, feedDaysAhead) });

/** Offset of the zone at an instant, in minutes east of UTC. */
function offsetAt(zone: string, instant: number) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-US", { timeZone: zone, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" })
    .formatToParts(new Date(instant)).map(part => [part.type, part.value]));
  return (Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour, +parts.minute, +parts.second) - Math.floor(instant / 1000) * 1000) / 60000;
}
/** The instant a wall-clock time of the zone names; across daylight-saving changes the second guess settles it. */
export function zonedInstant(day: string, time: string, zone: string): Date {
  const [year, month, date] = day.split("-").map(Number), [hour, minute] = time.split(":").map(Number);
  const wall = Date.UTC(year, month - 1, date, hour, minute);
  let instant = wall - offsetAt(zone, wall) * 60000;
  instant = wall - offsetAt(zone, instant) * 60000;
  return new Date(instant);
}

const stamp = (value: Date) => value.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
const dateValue = (day: string) => day.replaceAll("-", "");
/** TEXT values escape backslashes, semicolons, commas and line breaks (RFC 5545 §3.3.11). */
export const escapeText = (value: string) => value.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r\n|\r|\n/g, "\\n");
/** UTF-8 length of one character. */
const octets = (char: string) => { const code = char.codePointAt(0) || 0; return code < 0x80 ? 1 : code < 0x800 ? 2 : code < 0x10000 ? 3 : 4; };
/** Lines longer than 75 octets continue on the next line after CRLF and a space, never splitting a character. */
export function foldLine(line: string) {
  const out: string[] = [];
  let current = "", size = 0, limit = 75;
  for (const char of line) {
    const bytes = octets(char);
    if (size + bytes > limit) { out.push(current); current = " "; size = 1; limit = 75; }
    current += char; size += bytes;
  }
  out.push(current);
  return out.join("\r\n");
}

const statusOf: Record<FeedClass["status"], string> = { planned: "CONFIRMED", in_progress: "CONFIRMED", completed: "CONFIRMED", cancelled: "CANCELLED" };
const host = (origin: string) => /^[a-z][a-z0-9+.-]*:\/\/([^/:?#]+)/i.exec(origin)?.[1]?.toLowerCase() || "happy-learners";

/** The whole feed: one VEVENT per class, with a UID that never changes and a SEQUENCE that grows with each change. */
export function calendarFeed({ name, timezone, displayTimezone, origin, classes, now = new Date() }: FeedInput): string {
  const lines = [
    "BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Happy Learners//Mis clases//ES", "CALSCALE:GREGORIAN", "METHOD:PUBLISH",
    `X-WR-CALNAME:${escapeText(name)}`, `X-WR-TIMEZONE:${displayTimezone || timezone}`, "REFRESH-INTERVAL;VALUE=DURATION:PT1H", "X-PUBLISHED-TTL:PT1H",
  ];
  const dtstamp = stamp(now), domain = host(origin);
  for (const item of classes) {
    lines.push("BEGIN:VEVENT", `UID:${item.id}@${domain}`, `DTSTAMP:${dtstamp}`);
    if (item.startsAt) {
      const start = zonedInstant(item.sessionDate, item.startsAt, timezone);
      lines.push(`DTSTART:${stamp(start)}`, `DTEND:${stamp(new Date(start.getTime() + (item.durationMinutes || 60) * 60000))}`);
    } else lines.push(`DTSTART;VALUE=DATE:${dateValue(item.sessionDate)}`, `DTEND;VALUE=DATE:${dateValue(addDays(item.sessionDate, 1))}`);
    lines.push(`SUMMARY:${escapeText(`${item.courseTitle} · ${item.groupName}`)}`);
    lines.push(`DESCRIPTION:${escapeText(`${item.status === "cancelled" ? "Clase cancelada.\n" : ""}Curso: ${item.courseTitle}\nSección: ${item.groupName}`)}`);
    lines.push(`URL:${origin}/secciones/${item.groupId}/clases/${item.id}`, `STATUS:${statusOf[item.status]}`, `SEQUENCE:${Math.max(0, item.version - 1)}`, "TRANSP:OPAQUE");
    const updated = item.updatedAt ? new Date(item.updatedAt) : null;
    if (updated && !Number.isNaN(updated.getTime())) lines.push(`LAST-MODIFIED:${stamp(updated)}`);
    lines.push("END:VEVENT");
  }
  lines.push("END:VCALENDAR");
  return lines.map(foldLine).join("\r\n") + "\r\n";
}
