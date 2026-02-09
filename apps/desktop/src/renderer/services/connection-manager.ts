import type { OpencodeClient } from "@opencode-ai/sdk/v2/client"
import { createLogger } from "../lib/logger"
import type { Event, Part } from "../lib/types"
import { useAppStore } from "../stores/app-store"
import {
	flushStreamingParts,
	isStreamingPartType,
	updateStreamingPart,
} from "../stores/streaming-store"
import {
	connectToServer,
	getSessionStatuses,
	listSessions,
	subscribeToGlobalEvents,
} from "./opencode"

const log = createLogger("connection-manager")

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

/**
 * Monotonically increasing ID for event loop instances.
 * Each call to `startEventLoop` gets a unique ID. Before processing events
 * or reconnecting, the loop checks if it's still the "current" loop — if not
 * (because `connectToOpenCode` was called again), it exits immediately.
 * This prevents duplicate event streams when connections are rapidly recycled
 * (e.g., HMR, Vite reconnect, or React StrictMode double-effects).
 */
let eventLoopGeneration = 0

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
		log.info("Disconnecting previous connection", { url: connection.url })
		connection.abortController.abort()
		projectClients.clear()
	}

	// Bump generation — any previous event loop will see it's stale and exit
	eventLoopGeneration++
	const gen = eventLoopGeneration

	const store = useAppStore.getState()
	store.setOpenCodeUrl(url)

	// Base client has no directory — used for SSE events (which cover all projects)
	const baseClient = connectToServer(url)
	const abortController = new AbortController()

	connection = { url, baseClient, abortController }

	log.info("Connecting to OpenCode server", { url, generation: gen })

	// Start SSE event loop in the background
	startEventLoop(baseClient, abortController.signal, gen)

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
		log.debug("Loaded sessions for project", { directory, count: sessions.length })
		store.setSessions(sessions, statuses, directory)
	} catch (err) {
		log.error("Failed to load sessions", { directory }, err)
	}
}

/**
 * Get or create a project-scoped SDK client.
 * All project clients point at the same URL but send different
 * `x-opencode-directory` headers.
 *
 * If the module-level connection was lost (e.g. Vite HMR wiped it) but
 * the Zustand store still knows the server URL, we transparently
 * reconnect so callers don't hit "Not connected" errors.
 */
