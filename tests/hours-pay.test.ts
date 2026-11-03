import { describe, expect, it } from "vitest";
import type { Contract, ContractEngagement, ContractTerms } from "@happy-learners/contracts";
import { amountCents, formatCents, hoursPay, hoursPayable, personContract } from "../packages/domain/src/index";

// HRS-03 (AP-08): what the contract in force says about the hours registered; a reference, not payroll.
const contract = (engagement: ContractEngagement, compensation: ContractTerms["compensation"]) => ({ engagement, terms: { role: "Educador", compensation, term: { kind: "indefinite" as const } } });
const hourly = { kind: "hourly" as const, amount: "37.50", currency: "GTQ" };
const worked = { minutes: 150, classes: 3 };

describe("HRS-03 hours read with the contract", () => {
  it("reads amounts as whole cents", () => {
    expect([amountCents("37.5"), amountCents("37.50"), amountCents("1500"), amountCents("0.05"), amountCents("1,5"), amountCents(undefined)]).toEqual([3750, 3750, 150000, 5, null, null]);
    expect(formatCents(9375, "GTQ")).toMatch(/GTQ/);
  });

  it("only hourly pay outside employment, volunteer and services gives an amount for the hours registered", () => {
    expect(hoursPayable(contract("other", hourly))).toBe(true);
    expect(hoursPayable(contract("internship", hourly))).toBe(true);
    for (const engagement of ["employment", "services", "volunteer"] as const) expect(hoursPayable(contract(engagement, hourly))).toBe(false);
    expect(hoursPayable(contract("other", { kind: "per-session", amount: "50", currency: "GTQ" }))).toBe(false);
    // 2 h 30 min × GTQ 37.50 = GTQ 93.75, exactly.
    expect(hoursPay(contract("other", hourly), worked, false)).toEqual({ kind: "hourly", payable: true, cents: 9375, rateCents: 3750, currency: "GTQ", minutes: 150 });
    expect(hoursPay(contract("services", hourly), worked, false)).toMatchObject({ kind: "hourly", payable: false, cents: 9375 });
  });

  it("gives administration a reference for the rest", () => {
    expect(hoursPay(contract("services", { kind: "per-session", amount: "50", currency: "GTQ" }), worked, false)).toEqual({ kind: "per-session", cents: 15000, rateCents: 5000, currency: "GTQ", classes: 3 });
    const salary = contract("employment", { kind: "fixed", amount: "3000", currency: "GTQ", period: "month" });
    // A monthly amount per effective hour only over one whole month: 3000 / 2.5 h = 1200 per hour.
    expect(hoursPay(salary, worked, true)).toEqual({ kind: "fixed", amountCents: 300000, currency: "GTQ", period: "month", perHourCents: 120000 });
    expect(hoursPay(salary, worked, false)).toMatchObject({ perHourCents: null });
    expect(hoursPay(salary, { minutes: 0, classes: 0 }, true)).toMatchObject({ perHourCents: null });
    expect(hoursPay(contract("volunteer", { kind: "none" }), worked, true)).toEqual({ kind: "none", minutes: 150 });
    expect(hoursPay(null, worked, true)).toEqual({ kind: "no-contract" });
  });

  it("takes the contract in force, the latest started", () => {
    const item = (id: string, userId: string, phase: Contract["phase"], startDate: string) => ({ id, userId, phase, startDate });
    const all = [item("old", "u1", "in-force", "2026-01-01"), item("new", "u1", "ending", "2026-06-01"), item("next", "u1", "scheduled", "2026-12-01"), item("draft", "u1", "draft", "2026-11-01"), item("other", "u2", "in-force", "2026-01-01")];
    expect(personContract(all, "u1")?.id).toBe("new");
    expect(personContract(all, "u3")).toBeNull();
  });
});
