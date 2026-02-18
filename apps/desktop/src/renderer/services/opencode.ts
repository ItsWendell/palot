import type { OpencodeClient } from "@opencode-ai/sdk/v2/client"
import { createOpencodeClient } from "@opencode-ai/sdk/v2/client"
import { createLogger } from "../lib/logger"
import type { Event, OpenCodeProject, QuestionAnswer, Session, SessionStatus } from "../lib/types"

export type { OpencodeClient }

/**
 * Callable fetch signature. We avoid `typeof fetch` because Node 24 adds
 * static properties (e.g. `preconnect`) that wrapper functions don't carry.
 */
type FetchFn = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>

const log = createLogger("opencode")

const isElectron = typeof window !== "undefined" && "palot" in window

/**
 * Determines if a fetch error is a transient network error worth retrying.
 * Covers Chromium-specific issues like ERR_ALPN_NEGOTIATION_FAILED,
 * ERR_CONNECTION_RESET, and generic "Failed to fetch" / "Load failed".
 */
function isTransientNetworkError(err: unknown): boolean {
	if (!(err instanceof TypeError)) return false
	const msg = err.message.toLowerCase()
	return msg.includes("failed to fetch") || msg.includes("load failed") || msg.includes("network")
}

/**
 * Wraps a base fetch with automatic retry for transient network errors.
 *
 * Chromium (and therefore Electron) can occasionally fail requests to
 * localhost with ERR_ALPN_NEGOTIATION_FAILED or ERR_CONNECTION_RESET when
 * its internal connection pool gets into a bad state. A single retry after
 * a brief delay recovers from these transient issues.
 *
 * Only retries on TypeError (network-level failures). HTTP error responses
 * (4xx, 5xx) are NOT retried — they indicate server-side issues.
 */
function createRetryFetch(baseFetch: FetchFn = fetch, maxRetries = 2, baseDelayMs = 150): FetchFn {
	return async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
		let lastError: unknown
		for (let attempt = 0; attempt <= maxRetries; attempt++) {
			try {
				return await baseFetch(input, init)
			} catch (err) {
				lastError = err
				if (attempt < maxRetries && isTransientNetworkError(err)) {
					const delay = baseDelayMs * 2 ** attempt
					log.warn("Transient network error, retrying", {
						attempt: attempt + 1,
						maxRetries,
						delay,
						error: String(err),
						url: input instanceof Request ? input.url : String(input),
					})
					await new Promise((resolve) => setTimeout(resolve, delay))
					continue
				}
				throw err
			}
		}
		throw lastError
	}
}

// ============================================================
// IPC fetch proxy — routes non-SSE requests through the main
// process to bypass Chromium's 6-connections-per-origin limit.
// ============================================================

/**
 * Checks whether a Request is for an SSE (Server-Sent Events) stream.
 * SSE requests must stay in the renderer because they return a streaming
 * ReadableStream body that can't be serialized over IPC.
 */
function isSseRequest(request: Request): boolean {
	return (
		request.headers.get("accept") === "text/event-stream" || request.url.includes("/global/event")
	)
}

/**
 * Creates a fetch implementation that proxies requests through Electron's
 * main process via IPC, bypassing the browser's HTTP/1.1 connection limit.
 *
 * The main process uses `net.fetch()` (Electron's network stack) which has
 * no per-origin connection cap. This eliminates the 30-50s queueing delays
 * that occur when many parallel requests compete for 6 connection slots.
 *
 * SSE requests are excluded — they need a streaming ReadableStream body
 * which can't be serialized over IPC, so they use regular browser fetch.
 *
 * When `authHeader` is provided, it is injected into every request (including
 * SSE) to support HTTP Basic Auth for remote OpenCode servers.
 */
