import type {
  AtomicMark,
  CourseSettings,
  GradingActivity,
  GradingPeriod,
  GradingScheme,
  LearnerResult,
  Mark,
  Rubric,
} from "@happy-learners/contracts";

export type { AtomicMark, GradingPeriod, GradingScheme, LearnerResult, Mark, Rubric };
/** The domain name is unambiguous; the contracts package uses GradingActivity to avoid a lesson type collision. */
export type Activity = GradingActivity;

type InputError = { error: string };
type Marks = Map<string, Mark> | Record<string, Mark | undefined>;

const methods = new Set(["points", "weighted-categories", "pass-fail", "levels"]);
const periodMethods = new Set(["simple", "weighted", "cumulative", "last", "none"]);
const retakeMethods = new Set(["replace", "highest", "average"]);
const displayKinds = new Set(["numeric", "letters", "gpa", "levels", "pass-fail"]);
const panelMethods = new Set(["average", "median", "majority", "chair"]);
const idPattern = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,79}$/;

const record = (value: unknown): Record<string, unknown> | null =>
  value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
const finite = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);
const cleanText = (value: unknown, maximum = 120) =>
  typeof value === "string" && value.trim().length > 0 && value.trim().length <= maximum ? value.trim().normalize("NFC") : null;
const round = (value: number, decimals = 2) => {
  const factor = 10 ** decimals;
  return Math.round((value + Number.EPSILON) * factor) / factor;
};
const average = (values: number[]) => values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
const median = (values: number[]) => {
  if (!values.length) return null;
  const ordered = [...values].sort((a, b) => a - b);
  const middle = Math.floor(ordered.length / 2);
  return ordered.length % 2 ? ordered[middle] : (ordered[middle - 1] + ordered[middle]) / 2;
};
const markAt = (marks: Marks, id: string) => marks instanceof Map ? marks.get(id) : marks[id];

function error(message: string): InputError {
  return { error: message };
}

/** Validate and normalize a rubric. Criterion weights are percentages and must add up to 100. */
export function rubricInput(input: unknown): Rubric | InputError {
  const value = record(input);
  if (!value) return error("Escribe una rúbrica válida.");
  if (!Array.isArray(value.criteria) || !value.criteria.length) return error("Agrega al menos un criterio a la rúbrica.");
  if (value.criteria.length > 30) return error("La rúbrica puede tener hasta 30 criterios.");
  const ids = new Set<string>();
  const criteria: Rubric["criteria"] = [];
  for (const raw of value.criteria) {
    const criterion = record(raw);
    if (!criterion || !cleanText(criterion.id, 80) || !idPattern.test(String(criterion.id))) return error("Cada criterio necesita un identificador válido.");
    if (ids.has(String(criterion.id))) return error("Los criterios de la rúbrica no pueden repetirse.");
    ids.add(String(criterion.id));
    const label = cleanText(criterion.label);
    if (!label) return error("Cada criterio necesita un nombre.");
    if (!finite(criterion.weight) || criterion.weight <= 0 || criterion.weight > 100) return error("El peso de cada criterio debe estar entre 0 y 100.");
    if (!Array.isArray(criterion.levels) || criterion.levels.length < 2) return error(`Agrega al menos dos niveles a «${label}».`);
    const levelIds = new Set<string>();
    const levels: Rubric["criteria"][number]["levels"] = [];
    let previousPoints = Number.POSITIVE_INFINITY;
    for (const rawLevel of criterion.levels) {
      const level = record(rawLevel);
      const levelId = level && cleanText(level.id, 80);
      const levelLabel = level && cleanText(level.label);
      if (!levelId || !idPattern.test(levelId) || !levelLabel) return error(`Cada nivel de «${label}» necesita identificador y nombre.`);
      if (levelIds.has(levelId)) return error(`Los niveles de «${label}» no pueden repetirse.`);
      if (!finite(level!.points) || level!.points < 0 || level!.points > 100) return error(`Los puntos de los niveles de «${label}» deben estar entre 0 y 100.`);
      if (level!.points >= previousPoints) return error(`Ordena los niveles de «${label}» de mayor a menor puntaje.`);
      levelIds.add(levelId);
      previousPoints = level!.points;
      levels.push({ id: levelId, label: levelLabel, points: level!.points as number });
    }
    if (!levels.some(level => level.points > 0)) return error(`«${label}» necesita un nivel con más de cero puntos.`);
    criteria.push({ id: String(criterion.id), label, weight: criterion.weight as number, levels });
  }
  if (round(criteria.reduce((sum, criterion) => sum + criterion.weight, 0), 6) !== 100) return error("Los pesos de la rúbrica deben sumar 100.");
  return { criteria };
}

