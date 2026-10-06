import { useEffect, useSyncExternalStore } from "react";
import type { Course, SectionSummary, StudyProgram } from "@happy-learners/contracts";
import { api, changed } from "./api";

/** What the menu lists for the signed-in person: their courses, with their programs, and the sections they work with. */
export type Workspace = { owner: string; sections: SectionSummary[] | null; courses: Course[] | null; programs: StudyProgram[] | null; failed: boolean };

const empty = (owner: string): Workspace => ({ owner, sections: null, courses: null, programs: null, failed: false });
let state: Workspace = empty("");
let pending: Promise<void> | null = null, again = false, timer: ReturnType<typeof setTimeout> | undefined;
const listeners = new Set<() => void>();
const publish = (next: Workspace) => { state = next; listeners.forEach(listener => listener()); };
// Only changes to courses, programs and sections reach the menu: their names, status, settings, creation and who teaches them.
const affects = /^\/(courses(\/[^/]+(\/duplicate|\/groups(\/[^/]+(\/educators)?)?)?)?|programs(\/[^/]+)?)$/;

function refresh(owner: string): Promise<void> {
  if (pending) { again = true; return pending; }
  pending = Promise.all([api<{ sections: SectionSummary[] }>("/sections"), api<{ courses: Course[] }>("/courses"), api<{ programs: StudyProgram[] }>("/programs")])
    .then(([{ sections }, { courses }, { programs }]) => { if (state.owner === owner) publish({ owner, sections, courses, programs, failed: false }); })
    .catch(() => { if (state.owner === owner) publish({ ...state, failed: true }); })
    .finally(() => { pending = null; if (again) { again = false; void refresh(state.owner); } });
  return pending;
}

if (typeof window !== "undefined") addEventListener(changed, event => {
  if (!state.owner || !affects.test((event as CustomEvent<string>).detail.split("?")[0])) return;
  clearTimeout(timer); timer = setTimeout(() => void refresh(state.owner), 250);
});

/** The menu's lists, loaded once per person and refreshed after they change a course, a program or a section. */
export function useWorkspace(owner: string, missing?: string) {
  const current = useSyncExternalStore(listener => { listeners.add(listener); return () => listeners.delete(listener); }, () => state);
  useEffect(() => {
    if (state.owner !== owner) { publish(empty(owner)); void refresh(owner); }
    else if (state.failed) void refresh(owner);
  }, [owner]);
  // A section or course the lists do not have yet, such as one just assigned by administration.
  useEffect(() => {
    if (!missing || state.owner !== owner || !state.sections || !state.courses) return;
    if (!state.sections.some(item => item.id === missing) && !state.courses.some(item => item.id === missing)) void refresh(owner);
  }, [missing, owner]);
  return current.owner === owner ? current : empty(owner);
}
