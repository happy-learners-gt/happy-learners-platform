import { describe, expect, it } from "vitest";
import { fixtureMapper, mapPrompt, pagesInput, verifiedPages } from "../packages/domain/src/index";
import { openAiMapper } from "../apps/api/src/openai";

// Rebanada 5b: the book map. A model's answer only counts when its quote is really on the page it names.
const candidates = [
  { page: 2, text: "Polígonos regulares e irregulares. Un polígono regular tiene todos sus lados y ángulos iguales." },
  { page: 3, text: "Perímetro y área. El perímetro de un polígono es la suma de sus lados. Circunferencia y área del círculo." },
];

describe("book map rules", () => {
  it("keeps only pages whose quote is on that page, tolerating case, accents and spacing", () => {
    const result = verifiedPages({ pages: [
      { page: 3, relevant: true, quote: "el PERIMETRO de un  polígono es la suma de sus lados" },
      { page: 2, relevant: true, quote: "Los polígonos se estudian con transportador y regla." },
      { page: 9, relevant: true, quote: "Una página que no era candidata." },
      { page: 2, relevant: false, quote: "" },
    ] }, candidates);
    expect(result).toEqual({ pages: [3], evidence: [{ page: 3, quote: "el PERIMETRO de un  polígono es la suma de sus lados" }], dropped: 2 });
    expect(verifiedPages({ pages: [{ page: 3, relevant: true, quote: "área" }] }, candidates).pages).toEqual([]);
    expect(verifiedPages({} as never, candidates)).toEqual({ pages: [], evidence: [], dropped: 0 });
  });

  it("reads the pages a reviewer types", () => {
    expect(pagesInput("12, 15-17, 12", 100)).toEqual([12, 15, 16, 17]);
    expect(pagesInput("", 100)).toEqual([]);
    expect(pagesInput([3, 1], 10)).toEqual([1, 3]);
    for (const bad of ["0", "101", "5-3", "a", "1-60"]) expect(pagesInput(bad, 100), bad).toBeNull();
  });

  it("the fixture mapper quotes real sentences, so its pages always verify", async () => {
    const outcome = { statement: "Calcula perímetro y área de diferentes polígonos y del círculo.", code: "1.2", contents: ["1.2.3. Cálculo de circunferencia y área del círculo."] };
    const result = verifiedPages(await fixtureMapper.map({ outcome, candidates }), candidates);
    expect(result.pages).toContain(3);
    expect(result.dropped).toBe(0);
    const { user } = mapPrompt({ outcome, candidates });
    expect(user).toContain("[p. 3]");
    expect(user).toContain("frase EXACTA");
  });

  it("asks OpenAI for the book map with its own strict schema (no network)", async () => {
    let body: Record<string, unknown> = {};
    const mapper = openAiMapper({ key: "k", model: "m" }, async (_, init) => { body = JSON.parse(String(init!.body)); return new Response(JSON.stringify({ status: "completed", output: [{ type: "message", content: [{ type: "output_text", text: JSON.stringify({ pages: [{ page: 3, relevant: true, quote: "Circunferencia y área del círculo." }] }) }] }] })); });
    const output = await mapper.map({ outcome: { statement: "x", code: null, contents: [] }, candidates });
    expect(body).toMatchObject({ store: false, text: { format: { name: "book_map", strict: true } } });
    expect(verifiedPages(output, candidates).pages).toEqual([3]);
  });
});
