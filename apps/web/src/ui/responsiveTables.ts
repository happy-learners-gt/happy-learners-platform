import { useEffect } from "react";
import type { RefObject } from "react";

/**
 * List tables (`.members-table`) read as stacked cards on phones: each cell shows its column name from `data-label`.
 * The labels come from the table's own header, so no page repeats them; a cell that already has one keeps it. Matrix
 * tables (grades, coverage, permissions, notification settings) keep their grid and scroll sideways instead.
 */
export function labelTables(root: ParentNode) {
  for (const table of root.querySelectorAll<HTMLTableElement>("table.members-table:not(.notification-matrix)")) {
    const heads = [...(table.tHead?.rows[0]?.cells || [])].map(cell => cell.textContent?.trim() || "");
    for (const body of table.tBodies) for (const row of body.rows) {
      let column = 0;
      for (const cell of row.cells) {
        if (!cell.hasAttribute("data-label") && heads[column]) cell.setAttribute("data-label", heads[column]);
        column += cell.colSpan || 1;
      }
    }
  }
}

/** Keeps the labels current while the content under `root` changes. */
export function useTableLabels(root: RefObject<HTMLElement | null>) {
  useEffect(() => {
    const node = root.current;
    if (!node) return;
    let frame = 0;
    const run = () => { frame = 0; labelTables(node); };
    run();
    const observer = new MutationObserver(() => { if (!frame) frame = requestAnimationFrame(run); });
    observer.observe(node, { childList: true, subtree: true });
    return () => { observer.disconnect(); cancelAnimationFrame(frame); };
  }, [root]);
}
