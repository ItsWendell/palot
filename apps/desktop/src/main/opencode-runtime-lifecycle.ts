import { randomUUID } from "node:crypto";
import { OpenCode, type OpenCodeClient, type OpenCodeEvent } from "@opencode/client";
import { Service, type Endpoint, type StopOptions } from "@opencode/client/service";
import { actionableErrorMessage, errorDiagnostic } from "../shared/diagnostics";
import type {
  OpenCodeConnectInput,
  OpenCodeProfile,
  OpenCodeRuntimePhase,
  OpenCodeRuntimeStatus,
  OpenCodeVersionMismatch,
} from "../shared/opencode-contract";
import { classifyOpenCodeProfile } from "./opencode-connections/capabilities";
import {
  SUPPORTED_OPENCODE_VERSION,
  canContinueOpenCodeVersionMismatch,
  isSupportedOpenCodeVersion,
  shouldReuseOpenCodeService,
  supportedOpenCodeVersionLabel,
} from "./opencode-version";
import { observedOpenCodeFetch, openCodeLog } from "./opencode-observability";
import { discoverSelectedOpenCodeBinary } from "./opencode-runtime-selection";
import { controlOpenCodeLoginService } from "./opencode-login-runtime";
export { discoverBundledOpenCodeBinary } from "./opencode-runtime-selection";
import type { SshConnection } from "./ssh/transport";
import type { SshConnector } from "./ssh/interaction";

const REQUEST_TIMEOUT_MS = 30_000;
const RETAINED_ENDPOINT_TIMEOUT_MS = 5_000;
const LOCAL_SERVICE_UNAVAILABLE =
  "No reachable local OpenCode service was found. Retry the connection, or start OpenCode explicitly. If no CLI is installed, install OpenCode 2 or download an official runtime in connection settings first.";
const RECONNECTING_ERROR =
  "OpenCode is reconnecting. Retry once the service is available, or start it explicitly.";
const MAX_RECONNECT_DELAY_MS = 30_000;
const STREAM_YIELD_MS = 8;
// The service sends a keepalive every 15 seconds, including when no events are emitted.
const STREAM_IDLE_TIMEOUT_MS = 45_000;
const STREAM_FOREGROUND_SILENCE_MS = 20_000;

type Binary = { path: string; version: string };

type EstablishInput = OpenCodeConnectInput & { binary?: Binary };

export interface OpenCodeRuntimeLifecycleAdapter {
  discoverService(): Promise<Endpoint | undefined>;
  ensureService(input: {
    command: string[];
    version: string | ((version: string) => boolean);
    env?: Record<string, string>;
    onStart(): void;
  }): Promise<Endpoint>;
  stopService(options?: StopOptions): Promise<void>;
  controlLoginService?(action: "start" | "restart", binary: Binary): Promise<Endpoint | null>;
  makeClient(
    endpoint: Endpoint,
    headers?: Record<string, string>,
    rejectRedirects?: boolean,
  ): OpenCodeClient;
  discoverBinary(input?: { exactVersion?: string }): Promise<Binary | null>;
  wait(milliseconds: number, signal: AbortSignal): Promise<void>;
  now(): number;
}

interface OpenCodeRuntimeLifecycleOptions {
  /** Local launch selection only. SSH keeps the exact CLI authentication contract. */
  discoverLocalBinary?(): Promise<Binary | null>;
  profile?: OpenCodeProfile;
  headers?: Record<string, string>;
  isVersionMismatchAllowed?(mismatch: OpenCodeVersionMismatch): boolean;
  onVersionMismatchAccepted?(mismatch: OpenCodeVersionMismatch): void;
  onEvent(event: OpenCodeEvent, streamEpoch: number): void;
  onReconnect(client: OpenCodeClient): Promise<void>;
  onStatus(status: OpenCodeRuntimeStatus): void;
  allowVersionMismatch?: boolean;
  adapter?: OpenCodeRuntimeLifecycleAdapter;
}

function errorMessage(error: unknown): string {
  return actionableErrorMessage(error, "Unknown OpenCode error");
}

function requestSignal(signal?: AbortSignal): AbortSignal {
  const timeout = AbortSignal.timeout(REQUEST_TIMEOUT_MS);
  return signal ? AbortSignal.any([signal, timeout]) : timeout;
}

