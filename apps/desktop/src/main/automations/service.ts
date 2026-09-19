import { randomUUID } from "node:crypto";
import path from "node:path";
import type { OpenCodeClient, OpenCodeEvent } from "@opencode/client";
import { app, BrowserWindow, Notification, powerMonitor, powerSaveBlocker } from "electron";
import log from "electron-log/main";
import Store from "electron-store";
import type {
  AutomationChangedEvent,
  AutomationCommand,
  AutomationDefinition,
  AutomationDraft,
  AutomationHostSettings,
  AutomationNotificationTarget,
  AutomationRecord,
  AutomationRun,
  AutomationSchedulePreview,
  AutomationSnapshot,
  AutomationTrigger,
  OpenCodeRuntimeStatus,
} from "../../shared";
import { IPC_CHANNELS } from "../../shared/opencode-contract";
import { palotDatabase } from "../database/client";
import { openCodeRuntime } from "../opencode-runtime";
import { isSupportedOpenCodeVersion } from "../opencode-version";
import { AutomationDefinitionRegistry, validateAutomationDraft } from "./definitions";
import {
  advanceNextRun,
  initialNextRun,
  isMissedAutomationOccurrence,
  overdueOccurrenceCount,
  schedulePreview,
} from "./recurrence";
import { AutomationRepository } from "./repository";
import { AutomationConfigurationError, AutomationRunner } from "./runner";

const SCAN_INTERVAL_MS = 30_000;
const MAX_CONCURRENT_RUNS = 3;
const ONE_TIME_CATCH_UP_AGE_MS = 7 * 24 * 60 * 60 * 1_000;

type OpenTarget = (target: AutomationNotificationTarget) => void | Promise<void>;

export class AutomationService {
  private readonly repository = new AutomationRepository(palotDatabase());
  private readonly registry = new AutomationDefinitionRegistry(
    path.join(app.getPath("userData"), "automations"),
  );
  private readonly settingsStore = new Store<{ preventSleepWhileRunning: boolean }>({
    name: "automation-settings",
    defaults: { preventSleepWhileRunning: false },
  });
  private readonly runners = new Map<string, AutomationRunner>();
  private readonly recoveredConnections = new Set<string>();
  private scanTimer: ReturnType<typeof setInterval> | null = null;
  private scanPromise: Promise<void> | null = null;
  private unsubscribeEvent: (() => void) | null = null;
  private unsubscribeStatus: (() => void) | null = null;
  private unsubscribeDisposed: (() => void) | null = null;
  private openTarget: OpenTarget | null = null;
  private pendingNotificationTarget: AutomationNotificationTarget | null = null;
  private readonly attentionNotificationKeys = new Set<string>();
  private powerSaveBlockerID: number | null = null;
  private started = false;
  private stopping = false;

  async start(): Promise<void> {
    if (this.started) return;
    this.started = true;
    this.stopping = false;
    const { definitions, errors } = await this.registry.load();
    for (const error of errors) log.warn("Automation definition was not loaded", { error });
    const now = Date.now();
    for (const definition of definitions) {
      const current = this.repository.automation(definition.id);
      const unchanged = current?.updatedAt === definition.updatedAt;
      this.repository.synchronizeDefinition(
        definition,
        current?.definitionVersion ?? 1,
        unchanged && current ? current.nextRunAt : initialNextRun(definition.trigger, now),
      );
    }
    this.repository.reconcileDefinitionFiles(
      definitions.map((definition) => definition.id),
      errors.map((error) => error.id),
      now,
    );
    this.unsubscribeEvent = openCodeRuntime.onScopedEvent((event, runtime) =>
      this.onOpenCodeEvent(event, runtime),
    );
    this.unsubscribeStatus = openCodeRuntime.onRuntimeStatus((runtime) => {
      if (!runtime.connected) this.recoveredConnections.delete(runtime.connectionID);
      if (
        !runtime.connected ||
        !runtime.capabilities?.scheduledAutomations ||
        this.stopping ||
        this.recoveredConnections.has(runtime.connectionID)
      )
        return;
      this.recoverProfile(runtime);
      void this.scan();
      this.changed(runtime.profileID);
    });
    this.unsubscribeDisposed = openCodeRuntime.onConnectionDisposed((connectionID) => {
      const runner = this.runners.get(connectionID);
      this.runners.delete(connectionID);
      this.recoveredConnections.delete(connectionID);
      void runner?.shutdown();
    });
    powerMonitor.on("resume", this.onResume);
    this.scanTimer = setInterval(() => void this.scan(), SCAN_INTERVAL_MS);
    await this.recoverRuns();
    await this.scan();
    this.syncPowerSaveBlocker();
  }

