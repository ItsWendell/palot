/**
 * Short notification sounds synthesized with WebAudio, so Palot ships no audio assets.
 * Event qualification mirrors `main/notification-policy.ts`.
 */
import type { DesktopNotificationSettings, PalotEvent } from "../../shared";

export type NotificationSoundEvent = "turnCompleted" | "turnFailed" | "permission" | "question";
export type NotificationSoundID = "chime" | "pop" | "bell" | "ripple";
export type NotificationSoundChoice = NotificationSoundID | "off";
export type NotificationSoundPreferences = Record<NotificationSoundEvent, NotificationSoundChoice>;

export const NOTIFICATION_SOUND_EVENTS: readonly {
  id: NotificationSoundEvent;
  label: string;
  description: string;
}[] = [
  { id: "turnCompleted", label: "Turn completed", description: "A task finished its turn." },
  { id: "turnFailed", label: "Turn failed", description: "A turn stopped with an error." },
  { id: "permission", label: "Permission request", description: "A task needs permission." },
  { id: "question", label: "Question or form", description: "A task needs your answer." },
];

export const NOTIFICATION_SOUND_OPTIONS: readonly { id: NotificationSoundID; label: string }[] = [
  { id: "chime", label: "Chime" },
  { id: "pop", label: "Pop" },
  { id: "bell", label: "Bell" },
  { id: "ripple", label: "Ripple" },
];

export const DEFAULT_NOTIFICATION_SOUND_PREFERENCES: NotificationSoundPreferences = {
  turnCompleted: "off",
  turnFailed: "off",
  permission: "off",
  question: "off",
};

const SOUND_CHOICES = new Set<string>(["off", ...NOTIFICATION_SOUND_OPTIONS.map(({ id }) => id)]);

export function isNotificationSoundPreferences(
  value: unknown,
): value is NotificationSoundPreferences {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return NOTIFICATION_SOUND_EVENTS.every(
    ({ id }) => typeof record[id] === "string" && SOUND_CHOICES.has(record[id]),
  );
}

export function notificationSoundsEnabled(preferences: NotificationSoundPreferences): boolean {
  return NOTIFICATION_SOUND_EVENTS.some(({ id }) => preferences[id] !== "off");
}

export interface NotificationSoundCandidate {
  kind: NotificationSoundEvent;
  sessionID: string;
}

export function notificationSoundCandidate(event: PalotEvent): NotificationSoundCandidate | null {
  switch (event.type) {
    case "session.execution.succeeded":
      return { kind: "turnCompleted", sessionID: event.data.sessionID };
    case "session.execution.failed":
      // Interrupting a turn is the user's own action, not a failure to announce.
      if (event.data.error.type === "MessageAbortedError") return null;
      return { kind: "turnFailed", sessionID: event.data.sessionID };
    case "permission.asked":
      return { kind: "permission", sessionID: event.data.sessionID };
    case "form.created":
      return {
        // OpenCode questions and other forms both wait for an answer.
        kind: "question",
        sessionID: event.data.form.sessionID,
      };
    default:
      return null;
  }
}

/** Minimum gap between sounds so bursts (for example parallel subagents) stay quiet. */
export const NOTIFICATION_SOUND_THROTTLE_MS = 400;
/** Events older than this are history, not news. */
export const NOTIFICATION_SOUND_STALE_MS = 5 * 60_000;
const SEEN_LIMIT = 2_000;

export interface NotificationSoundControllerOptions {
  preferences(): NotificationSoundPreferences;
  /** Desktop notification settings, when loaded. Turn sounds follow `turnCompletion`. */
  desktopSettings(): DesktopNotificationSettings | null;
  focused(): boolean;
  /** Whether this window plays sounds; only one Palot window should. */
  owner(): boolean;
  isChildSession(connectionID: string, sessionID: string): boolean;
  play(sound: NotificationSoundID): void;
  now(): number;
}

