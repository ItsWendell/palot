/**
 * Type-safe RPC client for the Codedeck local backend server (Bun + Hono).
 *
 * Uses Hono's RPC client (`hc`) with the server's AppType for end-to-end
 * type safety. The type is resolved from compiled declarations (.d.ts)
 * so the desktop app doesn't need Bun types.
 */

import { createClient } from "@codedeck/server/client"

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
 * Starts an OpenCode server for a project directory.
 * Returns the server info once it's ready to accept connections.
 */
export async function startServerForProject(directory: string) {
	const res = await client.api.servers.start.$post({
		json: { directory },
	})
	if (!res.ok) {
		const data = await res.json()
		throw new Error("error" in data ? data.error : "Failed to start server")
	}
	return res.json()
}

/**
 * Stops a managed OpenCode server for a project directory.
 */
export async function stopServerForProject(directory: string) {
	const res = await client.api.servers.stop.$post({
		json: { directory },
	})
	if (!res.ok) {
		throw new Error("Failed to stop server")
	}
	return res.json()
}

/**
 * Fetches messages for a session from local disk storage (via the Codedeck server).
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
 * Checks if the Codedeck server is running.
 */
export async function checkServerHealth() {
	try {
		const res = await client.health.$get()
		return res.ok
	} catch {
		return false
	}
}
