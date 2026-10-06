import * as Y from "yjs";
import type { Activity, ActivityBlock, SequenceTemplate } from "@happy-learners/contracts";
import { orderByPhase } from "./model";
import type { LessonDraft } from "./model";

/**
 * The lesson's structure in the collaboration room (DEC-030), next to the rich text of each block: title and
 * objective as shared text, the other details as values, the order of the activities, and each activity's fields
 * and blocks. Everyone editing sees and merges these changes live; saving sends the merged result.
 */
const details = (doc: Y.Doc) => doc.getMap<unknown>("lesson");
const text = (doc: Y.Doc, key: "title" | "objective") => doc.getText(key);
const order = (doc: Y.Doc) => doc.getArray<string>("activity-order");
const activities = (doc: Y.Doc) => doc.getMap<Y.Map<unknown>>("activities");
export const localStructure = "lesson-structure";

/** Block text lives in its own collaborative field; the structure keeps everything else of the block. */
const shape = ({ richContent: _rich, instructions: _text, ...block }: ActivityBlock) => block;
function fieldsOf(activity: Activity): Record<string, string | number> {
  return {
    title: activity.title, minutes: activity.minutes, phase: activity.phase || "", purpose: activity.purpose || "", grouping: activity.grouping || "",
    outcomeIds: JSON.stringify(activity.outcomeIds || []), blocks: JSON.stringify((activity.blocks || []).map(shape)),
  };
}
const unique = (ids: string[]) => ids.filter((id, index) => ids.indexOf(id) === index);

/** Writes a text as the smallest change, so concurrent typing in other places of the text is kept. */
function setText(target: Y.Text, value: string) {
  const current = target.toString();
  if (current === value) return;
  let start = 0;
  while (start < current.length && start < value.length && current[start] === value[start]) start++;
  let end = 0;
  while (end < current.length - start && end < value.length - start && current[current.length - 1 - end] === value[value.length - 1 - end]) end++;
  target.delete(start, current.length - start - end);
  target.insert(start, value.slice(start, value.length - end));
}

export const hasStructure = (doc: Y.Doc) => details(doc).has("sequence");
export const savedVersion = (doc: Y.Doc) => { const value = details(doc).get("savedVersion"); return typeof value === "number" ? value : null; };
export const recordSaved = (doc: Y.Doc, version: number) => doc.transact(() => { if ((savedVersion(doc) ?? -1) < version) details(doc).set("savedVersion", version); }, localStructure);

/** Brings the room to the draft, changing only what differs. */
export function writeStructure(doc: Y.Doc, draft: LessonDraft) {
  doc.transact(() => {
    setText(text(doc, "title"), draft.title);
    setText(text(doc, "objective"), draft.objective);
    const map = details(doc);
    const values: Record<string, unknown> = { duration: draft.duration, unitId: draft.unitId, archived: draft.archived, sequence: draft.sequence, outcomeIds: JSON.stringify(draft.outcomeIds) };
    for (const [key, value] of Object.entries(values)) if (map.get(key) !== value) map.set(key, value);
    const shared = activities(doc), ids = draft.activities.map(activity => activity.id!);
    for (const id of [...shared.keys()]) if (!ids.includes(id)) shared.delete(id);
    for (const activity of draft.activities) {
      let fields = shared.get(activity.id!);
      if (!fields) { fields = new Y.Map(); shared.set(activity.id!, fields); }
      for (const [key, value] of Object.entries(fieldsOf(activity))) if (fields.get(key) !== value) fields.set(key, value);
    }
    setOrder(order(doc), ids);
  }, localStructure);
}
/**
 * Moves only what changed place: what keeps its relative order stays, the rest is removed and inserted where it
 * goes. A move and an activity added by someone else at the same time both survive.
 */
