import type { OpencodeClient } from "@opencode-ai/sdk/v2/client"
import type { Event } from "../lib/types"
import { useAppStore } from "../stores/app-store"
import {
	connectToServer,
	getSessionStatuses,
	listSessions,
	subscribeToGlobalEvents,
} from "./opencode"

// ============================================================
// State — single server connection + per-project clients
// ============================================================

/** The single OpenCode server connection */
let connection: {
	url: string
	/** Base client (no directory) — used for SSE subscription */
	baseClient: OpencodeClient
	abortController: AbortController
} | null = null

/** Per-project SDK clients, keyed by directory path */
const projectClients = new Map<string, OpencodeClient>()

// ============================================================
// Public API
// ============================================================

/**
 * Connect to the single OpenCode server.
 * Starts SSE subscription for all-project events.
 */
export async function connectToOpenCode(url: string): Promise<void> {
	// Disconnect existing connection if any
	if (connection) {
		connection.abortController.abort()
		projectClients.clear()
	}

	const store = useAppStore.getState()
	store.setOpenCodeUrl(url)

	// Base client has no directory — used for SSE events (which cover all projects)
	const baseClient = connectToServer(url)
	const abortController = new AbortController()

	connection = { url, baseClient, abortController }

	// Start SSE event loop in the background
	startEventLoop(baseClient, abortController.signal)

	store.setOpenCodeConnected(true)
}

/**
 * Load sessions for a specific project directory from the server.
 * Merges them into the flat store.
 */
export async function loadProjectSessions(directory: string): Promise<void> {
	const client = getProjectClient(directory)
	if (!client) return

	const store = useAppStore.getState()
	try {
		const [sessions, statuses] = await Promise.all([
			listSessions(client),
			getSessionStatuses(client),
		])
		store.setSessions(sessions, statuses, directory)
	} catch (err) {
		console.error(`Failed to load sessions for ${directory}:`, err)
	}
}

/**
 * Get or create a project-scoped SDK client.
 * All project clients point at the same URL but send different
 * `x-opencode-directory` headers.
 */
export function getProjectClient(directory: string): OpencodeClient | null {
	if (!connection) return null

	let client = projectClients.get(directory)
	if (!client) {
		client = connectToServer(connection.url, directory)
		projectClients.set(directory, client)
	}
	return client
}

/**
 * Check if we're connected to the OpenCode server.
 */
export function isConnected(): boolean {
	return connection !== null
}

/**
 * Get the server URL, or null if not connected.
 */
export function getServerUrl(): string | null {
	return connection?.url ?? null
}

/**
 * Disconnect from the OpenCode server.
 */
export function disconnect(): void {
	if (connection) {
		connection.abortController.abort()
		connection = null
		projectClients.clear()
	}
	const store = useAppStore.getState()
	store.setOpenCodeConnected(false)
}

// ============================================================
// Event Batching (OpenCode-inspired 16ms flush with coalescing)
// ============================================================

/** Target frame interval — ~60fps */
const FRAME_BUDGET_MS = 16

/**
 * Generates a coalescing key for events where only the latest matters.
 * Returns `undefined` for events that must NOT be coalesced (every instance matters).
 */
function coalescingKey(event: Event): string | undefined {
	switch (event.type) {
		case "message.part.updated": {
			const part = event.properties.part
			return `part:${part.messageID}:${part.id}`
		}
		case "session.status":
			return `status:${event.properties.sessionID}`
		default:
			return undefined
	}
}

/**
 * Batches and coalesces SSE events before dispatching to the Zustand store.
 *
 * Strategy (borrowed from OpenCode's TUI):
 * - Incoming events are queued into a batch.
 * - If the same coalescing key appears multiple times in the batch, only the
 *   latest event is kept (e.g. rapid `message.part.updated` for the same part).
 * - The batch is flushed at most every 16ms (~60fps).
 * - The *first* event after a quiet period flushes immediately (no added latency).
 */
function createEventBatcher() {
	/** Ordered queue of events (non-coalescable) */
	let queue: Event[] = []
	/** Coalescable events — only the latest per key is kept */
	const coalesced = new Map<string, Event>()
	let timer: ReturnType<typeof setTimeout> | undefined
	let lastFlush = 0

	function flush() {
		// Merge coalesced events into the queue
		const events = [...queue, ...coalesced.values()]
		queue = []
		coalesced.clear()
		timer = undefined
		lastFlush = Date.now()

		if (events.length === 0) return

		// Dispatch all events through the store in one synchronous pass.
		// React 18+ automatically batches synchronous setState calls within
		// the same microtask, so these will coalesce into one render.
		const { processEvent } = useAppStore.getState()
		for (const event of events) {
			processEvent(event)
		}
	}

	function enqueue(event: Event) {
		const key = coalescingKey(event)
		if (key) {
			// Coalescable — overwrite any previous event with the same key
			coalesced.set(key, event)
		} else {
			queue.push(event)
		}

		// If a timer is already scheduled, the event will be included in that flush
		if (timer) return

		const elapsed = Date.now() - lastFlush
		if (elapsed < FRAME_BUDGET_MS) {
			// Within the current frame budget — defer flush to next frame
			timer = setTimeout(flush, FRAME_BUDGET_MS)
		} else {
			// Enough time has passed — flush immediately (keeps first-event latency low)
			flush()
		}
	}

	function dispose() {
		if (timer) {
			clearTimeout(timer)
			timer = undefined
		}
		// Flush any remaining events
		flush()
	}

	return { enqueue, dispose }
}

// ============================================================
// SSE Event Loop
// ============================================================

/**
 * Background event loop that processes SSE events from the single server.
 * Events from ALL projects come through one stream.
 * Reconnects on disconnect with exponential backoff.
 */
async function startEventLoop(client: OpencodeClient, signal: AbortSignal): Promise<void> {
	let retryDelay = 1000

	while (!signal.aborted) {
		const batcher = createEventBatcher()

		try {
			const stream = await subscribeToGlobalEvents(client)
			retryDelay = 1000 // Reset on successful connect

			for await (const globalEvent of stream) {
				if (signal.aborted) break
				// Global events wrap the payload with { directory, payload }
				const event = globalEvent.payload
				if (event) {
					batcher.enqueue(event)
				}
			}
		} catch (err) {
			if (signal.aborted) break
			console.error("Event stream disconnected:", err)
			useAppStore.getState().setOpenCodeConnected(false)
		} finally {
			batcher.dispose()
		}

		if (signal.aborted) break

		// Exponential backoff: 1s, 2s, 4s, 8s, max 30s
		await new Promise((resolve) => setTimeout(resolve, retryDelay))
		retryDelay = Math.min(retryDelay * 2, 30000)

		// Mark as connected again on reconnect attempt
		if (connection) {
			useAppStore.getState().setOpenCodeConnected(true)
		}
	}
}
