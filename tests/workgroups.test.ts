import { describe, expect, it } from "vitest";
import { wholeSection, workGroupInput } from "@happy-learners/domain";

describe("work groups (DEC-028)", () => {
  it("accepts a name and distinct students", () => {
    expect(workGroupInput({ name: "  Equipo Azul ", learnerIds: ["learner-a", "learner-b"] })).toEqual({ name: "Equipo Azul", learnerIds: ["learner-a", "learner-b"] });
    expect(workGroupInput({ name: "Sin integrantes", learnerIds: [] })).toEqual({ name: "Sin integrantes", learnerIds: [] });
  });
  it("rejects the default group's name, markup, long names and repeated or invalid students", () => {
    expect(workGroupInput({ name: wholeSection.toUpperCase(), learnerIds: [] })).toBeNull();
    expect(workGroupInput({ name: "<b>Equipo</b>", learnerIds: [] })).toBeNull();
    expect(workGroupInput({ name: "x".repeat(61), learnerIds: [] })).toBeNull();
    expect(workGroupInput({ name: "Equipo", learnerIds: ["learner-a", "learner-a"] })).toBeNull();
    expect(workGroupInput({ name: "Equipo", learnerIds: [7] })).toBeNull();
    expect(workGroupInput({ name: "Equipo" })).toBeNull();
    expect(workGroupInput(null)).toBeNull();
  });
});