export function getProjectClient(directory: string): OpencodeClient | null {
	if (!connection) {
		// HMR recovery: module state is gone but the store remembers the URL
		const storeUrl = useAppStore.getState().opencode?.url
		if (storeUrl) {
			log.warn("Connection lost (likely HMR), reconnecting to", { url: storeUrl })
			// Re-establish connection synchronously for the base client + SSE,
			// then return a project client immediately below
			const baseClient = connectToServer(storeUrl)
			const abortController = new AbortController()
			eventLoopGeneration++
			connection = { url: storeUrl, baseClient, abortController }
			startEventLoop(baseClient, abortController.signal, eventLoopGeneration)
			useAppStore.getState().setOpenCodeConnected(true)
		} else {
			return null
		}
	}

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
	log.info("Disconnecting from OpenCode server")
	if (connection) {
		connection.abortController.abort()
		connection = null
		projectClients.clear()
	}
	// Bump generation so any in-flight event loop exits
	eventLoopGeneration++
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
 * - The batch is flushed using `requestAnimationFrame` so dispatches align
 *   with the browser's paint cycle — no wasted updates between frames.
 * - The *first* event after a quiet period flushes immediately (no added latency).
 */
function createEventBatcher() {
	/** Ordered queue of events (non-coalescable) */
	let queue: Event[] = []
	/** Coalescable events — only the latest per key is kept */
	const coalesced = new Map<string, Event>()
	let scheduled: number | undefined
	let lastFlush = 0

	function flush() {
		// Merge coalesced events into the queue
		const events = [...queue, ...coalesced.values()]
		queue = []
		coalesced.clear()
		scheduled = undefined
		lastFlush = performance.now()

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
		// Fast path: route high-frequency text/reasoning part updates to
		// the streaming store. This bypasses the main Zustand store entirely
		// — the streaming store has its own throttled notification cycle (~50ms)
		// so React re-renders far less often during active streaming.
		if (event.type === "message.part.updated") {
			const part = event.properties.part
			if (isStreamingPartType(part)) {
				updateStreamingPart(part)
				// Also enqueue in the normal path so the main store stays
				// eventually consistent — but coalescing means only the
				// latest version per part makes it through each flush.
				const key = coalescingKey(event)
				if (key) coalesced.set(key, event)
				if (scheduled !== undefined) return
				const elapsed = performance.now() - lastFlush
				if (elapsed < FRAME_BUDGET_MS) {
					scheduled = requestAnimationFrame(flush)
				} else {
					flush()
				}
				return
			}
		}

		// When a session goes idle, flush accumulated streaming parts to
		// the main store so the final state is persisted.
		if (event.type === "session.status" && event.properties.status.type === "idle") {
			const accumulated = flushStreamingParts()
			// Apply accumulated parts to main store in a single batch update
			const allParts: Part[] = []
			for (const messageParts of Object.values(accumulated)) {
				for (const part of Object.values(messageParts)) {
					allParts.push(part)
				}
			}
			if (allParts.length > 0) {
				useAppStore.getState().batchUpsertParts(allParts)
			}
		}

		const key = coalescingKey(event)
		if (key) {
			// Coalescable — overwrite any previous event with the same key
			coalesced.set(key, event)
		} else {
			queue.push(event)
		}

		// If a frame is already scheduled, the event will be included in that flush
		if (scheduled !== undefined) return

		const elapsed = performance.now() - lastFlush
		if (elapsed < FRAME_BUDGET_MS) {
			// Within the current frame budget — defer to next paint via rAF.
			// rAF fires right before the browser paints, ensuring the store
			// update and subsequent React render happen just-in-time.
			scheduled = requestAnimationFrame(flush)
		} else {
			// Enough time has passed — flush immediately (keeps first-event latency low)
			flush()
		}
	}

	function dispose() {
		if (scheduled !== undefined) {
			cancelAnimationFrame(scheduled)
			scheduled = undefined
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
 *
 * The `generation` parameter prevents duplicate streams: if `connectToOpenCode`
 * is called again (bumping eventLoopGeneration), any older event loop will
 * detect the mismatch and exit, even if its AbortSignal hasn't propagated yet.
 */
async function startEventLoop(
	client: OpencodeClient,
	signal: AbortSignal,
	generation: number,
): Promise<void> {
	let retryDelay = 1000

	const isStale = () => signal.aborted || generation !== eventLoopGeneration

	log.info("SSE event loop started", { generation })

	while (!isStale()) {
		const batcher = createEventBatcher()

		try {
			log.debug("Opening SSE stream", { generation })
			const stream = await subscribeToGlobalEvents(client)
			retryDelay = 1000 // Reset on successful connect
			log.info("SSE stream connected", { generation })

			for await (const globalEvent of stream) {
				if (isStale()) break
				// Global events wrap the payload with { directory, payload }
				const event = globalEvent.payload
				if (event) {
					batcher.enqueue(event)
				}
			}
			// Stream ended cleanly (server closed it)
			if (!isStale()) {
				log.warn("SSE stream ended (server closed connection)", { generation })
			}
		} catch (err) {
			if (isStale()) break
			log.error("SSE stream disconnected", { generation, retryDelay }, err)
			useAppStore.getState().setOpenCodeConnected(false)
		} finally {
			batcher.dispose()
		}

		if (isStale()) break

		// Exponential backoff: 1s, 2s, 4s, 8s, max 30s
		log.info("Reconnecting SSE in", { delayMs: retryDelay, generation })
		await new Promise((resolve) => setTimeout(resolve, retryDelay))
		retryDelay = Math.min(retryDelay * 2, 30000)

		// Check again after sleeping — a new connection may have started
		if (isStale()) break

		// Mark as connected again on reconnect attempt
		if (connection) {
			useAppStore.getState().setOpenCodeConnected(true)
		}
	}

	log.info("SSE event loop exited", { generation, stale: generation !== eventLoopGeneration })
}
