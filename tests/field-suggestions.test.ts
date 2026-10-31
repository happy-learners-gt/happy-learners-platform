import { describe, expect, it } from "vitest";
import { applySuggestion, checkedSuggestions, exampleSuggestions, fixtureSuggester, suggestInput, suggestPrompt } from "../packages/domain/src/index";
import type { SuggestInput } from "../packages/domain/src/index";

// 1.5.2 (docs/design/constructor-de-reportes.md §5): «Sugerir campos» in the document designer.
const fields = [
  { key: "estudiante.nombre", label: "Nombre del estudiante" }, { key: "curso.nombre", label: "Curso", example: "Matemática" },
  { key: "seccion.nombre", label: "Sección", example: "6.º A" }, { key: "fecha.hoy", label: "Fecha de hoy", example: "31 de octubre de 2026" },
];
const text = "Se hace constar que Ana López cursa matemática en la sección 6.º A. Ana López asiste con regularidad. Guatemala, 31 de octubre de 2026. {{curso.nombre}}";
const input = suggestInput("Constancia", text, fields) as SuggestInput;

describe("1.5.2 suggest fields", () => {
  it("validates the request and keeps example values short", () => {
    expect(suggestInput("Constancia", "  ", fields)).toEqual({ error: "Escribe el texto del bloque para sugerir sus campos." });
    expect(suggestInput("Constancia", "x".repeat(2001), fields)).toEqual({ error: "El texto supera los 2000 caracteres de un bloque." });
    expect(input.fields[0]).toEqual({ key: "estudiante.nombre", label: "Nombre del estudiante" });
  });

  it("finds real values in the text without a model, ignoring case and the fields it already has", () => {
    expect(exampleSuggestions(input).suggestions).toEqual([
      { original: "31 de octubre de 2026", field: "fecha.hoy" }, { original: "matemática", field: "curso.nombre" }, { original: "6.º A", field: "seccion.nombre" },
    ]);
  });

  it("keeps only parts that are in the text, with known fields and without overlaps, in reading order", () => {
    const checked = checkedSuggestions([
      exampleSuggestions(input),
      { suggestions: [{ original: "Ana López", field: "estudiante.nombre" }, { original: "octubre", field: "fecha.hoy" }, { original: "Pedro", field: "estudiante.nombre" }, { original: "sección", field: "estudiante.contrasena" }] },
    ], input);
    expect(checked).toEqual([
      { original: "Ana López", field: "estudiante.nombre", label: "Nombre del estudiante" }, { original: "matemática", field: "curso.nombre", label: "Curso" },
      { original: "6.º A", field: "seccion.nombre", label: "Sección" }, { original: "31 de octubre de 2026", field: "fecha.hoy", label: "Fecha de hoy" },
    ]);
  });

  it("accepting a proposal replaces every appearance of the part and leaves existing fields alone", () => {
    expect(applySuggestion(text, { original: "Ana López", field: "estudiante.nombre" })).toBe(
      "Se hace constar que {{estudiante.nombre}} cursa matemática en la sección 6.º A. {{estudiante.nombre}} asiste con regularidad. Guatemala, 31 de octubre de 2026. {{curso.nombre}}");
    expect(applySuggestion("{{curso.nombre}} y curso", { original: "curso", field: "curso.nombre" })).toBe("{{curso.nombre}} y {{curso.nombre}}");
  });

  it("the fixture recognizes a written date; the prompt lists the fields with their examples", async () => {
    expect(await fixtureSuggester.suggest({ ...input, text: "Emitida el 2 de marzo de 2027." })).toEqual({ suggestions: [{ original: "2 de marzo de 2027", field: "fecha.hoy" }] });
    const prompt = suggestPrompt(input);
    expect(prompt.user).toContain("- curso.nombre: Curso (ejemplo: Matemática)");
    expect(prompt.user).toContain("- estudiante.nombre: Nombre del estudiante\n");
  });
});
