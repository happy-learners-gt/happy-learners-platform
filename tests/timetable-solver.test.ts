import { describe, expect, it } from "vitest";
import { fixtureRulesTranslator, ruleText, solveTimetable, solverRule } from "../packages/domain/src/index";
import type { SolverDay, SolverInput, SolverMeeting } from "../packages/domain/src/index";

// 1.4.3 (docs/design/asistente-ia.md §6d): hard rules are never broken; the answer is the same every time.
const blocks = [
  { key: "p1", kind: "class" as const, startsAt: "07:00", endsAt: "07:45" }, { key: "p2", kind: "class" as const, startsAt: "07:45", endsAt: "08:30" },
  { key: "r2", kind: "break" as const, startsAt: "08:30", endsAt: "09:00" }, { key: "p3", kind: "class" as const, startsAt: "09:00", endsAt: "09:45" },
];
const week: SolverDay[] = [1, 2, 3, 4, 5].map(weekday => ({ weekday, blocks }));
const minutes = (clock: string) => Number(clock.slice(0, 2)) * 60 + Number(clock.slice(3));
const clash = (a: SolverMeeting, b: SolverMeeting) => a.weekday === b.weekday && minutes(a.startsAt) < minutes(b.startsAt) + b.durationMinutes && minutes(b.startsAt) < minutes(a.startsAt) + a.durationMinutes;
const base: SolverInput = {
  days: week,
  educators: [{ id: "ana", name: "Ana", availability: [] }, { id: "beto", name: "Beto", availability: [] }],
  sections: [
    { id: "mat-a", name: "Matemáticas 3.º A", educatorIds: ["ana"], meetingsPerWeek: 3, blocksPerMeeting: 1 },
    { id: "len-a", name: "Lenguaje 3.º A", educatorIds: ["beto"], meetingsPerWeek: 3, blocksPerMeeting: 1 },
    { id: "mat-b", name: "Matemáticas 3.º B", educatorIds: ["ana"], meetingsPerWeek: 3, blocksPerMeeting: 1 },
  ],
  rules: [{ kind: "shared-students", sectionIds: ["mat-a", "len-a"] }],
};

