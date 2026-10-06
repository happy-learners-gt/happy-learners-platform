import { test, expect } from "./local-test";
import { activity, addActivity, createLesson, e2eName, origin, saveStatus, signIn, toast, publish } from "./helpers";

test("didactic sequence: moments, composite activities and private teacher notes", async ({ page, browser }, info) => {
  const title = e2eName(info, "Secuencia PPP"), note = "Nota privada: repasa la pronunciación antes de empezar.";
  await signIn(page, "educador-demo", "/cursos/course-exploradores/contenido");
  await createLesson(page, "Greetings", title, "Presentarse con una frase completa.");

  // The template defines the moments; the starter activity lands in the first one.
  await page.getByLabel("Secuencia didáctica").selectOption({ label: "Presentación · Práctica · Producción" });
  for (const moment of ["Presentación", "Práctica", "Producción"]) await expect(page.getByRole("heading", { level: 2, name: moment, exact: true })).toBeVisible();
  const intro = activity(page, "Instrucciones");
  await intro.getByLabel(/^Título de la actividad/).fill("Escuchamos el modelo");
  const model = activity(page, "Escuchamos el modelo");
  await expect(model.locator(".card-kind")).toHaveText("Presentación · Actividad 1 de 1");
  await model.locator(".richtext-content").first().fill("Escucha cómo se presenta la maestra.");
  await model.getByLabel(/^Propósito de la actividad/).selectOption({ label: "Explicar" });
  await model.getByLabel(/^Organización de la actividad/).selectOption({ label: "Toda la clase" });

  // One activity, several blocks: a note only teachers see.
  await model.getByRole("group", { name: "Agregar a la actividad 1" }).getByRole("button", { name: "Nota para el docente", exact: true }).click();
  await model.getByRole("textbox", { name: "Nota para el docente de la actividad 1 (bloque 2)" }).fill(note);
  await expect(model.getByText("Solo docentes: los estudiantes no la ven")).toBeVisible();

  const question = await addActivity(page, "Pregunta", "Práctica");
  await question.getByLabel(/^Título de la actividad/).fill("Elige la presentación");
  await question.locator(".richtext-content").fill("¿Cuál frase sirve para presentarte?");
  await question.getByLabel("Opción 1", { exact: true }).fill("My name is Ana.");
  await question.getByLabel("Opción 2", { exact: true }).fill("Good night.");
  await expect(saveStatus(page)).toContainText("Borrador guardado", { timeout: 10_000 });

  // Up and down cross moment boundaries in the outline.
  const outline = page.getByRole("navigation", { name: "Estructura de la lección" });
  const handle = outline.getByRole("button", { name: /^Reordenar actividad \d: Elige la presentación$/ });
  await handle.focus();
  await page.keyboard.press("ArrowUp");
  await expect(toast(page)).toContainText("pasó a Presentación");
  await expect(handle).toBeFocused();
  await page.keyboard.press("ArrowDown");
  await expect(toast(page)).toContainText("pasó a Práctica");
  await expect(activity(page, "Elige la presentación").locator(".card-kind")).toHaveText("Práctica · Actividad 2 de 2");
  await expect(saveStatus(page)).toContainText("Borrador guardado", { timeout: 10_000 });

  await page.reload();
  await expect(activity(page, "Escuchamos el modelo").getByRole("textbox", { name: /^Nota para el docente/ })).toContainText(note);
  await publish(page);
  await expect(toast(page)).toContainText("Lección publicada");
  const code = (await page.locator(".share-row strong").textContent())!;

  // What students receive never includes the teacher note, in the API or on screen.
  const shared = await page.request.get(`/api/share/${code}`);
  expect(shared.ok()).toBeTruthy();
  expect(await shared.text()).not.toContain("Nota privada");
  const student = await (await browser.newContext()).newPage();
  await student.goto(`${origin}/aprender/${code}`);
  const moments = student.getByRole("region", { name: "Así será la lección" });
  await expect(moments).toContainText("Presentación");
  await expect(moments).toContainText("Práctica");
  await student.getByRole("button", { name: "Empezar" }).click();
  await expect(student.locator(".player-chip")).toHaveText("Presentación · Actividad 1 de 2 · 20 min");
  await expect(student.locator(".player-tags")).toContainText("Explicar");
  await expect(student.locator(".player-tags")).toContainText("Toda la clase");
  await expect(student.getByText("Escucha cómo se presenta la maestra.")).toBeVisible();
  await expect(student.getByText("Nota privada")).toHaveCount(0);
  await student.getByRole("button", { name: "Siguiente" }).click();
  await expect(student.locator(".player-chip")).toHaveText("Práctica · Actividad 2 de 2 · 5 min");
  await student.getByLabel("My name is Ana.").check();
  const correct = student.getByRole("status").filter({ hasText: "¡Correcto!" });
  await expect(correct).toBeVisible();
  // The feedback reads on one line across the card (it once inherited the editor's 44 px «correct» control).
  const box = (await correct.boundingBox())!;
  expect(box.width).toBeGreaterThan(200);
  expect(box.height).toBeLessThan(80);
  await student.context().close();
});
