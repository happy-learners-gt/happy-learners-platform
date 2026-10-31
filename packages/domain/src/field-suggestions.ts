import type { AiTokenUsage } from "./ai-usage";

/**
 * «Sugerir campos» (1.5.2, docs/design/constructor-de-reportes.md §5): a person writes a document's text as for one
 * student («Se hace constar que Ana López cursa Matemática…») and the designer proposes replacing the parts that are
 * data by the document's fields (`{{estudiante.nombre}}`). Each proposal is accepted one by one; nothing changes alone.
 * Parts that equal a real value of the preview section are found here, without a model; the model adds the rest.
 * Whatever it proposes is checked: the part must be in the text and the field must exist for the document.
 */
export const suggestPromptVersion = "2026-10-31.1";
export interface SuggestField { key: string; label: string; example?: string }
export interface SuggestInput { document: string; text: string; fields: SuggestField[] }
export interface SuggestOutput { suggestions: { original: string; field: string }[] }
export interface FieldSuggestion { original: string; field: string; label: string }
export interface FieldSuggester { readonly kind: "fixture" | "openai"; suggest(input: SuggestInput, observe?: (usage: AiTokenUsage) => void): Promise<SuggestOutput> }

const maxText = 2000, maxSuggestions = 12;

/** The request: a text of a document block and the document's fields, with an example value when there is one. */
export function suggestInput(document: string, text: unknown, fields: SuggestField[]): SuggestInput | { error: string } {
  if (typeof text !== "string" || !text.trim()) return { error: "Escribe el texto del bloque para sugerir sus campos." };
  if (text.length > maxText) return { error: `El texto supera los ${maxText} caracteres de un bloque.` };
  return { document, text, fields: fields.map(item => ({ key: item.key, label: item.label, ...(item.example?.trim() ? { example: item.example.trim().slice(0, 160) } : {}) })) };
}

/** The text outside the fields it already has, so a field is never proposed inside `{{…}}`. */
const plain = (text: string) => text.replace(/\{\{[^}]*\}\}/g, match => " ".repeat(match.length));
const at = (text: string, original: string) => plain(text).toLocaleLowerCase("es").indexOf(original.toLocaleLowerCase("es"));

/** Parts of the text equal to a field's real value (three letters or more), longest values first. */
export function exampleSuggestions(input: SuggestInput): SuggestOutput {
  const found: SuggestOutput["suggestions"] = [];
  let text = plain(input.text);
  for (const field of [...input.fields].filter(item => (item.example?.length || 0) >= 3).sort((a, b) => b.example!.length - a.example!.length)) {
    const index = text.toLocaleLowerCase("es").indexOf(field.example!.toLocaleLowerCase("es"));
    if (index < 0) continue;
    found.push({ original: input.text.slice(index, index + field.example!.length), field: field.key });
    text = text.slice(0, index) + " ".repeat(field.example!.length) + text.slice(index + field.example!.length);
  }
  return { suggestions: found };
}

/** The proposals worth showing, in the order they appear in the text: real parts, known fields, no overlaps. */
export function checkedSuggestions(outputs: SuggestOutput[], input: SuggestInput): FieldSuggestion[] {
  const labels = new Map(input.fields.map(item => [item.key, item.label]));
  const kept: (FieldSuggestion & { start: number })[] = [];
  for (const item of outputs.flatMap(output => Array.isArray(output?.suggestions) ? output.suggestions : [])) {
    const original = typeof item?.original === "string" ? item.original.trim() : "";
    if (!original || original.length > 200 || typeof item.field !== "string" || !labels.has(item.field)) continue;
    const start = at(input.text, original);
    if (start < 0 || kept.some(other => start < other.start + other.original.length && other.start < start + original.length)) continue;
    kept.push({ original: input.text.slice(start, start + original.length), field: item.field, label: labels.get(item.field)!, start });
  }
  return kept.sort((a, b) => a.start - b.start).slice(0, maxSuggestions).map(({ start: _, ...item }) => item);
}

/** The text with every appearance of the part (outside existing fields) replaced by the field. */
export function applySuggestion(text: string, suggestion: { original: string; field: string }) {
  let out = text;
  for (let index = at(out, suggestion.original); index >= 0; index = at(out, suggestion.original)) {
    out = `${out.slice(0, index)}{{${suggestion.field}}}${out.slice(index + suggestion.original.length)}`;
  }
  return out;
}

export const suggestSchema = {
  type: "object", additionalProperties: false, required: ["suggestions"],
  properties: { suggestions: { type: "array", items: { type: "object", additionalProperties: false, required: ["original", "field"], properties: { original: { type: "string" }, field: { type: "string" } } } } },
} as const;

export function suggestPrompt(input: SuggestInput) {
  const system = [
    "Ayudas a convertir el texto de un documento oficial de una institución educativa en una plantilla.",
    "Señala las partes del texto que son datos de cada documento (nombres, curso, sección, fechas, notas…) y el campo de la lista que las reemplaza.",
    "Copia cada parte exactamente como aparece en el texto. Usa solo campos de la lista; si ninguno corresponde, no la señales. No cambies nada más. Devuelve solo el objeto JSON pedido.",
  ].join(" ");
  const fields = input.fields.map(item => `- ${item.key}: ${item.label}${item.example ? ` (ejemplo: ${item.example})` : ""}`).join("\n");
  const user = [`Documento: ${input.document}.`, `Campos:\n${fields}`, `Texto:\n"""\n${input.text}\n"""`].join("\n\n");
  return { system, user };
}

const months = "enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|setiembre|octubre|noviembre|diciembre";
/** The local suggester: deterministic, so tests and ./scripts/verify never call a model. It recognizes a written date. */
export const fixtureSuggester: FieldSuggester = {
  kind: "fixture",
  async suggest(input) {
    const date = new RegExp(`\\b\\d{1,2} de (?:${months}) de \\d{4}\\b`, "i").exec(plain(input.text));
    const today = input.fields.find(item => item.key === "fecha.hoy");
    return { suggestions: date && today ? [{ original: date[0], field: today.key }] : [] };
  },
};
