import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { assesses, classLoad, lessonMinutes, publishChecklist, resolveSettings, studentActivities, validActivities } from "../packages/domain/src/index";
import type { Curriculum, Lesson, StudyProgram } from "../packages/contracts/src/index";
// @ts-expect-error — plain ESM scripts without type declarations
import { activitiesOf, build, courses, englishSeed, routes } from "../scripts/seed/build.mjs";
// @ts-expect-error — plain ESM scripts without type declarations
import { people, programs } from "../scripts/seed/content-a.mjs";
// @ts-expect-error — plain ESM scripts without type declarations
import { routeCourses, routePrograms } from "../scripts/seed/content-routes.mjs";
// @ts-expect-error — plain ESM scripts without type declarations
import { englishCourses, englishPeople, englishPrograms } from "../scripts/seed/content-english.mjs";
// @ts-expect-error — plain ESM scripts without type declarations
import { book, bookPages, pilotSql } from "../scripts/seed/pilot.mjs";
// @ts-expect-error — plain ESM scripts without type declarations
import { gradebookActivities, gradebookSql } from "../scripts/seed/gradebook.mjs";
// @ts-expect-error — plain ESM scripts without type declarations
import { calendarSql } from "../scripts/seed/calendar.mjs";
// @ts-expect-error — plain ESM scripts without type declarations
import { calendarEventsSql } from "../scripts/seed/calendar-events.mjs";
// @ts-expect-error — plain ESM scripts without type declarations
import { sectionFreedomSql } from "../scripts/seed/section-freedom.mjs";

type Seed = { id: string; title: string; program: string | null; lead: string; coTeachers: string[]; educationType: string; level: string; modality: string; pacing: string; format: string; settings: object; archived?: boolean;
  competencies: { outcomes: { id: string }[] }[]; resources: { id: string }[]; groups: { id: string; by: string }[];
  modules: { id: string; plan: string[]; lessons: { id: string; title: string; duration: number; sequence: Lesson["sequence"]; outcomeIds: string[]; published?: string; by: string; activities: unknown[] }[] }[] };
const all = courses as Seed[];
const paths = routeCourses as (Seed & { requires: string[] })[];
type Scheduled = Seed & { requires: string[]; groups: { id: string; by: string; educators: string[]; schedule: { durationMinutes: number }; plan: string[][] }[] };
const levels = englishCourses as Scheduled[];