function setOrder(list: Y.Array<string>, ids: string[]) {
  const current = list.toArray();
  if (current.join("\n") === ids.join("\n")) return;
  const n = current.length, m = ids.length;
  const common = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) common[i][j] = current[i] === ids[j] ? common[i + 1][j + 1] + 1 : Math.max(common[i + 1][j], common[i][j + 1]);
  const keep = new Set<number>();
  for (let i = 0, j = 0; i < n && j < m;) {
    if (current[i] === ids[j]) { keep.add(i); i++; j++; }
    else if (common[i + 1][j] >= common[i][j + 1]) i++;
    else j++;
  }
  for (let i = n - 1; i >= 0; i--) if (!keep.has(i)) list.delete(i, 1);
  let position = 0;
  for (const id of ids) {
    if (position >= list.length || list.get(position) !== id) list.insert(position, [id]);
    position++;
  }
}

/** A stable Yjs client for a seed: the same key always writes the same items. */
function seedClient(key: string) {
  let hash = 0x811c9dc5;
  for (const char of key) hash = Math.imul(hash ^ char.charCodeAt(0), 0x01000193) >>> 0;
  return hash || 1;
}
/**
 * Writes the saved lesson into a room without structure. Two people opening the lesson at once write the very
 * same items for the same saved version, so the room keeps one title, not two.
 */
export function seedStructure(doc: Y.Doc, saved: LessonDraft, key: string, version: number) {
  const seed = new Y.Doc();
  seed.clientID = seedClient(`${key}:${version}`);
  writeStructure(seed, saved);
  recordSaved(seed, version);
  Y.applyUpdate(doc, Y.encodeStateAsUpdate(seed), localStructure);
}

/**
 * The draft as the room holds it. Text of each block comes from the current draft (its editor follows the block's
 * collaborative field); an activity another person added appears with its blocks and their live text.
 */
export function readStructure(doc: Y.Doc, current: LessonDraft): LessonDraft {
  const map = details(doc), shared = activities(doc);
  const known = new Map(current.activities.map(activity => [activity.id, activity]));
  // Two people reordering at once can repeat an id; an activity added meanwhile may be missing from the order.
  const ids = unique(order(doc).toArray().filter(id => shared.has(id)));
  for (const id of shared.keys()) if (!ids.includes(id)) ids.push(id);
  const sequence = String(map.get("sequence") || current.sequence) as SequenceTemplate;
  const list = ids.map((id): Activity => {
    const fields = shared.get(id)!, before = known.get(id);
    const blocks = (JSON.parse(String(fields.get("blocks") || "[]")) as ActivityBlock[]).map(block => {
      const old = before?.blocks?.find(item => item.id === block.id);
      return { ...block, ...(old?.richContent ? { richContent: old.richContent } : {}), ...(old?.instructions ? { instructions: old.instructions } : {}) };
    });
    const outcomeIds = JSON.parse(String(fields.get("outcomeIds") || "[]")) as string[];
    return {
      id, position: 0, title: String(fields.get("title") ?? ""), minutes: Number(fields.get("minutes")) || 1, instructions: "", blocks,
      ...(fields.get("phase") ? { phase: String(fields.get("phase")) } : {}), ...(fields.get("purpose") ? { purpose: fields.get("purpose") as Activity["purpose"] } : {}),
      ...(fields.get("grouping") ? { grouping: fields.get("grouping") as Activity["grouping"] } : {}), ...(outcomeIds.length ? { outcomeIds } : {}),
    };
  });
  return {
    title: text(doc, "title").toString(), objective: text(doc, "objective").toString(),
    duration: Number(map.get("duration")) || current.duration, unitId: String(map.get("unitId") ?? current.unitId), archived: map.get("archived") === true,
    sequence, outcomeIds: JSON.parse(String(map.get("outcomeIds") || "[]")) as string[], activities: orderByPhase(list, sequence).map((activity, position) => ({ ...activity, position })),
  };
}

/** Calls back after each change to the structure made by someone else. */
export function observeStructure(doc: Y.Doc, listener: () => void) {
  const handler = (_events: unknown, transaction: Y.Transaction) => { if (!transaction.local) listener(); };
  const types = [details(doc), text(doc, "title"), text(doc, "objective"), order(doc), activities(doc)] as Y.AbstractType<unknown>[];
  for (const type of types) type.observeDeep(handler);
  return () => { for (const type of types) type.unobserveDeep(handler); };
}
