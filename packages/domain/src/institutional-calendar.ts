import type { DateRule, InstitutionalCalendarEvent, InstitutionalCalendarRule, SectionSchedule } from "@happy-learners/contracts";
import { occurrences } from "./calendar-rules";
import { meetingOn } from "./schedule";

export type CalendarRange = { from: string; until: string; schedule?: Pick<SectionSchedule, "startsAt" | "durationMinutes" | "meetings"> };
export type NoClassDay = Pick<InstitutionalCalendarEvent, "id" | "title" | "from" | "until" | "part">;

const addDay = (day: string, amount = 1) => {
  const date = new Date(`${day}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + amount);
  return date.toISOString().slice(0, 10);
};
const inPart = (startsAt: string, part: InstitutionalCalendarEvent["part"]) =>
  part === "full" || (part === "morning" ? startsAt < "12:00" : startsAt >= "12:00");

/**
 * Active no-class dates in a range. With a section schedule, half days are returned only for dates whose meeting
 * starts in that half; full days remain ranges because they remove every meeting.
 */
export function noClassDays(events: InstitutionalCalendarEvent[], range: CalendarRange): NoClassDay[] {
  const result: NoClassDay[] = [];
  for (const event of events) {
    if (!event.noClass || event.status === "skipped" || event.until < range.from || event.from > range.until) continue;
    const from = event.from < range.from ? range.from : event.from;
    const until = event.until > range.until ? range.until : event.until;
    if (event.part === "full" || !range.schedule) {
      result.push({ id: event.id, title: event.title, from, until, part: event.part });
      continue;
    }
    for (let day = from; day <= until; day = addDay(day)) {
      if (inPart(meetingOn(range.schedule, day).startsAt, event.part))
        result.push({ id: event.id, title: event.title, from: day, until: day, part: event.part });
    }
  }
  return result.sort((a, b) => a.from.localeCompare(b.from) || a.id.localeCompare(b.id));
}

/** Organization, program and section events add up; a skipped lower-level event never hides an event above it. */
export function effectiveCalendar(
  organization: InstitutionalCalendarEvent[],
  program: InstitutionalCalendarEvent[] = [],
  section: InstitutionalCalendarEvent[] = [],
) {
  return [...organization, ...program, ...section].sort((a, b) => a.from.localeCompare(b.from) || a.id.localeCompare(b.id));
}

export type ExistingGeneratedEvent = InstitutionalCalendarEvent & {
  /** Set by storage when the event changed after its rule was last edited. */
  manual?: boolean;
  modified?: boolean;
};
export type GeneratedEvent = Omit<InstitutionalCalendarEvent, "id" | "calendarId" | "categoryId" | "createdAt" | "updatedAt"> & {
  id?: string;
  calendarId?: string;
  categoryId?: string;
};
export type GenerationPlan = {
  create: GeneratedEvent[];
  update: (GeneratedEvent & { id: string })[];
  keep: ExistingGeneratedEvent[];
};
type RuleSource = DateRule | Pick<InstitutionalCalendarRule, "id" | "calendarId" | "categoryId" | "rule" | "noClass">;

const wrapped = (source: RuleSource) => "rule" in source
  ? source
  : { id: source.id, calendarId: "", categoryId: "", rule: source, noClass: false };

/**
 * Plans one generated event per rule occurrence. Events moved or skipped after generation are kept; an unchanged
 * generated event follows a later rule edit.
 */
export function generateYear(rules: RuleSource[], year: number, existing: ExistingGeneratedEvent[]): GenerationPlan {
  const sources = rules.map(wrapped);
  const computed = occurrences(sources.map(source => source.rule), year);
  const plan: GenerationPlan = { create: [], update: [], keep: [] };
  for (const occurrence of computed) {
    const source = sources.find(item => item.rule.id === occurrence.ruleId)!;
    const next: GeneratedEvent = {
      calendarId: source.calendarId,
      categoryId: source.categoryId,
      title: occurrence.title,
      from: occurrence.from,
      until: occurrence.until,
      part: occurrence.part,
      noClass: source.noClass,
      ruleId: source.id,
      year,
      status: "active",
    };
    const found = existing.find(event => event.ruleId === source.id && event.year === year);
    if (!found) plan.create.push(next);
    else if (found.status === "skipped" || found.manual || found.modified) plan.keep.push(found);
    else if (found.title !== next.title || found.from !== next.from || found.until !== next.until || found.part !== next.part
      || found.noClass !== next.noClass || found.categoryId !== next.categoryId) plan.update.push({ ...next, id: found.id });
    else plan.keep.push(found);
  }
  return plan;
}