/**
 * Validate and normalize a grading scheme. The first matching threshold wins, so thresholds must be ordered from
 * highest to lowest. Levels follow the same convention: the first one is the highest.
 */
export function schemeInput(input: unknown): GradingScheme | InputError {
  const value = record(input);
  if (!value) return error("Escribe un esquema de evaluación válido.");
  const id = cleanText(value.id, 80), name = cleanText(value.name);
  if (!id || !idPattern.test(id)) return error("El esquema necesita un identificador válido.");
  if (!name) return error("El esquema necesita un nombre.");
  if (typeof value.method !== "string" || !methods.has(value.method)) return error("Elige cómo se calcula la evaluación.");
  if (!Array.isArray(value.categories) || !value.categories.length) return error("Agrega al menos una categoría.");
  if (value.categories.length > 30) return error("El esquema puede tener hasta 30 categorías.");
  const categoryIds = new Set<string>();
  const categories: GradingScheme["categories"] = [];
  for (const raw of value.categories) {
    const category = record(raw);
    const categoryId = category && cleanText(category.id, 80);
    const label = category && cleanText(category.label);
    if (!categoryId || !idPattern.test(categoryId) || !label) return error("Cada categoría necesita identificador y nombre.");
    if (categoryIds.has(categoryId)) return error("Las categorías no pueden repetirse.");
    if (category!.weight !== undefined && (!finite(category!.weight) || category!.weight < 0 || category!.weight > 100)) return error(`El peso de «${label}» debe estar entre 0 y 100.`);
    if (category!.dropLowest !== undefined && (!Number.isInteger(category!.dropLowest) || Number(category!.dropLowest) < 0)) return error(`La cantidad que se descarta en «${label}» debe ser un entero positivo.`);
    if (category!.minimum !== undefined && (!finite(category!.minimum) || category!.minimum < 0 || category!.minimum > 100)) return error(`El mínimo de «${label}» debe estar entre 0 y 100.`);
    categoryIds.add(categoryId);
    categories.push({
      id: categoryId,
      label,
      ...(category!.weight !== undefined ? { weight: category!.weight as number } : {}),
      ...(category!.dropLowest !== undefined ? { dropLowest: category!.dropLowest as number } : {}),
      ...(category!.minimum !== undefined ? { minimum: category!.minimum as number } : {}),
    });
  }
  if (value.method === "weighted-categories") {
    if (categories.some(category => category.weight === undefined)) return error("Cada categoría ponderada necesita un peso.");
    if (categories.some(category => category.weight! <= 0)) return error("El peso de cada categoría ponderada debe ser mayor que cero.");
    if (round(categories.reduce((sum, category) => sum + category.weight!, 0), 6) !== 100) return error("Los pesos de las categorías deben sumar 100.");
  }

  let levels: GradingScheme["levels"];
  if (value.levels !== undefined) {
    if (!Array.isArray(value.levels) || value.levels.length < 2) return error("Agrega al menos dos niveles, del más alto al más bajo.");
    const levelIds = new Set<string>();
    levels = [];
    let previous = Number.POSITIVE_INFINITY;
    let values = 0;
    const levelValues = new Set<number>();
    for (const raw of value.levels) {
      const level = record(raw);
      const levelId = level && cleanText(level.id, 80);
      const label = level && cleanText(level.label);
      if (!levelId || !idPattern.test(levelId) || !label) return error("Cada nivel necesita identificador y nombre.");
      if (levelIds.has(levelId)) return error("Los niveles no pueden repetirse.");
      if (level!.value !== undefined) {
        if (!finite(level!.value) || level!.value < 0 || level!.value > 100) return error("El valor de cada nivel debe estar entre 0 y 100.");
        if (levelValues.has(level!.value)) return error("Los valores de los niveles no pueden repetirse.");
        if (level!.value >= previous) return error("Ordena los niveles de mayor a menor valor.");
        previous = level!.value;
        levelValues.add(level!.value);
        values++;
      }
      levelIds.add(levelId);
      levels.push({ id: levelId, label, ...(level!.value !== undefined ? { value: level!.value as number } : {}) });
    }
    if (values > 0 && values !== levels.length) return error("Asigna un valor a todos los niveles o a ninguno.");
  }
  if ((value.method === "levels" || record(value.display)?.kind === "levels") && !levels) return error("Este esquema necesita niveles.");

  const display = record(value.display);
  if (!display || typeof display.kind !== "string" || !displayKinds.has(display.kind)) return error("Elige cómo se muestra el resultado.");
  let normalizedDisplay: GradingScheme["display"];
  if (display.kind === "numeric") {
    if (!finite(display.max) || display.max <= 0) return error("La escala numérica necesita un máximo mayor que cero.");
    if (![0, 1, 2].includes(Number(display.decimals))) return error("Elige cero, uno o dos decimales.");
    normalizedDisplay = { kind: "numeric", max: display.max, decimals: display.decimals as 0 | 1 | 2 };
  } else if (display.kind === "letters" || display.kind === "gpa") {
    if (!Array.isArray(display.thresholds) || !display.thresholds.length) return error("Agrega al menos un umbral.");
    const letters = new Set<string>();
    let previous = Number.POSITIVE_INFINITY;
    let previousPoints = Number.POSITIVE_INFINITY;
    const thresholds: { letter: string; min: number; points?: number }[] = [];
    for (const raw of display.thresholds) {
      const threshold = record(raw);
      const letter = threshold && cleanText(threshold.letter, 20);
      if (!letter || !finite(threshold!.min) || threshold!.min < 0 || threshold!.min > 100) return error("Cada umbral necesita una etiqueta y un mínimo entre 0 y 100.");
      if (letters.has(letter)) return error("Las etiquetas de los umbrales no pueden repetirse.");
      if (threshold!.min >= previous) return error("Ordena los umbrales de mayor a menor.");
      if (display.kind === "gpa" && (!finite(threshold!.points) || threshold!.points < 0)) return error("Cada umbral de GPA necesita puntos válidos.");
      if (display.kind === "gpa" && (threshold!.points as number) >= previousPoints) return error("Ordena los puntos de GPA de mayor a menor.");
      letters.add(letter);
      previous = threshold!.min;
      if (display.kind === "gpa") previousPoints = threshold!.points as number;
      thresholds.push({ letter, min: threshold!.min as number, ...(display.kind === "gpa" ? { points: threshold!.points as number } : {}) });
    }
    normalizedDisplay = display.kind === "letters"
      ? { kind: "letters", thresholds: thresholds.map(({ letter, min }) => ({ letter, min })) }
      : { kind: "gpa", thresholds: thresholds.map(({ letter, min, points }) => ({ letter, min, points: points! })) };
  } else {
    normalizedDisplay = { kind: display.kind } as GradingScheme["display"];
  }

  const passing = record(value.passing);
  if (!passing) return error("Define cuándo se aprueba.");
  if (passing.min !== undefined && (!finite(passing.min) || passing.min < 0 || passing.min > 100)) return error("La nota mínima debe estar entre 0 y 100.");
  if (passing.level !== undefined && (typeof passing.level !== "string" || !levels?.some(level => level.id === passing.level))) return error("El nivel mínimo debe existir en el esquema.");
  if (passing.min === undefined && passing.level === undefined) return error("Define una nota o un nivel mínimo para aprobar.");
  if (passing.min !== undefined && passing.level !== undefined) return error("Define una nota o un nivel mínimo, no ambos.");
  if (typeof value.periods !== "string" || !periodMethods.has(value.periods)) return error("Elige cómo se combinan los periodos.");
  if (typeof value.retakes !== "string" || !retakeMethods.has(value.retakes)) return error("Elige cómo cuentan las reposiciones.");
  if (value.extraCreditCap !== undefined && (!finite(value.extraCreditCap) || value.extraCreditCap < 0 || value.extraCreditCap > 100)) return error("El tope de puntos extra debe estar entre 0 y 100.");

  return {
    id,
    name,
    method: value.method as GradingScheme["method"],
    categories,
    ...(levels ? { levels } : {}),
    display: normalizedDisplay,
    passing: {
      ...(passing.min !== undefined ? { min: passing.min as number } : {}),
      ...(passing.level !== undefined ? { level: passing.level as string } : {}),
    },
    periods: value.periods as GradingScheme["periods"],
    ...(value.extraCreditCap !== undefined ? { extraCreditCap: value.extraCreditCap as number } : {}),
    retakes: value.retakes as GradingScheme["retakes"],
  };
}

