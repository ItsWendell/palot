import captureWorkletUrl from "./voice-capture.worklet.ts?worker&url";
import {
  parseVoiceServerEvent,
  type VoiceClientCommand,
  type VoiceServerEvent,
} from "./voice-protocol";

export interface VoiceConnectionOptions {
  /** Exchanges the local SDP offer for the provider's answer (OpenCode's voice session route). */
  createSession(offerSdp: string, signal: AbortSignal): Promise<string>;
  inputDeviceID: string | null;
  onEvent(event: VoiceServerEvent): void;
  /** The media or event transport failed outside a graceful close. */
  onTransportLost(message: string): void;
  signal: AbortSignal;
}

export class VoiceConnectionError extends Error {
  constructor(
    readonly code:
      | "microphone-denied"
      | "microphone-missing"
      | "microphone-busy"
      | "connection"
      | "aborted",
    message: string,
  ) {
    super(message);
    this.name = "VoiceConnectionError";
  }
}

const EVENTS_CHANNEL = "oai-events";
const ICE_GATHERING_TIMEOUT_MS = 5_000;
const GRACEFUL_CLOSE_TIMEOUT_MS = 5_000;

function microphoneConstraints(deviceID: string | null): MediaStreamConstraints {
  return {
    audio: {
      ...(deviceID ? { deviceId: { exact: deviceID } } : {}),
      channelCount: 1,
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true,
    },
    video: false,
  };
}

function microphoneError(error: unknown): VoiceConnectionError {
  const name = error instanceof DOMException ? error.name : "";
  if (name === "NotAllowedError" || name === "SecurityError") {
    return new VoiceConnectionError("microphone-denied", "Microphone access was denied.");
  }
  if (name === "NotFoundError" || name === "OverconstrainedError") {
    return new VoiceConnectionError("microphone-missing", "No microphone is available.");
  }
  if (name === "NotReadableError" || name === "AbortError") {
    return new VoiceConnectionError("microphone-busy", "The microphone is in use by another app.");
  }
  return new VoiceConnectionError("microphone-busy", "The microphone couldn't be opened.");
}

function waitForIceGathering(peer: RTCPeerConnection, signal: AbortSignal): Promise<void> {
  if (peer.iceGatheringState === "complete") return Promise.resolve();
  return new Promise((resolve) => {
    const done = () => {
      clearTimeout(timer);
      peer.removeEventListener("icegatheringstatechange", check);
      signal.removeEventListener("abort", done);
      resolve();
    };
    const check = () => {
      if (peer.iceGatheringState === "complete") done();
    };
    // Gathered candidates are usually enough; don't stall the call on slow interfaces.
    const timer = setTimeout(done, ICE_GATHERING_TIMEOUT_MS);
    peer.addEventListener("icegatheringstatechange", check);
    signal.addEventListener("abort", done, { once: true });
  });
}

function rms(analyser: AnalyserNode, buffer: Float32Array<ArrayBuffer>): number {
  analyser.getFloatTimeDomainData(buffer);
  let sum = 0;
  for (const sample of buffer) sum += sample * sample;
  return Math.sqrt(sum / buffer.length);
}

/** Maps speech RMS (~0.005 quiet to ~0.2 loud) onto 0–1 for animation. */
function level(value: number): number {
  return Math.min(1, Math.max(0, Math.log10(Math.max(value, 1e-4) * 1e4) / 3.3 - 0.15));
}

/**
 * One GPT-Live WebRTC call: microphone capture through the buffering worklet,
 * remote audio playback, the `oai-events` data channel, and level metering.
 */
export class VoiceConnection {
  private closing = false;
  private closedResolver: (() => void) | null = null;
  private readonly inputSamples = new Float32Array(1024);
  private readonly outputSamples = new Float32Array(1024);

  private constructor(
    private readonly peer: RTCPeerConnection,
    private readonly events: RTCDataChannel,
    private microphone: MediaStream,
    private source: MediaStreamAudioSourceNode,
    private readonly audio: AudioContext,
    private readonly capture: AudioWorkletNode,
    private readonly inputAnalyser: AnalyserNode,
    private readonly outputAnalyser: AnalyserNode,
    private readonly player: HTMLAudioElement,
  ) {}

