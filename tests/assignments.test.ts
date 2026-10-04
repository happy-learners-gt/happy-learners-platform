import { expect, it } from "vitest";
import { assignmentAvailability, assignmentPeriod, assignmentPeriodError, effectivePublication } from "../packages/domain/src/index";

it("ST-027 only published content can be assigned: an archived or unpublished lesson is unavailable", () => {
  expect(assignmentAvailability({ archived: false, published: true, revision: 2 }, 2)).toBe("current");
  expect(assignmentAvailability({ archived: true, published: true, revision: 2 }, 2)).toBe("unavailable");
  expect(assignmentAvailability({ archived: false, published: false, revision: 0 }, 1)).toBe("unavailable");
});

it("ST-027 a replaced publication is identified and only a missing one requires substitution", () => {
  expect(assignmentAvailability({ archived: false, published: true, revision: 3 }, 2)).toBe("updated");
  expect(assignmentAvailability({ archived: true, published: true, revision: 3 }, 2)).toBe("unavailable");
});

it("ST-027 the assignment has a recipient period: upcoming, active and ended by calendar day", () => {
  expect(assignmentPeriod("2026-10-10", "2026-10-20", "2026-10-05")).toBe("upcoming");
  expect(assignmentPeriod("2026-10-10", "2026-10-20", "2026-10-10")).toBe("active");
  expect(assignmentPeriod("2026-10-10", "2026-10-20", "2026-10-20")).toBe("active");
  expect(assignmentPeriod("2026-10-10", "2026-10-20", "2026-10-21")).toBe("ended");
  expect(assignmentPeriod("2026-10-10", null, "2027-01-01")).toBe("active");
});

it("ST-027 validates the period of an assignment", () => {
  expect(assignmentPeriodError("2026-10-10", "")).toBeNull();
  expect(assignmentPeriodError("2026-10-10", "2026-10-10")).toBeNull();
  expect(assignmentPeriodError("", null)).toMatch(/desde qué fecha/);
  expect(assignmentPeriodError("2026-02-30", null)).toMatch(/desde qué fecha/);
  expect(assignmentPeriodError("2026-10-10", "2026-10-09")).toMatch(/posterior/);
});

it("ST-029 resolves the current non-archived publication and never a draft", () => {
  expect(effectivePublication({ archived: false, published: true, revision: 3, shareCode: "D-ABC" })).toEqual({ revision: 3, shareCode: "D-ABC" });
  expect(effectivePublication({ archived: true, published: true, revision: 3, shareCode: "D-ABC" })).toBeNull();
  expect(effectivePublication({ archived: false, published: false, revision: 0, shareCode: "D-ABC" })).toBeNull();
  expect(effectivePublication({ archived: false, published: true, revision: 2, shareCode: null })).toBeNull();
});
