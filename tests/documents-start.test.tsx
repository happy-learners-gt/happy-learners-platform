// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { defaultTemplate, reportKinds } from "../packages/domain/src/index";
import { App } from "../apps/web/src/App";

beforeEach(() => { vi.stubGlobal("scrollTo", vi.fn()); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); history.replaceState(null, "", "/"); });

it("Documentos without templates starts one from a document's usual format in one step and opens the designer", async () => {
  const member = { id: "user-0", username: "admin-demo", role: "admin", organizationId: "org-demo", permissions: { admin: true, coordination: null, grants: {} } };
  const created: unknown[] = [];
  vi.stubGlobal("fetch", vi.fn(async (input: string, init?: RequestInit) => {
    if (input === "/api/session") return Response.json({ member, pending: [] });
    if (input === "/api/organization") return Response.json({ organization: { id: "org-demo", name: "Escuela", timezone: "America/Guatemala", configured: true } });
    if (input === "/api/report-templates" && init?.method === "POST") { created.push(JSON.parse(String(init.body))); return Response.json({ template: { id: "tpl-1" } }, { status: 201 }); }
    if (input === "/api/report-templates") return Response.json({ templates: [], kinds: reportKinds });
    if (input === "/api/programs") return Response.json({ programs: [] });
    // The designer it opens reads the new template, its versions, the institution's images, sections and courses.
    if (input === "/api/report-templates/tpl-1") return Response.json({ template: { id: "tpl-1", kind: "certificate", programId: null, programName: null, name: "Constancia", draft: defaultTemplate("certificate"), publishedVersion: null, updatedAt: "t" }, versions: [] });
    if (input.startsWith("/api/report-images")) return Response.json({ images: [] });
    if (input === "/api/sections") return Response.json({ sections: [] });
    if (input === "/api/courses") return Response.json({ courses: [] });
    return Response.json({});
  }));
  history.replaceState(null, "", "/organizacion/documentos");
  render(<App/>);
  expect(await screen.findByRole("heading", { name: "Aún no hay plantillas" })).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Empezar con constancia" }));
  await waitFor(() => expect(location.pathname).toBe("/organizacion/documentos/tpl-1"));
  expect(created).toEqual([{ kind: "certificate", programId: null, name: "Constancia" }]);
});
