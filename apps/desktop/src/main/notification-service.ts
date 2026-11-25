import type { OpenCodeClient, OpenCodeEvent } from "@opencode/client";
import { BrowserWindow, Notification, shell } from "electron";
import log from "electron-log/main";
import Store from "electron-store";
import {
  DEFAULT_DESKTOP_NOTIFICATION_SETTINGS,
  type AttentionNotificationInput,
  type DesktopNotificationDeliveryStatus,
  type DesktopNotificationSettings,
  type OpenCodeRuntimeStatus,
} from "../shared/opencode-contract";
import { desktopNavigation } from "./desktop-navigation";
import {
  macosNotificationDeliveryStatus,
  requestMacosNotificationPermission,
} from "./macos-notification-permission";
import {
  createFamilyCompletionTracker,
  type FamilyCompletion,
  type FamilyCompletionTracker,
} from "../shared/family-completion";
import { attentionCandidate, shouldShowCompletionNotification } from "./notification-policy";
import { openCodeRuntime } from "./opencode-runtime";

const REQUEST_TIMEOUT_MS = 30_000;
const MAX_FAMILY_DEPTH = 16;
const FAMILY_EVENTS = new Set([
  "session.created",
  "session.inbox.enqueued",
  "session.inbox.delivered",
  "session.execution.started",
  "session.execution.succeeded",
  "session.execution.failed",
  "session.execution.interrupted",
]);

interface KnownSession {
  parentID: string | null;
  title: string | null;
}

/** One connection's task families, so a task notifies once when it and its subagents finish. */
interface ConnectionFamilies {
  runtime: OpenCodeRuntimeStatus;
  sessions: Map<string, KnownSession>;
  tracker: FamilyCompletionTracker;
  queue: Promise<void>;
}
const MACOS_NOTIFICATION_SETTINGS_URL =
  "x-apple.systempreferences:com.apple.Notifications-Settings.extension";

class DesktopNotificationService {
  private readonly store = new Store<DesktopNotificationSettings>({
    name: "notifications",
    defaults: DEFAULT_DESKTOP_NOTIFICATION_SETTINGS,
  });
  private readonly shownKeys = new Set<string>();
  private readonly families = new Map<string, ConnectionFamilies>();
  private unsubscribe: (() => void) | null = null;
  private bundleIdentifier = "dev.palot.desktop";

  configure(bundleIdentifier: string): void {
    this.bundleIdentifier = bundleIdentifier;
  }

  start(): void {
    if (this.unsubscribe) return;
    this.unsubscribe = openCodeRuntime.onScopedEvent((event, runtime) =>
      this.handleEvent(event, runtime),
    );
  }

  shutdown(): void {
    this.unsubscribe?.();
    this.unsubscribe = null;
    this.shownKeys.clear();
    for (const families of this.families.values()) families.tracker.reset();
    this.families.clear();
  }

  settings(): DesktopNotificationSettings {
    return {
      turnCompletion: this.store.get("turnCompletion"),
      permissionRequests: this.store.get("permissionRequests"),
      questionRequests: this.store.get("questionRequests"),
    };
  }

  updateSettings(settings: DesktopNotificationSettings): DesktopNotificationSettings {
    this.store.set(settings);
    return this.settings();
  }

  async deliveryStatus(): Promise<DesktopNotificationDeliveryStatus> {
    if (process.platform !== "darwin" || !Notification.isSupported()) {
      return { authorization: "unavailable", delivery: "unknown" };
    }
    try {
      return await macosNotificationDeliveryStatus();
    } catch (error) {
      log.warn("Could not inspect macOS notification delivery", error);
      return { authorization: "unavailable", delivery: "unknown" };
    }
  }

  async requestPermission(): Promise<DesktopNotificationDeliveryStatus> {
    if (process.platform !== "darwin") return this.deliveryStatus();
    await requestMacosNotificationPermission();
    return this.deliveryStatus();
  }

  async openSystemSettings(): Promise<void> {
    if (process.platform !== "darwin") return;
    const url = `${MACOS_NOTIFICATION_SETTINGS_URL}?id=${encodeURIComponent(this.bundleIdentifier)}`;
    await shell.openExternal(url);
  }

  sendTest(): void {
    this.show("Palot is ready", "Future task updates can reach you here.", {
      type: "notification-settings",
    });
  }

  notifyAttention(input: AttentionNotificationInput, profileID: string): void {
    const settings = this.settings();
    const enabled =
      input.type === "permission" ? settings.permissionRequests : settings.questionRequests;
    if (!enabled) return;
    const key = `attention:${profileID}:${input.sessionID}:${input.type}:${input.requestID}`;
    if (!this.claim(key)) return;
    const permission = input.type === "permission";
    this.show(
      permission ? "Permission required" : "Palot needs your input",
      permission
        ? "A task is waiting for permission to continue."
        : "A task is waiting for your answer to continue.",
      {
        type: "session",
        profileID,
        sessionID: input.sessionID,
        requestID: input.requestID,
        requestType: input.type,
      },
    );
  }

  private handleEvent(event: OpenCodeEvent, runtime: OpenCodeRuntimeStatus): void {
    if (!runtime.connected) return;
    const attention = attentionCandidate(event);
    if (attention) this.notifyAttention(attention, runtime.profileID);
    if (!FAMILY_EVENTS.has(event.type)) return;
    const families = this.familiesFor(runtime);
    families.runtime = runtime;
    // In order, after the parents the event needs are known.
    families.queue = families.queue
      .then(() => this.trackFamilyEvent(families, event))
      .catch((error) => log.warn("Could not track a task's completion", error));
  }

