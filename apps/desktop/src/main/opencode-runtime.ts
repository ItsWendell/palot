/** Main-process OpenCode lifecycle and event transport. */

import type { OpenCodeClient, OpenCodeEvent } from "@opencode/client";
import { BrowserWindow } from "electron";
import Store from "electron-store";
import type {
  OpenCodeConnectInput,
  OpenCodeCredentialInput,
  OpenCodePairingInfo,
  LocalOpenCodeServiceInfo,
  OpenCodePairImportInput,
  OpenCodeProfile,
  OpenCodeProfileCreateInput,
  OpenCodeProfileSnapshot,
  OpenCodeProfileTestResult,
  OpenCodeProfileUpdateInput,
  OpenCodeRuntimeStatus,
  OpenCodeVersionMismatch,
  OpenCodeTransportEvent,
} from "../shared/opencode-contract";
import { IPC_CHANNELS } from "../shared/opencode-contract";
import { OpenCodeEventBatcher } from "./event-batcher";
import { notifyEventObservers } from "./event-observers";
import { EventReplayGuard } from "./event-replay-guard";
import { openCodeLog } from "./opencode-observability";
import {
  OpenCodeRuntimeLifecycle,
  discoverBundledOpenCodeBinary,
} from "./opencode-runtime-lifecycle";
import { getOpenCodeReleaseManager } from "./opencode-release-manager";
import { getOpenCodeInstallations } from "./opencode-local-installations";
import type { SshConnector } from "./ssh/interaction";
import { buildAllowsOpenCodeVersionMismatch } from "./opencode-version";
import { OpenCodeCredentialVault } from "./opencode-connections/credential-vault";
import { serializeOpenCodePairPayload } from "./opencode-connections/pairing";
import {
  OpenCodeProfileStore,
  isLoopbackOpenCodeUrl,
  normalizeOpenCodeUrls,
} from "./opencode-connections/profile-store";

export function mapEvent(event: OpenCodeEvent): OpenCodeTransportEvent {
  return {
    ...event,
    createdAt: "created" in event && typeof event.created === "number" ? event.created : Date.now(),
  };
}

export class OpenCodeRuntime {
  private readonly eventObservers = new Set<(event: OpenCodeEvent) => void>();
  private readonly scopedEventObservers = new Map<string, Set<(event: OpenCodeEvent) => void>>();
  private readonly scopedReconnectObservers = new Map<
    string,
    Set<(client: OpenCodeClient) => void | Promise<void>>
  >();
  private readonly reconnectObservers = new Set<(client: OpenCodeClient) => void | Promise<void>>();
  private readonly batcher = new OpenCodeEventBatcher((batch) => {
    for (const window of BrowserWindow.getAllWindows()) {
      if (!window.isDestroyed()) {
        window.webContents.send(IPC_CHANNELS.events, batch);
      }
    }
  });
  private readonly profiles = new OpenCodeProfileStore();
  private readonly credentials = new OpenCodeCredentialVault();
  private readonly beforeSwitchObservers = new Set<() => void | Promise<void>>();
  private readonly disposalObservers = new Set<(connectionID: string) => void>();
  private switching = false;
  private switchPending = false;
  private shuttingDown = false;
  private readonly lifecycles = new Set<OpenCodeRuntimeLifecycle>();
  private readonly monitored = new Map<string, OpenCodeRuntimeLifecycle>();
  private lifecycle = this.retainLifecycle(this.initialProfile());

  private retainLifecycle(profile: OpenCodeProfile): OpenCodeRuntimeLifecycle {
    const existing = this.monitored.get(profile.id);
    if (existing) return existing;
    const lifecycle = this.createLifecycle(profile);
    this.monitored.set(profile.id, lifecycle);
    return lifecycle;
  }

