/**
 * Unified backend service layer.
 *
 * Detects whether we're running inside Electron (preload bridge available)
 * or in a plain browser (Bun + Hono server on port 3100). All hooks import
 * from here instead of `codedeck-server.ts` directly.
 *
 * In Electron mode, calls go through IPC to the main process.
 * In browser mode, calls go through HTTP to the Codedeck server.
 */

import type { DiscoveryResult, MessagesResult, ModelState } from "../../preload/api"

// ============================================================
// Runtime detection
// ============================================================

/**
 * Returns true when running inside Electron (preload bridge is available).
 * The `codedeck` object is exposed via `contextBridge.exposeInMainWorld`.
 */
export const isElectron = typeof window !== "undefined" && "codedeck" in window

// ============================================================
// Backend API — same signatures regardless of runtime
// ============================================================

/**
 * Fetches discovered OpenCode projects and sessions from local storage.
 */
export async function fetchDiscovery(): Promise<DiscoveryResult> {
	if (isElectron) {
		return window.codedeck.discover()
	}
	const { fetchDiscovery: httpFetch } = await import("./codedeck-server")
	const data = await httpFetch()
	return data as unknown as DiscoveryResult
}

/**
 * Ensures the single OpenCode server is running and returns its URL.
 */
export async function fetchOpenCodeUrl(): Promise<{ url: string }> {
	if (isElectron) {
		const info = await window.codedeck.ensureOpenCode()
		return { url: info.url }
	}
	const { fetchOpenCodeUrl: httpFetch } = await import("./codedeck-server")
	return httpFetch()
}

/**
 * Fetches messages for a session from local disk storage.
 * Used for offline/discovered sessions that don't have a live OpenCode server.
 */
export async function fetchSessionMessages(sessionId: string): Promise<MessagesResult> {
	if (isElectron) {
		return window.codedeck.getSessionMessages(sessionId)
	}
	const { fetchSessionMessages: httpFetch } = await import("./codedeck-server")
	const data = await httpFetch(sessionId)
	return data as unknown as MessagesResult
}

/**
 * Fetches the OpenCode model state (recent models, favorites, variants)
 * from ~/.local/state/opencode/model.json.
 */
export async function fetchModelState(): Promise<ModelState> {
	if (isElectron) {
		return window.codedeck.getModelState()
	}
	const { fetchModelState: httpFetch } = await import("./codedeck-server")
	return httpFetch() as unknown as Promise<ModelState>
}

/**
 * Checks if the backend is available.
 * In Electron, always returns true (main process is always there).
 * In browser, pings the Codedeck HTTP server.
 */
export async function checkBackendHealth(): Promise<boolean> {
	if (isElectron) {
		return true
	}
	const { checkServerHealth } = await import("./codedeck-server")
	return checkServerHealth()
}
