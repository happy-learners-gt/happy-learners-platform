import { describe, expect, it } from "vitest";
import { acceptsAttendance, classPlanInput, fictional, groupCodePattern, localDay, newGroupCode, nextClassStatus, normalizeGroupCode, scopeOfSection, scopeOfShare, scopeOfToken, tokenPattern, tokenPrefix, upcomingClasses } from "@happy-learners/domain";

describe("class lifecycle (HL-61 ST-035, ST-097)", () => {
  it("moves planned → in progress → completed and allows cancelling only before starting", () => {
    expect(nextClassStatus("planned", "start")).toBe("in_progress");
    expect(nextClassStatus("in_progress", "complete")).toBe("completed");
    expect(nextClassStatus("planned", "complete")).toBe("completed");
    expect(nextClassStatus("planned", "cancel")).toBe("cancelled");
    expect(nextClassStatus("cancelled", "restore")).toBe("planned");
    expect(nextClassStatus("in_progress", "cancel")).toBeNull();
    expect(nextClassStatus("completed", "start")).toBeNull();
    expect(nextClassStatus("completed", "cancel")).toBeNull();
  });
  it("takes attendance in every state except cancelled", () => {
    expect(["planned", "in_progress", "completed"].every(status => acceptsAttendance(status as never))).toBe(true);
    expect(acceptsAttendance("cancelled")).toBe(false);
  });
});

describe("class plan input", () => {
  it("normalizes a complete plan", () => {
    expect(classPlanInput({ sessionDate: "2026-10-12", startsAt: "08:00", durationMinutes: "45", lessonIds: ["lesson-1", "lesson-2"], notes: "  Repasar  " }))
      .toEqual({ sessionDate: "2026-10-12", startsAt: "08:00", durationMinutes: 45, lessonIds: ["lesson-1", "lesson-2"], notes: "Repasar" });
  });
  it("accepts a plan with only a date", () => {
    expect(classPlanInput({ sessionDate: "2026-10-12" })).toEqual({ sessionDate: "2026-10-12", startsAt: null, durationMinutes: null, lessonIds: [], notes: "" });
  });
  it.each([
    [{ sessionDate: "12/10/2026" }, "fecha"],
    [{ sessionDate: "2026-10-12", startsAt: "25:00" }, "hora"],
    [{ sessionDate: "2026-10-12", durationMinutes: 600 }, "duración"],
    [{ sessionDate: "2026-10-12", notes: "x".repeat(2001) }, "comentarios"],
    [{ sessionDate: "2026-10-12", lessonIds: "lesson-1" }, "lecciones"],
    [{ sessionDate: "2026-10-12", lessonIds: ["lesson-1", "lesson-1"] }, "una sola vez"],
    [{ sessionDate: "2026-10-12", lessonIds: ["l-1", "l-2", "l-3", "l-4", "l-5", "l-6", "l-7"] }, "hasta 6"],
  ])("rejects %j", (input, word) => {
    const result = classPlanInput(input);
    expect("error" in result && result.error.toLowerCase()).toContain(word);
  });
});

describe("group codes (ST-098)", () => {
  it("creates readable codes scoped to the organization", () => {
    const random = (size: number) => crypto.getRandomValues(new Uint8Array(size));
    const code = newGroupCode("org-demo", size => new Uint8Array(size));
    expect(code).toMatch(/^DG-[A-Z0-9]{4}-[A-Z0-9]{4}$/);
    expect(newGroupCode("org-other", random)).toMatch(/^OG-/);
    expect(newGroupCode("org-hl", random)).toMatch(/^HG-/);
    expect(groupCodePattern.test(newGroupCode("org-hl", random))).toBe(true);
    expect(groupCodePattern.test(code)).toBe(true);
    for (let index = 0; index < 50; index++) expect(newGroupCode("org-demo", random).slice(3)).not.toMatch(/[ILO01]/);
  });
  it("normalizes what learners type", () => {
    expect(normalizeGroupCode(" dg-mate-3a ")).toBe("DG-MATE-3A");
    expect(groupCodePattern.test(normalizeGroupCode("dg-mate-3a"))).toBe(true);
    expect(groupCodePattern.test("GREETINGS")).toBe(false);
    expect(groupCodePattern.test("XG-MATE-3A")).toBe(false);
  });
  it("routes tokens, share codes and section codes to the organization that issued them (DEC-032)", () => {
    const token = `${tokenPrefix("org-hl")}${"a".repeat(64)}`;
    expect(tokenPattern.test(token)).toBe(true);
    expect(tokenPattern.test(`x_${"a".repeat(64)}`)).toBe(false);
    expect([scopeOfToken(token), scopeOfToken(`o_${"a".repeat(64)}`), scopeOfToken(`x_${"a".repeat(64)}`), scopeOfToken(null)]).toEqual(["org-hl", "org-other", "org-demo", "org-demo"]);
    expect([scopeOfShare("H-ABCD"), scopeOfShare("O-ABCD"), scopeOfShare("Z-ABCD"), scopeOfShare("colores")]).toEqual(["org-hl", "org-other", "org-demo", "org-demo"]);
    expect([scopeOfSection("HG-MATE-3A"), scopeOfSection("OG-AB12-CD34"), scopeOfSection("DG-MATE-3A")]).toEqual(["org-hl", "org-other", "org-demo"]);
    expect([fictional("org-demo"), fictional("org-other"), fictional("org-hl")]).toEqual([true, true, false]);
  });
});

describe("upcoming classes", () => {
  const classes = [
    { id: "past", sessionDate: "2026-10-01", startsAt: "08:00", status: "planned" as const },
    { id: "late", sessionDate: "2026-10-05", startsAt: "10:00", status: "planned" as const },
    { id: "early", sessionDate: "2026-10-05", startsAt: "08:00", status: "planned" as const },
    { id: "done", sessionDate: "2026-10-06", startsAt: null, status: "completed" as const },
    { id: "off", sessionDate: "2026-10-07", startsAt: null, status: "cancelled" as const },
    { id: "next", sessionDate: "2026-10-08", startsAt: null, status: "planned" as const },
  ];
  it("keeps future planned or running classes in date and time order", () => {
    expect(upcomingClasses(classes, "2026-10-05").map(item => item.id)).toEqual(["early", "late", "next"]);
  });
  it("uses the organization's calendar day", () => {
    expect(localDay("America/Guatemala", new Date("2026-10-05T03:00:00Z"))).toBe("2026-10-04");
    expect(localDay("UTC", new Date("2026-10-05T03:00:00Z"))).toBe("2026-10-05");
  });
});
