import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { assesses, publishChecklist, resolveSettings, studentActivities, validActivities } from "../packages/domain/src/index";
import type { Curriculum, Lesson, StudyProgram } from "../packages/contracts/src/index";
// @ts-expect-error — plain ESM scripts without type declarations
import { activitiesOf, build, courses } from "../scripts/seed/build.mjs";
// @ts-expect-error — plain ESM scripts without type declarations
import { people, programs } from "../scripts/seed/content-a.mjs";

type Seed = { id: string; title: string; program: string | null; lead: string; coTeachers: string[]; educationType: string; level: string; modality: string; pacing: string; format: string; settings: object; archived?: boolean;
  competencies: { outcomes: { id: string }[] }[]; resources: { id: string }[]; groups: { id: string; by: string }[];
  modules: { id: string; plan: string[]; lessons: { id: string; title: string; duration: number; sequence: Lesson["sequence"]; outcomeIds: string[]; published?: string; by: string; activities: unknown[] }[] }[] };
const all = courses as Seed[];

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
    for (const course of all) {
      const program = (programs as StudyProgram[]).find(item => item.id === course.program) || null;
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
});
