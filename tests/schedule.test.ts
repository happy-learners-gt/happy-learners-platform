import { expect, it } from "vitest";
import { breakInput, cancelPlanInput, carryOver, classPlanInput, classSequence, completionInput, lessonsInOrder, periodWeek, scheduleDates, scheduleInput, scheduleSummary, sectionIndicators } from "../packages/domain/src/index";

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

it("ST-097 assigns the next lessons in content order to classes without lessons, skipping lessons already given", () => {
  const classes = [{ id: "a", lessonIds: ["l1"] }, { id: "b", lessonIds: [] }, { id: "c", lessonIds: [] }, { id: "d", lessonIds: [] }];
  expect(lessonsInOrder(classes, ["l1", "l2", "l3"], ["l1"])).toEqual([{ sessionId: "b", lessonIds: ["l2"] }, { sessionId: "c", lessonIds: ["l3"] }]);
  expect(lessonsInOrder(classes, ["l1"], ["l1"])).toEqual([]);
});

it("ST-101 a long class can cover several lessons in order, up to three when assigned in order", () => {
  const classes = [{ id: "b", lessonIds: [] }, { id: "c", lessonIds: [] }, { id: "d", lessonIds: [] }];
  expect(lessonsInOrder(classes, ["l1", "l2", "l3", "l4", "l5"], [], 2)).toEqual([{ sessionId: "b", lessonIds: ["l1", "l2"] }, { sessionId: "c", lessonIds: ["l3", "l4"] }, { sessionId: "d", lessonIds: ["l5"] }]);
  expect(lessonsInOrder(classes, ["l1", "l2", "l3", "l4"], [], 9)).toEqual([{ sessionId: "b", lessonIds: ["l1", "l2", "l3"] }, { sessionId: "c", lessonIds: ["l4"] }]);
});

it("ST-101 a class plan has its lessons in order and comments; date and time come from the schedule", () => {
  const plan = classPlanInput({ sessionDate: "2026-10-12", lessonIds: ["lesson-2", "lesson-1"], notes: "Traer cartulinas", resourceIds: ["resource-1"] });
  expect(plan).toEqual({ sessionDate: "2026-10-12", startsAt: null, durationMinutes: null, lessonIds: ["lesson-2", "lesson-1"], notes: "Traer cartulinas" });
  expect(classPlanInput({ sessionDate: "2026-10-12", lessonIds: [] })).toHaveProperty("lessonIds", []);
});

it("ST-101 places each class in the schedule: week of the period and number among the classes held", () => {
  expect(periodWeek("2026-10-05", "2026-10-05")).toBe(1);
  expect(periodWeek("2026-10-11", "2026-10-05")).toBe(1);
  expect(periodWeek("2026-10-12", "2026-10-07")).toBe(2);
  const classes = [
    { id: "c", sessionDate: "2026-10-14", status: "planned" },
    { id: "a", sessionDate: "2026-10-05", status: "completed" },
    { id: "b", sessionDate: "2026-10-07", status: "cancelled" },
    { id: "x", sessionDate: "2026-10-12", startsAt: "08:00", status: "planned" },
  ];
  expect([...classSequence(classes, "2026-10-01")]).toEqual([["a", { week: 2, number: 1 }], ["b", { week: 2, number: null }], ["x", { week: 3, number: 2 }], ["c", { week: 3, number: 3 }]]);
  expect(classSequence(classes).get("a")).toEqual({ week: 1, number: 1 });
});

it("ST-108 days without class are one day or a range, with a reason", () => {
  expect(breakInput({ title: "  Día de la  Revolución ", from: "2026-10-20" })).toEqual({ title: "Día de la Revolución", from: "2026-10-20", until: "2026-10-20" });
  expect(breakInput({ title: "Vacaciones", from: "2026-10-26", until: "2026-10-30" })).toEqual({ title: "Vacaciones", from: "2026-10-26", until: "2026-10-30" });
  expect(breakInput({ title: "", from: "2026-10-20" })).toHaveProperty("error");
  expect(breakInput({ title: "Asueto", from: "2026-10-21", until: "2026-10-20" })).toHaveProperty("error", "La fecha final debe ser igual o posterior a la inicial.");
  expect(breakInput({ title: "Asueto", from: "2026-02-30" })).toHaveProperty("error");
});

it("ST-108 the schedule skips holidays and whole weeks without class", () => {
  const breaks = [{ title: "Feriado", from: "2026-10-07", until: "2026-10-07" }, { title: "Semana sin clases", from: "2026-10-12", until: "2026-10-16" }];
  expect(scheduleDates({ weekdays: [1, 3], from: "2026-10-05", until: "2026-10-21" }, "2026-10-01", breaks)).toEqual(["2026-10-05", "2026-10-19", "2026-10-21"]);
});

it("ST-108 cancelling a class skips its plan unless it is asked to move it", () => {
  expect(cancelPlanInput(undefined)).toBe("skip");
  expect(cancelPlanInput({ plan: "shift" })).toBe("shift");
  expect(cancelPlanInput({ plan: "other" })).toBe("skip");
});

it("ST-109 finishing a class confirms each lesson; what is left out counts as completed", () => {
  const done = completionInput({ lessons: [{ id: "l2", outcome: "partial" }] }, ["l1", "l2"]);
  expect("outcomes" in done && [...done.outcomes]).toEqual([["l1", "completed"], ["l2", "partial"]]);
  expect("outcomes" in done && done.carryOver).toBe(true);
  expect(completionInput({ lessons: [{ id: "l9", outcome: "completed" }] }, ["l1"])).toHaveProperty("error");
  expect(completionInput({ lessons: [{ id: "l1", outcome: "done" }] }, ["l1"])).toHaveProperty("error");
  expect(completionInput({ lessons: [{ id: "l1", outcome: "toString" }] }, ["l1"])).toHaveProperty("error");
  expect(completionInput({ carryOver: false }, ["l1"])).toMatchObject({ carryOver: false });
});

it("ST-109 what was not completed opens the next class, without repeating lessons planned later", () => {
  expect(carryOver(["l3"], ["l2"], [], 6)).toEqual({ lessons: ["l2", "l3"], left: [] });
  expect(carryOver(["l3"], ["l2", "l4"], ["l4"], 6)).toEqual({ lessons: ["l2", "l3"], left: [] });
  expect(carryOver(["l3", "l2"], ["l2"], [], 6)).toEqual({ lessons: ["l3", "l2"], left: [] });
  expect(carryOver(["a", "b"], ["c"], [], 2)).toEqual({ lessons: ["c", "a"], left: ["b"] });
});

it("ST-109 a section counts as taught only the lessons its finished classes completed", () => {
  const classes = [{ status: "completed" as const, sessionDate: "2026-10-05", lessonIds: ["l1", "l2"], completedIds: ["l1"], marked: 0, attended: 0 }];
  expect(sectionIndicators(classes, ["l1", "l2"], 10, "2026-10-06")).toMatchObject({ lessonsTaught: 1, lessonsPlanned: 2 });
});
