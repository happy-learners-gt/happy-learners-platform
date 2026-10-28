import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import type { CSSProperties, KeyboardEvent } from "react";
import { createPortal } from "react-dom";
import { Icon } from "./icons";
import type { IconName } from "./icons";

export type MenuItem = { label: string; icon?: IconName; onSelect: () => void; danger?: boolean; disabled?: boolean } | "separator";

const edge = 8, offset = 4;
// While it is measured the list is transparent, not hidden: a hidden element cannot take the focus the menu gives it.
const measuring: CSSProperties = { position: "fixed", top: 0, left: 0, opacity: 0 };
/**
 * Where a floating surface goes next to its trigger without leaving the viewport (collision detection, as Floating UI
 * does): aligned to the trigger's end, shifted to stay at least 8 px inside the screen, and flipped above the trigger
 * when it does not fit below. Its height is capped by the room on the chosen side; the list scrolls inside.
 */
export function floatingPosition(anchor: DOMRect, size: { width: number; height: number }, viewport: { width: number; height: number }, align: "end" | "start" = "end"): CSSProperties {
  const width = Math.min(size.width, viewport.width - edge * 2);
  // The preferred alignment if it fits, else the opposite one, else the preferred one shifted inside the screen.
  const fits = (x: number) => x >= edge && x + width <= viewport.width - edge;
  const preferred = align === "end" ? anchor.right - width : anchor.left, other = align === "end" ? anchor.left : anchor.right - width;
  const left = Math.min(Math.max(edge, fits(preferred) ? preferred : fits(other) ? other : preferred), viewport.width - width - edge);
  const below = viewport.height - anchor.bottom - offset - edge, above = anchor.top - offset - edge;
  const up = size.height > below && above > below;
  const room = Math.max(96, up ? above : below), height = Math.min(size.height, room);
  return { position: "fixed", left, right: "auto", top: up ? anchor.top - offset - height : anchor.bottom + offset, maxHeight: room, maxWidth: viewport.width - edge * 2, transformOrigin: up ? "bottom" : "top" };
}

/**
 * Contextual menu following the WAI-ARIA menu button pattern: arrows, Home/End, Escape and Tab. The list renders in a
 * portal with fixed positioning, so no card, table or scroll container clips it and it never leaves the screen.
 */
export function Menu({ label, items, icon = "more", text, align = "end" }: { label: string; items: MenuItem[]; icon?: IconName; text?: string; align?: "end" | "start" }) {
  const [open, setOpen] = useState(false), [place, setPlace] = useState<CSSProperties>(measuring);
  // Inside a modal dialog the list must live in the dialog (the top layer); elsewhere, in the body.
  const [host, setHost] = useState<HTMLElement | null>(null);
  const button = useRef<HTMLButtonElement>(null), list = useRef<HTMLDivElement>(null);
  const id = useId();
  const entries = () => [...(list.current?.querySelectorAll<HTMLButtonElement>("[role=menuitem]:not([disabled])") || [])];
  useEffect(() => {
    if (!open) return;
    entries()[0]?.focus();
    const outside = (event: PointerEvent) => { if (!list.current?.contains(event.target as Node) && !button.current?.contains(event.target as Node)) setOpen(false); };
    addEventListener("pointerdown", outside);
    return () => removeEventListener("pointerdown", outside);
  }, [open]);
  // Placed before paint and kept next to its trigger while the page scrolls; it closes when the trigger leaves the
  // screen or the window changes size.
  useLayoutEffect(() => {
    if (!open) { setPlace(measuring); return; }
    const update = () => {
      if (!button.current || !list.current) return;
      const anchor = button.current.getBoundingClientRect(), viewport = { width: document.documentElement.clientWidth, height: innerHeight };
      if (anchor.bottom < 0 || anchor.top > viewport.height) { setOpen(false); return; }
      setPlace(floatingPosition(anchor, { width: list.current.scrollWidth, height: list.current.scrollHeight }, viewport, align));
    };
    update();
    const resize = () => setOpen(false);
    addEventListener("scroll", update, true); addEventListener("resize", resize);
    return () => { removeEventListener("scroll", update, true); removeEventListener("resize", resize); };
  }, [open, align]);
  function close(focus = true) { setOpen(false); if (focus) button.current?.focus(); }
  function keys(event: KeyboardEvent) {
    const all = entries(), index = all.indexOf(document.activeElement as HTMLButtonElement);
    const go = (next: number) => { event.preventDefault(); all[(next + all.length) % all.length]?.focus(); };
    if (event.key === "ArrowDown") go(index + 1);
    else if (event.key === "ArrowUp") go(index - 1);
    else if (event.key === "Home") go(0);
    else if (event.key === "End") go(all.length - 1);
    else if (event.key === "Escape") { event.preventDefault(); close(); }
    else if (event.key === "Tab") close(false);
  }
  return <div className="menu">
    <button ref={button} type="button" className={text ? "button secondary menu-button" : "icon-button"} aria-label={label} aria-haspopup="menu" aria-expanded={open} aria-controls={open ? id : undefined}
      onClick={() => { setHost(button.current?.closest("dialog") || document.body); setOpen(!open); }} onKeyDown={event => { if (event.key === "Escape" && open) { event.preventDefault(); setOpen(false); return; } if (event.key === "ArrowDown" || event.key === "ArrowUp") { event.preventDefault(); setHost(button.current?.closest("dialog") || document.body); setOpen(true); } }}>
      <Icon name={icon} size={18}/>{text && <span className="menu-button-text">{text}</span>}
    </button>
    {open && host && createPortal(<div ref={list} id={id} role="menu" aria-label={label} className="menu-list" style={place} onKeyDown={keys}>
      {items.map((item, index) => item === "separator" ? <div key={index} role="separator" className="menu-separator"/> :
        <button key={item.label} type="button" role="menuitem" tabIndex={-1} disabled={item.disabled} className={item.danger ? "danger" : undefined} onClick={() => { close(); item.onSelect(); }}>
          {item.icon && <Icon name={item.icon} size={16}/>}<span>{item.label}</span>
        </button>)}
    </div>, host)}
  </div>;
}
