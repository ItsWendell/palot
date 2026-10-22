/**
 * Main-process side of voice chat. One workspace window hosts the call; main mirrors its
 * snapshot to the floating overlay, keeps the display awake, and routes overlay, lock-screen
 * and global-shortcut commands back to the host.
 */

import { existsSync } from "node:fs";
import path from "node:path";
import {
  app,
  BrowserWindow,
  globalShortcut,
  powerMonitor,
  powerSaveBlocker,
  screen,
  systemPreferences,
  type IpcMainInvokeEvent,
} from "electron";
import log from "electron-log/main";
import {
  IDLE_VOICE_CALL_SNAPSHOT,
  VOICE_IPC_CHANNELS,
  type VoiceAudioLevels,
  type VoiceCallSnapshot,
  type VoiceClaimResult,
  type VoiceHostCommand,
  type VoiceHostPreferences,
  type VoiceHostPreferencesResult,
  type VoiceMicrophoneAccess,
  type VoiceOverlayCommand,
} from "../../shared/voice-contract";
import { registerTrustedIpcHandler } from "../ipc-security";
import { createVoiceOverlayWindow } from "./voice-overlay-window";
import {
  claimGranted,
  decideHostState,
  isCallLive,
  keepsDisplayAwake,
  overlayPosition,
  parseVoiceLevels,
  parseVoiceOverlayCommand,
  parseVoicePreferences,
  parseVoiceSnapshot,
  shouldShowOverlay,
} from "./voice-policy";

export interface VoiceHostOptions {
  /** Whether `window` is a trusted Palot workspace window. */
  isWorkspaceWindow: (window: BrowserWindow) => boolean;
  /** Shortcut target when no host exists and no workspace window has been focused. */
  fallbackWindow: () => BrowserWindow | null;
  overlayEntryUrl: string;
  overlayPreload: string;
}

type Register = (
  channel: string,
  handler: (event: IpcMainInvokeEvent, ...args: unknown[]) => unknown,
) => void;

function alive(window: BrowserWindow | null): window is BrowserWindow {
  return Boolean(window && !window.isDestroyed() && !window.webContents.isDestroyed());
}

export class VoiceHost {
  private host: BrowserWindow | null = null;
  private detachHost: (() => void) | null = null;
  private snapshot: VoiceCallSnapshot = IDLE_VOICE_CALL_SNAPSHOT;
  private overlayEnabled = true;
  private shortcut: string | null = null;
  private displayBlocker: number | null = null;
  /** The host whose renderer throttling is lifted for the call, so audio levels keep flowing while hidden. */
  private unthrottled: BrowserWindow | null = null;
  private lastFocused: BrowserWindow | null = null;
  private overlay: BrowserWindow | null = null;
  private overlayPainted = false;
  private overlayDismissed = false;
  /** User-dragged overlay position, remembered for this app session only. */
  private overlayDragged: { x: number; y: number } | null = null;
  private readonly cleanups: Array<() => void> = [];

  constructor(private readonly options: VoiceHostOptions) {}

  start(): void {
    const onFocus = (_event: unknown, window: BrowserWindow) => {
      if (this.options.isWorkspaceWindow(window)) this.lastFocused = window;
    };
    const onLock = () => {
      if (isCallLive(this.snapshot.phase)) this.sendHost({ type: "end" });
    };
    app.on("browser-window-focus", onFocus);
    powerMonitor.on("lock-screen", onLock);
    this.cleanups.push(
      () => app.removeListener("browser-window-focus", onFocus),
      () => powerMonitor.removeListener("lock-screen", onLock),
    );
    const overlayTrust = {
      expectedWindow: () => this.overlay,
      expectedUrl: this.options.overlayEntryUrl,
      expectedRole: "voice-overlay" as const,
    };
    registerTrustedIpcHandler(VOICE_IPC_CHANNELS.overlayReady, overlayTrust, () => this.snapshot);
    registerTrustedIpcHandler(VOICE_IPC_CHANNELS.overlayCommand, overlayTrust, (_event, input) =>
      this.overlayCommand(parseVoiceOverlayCommand(input)),
    );
  }

  claim(window: BrowserWindow): VoiceClaimResult {
    const current = alive(this.host)
      ? { sender: this.host === window, alive: true, phase: this.snapshot.phase }
      : null;
    if (!claimGranted(current)) return { granted: false };
    if (this.host !== window) {
      this.release();
      this.attachHost(window);
    }
    return { granted: true };
  }

  publishState(window: BrowserWindow, snapshot: VoiceCallSnapshot): void {
    const decision = decideHostState(alive(this.host) && this.host === window, snapshot.phase);
    if (decision === "ignore") return;
    if (decision === "release") {
      this.release();
      return;
    }
    this.snapshot = snapshot;
    this.updateDisplayBlocker();
    this.sendOverlay(VOICE_IPC_CHANNELS.overlayState, snapshot);
    this.updateOverlay();
  }

  publishLevels(window: BrowserWindow, levels: VoiceAudioLevels): void {
    if (this.host !== window || !this.overlay?.isVisible()) return;
    this.sendOverlay(VOICE_IPC_CHANNELS.overlayLevels, levels);
  }

