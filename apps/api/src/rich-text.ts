import { getSchema } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import type { Activity, RichTextDocument } from "@happy-learners/contracts";
import * as Y from "yjs";
import { prosemirrorJSONToYXmlFragment, yXmlFragmentToProsemirrorJSON } from "y-prosemirror";

const schema = getSchema([StarterKit.configure({ heading: { levels: [2, 3] } })]);
const empty: RichTextDocument = { type: "doc", content: [{ type: "paragraph" }] };

function initialDocument(activity: Activity): RichTextDocument {
  if (activity.richContent) return activity.richContent;
  return activity.instructions.trim()
    ? { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: activity.instructions }] }] }
    : empty;
}

export function encodeLessonDraft(activities: Activity[]): Uint8Array {
  const doc = new Y.Doc();
  for (const activity of activities) {
    if (!activity.id) continue;
    prosemirrorJSONToYXmlFragment(schema, initialDocument(activity), doc.getXmlFragment(activity.id));
  }
  return Y.encodeStateAsUpdate(doc);
}

export function richTextSnapshot(doc: Y.Doc, activityIds: string[]): Record<string, RichTextDocument> {
  const snapshot: Record<string, RichTextDocument> = {};
  for (const activityId of activityIds) {
    if (!/^[a-zA-Z0-9_-]{1,100}$/.test(activityId)) continue;
    const fragment = doc.getXmlFragment(activityId);
    const json = yXmlFragmentToProsemirrorJSON(fragment) as RichTextDocument;
    snapshot[activityId] = json.content?.length ? json : empty;
  }
  return snapshot;
}
