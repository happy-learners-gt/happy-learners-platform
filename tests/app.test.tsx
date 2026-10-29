// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
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
    if (input === "/api/bell-schedules") return Response.json({ schedules: [] });
    return Response.json({});
  }));
  history.replaceState(null, "", "/organizacion");
  render(<App/>);
  expect(await screen.findByRole("heading", { name: "Ciclo lectivo" })).toBeTruthy();
  expect(await screen.findByText("Ciclo 2027")).toBeTruthy();
  expect(screen.getByText("Vigente")).toBeTruthy();
  expect(screen.getByRole("list", { name: "Calendario de Ciclo 2027" }).querySelectorAll("li")).toHaveLength(4);
  fireEvent.click(screen.getByRole("button", { name: "Nuevo ciclo" }));
  const dialog = await screen.findByRole("dialog", { name: "Nuevo ciclo lectivo" });
  const divide = screen.getByRole("button", { name: "Repartir en 4 bimestres" }) as HTMLButtonElement;
  expect(divide.disabled).toBe(true);
  fireEvent.change(screen.getByLabelText("Inicio del ciclo"), { target: { value: "2028-01-10" } });
  fireEvent.change(screen.getByLabelText("Fin del ciclo"), { target: { value: "2028-10-20" } });
  fireEvent.change(screen.getByLabelText("Días de vacaciones entre periodos"), { target: { value: "14" } });
  fireEvent.click(divide);
  expect((screen.getByLabelText("Nombre del periodo 4") as HTMLInputElement).value).toBe("Cuarto bimestre");
  expect(dialog.querySelectorAll(".period-row")).toHaveLength(4);
  // The vacations between periods read right under them.
  expect(within(dialog).getAllByText(/14 días de vacaciones/)).toHaveLength(3);
  fireEvent.click(within(dialog).getByRole("button", { name: "Cancelar" }));
  // Jornadas: a template, the passing time and a break give the day's blocks before saving.
  fireEvent.click(await screen.findByRole("button", { name: "Nueva jornada" }));
  const jornada = await screen.findByRole("dialog", { name: "Nueva jornada" });
  const preview = within(jornada).getByRole("list", { name: "Vista previa de la jornada" });
  expect(preview.querySelectorAll(".is-class")).toHaveLength(8);
  expect(within(preview).getByText("07:30–08:10")).toBeTruthy();
  fireEvent.change(within(jornada).getByLabelText("Tiempo entre periodos"), { target: { value: "0" } });
  expect(within(preview).getByText("08:10–08:50")).toBeTruthy();
  fireEvent.change(within(jornada).getByLabelText("Duración del periodo"), { target: { value: "10" } });
  expect(within(jornada).getByText("Cada periodo dura entre 20 y 180 minutos.")).toBeTruthy();
  expect((within(jornada).getByRole("button", { name: "Crear jornada" }) as HTMLButtonElement).disabled).toBe(true);
});
it("previews recurring calendar rules and confirms year generation only after its preview", async () => {
  const member = { id: "user-0", username: "admin-demo", role: "admin", organizationId: "org-demo", permissions: { admin: true, coordination: null, grants: {} } };
  const category = { id: "category-holiday", key: "holiday", label: "Feriado", noClassDefault: true, builtin: true };
  const rule = { id: "rule-second-thursday", calendarId: "calendar-org", categoryId: category.id, noClass: true,
    rule: { id: "rule-second-thursday", title: "Encuentro anual", anchor: { kind: "nth-weekday", month: 11, weekday: 4, n: 2 }, days: 1, part: "full" } };
  const confirmed: string[] = [];
  vi.stubGlobal("fetch", vi.fn(async (input: string, init?: RequestInit) => {
    if (input === "/api/session") return Response.json({ member, pending: [] });
    if (input === "/api/organization") return Response.json({ organization: { id: "org-demo", name: "Escuela", timezone: "America/Guatemala", configured: true } });
    if (input === "/api/sections") return Response.json({ sections: [] });
    if (input === "/api/courses") return Response.json({ courses: [] });
    if (input === "/api/programs") return Response.json({ programs: [] });
    if (input === "/api/calendars") return Response.json({ calendars: [{ id: "calendar-org", scope: "organization", scopeId: null, name: "Calendario institucional", rules: [rule] }], categories: [category] });
    if (input.startsWith("/api/calendars/view")) return Response.json({ events: [] });
    if (input.endsWith("/generate?preview=1")) return Response.json({ plan: { create: [{ ...rule.rule, ruleId: rule.id, from: "2026-11-12", until: "2026-11-12", part: "full" }], update: [], keep: [] } });
    if (input.endsWith("/generate") && init?.method === "POST") { confirmed.push(input); return Response.json({ plan: {}, applied: { created: 1, updated: 0, kept: 0 } }); }
    return Response.json({});
  }));
  history.replaceState(null, "", "/calendario?año=2026");
  render(<App/>);
  expect(await screen.findByRole("heading", { level: 1, name: "Calendario" })).toBeTruthy();
  fireEvent.click(await screen.findByRole("button", { name: "Editar Encuentro anual" }));
  const editor = await screen.findByRole("dialog", { name: "Editar regla" });
  expect(within(editor).getByText("Segundo jueves de noviembre")).toBeTruthy();
  expect(within(editor).getByText(/2026-11-12/)).toBeTruthy();
  fireEvent.click(within(editor).getByRole("button", { name: "Cancelar" }));
  fireEvent.click(screen.getByRole("button", { name: "Generar 2026" }));
  const preview = await screen.findByRole("dialog", { name: "Generar el año 2026" });
  expect(within(preview).getByRole("heading", { name: /Se crean/ })).toBeTruthy();
  expect(confirmed).toEqual([]);
  fireEvent.click(within(preview).getByRole("button", { name: "Confirmar y generar 2026" }));
  await waitFor(() => expect(confirmed).toEqual(["/api/calendars/calendar-org/years/2026/generate"]));
});
it("sends periodId when a section schedule follows a period", async () => {
  const member = { id: "user-0", username: "admin-demo", role: "admin", organizationId: "org-demo", permissions: { admin: true, coordination: null, grants: {} } };
  const course = { id: "course-1", title: "Matemáticas", objective: "Resolver.", educationType: "formal", level: "primary", modality: "in-person", pacing: "scheduled", format: "subject", programId: "program-1", settings: { attendance: true }, status: "active", version: 1, updatedAt: "t",
    access: { role: "admin", assigned: [], configure: true, edit: true, publish: true, review: true, team: true, educators: true, sections: "all" } };
  const section = { id: "group-1", courseId: course.id, name: "Sexto A", status: "active", learnerCount: 0, educators: [], course: { id: course.id, title: course.title, status: "active" }, pacing: "scheduled", schedule: null,
    indicators: { learners: 0, classes: 0, taught: 0, upcoming: 0, unrecorded: 0, lessons: 0, covered: 0, attendance: null }, next: null, teaches: false };
  const year = { id: "year-program", name: "Ciclo del programa", from: "2026-01-12", until: "2026-11-27", status: "current", periodKind: "bimester", programId: "program-1",
    periods: [{ id: "period-2", position: 2, name: "Segundo bimestre", from: "2026-03-23", until: "2026-05-29", weight: 1 }], createdAt: "t", updatedAt: "t", activatedAt: "t", closedAt: null };
  const saved: unknown[] = [];
  vi.stubGlobal("fetch", vi.fn(async (input: string, init?: RequestInit) => {
    if (input === "/api/session") return Response.json({ member, pending: [] });
    if (input === "/api/organization") return Response.json({ organization: { id: "org-demo", name: "Escuela", timezone: "America/Guatemala", configured: true } });
    if (input === "/api/sections") return Response.json({ sections: [section] });
    if (input === "/api/courses") return Response.json({ courses: [course] });
    if (input === "/api/programs") return Response.json({ programs: [{ id: "program-1", name: "Primaria", status: "active", settings: {}, locked: [], courseCount: 1 }] });
    if (input === "/api/sections/group-1") return Response.json({ section, today: "2026-02-02" });
    if (input === "/api/courses/course-1") return Response.json({ course, units: [], curriculum: { competencies: [], outcomes: [] } });
    if (input === "/api/courses/course-1/sessions") return Response.json({ sessions: [], today: "2026-02-02" });
    if (input === "/api/calendar?section=group-1") return Response.json({ breaks: [], today: "2026-02-02" });
    if (input === "/api/academic-years") return Response.json({ years: [year], today: "2026-02-02" });
    if (input === "/api/bell-schedules") return Response.json({ schedules: [] });
    if (input === "/api/calendars") return Response.json({ calendars: [{ id: "calendar-section", scope: "section", scopeId: "group-1", name: "Calendario de Sexto A", rules: [] }], categories: [] });
    if (input === "/api/courses/course-1/groups/group-1/schedule" && init?.method === "PUT") { saved.push(JSON.parse(String(init.body))); return Response.json({ classes: 10 }); }
    if (input.startsWith("/api/lessons")) return Response.json({ lessons: [] });
    if (input.endsWith("/materials")) return Response.json({ materials: [] });
    if (input === "/api/resources") return Response.json({ resources: [] });
    return Response.json({});
  }));
  history.replaceState(null, "", "/secciones/group-1/horario");
  render(<App/>);
  expect(await screen.findByRole("heading", { level: 1, name: "Horario" })).toBeTruthy();
  fireEvent.change(await screen.findByLabelText("Seguir un periodo"), { target: { value: "period-2" } });
  fireEvent.click(screen.getByLabelText("Lunes"));
  fireEvent.click(screen.getByRole("button", { name: "Guardar horario" }));
  await waitFor(() => expect(saved).toHaveLength(1));
  expect(saved[0]).toMatchObject({ periodId: "period-2", from: "2026-03-23", until: "2026-05-29" });
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
    policy: { scale: "letters_af", passingGrade: 60, letterThresholds: [90, 80, 70, 60], average: "simple" }, canEdit: true, canLock: false, canUnlock: false, canSubmit: true,
    activities: [] as unknown[], scores: [] as unknown[], comments: [] as unknown[], reviews: [] as unknown[] };
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
  // The open period is the first tab shown; without a plan it takes one score per student.
  expect((await screen.findByRole("tab", { name: "Primer bimestre" })).getAttribute("aria-selected")).toBe("true");
  expect(screen.getByRole("tab", { name: /Segundo bimestre.*Cerrado/ })).toBeTruthy();
  expect(screen.getByText(/Sin plan de evaluación/)).toBeTruthy();
  const cell = screen.getByLabelText("Nota del periodo de Beto") as HTMLInputElement;
  fireEvent.change(cell, { target: { value: "101" } });
  expect((screen.getByRole("button", { name: /^Guardar/ }) as HTMLButtonElement).disabled).toBe(true);
  fireEvent.change(cell, { target: { value: "55" } });
  expect(cell.closest("td")!.className).toContain("grade-dirty");
  fireEvent.click(screen.getByRole("button", { name: "Guardar 1 cambio" }));
  await waitFor(() => expect(saved).toEqual([{ grades: [{ learnerId: "learner-b", periodId: "period-1", score: 55 }], scores: [] }]));
  // The summary reads the year: each period, the average with its letter and the result.
  expect(await screen.findByRole("button", { name: "Guardar notas" })).toBeTruthy();
  fireEvent.click(screen.getByRole("tab", { name: "Resumen del ciclo" }));
  expect(await screen.findByText("88,5 (B)")).toBeTruthy();
  expect(screen.getByText("No aprueba (parcial)")).toBeTruthy();
  // A locked period is read-only.
  fireEvent.click(screen.getByRole("tab", { name: /Segundo bimestre/ }));
  expect(await screen.findByText(/Aprobó Administración/)).toBeTruthy();
  expect(screen.queryByLabelText("Nota del periodo de Ana")).toBeNull();
});
it("grades a period with its assessment plan: points per activity, keyboard, paste from a spreadsheet and the plan editor", async () => {
  const member = { id: "user-educator", username: "educador-demo", role: "educator", organizationId: "org-demo", permissions: { admin: false, coordination: null, grants: {} } };
  const course = { id: "course-1", title: "Matemáticas", objective: "Resolver.", educationType: "formal", level: "primary", modality: "in-person", pacing: "scheduled", format: "subject", settings: {}, status: "active", version: 1, updatedAt: "t",
    access: { role: "lead", assigned: ["group-1"], configure: false, edit: true, publish: true, review: true, team: false, educators: false, sections: "assigned" } };
  const section = { id: "group-1", courseId: "course-1", name: "Sexto A", status: "active", learnerCount: 2, educators: [], course: { id: "course-1", title: course.title, status: "active" }, pacing: "scheduled",
    indicators: { learners: 2, classes: 0, taught: 0, upcoming: 0, unrecorded: 0, lessons: 0, covered: 0, attendance: null }, next: null, teaches: true };
  const gradebook = { section: { id: "group-1", name: "Sexto A", courseId: "course-1", courseTitle: course.title, status: "active" }, year: { id: "year-1", name: "Ciclo 2026", from: "2026-01-12", until: "2026-11-27", status: "current" },
    years: [{ id: "year-1", name: "Ciclo 2026", status: "current" }], learners: [{ id: "learner-a", name: "Ana" }, { id: "learner-b", name: "Beto" }],
    periods: [{ id: "period-4", position: 4, name: "Cuarto bimestre", from: "2026-09-07", until: "2026-11-27", weight: 1, locked: false, lockedAt: null, lockedBy: null }],
    activities: [{ id: "assessment-1", periodId: "period-4", position: 0, title: "Tareas", kind: "task", points: 30, dueOn: null }, { id: "assessment-2", periodId: "period-4", position: 1, title: "Examen", kind: "exam", points: 70, dueOn: null }],
    scores: [{ activityId: "assessment-1", learnerId: "learner-a", points: 25 }], grades: [{ learnerId: "learner-a", periodId: "period-4", score: 25 }],
    comments: [{ learnerId: "learner-a", periodId: "period-4", body: "Muy constante.", updatedAt: "2026-10-20T10:00:00Z", updatedBy: "Lucía" }], reviews: [],
    results: [{ learnerId: "learner-a", average: 25, letter: null, passed: false, complete: true }, { learnerId: "learner-b", average: null, letter: null, passed: null, complete: false }],
    policy: { scale: "numeric_100", passingGrade: 60, letterThresholds: [90, 80, 70, 60], average: "simple" }, canEdit: true, canLock: false, canUnlock: false, canSubmit: true };
  const saved: unknown[] = [], plans: unknown[] = [];
  vi.stubGlobal("fetch", vi.fn(async (input: string, init?: RequestInit) => {
    if (input === "/api/session") return Response.json({ member, pending: [] });
    if (input === "/api/organization") return Response.json({ organization: { id: "org-demo", name: "Escuela", timezone: "America/Guatemala", configured: true } });
    if (input === "/api/sections/group-1") return Response.json({ section, today: "2026-10-28" });
    if (input === "/api/courses/course-1") return Response.json({ course, units: [], curriculum: { competencies: [], outcomes: [] } });
    if (input.endsWith("/plan")) { plans.push(JSON.parse(String(init!.body))); return Response.json({ gradebook }); }
    if (input.startsWith("/api/sections/group-1/grades/history")) return Response.json({ changes: [{ id: "history-1", learnerId: "learner-a", periodId: "period-4", activityId: "assessment-1", activity: "Tareas", before: null, after: 25, by: "Lucía", at: "2026-10-20T10:00:00Z" }] });
    if (input.startsWith("/api/sections/group-1/grades")) {
      if (init?.method === "PUT") saved.push(JSON.parse(String(init.body)));
      return Response.json({ gradebook });
    }
    if (input.startsWith("/api/lessons")) return Response.json({ lessons: [] });
    if (input.endsWith("/materials")) return Response.json({ materials: [] });
    if (input === "/api/resources") return Response.json({ resources: [] });
    if (input === "/api/programs") return Response.json({ programs: [] });
    return Response.json({});
  }));
  history.replaceState(null, "", "/secciones/group-1/notas?periodo=period-4");
  render(<App/>);
  expect(await screen.findByText(/2 actividades · 100 de 100 puntos/)).toBeTruthy();
  // The period score is the sum earned so far, with the points graded.
  expect(screen.getByText("de 30")).toBeTruthy();
  const tasks = screen.getByLabelText("Tareas de Beto") as HTMLInputElement, exam = screen.getByLabelText("Examen de Beto") as HTMLInputElement;
  fireEvent.change(exam, { target: { value: "71" } });
  expect(exam.getAttribute("aria-invalid")).toBe("true");
  fireEvent.change(exam, { target: { value: "" } });
  // Arrows move between cells.
  tasks.focus();
  fireEvent.keyDown(tasks, { key: "ArrowUp" });
  expect(document.activeElement).toBe(screen.getByLabelText("Tareas de Ana"));
  // Two rows and two columns pasted from a spreadsheet fill the grid from the focused cell.
  const pasteTarget = screen.getByLabelText("Tareas de Ana");
  fireEvent.paste(pasteTarget, { clipboardData: { getData: () => "28\t60\n20\t50,5\n" } });
  expect((screen.getByLabelText("Examen de Beto") as HTMLInputElement).value).toBe("50,5");
  expect(screen.getByText("88")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Guardar 4 cambios" }));
  await waitFor(() => expect(saved).toHaveLength(1));
  expect((saved[0] as { scores: unknown[] }).scores).toEqual([
    { learnerId: "learner-a", activityId: "assessment-1", points: 28 }, { learnerId: "learner-a", activityId: "assessment-2", points: 60 },
    { learnerId: "learner-b", activityId: "assessment-1", points: 20 }, { learnerId: "learner-b", activityId: "assessment-2", points: 50.5 }]);
  // The student's detail: the comment and the history of changes.
  fireEvent.click(await screen.findByRole("button", { name: "Detalle de Ana (tiene comentario)" }));
  expect(await screen.findByText(/Tareas/, { selector: "strong" })).toBeTruthy();
  expect((screen.getByLabelText("Comentario de Ana en Cuarto bimestre") as HTMLTextAreaElement).value).toBe("Muy constante.");
  fireEvent.click(screen.getByRole("button", { name: "Cerrar" }));
  // The plan editor: a template replaces the activities without scores and adds up to 100.
  fireEvent.click(screen.getByRole("button", { name: "Editar el plan" }));
  const dialog = await screen.findByRole("dialog", { name: "Plan de evaluación · Cuarto bimestre" });
  fireEvent.change(within(dialog).getByLabelText("Empezar con una plantilla"), { target: { value: "zona-60" } });
  expect(within(dialog).getByText("Suma 130 de 100 puntos")).toBeTruthy();
  expect((within(dialog).getByRole("button", { name: "Guardar el plan" }) as HTMLButtonElement).disabled).toBe(true);
  expect((within(dialog).getAllByRole("button", { name: "Quitar Tareas" })[0] as HTMLButtonElement).disabled).toBe(true);
  fireEvent.click(within(dialog).getAllByRole("button", { name: "Quitar Tareas" })[1]);
  expect(within(dialog).getByText("Suma 110 de 100 puntos")).toBeTruthy();
  fireEvent.click(within(dialog).getByRole("button", { name: "Quitar Pruebas cortas" }));
  expect(within(dialog).getByText("Suma 100 de 100 puntos")).toBeTruthy();
  fireEvent.click(within(dialog).getByRole("button", { name: "Guardar el plan" }));
  await waitFor(() => expect(plans).toHaveLength(1));
  expect((plans[0] as { activities: { title: string; points: number; id?: string }[] }).activities.map(item => [item.title, item.points, !!item.id])).toEqual([["Tareas", 30, true], ["Proyecto", 20, false], ["Participación", 10, false], ["Examen del periodo", 40, false]]);
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