  private createLifecycle(profile: OpenCodeProfile): OpenCodeRuntimeLifecycle {
    if (this.shuttingDown) throw new Error("OpenCode runtime is shutting down");
    let lifecycle: OpenCodeRuntimeLifecycle;
    const replayGuard = new EventReplayGuard();
    const allowVersionMismatch = buildAllowsOpenCodeVersionMismatch(
      __PALOT_BUILD_CHANNEL__,
      process.env.PALOT_ALLOW_OPENCODE_VERSION_MISMATCH === "1",
    );
    lifecycle = new OpenCodeRuntimeLifecycle({
      profile,
      discoverLocalBinary: async () =>
        (await getOpenCodeInstallations().discoverPreferredBinary()) ??
        (await getOpenCodeReleaseManager().discoverPreparedBinary()) ??
        discoverBundledOpenCodeBinary(),
      headers:
        profile.kind === "remote" ? this.credentials.headers(profile.credentialID) : undefined,
      allowVersionMismatch,
      isVersionMismatchAllowed: allowVersionMismatch
        ? (mismatch) =>
            versionMismatchAllowed(profile.id, mismatch) ||
            (profile.kind === "local" &&
              (getOpenCodeReleaseManager().acceptsPreparedVersion(mismatch.detectedVersion) ||
                getOpenCodeInstallations().acceptsInstalledVersion(mismatch.detectedVersion)))
        : undefined,
      onVersionMismatchAccepted: allowVersionMismatch
        ? (mismatch) => acceptVersionMismatch(profile.id, mismatch)
        : undefined,
      onEvent: (event, streamEpoch) => {
        if (this.monitored.get(profile.id) !== lifecycle) return;
        if (!replayGuard.admit(event)) return;
        if (this.lifecycle === lifecycle)
          notifyEventObservers(this.eventObservers, event, (error) => {
            openCodeLog.warn("event observer failed", {
              connectionID: lifecycle.connectionID,
              type: event.type,
              error: error instanceof Error ? error.message : String(error),
            });
          });
        this.batcher.push(mapEvent(event), this.delivery(lifecycle, streamEpoch));
        notifyEventObservers(
          this.scopedEventObservers.get(lifecycle.connectionID) ?? [],
          event,
          (error) => {
            openCodeLog.warn("scoped event observer failed", { error: String(error) });
          },
        );
      },
      onReconnect: async (client) => {
        if (this.monitored.get(profile.id) !== lifecycle) return;
        const observers = [
          ...(this.lifecycle === lifecycle ? this.reconnectObservers : []),
          ...(this.scopedReconnectObservers.get(lifecycle.connectionID) ?? []),
        ];
        await Promise.allSettled(observers.map((observer) => observer(client)));
      },
      onStatus: (status) => {
        if (this.monitored.get(profile.id) === lifecycle) this.publishStatus(lifecycle, status);
      },
    });
    this.lifecycles.add(lifecycle);
    return lifecycle;
  }

  private async stopLifecycle(lifecycle: OpenCodeRuntimeLifecycle): Promise<void> {
    try {
      await lifecycle.stop();
    } finally {
      this.lifecycles.delete(lifecycle);
      this.scopedEventObservers.delete(lifecycle.connectionID);
      this.scopedReconnectObservers.delete(lifecycle.connectionID);
    }
  }

  runtimeStatus(): OpenCodeRuntimeStatus {
    return this.lifecycle.status();
  }

  listRuntimes(): OpenCodeRuntimeStatus[] {
    return [...this.monitored.values()].map((lifecycle) => lifecycle.status());
  }

  async connectProfile(
    profileID: string,
    sshConnector?: SshConnector,
  ): Promise<OpenCodeRuntimeStatus> {
    this.assertNotSwitching();
    const profile = this.profiles.get(profileID);
    if (profile.kind === "remote") {
      assertPlainHttpAllowed(profile.urls, profile.allowPlainHttp, { type: "none" });
    }
    const lifecycle = this.retainLifecycle(profile);
    const status = await lifecycle.connect({}, sshConnector);
    if (this.monitored.get(profileID) !== lifecycle)
      throw new Error("OpenCode connection has been disposed");
    if (profile.kind === "remote" && status.connected) {
      const connection = await lifecycle.requestConnection();
      if (this.monitored.get(profileID) !== lifecycle)
        throw new Error("OpenCode connection has been disposed");
      this.profiles.recordConnection(
        profileID,
        connection.endpoint.url,
        status.lastConnectedAt ?? Date.now(),
      );
    }
    return status;
  }

