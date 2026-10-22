/** Bridge for the floating voice overlay window. Exposes nothing beyond the call mirror. */

import { contextBridge, ipcRenderer } from "electron";
import type {
  PalotVoiceOverlayApi,
  VOICE_IPC_CHANNELS,
  VoiceAudioLevels,
  VoiceCallSnapshot,
} from "../shared/voice-contract";

// Sandboxed preloads cannot require sibling chunks. Importing shared runtime values from
// both preload entries would split them into one, so the channels are restated here and
// checked against the contract by the compiler.
const CHANNELS = {
  overlayState: "palot:voice:overlay-state",
  overlayLevels: "palot:voice:overlay-levels",
  overlayCommand: "palot:voice:overlay-command",
  overlayReady: "palot:voice:overlay-ready",
} as const satisfies Pick<
  typeof VOICE_IPC_CHANNELS,
  "overlayState" | "overlayLevels" | "overlayCommand" | "overlayReady"
>;

const platform = process.platform;

const api: PalotVoiceOverlayApi = {
  platform: platform === "darwin" || platform === "win32" ? platform : "linux",
  ready: () => ipcRenderer.invoke(CHANNELS.overlayReady),
  command: (command) => ipcRenderer.invoke(CHANNELS.overlayCommand, command),
  onState: (listener) => {
    const handler = (_event: Electron.IpcRendererEvent, snapshot: VoiceCallSnapshot) =>
      listener(snapshot);
    ipcRenderer.on(CHANNELS.overlayState, handler);
    return () => ipcRenderer.removeListener(CHANNELS.overlayState, handler);
  },
  onLevels: (listener) => {
    const handler = (_event: Electron.IpcRendererEvent, levels: VoiceAudioLevels) =>
      listener(levels);
    ipcRenderer.on(CHANNELS.overlayLevels, handler);
    return () => ipcRenderer.removeListener(CHANNELS.overlayLevels, handler);
  },
};

contextBridge.exposeInMainWorld("palotVoiceOverlay", api);
