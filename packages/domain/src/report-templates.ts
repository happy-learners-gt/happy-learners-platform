import type { PdfAlign, PdfBlock, PdfDocument, PdfImage, PdfPage } from "./pdf";

/**
 * Report templates (1.5.0, docs/design/constructor-de-reportes.md §2–§3): a template is data, blocks in order with
 * named fields (`{{estudiante.nombre}}`), never code. Each kind of document declares its fields and its datasets
 * (tables); rendering fills a template with one record per document (a student, a section) into a PDF document.
 */
export type ReportKind = "report-card" | "certificate";
export type TemplateBlock =
  | { id: string; type: "title"; text: string; align?: PdfAlign }
  | { id: string; type: "text"; text: string; align?: PdfAlign; size?: number; italic?: boolean }
  | { id: string; type: "fields"; pairs: { label: string; field: string }[] }
  | { id: string; type: "table"; dataset: string; columns: { field: string; label: string; width: number; align?: PdfAlign }[]; borders?: boolean; shade?: boolean }
  | { id: string; type: "image"; imageId: string; widthMm: number; align?: PdfAlign }
  | { id: string; type: "signatures"; lines: { name: string; role: string }[] }
  | { id: string; type: "page-break" };
export interface ReportTemplate { kind: ReportKind; page: PdfPage; logoId: string | null; header: string[]; footer: string; blocks: TemplateBlock[] }
/** One document's data: its fields and, for each dataset, its rows. */
export interface ReportRecord { fields: Record<string, string>; datasets: Record<string, Record<string, string>[]> }
type FieldSpec = { key: string; label: string };
export interface ReportKindSpec { label: string; fields: FieldSpec[]; datasets: { key: string; label: string; columns: FieldSpec[] }[] }

const common: FieldSpec[] = [
  { key: "organizacion.nombre", label: "Nombre de la organización" }, { key: "fecha.hoy", label: "Fecha de hoy" },
  { key: "ciclo.nombre", label: "Ciclo lectivo" }, { key: "seccion.nombre", label: "Sección" }, { key: "curso.nombre", label: "Curso" },
  { key: "seccion.docentes", label: "Docentes de la sección" }, { key: "estudiante.nombre", label: "Nombre del estudiante" },
];
export const reportKinds: Record<ReportKind, ReportKindSpec> = {
  "report-card": {
    label: "Boleta de calificaciones",
    fields: [...common, { key: "resultado.nota", label: "Nota del ciclo" }, { key: "resultado.estado", label: "Aprueba o no" }, { key: "esquema.nombre", label: "Esquema de evaluación" }],
    datasets: [
      { key: "periodos", label: "Periodos", columns: [{ key: "periodo", label: "Periodo" }, { key: "nota", label: "Nota" }, { key: "estado", label: "Estado" }, { key: "comentario", label: "Comentario" }] },
      { key: "actividades", label: "Actividades", columns: [{ key: "periodo", label: "Periodo" }, { key: "actividad", label: "Actividad" }, { key: "tipo", label: "Tipo" }, { key: "puntos", label: "Puntos" }, { key: "de", label: "De" }] },
    ],
  },
  certificate: {
    label: "Constancia",
    fields: [...common, { key: "constancia.tipo", label: "Inscripción o finalización" }, { key: "constancia.desde", label: "Fecha de inicio" }, { key: "constancia.hasta", label: "Fecha de fin" }],
    datasets: [],
  },
};

const field = /\{\{\s*([a-z.]+)\s*\}\}/g;
/** The fields a text names. */
export const fieldsIn = (text: string) => [...text.matchAll(field)].map(match => match[1]);
/** A text with its fields filled; a field without data becomes empty and is reported in `missing`. */
export function fill(text: string, values: Record<string, string>, missing?: Set<string>) {
  return text.replace(field, (_, key: string) => { if (values[key] === undefined || values[key] === "") missing?.add(key); return values[key] ?? ""; });
}

const align = (value: unknown): PdfAlign | undefined => value === "left" || value === "center" || value === "right" ? value : undefined;
const text = (value: unknown, max: number) => typeof value === "string" && value.length <= max ? value : null;
const id = (value: unknown) => typeof value === "string" && /^[a-zA-Z0-9-]{1,80}$/.test(value) ? value : null;

