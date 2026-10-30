import type { AiTokenUsage } from "./ai-usage";

/**
 * «Redactar con IA» (1.4.1, docs/design/asistente-ia.md §6e): a proposal for a long text field, shown under it with
 * «Usar» and «Descartar». It never replaces the text on its own. The model gets the kind of field, the minimum context
 * and the current text; of a student, at most the first name (report comments).
 */
export const writePromptVersion = "2026-10-30.1";
export type WriteField = "lesson-objective" | "course-objective" | "unit-objective" | "report-comment" | "resource-description" | "notice" | "document-text";
export type WriteAction = "draft" | "improve" | "shorten";
export interface WriteInput { field: WriteField; action: WriteAction; text: string; context: { course?: string; unit?: string; level?: string; lesson?: string; learner?: string } }
export interface WriteOutput { text: string }
export interface AiWriter { readonly kind: "fixture" | "openai"; write(input: WriteInput, observe?: (usage: AiTokenUsage) => void): Promise<WriteOutput> }

export const writeFields: Record<WriteField, { label: string; max: number; guide: string }> = {
  "lesson-objective": { label: "objetivo de la lección", max: 300, guide: "Una oración: qué podrá hacer cada estudiante al terminar la clase, con un verbo observable." },
  "course-objective": { label: "objetivo del curso", max: 600, guide: "Dos o tres oraciones: para qué sirve el curso y qué logra quien lo termina." },
  "unit-objective": { label: "objetivo de la unidad", max: 300, guide: "Una o dos oraciones: qué se aprende en la unidad." },
  "report-comment": { label: "comentario de boleta", max: 600, guide: "Dos a cuatro oraciones a la familia: un logro concreto, un aspecto por mejorar y una sugerencia. Tono respetuoso y cálido; sin diagnósticos ni etiquetas." },
  "resource-description": { label: "descripción de un recurso", max: 500, guide: "Una o dos oraciones: qué es el recurso y para qué se usa en el curso." },
  notice: { label: "aviso", max: 600, guide: "Breve y claro: qué pasa, cuándo y qué debe hacer quien lo lee." },
  "document-text": { label: "texto de un documento oficial", max: 2000, guide: "Tono formal e institucional. Conserva intactos los campos entre llaves dobles, como {{estudiante.nombre}}: no los cambies ni inventes otros." },
};
export const writeActionLabels: Record<WriteAction, string> = { draft: "Redactar", improve: "Mejorar redacción", shorten: "Más breve" };

/** A request as the browser sends it: a known field and action, text within the field's limit, short context. */
export function writeInput(value: unknown): WriteInput | { error: string } {
  const input = value && typeof value === "object" ? value as Record<string, unknown> : {};
  const field = input.field as WriteField, action = input.action as WriteAction;
  if (!(field in writeFields)) return { error: "Ese campo no admite redacción con IA." };
  if (!(action in writeActionLabels)) return { error: "Elige redactar, mejorar la redacción o acortar." };
  const text = typeof input.text === "string" ? input.text.trim() : "";
  if (text.length > writeFields[field].max * 2) return { error: "El texto es demasiado largo para este campo." };
  if (action !== "draft" && !text) return { error: "Escribe un texto para mejorarlo o acortarlo." };
  const raw = input.context && typeof input.context === "object" ? input.context as Record<string, unknown> : {};
  const context: WriteInput["context"] = {};
  for (const key of ["course", "unit", "level", "lesson", "learner"] as const) {
    const item = typeof raw[key] === "string" ? (raw[key] as string).trim().slice(0, 160) : "";
    // Of a student, only the first name, and only in a report comment.
    if (item && (key !== "learner" || field === "report-comment")) context[key] = key === "learner" ? item.split(/\s+/)[0] : item;
  }
  return { field, action, text, context };
}

export const writeSchema = { type: "object", additionalProperties: false, required: ["text"], properties: { text: { type: "string" } } } as const;

export function writePrompt(input: WriteInput) {
  const spec = writeFields[input.field];
  const system = [
    "Eres editor pedagógico de una institución educativa. Escribes en el idioma del texto o, si no hay texto, en español claro, sin jerga.",
    "No inventes datos, fechas, notas ni hechos que no estén en el texto o el contexto. Devuelve solo el objeto JSON pedido.",
  ].join(" ");
  const context = Object.entries(input.context).map(([key, value]) => `${({ course: "Curso", unit: "Unidad", level: "Nivel", lesson: "Lección", learner: "Estudiante (nombre de pila)" } as Record<string, string>)[key]}: ${value}`).join("\n");
  const task = input.action === "draft" ? `Redacta el ${spec.label}.` : input.action === "improve" ? `Mejora la redacción de este ${spec.label} sin cambiar lo que dice.` : `Acorta este ${spec.label} a la mitad o menos, sin perder lo esencial.`;
  const user = [task, spec.guide, `Máximo ${spec.max} caracteres.`, context, input.text ? `Texto actual:\n"""\n${input.text}\n"""` : ""].filter(Boolean).join("\n\n");
  return { system, user };
}

const sentence = (text: string) => { const clean = text.replace(/\s+/g, " ").trim(); return clean ? clean.charAt(0).toUpperCase() + clean.slice(1) + (/[.!?…»"]$/.test(clean) ? "" : ".") : ""; };

/** The local writer: deterministic, so tests and ./scripts/verify never call a model. */
export const fixtureWriter: AiWriter = {
  kind: "fixture",
  async write(input) {
    if (input.action === "shorten") {
      const first = input.text.split(/(?<=[.!?])\s+/)[0];
      return { text: sentence(first.length > writeFields[input.field].max / 2 ? `${first.slice(0, Math.floor(writeFields[input.field].max / 2) - 1).trimEnd()}…` : first) };
    }
    if (input.action === "improve") return { text: sentence(input.text.replace(/\s+([,.;:])/g, "$1")) };
    const where = input.context.lesson || input.context.unit || input.context.course || "este tema";
    const drafts: Record<WriteField, string> = {
      "lesson-objective": `Al terminar la clase, cada estudiante explica con sus palabras ${where.toLowerCase()} y lo aplica en un ejercicio.`,
      "course-objective": `El curso ${where} desarrolla los aprendizajes del nivel con práctica guiada y proyectos. Quien lo termina aplica lo aprendido en situaciones de su entorno.`,
      "unit-objective": `En la unidad ${where} se aprenden sus conceptos principales y se practican con ejercicios graduados.`,
      "report-comment": `${input.context.learner ? `${input.context.learner} ` : "Su hija o hijo "}participa con interés y avanza en ${input.context.course || "el curso"}. Le recomendamos repasar en casa los ejercicios de la unidad para afianzar lo aprendido.`,
      "resource-description": `Recurso de ${input.context.course || "el curso"} para consultar y practicar ${where.toLowerCase()}.`,
      notice: `Aviso sobre ${where}: revisa los detalles y confirma tu participación.`,
      "document-text": "Se hace constar que {{estudiante.nombre}} cursa {{curso.nombre}} en la sección {{seccion.nombre}}.",
    };
    return { text: drafts[input.field] };
  },
};

/** The proposal, if it fits the field; otherwise the reason to show instead. */
export function writtenText(output: WriteOutput, input: WriteInput): { text: string } | { error: string } {
  const text = typeof output?.text === "string" ? output.text.trim() : "";
  if (!text) return { error: "La IA no propuso un texto. Vuelve a intentar." };
  if (text.length > writeFields[input.field].max) return { error: `La propuesta supera los ${writeFields[input.field].max} caracteres del campo. Vuelve a intentar o usa «Más breve».` };
  return { text };
}
