/** A course requires other courses of its program (DEC-029). Requirements never form a cycle. */
export type Requirement = { courseId: string; requiredId: string };
export const maxPrerequisites = 10;

/** Whether `courseId` requiring `requiredIds` would close a cycle with the other requirements. */
export function createsCycle(requirements: Requirement[], courseId: string, requiredIds: string[]) {
  const edges = new Map<string, string[]>();
  for (const item of requirements.filter(item => item.courseId !== courseId)) edges.set(item.courseId, [...edges.get(item.courseId) || [], item.requiredId]);
  edges.set(courseId, requiredIds);
  // A cycle exists when, following what a required course needs, we come back to the course.
  const seen = new Set<string>(), stack = [...requiredIds];
  while (stack.length) {
    const next = stack.pop()!;
    if (next === courseId) return true;
    if (seen.has(next)) continue;
    seen.add(next);
    stack.push(...edges.get(next) || []);
  }
  return false;
}

/** Courses that cannot be required by `courseId` because they already depend on it (or are it). */
export function dependents(requirements: Requirement[], courseId: string) {
  const out = new Set<string>([courseId]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const item of requirements) if (out.has(item.requiredId) && !out.has(item.courseId)) { out.add(item.courseId); grew = true; }
  }
  return out;
}

/** The program's courses in stages: a course comes one stage after the latest course it requires. */
export function prerequisiteStages(courseIds: string[], requirements: Requirement[]) {
  const stage = new Map<string, number>();
  const known = new Set(courseIds);
  const needs = (id: string) => requirements.filter(item => item.courseId === id && known.has(item.requiredId)).map(item => item.requiredId);
  const visit = (id: string, path: Set<string>): number => {
    if (stage.has(id)) return stage.get(id)!;
    if (path.has(id)) return 0;
    path.add(id);
    const value = needs(id).reduce((max, required) => Math.max(max, visit(required, path) + 1), 0);
    path.delete(id);
    stage.set(id, value);
    return value;
  };
  for (const id of courseIds) visit(id, new Set());
  const stages: string[][] = [];
  for (const id of courseIds) (stages[stage.get(id)!] ||= []).push(id);
  return stages.filter(Boolean);
}

export function prerequisiteInput(value: unknown): { courseId: string; requiredIds: string[] } | null {
  const v = value && typeof value === "object" ? value as Record<string, unknown> : null;
  if (typeof v?.courseId !== "string" || !Array.isArray(v.requiredIds) || v.requiredIds.length > maxPrerequisites || v.requiredIds.some(id => typeof id !== "string" || id === v.courseId) || new Set(v.requiredIds).size !== v.requiredIds.length) return null;
  return { courseId: v.courseId, requiredIds: v.requiredIds as string[] };
}
