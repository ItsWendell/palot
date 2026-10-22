import { useSyncExternalStore } from "react";
import { voiceCall, type VoiceCallState } from "../services/voice-call";
import type { VoiceAudioLevels } from "../../shared";

export function useVoiceCall(): VoiceCallState {
  return useSyncExternalStore(voiceCall.subscribe, voiceCall.getState, voiceCall.getState);
}

/** Orb levels update ~30 times a second; read them only in small leaf components. */
export function useVoiceLevels(): VoiceAudioLevels {
  return useSyncExternalStore(voiceCall.subscribeLevels, voiceCall.getLevels, voiceCall.getLevels);
}
