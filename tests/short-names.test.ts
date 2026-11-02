import { expect, it } from "vitest";
import { shortLearnerNames } from "@happy-learners/domain";

const names = (list: string[]) => [...shortLearnerNames(list.map((name, index) => ({ id: String(index), name }))).values()];

it("R1 shows the first word and the initial of the next, never the full name", () => {
  expect(names(["Ana López García", "Luis  Pérez", "Sofía"])).toEqual(["Ana L.", "Luis P.", "Sofía"]);
  // Words without a letter do not count, and the initial is the first letter.
  expect(names(["E2E · Ana", "María - (Pérez)"])).toEqual(["E2E A.", "María P."]);
});

it("R1 tells apart names that would read the same, with more initials and then a number", () => {
  // «Ana Lima» has no more words to show; the other two take their next initial, so all three differ.
  expect(names(["Ana López García", "Ana López Ruiz", "Ana Lima"])).toEqual(["Ana L. G.", "Ana L. R.", "Ana L."]);
  // Identical names can only be numbered.
  expect(names(["Ana López", "Ana López", "Beto Ruiz"])).toEqual(["Ana L. (1)", "Ana L. (2)", "Beto R."]);
});
