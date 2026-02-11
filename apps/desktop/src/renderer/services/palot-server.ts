/**
 * Type-safe RPC client for the Palot local backend server (Bun + Hono).
 *
 * Uses Hono's RPC client (`hc`) with the server's AppType for end-to-end
 * type safety. The type is resolved from compiled declarations (.d.ts)
 * so the desktop app doesn't need Bun types.
 */

import { createClient } from "@palot/server/client"

const BASE_URL = "http://localhost:3100"

/**
 * Pre-typed Hono RPC client.
 * All routes are fully typed — autocomplete on paths, inferred request/response types.
 */
export const client = createClient(BASE_URL)

/**
 * Fetches discovered OpenCode projects and sessions from local storage.
 */
export async function fetchDiscovery() {
	const res = await client.api.discover.$get()
	if (!res.ok) {
		throw new Error(`Discovery failed: ${res.status} ${res.statusText}`)
	}
	return res.json()
}

/**
 * Fetches all running OpenCode servers (detected + managed).
 */
export async function fetchServers() {
	const res = await client.api.servers.$get()
	if (!res.ok) {
		throw new Error(`Server list failed: ${res.status} ${res.statusText}`)
	}
	return res.json()
}

/**
 * Ensures the single OpenCode server is running and returns its URL.
 * Calls `GET /api/servers/opencode` on the Palot backend.
 */
export async function fetchOpenCodeUrl(): Promise<{ url: string }> {
	const res = await client.api.servers.opencode.$get()
	if (!res.ok) {
		const data = await res.json()
		throw new Error("error" in data ? data.error : "Failed to get OpenCode server URL")
	}
	return res.json()
}

/**
 * Fetches messages for a session from local disk storage (via the Palot server).
 * Used for offline/discovered sessions that don't have a live OpenCode server.
 */
export async function fetchSessionMessages(sessionId: string) {
	const res = await client.api.sessions[":id"].messages.$get({
		param: { id: sessionId },
	})
	if (!res.ok) {
		throw new Error(`Messages fetch failed: ${res.status} ${res.statusText}`)
	}
	return res.json()
}

/**
 * Fetches the OpenCode model state (recent models, favorites, variants)
 * from the backend, which reads ~/.local/state/opencode/model.json.
 */
export async function fetchModelState(): Promise<{
	recent: { providerID: string; modelID: string }[]
	favorite: { providerID: string; modelID: string }[]
	variant: Record<string, string | undefined>
}> {
	const res = await client.api["model-state"].$get()
	if (!res.ok) {
		throw new Error(`Model state fetch failed: ${res.status} ${res.statusText}`)
	}
	return res.json()
}

/**
 * Updates the recent model list via the backend server.
 * Adds the model to the front, deduplicates, caps at 10.
 */
export async function updateModelRecent(model: { providerID: string; modelID: string }): Promise<{
	recent: { providerID: string; modelID: string }[]
	favorite: { providerID: string; modelID: string }[]
	variant: Record<string, string | undefined>
}> {
	const res = await client.api["model-state"].recent.$post({
		json: model,
	})
	if (!res.ok) {
		throw new Error(`Model state update failed: ${res.status} ${res.statusText}`)
	}
	return res.json()
}

/**
 * Checks if the Palot server is running.
 */
export async function checkServerHealth() {
	try {
		const res = await client.health.$get()
		return res.ok
	} catch {
		return false
	}
}
