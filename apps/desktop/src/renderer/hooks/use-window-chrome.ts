/** Keep renderer surfaces synchronized with the final native window chrome tier. */

import { useEffect } from "react";
import type { WindowChromeTier } from "../../shared/window-chrome";
import { applySidebarMaterialToRoot } from "../lib/appearance";

function applyWindowChromeTier(tier: WindowChromeTier): void {
  document.documentElement.dataset.chromeTier = tier;
  applySidebarMaterialToRoot();
}

export function useWindowChrome(): void {
  useEffect(() => {
    const api = window.palot;
    if (!api) return;

    const unsubscribe = api.onChromeTierChanged(applyWindowChromeTier);
    const unsubscribeReducedTransparency = api.onReducedTransparencyChanged((reduced) => {
      document.documentElement.dataset.reducedTransparency = String(reduced);
      applySidebarMaterialToRoot();
    });
    void api
      .getChromeTier()
      .then(applyWindowChromeTier)
      .catch(() => undefined);
    return () => {
      unsubscribe();
      unsubscribeReducedTransparency();
    };
  }, []);
}