describe("demo organization seed", () => {
  it("is generated from its sources and checked in unchanged", () => {
    expect(readFileSync(new URL("../database/migrations/0015_demo_organization.sql", import.meta.url), "utf8")).toBe(build().sql);
  });
  it("keeps one statement per line so the store can run it in chunks below the SQL length limit", () => {
    const lines = (build().sql as string).split("\n").filter(Boolean);
    expect(lines.filter(line => !line.startsWith("--") && !line.endsWith(";"))).toEqual([]);
    expect(Math.max(...lines.map(line => line.length))).toBeLessThan(60_000);
  });
  it("has at least five complete active courses, each with a team, curriculum, modules, lessons, resources and groups", () => {
    const active = all.filter(course => !course.archived);
    expect(active.length).toBeGreaterThanOrEqual(5);
    for (const course of active) {
      expect([course.lead, ...course.coTeachers].every(id => people.some((person: { id: string }) => person.id === id)), course.title).toBe(true);
      expect(course.competencies.flatMap(item => item.outcomes).length, course.title).toBeGreaterThanOrEqual(3);
      expect(course.modules.length, course.title).toBeGreaterThanOrEqual(3);
      expect(course.modules.flatMap(module => module.lessons).length, course.title).toBeGreaterThanOrEqual(4);
      expect(course.resources.length, course.title).toBeGreaterThanOrEqual(2);
      expect(course.groups.length, course.title).toBeGreaterThanOrEqual(1);
    }
  });
  it("only writes lessons the editor and the server would accept, and publishes what each course requires", () => {
    for (const course of [...all, ...paths, ...levels]) {
      const program = ([...programs, ...routePrograms, ...englishPrograms] as StudyProgram[]).find(item => item.id === course.program) || null;
      const { values } = resolveSettings(course as unknown as Parameters<typeof resolveSettings>[0], program);
      const outcomes = course.competencies.flatMap(item => item.outcomes.map(outcome => outcome.id));
      const resources = course.resources.map(item => item.id);
      const curriculum: Curriculum = { competencies: [], outcomes: outcomes.map((id, position) => ({ id, courseId: course.id, statement: id, level: "apply", evidence: "", position, status: "active", updatedAt: "" })), unitOutcomes: [] };
      for (const module of course.modules) {
        expect(module.plan.every(id => outcomes.includes(id)), module.id).toBe(true);
        for (const lesson of module.lessons) {
          const activities = activitiesOf(lesson);
          expect(validActivities(activities), lesson.id).toBe(true);
          expect(lesson.outcomeIds.every(id => outcomes.includes(id)), lesson.id).toBe(true);
          expect(activities.flatMap((a: { blocks: { kind: string; resourceId?: string }[] }) => a.blocks).filter((b: { kind: string }) => b.kind === "resource").every((b: { resourceId: string }) => resources.includes(b.resourceId)), lesson.id).toBe(true);
          if (!lesson.published) continue;
          const view = { id: lesson.id, title: lesson.title, duration: lesson.duration, sequence: lesson.sequence, outcomeIds: lesson.outcomeIds, activities } as unknown as Lesson;
          if (values.outcomesRequired) expect(lesson.outcomeIds.length, `${lesson.id} needs outcomes`).toBeGreaterThan(0);
          if (values.assessmentRequired) expect(activities.some(assesses), `${lesson.id} needs an assessment`).toBe(true);
          // The demo shows a clean checklist: every moment has activities and the time fits the duration.
          const checks = Object.fromEntries(publishChecklist(view, curriculum).map(item => [item.id, item.ok]));
          expect(checks.moments, `${lesson.id} moments`).toBe(true);
          expect(checks.time, `${lesson.id} time`).toBe(true);
          expect(studentActivities(activities).every(a => a.blocks!.length > 0), lesson.id).toBe(true);
        }
      }
    }
  });
  it("records who did what, in order, with real people", () => {
    const { events } = build() as { events: { actor: string; occurredAt: string }[] };
    const actors = new Set(events.map(entry => entry.actor));
    for (const person of people as { id: string }[]) expect(actors.has(person.id), person.id).toBe(true);
    expect(events.length).toBeGreaterThan(150);
  });
  it("adds three programs whose courses form a path, each requiring the previous one (DEC-033)", () => {
    expect(readFileSync(new URL("../database/migrations/0028_program_routes.sql", import.meta.url), "utf8")).toBe(build(routes).sql);
    expect(routePrograms).toHaveLength(3);
    for (const program of routePrograms as { id: string }[]) {
      const path = paths.filter(course => course.program === program.id);
      expect(path.length, program.id).toBeGreaterThanOrEqual(3);
      expect(path.length, program.id).toBeLessThanOrEqual(4);
      path.forEach((course, index) => expect(course.requires, course.id).toEqual(index ? [path[index - 1].id] : []));
      for (const course of path) {
        expect([course.lead, ...course.coTeachers].every(id => (people as { id: string }[]).some(person => person.id === id)), course.id).toBe(true);
        expect(course.modules.flatMap(module => module.lessons).every(lesson => lesson.published), course.id).toBe(true);
      }
    }
  });
  it("adds an English program from A1 to C2 whose sections plan classes against their time (DEC-035)", () => {
    expect(readFileSync(new URL("../database/migrations/0030_english_program.sql", import.meta.url), "utf8")).toBe(build(englishSeed).sql);
    const team = [...people, ...englishPeople] as { id: string }[];
    expect(levels.map(course => course.title.slice(0, 9))).toEqual(["Inglés A1", "Inglés A2", "Inglés B1", "Inglés B2", "Inglés C1", "Inglés C2"]);
    levels.forEach((course, index) => expect(course.requires, course.id).toEqual(index ? [levels[index - 1].id] : []));
    const lessons = new Map(levels.flatMap(course => course.modules.flatMap(module => module.lessons)).map(lesson => [lesson.id, lesson]));
    for (const course of levels) {
      expect([course.lead, ...course.coTeachers].every(id => team.some(person => person.id === id)), course.id).toBe(true);
      for (const lesson of course.modules.flatMap(module => module.lessons)) {
        expect(lesson.published, lesson.id).toBeTruthy();
        // A lesson lasts what its activities add up to.
        expect(lesson.duration, lesson.id).toBe(lessonMinutes({ activities: activitiesOf(lesson) }));
      }
      for (const group of course.groups) {
        expect(group.educators.every(id => [course.lead, ...course.coTeachers].includes(id)), group.id).toBe(true);
        expect(group.plan.flat().every(id => lessons.has(id) && course.modules.some(module => module.lessons.some(lesson => lesson.id === id))), group.id).toBe(true);
      }
    }
    // The first A1 class plans two 40-minute lessons in one hour: the demo of a plan that exceeds the class.
    const a1 = levels[0].groups[0];
    expect(classLoad(a1.schedule.durationMinutes, a1.plan[0].map(id => lessons.get(id)!.duration))).toMatchObject({ planned: 80, available: 60, excess: 20, state: "over" });
    expect(classLoad(a1.schedule.durationMinutes, a1.plan[1].map(id => lessons.get(id)!.duration)).state).toBe("fits");
  });
});

