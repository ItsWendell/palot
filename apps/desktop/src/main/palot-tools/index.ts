import { connectClientMcp } from "@opencode/client/mcp";
import { BrowserWindow } from "electron";
import { IPC_CHANNELS, type SessionTriageSnapshot } from "../../shared";
import { automationService } from "../automations/service";
import { openCodeRuntime } from "../opencode-runtime";
import { sessionTriageStore } from "../session-triage-store";
import { refreshTrayMenu } from "../tray";
import { PalotToolHost } from "./host";

let host: PalotToolHost | null = null;

export function palotToolHost(): PalotToolHost {
  return (host ??= new PalotToolHost({
    runtime: openCodeRuntime,
    connect: connectClientMcp,
    automations: automationService(),
    triage: sessionTriageStore(),
    onTriageChanged: broadcastSessionTriage,
    enabled: () => automationService().agentToolsEnabled(),
    askBeforeScheduling: () => automationService().askBeforeAgentScheduling(),
  }));
}

export async function shutdownPalotToolHost(): Promise<void> {
  const current = host;
  host = null;
  await current?.shutdown();
}

/** Triage changed outside a window's own dispatch, such as by an agent tool. */
export function broadcastSessionTriage(snapshot: SessionTriageSnapshot): void {
  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed()) window.webContents.send(IPC_CHANNELS.triageChanged, snapshot);
  }
  refreshTrayMenu();
}
