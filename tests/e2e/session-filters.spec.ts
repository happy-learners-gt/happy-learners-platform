import { test, expect } from "./local-test";
import type { APIRequestContext, PlaywrightWorkerArgs } from "@playwright/test";
import { sessionToken, signIn } from "./helpers";

// HL-108 ST-065: the class history of a course filters by section (grupo) and period; the filters combine and the
// course team's access rules decide which sections can be filtered.
const course = "/api/courses/seed-course-matematicas";
type Session = { id: string; groupId: string; sessionDate: string };
type Group = { id: string; name: string; status: string; educators: { userId: string }[] };

const contexts: APIRequestContext[] = [];
test.afterEach(async () => { for (const context of contexts.splice(0)) await context.dispose(); });
async function client(playwright: PlaywrightWorkerArgs["playwright"], baseURL: string, username?: string) {
  const cookie: Record<string, string> = username ? { Cookie: `hl_session=${await sessionToken(username)}` } : {};
  const context = await playwright.request.newContext({ baseURL, extraHTTPHeaders: { Origin: baseURL, ...cookie }, timeout: 15000 });
  contexts.push(context);
  return context;
}
const list = async (api: APIRequestContext, query = "") => {
  const response = await api.get(`${course}/sessions${query ? `?${query}` : ""}`);
  expect(response.status()).toBe(200);
  return ((await response.json()).sessions as Session[]);
};
const ids = (items: Session[]) => items.map(item => item.id).sort();
/** A period inside a section's classes: from its second class day to the one in the middle. */
function periodOf(sessions: Session[]) {
  const days = [...new Set(sessions.map(item => item.sessionDate))].sort();
  expect(days.length).toBeGreaterThan(2);
  return { from: days[1], to: days[Math.floor(days.length / 2)] };
}

test("HL-108 ST-065: the API filters the class history by section, by period and by both combined, and validates them", async ({ playwright, baseURL }) => {
  const lead = await client(playwright, baseURL!, "lucia.herrera");
  const groups = (await (await lead.get(`${course}/groups`)).json()).groups as Group[];
  const all = await list(lead);
  const [a, b] = groups;
  // Filter by section (grupo).
  const ofA = await list(lead, `section=${a.id}`);
  expect(ofA.length).toBeGreaterThan(0);
  expect(ids(ofA)).toEqual(ids(all.filter(item => item.groupId === a.id)));
  // Filter by period: both limits included.
  const { from, to } = periodOf(ofA);
  const inPeriod = await list(lead, `from=${from}&to=${to}`);
  expect(ids(inPeriod)).toEqual(ids(all.filter(item => item.sessionDate >= from && item.sessionDate <= to)));
  expect(inPeriod.some(item => item.sessionDate === from) && inPeriod.some(item => item.sessionDate === to)).toBe(true);
  // Both filters combine.
  const combined = await list(lead, `section=${b.id}&from=${from}&to=${to}`);
  expect(ids(combined)).toEqual(ids(all.filter(item => item.groupId === b.id && item.sessionDate >= from && item.sessionDate <= to)));
  expect(ids(await list(lead, `section=${a.id}&from=${to}&to=${to}`))).toEqual(ids(all.filter(item => item.groupId === a.id && item.sessionDate === to)));
  // Invalid filters are rejected; an unknown section is not there.
  for (const query of ["from=2026-02-30", "to=15-10-2026", `from=${to}&to=2000-01-01`, "section=Grupo%20A"]) expect((await lead.get(`${course}/sessions?${query}`)).status()).toBe(400);
  expect((await lead.get(`${course}/sessions?section=group-does-not-exist`)).status()).toBe(404);
});