  async shutdown(): Promise<void> {
    if (!this.started) return;
    this.stopping = true;
    if (this.scanTimer) clearInterval(this.scanTimer);
    this.scanTimer = null;
    this.unsubscribeEvent?.();
    this.unsubscribeStatus?.();
    this.unsubscribeDisposed?.();
    this.unsubscribeEvent = null;
    this.unsubscribeStatus = null;
    this.unsubscribeDisposed = null;
    powerMonitor.off("resume", this.onResume);
    await Promise.all([...this.runners.values()].map((runner) => runner.shutdown()));
    this.runners.clear();
    this.recoveredConnections.clear();
    await this.scanPromise?.catch(() => undefined);
    this.stopPowerSaveBlocker();
    this.started = false;
  }

  setOpenTarget(handler: OpenTarget): void {
    this.openTarget = handler;
  }

  takeNotificationTarget(): AutomationNotificationTarget | null {
    const target = this.pendingNotificationTarget;
    this.pendingNotificationTarget = null;
    return target;
  }

  settings(): AutomationHostSettings {
    return {
      launchAtLogin: app.getLoginItemSettings().openAtLogin,
      preventSleepWhileRunning: this.settingsStore.get("preventSleepWhileRunning"),
    };
  }

  updateSettings(settings: AutomationHostSettings): AutomationHostSettings {
    app.setLoginItemSettings({ openAtLogin: settings.launchAtLogin });
    this.settingsStore.set("preventSleepWhileRunning", settings.preventSleepWhileRunning);
    this.syncPowerSaveBlocker();
    return this.settings();
  }

  load(profileID: string): AutomationSnapshot {
    return { profileID, ...this.repository.load(profileID) };
  }

  preview(trigger: AutomationTrigger): AutomationSchedulePreview {
    return schedulePreview(trigger);
  }

  async dispatch(command: AutomationCommand): Promise<AutomationSnapshot> {
    if (
      command.type === "create" ||
      command.type === "resume" ||
      (command.type === "update" && command.draft.status === "active")
    ) {
      this.requireScheduledAutomations(command.profileID);
    }
    if (command.type === "run-now") this.requireManualAutomations(command.profileID);
    if (
      (command.type === "create" || command.type === "update") &&
      !this.destinationSupported(command.profileID, command.draft)
    ) {
      throw new AutomationConfigurationError(
        "This scheduled task uses a workspace mode that is unavailable for the active OpenCode server.",
      );
    }
    if (command.type === "create") await this.create(command.profileID, command.draft);
    if (command.type === "update") {
      await this.update(command.profileID, command.automationID, command.draft);
    }
    if (command.type === "pause") {
      await this.setStatus(command.profileID, command.automationID, "paused");
    }
    if (command.type === "resume") {
      await this.setStatus(command.profileID, command.automationID, "active");
    }
    if (command.type === "run-now") await this.runNow(command.profileID, command.automationID);
    if (command.type === "delete") await this.delete(command.profileID, command.automationID);
    if (command.type === "cancel-run") {
      this.requiredRun(command.runID, command.profileID);
      await this.runnerFor(command.profileID).cancel(command.runID);
    }
    if (command.type === "mark-read") {
      this.requiredRun(command.runID, command.profileID);
      this.repository.patchRun(command.runID, { readAt: Date.now() });
    }
    if (command.type === "mark-unread") {
      this.requiredRun(command.runID, command.profileID);
      this.repository.patchRun(command.runID, { readAt: null });
    }
    if (command.type === "archive-run") {
      this.requiredRun(command.runID, command.profileID);
      this.repository.patchRun(command.runID, { archivedAt: Date.now(), readAt: Date.now() });
    }
    if (command.type === "unarchive-run") {
      this.requiredRun(command.runID, command.profileID);
      this.repository.patchRun(command.runID, { archivedAt: null });
    }
    if (command.type === "mark-all-read")
      this.repository.markAllRead(command.profileID, Date.now());
    this.changed(command.profileID);
    if (command.type === "resume") void this.scan();
    return this.load(command.profileID);
  }

