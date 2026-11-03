import { expect, it } from "vitest";
import { timetableConflicts } from "@happy-learners/domain";

const section = (id: string, educatorIds: string[], classroomId: string | null, meetings: [number, string, number][]) =>
  ({ id, name: id, educatorIds, classroomId, meetings: meetings.map(([weekday, startsAt, durationMinutes]) => ({ weekday, startsAt, durationMinutes })) });

it("SCH-01 finds an educator or a classroom in two overlapping classes, and nothing when they only touch", () => {
  const sections = [
    section("a", ["ana"], "aula-1", [[1, "08:00", 45], [3, "08:00", 45]]),
    section("b", ["ana", "beto"], "aula-2", [[1, "08:30", 45]]),
    section("c", ["carla"], "aula-1", [[3, "08:15", 30]]),
    section("d", ["ana"], "aula-1", [[1, "08:45", 45]]),
  ];
  expect(timetableConflicts(sections)).toEqual([
    { kind: "educator", resourceId: "ana", weekday: 1, startsAt: "08:30", sectionIds: ["a", "b"] },
    { kind: "educator", resourceId: "ana", weekday: 1, startsAt: "08:45", sectionIds: ["b", "d"] },
    { kind: "classroom", resourceId: "aula-1", weekday: 3, startsAt: "08:15", sectionIds: ["a", "c"] },
  ]);
  // a (08:00–08:45) and d (08:45–09:30) only touch: same educator and room, no conflict.
  expect(timetableConflicts([sections[0], sections[3]])).toEqual([]);
});
