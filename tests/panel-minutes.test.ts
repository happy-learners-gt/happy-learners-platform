import { describe, expect, it } from "vitest";
import { defaultTemplate, minuteCanonical, minuteClosed, renderReport, signingProblem, templateInput } from "../packages/domain/src/index";
import type { MinuteContent } from "../packages/domain/src/index";

// 1.5.1 (docs/design/constructor-de-reportes.md §4): panel minutes, signed by every member, the chair last.
const content: MinuteContent = {
  minuteId: "m-1", organizationId: "org", activityId: "a-1", activityTitle: "Defensa del proyecto", points: 40, courseTitle: "Ciencias", sectionName: "4.º A", periodName: "Cuarto bimestre",
  learnerId: "l-1", learnerName: "Ana López", combine: "average", result: "34",
  evaluators: [{ userId: "u-chair", name: "Lucía", chair: true, mark: "36" }, { userId: "u-2", name: "Beto", chair: false, mark: "32" }, { userId: "u-3", name: "Cris", chair: false, mark: "34" }],
};

describe("1.5.1 panel minutes", () => {
  it("fingerprints the same content the same way, whatever the order of its members, and any change changes it", () => {
    expect(minuteCanonical({ ...content, evaluators: [...content.evaluators].reverse() })).toBe(minuteCanonical(content));
    expect(minuteCanonical({ ...content, evaluators: content.evaluators.map(item => item.userId === "u-2" ? { ...item, mark: "33" } : item) })).not.toBe(minuteCanonical(content));
  });

  it("members sign in any order, the chair last, each once; closed when all have signed", () => {
    expect(signingProblem(content, [], "u-chair")).toBe("Quien preside firma al final: faltan 2 integrantes.");
    expect(signingProblem(content, [], "u-3")).toBeNull();
    expect(signingProblem(content, ["u-3"], "u-3")).toBe("Ya firmaste esta acta.");
    expect(signingProblem(content, ["u-3"], "u-chair")).toBe("Quien preside firma al final: faltan 1 integrante.");
    expect(signingProblem(content, ["u-3", "u-2"], "u-chair")).toBeNull();
    expect(signingProblem(content, [], "u-ajeno")).toBe("Solo los integrantes del tribunal firman su acta.");
    expect(minuteClosed(content, ["u-3", "u-2"])).toBe(false);
    expect(minuteClosed(content, ["u-3", "u-2", "u-chair"])).toBe(true);
  });

  it("the default minutes template is valid and fills every field", () => {
    expect(templateInput(defaultTemplate("panel-minutes"), [])).toEqual(defaultTemplate("panel-minutes"));
    const { missing } = renderReport(defaultTemplate("panel-minutes"), [{ fields: {
      "organizacion.nombre": "Colegio", "curso.nombre": "Ciencias", "seccion.nombre": "4.º A", "estudiante.nombre": "Ana", "actividad.nombre": "Defensa", "periodo.nombre": "Cuarto bimestre",
      "tribunal.criterio": "Promedio", "resultado.nota": "34", "acta.estado": "Firmada", "acta.huella": "abc",
    }, datasets: { integrantes: [{ integrante: "Lucía", rol: "Preside", calificacion: "36", firma: "Lucía Herrera", fecha: "30 oct 2026" }] } }], {}, "Acta");
    expect(missing).toEqual([]);
  });
});
