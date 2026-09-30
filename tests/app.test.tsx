// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { App } from "../apps/web/src/App";
beforeEach(() => { vi.stubGlobal("scrollTo", vi.fn()); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); history.replaceState(null, "", "/"); });
it("shows an accessible Spanish login with explicit synthetic account guidance", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ error: "Inicia sesión para continuar." }, { status: 401 })));
  render(<App/>);
  expect(await screen.findByRole("heading", { name: "Iniciar sesión" })).toBeTruthy();
  expect(screen.getByLabelText("Usuario")).toBeTruthy();
  expect(screen.getByLabelText("Contraseña").getAttribute("type")).toBe("password");
  expect(screen.getByText("Probar con cuentas de demostración")).toBeTruthy();
  expect(screen.getByLabelText("Código de lección")).toBeTruthy();
});
it("preserves the login form and explains network failure", async () => {
  const request = vi.fn().mockResolvedValueOnce(Response.json({}, { status: 401 })).mockRejectedValue(new TypeError("Network"));
  vi.stubGlobal("fetch", request); render(<App/>);
  await screen.findByRole("heading", { name: "Iniciar sesión" });
  fireEvent.change(screen.getByLabelText("Contraseña"), { target: { value: "invalid" } });
  fireEvent.submit(screen.getByRole("button", { name: "Entrar" }).closest("form")!);
  expect((await screen.findByRole("alert")).textContent).toContain("Comprueba tu conexión");
  expect((screen.getByLabelText("Usuario") as HTMLInputElement).value).toBe("educador-demo");
});
it("asks to sign in again over the current page when the session expires", async () => {
  const member = { id: "user-1", username: "educador-demo", role: "educator", organizationId: "org-demo" };
  vi.stubGlobal("fetch", vi.fn(async (input: string) => {
    if (input === "/api/session") return Response.json({ member });
    if (input === "/api/organization") return Response.json({ organization: { id: "org-demo", name: "Escuela", timezone: "America/Guatemala", configured: true } });
    return Response.json({ error: "Inicia sesión para continuar." }, { status: 401 });
  }));
  history.replaceState(null, "", "/inicio");
  render(<App/>);
  expect(await screen.findByRole("heading", { level: 1, name: "Inicio" })).toBeTruthy();
  expect(await screen.findByRole("heading", { name: "Tu sesión terminó" })).toBeTruthy();
  expect((screen.getByLabelText("Usuario", { selector: "#renew-username" }) as HTMLInputElement).value).toBe("educador-demo");
  expect(screen.getByRole("navigation", { name: "Navegación principal" })).toBeTruthy();
});
