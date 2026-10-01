import { useRef, useState } from "react";
import type { KeyboardEvent, ReactNode } from "react";
import { useEditor, useEditorState, EditorContent } from "@tiptap/react";
import type { Editor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { CharacterCount, Placeholder } from "@tiptap/extensions";
import Collaboration from "@tiptap/extension-collaboration";
import CollaborationCaret from "@tiptap/extension-collaboration-caret";
import { isChangeOrigin } from "@tiptap/extension-collaboration";
import type { RichTextDocument } from "@happy-learners/contracts";
import type * as Y from "yjs";
import type { CollaborationProvider } from "./collaboration";
import { Icon } from "./ui/icons";
import type { IconName } from "./ui/icons";

const blank: RichTextDocument = { type: "doc", content: [{ type: "paragraph" }] };

export function RichText({ value, fallbackText = "", onChange, onRemoteChange, onEditorFocus, label = "Contenido de la actividad", editable = true, toolbar = true, collaboration, username, placeholder = "Escribe las instrucciones o el contenido de la actividad…" }: { value?: RichTextDocument; fallbackText?: string; onChange?: (doc: RichTextDocument) => void; onRemoteChange?: (doc: RichTextDocument) => void; onEditorFocus?: (editor: Editor) => void; label?: string; editable?: boolean; toolbar?: boolean; collaboration?: { document: Y.Doc; field: string; provider: CollaborationProvider }; username?: string; placeholder?: string }) {
  const initial = value || (fallbackText.trim() ? { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: fallbackText }] }] } as RichTextDocument : blank);
  const editor = useEditor({
    extensions: [
      // Only the nodes and marks the Worker accepts (apps/api domain validation): no code blocks or rules.
      StarterKit.configure({ heading: { levels: [2, 3] }, codeBlock: false, horizontalRule: false, link: { openOnClick: !editable, autolink: true }, undoRedo: collaboration ? false : undefined }),
      Placeholder.configure({ placeholder }),
      CharacterCount,
      ...(collaboration ? [Collaboration.configure({ document: collaboration.document, field: collaboration.field }), CollaborationCaret.configure({ provider: collaboration.provider, user: { name: username || "Educador", color: "#5B45E0" } })] : []),
    ],
    content: collaboration ? undefined : initial,
    editable,
    immediatelyRender: false,
    editorProps: { attributes: { role: "textbox", "aria-label": label, "aria-multiline": "true", ...(editable ? {} : { "aria-readonly": "true" }), class: "richtext-content" } },
    // A shared toolbar (lesson canvas) follows whichever editor has focus.
    onFocus: ({ editor: current }) => onEditorFocus?.(current as Editor),
    // Remote collaborative edits refresh local state without marking this editor as the author of a change.
    onUpdate: ({ editor: current, transaction }) => { const doc = current.getJSON() as RichTextDocument; if (collaboration && isChangeOrigin(transaction)) onRemoteChange?.(doc); else onChange?.(doc); },
  });
  if (!editor) return <div className="richtext-loading" role="status">Abriendo editor…</div>;
  return <div className={`richtext ${editable ? "is-editable" : "is-readonly"}`}>
    {editable && toolbar && <Toolbar editor={editor}/>}
    <div className="richtext-page"><EditorContent editor={editor}/></div>
    {editable && <Footer editor={editor}/>}
  </div>;
}

type Tool = { label: string; icon?: IconName; glyph?: ReactNode; active?: boolean; disabled?: boolean; run: () => void };

/**
 * Docs-style toolbar: grouped icon buttons, one tab stop, arrow keys move between tools (WAI-ARIA toolbar).
 * Without an editor (nothing focused yet) it stays visible and disabled.
 */