test("HL-108 ST-065: filtering respects the course team; access is denied to outsiders and to sections a person does not teach", async ({ playwright, baseURL }) => {
  const anon = await client(playwright, baseURL!), admin = await client(playwright, baseURL!, "marta.ruiz"), coTeacher = await client(playwright, baseURL!, "carlos.mejia");
  const outsider = await client(playwright, baseURL!, "educador-demo"), other = await client(playwright, baseURL!, "externo-demo");
  const groups = (await (await admin.get(`${course}/groups`)).json()).groups as Group[];
  const [kept, removed] = groups.filter(item => item.status === "active" && item.educators.some(person => person.userId === "seed-user-carlos"));
  const query = `section=${removed.id}&from=2020-01-01&to=2030-12-31`;
  // Outside the team nothing is returned, whatever the filter.
  expect((await anon.get(`${course}/sessions?${query}`)).status()).toBe(401);
  expect((await outsider.get(`${course}/sessions?${query}`)).status()).toBe(403);
  expect(Object.keys(await (await outsider.get(`${course}/sessions?${query}`)).json())).toEqual(["error"]);
  expect((await other.get(`${course}/sessions?${query}`)).status()).toBe(404);
  // Administration filters by any section.
  expect((await list(admin, query)).every(item => item.groupId === removed.id)).toBe(true);
  const educators = (groupId: string, userIds: string[]) => admin.put(`${course}/groups/${groupId}/educators`, { data: { userIds, conflictReason: "Sección de prueba E2E; su horario puede coincidir con otras secciones de prueba." } });
  try {
    expect((await educators(removed.id, ["seed-user-lucia"])).status()).toBe(200);
    // A co-teacher filters by the sections they teach; a section they do not teach is not there for them.
    const response = await coTeacher.get(`${course}/sessions?${query}`);
    expect(response.status()).toBe(404);
    expect(Object.keys(await response.json())).toEqual(["error"]);
    expect((await list(coTeacher, `section=${kept.id}`)).every(item => item.groupId === kept.id)).toBe(true);
    expect((await list(coTeacher, "from=2020-01-01&to=2030-12-31")).some(item => item.groupId === removed.id)).toBe(false);
  } finally {
    expect((await educators(removed.id, removed.educators.map(item => item.userId))).status()).toBe(200);
  }
});

test("HL-108 ST-065: an educator applies the section and period filters in the schedule, kept in the address", async ({ page, playwright, baseURL }) => {
  const lead = await client(playwright, baseURL!, "lucia.herrera");
  const groups = ((await (await lead.get(`${course}/groups`)).json()).groups as Group[]).filter(item => item.status === "active");
  const [a, b] = groups;
  const ofB = await list(lead, `section=${b.id}`);
  const { from, to } = periodOf(ofB);
  const expected = (await list(lead, `section=${b.id}&from=${from}&to=${to}`)).length;
  const rows = page.locator("table.schedule-table tbody tr:not(.is-break)");

  await signIn(page, "lucia.herrera", `/secciones/${a.id}/clases`);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Cronograma");
  const filters = page.getByRole("group", { name: "Filtrar clases" });
  await filters.getByLabel("Desde", { exact: true }).fill(from);
  await expect(page).toHaveURL(new RegExp(`/secciones/${a.id}/clases\\?desde=${from}$`));
  await filters.getByLabel("Hasta", { exact: true }).fill(to);
  await expect(page).toHaveURL(new RegExp(`/secciones/${a.id}/clases\\?desde=${from}&hasta=${to}$`));
  // Changing the section keeps the period.
  await filters.getByLabel("Sección", { exact: true }).selectOption(b.id);
  await expect(page).toHaveURL(new RegExp(`/secciones/${b.id}/clases\\?desde=${from}&hasta=${to}$`));
  await expect(page.getByRole("radio", { name: `Todo el periodo (${expected})` })).toBeChecked();
  await expect(rows).toHaveCount(expected);
  // The address restores the filters.
  await page.reload();
  await expect(page.getByRole("group", { name: "Filtrar clases" }).getByLabel("Desde", { exact: true })).toHaveValue(from);
  await expect(page.getByRole("group", { name: "Filtrar clases" }).getByLabel("Hasta", { exact: true })).toHaveValue(to);
  await expect(rows).toHaveCount(expected);
  await page.getByRole("group", { name: "Filtrar clases" }).getByRole("button", { name: "Limpiar filtros" }).click();
  await expect(page).toHaveURL(new RegExp(`/secciones/${b.id}/clases$`));
  await expect(page.getByRole("radio", { name: `Todo el periodo (${ofB.length})` })).toBeChecked();
});