  onConnectionDisposed(observer: (connectionID: string) => void): () => void {
    this.disposalObservers.add(observer);
    return () => {
      this.disposalObservers.delete(observer);
    };
  }

  async disconnectProfile(profileID: string): Promise<void> {
    this.assertNotSwitching();
    this.profiles.get(profileID);
    if (profileID === this.profileID())
      throw new Error("Cannot disconnect the focused OpenCode profile");
    await this.invalidateProfile(profileID, true);
  }

  private invalidateProfile(profileID: string, reportCleanupFailure = false): Promise<void> {
    const lifecycle = this.monitored.get(profileID);
    if (!lifecycle) return Promise.resolve();
    this.publishStatus(lifecycle, { ...lifecycle.status(), connected: false, phase: "stopped" });
    this.monitored.delete(profileID);
    notifyEventObservers(this.disposalObservers, lifecycle.connectionID, (error) => {
      openCodeLog.warn("connection disposal observer failed", { error: String(error) });
    });
    return this.stopLifecycle(lifecycle).catch((error) => {
      openCodeLog.warn("failed to dispose OpenCode connection", {
        profileID,
        error: String(error),
      });
      if (reportCleanupFailure) throw error;
    });
  }

  recoverEventStream(reason: "resume" | "focus" | "online"): void {
    for (const lifecycle of this.monitored.values()) lifecycle.recoverEventStream(reason);
  }

  performanceMetrics() {
    return this.batcher.snapshotMetrics();
  }

  async connect(
    input?: OpenCodeConnectInput,
    sshConnector?: SshConnector,
  ): Promise<OpenCodeRuntimeStatus> {
    this.assertNotSwitching();
    const lifecycle = this.lifecycle;
    const status = await lifecycle.connect(input, sshConnector);
    const profile = this.profiles.get(status.profileID);
    if (profile.kind === "remote" && status.connected) {
      const connection = await lifecycle.requestConnection();
      if (this.monitored.get(profile.id) !== lifecycle)
        throw new Error("OpenCode connection has been disposed");
      this.profiles.recordConnection(
        profile.id,
        connection.endpoint.url,
        status.lastConnectedAt ?? Date.now(),
      );
    }
    return status;
  }

  profileSnapshot(): OpenCodeProfileSnapshot {
    return this.profiles.snapshot();
  }

  createProfile(input: OpenCodeProfileCreateInput): OpenCodeProfileSnapshot {
    if (input.kind !== "remote") return this.profiles.create(input, null);
    const normalized = { ...input, urls: normalizeOpenCodeUrls(input.urls) };
    assertPlainHttpAllowed(normalized.urls, normalized.allowPlainHttp, normalized.credential);
    const credentialID = this.credentials.storeCredential(normalized.credential);
    try {
      return this.profiles.create(normalized, credentialID);
    } catch (error) {
      if (credentialID) this.deleteCredentialBestEffort(credentialID);
      throw error;
    }
  }

  updateProfile(input: OpenCodeProfileUpdateInput): OpenCodeProfileSnapshot {
    const current = this.profiles.get(input.id);
    if (current.id === this.profileID()) {
      throw new Error("Switch profiles before editing the active OpenCode server");
    }
    if (input.kind !== "remote") {
      const snapshot = this.profiles.update(input);
      this.invalidateProfile(input.id);
      return snapshot;
    }
    const normalized = { ...input, urls: normalizeOpenCodeUrls(input.urls) };
    if (normalized.credential) {
      assertPlainHttpAllowed(normalized.urls, normalized.allowPlainHttp, normalized.credential);
    }
    if (!normalized.credential) {
      const snapshot = this.profiles.update(normalized);
      this.invalidateProfile(input.id);
      return snapshot;
    }
    const previousID = current.kind === "remote" ? current.credentialID : null;
    const credentialID = this.credentials.storeCredential(normalized.credential);
    let snapshot: OpenCodeProfileSnapshot;
    try {
      snapshot = this.profiles.update(normalized, credentialID);
    } catch (error) {
      if (credentialID) this.deleteCredentialBestEffort(credentialID);
      throw error;
    }
    this.invalidateProfile(input.id);
    if (previousID) this.deleteCredentialBestEffort(previousID);
    return snapshot;
  }

