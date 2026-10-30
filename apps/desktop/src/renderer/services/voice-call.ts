import {
  IDLE_VOICE_CALL_SNAPSHOT,
  type VoiceAudioLevels,
  type VoiceCallSnapshot,
  type VoiceHostCommand,
} from "../../shared";
import { DEFAULT_VOICE_PREFERENCES, VOICE_MODEL, voicePreferencesAtom } from "../atoms/voice";
import { toast } from "../components/ui/toast";
import { readOpenCodeErrorDetail } from "../lib/opencode-error-detail";
import { VoiceConnection, VoiceConnectionError } from "../lib/voice/voice-connection";
import {
  formatVoiceDelegationPrompt,
  voiceGreetingInstruction,
  voiceSessionInstructions,
} from "../lib/voice/voice-prompts";
import type { VoiceServerEvent } from "../lib/voice/voice-protocol";
import { VoiceAgentRelay, type VoiceRelayFrame } from "../lib/voice/voice-relay";
import { playVoiceCue } from "../lib/voice/voice-sounds";
import { VoiceTranscript, type VoiceTranscriptLine } from "../lib/voice/voice-transcript";
import { rendererStore, router } from "../router";
import { openCodeClient } from "./opencode-client";
import { palot } from "./palot";

/** Where a call works: one OpenCode session on one connection. */
export interface VoiceCallTarget {
  connectionID: string;
  sessionID: string;
  title: string | null;
  projectName: string | null;
  /** The session runs the voice coordinator agent, which can start other tasks. */
  coordinator?: boolean;
  /** Extra facts for every delegation, such as the projects a coordinator may use. */
  context?: string;
}

/** Agent registered by the bundled `@palot/opencode-voice-coordinator` plugin. */
export const VOICE_COORDINATOR_AGENT = "voice-coordinator";

export interface CoordinatorProject {
  name: string | null;
  directory: string;
}

export type VoiceCallErrorKind = "needs-key" | "microphone" | "unsupported" | "busy" | "connection";

export interface VoiceCallState {
  snapshot: VoiceCallSnapshot;
  transcript: VoiceTranscriptLine[];
  lastError: { kind: VoiceCallErrorKind; message: string } | null;
}

type Listener = () => void;

/** Waits this long for the user's words to reach the transcript before delegating. */
const DELEGATION_TRANSCRIPT_WAIT_MS = 1_500;
const LEVEL_INTERVAL_MS = 33;
const LEVEL_PUBLISH_INTERVAL_MS = 66;
const SPEAKING_ON = 0.12;
const SPEAKING_OFF = 0.05;
const SPEAKING_HOLD_MS = 300;
const START_TIMEOUT_MS = 30_000;

const CLOSE_REASONS: Record<string, string> = {
  expired: "The voice chat reached its time limit.",
  content: "The voice chat was ended by a safety filter.",
  connection_lost: "The voice connection was lost.",
};

function delay(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        resolve();
      },
      { once: true },
    );
  });
}

function startError(error: unknown): { kind: VoiceCallErrorKind; message: string } {
  if (error instanceof VoiceConnectionError) {
    if (error.code === "microphone-denied") {
      return {
        kind: "microphone",
        message: "Allow microphone access for Palot in your system settings to start a voice chat.",
      };
    }
    if (error.code === "microphone-missing" || error.code === "microphone-busy") {
      return { kind: "microphone", message: error.message };
    }
  }
  const detail = readOpenCodeErrorDetail(error);
  if (
    detail?.tag === "ServiceUnavailableError" &&
    (detail.service === "openai" || /api key/i.test(detail.message))
  ) {
    return { kind: "needs-key", message: detail.message };
  }
  if (detail?.tag === "RouteNotFoundError" || detail?.tag === "NotFoundError") {
    return {
      kind: "unsupported",
      message: "This OpenCode server doesn't support voice. Update it to 2.0.32 or later.",
    };
  }
  if (detail) return { kind: "connection", message: detail.message };
  return {
    kind: "connection",
    message:
      error instanceof Error && error.message ? error.message : "Voice chat couldn't connect.",
  };
}

