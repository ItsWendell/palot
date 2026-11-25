import type { PalotVoiceOverlayApi } from "../../shared/voice-contract";

/**
 * Mirrors the OS reduced-motion setting onto the overlay root, as AppearanceSync does in
 * workspace windows, so `useReducedMotion()` gives the same answer in both.
 */
export function syncOverlayReducedMotion(
  api: Pick<PalotVoiceOverlayApi, "reducedMotion" | "onReducedMotion">,
  root: HTMLElement = document.documentElement,
): () => void {
  let active = true;
  const apply = (reduced: boolean) => {
    if (active) root.dataset.reducedMotion = String(reduced);
  };
  // Subscribe before reading; IPC keeps the reply ordered with the pushes around it.
  const unsubscribe = api.onReducedMotion(apply);
  void api
    .reducedMotion()
    .then(apply)
    .catch(() => undefined);
  return () => {
    active = false;
    unsubscribe();
  };
}
