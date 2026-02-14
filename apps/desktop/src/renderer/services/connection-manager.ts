import type { OpencodeClient } from "@opencode-ai/sdk/v2/client"
import { processEvent } from "../atoms/actions/event-processor"
import { authHeaderAtom, serverConnectedAtom, serverUrlAtom } from "../atoms/connection"
import { batchUpsertPartsAtom } from "../atoms/parts"
import { setSessionsAtom } from "../atoms/sessions"
import { appStore } from "../atoms/store"
import {
	applyStreamingDelta,
	flushStreamingParts,
	isStreamingField,
	isStreamingPartType,
	updateStreamingPart,
} from "../atoms/streaming"
import { createLogger } from "../lib/logger"
import type { Event } from "../lib/types"
import {
	connectToServer,
	disposeAllInstances,
	getSessionStatuses,
	listProjects,
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
	/** Auth header for remote servers (null for local/unauthenticated). */
	authHeader: string | null
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
 * Connect to an OpenCode server.
 * Starts SSE subscription for all-project events.
 *
 * @param url       Base URL of the OpenCode server
 * @param authHeader  Optional HTTP Authorization header for remote servers
 */
export async function connectToOpenCode(url: string, authHeader?: string | null): Promise<void> {
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

	const resolvedAuth = authHeader ?? null
	appStore.set(serverUrlAtom, url)
	appStore.set(authHeaderAtom, resolvedAuth)

	// Base client has no directory — used for SSE events (which cover all projects)
	const baseClient = connectToServer(url, { authHeader: resolvedAuth ?? undefined })
	const abortController = new AbortController()

	connection = { url, authHeader: resolvedAuth, baseClient, abortController }
	setGlobalAbort(abortController)

	log.info("Connecting to OpenCode server", { url, authenticated: !!resolvedAuth, generation: gen })

	// Start SSE event loop in the background
	startEventLoop(baseClient, abortController.signal, gen)

	appStore.set(serverConnectedAtom, true)
}

/**
 * List all projects known to the OpenCode server via the API.
 * Uses the base client (no directory scope) since project.list() is global.
 */
export async function loadAllProjects() {
	const client = getBaseClient()
	if (!client) {
		log.warn("Cannot load projects: not connected to server")
		return []
	}
	try {
		const projects = await listProjects(client)
		log.info("Loaded projects from API", { count: projects.length })
		return projects
	} catch (err) {
		log.error("Failed to load projects from API", err)
		return []
	}
}

/**
 * Load sessions for a specific project directory from the server.
 * Merges them into the Jotai store.
 *
 * @param directory    The project's main worktree directory
 * @param sandboxDirs  Known sandbox (worktree) directories for this project,
 *                     used to restore worktree metadata on sessions after reload
 */
export async function loadProjectSessions(
	directory: string,
	sandboxDirs?: Set<string>,
): Promise<void> {
	const client = getProjectClient(directory)
	if (!client) return

	try {
		const [sessions, statuses] = await Promise.all([
			listSessions(client),
			getSessionStatuses(client),
		])
		log.debug("Loaded sessions for project", { directory, count: sessions.length })
		appStore.set(setSessionsAtom, { sessions, statuses, directory, sandboxDirs })
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

			const storeAuth = appStore.get(authHeaderAtom)
			const baseClient = connectToServer(storeUrl, { authHeader: storeAuth ?? undefined })
			const abortController = new AbortController()
			eventLoopGeneration++
			connection = { url: storeUrl, authHeader: storeAuth, baseClient, abortController }
			setGlobalAbort(abortController)
			startEventLoop(baseClient, abortController.signal, eventLoopGeneration)
			appStore.set(serverConnectedAtom, true)
		} else {
			return null
		}
	}

	let client = projectClients.get(directory)
	if (!client) {
		client = connectToServer(connection.url, {
			directory,
			authHeader: connection.authHeader ?? undefined,
		})
		projectClients.set(directory, client)
	}
	return client
}

/**
 * Get the base SDK client (no directory scope).
 * Used for global operations like auth set/remove, provider list, global config.
 * Returns null if not connected.
 */
export function getBaseClient(): OpencodeClient | null {
	if (!connection) {
		// HMR recovery
		const storeUrl = appStore.get(serverUrlAtom)
		if (storeUrl) {
			const storeAuth = appStore.get(authHeaderAtom)
			const baseClient = connectToServer(storeUrl, { authHeader: storeAuth ?? undefined })
			const abortController = new AbortController()
			eventLoopGeneration++
			connection = { url: storeUrl, authHeader: storeAuth, baseClient, abortController }
			setGlobalAbort(abortController)
			startEventLoop(baseClient, abortController.signal, eventLoopGeneration)
			appStore.set(serverConnectedAtom, true)
		} else {
			return null
		}
	}
	return connection.baseClient
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
		case "message.part.delta":
			return `part:${event.properties.messageID}:${event.properties.partID}`
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

		// Fast path: route incremental text/reasoning deltas to streaming buffer
		if (event.type === "message.part.delta") {
			const { messageID, partID, field, delta, sessionID } = event.properties
			if (isStreamingField(field)) {
				const applied = applyStreamingDelta(messageID, partID, field, delta, sessionID)
				if (applied) {
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
				// Part not in streaming buffer yet, fall through to normal processing
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