  deleteProfile(profileID: string): OpenCodeProfileSnapshot {
    const profile = this.profiles.get(profileID);
    if (profile.id === this.profileID())
      throw new Error("Switch profiles before deleting the active profile");
    const snapshot = this.profiles.delete(profileID);
    this.invalidateProfile(profileID);
    if (profile.kind === "remote" && profile.credentialID)
      this.deleteCredentialBestEffort(profile.credentialID);
    return snapshot;
  }

  async testProfile(
    input: OpenCodeProfileCreateInput,
    sshConnector?: SshConnector,
  ): Promise<OpenCodeProfileTestResult> {
    if (input.kind !== "remote") {
      const lifecycle = this.createLifecycle({
        ...input,
        id: "profile-test",
      });
      try {
        const status = await lifecycle.connect({}, sshConnector);
        const connection = await lifecycle.requestConnection();
        return {
          url: connection.endpoint.url,
          version: status.version ?? status.contractVersion,
          pid: status.pid,
          secure: input.kind === "ssh" || new URL(connection.endpoint.url).protocol === "https:",
        };
      } finally {
        await this.stopLifecycle(lifecycle);
      }
    }
    const urls = normalizeOpenCodeUrls(input.urls);
    assertPlainHttpAllowed(urls, input.allowPlainHttp, input.credential);
    const credentialID = this.credentials.storeCredential(input.credential);
    try {
      const lifecycle = this.createLifecycle({
        id: "profile-test",
        kind: "remote",
        name: input.name,
        urls,
        credentialID,
        allowPlainHttp: input.allowPlainHttp,
        lastSuccessfulUrl: null,
        lastConnectedAt: null,
      });
      try {
        const status = await lifecycle.connect();
        const connection = await lifecycle.requestConnection();
        return {
          url: connection.endpoint.url,
          version: status.version ?? status.contractVersion,
          pid: status.pid,
          secure: new URL(connection.endpoint.url).protocol === "https:",
        };
      } finally {
        await this.stopLifecycle(lifecycle);
      }
    } finally {
      if (credentialID) this.deleteCredentialBestEffort(credentialID);
    }
  }

  async switchProfile(
    profileID: string,
    sshConnector?: SshConnector,
  ): Promise<OpenCodeRuntimeStatus> {
    this.assertNotSwitching();
    if (this.switchPending) throw new Error("An OpenCode server switch is already in progress");
    this.switchPending = true;
    try {
      return await this.switchProfileNow(profileID, sshConnector);
    } finally {
      this.switchPending = false;
    }
  }

  private async switchProfileNow(
    profileID: string,
    sshConnector?: SshConnector,
  ): Promise<OpenCodeRuntimeStatus> {
    if (profileID === this.profileID() && this.runtimeStatus().connected)
      return this.runtimeStatus();
    const profile = this.profiles.get(profileID);
    if (profile.kind === "remote") {
      assertPlainHttpAllowed(profile.urls, profile.allowPlainHttp, { type: "none" });
    }
    const status = await this.connectProfile(profileID, sshConnector);
    const candidate = this.monitored.get(profileID)!;
    this.switching = true;
    try {
      await Promise.all([...this.beforeSwitchObservers].map((observer) => observer()));
      if (this.shuttingDown) throw new Error("OpenCode runtime is shutting down");
      if (!candidate || this.monitored.get(profileID) !== candidate)
        throw new Error("OpenCode connection has been disposed");
      this.profiles.activate(profileID);
      this.batcher.flush();
      this.lifecycle = candidate;
    } finally {
      this.switching = false;
    }
    this.publishStatus(candidate, status);
    return status;
  }

  onBeforeSwitch(observer: () => void | Promise<void>): () => void {
    this.beforeSwitchObservers.add(observer);
    return () => this.beforeSwitchObservers.delete(observer);
  }

