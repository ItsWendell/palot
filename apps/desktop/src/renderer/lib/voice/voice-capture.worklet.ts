/**
 * Microphone capture for voice chat. While the call connects, input is held so
 * the user's first words are not lost. On release the held audio is replayed,
 * with leading silence trimmed, slightly faster than real time until it has
 * caught up with live input. Muting outputs silence and drops held audio.
 */

declare abstract class AudioWorkletProcessor {
  readonly port: MessagePort;
  abstract process(inputs: Float32Array[][], outputs: Float32Array[][]): boolean;
}
declare function registerProcessor(name: string, processor: new () => AudioWorkletProcessor): void;
declare const sampleRate: number;

type CaptureMessage = { type: "release" } | { type: "mute"; muted: boolean };

/** Below this RMS a frame counts as silence for leading-silence trimming. */
const SILENCE_RMS = 0.003;
/** Audio kept before the first spoken frame so word onsets aren't clipped. */
const PREROLL_SECONDS = 0.15;
/** Upper bound on held audio while connecting. */
const MAX_HOLD_SECONDS = 20;
/** Playback rate while catching up; mild enough for speech recognition. */
const CATCH_UP_RATE = 1.5;

class VoiceCaptureProcessor extends AudioWorkletProcessor {
  private readonly buffer = new Float32Array(Math.round(sampleRate * MAX_HOLD_SECONDS));
  private readonly preroll = Math.round(sampleRate * PREROLL_SECONDS);
  /** Absolute sample positions; the ring index is position modulo capacity. */
  private written = 0;
  private read = 0;
  private holding = true;
  private muted = false;
  private spoke = false;

  constructor() {
    super();
    this.port.onmessage = (event: MessageEvent<CaptureMessage>) => {
      const message = event.data;
      if (message.type === "mute") {
        this.muted = message.muted;
        if (message.muted) this.read = this.written;
      }
      if (message.type === "release" && this.holding) {
        this.holding = false;
        if (!this.spoke) this.read = this.written;
      }
    };
  }

  process(inputs: Float32Array[][], outputs: Float32Array[][]): boolean {
    const input = inputs[0]?.[0];
    const output = outputs[0]?.[0];
    if (input && !this.muted) this.capture(input);
    if (!output) return true;
    if (this.holding || this.muted) {
      output.fill(0);
      return true;
    }
    const capacity = this.buffer.length;
    const catchingUp = this.written - this.read > output.length * 2;
    const step = catchingUp ? CATCH_UP_RATE : 1;
    for (let index = 0; index < output.length; index += 1) {
      const whole = Math.floor(this.read);
      if (whole >= this.written) {
        output[index] = 0;
        continue;
      }
      const current = this.buffer[whole % capacity]!;
      if (whole + 1 >= this.written) {
        output[index] = current;
        this.read = whole + 1;
        continue;
      }
      const next = this.buffer[(whole + 1) % capacity]!;
      const fraction = this.read - whole;
      output[index] = current * (1 - fraction) + next * fraction;
      this.read += step;
    }
    return true;
  }

  private capture(frame: Float32Array): void {
    const capacity = this.buffer.length;
    for (const sample of frame) {
      this.buffer[this.written % capacity] = sample;
      this.written += 1;
    }
    if (this.written - this.read > capacity) this.read = this.written - capacity;
    if (!this.holding || this.spoke) return;
    let sum = 0;
    for (const sample of frame) sum += sample * sample;
    if (Math.sqrt(sum / frame.length) >= SILENCE_RMS) {
      this.spoke = true;
      return;
    }
    // Until the user speaks, keep only the pre-roll.
    this.read = Math.max(this.read, this.written - this.preroll);
  }
}

registerProcessor("palot-voice-capture", VoiceCaptureProcessor);
