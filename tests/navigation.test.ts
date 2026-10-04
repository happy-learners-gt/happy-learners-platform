import { expect, it } from "vitest";
import { moduleNavigation } from "../packages/domain/src/index";

const lessons = [
  { id: "a", title: "Saludos", shareCode: "D-A", published: true, archived: false },
  { id: "b", title: "Borrador", shareCode: "D-B", published: false, archived: false },
  { id: "c", title: "Colores", shareCode: "D-C", published: true, archived: false },
  { id: "d", title: "Archivada", shareCode: "D-D", published: true, archived: true },
  { id: "e", title: "Despedidas", shareCode: "D-E", published: true, archived: false },
];

it("ST-032 shows the position in the module counting only published lessons", () => {
  expect(moduleNavigation("Módulo 1", lessons, "c")).toMatchObject({ moduleName: "Módulo 1", position: 2, total: 3 });
});

it("ST-032 moves forward and back between published lessons", () => {
  const middle = moduleNavigation("Módulo 1", lessons, "c")!;
  expect(middle.previous).toEqual({ title: "Saludos", shareCode: "D-A" });
  expect(middle.next).toEqual({ title: "Despedidas", shareCode: "D-E" });
  expect(moduleNavigation("Módulo 1", lessons, "a")!.previous).toBeNull();
  expect(moduleNavigation("Módulo 1", lessons, "e")!.next).toBeNull();
});

it("ST-032 skips unpublished and archived lessons and never navigates from one", () => {
  expect(moduleNavigation("Módulo 1", lessons, "a")!.next).toEqual({ title: "Colores", shareCode: "D-C" });
  expect(moduleNavigation("Módulo 1", lessons, "b")).toBeNull();
  expect(moduleNavigation("Módulo 1", lessons, "d")).toBeNull();
});
