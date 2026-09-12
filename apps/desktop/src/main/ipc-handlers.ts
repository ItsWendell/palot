/** Validated IPC handlers for the Palot renderer. */

import {
  app,
  BrowserWindow,
  clipboard,
  contentTracing,
  dialog,
  ipcMain,
  nativeImage,
  nativeTheme,
  shell,
  type WebContents,
  type IpcMainInvokeEvent,
} from "electron";
import { readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import * as v from "valibot";
import { allowedExternalUrl } from "./external-url-policy";
import { openDesktopDialog } from "./desktop-dialogs";
import { normalizeSshConfig } from "./ssh/config";
import { sshInteractions } from "./ssh/interaction";
import { IPC_CHANNELS } from "../shared/opencode-contract";
import {
  normalizeAppearancePreferences,
  EXTERNAL_OPEN_TARGET_IDS,
  type OpenCodeCredentialInput,
  type OpenCodePairImportInput,
  type OpenCodePairPayload,
  type OpenCodeProfileCreateInput,
  type OpenCodeProfileUpdateInput,
  type AppearanceUpdateInput,
  type AttentionSnapshotInput,
  type NativeSymbolInput,
} from "../shared";
import type { AutomationCommand } from "../shared/automation-contract";
import type { SessionTriageCommand } from "../shared/session-triage-contract";
import { requestAppRestart } from "./app-restart";
import { getResolvedChromeTier } from "./liquid-glass";
import {
  ATTACHMENT_DIALOG_FILTERS,
  inspectPickedFiles,
  readAttachmentPreview,
  shutdownAttachmentStorage,
  stageClipboardImages,
} from "./file-attachments";
import { openCodeRuntime } from "./opencode-runtime";
import { getOpenCodeReleaseManager } from "./opencode-release-manager";
import { getOpenCodeInstallations } from "./opencode-local-installations";
import { OpenCodeRequestProxy } from "./opencode-request-proxy";
import { createSessionPty, ptyTransport } from "./opencode-pty";
import {
  guardFocusedOpenCodeConnection,
  sessionWindowConnection,
  type SessionWindowConnection,
  type SessionWindowScope,
} from "./opencode-native-scope";
import { sessionTriageStore } from "./session-triage-store";
import { automationService } from "./automations/service";
import { automationDraftSchema, automationTriggerSchema } from "./automations/definitions";
import { desktopNavigation } from "./desktop-navigation";
import { desktopNotificationService } from "./notification-service";
import { externalOpenService } from "./external-open/service";
import { refreshTrayMenu } from "./tray";
import { appearanceService } from "./appearance-service";
import { openCodeAttentionIndex } from "./attention-index";
import { registerTrustedIpcHandler } from "./ipc-security";
import {
  exportSupportBundle,
  palotDataLocations,
  removePalotOwnedData,
  resetPalotSettings,
  revealPalotDataFolder,
  revealPalotLogsFolder,
} from "./data-recovery";
import { closePalotDatabase } from "./database/client";
import { tailscaleService } from "./tailscale-service";

let performanceTraceActive = false;
const requestProxy = new OpenCodeRequestProxy({
  connection: (target) => openCodeRuntime.requestConnection(target),
  fetch: (input, init) => globalThis.fetch(input, { ...init, redirect: "error" }),
});
openCodeRuntime.onBeforeSwitch(() => {
  ptyTransport.closeAll();
});
const observedRequestSenders = new WeakSet<WebContents>();
const nativeSymbolCache = new Map<string, string | null>();
const MAX_SESSION_TRANSFER_BYTES = 50 * 1024 * 1024;

async function openCodeWebAccessInfo() {
  const local = await openCodeRuntime.localServiceInfo();
  const tailscale = await tailscaleService().status(local.url);
  return { local, tailscale };
}

const NATIVE_SYMBOL_WEIGHTS = new Set<NonNullable<NativeSymbolInput["weight"]>>([
  "ultralight",
  "thin",
  "light",
  "regular",
  "medium",
  "semibold",
  "bold",
  "heavy",
  "black",
]);
const NATIVE_SYMBOL_SCALES = new Set<NonNullable<NativeSymbolInput["scale"]>>([
  "small",
  "medium",
  "large",
]);

function renderNativeSymbol(input: unknown): string | null {
  if (process.platform !== "darwin" || !input || typeof input !== "object") return null;
  const value = input as Partial<NativeSymbolInput>;
  if (
    typeof value.name !== "string" ||
    value.name.length > 80 ||
    !/^[a-z0-9.-]+$/.test(value.name)
  ) {
    return null;
  }
  const pointSize =
    typeof value.pointSize === "number" && Number.isFinite(value.pointSize)
      ? Math.min(64, Math.max(8, value.pointSize))
      : 16;
  const weight = value.weight && NATIVE_SYMBOL_WEIGHTS.has(value.weight) ? value.weight : "medium";
  const scale = value.scale && NATIVE_SYMBOL_SCALES.has(value.scale) ? value.scale : "small";
  const cacheKey = `${value.name}:${pointSize}:${weight}:${scale}`;
  const cached = nativeSymbolCache.get(cacheKey);
  if (cached !== undefined) return cached;
  const image = nativeImage.createFromNamedImage(value.name, { pointSize, weight, scale });
  const result = image.isEmpty() ? null : image.toDataURL({ scaleFactor: 2 });
  nativeSymbolCache.set(cacheKey, result);
  return result;
}
function assertTrustedMainFrame(event: Electron.IpcMainInvokeEvent): WebContents {
  if (
    !BrowserWindow.fromWebContents(event.sender) ||
    event.senderFrame !== event.sender.mainFrame
  ) {
    throw new Error("OpenCode requests are only available to the Palot main frame");
  }
  return event.sender;
}

function parseOpenCodeRequest(input: unknown) {
  if (!input || typeof input !== "object") throw new Error("OpenCode request is invalid");
  const value = input as Record<string, unknown>;
  if (
    typeof value.id !== "string" ||
    typeof value.rendererStartedAt !== "number" ||
    !Number.isFinite(value.rendererStartedAt) ||
    typeof value.path !== "string" ||
    typeof value.method !== "string" ||
    !value.headers ||
    typeof value.headers !== "object" ||
    Array.isArray(value.headers) ||
    (value.body !== null && !(value.body instanceof ArrayBuffer))
  ) {
    throw new Error("OpenCode request is invalid");
  }
  const headers: Record<string, string> = {};
  for (const [key, header] of Object.entries(value.headers)) {
    if (typeof header !== "string") throw new Error("OpenCode request headers are invalid");
    headers[key] = header;
  }
  return {
    id: value.id,
    profileID: v.parse(v.optional(identifier), value.profileID),
    connectionID: v.parse(v.optional(identifier), value.connectionID),
    rendererStartedAt: value.rendererStartedAt,
    path: value.path,
    method: value.method,
    headers,
    body: value.body as ArrayBuffer | null,
  };
}

function parseCredential(input: unknown): OpenCodeCredentialInput {
  if (!input || typeof input !== "object") throw new Error("OpenCode credential is invalid");
  const value = input as Record<string, unknown>;
  if (value.type === "none") return { type: "none" };
  if (
    value.type === "basic" &&
    typeof value.username === "string" &&
    typeof value.password === "string"
  ) {
    return { type: "basic", username: value.username, password: value.password };
  }
  if (value.type === "bearer" && typeof value.token === "string") {
    return { type: "bearer", token: value.token };
  }
  if (
    value.type === "headers" &&
    value.headers &&
    typeof value.headers === "object" &&
    !Array.isArray(value.headers)
  ) {
    const headers: Record<string, string> = {};
    for (const [key, header] of Object.entries(value.headers)) {
      if (typeof header !== "string") throw new Error("OpenCode credential headers are invalid");
      headers[key] = header;
    }
    return { type: "headers", headers };
  }
  throw new Error("OpenCode credential is invalid");
}

function parseProfileCreate(input: unknown): OpenCodeProfileCreateInput {
  if (!input || typeof input !== "object") throw new Error("OpenCode profile is invalid");
  const value = input as Record<string, unknown>;
  const name = v.parse(v.pipe(v.string(), v.minLength(1), v.maxLength(120)), value.name);
  if (value.kind === "local") return { kind: "local", name };
  if (value.kind === "ssh") return { kind: "ssh", name, ssh: normalizeSshConfig(value.ssh) };
  if (value.kind === "remote" && Array.isArray(value.urls)) {
    return {
      kind: "remote",
      name,
      urls: value.urls.map((url) => v.parse(v.string(), url)),
      credential: parseCredential(value.credential),
      allowPlainHttp: v.parse(v.boolean(), value.allowPlainHttp),
    };
  }
  throw new Error("OpenCode profile is invalid");
}

function parseProfileUpdate(input: unknown): OpenCodeProfileUpdateInput {
  if (!input || typeof input !== "object") throw new Error("OpenCode profile is invalid");
  const value = input as Record<string, unknown>;
  const id = v.parse(identifier, value.id);
  const parsed = parseProfileCreate({ ...value, credential: value.credential ?? { type: "none" } });
  if (parsed.kind === "remote") {
    return {
      ...parsed,
      id,
      ...(value.credential === undefined ? { credential: undefined } : {}),
    };
  }
  return { ...parsed, id };
}

function parsePairPayload(input: unknown): OpenCodePairPayload {
  if (!input || typeof input !== "object") throw new Error("OpenCode pairing payload is invalid");
  const value = input as Record<string, unknown>;
  if (!Array.isArray(value.urls)) throw new Error("OpenCode pairing URLs are invalid");
  return {
    urls: value.urls.map((url) => v.parse(v.string(), url)),
    username: v.parse(v.pipe(v.string(), v.minLength(1)), value.username),
    password: v.parse(v.pipe(v.string(), v.minLength(1)), value.password),
  };
}

function parsePairImport(input: unknown): OpenCodePairImportInput {
  if (!input || typeof input !== "object") throw new Error("OpenCode pairing import is invalid");
  const value = input as Record<string, unknown>;
  return {
    payload: parsePairPayload(value.payload),
    allowPlainHttp: v.parse(v.boolean(), value.allowPlainHttp),
  };
}

function requireRuntimeCapability(
  capability: "localPathActions" | "localFileAttachments" | "worktreeCreate",
): void {
  if (!openCodeRuntime.runtimeStatus().capabilities?.[capability]) {
    throw new Error("This action is unavailable for the active OpenCode server");
  }
}

function parseAttentionSnapshot(input: unknown): AttentionSnapshotInput {
  if (!input || typeof input !== "object") throw new Error("Attention snapshot input is invalid");
  const value = input as Record<string, unknown>;
  if (!Array.isArray(value.sessions) || value.sessions.length > 2_000) {
    throw new Error("Attention snapshot sessions are invalid");
  }
  for (const item of value.sessions) {
    if (!item || typeof item !== "object") throw new Error("Attention session is invalid");
    const session = item as Record<string, unknown>;
    if (typeof session.id !== "string" || typeof session.projectID !== "string") {
      throw new Error("Attention session identity is invalid");
    }
  }
  return {
    connectionID: v.parse(identifier, value.connectionID),
    sessions: value.sessions as AttentionSnapshotInput["sessions"],
  };
}

const identifier = v.pipe(v.string(), v.minLength(1), v.maxLength(512));
const timestamp = v.pipe(v.number(), v.finite(), v.integer());

const restartAppSchema = v.optional(
  v.strictObject({ reason: v.optional(v.pipe(v.string(), v.maxLength(1_000))) }),
  {},
);
const connectOpenCodeSchema = v.optional(
  v.strictObject({
    versionMismatch: v.optional(v.picklist(["continue", "replace"])),
    approvedVersion: v.optional(v.pipe(v.string(), v.minLength(1), v.maxLength(80))),
    startLocalService: v.optional(v.boolean()),
  }),
  {},
);
const ptyConnectionSchema = v.strictObject({
  ptyID: identifier,
  location: v.strictObject({
    directory: v.pipe(v.string(), v.minLength(1), v.maxLength(16_384)),
    workspaceID: v.optional(identifier),
  }),
  cursor: v.pipe(v.number(), v.finite(), v.integer(), v.minValue(-1)),
  transport: v.picklist(["legacy", "persistent"]),
  readOnly: v.optional(v.boolean()),
});
const ptyCreateSchema = v.strictObject({
  sessionID: identifier,
  location: v.strictObject({
    directory: v.pipe(v.string(), v.minLength(1), v.maxLength(16_384)),
    workspaceID: v.optional(identifier),
  }),
});
const ptyWriteSchema = v.strictObject({
  connectionID: identifier,
  data: v.pipe(v.string(), v.maxLength(1_048_576)),
  cols: v.pipe(v.number(), v.finite(), v.integer(), v.minValue(1), v.maxValue(65_535)),
  rows: v.pipe(v.number(), v.finite(), v.integer(), v.minValue(1), v.maxValue(65_535)),
  control: v.optional(v.boolean()),
});
const attentionNotificationSchema = v.strictObject({
  sessionID: identifier,
  requestID: identifier,
  type: v.picklist(["permission", "form", "question", "input"]),
});
const desktopNotificationSettingsSchema = v.strictObject({
  turnCompletion: v.picklist(["never", "unfocused", "always"]),
  permissionRequests: v.boolean(),
  questionRequests: v.boolean(),
});
const activityWatermarkSchema = v.strictObject({
  updatedAt: timestamp,
  // An empty ID is the lower-bound sentinel when a profile has no sessions yet.
  sessionID: v.pipe(v.string(), v.maxLength(512)),
});
const triageCommandSchema = v.variant("type", [
  v.strictObject({
    type: v.literal("bootstrap"),
    profileID: identifier,
    at: timestamp,
    through: activityWatermarkSchema,
  }),
  v.strictObject({
    type: v.literal("settle"),
    profileID: identifier,
    sessionID: identifier,
    at: timestamp,
    through: activityWatermarkSchema,
  }),
  v.strictObject({
    type: v.literal("inbox"),
    profileID: identifier,
    sessionID: identifier,
    at: timestamp,
    activity: v.optional(activityWatermarkSchema),
  }),
  ...(["pin", "unpin", "wake"] as const).map((type) =>
    v.strictObject({
      type: v.literal(type),
      profileID: identifier,
      sessionID: identifier,
      at: timestamp,
    }),
  ),
  v.strictObject({
    type: v.literal("snooze"),
    profileID: identifier,
    sessionID: identifier,
    at: timestamp,
    until: timestamp,
    through: activityWatermarkSchema,
  }),
  v.strictObject({ type: v.literal("remove"), profileID: identifier, sessionID: identifier }),
]);
const automationCommandSchema = v.variant("type", [
  v.strictObject({
    type: v.literal("create"),
    profileID: identifier,
    draft: automationDraftSchema,
  }),
  v.strictObject({
    type: v.literal("update"),
    profileID: identifier,
    automationID: identifier,
    draft: automationDraftSchema,
  }),
  ...(["pause", "resume", "run-now", "delete"] as const).map((type) =>
    v.strictObject({ type: v.literal(type), profileID: identifier, automationID: identifier }),
  ),
  v.strictObject({ type: v.literal("cancel-run"), profileID: identifier, runID: identifier }),
  ...(["mark-read", "mark-unread", "archive-run", "unarchive-run"] as const).map((type) =>
    v.strictObject({ type: v.literal(type), profileID: identifier, runID: identifier }),
  ),
  v.strictObject({ type: v.literal("mark-all-read"), profileID: identifier }),
]);
const automationHostSettingsSchema = v.strictObject({
  launchAtLogin: v.boolean(),
  preventSleepWhileRunning: v.boolean(),
});

let ipcTrust:
  | {
      expectedWindow: (event: Electron.IpcMainInvokeEvent) => BrowserWindow | null;
      openSessionWindow: (sessionID: string, owner: SessionWindowConnection) => Promise<void>;
      sessionWindowScope: (window: BrowserWindow) => SessionWindowScope | undefined;
      takeWindowTarget: (window: BrowserWindow) => ReturnType<typeof desktopNavigation.take>;
      expectedUrl: string;
      expectedRole: "main";
      onStartupFailure: (failure: unknown) => void;
    }
  | undefined;

function register(channel: string, handler: Parameters<typeof ipcMain.handle>[1]): void {
  if (!ipcTrust)
    throw new Error("IPC trust policy must be configured before handlers are registered");
  registerTrustedIpcHandler(channel, ipcTrust, handler);
}

function assertActiveProfile(profileID: string): void {
  if (profileID !== openCodeRuntime.runtimeStatus().profileID) {
    throw new Error("Session triage profile does not match the active OpenCode connection");
  }
}

function assertKnownProfile(profileID: string): void {
  if (!openCodeRuntime.profileSnapshot().profiles.some((profile) => profile.id === profileID)) {
    throw new Error("Unknown OpenCode profile");
  }
}

function registerFocusedNative(
  channel: string,
  handler: (event: IpcMainInvokeEvent, input: unknown) => unknown,
): void {
  register(channel, async (event, input: unknown, connectionID: unknown) => {
    assertTrustedMainFrame(event);
    const validate = guardFocusedOpenCodeConnection(connectionID, () =>
      openCodeRuntime.runtimeStatus(),
    );
    const result = await handler(event, input);
    validate();
    return result;
  });
}

function focusedPtyRuntime() {
  const status = openCodeRuntime.runtimeStatus();
  const scoped = openCodeRuntime.scopedConnection(status.connectionID);
  return {
    withClient: <T>(
      operation: (client: import("@opencode/client").OpenCodeClient, remote: boolean) => Promise<T>,
    ) => scoped.withClient((client) => operation(client, status.topology === "remote-machine")),
    requestConnection: () =>
      openCodeRuntime.requestConnection({ connectionID: status.connectionID }),
  };
}

export function registerIpcHandlers(options: NonNullable<typeof ipcTrust>): void {
  ipcTrust = options;
  register(IPC_CHANNELS.appearanceLoad, () => ({
    preferences: appearanceService().preferences(),
    hasStoredPreferences: appearanceService().hasStoredPreferences(),
    reducedTransparency: nativeTheme.prefersReducedTransparency,
    chromeTier: getResolvedChromeTier(),
  }));
  register(IPC_CHANNELS.appearanceUpdate, (event, input: AppearanceUpdateInput) => {
    assertTrustedMainFrame(event);
    if (!input || typeof input !== "object") throw new Error("Appearance update is invalid");
    const resolvedScheme = input.resolvedScheme;
    if (resolvedScheme !== "light" && resolvedScheme !== "dark") {
      throw new Error("Appearance scheme is invalid");
    }
    return appearanceService().update({
      preferences: normalizeAppearancePreferences(input.preferences),
      resolvedScheme,
    });
  });
  register(IPC_CHANNELS.nativeSystemAppearance, (event) => {
    assertTrustedMainFrame(event);
    return appearanceService().nativeSystemAppearance();
  });
  register(IPC_CHANNELS.nativeSymbol, (event, input: unknown) => {
    assertTrustedMainFrame(event);
    return renderNativeSymbol(input);
  });
  register(IPC_CHANNELS.chromeTier, () => getResolvedChromeTier());
  register(IPC_CHANNELS.openSessionWindow, (event, input: unknown, connectionID: unknown) => {
    assertTrustedMainFrame(event);
    const sessionID = v.parse(identifier, input);
    const owner = sessionWindowConnection(connectionID, openCodeRuntime);
    return options.openSessionWindow(sessionID, owner);
  });
  register(IPC_CHANNELS.closeWindow, (event) => {
    BrowserWindow.fromWebContents(event.sender)?.close();
  });
  register(IPC_CHANNELS.attentionNotification, (_event, input: unknown) => {
    desktopNotificationService().notifyAttention(v.parse(attentionNotificationSchema, input));
  });
  register(IPC_CHANNELS.attentionSnapshot, (event, input: unknown) => {
    assertTrustedMainFrame(event);
    const parsed = parseAttentionSnapshot(input);
    return openCodeAttentionIndex(parsed.connectionID).snapshot(parsed);
  });
  register(IPC_CHANNELS.notificationSettingsLoad, (event) => {
    assertTrustedMainFrame(event);
    return desktopNotificationService().settings();
  });
  register(IPC_CHANNELS.notificationSettingsUpdate, (event, input: unknown) => {
    assertTrustedMainFrame(event);
    return desktopNotificationService().updateSettings(
      v.parse(desktopNotificationSettingsSchema, input),
    );
  });
  register(IPC_CHANNELS.notificationDeliveryStatus, (event) => {
    assertTrustedMainFrame(event);
    return desktopNotificationService().deliveryStatus();
  });
  register(IPC_CHANNELS.notificationPermissionRequest, (event) => {
    assertTrustedMainFrame(event);
    return desktopNotificationService().requestPermission();
  });
  register(IPC_CHANNELS.notificationSystemSettingsOpen, (event) => {
    assertTrustedMainFrame(event);
    return desktopNotificationService().openSystemSettings();
  });
  register(IPC_CHANNELS.notificationTest, (event) => {
    assertTrustedMainFrame(event);
    desktopNotificationService().sendTest();
  });
  register(IPC_CHANNELS.openTargetTake, (event) => {
    assertTrustedMainFrame(event);
    return options.takeWindowTarget(BrowserWindow.fromWebContents(event.sender)!);
  });
  register(IPC_CHANNELS.runtimeStatus, (event) => {
    const window = BrowserWindow.fromWebContents(event.sender)!;
    return options.sessionWindowScope(window)?.runtimeStatus() ?? openCodeRuntime.runtimeStatus();
  });
  register(IPC_CHANNELS.runtimeList, () => openCodeRuntime.listRuntimes());
  register(IPC_CHANNELS.openCodeReleaseStatus, (event) => {
    assertTrustedMainFrame(event);
    return getOpenCodeReleaseManager().status();
  });
  register(IPC_CHANNELS.openCodeReleaseChannel, (event, input: unknown) => {
    assertTrustedMainFrame(event);
    return getOpenCodeReleaseManager().setChannel(v.parse(v.picklist(["stable", "beta"]), input));
  });
  register(IPC_CHANNELS.openCodeReleaseCheck, (event) => {
    assertTrustedMainFrame(event);
    return getOpenCodeReleaseManager().check();
  });
  register(IPC_CHANNELS.openCodeReleasePrepare, (event, input: unknown) => {
    assertTrustedMainFrame(event);
    return getOpenCodeReleaseManager().prepare(
      v.parse(
        v.strictObject({
          version: v.pipe(v.string(), v.maxLength(80)),
          allowUntested: v.optional(v.boolean()),
        }),
        input,
      ),
    );
  });
  register(IPC_CHANNELS.openCodeReleaseReset, (event) => {
    assertTrustedMainFrame(event);
    return getOpenCodeReleaseManager().reset();
  });
  register(IPC_CHANNELS.openCodeInstallationsInspect, (event) => {
    assertTrustedMainFrame(event);
    return getOpenCodeInstallations().inspect();
  });
  register(IPC_CHANNELS.openCodeInstallationStatus, (event) => {
    assertTrustedMainFrame(event);
    return getOpenCodeInstallations().status();
  });
  register(IPC_CHANNELS.openCodeRuntimePreference, (event, input: unknown) => {
    assertTrustedMainFrame(event);
    return getOpenCodeInstallations().setPreference(
      v.parse(v.picklist(["installed", "palot"]), input),
    );
  });
  register(IPC_CHANNELS.openCodeInstallationSelect, (event, input: unknown) => {
    assertTrustedMainFrame(event);
    return getOpenCodeInstallations().select(v.parse(identifier, input));
  });
  register(IPC_CHANNELS.openCodeInstallationUpgrade, (event, input: unknown) => {
    assertTrustedMainFrame(event);
    return getOpenCodeInstallations().upgrade(
      v.parse(
        v.strictObject({
          id: identifier,
          currentVersion: v.pipe(v.string(), v.minLength(1), v.maxLength(80)),
          version: v.pipe(v.string(), v.minLength(1), v.maxLength(80)),
          method: v.picklist(["auto", "npm", "bun", "pnpm", "yarn", "curl"]),
          allowUntested: v.optional(v.boolean()),
        }),
        input,
      ),
    );
  });
  register(IPC_CHANNELS.profileDisconnect, (event, input: unknown) => {
    assertTrustedMainFrame(event);
    return openCodeRuntime.disconnectProfile(v.parse(identifier, input));
  });
  register(IPC_CHANNELS.profileConnect, (event, input: unknown) => {
    const sender = assertTrustedMainFrame(event);
    return openCodeRuntime.connectProfile(
      v.parse(identifier, input),
      sshInteractions.connector(sender),
    );
  });
  register(IPC_CHANNELS.connect, (event, input: unknown) => {
    const sender = assertTrustedMainFrame(event);
    return openCodeRuntime.connect(
      v.parse(connectOpenCodeSchema, input),
      sshInteractions.connector(sender),
    );
  });
  register(IPC_CHANNELS.sshState, (event) => sshInteractions.state(assertTrustedMainFrame(event)));
  register(IPC_CHANNELS.sshRespond, (event, input: unknown) => {
    const sender = assertTrustedMainFrame(event);
    const response = v.parse(
      v.object({
        operationID: identifier,
        promptID: identifier,
        value: v.nullable(v.pipe(v.string(), v.maxLength(16_384))),
      }),
      input,
    );
    sshInteractions.respond(sender, response);
  });
  register(IPC_CHANNELS.sshCancel, (event, input: unknown) => {
    sshInteractions.cancel(assertTrustedMainFrame(event), v.parse(identifier, input));
  });
  register(IPC_CHANNELS.networkRestored, (event) => {
    assertTrustedMainFrame(event);
    openCodeRuntime.recoverEventStream("online");
  });
  register(IPC_CHANNELS.profilesList, (event) => {
    assertTrustedMainFrame(event);
    return openCodeRuntime.profileSnapshot();
  });
  register(IPC_CHANNELS.profilesCreate, (event, input: unknown) => {
    assertTrustedMainFrame(event);
    return openCodeRuntime.createProfile(parseProfileCreate(input));
  });
  register(IPC_CHANNELS.profilesUpdate, (event, input: unknown) => {
    assertTrustedMainFrame(event);
    return openCodeRuntime.updateProfile(parseProfileUpdate(input));
  });
  register(IPC_CHANNELS.profilesDelete, (event, input: unknown) => {
    assertTrustedMainFrame(event);
    return openCodeRuntime.deleteProfile(v.parse(identifier, input));
  });
  register(IPC_CHANNELS.profilesTest, (event, input: unknown) => {
    const sender = assertTrustedMainFrame(event);
    return openCodeRuntime.testProfile(
      parseProfileCreate(input),
      sshInteractions.connector(sender),
    );
  });
  register(IPC_CHANNELS.profilesSwitch, (event, input: unknown) => {
    const sender = assertTrustedMainFrame(event);
    const profileID = v.parse(identifier, input);
    const window = BrowserWindow.fromWebContents(event.sender)!;
    const scope = options.sessionWindowScope(window);
    if (scope) return scope.switchProfile(profileID);
    return openCodeRuntime.switchProfile(profileID, sshInteractions.connector(sender));
  });
  register(IPC_CHANNELS.pairingInfo, (event) => {
    assertTrustedMainFrame(event);
    return openCodeRuntime.pairingInfo();
  });
  register(IPC_CHANNELS.pairingImport, (event, input: unknown) => {
    assertTrustedMainFrame(event);
    return openCodeRuntime.importPairing(parsePairImport(input));
  });
  register(IPC_CHANNELS.webAccessInfo, (event) => {
    assertTrustedMainFrame(event);
    return openCodeWebAccessInfo();
  });
  register(IPC_CHANNELS.webAccessEnableTailscale, async (event) => {
    assertTrustedMainFrame(event);
    const local = await openCodeRuntime.localServiceInfo();
    if (!local.available || !local.url) {
      throw new Error(local.reason ?? "Local OpenCode web access is unavailable");
    }
    await tailscaleService().enable(local.url);
    return openCodeWebAccessInfo();
  });
  register(IPC_CHANNELS.webAccessDisableTailscale, async (event) => {
    assertTrustedMainFrame(event);
    const local = await openCodeRuntime.localServiceInfo();
    await tailscaleService().disable(local.url);
    return openCodeWebAccessInfo();
  });
  register(IPC_CHANNELS.localServiceRestart, (event) => {
    assertTrustedMainFrame(event);
    return openCodeRuntime.restartLocalService();
  });
  registerFocusedNative(IPC_CHANNELS.ptyCreate, (event, input: unknown) => {
    assertTrustedMainFrame(event);
    if (openCodeRuntime.runtimeStatus().capabilities?.pty === "none") {
      throw new Error("Terminals are unavailable for the active OpenCode server");
    }
    return createSessionPty(v.parse(ptyCreateSchema, input), focusedPtyRuntime());
  });
  registerFocusedNative(IPC_CHANNELS.ptyConnect, (event, input: unknown) => {
    const sender = assertTrustedMainFrame(event);
    assertPtyAvailable();
    return ptyTransport.connect(sender, v.parse(ptyConnectionSchema, input), focusedPtyRuntime());
  });
  register(IPC_CHANNELS.ptyStart, (event, input: unknown) => {
    const sender = assertTrustedMainFrame(event);
    assertPtyAvailable();
    ptyTransport.start(sender, v.parse(identifier, input));
  });
  register(IPC_CHANNELS.ptyWrite, (event, input: unknown) => {
    const sender = assertTrustedMainFrame(event);
    assertPtyAvailable();
    const value = v.parse(ptyWriteSchema, input);
    ptyTransport.write(
      sender,
      value.connectionID,
      value.data,
      {
        cols: value.cols,
        rows: value.rows,
      },
      value.control,
    );
  });
  register(IPC_CHANNELS.ptyDisconnect, (event, input: unknown) => {
    const sender = assertTrustedMainFrame(event);
    ptyTransport.disconnect(sender, v.parse(identifier, input));
  });
  register(IPC_CHANNELS.triageLoad, (event, input: unknown) => {
    assertTrustedMainFrame(event);
    const profileID = v.parse(identifier, input);
    assertKnownProfile(profileID);
    return sessionTriageStore().load(profileID);
  });
  register(IPC_CHANNELS.triageDispatch, (event, input: unknown) => {
    assertTrustedMainFrame(event);
    const command = v.parse(triageCommandSchema, input) as SessionTriageCommand;
    assertKnownProfile(command.profileID);
    const snapshot = sessionTriageStore().dispatch(command);
    refreshTrayMenu();
    return snapshot;
  });
  register(IPC_CHANNELS.automationLoad, (event, input: unknown) => {
    assertTrustedMainFrame(event);
    const profileID = v.parse(identifier, input);
    assertActiveProfile(profileID);
    return automationService().load(profileID);
  });
  register(IPC_CHANNELS.automationDispatch, (event, input: unknown) => {
    assertTrustedMainFrame(event);
    const command = v.parse(automationCommandSchema, input) as AutomationCommand;
    assertActiveProfile(command.profileID);
    return automationService().dispatch(command);
  });
  register(IPC_CHANNELS.automationPreview, (event, input: unknown) => {
    assertTrustedMainFrame(event);
    return automationService().preview(v.parse(automationTriggerSchema, input));
  });
  register(IPC_CHANNELS.automationTakeNotification, (event) => {
    assertTrustedMainFrame(event);
    return automationService().takeNotificationTarget();
  });
  register(IPC_CHANNELS.automationSettingsLoad, (event) => {
    assertTrustedMainFrame(event);
    return automationService().settings();
  });
  register(IPC_CHANNELS.automationSettingsUpdate, (event, input: unknown) => {
    assertTrustedMainFrame(event);
    return automationService().updateSettings(v.parse(automationHostSettingsSchema, input));
  });
  register(IPC_CHANNELS.request, (event, input: unknown) => {
    const sender = assertTrustedMainFrame(event);
    if (!observedRequestSenders.has(sender)) {
      observedRequestSenders.add(sender);
      sender.once("destroyed", () => requestProxy.cancelAll(sender));
    }
    return requestProxy.request(sender, parseOpenCodeRequest(input));
  });
  register(IPC_CHANNELS.cancelRequest, (event, input: unknown) => {
    const sender = assertTrustedMainFrame(event);
    if (typeof input !== "string") throw new Error("OpenCode request ID is invalid");
    requestProxy.cancel(sender, input);
  });
  registerFocusedNative(IPC_CHANNELS.pickDirectory, async () => {
    requireRuntimeCapability("localPathActions");
    const result = await openDesktopDialog("project", {
      title: "Choose a project folder",
      properties: ["openDirectory", "createDirectory"],
    });
    return result.canceled ? null : (result.filePaths[0] ?? null);
  });
  register(IPC_CHANNELS.openExternalUrl, (event, input: unknown) => {
    assertTrustedMainFrame(event);
    if (typeof input !== "string") return false;
    const url = allowedExternalUrl(input, !app.isPackaged);
    if (!url) return false;
    void shell.openExternal(url);
    return true;
  });
  registerFocusedNative(IPC_CHANNELS.revealFileInFinder, (event, input: unknown) => {
    requireRuntimeCapability("localPathActions");
    assertTrustedMainFrame(event);
    if (typeof input !== "string" || !input.trim()) return false;
    const targetPath = input.trim().startsWith("~")
      ? path.join(process.env.HOME ?? "", input.trim().slice(1))
      : input.trim();
    shell.showItemInFolder(targetPath);
    return true;
  });
  registerFocusedNative(IPC_CHANNELS.externalOpenTargets, (event, input: unknown) => {
    assertTrustedMainFrame(event);
    return externalOpenService().getTargets(v.parse(identifier, input));
  });
  registerFocusedNative(IPC_CHANNELS.externalOpen, (event, input: unknown) => {
    assertTrustedMainFrame(event);
    if (!input || typeof input !== "object") throw new Error("External open request is invalid");
    const value = input as Record<string, unknown>;
    if (!value.resource || typeof value.resource !== "object") {
      throw new Error("External open resource is invalid");
    }
    const resource = value.resource as Record<string, unknown>;
    const targetID =
      value.targetID === undefined
        ? undefined
        : v.parse(v.picklist(EXTERNAL_OPEN_TARGET_IDS), value.targetID);
    if (resource.kind === "session-directory") {
      return externalOpenService().open({
        resource: {
          kind: "session-directory",
          sessionID: v.parse(identifier, resource.sessionID),
        },
        ...(targetID ? { targetID } : {}),
      });
    }
    if (resource.kind === "file") {
      const filePath = typeof resource.path === "string" ? resource.path : "";
      if (!filePath) throw new Error("External open file path is required");
      const line =
        typeof resource.line === "number" &&
        Number.isSafeInteger(resource.line) &&
        resource.line > 0
          ? resource.line
          : undefined;
      const column =
        typeof resource.column === "number" &&
        Number.isSafeInteger(resource.column) &&
        resource.column > 0
          ? resource.column
          : undefined;
      const sessionID =
        typeof resource.sessionID === "string" && resource.sessionID
          ? v.parse(identifier, resource.sessionID)
          : undefined;
      return externalOpenService().open({
        resource: {
          kind: "file",
          path: filePath,
          ...(line ? { line } : {}),
          ...(column ? { column } : {}),
          ...(sessionID ? { sessionID } : {}),
        },
        ...(targetID ? { targetID } : {}),
      });
    }
    throw new Error("External open resource is unsupported");
  });
  registerFocusedNative(IPC_CHANNELS.pickFiles, async () => {
    requireRuntimeCapability("localFileAttachments");
    const result = await openDesktopDialog("attachment", {
      title: "Attach files",
      properties: ["openFile", "multiSelections"],
      filters: ATTACHMENT_DIALOG_FILTERS,
    });
    if (result.canceled) return { files: [], errors: [] };
    return inspectPickedFiles(result.filePaths);
  });
  register(IPC_CHANNELS.saveSessionExport, async (event, input: unknown) => {
    assertTrustedMainFrame(event);
    if (!input || typeof input !== "object") throw new Error("Session export is invalid.");
    const value = input as Record<string, unknown>;
    if (typeof value.suggestedName !== "string" || typeof value.contents !== "string") {
      throw new Error("Session export is invalid.");
    }
    if (Buffer.byteLength(value.contents, "utf8") > MAX_SESSION_TRANSFER_BYTES) {
      throw new Error("Session export exceeds the 50 MB limit.");
    }
    const safeName = value.suggestedName
      .replaceAll(/[^A-Za-z0-9._-]+/g, "-")
      .replace(/^-+|-+$/g, "");
    const result = await dialog.showSaveDialog({
      title: "Export task",
      defaultPath: safeName.endsWith(".json") ? safeName : `${safeName || "palot-task"}.json`,
      filters: [{ name: "Palot task", extensions: ["json"] }],
    });
    if (result.canceled || !result.filePath) return null;
    await writeFile(result.filePath, value.contents, "utf8");
    return result.filePath;
  });
  register(IPC_CHANNELS.pickSessionImport, async (event) => {
    assertTrustedMainFrame(event);
    const result = await openDesktopDialog("import", {
      title: "Import task",
      properties: ["openFile"],
      filters: [{ name: "Palot task", extensions: ["json"] }],
    });
    const path = result.canceled ? null : (result.filePaths[0] ?? null);
    if (!path) return null;
    const info = await stat(path);
    if (!info.isFile() || info.size > MAX_SESSION_TRANSFER_BYTES) {
      throw new Error("Session import must be a JSON file smaller than 50 MB.");
    }
    return { path, contents: await readFile(path, "utf8") };
  });
  register(IPC_CHANNELS.writeClipboardText, (event, input: unknown) => {
    assertTrustedMainFrame(event);
    if (typeof input !== "string") throw new Error("Clipboard text is invalid.");
    return clipboard.writeText(input);
  });
  register(IPC_CHANNELS.downloadUrl, async (event, input: unknown) => {
    assertTrustedMainFrame(event);
    if (typeof input !== "string") throw new Error("Download URL is invalid.");
    const url = new URL(input);
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      throw new Error("Only HTTP and HTTPS downloads are supported.");
    }
    event.sender.downloadURL(url.href);
  });
  registerFocusedNative(IPC_CHANNELS.attachClipboardImages, async (_event, input: unknown) => {
    requireRuntimeCapability("localFileAttachments");
    if (!Array.isArray(input)) throw new Error("Clipboard images are invalid.");
    const images = input.map((value) => {
      if (!value || typeof value !== "object") throw new Error("Clipboard image is invalid.");
      const image = value as { mime?: unknown; data?: unknown };
      if (typeof image.mime !== "string" || !(image.data instanceof ArrayBuffer)) {
        throw new Error("Clipboard image is invalid.");
      }
      return { mime: image.mime, data: image.data };
    });
    if (images.length === 0) {
      const clipboardItems = await clipboard.read();
      for (const mime of ["image/png", "image/jpeg"] as const) {
        const item = clipboardItems.find((candidate) => candidate.types.includes(mime));
        if (!item) continue;
        const blob = await item.getType(mime);
        if (!(blob instanceof Blob)) continue;
        images.push({ mime, data: await blob.arrayBuffer() });
        break;
      }
    }
    return images.length ? stageClipboardImages(images) : { files: [], errors: [] };
  });
  registerFocusedNative(IPC_CHANNELS.attachmentPreview, async (_event, input: unknown) => {
    requireRuntimeCapability("localFileAttachments");
    if (typeof input !== "string") throw new Error("Attachment URL is invalid.");
    return readAttachmentPreview(input);
  });
  register(IPC_CHANNELS.performanceSnapshot, (event) => {
    assertTrustedMainFrame(event);
    const hostWindow = BrowserWindow.fromWebContents(event.sender);
    return {
      capturedAt: Date.now(),
      versions: {
        platform: process.platform,
        architecture: process.arch,
        electron: process.versions.electron ?? null,
        chromium: process.versions.chrome ?? null,
        node: process.versions.node ?? null,
      },
      hardwareAcceleration: app.isHardwareAccelerationEnabled(),
      gpuFeatureStatus: Object.fromEntries(Object.entries(app.getGPUFeatureStatus())),
      window: hostWindow
        ? {
            focused: hostWindow.isFocused(),
            visible: hostWindow.isVisible(),
            minimized: hostWindow.isMinimized(),
          }
        : null,
      openCodeTransport: openCodeRuntime.performanceMetrics(),
      processes: app.getAppMetrics().map((metric) => ({
        pid: metric.pid,
        type: metric.type,
        name: metric.name ?? null,
        serviceName: metric.serviceName ?? null,
        creationTime: metric.creationTime,
        sandboxed: metric.sandboxed ?? null,
        cpu: {
          percentCPUUsage: metric.cpu.percentCPUUsage,
          cumulativeCPUUsage: metric.cpu.cumulativeCPUUsage ?? null,
          idleWakeupsPerSecond: metric.cpu.idleWakeupsPerSecond,
        },
        memory: {
          workingSetSize: metric.memory.workingSetSize,
          peakWorkingSetSize: metric.memory.peakWorkingSetSize,
          privateBytes: metric.memory.privateBytes ?? null,
        },
      })),
    };
  });
  register(IPC_CHANNELS.performanceTraceStart, async (event) => {
    assertTrustedMainFrame(event);
    if (process.env.PALOT_PERFORMANCE_HARNESS !== "1") {
      throw new Error("Whole-app performance tracing is only available in the performance harness");
    }
    if (performanceTraceActive) throw new Error("Whole-app performance tracing is already active");
    await contentTracing.startRecording({
      included_categories: [
        "toplevel",
        "v8",
        "blink",
        "blink.user_timing",
        "electron",
        "devtools.timeline",
        "disabled-by-default-devtools.timeline",
        "disabled-by-default-devtools.timeline.stack",
        "disabled-by-default-v8.cpu_profiler",
        "disabled-by-default-v8.cpu_profiler.hires",
      ],
      recording_mode: "record-until-full",
    });
    performanceTraceActive = true;
  });
  register(IPC_CHANNELS.performanceTraceStop, async (event) => {
    assertTrustedMainFrame(event);
    if (!performanceTraceActive) throw new Error("Whole-app performance tracing is not active");
    const logDirectory = process.env.PALOT_LOG_DIR;
    if (!logDirectory) throw new Error("Whole-app performance tracing requires PALOT_LOG_DIR");
    const output = path.resolve(logDirectory, "..", "performance-app-trace.json");
    try {
      return await contentTracing.stopRecording(output);
    } finally {
      performanceTraceActive = false;
    }
  });
  register(IPC_CHANNELS.restartApp, (_event, input: unknown) => {
    const parsed = v.parse(restartAppSchema, input);
    return requestAppRestart(parsed.reason?.trim() || "Restart requested from Palot");
  });
  register(IPC_CHANNELS.rendererStartupFailure, (event, input: unknown) => {
    assertTrustedMainFrame(event);
    const message = v.parse(v.pipe(v.string(), v.minLength(1), v.maxLength(4_000)), input);
    ipcTrust?.onStartupFailure(new Error(`Palot renderer failed during startup: ${message}`));
  });
  register(IPC_CHANNELS.dataLocations, (event) => {
    assertTrustedMainFrame(event);
    return palotDataLocations();
  });
  register(IPC_CHANNELS.dataReveal, async (event, input: unknown) => {
    assertTrustedMainFrame(event);
    const location = v.parse(v.picklist(["data", "logs"]), input);
    if (location === "data") await revealPalotDataFolder();
    else await revealPalotLogsFolder();
  });
  register(IPC_CHANNELS.supportBundleExport, (event) => {
    assertTrustedMainFrame(event);
    return exportSupportBundle();
  });
  register(IPC_CHANNELS.dataReset, async (event, input: unknown) => {
    assertTrustedMainFrame(event);
    const scope = v.parse(v.picklist(["settings", "all"]), input);
    if (scope === "settings") {
      await resetPalotSettings();
    } else {
      await automationService().shutdown();
      await openCodeRuntime.shutdown();
      closePalotDatabase();
      await shutdownAttachmentStorage();
      await removePalotOwnedData();
    }
    await requestAppRestart(`Reset Palot ${scope === "settings" ? "settings" : "data"}`);
  });
}

function assertPtyAvailable(): void {
  if (openCodeRuntime.runtimeStatus().capabilities?.pty === "none") {
    throw new Error("Terminals are unavailable for the active OpenCode server");
  }
}

export function unregisterIpcHandlers(): void {
  for (const channel of Object.values(IPC_CHANNELS)) {
    if (channel !== IPC_CHANNELS.events && channel !== IPC_CHANNELS.chromeTierChanged) {
      ipcMain.removeHandler(channel);
    }
  }
}
