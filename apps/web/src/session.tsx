import { createContext, useContext } from "react";
import type { EffectivePreferences, Member, Organization } from "@happy-learners/contracts";

/** ST-160: `preferences` are the ones in force; `setPreferences` applies a saved change (appearance and formats) at once. */
export type Session = { member: Member; organization: Organization | null; setOrganization: (organization: Organization) => void; logout: () => void; preferences: EffectivePreferences | null; setPreferences: (preferences: EffectivePreferences) => void };
export const SessionContext = createContext<Session | null>(null);
export function useSession() {
  const session = useContext(SessionContext);
  if (!session) throw new Error("SessionContext is required");
  return session;
}
export const isEducator = (member: Member) => member.role === "educator";
export const roleLabel = (member: Member) => member.role === "admin" ? "Administración" : member.permissions?.coordination ? "Educador · Coordinación académica" : "Educador";
