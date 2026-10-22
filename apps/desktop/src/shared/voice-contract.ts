/**
 * Voice chat runs in one workspace window's renderer (the host). Main mirrors the
 * host's state to the floating overlay, keeps the display awake during a call,
 * routes overlay and global-shortcut commands back to the host, and grants
 * microphone access only to trusted workspace windows.
 */

export type VoiceCallPhase = "idle" | "starting" | "active" | "stopping";

export type VoiceActivity = "connecting" | "listening" | "thinking" | "speaking";

export interface VoiceCallSnapshot {
  phase: VoiceCallPhase;
  activity: VoiceActivity;
  micMuted: boolean;
  outputMuted: boolean;
  connectionID: string | null;
  sessionID: string | null;
  /** Title of the OpenCode session the call works in. */
  title: string | null;
  /** Agent progress such as "Running command"; null while nothing is running. */
  status: string | null;
  /** Latest assistant speech, shown as captions while output is muted. */
  caption: string | null;
  error: string | null;
  startedAt: number | null;
}

export const IDLE_VOICE_CALL_SNAPSHOT: VoiceCallSnapshot = {
  phase: "idle",
  activity: "connecting",
  micMuted: false,
  outputMuted: false,
  connectionID: null,
  sessionID: null,
  title: null,
  status: null,
  caption: null,
  error: null,
  startedAt: null,
};

/** Smoothed 0–1 levels used to animate the orb. Hosts publish at most ~15 times per second. */
export interface VoiceAudioLevels {
  input: number;
  output: number;
}

export type VoiceOverlayCommand =
  | { type: "toggle-mic" }
  | { type: "toggle-output" }
  | { type: "end" }
  /** Focus the host window and show the call's session. */
  | { type: "open-session" };

export type VoiceHostCommand =
  | VoiceOverlayCommand
  /** The global shortcut was pressed: start a call in the current task, or end the active one. */
  | { type: "toggle-call" };

export interface VoiceHostPreferences {
  /** Show the floating overlay while the host window is not focused. */
  overlay: boolean;
  /** Electron accelerator for the OS-wide shortcut, or null when disabled. */
  globalShortcut: string | null;
}

export interface VoiceHostPreferencesResult {
  /** False when the OS or another app already owns the requested accelerator. */
  globalShortcutRegistered: boolean;
}

export interface VoiceClaimResult {
  /** False when another window already hosts an active call. */
  granted: boolean;
}

export type VoiceMicrophoneAccess =
  | "granted"
  | "denied"
  | "restricted"
  | "not-determined"
  | "unknown";

export const VOICE_IPC_CHANNELS = {
  /** Renderer → main (invoke): reserve this window as the call host before starting. */
  hostClaim: "palot:voice:host-claim",
  /** Renderer → main (invoke): the host's current snapshot. Idle releases the claim. */
  hostState: "palot:voice:host-state",
  /** Renderer → main (invoke): throttled orb levels. */
  hostLevels: "palot:voice:host-levels",
  /** Renderer → main (invoke): overlay and global shortcut preferences. */
  hostPreferences: "palot:voice:host-preferences",
  /** Renderer → main (invoke): ask the OS for microphone access where it has a prompt (macOS). */
  microphoneAccess: "palot:voice:microphone-access",
  /** Renderer → main (invoke): where the bundled voice coordinator OpenCode plugin lives on disk. */
  coordinatorPlugin: "palot:voice:coordinator-plugin",
  /** Main → host renderer (push): a VoiceHostCommand. */
  hostCommand: "palot:voice:host-command",
  /** Main → overlay renderer (push): VoiceCallSnapshot. */
  overlayState: "palot:voice:overlay-state",
  /** Main → overlay renderer (push): VoiceAudioLevels. */
  overlayLevels: "palot:voice:overlay-levels",
  /** Overlay renderer → main (invoke): a VoiceOverlayCommand. */
  overlayCommand: "palot:voice:overlay-command",
  /** Overlay renderer → main (invoke): the latest snapshot, for first paint. */
  overlayReady: "palot:voice:overlay-ready",
} as const;

/** Exposed on `window.palot.voice` in workspace windows. */
export interface PalotVoiceApi {
  claim(): Promise<VoiceClaimResult>;
  publishState(snapshot: VoiceCallSnapshot): Promise<void>;
  publishLevels(levels: VoiceAudioLevels): Promise<void>;
  configure(preferences: VoiceHostPreferences): Promise<VoiceHostPreferencesResult>;
  requestMicrophoneAccess(): Promise<VoiceMicrophoneAccess>;
  /** Absolute directory of the bundled coordinator plugin, or null when this build lacks it. */
  coordinatorPluginDirectory(): Promise<string | null>;
  onCommand(listener: (command: VoiceHostCommand) => void): () => void;
}

/** Exposed on `window.palotVoiceOverlay` in the overlay window only. */
export interface PalotVoiceOverlayApi {
  readonly platform: "darwin" | "linux" | "win32";
  ready(): Promise<VoiceCallSnapshot>;
  command(command: VoiceOverlayCommand): Promise<void>;
  onState(listener: (snapshot: VoiceCallSnapshot) => void): () => void;
  onLevels(listener: (levels: VoiceAudioLevels) => void): () => void;
}
