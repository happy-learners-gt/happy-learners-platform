import { describe, expect, it } from "vitest";
import { fixtureWriter, writeInput, writePrompt, writtenText } from "../packages/domain/src/index";
import type { WriteInput } from "../packages/domain/src/index";

// 1.4.1 (docs/design/asistente-ia.md §6e): «Redactar con IA» proposes; the person decides.
describe("1.4.1 writing with AI", () => {
  it("accepts known fields and actions, and of a student only the first name in a report comment", () => {
    expect(writeInput({ field: "report-comment", action: "draft", text: "", context: { course: " Matemáticas ", learner: "Ana Lucía Pérez" } }))
      .toEqual({ field: "report-comment", action: "draft", text: "", context: { course: "Matemáticas", learner: "Ana" } });
    expect(writeInput({ field: "lesson-objective", action: "draft", text: "", context: { learner: "Ana Pérez", lesson: "Fracciones" } }))
      .toEqual({ field: "lesson-objective", action: "draft", text: "", context: { lesson: "Fracciones" } });
    expect(writeInput({ field: "contraseña", action: "draft", text: "" })).toEqual({ error: "Ese campo no admite redacción con IA." });
    expect(writeInput({ field: "notice", action: "translate", text: "x" })).toEqual({ error: "Elige redactar, mejorar la redacción o acortar." });
    expect(writeInput({ field: "notice", action: "shorten", text: "  " })).toEqual({ error: "Escribe un texto para mejorarlo o acortarlo." });
    expect(writeInput({ field: "lesson-objective", action: "improve", text: "x".repeat(601) })).toEqual({ error: "El texto es demasiado largo para este campo." });
  });

  it("asks the model for the field's kind of text, within its limit, without inventing", () => {
    const { system, user } = writePrompt({ field: "report-comment", action: "improve", text: "ana trabaja bien", context: { course: "Matemáticas", learner: "Ana" } });
    expect(system).toContain("No inventes datos");
    expect(user).toContain("Mejora la redacción de este comentario de boleta sin cambiar lo que dice.");
    expect(user).toContain("Máximo 600 caracteres.");
    expect(user).toContain("Estudiante (nombre de pila): Ana");
  });

  it("the fixture is deterministic, and a proposal over the field's limit is not offered", async () => {
    const input: WriteInput = { field: "lesson-objective", action: "shorten", text: "Comparar fracciones con regletas. Después explicarlo a la clase.", context: {} };
    expect(await fixtureWriter.write(input)).toEqual({ text: "Comparar fracciones con regletas." });
    expect(await fixtureWriter.write({ ...input, action: "improve", text: "comparar fracciones , con regletas" })).toEqual({ text: "Comparar fracciones, con regletas." });
    expect((await fixtureWriter.write({ ...input, action: "draft", text: "", context: { lesson: "Fracciones equivalentes" } })).text).toBe("Al terminar la clase, cada estudiante explica con sus palabras fracciones equivalentes y lo aplica en un ejercicio.");
    expect(writtenText({ text: "x".repeat(301) }, input)).toEqual({ error: "La propuesta supera los 300 caracteres del campo. Vuelve a intentar o usa «Más breve»." });
    expect(writtenText({ text: "  " }, input)).toEqual({ error: "La IA no propuso un texto. Vuelve a intentar." });
    expect(writtenText({ text: " Listo. " }, input)).toEqual({ text: "Listo." });
  });
});