// Discovery and snapshot repair do not accept cancellation. Stop awaiting them
// when recovery is retired; their eventual results cannot resume the old loop.
function withAbort<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    const onAbort = () => reject(signal.reason);
    signal.addEventListener("abort", onAbort, { once: true });
    promise.then(resolve, reject).finally(() => signal.removeEventListener("abort", onAbort));
    if (signal.aborted) {
      signal.removeEventListener("abort", onAbort);
      reject(signal.reason);
    }
  });
}

function wait(milliseconds: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(signal.reason);
      return;
    }
    const onAbort = () => {
      clearTimeout(timer);
      reject(signal.reason);
    };
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, milliseconds);
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

export const openCodeRuntimeLifecycleAdapter: OpenCodeRuntimeLifecycleAdapter = {
  discoverService: () => Service.discover(),
  ensureService: (input) => Service.ensure(input),
  stopService: (options) => Service.stop(options),
  controlLoginService: controlOpenCodeLoginService,
  makeClient: (endpoint, headers, rejectRedirects = false) =>
    OpenCode.make({
      baseUrl: endpoint.url,
      headers: headers ?? Service.headers(endpoint),
      fetch: observedOpenCodeFetch((input, init) =>
        globalThis.fetch(input, rejectRedirects ? { ...init, redirect: "error" } : init),
      ),
    }),
  discoverBinary: discoverSelectedOpenCodeBinary,
  wait,
  now: Date.now,
};

export class OpenCodeRuntimeLifecycle {
  readonly connectionID = randomUUID();
  readonly profileID: string;
  readonly contractVersion = SUPPORTED_OPENCODE_VERSION;
  private clientValue: OpenCodeClient | null = null;
  private endpointValue: Endpoint | null = null;
  private connectPromise: Promise<OpenCodeRuntimeStatus> | null = null;
  private reconnectPromise: Promise<void> | null = null;
  private pendingReconnect: { cause: unknown } | null = null;
  private restartPromise: Promise<OpenCodeRuntimeStatus> | null = null;
  private reconnectAbort: AbortController | null = null;
  private streamAbort: AbortController | null = null;
  private streamLastActivity = 0;
  private streamEpochValue = 0;
  private stopped = false;
  private statusValue: OpenCodeRuntimeStatus;
  private readonly adapter: OpenCodeRuntimeLifecycleAdapter;
  private sshConnector: SshConnector | undefined;
  private sshConnection: SshConnection | null = null;
  private connectionAbort = new AbortController();
  private stopPromise: Promise<void> | null = null;

  constructor(private readonly options: OpenCodeRuntimeLifecycleOptions) {
    const profile = options.profile ?? {
      id: "local-default",
      kind: "local",
      name: "Local OpenCode",
    };
    const classification = classifyOpenCodeProfile(profile);
    this.profileID = profile.id;
    this.statusValue = {
      connectionID: this.connectionID,
      profileID: this.profileID,
      contractVersion: this.contractVersion,
      phase: "idle",
      connected: false,
      canStartLocalService: false,
      ...classification,
      binaryPath: null,
      version: null,
      pid: null,
      managed: false,
      lastConnectedAt: null,
      error: null,
      versionMismatch: null,
    };
    this.adapter = options.adapter ?? openCodeRuntimeLifecycleAdapter;
  }

  status(): OpenCodeRuntimeStatus {
    return { ...this.statusValue };
  }

  async connect(
    input: OpenCodeConnectInput = {},
    sshConnector?: SshConnector,
  ): Promise<OpenCodeRuntimeStatus> {
    if (this.stopped) throw new Error("OpenCode connection has been disposed");
    if (this.statusValue.connected && this.clientValue) return this.status();
    const explicitLocalStart =
      (this.options.profile?.kind ?? "local") === "local" &&
      (input.startLocalService || input.versionMismatch === "replace");
    if (this.reconnectPromise && !explicitLocalStart) {
      throw new Error(this.statusValue.error ?? RECONNECTING_ERROR);
    }
    if (this.connectPromise) return this.connectPromise;
    const reconnect = this.reconnectPromise;
    if (reconnect) {
      this.pendingReconnect = null;
      this.reconnectAbort?.abort(new Error("OpenCode recovery superseded by explicit startup"));
      this.streamAbort?.abort();
      this.streamAbort = null;
    }
    if (sshConnector) this.sshConnector = sshConnector;
    this.stopped = false;
    this.connectPromise = (async () => {
      // Drain the cancelled loop before granting this attempt startup authority.
      // Its discovery/health/repair waits are abortable even if the producer hangs.
      if (reconnect) await reconnect;
      this.connectionAbort.signal.throwIfAborted();
      await this.establish(input);
    })()
      .then(() => {
        this.startEventStream();
        return this.status();
      })
      .catch((error: unknown) => {
        if (!this.stopped && this.statusValue.phase !== "error") {
          this.setStatus("error", { connected: false, error: errorMessage(error) });
        }
        throw error;
      })
      .finally(() => {
        this.connectPromise = null;
      });
    return this.connectPromise;
  }