function reportStartError(error: { kind: VoiceCallErrorKind; message: string }): void {
  playVoiceCue("error");
  if (error.kind === "needs-key") {
    toast.add({
      type: "error",
      title: "Voice chat needs an OpenAI API key",
      description:
        "Add an OpenAI API key in Settings → Providers. ChatGPT sign-in can't start voice sessions.",
      actionProps: {
        children: "Open Providers",
        onClick: () => void router.navigate({ to: "/settings/providers" }),
      },
    });
    return;
  }
  toast.add({ type: "error", title: "Voice chat couldn't start", description: error.message });
}

/** Whether OpenCode has loaded the coordinator plugin for this location. */
export async function coordinatorAvailable(
  connectionID: string,
  directory: string,
): Promise<boolean> {
  try {
    await openCodeClient(connectionID).agent.get({
      agentID: VOICE_COORDINATOR_AGENT,
      location: { directory },
    });
    return true;
  } catch {
    return false;
  }
}

class VoiceCallController {
  private state: VoiceCallState = {
    snapshot: IDLE_VOICE_CALL_SNAPSHOT,
    transcript: [],
    lastError: null,
  };
  private levels: VoiceAudioLevels = { input: 0, output: 0 };
  private readonly listeners = new Set<Listener>();
  private readonly levelListeners = new Set<Listener>();
  private connection: VoiceConnection | null = null;
  private abort: AbortController | null = null;
  private target: VoiceCallTarget | null = null;
  private launchTarget: VoiceCallTarget | null = null;
  private transcript = new VoiceTranscript();
  private relay = new VoiceAgentRelay();
  private delegations = 0;
  private busy = false;
  private levelTimer: ReturnType<typeof setInterval> | undefined;
  private lastLevelPublish = 0;
  private speakingUntil = 0;
  private hostUnsubscribe: (() => void) | null = null;

  // Store -------------------------------------------------------------------------------

  readonly subscribe = (listener: Listener) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  readonly getState = () => this.state;

  readonly subscribeLevels = (listener: Listener) => {
    this.levelListeners.add(listener);
    return () => this.levelListeners.delete(listener);
  };

  readonly getLevels = () => this.levels;

  /** Read through a method so narrowing doesn't outlive an await. */
  private phase(): VoiceCallSnapshot["phase"] {
    return this.state.snapshot.phase;
  }

  private update(patch: Partial<VoiceCallSnapshot>, extra: Partial<VoiceCallState> = {}): void {
    const snapshot = { ...this.state.snapshot, ...patch };
    const changed = (Object.keys(patch) as (keyof VoiceCallSnapshot)[]).some(
      (key) => this.state.snapshot[key] !== snapshot[key],
    );
    if (!changed && Object.keys(extra).length === 0) return;
    this.state = { ...this.state, ...extra, snapshot };
    for (const listener of this.listeners) listener();
    if (changed) void window.palot?.voice?.publishState(snapshot).catch(() => undefined);
  }

  // Host wiring -------------------------------------------------------------------------

  /** Connects main-process commands (overlay buttons, global shortcut) to this window. */
  attachHost(): () => void {
    this.hostUnsubscribe?.();
    const unsubscribe = window.palot?.voice?.onCommand((command) =>
      this.handleHostCommand(command),
    );
    this.hostUnsubscribe = unsubscribe ?? null;
    return () => {
      unsubscribe?.();
      if (this.hostUnsubscribe === unsubscribe) this.hostUnsubscribe = null;
    };
  }

  /** The session the user is looking at; the global shortcut starts calls here. */
  setLaunchTarget(target: VoiceCallTarget | null): void {
    this.launchTarget = target;
  }

  handleHostCommand(command: VoiceHostCommand): void {
    switch (command.type) {
      case "toggle-mic":
        this.toggleMicrophone();
        return;
      case "toggle-output":
        this.toggleOutput();
        return;
      case "end":
        void this.end();
        return;
      case "open-session":
        this.openSession();
        return;
      case "toggle-call":
        if (this.state.snapshot.phase !== "idle") void this.end();
        else if (this.launchTarget) void this.start(this.launchTarget);
        else toast.add({ type: "warning", title: "Open a task to start a voice chat" });
        return;
    }
  }

