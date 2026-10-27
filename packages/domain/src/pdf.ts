/**
 * A minimal PDF writer for printable documents made of text: A4 pages, the standard Helvetica fonts (no embedding),
 * WinAnsi encoding (Spanish accents, ñ, ¿ ¡, curly quotes and dashes), word wrapping, and a header and a footer on
 * every page. Everything is plain ASCII in the file, so it can be checked byte by byte. No dependency.
 */
export type PdfBlock = { text: string; bold?: boolean; size?: number; indent?: number; space?: number };
export type PdfDocument = { title: string; header: string[]; footer: string; blocks: PdfBlock[] };

const width = 595.28, height = 841.89, margin = 56, bodySize = 10.5;
const special: Record<string, number> = { "€": 0x80, "‚": 0x82, "„": 0x84, "…": 0x85, "‘": 0x91, "’": 0x92, "“": 0x93, "”": 0x94, "•": 0x95, "–": 0x96, "—": 0x97, "™": 0x99 };
/** A character's WinAnsi code; anything the font cannot show becomes «?». */
function code(char: string) {
  const value = char.codePointAt(0)!;
  if (value >= 32 && value < 127) return value;
  if (value >= 160 && value <= 255) return value;
  return special[char] ?? 63;
}
/** A PDF literal string: parentheses and backslashes escaped, bytes over 126 as octal escapes. */
export function pdfString(text: string) {
  let out = "(";
  for (const char of text.normalize("NFC")) {
    const value = code(char);
    out += value === 40 || value === 41 || value === 92 ? `\\${String.fromCharCode(value)}` : value > 126 ? `\\${value.toString(8).padStart(3, "0")}` : String.fromCharCode(value);
  }
  return `${out})`;
}
/** An estimate of Helvetica's advance widths, on the safe side, so wrapped lines never overflow the margin. */
function textWidth(text: string, size: number, bold = false) {
  let units = 0;
  for (const char of text) {
    units += /[ijl.,;:'!|]/.test(char) ? 0.28 : /[ frtI()\-]/.test(char) ? 0.34 : /[mwMW@%]/.test(char) ? 0.89 : /[A-ZÁÉÍÓÚÑÜ]/.test(char) ? 0.72 : /[0-9]/.test(char) ? 0.56 : 0.56;
  }
  return units * size * (bold ? 1.06 : 1);
}
/** Lines of at most `max` points, breaking between words (or inside a word longer than a line). */
export function wrap(text: string, size: number, max: number, bold = false): string[] {
  const lines: string[] = [];
  for (const paragraph of text.split("\n")) {
    let line = "";
    for (const word of paragraph.split(/\s+/).filter(Boolean)) {
      const next = line ? `${line} ${word}` : word;
      if (textWidth(next, size, bold) <= max) { line = next; continue; }
      if (line) lines.push(line);
      let rest = word;
      while (textWidth(rest, size, bold) > max) { let cut = rest.length; while (cut > 1 && textWidth(rest.slice(0, cut), size, bold) > max) cut--; lines.push(rest.slice(0, cut)); rest = rest.slice(cut); }
      line = rest;
    }
    lines.push(line);
  }
  return lines;
}

type Placed = { text: string; bold: boolean; size: number; x: number; y: number };
/**
 * The document as a PDF file, all ASCII (so its characters are its bytes): blocks flow from page to page under the
 * header, and the footer says «Página n de N».
 */
export function pdfFile(document: PdfDocument): string {
  const headerSize = 8.5, footerSize = 8, top = height - margin, headerBottom = top - document.header.length * 11 - 10, bottom = margin + 24;
  const pages: Placed[][] = [[]];
  let y = headerBottom - 8;
  for (const block of document.blocks) {
    const size = block.size || bodySize, indent = block.indent || 0, leading = size * 1.35;
    y -= block.space ?? 0;
    for (const line of wrap(block.text, size, width - margin * 2 - indent, block.bold)) {
      if (y - leading < bottom) { pages.push([]); y = headerBottom - 8; }
      y -= leading;
      pages[pages.length - 1].push({ text: line, bold: !!block.bold, size, x: margin + indent, y });
    }
  }
  const total = pages.length;
  const streams = pages.map((placed, index) => {
    const ops: string[] = [];
    document.header.forEach((line, row) => ops.push(`BT /${row === 0 ? "F2" : "F1"} ${headerSize} Tf ${margin} ${(top - row * 11).toFixed(2)} Td ${pdfString(line)} Tj ET`));
    ops.push(`0.6 G 0.5 w ${margin} ${headerBottom.toFixed(2)} m ${width - margin} ${headerBottom.toFixed(2)} l S 0 G`);
    for (const line of placed) ops.push(`BT /${line.bold ? "F2" : "F1"} ${line.size} Tf ${line.x.toFixed(2)} ${line.y.toFixed(2)} Td ${pdfString(line.text)} Tj ET`);
    ops.push(`0.6 G 0.5 w ${margin} ${margin + 14} m ${width - margin} ${margin + 14} l S 0 G`);
    ops.push(`BT /F2 ${footerSize} Tf ${margin} ${margin} Td ${pdfString(document.footer)} Tj ET`);
    const pageLabel = `Página ${index + 1} de ${total}`;
    ops.push(`BT /F1 ${footerSize} Tf ${(width - margin - textWidth(pageLabel, footerSize)).toFixed(2)} ${margin} Td ${pdfString(pageLabel)} Tj ET`);
    return ops.join("\n");
  });
  // Objects: 1 catalog, 2 page tree, 3–4 fonts, 5 info, then a page and its content stream for each page.
  const objects: string[] = [];
  const pageIds = pages.map((_, index) => 6 + index * 2);
  objects[1] = "<< /Type /Catalog /Pages 2 0 R >>";
  objects[2] = `<< /Type /Pages /Kids [${pageIds.map(id => `${id} 0 R`).join(" ")}] /Count ${total} >>`;
  objects[3] = "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>";
  objects[4] = "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>";
  objects[5] = `<< /Title ${pdfString(document.title)} /Producer (Happy Learners) >>`;
  streams.forEach((stream, index) => {
    objects[pageIds[index]] = `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${width} ${height}] /Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ${pageIds[index] + 1} 0 R >>`;
    objects[pageIds[index] + 1] = `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`;
  });
  let out = "%PDF-1.4\n";
  const offsets: number[] = [];
  for (let id = 1; id < objects.length; id++) { offsets[id] = out.length; out += `${id} 0 obj\n${objects[id]}\nendobj\n`; }
  const xref = out.length;
  out += `xref\n0 ${objects.length}\n0000000000 65535 f \n${offsets.slice(1).map(offset => `${String(offset).padStart(10, "0")} 00000 n \n`).join("")}`;
  out += `trailer\n<< /Size ${objects.length} /Root 1 0 R /Info 5 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return out;
}
