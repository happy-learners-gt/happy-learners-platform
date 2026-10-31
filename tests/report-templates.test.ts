import { describe, expect, it } from "vitest";
import { defaultTemplate, fill, jpegImage, pdfFile, renderReport, templateInput } from "../packages/domain/src/index";
import type { ReportRecord } from "../packages/domain/src/index";

// 1.5.0 (docs/design/constructor-de-reportes.md §2–§3): templates are data, checked against their kind's fields.
const jpeg = Uint8Array.from([0xff, 0xd8, 0xff, 0xc0, 0x00, 0x11, 0x08, 0x00, 0x02, 0x00, 0x03, 0x03, 1, 0x22, 0, 2, 0x11, 1, 3, 0x11, 1, 0xff, 0xd9]);
const record = (name: string): ReportRecord => ({
  fields: { "organizacion.nombre": "Colegio Horizonte", "estudiante.nombre": name, "curso.nombre": "Matemáticas", "seccion.nombre": "3.º A", "ciclo.nombre": "2026", "seccion.docentes": "Lucía Herrera", "resultado.nota": "88", "resultado.estado": "Aprueba", "esquema.nombre": "Puntos" },
  datasets: { periodos: [{ periodo: "Primer bimestre", nota: "85", estado: "Cerrado", comentario: "Participa con interés." }, { periodo: "Segundo bimestre", nota: "90", estado: "Abierto", comentario: "" }] },
});

describe("1.5.0 report templates", () => {
  it("the default templates are valid and fill every field from the platform's data", () => {
    for (const kind of ["report-card", "certificate"] as const) expect(templateInput(defaultTemplate(kind), [])).toEqual(defaultTemplate(kind));
    const { document, missing } = renderReport(defaultTemplate("report-card"), [record("Ana López"), record("Beto Ruiz")], {}, "Boleta");
    expect(missing).toEqual([]);
    expect(document.header).toEqual(["Colegio Horizonte", "Boleta de calificaciones · Docente: Lucía Herrera"]);
    // One page per student: the second record starts on a new page.
    expect(document.blocks.filter(block => block.pageBreak)).toHaveLength(1);
    const table = document.blocks.find(block => block.table)!.table!;
    expect(table.header).toEqual(["Periodo", "Nota", "Estado", "Comentario"]);
    expect(table.rows[0]).toEqual(["Primer bimestre", "85", "Cerrado", "Participa con interés."]);
    const file = pdfFile(document);
    expect(file).toContain("(Ana L\\363pez) Tj");
    expect(file).toContain("(Beto Ruiz) Tj");
  });

  it("reports the fields without data instead of inventing them", () => {
    expect(fill("Hola {{estudiante.nombre}} de {{curso.nombre}}", { "estudiante.nombre": "Ana" })).toBe("Hola Ana de ");
    const { missing } = renderReport(defaultTemplate("certificate"), [{ fields: { "estudiante.nombre": "Ana" }, datasets: {} }], {}, "Constancia");
    expect(missing).toEqual(["ciclo.nombre", "constancia.desde", "constancia.hasta", "constancia.tipo", "curso.nombre", "fecha.hoy", "organizacion.nombre", "seccion.nombre"]);
  });

  it("refuses unknown fields, datasets, columns, images and empty or oversized blocks", () => {
    const base = defaultTemplate("report-card");
    const withBlock = (block: object) => templateInput({ ...base, blocks: [block] }, ["logo-1"]);
    expect(withBlock({ id: "t", type: "text", text: "   " })).toEqual({ error: "Un bloque de texto está vacío o supera 2000 caracteres." });
    expect(withBlock({ id: "t", type: "text", text: "Hola {{estudiante.correo}}" })).toEqual({ error: "El campo {{estudiante.correo}} no existe en un documento de tipo «Boleta de calificaciones»." });
    expect(withBlock({ id: "t", type: "table", dataset: "asistencia", columns: [{ field: "x", label: "X" }] })).toEqual({ error: "Una tabla usa un conjunto de datos del documento y de 1 a 8 columnas que existen." });
    expect(withBlock({ id: "t", type: "table", dataset: "periodos", columns: [{ field: "promedio", label: "P" }] })).toEqual({ error: "Una tabla usa un conjunto de datos del documento y de 1 a 8 columnas que existen." });
    expect(withBlock({ id: "t", type: "image", imageId: "otra", widthMm: 30 })).toEqual({ error: "Una imagen usa una imagen de la organización y mide de 5 a 180 mm." });
    expect(withBlock({ id: "t", type: "signatures", lines: [] })).toEqual({ error: "Un bloque de firmas tiene de 1 a 4 firmas con nombre y cargo." });
    expect(withBlock({ id: "t", type: "html", text: "<b>x</b>" })).toEqual({ error: "Un bloque tiene un tipo que no existe." });
    expect(templateInput({ ...base, logoId: "otra" }, ["logo-1"])).toEqual({ error: "El logotipo ya no está en las imágenes de la organización." });
    expect(templateInput({ ...base, kind: "contrato" }, [])).toEqual({ error: "Elige el tipo de documento." });
  });

  it("renders the logo beside the header and images in blocks", () => {
    const template = { ...defaultTemplate("certificate"), logoId: "logo-1", blocks: [...defaultTemplate("certificate").blocks, { id: "sello", type: "image" as const, imageId: "logo-1", widthMm: 25, align: "right" as const }] };
    const checked = templateInput(template, ["logo-1"]);
    expect("error" in checked).toBe(false);
    const { document } = renderReport(template, [record("Ana")], { "logo-1": jpegImage(jpeg)! }, "Constancia");
    expect(document.logo).toBe("logo-1");
    expect(pdfFile(document).match(/\/Subtype \/Image/g)).toHaveLength(1);
  });
});