  async client(): Promise<OpenCodeClient> {
    if (this.stopped) throw new Error("OpenCode connection has been disposed");
    // Reconnect observers may request the ready client while snapshot repair is pending.
    if (this.clientValue && this.statusValue.connected) return this.clientValue;
    if (this.reconnectPromise) throw new Error(this.statusValue.error ?? RECONNECTING_ERROR);
    if (this.connectPromise) await this.connectPromise;
    if (
      this.options.profile?.kind === "ssh" &&
      (!this.clientValue || !this.statusValue.connected)
    ) {
      throw new Error(
        this.statusValue.error ?? "Connect to this SSH server from a Palot window first",
      );
    }
    if (!this.clientValue || !this.statusValue.connected) await this.connect();
    if (!this.clientValue) throw new Error("OpenCode client is not connected");
    return this.clientValue;
  }

  async restartLocalService(): Promise<OpenCodeRuntimeStatus> {
    if (this.stopped) throw new Error("OpenCode connection has been disposed");
    const profile = this.options.profile ?? {
      id: "local-default",
      kind: "local" as const,
      name: "Local OpenCode",
    };
    if (profile.kind !== "local")
      throw new Error("Only the local OpenCode service can be restarted");
    if (this.restartPromise) return this.restartPromise;
    if (this.connectPromise || this.reconnectPromise) {
      throw new Error("OpenCode is connecting. Disconnect first, then restart the local service.");
    }
    this.restartPromise = this.restartLocalServiceNow().finally(() => {
      this.restartPromise = null;
    });
    return this.restartPromise;
  }

  async requestConnection(): Promise<{
    endpoint: Endpoint;
    headers: Record<string, string> | undefined;
  }> {
    await this.client();
    if (!this.endpointValue) throw new Error("OpenCode endpoint is not connected");
    return {
      endpoint: this.endpointValue,
      headers: this.options.headers ?? Service.headers(this.endpointValue),
    };
  }

  streamEpoch(): number {
    return this.streamEpochValue;
  }

  recoverEventStream(reason: "resume" | "focus" | "online"): void {
    const controller = this.streamAbort;
    if (!controller || controller.signal.aborted || this.stopped) return;
    if (this.adapter.now() - this.streamLastActivity < STREAM_FOREGROUND_SILENCE_MS) return;
    this.failEventStream(controller, new Error(`OpenCode event stream stale after ${reason}`));
  }

  stop(): Promise<void> {
    if (this.stopPromise) return this.stopPromise;
    this.stopped = true;
    this.connectionAbort.abort(new Error("OpenCode connection stopped"));
    this.pendingReconnect = null;
    this.reconnectAbort?.abort();
    this.reconnectAbort = null;
    this.streamAbort?.abort();
    this.streamAbort = null;
    this.clientValue = null;
    this.endpointValue = null;
    this.setStatus("stopped", { connected: false, canStartLocalService: false, error: null });
    this.stopPromise = (async () => {
      if (this.options.profile?.kind === "ssh") {
        await Promise.allSettled([this.connectPromise, this.reconnectPromise]);
        await this.closeSsh();
      }
    })();
    return this.stopPromise;
  }