  private familiesFor(runtime: OpenCodeRuntimeStatus): ConnectionFamilies {
    const existing = this.families.get(runtime.connectionID);
    if (existing) return existing;
    const sessions = new Map<string, KnownSession>();
    const families: ConnectionFamilies = {
      runtime,
      sessions,
      queue: Promise.resolve(),
      tracker: createFamilyCompletionTracker({
        parentOf: (sessionID) => sessions.get(sessionID)?.parentID,
        onFinished: (completion) => {
          families.queue = families.queue
            .then(() => this.notifyCompletion(families, completion))
            .catch((error) => log.warn("Could not show a completion notification", error));
        },
      }),
    };
    this.families.set(runtime.connectionID, families);
    return families;
  }

  private async trackFamilyEvent(families: ConnectionFamilies, event: OpenCodeEvent) {
    const data = event.data as { sessionID?: unknown; parentID?: unknown };
    const sessionID = typeof data.sessionID === "string" ? data.sessionID : null;
    if (!sessionID) return;
    if (event.type === "session.created") {
      families.sessions.set(sessionID, {
        parentID: typeof data.parentID === "string" ? data.parentID : null,
        title: null,
      });
      return;
    }
    if (
      event.type === "session.execution.succeeded" ||
      event.type === "session.execution.failed" ||
      event.type === "session.execution.started"
    ) {
      await this.resolveFamily(families, sessionID);
    }
    const created = (event as { created?: unknown }).created;
    families.tracker.handle({
      id: event.id,
      type: event.type,
      data: event.data,
      ...(typeof created === "number" ? { createdAt: created } : {}),
    });
  }

  /** Loads the session and its ancestors the first time an event names them. */
  private async resolveFamily(families: ConnectionFamilies, sessionID: string) {
    let current: string | null = sessionID;
    for (let depth = 0; current && depth < MAX_FAMILY_DEPTH; depth++) {
      const known = families.sessions.get(current);
      if (known && (known.title !== null || known.parentID !== null)) {
        current = known.parentID;
        continue;
      }
      const sessionInfo = await this.connectionClient(families.runtime.connectionID, (client) =>
        client.session.get(
          { sessionID: current! },
          { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) },
        ),
      );
      const parentID = sessionInfo?.parentID ?? known?.parentID ?? null;
      families.sessions.set(current, { parentID, title: sessionInfo?.title?.trim() || null });
      current = parentID;
    }
  }

  private async connectionClient<T>(
    connectionID: string,
    operation: (client: OpenCodeClient) => Promise<T>,
  ): Promise<T | null> {
    try {
      return await openCodeRuntime.scopedConnection(connectionID).withClient(operation);
    } catch {
      return null;
    }
  }

  /**
   * A task and its subagents went idle. One notification per busy period: a subagent's later
   * report wakes the task into a new period only after this one has ended.
   */
  /**
   * A watched pull request became ready to merge. Shown once per readiness (the watch dedupes),
   * under the same setting as finished tasks; merging is the person's call, so it says so.
   */
  notifyPullRequestReady(input: {
    profileID: string;
    sessionID: string;
    number: number;
    title: string;
  }): void {
    const focused = BrowserWindow.getAllWindows().some((window) => window.isFocused());
    if (!shouldShowCompletionNotification(this.settings(), focused)) return;
    this.show(
      `PR #${input.number} is ready to merge`,
      `${input.title ? `${input.title}. ` : ""}Checks pass and review is answered. Merging is up to you.`,
      { type: "session", profileID: input.profileID, sessionID: input.sessionID },
    );
  }

  private async notifyCompletion(families: ConnectionFamilies, completion: FamilyCompletion) {
    if (completion.outcome === "interrupted") return;
    const runtime = families.runtime;
    const settings = this.settings();
    const focused = BrowserWindow.getAllWindows().some((window) => window.isFocused());
    if (!shouldShowCompletionNotification(settings, focused)) return;
    if (families.sessions.get(completion.rootID)?.parentID) return;
    // The event stream can miss a run that started before Palot connected.
    const active = await this.connectionClient(runtime.connectionID, (client) =>
      client.session.active({ signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) }),
    );
    const running: string[] = [];
    for (const sessionID of Object.keys(active ?? {})) {
      await this.resolveFamily(families, sessionID);
      if (families.tracker.rootOf(sessionID) === completion.rootID) running.push(sessionID);
    }
    if (running.length > 0) {
      families.tracker.seedActive(running);
      return;
    }
    if (!this.claim(`completion:${runtime.profileID}:${completion.eventID}`)) return;
    let owner: ReturnType<typeof openCodeRuntime.scopedConnection>;
    try {
      owner = openCodeRuntime.scopedConnection(runtime.connectionID);
      if (!owner.runtimeStatus().connected) return;
    } catch {
      return;
    }
    const name = families.sessions.get(completion.rootID)?.title || "Task";
    this.show(
      completion.outcome === "succeeded" ? `${name} finished` : `${name} failed`,
      completion.outcome === "succeeded"
        ? "Open Palot to review the result."
        : (completion.error ?? "Open Palot to review what went wrong."),
      { type: "session", profileID: runtime.profileID, sessionID: completion.rootID },
    );
  }

  private claim(key: string): boolean {
    if (this.shownKeys.has(key)) return false;
    this.shownKeys.add(key);
    if (this.shownKeys.size > 2_000) this.shownKeys.delete(this.shownKeys.values().next().value!);
    return true;
  }

  private show(
    title: string,
    body: string,
    target: Parameters<typeof desktopNavigation.request>[0],
  ): void {
    if (!Notification.isSupported()) return;
    const notification = new Notification({ title, body });
    notification.on("click", () => desktopNavigation.request(target));
    notification.show();
  }
}

let service: DesktopNotificationService | null = null;

export function desktopNotificationService(): DesktopNotificationService {
  return (service ??= new DesktopNotificationService());
}
