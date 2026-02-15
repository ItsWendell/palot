import { app, BrowserWindow, dialog, ipcMain, nativeTheme, net, systemPreferences } from "electron"
import {
	acceptRun,
	archiveRun,
	createAutomation,
	deleteAutomation,
	getAutomation,
	listAutomations,
	listRuns,
	markRunRead,
	previewSchedule,
	runNow,
	updateAutomation,
} from "./automation"
import type { CreateAutomationInput, UpdateAutomationInput } from "./automation/types"
import { installCli, isCliInstalled, uninstallCli } from "./cli-install"
import { deleteCredential, getCredential, storeCredential } from "./credential-store"
import {
	applyChangesToLocal,
	applyDiffTextToLocal,
	checkout,
	commitAll,
	createBranch,
	getDiffStat,
	getGitRoot,
	getRemoteUrl,
	getStatus,
	listBranches,
	push,
	stashAndCheckout,
	stashPop,
} from "./git-service"
import { getResolvedChromeTier } from "./liquid-glass"
import { createLogger } from "./logger"
import { getDiscoveredServers } from "./mdns-scanner"

import { readModelState, updateModelRecent } from "./model-state"
import { dismissNotification, updateBadgeCount } from "./notifications"
import type { MigrationProvider } from "./onboarding"
import {
	checkOpenCodeInstallation,
	detectProviders,
	executeMigration,
	installOpenCode,
	previewMigration,
	restoreMigrationBackup,
	scanProvider,
} from "./onboarding"
import { getOpenInTargets, openInTarget, setPreferredTarget } from "./open-in-targets"
import { ensureServer, getServerUrl, restartServer, stopServer } from "./opencode-manager"
import { getOpaqueWindows, getSettings, onSettingsChanged, updateSettings } from "./settings-store"
import { checkForUpdates, downloadUpdate, getUpdateState, installUpdate } from "./updater"

const log = createLogger("ipc")

/** Read the opaque windows preference for use at window creation time. */
export { getOpaqueWindows as getOpaqueWindowsPref } from "./settings-store"

// ============================================================
// Serialized fetch types — used to pass Request/Response over IPC
// ============================================================

interface SerializedRequest {
	url: string
	method: string
	headers: Record<string, string>
	body: string | null
}

interface SerializedResponse {
	status: number
	statusText: string
	headers: Record<string, string>
	body: string | null
}

/**
 * Generic fetch proxy handler for the renderer process.
 *
 * The renderer serializes a Request into a plain object, sends it over IPC,
 * and the main process performs the actual HTTP request using `net.fetch()`
 * (Electron's network stack, which has no connection-per-origin limits).
 * The response is serialized back to the renderer.
 *
 * This bypasses Chromium's 6-connections-per-origin HTTP/1.1 limit, which
 * causes severe queueing when many parallel requests hit the OpenCode server.
 */
async function handleFetchProxy(
	_event: Electron.IpcMainInvokeEvent,
	req: SerializedRequest,
): Promise<SerializedResponse> {
	const response = await net.fetch(req.url, {
		method: req.method,
		headers: req.headers,
		body: req.body ?? undefined,
	})

	const body = await response.text()
	const headers: Record<string, string> = {}
	response.headers.forEach((value, key) => {
		headers[key] = value
	})

	return {
		status: response.status,
		statusText: response.statusText,
		headers,
		body,
	}
}

/**
 * Wraps an IPC handler to log errors before they propagate to the renderer.
 * Without this, errors thrown in handlers are silently serialized across IPC
 * and the main process log shows nothing.
 */
function withLogging<TArgs extends unknown[], TResult>(
	channel: string,
	handler: (...args: TArgs) => TResult | Promise<TResult>,
): (...args: TArgs) => Promise<TResult> {
	return async (...args: TArgs) => {
		try {
			return await handler(...args)
		} catch (err) {
			log.error(`Handler "${channel}" failed`, err)
			throw err
		}
	}
}

/**
 * Registers all IPC handlers that the renderer can invoke via contextBridge.
 *
 * Each handler corresponds to an endpoint that was previously served by
 * the Bun + Hono server on port 3100. Now they run in-process in Electron's
 * main process, communicating via IPC instead of HTTP.
 */
