import type { GradeAverage, GradeScale, LetterThresholds } from "@happy-learners/contracts";

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
