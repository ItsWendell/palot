export type StartupWindowPresentation = "hidden" | "inactive" | "focused";

export function startupWindowPresentation(env: NodeJS.ProcessEnv): StartupWindowPresentation {
  if (env.PALOT_START_HIDDEN === "1" || env.PALOT_E2E_HIDDEN === "1") return "hidden";
  if (env.PALOT_START_INACTIVE === "1" || env.PALOT_E2E_INACTIVE === "1") return "inactive";
  return "focused";
}

/** How long after a load finishes a window still waiting for its first paint is shown anyway. */
export const FIRST_PAINT_FALLBACK_MS = 1_000;

interface PresentableWindow {
  once(event: "ready-to-show", listener: () => void): unknown;
  isDestroyed(): boolean;
  webContents: { once(event: "did-finish-load", listener: () => void): unknown };
}

/**
 * Runs `present` once, on the window's first paint (`ready-to-show`) or, if that never comes,
 * shortly after its page finishes loading. A reload before the first paint swallows
 * `ready-to-show`, and on Wayland a window that was never shown gets no frames to paint, so
 * waiting for the paint alone can keep it hidden for good.
 */
export function presentWhenReady(window: PresentableWindow, present: () => void): void {
  let presented = false;
  const once = () => {
    if (presented || window.isDestroyed()) return;
    presented = true;
    present();
  };
  window.once("ready-to-show", once);
  window.webContents.once("did-finish-load", () => {
    setTimeout(once, FIRST_PAINT_FALLBACK_MS);
  });
}
