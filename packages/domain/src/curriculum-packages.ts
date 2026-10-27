import type { CognitiveLevel, CurriculumPackageSummary } from "@happy-learners/contracts";
import { cognitiveLevels, competencyLimit, outcomeLimit } from "./outcomes";
import { matematicasPrimaria6 } from "./cnb/matematicas-primaria-6";

/**
 * Curriculum packages: official curricular references kept in the repository as versioned, structured data. An
 * organization's administration activates a package; a course's lead then picks some of its indicators, which become
 * the course's own competencies and learning outcomes in its curriculum plan. Each picked item is linked to the
 * package by its code, so picking it again never duplicates it.
 */
export interface PackageIndicator { code: string; statement: string; level: CognitiveLevel; contents: string[] }
export interface PackageCompetency { code: string; statement: string; indicators: PackageIndicator[] }
export interface CurriculumPackage {
  id: string; version: string; title: string; area: string; grade: string; level: string;
  source: { name: string; url: string; retrievedOn: string };
  competencies: PackageCompetency[];
}

export const curriculumPackages: CurriculumPackage[] = [matematicasPrimaria6];
export const packageOf = (id: string) => curriculumPackages.find(item => item.id === id) || null;
export const maxPickedIndicators = 40;

export function packageSummary(item: CurriculumPackage): Omit<CurriculumPackageSummary, "active" | "activatedAt" | "activatedVersion"> {
  return { id: item.id, version: item.version, title: item.title, area: item.area, grade: item.grade, level: item.level, source: item.source,
    competencies: item.competencies.length, indicators: item.competencies.reduce((sum, competency) => sum + competency.indicators.length, 0) };
}

/**
 * What is wrong with a package, if anything: ids and codes, numbering (an indicator belongs to its competency and a
 * content to its indicator), lengths that fit the curriculum plan, cognitive levels and the source.
 */
export function packageProblems(item: CurriculumPackage): string[] {
  const problems: string[] = [];
  if (!/^[a-z0-9-]{3,80}$/.test(item.id)) problems.push("id");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(item.version)) problems.push("version");
  if (!/^https:\/\//.test(item.source.url) || !/^\d{4}-\d{2}-\d{2}$/.test(item.source.retrievedOn)) problems.push("source");
  if (!item.competencies.length) problems.push("competencies");
  const codes = new Set<string>();
  for (const competency of item.competencies) {
    if (!/^\d+$/.test(competency.code) || codes.has(competency.code)) problems.push(`competency ${competency.code}: code`);
    codes.add(competency.code);
    if (!competency.statement || competency.statement.length > 560) problems.push(`competency ${competency.code}: statement`);
    if (!competency.indicators.length) problems.push(`competency ${competency.code}: indicators`);
    for (const indicator of competency.indicators) {
      if (!indicator.code.startsWith(`${competency.code}.`) || !/^\d+\.\d+$/.test(indicator.code) || codes.has(indicator.code)) problems.push(`indicator ${indicator.code}: code`);
      codes.add(indicator.code);
      if (!indicator.statement || indicator.statement.length > 400) problems.push(`indicator ${indicator.code}: statement`);
      if (!cognitiveLevels.some(level => level.value === indicator.level)) problems.push(`indicator ${indicator.code}: level`);
      if (!indicator.contents.length || indicator.contents.some(content => !content.startsWith(`${indicator.code}.`) || content.length > 400)) problems.push(`indicator ${indicator.code}: contents`);
    }
  }
  return problems;
}

/** The competency's name in a course plan (up to 120 characters): its code and the start of its statement. */
export function competencyName(item: CurriculumPackage, competency: PackageCompetency) {
  const full = `${competency.code}. ${competency.statement}`;
  if (full.length <= 120) return full;
  const cut = full.slice(0, 117);
  return `${cut.slice(0, cut.lastIndexOf(" ") > 60 ? cut.lastIndexOf(" ") : 117).replace(/[,;:]$/, "")}…`;
}
/** The competency's description: its full statement and where it comes from. */
export const competencyDescription = (item: CurriculumPackage, competency: PackageCompetency) =>
  `${competency.statement}\n\nFuente: ${item.source.name}, ${item.title}, competencia ${competency.code}.`;
/** Where an outcome comes from, as its evidence line in the plan. */
export const indicatorEvidence = (item: CurriculumPackage, indicator: PackageIndicator) => `${item.source.name}, ${item.title}, indicador de logro ${indicator.code}.`;

/**
 * What linking some indicators adds to a course: the competencies and indicators not linked yet, in the package's
 * order. Codes that do not exist come back as unknown; codes already linked as skipped.
 */
export function linkPlan(item: CurriculumPackage, codes: string[], linked: { kind: "competency" | "indicator"; code: string }[]) {
  const wanted = new Set(codes), done = new Set(linked.map(entry => `${entry.kind}:${entry.code}`));
  const all = item.competencies.flatMap(competency => competency.indicators.map(indicator => ({ competency, indicator })));
  const unknown = codes.filter(code => !all.some(entry => entry.indicator.code === code));
  const picked = all.filter(entry => wanted.has(entry.indicator.code));
  const indicators = picked.filter(entry => !done.has(`indicator:${entry.indicator.code}`));
  const competencies = [...new Map(indicators.filter(entry => !done.has(`competency:${entry.competency.code}`)).map(entry => [entry.competency.code, entry.competency])).values()];
  return { unknown, skipped: picked.length - indicators.length, competencies, indicators };
}
