import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
// @ts-expect-error — plain ESM script without type declarations
import { css } from "../scripts/fluent-tokens.mjs";

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

it("keeps the generated Fluent tokens in sync with @fluentui/tokens", () => {
  // Regenerate with `node scripts/fluent-tokens.mjs` after upgrading the package.
  expect(read("apps/web/src/fluent/tokens.css")).toBe(css());
});
it("points every semantic token at a defined Fluent token", () => {
  const fluent = new Set([...read("apps/web/src/fluent/tokens.css").matchAll(/--([A-Za-z0-9-]+):/g)].map(match => match[1]));
  const theme = read("apps/web/src/theme.css");
  const used = [...theme.matchAll(/var\(--((?:color|brand|shadow|border|font|duration|curve)[A-Za-z0-9-]*)\)/g)].map(match => match[1])
    .filter(name => /^(color[A-Z]|brand-|shadow\d|borderRadius|font(Size|Weight|Family)|duration|curve)/.test(name));
  expect(used.length).toBeGreaterThan(40);
  expect(used.filter(name => !fluent.has(name))).toEqual([]);
});
it("keeps colours out of components: only white/black on brand or media surfaces", () => {
  const colours = [...read("apps/web/src/style.css").matchAll(/#[0-9a-fA-F]{3,8}\b|rgba?\(([^)]*)\)/g)].map(match => match[0]);
  const allowed = /^(#fff|#000|#e9eaf1|#0d0f1a|rgba\(255, 255, 255, [.\d]+\)|rgba\(13, 15, 26, \.9\))$/;
  expect(colours.filter(colour => !allowed.test(colour))).toEqual([]);
});

it("lists every component of ui/ in the library levels of docs/design/fluent.md (C.4)", async () => {
  const { readdirSync } = await import("node:fs");
  const exported = readdirSync(new URL("../apps/web/src/ui/", import.meta.url)).filter(name => /\.tsx?$/.test(name))
    .flatMap(name => [...read(`apps/web/src/ui/${name}`).matchAll(/^export (?:function|const) ([A-Z][A-Za-z]+)/gm)].map(match => match[1]));
  const table = read("docs/design/fluent.md").split("## Biblioteca de componentes por niveles")[1].split("\n## ")[0];
  const listed = new Set([...table.matchAll(/`([A-Z][A-Za-z]+)`/g)].map(match => match[1]));
  expect(exported.filter(name => !listed.has(name))).toEqual([]);
  expect([...listed].filter(name => !exported.includes(name))).toEqual([]);
});