function createIpcFetch(authHeader?: string): FetchFn {
	return async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
		// Normalize input to a Request object (the SDK always passes a Request,
		// but handle URL/string too for robustness)
		const request = input instanceof Request ? input : new Request(input, init)

		// SSE streams must stay in the renderer — they need a streaming body
		if (isSseRequest(request)) {
			// Inject auth header into SSE requests if needed
			if (authHeader) {
				const headers = new Headers(request.headers)
				headers.set("Authorization", authHeader)
				return fetch(new Request(request, { headers }))
			}
			return fetch(request)
		}

		// Serialize the Request into a plain object for IPC transport
		const headers: Record<string, string> = {}
		request.headers.forEach((value, key) => {
			headers[key] = value
		})

		// Inject auth header for remote servers
		if (authHeader) {
			headers.Authorization = authHeader
		}

		const body = request.body ? await request.text() : null

		const serialized = {
			url: request.url,
			method: request.method,
			headers,
			body,
		}

		log.info("IPC fetch →", { method: request.method, url: request.url })
		const start = performance.now()
		// Send through IPC → main process → net.fetch() → back
		const result = await window.palot.fetch(serialized)
		const durationMs = Math.round(performance.now() - start)
		log.info("IPC fetch ←", {
			method: request.method,
			url: request.url,
			status: result.status,
			durationMs,
		})

		// HTTP spec: 101, 204, 205, 304 are "null body statuses" and the
		// Response constructor throws if you pass a non-null body with them.
		// The main process may serialize an empty string for these, so we
		// must explicitly pass null.
		const isNullBodyStatus = [101, 204, 205, 304].includes(result.status)

		// Reconstruct a Response object from the serialized result
		return new Response(isNullBodyStatus ? null : result.body, {
			status: result.status,
			statusText: result.statusText,
			headers: result.headers,
		})
	}
}

// ============================================================
// Auth helpers
// ============================================================

/**
 * Build an HTTP Basic Auth header value from username and password.
 */
export function buildBasicAuthHeader(username: string, password: string): string {
	return `Basic ${btoa(`${username}:${password}`)}`
}

// ============================================================
// Client creation
// ============================================================

export interface ConnectOptions {
	/** Project directory for scoped requests. */
	directory?: string
	/** Pre-built Authorization header value (e.g. "Basic dXNlcjpwYXNz"). */
	authHeader?: string
}

/**
 * Creates an OpenCode client connected to a running server.
 *
 * When a `directory` is provided, the SDK's built-in `x-opencode-directory`
 * header is used. The OpenCode server reads this header (or a `?directory=`
 * query param) to scope requests to the correct project instance.
 *
 * When `authHeader` is provided, it is injected into every request for
 * HTTP Basic Auth (used by remote OpenCode servers).
 *
 * In Electron mode, non-SSE requests are proxied through the main process
 * via IPC to bypass Chromium's 6-connections-per-origin HTTP/1.1 limit.
 * SSE requests (for the event stream) still use the browser's native fetch.
 */
export function connectToServer(url: string, options?: ConnectOptions): OpencodeClient {
	const { directory, authHeader } = options ?? {}

	// In Electron: use IPC-based fetch (with retry wrapper on top) for API calls,
	// falling back to browser fetch only for SSE streams.
	// In browser: use regular fetch with retry wrapper (no IPC available).
	const baseFetch = isElectron ? createIpcFetch(authHeader) : createBrowserFetch(authHeader)

	return createOpencodeClient({
		baseUrl: url,
		directory,
		// Wrap with retry logic to handle transient Chromium network errors
		// (e.g. ERR_ALPN_NEGOTIATION_FAILED on localhost connections)
		fetch: createRetryFetch(baseFetch) as typeof fetch,
	})
}

/**
 * Creates a browser fetch wrapper that optionally injects an auth header.
 * Used in non-Electron (browser dev) mode.
 */
function createBrowserFetch(authHeader?: string): FetchFn {
	if (!authHeader) return fetch
	return async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
		const request = input instanceof Request ? input : new Request(input, init)
		const headers = new Headers(request.headers)
		headers.set("Authorization", authHeader)
		return fetch(new Request(request, { headers }))
	}
}

