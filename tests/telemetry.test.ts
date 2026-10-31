import { describe, expect, it } from "vitest";
import { requestLog, routeTemplate } from "../apps/api/src/telemetry";

// SLO and observability (docs/operations/slo.md): one line per API request, without ids, tokens or query strings.
describe("request log", () => {
  it("turns ids, tokens and codes into :id and keeps the route's words", () => {
    expect(routeTemplate("/api/sections/seed-group-mat-6a/grades/progress.pdf")).toBe("/api/sections/:id/grades/progress.pdf");
    expect(routeTemplate("/api/invitations/accept/d_0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef")).toBe("/api/invitations/accept/:id");
    expect(routeTemplate("/api/share/D-1A2B3C4D5E6F7A8B")).toBe("/api/share/:id");
    expect(routeTemplate("/api/report-templates/report-template-0b5c1e2f-1111-4222-8333-944455556666/preview")).toBe("/api/report-templates/:id/preview");
    expect(routeTemplate("/api/timetables")).toBe("/api/timetables");
  });

  it("carries status, duration, rows and organization, never the query string", () => {
    const request = new Request("https://example.test/api/members/user-1?search=ana", { headers: { "CF-Ray": "abc-MIA" } });
    const line = requestLog(request, new Response(null, { status: 200 }), Date.now() - 12, { rowsRead: 40, rowsWritten: 1, queries: 3, organization: "org-demo" }, "sha");
    expect(line).toMatchObject({ event: "api", route: "/api/members/:id", method: "GET", status: 200, rowsRead: 40, rowsWritten: 1, queries: 3, organization: "org-demo", ray: "abc-MIA" });
    expect(line.ms).toBeGreaterThanOrEqual(12);
    expect(JSON.stringify(line)).not.toContain("ana");
  });
});