  private async create(profileID: string, input: AutomationDraft): Promise<void> {
    const draft = validateAutomationDraft(input);
    const now = Date.now();
    const definition: AutomationDefinition = {
      ...draft,
      version: 1,
      id: randomUUID(),
      profileID,
      createdAt: now,
      updatedAt: now,
    };
    await this.registry.write(definition);
    this.repository.synchronizeDefinition(definition, 1, initialNextRun(definition.trigger, now));
  }

  private async update(profileID: string, id: string, input: AutomationDraft): Promise<void> {
    const current = this.requiredAutomation(id);
    if (current.profileID !== profileID) throw new Error("Scheduled task profile does not match");
    const definition: AutomationDefinition = {
      ...validateAutomationDraft(input),
      version: 1,
      id,
      profileID,
      createdAt: current.createdAt,
      updatedAt: Date.now(),
    };
    await this.registry.write(definition);
    this.repository.setDefinitionState({
      definition,
      definitionVersion: current.definitionVersion + 1,
      nextRunAt:
        definition.status === "active" ? initialNextRun(definition.trigger, Date.now()) : null,
    });
    if (current.activeRunID) {
      const run = this.repository.run(current.activeRunID);
      if (run?.state === "needs-attention" && run.attention?.type === "configuration") {
        this.repository.patchRun(run.id, { state: "pending", attention: null, error: null });
        void this.runnerFor(profileID).execute(run.id);
      }
    }
  }

  private async setStatus(
    profileID: string,
    id: string,
    status: "active" | "paused",
  ): Promise<void> {
    const current = this.requiredAutomation(id, profileID);
    const definition: AutomationDefinition = {
      ...definitionFromRecord(current),
      status,
      updatedAt: Date.now(),
    };
    await this.registry.write(definition);
    this.repository.setDefinitionState({
      definition,
      definitionVersion: current.definitionVersion + 1,
      nextRunAt: status === "active" ? initialNextRun(definition.trigger, Date.now()) : null,
    });
  }

  private async delete(profileID: string, id: string): Promise<void> {
    const current = this.requiredAutomation(id, profileID);
    if (current.activeRunID) await this.registry.tombstone(id);
    else await this.registry.remove(id);
    this.repository.deleteDefinition(id, Date.now());
    if (!current.activeRunID) return;
    const run = this.repository.run(current.activeRunID);
    if (
      run &&
      !isTerminalRun(run) &&
      ![...this.runners.values()].some((runner) => runner.isExecuting(run.id))
    ) {
      this.repository.finishRun(run.id, id, {
        state: "cancelled",
        completedAt: Date.now(),
        summary: "The automation was deleted before this run started.",
        error: { code: "automation_deleted", message: "The automation was deleted." },
      });
    }
    const retained = this.repository.run(current.activeRunID);
    if (!retained || isTerminalRun(retained)) await this.registry.remove(id);
  }

  private async runNow(profileID: string, id: string): Promise<void> {
    const record = this.requiredAutomation(id, profileID);
    if (!this.destinationSupported(profileID, record)) {
      throw new AutomationConfigurationError(
        "This scheduled task uses a workspace mode that is unavailable for the active OpenCode server.",
      );
    }
    if (record.activeRunID) return;
    const definition = definitionFromRecord(record);
    const run = this.repository.createRun({
      id: randomUUID(),
      definition,
      definitionVersion: record.definitionVersion,
      trigger: "manual",
      scheduledFor: Date.now(),
      occurrenceKey: `${definition.id}:manual:${randomUUID()}`,
    });
    if (run) void this.runnerFor(profileID).execute(run.id);
  }

  private async scan(): Promise<void> {
    if (this.stopping) return;
    if (this.scanPromise) return this.scanPromise;
    this.scanPromise = this.performScan().finally(() => {
      this.scanPromise = null;
    });
    return this.scanPromise;
  }

  private async performScan(): Promise<void> {
    for (const runtime of openCodeRuntime.listRuntimes()) {
      if (!runtime.connected || !runtime.capabilities?.scheduledAutomations) continue;
      this.scanProfile(runtime.profileID);
    }
  }