  private async restartLocalServiceNow(): Promise<OpenCodeRuntimeStatus> {
    // Verify the selected executable before interrupting a working shared service.
    const binary = await this.discoverLocalBinary();
    this.connectionAbort.signal.throwIfAborted();
    if (!binary) throw new Error("No verified OpenCode runtime is available to restart with.");
    this.reconnectAbort?.abort();
    this.reconnectAbort = null;
    this.streamAbort?.abort();
    this.streamAbort = null;
    this.clientValue = null;
    this.endpointValue = null;
    this.stopped = false;
    this.setStatus("reconnecting", { connected: false, error: null });
    try {
      const managedEndpoint = await this.adapter.controlLoginService?.("restart", binary);
      if (managedEndpoint) this.endpointValue = managedEndpoint;
      else await this.adapter.stopService({ pty: "handoff" });
      this.connectionAbort.signal.throwIfAborted();
      await this.establish({ startLocalService: true, binary });
      this.startEventStream();
      const client = this.clientValue;
      if (client) await this.options.onReconnect(client);
      return this.status();
    } catch (error) {
      if (!this.stopped) this.setStatus("error", { connected: false, error: errorMessage(error) });
      throw error;
    }
  }

  private async establish(
    input: EstablishInput = {},
    signal: AbortSignal = this.connectionAbort.signal,
  ): Promise<void> {
    try {
      await this.establishNow(input, signal);
    } catch (error) {
      await this.closeSsh();
      throw error;
    }
  }

  private discoverLocalBinary(): Promise<Binary | null> {
    return this.options.discoverLocalBinary
      ? this.options.discoverLocalBinary()
      : this.adapter.discoverBinary();
  }

  private async closeSsh(): Promise<void> {
    const connection = this.sshConnection;
    this.sshConnection = null;
    await connection?.close();
  }

