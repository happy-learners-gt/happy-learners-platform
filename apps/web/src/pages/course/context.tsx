import { createContext, useCallback, useContext, useEffect, useState } from "react";
import type { ReactNode } from "react";
import type { Course, LearningUnit, Lesson, Material, Resource } from "@happy-learners/contracts";
import { api, message } from "../../api";
import { useSession, isEducator } from "../../session";

export type CourseData = {
  course: Course; units: LearningUnit[]; lessons: Lesson[]; materials: Material[]; legacyResources: Resource[];
  writable: boolean; educator: boolean; reload: () => Promise<void>;
};
const Context = createContext<CourseData | null>(null);
export function useCourse() {
  const value = useContext(Context);
  if (!value) throw new Error("CourseProvider is required");
  return value;
}

type State = { status: "loading" } | { status: "error"; error: string; code: number } | { status: "ready"; data: Omit<CourseData, "reload" | "writable" | "educator"> };

/** Loads a course once for all of its pages; pages call reload() after a change. */
export function useCourseLoader(id: string) {
  const { member } = useSession();
  const educator = isEducator(member);
  const [state, setState] = useState<State>({ status: "loading" });
  const load = useCallback(async () => {
    try {
      const [detail, lessons, materials, legacy] = await Promise.all([
        api<{ course: Course; units: LearningUnit[] }>(`/courses/${id}`),
        api<{ lessons: Lesson[] }>(`/lessons?${educator ? "drafts=1&" : ""}course=${id}`),
        api<{ materials: Material[] }>(`/courses/${id}/materials`),
        api<{ resources: Resource[] }>("/resources"),
      ]);
      setState({ status: "ready", data: { course: detail.course, units: detail.units, lessons: lessons.lessons, materials: materials.materials, legacyResources: legacy.resources } });
    } catch (error) {
      setState({ status: "error", error: message(error), code: (error as { status?: number }).status || 0 });
    }
  }, [id, educator]);
  useEffect(() => { setState({ status: "loading" }); void load(); }, [load]);
  return { state, load, educator };
}

export function CourseProvider({ data, children }: { data: CourseData; children: ReactNode }) {
  return <Context.Provider value={data}>{children}</Context.Provider>;
}
