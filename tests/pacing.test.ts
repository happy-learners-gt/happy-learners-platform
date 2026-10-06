import { expect, it } from "vitest";
import { effectiveProfile, nextInPath, pacings, pathIndicators } from "../packages/domain/src/index";

it("ST-110: a self-paced section counts who began, who finished and the average share of published lessons completed", () => {
  const lessons = ["l1", "l2", "l3", "l4"];
  const completed = new Map([["ana", new Set(["l1", "l2", "l3", "l4"])], ["beto", new Set(["l1", "archived"])]]);
  expect(pathIndicators(lessons, completed, new Set(["ana", "beto", "former"]), ["ana", "beto", "carla"])).toEqual({ started: 2, finished: 1, pathAverage: 42 });
  expect(pathIndicators([], completed, new Set(["ana"]), ["ana"])).toEqual({ started: 1, finished: 0, pathAverage: null });
  expect(pathIndicators(lessons, new Map(), new Set(), [])).toEqual({ started: 0, finished: 0, pathAverage: null });
});

it("ST-110: the student continues with the first published lesson they have not completed, in content order", () => {
  expect(nextInPath(["l1", "l2", "l3"], new Set(["l1", "l3"]))).toBe("l2");
  expect(nextInPath(["l1", "l2"], new Set(["l1", "l2"]))).toBeNull();
  expect(nextInPath([], new Set())).toBeNull();
});

it("ST-110: a course in a program follows the program's pacing, and each pacing says what it changes", () => {
  const course = { educationType: "formal", level: "primary", modality: "in-person", pacing: "self-paced", format: "subject" } as const;
  const program = { educationType: "formal", level: "primary", modality: "in-person", pacing: "scheduled" } as Parameters<typeof effectiveProfile>[1];
  expect(effectiveProfile(course, null).pacing).toBe("self-paced");
  expect(effectiveProfile(course, program).pacing).toBe("scheduled");
  expect(pacings.find(item => item.value === "self-paced")!.hint).toContain("Sin horario ni clases");
});