/** Plays at most one sound per live event, throttled across events. */
export function createNotificationSoundController(options: NotificationSoundControllerOptions) {
  const seen = new Set<string>();
  let lastPlayedAt = Number.NEGATIVE_INFINITY;

  const claim = (key: string) => {
    if (seen.has(key)) return false;
    seen.add(key);
    if (seen.size > SEEN_LIMIT) seen.delete(seen.values().next().value!);
    return true;
  };

  return {
    handle(connectionID: string, events: readonly PalotEvent[]): void {
      for (const event of events) {
        const candidate = notificationSoundCandidate(event);
        if (!candidate) continue;
        if (!claim(`${connectionID}:${event.id}`)) continue;
        const now = options.now();
        if (now - event.createdAt > NOTIFICATION_SOUND_STALE_MS) continue;
        const sound = options.preferences()[candidate.kind];
        if (sound === "off") continue;
        if (candidate.kind === "turnCompleted" || candidate.kind === "turnFailed") {
          // Subagent turns finish inside their parent's work; only the parent is news.
          if (options.isChildSession(connectionID, candidate.sessionID)) continue;
          if (options.desktopSettings()?.turnCompletion === "unfocused" && options.focused()) {
            continue;
          }
        }
        if (!options.owner()) continue;
        if (now - lastPlayedAt < NOTIFICATION_SOUND_THROTTLE_MS) continue;
        lastPlayedAt = now;
        options.play(sound);
      }
    },
  };
}

// Synthesis -----------------------------------------------------------------------------------

interface Tone {
  frequency: number;
  /** Glide target for pitch-drop sounds. */
  endFrequency?: number;
  type: OscillatorType;
  /** Seconds after the sound starts. */
  start: number;
  duration: number;
  gain: number;
}

const SOUNDS: Record<NotificationSoundID, readonly Tone[]> = {
  chime: [
    { frequency: 880, type: "sine", start: 0, duration: 0.32, gain: 1 },
    { frequency: 1318.5, type: "sine", start: 0.09, duration: 0.42, gain: 0.8 },
  ],
  pop: [{ frequency: 640, endFrequency: 260, type: "sine", start: 0, duration: 0.11, gain: 1 }],
  bell: [
    { frequency: 1046.5, type: "sine", start: 0, duration: 0.9, gain: 1 },
    { frequency: 2093, type: "sine", start: 0, duration: 0.45, gain: 0.22 },
    { frequency: 2637, type: "sine", start: 0, duration: 0.3, gain: 0.1 },
  ],
  ripple: [
    { frequency: 1046.5, type: "triangle", start: 0, duration: 0.14, gain: 0.8 },
    { frequency: 1318.5, type: "triangle", start: 0.06, duration: 0.14, gain: 0.7 },
    { frequency: 1568, type: "triangle", start: 0.12, duration: 0.2, gain: 0.6 },
  ],
};

/** Kept low so sounds stay a soft cue under music or calls. */
const MASTER_VOLUME = 0.12;
const SILENT = 0.0001;
let context: AudioContext | null = null;

function audioContext(): AudioContext | null {
  if (typeof AudioContext === "undefined") return null;
  context ??= new AudioContext();
  if (context.state === "suspended") void context.resume().catch(() => undefined);
  return context;
}

export function playNotificationSound(sound: NotificationSoundID): void {
  const audio = audioContext();
  if (!audio) return;
  try {
    const origin = audio.currentTime + 0.01;
    const master = audio.createGain();
    master.gain.value = MASTER_VOLUME;
    master.connect(audio.destination);
    let end = origin;
    for (const tone of SOUNDS[sound]) {
      const start = origin + tone.start;
      const stop = start + tone.duration;
      const oscillator = audio.createOscillator();
      const envelope = audio.createGain();
      oscillator.type = tone.type;
      oscillator.frequency.setValueAtTime(tone.frequency, start);
      if (tone.endFrequency) {
        oscillator.frequency.exponentialRampToValueAtTime(tone.endFrequency, stop);
      }
      envelope.gain.setValueAtTime(SILENT, start);
      envelope.gain.exponentialRampToValueAtTime(tone.gain, start + 0.01);
      envelope.gain.exponentialRampToValueAtTime(SILENT, stop);
      oscillator.connect(envelope).connect(master);
      oscillator.start(start);
      oscillator.stop(stop + 0.02);
      end = Math.max(end, stop + 0.02);
    }
    setTimeout(() => master.disconnect(), Math.ceil((end - audio.currentTime) * 1000) + 50);
  } catch {
    // Sound is a courtesy; audio device failures must never affect task handling.
  }
}
