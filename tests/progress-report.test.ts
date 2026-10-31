import { describe, expect, it } from "vitest";
import { defaultTemplate, progressRecord, progressSummary, renderReport, templateInput } from "../packages/domain/src/index";
import type { ProgressInput } from "../packages/domain/src/index";

// 1.5.2 (docs/design/constructor-de-reportes.md §4): a section's progress report from its own records.
const input: ProgressInput = {
  learners: [{ id: "ana", name: "Ana López" }, { id: "beto", name: "Beto Ruiz" }],
  classes: [{ id: "c1", status: "completed" }, { id: "c2", status: "completed" }, { id: "c3", status: "cancelled" }, { id: "c4", status: "planned" }],
  attendance: [
    { sessionId: "c1", learnerId: "ana", status: "present" }, { sessionId: "c2", learnerId: "ana", status: "late" },
    { sessionId: "c1", learnerId: "beto", status: "absent" }, { sessionId: "c2", learnerId: "beto", status: "excused" },
    // A mark on a cancelled class does not count.
    { sessionId: "c3", learnerId: "beto", status: "absent" },
  ],
  units: [{ id: "u1", name: "Números", lessons: ["l1", "l2"] }, { id: "u2", name: "Fracciones", lessons: ["l3"] }],
  taught: ["l1", "l9"],
  readings: [{ id: "r1", unitId: "u1" }, { id: "r2", unitId: "u2" }],
  readingMarks: [{ readingId: "r1", learnerId: "ana" }, { readingId: "r2", learnerId: "ana" }, { readingId: "r1", learnerId: "beto" }, { readingId: "other", learnerId: "beto" }],
};

describe("1.5.2 progress report", () => {
  it("counts classes, plan coverage, attendance without excused absences and required readings", () => {
    const summary = progressSummary(input);
    expect(summary.classes).toEqual({ completed: 2, scheduled: 3, cancelled: 1 });
    expect(summary.coverage).toEqual({ taught: 1, total: 3 });
    expect(summary.attendance).toBeCloseTo(2 / 3);
    expect(summary.readings).toEqual({ required: 2, rate: 0.75 });
    expect(summary.units).toEqual([{ name: "Números", total: 2, taught: 1, readings: 1 }, { name: "Fracciones", total: 1, taught: 0, readings: 1 }]);
    expect(summary.learners.map(item => [item.name, item.attendance, item.excused, item.read])).toEqual([["Ana López", 1, 0, 2], ["Beto Ruiz", 0, 1, 1]]);
  });

  it("writes the fields and tables, and says «Sin datos» rather than zero when nothing was recorded", () => {
    const record = progressRecord(progressSummary(input));
    expect(record.fields).toMatchObject({ "avance.clases": "2 de 3 clases dadas (1 cancelada)", "avance.cobertura": "1 de 3 lecciones (33 %)", "avance.asistencia": "67 %", "avance.lecturas": "75 % de 2 lecturas obligatorias", "avance.estudiantes": "2" });
    expect(record.datasets.estudiantes[1]).toEqual({ estudiante: "Beto Ruiz", asistencia: "0 %", presentes: "0", ausencias: "1", justificadas: "1", lecturas: "1 de 2" });
    const empty = progressRecord(progressSummary({ ...input, attendance: [], units: [], readings: [] }));
    expect(empty.fields).toMatchObject({ "avance.asistencia": "Sin datos", "avance.cobertura": "Sin lecciones en el plan", "avance.lecturas": "Sin lecturas obligatorias" });
    expect(empty.datasets.estudiantes[0].asistencia).toBe("Sin datos");
  });

  it("the default template is valid and renders every field it names", () => {
    const template = defaultTemplate("progress-report");
    expect(templateInput(template, [])).toEqual(template);
    const progress = progressRecord(progressSummary(input));
    const fields = { "organizacion.nombre": "Colegio", "fecha.hoy": "30 de octubre de 2026", "ciclo.nombre": "2026", "seccion.nombre": "3.º A", "curso.nombre": "Matemática", "seccion.docentes": "Lucía", ...progress.fields };
    const { document, missing } = renderReport(template, [{ fields, datasets: progress.datasets }], {}, "Reporte de avance");
    expect(missing).toEqual([]);
    expect(document.blocks.filter(block => block.table).map(block => block.table!.rows.length)).toEqual([2, 2]);
    // A student's name is not a field of a section's report.
    expect(templateInput({ ...template, blocks: [{ id: "x", type: "text", text: "{{estudiante.nombre}}" }] }, [])).toEqual({ error: "El campo {{estudiante.nombre}} no existe en un documento de tipo «Reporte de avance»." });
  });
});
