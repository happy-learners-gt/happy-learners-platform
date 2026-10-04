import { test, expect } from "./local-test";
import type { APIRequestContext } from "@playwright/test";
import { sessionToken } from "./helpers";

const course = "/api/courses/seed-course-matematicas";
const original = [{ userId: "seed-user-carlos", role: "co-teacher" }, { userId: "seed-user-lucia", role: "lead" }];

test.describe("HL-115 ST-072: only administration changes a course team", () => {
  const contexts: APIRequestContext[] = [];
  test.afterAll(async () => { for (const context of contexts) await context.dispose(); });
  async function client(playwright: { request: { newContext: (options: object) => Promise<APIRequestContext> } }, baseURL: string, username?: string) {
    const cookie: Record<string, string> = username ? { Cookie: `hl_session=${await sessionToken(username)}` } : {};
    const context = await playwright.request.newContext({ baseURL, extraHTTPHeaders: { Origin: baseURL, ...cookie }, timeout: 15000 });
    contexts.push(context);
    return context;
  }
  const version = async (api: APIRequestContext) => (await (await api.get(course)).json()).course.version as number;
  const team = async (api: APIRequestContext) => ((await (await api.get(course)).json()).course.team as { userId: string; role: string }[])
    .map(({ userId, role }) => ({ userId, role })).sort((a, b) => a.userId.localeCompare(b.userId));

  test("educators, other organizations and anonymous visitors are denied; administration is allowed", async ({ playwright, baseURL }) => {
    const anon = await client(playwright, baseURL!), admin = await client(playwright, baseURL!, "marta.ruiz");
    const lead = await client(playwright, baseURL!, "lucia.herrera"), outsider = await client(playwright, baseURL!, "educador-demo"), other = await client(playwright, baseURL!, "externo-demo");
    const widened = [{ userId: "seed-user-ana", role: "co-teacher" }, ...original];
    try {
      expect((await anon.put(`${course}/team`, { data: { members: widened, version: 1 } })).status()).toBe(401);
      // The course lead and an educator outside the team cannot change it, even with the current version.
      expect((await lead.put(`${course}/team`, { data: { members: widened, version: await version(admin) } })).status()).toBe(403);
      expect((await outsider.put(`${course}/team`, { data: { members: [...original, { userId: "user-educator", role: "co-teacher" }], version: await version(admin) } })).status()).toBe(403);
      // Another organization does not even see the course.
      expect((await other.put(`${course}/team`, { data: { members: widened, version: 1 } })).status()).toBe(404);
      expect(await team(admin)).toEqual(original);

      // Administration can only choose active people of its own organization.
      expect((await admin.put(`${course}/team`, { data: { members: [...original, { userId: "user-2", role: "co-teacher" }], version: await version(admin) } })).status()).toBe(400);
      expect((await admin.put(`${course}/team`, { data: { members: widened, version: await version(admin) } })).status()).toBe(200);
      // Educators still see the team, and the change is in the course's activity.
      expect(await team(lead)).toEqual(widened);
      const events = (await (await lead.get("/api/activity?course=seed-course-matematicas&limit=5")).json()).events as { summary: string; actorName: string }[];
      expect(events[0]).toMatchObject({ summary: "Actualizó el equipo docente (3 personas)", actorName: "Marta Ruiz" });
    } finally {
      const restored = await admin.put(`${course}/team`, { data: { members: original, version: await version(admin) } });
      expect(restored.status()).toBe(200);
    }
    expect(await team(admin)).toEqual(original);
  });
});
