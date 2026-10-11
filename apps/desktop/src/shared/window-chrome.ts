/** Window chrome modes shared by Electron main, preload, and renderer. */

export type WindowChromeTier = "liquid-glass" | "vibrancy" | "opaque";

export const WINDOW_CHROME_TIERS: readonly WindowChromeTier[] = [
  "liquid-glass",
  "vibrancy",
  "opaque",
];

export function isWindowChromeTier(value: string): value is WindowChromeTier {
  return WINDOW_CHROME_TIERS.includes(value as WindowChromeTier);
}

/** Present when a Linux tiling compositor owns window closing, so Palot omits its own close button. */
export const WINDOW_MANAGER_OWNS_CLOSE_ARGUMENT = "--palot-window-manager-owns-close";
