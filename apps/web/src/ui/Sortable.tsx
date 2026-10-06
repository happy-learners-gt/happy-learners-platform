import { useRef } from "react";
import type { KeyboardEvent, PointerEvent } from "react";
import { Icon } from "./icons";

/** The list with the item at `from` placed at `to`. */
export function moveItem<T>(list: T[], from: number, to: number) {
  const next = [...list];
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item);
  return next;
}

type Drag = { pointer: number; start: number; item: HTMLElement; others: HTMLElement[]; to: number };
const clearDrop = (items: HTMLElement[]) => items.forEach(item => delete item.dataset.drop);

/**
 * Handle of an item that can be reordered (Fluent «re-order dots»). The item is the closest `li`: dragging the
 * handle with a mouse, a pen or a finger moves it within its list, and the arrow keys move it one place. `onStep`
 * replaces what the arrow keys do when a step can leave the list, as an activity passing to the next moment.
 */
export function SortHandle({ id, label, index, count, onMove, onStep, disabled = false, className = "" }: {
  id: string; label: string; index: number; count: number; onMove: (to: number) => void; onStep?: (delta: -1 | 1) => boolean; disabled?: boolean; className?: string;
}) {
  const drag = useRef<Drag | null>(null);
  const off = disabled || count < 2;
  function refocus() { requestAnimationFrame(() => document.querySelector<HTMLButtonElement>(`[data-sort-handle="${CSS.escape(id)}"]`)?.focus()); }
  function key(event: KeyboardEvent<HTMLButtonElement>) {
    const to = event.key === "ArrowUp" ? index - 1 : event.key === "ArrowDown" ? index + 1 : event.key === "Home" ? 0 : event.key === "End" ? count - 1 : null;
    if (to === null || disabled) return;
    event.preventDefault();
    if (onStep && (event.key === "ArrowUp" || event.key === "ArrowDown")) { if (onStep(event.key === "ArrowUp" ? -1 : 1)) refocus(); return; }
    if (count < 2) return;
    if (to < 0 || to >= count || to === index) return;
    onMove(to);
    refocus();
  }
  function down(event: PointerEvent<HTMLButtonElement>) {
    if (off || (event.pointerType === "mouse" && event.button !== 0)) return;
    const item = event.currentTarget.closest("li"), list = item?.parentElement;
    if (!item || !list) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    const others = [...list.children].filter((child): child is HTMLElement => child instanceof HTMLElement && child.tagName === "LI" && child !== item);
    drag.current = { pointer: event.pointerId, start: event.clientY, item, others, to: index };
    item.classList.add("is-dragging");
    list.classList.add("is-sorting");
  }
  function move(event: PointerEvent<HTMLButtonElement>) {
    const state = drag.current;
    if (!state || event.pointerId !== state.pointer) return;
    state.item.style.transform = `translateY(${event.clientY - state.start}px)`;
    state.to = state.others.filter(other => { const box = other.getBoundingClientRect(); return box.top + box.height / 2 < event.clientY; }).length;
    clearDrop(state.others);
    if (state.to !== index) {
      if (state.to < state.others.length) state.others[state.to].dataset.drop = "before";
      else state.others[state.others.length - 1].dataset.drop = "after";
    }
  }
  function end(drop: boolean) {
    const state = drag.current;
    if (!state) return;
    drag.current = null;
    state.item.style.transform = "";
    state.item.classList.remove("is-dragging");
    state.item.parentElement?.classList.remove("is-sorting");
    clearDrop(state.others);
    if (drop && state.to !== index) { onMove(state.to); refocus(); }
  }
  return <button type="button" className={`drag-handle${className ? ` ${className}` : ""}`} data-sort-handle={id} disabled={disabled || (count < 2 && !onStep)}
    aria-label={label} aria-roledescription="control para reordenar" aria-keyshortcuts="ArrowUp ArrowDown" title="Arrastra para cambiar el orden, o usa las flechas del teclado"
    onKeyDown={key} onPointerDown={down} onPointerMove={move} onPointerUp={() => end(true)} onPointerCancel={() => end(false)} onLostPointerCapture={() => end(false)}>
    <Icon name="reorder" size={16}/>
  </button>;
}