describe("1.4.3 timetable solver", () => {
  it("places every meeting without clashes of educators or shared students, one per day per section, deterministically", () => {
    const result = solveTimetable(base);
    expect(result.status).toBe("solved");
    const meetings = result.meetings;
    expect(meetings).toHaveLength(9);
    for (const section of base.sections) expect(new Set(meetings.filter(item => item.sectionId === section.id).map(item => item.weekday)).size).toBe(3);
    const pairs = meetings.flatMap((a, i) => meetings.slice(i + 1).map(b => [a, b] as const));
    const educatorOf = (id: string) => base.sections.find(section => section.id === id)!.educatorIds[0];
    expect(pairs.filter(([a, b]) => educatorOf(a.sectionId) === educatorOf(b.sectionId) && clash(a, b))).toEqual([]);
    expect(pairs.filter(([a, b]) => [a.sectionId, b.sectionId].sort().join() === "len-a,mat-a" && clash(a, b))).toEqual([]);
    // Days spread over the week: a section's meetings are not on consecutive days when it can avoid it.
    expect(meetings.filter(item => item.sectionId === "mat-a").map(item => item.weekday)).toEqual([1, 3, 5]);
    expect(solveTimetable(structuredClone(base))).toEqual(result);
  });

  it("follows preferred days when it can, and never breaks availability, declared absences or the daily load", () => {
    // Ana gives at most 45 minutes a day, five days: 3 + 2 meetings fit, 3 + 3 would not.
    const result = solveTimetable({
      ...base,
      sections: base.sections.map(section => section.id === "mat-b" ? { ...section, meetingsPerWeek: 2 } : section),
      educators: [{ id: "ana", name: "Ana", availability: [1, 2, 3, 4, 5].map(day => ({ day: day as 1, start: "07:00", end: "08:30" })) }, base.educators[1]],
      rules: [...base.rules, { kind: "preferred-days", sectionId: "len-a", weekdays: [2, 4] }, { kind: "unavailable", educatorId: "beto", weekday: 5, from: "07:00", to: "12:00" }, { kind: "max-daily", educatorId: "ana", minutes: 45 }],
    });
    expect(result.status).toBe("solved");
    const meetings = result.meetings;
    expect(meetings.filter(item => item.sectionId === "len-a").map(item => item.weekday)).toEqual(expect.arrayContaining([2, 4]));
    expect(meetings.filter(item => item.sectionId === "len-a" && item.weekday === 5)).toEqual([]);
    // Ana: only before 08:30 and at most 45 minutes a day, so her two sections never meet the same day.
    const ana = meetings.filter(item => item.sectionId !== "len-a");
    expect(ana.every(item => minutes(item.startsAt) + item.durationMinutes <= minutes("08:30"))).toBe(true);
    expect(new Set(ana.map(item => item.weekday)).size).toBe(ana.length);
    if (result.status === "solved") expect(result.preferredMissed).toBe(1);
  });

  it("joins consecutive periods without crossing a break and respects meetings already fixed", () => {
    const result = solveTimetable({
      ...base,
      sections: [{ id: "lab", name: "Laboratorio", educatorIds: ["ana"], meetingsPerWeek: 2, blocksPerMeeting: 2 }],
      rules: [],
      fixed: [{ sectionId: "otra", educatorIds: ["ana"], weekday: 1, startsAt: "07:00", durationMinutes: 45 }],
    });
    expect(result.meetings).toEqual([{ sectionId: "lab", weekday: 2, startsAt: "07:00", durationMinutes: 90 }, { sectionId: "lab", weekday: 4, startsAt: "07:00", durationMinutes: 90 }]);
  });

  it("explains what makes a section impossible instead of breaking a rule", () => {
    const result = solveTimetable({
      days: week,
      educators: [{ id: "ana", name: "Ana", availability: [{ day: 1, start: "07:00", end: "07:45" }] }],
      sections: [{ id: "mat-a", name: "Matemáticas 3.º A", educatorIds: ["ana"], meetingsPerWeek: 2, blocksPerMeeting: 1 }],
      rules: [],
    });
    expect(result.status).toBe("impossible");
    if (result.status !== "impossible") return;
    expect(result.meetings).toEqual([{ sectionId: "mat-a", weekday: 1, startsAt: "07:00", durationMinutes: 45 }]);
    expect(result.unplaced).toEqual([{ sectionId: "mat-a", name: "Matemáticas 3.º A", placed: 1, needed: 2, reasons: [
      { reason: "Fuera de la disponibilidad de Ana", slots: 12 }, { reason: "Matemáticas 3.º A ya tiene clase ese día", slots: 3 },
    ] }]);
    const noRun = solveTimetable({ ...base, sections: [{ id: "x", name: "Taller", educatorIds: ["beto"], meetingsPerWeek: 1, blocksPerMeeting: 3 }], rules: [] });
    expect(noRun.status === "impossible" && noRun.unplaced[0].reasons).toEqual([{ reason: "La jornada no tiene 3 periodos seguidos sin recreo", slots: 1 }]);
  });
});

describe("1.4.3 timetable solver at a school's size", () => {
  it("solves 30 sections of 10 educators, with groups of shared students, well within its step limit", () => {
    const periods = Array.from({ length: 6 }, (_, index) => ({ key: `p${index + 1}`, kind: "class" as const, startsAt: `${String(7 + index).padStart(2, "0")}:00`, endsAt: `${String(7 + index).padStart(2, "0")}:45` }));
    const sections = Array.from({ length: 30 }, (_, index) => ({ id: `s${index}`, name: `Sección ${index}`, educatorIds: [`e${index % 10}`], meetingsPerWeek: 3, blocksPerMeeting: 1 }));
    // Five groups of students take six courses each.
    const rules = Array.from({ length: 5 }, (_, group) => ({ kind: "shared-students" as const, sectionIds: sections.filter((_, index) => index % 5 === group).map(section => section.id) }));
    const started = Date.now();
    const result = solveTimetable({ days: [1, 2, 3, 4, 5].map(weekday => ({ weekday, blocks: periods })), sections, rules, educators: Array.from({ length: 10 }, (_, index) => ({ id: `e${index}`, name: `Docente ${index}`, availability: [] })) });
    expect(result.status).toBe("solved");
    expect(result.meetings).toHaveLength(90);
    expect(result.steps).toBeLessThan(1000);
    expect(Date.now() - started).toBeLessThan(5000);
  });
});

