/**
 * R1 (docs/security/auditoria-2026-11.md; decided by the product owner on 02-nov-2026): what a section code shows of
 * each student. Whoever has the code sees, to pick themselves, the first word of each name and the initial of the next
 * («Ana López García» → «Ana L.»), never the full name. Two names that would read the same take more initials, and if
 * they still match, a number, so each student can still find themselves.
 */
export function shortLearnerNames<T extends { id: string; name: string }>(learners: readonly T[]): Map<string, string> {
  // Only words with a letter count: «·» or «-» between names would make an empty initial.
  const words = new Map(learners.map(item => [item.id, item.name.trim().split(/\s+/).filter(word => /\p{L}/u.test(word))]));
  const short = (parts: string[], initials: number) => [parts[0] || "Estudiante", ...parts.slice(1, 1 + initials).map(word => `${[...word].find(letter => /\p{L}/u.test(letter))!.toLocaleUpperCase("es")}.`)].join(" ");
  const result = new Map<string, string>();
  const groups = new Map<string, string[]>();
  for (const item of learners) {
    const parts = words.get(item.id)!;
    let initials = 1, label = short(parts, initials);
    // More initials while another name reads the same and this one still has words to show.
    while (initials < parts.length - 1 && learners.some(other => other.id !== item.id && short(words.get(other.id)!, initials) === label)) label = short(parts, ++initials);
    result.set(item.id, label);
    groups.set(label, [...groups.get(label) || [], item.id]);
  }
  for (const [label, ids] of groups) if (ids.length > 1) ids.forEach((id, index) => result.set(id, `${label} (${index + 1})`));
  return result;
}