function rubricValue(activity: GradingActivity, choices: Record<string, string>) {
  if (!activity.rubric || activity.points < 0) return null;
  const checked = rubricInput(activity.rubric);
  if ("error" in checked) return null;
  if (Object.keys(choices).some(id => !checked.criteria.some(criterion => criterion.id === id))) return null;
  let result = 0;
  for (const criterion of checked.criteria) {
    const selected = criterion.levels.find(level => level.id === choices[criterion.id]);
    if (!selected) return null;
    const maximum = Math.max(...criterion.levels.map(level => level.points));
    if (maximum <= 0) return null;
    result += (selected.points / maximum) * (criterion.weight / 100) * activity.points;
  }
  return round(result);
}

function atomicValue(activity: GradingActivity, mark: AtomicMark): number | null {
  if (mark.kind === "exempt") return null;
  if (mark.kind === "points") return finite(mark.value) && mark.value >= 0 && mark.value <= activity.points ? mark.value : null;
  if (mark.kind === "pass") return mark.value ? activity.points : 0;
  if (mark.kind === "rubric") return rubricValue(activity, mark.choices);
  // A level needs the scheme's ordered levels; learnerResult resolves it with that context.
  return null;
}

function panelValue(activity: GradingActivity, mark: Extract<Mark, { kind: "panel" }>) {
  if (!activity.panel || !panelMethods.has(activity.panel.combine) || !mark.marks.length) return null;
  if (new Set(mark.marks.map(entry => entry.evaluator)).size !== mark.marks.length) return null;
  const entries = mark.marks
    .map(entry => ({ evaluator: entry.evaluator, value: atomicValue({ ...activity, grading: entry.mark.kind === "rubric" ? "rubric" : entry.mark.kind === "pass" ? "pass-fail" : "points" }, entry.mark) }))
    .filter((entry): entry is { evaluator: string; value: number } => entry.value !== null);
  if (!entries.length) return null;
  const chair = activity.panel.chair ? entries.find(entry => entry.evaluator === activity.panel!.chair) : undefined;
  if (activity.panel.combine === "chair") return chair?.value ?? null;
  if (activity.panel.combine === "average") return round(average(entries.map(entry => entry.value))!);
  if (activity.panel.combine === "median") return round(median(entries.map(entry => entry.value))!);
  const counts = new Map<number, number>();
  for (const entry of entries) counts.set(entry.value, (counts.get(entry.value) || 0) + 1);
  const highest = Math.max(...counts.values());
  const modes = [...counts].filter(([, count]) => count === highest).map(([value]) => value);
  if (modes.length === 1 && highest > entries.length / 2) return modes[0];
  return chair?.value ?? round(average(entries.map(entry => entry.value))!);
}

