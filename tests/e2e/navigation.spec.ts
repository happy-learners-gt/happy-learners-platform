import { test, expect } from "./local-test";
import { E2E_PREFIX, sessionToken } from "./helpers";

test("ST-032 the published lesson shows its position in the module and moves to the next published lesson", async ({ page, playwright, baseURL }, info) => {
  const educator = await playwright.request.newContext({ baseURL, extraHTTPHeaders: { Origin: baseURL!, Cookie: `hl_session=${await sessionToken("educador-demo")}` } });
  try {
    const body = { title: `${E2E_PREFIX} Recorrido ${info.project.name}`, objective: "Seguir el orden curricular.", status: "active", educationType: "non-formal", level: "unspecified", format: "workshop", modality: "in-person", pacing: "scheduled", area: "011", settings: {}, programId: null };
    const courseId = (await (await educator.post("/api/courses", { data: body })).json()).id;
    const moduleName = `${E2E_PREFIX} Módulo de saludos`;
    const unit = await educator.post(`/api/courses/${courseId}/units`, { data: { name: moduleName, objective: "Practicar.", status: "active", version: 1 } }); expect(unit.status()).toBe(201);
    const courseUnitId = (await unit.json()).id;
    const lessons: { id: string; shareCode: string; title: string }[] = [];
    for (const [title, publish] of [["Primera", true], ["Sin publicar", false], ["Tercera", true]] as const) {
      const saved = (await (await educator.post("/api/lessons", { data: { title: `${E2E_PREFIX} ${title}`, objective: "Practicar.", courseId, courseUnitId, instructions: "Sigue las indicaciones.", duration: 15 } })).json()).lesson;
      if (publish) expect((await educator.post(`/api/lessons/${saved.id}/publish`)).status()).toBe(200);
      lessons.push({ id: saved.id, shareCode: saved.shareCode, title: saved.title });
    }
    const [first, draft, third] = lessons;
    // The share API exposes only published neighbours; the draft is skipped.
    const navigation = (await (await page.request.get(`/api/share/${first.shareCode}`)).json()).navigation;
    expect(navigation).toEqual({ moduleName, position: 1, total: 2, previous: null, next: { title: third.title, shareCode: third.shareCode } });
    expect((await page.request.get(`/api/share/${draft.shareCode}`)).status()).toBe(404);

    await page.goto(`/aprender/${first.shareCode}`);
    const nav = page.getByRole("navigation", { name: `Lecciones de ${moduleName}` });
    await expect(nav).toContainText(`Lección 1 de 2 en ${moduleName}`);
    await expect(nav.getByRole("link", { name: /Lección anterior/ })).toHaveCount(0);
    await nav.getByRole("link", { name: `Siguiente lección: ${third.title}` }).click();
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(third.title);
    const thirdNav = page.getByRole("navigation", { name: `Lecciones de ${moduleName}` });
    await expect(thirdNav).toContainText(`Lección 2 de 2 en ${moduleName}`);
    await expect(thirdNav.getByRole("link", { name: /Siguiente lección/ })).toHaveCount(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    // Finishing the last lesson says so; going back reaches the first one.
    await page.getByRole("button", { name: "Empezar" }).click();
    await page.getByRole("button", { name: "Terminar lección" }).click();
    await expect(page.getByText(`Es la última lección publicada de ${moduleName}.`)).toBeVisible();
    await page.getByRole("button", { name: "Repasar desde el inicio" }).click();
    await page.getByRole("navigation", { name: `Lecciones de ${moduleName}` }).getByRole("link", { name: `Lección anterior: ${first.title}` }).click();
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(first.title);
    await page.getByRole("button", { name: "Empezar" }).click();
    await page.getByRole("button", { name: "Terminar lección" }).click();
    await expect(page.getByRole("link", { name: `Siguiente lección: ${third.title}` })).toBeVisible();
  } finally { await educator.dispose(); }
});
