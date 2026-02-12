/**
 * Unified backend service layer.
 *
 * Detects whether we're running inside Electron (preload bridge available)
 * or in a plain browser (Bun + Hono server on port 3100). All hooks import
 * from here instead of `palot-server.ts` directly.
 *
 * In Electron mode, calls go through IPC to the main process.
 * In browser mode, calls go through HTTP to the Palot server.
 */

import type {
	DiscoveryResult,
	GitBranchInfo,
	GitCheckoutResult,
	GitStashResult,
	GitStatusInfo,
	MessagesResult,
	ModelState,
	OpenInTargetsResult,
} from "../../preload/api"
import { createLogger } from "../lib/logger"

const log = createLogger("backend")

// ============================================================
// Runtime detection
// ============================================================

/**
 * Returns true when running inside Electron (preload bridge is available).
 * The `palot` object is exposed via `contextBridge.exposeInMainWorld`.
 */
export const isElectron = typeof window !== "undefined" && "palot" in window

// ============================================================
// Backend API — same signatures regardless of runtime
// ============================================================

/**
 * Fetches discovered OpenCode projects and sessions from local storage.
 */
export async function fetchDiscovery(): Promise<DiscoveryResult> {
	log.debug("fetchDiscovery", { via: isElectron ? "ipc" : "http" })
	try {
		if (isElectron) {
			return await window.palot.discover()
		}
		const { fetchDiscovery: httpFetch } = await import("./palot-server")
		const data = await httpFetch()
		return data as unknown as DiscoveryResult
	} catch (err) {
		log.error("fetchDiscovery failed", err)
		throw err
	}
}

/**
 * Ensures the single OpenCode server is running and returns its URL.
 */
export async function fetchOpenCodeUrl(): Promise<{ url: string }> {
	log.debug("fetchOpenCodeUrl", { via: isElectron ? "ipc" : "http" })
	try {
		if (isElectron) {
			const info = await window.palot.ensureOpenCode()
			log.info("OpenCode server URL resolved", { url: info.url })
			return { url: info.url }
		}
		const { fetchOpenCodeUrl: httpFetch } = await import("./palot-server")
		const result = await httpFetch()
		log.info("OpenCode server URL resolved", { url: result.url })
		return result
	} catch (err) {
		log.error("fetchOpenCodeUrl failed", err)
		throw err
	}
}

/**
 * Fetches messages for a session from local disk storage.
 * Used for offline/discovered sessions that don't have a live OpenCode server.
 */
export async function fetchSessionMessages(sessionId: string): Promise<MessagesResult> {
	log.debug("fetchSessionMessages", { sessionId, via: isElectron ? "ipc" : "http" })
	try {
		if (isElectron) {
			return await window.palot.getSessionMessages(sessionId)
		}
		const { fetchSessionMessages: httpFetch } = await import("./palot-server")
		const data = await httpFetch(sessionId)
		return data as unknown as MessagesResult
	} catch (err) {
		log.error("fetchSessionMessages failed", { sessionId }, err)
		throw err
	}
}

/**
 * Fetches the OpenCode model state (recent models, favorites, variants)
 * from ~/.local/state/opencode/model.json.
 */
export async function fetchModelState(): Promise<ModelState> {
	if (isElectron) {
		return window.palot.getModelState()
	}
	const { fetchModelState: httpFetch } = await import("./palot-server")
	return httpFetch() as unknown as Promise<ModelState>
}

/**
 * Adds a model to the front of the recent list in model.json.
 * Matches the TUI's `model.set(model, { recent: true })` behavior.
 * Returns the updated model state.
 */
export async function updateModelRecent(model: {
	providerID: string
	modelID: string
}): Promise<ModelState> {
	if (isElectron) {
		return window.palot.updateModelRecent(model)
	}
	const { updateModelRecent: httpUpdate } = await import("./palot-server")
	return httpUpdate(model) as unknown as Promise<ModelState>
}

/**
 * Checks if the backend is available.
 * In Electron, always returns true (main process is always there).
 * In browser, pings the Palot HTTP server.
 */
export async function checkBackendHealth(): Promise<boolean> {
	if (isElectron) {
		return true
	}
	const { checkServerHealth } = await import("./palot-server")
	return checkServerHealth()
}

// ============================================================
// Directory picker — Electron-only (native dialog via IPC)
// ============================================================

/**
 * Opens a native folder picker dialog.
 * Returns the selected directory path, or null if cancelled.
 */
export async function pickDirectory(): Promise<string | null> {
	if (isElectron) {
		return window.palot.pickDirectory()
	}
	throw new Error("Directory picker is only available in Electron mode")
}

// ============================================================
// Git operations — Electron-only (main process via IPC)
// In browser mode, these are not available (OpenCode server
// doesn't expose git checkout/stash APIs).
// ============================================================

/**
 * Lists all local and remote branches for a project directory.
 */
export async function fetchGitBranches(directory: string): Promise<GitBranchInfo> {
	if (isElectron) {
		return window.palot.git.listBranches(directory)
	}
	throw new Error("Git operations are only available in Electron mode")
}

/**
 * Gets the working tree status (clean/dirty, file counts).
 */
export async function fetchGitStatus(directory: string): Promise<GitStatusInfo> {
	if (isElectron) {
		return window.palot.git.getStatus(directory)
	}
	throw new Error("Git operations are only available in Electron mode")
}

/**
 * Checks out a branch. Fails if there are uncommitted changes
 * that would conflict.
 */
export async function gitCheckout(directory: string, branch: string): Promise<GitCheckoutResult> {
	if (isElectron) {
		return window.palot.git.checkout(directory, branch)
	}
	throw new Error("Git operations are only available in Electron mode")
}

/**
 * Stashes uncommitted changes, then checks out the target branch.
 */
export async function gitStashAndCheckout(
	directory: string,
	branch: string,
): Promise<GitStashResult> {
	if (isElectron) {
		return window.palot.git.stashAndCheckout(directory, branch)
	}
	throw new Error("Git operations are only available in Electron mode")
}

/**
 * Pops the most recent stash entry.
 */
export async function gitStashPop(directory: string): Promise<GitStashResult> {
	if (isElectron) {
		return window.palot.git.stashPop(directory)
	}
	throw new Error("Git operations are only available in Electron mode")
}

// ============================================================
// Open in external app — Electron-only (main process via IPC)
// ============================================================

/**
 * Gets the list of available "Open in" targets (editors, terminals, file managers)
 * with their availability status and the user's preferred target.
 */
export async function fetchOpenInTargets(): Promise<OpenInTargetsResult> {
	if (isElectron) {
		return window.palot.openIn.getTargets()
	}
	throw new Error("Open-in targets are only available in Electron mode")
}

/**
 * Opens a directory in the specified target application.
 * Optionally persists the target as the user's preferred choice.
 */
export async function openInTarget(
	directory: string,
	targetId: string,
	persistPreferred?: boolean,
): Promise<void> {
	if (isElectron) {
		return window.palot.openIn.open(directory, targetId, persistPreferred)
	}
	throw new Error("Open-in targets are only available in Electron mode")
}

/**
 * Sets the user's preferred "Open in" target without opening anything.
 */
export async function setOpenInPreferred(targetId: string): Promise<{ success: boolean }> {
	if (isElectron) {
		return window.palot.openIn.setPreferred(targetId)
	}
	throw new Error("Open-in targets are only available in Electron mode")
}
