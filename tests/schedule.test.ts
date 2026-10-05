import { expect, it } from "vitest";
import { classPlanInput, lessonsInOrder, scheduleDates, scheduleInput, scheduleSummary } from "../packages/domain/src/index";

const valid = { weekdays: [3, 1], startsAt: "08:00", durationMinutes: 45, from: "2026-10-05", until: "2026-10-16" };

it("ST-099 validates a section schedule and says what to fix", () => {
  expect(scheduleInput(valid)).toEqual({ ...valid, weekdays: [1, 3] });
  expect(scheduleInput({ ...valid, weekdays: [] })).toEqual({ error: "Elige al menos un día de la semana." });
  expect(scheduleInput({ ...valid, weekdays: [1, 1] })).toHaveProperty("error");
  expect(scheduleInput({ ...valid, weekdays: [7] })).toHaveProperty("error");
  expect(scheduleInput({ ...valid, startsAt: "24:00" })).toHaveProperty("error", "Escribe la hora de inicio con el formato HH:MM.");
  expect(scheduleInput({ ...valid, durationMinutes: 4 })).toHaveProperty("error");
  expect(scheduleInput({ ...valid, from: "2026-02-30" })).toHaveProperty("error");
  expect(scheduleInput({ ...valid, until: "2026-10-04" })).toHaveProperty("error", "La fecha de fin debe ser igual o posterior a la de inicio.");
  expect(scheduleInput({ ...valid, until: "2027-10-06" })).toHaveProperty("error", "El periodo puede durar hasta un año.");
});

it("ST-099 generates the class days of the period from today on, never in the past", () => {
  expect(scheduleDates({ weekdays: [1, 3], from: "2026-10-05", until: "2026-10-16" }, "2026-10-01")).toEqual(["2026-10-05", "2026-10-07", "2026-10-12", "2026-10-14"]);
  expect(scheduleDates({ weekdays: [1, 3], from: "2026-10-05", until: "2026-10-16" }, "2026-10-08")).toEqual(["2026-10-12", "2026-10-14"]);
  expect(scheduleDates({ weekdays: [0], from: "2026-10-05", until: "2026-10-16" }, "2026-10-17")).toEqual([]);
  expect(scheduleDates({ weekdays: [0, 1, 2, 3, 4, 5, 6], from: "2026-01-01", until: "2026-12-31" }, "2026-01-01")).toHaveLength(365);
});

it("ST-099 summarizes a schedule the way a timetable reads", () => {
  expect(scheduleSummary({ weekdays: [1, 3], startsAt: "08:00", durationMinutes: 45 })).toBe("lun y mié, 08:00 · 45 min");
  expect(scheduleSummary({ weekdays: [0, 1, 5], startsAt: "09:30", durationMinutes: 40 })).toBe("lun, vie y dom, 09:30 · 40 min");
});

it("ST-097 assigns the next lessons in content order to classes without one, skipping lessons already given", () => {
  const classes = [{ id: "a", lessonId: "l1" }, { id: "b" }, { id: "c", lessonId: null }, { id: "d" }];
  expect(lessonsInOrder(classes, ["l1", "l2", "l3"], ["l1"])).toEqual([{ sessionId: "b", lessonId: "l2" }, { sessionId: "c", lessonId: "l3" }]);
  expect(lessonsInOrder(classes, ["l1"], ["l1"])).toEqual([]);
});

it("ST-097 a class plan has a lesson and notes; resources come from the lesson", () => {
  const plan = classPlanInput({ sessionDate: "2026-10-12", startsAt: "08:00", durationMinutes: 45, lessonId: "lesson-1", notes: "Traer cartulinas", resourceIds: ["resource-1"] });
  expect(plan).toEqual({ sessionDate: "2026-10-12", startsAt: "08:00", durationMinutes: 45, lessonId: "lesson-1", notes: "Traer cartulinas" });
});
