import { csvCell } from "./hours";
import type { AssessmentKind, GradeAverage, GradeScale, LetterThresholds } from "@happy-learners/contracts";

/**
 * The minimal gradebook (libreta). Each student of a section has at most one score per period of the school year,
 * always stored as a number from 0 to 100 with one decimal; a course that reads in letters shows the letter that
 * score reaches. The course (or its program) decides the scale, the passing score, the letter thresholds and
 * whether periods average simply or by their weight.
 *
 * A missing score is never a zero: the average counts only the periods that have a score, and a weighted average
 * divides by the weights of those periods alone. The result says whether every period already has a score.
 * Out of scope: make-up exams, extra points and absences that lower a score.
 */
export const gradeScales: { value: GradeScale; label: string }[] = [
  { value: "numeric_100", label: "Numérica de 0 a 100" },
  { value: "letters_af", label: "Letras de A a F" },
];
export const gradeAverages: { value: GradeAverage; label: string }[] = [
  { value: "simple", label: "Promedio simple" },
  { value: "weighted", label: "Ponderado por el peso de cada periodo" },
];
export const defaultThresholds: LetterThresholds = [90, 80, 70, 60];
export const thresholdPresets: LetterThresholds[] = [[90, 80, 70, 60], [93, 85, 77, 70], [85, 75, 65, 60], [80, 70, 60, 50]];
export const passingChoices = [50, 55, 60, 65, 70, 75, 80];
export const thresholdsText = (value: LetterThresholds) => `A ${value[0]} · B ${value[1]} · C ${value[2]} · D ${value[3]}`;
export const letters = ["A", "B", "C", "D", "F"] as const;

export const isGradeScale = (value: unknown): value is GradeScale => gradeScales.some(item => item.value === value);
export const isGradeAverage = (value: unknown): value is GradeAverage => gradeAverages.some(item => item.value === value);
export const isPassingGrade = (value: unknown): value is number => typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= 100;
/** Four whole minimums for A, B, C and D, each lower than the one before, between 1 and 100. */
export function isLetterThresholds(value: unknown): value is LetterThresholds {
  return Array.isArray(value) && value.length === 4 && value.every(item => Number.isInteger(item) && item >= 1 && item <= 100) && value.every((item, index) => index === 0 || item < value[index - 1]);
}

/**
 * A score as it arrives: a number from 0 to 100 with at most one decimal (a comma is accepted as the decimal
 * mark), or null when the cell is cleared. Undefined when it is not a valid score.
 */
export function scoreInput(value: unknown): number | null | undefined {
  if (value === null || value === "") return null;
  const number = typeof value === "number" ? value : typeof value === "string" && /^\s*\d{1,3}([.,]\d)?\s*$/.test(value) ? Number(value.trim().replace(",", ".")) : NaN;
  if (!Number.isFinite(number) || number < 0 || number > 100 || Math.round(number * 10) !== number * 10) return undefined;
  return number;
}

/** The letter a score reaches: A from its threshold up, then B, C, D, and F below D. */
export function letterOf(score: number, thresholds: LetterThresholds) {
  const index = thresholds.findIndex(minimum => score >= minimum);
  return letters[index === -1 ? 4 : index];
}

const oneDecimal = (value: number) => Math.round((value + Number.EPSILON) * 10) / 10;
/**
 * The average of the periods that have a score, rounded to one decimal. Simple: their mean. Weighted: each score by
 * its period's weight, over the sum of the weights of the periods that have a score. Null when no period has one.
 */
export function averageOf(scores: { score: number | null; weight: number }[], mode: GradeAverage): number | null {
  const graded = scores.filter((item): item is { score: number; weight: number } => item.score !== null);
  if (!graded.length) return null;
  if (mode === "simple") return oneDecimal(graded.reduce((sum, item) => sum + item.score, 0) / graded.length);
  const weights = graded.reduce((sum, item) => sum + item.weight, 0);
  return weights > 0 ? oneDecimal(graded.reduce((sum, item) => sum + item.score * item.weight, 0) / weights) : null;
}

export type GradingPolicy = { scale: GradeScale; passingGrade: number; letterThresholds: LetterThresholds; average: GradeAverage };
/** A student's result: the average, its letter when the course reads in letters, whether it passes and whether every period has a score. */
export function gradeResult(scores: { score: number | null; weight: number }[], policy: GradingPolicy) {
  const average = averageOf(scores, policy.average);
  return {
    average,
    letter: average === null || policy.scale !== "letters_af" ? null : letterOf(average, policy.letterThresholds),
    passed: average === null ? null : average >= policy.passingGrade,
    complete: scores.length > 0 && scores.every(item => item.score !== null),
  };
}
export const maxGradeChanges = 500;

/**
 * The assessment plan (plan de evaluación) of a course and period: activities whose points add up to 100, such as the
 * zona (tasks, project, participation) and the exam. A student's period score is the sum of the points earned in the
 * activities graded so far, as a Guatemalan school accumulates its zona; a period whose plan is complete and graded
 * gives the final score. A missing activity score is not a zero: the period says how many points were graded.
 */
