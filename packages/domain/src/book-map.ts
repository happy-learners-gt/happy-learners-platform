import type { BookPage } from "./lesson-proposals";
import { relevantPages } from "./lesson-proposals";

/**
 * The book map (rebanada 5b): which pages of the course's main book work on each indicator of its plan, with evidence.
 * A lexical search proposes candidate pages; a language model (or a local fixture) may confirm them, quoting each page;
 * the team reviews and confirms the map. A model's quote is only accepted when it is really on that page, so a page
 * the model imagined never enters the map. Confirmed pages are what lesson proposals use.
 */
export const mapCandidates = 5, maxCandidateText = 1500, maxQuote = 240;
export const mapSourceLabels = { lexical: "Búsqueda en el texto", ai: "Revisado con IA", teacher: "Revisado por el equipo" } as const;
export type MapSource = keyof typeof mapSourceLabels;
export type MapEvidence = { page: number; quote: string };

/** The candidate pages of an indicator: more than a proposal uses, so a reviewer (or a model) can choose among them. */
export const mapCandidatePages = (query: string, pages: BookPage[]) => relevantPages(query, pages, mapCandidates);

/** What a mapper receives for one indicator: the indicator and the text of its candidate pages. */
export interface MapInput { outcome: { statement: string; code: string | null; contents: string[] }; candidates: { page: number; text: string }[] }
/** What a mapper answers, page by page. */
export interface MapOutput { pages: { page: number; relevant: boolean; quote: string }[] }
/** The port: a language model in production, a deterministic fixture in tests and local demonstrations. */
export interface BookMapper { readonly kind: "fixture" | "openai"; map(input: MapInput): Promise<MapOutput> }

export const mapSchema = {
  type: "object", additionalProperties: false, required: ["pages"],
  properties: { pages: { type: "array", items: { type: "object", additionalProperties: false, required: ["page", "relevant", "quote"], properties: { page: { type: "integer" }, relevant: { type: "boolean" }, quote: { type: "string" } } } } },
} as const;

export function mapPrompt(input: MapInput) {
  const system = "Eres docente de primaria en Guatemala. Decides qué páginas de un libro de texto trabajan un indicador de logro del Currículo Nacional Base (CNB). Responde solo con el JSON pedido.";
  const user = [
    `Indicador${input.outcome.code ? ` ${input.outcome.code}` : ""}: ${input.outcome.statement}`,
    input.outcome.contents.length ? `Contenidos del CNB:\n- ${input.outcome.contents.join("\n- ")}` : "",
    `Páginas candidatas del libro:\n${input.candidates.map(page => `[p. ${page.page}]\n"""\n${page.text}\n"""`).join("\n")}`,
    "Para cada página candidata indica si trabaja el indicador (relevant). Si sí, copia en quote una frase EXACTA de esa página (hasta 200 caracteres) que lo demuestre; si no, quote es \"\". No inventes páginas ni frases.",
  ].filter(Boolean).join("\n\n");
  return { system, user };
}

const plain = (text: string) => text.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[“”«»"]/g, "\"").replace(/\s+/g, " ").trim();
/**
 * The pages a mapper's answer supports: candidates it says are relevant whose quote is really on that page (ignoring
 * case, accents and spacing). Pages it imagined, or quotes it made up, are dropped and counted.
 */
export function verifiedPages(output: MapOutput, candidates: { page: number; text: string }[]): { pages: number[]; evidence: MapEvidence[]; dropped: number } {
  const evidence: MapEvidence[] = []; let dropped = 0;
  for (const answer of Array.isArray(output?.pages) ? output.pages : []) {
    if (!answer || !answer.relevant) continue;
    const page = candidates.find(item => item.page === answer.page), quote = typeof answer.quote === "string" ? answer.quote.trim().slice(0, maxQuote) : "";
    if (!page || quote.length < 8 || !plain(page.text).includes(plain(quote)) || evidence.some(item => item.page === page.page)) { dropped++; continue; }
    evidence.push({ page: page.page, quote });
  }
  evidence.sort((a, b) => a.page - b.page);
  return { pages: evidence.map(item => item.page), evidence, dropped };
}

/** The fixture mapper: a page is relevant when it shares the indicator's words, quoting the sentence that shares most. */
export const fixtureMapper: BookMapper = {
  kind: "fixture",
  async map(input) {
    const query = [input.outcome.statement, ...input.outcome.contents].join(" ");
    const kept = new Set(relevantPages(query, input.candidates.map(({ page, text }) => ({ page, text })), mapCandidates).map(page => page.page));
    const words = new Set(query.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().match(/[a-zñ]{5,}/g) || []);
    return { pages: input.candidates.map(candidate => {
      const sentences = candidate.text.split(/(?<=[.!?])\s+/);
      const best = sentences.map(sentence => ({ sentence, hits: (sentence.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().match(/[a-zñ]{5,}/g) || []).filter(word => words.has(word)).length }))
        .sort((a, b) => b.hits - a.hits)[0];
      return { page: candidate.page, relevant: kept.has(candidate.page) && !!best?.hits, quote: kept.has(candidate.page) && best ? best.sentence.slice(0, 200) : "" };
    }) };
  },
};

/** «2, 5-7» → [2, 5, 6, 7]: pages a reviewer types, within the book; null when it is not a valid list. */
export function pagesInput(text: unknown, total: number): number[] | null {
  if (Array.isArray(text)) return text.every(page => Number.isInteger(page) && page >= 1 && page <= total) && text.length <= 40 ? [...new Set(text as number[])].sort((a, b) => a - b) : null;
  if (typeof text !== "string") return null;
  const pages = new Set<number>();
  for (const part of text.split(",").map(item => item.trim()).filter(Boolean)) {
    const match = /^(\d+)(?:\s*[-–]\s*(\d+))?$/.exec(part);
    if (!match) return null;
    const from = Number(match[1]), until = Number(match[2] ?? match[1]);
    if (from < 1 || until < from || until > total || until - from > 40) return null;
    for (let page = from; page <= until; page++) pages.add(page);
  }
  return pages.size <= 40 ? [...pages].sort((a, b) => a - b) : null;
}
