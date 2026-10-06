import { createContext, useCallback, useContext, useEffect, useState } from "react";
import type { ReactNode } from "react";
import type { Course, CourseAccess, CourseSettings, Curriculum, LearningUnit, Lesson, Material, Pacing, Resource, StudyProgram } from "@happy-learners/contracts";
import { effectiveProfile, moduleNoun, resolveSettings, teachesSection } from "@happy-learners/domain";
import type { ModuleNoun, SettingSource } from "@happy-learners/domain";
import { api, message } from "../../api";

export type CourseData = {
  course: Course; units: LearningUnit[]; curriculum: Curriculum; lessons: Lesson[]; materials: Material[]; legacyResources: Resource[];
  program: StudyProgram | null;
  /** What the person can do in this course, as the server decided it (DEC-023). */
  access: CourseAccess;
  /** The team edits lessons and resources of an active course. */
  writable: boolean;
  /** The lead publishes lessons and organizes modules and the curriculum plan. */
  publisher: boolean;
  /** Administration configures the course, its team, sections, students and schedules. */
  configurable: boolean;
  /** Whether the person plans and teaches the classes of a section. */
  teaches: (groupId: string) => boolean;
  reload: () => Promise<void>;
  /** What the course actually does, and where each value comes from. */
  settings: Required<CourseSettings>; sources: Record<keyof CourseSettings, SettingSource>;
  /** How the course's modules are called, in every grammatical form. */
  noun: ModuleNoun;
  /** With a calendar, sections follow a schedule of classes; at their own pace, each student works through the published lessons (DEC-027). */
  pacing: Pacing;
};
const Context = createContext<CourseData | null>(null);
export function useCourse() {
  const value = useContext(Context);
  if (!value) throw new Error("CourseProvider is required");
  return value;
}

type Loaded = Pick<CourseData, "course" | "units" | "curriculum" | "lessons" | "materials" | "legacyResources" | "program">;
type State = { status: "loading" } | { status: "error"; error: string; code: number } | { status: "ready"; data: Loaded };

/** Loads a course once for all of its pages; pages call reload() after a change. */
export function useCourseLoader(id: string) {
  const [state, setState] = useState<State>({ status: "loading" });
  const load = useCallback(async () => {
    try {
      const [detail, lessons, materials, legacy, programs] = await Promise.all([
        api<{ course: Course; units: LearningUnit[]; curriculum: Curriculum }>(`/courses/${id}`),
        api<{ lessons: Lesson[] }>(`/lessons?drafts=1&course=${id}`),
        api<{ materials: Material[] }>(`/courses/${id}/materials`),
        api<{ resources: Resource[] }>("/resources"),
        api<{ programs: StudyProgram[] }>("/programs"),
      ]);
      setState({ status: "ready", data: { course: detail.course, units: detail.units, curriculum: detail.curriculum, lessons: lessons.lessons, materials: materials.materials, legacyResources: legacy.resources, program: programs.programs.find(item => item.id === detail.course.programId) || null } });
    } catch (error) {
      setState({ status: "error", error: message(error), code: (error as { status?: number }).status || 0 });
    }
  }, [id]);
  useEffect(() => { setState({ status: "loading" }); void load(); }, [load]);
  return { state, load };
}

export function courseConfiguration(course: Course, program: StudyProgram | null) {
  const { values, source } = resolveSettings(course, program);
  return { settings: values, sources: source, noun: moduleNoun(values.moduleLabel), pacing: effectiveProfile(course, program).pacing };
}
/** The capabilities of an active course; an archived course is read-only for everyone but administration's restore. */
export function capabilities(course: Course) {
  const access = course.access!, active = course.status === "active";
  return { access, writable: access.edit && active, publisher: access.publish && active, configurable: access.configure && active, teaches: (groupId: string) => active && teachesSection(access, groupId) };
}

export function CourseProvider({ data, children }: { data: CourseData; children: ReactNode }) {
  return <Context.Provider value={data}>{children}</Context.Provider>;
}