  async pairingInfo(): Promise<OpenCodePairingInfo> {
    const status = this.runtimeStatus();
    if (status.capabilities?.pairing !== "show")
      throw new Error("Pairing is unavailable for this profile");
    const [server, connection] = await Promise.all([
      this.withClient((client) => client.server.get()),
      this.requestConnection(),
    ]);
    const auth = connection.endpoint.auth;
    if (!auth || auth.type !== "basic")
      throw new Error("The active OpenCode service has no pairable credentials");
    const payload = { urls: server.urls, username: auth.username, password: auth.password };
    return { ...payload, payload: serializeOpenCodePairPayload(payload) };
  }

  async restartLocalService(): Promise<OpenCodeRuntimeStatus> {
    if (this.profiles.get(this.profileID()).kind !== "local") {
      throw new Error("Switch to the local OpenCode connection before restarting its service");
    }
    return this.lifecycle.restartLocalService();
  }

  async localServiceInfo(): Promise<LocalOpenCodeServiceInfo> {
    const status = this.runtimeStatus();
    const profile = this.profiles.get(status.profileID);
    if (profile.kind !== "local") {
      return {
        available: false,
        reason: "Switch to the local OpenCode connection to use its web interface.",
        url: null,
        version: status.version,
        pid: status.pid,
        managed: status.managed,
        restartAvailable: false,
        pairingAvailable: false,
      };
    }
    if (!status.connected) {
      return {
        available: false,
        reason: status.error ?? "The local OpenCode service is not connected.",
        url: null,
        version: status.version,
        pid: status.pid,
        managed: status.managed,
        restartAvailable: true,
        pairingAvailable: false,
      };
    }
    const connection = await this.requestConnection();
    const url = new URL(connection.endpoint.url);
    const hostname = url.hostname.replace(/^\[|\]$/g, "").toLowerCase();
    const available =
      url.protocol === "http:" && ["127.0.0.1", "localhost", "::1"].includes(hostname);
    return {
      available,
      reason: available ? null : "The active local service is not listening on loopback HTTP.",
      url: available ? url.toString().replace(/\/$/, "") : null,
      version: status.version,
      pid: status.pid,
      managed: status.managed,
      restartAvailable: true,
      pairingAvailable: status.capabilities?.pairing === "show",
    };
  }