/**
 * Fetch all projects known to the server.
 */
export async function listProjects(client: OpencodeClient): Promise<OpenCodeProject[]> {
	const result = await client.project.list()
	return (result.data as OpenCodeProject[]) ?? []
}

/**
 * Fetch sessions from a server with optional filtering/pagination.
 *
 * @param limit  Maximum number of sessions to return (server default: 100)
 * @param roots  Only return root sessions (no sub-agents)
 * @param search Filter sessions by title (case-insensitive substring match)
 */
export async function listSessions(
	client: OpencodeClient,
	options?: { limit?: number; roots?: boolean; search?: string },
): Promise<Session[]> {
	const params = {
		limit: options?.limit,
		roots: options?.roots,
		search: options?.search,
	}
	log.info("Listing sessions", params)
	const result = await client.session.list(params)
	const sessions = (result.data as Session[]) ?? []
	log.info("Listed sessions", { count: sessions.length, ...params })
	return sessions
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
 * Reply to a question request from the AI assistant.
 */
export async function replyToQuestion(
	client: OpencodeClient,
	requestId: string,
	answers: QuestionAnswer[],
): Promise<void> {
	await client.question.reply({ requestID: requestId, answers })
}

/**
 * Reject a question request from the AI assistant.
 */
export async function rejectQuestion(client: OpencodeClient, requestId: string): Promise<void> {
	await client.question.reject({ requestID: requestId })
}

/**
 * Dispose a specific project instance on the OpenCode server.
 * This forces the server to re-read all config, agents, skills, etc. from disk
 * for that project. The resulting `server.instance.disposed` SSE event triggers
 * automatic query invalidation in the UI.
 */
export async function disposeInstance(client: OpencodeClient): Promise<void> {
	await client.instance.dispose()
}

/**
 * Dispose all instances on the OpenCode server (global reload).
 * Forces re-initialization of all project instances, re-reading all config
 * files, agents, skills, commands, etc. from disk. The resulting
 * `global.disposed` SSE event triggers automatic query invalidation in the UI.
 */
export async function disposeAllInstances(client: OpencodeClient): Promise<void> {
	await client.global.dispose()
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
 * Revert a session to a specific message (undo).
 * Rolls back filesystem changes and marks messages after the revert point.
 */
export async function revertSession(
	client: OpencodeClient,
	sessionId: string,
	messageId: string,
): Promise<Session> {
	const result = await client.session.revert({
		sessionID: sessionId,
		messageID: messageId,
	})
	return result.data as Session
}

/**
 * Unrevert a session (redo).
 * Restores previously reverted messages and filesystem state.
 */
export async function unrevertSession(client: OpencodeClient, sessionId: string): Promise<Session> {
	const result = await client.session.unrevert({
		sessionID: sessionId,
	})
	return result.data as Session
}

/**
 * Execute a named command on a session.
 * Server-side commands like /init, /review, or user-defined commands.
 */
export async function executeCommand(
	client: OpencodeClient,
	sessionId: string,
	command: string,
	args: string,
): Promise<void> {
	await client.session.command({
		sessionID: sessionId,
		command,
		arguments: args,
	})
}

/**
 * List available commands from the server.
 */
export async function listCommands(
	client: OpencodeClient,
): Promise<Array<{ name: string; description?: string }>> {
	const result = await client.command.list()
	return (result.data ?? []) as Array<{ name: string; description?: string }>
}

/**
 * Search for files in the project.
 * Returns file paths as strings (from the OpenCode /find/file endpoint).
 */
export async function findFiles(client: OpencodeClient, query: string): Promise<string[]> {
	const result = await client.find.files({ query })
	return (result.data ?? []) as string[]
}

/**
 * Summarize/compact a session conversation.
 */
export async function summarizeSession(client: OpencodeClient, sessionId: string): Promise<void> {
	await client.session.summarize({ sessionID: sessionId })
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