  static async open(options: VoiceConnectionOptions): Promise<VoiceConnection> {
    const { signal } = options;
    let microphone: MediaStream;
    try {
      microphone = await navigator.mediaDevices.getUserMedia(
        microphoneConstraints(options.inputDeviceID),
      );
    } catch (error) {
      if (options.inputDeviceID) {
        // A remembered device can disappear; fall back to the system default once.
        try {
          microphone = await navigator.mediaDevices.getUserMedia(microphoneConstraints(null));
        } catch (fallback) {
          throw microphoneError(fallback);
        }
      } else {
        throw microphoneError(error);
      }
    }

    const cleanup: Array<() => void> = [
      () => microphone.getTracks().forEach((track) => track.stop()),
    ];
    const fail = (error: unknown): never => {
      for (const step of cleanup.reverse()) {
        try {
          step();
        } catch {
          // Best-effort teardown after a failed start.
        }
      }
      if (error instanceof VoiceConnectionError) throw error;
      if (signal.aborted) throw new VoiceConnectionError("aborted", "Voice chat was cancelled.");
      throw new VoiceConnectionError(
        "connection",
        error instanceof Error && error.message ? error.message : "Voice chat couldn't connect.",
      );
    };

    try {
      const audio = new AudioContext({ latencyHint: "interactive" });
      cleanup.push(() => void audio.close());
      await audio.audioWorklet.addModule(captureWorkletUrl);
      const source = audio.createMediaStreamSource(microphone);
      const capture = new AudioWorkletNode(audio, "palot-voice-capture", {
        numberOfInputs: 1,
        numberOfOutputs: 1,
        outputChannelCount: [1],
      });
      const destination = audio.createMediaStreamDestination();
      const inputAnalyser = audio.createAnalyser();
      inputAnalyser.fftSize = 1024;
      source.connect(capture).connect(destination);
      source.connect(inputAnalyser);

      const peer = new RTCPeerConnection();
      cleanup.push(() => peer.close());
      const outbound = destination.stream.getAudioTracks()[0];
      if (!outbound) throw new Error("Microphone audio couldn't be prepared.");
      peer.addTrack(outbound, destination.stream);

      const player = new Audio();
      player.autoplay = true;
      cleanup.push(() => {
        player.pause();
        player.srcObject = null;
      });
      const outputAnalyser = audio.createAnalyser();
      outputAnalyser.fftSize = 1024;
      peer.addEventListener("track", (event) => {
        const stream = event.streams[0] ?? new MediaStream([event.track]);
        player.srcObject = stream;
        void player.play().catch(() => undefined);
        audio.createMediaStreamSource(stream).connect(outputAnalyser);
      });

      const events = peer.createDataChannel(EVENTS_CHANNEL);
      let connection: VoiceConnection | null = null;
      events.addEventListener("message", ({ data }) => {
        const event = parseVoiceServerEvent(data);
        if (!event) return;
        if (event.type === "session.closed") connection?.closedResolver?.();
        options.onEvent(event);
      });
      const lost = (message: string) => {
        if (connection && !connection.closing) options.onTransportLost(message);
      };
      events.addEventListener("close", () => lost("The voice connection closed unexpectedly."));
      peer.addEventListener("connectionstatechange", () => {
        if (peer.connectionState === "failed") lost("The voice connection was lost.");
      });

      const offer = await peer.createOffer();
      await peer.setLocalDescription(offer);
      await waitForIceGathering(peer, signal);
      if (signal.aborted) throw new VoiceConnectionError("aborted", "Voice chat was cancelled.");
      const sdp = peer.localDescription?.sdp;
      if (!sdp) throw new Error("The local voice offer is missing.");
      const answer = await options.createSession(sdp, signal);
      if (signal.aborted) throw new VoiceConnectionError("aborted", "Voice chat was cancelled.");
      await peer.setRemoteDescription({ type: "answer", sdp: answer });

      connection = new VoiceConnection(
        peer,
        events,
        microphone,
        source,
        audio,
        capture,
        inputAnalyser,
        outputAnalyser,
        player,
      );
      return connection;
    } catch (error) {
      return fail(error);
    }
  }

  send(command: VoiceClientCommand): boolean {
    if (this.events.readyState !== "open") return false;
    this.events.send(JSON.stringify(command));
    return true;
  }

  /** Starts sending held and live microphone audio. Call once the session has started. */
  releaseInput(): void {
    this.capture.port.postMessage({ type: "release" });
  }

  setMicrophoneMuted(muted: boolean): void {
    this.capture.port.postMessage({ type: "mute", muted });
    for (const track of this.microphone.getAudioTracks()) track.enabled = !muted;
    this.send({ type: muted ? "session.input_audio.mute" : "session.input_audio.unmute" });
  }

  setOutputMuted(muted: boolean): void {
    this.player.muted = muted;
  }

  levels(): { input: number; output: number } {
    return {
      input: level(rms(this.inputAnalyser, this.inputSamples)),
      output: level(rms(this.outputAnalyser, this.outputSamples)),
    };
  }

  /** Switches the capture device mid-call. */
  async replaceInputDevice(deviceID: string | null): Promise<void> {
    const next = await navigator.mediaDevices.getUserMedia(microphoneConstraints(deviceID));
    const muted = this.microphone.getAudioTracks().some((track) => !track.enabled);
    const source = this.audio.createMediaStreamSource(next);
    this.source.disconnect();
    source.connect(this.capture);
    source.connect(this.inputAnalyser);
    this.microphone.getTracks().forEach((track) => track.stop());
    this.microphone = next;
    this.source = source;
    for (const track of next.getAudioTracks()) track.enabled = !muted;
  }

  /** Ends the call. Graceful closes wait briefly for `session.closed` so final usage is recorded. */
  async close(graceful: boolean): Promise<void> {
    if (this.closing) return;
    this.closing = true;
    if (graceful && this.events.readyState === "open") {
      const closed = new Promise<void>((resolve) => {
        this.closedResolver = resolve;
        setTimeout(resolve, GRACEFUL_CLOSE_TIMEOUT_MS);
      });
      this.send({ type: "session.close" });
      await closed;
    }
    this.microphone.getTracks().forEach((track) => track.stop());
    this.player.pause();
    this.player.srcObject = null;
    this.events.close();
    this.peer.close();
    await this.audio.close().catch(() => undefined);
  }
}
