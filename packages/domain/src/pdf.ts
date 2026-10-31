/**
 * A minimal PDF writer for printable documents: the standard Helvetica fonts (no embedding), WinAnsi encoding (Spanish
 * accents, ñ, ¿ ¡, curly quotes and dashes), word wrapping, and a header and a footer on every page. 1.5.0 adds page
 * sizes, aligned and italic text, tables, JPEG images (a logo beside the header, or a block), and signature lines,
 * for the report builder (docs/design/constructor-de-reportes.md). Everything is plain ASCII in the file (images go as
 * hexadecimal), so it can be checked byte by byte; a document without the new features is written exactly as before.
 */
export type PdfAlign = "left" | "center" | "right";
export type PdfTable = { columns: { width: number; align?: PdfAlign }[]; header?: string[]; rows: string[][]; borders?: boolean; shade?: boolean };
/**
 * A paragraph. `columns` lays out a table row instead: the text's tab-separated cells start at those offsets and do not
 * wrap. `pageBreak` starts the block on a new page. `table`, `image` and `signatures` (1.5.0) draw those instead of
 * the text.
 */
export type PdfBlock = {
  text: string; bold?: boolean; italic?: boolean; size?: number; indent?: number; space?: number; columns?: number[]; pageBreak?: boolean; align?: PdfAlign;
  table?: PdfTable; image?: { id: string; widthMm: number; align?: PdfAlign }; signatures?: { name: string; role: string }[];
};
/** A JPEG as the PDF embeds it: its bytes, size in pixels and whether it is grey or colour. */
export type PdfImage = { bytes: Uint8Array; width: number; height: number; components: 1 | 3 };
export type PdfPage = { size?: "a4" | "letter" | "legal"; orientation?: "portrait" | "landscape"; marginMm?: number };
export type PdfDocument = { title: string; header: string[]; footer: string; blocks: PdfBlock[]; page?: PdfPage; images?: Record<string, PdfImage>; logo?: string };

const sizes = { a4: [595.28, 841.89], letter: [612, 792], legal: [612, 1008] } as const;
const bodySize = 10.5;
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

