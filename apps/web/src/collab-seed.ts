import { getSchema } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { prosemirrorJSONToYXmlFragment } from "y-prosemirror";
import type * as Y from "yjs";
import type { Activity, RichTextDocument } from "@happy-learners/contracts";

// Same schema as the Worker (apps/api/src/rich-text.ts), so seeded fields round-trip unchanged.
const schema = getSchema([StarterKit.configure({ heading: { levels: [2, 3] } })]);

/**
 * A collaboration room is seeded once, from the activities that had IDs at that moment. Activities saved
 * before they had IDs have no field in the room, and the Worker would read them back as empty on save.
 * Once synced, write the stored text of every missing field so no activity is lost.
 */
export function seedMissingFields(doc: Y.Doc, activities: Activity[]) {
  doc.transact(() => {
    for (const activity of activities) {
      if (!activity.id) continue;
      const fragment = doc.getXmlFragment(activity.id);
      if (fragment.length) continue;
      const initial: RichTextDocument | null = activity.richContent
        || (activity.instructions.trim() ? { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: activity.instructions }] }] } : null);
      if (initial) prosemirrorJSONToYXmlFragment(schema, initial, fragment);
    }
  }, "seed");
}
