import { describe, expect, it } from "vitest";
import type { DateRule } from "../packages/contracts/src/index";
import { easterSunday, guatemalaTemplate, nextYearRules, occurrences, ruleInput, ruleSummary } from "../packages/domain/src/index";

const fixed = (patch: Partial<DateRule> = {}): DateRule => ({
  id: "independence",
  title: "Independencia",
  anchor: { kind: "fixed", month: 9, day: 15 },
  ...patch,
});

describe("calendar date rules", () => {
  it("calculates Gregorian Easter and dates relative to it", () => {
    expect([2024, 2025, 2026, 2027, 2038, 2285].map(easterSunday)).toEqual([
      "2024-03-31", "2025-04-20", "2026-04-05", "2027-03-28", "2038-04-25", "2285-03-22",
    ]);
    expect(occurrences([{ id: "good-friday", title: "Viernes Santo", anchor: { kind: "easter", offset: -2 } }], 2026)[0].from).toBe("2026-04-03");
    expect(() => easterSunday(1582)).toThrow("1583");
  });

  it("finds numbered and last weekdays, and omits a fifth weekday that does not exist", () => {
    const rules: DateRule[] = [
      { id: "second-thursday", title: "Segundo jueves", anchor: { kind: "nth-weekday", month: 11, weekday: 4, n: 2 } },
      { id: "last-friday", title: "Último viernes", anchor: { kind: "nth-weekday", month: 5, weekday: 5, n: -1 } },
      { id: "fifth-monday", title: "Quinto lunes", anchor: { kind: "nth-weekday", month: 2, weekday: 1, n: 5 } },
    ];
    expect(occurrences(rules, 2026).map(item => [item.ruleId, item.from])).toEqual([
      ["last-friday", "2026-05-29"], ["second-thursday", "2026-11-12"],
    ]);
    expect(occurrences([rules[2]], 2027)).toEqual([]);
  });

  it("resolves relative rules and reports dependency cycles", () => {
    const easter: DateRule = { id: "easter", title: "Pascua", anchor: { kind: "easter", offset: 0 } };
    const monday: DateRule = { id: "monday", title: "Lunes siguiente", anchor: { kind: "relative", to: "easter", offset: 1, weekday: 1 } };
    expect(occurrences([monday, easter], 2026).find(item => item.ruleId === "monday")?.from).toBe("2026-04-06");
    const cycle: DateRule[] = [
      { id: "a", title: "A", anchor: { kind: "relative", to: "b", offset: 0 } },
      { id: "b", title: "B", anchor: { kind: "relative", to: "a", offset: 0 } },
    ];
    expect(() => occurrences(cycle, 2026)).toThrow("ciclo");
  });

  it("shifts dates in either direction and breaks nearest ties forward", () => {
    const monday = occurrences([fixed({ shift: { when: [6, 0], to: "next", onto: [1] } })], 2029)[0];
    expect(monday).toMatchObject({ from: "2029-09-17", until: "2029-09-17", shiftedFrom: "2029-09-15" });
    const friday = occurrences([fixed({
      id: "nearest",
      anchor: { kind: "fixed", month: 9, day: 19 },
      shift: { when: [3], to: "nearest", onto: [1, 5] },
    })], 2029)[0];
    expect(friday).toMatchObject({ from: "2029-09-21", shiftedFrom: "2029-09-19" });
  });

  it("applies validity, excluded years and one-year rules, and copies only reusable rules", () => {
    const rules: DateRule[] = [
      fixed({ id: "valid", fromYear: 2026, untilYear: 2027 }),
      fixed({ id: "except", exceptYears: [2026] }),
      fixed({ id: "once-in-year", onlyYear: 2026 }),
      fixed({ id: "expired", untilYear: 2025 }),
    ];
    expect(occurrences(rules, 2026).map(item => item.ruleId)).toEqual(["once-in-year", "valid"]);
    expect(occurrences(rules, 2027).map(item => item.ruleId)).toEqual(["except", "valid"]);
    expect(nextYearRules(rules, 2026).map(item => item.id)).toEqual(["valid", "except"]);
    expect(nextYearRules(rules, 2027).map(item => item.id)).toEqual(["except"]);
    expect(nextYearRules([{ id: "visit", title: "Visita", anchor: { kind: "once", date: "2026-10-28" } }], 2026)).toEqual([]);
  });

  it("keeps duration and half-day information", () => {
    expect(occurrences([
      { id: "holy-week", title: "Semana Santa", anchor: { kind: "easter", offset: -4 }, days: 3 },
      { id: "eve", title: "Nochebuena", anchor: { kind: "fixed", month: 12, day: 24 }, part: "afternoon" },
    ], 2026)).toEqual([
      { ruleId: "holy-week", title: "Semana Santa", from: "2026-04-01", until: "2026-04-03", part: "full", shiftedFrom: null },
      { ruleId: "eve", title: "Nochebuena", from: "2026-12-24", until: "2026-12-24", part: "afternoon", shiftedFrom: null },
    ]);
  });

  it("provides the complete Guatemala reference template for 2026 and 2027", () => {
    const table = {
      2026: [
        ["Año Nuevo", "2026-01-01", "full"], ["Miércoles Santo", "2026-04-01", "afternoon"],
        ["Jueves Santo", "2026-04-02", "full"], ["Viernes Santo", "2026-04-03", "full"],
        ["Sábado de Gloria", "2026-04-04", "full"], ["Día del Trabajo", "2026-05-01", "full"],
        ["Día del Ejército", "2026-06-30", "full"], ["Día de la Independencia", "2026-09-15", "full"],
        ["Día de la Revolución", "2026-10-20", "full"], ["Día de Todos los Santos", "2026-11-01", "full"],
        ["Nochebuena", "2026-12-24", "afternoon"], ["Navidad", "2026-12-25", "full"], ["Fin de año", "2026-12-31", "afternoon"],
      ],
      2027: [
        ["Año Nuevo", "2027-01-01", "full"], ["Miércoles Santo", "2027-03-24", "afternoon"],
        ["Jueves Santo", "2027-03-25", "full"], ["Viernes Santo", "2027-03-26", "full"],
        ["Sábado de Gloria", "2027-03-27", "full"], ["Día del Trabajo", "2027-05-01", "full"],
        ["Día del Ejército", "2027-06-30", "full"], ["Día de la Independencia", "2027-09-15", "full"],
        ["Día de la Revolución", "2027-10-20", "full"], ["Día de Todos los Santos", "2027-11-01", "full"],
        ["Nochebuena", "2027-12-24", "afternoon"], ["Navidad", "2027-12-25", "full"], ["Fin de año", "2027-12-31", "afternoon"],
      ],
    } as const;
    for (const year of [2026, 2027] as const) {
      expect(occurrences(guatemalaTemplate, year).map(item => [item.title, item.from, item.part])).toEqual(table[year]);
    }
  });

  it("validates every anchor type and rejects malformed rules with useful messages", () => {
    const anchors: DateRule["anchor"][] = [
      { kind: "fixed", month: 9, day: 15 },
      { kind: "nth-weekday", month: 11, weekday: 4, n: 2 },
      { kind: "easter", offset: -2 },
      { kind: "relative", to: "easter", offset: 1, weekday: 1 },
      { kind: "once", date: "2026-10-28" },
    ];
    for (const [index, anchor] of anchors.entries()) expect(ruleInput({ id: `rule-${index}`, title: "Regla", anchor })).not.toHaveProperty("error");
    const error = (input: unknown) => (ruleInput(input) as { error: string }).error;
    expect(error(null)).toContain("identificador");
    expect(error({ id: "x", title: "", anchor: anchors[0] })).toContain("título");
    expect(error({ id: "x", title: "X", anchor: { kind: "fixed", month: 4, day: 31 } })).toContain("no existe");
    expect(error({ id: "x", title: "X", anchor: { kind: "nth-weekday", month: 1, weekday: 1, n: 6 } })).toContain("posición");
    expect(error({ id: "x", title: "X", anchor: { kind: "relative", to: "x", offset: 0 } })).toContain("sí misma");
    expect(error({ id: "x", title: "X", anchor: { kind: "once", date: "2026-02-30" } })).toContain("YYYY-MM-DD");
    expect(error({ id: "x", title: "X", anchor: anchors[0], days: 0 })).toContain("1 a 366");
    expect(error({ id: "x", title: "X", anchor: anchors[0], shift: { when: [6], to: "next", onto: [] } })).toContain("al menos un día");
    expect(error({ id: "x", title: "X", anchor: anchors[0], shift: { when: [6], to: "next", onto: [6] } })).toContain("también");
    expect(error({ id: "x", title: "X", anchor: anchors[0], fromYear: 2027, untilYear: 2026 })).toContain("posterior");
  });

  it("summarizes every anchor type in Spanish", () => {
    expect(ruleSummary(fixed())).toBe("15 de septiembre");
    expect(ruleSummary({ id: "nth", title: "Nth", anchor: { kind: "nth-weekday", month: 11, weekday: 4, n: 2 } })).toBe("Segundo jueves de noviembre");
    expect(ruleSummary({ id: "last", title: "Last", anchor: { kind: "nth-weekday", month: 5, weekday: 5, n: -1 } })).toBe("Último viernes de mayo");
    expect(ruleSummary({ id: "easter", title: "Easter", anchor: { kind: "easter", offset: -2 } })).toBe("2 días antes de Pascua");
    expect(ruleSummary({ id: "relative", title: "Relative", anchor: { kind: "relative", to: "easter", offset: 1, weekday: 1 } }, { easter: "Domingo de Pascua" })).toBe("Primer lunes a partir de 1 día después de «Domingo de Pascua»");
    expect(ruleSummary({ id: "monday", title: "Monday", anchor: { kind: "relative", to: "easter", offset: 0, weekday: 1 } }, { easter: "Domingo de Pascua" })).toBe("Primer lunes a partir de «Domingo de Pascua»");
    expect(ruleSummary({ id: "after", title: "After", anchor: { kind: "relative", to: "easter", offset: 7 } })).toBe("7 días después de «easter»");
    expect(ruleSummary({ id: "once", title: "Once", anchor: { kind: "once", date: "2026-10-28" } })).toBe("28 de octubre de 2026");
    expect(ruleSummary(fixed({ shift: { when: [6, 0], to: "next", onto: [1] } }))).toBe("15 de septiembre; si cae sábado o domingo, el lunes siguiente");
  });
});
