import { createContext, useContext } from "react";
import type { SectionSummary } from "@happy-learners/contracts";

/** The section being worked on: one instance of its course, with its own students, schedule, classes and progress (DEC-024). */
export type SectionData = { section: SectionSummary; today: string; base: string; reload: () => Promise<void> };
const Context = createContext<SectionData | null>(null);
export const SectionProvider = Context.Provider;
export function useSection() {
  const value = useContext(Context);
  if (!value) throw new Error("SectionProvider is required");
  return value;
}
export const sectionPath = (id: string) => `/secciones/${id}`;
