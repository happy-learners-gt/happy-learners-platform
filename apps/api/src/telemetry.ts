import type { Usage } from "./storage";

/**
 * One structured line per API request (docs/operations/slo.md): the route as a template, never ids, tokens or query
 * strings; status, duration and the rows the request read and wrote in its organization's database (the free plan's
 * daily quota of rows read is what took the API down on 30-oct-2026). Nothing about the person.
 */
export interface RequestLog {
  event: "api"; route: string; method: string; status: number; ms: number;
  rowsRead: number; rowsWritten: number; queries: number; organization: string | null; sha: string; ray: string | null;
}

/** A path as a template: segments with a digit or longer than 24 characters (ids, tokens, codes) become `:id`. */
export const routeTemplate = (path: string) => path.split("/").map(segment => /\d/.test(segment) || segment.length > 24 ? ":id" : segment).join("/");

export function requestLog(request: Request, response: Response, started: number, usage: Usage & { organization?: string | null }, sha: string): RequestLog {
  return {
    event: "api", route: routeTemplate(new URL(request.url).pathname), method: request.method, status: response.status, ms: Date.now() - started,
    rowsRead: usage.rowsRead, rowsWritten: usage.rowsWritten, queries: usage.queries, organization: usage.organization || null, sha, ray: request.headers.get("CF-Ray"),
  };
}