/** Turn one recorded mark into earned points. Invalid or exempt marks have no numeric value. */
export function markValue(activity: GradingActivity, mark: Mark): number | null {
  if (!finite(activity.points) || activity.points < 0) return null;
  if (activity.grading === "panel") return mark.kind === "panel" ? panelValue(activity, mark) : null;
  if (mark.kind === "panel") return null;
  // A points mark is already the earned number. Group adjustments are stored that way on any activity.
  if (mark.kind === "points") return atomicValue(activity, mark);
  if (activity.grading === "points" || (activity.grading === "pass-fail" && mark.kind !== "pass") || (activity.grading === "rubric" && mark.kind !== "rubric") || (activity.grading === "level" && mark.kind !== "level")) return null;
  return atomicValue(activity, mark);
}

function numericLevelValue(scheme: GradingScheme, levelId: string) {
  const levels = scheme.levels || [];
  const index = levels.findIndex(level => level.id === levelId);
  if (index < 0) return null;
  if (levels[index].value !== undefined) return levels[index].value!;
  return levels.length === 1 ? 100 : ((levels.length - index - 1) / (levels.length - 1)) * 100;
}

function valueWithScheme(scheme: GradingScheme, activity: GradingActivity, mark: Mark) {
  if (mark.kind === "level") {
    const percentage = numericLevelValue(scheme, mark.value);
    return percentage === null ? null : round((percentage / 100) * activity.points);
  }
  if (mark.kind === "panel" && activity.panel) {
    const entries = mark.marks.map(entry => {
      if (entry.mark.kind !== "level") return entry;
      const percentage = numericLevelValue(scheme, entry.mark.value);
      return percentage === null ? { ...entry, mark: { kind: "exempt" } as AtomicMark } : { ...entry, mark: { kind: "points", value: round((percentage / 100) * activity.points) } as AtomicMark };
    });
    return panelValue(activity, { kind: "panel", marks: entries });
  }
  return markValue(activity, mark);
}

