import type { StaffAvailabilitySlot } from "@happy-learners/contracts";

/**
 * Timetables with rules (1.4.3, docs/design/asistente-ia.md §6d). A deterministic solver places each section's weekly
 * meetings in the school day's class blocks: backtracking, the most constrained section first, candidates in a fixed
 * order (preferred days, then days spread over the week, then earlier). Hard rules are never broken; when a section
 * cannot be placed, the answer says what blocks each slot it could have used. A language model only turns rules
 * written in words into these rules, which a person confirms (task `rules-to-constraints`).
 */
export interface SolverBlock { key: string; startsAt: string; endsAt: string; kind: "class" | "break"; label?: string }
/** A school day: its blocks in order, breaks included (two class blocks are consecutive only without a break between). */
export interface SolverDay { weekday: number; blocks: SolverBlock[] }
export interface SolverSection { id: string; name: string; educatorIds: string[]; meetingsPerWeek: number; blocksPerMeeting: number }
export interface SolverEducator { id: string; name: string; availability: StaffAvailabilitySlot[] }
export type SolverRule =
  | { kind: "unavailable"; educatorId: string; weekday: number; from: string; to: string }
  | { kind: "max-daily"; educatorId: string; minutes: number }
  | { kind: "shared-students"; sectionIds: string[] }
  | { kind: "not-on"; sectionId: string; weekday: number }
  | { kind: "preferred-days"; sectionId: string; weekdays: number[] };
/** Meetings that are already fixed (sections outside this run): they occupy their educators. */
export interface FixedMeeting { sectionId: string; name?: string; educatorIds: string[]; weekday: number; startsAt: string; durationMinutes: number }
export interface SolverInput { days: SolverDay[]; sections: SolverSection[]; educators: SolverEducator[]; rules: SolverRule[]; fixed?: FixedMeeting[] }
export interface SolverMeeting { sectionId: string; weekday: number; startsAt: string; durationMinutes: number }
export interface UnplacedSection { sectionId: string; name: string; placed: number; needed: number; reasons: { reason: string; slots: number }[] }
export type SolverResult =
  | { status: "solved"; meetings: SolverMeeting[]; preferredMissed: number; steps: number }
  | { status: "impossible"; meetings: SolverMeeting[]; unplaced: UnplacedSection[]; steps: number; exhausted: boolean };

