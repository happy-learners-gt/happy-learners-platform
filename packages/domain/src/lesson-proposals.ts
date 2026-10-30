import type { Activity, ActivityBlock, ActivityGrouping, ActivityPurpose } from "@happy-learners/contracts";

/**
 * Lesson proposals. For a learning outcome of the course's plan (a CNB indicator, with its contents when it comes
 * from a package), the pages of the main book that work on it are found with a deterministic lexical search; a
 * generator (a language model, or a local fixture) proposes one lesson from those pages, following the moments of
 * the course's didactic sequence. Its answer is a small structured object that the platform turns into its own
 * lesson model and validates; the lesson is always a draft for the team to review and publish.
 */
export const proposalPromptVersion = "2026-10-27.1";
export const proposalBatch = 3, maxProposalItems = 12, maxExcerpt = 6000, pagesPerProposal = 3;
export const proposalStatusLabels = { queued: "En cola", running: "En curso", done: "Listo", error: "Error" } as const;

// Spanish words too common to tell pages apart.
const stopwords = new Set("para como esta este estos estas sobre entre desde hasta donde cuando cual cuales porque tiene tienen hacer cada otra otro otros otras todo todos toda todas puede pueden segun tambien pero sino aunque mismo misma ellos ellas nuestra nuestro sus una unos unas las los del con por que mas sus diferentes diferente situaciones aplicando utilizando realizacion identificacion calculo descripcion establecimiento utilizacion".split(" "));
/** Words of a text without accents or case, of four letters or more, with a light plural stem. */
export function terms(text: string): string[] {
  return text.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().match(/[a-zñ]{4,}/g)?.filter(word => !stopwords.has(word)).map(word => word.replace(/(es|s)$/, "")) || [];
}

export type BookPage = { page: number; text: string };
/**
 * The pages of the book that best match an outcome and its contents, by term frequency weighted by how rare each
 * term is in the book (TF-IDF), keeping those at least half as relevant as the best. Deterministic: the same book and outcome always give the same pages, in page order.
 */
export function relevantPages(query: string, pages: BookPage[], limit = pagesPerProposal): { page: number; score: number }[] {
  const wanted = [...new Set(terms(query))];
  if (!wanted.length || !pages.length) return [];
  const counted = pages.map(page => { const counts = new Map<string, number>(); for (const term of terms(page.text)) counts.set(term, (counts.get(term) || 0) + 1); return { page: page.page, counts }; });
  const idf = new Map(wanted.map(term => [term, Math.log((pages.length + 1) / (counted.filter(page => page.counts.has(term)).length + 0.5))]));
  return counted
    .map(page => ({ page: page.page, score: Math.round(wanted.reduce((sum, term) => sum + (page.counts.has(term) ? (1 + Math.log(page.counts.get(term)!)) * idf.get(term)! : 0), 0) * 1000) / 1000 }))
    .filter(page => page.score > 0).sort((a, b) => b.score - a.score || a.page - b.page)
    // A page far below the best one only shares a word or two: it is left out.
    .filter((page, _, ranked) => page.score >= ranked[0].score * 0.5).slice(0, limit).sort((a, b) => a.page - b.page);
}
/** «p. 12», «pp. 12–14», «pp. 12, 18»: how a lesson cites the pages it comes from. */
export function pagesLabel(pages: number[]) {
  if (!pages.length) return "";
  if (pages.length === 1) return `p. ${pages[0]}`;
  const contiguous = pages.every((page, index) => index === 0 || page === pages[index - 1] + 1);
  return contiguous ? `pp. ${pages[0]}–${pages[pages.length - 1]}` : `pp. ${pages.join(", ")}`;
}

/** Everything a generator receives: only what this lesson needs, never the whole book. */
export interface ProposalInput {
  course: string; grade: string; minutes: number;
  sequence: { label: string; phases: { id: string; label: string; hint: string }[] };
  outcome: { id: string; statement: string; code: string | null; competency: string | null; contents: string[] };
  book: { title: string; fileId: string; pages: number[]; excerpt: string };
  /** Indexed resources the person kept checked. Absent means the proposal uses only the main book, as before. */
  sources?: { resourceId: string; fileId: string; title: string; chapter: string | null; pages: number[]; excerpt: string }[];
}
/** What a generator answers: plain fields the platform turns into its lesson model. */
export interface ProposalOutput {
  title: string; objective: string;
  activities: { title: string; phase: string; purpose: ActivityPurpose; grouping: ActivityGrouping; minutes: number; instructions: string; question: { prompt: string; options: string[]; answer: number } | null }[];
}
/** The port: a language model in production, a deterministic fixture in tests and local demonstrations. */
export interface LessonDraftGenerator { readonly kind: "fixture" | "openai"; generate(input: ProposalInput): Promise<ProposalOutput> }

