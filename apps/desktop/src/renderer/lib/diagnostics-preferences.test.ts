import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  reactScanRequested,
  readDiagnosticsPreferences,
  subscribeDiagnosticsPreferences,
  updateDiagnosticsPreferences,
} from "./diagnostics-preferences";

describe("diagnostics preferences", () => {
  beforeEach(() => window.localStorage.clear());

  it("persists overlay and React Scan choices in one bootstrap-safe record", () => {
    updateDiagnosticsPreferences({ overlayVisible: true, reactScanEnabled: false });

    expect(readDiagnosticsPreferences()).toEqual({
      overlayVisible: true,
      reactScanEnabled: false,
    });
    expect(
      JSON.parse(window.localStorage.getItem("palot.desktop.state.diagnostics") ?? "null"),
    ).toEqual({
      version: 1,
      value: { overlayVisible: true, reactScanEnabled: false },
    });
  });

  it("uses the build default until the user makes an explicit React Scan choice", () => {
    expect(reactScanRequested(readDiagnosticsPreferences(), true)).toBe(true);
    updateDiagnosticsPreferences({ reactScanEnabled: false });
    expect(reactScanRequested(readDiagnosticsPreferences(), true)).toBe(false);
  });

  it("notifies runtime subscribers after updates", () => {
    const listener = vi.fn();
    const unsubscribe = subscribeDiagnosticsPreferences(listener);

    updateDiagnosticsPreferences({ overlayVisible: true });
    unsubscribe();
    updateDiagnosticsPreferences({ overlayVisible: false });

    expect(listener).toHaveBeenCalledTimes(1);
  });
});