export function registerIpcHandlers(): void {
	// --- App info ---

	ipcMain.handle("app:info", () => ({
		version: app.getVersion(),
		isDev: !app.isPackaged,
	}))

	// --- OpenCode server lifecycle ---

	ipcMain.handle(
		"opencode:ensure",
		withLogging("opencode:ensure", async () => await ensureServer()),
	)

	ipcMain.handle("opencode:url", () => getServerUrl())

	ipcMain.handle(
		"opencode:stop",
		withLogging("opencode:stop", () => stopServer()),
	)

	ipcMain.handle(
		"opencode:restart",
		withLogging("opencode:restart", async () => await restartServer()),
	)

	// --- Model state ---

	ipcMain.handle(
		"model-state",
		withLogging("model-state", async () => await readModelState()),
	)

	ipcMain.handle(
		"model-state:update-recent",
		withLogging(
			"model-state:update-recent",
			async (_, model: { providerID: string; modelID: string }) => await updateModelRecent(model),
		),
	)

	// --- Auto-updater ---

	ipcMain.handle("updater:state", () => getUpdateState())

	ipcMain.handle("updater:check", async () => await checkForUpdates())

	ipcMain.handle("updater:download", async () => await downloadUpdate())

	ipcMain.handle("updater:install", async () => await installUpdate())

	// --- Git operations ---

	ipcMain.handle(
		"git:branches",
		withLogging("git:branches", async (_, directory: string) => await listBranches(directory)),
	)

	ipcMain.handle(
		"git:status",
		withLogging("git:status", async (_, directory: string) => await getStatus(directory)),
	)

	ipcMain.handle(
		"git:checkout",
		withLogging(
			"git:checkout",
			async (_, directory: string, branch: string) => await checkout(directory, branch),
		),
	)

	ipcMain.handle(
		"git:stash-and-checkout",
		withLogging(
			"git:stash-and-checkout",
			async (_, directory: string, branch: string) => await stashAndCheckout(directory, branch),
		),
	)

	ipcMain.handle(
		"git:stash-pop",
		withLogging("git:stash-pop", async (_, directory: string) => await stashPop(directory)),
	)

	ipcMain.handle(
		"git:diff-stat",
		withLogging("git:diff-stat", async (_, directory: string) => await getDiffStat(directory)),
	)

	ipcMain.handle(
		"git:commit-all",
		withLogging(
			"git:commit-all",
			async (_, directory: string, message: string) => await commitAll(directory, message),
		),
	)

	ipcMain.handle(
		"git:push",
		withLogging(
			"git:push",
			async (_, directory: string, remote?: string) => await push(directory, remote),
		),
	)

	ipcMain.handle(
		"git:create-branch",
		withLogging(
			"git:create-branch",
			async (_, directory: string, branchName: string) => await createBranch(directory, branchName),
		),
	)

	ipcMain.handle(
		"git:apply-to-local",
		withLogging(
			"git:apply-to-local",
			async (_, worktreeDir: string, localDir: string) =>
				await applyChangesToLocal(worktreeDir, localDir),
		),
	)

	ipcMain.handle(
		"git:apply-diff-text",
		withLogging(
			"git:apply-diff-text",
			async (_, localDir: string, diffText: string) =>
				await applyDiffTextToLocal(localDir, diffText),
		),
	)

	ipcMain.handle(
		"git:root",
		withLogging("git:root", async (_, directory: string) => await getGitRoot(directory)),
	)

	ipcMain.handle(
		"git:remote-url",
		withLogging(
			"git:remote-url",
			async (_, directory: string, remote?: string) => await getRemoteUrl(directory, remote),
		),
	)

	// --- Directory picker ---

	ipcMain.handle(
		"dialog:open-directory",
		withLogging("dialog:open-directory", async () => {
			const result = await dialog.showOpenDialog({
				properties: ["openDirectory"],
				title: "Select a project folder",
			})
			if (result.canceled || result.filePaths.length === 0) return null
			return result.filePaths[0]
		}),
	)

	// --- Fetch proxy (bypasses Chromium connection limits) ---

	ipcMain.handle("fetch:request", withLogging("fetch:request", handleFetchProxy))

	// --- CLI install ---

	ipcMain.handle("cli:is-installed", () => isCliInstalled())

	ipcMain.handle("cli:install", () => installCli())

	ipcMain.handle("cli:uninstall", () => uninstallCli())

	// --- Open in external app ---

	ipcMain.handle("open-in:targets", () => getOpenInTargets())

	ipcMain.handle(
		"open-in:open",
		withLogging(
			"open-in:open",
			async (_, directory: string, targetId: string, persistPreferred?: boolean) =>
				await openInTarget(directory, targetId, { persistPreferred }),
		),
	)

	ipcMain.handle("open-in:set-preferred", (_, targetId: string) => {
		setPreferredTarget(targetId)
		return { success: true }
	})

	// --- Chrome tier (pull-based, avoids race with push-based "chrome-tier" event) ---

	ipcMain.handle("chrome-tier:get", () => getResolvedChromeTier())

	// --- Window preferences (opaque windows) ---

	ipcMain.handle("prefs:get-opaque-windows", () => {
		return getOpaqueWindows()
	})

	ipcMain.handle("prefs:set-opaque-windows", (_, value: boolean) => {
		updateSettings({ opaqueWindows: value })
		return { success: true }
	})

	ipcMain.handle("app:relaunch", () => {
		app.relaunch()
		app.exit(0)
	})

	// --- Notifications ---

	ipcMain.handle("notification:dismiss", (_, sessionId: string) => {
		dismissNotification(sessionId)
	})

	ipcMain.handle("notification:badge", (_, count: number) => {
		updateBadgeCount(count)
	})

	// --- Settings ---

	ipcMain.handle("settings:get", () => getSettings())

	ipcMain.handle("settings:update", (_, partial) => updateSettings(partial))

	// --- Credential storage (safeStorage-backed) ---

	ipcMain.handle(
		"credential:store",
		withLogging("credential:store", (_, serverId: string, password: string) => {
			storeCredential(serverId, password)
		}),
	)

	ipcMain.handle("credential:get", (_, serverId: string) => getCredential(serverId))

	ipcMain.handle(
		"credential:delete",
		withLogging("credential:delete", (_, serverId: string) => {
			deleteCredential(serverId)
		}),
	)

	// --- mDNS discovery ---

	ipcMain.handle("mdns:get-discovered", () => getDiscoveredServers())

	// --- Remote server connectivity test ---

	ipcMain.handle(
		"server:test-connection",
		withLogging(
			"server:test-connection",
			async (_, url: string, username?: string, password?: string) => {
				try {
					const headers: Record<string, string> = {}
					if (password) {
						const user = username || "opencode"
						headers.Authorization = `Basic ${Buffer.from(`${user}:${password}`).toString("base64")}`
					}
					const res = await net.fetch(`${url}/session`, {
						method: "GET",
						headers,
						signal: AbortSignal.timeout(5000),
					})
					if (res.ok) return null
					if (res.status === 401) return "Authentication failed. Check username and password."
					return `Server responded with HTTP ${res.status} ${res.statusText}`
				} catch (err) {
					const msg = err instanceof Error ? err.message : String(err)
					if (msg.includes("ECONNREFUSED")) return "Connection refused. Is the server running?"
					if (msg.includes("ENOTFOUND")) return "Host not found. Check the URL."
					if (msg.includes("ETIMEDOUT") || msg.includes("timeout")) return "Connection timed out."
					if (msg.includes("CERT")) return `TLS/certificate error: ${msg}`
					return `Connection failed: ${msg}`
				}
			},
		),
	)

	// --- Native theme (controls macOS glass tint color) ---

	ipcMain.handle("theme:set-native", (_, source: string) => {
		if (source === "light" || source === "dark") {
			nativeTheme.themeSource = source
		} else {
			nativeTheme.themeSource = "system"
		}
	})

	// --- System accent color (macOS / Windows) ---

	ipcMain.handle("theme:accent-color", () => {
		try {
			return systemPreferences.getAccentColor()
		} catch {
			return null
		}
	})

	// Broadcast accent color changes to all renderer windows
	systemPreferences.on("accent-color-changed", (_event, newColor) => {
		for (const win of BrowserWindow.getAllWindows()) {
			win.webContents.send("theme:accent-color-changed", newColor)
		}
	})

	// --- Onboarding ---

	ipcMain.handle(
		"onboarding:check-opencode",
		withLogging("onboarding:check-opencode", async () => await checkOpenCodeInstallation()),
	)

	ipcMain.handle(
		"onboarding:install-opencode",
		withLogging("onboarding:install-opencode", async () => await installOpenCode()),
	)

	ipcMain.handle(
		"onboarding:detect-providers",
		withLogging("onboarding:detect-providers", async () => await detectProviders()),
	)

	ipcMain.handle(
		"onboarding:scan-provider",
		withLogging(
			"onboarding:scan-provider",
			async (_, provider: MigrationProvider) => await scanProvider(provider),
		),
	)

	ipcMain.handle(
		"onboarding:preview-migration",
		withLogging(
			"onboarding:preview-migration",
			async (_, provider: MigrationProvider, scanResult: unknown, categories: string[]) =>
				await previewMigration(provider, scanResult, categories),
		),
	)

	ipcMain.handle(
		"onboarding:execute-migration",
		withLogging(
			"onboarding:execute-migration",
			async (_, provider: MigrationProvider, scanResult: unknown, categories: string[]) =>
				await executeMigration(provider, scanResult, categories),
		),
	)

	ipcMain.handle(
		"onboarding:restore-backup",
		withLogging("onboarding:restore-backup", async () => await restoreMigrationBackup()),
	)

	// --- Automations ---

	ipcMain.handle(
		"automation:list",
		withLogging("automation:list", () => listAutomations()),
	)

	ipcMain.handle(
		"automation:get",
		withLogging("automation:get", (_, id: string) => getAutomation(id)),
	)

	ipcMain.handle(
		"automation:create",
		withLogging("automation:create", async (_, input: CreateAutomationInput) => {
			const result = await createAutomation(input)
			for (const win of BrowserWindow.getAllWindows()) {
				win.webContents.send("automation:runs-updated")
			}
			return result
		}),
	)

	ipcMain.handle(
		"automation:update",
		withLogging("automation:update", async (_, input: UpdateAutomationInput) => {
			const result = await updateAutomation(input)
			for (const win of BrowserWindow.getAllWindows()) {
				win.webContents.send("automation:runs-updated")
			}
			return result
		}),
	)

	ipcMain.handle(
		"automation:delete",
		withLogging("automation:delete", async (_, id: string) => {
			const result = await deleteAutomation(id)
			for (const win of BrowserWindow.getAllWindows()) {
				win.webContents.send("automation:runs-updated")
			}
			return result
		}),
	)

	ipcMain.handle(
		"automation:run-now",
		withLogging("automation:run-now", async (_, id: string) => {
			// runNow is fire-and-forget: it returns immediately after validating
			// the automation exists. Execution happens in the background, and
			// broadcastRunsUpdated() is called from within executeAutomation.
			return runNow(id)
		}),
	)

	ipcMain.handle(
		"automation:list-runs",
		withLogging("automation:list-runs", (_, automationId?: string) => listRuns(automationId)),
	)

	ipcMain.handle(
		"automation:archive-run",
		withLogging("automation:archive-run", async (_, runId: string) => {
			const result = await archiveRun(runId)
			for (const win of BrowserWindow.getAllWindows()) {
				win.webContents.send("automation:runs-updated")
			}
			return result
		}),
	)

	ipcMain.handle(
		"automation:accept-run",
		withLogging("automation:accept-run", async (_, runId: string) => {
			const result = await acceptRun(runId)
			for (const win of BrowserWindow.getAllWindows()) {
				win.webContents.send("automation:runs-updated")
			}
			return result
		}),
	)

	ipcMain.handle(
		"automation:mark-run-read",
		withLogging("automation:mark-run-read", async (_, runId: string) => {
			const result = await markRunRead(runId)
			for (const win of BrowserWindow.getAllWindows()) {
				win.webContents.send("automation:runs-updated")
			}
			return result
		}),
	)

	ipcMain.handle(
		"automation:preview-schedule",
		withLogging("automation:preview-schedule", (_, rrule: string, timezone: string) =>
			previewSchedule(rrule, timezone),
		),
	)

	// --- Settings push channel (main -> renderer) ---
	// Notify all renderer windows when settings change so they can update reactively.

	onSettingsChanged((settings) => {
		for (const win of BrowserWindow.getAllWindows()) {
			win.webContents.send("settings:changed", settings)
		}
	})
}