  async importPairing(input: OpenCodePairImportInput): Promise<OpenCodeProfileSnapshot> {
    const urls = normalizeOpenCodeUrls(input.payload.urls);
    const credential = {
      type: "basic" as const,
      username: input.payload.username,
      password: input.payload.password,
    };
    assertPlainHttpAllowed(urls, input.allowPlainHttp, credential);
    const credentialID = this.credentials.storeCredential(credential);
    const profile: Extract<OpenCodeProfile, { kind: "remote" }> = {
      id: "pairing-probe",
      kind: "remote",
      name: new URL(urls[0]!).hostname || "Paired OpenCode",
      urls,
      credentialID,
      allowPlainHttp: input.allowPlainHttp,
      lastSuccessfulUrl: null,
      lastConnectedAt: null,
    };
    const lifecycle = this.createLifecycle(profile);
    let credentialCommitted = false;
    try {
      const status = await lifecycle.connect();
      const connection = await lifecycle.requestConnection();
      const before = new Set(this.profiles.snapshot().profiles.map((item) => item.id));
      const snapshot = this.profiles.create(
        {
          kind: "remote",
          name: profile.name,
          urls,
          credential,
          allowPlainHttp: input.allowPlainHttp,
        },
        credentialID,
      );
      credentialCommitted = true;
      const created = snapshot.profiles.find((item) => !before.has(item.id));
      if (created) {
        try {
          this.profiles.recordConnection(
            created.id,
            connection.endpoint.url,
            status.lastConnectedAt ?? Date.now(),
          );
        } catch (error) {
          openCodeLog.warn("failed to record paired server connection", {
            profileID: created.id,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }
      return this.profiles.snapshot();
    } catch (error) {
      if (!credentialCommitted && credentialID) this.deleteCredentialBestEffort(credentialID);
      throw error;
    } finally {
      await this.stopLifecycle(lifecycle);
    }
  }

  async requestConnection(target: { profileID?: string; connectionID?: string } = {}) {
    const explicit = target.profileID !== undefined || target.connectionID !== undefined;
    if (!explicit) this.assertNotSwitching();
    if (this.shuttingDown) throw new Error("OpenCode runtime is shutting down");
    if (target.profileID !== undefined) this.profiles.get(target.profileID);
    const lifecycle =
      target.profileID !== undefined
        ? this.monitored.get(target.profileID)
        : target.connectionID !== undefined
          ? [...this.monitored.values()].find((item) => item.connectionID === target.connectionID)
          : this.lifecycle;
    if (
      !lifecycle ||
      (target.connectionID !== undefined && lifecycle.connectionID !== target.connectionID)
    ) {
      throw new Error("OpenCode request target is unavailable or stale");
    }
    // Explicit requests may use retained connections, but must never start a service implicitly.
    if (explicit && !lifecycle.status().connected)
      throw new Error("OpenCode request target is not connected");
    const connection = await lifecycle.requestConnection();
    const validate = () => {
      if (
        this.shuttingDown ||
        this.monitored.get(lifecycle.profileID) !== lifecycle ||
        (!explicit && this.lifecycle !== lifecycle)
      ) {
        throw new Error("OpenCode connection changed during request");
      }
    };
    validate();
    return { ...connection, validate };
  }

  /** An exact, non-focusing client/observer view for explicitly scoped main-process consumers. */
  scopedConnection(connectionID: string) {
    const lifecycle = [...this.monitored.values()].find(
      (item) => item.connectionID === connectionID,
    );
    if (!lifecycle) throw new Error("OpenCode connection is unavailable or stale");
    const validate = () => {
      if (this.shuttingDown || this.monitored.get(lifecycle.profileID) !== lifecycle) {
        throw new Error("OpenCode connection is unavailable or stale");
      }
    };
    return {
      runtimeStatus: () => {
        validate();
        return lifecycle.status();
      },
      withClient: async <T>(operation: (client: OpenCodeClient) => Promise<T>): Promise<T> => {
        validate();
        if (!lifecycle.status().connected) throw new Error("OpenCode connection is not connected");
        const client = await lifecycle.client();
        validate();
        const result = await operation(client);
        validate();
        return result;
      },
      onEvent: (observer: (event: OpenCodeEvent) => void) => {
        validate();
        const observers = this.scopedEventObservers.get(connectionID) ?? new Set();
        this.scopedEventObservers.set(connectionID, observers);
        observers.add(observer);
        return () => {
          observers.delete(observer);
        };
      },
      onReconnect: (observer: (client: OpenCodeClient) => void | Promise<void>) => {
        validate();
        const observers = this.scopedReconnectObservers.get(connectionID) ?? new Set();
        this.scopedReconnectObservers.set(connectionID, observers);
        observers.add(observer);
        return () => {
          observers.delete(observer);
        };
      },
    };
  }

  async withClient<T>(
    operation: (client: OpenCodeClient, status: OpenCodeRuntimeStatus) => Promise<T>,
  ): Promise<T> {
    this.assertNotSwitching();
    const lifecycle = this.lifecycle;
    const client = await lifecycle.client();
    this.assertNotSwitching();
    if (lifecycle !== this.lifecycle) throw new Error("OpenCode connection changed during request");
    return operation(client, lifecycle.status());
  }

  onEvent(observer: (event: OpenCodeEvent) => void): () => void {
    this.eventObservers.add(observer);
    return () => this.eventObservers.delete(observer);
  }

  onReconnect(observer: (client: OpenCodeClient) => void | Promise<void>): () => void {
    this.reconnectObservers.add(observer);
    return () => this.reconnectObservers.delete(observer);
  }

  async shutdown(): Promise<void> {
    this.shuttingDown = true;
    const cleanup = await Promise.allSettled(
      [...this.lifecycles].map((lifecycle) => this.stopLifecycle(lifecycle)),
    );
    if (cleanup.some((result) => result.status === "rejected")) {
      openCodeLog.warn("OpenCode connection cleanup could not be completed");
    }
    this.eventObservers.clear();
    this.reconnectObservers.clear();
    this.beforeSwitchObservers.clear();
    for (const lifecycle of this.monitored.values()) {
      notifyEventObservers(this.disposalObservers, lifecycle.connectionID, () => {});
    }
    this.disposalObservers.clear();
    this.batcher.flush();
    this.batcher.dispose();
  }

  private publishStatus(lifecycle: OpenCodeRuntimeLifecycle, status: OpenCodeRuntimeStatus): void {
    this.batcher.push(
      {
        id: `palot-status-${Date.now()}-${status.phase}`,
        type: "palot.runtime.status",
        createdAt: Date.now(),
        location: null,
        data: status,
      },
      this.delivery(lifecycle, lifecycle.streamEpoch()),
    );
  }

  private delivery(lifecycle: OpenCodeRuntimeLifecycle, streamEpoch: number) {
    return {
      connectionID: lifecycle.connectionID,
      contractVersion: lifecycle.contractVersion,
      streamEpoch,
    };
  }

  private profileID(): string {
    return this.lifecycle.profileID;
  }

  private assertNotSwitching(): void {
    if (this.shuttingDown) throw new Error("OpenCode runtime is shutting down");
    if (this.switching) throw new Error("OpenCode server switch is in progress");
  }

  private initialProfile(): OpenCodeProfile {
    const configured = connectionProfileID();
    const snapshot = this.profiles.snapshot();
    return (
      (configured ? snapshot.profiles.find((profile) => profile.id === configured) : undefined) ??
      snapshot.profiles.find((profile) => profile.id === snapshot.activeProfileID) ??
      snapshot.profiles[0]!
    );
  }

  private deleteCredentialBestEffort(credentialID: string): void {
    try {
      this.credentials.delete(credentialID);
    } catch (error) {
      openCodeLog.warn("failed to delete OpenCode credential", {
        credentialID,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
}

function assertPlainHttpAllowed(
  urls: string[],
  allowed: boolean,
  credential: OpenCodeCredentialInput,
): void {
  const insecure = urls.some(
    (url) => new URL(url).protocol === "http:" && !isLoopbackOpenCodeUrl(url),
  );
  if (insecure && !allowed) {
    throw new Error(
      credential.type === "none"
        ? "Allow plain HTTP before connecting to a non-loopback OpenCode server"
        : "Allow plain HTTP before sending credentials to a non-loopback OpenCode server",
    );
  }
}

function connectionProfileID(): string | undefined {
  const configured = process.env.PALOT_CONNECTION_PROFILE_ID?.trim();
  if (!configured) return undefined;
  if (configured.length > 512) {
    throw new Error("PALOT_CONNECTION_PROFILE_ID must be 512 characters or fewer");
  }
  return configured;
}

interface OpenCodeCompatibilitySettings {
  acceptedVersionMismatches: string[];
}

let compatibilitySettings: Store<OpenCodeCompatibilitySettings> | null = null;

function compatibilityStore(): Store<OpenCodeCompatibilitySettings> {
  return (compatibilitySettings ??= new Store<OpenCodeCompatibilitySettings>({
    name: "opencode-compatibility",
    defaults: { acceptedVersionMismatches: [] },
  }));
}

function versionMismatchKey(profileID: string, mismatch: OpenCodeVersionMismatch): string {
  return `${profileID}\u0000${mismatch.expectedVersion}\u0000${mismatch.detectedVersion}`;
}

function versionMismatchAllowed(profileID: string, mismatch: OpenCodeVersionMismatch): boolean {
  return compatibilityStore()
    .get("acceptedVersionMismatches")
    .includes(versionMismatchKey(profileID, mismatch));
}

function acceptVersionMismatch(profileID: string, mismatch: OpenCodeVersionMismatch): void {
  const store = compatibilityStore();
  const key = versionMismatchKey(profileID, mismatch);
  const accepted = store.get("acceptedVersionMismatches");
  if (!accepted.includes(key)) store.set("acceptedVersionMismatches", [...accepted, key]);
}

let runtimeInstance: OpenCodeRuntime | null = null;

function getOpenCodeRuntime(): OpenCodeRuntime {
  return (runtimeInstance ??= new OpenCodeRuntime());
}

export const openCodeRuntime = new Proxy({} as OpenCodeRuntime, {
  get(_target, property) {
    const runtime = getOpenCodeRuntime();
    const value = Reflect.get(runtime, property, runtime);
    return typeof value === "function" ? value.bind(runtime) : value;
  },
});