/** The structured output a model must follow (JSON Schema, strict: every field required, nothing else). */
export const proposalSchema = {
  type: "object", additionalProperties: false, required: ["title", "objective", "activities"],
  properties: {
    title: { type: "string" }, objective: { type: "string" },
    activities: { type: "array", items: { type: "object", additionalProperties: false, required: ["title", "phase", "purpose", "grouping", "minutes", "instructions", "question"],
      properties: {
        title: { type: "string" }, phase: { type: "string" }, purpose: { type: "string", enum: ["explain", "explore", "practice", "assess", "reflect"] },
        grouping: { type: "string", enum: ["individual", "pairs", "teams", "whole-class"] }, minutes: { type: "integer" }, instructions: { type: "string" },
        question: { anyOf: [{ type: "null" }, { type: "object", additionalProperties: false, required: ["prompt", "options", "answer"], properties: { prompt: { type: "string" }, options: { type: "array", items: { type: "string" } }, answer: { type: "integer" } } }] },
      } } },
  },
} as const;

/** The instructions for a language model: Guatemalan school Spanish, the book's pages as the only source. */
export function proposalPrompt(input: ProposalInput) {
  const system = [
    "Eres docente de primaria en Guatemala y preparas lecciones a partir del libro de texto del curso y del Currículo Nacional Base (CNB).",
    "Escribe en español de Guatemala, claro y concreto, tuteando a quien imparte. No inventes datos, páginas ni contenidos que no estén en el fragmento del libro.",
    "Devuelve solo el objeto JSON pedido.",
  ].join(" ");
  const user = [
    `Curso: ${input.course}. Grado: ${input.grade}. Duración de la clase: ${input.minutes} minutos.`,
    `Resultado de aprendizaje (indicador${input.outcome.code ? ` ${input.outcome.code}` : ""}): ${input.outcome.statement}`,
    input.outcome.competency ? `Competencia: ${input.outcome.competency}` : "",
    input.outcome.contents.length ? `Contenidos del CNB:\n- ${input.outcome.contents.join("\n- ")}` : "",
    `Secuencia didáctica «${input.sequence.label}». Usa exactamente estos momentos, en este orden, con su id en "phase":\n${input.sequence.phases.map(phase => `- ${phase.id}: ${phase.label}. ${phase.hint}`).join("\n")}`,
    `Fragmento del libro «${input.book.title}» (${pagesLabel(input.book.pages)}):\n"""\n${input.book.excerpt}\n"""`,
    input.sources?.length ? `Otras fuentes indexadas, además del libro. Cita cada una con su capítulo y sus páginas, y no cites una página que no esté en su fragmento:\n${input.sources.map(source => `- «${source.title}»${source.chapter ? `, ${source.chapter}` : ""}, ${pagesLabel(source.pages)}:\n"""\n${source.excerpt}\n"""`).join("\n")}` : "",
    "Propón una lección: título (hasta 120 caracteres), objetivo (una oración) y de 3 a 6 actividades. Los minutos deben sumar la duración de la clase.",
    "Cada actividad dice qué hacen los estudiantes y cita las páginas del libro que usa. Incluye al menos una actividad con propósito \"assess\" con una pregunta de opción múltiple (de 3 a 4 opciones, answer es el índice de la correcta desde 0). En las demás, question es null.",
  ].filter(Boolean).join("\n\n");
  return { system, user };
}

/**
 * The fixture generator: a deterministic proposal built from the same input, one activity per moment of the
 * sequence and a closing question. It never calls anything; tests and local demonstrations use it.
 */
export const fixtureGenerator: LessonDraftGenerator = {
  kind: "fixture",
  async generate(input) {
    const phases = input.sequence.phases, cite = pagesLabel(input.book.pages);
    const base = Math.floor(input.minutes / phases.length), extra = input.minutes - base * phases.length;
    const content = (input.outcome.contents[0]?.replace(/^[\d.]+\s*/, "") || input.outcome.statement).replace(/\.+$/, "");
    // The excerpt marks where each page starts ([p. 12]); the quoted sentence leaves those marks out.
    const first = input.book.excerpt.replace(/\[p\. \d+\]\s*/g, "").split(/(?<=[.!?])\s+/)[0]?.slice(0, 200).replace(/\.$/, "") || "";
    const cited = (input.sources || []).map(source => `«${source.title}»${source.chapter ? `, ${source.chapter}` : ""}, ${pagesLabel(source.pages)}.`).join(" ");
    return {
      title: `${input.outcome.code ? `${input.outcome.code} · ` : ""}${input.outcome.statement}`.slice(0, 120),
      objective: `Al terminar, cada estudiante ${input.outcome.statement.charAt(0).toLocaleLowerCase("es")}${input.outcome.statement.slice(1)}`.replace(/\.?$/, "."),
      activities: phases.map((phase, index) => {
        const last = index === phases.length - 1;
        return {
          title: `${phase.label}: ${last ? "comprobamos lo aprendido" : index === 0 ? "partimos de lo que sabemos" : content.slice(0, 80)}`,
          phase: phase.id, purpose: last ? "assess" : index === 0 ? "explore" : "practice", grouping: last ? "individual" : index === 0 ? "whole-class" : "pairs",
          minutes: base + (last ? extra : 0),
          instructions: last ? `Responde la pregunta y comenta tu respuesta con tu pareja. Libro, ${cite}.`
            : index === 0 ? `Lee con el grupo el inicio del tema en el libro (${cite})${first ? `: «${first}»` : ""}. Pregunta qué saben de ${content.toLocaleLowerCase("es")}.${cited ? ` También: ${cited}` : ""}`
            : `Trabaja en parejas los ejercicios del libro (${cite}) sobre ${content.toLocaleLowerCase("es")}.`,
          question: last ? { prompt: `¿Qué contenido trabajamos hoy con el libro (${cite})?`, options: [content.slice(0, 180), "Un tema que no está en el libro", "Ninguno de los anteriores"], answer: 0 } : null,
        };
      }),
    };
  },
};

