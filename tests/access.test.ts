import { describe, expect, it } from "vitest";
import { courseAccess, seesSection, teachesSection } from "../packages/domain/src/index";

describe("DEC-023 course access", () => {
  it("leaves people outside the team without access", () => {
    expect(courseAccess(false, null, [])).toBeNull();
  });
  it("lets administration configure and read every section without teaching or editing", () => {
    const access = courseAccess(true, null, [])!;
    expect(access).toMatchObject({ configure: true, edit: false, publish: false, teach: null, sections: "all" });
    expect(seesSection(access, "group-a")).toBe(true);
    expect(teachesSection(access, "group-a")).toBe(false);
  });
  it("lets the lead edit, publish and teach every section, without configuring the course", () => {
    const access = courseAccess(false, "lead", [])!;
    expect(access).toMatchObject({ configure: false, edit: true, publish: true, teach: "all", sections: "all" });
    expect(teachesSection(access, "group-b")).toBe(true);
  });
  it("keeps a co-teacher to editing drafts and teaching the assigned sections", () => {
    const access = courseAccess(false, "co-teacher", ["group-a"])!;
    expect(access).toMatchObject({ configure: false, edit: true, publish: false, teach: "assigned", sections: "assigned" });
    expect([seesSection(access, "group-a"), teachesSection(access, "group-a")]).toEqual([true, true]);
    expect([seesSection(access, "group-b"), teachesSection(access, "group-b")]).toEqual([false, false]);
  });
  it("adds the course role to an administrator on the team", () => {
    expect(courseAccess(true, "co-teacher", ["group-a"])).toMatchObject({ configure: true, edit: true, publish: false, teach: "assigned", sections: "all" });
    expect(teachesSection(courseAccess(true, "co-teacher", ["group-a"])!, "group-b")).toBe(false);
  });
});