  private async establishNow(input: EstablishInput, signal: AbortSignal): Promise<void> {
    signal.throwIfAborted();
    const startedAt = this.adapter.now();
    openCodeLog.info("connection attempt started", {
      connectionID: this.connectionID,
      previousPhase: this.statusValue.phase,
      versionMismatch: input.versionMismatch ?? null,
    });
    this.setStatus("discovering", {
      connected: false,
      error: null,
      version: null,
      pid: null,
      versionMismatch: null,
      canStartLocalService: false,
    });
    const profile = this.options.profile ?? {
      id: "local-default",
      kind: "local" as const,
      name: "Local OpenCode",
    };
    let endpoint: Endpoint | undefined;
    if (profile.kind === "ssh") {
      await this.closeSsh();
      if (!this.sshConnector)
        throw new Error("Connect to this SSH server from a Palot window first");
      const binary = await this.adapter.discoverBinary({ exactVersion: this.contractVersion });
      if (!binary || binary.version !== this.contractVersion)
        throw new Error(
          `SSH authentication requires OpenCode ${this.contractVersion}. Install a matching CLI or explicitly download and select the matching official runtime in connection settings.`,
        );
      this.connectionAbort.signal.throwIfAborted();
      this.sshConnection = await this.sshConnector({
        config: profile.ssh,
        binaryPath: binary.path,
        version: this.contractVersion,
        signal: this.connectionAbort.signal,
      });
      endpoint = this.sshConnection.endpoint;
    } else if (profile.kind === "local") {
      // A stream failure does not imply that the shared service needs replacing.
      // Bound the old endpoint probe so a hung service cannot prevent rediscovery.
      if (this.endpointValue) {
        try {
          const probeSignal = AbortSignal.any([
            signal,
            AbortSignal.timeout(RETAINED_ENDPOINT_TIMEOUT_MS),
          ]);
          await withAbort(
            this.adapter
              .makeClient(this.endpointValue, this.options.headers, false)
              .health.get({ signal: probeSignal }),
            probeSignal,
          );
          signal.throwIfAborted();
          endpoint = this.endpointValue;
        } catch {
          signal.throwIfAborted();
          this.endpointValue = null;
        }
      }
      if (!endpoint) {
        try {
          endpoint = await withAbort(this.adapter.discoverService(), signal);
        } catch (error) {
          if (!this.stopped && !signal.aborted)
            this.setStatus("error", { canStartLocalService: true, error: errorMessage(error) });
          throw error;
        }
      }
    } else {
      endpoint = await this.discoverRemoteEndpoint(profile);
    }
    signal.throwIfAborted();
    let managed = false;
    let launchVersion: string | null = null;
    let binaryPath = this.statusValue.binaryPath;
    let acceptedMismatch: OpenCodeVersionMismatch | null = null;
    if (endpoint) {
      const candidate = this.adapter.makeClient(
        endpoint,
        this.options.headers,
        profile.kind !== "local",
      );
      const healthSignal = requestSignal(signal);
      const health = await withAbort(
        candidate.health.get({ signal: healthSignal }),
        healthSignal,
      ).catch((error: unknown) => {
        if (profile.kind === "local" && !this.stopped && !signal.aborted) {
          this.setStatus("error", {
            canStartLocalService: true,
            error: LOCAL_SERVICE_UNAVAILABLE,
          });
          throw new Error(LOCAL_SERVICE_UNAVAILABLE, { cause: error });
        }
        throw error;
      });
      signal.throwIfAborted();
      if (!shouldReuseOpenCodeService(health.version)) {
        const mismatch = this.versionMismatch(health.version);
        const allowed = this.versionMismatchAllowed(mismatch, input);
        if (allowed) {
          acceptedMismatch = mismatch;
          if (input.versionMismatch === "continue") {
            this.options.onVersionMismatchAccepted?.(mismatch);
          }
        } else if (input.versionMismatch === "replace") {
          endpoint = undefined;
        } else {
          const error = new Error(this.versionMismatchMessage(mismatch));
          this.setStatus("error", {
            connected: false,
            version: health.version,
            pid: health.pid,
            versionMismatch: mismatch,
            error: error.message,
          });
          throw error;
        }
      }
    }
    if (!endpoint && profile.kind === "local") {
      signal.throwIfAborted();
      this.setStatus("discovering", { canStartLocalService: true });
      if (!input.startLocalService && input.versionMismatch !== "replace") {
        throw new Error(LOCAL_SERVICE_UNAVAILABLE);
      }
      const binary = input.binary ?? (await this.discoverLocalBinary());
      signal.throwIfAborted();
      if (!binary) {
        const error = new Error(
          `A supported OpenCode 2 binary was not found. Install ${supportedOpenCodeVersionLabel()}, set OPENCODE_BIN to its executable, or download an official runtime in connection settings.`,
        );
        this.setStatus("error", {
          connected: false,
          // Keep the confirmed action available after setup prepares a runtime.
          // Preparation does not reconnect or refresh lifecycle state itself.
          canStartLocalService: true,
          binaryPath: null,
          error: error.message,
        });
        throw error;
      }
      binaryPath = binary.path;
      launchVersion = binary.version;
      this.setStatus("starting", { connected: false, binaryPath, error: null });
      const configuredPort = process.env.PALOT_OPENCODE_SERVICE_PORT?.trim() || undefined;
      // Keep persistent proxies valid; fail on a port conflict instead of silently moving.
      const servicePort = configuredPort ?? "4096";
      endpoint =
        (await this.adapter.controlLoginService?.(
          input.versionMismatch === "replace" ? "restart" : "start",
          binary,
        )) ??
        (await this.adapter.ensureService({
          command: [binaryPath, "serve", "--service", `--port=${servicePort}`],
          // Explicit start/recovery must not replace a healthy version that appeared
          // since discovery. Only explicit version replacement requests an exact version.
          version: input.versionMismatch === "replace" ? binary.version : () => true,
          onStart: () => {
            managed = true;
          },
        }));
    }
    if (this.stopped) throw new Error("OpenCode runtime stopped while connecting");

    this.setStatus("connecting", {
      connected: false,
      canStartLocalService: false,
      binaryPath,
      managed,
      error: null,
    });
    if (!endpoint) throw new Error("OpenCode server is unavailable");
    const client = this.adapter.makeClient(
      endpoint,
      this.options.headers,
      profile.kind !== "local",
    );
    const healthSignal = requestSignal(signal);
    const health = await withAbort(client.health.get({ signal: healthSignal }), healthSignal);
    signal.throwIfAborted();
    if (!isSupportedOpenCodeVersion(health.version)) {
      const mismatch = this.versionMismatch(health.version);
      // Replacement rejects continuing the OLD service. A deliberately prepared
      // beta still uses its recorded consent after the selected binary is started.
      const approvalInput =
        input.versionMismatch === "replace" && health.version === launchVersion ? {} : input;
      if (!this.versionMismatchAllowed(mismatch, approvalInput)) {
        const error = new Error(this.versionMismatchMessage(mismatch));
        this.setStatus("error", {
          connected: false,
          version: health.version,
          pid: health.pid,
          versionMismatch: mismatch,
          error: error.message,
        });
        throw error;
      }
      const newlyAccepted = acceptedMismatch === null;
      acceptedMismatch = mismatch;
      if (input.versionMismatch === "continue" && newlyAccepted) {
        this.options.onVersionMismatchAccepted?.(mismatch);
      }
    }
    if (this.stopped) throw new Error("OpenCode runtime stopped while connecting");
    this.clientValue = client;
    this.endpointValue = endpoint;
    this.setStatus("connected", {
      connected: true,
      canStartLocalService: false,
      binaryPath,
      managed,
      version: health.version,
      pid: health.pid,
      lastConnectedAt: this.adapter.now(),
      error: null,
      versionMismatch: acceptedMismatch,
    });
    openCodeLog.info("connection established", {
      connectionID: this.connectionID,
      durationMs: this.adapter.now() - startedAt,
      managed,
      version: health.version,
      pid: health.pid,
    });
  }

