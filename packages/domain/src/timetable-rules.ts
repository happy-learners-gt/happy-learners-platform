import type { AiTokenUsage } from "./ai-usage";
import type { SolverRule } from "./timetable-solver";
import { weekdayNames } from "./timetable-solver";

/**
 * The rules of a timetable (1.4.3): checked against the sections and educators that exist, and the task that turns a
 * rule written in words into these rules (`rules-to-constraints`). What the model proposes is only shown: the person
 * confirms each rule before the solver uses it.
 */
export const rulesPromptVersion = "2026-10-30.1";
export interface RuleContext { sections: { id: string; name: string }[]; educators: { id: string; name: string }[] }
export interface RulesInput { text: string; context: RuleContext }
export interface RulesOutput { rules: { kind: string; educatorId: string | null; sectionId: string | null; sectionIds: string[]; weekday: number | null; weekdays: number[]; from: string | null; to: string | null; minutes: number | null }[] }
export interface RulesTranslator { readonly kind: "fixture" | "openai"; translate(input: RulesInput, observe?: (usage: AiTokenUsage) => void): Promise<RulesOutput> }

const clock = /^([01]\d|2[0-3]):[0-5]\d$/;
const isDay = (value: unknown): value is number => Number.isInteger(value) && (value as number) >= 0 && (value as number) <= 6;

/** One rule as the page or the model writes it, or null if it names something that does not exist or is not valid. */
export function solverRule(value: unknown, context: RuleContext): SolverRule | null {
  const rule = value && typeof value === "object" ? value as Record<string, unknown> : {};
  const educator = context.educators.some(item => item.id === rule.educatorId) ? rule.educatorId as string : null;
  const section = context.sections.some(item => item.id === rule.sectionId) ? rule.sectionId as string : null;
  switch (rule.kind) {
    case "unavailable": {
      const from = typeof rule.from === "string" && clock.test(rule.from) ? rule.from : "00:00", to = typeof rule.to === "string" && clock.test(rule.to) ? rule.to : "23:59";
      return educator && isDay(rule.weekday) && from < to ? { kind: "unavailable", educatorId: educator, weekday: rule.weekday, from, to } : null;
    }
    case "max-daily": return educator && Number.isInteger(rule.minutes) && (rule.minutes as number) >= 30 && (rule.minutes as number) <= 720 ? { kind: "max-daily", educatorId: educator, minutes: rule.minutes as number } : null;
    case "shared-students": {
      const ids = Array.isArray(rule.sectionIds) ? [...new Set(rule.sectionIds.filter((id): id is string => typeof id === "string" && context.sections.some(item => item.id === id)))] : [];
      return ids.length >= 2 && ids.length === (rule.sectionIds as unknown[]).length ? { kind: "shared-students", sectionIds: ids } : null;
    }
    case "not-on": return section && isDay(rule.weekday) ? { kind: "not-on", sectionId: section, weekday: rule.weekday } : null;
    case "preferred-days": {
      const days = Array.isArray(rule.weekdays) ? [...new Set(rule.weekdays.filter(isDay))] : [];
      return section && days.length ? { kind: "preferred-days", sectionId: section, weekdays: days.sort() } : null;
    }
    default: return null;
  }
}

/** A rule in words, for the list of rules and for confirming what the model understood. */
export function ruleText(rule: SolverRule, context: RuleContext): string {
  const educator = (id: string) => context.educators.find(item => item.id === id)?.name || "Docente";
  const section = (id: string) => context.sections.find(item => item.id === id)?.name || "Sección";
  switch (rule.kind) {
    case "unavailable": return rule.from === "00:00" && rule.to === "23:59" ? `${educator(rule.educatorId)} no da clases el ${weekdayNames[rule.weekday]}` : `${educator(rule.educatorId)} no da clases el ${weekdayNames[rule.weekday]} de ${rule.from} a ${rule.to}`;
    case "max-daily": return `${educator(rule.educatorId)} da como máximo ${rule.minutes} minutos de clase al día`;
    case "shared-students": return `${rule.sectionIds.map(section).join(", ")} comparten estudiantes: no coinciden en horario`;
    case "not-on": return `${section(rule.sectionId)} no tiene clase el ${weekdayNames[rule.weekday]}`;
    case "preferred-days": return `${section(rule.sectionId)} prefiere ${rule.weekdays.map(day => weekdayNames[day]).join(" y ")}`;
  }
}

