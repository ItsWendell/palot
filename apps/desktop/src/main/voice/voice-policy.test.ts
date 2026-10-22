import { describe, expect, it } from "vitest";
import { IDLE_VOICE_CALL_SNAPSHOT } from "../../shared/voice-contract";
import {
  claimGranted,
  decideHostState,
  keepsDisplayAwake,
  overlayPosition,
  parseVoiceLevels,
  parseVoiceOverlayCommand,
  parseVoicePreferences,
  parseVoiceSnapshot,
  shouldShowOverlay,
} from "./voice-policy";

describe("voice host claim", () => {
  it("keeps the claim with a live window that is running a call", () => {
    expect(claimGranted({ sender: false, alive: true, phase: "active" })).toBe(false);
    expect(claimGranted({ sender: false, alive: true, phase: "starting" })).toBe(false);
    expect(claimGranted({ sender: false, alive: true, phase: "stopping" })).toBe(false);
  });

  it("grants the claim when free, idle, dead, or already held by the sender", () => {
    expect(claimGranted(null)).toBe(true);
    expect(claimGranted({ sender: false, alive: true, phase: "idle" })).toBe(true);
    expect(claimGranted({ sender: false, alive: false, phase: "active" })).toBe(true);
    expect(claimGranted({ sender: true, alive: true, phase: "active" })).toBe(true);
  });

  it("ignores other windows and releases on the host's idle snapshot", () => {
    expect(decideHostState(false, "active")).toBe("ignore");
    expect(decideHostState(false, "idle")).toBe("ignore");
    expect(decideHostState(true, "active")).toBe("update");
    expect(decideHostState(true, "stopping")).toBe("update");
    expect(decideHostState(true, "idle")).toBe("release");
  });

  it("keeps the display awake only while a call connects or runs", () => {
    expect(keepsDisplayAwake("starting")).toBe(true);
    expect(keepsDisplayAwake("active")).toBe(true);
    expect(keepsDisplayAwake("stopping")).toBe(false);
    expect(keepsDisplayAwake("idle")).toBe(false);
  });
});

describe("voice overlay visibility", () => {
  const live = { enabled: true, dismissed: false, phase: "active" as const, hostFocused: false };

  it("shows a live call while the host window is not focused", () => {
    expect(shouldShowOverlay(live)).toBe(true);
    expect(shouldShowOverlay({ ...live, phase: "starting" })).toBe(true);
    expect(shouldShowOverlay({ ...live, phase: "stopping" })).toBe(true);
  });

  it("hides when the host is focused, the call is idle, or the overlay is off or dismissed", () => {
    expect(shouldShowOverlay({ ...live, hostFocused: true })).toBe(false);
    expect(shouldShowOverlay({ ...live, phase: "idle" })).toBe(false);
    expect(shouldShowOverlay({ ...live, enabled: false })).toBe(false);
    expect(shouldShowOverlay({ ...live, dismissed: true })).toBe(false);
  });

  it("centres on the host display unless a dragged position still fits a display", () => {
    const primary = { x: 0, y: 25, width: 1_440, height: 875 };
    const secondary = { x: 1_440, y: 0, width: 1_920, height: 1_080 };
    const workAreas = [primary, secondary];
    expect(overlayPosition({ hostWorkArea: secondary, workAreas, remembered: null })).toEqual({
      x: 1_440 + 810,
      y: 12,
    });
    expect(
      overlayPosition({ hostWorkArea: primary, workAreas, remembered: { x: 2_000, y: 900 } }),
    ).toEqual({ x: 2_000, y: 900 });
    // The display it was dragged to is gone.
    expect(
      overlayPosition({
        hostWorkArea: primary,
        workAreas: [primary],
        remembered: { x: 2_000, y: 900 },
      }),
    ).toEqual({ x: 570, y: 37 });
  });
});

describe("voice IPC validation", () => {
  const snapshot = {
    ...IDLE_VOICE_CALL_SNAPSHOT,
    phase: "active",
    activity: "speaking",
    connectionID: "local",
    sessionID: "ses_1",
    title: "Fix the build",
    startedAt: 1_700_000_000_000,
  };

  it("accepts a host snapshot and trims oversized captions to their latest speech", () => {
    expect(parseVoiceSnapshot(snapshot)).toEqual(snapshot);
    const caption = `${"a".repeat(5_000)}latest words`;
    const parsed = parseVoiceSnapshot({ ...snapshot, caption });
    expect(parsed.caption).toHaveLength(2_000);
    expect(parsed.caption?.endsWith("latest words")).toBe(true);
  });

  it("rejects malformed or overreaching snapshots", () => {
    expect(() => parseVoiceSnapshot({ ...snapshot, phase: "ringing" })).toThrow();
    expect(() => parseVoiceSnapshot({ ...snapshot, extra: true })).toThrow();
    expect(() => parseVoiceSnapshot({ ...snapshot, caption: "x".repeat(200_000) })).toThrow();
    expect(() => parseVoiceSnapshot({ ...snapshot, startedAt: Number.NaN })).toThrow();
  });

  it("clamps levels into 0..1 and rejects non-finite values", () => {
    expect(parseVoiceLevels({ input: -0.5, output: 3 })).toEqual({ input: 0, output: 1 });
    expect(() => parseVoiceLevels({ input: Number.POSITIVE_INFINITY, output: 0 })).toThrow();
  });

  it("accepts overlay commands only, not host-only commands", () => {
    expect(parseVoiceOverlayCommand({ type: "open-session" })).toEqual({ type: "open-session" });
    expect(() => parseVoiceOverlayCommand({ type: "toggle-call" })).toThrow();
    expect(() => parseVoiceOverlayCommand({ type: "end", sessionID: "ses_1" })).toThrow();
  });

  it("bounds the global shortcut accelerator", () => {
    expect(
      parseVoicePreferences({ overlay: true, globalShortcut: " CommandOrControl+Shift+Space " }),
    ).toEqual({ overlay: true, globalShortcut: "CommandOrControl+Shift+Space" });
    expect(parseVoicePreferences({ overlay: false, globalShortcut: null })).toEqual({
      overlay: false,
      globalShortcut: null,
    });
    expect(() =>
      parseVoicePreferences({ overlay: true, globalShortcut: "Ctrl+".repeat(40) }),
    ).toThrow();
    expect(() => parseVoicePreferences({ overlay: true, globalShortcut: "Ctrl + K" })).toThrow();
  });
});