export const weekdayNames = ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"];
const toMinutes = (clock: string) => Number(clock.slice(0, 2)) * 60 + Number(clock.slice(3, 5));
const toClock = (minutes: number) => `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
/** Availability counts Monday as 1 and Sunday as 7; schedules count Sunday as 0. */
const availabilityDay = (weekday: number) => weekday === 0 ? 7 : weekday;

type Candidate = { weekday: number; start: number; end: number };
type Placed = { sectionId: string; educatorIds: string[]; weekday: number; start: number; end: number };

/** Every place a meeting of `size` consecutive class blocks fits, over the days. */
function slotsOf(days: SolverDay[], size: number): Candidate[] {
  const out: Candidate[] = [];
  for (const day of [...days].sort((a, b) => ((a.weekday + 6) % 7) - ((b.weekday + 6) % 7))) {
    for (let index = 0; index < day.blocks.length; index++) {
      const run = day.blocks.slice(index, index + size);
      if (run.length < size || run.some(block => block.kind !== "class")) continue;
      out.push({ weekday: day.weekday, start: toMinutes(run[0].startsAt), end: toMinutes(run[run.length - 1].endsAt) });
    }
  }
  return out;
}

export function solveTimetable(input: SolverInput, maxSteps = 200_000): SolverResult {
  const educators = new Map(input.educators.map(item => [item.id, item]));
  const fixed: Placed[] = (input.fixed || []).map(item => ({ sectionId: item.sectionId, educatorIds: item.educatorIds, weekday: item.weekday, start: toMinutes(item.startsAt), end: toMinutes(item.startsAt) + item.durationMinutes }));
  const shared = input.rules.filter((rule): rule is Extract<SolverRule, { kind: "shared-students" }> => rule.kind === "shared-students");
  const partners = (sectionId: string) => new Set(shared.filter(rule => rule.sectionIds.includes(sectionId)).flatMap(rule => rule.sectionIds).filter(id => id !== sectionId));
  const maxDaily = new Map(input.rules.flatMap(rule => rule.kind === "max-daily" ? [[rule.educatorId, rule.minutes] as const] : []));
  const preferred = new Map(input.rules.flatMap(rule => rule.kind === "preferred-days" ? [[rule.sectionId, new Set(rule.weekdays)] as const] : []));
  const overlaps = (a: { weekday: number; start: number; end: number }, b: { weekday: number; start: number; end: number }) => a.weekday === b.weekday && a.start < b.end && b.start < a.end;
  const name = (id: string) => educators.get(id)?.name || "Docente";
  const sectionName = (id: string) => input.sections.find(section => section.id === id)?.name || input.fixed?.find(item => item.sectionId === id)?.name || "Otra sección";

  /** Why a slot cannot take a meeting of `section` given what is placed; null when it can. Fixed rules come first. */
  function blocked(section: SolverSection, slot: Candidate, placed: Placed[]): string | null {
    const day = weekdayNames[slot.weekday];
    if (input.rules.some(rule => rule.kind === "not-on" && rule.sectionId === section.id && rule.weekday === slot.weekday)) return `Regla: ${section.name} no tiene clase el ${day}`;
    if (placed.some(item => item.sectionId === section.id && item.weekday === slot.weekday)) return `${section.name} ya tiene clase ese día`;
    for (const educatorId of section.educatorIds) {
      const educator = educators.get(educatorId);
      if (educator?.availability.length && !educator.availability.some(item => item.day === availabilityDay(slot.weekday) && toMinutes(item.start) <= slot.start && slot.end <= toMinutes(item.end))) return `Fuera de la disponibilidad de ${name(educatorId)}`;
      const rule = input.rules.find(item => item.kind === "unavailable" && item.educatorId === educatorId && item.weekday === slot.weekday && toMinutes(item.from) < slot.end && slot.start < toMinutes(item.to));
      if (rule) return `Regla: ${name(educatorId)} no está disponible el ${day}`;
      const busy = [...fixed, ...placed].find(item => item.educatorIds.includes(educatorId) && overlaps(item, slot));
      if (busy) return `${name(educatorId)} ya tiene clase con ${sectionName(busy.sectionId)}`;
      const limit = maxDaily.get(educatorId);
      if (limit !== undefined) {
        const load = [...fixed, ...placed].filter(item => item.educatorIds.includes(educatorId) && item.weekday === slot.weekday).reduce((sum, item) => sum + item.end - item.start, 0);
        if (load + slot.end - slot.start > limit) return `Carga diaria máxima de ${name(educatorId)} (${limit} min)`;
      }
    }
    const mates = partners(section.id);
    const clash = [...fixed, ...placed].find(item => mates.has(item.sectionId) && overlaps(item, slot));
    if (clash) return `Comparte estudiantes con ${sectionName(clash.sectionId)}, que tiene clase entonces`;
    return null;
  }

  /** Candidates in a fixed order: preferred days, then days not next to the section's other meetings, then earlier. */
  function ordered(section: SolverSection, placed: Placed[], slots: Candidate[]) {
    const mine = placed.filter(item => item.sectionId === section.id).map(item => (item.weekday + 6) % 7);
    const wish = preferred.get(section.id);
    const rank = (slot: Candidate) => {
      const position = (slot.weekday + 6) % 7;
      const near = mine.some(day => Math.abs(day - position) === 1) ? 1 : 0;
      return [wish && !wish.has(slot.weekday) ? 1 : 0, near, position, slot.start];
    };
    return slots.filter(slot => !blocked(section, slot, placed)).sort((a, b) => {
      const [x, y] = [rank(a), rank(b)];
      for (let index = 0; index < x.length; index++) if (x[index] !== y[index]) return x[index] - y[index];
      return 0;
    });
  }

  const slotCache = new Map<number, Candidate[]>();
  const slotsFor = (section: SolverSection) => { if (!slotCache.has(section.blocksPerMeeting)) slotCache.set(section.blocksPerMeeting, slotsOf(input.days, section.blocksPerMeeting)); return slotCache.get(section.blocksPerMeeting)!; };
  const needed = input.sections.flatMap(section => Array.from({ length: Math.max(0, section.meetingsPerWeek) }, () => section));
  let steps = 0, exhausted = false, best: Placed[] = [];

  function search(placed: Placed[], remaining: SolverSection[]): Placed[] | null {
    if (!remaining.length) return placed;
    if (++steps > maxSteps) { exhausted = true; return null; }
    // The most constrained meeting first (fewest open slots); ties by the order sections were given.
    let pick = 0, options: Candidate[] | null = null;
    for (let index = 0; index < remaining.length; index++) {
      const found = ordered(remaining[index], placed, slotsFor(remaining[index]));
      if (!options || found.length < options.length) { pick = index; options = found; }
      if (!found.length) break;
    }
    if (placed.length > best.length) best = placed;
    const section = remaining[pick], rest = remaining.filter((_, index) => index !== pick);
    for (const slot of options!) {
      const found = search([...placed, { sectionId: section.id, educatorIds: section.educatorIds, ...slot }], rest);
      if (found) return found;
      if (exhausted) return null;
    }
    return null;
  }

  const solution = search([], needed);
  if (!solution) {
    // One section that cannot be placed must not hide the rest: place what fits, most constrained first, one by one.
    const greedy: Placed[] = [];
    const queue = [...needed].sort((a, b) => ordered(a, [], slotsFor(a)).length - ordered(b, [], slotsFor(b)).length);
    for (const section of queue) {
      const [slot] = ordered(section, greedy, slotsFor(section));
      if (slot) greedy.push({ sectionId: section.id, educatorIds: section.educatorIds, ...slot });
    }
    if (greedy.length > best.length) best = greedy;
  }
  const meetingsOf = (placed: Placed[]) => placed.map(item => ({ sectionId: item.sectionId, weekday: item.weekday, startsAt: toClock(item.start), durationMinutes: item.end - item.start }))
    .sort((a, b) => ((a.weekday + 6) % 7) - ((b.weekday + 6) % 7) || a.startsAt.localeCompare(b.startsAt) || a.sectionId.localeCompare(b.sectionId));
  if (solution) {
    const preferredMissed = solution.filter(item => preferred.get(item.sectionId) && !preferred.get(item.sectionId)!.has(item.weekday)).length;
    return { status: "solved", meetings: meetingsOf(solution), preferredMissed, steps };
  }
  // No full answer: report the most that could be placed and, for each section short of meetings, what blocks its slots.
  const unplaced = input.sections.flatMap(section => {
    const placed = best.filter(item => item.sectionId === section.id).length;
    if (placed >= section.meetingsPerWeek) return [];
    const counts = new Map<string, number>();
    for (const slot of slotsFor(section)) { const reason = blocked(section, slot, best); if (reason) counts.set(reason, (counts.get(reason) || 0) + 1); }
    if (!slotsFor(section).length) counts.set(`La jornada no tiene ${section.blocksPerMeeting} periodos seguidos sin recreo`, 1);
    return [{ sectionId: section.id, name: section.name, placed, needed: section.meetingsPerWeek, reasons: [...counts.entries()].map(([reason, slots]) => ({ reason, slots })).sort((a, b) => b.slots - a.slots || a.reason.localeCompare(b.reason)) }];
  });
  return { status: "impossible", meetings: meetingsOf(best), unplaced, steps, exhausted };
}