  private scanProfile(profileID: string): void {
    const supportedProfiles = new Set(
      openCodeRuntime
        .listRuntimes()
        .filter((runtime) => runtime.connected && runtime.capabilities?.scheduledAutomations)
        .map((runtime) => runtime.profileID),
    );
    const activeCount = this.repository
      .activeRuns()
      .filter((run) => supportedProfiles.has(run.profileID)).length;
    const capacity = Math.max(0, MAX_CONCURRENT_RUNS - activeCount);
    if (!capacity) return;
    const now = Date.now();
    for (const definition of this.repository.due(profileID, now, capacity)) {
      const scheduledFor = definition.nextRunAt;
      if (scheduledFor === null) continue;
      const record = definition;
      const definitionValue = definitionFromRecord(record);
      const overdueAge = Math.max(0, now - scheduledFor);
      const maxAge =
        definitionValue.trigger.type === "once"
          ? ONE_TIME_CATCH_UP_AGE_MS
          : definitionValue.missedRuns.type === "catch-up-once"
            ? definitionValue.missedRuns.maxAgeMs
            : 0;
      const nextRunAt = advanceNextRun(definitionValue.trigger, now);
      const missed = isMissedAutomationOccurrence(overdueAge, SCAN_INTERVAL_MS);
      const shouldSkip =
        (definitionValue.trigger.type === "recurring" &&
          definitionValue.missedRuns.type === "skip" &&
          missed) ||
        overdueAge > maxAge;
      const run = this.repository.createRun({
        id: randomUUID(),
        definition: definitionValue,
        definitionVersion: record.definitionVersion,
        trigger: missed ? "catch-up" : "scheduled",
        scheduledFor,
        occurrenceKey: `${definition.id}:scheduled:${scheduledFor}`,
        nextRunAt,
      });
      if (!run) continue;
      if (shouldSkip) {
        const expiredOneTime =
          definitionValue.trigger.type === "once" && overdueAge > ONE_TIME_CATCH_UP_AGE_MS;
        const finished = this.repository.finishRun(run.id, definition.id, {
          state: expiredOneTime ? "unknown" : "skipped",
          completedAt: now,
          summary: expiredOneTime
            ? "This one-time run expired while Palot was unavailable."
            : overdueOccurrenceCount(definitionValue.trigger, scheduledFor, now) > 1
              ? "Missed occurrences were skipped."
              : "The missed occurrence was skipped.",
          error: expiredOneTime
            ? {
                code: "missed_one_time_run",
                message: "Review or run this task manually; it was more than seven days late.",
              }
            : null,
        });
        this.changed(definitionValue.profileID);
        if (finished && expiredOneTime) this.runFinished(finished, definitionValue);
        continue;
      }
      void this.runnerFor(profileID).execute(run.id);
    }
  }

  private async recoverRuns(): Promise<void> {
    if (this.stopping) return;
    for (const runtime of openCodeRuntime.listRuntimes()) {
      this.recoverProfile(runtime);
    }
  }

  private recoverProfile(runtime: OpenCodeRuntimeStatus): void {
    if (!runtime.connected || !runtime.capabilities?.scheduledAutomations) return;
    this.recoveredConnections.add(runtime.connectionID);
    const runner = this.runnerFor(runtime.profileID);
    for (const run of this.repository.activeRuns(runtime.profileID)) void runner.recover(run);
  }

  private onOpenCodeEvent(event: OpenCodeEvent, runtime: OpenCodeRuntimeStatus): void {
    const runner = this.runners.get(runtime.connectionID);
    if (!runner) return;
    runner.onEvent(event);
    const sessionID = eventSessionID(event);
    if (!sessionID) return;
    const runID = runner.runIDForSession(sessionID);
    const run = runID ? this.repository.run(runID) : null;
    if (run?.state === "needs-attention") this.notifyAttention(run);
  }

  private runtime(profileID: string): OpenCodeRuntimeStatus {
    const runtime = openCodeRuntime
      .listRuntimes()
      .find((value) => value.profileID === profileID && value.connected);
    if (!runtime)
      throw new AutomationConfigurationError("The scheduled task's server is not connected.");
    return runtime;
  }