  configure(preferences: VoiceHostPreferences): VoiceHostPreferencesResult {
    this.overlayEnabled = preferences.overlay;
    const globalShortcutRegistered = this.registerShortcut(preferences.globalShortcut);
    this.updateOverlay();
    return { globalShortcutRegistered };
  }

  async requestMicrophoneAccess(): Promise<VoiceMicrophoneAccess> {
    // Windows and Linux have no app-level prompt; Chromium's permission policy decides.
    if (process.platform !== "darwin") return "granted";
    const status = systemPreferences.getMediaAccessStatus("microphone");
    if (status !== "not-determined") return status;
    try {
      return (await systemPreferences.askForMediaAccess("microphone")) ? "granted" : "denied";
    } catch (error) {
      log.warn("Microphone access request failed", error);
      return "unknown";
    }
  }

  shutdown(): void {
    for (const cleanup of this.cleanups.splice(0)) cleanup();
    this.registerShortcut(null);
    this.release();
  }

  private overlayCommand(command: VoiceOverlayCommand): void {
    const host = this.host;
    if (!alive(host) || !isCallLive(this.snapshot.phase)) return;
    if (command.type === "open-session") {
      if (host.isMinimized()) host.restore();
      host.show();
      if (process.platform === "darwin") app.focus({ steal: true });
      host.focus();
    }
    this.sendHost(command);
  }

  private attachHost(window: BrowserWindow): void {
    this.host = window;
    this.snapshot = IDLE_VOICE_CALL_SNAPSHOT;
    const update = () => this.updateOverlay();
    const release = () => {
      if (this.host === window) this.release();
    };
    const onNavigation = (details: { isMainFrame: boolean; isSameDocument: boolean }) => {
      if (details.isMainFrame && !details.isSameDocument) release();
    };
    const windowEvents = ["focus", "blur", "show", "hide", "minimize", "restore"] as const;
    for (const name of windowEvents) window.on(name as "focus", update);
    window.once("closed", release);
    const contents = window.webContents;
    contents.on("did-start-navigation", onNavigation);
    contents.once("render-process-gone", release);
    contents.once("destroyed", release);
    this.detachHost = () => {
      if (!window.isDestroyed()) {
        for (const name of windowEvents) window.removeListener(name as "focus", update);
        window.removeListener("closed", release);
      }
      if (!contents.isDestroyed()) {
        contents.removeListener("did-start-navigation", onNavigation);
        contents.removeListener("render-process-gone", release);
        contents.removeListener("destroyed", release);
      }
    };
  }

  private release(): void {
    this.restoreThrottling();
    this.detachHost?.();
    this.detachHost = null;
    this.host = null;
    this.snapshot = IDLE_VOICE_CALL_SNAPSHOT;
    this.overlayDismissed = false;
    this.updateDisplayBlocker();
    this.destroyOverlay();
  }

  private sendHost(command: VoiceHostCommand, target: BrowserWindow | null = this.host): void {
    if (alive(target)) target.webContents.send(VOICE_IPC_CHANNELS.hostCommand, command);
  }

  private registerShortcut(accelerator: string | null): boolean {
    if (accelerator && accelerator === this.shortcut) return true;
    if (this.shortcut) {
      try {
        globalShortcut.unregister(this.shortcut);
      } catch (error) {
        log.warn("Voice shortcut could not be unregistered", error);
      }
      this.shortcut = null;
    }
    if (!accelerator) return false;
    try {
      if (!globalShortcut.register(accelerator, () => this.toggleCall())) return false;
    } catch (error) {
      log.warn("Voice shortcut could not be registered", { accelerator, error });
      return false;
    }
    this.shortcut = accelerator;
    return true;
  }

  private toggleCall(): void {
    const lastFocused =
      alive(this.lastFocused) && this.options.isWorkspaceWindow(this.lastFocused)
        ? this.lastFocused
        : null;
    const target = alive(this.host) ? this.host : (lastFocused ?? this.options.fallbackWindow());
    this.sendHost({ type: "toggle-call" }, target);
  }

  private restoreThrottling(): void {
    const window = this.unthrottled;
    this.unthrottled = null;
    if (alive(window)) window.webContents.setBackgroundThrottling(true);
  }

  private updateDisplayBlocker(): void {
    const live = alive(this.host) && this.snapshot.phase !== "idle";
    if (live && this.unthrottled !== this.host) {
      this.restoreThrottling();
      this.host!.webContents.setBackgroundThrottling(false);
      this.unthrottled = this.host;
    } else if (!live) {
      this.restoreThrottling();
    }
    const awake = alive(this.host) && keepsDisplayAwake(this.snapshot.phase);
    if (awake && this.displayBlocker === null) {
      this.displayBlocker = powerSaveBlocker.start("prevent-display-sleep");
    } else if (!awake && this.displayBlocker !== null) {
      if (powerSaveBlocker.isStarted(this.displayBlocker)) {
        powerSaveBlocker.stop(this.displayBlocker);
      }
      this.displayBlocker = null;
    }
  }

