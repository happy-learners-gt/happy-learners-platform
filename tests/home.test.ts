import { expect, it } from "vitest";
import type { CourseProgress } from "@happy-learners/contracts";
import { courseAttention, homeCourses } from "@happy-learners/domain";

const today = "2026-11-02";
const course = (id: string, patch: Partial<CourseProgress> = {}): CourseProgress => ({
  courseId: id, title: `Curso ${id}`, team: [], lessons: 4, published: 4, changes: 0, outcomes: 5, taught: 5, assessed: 5,
  sessions: 10, attendanceRate: 95, learners: 12, lastActivity: "2026-10-30T10:00:00Z", ...patch,
});

it("HOME-01 names why a course needs attention, what affects students first", () => {
  expect(courseAttention(course("ok"), today)).toEqual([]);
  expect(courseAttention(course("a", { attendanceRate: 70, changes: 2, published: 3 }), today)).toEqual(["low-attendance", "unpublished-changes", "drafts"]);
  expect(courseAttention(course("b", { outcomes: 0, assessed: 0 }), today)).toEqual(["no-plan"]);
  expect(courseAttention(course("c", { assessed: 2 }), today)).toEqual(["unassessed"]);
  expect(courseAttention(course("d", { lastActivity: "2026-09-01T00:00:00Z" }), today)).toEqual(["inactive"]);
  // A course without students only counts its content: no plan, attendance or inactivity to worry about yet.
  expect(courseAttention(course("e", { learners: 0, outcomes: 0, attendanceRate: null, lastActivity: null, changes: 1 }), today)).toEqual(["unpublished-changes"]);
});

it("HOME-01 lists up to six courses, those that need attention first, and counts the rest for «Ver todos»", () => {
  const healthy = Array.from({ length: 20 }, (_, index) => course(`h${index}`, { lastActivity: `2026-10-${String(index + 10).padStart(2, "0")}T00:00:00Z` }));
  const result = homeCourses([...healthy, course("low", { attendanceRate: 60 }), course("draft", { published: 3 })], today);
  expect(result.attention).toBe(true);
  expect(result.listed.map(item => item.course.courseId)).toEqual(["low", "draft"]);
  expect(result.hidden).toBe(20);
  // Nothing needs attention: the most recently active ones.
  const calm = homeCourses(healthy, today);
  expect(calm.attention).toBe(false);
  expect(calm.listed.map(item => item.course.courseId)).toEqual(["h19", "h18", "h17", "h16", "h15", "h14"]);
  expect(calm.hidden).toBe(14);
  // Eight or fewer are all listed, in their order.
  expect(homeCourses(healthy.slice(0, 8), today)).toMatchObject({ hidden: 0, attention: false });
  expect(homeCourses(healthy.slice(0, 8), today).listed).toHaveLength(8);
});