/** A template as the designer sends it, checked against its kind's fields and datasets and the images it may use. */
export function templateInput(value: unknown, images: string[]): ReportTemplate | { error: string } {
  const input = value && typeof value === "object" ? value as Record<string, unknown> : {};
  const kind = input.kind as ReportKind;
  const spec = reportKinds[kind];
  if (!spec) return { error: "Elige el tipo de documento." };
  const known = new Set(spec.fields.map(item => item.key));
  const unknown = (texts: string[]) => texts.flatMap(fieldsIn).find(key => !known.has(key));
  const raw = input.page && typeof input.page === "object" ? input.page as Record<string, unknown> : {};
  const page: PdfPage = { size: raw.size === "legal" || raw.size === "a4" ? raw.size : "letter", orientation: raw.orientation === "landscape" ? "landscape" : "portrait", marginMm: Number.isInteger(raw.marginMm) && (raw.marginMm as number) >= 10 && (raw.marginMm as number) <= 40 ? raw.marginMm as number : 20 };
  const header = Array.isArray(input.header) ? input.header.map(line => text(line, 160)) : [];
  if (header.length > 4 || header.some(line => line === null)) return { error: "El encabezado tiene hasta 4 líneas de hasta 160 caracteres." };
  const footer = text(input.footer ?? "", 200);
  if (footer === null) return { error: "El pie tiene hasta 200 caracteres." };
  const logoId = input.logoId === null || input.logoId === undefined ? null : id(input.logoId);
  if (logoId && !images.includes(logoId)) return { error: "El logotipo ya no está en las imágenes de la organización." };
  if (!Array.isArray(input.blocks) || !input.blocks.length || input.blocks.length > 60) return { error: "Una plantilla tiene de 1 a 60 bloques." };
  const blocks: TemplateBlock[] = [];
  for (const rawBlock of input.blocks as Record<string, unknown>[]) {
    const blockId = id(rawBlock?.id);
    if (!blockId) return { error: "Un bloque no tiene identificador." };
    switch (rawBlock.type) {
      case "title": case "text": {
        const content = text(rawBlock.text, 2000);
        if (content === null || !content.trim()) return { error: "Un bloque de texto está vacío o supera 2000 caracteres." };
        const size = Number(rawBlock.size);
        blocks.push(rawBlock.type === "title" ? { id: blockId, type: "title", text: content, align: align(rawBlock.align) } : { id: blockId, type: "text", text: content, align: align(rawBlock.align), ...(size >= 7 && size <= 18 ? { size } : {}), ...(rawBlock.italic ? { italic: true } : {}) });
        break;
      }
      case "fields": {
        const pairs = Array.isArray(rawBlock.pairs) ? (rawBlock.pairs as Record<string, unknown>[]).map(pair => ({ label: text(pair?.label, 80), field: typeof pair?.field === "string" && known.has(pair.field) ? pair.field : null })) : [];
        if (!pairs.length || pairs.length > 12 || pairs.some(pair => pair.label === null || !pair.field)) return { error: "Un bloque de campos tiene de 1 a 12 pares de etiqueta y campo existente." };
        blocks.push({ id: blockId, type: "fields", pairs: pairs as { label: string; field: string }[] });
        break;
      }
      case "table": {
        const dataset = spec.datasets.find(item => item.key === rawBlock.dataset);
        const columns = Array.isArray(rawBlock.columns) ? (rawBlock.columns as Record<string, unknown>[]).map(column => ({ field: dataset?.columns.some(item => item.key === column?.field) ? column.field as string : null, label: text(column?.label, 60), width: Number(column?.width) >= 1 && Number(column?.width) <= 10 ? Number(column.width) : 1, align: align(column?.align) })) : [];
        if (!dataset || !columns.length || columns.length > 8 || columns.some(column => !column.field || column.label === null)) return { error: "Una tabla usa un conjunto de datos del documento y de 1 a 8 columnas que existen." };
        blocks.push({ id: blockId, type: "table", dataset: dataset.key, columns: columns as { field: string; label: string; width: number; align?: PdfAlign }[], borders: rawBlock.borders !== false, shade: rawBlock.shade !== false });
        break;
      }
      case "image": {
        const imageId = id(rawBlock.imageId), width = Number(rawBlock.widthMm);
        if (!imageId || !images.includes(imageId) || !(width >= 5 && width <= 180)) return { error: "Una imagen usa una imagen de la organización y mide de 5 a 180 mm." };
        blocks.push({ id: blockId, type: "image", imageId, widthMm: width, align: align(rawBlock.align) });
        break;
      }
      case "signatures": {
        const lines = Array.isArray(rawBlock.lines) ? (rawBlock.lines as Record<string, unknown>[]).map(line => ({ name: text(line?.name, 80), role: text(line?.role, 80) })) : [];
        if (!lines.length || lines.length > 4 || lines.some(line => line.name === null || line.role === null)) return { error: "Un bloque de firmas tiene de 1 a 4 firmas con nombre y cargo." };
        blocks.push({ id: blockId, type: "signatures", lines: lines as { name: string; role: string }[] });
        break;
      }
      case "page-break": blocks.push({ id: blockId, type: "page-break" }); break;
      default: return { error: "Un bloque tiene un tipo que no existe." };
    }
  }
  const named = unknown([...(header as string[]), footer, ...blocks.flatMap(block => block.type === "title" || block.type === "text" ? [block.text] : block.type === "signatures" ? block.lines.flatMap(line => [line.name, line.role]) : [])]);
  if (named) return { error: `El campo {{${named}}} no existe en un documento de tipo «${spec.label}».` };
  return { kind, page, logoId, header: header as string[], footer, blocks };
}

