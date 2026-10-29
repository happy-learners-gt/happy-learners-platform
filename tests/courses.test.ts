import { describe, expect, it } from "vitest";
import { materialInput, completeOrder, validTermIds } from "../packages/domain/src/courses";
import { courseInput, derivedSettings, moduleNoun, programInput, resolveSettings, settingDefinitions, settingsInput, visibleSettingDefinitions } from "../packages/domain/src/academic";
import type { StudyProgram } from "../packages/contracts/src/index";

const course = { title: "Fotografía cotidiana", objective: "Componer una imagen con luz natural.", status: "active", educationType: "non-formal", level: "unspecified", format: "workshop", modality: "in-person", pacing: "scheduled", settings: {}, programId: null };
const material = { title: "Observar la luz", description: "Una guía breve para comparar sombras.", kind: "text", content: "Observa un objeto iluminado desde dos posiciones. Describe la sombra.", status: "draft", termIds: [] };
describe("generic learning content", () => {
  it("creates courses and materials without language-specific fields", () => {
    expect(courseInput(course)).toEqual(course);
    expect(materialInput(material)).toEqual(material);
  });
  it("describes courses with standard ISCED dimensions and rejects incoherent ones", () => {
    expect(courseInput({ ...course, title: "  Ciencias  ", educationType: "formal", level: "upper-secondary", format: "laboratory", area: "053" })).toMatchObject({ title: "Ciencias", level: "upper-secondary", area: "053" });
    expect(courseInput({ ...course, educationType: "formal", level: "unspecified" })).toBeNull();
    expect(courseInput({ ...course, level: "kindergarten" })).toBeNull();
    expect(courseInput({ ...course, format: "run-code" })).toBeNull();
    expect(courseInput({ ...course, area: "99" })).toBeNull();
    expect(courseInput({ ...course, settings: { attendance: "yes" } })).toBeNull();
    expect(courseInput({ ...course, settings: { unknown: true } })).toBeNull();
    expect(courseInput({ ...course, programId: "../org-other" })).toBeNull();
    expect(validTermIds(["../org-other"])).toBe(false);
    expect(validTermIds(Array.from({ length: 25 }, (_, i) => `t-${i}`))).toBe(false);
  });
  it("derives behaviour from the dimensions and resolves settings with their source", () => {
    expect(derivedSettings({ educationType: "formal", level: "primary", modality: "online", pacing: "scheduled", format: "laboratory" })).toEqual({ moduleLabel: "modules", defaultSequence: "five-e", attendance: false, workGroups: false, outcomesRequired: true, assessmentRequired: true, gradeScale: "numeric_100", passingGrade: 60, letterThresholds: [90, 80, 70, 60], gradeAverage: "simple", gradingSchemeId: null });
    const program: StudyProgram = { id: "p", name: "Primaria", description: "", educationType: "formal", level: "primary", modality: "in-person", pacing: "scheduled", format: "subject", settings: { moduleLabel: "units", assessmentRequired: false }, locked: ["moduleLabel"], status: "active", version: 1, updatedAt: "t" };
    const inProgram = { educationType: "non-formal" as const, level: "unspecified" as const, modality: "online" as const, pacing: "self-paced" as const, format: "subject" as const, settings: { moduleLabel: "weeks" as const, assessmentRequired: true } };
    const { values, source } = resolveSettings(inProgram, program);
    // The program fixes the label, so the course's own value is ignored; its own assessment value wins.
    expect(values).toEqual({ moduleLabel: "units", defaultSequence: "start-develop-close", attendance: true, workGroups: true, outcomesRequired: true, assessmentRequired: true, gradeScale: "numeric_100", passingGrade: 60, letterThresholds: [90, 80, 70, 60], gradeAverage: "simple", gradingSchemeId: null });
    expect(source).toEqual({ moduleLabel: "program-locked", defaultSequence: "derived", attendance: "derived", workGroups: "derived", outcomesRequired: "derived", assessmentRequired: "course", gradeScale: "derived", passingGrade: "derived", letterThresholds: "derived", gradeAverage: "derived", gradingSchemeId: "derived" });
    expect(resolveSettings({ ...inProgram, settings: {} }, program).source.assessmentRequired).toBe("program");
  });
  it("keeps the grading scheme inheritable without offering an empty selector", () => {
    expect(settingDefinitions.map(item => item.key)).toContain("gradingSchemeId");
    expect(visibleSettingDefinitions.map(item => item.key)).not.toContain("gradingSchemeId");
    expect(settingsInput({ gradingSchemeId: "scheme-11111111-1111-4111-8111-111111111111" })?.gradingSchemeId).toBe("scheme-11111111-1111-4111-8111-111111111111");
    expect(settingsInput({ gradingSchemeId: null })).toEqual({ gradingSchemeId: null });
    expect(settingsInput({ gradingSchemeId: "points" })).toBeNull();
  });
  it("only lets a program fix settings it gives a value to", () => {
    const base = { name: "Inglés para adultos", educationType: "non-formal", level: "unspecified", modality: "online", pacing: "self-paced", format: "open-course", status: "active" };
    expect(programInput({ ...base, settings: { attendance: true }, locked: ["attendance"] })).toMatchObject({ locked: ["attendance"] });
    expect(programInput({ ...base, settings: {}, locked: ["attendance"] })).toBeNull();
    expect(settingsInput({ defaultSequence: "ppp", moduleLabel: "sessions" })).toEqual({ defaultSequence: "ppp", moduleLabel: "sessions" });
  });
  it("agrees in gender for every module name", () => {
    expect(moduleNoun("units")).toMatchObject({ New: "Nueva unidad", the: "la unidad", this: "esta unidad", theMany: "las unidades" });
    expect(moduleNoun("modules")).toMatchObject({ New: "Nuevo módulo", ofThe: "del módulo", none: "ningún módulo" });
  });
  it("validates sizes, kinds, statuses and safe link schemes", () => {
    expect(materialInput({ ...material, content: "x".repeat(8001) })).toBeNull();
    expect(materialInput({ ...material, kind: "image" })).toBeNull();
    expect(materialInput({ ...material, status: "deleted" })).toBeNull();
    for (const content of ["javascript:alert(1)", "data:text/html,hello", "https://user:password@example.com", "https://"]) expect(materialInput({ ...material, kind: "link", content })).toBeNull();
    expect(materialInput({ ...material, kind: "link", content: "https://example.com/guia?q=luz#uno" })).not.toBeNull();
  });
  it("requires a complete permutation for ordering", () => {
    expect(completeOrder(["b", "a"], ["a", "b"])).toBe(true);
    expect(completeOrder(["a", "a"], ["a", "b"])).toBe(false);
    expect(completeOrder(["a", "foreign"], ["a", "b"])).toBe(false);
    expect(completeOrder(["a"], ["a", "b"])).toBe(false);
  });
});
