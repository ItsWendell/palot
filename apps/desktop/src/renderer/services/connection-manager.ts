import type { OpencodeClient } from "@opencode-ai/sdk/v2/client"
import { processEvent } from "../atoms/actions/event-processor"
import { serverConnectedAtom, serverUrlAtom } from "../atoms/connection"
import { batchUpsertPartsAtom } from "../atoms/parts"
import { setSessionsAtom } from "../atoms/sessions"
import { appStore } from "../atoms/store"
import { flushStreamingParts, isStreamingPartType, updateStreamingPart } from "../atoms/streaming"
import { createLogger } from "../lib/logger"
import type { Event } from "../lib/types"
import {
	connectToServer,
	disposeAllInstances,
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
 */
let eventLoopGeneration = 0

/**
 * Global reference to the SSE AbortController that survives Vite HMR
 * module replacement. When HMR replaces this module, the old module's
 * `connection` variable is lost, but the old event loop keeps running
 * with an unreachable AbortController. By storing it on `window`, the
 * new module can abort the stale loop on reconnect.
 */
const SSE_ABORT_KEY = "__palot_sse_abort__" as const

function getGlobalAbort(): AbortController | undefined {
	// biome-ignore lint/suspicious/noExplicitAny: accessing dynamic window property for SSE abort controller
	return (window as any)[SSE_ABORT_KEY]
}

function setGlobalAbort(controller: AbortController | null) {
	// biome-ignore lint/suspicious/noExplicitAny: accessing dynamic window property for SSE abort controller
	;(window as any)[SSE_ABORT_KEY] = controller
}

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

	// Also abort any stale SSE loop from a previous HMR module that we can't
	// reach through the module-level `connection` variable.
	const staleAbort = getGlobalAbort()
	if (staleAbort && !staleAbort.signal.aborted) {
		log.info("Aborting stale SSE connection from previous module")
		staleAbort.abort()
	}

	// Bump generation — any previous event loop will see it's stale and exit
	eventLoopGeneration++
	const gen = eventLoopGeneration

	appStore.set(serverUrlAtom, url)

	// Base client has no directory — used for SSE events (which cover all projects)
	const baseClient = connectToServer(url)
	const abortController = new AbortController()

	connection = { url, baseClient, abortController }
	setGlobalAbort(abortController)

	log.info("Connecting to OpenCode server", { url, generation: gen })

	// Start SSE event loop in the background
	startEventLoop(baseClient, abortController.signal, gen)

	appStore.set(serverConnectedAtom, true)
}

/**
 * Load sessions for a specific project directory from the server.
 * Merges them into the Jotai store.
 */
export async function loadProjectSessions(directory: string): Promise<void> {
	const client = getProjectClient(directory)
	if (!client) return

	try {
		const [sessions, statuses] = await Promise.all([
			listSessions(client),
			getSessionStatuses(client),
		])
		log.debug("Loaded sessions for project", { directory, count: sessions.length })
		appStore.set(setSessionsAtom, { sessions, statuses, directory })
	} catch (err) {
		log.error("Failed to load sessions", { directory }, err)
	}
}

/**
 * Get or create a project-scoped SDK client.
 *
 * If the module-level connection was lost (e.g. Vite HMR wiped it) but
 * the Jotai store still knows the server URL, we transparently reconnect.
 */
export function getProjectClient(directory: string): OpencodeClient | null {
	if (!connection) {
		// HMR recovery: module state is gone but the store remembers the URL
		const storeUrl = appStore.get(serverUrlAtom)
		if (storeUrl) {
			log.warn("Connection lost (likely HMR), reconnecting to", { url: storeUrl })

			// Abort any stale SSE loop from the previous module
			const staleAbort = getGlobalAbort()
			if (staleAbort && !staleAbort.signal.aborted) {
				log.info("Aborting stale SSE connection from previous module")
				staleAbort.abort()
			}

			const baseClient = connectToServer(storeUrl)
			const abortController = new AbortController()
			eventLoopGeneration++
			connection = { url: storeUrl, baseClient, abortController }
			setGlobalAbort(abortController)
			startEventLoop(baseClient, abortController.signal, eventLoopGeneration)
			appStore.set(serverConnectedAtom, true)
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
 * Reload all OpenCode configuration by disposing all server instances.
 * This forces the server to re-read config files, agents, skills, commands, etc.
 * The resulting SSE events automatically invalidate UI queries.
 */
export async function reloadConfig(): Promise<void> {
	if (!connection) {
		log.warn("Cannot reload config: not connected to server")
		return
	}
	log.info("Reloading OpenCode config (disposing all instances)")
	await disposeAllInstances(connection.baseClient)
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
	setGlobalAbort(null)
	eventLoopGeneration++
	appStore.set(serverConnectedAtom, false)
}

// ============================================================
// Event Batching (OpenCode-inspired 16ms flush with coalescing)
// ============================================================

const FRAME_BUDGET_MS = 16

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

function createEventBatcher() {
	let queue: Event[] = []
	const coalesced = new Map<string, Event>()
	let scheduled: number | undefined
	let lastFlush = 0

	function flush() {
		const events = [...queue, ...coalesced.values()]
		queue = []
		coalesced.clear()
		scheduled = undefined
		lastFlush = performance.now()

		if (events.length === 0) return

		for (const event of events) {
			processEvent(event)
		}
	}

	function enqueue(event: Event) {
		// Fast path: route high-frequency text/reasoning part updates to streaming buffer
		if (event.type === "message.part.updated") {
			const part = event.properties.part
			if (isStreamingPartType(part)) {
				updateStreamingPart(part)
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

		// When a session goes idle, flush streaming parts to main store
		if (event.type === "session.status" && event.properties.status.type === "idle") {
			const flushedParts = flushStreamingParts()
			if (flushedParts.length > 0) {
				appStore.set(batchUpsertPartsAtom, flushedParts)
			}
		}

		const key = coalescingKey(event)
		if (key) {
			coalesced.set(key, event)
		} else {
			queue.push(event)
		}

		if (scheduled !== undefined) return

		const elapsed = performance.now() - lastFlush
		if (elapsed < FRAME_BUDGET_MS) {
			scheduled = requestAnimationFrame(flush)
		} else {
			flush()
		}
	}

	function dispose() {
		if (scheduled !== undefined) {
			cancelAnimationFrame(scheduled)
			scheduled = undefined
		}
		flush()
	}

	return { enqueue, dispose }
}

// ============================================================
// SSE Event Loop
// ============================================================

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
			retryDelay = 1000
			log.info("SSE stream connected", { generation })

			for await (const globalEvent of stream) {
				if (isStale()) break
				const event = globalEvent.payload
				if (event) {
					batcher.enqueue(event)
				}
			}
			if (!isStale()) {
				log.warn("SSE stream ended (server closed connection)", { generation })
			}
		} catch (err) {
			if (isStale()) break
			log.error("SSE stream disconnected", { generation, retryDelay }, err)
			appStore.set(serverConnectedAtom, false)
		} finally {
			batcher.dispose()
		}

		if (isStale()) break

		log.info("Reconnecting SSE in", { delayMs: retryDelay, generation })
		await new Promise((resolve) => setTimeout(resolve, retryDelay))
		retryDelay = Math.min(retryDelay * 2, 30000)

		if (isStale()) break

		if (connection) {
			appStore.set(serverConnectedAtom, true)
		}
	}

	log.info("SSE event loop exited", { generation, stale: generation !== eventLoopGeneration })
}
