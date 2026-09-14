import type { OpenCodeEvent } from "@opencode/client";
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
  attentionCandidate,
  completionCandidate,
  shouldShowCompletionNotification,
} from "./notification-policy";
import { openCodeRuntime } from "./opencode-runtime";

const REQUEST_TIMEOUT_MS = 30_000;
const MACOS_NOTIFICATION_SETTINGS_URL =
  "x-apple.systempreferences:com.apple.Notifications-Settings.extension";

class DesktopNotificationService {
  private readonly store = new Store<DesktopNotificationSettings>({
    name: "notifications",
    defaults: DEFAULT_DESKTOP_NOTIFICATION_SETTINGS,
  });
  private readonly shownKeys = new Set<string>();
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
    const completion = completionCandidate(event);
    if (completion) void this.notifyCompletion(completion, runtime);
  }

  private async notifyCompletion(
    candidate: NonNullable<ReturnType<typeof completionCandidate>>,
    runtime: OpenCodeRuntimeStatus,
  ): Promise<void> {
    const settings = this.settings();
    const focused = BrowserWindow.getAllWindows().some((window) => window.isFocused());
    if (!shouldShowCompletionNotification(settings, focused)) return;
    if (!this.claim(`completion:${runtime.profileID}:${candidate.eventID}`)) return;
    let owner: ReturnType<typeof openCodeRuntime.scopedConnection>;
    try {
      owner = openCodeRuntime.scopedConnection(runtime.connectionID);
    } catch {
      return;
    }
    const session = await owner
      .withClient((client) =>
        client.session.get(
          { sessionID: candidate.sessionID },
          { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) },
        ),
      )
      .catch(() => null);
    try {
      if (!owner.runtimeStatus().connected) return;
    } catch {
      return;
    }
    if (session?.parentID) return;
    const name = session?.title?.trim() || "Task";
    this.show(
      candidate.outcome === "succeeded" ? `${name} finished` : `${name} failed`,
      candidate.outcome === "succeeded"
        ? "Open Palot to review the result."
        : (candidate.error ?? "Open Palot to review what went wrong."),
      { type: "session", profileID: runtime.profileID, sessionID: candidate.sessionID },
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