describe("1.4.3 timetable rules", () => {
  const context = { sections: [{ id: "mat-a", name: "Matemáticas 3.º A" }, { id: "len-a", name: "Lenguaje 3.º A" }], educators: [{ id: "ana", name: "Ana Pérez" }, { id: "beto", name: "Beto Ruiz" }] };
  it("keeps only rules that name what exists, and says each one in words", () => {
    expect(solverRule({ kind: "unavailable", educatorId: "ana", weekday: 5 }, context)).toEqual({ kind: "unavailable", educatorId: "ana", weekday: 5, from: "00:00", to: "23:59" });
    expect(solverRule({ kind: "unavailable", educatorId: "nadie", weekday: 5 }, context)).toBeNull();
    expect(solverRule({ kind: "max-daily", educatorId: "beto", minutes: 10 }, context)).toBeNull();
    expect(solverRule({ kind: "shared-students", sectionIds: ["mat-a", "otra"] }, context)).toBeNull();
    expect(solverRule({ kind: "preferred-days", sectionId: "len-a", weekdays: [4, 2, 2, 9] }, context)).toEqual({ kind: "preferred-days", sectionId: "len-a", weekdays: [2, 4] });
    expect(ruleText({ kind: "unavailable", educatorId: "ana", weekday: 5, from: "00:00", to: "23:59" }, context)).toBe("Ana Pérez no da clases el viernes");
    expect(ruleText({ kind: "shared-students", sectionIds: ["mat-a", "len-a"] }, context)).toBe("Matemáticas 3.º A, Lenguaje 3.º A comparten estudiantes: no coinciden en horario");
  });
  it("the local translator understands common phrasings, one rule per sentence", async () => {
    const { rules } = await fixtureRulesTranslator.translate({ text: "Ana Pérez no da clases el viernes. Matemáticas 3.º A y Lenguaje 3.º A comparten estudiantes; Beto Ruiz da como máximo 90 minutos al día. Lenguaje 3.º A prefiere martes y jueves", context });
    expect(rules.map(rule => solverRule(rule, context))).toEqual([
      { kind: "unavailable", educatorId: "ana", weekday: 5, from: "00:00", to: "23:59" },
      { kind: "shared-students", sectionIds: ["mat-a", "len-a"] },
      { kind: "max-daily", educatorId: "beto", minutes: 90 },
      { kind: "preferred-days", sectionId: "len-a", weekdays: [2, 4] },
    ]);
  });
});

describe("1.4.3 timetable solver with one impossible section", () => {
  it("still places every other section and names only the impossible one", () => {
    const result = solveTimetable({
      days: week,
      educators: [{ id: "ana", name: "Ana", availability: [{ day: 1, start: "07:00", end: "07:45" }] }, { id: "beto", name: "Beto", availability: [{ day: 2, start: "07:00", end: "07:45" }] }, { id: "cris", name: "Cris", availability: [] }],
      sections: [
        { id: "taller", name: "Taller", educatorIds: ["ana", "beto"], meetingsPerWeek: 1, blocksPerMeeting: 1 },
        { id: "mat", name: "Matemáticas", educatorIds: ["cris"], meetingsPerWeek: 3, blocksPerMeeting: 1 },
      ],
      rules: [],
    });
    expect(result.status).toBe("impossible");
    if (result.status !== "impossible") return;
    expect(result.meetings.filter(item => item.sectionId === "mat")).toHaveLength(3);
    expect(result.unplaced.map(item => [item.sectionId, item.placed, item.needed])).toEqual([["taller", 0, 1]]);
  });
});