export const assessmentKinds: { value: AssessmentKind; label: string }[] = [
  { value: "task", label: "Tarea" }, { value: "project", label: "Proyecto" }, { value: "quiz", label: "Prueba corta" },
  { value: "exam", label: "Examen" }, { value: "participation", label: "Participación" }, { value: "other", label: "Otra" },
];
export const isAssessmentKind = (value: unknown): value is AssessmentKind => assessmentKinds.some(item => item.value === value);
export const assessmentKindLabel = (kind: AssessmentKind) => assessmentKinds.find(item => item.value === kind)?.label || "Otra";
export const maxAssessmentActivities = 20;
export type PlannedActivity = { title: string; kind: AssessmentKind; points: number };
/** Starting plans: the zona and the exam in the usual proportions. */
export const assessmentTemplates: { id: string; label: string; activities: PlannedActivity[] }[] = [
  { id: "zona-60", label: "Zona 60 y examen 40", activities: [
    { title: "Tareas", kind: "task", points: 20 }, { title: "Proyecto", kind: "project", points: 20 }, { title: "Pruebas cortas", kind: "quiz", points: 10 },
    { title: "Participación", kind: "participation", points: 10 }, { title: "Examen del periodo", kind: "exam", points: 40 }] },
  { id: "zona-70", label: "Zona 70 y examen 30", activities: [
    { title: "Tareas", kind: "task", points: 25 }, { title: "Proyecto", kind: "project", points: 25 }, { title: "Pruebas cortas", kind: "quiz", points: 10 },
    { title: "Participación", kind: "participation", points: 10 }, { title: "Examen del periodo", kind: "exam", points: 30 }] },
  { id: "proyectos", label: "Por proyectos (sin examen)", activities: [
    { title: "Proyecto 1", kind: "project", points: 35 }, { title: "Proyecto 2", kind: "project", points: 35 }, { title: "Tareas", kind: "task", points: 20 },
    { title: "Participación", kind: "participation", points: 10 }] },
];
/** Points as they arrive: a number with at most one decimal (comma accepted), from 0 up to the maximum. */
export function pointsInput(value: unknown, maximum: number): number | null | undefined {
  if (value === null || value === "") return null;
  const number = typeof value === "number" ? value : typeof value === "string" && /^\s*\d{1,3}([.,]\d)?\s*$/.test(value) ? Number(value.trim().replace(",", ".")) : NaN;
  if (!Number.isFinite(number) || number < 0 || number > maximum || Math.round(number * 10) !== number * 10) return undefined;
  return number;
}
/** The plan's total points, to one decimal. */
export const planTotal = (activities: { points: number }[]) => oneDecimal(activities.reduce((sum, item) => sum + item.points, 0));
/**
 * A student's period from the plan: the points earned, the points graded so far and whether every activity has a
 * score. The score is null while no activity has one.
 */
export function periodFromPlan(activities: { id: string; points: number }[], earned: Map<string, number>) {
  const graded = activities.filter(activity => earned.has(activity.id));
  return {
    score: graded.length ? Math.min(100, oneDecimal(graded.reduce((sum, activity) => sum + earned.get(activity.id)!, 0))) : null,
    graded: planTotal(graded), complete: activities.length > 0 && graded.length === activities.length,
  };
}

/** Statistics of a set of scores (period or average): who passes, the bands of ten points and who is at risk. */
export function gradeStatistics(entries: { learnerId: string; score: number | null }[], passingGrade: number) {
  const scored = entries.filter((item): item is { learnerId: string; score: number } => item.score !== null);
  const values = scored.map(item => item.score).sort((a, b) => a - b);
  const middle = Math.floor(values.length / 2);
  const bands = [[90, 100], [80, 89.9], [70, 79.9], [60, 69.9], [0, 59.9]].map(([from, until]) => ({ from, until, count: values.filter(value => value >= from && value <= until).length }));
  return {
    count: values.length, missing: entries.length - values.length,
    average: values.length ? oneDecimal(values.reduce((sum, value) => sum + value, 0) / values.length) : null,
    median: values.length ? (values.length % 2 ? values[middle] : oneDecimal((values[middle - 1] + values[middle]) / 2)) : null,
    highest: values.length ? values[values.length - 1] : null, lowest: values.length ? values[0] : null,
    passed: values.filter(value => value >= passingGrade).length, failed: values.filter(value => value < passingGrade).length,
    bands,
    /** Below the passing score, or within five points of it. */
    atRisk: scored.filter(item => item.score < passingGrade + 5).sort((a, b) => a.score - b.score).map(item => ({ ...item, failing: item.score < passingGrade })),
  };
}

/** A CSV file as the hours export writes it: BOM, commas and CRLF lines. */
export const csvFile = (rows: (string | number | null)[][]) => `\uFEFF${rows.map(row => row.map(csvCell).join(",")).join("\r\n")}\r\n`;

/** Pasted cells from a spreadsheet: rows by line, cells by tab (or semicolon when there is no tab). */
export function pastedCells(text: string): string[][] {
  const lines = text.replace(/\r\n?/g, "\n").replace(/\n$/, "").split("\n");
  return lines.map(line => line.split(line.includes("\t") ? "\t" : ";").map(cell => cell.trim()));
}
export const maxCommentLength = 600;
