export const timezones = ["America/Guatemala", "America/Mexico_City", "America/Bogota"] as const;
export { courseAccess, seesSection, teachesSection, maxSectionEducators } from "./access";
export { moduleNavigation } from "./navigation";
export type { ModuleLesson } from "./navigation";
export { isCalendarDay, weekdays, scheduleInput, scheduleDates, scheduleSummary, lessonsInOrder, periodWeek, classSequence, maxScheduleDays, maxScheduledClasses } from "./schedule";
export type { SectionSchedule } from "./schedule";
export { acceptsAttendance, classActions, classPlanInput, classStatusLabels, maxClassLessons, groupCodePattern, localDay, newGroupCode, nextClassStatus, normalizeGroupCode, upcomingClasses } from "./classes";
export type { ClassAction, ClassPlan } from "./classes";
export { materialInput, record, cleanText, validTermIds, completeOrder } from "./courses";
export { educationTypes, educationLevels, knowledgeAreas, areaLabel, courseFormats, modalities, pacings, moduleLabels, moduleNoun, settingDefinitions, derivedSettings, sourceLabel, effectiveProfile, resolveSettings, settingsInput, profileInput, courseInput, programInput, coursePresets, labelOf } from "./academic";
export type { ModuleNoun, SettingKey, SettingSource } from "./academic";
export { sequenceTemplates, sequenceOf, purposes, groupings, blockKinds, blocksOf, phaseOf, studentActivities, resourceIdsOf, richTextFieldsOf, hasText } from "./sequences";
export type { Phase } from "./sequences";
export { cognitiveLevels, competencyInput, outcomeInput, validOutcomeIds, outcomeCodes, activityOutcomes, assesses, lessonOutcomes, coverage, suggestedResources, publishChecklist, outcomeLimit, competencyLimit } from "./outcomes";
export type { Gap, OutcomeCoverage, UnitCoverage, CheckItem } from "./outcomes";
import { validOutcomeIds } from "./outcomes";
export function organizationInput(value: unknown): { name: string; timezone: string } | null {
  if (!value || typeof value !== "object") return null;
  const { name, timezone } = value as Record<string, unknown>;
  if (typeof name !== "string" || typeof timezone !== "string") return null;
  const clean = name.trim().normalize("NFC");
  if (clean.length < 3 || clean.length > 80 || /[<>\x00-\x1f]/.test(clean)) return null;
  if (!timezones.some(item => item === timezone)) return null;
  return { name: clean, timezone };
}
const purposeValues = new Set(["explain", "explore", "practice", "assess", "reflect"]);
const groupingValues = new Set(["individual", "pairs", "teams", "whole-class"]);
const blockKindValues = new Set(["text", "resource", "question", "teacher-note"]);
const idPattern = /^[a-zA-Z0-9-]{1,80}$/;
function validQuestion(options: unknown, answer: unknown) {
  return Array.isArray(options) && options.length >= 2 && options.length <= 6 && options.every(o => typeof o === "string" && o.trim() && o.length <= 200) && new Set(options).size === options.length && Number.isInteger(answer) && (answer as number) >= 0 && (answer as number) < options.length;
}
function hasBody(item: Record<string, unknown>) {
  const instructions = item.instructions === undefined ? "" : item.instructions;
  if (typeof instructions !== "string" || instructions.length > 4000) return false;
  if (item.richContent !== undefined && !validRichText(item.richContent)) return false;
  return !!instructions.trim() || validRichText(item.richContent);
}
/**
 * Lesson activities. An activity has a title, minutes, an optional moment, purpose and grouping, and either
 * ordered blocks (text, resource, question, teacher note) or the older single typed body.
 */