export function Toolbar({ editor }: { editor: Editor | null }) {
  const state = useEditorState({
    editor,
    selector: ({ editor: e }) => !e ? null : ({
      bold: e.isActive("bold"), italic: e.isActive("italic"), underline: e.isActive("underline"), strike: e.isActive("strike"),
      h2: e.isActive("heading", { level: 2 }), h3: e.isActive("heading", { level: 3 }), paragraph: e.isActive("paragraph"),
      bullet: e.isActive("bulletList"), ordered: e.isActive("orderedList"), quote: e.isActive("blockquote"), link: e.isActive("link"),
      undo: e.can().undo(), redo: e.can().redo(), href: String(e.getAttributes("link").href || ""),
    }),
  });
  const [linking, setLinking] = useState(false), [href, setHref] = useState(""), [current, setCurrent] = useState(0);
  const bar = useRef<HTMLDivElement>(null);
  if (!editor || !state) return <div className="richtext-chrome"><div className="richtext-toolbar is-idle" role="toolbar" aria-label="Formato del texto" aria-disabled="true"><span className="toolbar-hint"><Icon name="edit" size={16}/>Haz clic en el texto de una actividad para darle formato.</span></div></div>;
  const chain = () => editor.chain().focus();
  const groups: Tool[][] = [
    [{ label: "Deshacer", icon: "undo", disabled: !state.undo, run: () => chain().undo().run() },
     { label: "Rehacer", icon: "redo", disabled: !state.redo, run: () => chain().redo().run() }],
    [{ label: "Texto normal", glyph: <span className="glyph">T</span>, active: state.paragraph && !state.h2 && !state.h3, run: () => chain().setParagraph().run() },
     { label: "Título", glyph: <span className="glyph">H2</span>, active: state.h2, run: () => chain().toggleHeading({ level: 2 }).run() },
     { label: "Subtítulo", glyph: <span className="glyph small">H3</span>, active: state.h3, run: () => chain().toggleHeading({ level: 3 }).run() }],
    [{ label: "Negrita", icon: "bold", active: state.bold, run: () => chain().toggleBold().run() },
     { label: "Cursiva", icon: "italic", active: state.italic, run: () => chain().toggleItalic().run() },
     { label: "Subrayado", icon: "underline", active: state.underline, run: () => chain().toggleUnderline().run() },
     { label: "Tachado", icon: "strike", active: state.strike, run: () => chain().toggleStrike().run() }],
    [{ label: "Lista", icon: "listBullet", active: state.bullet, run: () => chain().toggleBulletList().run() },
     { label: "Lista numerada", icon: "listOrdered", active: state.ordered, run: () => chain().toggleOrderedList().run() },
     { label: "Cita", icon: "quote", active: state.quote, run: () => chain().toggleBlockquote().run() }],
    [{ label: "Enlace", icon: "link", active: state.link || linking, run: () => { setHref(state.href || "https://"); setLinking(!linking); } }],
  ];
  const flat = groups.flat();
  function keys(event: KeyboardEvent) {
    const move = { ArrowRight: 1, ArrowLeft: -1 }[event.key as "ArrowRight" | "ArrowLeft"], edge = { Home: 0, End: flat.length - 1 }[event.key as "Home" | "End"];
    if (move === undefined && edge === undefined) return;
    event.preventDefault();
    const next = edge ?? (current + move! + flat.length) % flat.length;
    setCurrent(next);
    bar.current?.querySelectorAll<HTMLButtonElement>(".richtext-tool")[next]?.focus();
  }
  function applyLink(value: string) {
    const clean = value.trim();
    if (!clean || clean === "https://") chain().extendMarkRange("link").unsetLink().run();
    else if (/^https?:\/\/[^\s/?#@]+/i.test(clean)) chain().extendMarkRange("link").setLink({ href: clean }).run();
    else return false;
    setLinking(false);
    return true;
  }
  let index = -1;
  return <div className="richtext-chrome">
    <div ref={bar} className="richtext-toolbar" role="toolbar" aria-label="Formato del texto" onKeyDown={keys}>
      {groups.map((group, g) => <div key={g} className="richtext-group" role="group">
        {group.map(tool => { index++; const i = index; return <button key={tool.label} type="button" className="richtext-tool" title={tool.label} aria-label={tool.label} aria-pressed={tool.active === undefined ? undefined : tool.active}
          disabled={tool.disabled} tabIndex={i === current ? 0 : -1} onFocus={() => setCurrent(i)} onMouseDown={event => event.preventDefault()} onClick={tool.run}>
          {tool.icon ? <Icon name={tool.icon} size={18}/> : tool.glyph}
        </button>; })}
      </div>)}
    </div>
    {linking && <form className="richtext-link" onSubmit={event => { event.preventDefault(); applyLink(href); }}>
      <Icon name="link" size={16}/>
      <label htmlFor="richtext-link-input" className="sr-only">Dirección del enlace</label>
      <input id="richtext-link-input" type="url" value={href} autoFocus onChange={event => setHref(event.target.value)} placeholder="https://ejemplo.org" onKeyDown={event => { if (event.key === "Escape") { event.preventDefault(); setLinking(false); editor.commands.focus(); } }}/>
      <button className="button primary small">Aplicar</button>
      {state.link && <button type="button" className="button ghost small" onClick={() => applyLink("")}>Quitar enlace</button>}
    </form>}
  </div>;
}

function Footer({ editor }: { editor: Editor }) {
  const words = useEditorState({ editor, selector: ({ editor: e }) => e.storage.characterCount.words() as number });
  return <div className="richtext-footer" aria-hidden="true"><span>{words === 1 ? "1 palabra" : `${words} palabras`}</span><span>Ctrl+B negrita · Ctrl+I cursiva · Ctrl+Z deshacer</span></div>;
}
