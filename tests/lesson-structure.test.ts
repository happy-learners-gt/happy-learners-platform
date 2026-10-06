import { describe, expect, it } from "vitest";
import * as Y from "yjs";
import type { LessonDraft } from "../apps/web/src/model";
import { hasStructure, observeStructure, readStructure, recordSaved, savedVersion, seedStructure, writeStructure } from "../apps/web/src/lesson-structure";

const block = (id: string) => ({ id, kind: "text" as const, richContent: { type: "doc" as const, content: [{ type: "paragraph", content: [{ type: "text", text: id }] }] } });
const draft: LessonDraft = {
  title: "Fracciones", objective: "Comparar fracciones", duration: 40, unitId: "unit-1", archived: false, sequence: "start-develop-close", outcomeIds: [],
  activities: [
    { id: "a", position: 0, title: "Activación", minutes: 5, instructions: "", phase: "start", blocks: [block("a1")] },
    { id: "b", position: 1, title: "Práctica", minutes: 20, instructions: "", phase: "develop", grouping: "pairs", blocks: [block("b1")] },
    { id: "c", position: 2, title: "Ejercicios", minutes: 10, instructions: "", phase: "develop", blocks: [block("c1")] },
  ],
};
/** Two editors in the same room: each change of one reaches the other, as the collaboration server relays it. */
function room() {
  const one = new Y.Doc(), two = new Y.Doc();
  one.on("update", (update: Uint8Array, origin: unknown) => { if (origin !== "remote") Y.applyUpdate(two, update, "remote"); });
  two.on("update", (update: Uint8Array, origin: unknown) => { if (origin !== "remote") Y.applyUpdate(one, update, "remote"); });
  return [one, two];
}
/** Two editors whose changes cross in transit: what happens when two people edit at the same moment. */
function apart(seed: LessonDraft) {
  const one = new Y.Doc(), two = new Y.Doc();
  writeStructure(one, seed);
  Y.applyUpdate(two, Y.encodeStateAsUpdate(one), "remote");
  const exchange = () => {
    const [toTwo, toOne] = [Y.encodeStateAsUpdate(one, Y.encodeStateVector(two)), Y.encodeStateAsUpdate(two, Y.encodeStateVector(one))];
    Y.applyUpdate(two, toTwo, "remote"); Y.applyUpdate(one, toOne, "remote");
  };
  return { one, two, exchange };
}

describe("lesson structure in the collaboration room", () => {
  it("round-trips the draft and keeps block text from the current editor", () => {
    const doc = new Y.Doc();
    expect(hasStructure(doc)).toBe(false);
    writeStructure(doc, draft);
    expect(hasStructure(doc)).toBe(true);
    expect(readStructure(doc, draft)).toEqual(draft);
    // The structure never carries block text: that lives in each block's collaborative field.
    expect(JSON.stringify(doc.getMap("activities").toJSON())).not.toContain("richContent");
  });

  it("merges concurrent edits to title, objective, order and activities", () => {
    const { one, two, exchange } = apart(draft);
    const base = readStructure(two, draft);
    expect(base.activities.map(a => a.id)).toEqual(["a", "b", "c"]);
    writeStructure(one, { ...base, title: "Fracciones equivalentes", activities: [base.activities[0], base.activities[2], base.activities[1]] });
    writeStructure(two, { ...base, objective: "Comparar y ordenar fracciones", activities: base.activities.map(a => a.id === "b" ? { ...a, minutes: 25 } : a).concat({ id: "d", position: 3, title: "Cierre", minutes: 5, instructions: "", phase: "close", blocks: [block("d1")] }) });
    exchange();
    const left = readStructure(one, base), right = readStructure(two, base);
    expect(left).toEqual(right);
    expect(left.title).toBe("Fracciones equivalentes");
    expect(left.objective).toBe("Comparar y ordenar fracciones");
    expect(left.activities.map(a => a.id)).toEqual(["a", "c", "b", "d"]);
    expect(left.activities.find(a => a.id === "b")!.minutes).toBe(25);
    expect(left.activities.find(a => a.id === "b")!.grouping).toBe("pairs");
    expect(left.activities.map(a => a.position)).toEqual([0, 1, 2, 3]);
  });

  it("a move and an activity added at the same time both survive, whoever wins the tie", () => {
    const free: LessonDraft = { ...draft, sequence: "free", activities: draft.activities.map(a => ({ ...a, phase: "main" })) };
    const extra = { id: "d", position: 3, title: "Cierre", minutes: 5, instructions: "", phase: "main", blocks: [block("d1")] };
    for (let run = 0; run < 25; run++) {
      const { one, two, exchange } = apart(free);
      const [a, b, c] = free.activities;
      writeStructure(one, { ...free, activities: [c, a, b] });
      writeStructure(two, { ...free, activities: [a, b, c, extra] });
      exchange();
      const ids = readStructure(one, free).activities.map(item => item.id);
      expect(readStructure(two, free).activities.map(item => item.id)).toEqual(ids);
      expect(ids.filter(id => id !== "d")).toEqual(["c", "a", "b"]);
      expect(ids).toContain("d");
    }
  });

  it("keeps both people's typing in the same title", () => {
    const { one, two, exchange } = apart(draft);
    writeStructure(one, { ...draft, title: "Fracciones propias" });
    writeStructure(two, { ...draft, title: "Las fracciones" });
    exchange();
    expect(readStructure(one, draft).title).toBe(readStructure(two, draft).title);
    expect(readStructure(one, draft).title).toBe("Las fracciones propias");
  });

  it("removes an activity that someone deleted and tells the others", () => {
    const [one, two] = room();
    writeStructure(one, draft);
    const heard: number[] = [];
    const stop = observeStructure(two, () => heard.push(1));
    writeStructure(one, { ...draft, activities: draft.activities.filter(a => a.id !== "c") });
    expect(readStructure(two, draft).activities.map(a => a.id)).toEqual(["a", "b"]);
    expect(heard.length).toBeGreaterThan(0);
    const count = heard.length;
    writeStructure(two, { ...draft, title: "Propio" });
    expect(heard.length).toBe(count);
    stop();
  });

  it("two people seeding an empty room at once keep one copy of the lesson", () => {
    const one = new Y.Doc(), two = new Y.Doc();
    seedStructure(one, draft, "lesson-1", 3);
    seedStructure(two, draft, "lesson-1", 3);
    Y.applyUpdate(two, Y.encodeStateAsUpdate(one)); Y.applyUpdate(one, Y.encodeStateAsUpdate(two));
    expect(readStructure(one, draft)).toEqual(draft);
    expect(readStructure(two, draft)).toEqual(draft);
    expect(savedVersion(one)).toBe(3);
  });

  it("records the newest saved version only", () => {
    const doc = new Y.Doc();
    expect(savedVersion(doc)).toBeNull();
    recordSaved(doc, 4); recordSaved(doc, 3);
    expect(savedVersion(doc)).toBe(4);
  });
});
