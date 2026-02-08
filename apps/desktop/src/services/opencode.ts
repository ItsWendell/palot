import type { OpencodeClient } from "@opencode-ai/sdk/v2/client"
import { createOpencodeClient } from "@opencode-ai/sdk/v2/client"
import type { Event, Session, SessionStatus } from "../lib/types"

export type { OpencodeClient }

/**
 * Creates an OpenCode client connected to a running server.
 * For now, we connect to an existing server. Later, Tauri will spawn servers.
 */
export function connectToServer(url: string, directory?: string): OpencodeClient {
	return createOpencodeClient({
		baseUrl: url,
		directory,
	})
}

/**
 * Fetch all sessions from a server.
 */
export async function listSessions(client: OpencodeClient): Promise<Session[]> {
	const result = await client.session.list()
	return (result.data as Session[]) ?? []
}

/**
 * Get session statuses (running/idle/retry) for all sessions.
 */
export async function getSessionStatuses(
	client: OpencodeClient,
): Promise<Record<string, SessionStatus>> {
	const result = await client.session.status()
	return (result.data as Record<string, SessionStatus>) ?? {}
}

/**
 * Create a new session (= new agent).
 */
export async function createSession(client: OpencodeClient, title?: string): Promise<Session> {
	const result = await client.session.create({ title })
	return result.data as Session
}

/**
 * Send a prompt to a session (async — returns immediately, track via events).
 */
export async function sendPrompt(
	client: OpencodeClient,
	sessionId: string,
	text: string,
	options?: {
		providerID?: string
		modelID?: string
		agent?: string
		variant?: string
	},
): Promise<void> {
	await client.session.promptAsync({
		sessionID: sessionId,
		parts: [{ type: "text", text }],
		model:
			options?.providerID && options?.modelID
				? { providerID: options.providerID, modelID: options.modelID }
				: undefined,
		agent: options?.agent,
		variant: options?.variant,
	})
}

/**
 * Abort a running session.
 */
export async function abortSession(client: OpencodeClient, sessionId: string): Promise<void> {
	await client.session.abort({ sessionID: sessionId })
}

/**
 * Rename a session (update its title).
 */
export async function renameSession(
	client: OpencodeClient,
	sessionId: string,
	title: string,
): Promise<void> {
	await client.session.update({ sessionID: sessionId, title })
}

/**
 * Delete a session.
 */
export async function deleteSession(client: OpencodeClient, sessionId: string): Promise<void> {
	await client.session.delete({ sessionID: sessionId })
}

/**
 * Get file diffs for a session.
 */
export async function getSessionDiff(client: OpencodeClient, sessionId: string) {
	const result = await client.session.diff({ sessionID: sessionId })
	return result.data ?? []
}

/**
 * Respond to a permission request.
 */
export async function respondToPermission(
	client: OpencodeClient,
	sessionId: string,
	permissionId: string,
	response: "once" | "always" | "reject",
): Promise<void> {
	await client.permission.respond({
		sessionID: sessionId,
		permissionID: permissionId,
		response,
	})
}

/**
 * Global event from the /global/event SSE endpoint.
 * Wraps each Event with the directory it belongs to.
 */
export interface GlobalEvent {
	directory: string
	payload: Event
}

/**
 * Subscribe to global SSE events from the server.
 * Uses `/global/event` which streams events from ALL projects,
 * each tagged with their directory. This avoids the per-directory
 * scoping issue where `/event` only returns events for one Instance.
 */
export async function subscribeToGlobalEvents(
	client: OpencodeClient,
): Promise<AsyncIterable<GlobalEvent>> {
	const result = await client.global.event()
	return result.stream as AsyncIterable<GlobalEvent>
}

/**
 * Get messages for a session (for initial load of activity feed).
 */
export async function getSessionMessages(client: OpencodeClient, sessionId: string) {
	const result = await client.session.messages({
		sessionID: sessionId,
	})
	return result.data ?? []
}