  private async discoverRemoteEndpoint(
    profile: Extract<OpenCodeProfile, { kind: "remote" }>,
  ): Promise<Endpoint> {
    const urls = profile.lastSuccessfulUrl
      ? [
          profile.lastSuccessfulUrl,
          ...profile.urls.filter((url) => url !== profile.lastSuccessfulUrl),
        ]
      : profile.urls;
    let lastError: unknown;
    for (const url of urls) {
      try {
        const endpoint = { url } satisfies Endpoint;
        const client = this.adapter.makeClient(endpoint, this.options.headers, true);
        await client.health.get({ signal: requestSignal() });
        return endpoint;
      } catch (error) {
        lastError = error;
      }
    }
    throw new Error(`Could not connect to ${profile.name}: ${errorMessage(lastError)}`);
  }

  private versionMismatch(detectedVersion: string): OpenCodeVersionMismatch {
    return {
      detectedVersion,
      expectedVersion: this.contractVersion,
      canContinue:
        this.options.profile?.kind !== "ssh" &&
        this.options.allowVersionMismatch === true &&
        canContinueOpenCodeVersionMismatch(detectedVersion),
    };
  }

  private versionMismatchAllowed(
    mismatch: OpenCodeVersionMismatch,
    input: OpenCodeConnectInput,
  ): boolean {
    if (!mismatch.canContinue) return false;
    if (input.versionMismatch === "continue")
      return input.approvedVersion === mismatch.detectedVersion;
    if (input.versionMismatch === "replace") return false;
    return this.options.isVersionMismatchAllowed?.(mismatch) ?? false;
  }

  private versionMismatchMessage(mismatch: OpenCodeVersionMismatch): string {
    return mismatch.canContinue
      ? `OpenCode ${mismatch.detectedVersion} does not match Palot's ${mismatch.expectedVersion} contract.`
      : `OpenCode ${mismatch.detectedVersion} is not supported. Install ${supportedOpenCodeVersionLabel()}.`;
  }

  private startEventStream(): void {
    const client = this.clientValue;
    if (!client || this.stopped) return;
    this.streamAbort?.abort();
    const controller = new AbortController();
    this.streamAbort = controller;
    const streamEpoch = ++this.streamEpochValue;
    openCodeLog.info("event stream started", { connectionID: this.connectionID, streamEpoch });
    let watchdog: ReturnType<typeof setTimeout> | undefined;
    const clearWatchdog = () => clearTimeout(watchdog);
    controller.signal.addEventListener("abort", clearWatchdog, { once: true });
    const fail = (error: unknown) => {
      if (controller.signal.aborted || this.stopped || this.streamAbort !== controller) return;
      openCodeLog.warn("event stream failed", {
        connectionID: this.connectionID,
        streamEpoch,
        error: errorDiagnostic(error),
      });
      this.failEventStream(controller, error);
    };
    const onActivity = () => {
      if (controller.signal.aborted || this.streamAbort !== controller) return;
      this.streamLastActivity = this.adapter.now();
      clearWatchdog();
      watchdog = setTimeout(
        () => fail(new Error("OpenCode event stream stalled")),
        STREAM_IDLE_TIMEOUT_MS,
      );
      watchdog.unref();
    };
    onActivity();
    void this.consumeEvents(client, controller, streamEpoch, onActivity)
      .catch(fail)
      .finally(() => {
        clearWatchdog();
        controller.signal.removeEventListener("abort", clearWatchdog);
      });
  }

  private failEventStream(controller: AbortController, cause: unknown): void {
    if (controller.signal.aborted || this.stopped || this.streamAbort !== controller) return;
    // Cancel the hung read before entering the serialized recovery loop.
    // Its eventual rejection is ignored because this controller is already aborted.
    controller.abort(cause);
    if (this.reconnectPromise) {
      this.setStatus("reconnecting", { connected: false, error: errorMessage(cause) });
    }
    this.startReconnect(cause);
  }