function levelFromScore(scheme: GradingScheme, score: number | null) {
  if (score === null || !scheme.levels?.length) return null;
  const valued = scheme.levels.every(level => level.value !== undefined);
  if (!valued) return null;
  return scheme.levels.find(level => score >= level.value!)?.id || scheme.levels[scheme.levels.length - 1].id;
}

function levelPassed(scheme: GradingScheme, level: string | null) {
  if (!scheme.passing.level || !level || !scheme.levels) return null;
  const actual = scheme.levels.findIndex(item => item.id === level);
  const minimum = scheme.levels.findIndex(item => item.id === scheme.passing.level);
  return actual >= 0 && minimum >= 0 ? actual <= minimum : null;
}

function passedOf(scheme: GradingScheme, score: number | null, level: string | null) {
  if (scheme.passing.level) return levelPassed(scheme, level);
  return score === null || scheme.passing.min === undefined ? null : score >= scheme.passing.min;
}

function formatNumber(value: number, decimals: number) {
  return value.toFixed(decimals).replace(".", ",");
}

/** Format a percentage score or a level ID according to the scheme's display. */
export function displayOf(scheme: GradingScheme, scoreOrLevel: number | string | null): string | null {
  if (scoreOrLevel === null) return null;
  if (scheme.display.kind === "levels") {
    if (typeof scoreOrLevel === "string") return scheme.levels?.find(level => level.id === scoreOrLevel)?.label || null;
    const level = levelFromScore(scheme, scoreOrLevel);
    return level ? scheme.levels?.find(item => item.id === level)?.label || null : null;
  }
  if (typeof scoreOrLevel !== "number" || !Number.isFinite(scoreOrLevel)) return null;
  if (scheme.display.kind === "numeric") return formatNumber((scoreOrLevel / 100) * scheme.display.max, scheme.display.decimals);
  if (scheme.display.kind === "letters") return scheme.display.thresholds.find(threshold => scoreOrLevel >= threshold.min)?.letter || null;
  if (scheme.display.kind === "gpa") {
    const threshold = scheme.display.thresholds.find(item => scoreOrLevel >= item.min);
    return threshold ? formatNumber(threshold.points, 2) : null;
  }
  return passedOf(scheme, scoreOrLevel, levelFromScore(scheme, scoreOrLevel)) ? "Aprobado" : "No aprobado";
}

type EffectiveActivity = {
  activity: GradingActivity;
  value: number | null;
  percentage: number | null;
  exempt: boolean;
  marked: boolean;
  level: string | null;
};

