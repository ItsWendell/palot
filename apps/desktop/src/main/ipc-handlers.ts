import { ipcMain } from "electron"
import { discover } from "./discovery"
import { readSessionMessages } from "./messages"
import { readModelState } from "./model-state"
import { ensureServer, getServerUrl, stopServer } from "./opencode-manager"
import { checkForUpdates, downloadUpdate, getUpdateState, installUpdate } from "./updater"

/**
 * Registers all IPC handlers that the renderer can invoke via contextBridge.
 *
 * Each handler corresponds to an endpoint that was previously served by
 * the Bun + Hono server on port 3100. Now they run in-process in Electron's
 * main process, communicating via IPC instead of HTTP.
 */
export function registerIpcHandlers(): void {
	// --- OpenCode server lifecycle ---

	ipcMain.handle("opencode:ensure", async () => await ensureServer())

	ipcMain.handle("opencode:url", () => getServerUrl())

	ipcMain.handle("opencode:stop", () => stopServer())

	// --- Discovery (filesystem reads) ---

	ipcMain.handle("discover", async () => await discover())

	// --- Session messages (filesystem reads) ---

	ipcMain.handle(
		"session:messages",
		async (_, sessionId: string) => await readSessionMessages(sessionId),
	)

	// --- Model state ---

	ipcMain.handle("model-state", async () => await readModelState())

	// --- Auto-updater ---

	ipcMain.handle("updater:state", () => getUpdateState())

	ipcMain.handle("updater:check", async () => await checkForUpdates())

	ipcMain.handle("updater:download", async () => await downloadUpdate())

	ipcMain.handle("updater:install", async () => await installUpdate())
}