describe("school pilot seed (0054, REL-010)", () => {
  it("is generated from scripts/seed/pilot.mjs and checked in unchanged, one statement per line, only in org-demo", () => {
    expect(readFileSync(new URL("../database/migrations/0054_demo_pilot.sql", import.meta.url), "utf8")).toBe(pilotSql);
    const lines = (pilotSql as string).split("\n").filter(line => line && !line.startsWith("--"));
    expect(lines.every(line => /^(INSERT( OR IGNORE)? INTO|UPDATE) /.test(line) && line.endsWith(";"))).toBe(true);
    expect(lines.filter(line => line.startsWith("INSERT")).every(line => line.includes("EXISTS(SELECT 1 FROM organizations WHERE id='org-demo')"))).toBe(true);
    expect(lines.filter(line => line.startsWith("UPDATE")).every(line => line.includes("organization_id='org-demo'"))).toBe(true);
  });
  it("uses ids the API routes accept and a book whose text and PDF agree", () => {
    for (const prefix of ["year", "period", "reference"]) for (const id of (pilotSql as string).match(new RegExp(`'${prefix}-[^']+'`, "g")) || []) expect(id).toMatch(new RegExp(`^'${prefix}-[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}'$`));
    expect(Buffer.from(book.pdf).subarray(0, 8).toString()).toBe("%PDF-1.4");
    expect(pilotSql).toContain(book.sha256);
    expect(bookPages).toHaveLength(16);
    // The book covers every indicator of the plan except operations with decimals (4.5): it only names the decimal
    // number system next to the Maya one, so the search proposes that page and the AI review has a real gap to find.
    expect(bookPages.join(" ").toLowerCase()).not.toContain("decimales");
  });
  it("only writes lessons the editor accepts", () => {
    const lessons = [...(pilotSql as string).matchAll(/INSERT INTO lessons\([^)]*\) SELECT '[^']+','[^']+','published','((?:[^']|'')*)'/g)].map(match => JSON.parse(match[1].replaceAll("''", "'")));
    expect(lessons.map(lesson => lesson.title)).toEqual(["Polígonos regulares e irregulares", "Perímetro de polígonos"]);
    for (const lesson of lessons) expect(validActivities(lesson.activities)).toBe(true);
  });
});