function retakeGroups(scheme: GradingScheme, activities: GradingActivity[], marks: Marks): EffectiveActivity[] {
  const byId = new Map(activities.map(activity => [activity.id, activity]));
  const rootOf = (activity: GradingActivity) => {
    let current = activity;
    const seen = new Set<string>();
    while (current.retakeOf && byId.has(current.retakeOf) && !seen.has(current.id)) {
      seen.add(current.id);
      current = byId.get(current.retakeOf)!;
    }
    return current.id;
  };
  const groups = new Map<string, GradingActivity[]>();
  for (const activity of activities) {
    const root = rootOf(activity);
    groups.set(root, [...(groups.get(root) || []), activity]);
  }
  return [...groups.values()].map(group => {
    const base = byId.get(rootOf(group[0])) || group[0];
    const attempts = group.map(activity => {
      const mark = markAt(marks, activity.id);
      const exempt = mark?.kind === "exempt";
      const value = mark ? valueWithScheme(scheme, activity, mark) : null;
      const level = mark?.kind === "level" && scheme.levels?.some(item => item.id === mark.value) ? mark.value : null;
      return { activity, mark, exempt, value, level };
    });
    const numeric = attempts.filter((attempt): attempt is typeof attempt & { value: number } => attempt.value !== null);
    const marked = attempts.some(attempt => attempt.mark !== undefined && !attempt.exempt);
    const exempt = attempts.some(attempt => attempt.exempt) && !marked;
    if (!numeric.length) return { activity: base, value: null, percentage: null, exempt, marked, level: null };
    let selected: typeof numeric;
    if (scheme.retakes === "replace") selected = [numeric[numeric.length - 1]];
    else if (scheme.retakes === "highest") selected = [numeric.reduce((best, item) => item.value / item.activity.points > best.value / best.activity.points ? item : best)];
    else selected = numeric;
    const percentage = average(selected.map(item => item.activity.points ? (item.value / item.activity.points) * 100 : 0))!;
    const value = round((percentage / 100) * base.points);
    const levels = selected.map(item => item.level).filter((item): item is string => item !== null);
    const level = levels.length ? modalLevel(scheme, levels) : null;
    return { activity: base, value, percentage: round(percentage), exempt, marked, level };
  });
}

function modalLevel(scheme: GradingScheme, levels: string[]) {
  if (!levels.length || !scheme.levels) return null;
  if (scheme.levels.every(level => level.value !== undefined)) {
    const mean = average(levels.map(level => scheme.levels!.find(item => item.id === level)!.value!))!;
    return [...scheme.levels].sort((a, b) => Math.abs(a.value! - mean) - Math.abs(b.value! - mean))[0].id;
  }
  const counts = new Map<string, number>();
  for (const level of levels) counts.set(level, (counts.get(level) || 0) + 1);
  const maximum = Math.max(...counts.values());
  // A tie chooses the highest level because levels are ordered from highest to lowest.
  return scheme.levels.find(level => counts.get(level.id) === maximum)?.id || null;
}

