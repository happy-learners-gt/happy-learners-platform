import type { AtomicMark, Rubric } from "@happy-learners/contracts";
import { markValue } from "./grading";

/**
 * Group sets (lote 3a). Formation is pure: the API passes the learners it already chose
 * (the active roster, or only the students present in one class). The same seed, learners
 * and rules always build the same groups. A constraint that cannot be met is reported;
 * the best split is still returned.
 */

export type FormationLearner = {
  id: string;
  score?: number | null;
  attribute?: string | null;
  /** false drops the learner. The API filters attendance and usually omits this flag. */
  present?: boolean;
};

export type GroupRules = {
  by: "size" | "count";
  size?: number;
  count?: number;
  how: "random" | "balanced" | "mixed";
  minimum?: number;
  maximum?: number;
  together?: [string, string][];
  apart?: [string, string][];
  prefix?: string;
  seed: string;
  scores?: Record<string, number>;
  attributes?: Record<string, string>;
};

export type UnmetConstraint = {
  kind: "together" | "apart" | "minimum" | "maximum";
  learners: string[];
  message: string;
};

export type FormedGroups = {
  groups: { name: string; learnerIds: string[] }[];
  unmet: UnmetConstraint[];
};

type InputError = { error: string };
type Unit = { ids: string[]; score: number | null; attribute: string };

const record = (value: unknown): Record<string, unknown> | null =>
  value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
const tenth = (value: number) => Math.round((value + Number.EPSILON) * 10) / 10;
const clamp = (value: number, minimum: number, maximum: number) => Math.min(maximum, Math.max(minimum, value));