  /**
   * Creates a session for the voice coordinator agent in `directory`, opens it and
   * starts a call there. The coordinator can create and steer other tasks.
   */
  async startCoordinatorChat(input: {
    connectionID: string;
    directory: string;
    projectName: string | null;
    projects: readonly CoordinatorProject[];
  }): Promise<void> {
    if (this.state.snapshot.phase !== "idle") return;
    if (!(await coordinatorAvailable(input.connectionID, input.directory))) {
      toast.add({
        type: "warning",
        title: "Set up the voice coordinator first",
        description:
          "Add Palot's coordinator plugin to OpenCode to start voice chats that manage tasks.",
        actionProps: {
          children: "Open Voice settings",
          onClick: () => void router.navigate({ to: "/settings/voice" }),
        },
      });
      return;
    }
    let sessionID: string;
    try {
      const created = await openCodeClient(input.connectionID).session.create({
        title: "Voice chat",
        agent: VOICE_COORDINATOR_AGENT,
        location: { directory: input.directory },
      });
      sessionID = created.id;
    } catch (error) {
      const detail = readOpenCodeErrorDetail(error);
      reportStartError({
        kind: "connection",
        message:
          detail?.message ??
          (error instanceof Error ? error.message : "The voice chat task couldn't be created."),
      });
      return;
    }
    await router.navigate({ to: "/sessions/$sessionID", params: { sessionID } });
    const projects = input.projects
      .slice(0, 12)
      .map((project) =>
        project.name ? `${project.name} (${project.directory})` : project.directory,
      );
    await this.start({
      connectionID: input.connectionID,
      sessionID,
      title: "Voice chat",
      projectName: input.projectName,
      coordinator: true,
      ...(projects.length ? { context: `Known projects: ${projects.join("; ")}` } : {}),
    });
  }

  openSession(): void {
    const target = this.target;
    if (!target) return;
    void router.navigate({ to: "/sessions/$sessionID", params: { sessionID: target.sessionID } });
  }

  // Call lifecycle ----------------------------------------------------------------------

  async start(target: VoiceCallTarget): Promise<void> {
    if (this.state.snapshot.phase !== "idle") return;
    const preferences = rendererStore.get(voicePreferencesAtom) ?? DEFAULT_VOICE_PREFERENCES;
    const claim = await window.palot?.voice?.claim().catch(() => ({ granted: true }));
    if (claim && !claim.granted) {
      reportStartError({
        kind: "busy",
        message: "Voice chat is already active in another window.",
      });
      return;
    }

    this.target = target;
    this.transcript = new VoiceTranscript();
    this.relay = new VoiceAgentRelay();
    this.delegations = 0;
    this.busy = false;
    this.speakingUntil = 0;
    const abort = new AbortController();
    this.abort = abort;
    const timeout = setTimeout(() => abort.abort(), START_TIMEOUT_MS);
    this.update(
      {
        ...IDLE_VOICE_CALL_SNAPSHOT,
        phase: "starting",
        activity: "connecting",
        connectionID: target.connectionID,
        sessionID: target.sessionID,
        title: target.title,
      },
      { transcript: [], lastError: null },
    );
    this.startLevelLoop();

    try {
      const access = await window.palot?.voice
        ?.requestMicrophoneAccess()
        .catch(() => "unknown" as const);
      if (access === "denied" || access === "restricted") {
        throw new VoiceConnectionError("microphone-denied", "Microphone access was denied.");
      }
      const instructions = voiceSessionInstructions({
        sessionTitle: target.title,
        projectName: target.projectName,
        coordinator: Boolean(target.coordinator),
      });
      const connection = await VoiceConnection.open({
        signal: abort.signal,
        inputDeviceID: preferences.inputDeviceID,
        onEvent: (event) => this.handleEvent(event),
        onTransportLost: (message) => void this.finish(message),
        createSession: async (sdp, signal) => {
          const result = await openCodeClient(target.connectionID).experimental.voice.session(
            {
              model: VOICE_MODEL,
              session: {
                instructions,
                delegation: { type: "client" },
                audio: { output: { voice: preferences.voice } },
                ...(preferences.greeting
                  ? {
                      input: [
                        {
                          type: "message",
                          role: "developer",
                          content: [
                            { type: "input_text", text: voiceGreetingInstruction(target.title) },
                          ],
                        },
                      ],
                    }
                  : {}),
              },
              transport: { type: "webrtc", sdp },
            },
            { signal },
          );
          if (result.transport.type !== "webrtc")
            throw new Error("The voice service returned an unexpected transport.");
          return result.transport.sdp;
        },
      });
      if (abort.signal.aborted) {
        await connection.close(false);
        return;
      }
      this.connection = connection;
    } catch (error) {
      clearTimeout(timeout);
      if (this.abort !== abort) return;
      const userCancelled =
        error instanceof VoiceConnectionError &&
        error.code === "aborted" &&
        this.phase() === "stopping";
      this.reset();
      if (userCancelled) return;
      const failure =
        abort.signal.aborted && !(error instanceof VoiceConnectionError && error.code !== "aborted")
          ? { kind: "connection" as const, message: "Voice chat took too long to connect." }
          : startError(error);
      this.update({}, { lastError: failure });
      reportStartError(failure);
      return;
    } finally {
      clearTimeout(timeout);
    }
  }