export function validActivities(input: unknown): boolean {
  if (!Array.isArray(input) || input.length > 30) return false;
  // Activity IDs are unique among activities and block IDs among blocks (they name collaborative fields);
  // the first block of an older activity keeps the activity's ID so its live text is not lost.
  const unique = (seen: Set<string>) => (id: unknown) => typeof id === "string" && idPattern.test(id) && !seen.has(id) && !!seen.add(id);
  const uniqueId = unique(new Set()), uniqueBlockId = unique(new Set());
  return input.every((item, position) => {
    if (!item || typeof item !== "object" || !uniqueId(item.id) || item.position !== position) return false;
    if (typeof item.title !== "string" || !item.title.trim() || item.title.length > 160 || !Number.isInteger(item.minutes) || item.minutes < 1 || item.minutes > 120) return false;
    if (item.phase !== undefined && (typeof item.phase !== "string" || !/^[a-z-]{1,40}$/.test(item.phase))) return false;
    if (item.purpose !== undefined && !purposeValues.has(item.purpose)) return false;
    if (item.grouping !== undefined && !groupingValues.has(item.grouping)) return false;
    if (item.outcomeIds !== undefined && !validOutcomeIds(item.outcomeIds)) return false;
    if (item.blocks !== undefined) {
      if (!Array.isArray(item.blocks) || !item.blocks.length || item.blocks.length > 12) return false;
      const blocks = item.blocks as Record<string, unknown>[];
      if (!blocks.some(block => block?.kind !== "teacher-note")) return false;
      return blocks.every(block => {
        if (!block || typeof block !== "object" || !uniqueBlockId(block.id) || !blockKindValues.has(String(block.kind))) return false;
        if (block.kind === "resource") return typeof block.resourceId === "string" && !!block.resourceId && (block.instructions === undefined || (typeof block.instructions === "string" && block.instructions.length <= 4000)) && (block.richContent === undefined || validRichText(block.richContent));
        if (block.kind === "question") return hasBody(block) && validQuestion(block.options, block.answer);
        return hasBody(block);
      });
    }
    if (!["text", "resource", "question"].includes(item.type) || typeof item.instructions !== "string" || item.instructions.length > 4000 || (!item.instructions.trim() && !validRichText(item.richContent)) || (item.richContent !== undefined && !validRichText(item.richContent))) return false;
    if (item.type === "resource" && (typeof item.resourceId !== "string" || !item.resourceId)) return false;
    if (item.type === "question" && !validQuestion(item.options, item.answer)) return false;
    return true;
  });
}
// Tables (ST-069): a table holds rows; a row holds header or data cells; a cell holds paragraphs or lists.
const tableParents: Record<string, string[]> = { tableRow: ["table"], tableHeader: ["tableRow"], tableCell: ["tableRow"] };
const richNodes = new Set(["doc", "paragraph", "heading", "text", "hardBreak", "bulletList", "orderedList", "listItem", "blockquote", "table", "tableRow", "tableHeader", "tableCell"]);
const richMarks = new Set(["bold", "italic", "underline", "strike", "code", "link"]);
export function validRichText(value: unknown): boolean {
  if (!value || typeof value !== "object") return false;
  let textLength = 0, count = 0;
  function visit(item: unknown, depth: number, parent = "doc"): boolean {
    if (!item || typeof item !== "object" || depth > 10 || ++count > 1200) return false;
    const n = item as Record<string, unknown>;
    if (typeof n.type !== "string" || !richNodes.has(n.type)) return false;
    if (tableParents[n.type] && !tableParents[n.type].includes(parent)) return false;
    if (n.type === "table" && parent !== "doc") return false;
    if (["table", "tableRow"].includes(n.type) && (!Array.isArray(n.content) || !n.content.length || n.content.length > 30)) return false;
    if (n.type === "text") { if (typeof n.text !== "string" || n.content !== undefined) return false; textLength += n.text.length; if (textLength > 12000) return false; }
    if (n.type === "heading" && (!n.attrs || ![2, 3].includes(Number((n.attrs as Record<string, unknown>).level)))) return false;
    if (n.marks !== undefined && (!Array.isArray(n.marks) || n.marks.length > 6 || !n.marks.every(mark => {
      if (!mark || typeof mark !== "object" || !richMarks.has(String((mark as Record<string, unknown>).type))) return false;
      const m = mark as Record<string, unknown>;
      if (m.type !== "link") return true;
      const href = String((m.attrs as Record<string, unknown> | undefined)?.href || "");
      return /^https?:\/\/[^\s/?#@]+(?::\d+)?(?:[/?#]|$)/i.test(href);
    }))) return false;
    if (n.type === "table" && !(n.content as Record<string, unknown>[]).every(row => row?.type === "tableRow")) return false;
    if (n.type === "tableRow" && !(n.content as Record<string, unknown>[]).every(cell => ["tableHeader", "tableCell"].includes(String(cell?.type)))) return false;
    return n.content === undefined || (Array.isArray(n.content) && n.content.every(child => visit(child, depth + 1, n.type as string)));
  }
  const root = value as Record<string, unknown>;
  return root.type === "doc" && Array.isArray(root.content) && root.content.every(child => visit(child, 1)) && textLength > 0;
}
