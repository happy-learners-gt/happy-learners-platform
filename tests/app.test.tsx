// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { App } from "../apps/web/src/App";
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
it("shows an accessible Spanish login with explicit synthetic account guidance", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ error: "Inicia sesión para continuar." }, { status: 401 })));
  render(<App/>);
  expect(await screen.findByRole("heading", { name: "Iniciar sesión" })).toBeTruthy();
  expect(screen.getByLabelText("Usuario")).toBeTruthy();
  expect(screen.getByLabelText("Contraseña").getAttribute("type")).toBe("password");
  expect(screen.getByText("Probar con datos ficticios")).toBeTruthy();
});
it("preserves the login form and explains network failure", async () => {
  const request = vi.fn().mockResolvedValueOnce(Response.json({}, { status: 401 })).mockRejectedValue(new TypeError("Network"));
  vi.stubGlobal("fetch", request); render(<App/>);
  await screen.findByRole("heading", { name: "Iniciar sesión" });
  fireEvent.change(screen.getByLabelText("Contraseña"), { target: { value: "invalid" } });
  fireEvent.submit(screen.getByRole("button", { name: /Entrar a mi espacio/ }).closest("form")!);
  expect((await screen.findByRole("alert")).textContent).toContain("Comprueba tu conexión");
  expect((screen.getByLabelText("Usuario") as HTMLInputElement).value).toBe("instructor-demo");
});