  /** Ends the call gracefully. Safe to call in any phase. */
  async end(): Promise<void> {
    const phase = this.state.snapshot.phase;
    if (phase === "idle" || phase === "stopping") return;
    if (phase === "starting" && !this.connection) {
      this.update({ phase: "stopping" });
      this.abort?.abort();
      return;
    }
    this.update({ phase: "stopping" });
    await this.finish(null);
  }

  private async finish(message: string | null): Promise<void> {
    const connection = this.connection;
    const wasActive = this.state.snapshot.phase === "active" || this.phase() === "stopping";
    this.connection = null;
    if (connection) await connection.close(message === null).catch(() => undefined);
    if (this.state.snapshot.phase === "idle") return;
    this.reset();
    if (wasActive) playVoiceCue("end");
    if (message) {
      playVoiceCue("error");
      toast.add({ type: "error", title: "Voice chat ended", description: message });
    }
  }

  private reset(): void {
    this.abort = null;
    this.target = null;
    this.levels = { input: 0, output: 0 };
    for (const listener of this.levelListeners) listener();
    this.update(IDLE_VOICE_CALL_SNAPSHOT);
  }

  toggleMicrophone(): void {
    const connection = this.connection;
    if (!connection) return;
    const muted = !this.state.snapshot.micMuted;
    connection.setMicrophoneMuted(muted);
    playVoiceCue(muted ? "mute" : "unmute");
    this.update({ micMuted: muted });
  }

  toggleOutput(): void {
    const connection = this.connection;
    if (!connection) return;
    const muted = !this.state.snapshot.outputMuted;
    connection.setOutputMuted(muted);
    this.update({
      outputMuted: muted,
      caption: muted ? this.transcript.latest("assistant") : null,
    });
  }

  async selectInputDevice(deviceID: string | null): Promise<void> {
    await this.connection?.replaceInputDevice(deviceID).catch((error: unknown) => {
      toast.add({
        type: "error",
        title: "Couldn't switch microphone",
        description: error instanceof Error ? error.message : undefined,
      });
    });
  }

  // Events ------------------------------------------------------------------------------

  private handleEvent(event: VoiceServerEvent): void {
    switch (event.type) {
      case "session.started":
        this.connection?.releaseInput();
        playVoiceCue("start");
        this.update({ phase: "active", activity: "listening", startedAt: Date.now() });
        return;
      case "transcript":
        this.transcript.add({
          speaker: event.speaker,
          text: event.delta,
          startMs: event.startMs,
          endMs: event.endMs,
        });
        this.update(
          event.speaker === "assistant" && this.state.snapshot.outputMuted
            ? { caption: this.transcript.latest("assistant") }
            : {},
          { transcript: this.transcript.lines() },
        );
        return;
      case "delegation":
        void this.delegate(event.delegationID);
        return;
      case "session.closed": {
        const message =
          event.reason && event.reason !== "close_requested" && event.reason !== "remote_hangup"
            ? (CLOSE_REASONS[event.reason] ?? "The voice chat ended.")
            : null;
        void this.finish(message);
        return;
      }
      case "input-muted":
        this.update({ micMuted: event.muted });
        return;
      case "usage":
        return;
      case "error":
        // Rejected commands leave the session running; surface them without ending the call.
        console.warn("Voice session error", event.code ?? "", event.message);
        return;
    }
  }

