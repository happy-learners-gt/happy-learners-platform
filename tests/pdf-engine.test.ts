import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { jpegImage, pdfFile, pdfString } from "../packages/domain/src/pdf";
import type { PdfDocument } from "../packages/domain/src/pdf";

// 1.5.0 (docs/design/constructor-de-reportes.md §1): the PDF engine grows without changing what it already writes.
const classic: PdfDocument = { title: "Boleta · Ana", header: ["Colegio Horizonte", "Ciclo 2026 — Boleta"], footer: "Generado el 30 de octubre", blocks: [
  { text: "Ana López Pérez", bold: true, size: 14 }, { text: "Curso\tB1\tB2", bold: true, columns: [0, 220, 280] }, { text: "Matemáticas\t85\t90", columns: [0, 220, 280] },
  { text: "Comentario: participa con interés y avanza en la comprensión lectora. ".repeat(12), space: 6 }, { text: "Segunda página", pageBreak: true, indent: 12 },
] };
/** Every object the cross-reference table points to starts exactly there. */
function xrefMatches(file: string) {
  const start = Number(/startxref\n(\d+)/.exec(file)![1]);
  const entries = file.slice(start).split("\n").slice(2).filter(line => / 00000 n $/.test(line)).map(line => Number(line.slice(0, 10)));
  return entries.length > 0 && entries.every((offset, index) => file.startsWith(`${index + 1} 0 obj`, offset));
}
// A tiny baseline JPEG header: start of image, then a start-of-frame of 3 × 2 pixels in colour.
const jpeg = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x04, 0x00, 0x00, 0xff, 0xc0, 0x00, 0x11, 0x08, 0x00, 0x02, 0x00, 0x03, 0x03, 1, 0x22, 0, 2, 0x11, 1, 3, 0x11, 1, 0xff, 0xd9]);

describe("1.5.0 PDF engine", () => {
  it("writes a document without the new features exactly as before", () => {
    expect(createHash("sha256").update(pdfFile(classic)).digest("hex")).toBe("0edffec763e5579ad9bc9cfd1f7e5c3ab85e086705dce139764f354e0a7393a6");
  });

  it("reads a JPEG's size and colour, and refuses what is not a JPEG", () => {
    expect(jpegImage(jpeg)).toMatchObject({ width: 3, height: 2, components: 3 });
    expect(jpegImage(Uint8Array.from([0x89, 0x50, 0x4e, 0x47]))).toBeNull();
  });

  it("embeds images as hexadecimal, adds italic fonts only when used, and keeps the cross-reference exact", () => {
    const file = pdfFile({ ...classic, page: { size: "letter", orientation: "landscape", marginMm: 20 }, images: { logo: jpegImage(jpeg)!, sello: jpegImage(jpeg)! }, logo: "logo",
      blocks: [{ text: "Constancia", bold: true, align: "center", size: 16 }, { text: "Se hace constar…", italic: true }, { text: "", image: { id: "sello", widthMm: 30, align: "right" } }] });
    expect(/^[\x09\x0a\x0d\x20-\x7e]*$/.test(file)).toBe(true);
    expect(file).toContain("/MediaBox [0 0 792 612]");
    expect(file).toContain("/BaseFont /Helvetica-Oblique");
    expect(file.match(/\/Subtype \/Image/g)).toHaveLength(2);
    expect(file).toContain("/Filter [/ASCIIHexDecode /DCTDecode]");
    expect(file).toContain("ffd8ffe0");
    expect(file).toContain("/XObject << /Im1");
    expect(xrefMatches(file)).toBe(true);
    expect(xrefMatches(pdfFile(classic))).toBe(true);
    expect(pdfFile(classic)).not.toContain("Helvetica-Oblique");
  });

  it("draws tables with borders and a shaded header that repeats on every page, wrapping long cells", () => {
    const rows = Array.from({ length: 60 }, (_, index) => [`Curso ${index + 1} con un nombre largo que ocupa dos líneas en su celda`, "85", "90"]);
    const file = pdfFile({ ...classic, blocks: [{ text: "", table: { columns: [{ width: 3 }, { width: 1, align: "right" }, { width: 1, align: "right" }], header: ["Curso", "B1", "B2"], rows, borders: true, shade: true } }] });
    const pages = Number(/\/Count (\d+)/.exec(file)![1]);
    expect(pages).toBeGreaterThan(1);
    expect(file.match(/\(Curso\) Tj/g)).toHaveLength(pages);
    expect(file).toContain("0.92 g");
    expect(file).toContain("re S");
    // A long cell wraps inside its column: its words continue on the next line of the same cell.
    expect(file).toContain(`${pdfString("Curso 60 con un nombre largo que ocupa dos líneas en")} Tj`);
    expect(file).toContain(`${pdfString("su celda")} Tj`);
    expect(xrefMatches(file)).toBe(true);
  });

  it("aligns text and lays out signature lines in columns", () => {
    const file = pdfFile({ ...classic, blocks: [{ text: "Derecha", align: "right" }, { text: "", signatures: [{ name: "Ana López", role: "Dirección" }, { name: "Beto Ruiz", role: "Coordinación" }] }] });
    const x = (text: string) => Number(new RegExp(`([\\d.]+) [\\d.]+ Td ${pdfString(text).replace(/[()\\]/g, "\\$&")} Tj`).exec(file)![1]);
    expect(x("Derecha")).toBeGreaterThan(400);
    expect(x("Beto Ruiz")).toBeGreaterThan(x("Ana López") + 150);
    expect(file.match(/ l S\n/g)!.length).toBeGreaterThanOrEqual(2);
    expect(file).toContain("(Coordinaci\\363n) Tj");
  });
});
