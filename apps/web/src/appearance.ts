import type { UserPreferences } from "@happy-learners/contracts";

/**
 * ST-160: appearance and accessibility applied to the whole document at once. The root element carries the resolved
 * theme (`data-theme`), contrast, motion and density, and `--text-scale`; theme.css and fluent/tokens.css read them, so
 * every Fluent token follows. With «system», the theme follows prefers-color-scheme and the motion follows
 * prefers-reduced-motion, live. The last choice is kept in this browser so the next visit (and the sign-in page) opens
 * in it before the session answers; the account keeps the real value.
 */
export type Appearance = Pick<UserPreferences, "theme" | "textScale" | "highContrast" | "motion" | "density">;
export const defaultAppearance: Appearance = { theme: "system", textScale: 100, highContrast: false, motion: "system", density: "comfortable" };
const storageKey = "hl-appearance";
let current: Appearance = defaultAppearance;
let listening = false;

const query = (media: string) => typeof matchMedia === "function" ? matchMedia(media) : null;
export const systemDark = () => !!query("(prefers-color-scheme: dark)")?.matches;
export const systemReducedMotion = () => !!query("(prefers-reduced-motion: reduce)")?.matches;
/** Whether the screen moves less now: the person asked for it, or left it to a system that asks for it. */
export const reducedMotion = () => current.motion === "reduce" || systemReducedMotion();

function paint(root: HTMLElement) {
  const dark = current.theme === "dark" || (current.theme === "system" && systemDark());
  root.dataset.theme = dark ? "dark" : "light";
  root.dataset.contrast = current.highContrast ? "high" : "standard";
  root.dataset.motion = reducedMotion() ? "reduce" : "full";
  root.dataset.density = current.density;
  root.style.setProperty("--text-scale", String(Math.min(150, Math.max(100, current.textScale)) / 100));
  root.style.colorScheme = dark ? "dark" : "light";
  document.querySelector('meta[name="color-scheme"]')?.setAttribute("content", dark ? "dark" : "light");
}

export function applyAppearance(appearance: Appearance, root: HTMLElement = document.documentElement) {
  current = { ...defaultAppearance, ...appearance };
  paint(root);
  try { localStorage.setItem(storageKey, JSON.stringify(current)); } catch { /* Private mode: the account still keeps it. */ }
  if (!listening) {
    listening = true;
    // «System» follows the operating system as it changes, without reloading.
    for (const media of ["(prefers-color-scheme: dark)", "(prefers-reduced-motion: reduce)"]) query(media)?.addEventListener("change", () => paint(root));
  }
}
/** Before the first render: the last appearance used in this browser, or the defaults. */
export function restoreAppearance() {
  let saved: Partial<Appearance> = {};
  try { saved = JSON.parse(localStorage.getItem(storageKey) || "{}") as Partial<Appearance>; } catch { /* Ignore a damaged value. */ }
  applyAppearance({ ...defaultAppearance, ...saved });
}
/** The appearance part of the preferences. */
export const appearanceOf = (preferences: UserPreferences | Appearance): Appearance => ({ theme: preferences.theme, textScale: preferences.textScale, highContrast: preferences.highContrast, motion: preferences.motion, density: preferences.density });
