import { playTones, type Tone } from "../notification-sounds";

export type VoiceCue = "start" | "end" | "mute" | "unmute" | "error";

/** Short synthesized cues: rising for start/unmute, falling for end/mute. */
const CUES: Record<VoiceCue, readonly Tone[]> = {
  start: [
    { frequency: 523.25, type: "sine", start: 0, duration: 0.16, gain: 0.8 },
    { frequency: 783.99, type: "sine", start: 0.08, duration: 0.26, gain: 0.9 },
  ],
  end: [
    { frequency: 783.99, type: "sine", start: 0, duration: 0.16, gain: 0.8 },
    { frequency: 523.25, type: "sine", start: 0.08, duration: 0.28, gain: 0.8 },
  ],
  mute: [{ frequency: 660, endFrequency: 440, type: "sine", start: 0, duration: 0.12, gain: 0.7 }],
  unmute: [
    { frequency: 440, endFrequency: 660, type: "sine", start: 0, duration: 0.12, gain: 0.7 },
  ],
  error: [
    { frequency: 330, type: "triangle", start: 0, duration: 0.16, gain: 0.8 },
    { frequency: 247, type: "triangle", start: 0.14, duration: 0.22, gain: 0.8 },
  ],
};

export function playVoiceCue(cue: VoiceCue): void {
  playTones(CUES[cue]);
}
