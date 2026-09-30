import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Collaboration from "@tiptap/extension-collaboration";
import CollaborationCaret from "@tiptap/extension-collaboration-caret";
import { isChangeOrigin } from "@tiptap/extension-collaboration";
import type { RichTextDocument } from "@happy-learners/contracts";
import type * as Y from "yjs";
import type { CollaborationProvider } from "./collaboration";

const blank: RichTextDocument = { type: "doc", content: [{ type: "paragraph" }] };
export function RichText({ value, fallbackText = "", onChange, onRemoteChange, label = "Contenido de la actividad", editable = true, collaboration, username }: { value?: RichTextDocument; fallbackText?: string; onChange?: (doc: RichTextDocument) => void; onRemoteChange?: (doc: RichTextDocument) => void; label?: string; editable?: boolean; collaboration?: { document: Y.Doc; field: string; provider: CollaborationProvider }; username?: string }) {
  const initial = value || (fallbackText.trim() ? { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: fallbackText }] }] } as RichTextDocument : blank);
  const editor = useEditor({
    extensions: [
      StarterKit.configure({ heading: { levels: [2, 3] }, link: { openOnClick: !editable }, undoRedo: collaboration ? false : undefined }),
      ...(collaboration ? [Collaboration.configure({ document: collaboration.document, field: collaboration.field }), CollaborationCaret.configure({ provider: collaboration.provider, user: { name: username || "Educador", color: "#0F5C4F" } })] : []),
    ],
    content: collaboration ? undefined : initial,
    editable,
    immediatelyRender: false,
    editorProps: { attributes: { role: "textbox", "aria-label": label, "aria-multiline": "true", ...(editable ? {} : { "aria-readonly": "true" }), class: "richtext-content" } },
    // Remote collaborative edits refresh local state without marking this editor as the author of a change.
    onUpdate: ({ editor: current, transaction }) => { const doc = current.getJSON() as RichTextDocument; if (collaboration && isChangeOrigin(transaction)) onRemoteChange?.(doc); else onChange?.(doc); },
  });
  if (!editor) return <div className="richtext-loading" role="status">Abriendo editor…</div>;
  const button = (name: string, action: () => void, pressed = false) => <button type="button" className="richtext-tool" aria-label={name} aria-pressed={pressed} onMouseDown={event => event.preventDefault()} onClick={action}>{name}</button>;
  return <div className={`richtext ${editable ? "is-editable" : "is-readonly"}`}>
    {editable && <div className="richtext-toolbar" role="toolbar" aria-label="Formato del texto">
      {button("Negrita", () => editor.chain().focus().toggleBold().run(), editor.isActive("bold"))}
      {button("Cursiva", () => editor.chain().focus().toggleItalic().run(), editor.isActive("italic"))}
      {button("Título", () => editor.chain().focus().toggleHeading({ level: 2 }).run(), editor.isActive("heading", { level: 2 }))}
      {button("Lista", () => editor.chain().focus().toggleBulletList().run(), editor.isActive("bulletList"))}
      {button("Lista numerada", () => editor.chain().focus().toggleOrderedList().run(), editor.isActive("orderedList"))}
      {button("Cita", () => editor.chain().focus().toggleBlockquote().run(), editor.isActive("blockquote"))}
      {button("Enlace", () => { const href = window.prompt("Pega un enlace http o https"); if (href && /^https?:\/\//i.test(href)) editor.chain().focus().extendMarkRange("link").setLink({ href }).run(); }, editor.isActive("link"))}
    </div>}
    <EditorContent editor={editor}/>
  </div>;
}
