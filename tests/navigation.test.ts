import { expect, it } from "vitest";
import { menuCourses, moduleNavigation, rememberCourse } from "../packages/domain/src/index";

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

const course = (id: string, updatedAt = "2026-10-01T00:00:00Z", team: string[] = [], status: "active" | "archived" = "active") =>
  ({ id, title: `Curso ${id}`, status, updatedAt, team: team.map(userId => ({ userId })) });
const many = Array.from({ length: 25 }, (_, index) => course(String(index + 10), `2026-10-${String(index + 1).padStart(2, "0")}T00:00:00Z`));

it("IA-01 lists every course while hiding them would save little", () => {
  const ten = many.slice(0, 10);
  expect(menuCourses(ten, { id: "u" })).toEqual({ listed: [...ten].sort((a, b) => a.title.localeCompare(b.title, "es", { numeric: true })), hidden: 0 });
  expect(menuCourses(many.slice(0, 11), { id: "u" }).listed).toHaveLength(8);
});

it("IA-01 lists the open course, then the recent ones, then the team's, then the latest changed, in alphabetical order", () => {
  const courses = [...many, course("team", "2020-01-01T00:00:00Z", ["u"])];
  const { listed, hidden } = menuCourses(courses, { id: "u", current: "10", recent: ["11", "12"] });
  expect(listed.map(item => item.id)).toEqual(["10", "11", "12", "31", "32", "33", "34", "team"]);
  expect(hidden).toBe(18);
  // Without history, the team's courses come before the latest changed.
  expect(menuCourses(courses, { id: "u" }).listed.map(item => item.id)).toEqual(["28", "29", "30", "31", "32", "33", "34", "team"]);
});

it("IA-01 keeps an archived open course listed without counting it as hidden", () => {
  const archived = course("old", "2020-01-01T00:00:00Z", [], "archived");
  const { listed, hidden } = menuCourses([...many, archived], { id: "u", current: "old" });
  expect(listed.map(item => item.id)).toContain("old");
  expect(hidden).toBe(25 - 7);
  expect(menuCourses([...many, archived], { id: "u" }).listed.map(item => item.id)).not.toContain("old");
});

it("IA-01 remembers recent courses most recent first, without repeats and up to the limit", () => {
  expect(rememberCourse(["a", "b", "c"], "b")).toEqual(["b", "a", "c"]);
  expect(rememberCourse(["a", "b", "c", "d", "e", "f", "g", "h"], "i")).toEqual(["i", "a", "b", "c", "d", "e", "f", "g"]);
});