  private updateOverlay(): void {
    const host = this.host;
    const show =
      alive(host) &&
      shouldShowOverlay({
        enabled: this.overlayEnabled,
        dismissed: this.overlayDismissed,
        phase: this.snapshot.phase,
        hostFocused: host.isFocused() && host.isVisible() && !host.isMinimized(),
      });
    if (!show) {
      if (!isCallLive(this.snapshot.phase) || !this.overlayEnabled) this.destroyOverlay();
      else if (alive(this.overlay) && this.overlay.isVisible()) this.overlay.hide();
      return;
    }
    const overlay = this.ensureOverlay(host);
    if (this.overlayPainted && !overlay.isVisible()) overlay.showInactive();
  }

  private ensureOverlay(host: BrowserWindow): BrowserWindow {
    if (alive(this.overlay)) return this.overlay;
    const position = overlayPosition({
      hostWorkArea: screen.getDisplayMatching(host.getBounds()).workArea,
      workAreas: screen.getAllDisplays().map((display) => display.workArea),
      remembered: this.overlayDragged,
    });
    const overlay = createVoiceOverlayWindow({
      entryUrl: this.options.overlayEntryUrl,
      preload: this.options.overlayPreload,
      position,
    });
    this.overlay = overlay;
    this.overlayPainted = false;
    overlay.once("ready-to-show", () => {
      if (this.overlay !== overlay) return;
      this.overlayPainted = true;
      this.updateOverlay();
    });
    const rememberPosition = () => {
      if (overlay.isDestroyed() || !overlay.isVisible()) return;
      const [x, y] = overlay.getPosition();
      if (x !== undefined && y !== undefined) this.overlayDragged = { x, y };
    };
    // Linux has no "moved" event; "move" fires during the drag there.
    if (process.platform === "linux") overlay.on("move", rememberPosition);
    else overlay.on("moved", rememberPosition);
    overlay.once("closed", () => {
      // destroyOverlay() clears the reference first, so this only runs when the window
      // manager or the user closed it. Stay hidden for the rest of this call.
      if (this.overlay !== overlay) return;
      this.overlay = null;
      this.overlayPainted = false;
      this.overlayDismissed = true;
    });
    return overlay;
  }

  private destroyOverlay(): void {
    const overlay = this.overlay;
    this.overlay = null;
    this.overlayPainted = false;
    if (overlay && !overlay.isDestroyed()) overlay.destroy();
  }

  /**
   * Pushes before the overlay subscribes are dropped; it subscribes first and then asks
   * for the current snapshot, and IPC ordering keeps that reply ahead of later pushes.
   */
  private sendOverlay(channel: string, payload: unknown): void {
    if (alive(this.overlay)) this.overlay.webContents.send(channel, payload);
  }
}

let instance: VoiceHost | null = null;

export function installVoiceHost(options: VoiceHostOptions): VoiceHost {
  instance?.shutdown();
  instance = new VoiceHost(options);
  instance.start();
  return instance;
}

export function voiceHost(): VoiceHost {
  if (!instance) throw new Error("Voice host is not installed");
  return instance;
}

export function shutdownVoiceHost(): void {
  instance?.shutdown();
  instance = null;
}

/** Host-side handlers. `register` applies the trusted workspace-window checks. */
export function registerVoiceHostIpc(register: Register, host: () => VoiceHost = voiceHost): void {
  const senderWindow = (event: IpcMainInvokeEvent) => {
    const window = BrowserWindow.fromWebContents(event.sender);
    if (!window) throw new Error("Voice host window is unavailable");
    return window;
  };
  register(VOICE_IPC_CHANNELS.hostClaim, (event) => host().claim(senderWindow(event)));
  register(VOICE_IPC_CHANNELS.hostState, (event, input) =>
    host().publishState(senderWindow(event), parseVoiceSnapshot(input)),
  );
  register(VOICE_IPC_CHANNELS.hostLevels, (event, input) =>
    host().publishLevels(senderWindow(event), parseVoiceLevels(input)),
  );
  register(VOICE_IPC_CHANNELS.hostPreferences, (_event, input) =>
    host().configure(parseVoicePreferences(input)),
  );
  register(VOICE_IPC_CHANNELS.microphoneAccess, () => host().requestMicrophoneAccess());
  register(VOICE_IPC_CHANNELS.coordinatorPlugin, () => coordinatorPluginDirectory());
}

/**
 * The voice coordinator plugin ships as plain TypeScript; OpenCode supplies its
 * `effect` and `@opencode/plugin` imports. Packaged builds carry it in resources,
 * source builds use the workspace package.
 */
export function coordinatorPluginDirectory(): string | null {
  const candidates = app.isPackaged
    ? [path.join(process.resourcesPath, "opencode-voice-coordinator")]
    : [path.resolve(app.getAppPath(), "../../packages/opencode-voice-coordinator")];
  return candidates.find((candidate) => existsSync(path.join(candidate, "server.ts"))) ?? null;
}