function hashSeed(seed: string) {
  let hash = 2166136261;
  for (let index = 0; index < seed.length; index++) {
    hash ^= seed.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

/** mulberry32. Formation never calls Math.random, so a seed repeats exactly. */
function mulberry32(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6D2B79F5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffle<T>(items: T[], random: () => number) {
  const copy = [...items];
  for (let index = copy.length - 1; index > 0; index--) {
    const swap = Math.floor(random() * (index + 1));
    [copy[index], copy[swap]] = [copy[swap], copy[index]];
  }
  return copy;
}

function pairs(value: unknown, purpose: string): [string, string][] | InputError {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > 100) return { error: `Revisa las parejas que ${purpose}: envía una lista breve.` };
  const out: [string, string][] = [];
  for (const pair of value) {
    if (!Array.isArray(pair) || pair.length !== 2 || pair.some(id => typeof id !== "string" || !id.trim() || id.length > 80) || pair[0] === pair[1]) {
      return { error: `Revisa las parejas que ${purpose}: cada una son dos estudiantes distintos.` };
    }
    out.push([pair[0].trim(), pair[1].trim()]);
  }
  return out;
}

function optionalMap(value: unknown, numeric: boolean, label: string): { values: Record<string, string | number> } | InputError | undefined {
  if (value === undefined) return undefined;
  const body = record(value);
  if (!body) return { error: `Revisa ${label}: envía un objeto.` };
  const entries = Object.entries(body);
  if (entries.length > 200) return { error: `Revisa ${label}: son demasiados.` };
  const values: Record<string, string | number> = {};
  for (const [key, item] of entries) {
    if (!key.trim() || key.length > 80) return { error: `Revisa ${label}: hay un estudiante que no reconozco.` };
    if (numeric) {
      if (typeof item !== "number" || !Number.isFinite(item)) return { error: `Revisa ${label}: cada valor es un número.` };
      values[key] = item;
    } else {
      if (typeof item !== "string" || !item.trim() || item.length > 80) return { error: `Revisa ${label}: cada valor es un texto breve.` };
      values[key] = item.trim();
    }
  }
  return { values };
}

/** Validate the rules stored with a group set. Messages speak to the teacher in informal tú. */
export function groupRulesInput(input: unknown): GroupRules | InputError {
  const value = record(input);
  if (!value) return { error: "Indica las reglas del conjunto." };
  if (value.by !== "size" && value.by !== "count") return { error: "Elige si formas por tamaño o por cantidad de grupos." };
  if (value.how !== "random" && value.how !== "balanced" && value.how !== "mixed") return { error: "Elige cómo repartes: al azar, equilibrado o mixto." };
  if (typeof value.seed !== "string" || !value.seed.trim() || value.seed.trim().length > 80) return { error: "Indica la semilla con la que se forma el conjunto." };
  const rules: GroupRules = { by: value.by, how: value.how, seed: value.seed.trim() };
  if (value.by === "size") {
    if (typeof value.size !== "number" || !Number.isInteger(value.size) || value.size < 2 || value.size > 30) return { error: "Indica el tamaño de cada grupo, un entero entre 2 y 30." };
    rules.size = value.size;
  } else {
    if (typeof value.count !== "number" || !Number.isInteger(value.count) || value.count < 1 || value.count > 30) return { error: "Indica cuántos grupos quieres, un entero entre 1 y 30." };
    rules.count = value.count;
  }
  const bound = (item: unknown, label: string) => {
    if (item === undefined) return undefined;
    if (typeof item !== "number" || !Number.isInteger(item) || item < 1 || item > 100) return { error: `${label} es un entero entre 1 y 100.` };
    return item;
  };
  const minimum = bound(value.minimum, "El mínimo de un grupo");
  const maximum = bound(value.maximum, "El máximo de un grupo");
  if (minimum && typeof minimum === "object") return minimum;
  if (maximum && typeof maximum === "object") return maximum;
  if (typeof minimum === "number" && typeof maximum === "number" && minimum > maximum) return { error: "El mínimo no puede ser mayor que el máximo." };
  if (typeof minimum === "number") rules.minimum = minimum;
  if (typeof maximum === "number") rules.maximum = maximum;
  const together = pairs(value.together, "deben ir juntas");
  if ("error" in together) return together;
  const apart = pairs(value.apart, "deben ir separadas");
  if ("error" in apart) return apart;
  if (together.length) rules.together = together;
  if (apart.length) rules.apart = apart;
  if (value.prefix !== undefined) {
    if (typeof value.prefix !== "string" || !value.prefix.trim() || value.prefix.trim().length > 40) return { error: "El prefijo del nombre cabe en 40 caracteres." };
    rules.prefix = value.prefix.trim();
  }
  const scores = optionalMap(value.scores, true, "los puntajes previos");
  if (scores && "error" in scores) return scores;
  const attributes = optionalMap(value.attributes, false, "los atributos");
  if (attributes && "error" in attributes) return attributes;
  if (scores) rules.scores = scores.values as Record<string, number>;
  if (attributes) rules.attributes = attributes.values as Record<string, string>;
  return rules;
}

function capacities(count: number, rules: GroupRules) {
  if (!count) return [];
  if (rules.by === "count") {
    const groups = Math.min(rules.count!, count);
    const base = Math.floor(count / groups);
    const extra = count % groups;
    return Array.from({ length: groups }, (_, index) => base + (index < extra ? 1 : 0));
  }
  const size = rules.size!;
  if (count <= size) return [count];
  const groups = Math.floor(count / size);
  const extra = count % size;
  return Array.from({ length: groups }, (_, index) => size + (index < extra ? 1 : 0));
}

function mean(values: number[]) {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

/** Build groups. Learners with present: false are left out; everyone else is placed. */
export function formGroups(learners: FormationLearner[], rules: GroupRules, seed: string): FormedGroups {
  const unmet: UnmetConstraint[] = [];
  const pool = learners.filter(learner => learner.present !== false);
  const known = new Set(pool.map(learner => learner.id));
  const scoreOf = new Map(pool.map(learner => [learner.id, learner.score ?? rules.scores?.[learner.id] ?? null]));
  const attributeOf = new Map(pool.map(learner => [learner.id, learner.attribute ?? rules.attributes?.[learner.id] ?? learner.id]));
  const parent = new Map<string, string>();
  const clusterSize = new Map<string, number>();
  const find = (id: string): string => {
    let root = parent.get(id) ?? id;
    if (!parent.has(id)) { parent.set(id, id); clusterSize.set(id, 1); root = id; }
    while (parent.get(root) !== root) root = parent.get(root)!;
    parent.set(id, root);
    return root;
  };
  const membersOf = (id: string) => pool.map(learner => learner.id).filter(member => find(member) === find(id));
  for (const pair of rules.together ?? []) {
    const present = pair.filter(id => known.has(id));
    if (present.length < 2) {
      unmet.push({ kind: "together", learners: pair, message: "No pude mantener junta una pareja que no está completa en la lista." });
      continue;
    }
    const [left, right] = present;
    const leftRoot = find(left), rightRoot = find(right);
    if (leftRoot === rightRoot) continue;
    const next = clusterSize.get(leftRoot)! + clusterSize.get(rightRoot)!;
    if (rules.maximum !== undefined && next > rules.maximum) {
      unmet.push({ kind: "together", learners: pair, message: "No pude mantener junta una pareja sin pasar el máximo del grupo." });
      continue;
    }
    parent.set(rightRoot, leftRoot);
    clusterSize.set(leftRoot, next);
  }
  const seen = new Set<string>();
  const units: Unit[] = [];
  for (const learner of pool) {
    const root = find(learner.id);
    if (seen.has(root)) continue;
    seen.add(root);
    const ids = membersOf(learner.id);
    const scores = ids.map(id => scoreOf.get(id)).filter((score): score is number => typeof score === "number");
    const attributes = ids.map(id => attributeOf.get(id) || id);
    const frequent = [...attributes].sort((a, b) => attributes.filter(item => item === b).length - attributes.filter(item => item === a).length || a.localeCompare(b))[0];
    units.push({ ids, score: scores.length ? mean(scores) : null, attribute: frequent });
  }
  const room = capacities(pool.length, rules);
  const buckets = room.map(() => [] as string[]);
  const random = mulberry32(hashSeed(seed));
  const ordered = rules.how === "random"
    ? shuffle(units, random)
    : rules.how === "balanced"
      ? [...units].sort((a, b) => (b.score ?? Number.NEGATIVE_INFINITY) - (a.score ?? Number.NEGATIVE_INFINITY) || a.ids[0].localeCompare(b.ids[0]))
      : [...units].sort((a, b) => {
          const sizeA = units.filter(unit => unit.attribute === a.attribute).length;
          const sizeB = units.filter(unit => unit.attribute === b.attribute).length;
          return sizeB - sizeA || a.attribute.localeCompare(b.attribute) || a.ids[0].localeCompare(b.ids[0]);
        });
  const place = (unit: Unit, preferred?: number) => {
    const fits = (index: number) => room[index] - buckets[index].length >= unit.ids.length;
    let target = preferred !== undefined && fits(preferred) ? preferred : buckets.findIndex((_, index) => fits(index));
    if (rules.how === "random" && preferred === undefined) target = buckets.findIndex((_, index) => fits(index));
    if (target < 0) {
      target = room.reduce((best, _, index) => (room[index] - buckets[index].length > room[best] - buckets[best].length ? index : best), 0);
      unmet.push({ kind: "maximum", learners: unit.ids, message: "No cupo un bloque sin pasar el tamaño previsto de un grupo." });
    }
    buckets[target].push(...unit.ids);
    return target;
  };
  if (rules.how === "balanced") {
    let index = 0, direction = 1;
    for (const unit of ordered) {
      const used = place(unit, room[index] - buckets[index].length >= unit.ids.length ? index : undefined);
      let next = used + direction;
      if (next >= buckets.length || next < 0) { direction *= -1; next = used + direction; }
      index = Math.min(buckets.length - 1, Math.max(0, next));
    }
  } else if (rules.how === "mixed") {
    let start = 0;
    for (const unit of ordered) {
      let preferred = -1;
      for (let attempt = 0; attempt < buckets.length; attempt++) {
        const index = (start + attempt) % buckets.length;
        const occupied = buckets[index].some(id => attributeOf.get(id) === unit.attribute);
        if (!occupied && room[index] - buckets[index].length >= unit.ids.length) { preferred = index; break; }
      }
      const used = place(unit, preferred >= 0 ? preferred : undefined);
      start = (used + 1) % Math.max(buckets.length, 1);
    }
  } else {
    for (const unit of ordered) place(unit);
  }
  const indexOf = new Map<string, number>();
  buckets.forEach((ids, index) => ids.forEach(id => indexOf.set(id, index)));
  const apartSet = new Set((rules.apart ?? []).map(pair => [...pair].sort().join("\0")));
  const conflicts = (id: string, group: number, ignore: string) => buckets[group].some(other => other !== id && other !== ignore && apartSet.has([id, other].sort().join("\0")));
  for (const pair of rules.apart ?? []) {
    const [left, right] = pair;
    if (!known.has(left) || !known.has(right)) {
      unmet.push({ kind: "apart", learners: pair, message: "No pude separar una pareja que no está completa en la lista." });
      continue;
    }
    if (find(left) === find(right)) {
      unmet.push({ kind: "apart", learners: pair, message: "No pude separar a dos estudiantes que también deben ir juntos." });
      continue;
    }
    if (indexOf.get(left) !== indexOf.get(right)) continue;
    const origin = indexOf.get(left)!;
    let moved = false;
    for (let group = 0; group < buckets.length && !moved; group++) {
      if (group === origin) continue;
      for (const other of [...buckets[group]]) {
        if (membersOf(other).length > 1 || membersOf(right).length > 1) continue;
        if (conflicts(right, group, other) || conflicts(other, origin, right)) continue;
        buckets[origin] = buckets[origin].filter(id => id !== right);
        buckets[group] = buckets[group].filter(id => id !== other);
        buckets[origin].push(other);
        buckets[group].push(right);
        indexOf.set(right, group);
        indexOf.set(other, origin);
        moved = true;
        break;
      }
    }
    if (!moved) unmet.push({ kind: "apart", learners: pair, message: "No pude separar a esta pareja sin romper el tamaño de los grupos." });
  }
  const prefix = rules.prefix || "Grupo";
  const groups = buckets.filter(ids => ids.length).map((ids, index) => ({ name: `${prefix} ${index + 1}`, learnerIds: ids }));
  groups.forEach(group => {
    if (rules.minimum !== undefined && group.learnerIds.length < rules.minimum) {
      unmet.push({ kind: "minimum", learners: group.learnerIds, message: `«${group.name}» quedó con ${group.learnerIds.length} y el mínimo es ${rules.minimum}.` });
    }
    if (rules.maximum !== undefined && group.learnerIds.length > rules.maximum) {
      unmet.push({ kind: "maximum", learners: group.learnerIds, message: `«${group.name}» quedó con ${group.learnerIds.length} y el máximo es ${rules.maximum}.` });
    }
  });
  return { groups, unmet };
}

export type GroupAdjustment = { learnerId: string; kind: "factor" | "override" | "peer"; value: number };
export type PeerRating = { raterId: string; rateeId: string; score: number };
export type IndividualAssignment = {
  learnerId: string;
  mark: AtomicMark | null;
  source: "group" | "individual" | "exempt" | "none";
  factor?: number;
};

function peerFactors(learnerIds: string[], ratings: PeerRating[], minimum: number, maximum: number) {
  const received = new Map(learnerIds.map(id => [id, [] as number[]]));
  for (const rating of ratings) {
    if (!received.has(rating.rateeId) || !received.has(rating.raterId) || rating.raterId === rating.rateeId) continue;
    if (typeof rating.score !== "number" || rating.score < 0 || rating.score > 5) continue;
    received.get(rating.rateeId)!.push(rating.score);
  }
  const means = learnerIds.map(id => { const scores = received.get(id)!; return scores.length ? mean(scores) : null; });
  const known = means.filter((value): value is number => value !== null);
  const average = known.length ? mean(known) : null;
  return new Map(learnerIds.map((id, index) => {
    const value = means[index];
    if (value === null || !average) return [id, 1];
    return [id, clamp(value / average, minimum, maximum)];
  }));
}

/**
 * Copy a group mark onto each member. An explicit factor (0 to 2) wins over coevaluation.
 * WebPA is the mean received divided by the group's mean, clamped to the activity bounds
 * (0.5 and 1.5 unless the activity says otherwise). A student outside every group gets
 * nothing (never a zero). An exemption and a hand-written mark are left untouched.
 */
export function groupToIndividual(input: {
  points: number;
  grading: "points" | "rubric" | "pass-fail" | "level" | "panel";
  rubric?: Rubric;
  peerMin?: number;
  peerMax?: number;
  groups: { id: string; learnerIds: string[] }[];
  marks: { workGroupId: string; mark: AtomicMark }[];
  adjustments: GroupAdjustment[];
  peerRatings: PeerRating[];
  exemptLearnerIds?: string[];
  manualLearnerIds?: string[];
  roster?: string[];
}): IndividualAssignment[] {
  const peerMin = input.peerMin ?? 0.5;
  const peerMax = input.peerMax ?? 1.5;
  const exempt = new Set(input.exemptLearnerIds ?? []);
  const manual = new Set(input.manualLearnerIds ?? []);
  const markOf = new Map(input.marks.map(item => [item.workGroupId, item.mark]));
  const adjustmentOf = new Map(input.adjustments.map(item => [item.learnerId, item]));
  const membership = new Map<string, string>();
  for (const group of input.groups) for (const learnerId of group.learnerIds) if (!membership.has(learnerId)) membership.set(learnerId, group.id);
  const factors = new Map<string, Map<string, number>>();
  for (const group of input.groups) factors.set(group.id, peerFactors(group.learnerIds, input.peerRatings, peerMin, peerMax));
  const ids = input.roster?.length ? input.roster : [...new Set([...membership.keys(), ...exempt, ...manual])];
  return ids.map(learnerId => {
    if (exempt.has(learnerId)) return { learnerId, mark: { kind: "exempt" as const }, source: "exempt" as const };
    if (manual.has(learnerId)) return { learnerId, mark: null, source: "individual" as const };
    const groupId = membership.get(learnerId);
    if (!groupId) return { learnerId, mark: null, source: "none" as const };
    const groupMark = markOf.get(groupId);
    if (!groupMark || groupMark.kind === "exempt") return { learnerId, mark: null, source: "none" as const };
    const adjustment = adjustmentOf.get(learnerId);
    if (adjustment?.kind === "override") {
      return { learnerId, mark: { kind: "points", value: tenth(clamp(adjustment.value, 0, input.points)) }, source: "group" };
    }
    const peer = factors.get(groupId)?.get(learnerId) ?? 1;
    const ratings = input.peerRatings.some(rating => rating.rateeId === learnerId || rating.raterId === learnerId);
    let factor = 1;
    if (adjustment?.kind === "factor") factor = clamp(adjustment.value, 0, 2);
    else if (adjustment?.kind === "peer") factor = ratings ? peer : clamp(adjustment.value, peerMin, peerMax);
    else if (ratings) factor = peer;
    const base = markValue({ id: "group", periodId: "period", categoryId: "general", title: "Grupo", points: input.points, grading: input.grading, ...(input.rubric ? { rubric: input.rubric } : {}) }, groupMark);
    const applied = adjustment?.kind === "factor" || adjustment?.kind === "peer" || ratings;
    const mark = factor === 1 || base === null ? groupMark : { kind: "points" as const, value: tenth(clamp(base * factor, 0, input.points)) };
    return { learnerId, mark, source: "group", ...(applied ? { factor } : {}) };
  });
}
