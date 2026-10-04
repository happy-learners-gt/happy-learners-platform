import { createContext, useCallback, useContext, useEffect, useState } from "react";
import type { ReactNode } from "react";
import type { Course, CourseSettings, Curriculum, LearningUnit, Lesson, Material, Resource, StudyProgram } from "@happy-learners/contracts";
import { moduleNoun, resolveSettings } from "@happy-learners/domain";
import type { ModuleNoun, SettingSource } from "@happy-learners/domain";
import { api, message } from "../../api";
import { useSession, isEducator } from "../../session";

export type CourseData = {
  course: Course; units: LearningUnit[]; curriculum: Curriculum; lessons: Lesson[]; materials: Material[]; legacyResources: Resource[];
  program: StudyProgram | null;
  writable: boolean; educator: boolean; admin: boolean;
  /** The member is an educator of the course's teaching team: the only people who reach its groups and attendance. */
  classroom: boolean;
  reload: () => Promise<void>;
  /** What the course actually does, and where each value comes from. */
  settings: Required<CourseSettings>; sources: Record<keyof CourseSettings, SettingSource>;
  /** How the course's modules are called, in every grammatical form. */
  noun: ModuleNoun;
};
const Context = createContext<CourseData | null>(null);
export function useCourse() {
  const value = useContext(Context);
  if (!value) throw new Error("CourseProvider is required");
  return value;
}

type State = { status: "loading" } | { status: "error"; error: string; code: number } | { status: "ready"; data: Omit<CourseData, "reload" | "writable" | "educator" | "admin" | "classroom" | "settings" | "sources" | "noun"> };

/** Loads a course once for all of its pages; pages call reload() after a change. */
export function useCourseLoader(id: string) {
  const { member } = useSession();
  const educator = isEducator(member), admin = member.role === "admin";
  const [state, setState] = useState<State>({ status: "loading" });
  const load = useCallback(async () => {
    try {
      const [detail, lessons, materials, legacy, programs] = await Promise.all([
        api<{ course: Course; units: LearningUnit[]; curriculum: Curriculum }>(`/courses/${id}`),
        api<{ lessons: Lesson[] }>(`/lessons?${educator ? "drafts=1&" : ""}course=${id}`),
        api<{ materials: Material[] }>(`/courses/${id}/materials`),
        api<{ resources: Resource[] }>("/resources"),
        api<{ programs: StudyProgram[] }>("/programs"),
      ]);
      setState({ status: "ready", data: { course: detail.course, units: detail.units, curriculum: detail.curriculum, lessons: lessons.lessons, materials: materials.materials, legacyResources: legacy.resources, program: programs.programs.find(item => item.id === detail.course.programId) || null } });
    } catch (error) {
      setState({ status: "error", error: message(error), code: (error as { status?: number }).status || 0 });
    }
  }, [id, educator]);
  useEffect(() => { setState({ status: "loading" }); void load(); }, [load]);
  return { state, load, educator, admin };
}

export function courseConfiguration(course: Course, program: StudyProgram | null) {
  const { values, source } = resolveSettings(course, program);
  return { settings: values, sources: source, noun: moduleNoun(values.moduleLabel) };
}

export function CourseProvider({ data, children }: { data: CourseData; children: ReactNode }) {
  return <Context.Provider value={data}>{children}</Context.Provider>;
}
