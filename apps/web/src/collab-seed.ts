import { getSchema } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { prosemirrorJSONToYXmlFragment } from "y-prosemirror";
import type * as Y from "yjs";
import type { Activity, RichTextDocument } from "@happy-learners/contracts";
import { blocksOf } from "@happy-learners/domain";

// Same schema as the Worker (apps/api/src/rich-text.ts), so seeded fields round-trip unchanged.
const schema = getSchema([StarterKit.configure({ heading: { levels: [2, 3] } })]);

/**
 * A collaboration room is seeded once, from the blocks that existed at that moment. Blocks saved later
 * (or activities saved before they had IDs) have no field in the room, and the Worker would read them back
 * as empty on save. Once synced, write the stored text of every missing field so no block is lost.
 */
export function seedMissingFields(doc: Y.Doc, activities: Activity[]) {
  doc.transact(() => {
    for (const block of activities.filter(activity => activity.id).flatMap(blocksOf)) {
      const fragment = doc.getXmlFragment(block.id);
      if (fragment.length) continue;
      const initial: RichTextDocument | null = block.richContent
        || (block.instructions?.trim() ? { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: block.instructions }] }] } : null);
      if (initial) prosemirrorJSONToYXmlFragment(schema, initial, fragment);
    }
  }, "seed");
}
