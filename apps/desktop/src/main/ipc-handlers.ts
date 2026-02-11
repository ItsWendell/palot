import path from "node:path"
import { app, dialog, ipcMain, nativeTheme, net } from "electron"
import { installCli, isCliInstalled, uninstallCli } from "./cli-install"
import { discover } from "./discovery"
import { checkout, getStatus, listBranches, stashAndCheckout, stashPop } from "./git-service"
import { getResolvedChromeTier } from "./liquid-glass"
import { createLogger } from "./logger"
import { readSessionMessages } from "./messages"
import { readModelState, updateModelRecent } from "./model-state"
import { dismissNotification, updateBadgeCount } from "./notifications"
import { getOpenInTargets, openInTarget, setPreferredTarget } from "./open-in-targets"
import { ensureServer, getServerUrl, stopServer } from "./opencode-manager"
import { checkForUpdates, downloadUpdate, getUpdateState, installUpdate } from "./updater"

const log = createLogger("ipc")

// ============================================================
// Simple JSON preferences file for main-process-readable settings.
// Stored in userData (e.g. ~/Library/Application Support/Codedeck/preferences.json).
// Only settings that the main process needs at window creation time go here.
// ============================================================

const PREFS_FILE = () => path.join(app.getPath("userData"), "preferences.json")

interface MainPreferences {
	opaqueWindows?: boolean
}

function readMainPreferences(): MainPreferences {
	try {
		const fs = require("node:fs") as typeof import("node:fs")
		const data = fs.readFileSync(PREFS_FILE(), "utf-8")
		return JSON.parse(data) as MainPreferences
	} catch {
		return {}
	}
}

function writeMainPreferences(prefs: MainPreferences): void {
	try {
		const fs = require("node:fs") as typeof import("node:fs")
		fs.mkdirSync(path.dirname(PREFS_FILE()), { recursive: true })
		fs.writeFileSync(PREFS_FILE(), JSON.stringify(prefs, null, 2), "utf-8")
	} catch (err) {
		log.error("Failed to write preferences:", err)
	}
}

/** Read the opaque windows preference for use at window creation time. */
export function getOpaqueWindowsPref(): boolean {
	return readMainPreferences().opaqueWindows === true
}

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

	// --- Discovery (filesystem reads) ---

	ipcMain.handle(
		"discover",
		withLogging("discover", async () => await discover()),
	)

	// --- Session messages (filesystem reads) ---

	ipcMain.handle(
		"session:messages",
		withLogging(
			"session:messages",
			async (_, sessionId: string) => await readSessionMessages(sessionId),
		),
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
		return readMainPreferences().opaqueWindows === true
	})

	ipcMain.handle("prefs:set-opaque-windows", (_, value: boolean) => {
		const prefs = readMainPreferences()
		prefs.opaqueWindows = value
		writeMainPreferences(prefs)
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

	// --- Native theme (controls macOS glass tint color) ---

	ipcMain.handle("theme:set-native", (_, source: string) => {
		if (source === "light" || source === "dark") {
			nativeTheme.themeSource = source
		} else {
			nativeTheme.themeSource = "system"
		}
	})
}
