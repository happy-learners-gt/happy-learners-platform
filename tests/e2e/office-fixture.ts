const encoder = new TextEncoder();
type Entry = { name: string; value: string };

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function put16(view: DataView, offset: number, value: number) { view.setUint16(offset, value, true); }
function put32(view: DataView, offset: number, value: number) { view.setUint32(offset, value, true); }

export function officePackage(extension: "docx" | "pptx" | "xlsx"): Buffer {
  const main = {
    docx: ["word/document.xml", `<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>Documento de demostración validado</w:t></w:r></w:p><w:sectPr/></w:body></w:document>`],
    pptx: ["ppt/presentation.xml", `<?xml version="1.0"?><p:presentation xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><p:sldIdLst><p:sldId id="256" r:id="rId1"/></p:sldIdLst><p:sldSz cx="9144000" cy="5143500"/></p:presentation>`],
    xlsx: ["xl/workbook.xml", `<?xml version="1.0"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Demo" sheetId="1" r:id="rId1"/></sheets></workbook>`],
  }[extension];
  const extra: Entry[] = extension === "docx" ? [] : extension === "pptx" ? [
    { name: "ppt/_rels/presentation.xml.rels", value: `<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide1.xml"/></Relationships>` },
    { name: "ppt/slides/slide1.xml", value: `<?xml version="1.0"?><p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"><p:cSld><p:spTree><p:nvGrpSpPr/><p:grpSpPr/><p:sp><p:nvSpPr/><p:txBody><a:bodyPr xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"/><a:lstStyle xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"/><a:p xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:r><a:rPr/><a:t>Presentación de demostración</a:t></a:r></a:p></p:txBody></p:sp></p:spTree></p:cSld></p:sld>` },
  ] : [
    { name: "xl/_rels/workbook.xml.rels", value: `<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>` },
    { name: "xl/worksheets/sheet1.xml", value: `<?xml version="1.0"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>Hoja de demostración</t></is></c></row></sheetData></worksheet>` },
  ];
  const contentType = extension === "docx" ? "application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml" : extension === "pptx" ? "application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml" : "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml";
  const entries: Entry[] = [
    { name: "[Content_Types].xml", value: `<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/${main[0]}" ContentType="${contentType}"/></Types>` },
    { name: "_rels/.rels", value: `<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rIdOffice" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="${main[0]}"/></Relationships>` },
    ...(extension === "docx" ? [{ name: "word/_rels/document.xml.rels", value: `<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"/>` }] : []),
    { name: main[0], value: main[1] }, ...extra,
  ];
  const local: Uint8Array[] = [], central: Uint8Array[] = [];
  let localOffset = 0;
  for (const entry of entries) {
    const name = encoder.encode(entry.name), data = encoder.encode(entry.value), crc = crc32(data);
    const localHeader = new Uint8Array(30 + name.length + data.length), lv = new DataView(localHeader.buffer);
    put32(lv, 0, 0x04034b50); put16(lv, 4, 20); put16(lv, 8, 0); put32(lv, 14, crc); put32(lv, 18, data.length); put32(lv, 22, data.length); put16(lv, 26, name.length);
    localHeader.set(name, 30); localHeader.set(data, 30 + name.length); local.push(localHeader);
    const header = new Uint8Array(46 + name.length), cv = new DataView(header.buffer);
    put32(cv, 0, 0x02014b50); put16(cv, 4, 20); put16(cv, 6, 20); put32(cv, 16, crc); put32(cv, 20, data.length); put32(cv, 24, data.length); put16(cv, 28, name.length); put32(cv, 42, localOffset);
    header.set(name, 46); central.push(header); localOffset += localHeader.length;
  }
  const centralBytes = central.reduce((sum, part) => sum + part.length, 0), end = new Uint8Array(22), ev = new DataView(end.buffer);
  put32(ev, 0, 0x06054b50); put16(ev, 8, entries.length); put16(ev, 10, entries.length); put32(ev, 12, centralBytes); put32(ev, 16, localOffset);
  return Buffer.concat([...local, ...central, end]);
}

/** A valid two-page PDF with real cross-reference offsets, so strict readers accept it. */
export function pdfDocument(pages = ["Primera pagina de demostracion", "Segunda pagina de demostracion"]): Buffer {
  const objects: string[] = [];
  const pageIds = pages.map((_, index) => 4 + index * 2);
  objects[1] = "<< /Type /Catalog /Pages 2 0 R >>";
  objects[2] = `<< /Type /Pages /Kids [${pageIds.map(id => `${id} 0 R`).join(" ")}] /Count ${pages.length} >>`;
  objects[3] = "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>";
  pages.forEach((text, index) => {
    const stream = `BT /F1 28 Tf 72 700 Td (${text}) Tj ET`;
    objects[pageIds[index]] = `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> /Contents ${pageIds[index] + 1} 0 R >>`;
    objects[pageIds[index] + 1] = `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`;
  });
  let body = "%PDF-1.4\n";
  const offsets: number[] = [];
  for (let id = 1; id < objects.length; id++) { offsets[id] = body.length; body += `${id} 0 obj\n${objects[id]}\nendobj\n`; }
  const xref = body.length;
  body += `xref\n0 ${objects.length}\n0000000000 65535 f \n${offsets.slice(1).map(offset => `${String(offset).padStart(10, "0")} 00000 n \n`).join("")}`;
  body += `trailer\n<< /Size ${objects.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(body, "latin1");
}

/** Smallest MP4 the server accepts: an ISO-BMFF "ftyp" box followed by padding. */
export function mp4Header(): Buffer {
  const ftyp = Buffer.from([0, 0, 0, 0x18, ...Buffer.from("ftypisom"), 0, 0, 2, 0, ...Buffer.from("isomiso2")]);
  return Buffer.concat([ftyp, Buffer.alloc(64)]);
}
