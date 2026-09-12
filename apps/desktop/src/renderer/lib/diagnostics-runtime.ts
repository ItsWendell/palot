import type { DiagnosticsSnapshot } from "./diagnostics-controller";
import {
  reactScanRequested,
  readDiagnosticsPreferences,
  subscribeDiagnosticsPreferences,
} from "./diagnostics-preferences";

export interface DiagnosticsStatusSnapshot {
  phase: DiagnosticsSnapshot["phase"];
  collector: Pick<DiagnosticsSnapshot["collector"], "sampleCount">;
  preferences: DiagnosticsSnapshot["preferences"];
}

let readLoadedSnapshot: (() => DiagnosticsSnapshot) | null = null;

export function registerDiagnosticsSnapshot(readSnapshot: () => DiagnosticsSnapshot): void {
  readLoadedSnapshot = readSnapshot;
}

export function readDiagnosticsStatus(): DiagnosticsStatusSnapshot {
  if (readLoadedSnapshot) return readLoadedSnapshot();
  const preferences = readDiagnosticsPreferences();
  const bootstrap =
    typeof window !== "undefined" && window.palotDiagnosticsBoot
      ? window.palotDiagnosticsBoot
      : {
          reactScanRequested: reactScanRequested(preferences),
          reactScanActive: false,
          reactScanStatus: "off" as const,
        };
  return {
    phase: "idle",
    collector: { sampleCount: 0 },
    preferences: {
      overlayVisible: preferences.overlayVisible,
      reactScanRequested: reactScanRequested(preferences),
      reactScanActive: bootstrap.reactScanActive,
      reactScanStatus: bootstrap.reactScanStatus,
    },
  };
}

export function startOptionalDiagnosticsOverlayHost(): () => void {
  let disposed = false;
  let loading = false;
  let stopHost: (() => void) | null = null;

  const sync = () => {
    if (disposed || loading || stopHost || !readDiagnosticsPreferences().overlayVisible) return;
    loading = true;
    void import("./diagnostics-overlay-host").then(
      ({ startDiagnosticsOverlayHost }) => {
        loading = false;
        if (disposed) return;
        stopHost = startDiagnosticsOverlayHost();
      },
      () => {
        loading = false;
      },
    );
  };

  const unsubscribe = subscribeDiagnosticsPreferences(sync);
  sync();
  return () => {
    disposed = true;
    unsubscribe();
    stopHost?.();
    stopHost = null;
  };
}
