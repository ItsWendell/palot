/** Narrow, typed bridge from the sandboxed renderer to Electron main. */

import { contextBridge, ipcRenderer } from "electron";
import type { PalotApi, PalotEventBatch, PalotOpenTarget } from "../shared/opencode-contract";
import type {
  AutomationChangedEvent,
  AutomationNotificationTarget,
} from "../shared/automation-contract";
import { IPC_CHANNELS } from "../shared/opencode-contract";
import {
  hasStoredAppearancePreferencesArgument,
  parseAppearancePreferencesArgument,
  REDUCED_TRANSPARENCY_ARGUMENT,
  type AppearancePreferences,
} from "../shared";
import { isWindowChromeTier, type WindowChromeTier } from "../shared/window-chrome";

const CHROME_TIER_ARGUMENT = "--palot-chrome-tier=";

window.addEventListener("online", () => {
  void ipcRenderer.invoke(IPC_CHANNELS.networkRestored).catch(() => undefined);
});

function initialChromeTier(): WindowChromeTier {
  const value = process.argv
    .find((argument) => argument.startsWith(CHROME_TIER_ARGUMENT))
    ?.slice(CHROME_TIER_ARGUMENT.length);
  return value && isWindowChromeTier(value) ? value : "opaque";
}

const api: PalotApi = {
  platform: process.platform,
  appearancePreferences: parseAppearancePreferencesArgument(process.argv),
  hasStoredAppearancePreferences: hasStoredAppearancePreferencesArgument(process.argv),
  reducedTransparency: process.argv.includes(REDUCED_TRANSPARENCY_ARGUMENT),
  chromeTier: initialChromeTier(),
  loadAppearance: () => ipcRenderer.invoke(IPC_CHANNELS.appearanceLoad),
  updateAppearance: (input) => ipcRenderer.invoke(IPC_CHANNELS.appearanceUpdate, input),
  onAppearanceChanged: (listener) => {
    const handler = (_event: Electron.IpcRendererEvent, value: AppearancePreferences) =>
      listener(value);
    ipcRenderer.on(IPC_CHANNELS.appearanceChanged, handler);
    return () => ipcRenderer.removeListener(IPC_CHANNELS.appearanceChanged, handler);
  },
  nativeSystemAppearance: () => ipcRenderer.invoke(IPC_CHANNELS.nativeSystemAppearance),
  onNativeSystemAppearanceChanged: (listener) => {
    const handler = (
      _event: Electron.IpcRendererEvent,
      appearance: Parameters<typeof listener>[0],
    ) => listener(appearance);
    ipcRenderer.on(IPC_CHANNELS.nativeSystemAppearanceChanged, handler);
    return () => ipcRenderer.removeListener(IPC_CHANNELS.nativeSystemAppearanceChanged, handler);
  },
  nativeSymbol: (input) => ipcRenderer.invoke(IPC_CHANNELS.nativeSymbol, input),
  onReducedTransparencyChanged: (listener) => {
    const handler = (_event: Electron.IpcRendererEvent, reduced: boolean) => listener(reduced);
    ipcRenderer.on(IPC_CHANNELS.reducedTransparencyChanged, handler);
    return () => ipcRenderer.removeListener(IPC_CHANNELS.reducedTransparencyChanged, handler);
  },
  getChromeTier: () => ipcRenderer.invoke(IPC_CHANNELS.chromeTier),
  onChromeTierChanged: (listener) => {
    const handler = (_event: Electron.IpcRendererEvent, tier: WindowChromeTier) => listener(tier);
    ipcRenderer.on(IPC_CHANNELS.chromeTierChanged, handler);
    return () => ipcRenderer.removeListener(IPC_CHANNELS.chromeTierChanged, handler);
  },
  runtimeStatus: () => ipcRenderer.invoke(IPC_CHANNELS.runtimeStatus),
  openCodeReleaseStatus: () => ipcRenderer.invoke(IPC_CHANNELS.openCodeReleaseStatus),
  setOpenCodeReleaseChannel: (channel) =>
    ipcRenderer.invoke(IPC_CHANNELS.openCodeReleaseChannel, channel),
  checkOpenCodeRelease: () => ipcRenderer.invoke(IPC_CHANNELS.openCodeReleaseCheck),
  prepareOpenCodeRelease: (input) => ipcRenderer.invoke(IPC_CHANNELS.openCodeReleasePrepare, input),
  resetOpenCodeRelease: () => ipcRenderer.invoke(IPC_CHANNELS.openCodeReleaseReset),
  inspectOpenCodeInstallations: () => ipcRenderer.invoke(IPC_CHANNELS.openCodeInstallationsInspect),
  openCodeInstallationStatus: () => ipcRenderer.invoke(IPC_CHANNELS.openCodeInstallationStatus),
  setOpenCodeRuntimePreference: (preference) =>
    ipcRenderer.invoke(IPC_CHANNELS.openCodeRuntimePreference, preference),
  selectOpenCodeInstallation: (id) =>
    ipcRenderer.invoke(IPC_CHANNELS.openCodeInstallationSelect, id),
  upgradeOpenCodeInstallation: (input) =>
    ipcRenderer.invoke(IPC_CHANNELS.openCodeInstallationUpgrade, input),
  listOpenCodeRuntimes: () => ipcRenderer.invoke(IPC_CHANNELS.runtimeList),
  connectOpenCodeProfile: (profileID) => ipcRenderer.invoke(IPC_CHANNELS.profileConnect, profileID),
  disconnectOpenCodeProfile: (profileID) =>
    ipcRenderer.invoke(IPC_CHANNELS.profileDisconnect, profileID),
  connectOpenCode: (input) => ipcRenderer.invoke(IPC_CHANNELS.connect, input),
  listOpenCodeProfiles: () => ipcRenderer.invoke(IPC_CHANNELS.profilesList),
  getSshConnectionState: () => ipcRenderer.invoke(IPC_CHANNELS.sshState),
  respondSshPrompt: (input) => ipcRenderer.invoke(IPC_CHANNELS.sshRespond, input),
  cancelSshConnection: (operationID) => ipcRenderer.invoke(IPC_CHANNELS.sshCancel, operationID),
  onSshConnectionState: (listener) => {
    const handler = (_event: Electron.IpcRendererEvent, state: Parameters<typeof listener>[0]) =>
      listener(state);
    ipcRenderer.on(IPC_CHANNELS.sshStateChanged, handler);
    return () => ipcRenderer.removeListener(IPC_CHANNELS.sshStateChanged, handler);
  },
  createOpenCodeProfile: (input) => ipcRenderer.invoke(IPC_CHANNELS.profilesCreate, input),
  updateOpenCodeProfile: (input) => ipcRenderer.invoke(IPC_CHANNELS.profilesUpdate, input),
  deleteOpenCodeProfile: (profileID) => ipcRenderer.invoke(IPC_CHANNELS.profilesDelete, profileID),
  testOpenCodeProfile: (input) => ipcRenderer.invoke(IPC_CHANNELS.profilesTest, input),
  switchOpenCodeProfile: (profileID) => ipcRenderer.invoke(IPC_CHANNELS.profilesSwitch, profileID),
  openCodePairingInfo: () => ipcRenderer.invoke(IPC_CHANNELS.pairingInfo),
  importOpenCodePairing: (input) => ipcRenderer.invoke(IPC_CHANNELS.pairingImport, input),
  openCodeWebAccessInfo: () => ipcRenderer.invoke(IPC_CHANNELS.webAccessInfo),
  enableOpenCodeTailscaleAccess: () => ipcRenderer.invoke(IPC_CHANNELS.webAccessEnableTailscale),
  disableOpenCodeTailscaleAccess: () => ipcRenderer.invoke(IPC_CHANNELS.webAccessDisableTailscale),
  restartLocalOpenCodeService: () => ipcRenderer.invoke(IPC_CHANNELS.localServiceRestart),
  createPty: (input, connectionID) =>
    ipcRenderer.invoke(IPC_CHANNELS.ptyCreate, input, connectionID),
  connectPty: (input, connectionID) =>
    ipcRenderer.invoke(IPC_CHANNELS.ptyConnect, input, connectionID),
  startPty: (connectionID) => ipcRenderer.invoke(IPC_CHANNELS.ptyStart, connectionID),
  writePty: (input) => ipcRenderer.invoke(IPC_CHANNELS.ptyWrite, input),
  disconnectPty: (connectionID) => ipcRenderer.invoke(IPC_CHANNELS.ptyDisconnect, connectionID),
  onPtyEvent: (listener) => {
    const handler = (_event: Electron.IpcRendererEvent, value: Parameters<typeof listener>[0]) =>
      listener(value);
    ipcRenderer.on(IPC_CHANNELS.ptyEvents, handler);
    return () => ipcRenderer.removeListener(IPC_CHANNELS.ptyEvents, handler);
  },
  loadSessionTriage: (profileID) => ipcRenderer.invoke(IPC_CHANNELS.triageLoad, profileID),
  dispatchSessionTriage: (command) => ipcRenderer.invoke(IPC_CHANNELS.triageDispatch, command),
  loadAutomations: (profileID) => ipcRenderer.invoke(IPC_CHANNELS.automationLoad, profileID),
  dispatchAutomation: (command) => ipcRenderer.invoke(IPC_CHANNELS.automationDispatch, command),
  previewAutomationSchedule: (trigger) =>
    ipcRenderer.invoke(IPC_CHANNELS.automationPreview, trigger),
  takeAutomationNotificationTarget: () =>
    ipcRenderer.invoke(IPC_CHANNELS.automationTakeNotification),
  loadAutomationHostSettings: () => ipcRenderer.invoke(IPC_CHANNELS.automationSettingsLoad),
  updateAutomationHostSettings: (settings) =>
    ipcRenderer.invoke(IPC_CHANNELS.automationSettingsUpdate, settings),
  onAutomationChanged: (listener) => {
    const handler = (_event: Electron.IpcRendererEvent, input: AutomationChangedEvent) =>
      listener(input);
    ipcRenderer.on(IPC_CHANNELS.automationChanged, handler);
    return () => ipcRenderer.removeListener(IPC_CHANNELS.automationChanged, handler);
  },
  onAutomationNotificationOpened: (listener) => {
    const handler = (_event: Electron.IpcRendererEvent, input: AutomationNotificationTarget) =>
      listener(input);
    ipcRenderer.on(IPC_CHANNELS.automationNotificationOpened, handler);
    return () => ipcRenderer.removeListener(IPC_CHANNELS.automationNotificationOpened, handler);
  },
  openCodeRequest: (input) => ipcRenderer.invoke(IPC_CHANNELS.request, input),
  cancelOpenCodeRequest: (requestID) => ipcRenderer.invoke(IPC_CHANNELS.cancelRequest, requestID),
  pickDirectory: (connectionID) =>
    ipcRenderer.invoke(IPC_CHANNELS.pickDirectory, undefined, connectionID),
  openExternalUrl: (url) => ipcRenderer.invoke(IPC_CHANNELS.openExternalUrl, url),
  revealFileInFinder: (path, connectionID) =>
    ipcRenderer.invoke(IPC_CHANNELS.revealFileInFinder, path, connectionID),
  externalOpenTargets: (sessionID, connectionID) =>
    ipcRenderer.invoke(IPC_CHANNELS.externalOpenTargets, sessionID, connectionID),
  externalOpen: (input, connectionID) =>
    ipcRenderer.invoke(IPC_CHANNELS.externalOpen, input, connectionID),
  pickFiles: (connectionID) => ipcRenderer.invoke(IPC_CHANNELS.pickFiles, undefined, connectionID),
  saveSessionExport: (input) => ipcRenderer.invoke(IPC_CHANNELS.saveSessionExport, input),
  pickSessionImport: () => ipcRenderer.invoke(IPC_CHANNELS.pickSessionImport),
  writeClipboardText: (value) => ipcRenderer.invoke(IPC_CHANNELS.writeClipboardText, value),
  attachClipboardImages: (images, connectionID) =>
    ipcRenderer.invoke(IPC_CHANNELS.attachClipboardImages, images, connectionID),
  attachmentPreview: (grant, connectionID) =>
    ipcRenderer.invoke(IPC_CHANNELS.attachmentPreview, grant, connectionID),
  downloadUrl: (url) => ipcRenderer.invoke(IPC_CHANNELS.downloadUrl, url),
  performanceSnapshot: () => ipcRenderer.invoke(IPC_CHANNELS.performanceSnapshot),
  performanceTraceStart: () => ipcRenderer.invoke(IPC_CHANNELS.performanceTraceStart),
  performanceTraceStop: () => ipcRenderer.invoke(IPC_CHANNELS.performanceTraceStop),
  restartApp: (input) => ipcRenderer.invoke(IPC_CHANNELS.restartApp, input),
  reportRendererStartupFailure: (message) =>
    ipcRenderer.invoke(IPC_CHANNELS.rendererStartupFailure, message),
  dataLocations: () => ipcRenderer.invoke(IPC_CHANNELS.dataLocations),
  revealDataLocation: (location) => ipcRenderer.invoke(IPC_CHANNELS.dataReveal, location),
  exportSupportBundle: () => ipcRenderer.invoke(IPC_CHANNELS.supportBundleExport),
  resetPalotData: (scope) => ipcRenderer.invoke(IPC_CHANNELS.dataReset, scope),
  showAttentionNotification: (input) =>
    ipcRenderer.invoke(IPC_CHANNELS.attentionNotification, input),
  loadAttentionSnapshot: (input) => ipcRenderer.invoke(IPC_CHANNELS.attentionSnapshot, input),
  loadDesktopNotificationSettings: () => ipcRenderer.invoke(IPC_CHANNELS.notificationSettingsLoad),
  updateDesktopNotificationSettings: (settings) =>
    ipcRenderer.invoke(IPC_CHANNELS.notificationSettingsUpdate, settings),
  desktopNotificationDeliveryStatus: () =>
    ipcRenderer.invoke(IPC_CHANNELS.notificationDeliveryStatus),
  requestDesktopNotificationPermission: () =>
    ipcRenderer.invoke(IPC_CHANNELS.notificationPermissionRequest),
  openDesktopNotificationSystemSettings: () =>
    ipcRenderer.invoke(IPC_CHANNELS.notificationSystemSettingsOpen),
  sendDesktopTestNotification: () => ipcRenderer.invoke(IPC_CHANNELS.notificationTest),
  takeOpenTarget: () => ipcRenderer.invoke(IPC_CHANNELS.openTargetTake),
  openSessionWindow: (sessionID, connectionID) =>
    ipcRenderer.invoke(IPC_CHANNELS.openSessionWindow, sessionID, connectionID),
  closeWindow: () => ipcRenderer.invoke(IPC_CHANNELS.closeWindow),
  onOpenTargetRequested: (listener) => {
    const handler = (_event: Electron.IpcRendererEvent, target: PalotOpenTarget) =>
      listener(target);
    ipcRenderer.on(IPC_CHANNELS.openTargetRequested, handler);
    return () => ipcRenderer.removeListener(IPC_CHANNELS.openTargetRequested, handler);
  },
  onOpenCodeEvents: (listener) => {
    const handler = (_event: Electron.IpcRendererEvent, batch: PalotEventBatch) =>
      listener({ ...batch, rendererReceivedAt: Date.now() });
    ipcRenderer.on(IPC_CHANNELS.events, handler);
    return () => ipcRenderer.removeListener(IPC_CHANNELS.events, handler);
  },
};

const reportStartupError = (event: ErrorEvent) => {
  void api.reportRendererStartupFailure(
    event.error instanceof Error ? event.error.message : event.message,
  );
};
const reportStartupRejection = (event: PromiseRejectionEvent) => {
  const reason = event.reason;
  void api.reportRendererStartupFailure(reason instanceof Error ? reason.message : String(reason));
};
window.addEventListener("error", reportStartupError);
window.addEventListener("unhandledrejection", reportStartupRejection);
window.addEventListener(
  "DOMContentLoaded",
  () => {
    window.removeEventListener("error", reportStartupError);
    window.removeEventListener("unhandledrejection", reportStartupRejection);
  },
  { once: true },
);

contextBridge.exposeInMainWorld("palot", api);
