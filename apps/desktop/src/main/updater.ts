import { BrowserWindow } from "electron"
import electronUpdater, { type AppUpdater, type UpdateInfo } from "electron-updater"

/**
 * Auto-updater module.
 *
 * Uses electron-updater to check for new releases on GitHub Releases.
 * Downloads updates in the background and notifies the renderer via IPC
 * so it can show a non-intrusive "update available" banner.
 *
 * Note: electron-updater is CJS — the destructuring workaround below is
 * required for ESM compatibility. See electron-builder#7976.
 */

function getAutoUpdater(): AppUpdater {
	const { autoUpdater } = electronUpdater
	return autoUpdater
}

/** Current update state, queryable by the renderer. */
export interface UpdateState {
	status: "idle" | "checking" | "available" | "downloading" | "ready" | "error"
	version?: string
	releaseNotes?: string
	progress?: {
		percent: number
		bytesPerSecond: number
		transferred: number
		total: number
	}
	error?: string
}

let state: UpdateState = { status: "idle" }
let checkInterval: ReturnType<typeof setInterval> | null = null

function getMainWindow(): BrowserWindow | null {
	return BrowserWindow.getAllWindows()[0] ?? null
}

function setState(next: Partial<UpdateState>): void {
	state = { ...state, ...next }
	getMainWindow()?.webContents.send("updater:state-changed", state)
}

/**
 * Initialises the auto-updater. Call once after the main window is created.
 * In development (unpackaged), this is a no-op.
 */
export function initAutoUpdater(): void {
	if (!require("electron").app.isPackaged) return

	const autoUpdater = getAutoUpdater()

	// Logging
	autoUpdater.logger = console

	// Don't auto-download — let the user trigger it, or download silently
	// after they've been notified.
	autoUpdater.autoDownload = false

	// Install on quit by default
	autoUpdater.autoInstallOnAppQuit = true

	// ── Events ──────────────────────────────────────────────────

	autoUpdater.on("checking-for-update", () => {
		setState({ status: "checking" })
	})

	autoUpdater.on("update-available", (info: UpdateInfo) => {
		setState({
			status: "available",
			version: info.version,
			releaseNotes:
				typeof info.releaseNotes === "string"
					? info.releaseNotes
					: Array.isArray(info.releaseNotes)
						? info.releaseNotes.map((n) => n.note).join("\n")
						: undefined,
		})
	})

	autoUpdater.on("update-not-available", () => {
		setState({ status: "idle" })
	})

	autoUpdater.on("download-progress", (progress) => {
		setState({
			status: "downloading",
			progress: {
				percent: progress.percent,
				bytesPerSecond: progress.bytesPerSecond,
				transferred: progress.transferred,
				total: progress.total,
			},
		})
	})

	autoUpdater.on("update-downloaded", () => {
		setState({ status: "ready", progress: undefined })
	})

	autoUpdater.on("error", (err) => {
		console.error("[auto-updater] Error:", err.message)
		setState({ status: "error", error: err.message })
	})

	// ── Initial check (10s after launch) + periodic (every 4 hours) ──

	setTimeout(() => {
		autoUpdater.checkForUpdates().catch(() => {})
	}, 10_000)

	checkInterval = setInterval(
		() => {
			autoUpdater.checkForUpdates().catch(() => {})
		},
		4 * 60 * 60 * 1000,
	)
}

/** Returns the current update state (for IPC handler). */
export function getUpdateState(): UpdateState {
	return state
}

/** Manually triggers an update check. */
export async function checkForUpdates(): Promise<void> {
	if (!require("electron").app.isPackaged) return
	await getAutoUpdater().checkForUpdates()
}

/** Starts downloading the available update. */
export async function downloadUpdate(): Promise<void> {
	await getAutoUpdater().downloadUpdate()
}

/** Quits and installs the downloaded update. */
export function installUpdate(): void {
	getAutoUpdater().quitAndInstall(false, true)
}

/** Cleanup — call on app quit. */
export function stopAutoUpdater(): void {
	if (checkInterval) {
		clearInterval(checkInterval)
		checkInterval = null
	}
}
