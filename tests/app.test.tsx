// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { App } from "../apps/web/src/App";
beforeEach(() => { vi.stubGlobal("scrollTo", vi.fn()); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); history.replaceState(null, "", "/"); });
it("shows an accessible Spanish login with explicit synthetic account guidance", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ error: "Inicia sesión para continuar." }, { status: 401 })));
  render(<App/>);
  expect(await screen.findByRole("heading", { name: "Iniciar sesión" })).toBeTruthy();
  expect(screen.getByLabelText("Usuario")).toBeTruthy();
  expect(screen.getByLabelText("Contraseña").getAttribute("type")).toBe("password");
  expect(screen.getByText("Probar con cuentas de demostración")).toBeTruthy();
  expect(screen.getByLabelText("Código de sección o de lección")).toBeTruthy();
});
it("preserves the login form and explains network failure", async () => {
  const request = vi.fn().mockResolvedValueOnce(Response.json({}, { status: 401 })).mockRejectedValue(new TypeError("Network"));
  vi.stubGlobal("fetch", request); render(<App/>);
  await screen.findByRole("heading", { name: "Iniciar sesión" });
  fireEvent.change(screen.getByLabelText("Contraseña"), { target: { value: "invalid" } });
  fireEvent.submit(screen.getByRole("button", { name: "Entrar" }).closest("form")!);
  expect((await screen.findByRole("alert")).textContent).toContain("Comprueba tu conexión");
  expect((screen.getByLabelText("Usuario") as HTMLInputElement).value).toBe("educador-demo");
});
it("asks to sign in again over the current page when the session expires", async () => {
  const member = { id: "user-1", username: "educador-demo", role: "educator", organizationId: "org-demo" };
  vi.stubGlobal("fetch", vi.fn(async (input: string) => {
    if (input === "/api/session") return Response.json({ member });
    if (input === "/api/organization") return Response.json({ organization: { id: "org-demo", name: "Escuela", timezone: "America/Guatemala", configured: true } });
    return Response.json({ error: "Inicia sesión para continuar." }, { status: 401 });
  }));
  history.replaceState(null, "", "/inicio");
  render(<App/>);
  expect(await screen.findByRole("heading", { level: 1, name: "Inicio" })).toBeTruthy();
  expect(await screen.findByRole("heading", { name: "Tu sesión terminó" })).toBeTruthy();
  expect((screen.getByLabelText("Usuario", { selector: "#renew-username" }) as HTMLInputElement).value).toBe("educador-demo");
  expect(screen.getByRole("navigation", { name: "Navegación principal" })).toBeTruthy();
});
it("shows the school year with its periods in Organización and divides a new one into bimestres", async () => {
  const member = { id: "user-0", username: "admin-demo", role: "admin", organizationId: "org-demo", permissions: { admin: true, coordination: null, grants: {} } };
  const periods = [["Primer bimestre", "2027-01-11", "2027-03-19"], ["Segundo bimestre", "2027-03-20", "2027-05-28"], ["Tercer bimestre", "2027-05-29", "2027-08-06"], ["Cuarto bimestre", "2027-08-07", "2027-10-22"]]
    .map(([name, from, until], index) => ({ id: `period-${index}`, position: index + 1, name, from, until }));
  const year = { id: "year-1", name: "Ciclo 2027", from: "2027-01-11", until: "2027-10-22", status: "current", periodKind: "bimester", periods, createdAt: "t", updatedAt: "t", activatedAt: "t", closedAt: null };
  vi.stubGlobal("fetch", vi.fn(async (input: string) => {
    if (input === "/api/session") return Response.json({ member, pending: [] });
    if (input === "/api/organization") return Response.json({ organization: { id: "org-demo", name: "Escuela", timezone: "America/Guatemala", configured: true } });
    if (input === "/api/academic-years") return Response.json({ years: [year], today: "2026-10-26" });
    if (input.startsWith("/api/calendar")) return Response.json({ breaks: [], today: "2026-10-26" });
    return Response.json({});
  }));
  history.replaceState(null, "", "/organizacion");
  render(<App/>);
  expect(await screen.findByRole("heading", { name: "Ciclo lectivo" })).toBeTruthy();
  expect(await screen.findByText("Ciclo 2027")).toBeTruthy();
  expect(screen.getByText("Vigente")).toBeTruthy();
  expect(screen.getByRole("list", { name: "Periodos de Ciclo 2027" }).querySelectorAll("li")).toHaveLength(4);
  fireEvent.click(screen.getByRole("button", { name: "Nuevo ciclo" }));
  const dialog = await screen.findByRole("dialog", { name: "Nuevo ciclo lectivo" });
  const divide = screen.getByRole("button", { name: "Repartir en 4 bimestres" }) as HTMLButtonElement;
  expect(divide.disabled).toBe(true);
  fireEvent.change(screen.getByLabelText("Inicio del ciclo"), { target: { value: "2028-01-10" } });
  fireEvent.change(screen.getByLabelText("Fin del ciclo"), { target: { value: "2028-10-20" } });
  fireEvent.click(divide);
  expect((screen.getByLabelText("Nombre del periodo 4") as HTMLInputElement).value).toBe("Cuarto bimestre");
  expect(dialog.querySelectorAll(".period-row")).toHaveLength(4);
});
it("shows a section's gradebook with letters, the partial result and saves only the changed scores", async () => {
  const member = { id: "user-educator", username: "educador-demo", role: "educator", organizationId: "org-demo", permissions: { admin: false, coordination: null, grants: {} } };
  const course = { id: "course-1", title: "Comunicación y Lenguaje", objective: "Leer y escribir.", educationType: "formal", level: "primary", modality: "in-person", pacing: "scheduled", format: "subject", settings: { gradeScale: "letters_af" }, status: "active", version: 1, updatedAt: "t",
    access: { role: "lead", assigned: ["group-1"], configure: false, edit: true, publish: true, review: true, team: false, educators: false, sections: "assigned" } };
  const section = { id: "group-1", courseId: "course-1", name: "Quinto A", status: "active", learnerCount: 2, educators: [], course: { id: "course-1", title: course.title, status: "active" }, pacing: "scheduled",
    indicators: { learners: 2, classes: 0, taught: 0, upcoming: 0, unrecorded: 0, lessons: 0, covered: 0, attendance: null }, next: null, teaches: true };
  const periods = [{ id: "period-1", position: 1, name: "Primer bimestre", from: "2027-01-11", until: "2027-03-19", weight: 1, locked: false, lockedAt: null, lockedBy: null },
    { id: "period-2", position: 2, name: "Segundo bimestre", from: "2027-03-20", until: "2027-05-28", weight: 1, locked: true, lockedAt: "2027-05-29T10:00:00Z", lockedBy: "Administración" }];
  const gradebook = { section: { id: "group-1", name: "Quinto A", courseId: "course-1", courseTitle: course.title, status: "active" }, year: { id: "year-1", name: "Ciclo 2027", from: "2027-01-11", until: "2027-10-22", status: "current" },
    years: [{ id: "year-1", name: "Ciclo 2027", status: "current" }], periods, learners: [{ id: "learner-a", name: "Ana" }, { id: "learner-b", name: "Beto" }],
    grades: [{ learnerId: "learner-a", periodId: "period-1", score: 85 }, { learnerId: "learner-a", periodId: "period-2", score: 92 }],
    results: [{ learnerId: "learner-a", average: 88.5, letter: "B", passed: true, complete: true }, { learnerId: "learner-b", average: null, letter: null, passed: null, complete: false }],
    policy: { scale: "letters_af", passingGrade: 60, letterThresholds: [90, 80, 70, 60], average: "simple" }, canEdit: true, canLock: true, canUnlock: false };
  const saved: unknown[] = [];
  vi.stubGlobal("fetch", vi.fn(async (input: string, init?: RequestInit) => {
    if (input === "/api/session") return Response.json({ member, pending: [] });
    if (input === "/api/organization") return Response.json({ organization: { id: "org-demo", name: "Escuela", timezone: "America/Guatemala", configured: true } });
    if (input === "/api/sections/group-1") return Response.json({ section, today: "2027-03-01" });
    if (input === "/api/courses/course-1") return Response.json({ course, units: [], curriculum: { competencies: [], outcomes: [] } });
    if (input.startsWith("/api/sections/group-1/grades")) {
      if (init?.method === "PUT") { saved.push(JSON.parse(String(init.body))); return Response.json({ gradebook: { ...gradebook, grades: [...gradebook.grades, { learnerId: "learner-b", periodId: "period-1", score: 55 }], results: [gradebook.results[0], { learnerId: "learner-b", average: 55, letter: "F", passed: false, complete: false }] } }); }
      return Response.json({ gradebook });
    }
    if (input.startsWith("/api/lessons")) return Response.json({ lessons: [] });
    if (input.endsWith("/materials")) return Response.json({ materials: [] });
    if (input === "/api/resources") return Response.json({ resources: [] });
    if (input === "/api/programs") return Response.json({ programs: [] });
    return Response.json({});
  }));
  history.replaceState(null, "", "/secciones/group-1/notas");
  render(<App/>);
  expect(await screen.findByRole("heading", { level: 1, name: "Notas" })).toBeTruthy();
  expect(await screen.findByRole("table")).toBeTruthy();
  expect(screen.getByText("88,5 (B)")).toBeTruthy();
  expect(screen.getByText("Aprueba")).toBeTruthy();
  // A locked period is read-only; the open one takes scores.
  expect(screen.queryByLabelText("Nota de Ana en Segundo bimestre")).toBeNull();
  const cell = screen.getByLabelText("Nota de Beto en Primer bimestre") as HTMLInputElement;
  fireEvent.change(cell, { target: { value: "101" } });
  expect((screen.getByRole("button", { name: "Guardar notas" }) as HTMLButtonElement).disabled).toBe(true);
  fireEvent.change(cell, { target: { value: "55" } });
  fireEvent.click(screen.getByRole("button", { name: "Guardar notas" }));
  expect(await screen.findByText("No aprueba (parcial)")).toBeTruthy();
  expect(saved).toEqual([{ grades: [{ learnerId: "learner-b", periodId: "period-1", score: 55 }] }]);
});
it("shows the course's bibliography with its main book and links a library item from the dialog", async () => {
  const member = { id: "user-educator", username: "educador-demo", role: "educator", organizationId: "org-demo", permissions: { admin: false, coordination: null, grants: {} } };
  const course = { id: "course-1", title: "Comunicación y Lenguaje", objective: "Leer y escribir.", educationType: "formal", level: "primary", modality: "in-person", pacing: "scheduled", format: "subject", settings: {}, status: "active", version: 1, updatedAt: "t",
    access: { role: "lead", assigned: [], configure: false, edit: true, publish: true, review: true, team: false, educators: false, sections: "assigned" } };
  const materials = [
    { id: "course-file-1", fileId: "course-file-1", courseId: "course-1", title: "Libro de lectura 5", description: "PDF · 2.0 MB", kind: "file", content: "", status: "published", version: 1, updatedAt: "2026-10-01T00:00:00Z", termIds: [], fileName: "Libro de lectura 5.pdf", mediaType: "application/pdf" },
    { id: "material-2", courseId: "course-1", title: "Diccionario en línea", description: "Consulta", kind: "link", content: "https://dle.rae.es", status: "published", version: 1, updatedAt: "2026-10-02T00:00:00Z", termIds: [] },
  ];
  let references = [{ id: "reference-1", courseId: "course-1", itemId: "course-file-1", kind: "file", title: "Libro de lectura 5", status: "published", fileName: "Libro de lectura 5.pdf", role: "text", primary: true, citation: "Editorial escolar, 2026", updatedAt: "t" }];
  const posted: unknown[] = [];
  vi.stubGlobal("fetch", vi.fn(async (input: string, init?: RequestInit) => {
    if (input === "/api/session") return Response.json({ member, pending: [] });
    if (input === "/api/organization") return Response.json({ organization: { id: "org-demo", name: "Escuela", timezone: "America/Guatemala", configured: true } });
    if (input === "/api/courses/course-1") return Response.json({ course, units: [], curriculum: { competencies: [], outcomes: [] } });
    if (input === "/api/courses/course-1/materials") return Response.json({ materials });
    if (input === "/api/courses/course-1/bibliography") {
      if (init?.method === "POST") { posted.push(JSON.parse(String(init.body))); references = [...references, { id: "reference-2", courseId: "course-1", itemId: "material-2", kind: "link", title: "Diccionario en línea", status: "published", role: "support", primary: false, citation: "", updatedAt: "t" }] as typeof references; return Response.json({ references, canManage: true }, { status: 201 }); }
      return Response.json({ references, canManage: true });
    }
    if (input.startsWith("/api/lessons")) return Response.json({ lessons: [] });
    if (input === "/api/resources") return Response.json({ resources: [] });
    if (input === "/api/programs") return Response.json({ programs: [] });
    return Response.json({});
  }));
  history.replaceState(null, "", "/cursos/course-1/biblioteca");
  render(<App/>);
  expect(await screen.findByRole("heading", { name: "Bibliografía del curso" })).toBeTruthy();
  expect(await screen.findByText("Libro principal")).toBeTruthy();
  expect(screen.getByText(/Editorial escolar, 2026/)).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Agregar referencia" }));
  const dialog = await screen.findByRole("dialog", { name: "Agregar a la bibliografía" });
  // Only items not yet referenced are offered.
  expect([...dialog.querySelectorAll("option")].map(option => option.textContent)).toContain("Diccionario en línea");
  expect([...dialog.querySelectorAll("option")].map(option => option.textContent)).not.toContain("Libro de lectura 5 (Libro de lectura 5.pdf)");
  fireEvent.change(screen.getByLabelText("Rol"), { target: { value: "support" } });
  fireEvent.click(within(dialog).getByRole("button", { name: "Agregar referencia" }));
  expect(await screen.findByText("Diccionario en línea", { selector: ".bibliography strong" })).toBeTruthy();
  expect(posted).toEqual([{ role: "support", citation: "", primary: false, itemId: "material-2" }]);
});
it("lets the course's lead pick CNB indicators for the curriculum plan, with those already in it fixed", async () => {
  const { packageOf, packageSummary } = await import("../packages/domain/src/index");
  const math = packageOf("cnb-matematicas-primaria-6")!;
  const member = { id: "user-educator", username: "educador-demo", role: "educator", organizationId: "org-demo", permissions: { admin: false, coordination: null, grants: {} } };
  const course = { id: "course-1", title: "Matemáticas 6.º", objective: "Resolver problemas.", educationType: "formal", level: "primary", modality: "in-person", pacing: "self-paced", format: "subject", settings: { attendance: false }, status: "active", version: 7, updatedAt: "t",
    access: { role: "lead", assigned: [], configure: false, edit: true, publish: true, review: true, team: false, educators: false, sections: "assigned" } };
  const view = { ...packageSummary(math), active: true, activatedAt: "t", activatedVersion: math.version,
    competencyList: math.competencies.map(competency => ({ code: competency.code, statement: competency.statement, competencyId: competency.code === "1" ? "competency-1" : null,
      indicators: competency.indicators.map(indicator => ({ ...indicator, outcomeId: indicator.code === "1.1" ? "outcome-1" : null })) })) };
  const posted: unknown[] = [];
  vi.stubGlobal("fetch", vi.fn(async (input: string, init?: RequestInit) => {
    if (input === "/api/session") return Response.json({ member, pending: [] });
    if (input === "/api/organization") return Response.json({ organization: { id: "org-demo", name: "Escuela", timezone: "America/Guatemala", configured: true } });
    if (input === "/api/courses/course-1") return Response.json({ course, units: [], curriculum: { competencies: [], outcomes: [] } });
    if (input === "/api/courses/course-1/curriculum-packages") return Response.json({ packages: [view], canLink: true });
    if (input === `/api/courses/course-1/curriculum-packages/${math.id}`) { posted.push(JSON.parse(String(init!.body))); return Response.json({ added: 2, skipped: 0, version: 8 }, { status: 201 }); }
    if (input.startsWith("/api/lessons")) return Response.json({ lessons: [] });
    if (input.endsWith("/materials")) return Response.json({ materials: [] });
    if (input === "/api/resources") return Response.json({ resources: [] });
    if (input === "/api/programs") return Response.json({ programs: [] });
    return Response.json({});
  }));
  history.replaceState(null, "", "/cursos/course-1/plan");
  render(<App/>);
  fireEvent.click(await screen.findByRole("button", { name: "Agregar indicadores del CNB" }));
  const dialog = await screen.findByRole("dialog", { name: "Agregar indicadores del CNB" });
  expect(within(dialog).getByText(/Fuente: CNB Guatemala/)).toBeTruthy();
  const linked = within(dialog).getByRole("checkbox", { name: /^1\.1 Identifica características de polígonos/ }) as HTMLInputElement;
  expect(linked.checked && linked.disabled).toBe(true);
  fireEvent.click(within(dialog).getByRole("checkbox", { name: /^1\.2 Calcula perímetro/ }));
  fireEvent.click(within(dialog).getByRole("checkbox", { name: /^6\.4 Calcula e interpreta/ }));
  fireEvent.click(within(dialog).getByRole("button", { name: "Agregar 2 indicadores" }));
  expect(await screen.findByText("Se agregaron 2 indicadores al plan curricular.")).toBeTruthy();
  expect(posted).toEqual([{ codes: ["1.2", "6.4"], version: 7 }]);
});
it("guides «Planificar con IA» step by step: review of an AI proposal, coverage gaps preselected and the verified map", async () => {
  const member = { id: "user-educator", username: "educador-demo", role: "educator", organizationId: "org-demo", permissions: { admin: false, coordination: null, grants: {} } };
  const course = { id: "course-1", title: "Matemáticas 6.º", objective: "Resolver problemas.", educationType: "formal", level: "primary", modality: "in-person", pacing: "self-paced", format: "subject", settings: { attendance: false }, status: "active", version: 3, updatedAt: "t",
    access: { role: "lead", assigned: [], configure: false, edit: true, publish: true, review: true, team: false, educators: false, sections: "assigned" } };
  const outcomes = [{ id: "outcome-1", statement: "Identifica características de polígonos regulares e irregulares.", code: "1.1" }, { id: "outcome-2", statement: "Calcula el área y volumen de sólidos geométricos.", code: "1.4" }, { id: "outcome-3", statement: "Realiza cálculos aritméticos con decimales", code: "4.5" }];
  const proposals = { outcomes, units: [{ id: "unit-1", name: "Unidad 1" }], sequence: { id: "start-develop-close", label: "Inicio · Desarrollo · Cierre" }, bookText: "ready", generator: "openai", blockers: [],
    book: { fileId: "course-file-1", title: "Libro de Matemáticas 6", pages: 16, sha256: "a".repeat(64) }, canPropose: true, jobs: [] };
  const row = (patch: Record<string, unknown>) => ({ candidates: [], pages: [], evidence: [], source: "ai", status: "confirmed", aiStatus: "done", aiError: null, ...patch });
  const map = { book: { title: "Libro de Matemáticas 6", pages: 16 }, bookText: "ready", mapper: "openai", canEdit: true, summary: { total: 3, mapped: 3, confirmed: 3, uncovered: 1 }, outcomes: [
    row({ outcomeId: "outcome-1", code: "1.1", statement: outcomes[0].statement, pages: [2], evidence: [{ page: 2, quote: "Un polígono es regular cuando todos sus lados y ángulos son iguales." }] }),
    row({ outcomeId: "outcome-2", code: "1.4", statement: outcomes[1].statement, pages: [7] }), row({ outcomeId: "outcome-3", code: "4.5", statement: outcomes[2].statement }),
  ] };
  const draft = { id: "lesson-9", title: "Área y volumen de prismas", objective: "Calcular el área total y el volumen de prismas.", program: "Unidad 1", courseId: "course-1", courseUnitId: "unit-1", duration: 45, materials: [], reflection: "", publishedAt: "", status: "draft", revision: 0, sequence: "start-develop-close", outcomeIds: ["outcome-2"],
    generated: { source: "openai", model: "gpt-5.6-luna", pages: [7], indicator: "1.4", at: "2026-10-27T18:00:00Z" },
    activities: [{ id: "a1", position: 0, title: "Recordamos", minutes: 10, phase: "start", purpose: "explore", instructions: "", blocks: [{ id: "b1", kind: "text", instructions: "Observa una caja y cuenta sus caras." }] },
      { id: "a2", position: 1, title: "Comprobamos", minutes: 35, phase: "close", purpose: "assess", instructions: "", blocks: [{ id: "b2", kind: "question", instructions: "¿Cuál es el volumen de un cubo de 2 cm?", options: ["8 cm³", "6 cm³"], answer: 0 }] }] };
  const published: string[] = [], asked: unknown[] = [];
  vi.stubGlobal("fetch", vi.fn(async (input: string, init?: RequestInit) => {
    if (input === "/api/session") return Response.json({ member, pending: [] });
    if (input === "/api/organization") return Response.json({ organization: { id: "org-demo", name: "Escuela", timezone: "America/Guatemala", configured: true } });
    if (input === "/api/courses/course-1") return Response.json({ course, units: [], curriculum: { competencies: [], outcomes: [] } });
    if (input === "/api/courses/course-1/proposals" && init?.method === "POST") { asked.push(JSON.parse(String(init.body))); return Response.json({ ...proposals, jobs: [{ id: "proposal-1", unitId: "unit-1", unitName: "Unidad 1", generator: "openai", createdAt: "2026-10-27T18:00:00Z", requestedBy: "Lucía", items: [] }], skipped: 0 }, { status: 202 }); }
    if (input === "/api/courses/course-1/proposals") return Response.json(proposals);
    if (input === "/api/courses/course-1/book-map") return Response.json(map);
    if (input === "/api/lessons/lesson-9/publish") { published.push(String(init?.method)); return Response.json({ lesson: { ...draft, revision: 1 } }); }
    if (input.startsWith("/api/lessons")) return Response.json({ lessons: published.length ? [{ ...draft, revision: 1, status: "published" }] : [draft] });
    if (input.endsWith("/materials")) return Response.json({ materials: [] });
    if (input === "/api/resources") return Response.json({ resources: [] });
    if (input === "/api/programs") return Response.json({ programs: [] });
    return Response.json({});
  }));
  // The former page of 1.2.0 leads to the assistant.
  history.replaceState(null, "", "/cursos/course-1/propuestas");
  render(<App/>);
  expect(await screen.findByRole("heading", { level: 1, name: "Planificar con IA" })).toBeTruthy();
  expect(location.pathname + location.search).toBe("/cursos/course-1/asistente?paso=propuestas");
  // Proposals: the two indicators without lessons come preselected; the covered one says so.
  expect((await screen.findByRole("checkbox", { name: /polígonos/ }) as HTMLInputElement).checked).toBe(true);
  expect((screen.getByRole("checkbox", { name: /sólidos geométricos/ }) as HTMLInputElement).checked).toBe(false);
  expect(screen.getByText("1 borrador")).toBeTruthy();
  // The main action submits the chosen gaps.
  fireEvent.click(screen.getByRole("button", { name: "Proponer 2 lecciones" }));
  expect(await screen.findByText(/Se pidieron/)).toBeTruthy();
  expect(asked).toEqual([{ unitId: "plan", outcomeIds: ["outcome-1", "outcome-3"], minutes: 45 }]);
  // Review: the AI proposal with its activities, its question and where it came from.
  fireEvent.click(screen.getByRole("tab", { name: /Revisión/ }));
  expect(await screen.findByText("Área y volumen de prismas")).toBeTruthy();
  expect(screen.getByText("Propuesta de IA")).toBeTruthy();
  expect(screen.getByText(/¿Cuál es el volumen de un cubo de 2 cm\?/)).toBeTruthy();
  expect(screen.getByText(/OpenAI \(gpt-5\.6-luna\) · libro, p\. 7/)).toBeTruthy();
  // The map: verified quotes and «the book does not cover it».
  fireEvent.click(screen.getByRole("tab", { name: /Mapa del libro/ }));
  expect(await screen.findByText(/p\. 2: «Un polígono es regular/)).toBeTruthy();
  expect(screen.getByText("El libro no lo trata")).toBeTruthy();
  // Publishing a proposal asks to confirm it was reviewed.
  fireEvent.click(screen.getByRole("tab", { name: /Revisión/ }));
  fireEvent.click(await screen.findByRole("button", { name: "Publicar" }));
  fireEvent.click(await screen.findByRole("button", { name: "La revisé, publicar" }));
  expect(await screen.findByText("«Área y volumen de prismas» se publicó.")).toBeTruthy();
  expect(published).toEqual(["POST"]);
});