  private runnerFor(profileID: string): AutomationRunner {
    const runtime = this.runtime(profileID);
    const existing = this.runners.get(runtime.connectionID);
    if (existing) return existing;
    const owner = openCodeRuntime.scopedConnection(runtime.connectionID);
    const runner = new AutomationRunner({
      client: () => owner.withClient((client) => this.checkedClient(client)),
      repository: this.repository,
      memory: { ensure: (automationID) => this.registry.ensureMemory(automationID) },
      capabilities: () => ({
        localPathActions: owner.runtimeStatus().capabilities?.localPathActions ?? false,
        worktreeCreate: owner.runtimeStatus().capabilities?.worktreeCreate ?? false,
      }),
      onChanged: () => this.changed(profileID),
      onFinished: (run, definition) => this.runFinished(run, definition),
      onAttention: (run, definition) => void this.runNeedsAttention(run, definition),
    });
    this.runners.set(runtime.connectionID, runner);
    return runner;
  }

  private async checkedClient(client: OpenCodeClient): Promise<OpenCodeClient> {
    const health = await client.server.info({ signal: AbortSignal.timeout(30_000) });
    if (!isSupportedOpenCodeVersion(health.version)) {
      throw new AutomationConfigurationError(
        "Scheduled tasks require stable OpenCode 2.0.7 or newer within 2.x.",
      );
    }
    return client;
  }

  private requireScheduledAutomations(profileID: string): void {
    if (!this.runtime(profileID).capabilities?.scheduledAutomations) {
      throw new AutomationConfigurationError(
        "Scheduled tasks are paused for the active OpenCode server.",
      );
    }
  }

  private requireManualAutomations(profileID: string): void {
    if (!this.runtime(profileID).capabilities?.manualAutomations) {
      throw new AutomationConfigurationError(
        "Manual scheduled-task runs are unavailable for the active OpenCode server.",
      );
    }
  }

  private destinationSupported(
    profileID: string,
    definition: Pick<AutomationDefinition | AutomationDraft, "destination">,
  ): boolean {
    const capabilities = this.runtime(profileID).capabilities;
    if (!capabilities || definition.destination.type === "session") return true;
    if (definition.destination.workspace.type === "new-worktree")
      return capabilities.worktreeCreate;
    return true;
  }

  private requiredAutomation(id: string, profileID?: string): AutomationRecord {
    const value = this.repository.automation(id);
    if (!value) throw new Error("Scheduled task was not found");
    if (profileID && value.profileID !== profileID) {
      throw new Error("Scheduled task profile does not match");
    }
    return value;
  }

  private requiredRun(id: string, profileID: string): AutomationRun {
    const value = this.repository.run(id);
    if (!value) throw new Error("Scheduled run was not found");
    if (value.profileID !== profileID) throw new Error("Scheduled run profile does not match");
    return value;
  }

  private runFinished(run: AutomationRun, definition: AutomationDefinition): void {
    if (!this.repository.automation(definition.id)) {
      void this.registry
        .remove(definition.id)
        .catch((error) => log.warn("Deleted automation files were not cleaned up", { error }));
    }
    void this.scan();
    const failure = ["failed", "interrupted", "unknown"].includes(run.state);
    const shouldNotify =
      definition.notifications === "all-runs" ||
      (definition.notifications === "failures-only" && failure) ||
      (definition.notifications === "background-only" &&
        !BrowserWindow.getAllWindows().some((window) => window.isFocused()));
    if (!shouldNotify) {
      if (run.state === "succeeded") {
        this.repository.patchRun(run.id, { readAt: Date.now() });
        this.changed(run.profileID);
      }
      return;
    }
    this.showNotification(
      run,
      run.state === "succeeded" ? `${definition.name} is ready` : `${definition.name} needs review`,
      "Open the scheduled run in Palot.",
    );
  }