describe("professional gradebook seed (0056, 1.2.3)", () => {
  it("is generated from scripts/seed/gradebook.mjs and checked in unchanged, only in org-demo, with a plan of 100 points", () => {
    expect(readFileSync(new URL("../database/migrations/0056_demo_gradebook.sql", import.meta.url), "utf8")).toBe(gradebookSql);
    const lines = (gradebookSql as string).split("\n").filter(line => line && !line.startsWith("--"));
    expect(lines.every(line => /^(INSERT INTO|DELETE FROM) /.test(line) && line.endsWith(";"))).toBe(true);
    expect(lines.filter(line => line.startsWith("INSERT")).every(line => line.includes("EXISTS(SELECT 1 FROM organizations WHERE id='org-demo')"))).toBe(true);
    // The only rows it removes are the pilot's own fourth-bimestre scores of «6.º A», once its plan exists.
    expect(lines.filter(line => line.startsWith("DELETE"))).toEqual([expect.stringMatching(/^DELETE FROM section_grades WHERE group_id='seed-group-mat-6a' AND period_id='period-[a-f0-9-]{36}' AND id LIKE 'seed-grade-%' AND updated_at='2026-10-23T20:00:00.000Z' AND EXISTS/)]);
    expect((gradebookActivities as { points: number }[]).reduce((sum, item) => sum + item.points, 0)).toBe(100);
    for (const id of (gradebookSql as string).match(/'assessment-[^']+'/g) || []) expect(id).toMatch(/^'assessment-[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}'$/);
  });
});

describe("academic calendar seed (0058, 1.2.4)", () => {
  it("is generated from scripts/seed/calendar.mjs and checked in unchanged, only in org-demo", () => {
    expect(readFileSync(new URL("../database/migrations/0058_demo_calendar.sql", import.meta.url), "utf8")).toBe(calendarSql);
    const lines = (calendarSql as string).split("\n").filter(line => line && !line.startsWith("--"));
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatch(/^INSERT INTO bell_schedules\(.*WHERE EXISTS\(SELECT 1 FROM organizations WHERE id='org-demo'\) AND NOT EXISTS/);
    expect(lines[0]).toMatch(/'bell-[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}'/);
  });
});

describe("institutional calendar events seed (0063, 1.3.4)", () => {
  it("is generated from scripts/seed/calendar-events.mjs and checked in unchanged, only in org-demo", () => {
    expect(readFileSync(new URL("../database/migrations/0063_demo_calendar_events.sql", import.meta.url), "utf8")).toBe(calendarEventsSql);
    const lines = (calendarEventsSql as string).split("\n").filter(line => line && !line.startsWith("--"));
    expect(lines.every(line => line.startsWith("INSERT INTO ") && line.endsWith(";"))).toBe(true);
    expect(lines.every(line => line.includes("EXISTS(SELECT 1 FROM organizations WHERE id='org-demo')"))).toBe(true);
    expect(lines.some(line => line.includes("Exámenes del cuarto bimestre") && line.includes("2026-11-16"))).toBe(true);
    expect(lines.some(line => line.includes("Admisiones 2027") && line.includes("2027-01-11"))).toBe(true);
    expect(lines.some(line => line.includes("Inscripciones 2027"))).toBe(true);
    expect(lines.some(line => line.includes("Feria de ciencias"))).toBe(true);
    expect(lines.some(line => line.includes("Acto de clausura") && line.includes("2026-11-27"))).toBe(true);
    expect(lines.filter(line => line.startsWith("INSERT INTO calendar_rules"))).toHaveLength(13);
  });
});

describe("section freedom seed (0067, 1.3.6)", () => {
  it("is generated from scripts/seed/section-freedom.mjs and checked in unchanged, only in org-demo", () => {
    expect(readFileSync(new URL("../database/migrations/0067_demo_section_freedom.sql", import.meta.url), "utf8")).toBe(sectionFreedomSql);
    const lines = (sectionFreedomSql as string).split("\n").filter(line => line && !line.startsWith("--"));
    expect(lines.every(line => line.startsWith("INSERT INTO ") && line.endsWith(";"))).toBe(true);
    expect(lines.every(line => line.includes("EXISTS(SELECT 1 FROM organizations WHERE id='org-demo')"))).toBe(true);
    expect(lines.some(line => line.includes("Didáctica de la lectura") && line.includes('"sectionFreedom":"flexible"') && line.includes("'bachelor'"))).toBe(true);
    expect(lines.some(line => line.includes("seed-lesson-catedra-propia") && line.includes("seed-group-catedra-a"))).toBe(true);
    expect(lines.some(line => line.includes("seed-lesson-catedra-opcional") && line.includes("hidden"))).toBe(true);
    expect(lines.some(line => line.includes("Ensayo de la sección B") && line.includes("seed-group-catedra-b"))).toBe(true);
  });
});