const clip = (text: unknown, max: number) => typeof text === "string" ? text.trim().replace(/\s+/g, " ").slice(0, max) : "";
/**
 * Turns a generator's answer into activities of the lesson model: each with its moment, purpose and grouping, a text
 * block, a question block when it asks one, the book as a resource and the outcome it works on. What the answer says
 * is clipped to the model's limits; a moment the sequence does not have falls back to its first one.
 */
export function draftFromOutput(output: ProposalOutput, input: ProposalInput): { title: string; objective: string; activities: Activity[] } {
  const phases = new Set(input.sequence.phases.map(phase => phase.id));
  const activities = (Array.isArray(output.activities) ? output.activities : []).slice(0, 8).map((activity, position): Activity => {
    const blocks: ActivityBlock[] = [{ id: `p${position}-text`, kind: "text", instructions: clip(activity.instructions, 3800) }];
    const question = activity.question;
    if (question && Array.isArray(question.options)) {
      const options = [...new Set(question.options.map(option => clip(option, 200)).filter(Boolean))].slice(0, 6);
      if (options.length >= 2 && Number.isInteger(question.answer) && question.answer >= 0 && question.answer < options.length)
        blocks.push({ id: `p${position}-question`, kind: "question", instructions: clip(question.prompt, 3800), options, answer: question.answer });
    }
    if (position === 0) {
      blocks.push({ id: `p${position}-book`, kind: "resource", resourceId: input.book.fileId, instructions: `Libro: ${input.book.title}, ${pagesLabel(input.book.pages)}.` });
      for (const source of (input.sources || []).filter(source => source.fileId !== input.book.fileId))
        blocks.push({ id: `p${position}-${source.resourceId}`, kind: "resource", resourceId: source.fileId, chapter: source.chapter || undefined, pages: pagesLabel(source.pages), instructions: `«${source.title}»${source.chapter ? `, ${source.chapter}` : ""}, ${pagesLabel(source.pages)}.` });
    }
    return {
      id: `proposal-${position}`, position, title: clip(activity.title, 160) || `Actividad ${position + 1}`, minutes: Math.min(120, Math.max(1, Math.round(Number(activity.minutes) || 1))),
      phase: phases.has(activity.phase) ? activity.phase : input.sequence.phases[0].id, purpose: activity.purpose, grouping: activity.grouping,
      outcomeIds: [input.outcome.id], instructions: "", blocks,
    };
  });
  return { title: clip(output.title, 160), objective: clip(output.objective, 1000), activities };
}

/** What makes a proposal unusable, beyond the lesson model's own validation; null when it is fine. */
export function proposalProblem(draft: { title: string; objective: string; activities: Activity[] }, input: ProposalInput): string | null {
  if (!draft.title || !draft.objective) return "La propuesta no tiene título u objetivo.";
  if (draft.activities.length < 2) return "La propuesta tiene menos de dos actividades.";
  if (!draft.activities.some(activity => activity.purpose === "assess" && activity.blocks?.some(block => block.kind === "question"))) return "La propuesta no comprueba lo aprendido con una pregunta.";
  const total = draft.activities.reduce((sum, activity) => sum + activity.minutes, 0);
  if (Math.abs(total - input.minutes) > Math.max(5, input.minutes * 0.2)) return `Las actividades suman ${total} minutos y la clase dura ${input.minutes}.`;
  return null;
}

const plainCitation = (text: string) => text.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\s+/g, " ").trim();
/** A citation is verified only when the quoted sentence is really on that page of that resource. */
export function sourceCitationVerified(quote: string, pageText: string | undefined): boolean {
  const clean = quote.trim();
  return clean.length >= 8 && !!pageText && plainCitation(pageText).includes(plainCitation(clean));
}
/** The sentence a source's excerpt actually starts with: what a citation may claim. */
export function sourceQuote(excerpt: string): string {
  return excerpt.replace(/\[p\. \d+\]\s*/g, "").split(/(?<=[.!?])\s+/)[0]?.trim().slice(0, 200) || "";
}
