// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { App } from "../apps/web/src/App";

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
const catalog = { resources: [{ id: "r1", title: "Colors", description: "Practice colors", level: "Inicial", skill: "lectura", topic: "Colores", tags: ["vocabulario"], content: "red", status: "publicado" }], lessons: [] };
it("permite entrar al espacio del educador y buscar recursos", async () => {
  vi.stubGlobal("fetch", vi.fn(async (path: string) => path.endsWith("/state") ? Response.json(catalog) : path.endsWith("/login") ? Response.json({ session: { user: "Educador", role: "educador" } }) : Response.json(catalog)));
  render(<App />); fireEvent.change(screen.getByLabelText("Código"), { target: { value: "san-gaspar" } }); fireEvent.click(screen.getByText("Entrar"));
  expect(await screen.findByText("Biblioteca de enseñanza")).toBeTruthy(); expect(screen.getByText("Colors")).toBeTruthy();
  fireEvent.change(screen.getByLabelText("Buscar recursos"), { target: { value: "inexistente" } }); expect(screen.queryByText("Colors")).toBeNull();
});
it("muestra un error si el código no es válido", async () => {
  vi.stubGlobal("fetch", vi.fn(async (path: string) => path.endsWith("/state") ? Response.json(catalog) : new Response(JSON.stringify({ error: "Código no válido" }), { status: 401, headers: { "Content-Type": "application/json" } })));
  render(<App />); fireEvent.change(screen.getByLabelText("Código"), { target: { value: "no" } }); fireEvent.click(screen.getByText("Entrar")); expect((await screen.findByRole("alert")).textContent).toContain("Código no válido");
});