/** Size and colour of a JPEG, read from its start-of-frame marker; null if it is not a baseline or progressive JPEG. */
export function jpegImage(bytes: Uint8Array): PdfImage | null {
  if (bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;
  for (let at = 2; at + 9 < bytes.length;) {
    if (bytes[at] !== 0xff) return null;
    const marker = bytes[at + 1], length = (bytes[at + 2] << 8) | bytes[at + 3];
    if (marker >= 0xc0 && marker <= 0xc2) {
      const height = (bytes[at + 5] << 8) | bytes[at + 6], width = (bytes[at + 7] << 8) | bytes[at + 8], components = bytes[at + 9];
      return width && height && (components === 1 || components === 3) ? { bytes, width, height, components } : null;
    }
    at += 2 + length;
  }
  return null;
}
const hex = (bytes: Uint8Array) => { let out = ""; for (const byte of bytes) out += byte.toString(16).padStart(2, "0"); return `${out}>`; };

type Placed =
  | { kind?: undefined; text: string; bold: boolean; italic?: boolean; size: number; x: number; y: number }
  | { kind: "rect"; x: number; y: number; w: number; h: number; fill?: number; stroke?: boolean }
  | { kind: "line"; x1: number; y1: number; x2: number; y2: number }
  | { kind: "image"; id: string; x: number; y: number; w: number; h: number };
const font = (bold: boolean, italic = false) => italic ? (bold ? "F4" : "F3") : bold ? "F2" : "F1";
/**
 * The document as a PDF file, all ASCII (so its characters are its bytes): blocks flow from page to page under the
 * header, and the footer says «Página n de N».
 */
export function pdfFile(document: PdfDocument): string {
  const [baseWidth, baseHeight] = sizes[document.page?.size || "a4"];
  const [width, height] = document.page?.orientation === "landscape" ? [baseHeight, baseWidth] : [baseWidth, baseHeight];
  const margin = document.page?.marginMm ? Math.round(document.page.marginMm * 72 / 25.4 * 100) / 100 : 56;
  const logo = document.logo ? document.images?.[document.logo] : undefined, logoHeight = 40, logoWidth = logo ? logoHeight * logo.width / logo.height : 0;
  const headerSize = 8.5, footerSize = 8, top = height - margin, bottom = margin + 24;
  const headerBottom = top - Math.max(document.header.length * 11 + 10, logo ? logoHeight + 4 : 0);
  const headerX = margin + (logo ? logoWidth + 10 : 0);
  const pages: Placed[][] = [[]];
  const used = new Set<string>();
  let y = headerBottom - 8;
  const page = () => pages[pages.length - 1];
  const newPage = () => { pages.push([]); y = headerBottom - 8; };
  const alignedX = (left: number, available: number, used: number, align?: PdfAlign) => align === "center" ? left + (available - used) / 2 : align === "right" ? left + available - used : left;
  for (const block of document.blocks) {
    const size = block.size || bodySize, indent = block.indent || 0, leading = size * 1.35;
    if (block.pageBreak && page().length) newPage();
    y -= block.space ?? 0;
    const left = margin + indent, available = width - margin * 2 - indent;
    if (block.table) {
      const table = block.table, total = table.columns.reduce((sum, column) => sum + column.width, 0) || 1;
      const widths = table.columns.map(column => available * column.width / total), cellLeading = size * 1.3;
      const row = (cells: string[], header: boolean) => {
        const lines = widths.map((columnWidth, index) => wrap(cells[index] || "", size, columnWidth - 8, header));
        const rowHeight = Math.max(1, ...lines.map(cell => cell.length)) * cellLeading + 6;
        if (y - rowHeight < bottom) { newPage(); if (!header && table.header) row(table.header, true); }
        let x = left;
        widths.forEach((columnWidth, index) => {
          if (header && table.shade) page().push({ kind: "rect", x, y: y - rowHeight, w: columnWidth, h: rowHeight, fill: 0.92 });
          if (table.borders) page().push({ kind: "rect", x, y: y - rowHeight, w: columnWidth, h: rowHeight, stroke: true });
          lines[index].forEach((line, at) => page().push({ text: line, bold: header, size, x: alignedX(x + 4, columnWidth - 8, textWidth(line, size, header), header ? "left" : table.columns[index].align), y: y - 3 - size * 0.85 - at * cellLeading }));
          x += columnWidth;
        });
        y -= rowHeight;
      };
      if (table.header) row(table.header, true);
      for (const cells of table.rows) row(cells, false);
      continue;
    }
    if (block.image) {
      const image = document.images?.[block.image.id];
      if (!image) continue;
      const w = Math.min(block.image.widthMm * 72 / 25.4, available), h = w * image.height / image.width;
      if (y - h < bottom) newPage();
      y -= h;
      page().push({ kind: "image", id: block.image.id, x: alignedX(left, available, w, block.image.align), y, w, h });
      used.add(block.image.id);
      continue;
    }
    if (block.signatures?.length) {
      const columnWidth = available / block.signatures.length, needed = 30 + size * 2.8;
      if (y - needed < bottom) newPage();
      const line = y - 30;
      block.signatures.forEach((signature, index) => {
        const x = left + columnWidth * index;
        page().push({ kind: "line", x1: x + 10, y1: line, x2: x + columnWidth - 10, y2: line });
        page().push({ text: signature.name, bold: true, size, x: alignedX(x, columnWidth, textWidth(signature.name, size, true), "center"), y: line - size * 1.2 });
        page().push({ text: signature.role, bold: false, italic: true, size: size - 1, x: alignedX(x, columnWidth, textWidth(signature.role, size - 1), "center"), y: line - size * 2.4 });
      });
      y -= needed;
      continue;
    }
    if (block.columns) {
      if (y - leading < bottom) newPage();
      y -= leading;
      const cells = block.text.split("\t");
      block.columns.forEach((offset, index) => { if (cells[index]) page().push({ text: cells[index], bold: !!block.bold, ...(block.italic ? { italic: true } : {}), size, x: margin + indent + offset, y }); });
      continue;
    }
    for (const line of wrap(block.text, size, available, block.bold)) {
      if (y - leading < bottom) newPage();
      y -= leading;
      page().push({ text: line, bold: !!block.bold, ...(block.italic ? { italic: true } : {}), size, x: block.align ? alignedX(left, available, textWidth(line, size, block.bold), block.align) : left, y });
    }
  }
  if (logo) used.add(document.logo!);
  const italic = pages.some(placed => placed.some(item => !item.kind && item.italic));
  const total = pages.length;
  const images = [...used].filter(id => document.images?.[id]);
  const streams = pages.map((placed, index) => {
    const ops: string[] = [];
    if (logo) ops.push(`q ${logoWidth.toFixed(2)} 0 0 ${logoHeight} ${margin} ${(top - logoHeight + 8.5).toFixed(2)} cm /Im${images.indexOf(document.logo!) + 1} Do Q`);
    document.header.forEach((line, row) => ops.push(`BT /${row === 0 ? "F2" : "F1"} ${headerSize} Tf ${headerX} ${(top - row * 11).toFixed(2)} Td ${pdfString(line)} Tj ET`));
    ops.push(`0.6 G 0.5 w ${margin} ${headerBottom.toFixed(2)} m ${width - margin} ${headerBottom.toFixed(2)} l S 0 G`);
    for (const item of placed) {
      if (item.kind === "rect") ops.push(item.fill !== undefined ? `${item.fill} g ${item.x.toFixed(2)} ${item.y.toFixed(2)} ${item.w.toFixed(2)} ${item.h.toFixed(2)} re f 0 g` : `0.6 G 0.5 w ${item.x.toFixed(2)} ${item.y.toFixed(2)} ${item.w.toFixed(2)} ${item.h.toFixed(2)} re S 0 G`);
      else if (item.kind === "line") ops.push(`0 G 0.7 w ${item.x1.toFixed(2)} ${item.y1.toFixed(2)} m ${item.x2.toFixed(2)} ${item.y2.toFixed(2)} l S`);
      else if (item.kind === "image") ops.push(`q ${item.w.toFixed(2)} 0 0 ${item.h.toFixed(2)} ${item.x.toFixed(2)} ${item.y.toFixed(2)} cm /Im${images.indexOf(item.id) + 1} Do Q`);
      else ops.push(`BT /${font(item.bold, item.italic)} ${item.size} Tf ${item.x.toFixed(2)} ${item.y.toFixed(2)} Td ${pdfString(item.text)} Tj ET`);
    }
    ops.push(`0.6 G 0.5 w ${margin} ${margin + 14} m ${width - margin} ${margin + 14} l S 0 G`);
    ops.push(`BT /F2 ${footerSize} Tf ${margin} ${margin} Td ${pdfString(document.footer)} Tj ET`);
    const pageLabel = `Página ${index + 1} de ${total}`;
    ops.push(`BT /F1 ${footerSize} Tf ${(width - margin - textWidth(pageLabel, footerSize)).toFixed(2)} ${margin} Td ${pdfString(pageLabel)} Tj ET`);
    return ops.join("\n");
  });
  // Objects: 1 catalog, 2 page tree, 3–4 fonts, 5 info, then a page and its content stream for each page; then, only
  // when used, the italic fonts and the images (so a document without them is written as before).
  const objects: string[] = [];
  const pageIds = pages.map((_, index) => 6 + index * 2);
  let next = 6 + pages.length * 2;
  const italicIds = italic ? [next++, next++] : [];
  const imageIds = images.map(() => next++);
  objects[1] = "<< /Type /Catalog /Pages 2 0 R >>";
  objects[2] = `<< /Type /Pages /Kids [${pageIds.map(id => `${id} 0 R`).join(" ")}] /Count ${total} >>`;
  objects[3] = "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>";
  objects[4] = "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>";
  objects[5] = `<< /Title ${pdfString(document.title)} /Producer (Happy Learners) >>`;
  const fonts = `/F1 3 0 R /F2 4 0 R${italic ? ` /F3 ${italicIds[0]} 0 R /F4 ${italicIds[1]} 0 R` : ""}`;
  const xobjects = imageIds.length ? ` /XObject << ${imageIds.map((id, index) => `/Im${index + 1} ${id} 0 R`).join(" ")} >>` : "";
  streams.forEach((stream, index) => {
    objects[pageIds[index]] = `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${width} ${height}] /Resources << /Font << ${fonts} >>${xobjects} >> /Contents ${pageIds[index] + 1} 0 R >>`;
    objects[pageIds[index] + 1] = `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`;
  });
  if (italic) {
    objects[italicIds[0]] = "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Oblique /Encoding /WinAnsiEncoding >>";
    objects[italicIds[1]] = "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-BoldOblique /Encoding /WinAnsiEncoding >>";
  }
  images.forEach((id, index) => {
    const image = document.images![id], data = hex(image.bytes);
    objects[imageIds[index]] = `<< /Type /XObject /Subtype /Image /Width ${image.width} /Height ${image.height} /ColorSpace /${image.components === 1 ? "DeviceGray" : "DeviceRGB"} /BitsPerComponent 8 /Filter [/ASCIIHexDecode /DCTDecode] /Length ${data.length} >>\nstream\n${data}\nendstream`;
  });
  let out = "%PDF-1.4\n";
  const offsets: number[] = [];
  for (let id = 1; id < objects.length; id++) { offsets[id] = out.length; out += `${id} 0 obj\n${objects[id]}\nendobj\n`; }
  const xref = out.length;
  out += `xref\n0 ${objects.length}\n0000000000 65535 f \n${offsets.slice(1).map(offset => `${String(offset).padStart(10, "0")} 00000 n \n`).join("")}`;
  out += `trailer\n<< /Size ${objects.length} /Root 1 0 R /Info 5 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return out;
}