function calculatePeriod(scheme: GradingScheme, activities: GradingActivity[], marks: Marks, periodId: string) {
  const effective = retakeGroups(scheme, activities, marks);
  const required = effective.filter(item => !item.activity.extra);
  const included = required.filter(item => item.value !== null);
  const graded = round(included.reduce((sum, item) => sum + item.activity.points, 0));
  const complete = required.length > 0 && required.every(item => item.marked || item.exempt);
  const reasons: string[] = [];
  let score: number | null = null;
  let level: string | null = null;
  const categoryEntries = (category: GradingScheme["categories"][number]) => {
    const entries = [...included.filter(item => item.activity.categoryId === category.id)]
      .sort((a, b) => a.percentage! - b.percentage! || a.activity.id.localeCompare(b.activity.id));
    const dropped = category.dropLowest || 0;
    return entries.length > dropped ? entries.slice(dropped) : entries;
  };

  if (scheme.method === "points") {
    score = included.length ? included.reduce((sum, item) => sum + item.value!, 0) : null;
  } else if (scheme.method === "weighted-categories") {
    let weighted = 0, weights = 0;
    for (const category of scheme.categories) {
      const entries = categoryEntries(category);
      if (!entries.length) continue;
      const maximum = entries.reduce((sum, item) => sum + item.activity.points, 0);
      const categoryScore = maximum ? entries.reduce((sum, item) => sum + item.value!, 0) / maximum * 100 : 0;
      weighted += categoryScore * category.weight!;
      weights += category.weight!;
    }
    score = weights ? weighted / weights : null;
  } else if (scheme.method === "pass-fail") {
    score = included.length ? average(included.map(item => item.percentage!)) : null;
  } else {
    const recordedLevels = included.map(item => item.level || levelFromScore(scheme, item.percentage)).filter((item): item is string => item !== null);
    level = modalLevel(scheme, recordedLevels);
    score = included.length ? average(included.map(item => item.percentage!)) : null;
  }
  for (const category of scheme.categories.filter(item => item.minimum !== undefined)) {
    const entries = categoryEntries(category);
    if (!entries.length) continue;
    const maximum = entries.reduce((sum, item) => sum + item.activity.points, 0);
    const categoryScore = maximum ? entries.reduce((sum, item) => sum + item.value!, 0) / maximum * 100 : 0;
    if (categoryScore < category.minimum!) reasons.push(`No alcanzó el mínimo de ${category.minimum} en «${category.label}».`);
  }

  if (score !== null) {
    const extra = effective.filter(item => item.activity.extra && item.value !== null).reduce((sum, item) => sum + item.value!, 0);
    score = round(Math.min(100 + (scheme.extraCreditCap || 0), score + Math.min(extra, scheme.extraCreditCap || 0)));
  }
  if (!level) level = levelFromScore(scheme, score);
  let passed = passedOf(scheme, score, level);
  if (reasons.length && passed !== null) passed = false;
  const display = displayOf(scheme, scheme.display.kind === "levels" ? level : score);
  return { periodId, score, display, level, graded, complete, passed, reasons };
}

/**
 * Calculate one learner's results. Missing marks are excluded, not converted to zero. For levels, valued levels are
 * averaged and mapped to the nearest level; unvalued levels use the most frequent one, with ties going to the highest.
 */
export function learnerResult(
  scheme: GradingScheme,
  activities: GradingActivity[],
  marks: Marks,
  periods: GradingPeriod[],
): LearnerResult {
  const orderedPeriods = periods
    .map((period, index) => ({ period, index }))
    .sort((a, b) => (a.period.position ?? a.index) - (b.period.position ?? b.index))
    .map(item => item.period);
  const periodResults = orderedPeriods.map(period => calculatePeriod(scheme, activities.filter(activity => activity.periodId === period.id), marks, period.id));
  let score: number | null = null;
  let level: string | null = null;
  let reasons: string[] = [];
  let complete = periods.length > 0 && periodResults.every(period => period.complete);

  if (scheme.periods === "cumulative") {
    const combined = calculatePeriod(scheme, activities, marks, "final");
    score = combined.score;
    level = combined.level;
    reasons = combined.reasons;
    complete = combined.complete;
  } else if (scheme.periods === "last") {
    const last = [...periodResults].reverse().find(period => period.score !== null || period.level !== null);
    if (last) {
      score = last.score;
      level = last.level;
      reasons = [...last.reasons];
    }
    complete = periodResults.length > 0 && periodResults[periodResults.length - 1].complete;
  } else if (scheme.periods !== "none") {
    const scored = periodResults.map((result, index) => ({ result, weight: orderedPeriods[index].weight ?? 1 })).filter(item => item.result.score !== null);
    if (scored.length) {
      if (scheme.periods === "weighted") {
        const weight = scored.reduce((sum, item) => sum + item.weight, 0);
        score = weight > 0 ? scored.reduce((sum, item) => sum + item.result.score! * item.weight, 0) / weight : null;
      } else score = average(scored.map(item => item.result.score!));
      if (score !== null) {
        score = round(score);
        level = levelFromScore(scheme, score);
      }
    }
    reasons = [...new Set(periodResults.flatMap(period => period.reasons))];
  }

  let passed = scheme.periods === "none" ? null : passedOf(scheme, score, level);
  if (reasons.length && passed !== null) passed = false;
  return {
    periods: periodResults,
    final: {
      score,
      display: scheme.periods === "none" ? null : displayOf(scheme, scheme.display.kind === "levels" ? level : score),
      passed,
      complete,
      reasons,
    },
  };
}

