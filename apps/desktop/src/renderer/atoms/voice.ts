import { persistedAtom } from "./persisted";

export interface VoiceOption {
  id: string;
  label: string;
  description: string;
}

/** GPT-Live voices (https://developers.openai.com/api/docs/guides/live-conversations#voice-options). */
export const VOICE_OPTIONS: readonly VoiceOption[] = [
  { id: "marin", label: "Marin", description: "Default voice" },
  { id: "gleam", label: "Gleam", description: "English, North American" },
  { id: "meridian", label: "Meridian", description: "English, North American" },
  { id: "quartz", label: "Quartz", description: "English, Australian" },
  { id: "ripple", label: "Ripple", description: "English, Australian" },
  { id: "vesper", label: "Vesper", description: "English, British" },
  { id: "willow", label: "Willow", description: "English, Irish" },
  { id: "stone", label: "Stone", description: "English, Irish" },
  { id: "delta", label: "Delta", description: "English, Southern U.S." },
  { id: "cinder", label: "Cinder", description: "English, Southern U.S." },
  { id: "beacon", label: "Beacon", description: "English, Filipino" },
  { id: "nuri", label: "Nuri", description: "German" },
  { id: "juni", label: "Juni", description: "German" },
  { id: "flitz", label: "Flitz", description: "German" },
  { id: "brise", label: "Brise", description: "French" },
  { id: "sillage", label: "Sillage", description: "French" },
  { id: "bossa", label: "Bossa", description: "Portuguese, Brazilian" },
  { id: "tempo", label: "Tempo", description: "Portuguese, Brazilian" },
  { id: "nira", label: "Nira", description: "Hindi" },
  { id: "harema", label: "Harema", description: "Japanese" },
  { id: "shida", label: "Shida", description: "Japanese" },
  { id: "noeul", label: "Noeul", description: "Korean" },
];

/** OpenCode's voice route selects GPT-Live from this model family; it alone supports client delegation. */
export const VOICE_MODEL = "gpt-live-1";

export interface VoicePreferences {
  voice: string;
  /** `deviceId` from enumerateDevices, or null for the system default. */
  inputDeviceID: string | null;
  /** Float the call over other apps while Palot isn't focused. */
  overlay: boolean;
  /** Electron accelerator for the OS-wide toggle, or null when off. */
  globalShortcut: string | null;
  /** Have the assistant open the call with a short greeting. */
  greeting: boolean;
}

export const DEFAULT_VOICE_PREFERENCES: VoicePreferences = {
  voice: "marin",
  inputDeviceID: null,
  overlay: true,
  globalShortcut: null,
  greeting: true,
};

function isVoicePreferences(value: unknown): value is VoicePreferences {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return (
    typeof record.voice === "string" &&
    VOICE_OPTIONS.some((option) => option.id === record.voice) &&
    (record.inputDeviceID === null || typeof record.inputDeviceID === "string") &&
    typeof record.overlay === "boolean" &&
    (record.globalShortcut === null ||
      (typeof record.globalShortcut === "string" && record.globalShortcut.length <= 64)) &&
    typeof record.greeting === "boolean"
  );
}

export const voicePreferencesAtom = persistedAtom<VoicePreferences>({
  key: "voice.preferences",
  initialValue: DEFAULT_VOICE_PREFERENCES,
  validate: isVoicePreferences,
});
