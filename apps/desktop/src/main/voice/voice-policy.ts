/** Pure voice-call host rules and IPC schemas, kept free of Electron for testing. */

import * as v from "valibot";
import type {
  VoiceAudioLevels,
  VoiceCallPhase,
  VoiceCallSnapshot,
  VoiceHostPreferences,
  VoiceOverlayCommand,
} from "../../shared/voice-contract";

export const VOICE_TEXT_LIMITS = {
  identifier: 512,
  title: 500,
  status: 500,
  caption: 2_000,
  error: 1_000,
  /** Payloads above this are rejected outright rather than truncated. */
  payload: 100_000,
  accelerator: 128,
} as const;

/** Bounded text: reject absurd payloads, then keep the part the overlay can show. */
function text(limit: number, keep: "start" | "end" = "start") {
  return v.nullable(
    v.pipe(
      v.string(),
      v.maxLength(VOICE_TEXT_LIMITS.payload),
      v.transform((value) =>
        value.length <= limit
          ? value
          : keep === "start"
            ? value.slice(0, limit)
            : value.slice(value.length - limit),
      ),
    ),
  );
}

const identifier = v.nullable(
  v.pipe(v.string(), v.minLength(1), v.maxLength(VOICE_TEXT_LIMITS.identifier)),
);

export const voiceSnapshotSchema = v.strictObject({
  phase: v.picklist(["idle", "starting", "active", "stopping"]),
  activity: v.picklist(["connecting", "listening", "thinking", "speaking"]),
  micMuted: v.boolean(),
  outputMuted: v.boolean(),
  connectionID: identifier,
  sessionID: identifier,
  title: text(VOICE_TEXT_LIMITS.title),
  status: text(VOICE_TEXT_LIMITS.status),
  // Captions trail the latest speech, so keep the end.
  caption: text(VOICE_TEXT_LIMITS.caption, "end"),
  error: text(VOICE_TEXT_LIMITS.error),
  startedAt: v.nullable(v.pipe(v.number(), v.finite(), v.minValue(0))),
});

const level = v.pipe(
  v.number(),
  v.finite(),
  v.transform((value) => Math.min(1, Math.max(0, value))),
);

export const voiceLevelsSchema = v.strictObject({ input: level, output: level });

export const voicePreferencesSchema = v.strictObject({
  overlay: v.boolean(),
  globalShortcut: v.nullable(
    v.pipe(
      v.string(),
      v.trim(),
      v.minLength(1),
      v.maxLength(VOICE_TEXT_LIMITS.accelerator),
      // Electron accelerators are printable ASCII key names joined by "+", without spaces.
      v.regex(/^[\x21-\x7e]+$/),
    ),
  ),
});

export const voiceOverlayCommandSchema = v.variant(
  "type",
  (["toggle-mic", "toggle-output", "end", "open-session"] as const).map((type) =>
    v.strictObject({ type: v.literal(type) }),
  ),
);

export function parseVoiceSnapshot(input: unknown): VoiceCallSnapshot {
  return v.parse(voiceSnapshotSchema, input);
}

export function parseVoiceLevels(input: unknown): VoiceAudioLevels {
  return v.parse(voiceLevelsSchema, input);
}

export function parseVoicePreferences(input: unknown): VoiceHostPreferences {
  return v.parse(voicePreferencesSchema, input);
}

export function parseVoiceOverlayCommand(input: unknown): VoiceOverlayCommand {
  return v.parse(voiceOverlayCommandSchema, input);
}

export function isCallLive(phase: VoiceCallPhase): boolean {
  return phase !== "idle";
}

/** The display stays awake while a call connects or runs, not while it winds down. */
export function keepsDisplayAwake(phase: VoiceCallPhase): boolean {
  return phase === "starting" || phase === "active";
}

export interface VoiceHostClaimState {
  /** The current host is the window asking. */
  sender: boolean;
  alive: boolean;
  phase: VoiceCallPhase;
}

/** One host at a time: a live window with a running call keeps the claim. */
export function claimGranted(current: VoiceHostClaimState | null): boolean {
  return !current || current.sender || !current.alive || !isCallLive(current.phase);
}

export type VoiceStateDecision = "ignore" | "update" | "release";

/** Only the host publishes; its idle snapshot ends the claim. */
export function decideHostState(fromHost: boolean, phase: VoiceCallPhase): VoiceStateDecision {
  if (!fromHost) return "ignore";
  return isCallLive(phase) ? "update" : "release";
}

export function shouldShowOverlay(input: {
  enabled: boolean;
  dismissed: boolean;
  phase: VoiceCallPhase;
  /** Focused, visible and not minimized. */
  hostFocused: boolean;
}): boolean {
  return input.enabled && !input.dismissed && isCallLive(input.phase) && !input.hostFocused;
}

export interface Rectangle {
  x: number;
  y: number;
  width: number;
  height: number;
}

export const VOICE_OVERLAY_SIZE = { width: 300, height: 84 } as const;
const OVERLAY_TOP_INSET = 12;

function contains(outer: Rectangle, inner: Rectangle): boolean {
  return (
    inner.x >= outer.x &&
    inner.y >= outer.y &&
    inner.x + inner.width <= outer.x + outer.width &&
    inner.y + inner.height <= outer.y + outer.height
  );
}

/**
 * A remembered (user-dragged) position wins while it still fits a display; otherwise the
 * overlay sits at the top centre of the host display's work area.
 */
export function overlayPosition(input: {
  hostWorkArea: Rectangle;
  workAreas: readonly Rectangle[];
  remembered: { x: number; y: number } | null;
  size?: { width: number; height: number };
}): { x: number; y: number } {
  const size = input.size ?? VOICE_OVERLAY_SIZE;
  if (input.remembered) {
    const bounds = { ...input.remembered, ...size };
    if (input.workAreas.some((area) => contains(area, bounds))) return input.remembered;
  }
  const area = input.hostWorkArea;
  return {
    x: Math.round(area.x + (area.width - size.width) / 2),
    y: Math.round(area.y + OVERLAY_TOP_INSET),
  };
}
