import { describe, expect, it } from "vitest";
import { proposeTimetable } from "../packages/domain/src/index";
import type { ProposalSession } from "../packages/domain/src/index";

// 1.4.2 (docs/design/asistente-ia.md §6d): the section's pending lessons in its next classes, by fixed rules.
const lesson = (id: string, minutes: number) => ({ id, title: id.toUpperCase(), minutes });
const session = (id: string, sessionDate: string, partial: Partial<ProposalSession> = {}): ProposalSession => ({ id, sessionDate, startsAt: "08:00", durationMinutes: 45, status: "planned", lessonIds: [], ...partial });

describe("1.4.2 proposed timetable", () => {
  it("fills the next classes in order, as many lessons as fit, and lists what is left", () => {
    const lessons = [lesson("l1", 20), lesson("l2", 20), lesson("l3", 30), lesson("l4", 45), lesson("l5", 10)];
    const result = proposeTimetable(lessons, [session("s2", "2026-11-04"), session("s1", "2026-11-03"), session("s3", "2026-11-05")], "2026-11-01");
    expect(result.assignments.map(item => [item.sessionId, item.lessons.map(l => l.id), item.minutes, item.overflow])).toEqual([
      ["s1", ["l1", "l2"], 40, false], ["s2", ["l3"], 30, false], ["s3", ["l4"], 45, false],
    ]);
    expect(result.unplanned.map(item => item.id)).toEqual(["l5"]);
    expect(result.freeSessions).toBe(0);
  });

  it("keeps planned classes, skips past and cancelled ones, and does not propose what is planned or taught", () => {
    const lessons = [lesson("l1", 20), lesson("l2", 20), lesson("l3", 20), lesson("l4", 20)];
    const result = proposeTimetable(lessons, [
      session("past", "2026-10-28"),
      session("done", "2026-10-29", { status: "completed", lessonIds: ["l1"], completedLessonIds: ["l1"] }),
      session("kept", "2026-11-03", { lessonIds: ["l2"] }),
      session("off", "2026-11-04", { status: "cancelled", lessonIds: ["l3"] }),
      session("open", "2026-11-05", { durationMinutes: 40 }),
      session("spare", "2026-11-06"),
    ], "2026-11-01");
    // l3 was planned only in a cancelled class: it is pending again.
    expect(result.assignments.map(item => [item.sessionId, item.lessons.map(l => l.id)])).toEqual([["open", ["l3", "l4"]]]);
    expect(result).toMatchObject({ unplanned: [], keptSessions: 1, freeSessions: 1 });
  });

  it("a lesson longer than its class goes alone and is flagged; a class without duration counts 45 minutes", () => {
    const result = proposeTimetable([lesson("long", 90), lesson("short", 10)], [session("a", "2026-11-03", { durationMinutes: null }), session("b", "2026-11-04")], "2026-11-01");
    expect(result.assignments.map(item => [item.sessionId, item.lessons.map(l => l.id), item.capacity, item.overflow])).toEqual([["a", ["long"], 45, true], ["b", ["short"], 45, false]]);
  });

  it("is deterministic and respects the limit of lessons per class", () => {
    const many = Array.from({ length: 8 }, (_, index) => lesson(`l${index + 1}`, 5));
    const sessions = [session("a", "2026-11-03"), session("b", "2026-11-04")];
    const first = proposeTimetable(many, sessions, "2026-11-01");
    expect(first.assignments.map(item => item.lessons.length)).toEqual([6, 2]);
    expect(proposeTimetable(many, structuredClone(sessions), "2026-11-01")).toEqual(first);
  });
});