  private async consumeEvents(
    client: OpenCodeClient,
    controller: AbortController,
    streamEpoch: number,
    onActivity: () => void,
  ): Promise<void> {
    let lastYield = this.adapter.now();
    for await (const event of client.event.subscribe({ signal: controller.signal, onActivity })) {
      if (controller.signal.aborted) return;
      this.options.onEvent(event, streamEpoch);
      if (this.adapter.now() - lastYield >= STREAM_YIELD_MS) {
        await new Promise<void>((resolve) => setImmediate(resolve));
        lastYield = this.adapter.now();
      }
    }
    if (!controller.signal.aborted) throw new Error("OpenCode event stream closed");
  }

  private startReconnect(cause: unknown): void {
    if (this.stopped) return;
    if (this.reconnectPromise) {
      // A replacement stream can fail while onReconnect is still repairing snapshots.
      // Keep that failure for the same loop instead of losing it or spawning a second loop.
      this.pendingReconnect = { cause };
      return;
    }
    this.clientValue = null;
    openCodeLog.warn("reconnect started", {
      connectionID: this.connectionID,
      error: errorDiagnostic(cause),
    });
    this.setStatus("reconnecting", { connected: false, error: errorMessage(cause) });
    const controller = new AbortController();
    this.reconnectAbort = controller;
    this.reconnectPromise = this.reconnectLoop(controller.signal).finally(() => {
      if (this.reconnectAbort === controller) this.reconnectAbort = null;
      this.reconnectPromise = null;
      const pending = this.pendingReconnect;
      this.pendingReconnect = null;
      if (pending && !controller.signal.aborted) this.startReconnect(pending.cause);
    });
  }

  private async reconnectLoop(signal: AbortSignal): Promise<void> {
    let backoff = 1_000;
    let attempt = 0;
    while (!this.stopped && !signal.aborted) {
      try {
        attempt += 1;
        openCodeLog.info("reconnect attempt scheduled", {
          connectionID: this.connectionID,
          attempt,
          backoffMs: backoff,
        });
        await withAbort(this.adapter.wait(backoff, signal), signal);
        if (signal.aborted || this.stopped) return;
        await this.establish({}, AbortSignal.any([signal, this.connectionAbort.signal]));
        if (signal.aborted || this.stopped) return;
        this.startEventStream();
        const client = this.clientValue;
        if (!client) throw new Error("OpenCode client is not connected");
        await withAbort(this.options.onReconnect(client), signal);
        if (signal.aborted || this.stopped) return;
        if (this.pendingReconnect) {
          const { cause } = this.pendingReconnect;
          this.pendingReconnect = null;
          throw cause;
        }
        return;
      } catch (error) {
        if (this.stopped || signal.aborted) return;
        this.streamAbort?.abort();
        this.pendingReconnect = null;
        this.streamAbort = null;
        this.clientValue = null;
        // Do not repeatedly reopen authentication or setup dialogs after cancellation.
        // The next explicit Connect action can attach a fresh window and try again.
        if (this.options.profile?.kind === "ssh") {
          await this.closeSsh();
          this.setStatus("error", { connected: false, error: errorMessage(error) });
          return;
        }
        this.setStatus("reconnecting", { connected: false, error: errorMessage(error) });
        openCodeLog.warn("reconnect attempt failed", {
          connectionID: this.connectionID,
          attempt,
          backoffMs: backoff,
          error: errorDiagnostic(error),
        });
        backoff = Math.min(backoff * 2, MAX_RECONNECT_DELAY_MS);
      }
    }
  }

  private setStatus(
    phase: OpenCodeRuntimePhase,
    patch: Partial<Omit<OpenCodeRuntimeStatus, "phase">>,
  ): void {
    const previous = this.statusValue;
    this.statusValue = { ...this.statusValue, ...patch, phase };
    if (previous.phase !== phase || previous.connected !== this.statusValue.connected) {
      openCodeLog.info("runtime status changed", {
        connectionID: this.connectionID,
        from: previous.phase,
        to: phase,
        connected: this.statusValue.connected,
        error: this.statusValue.error,
      });
    }
    this.options.onStatus(this.status());
  }
}
