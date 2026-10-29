import { useId, useRef } from "react";
import type { KeyboardEvent, ReactNode } from "react";

export type TabItem<T extends string> = { value: T; label: string; badge?: ReactNode };

/**
 * Tabs following the WAI-ARIA pattern: arrows, Home and End move between tabs and select them; only the selected tab
 * is in the tab order. On narrow screens the list scrolls sideways instead of wrapping.
 */
export function Tabs<T extends string>({ label, items, value, onChange, children, aside }: { label: string; items: TabItem<T>[]; value: T; onChange: (value: T) => void; children: ReactNode; aside?: ReactNode }) {
  const base = useId(), refs = useRef<(HTMLButtonElement | null)[]>([]);
  function onKey(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    if (!["ArrowRight", "ArrowLeft", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const next = event.key === "Home" ? 0 : event.key === "End" ? items.length - 1 : (index + (event.key === "ArrowRight" ? 1 : items.length - 1)) % items.length;
    onChange(items[next].value); refs.current[next]?.focus();
  }
  return <>
    <div className="tab-row">
    <div role="tablist" aria-label={label} className="tabs scrollable-tabs">
      {items.map((item, index) => <button key={item.value} ref={element => { refs.current[index] = element; }} type="button" role="tab" id={`${base}-${item.value}`} aria-controls={`${base}-panel`}
        aria-selected={value === item.value} tabIndex={value === item.value ? 0 : -1} className="tab" onClick={() => onChange(item.value)} onKeyDown={event => onKey(event, index)}>
        {item.label}{item.badge ? <>{" "}{item.badge}</> : null}
      </button>)}
    </div>
    {aside}
    </div>
    <div role="tabpanel" id={`${base}-panel`} aria-labelledby={`${base}-${value}`} className="tab-panel">{children}</div>
  </>;
}
