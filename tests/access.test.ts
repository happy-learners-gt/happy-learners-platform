import { describe, expect, it } from "vitest";
import { courseAccess, sectionIndicators, seesSection, teachesSection } from "../packages/domain/src/index";

describe("DEC-023 DEC-024 course access", () => {
  it("leaves people outside the team without access", () => {
    expect(courseAccess(false, null, [])).toBeNull();
  });
  it("lets administration configure and read every section without teaching or editing", () => {
    const access = courseAccess(true, null, [])!;
    expect(access).toMatchObject({ configure: true, edit: false, publish: false, sections: "all" });
    expect(seesSection(access, "group-a")).toBe(true);
    expect(teachesSection(access, "group-a")).toBe(false);
  });
  it("lets the lead edit and publish the course, and see and teach only the sections assigned", () => {
    const access = courseAccess(false, "lead", ["group-a"])!;
    expect(access).toMatchObject({ configure: false, edit: true, publish: true, sections: "assigned" });
    expect([seesSection(access, "group-a"), teachesSection(access, "group-a")]).toEqual([true, true]);
    expect([seesSection(access, "group-b"), teachesSection(access, "group-b")]).toEqual([false, false]);
  });
  it("keeps a co-teacher to editing drafts and teaching the assigned sections", () => {
    const access = courseAccess(false, "co-teacher", ["group-a"])!;
    expect(access).toMatchObject({ configure: false, edit: true, publish: false, sections: "assigned" });
    expect([seesSection(access, "group-a"), teachesSection(access, "group-a")]).toEqual([true, true]);
    expect([seesSection(access, "group-b"), teachesSection(access, "group-b")]).toEqual([false, false]);
  });
  it("adds the course role to an administrator on the team", () => {
    expect(courseAccess(true, "co-teacher", ["group-a"])).toMatchObject({ configure: true, edit: true, publish: false, sections: "all" });
    expect(teachesSection(courseAccess(true, "co-teacher", ["group-a"])!, "group-a")).toBe(true);
    expect(teachesSection(courseAccess(true, "co-teacher", ["group-a"])!, "group-b")).toBe(false);
  });
});

describe("DEC-024 section indicators", () => {
  const today = "2026-10-07";
  const classes = [
    { status: "completed" as const, sessionDate: "2026-10-01", lessonIds: ["l1", "l2"], marked: 10, attended: 9 },
    { status: "completed" as const, sessionDate: "2026-10-02", lessonIds: ["l2", "old"], marked: 10, attended: 7 },
    { status: "planned" as const, sessionDate: "2026-10-05", lessonIds: [], marked: 0, attended: 0 },
    { status: "in_progress" as const, sessionDate: "2026-10-07", lessonIds: ["l3"], marked: 4, attended: 4 },
    { status: "planned" as const, sessionDate: "2026-10-09", lessonIds: ["l4"], marked: 0, attended: 0 },
    { status: "cancelled" as const, sessionDate: "2026-10-03", lessonIds: ["l5"], marked: 0, attended: 0 },
  ];
  it("counts only the section's own classes, attendance and lessons", () => {
    expect(sectionIndicators(classes, ["l1", "l2", "l3", "l4", "l5"], 10, today)).toEqual({
      learners: 10, classes: 5, taught: 2, upcoming: 2, unrecorded: 1, attendanceRate: 83,
      lessonsPublished: 5, lessonsTaught: 2, lessonsPlanned: 4,
    });
  });
  it("has no attendance rate before a class is recorded", () => {
    expect(sectionIndicators([], ["l1"], 0, today)).toMatchObject({ classes: 0, taught: 0, attendanceRate: null, lessonsTaught: 0, lessonsPublished: 1 });
  });
});