  private async runNeedsAttention(
    run: AutomationRun,
    definition: AutomationDefinition,
  ): Promise<void> {
    const current = this.repository.automation(definition.id);
    if (!current) {
      this.repository.finishRun(run.id, definition.id, {
        state: "cancelled",
        completedAt: Date.now(),
        summary: "The automation was deleted while this run was waiting to start.",
        error: { code: "automation_deleted", message: "The automation was deleted." },
      });
      await this.registry.remove(definition.id);
      this.changed(run.profileID);
      return;
    }
    if (current && current.consecutiveStartFailures >= 3 && current.status === "active") {
      const paused: AutomationDefinition = {
        ...definitionFromRecord(current),
        status: "paused",
        updatedAt: Date.now(),
      };
      await this.registry.write(paused);
      this.repository.setDefinitionState({
        definition: paused,
        definitionVersion: current.definitionVersion + 1,
        nextRunAt: null,
      });
      this.changed(run.profileID);
    }
    this.notifyAttention(run);
  }

  private notifyAttention(run: AutomationRun): void {
    const definition = this.repository.runDefinition(run.id);
    if (!definition) return;
    const key = `${run.id}:${run.attention?.type ?? "unknown"}:${run.attention?.requestID ?? "none"}`;
    if (this.attentionNotificationKeys.has(key)) return;
    this.attentionNotificationKeys.add(key);
    this.showNotification(
      run,
      `${definition.name} needs your attention`,
      run.attention?.message ?? "Open the scheduled run in Palot.",
    );
  }

  private showNotification(run: AutomationRun, title: string, body: string): void {
    if (!Notification.isSupported()) return;
    const notification = new Notification({ title, body });
    notification.on("click", () => {
      this.repository.patchRun(run.id, { readAt: Date.now() });
      this.changed(run.profileID);
      const target = {
        profileID: run.profileID,
        automationID: run.automationID,
        runID: run.id,
        sessionID: run.attention?.sessionID ?? run.rootSessionID,
        requestID: run.attention?.requestID ?? null,
        requestType:
          run.attention?.type === "permission" ||
          run.attention?.type === "form" ||
          run.attention?.type === "question"
            ? run.attention.type
            : null,
      };
      this.pendingNotificationTarget = target;
      void this.openTarget?.(target);
    });
    notification.show();
  }

  private changed(profileID: string): void {
    this.syncPowerSaveBlocker();
    const event: AutomationChangedEvent = { profileID };
    for (const window of BrowserWindow.getAllWindows()) {
      if (!window.isDestroyed()) {
        window.webContents.send(IPC_CHANNELS.automationChanged, event);
      }
    }
  }

  private readonly onResume = () => {
    void this.scan();
  };

  private syncPowerSaveBlocker(): void {
    const shouldBlock =
      this.settingsStore.get("preventSleepWhileRunning") &&
      this.repository
        .activeRuns()
        .some((run) =>
          ["pending", "preparing", "queued", "running", "settling"].includes(run.state),
        );
    if (shouldBlock && this.powerSaveBlockerID === null) {
      this.powerSaveBlockerID = powerSaveBlocker.start("prevent-app-suspension");
      return;
    }
    if (!shouldBlock) this.stopPowerSaveBlocker();
  }

  private stopPowerSaveBlocker(): void {
    if (this.powerSaveBlockerID === null) return;
    if (powerSaveBlocker.isStarted(this.powerSaveBlockerID)) {
      powerSaveBlocker.stop(this.powerSaveBlockerID);
    }
    this.powerSaveBlockerID = null;
  }
}

function isTerminalRun(run: AutomationRun): boolean {
  return ["succeeded", "failed", "interrupted", "cancelled", "skipped", "unknown"].includes(
    run.state,
  );
}

let service: AutomationService | null = null;

export function automationService(): AutomationService {
  return (service ??= new AutomationService());
}

function definitionFromRecord(record: AutomationRecord): AutomationDefinition {
  return {
    version: record.version,
    id: record.id,
    profileID: record.profileID,
    name: record.name,
    status: record.status,
    action: record.action,
    destination: record.destination,
    trigger: record.trigger,
    missedRuns: record.missedRuns,
    notifications: record.notifications,
    createdFromSessionID: record.createdFromSessionID,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  };
}

function eventSessionID(event: OpenCodeEvent): string | null {
  if ("sessionID" in event.data && typeof event.data.sessionID === "string") {
    return event.data.sessionID;
  }
  const form = "form" in event.data ? event.data.form : undefined;
  if (form && typeof form === "object" && "sessionID" in form) {
    return typeof form.sessionID === "string" ? form.sessionID : null;
  }
  return null;
}
