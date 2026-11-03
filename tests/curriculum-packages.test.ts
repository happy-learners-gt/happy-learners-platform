import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn, type ChildProcess } from "node:child_process";
import { createServer } from "node:net";
import { once } from "node:events";
import { setTimeout as delay } from "node:timers/promises";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { CoursePackageView, CurriculumPackageSummary, Curriculum } from "../packages/contracts/src/index";
import { competencyDescription, competencyName, curriculumPackages, indicatorEvidence, linkPlan, packageOf, packageProblems } from "../packages/domain/src/index";
import { listenOnTestPort } from "./test-port";

// Curriculum packages: official references versioned in the repository. The first one is CNB Guatemala's
// «Dosificación de los aprendizajes · Matemáticas · Sexto Grado»: 7 competencies and 26 achievement indicators.
const math = packageOf("cnb-matematicas-primaria-6")!;

describe("curriculum package data", () => {
  it("every package in the repository is valid, sourced and fits the curriculum plan", () => {
    for (const item of curriculumPackages) expect(packageProblems(item), item.id).toEqual([]);
    expect(math.source.url).toMatch(/^https:\/\/cnbguatemala\.org\/wiki\//);
    expect(math.competencies.map(competency => competency.code)).toEqual(["1", "2", "3", "4", "5", "6", "7"]);
    expect(math.competencies.map(competency => competency.indicators.length)).toEqual([5, 1, 3, 6, 2, 4, 5]);
    expect(math.competencies.flatMap(competency => competency.indicators.flatMap(indicator => indicator.contents)).length).toBe(84);
    for (const competency of math.competencies) {
      expect(competencyName(math, competency).length).toBeLessThanOrEqual(120);
      expect(competencyDescription(math, competency).length).toBeLessThanOrEqual(600);
      for (const indicator of competency.indicators) expect(indicatorEvidence(math, indicator).length).toBeLessThanOrEqual(400);
    }
    // The wording is the source's, numbering included.
    expect(math.competencies[0].indicators[0]).toMatchObject({ code: "1.1", statement: "Identifica características de polígonos regulares e irregulares." });
    expect(math.competencies[6].indicators[2].contents[0]).toBe("7.3.1. Cálculo de la cuenta larga (K’im, Winal, Tun, K’atun, Baktun) para diferentes fechas del gregoriano.");
  });

  it("detects broken data: codes outside their competency, repeated codes, missing contents or an unknown level", () => {
    const broken = structuredClone(math);
    broken.competencies[0].indicators[1].code = "2.9";
    broken.competencies[1].indicators[0].code = "1.1";
    broken.competencies[2].indicators[0].contents = [];
    (broken.competencies[3].indicators[0] as { level: string }).level = "memorize";
    expect(packageProblems(broken)).toEqual(["indicator 2.9: code", "indicator 2.9: contents", "indicator 1.1: code", "indicator 1.1: contents", "indicator 3.1: contents", "indicator 4.1: level"]);
  });

  it("plans only what is not linked yet and reports unknown codes", () => {
    const first = linkPlan(math, ["1.1", "1.2", "4.2"], []);
    expect(first.competencies.map(competency => competency.code)).toEqual(["1", "4"]);
    expect(first.indicators.map(entry => entry.indicator.code)).toEqual(["1.1", "1.2", "4.2"]);
    const again = linkPlan(math, ["1.1", "1.3", "9.9"], [{ kind: "competency", code: "1" }, { kind: "indicator", code: "1.1" }]);
    expect(again).toMatchObject({ unknown: ["9.9"], skipped: 1, competencies: [] });
    expect(again.indicators.map(entry => entry.indicator.code)).toEqual(["1.3"]);
  });
});

let worker: ChildProcess;
let origin = "";
let logs = "";
const storage = mkdtempSync(join(tmpdir(), "hl-platform-packages-"));
beforeAll(async () => {
  const server = createServer();
  await listenOnTestPort(server);
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Missing local port");
  await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  origin = `http://127.0.0.1:${address.port}`;
  worker = spawn("node_modules/.bin/wrangler", ["dev", "--local", "--config", "build/wrangler.json", "--ip", "127.0.0.1", "--port", String(address.port), "--inspector-port", "0", "--persist-to", storage], {
    env: { ...process.env, WRANGLER_SEND_METRICS: "false", BROWSER: "none" }, stdio: ["ignore", "pipe", "pipe"],
  });
  worker.stdout?.on("data", chunk => { logs += chunk; });
  worker.stderr?.on("data", chunk => { logs += chunk; });
  for (let attempt = 0; attempt < 200; attempt++) {
    if (worker.exitCode !== null) throw new Error(logs);
    try { if ((await fetch(`${origin}/api/health`, { signal: AbortSignal.timeout(500) })).ok) return; } catch { /* Wait for the local runtime to start. */ }
    await delay(200);
  }
  throw new Error(`Local Worker did not start:\n${logs}`);
});
afterAll(async () => {
  if (worker && worker.exitCode === null) { const exited = once(worker, "exit"); worker.kill("SIGTERM"); await exited; }
  rmSync(storage, { recursive: true, force: true });
});

const password = "Aprender-2026!";
async function signIn(username: string) {
  const response = await fetch(`${origin}/api/login`, { method: "POST", headers: { "Content-Type": "application/json", Origin: origin }, body: JSON.stringify({ username, password }) });
  return response.status === 200 ? response.headers.get("set-cookie")!.split(";")[0] : null;
}
async function as(cookie: string | null, path: string, method = "GET", data?: unknown) {
  return fetch(`${origin}/api${path}`, { method, headers: { Cookie: cookie || "", Origin: origin, ...(data !== undefined ? { "Content-Type": "application/json" } : {}) }, ...(data !== undefined ? { body: JSON.stringify(data) } : {}) });
}
const read = async <T = Record<string, unknown>>(response: Response, status = 200) => { const text = await response.text(); expect(response.status, text).toBe(status); return JSON.parse(text) as T; };
const errorOf = async (response: Response, status: number) => (await read<{ error: string }>(response, status)).error;

describe("curriculum packages on the built Worker", () => {
  it("administration activates the package and the course's lead takes five indicators into the plan, once", async () => {
    const admin = await signIn("admin-demo"), educator = await signIn("educador-demo"), other = await signIn("carlos.mejia"), external = await signIn("admin-externo");
    const course = (await read<{ id: string }>(await as(admin, "/courses", "POST", { title: "Matemáticas 6.º", objective: "Resolver problemas con números y figuras.", status: "active", educationType: "non-formal", level: "unspecified", format: "workshop", modality: "in-person", pacing: "scheduled", area: "011", settings: {}, programId: null, leadId: "user-educator" }), 201)).id;
    const detail = async () => (await read<{ course: { version: number }; curriculum: Curriculum }>(await as(educator, `/courses/${course}`)));
    const path = `/courses/${course}/curriculum-packages`, pick = (codes: string[], version: number, cookie = educator) => as(cookie, `${path}/${math.id}`, "POST", { codes, version });

    // The demo has the package active (0054): deactivated, the catalog lists it inactive and courses see no package.
    await read(await as(admin, `/curriculum-packages/${math.id}/deactivate`, "POST"));
    expect((await read<{ packages: CurriculumPackageSummary[] }>(await as(educator, "/curriculum-packages"))).packages).toEqual([expect.objectContaining({ id: math.id, active: false, competencies: 7, indicators: 26 })]);
    expect((await read<{ packages: CoursePackageView[] }>(await as(educator, path))).packages).toEqual([]);
    expect(await errorOf(await pick(["1.1"], (await detail()).course.version), 404)).toContain("no está activo");
    expect(await errorOf(await as(educator, `/curriculum-packages/${math.id}/activate`, "POST"), 403)).toContain("Solo administración");
    expect((await read<{ packages: CurriculumPackageSummary[] }>(await as(admin, `/curriculum-packages/${math.id}/activate`, "POST"))).packages[0]).toMatchObject({ active: true, activatedVersion: math.version });
    expect((await as(admin, "/curriculum-packages/no-existe/activate", "POST")).status).toBe(404);
    // Another organization keeps its own activation.
    expect((await read<{ packages: CurriculumPackageSummary[] }>(await as(external, "/curriculum-packages"))).packages[0].active).toBe(false);

    // The lead picks five indicators: three competencies and five outcomes appear in the plan, with their source.
    const view = (await read<{ packages: CoursePackageView[]; canLink: boolean }>(await as(educator, path)));
    expect(view.canLink).toBe(true);
    const before = await detail();
    expect(await read(await pick(["1.1", "1.2", "4.2", "4.4", "6.4"], before.course.version), 201)).toEqual({ added: 5, skipped: 0, version: before.course.version + 1 });
    const after = await detail();
    expect(after.curriculum.outcomes.map(outcome => [outcome.statement, outcome.level])).toEqual([
      ["Identifica características de polígonos regulares e irregulares.", "remember"],
      ["Calcula perímetro y área de diferentes polígonos y del círculo.", "apply"],
      ["Realiza cálculos aritméticos de adición, sustracción, multiplicación, división y potenciación con números naturales enteros.", "apply"],
      ["Realiza cálculos aritméticos de adición, sustracción, multiplicación, división con fracciones.", "apply"],
      ["Calcula e interpreta el promedio aritmético, la mediana y la moda en un conjunto de datos no agrupados.", "apply"],
    ]);
    expect(after.curriculum.outcomes[0].evidence).toBe("CNB Guatemala, Dosificación de los aprendizajes · Matemáticas · Sexto Grado, indicador de logro 1.1.");
    expect(after.curriculum.competencies.map(competency => competency.name.slice(0, 3))).toEqual(["1. ", "4. ", "6. "]);
    const byCompetency = new Map(after.curriculum.competencies.map(competency => [competency.id, competency.name.slice(0, 1)]));
    expect(after.curriculum.outcomes.map(outcome => byCompetency.get(outcome.competencyId!))).toEqual(["1", "1", "4", "4", "6"]);
    const linked = (await read<{ packages: CoursePackageView[] }>(await as(educator, path))).packages[0];
    expect(linked.competencyList[0].indicators.filter(indicator => indicator.outcomeId).map(indicator => indicator.code)).toEqual(["1.1", "1.2"]);

    // Picking again never duplicates: what is linked is skipped and competency 1 is reused.
    expect(await read(await pick(["1.1", "1.3"], after.course.version), 201)).toMatchObject({ added: 1, skipped: 1 });
    const again = await detail();
    expect(again.curriculum.competencies).toHaveLength(3);
    expect(again.curriculum.outcomes).toHaveLength(6);
    expect(await read(await pick(["1.1"], again.course.version))).toMatchObject({ added: 0, skipped: 1 });
    expect((await detail()).curriculum.outcomes).toHaveLength(6);
    // A stale version, an unknown code and anyone but the lead are refused.
    expect(await errorOf(await pick(["2.1"], after.course.version), 409)).toContain("cambió");
    expect(await errorOf(await pick(["9.9"], again.course.version), 400)).toContain("9.9");
    expect(await errorOf(await pick(["2.1"], again.course.version, admin), 403)).toContain("responsable del curso");
    expect((await as(other, path)).status).toBe(403);
    expect((await as(external, path)).status).toBe(404);

    // Deactivating hides the package from new picks and keeps the plan.
    await read(await as(admin, `/curriculum-packages/${math.id}/deactivate`, "POST"));
    expect((await read<{ packages: CoursePackageView[] }>(await as(educator, path))).packages).toEqual([]);
    expect((await detail()).curriculum.outcomes).toHaveLength(6);
  }, 30_000); // A full flow on the local Worker: room for slow runners.
});