export const rulesSchema = {
  type: "object", additionalProperties: false, required: ["rules"],
  properties: { rules: { type: "array", items: { type: "object", additionalProperties: false, required: ["kind", "educatorId", "sectionId", "sectionIds", "weekday", "weekdays", "from", "to", "minutes"], properties: {
    kind: { type: "string", enum: ["unavailable", "max-daily", "shared-students", "not-on", "preferred-days"] },
    educatorId: { anyOf: [{ type: "string" }, { type: "null" }] }, sectionId: { anyOf: [{ type: "string" }, { type: "null" }] },
    sectionIds: { type: "array", items: { type: "string" } }, weekday: { anyOf: [{ type: "integer" }, { type: "null" }] }, weekdays: { type: "array", items: { type: "integer" } },
    from: { anyOf: [{ type: "string" }, { type: "null" }] }, to: { anyOf: [{ type: "string" }, { type: "null" }] }, minutes: { anyOf: [{ type: "integer" }, { type: "null" }] },
  } } } },
} as const;

export function rulesPrompt(input: RulesInput) {
  const system = "Traduces reglas de horario escritas por una persona a reglas estructuradas. Usa solo los ids de la lista. Si una parte no se puede expresar con estas reglas, omítela. Devuelve solo el objeto JSON pedido.";
  const user = [
    `Reglas posibles: "unavailable" (docente no disponible un día, con from y to HH:MM opcionales), "max-daily" (minutos máximos de clase al día de un docente), "shared-students" (secciones que comparten estudiantes y no pueden coincidir), "not-on" (una sección no tiene clase un día), "preferred-days" (días preferidos de una sección). Días: 0 domingo, 1 lunes, 2 martes, 3 miércoles, 4 jueves, 5 viernes, 6 sábado. Los campos que no usa una regla van en null o vacíos.`,
    `Docentes:\n${input.context.educators.map(item => `- ${item.id}: ${item.name}`).join("\n")}`,
    `Secciones:\n${input.context.sections.map(item => `- ${item.id}: ${item.name}`).join("\n")}`,
    `Regla escrita:\n"""\n${input.text}\n"""`,
  ].join("\n\n");
  return { system, user };
}

const fold = (text: string) => text.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
const dayIn = (text: string) => { const index = weekdayNames.map(fold).findIndex(day => new RegExp(`\\b${day}\\b`).test(fold(text))); return index >= 0 ? index : null; };
const mentioned = <T extends { name: string }>(text: string, items: T[]) => items.filter(item => fold(text).includes(fold(item.name))).sort((a, b) => fold(text).indexOf(fold(a.name)) - fold(text).indexOf(fold(b.name)));
const empty = { educatorId: null, sectionId: null, sectionIds: [], weekday: null, weekdays: [], from: null, to: null, minutes: null };

/** The local translator: common phrasings, one sentence per rule, deterministically. */
export const fixtureRulesTranslator: RulesTranslator = {
  kind: "fixture",
  async translate(input) {
    const rules: RulesOutput["rules"] = [];
    // A sentence ends at a period followed by a space (names like «3.º A» keep theirs), a semicolon or a line break.
    for (const sentence of input.text.split(/\.\s+|[;\n]+/).map(item => item.trim().replace(/\.$/, "")).filter(Boolean)) {
      const folded = fold(sentence), educators = mentioned(sentence, input.context.educators), sections = mentioned(sentence, input.context.sections), day = dayIn(sentence);
      const minutes = /(\d{2,3})\s*min/.exec(folded)?.[1];
      if (folded.includes("comparten") && sections.length >= 2) rules.push({ ...empty, kind: "shared-students", sectionIds: sections.map(item => item.id) });
      else if (/maxim|como mucho/.test(folded) && minutes && educators[0]) rules.push({ ...empty, kind: "max-daily", educatorId: educators[0].id, minutes: Number(minutes) });
      else if (/prefiere|mejor/.test(folded) && sections[0]) rules.push({ ...empty, kind: "preferred-days", sectionId: sections[0].id, weekdays: weekdayNames.map((name, index) => new RegExp(`\\b${fold(name)}\\b`).test(folded) ? index : -1).filter(index => index >= 0) });
      else if (/\bno\b/.test(folded) && day !== null && educators[0]) rules.push({ ...empty, kind: "unavailable", educatorId: educators[0].id, weekday: day, from: "00:00", to: "23:59" });
      else if (/\bno\b/.test(folded) && day !== null && sections[0]) rules.push({ ...empty, kind: "not-on", sectionId: sections[0].id, weekday: day });
    }
    return { rules };
  },
};
