import { createRoot, type Root } from "react-dom/client";
import {
  readDiagnosticsPreferences,
  subscribeDiagnosticsPreferences,
} from "./diagnostics-preferences";

export function startDiagnosticsOverlayHost(): () => void {
  let host: HTMLDivElement | null = null;
  let root: Root | null = null;
  let generation = 0;

  const unmount = () => {
    generation += 1;
    root?.unmount();
    root = null;
    host?.remove();
    host = null;
  };

  const sync = () => {
    if (!readDiagnosticsPreferences().overlayVisible) {
      unmount();
      return;
    }
    if (root) return;
    const expectedGeneration = ++generation;
    void import("../components/diagnostics-overlay").then(({ DiagnosticsOverlay }) => {
      if (
        expectedGeneration !== generation ||
        !readDiagnosticsPreferences().overlayVisible ||
        root
      ) {
        return;
      }
      host = document.createElement("div");
      host.id = "palot-diagnostics-root";
      host.className = "pointer-events-none fixed inset-0 z-40";
      document.body.append(host);
      root = createRoot(host);
      root.render(<DiagnosticsOverlay />);
    });
  };

  sync();
  const unsubscribe = subscribeDiagnosticsPreferences(sync);
  return () => {
    unsubscribe();
    unmount();
  };
}
