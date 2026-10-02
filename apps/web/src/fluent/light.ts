/**
 * Fluent "light": a soft highlight follows the pointer across interactive surfaces (Fluent's reveal),
 * so the element under the pointer feels lit. One delegated listener, at most one update per frame.
 * Disabled for touch-only devices and when the system asks for reduced motion.
 */
export const litSurfaces = ".course-card, .resource-card, .panel, .stat-tile, .canvas-card, .competency-card, .program-list > li, .preset, .lit";

export function installLight(root: Document = document) {
  const view = root.defaultView;
  if (!view || view.matchMedia("(prefers-reduced-motion: reduce)").matches || !view.matchMedia("(hover: hover)").matches) return () => {};
  let frame = 0, current: HTMLElement | null = null, x = 0, y = 0;
  const clear = (element: HTMLElement | null) => { element?.style.removeProperty("--light-x"); element?.style.removeProperty("--light-y"); };
  function paint() {
    frame = 0;
    if (!current) return;
    const box = current.getBoundingClientRect();
    current.style.setProperty("--light-x", `${Math.round(x - box.left)}px`);
    current.style.setProperty("--light-y", `${Math.round(y - box.top)}px`);
  }
  function move(event: PointerEvent) {
    if (event.pointerType !== "mouse" && event.pointerType !== "pen") return;
    const target = (event.target as Element | null)?.closest<HTMLElement>(litSurfaces) || null;
    if (target !== current) { clear(current); current = target; }
    x = event.clientX; y = event.clientY;
    if (current && !frame) frame = view!.requestAnimationFrame(paint);
  }
  const leave = () => { clear(current); current = null; };
  root.addEventListener("pointermove", move, { passive: true });
  root.addEventListener("pointerleave", leave);
  return () => { root.removeEventListener("pointermove", move); root.removeEventListener("pointerleave", leave); if (frame) view.cancelAnimationFrame(frame); leave(); };
}
