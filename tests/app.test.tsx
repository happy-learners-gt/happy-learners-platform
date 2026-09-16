// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { App } from "../apps/web/src/App";

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
it("shows availability and the complete version returned by the API", async () => {
  const sha = "1234567890abcdef1234567890abcdef12345678";
  vi.stubGlobal("fetch", vi.fn(async (path: string) => Response.json(path.endsWith("health") ? { status: "ok" } : { sha })));
  render(<App />);
  expect(await screen.findByText(sha)).toBeTruthy();
  expect(screen.getByRole("status").textContent).toBe("Happy Learners está disponible.");
});
it.each(["http", "network", "invalid"])("does not claim availability after %s failure", async (failure) => {
  vi.stubGlobal("fetch", vi.fn(async () => {
    if (failure === "network") throw new Error("offline");
    return failure === "http" ? new Response(null, { status: 503 }) : Response.json({ status: "ok", sha: "unknown" });
  }));
  render(<App />);
  expect(await screen.findByText(/No pudimos comprobar/)).toBeTruthy();
  expect(screen.queryByText(/Versión desplegada/)).toBeNull();
});