/** The PDF document for the records (one or more pages each), and the fields that had no data. */
export function renderReport(template: ReportTemplate, records: ReportRecord[], images: Record<string, PdfImage>, title: string): { document: PdfDocument; missing: string[] } {
  const missing = new Set<string>();
  const first = records[0]?.fields || {};
  const blocks: PdfBlock[] = records.flatMap((record, index) => template.blocks.flatMap((block, at): PdfBlock[] => {
    const breakBefore = index > 0 && at === 0;
    const values = record.fields;
    switch (block.type) {
      case "title": return [{ text: fill(block.text, values, missing), bold: true, size: 15, align: block.align, space: 4, pageBreak: breakBefore }];
      case "text": return [{ text: fill(block.text, values, missing), size: block.size, align: block.align, italic: block.italic, space: 6, pageBreak: breakBefore }];
      case "fields": return block.pairs.map((pair, position) => ({ text: `${pair.label}: ${fill(`{{${pair.field}}}`, values, missing)}`, size: 10, space: position ? 2 : 6, pageBreak: breakBefore && position === 0 }));
      case "table": return [{ text: "", space: 8, pageBreak: breakBefore, table: { columns: block.columns.map(column => ({ width: column.width, align: column.align })), header: block.columns.map(column => column.label), rows: (record.datasets[block.dataset] || []).map(row => block.columns.map(column => row[column.field] ?? "")), borders: block.borders, shade: block.shade } }];
      case "image": return [{ text: "", space: 6, pageBreak: breakBefore, image: { id: block.imageId, widthMm: block.widthMm, align: block.align } }];
      case "signatures": return [{ text: "", space: 36, pageBreak: breakBefore, signatures: block.lines.map(line => ({ name: fill(line.name, values, missing), role: fill(line.role, values, missing) })) }];
      case "page-break": return [{ text: "", pageBreak: true }];
    }
  }));
  const used = new Set([template.logoId, ...template.blocks.flatMap(block => block.type === "image" ? [block.imageId] : [])].filter((item): item is string => !!item));
  const document: PdfDocument = {
    title, page: template.page, header: template.header.map(line => fill(line, first, missing)), footer: fill(template.footer, first, missing), blocks,
    images: Object.fromEntries([...used].filter(item => images[item]).map(item => [item, images[item]])), ...(template.logoId && images[template.logoId] ? { logo: template.logoId } : {}),
  };
  return { document, missing: [...missing].sort() };
}

/** The template a kind starts from: the same information the platform printed before templates existed. */
export function defaultTemplate(kind: ReportKind): ReportTemplate {
  const base = { kind, page: { size: "letter" as const, orientation: "portrait" as const, marginMm: 20 }, logoId: null, footer: "Documento generado por Happy Learners" };
  if (kind === "certificate") return { ...base, header: ["{{organizacion.nombre}}", "Constancia"], blocks: [
    { id: "titulo", type: "title", text: "Constancia de {{constancia.tipo}}", align: "center" },
    { id: "cuerpo", type: "text", text: "Se hace constar que {{estudiante.nombre}} está inscrita o inscrito en {{curso.nombre}}, sección {{seccion.nombre}}, del ciclo {{ciclo.nombre}}, del {{constancia.desde}} al {{constancia.hasta}}." },
    { id: "lugar", type: "text", text: "Se extiende la presente el {{fecha.hoy}}.", italic: true },
    { id: "firmas", type: "signatures", lines: [{ name: "Dirección", role: "{{organizacion.nombre}}" }] },
  ] };
  return { ...base, header: ["{{organizacion.nombre}}", "Boleta de calificaciones · Docente: {{seccion.docentes}}"], blocks: [
    { id: "estudiante", type: "title", text: "{{estudiante.nombre}}" },
    { id: "datos", type: "fields", pairs: [{ label: "Curso", field: "curso.nombre" }, { label: "Sección", field: "seccion.nombre" }, { label: "Ciclo", field: "ciclo.nombre" }] },
    { id: "periodos", type: "table", dataset: "periodos", columns: [{ field: "periodo", label: "Periodo", width: 3 }, { field: "nota", label: "Nota", width: 1, align: "right" }, { field: "estado", label: "Estado", width: 1.5 }, { field: "comentario", label: "Comentario", width: 4 }], borders: true, shade: true },
    { id: "resultado", type: "fields", pairs: [{ label: "Resultado del ciclo", field: "resultado.nota" }, { label: "Estado", field: "resultado.estado" }, { label: "Esquema", field: "esquema.nombre" }] },
    { id: "firmas", type: "signatures", lines: [{ name: "Docente", role: "{{seccion.docentes}}" }, { name: "Coordinación académica", role: "{{organizacion.nombre}}" }] },
  ] };
}
