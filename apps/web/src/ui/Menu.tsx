import { useEffect, useId, useRef, useState } from "react";
import type { KeyboardEvent } from "react";
import { Icon } from "./icons";
import type { IconName } from "./icons";

export type MenuItem = { label: string; icon?: IconName; onSelect: () => void; danger?: boolean; disabled?: boolean } | "separator";

/** Contextual menu following the WAI-ARIA menu button pattern: arrows, Home/End, Escape and Tab. */
export function Menu({ label, items, icon = "more", text }: { label: string; items: MenuItem[]; icon?: IconName; text?: string }) {
  const [open, setOpen] = useState(false);
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
      onClick={() => setOpen(!open)} onKeyDown={event => { if (event.key === "ArrowDown" || event.key === "ArrowUp") { event.preventDefault(); setOpen(true); } }}>
      <Icon name={icon} size={18}/>{text && <span className="menu-button-text">{text}</span>}
    </button>
    {open && <div ref={list} id={id} role="menu" aria-label={label} className="menu-list" onKeyDown={keys}>
      {items.map((item, index) => item === "separator" ? <div key={index} role="separator" className="menu-separator"/> :
        <button key={item.label} type="button" role="menuitem" tabIndex={-1} disabled={item.disabled} className={item.danger ? "danger" : undefined} onClick={() => { close(); item.onSelect(); }}>
          {item.icon && <Icon name={item.icon} size={16}/>}<span>{item.label}</span>
        </button>)}
    </div>}
  </div>;
}
