import type { HealthResponse, VersionResponse } from "@happy-learners/contracts";
import { sha } from "./generated/version";

export default {
  async fetch(request, env) {
    const path = new URL(request.url).pathname;
    if (!path.startsWith("/api/")) return env.ASSETS.fetch(request);
    const headers = { "Cache-Control": "no-store" };
    if (path !== "/api/health" && path !== "/api/version") {
      return Response.json({ error: "Not found" }, { status: 404, headers });
    }
    if (request.method !== "GET" && request.method !== "HEAD") {
      return Response.json({ error: "Method not allowed" }, {
        status: 405, headers: { ...headers, Allow: "GET, HEAD" },
      });
    }
    const body: HealthResponse | VersionResponse = path === "/api/health" ? { status: "ok" } : { sha };
    const response = Response.json(body, { headers });
    return request.method === "HEAD" ? new Response(null, response) : response;
  },
} satisfies ExportedHandler<Env>;