export const pointsScheme: GradingScheme = {
  id: "points",
  name: "Puntos acumulados",
  method: "points",
  categories: [{ id: "general", label: "Actividades" }],
  display: { kind: "numeric", max: 100, decimals: 1 },
  passing: { min: 60 },
  periods: "simple",
  extraCreditCap: 0,
  retakes: "replace",
};

/** Translate the legacy gradebook settings into the compatible data-driven points scheme. */
export function schemeFromSettings(settings: Pick<Required<CourseSettings>, "gradeScale" | "passingGrade" | "letterThresholds" | "gradeAverage">): GradingScheme {
  const [a, b, c, d] = settings.letterThresholds;
  return {
    ...pointsScheme,
    display: settings.gradeScale === "letters_af"
      ? { kind: "letters", thresholds: [{ letter: "A", min: a }, { letter: "B", min: b }, { letter: "C", min: c }, { letter: "D", min: d }, { letter: "F", min: 0 }] }
      : { kind: "numeric", max: 100, decimals: 1 },
    passing: { min: settings.passingGrade },
    periods: settings.gradeAverage,
  };
}

/** Starting examples only; every calculation still goes through the same data-driven engine. */
export const schemeTemplates: GradingScheme[] = [
  {
    id: "colegio", name: "Colegio: zona y examen", method: "points",
    categories: [{ id: "zona", label: "Zona" }, { id: "examen", label: "Examen" }],
    display: { kind: "numeric", max: 100, decimals: 1 }, passing: { min: 60 }, periods: "simple", extraCreditCap: 0, retakes: "replace",
  },
  {
    id: "universidad", name: "Universidad: categorías y GPA", method: "weighted-categories",
    categories: [{ id: "tareas", label: "Tareas", weight: 30, dropLowest: 1 }, { id: "proyectos", label: "Proyectos", weight: 30 }, { id: "final", label: "Examen final", weight: 40, minimum: 60 }],
    display: { kind: "gpa", thresholds: [{ letter: "A", min: 90, points: 4 }, { letter: "B", min: 80, points: 3 }, { letter: "C", min: 70, points: 2 }, { letter: "D", min: 60, points: 1 }, { letter: "F", min: 0, points: 0 }] },
    passing: { min: 60 }, periods: "weighted", extraCreditCap: 5, retakes: "highest",
  },
  {
    id: "idiomas", name: "Academia de idiomas: MCER", method: "levels",
    categories: [{ id: "comprension", label: "Comprensión" }, { id: "expresion", label: "Expresión" }],
    levels: [{ id: "c1", label: "C1", value: 100 }, { id: "b2", label: "B2", value: 80 }, { id: "b1", label: "B1", value: 60 }, { id: "a2", label: "A2", value: 40 }],
    display: { kind: "levels" }, passing: { level: "b1" }, periods: "last", retakes: "highest",
  },
  {
    id: "tecnica", name: "Formación técnica: competencias", method: "pass-fail",
    categories: [{ id: "competencias", label: "Competencias" }],
    display: { kind: "pass-fail" }, passing: { min: 100 }, periods: "cumulative", retakes: "replace",
  },
  {
    id: "artes", name: "Artes: interpretación y recital", method: "weighted-categories",
    categories: [{ id: "interpretacion", label: "Interpretación", weight: 60 }, { id: "recital", label: "Panel de recital", weight: 40, minimum: 60 }],
    display: { kind: "numeric", max: 100, decimals: 1 }, passing: { min: 70 }, periods: "simple", retakes: "average",
  },
  {
    id: "seminario", name: "Seminario o taller", method: "pass-fail",
    categories: [{ id: "asistencia", label: "Asistencia" }, { id: "entrega", label: "Entrega" }],
    display: { kind: "pass-fail" }, passing: { min: 100 }, periods: "none", retakes: "replace",
  },
  {
    id: "doctorado", name: "Doctorado: examen privado", method: "pass-fail",
    categories: [{ id: "tribunal", label: "Dictamen del tribunal" }],
    display: { kind: "pass-fail" }, passing: { min: 50 }, periods: "last", retakes: "replace",
  },
];