  private async delegate(delegationID: string): Promise<void> {
    const target = this.target;
    const connection = this.connection;
    if (!target || !connection) return;
    const signal = this.abort?.signal;
    const deadline = Date.now() + DELEGATION_TRANSCRIPT_WAIT_MS;
    // Transcript deltas can trail the delegation event; give them a moment.
    while (!this.transcript.hasPendingUserSpeech() && Date.now() < deadline && !signal?.aborted) {
      await delay(100, signal);
    }
    await delay(250, signal);
    if (this.connection !== connection) return;
    const request = this.transcript.takeDelegationWindow();
    if (!request.instruction) {
      connection.send({
        type: "session.thinking.append",
        delegation_id: delegationID,
        content: "No transcript of this request was captured. Ask the user to repeat it.",
      });
      return;
    }
    const text = formatVoiceDelegationPrompt({
      window: request,
      continued: this.delegations > 0,
      context:
        [
          [
            target.title ? `Session "${target.title}"` : null,
            target.projectName ? `in project "${target.projectName}"` : null,
          ]
            .filter(Boolean)
            .join(" "),
          target.context ?? "",
        ]
          .filter(Boolean)
          .join(". ") || undefined,
    });
    this.delegations += 1;
    this.relay.delegated(delegationID);
    try {
      await palot.sendComposerPrompt({
        sessionID: target.sessionID,
        text,
        ...(this.busy ? { delivery: "steer" as const } : {}),
      });
    } catch (error) {
      const detail = readOpenCodeErrorDetail(error);
      connection.send({
        type: "session.commentary.append",
        delegation_id: delegationID,
        content: `The request couldn't be sent to the task: ${detail?.message ?? (error instanceof Error ? error.message : "unknown error")}.`,
      });
    }
  }

  /** Called by the session observer whenever the call's session changes. */
  observe(target: { connectionID: string; sessionID: string }, frame: VoiceRelayFrame): void {
    const connection = this.connection;
    if (!connection || !this.target) return;
    if (
      target.connectionID !== this.target.connectionID ||
      target.sessionID !== this.target.sessionID
    )
      return;
    this.busy = frame.busy;
    const { outputs, status } = this.relay.update(frame);
    for (const output of outputs) {
      connection.send({
        type:
          output.kind === "commentary" ? "session.commentary.append" : "session.thinking.append",
        delegation_id: output.delegationID,
        content: output.content,
      });
    }
    this.update({ status });
  }

  /** Keeps the call's title current when the session is renamed. */
  retitle(title: string | null): void {
    if (this.target) this.target = { ...this.target, title };
    this.update({ title });
  }

  // Levels ------------------------------------------------------------------------------

  private startLevelLoop(): void {
    clearInterval(this.levelTimer);
    // A timer, not requestAnimationFrame: the overlay needs levels while this window is hidden.
    this.levelTimer = setInterval(() => {
      const phase = this.state.snapshot.phase;
      if (phase === "idle") {
        clearInterval(this.levelTimer);
        return;
      }
      const now = performance.now();
      const raw = this.connection?.levels() ?? { input: 0, output: 0 };
      this.levels = {
        input: this.levels.input * 0.6 + raw.input * 0.4,
        output: this.levels.output * 0.6 + raw.output * 0.4,
      };
      for (const listener of this.levelListeners) listener();

      if (phase === "active") {
        const holding = now < this.speakingUntil;
        if (raw.output >= SPEAKING_ON || (holding && raw.output >= SPEAKING_OFF)) {
          this.speakingUntil = now + SPEAKING_HOLD_MS;
        }
        const activity =
          now < this.speakingUntil
            ? "speaking"
            : this.relay.awaiting && this.busy
              ? "thinking"
              : "listening";
        if (activity !== this.state.snapshot.activity) this.update({ activity });
      }
      if (now - this.lastLevelPublish >= LEVEL_PUBLISH_INTERVAL_MS) {
        this.lastLevelPublish = now;
        void window.palot?.voice?.publishLevels(this.levels).catch(() => undefined);
      }
    }, LEVEL_INTERVAL_MS);
  }
}

export const voiceCall = new VoiceCallController();
