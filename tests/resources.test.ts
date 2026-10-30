import { describe, expect, it } from "vitest";
import { citation, detectHeadings, indexFromOutline, indexRanges, lookupIdentifier, resourceCoverage, resourceFields, resourceInput } from "../packages/domain/src/resources";
import type { CitationResource, IndexEntry, ResourceAuthor } from "../packages/domain/src/resources";

const person = (family: string, given: string): ResourceAuthor => ({ kind: "person", family, given });
const institution = (name: string): ResourceAuthor => ({ kind: "institution", name });
const source = (partial: Partial<CitationResource> & Pick<CitationResource, "type" | "title">): CitationResource => ({
  authors: [], year: 2024, metadata: {}, ...partial,
});

describe("resource records (1.3.7)", () => {
  it("asks each type only for the fields it has", () => {
    expect(resourceFields("book").map(field => field.key)).toEqual(["edition", "publisher", "place", "isbn", "pages"]);
    expect(resourceFields("chapter").map(field => field.key)).toEqual(["book", "editors", "pages", "publisher", "isbn"]);
    expect(resourceFields("article").map(field => field.key)).toEqual(["journal", "volume", "issue", "pages", "doi"]);
    expect(resourceFields("guide").map(field => field.key)).toEqual(["institution", "version", "url"]);
    expect(resourceFields("standard").map(field => field.key)).toEqual(["body", "code", "effective", "url"]);
    expect(resourceFields("score").map(field => field.key)).toEqual(["composer", "arranger", "instrumentation", "publisher"]);
    expect(resourceFields("video").map(field => field.key)).toEqual(["performers", "duration", "platform", "url"]);
    expect(resourceFields("dataset").map(field => field.key)).toEqual(["publisher", "version", "format", "doi", "url"]);
    expect(resourceFields("case").map(field => field.key)).toEqual(["version"]);
    expect(resourceFields("website").map(field => field.key)).toEqual(["site", "retrieved", "url"]);
    expect(resourceFields("other").map(field => field.key)).toEqual(["description"]);
    expect(resourceInput({ type: "book", kind: "reference", title: "  Matemática   6 ", authors: [person("López", "Ana")], year: "2024", metadata: { edition: 3, publisher: "Santillana" }, shareable: false })).toMatchObject({ title: "Matemática 6", year: 2024, metadata: { edition: 3, publisher: "Santillana" } });
    expect(resourceInput({ type: "otro", kind: "file", title: "x", authors: [person("López", "Ana")] })).toEqual({ error: "Elige el tipo de recurso." });
    expect(resourceInput({ type: "book", kind: "file", title: "x", authors: [] })).toEqual({ error: "Escribe la autoría: personas (apellido y nombre) o una institución." });
  });

  it("writes APA 7 for a book, a chapter, an article with a DOI, a standard, a score, a video and a website", () => {
    expect(citation(source({ type: "book", title: "Matemática 6", authors: [person("López", "Ana"), person("Pérez", "María")], metadata: { edition: 3, publisher: "Santillana", place: "Guatemala", isbn: "978-1" } }), "apa7"))
      .toBe("López, A. y Pérez, M. (2024). Matemática 6 (3.ª ed.). Santillana.");
    expect(citation(source({ type: "book", title: "Guía de lectura", authors: [institution("Ministerio de Educación")], year: null, metadata: { publisher: "MINEDUC" } }), "apa7"))
      .toBe("Ministerio de Educación. (s. f.). Guía de lectura. MINEDUC.");
    expect(citation(source({ type: "chapter", title: "Las fracciones equivalentes", authors: [person("López", "Ana")], metadata: { book: "Matemática 6", editors: "M. Pérez", pages: "41-58", publisher: "Santillana" } }), "apa7"))
      .toBe("López, A. (2024). Las fracciones equivalentes. En M. Pérez (Ed.), Matemática 6 (pp. 41–58). Santillana.");
    expect(citation(source({ type: "article", title: "La fracción como relación", authors: [person("López", "Ana"), person("Pérez", "María")], metadata: { journal: "Revista de Educación Matemática", volume: "12", issue: "3", pages: "41-58", doi: "10.1000/fraccion" } }), "apa7"))
      .toBe("López, A. y Pérez, M. (2024). La fracción como relación. Revista de Educación Matemática, 12(3), 41–58. https://doi.org/10.1000/fraccion");
    expect(citation(source({ type: "standard", title: "Currículo Nacional Base", authors: [institution("Ministerio de Educación")], year: 2018, metadata: { code: "CNB", url: "https://cnb.example/norma" } }), "apa7"))
      .toBe("Ministerio de Educación. (2018). Currículo Nacional Base (CNB). https://cnb.example/norma");
    expect(citation(source({ type: "score", title: "Sonatina en do mayor, Op. 36 n.º 1", authors: [person("Clementi", "Muzio")], year: 1797, metadata: { publisher: "Schott" } }), "apa7"))
      .toBe("Clementi, M. (1797). Sonatina en do mayor, Op. 36 n.º 1 [Partitura]. Schott.");
    expect(citation(source({ type: "video", title: "Fracciones equivalentes", authors: [person("López", "Ana")], year: null, metadata: { platform: "YouTube", url: "https://youtu.be/abc" } }), "apa7"))
      .toBe("López, A. (s. f.). Fracciones equivalentes [Video]. YouTube. https://youtu.be/abc");
    expect(citation(source({ type: "website", title: "Fracciones", authors: [institution("Mate fácil")], year: null, metadata: { site: "Mate fácil", retrieved: "2026-10-15", url: "https://mate.example/fracciones" } }), "apa7"))
      .toBe("Mate fácil. (s. f.). Fracciones. Mate fácil. Recuperado el 15 de octubre de 2026, de https://mate.example/fracciones");
    // Without authorship the title moves to the author's place (APA 7, 9.12).
    expect(citation(source({ type: "other", title: "Geometría interactiva", authors: [], year: null }), "apa7")).toBe("Geometría interactiva. (s. f.).");
    expect(citation(source({ type: "book", title: "Manual de geometría", authors: [], year: 2024, metadata: { edition: "2", publisher: "Editorial escolar" } }), "apa7"))
      .toBe("Manual de geometría (2.ª ed.). (2024). Editorial escolar.");
    expect(citation(source({ type: "video", title: "Fracciones", authors: [], year: null, metadata: { platform: "YouTube", url: "https://youtu.be/x" } }), "apa7"))
      .toBe("Fracciones [Video]. (s. f.). YouTube. https://youtu.be/x");
    expect(citation(source({ type: "book", title: "Otra", authors: [person("López", "Ana")], citationOverride: "López, Ana. Otra, s. f." }), "apa7")).toBe("López, Ana. Otra, s. f.");
  });

  it("builds an index from an outline, detects headings and rejects an illegal range", () => {
    const outline = indexFromOutline([{ title: "Capítulo 1", page: 4, children: [{ title: "Las fracciones", page: 5 }] }, { title: "Capítulo 2", page: 10 }]);
    expect(outline.map(entry => [entry.title, entry.startPage, entry.endPage, entry.parentId])).toEqual([
      ["Capítulo 1", 4, 9, null],
      ["Las fracciones", 5, 5, "outline-0"],
      ["Capítulo 2", 10, 10, null],
    ]);
    const detected = detectHeadings([
      { page: 1, text: "Introducción\nEste libro presenta las fracciones." },
      { page: 4, text: "Capítulo 1 Las fracciones\nUna fracción compara dos cantidades." },
      { page: 10, text: "Capítulo 2 Decimales\nUn decimal es otra forma de escribir una fracción." },
      { page: 12, text: "Sigue el mismo tema con más ejemplos de la vida diaria." },
    ]);
    expect(detected.map(entry => [entry.title, entry.startPage, entry.endPage])).toEqual([
      ["Introducción", 1, 3],
      ["Capítulo 1 Las fracciones", 4, 9],
      ["Capítulo 2 Decimales", 10, 12],
    ]);
    const overlap: IndexEntry[] = [
      { id: "a", parentId: null, position: 0, title: "Uno", startPage: 1, endPage: 10, startSeconds: null, endSeconds: null, source: "manual" },
      { id: "b", parentId: null, position: 1, title: "Dos", startPage: 8, endPage: 12, startSeconds: null, endSeconds: null, source: "manual" },
    ];
    expect(indexRanges(overlap)).toBe("«Uno» y «Dos» se solapan.");
    expect(indexRanges([{ id: "a", parentId: null, position: 0, title: "Uno", startPage: 1, endPage: 10, startSeconds: null, endSeconds: null, source: "manual" }, { id: "c", parentId: "a", position: 0, title: "Fuera", startPage: 11, endPage: 12, startSeconds: null, endSeconds: null, source: "manual" }])).toBe("«Fuera» se sale de «Uno».");
    expect(indexRanges([{ id: "a", parentId: null, position: 0, title: "Uno", startPage: 5, endPage: 4, startSeconds: null, endSeconds: null, source: "manual" }])).toBe("El rango de «Uno» termina antes de empezar.");
    expect(indexRanges(outline)).toBeNull();
  });

  it("counts outcomes that have a confirmed indexed resource", () => {
    const coverage = resourceCoverage(
      [{ id: "o1" }, { id: "o2" }, { id: "o3" }],
      [
        { outcomeId: "o1", resourceId: "book", pages: [4, 5], status: "confirmed", chapter: "Capítulo 1" },
        { outcomeId: "o2", resourceId: "book", pages: [], status: "confirmed" },
        { outcomeId: "o3", resourceId: "guide", pages: [1], status: "proposed" },
      ],
    );
    expect(coverage.covered).toBe(1);
    expect(coverage.total).toBe(3);
    expect(coverage.byOutcome.find(item => item.outcomeId === "o1")!.resources).toEqual([{ resourceId: "book", pages: [4, 5], chapter: "Capítulo 1" }]);
    expect(coverage.byOutcome.filter(item => !item.resources.length).map(item => item.outcomeId)).toEqual(["o2", "o3"]);
  });

  it("fills a record from an ISBN or a DOI and gives up when the catalog does not answer", async () => {
    const fetchImpl = (async (url: string) => Response.json(String(url).includes("openlibrary")
      ? { "ISBN:9781": { title: "Matemática 6", authors: [{ name: "Ana López" }], publishers: [{ name: "Santillana" }], publish_date: "2024", number_of_pages: 180 } }
      : { message: { title: ["La fracción"], author: [{ family: "López", given: "Ana" }], issued: { "date-parts": [[2024]] }, "container-title": ["Revista"], volume: "12", DOI: "10.1000/fraccion" } })) as typeof fetch;
    expect(await lookupIdentifier("isbn", "978-1", fetchImpl, 50)).toMatchObject({ record: { type: "book", title: "Matemática 6", year: 2024, authors: [{ family: "López", given: "Ana" }], metadata: { publisher: "Santillana", isbn: "9781" } } });
    expect(await lookupIdentifier("doi", "10.1000/fraccion", fetchImpl, 50)).toMatchObject({ record: { type: "article", title: "La fracción", metadata: { journal: "Revista", doi: "10.1000/fraccion" } } });
    const hanging = ((_: string, init?: RequestInit) => new Promise<Response>((_resolve, reject) => { init?.signal?.addEventListener("abort", () => reject(Object.assign(new Error("timed out"), { name: "TimeoutError" }))); })) as typeof fetch;
    expect(await lookupIdentifier("isbn", "9780000000000", hanging, 20)).toEqual({ error: "timeout" });
  });
});
