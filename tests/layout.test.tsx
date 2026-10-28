// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { floatingPosition } from "../apps/web/src/ui/Menu";
import { labelTables } from "../apps/web/src/ui/responsiveTables";

// The layout standard (docs/design/fluent.md, point 9): floating menus never leave the screen and list tables carry
// the labels they show as stacked cards on phones.
const rect = (left: number, top: number, width = 36, height = 36) => ({ left, top, right: left + width, bottom: top + height, width, height, x: left, y: top, toJSON: () => ({}) }) as DOMRect;
const phone = { width: 390, height: 844 };

describe("floating menus", () => {
  it("align to the trigger's end, and to its start when the end would leave the screen on the left", () => {
    expect(floatingPosition(rect(340, 100), { width: 220, height: 200 }, phone)).toMatchObject({ left: 156, top: 140 });
    // A trigger at the left edge (a row that wrapped): the list opens to the right instead of off screen.
    expect(floatingPosition(rect(16, 100), { width: 220, height: 200 }, phone)).toMatchObject({ left: 16, top: 140 });
  });

  it("shift to stay 8 px inside the viewport and flip above the trigger when there is no room below", () => {
    expect(floatingPosition(rect(180, 100), { width: 220, height: 200 }, phone, "start")).toMatchObject({ left: 162 });
    const up = floatingPosition(rect(300, 780), { width: 220, height: 300 }, phone);
    expect(up).toMatchObject({ top: 476, transformOrigin: "bottom" });
    // Taller than both sides: on the side with more room, capped by it and scrolled inside.
    const tall = floatingPosition(rect(300, 400), { width: 220, height: 2000 }, phone);
    expect(tall).toMatchObject({ top: 440, maxHeight: 396 });
    // Wider than the screen: as wide as the screen allows.
    expect(floatingPosition(rect(300, 100), { width: 600, height: 100 }, phone)).toMatchObject({ left: 8, maxWidth: 374 });
  });
});

describe("list tables on phones", () => {
  it("label each cell with its column, keep labels a page set and leave matrix tables alone", () => {
    document.body.innerHTML = `<table class="members-table"><thead><tr><th>Persona</th><th>Rol</th><th>Contrato</th></tr></thead>
      <tbody><tr><td>Ana</td><td>Educador</td><td data-label="Propio">Vigente</td></tr><tr><td colspan="2">Sin datos</td><td>—</td></tr></tbody></table>
      <table class="members-table notification-matrix"><thead><tr><th>Aviso</th></tr></thead><tbody><tr><td>X</td></tr></tbody></table>`;
    labelTables(document);
    const [list, matrix] = document.querySelectorAll("table");
    expect([...list.querySelectorAll("tbody tr:first-child td")].map(cell => cell.getAttribute("data-label"))).toEqual(["Persona", "Rol", "Propio"]);
    expect([...list.querySelectorAll("tbody tr:last-child td")].map(cell => cell.getAttribute("data-label"))).toEqual(["Persona", "Contrato"]);
    expect(matrix.querySelector("td")!.hasAttribute("data-label")).toBe(false);
  });
});
