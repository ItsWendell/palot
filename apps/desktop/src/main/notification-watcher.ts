import { net } from "electron"
import { createLogger } from "./logger"
import { setServerUrl, showNotification, updateBadgeCount } from "./notifications"

const log = createLogger("notification-watcher")

// ============================================================
// Types — minimal, only what we need for notification decisions
// ============================================================

export interface SessionState {
	status: string // "busy" | "idle" | "retry"
	title: string
	directory?: string
	/** If set, this session is a sub-agent spawned by another session. */
	parentID?: string
}

// ============================================================
// State
// ============================================================

let abortController: AbortController | null = null

/** Minimal session state for transition detection. */
const sessions = new Map<string, SessionState>()

/** Pending permission/question count for badge. */
let pendingCount = 0

/** Listeners notified whenever session or pending state changes. */
const changeListeners = new Set<() => void>()

// ============================================================
// Public API
// ============================================================

/**
 * Start watching the OpenCode server's global SSE event stream
 * for notification-worthy events.
 *
 * This runs in the main process (Node.js) and is never throttled
 * by Chromium's background tab restrictions or macOS App Nap.
 */
export function startNotificationWatcher(url: string): void {
	if (abortController) {
		log.debug("Stopping existing watcher before restart")
		abortController.abort()
	}

	abortController = new AbortController()
	pendingCount = 0

	// Make the server URL available for notification action replies
	setServerUrl(url)

	log.info("Starting notification watcher", { url })
	connectWithRetry(url, abortController.signal)
}

/**
 * Stop the notification watcher.
 */
export function stopNotificationWatcher(): void {
	if (abortController) {
		abortController.abort()
		abortController = null
	}
	sessions.clear()
	pendingCount = 0
	updateBadgeCount(0)
	setServerUrl(null)
	log.info("Notification watcher stopped")
}

/**
 * Check if the watcher is currently running.
 */
export function isWatcherRunning(): boolean {
	return abortController !== null && !abortController.signal.aborted
}

/**
 * Get a snapshot of all tracked sessions.
 * Returns a new Map (caller-safe to iterate without races).
 */
export function getSessionStates(): ReadonlyMap<string, SessionState> {
	return new Map(sessions)
}

/**
 * Get the current pending permission/question count.
 */
export function getPendingCount(): number {
	return pendingCount
}

/**
 * Subscribe to any state change (session status, pending count).
 * Called after every processGlobalEvent that mutates state.
 * Returns an unsubscribe function.
 */
export function onStateChanged(listener: () => void): () => void {
	changeListeners.add(listener)
	return () => changeListeners.delete(listener)
}

// ============================================================
// SSE Connection + Retry Loop
// ============================================================

async function connectWithRetry(url: string, signal: AbortSignal): Promise<void> {
	let retryDelay = 1_000

	while (!signal.aborted) {
		try {
			await consumeSSE(url, signal)
			// Stream ended normally (server closed connection)
			if (!signal.aborted) {
				log.warn("SSE stream ended, reconnecting...")
			}
		} catch (err) {
			if (signal.aborted) break
			log.error("SSE stream error, reconnecting", { retryDelay }, err)
		}

		if (signal.aborted) break

		// Exponential backoff: 1s -> 2s -> 4s -> ... -> 30s max
		await sleep(retryDelay, signal)
		retryDelay = Math.min(retryDelay * 2, 30_000)
	}
}

async function consumeSSE(url: string, signal: AbortSignal): Promise<void> {
	const sseUrl = `${url}/global/event`

	const response = await net.fetch(sseUrl, {
		headers: { Accept: "text/event-stream" },
		signal,
	})

	if (!response.ok) {
		throw new Error(`SSE connection failed: ${response.status} ${response.statusText}`)
	}

	if (!response.body) {
		throw new Error("SSE response has no body")
	}

	log.info("SSE stream connected")

	const reader = response.body.getReader()
	const decoder = new TextDecoder()
	let buffer = ""

	try {
		while (!signal.aborted) {
			const { done, value } = await reader.read()
			if (done) break

			buffer += decoder.decode(value, { stream: true })

			// Process complete SSE lines
			let newlineIndex: number = buffer.indexOf("\n")
			while (newlineIndex !== -1) {
				const line = buffer.slice(0, newlineIndex).trim()
				buffer = buffer.slice(newlineIndex + 1)

				if (line.startsWith("data: ")) {
					const jsonStr = line.slice(6)
					try {
						const globalEvent = JSON.parse(jsonStr)
						processGlobalEvent(globalEvent)
					} catch {
						// Malformed JSON — skip
					}
				}

				newlineIndex = buffer.indexOf("\n")
			}
		}
	} finally {
		reader.releaseLock()
	}
}

// ============================================================
// Event Processing — only notification-relevant events
// ============================================================

interface GlobalSSEEvent {
	directory?: string
	payload?: {
		type: string
		properties: Record<string, unknown>
	}
}

function processGlobalEvent(globalEvent: GlobalSSEEvent): void {
	const event = globalEvent.payload
	if (!event) return

	const eventType = event.type
	const props = event.properties

	const directory = globalEvent.directory

	switch (eventType) {
		case "permission.updated": {
			const sessionId = props.sessionID as string
			const title = props.title as string
			pendingCount++
			updateBadgeCount(pendingCount)
			scheduleNotify()
			if (!isSubAgent(sessionId)) {
				showNotification({
					type: "permission",
					sessionId,
					title: "Agent needs permission",
					body: title || "Approval required",
					directory,
					meta: { permissionId: props.id as string },
				})
			}
			break
		}

		case "permission.replied": {
			pendingCount = Math.max(0, pendingCount - 1)
			updateBadgeCount(pendingCount)
			scheduleNotify()
			break
		}

		case "question.asked": {
			const sessionId = props.sessionID as string
			const questions = props.questions as Array<{ header?: string }> | undefined
			const header = questions?.[0]?.header ?? "Question"
			pendingCount++
			updateBadgeCount(pendingCount)
			scheduleNotify()
			if (!isSubAgent(sessionId)) {
				showNotification({
					type: "question",
					sessionId,
					title: "Agent has a question",
					body: header,
					directory,
					meta: { requestId: props.id as string },
				})
			}
			break
		}

		case "question.replied":
		case "question.rejected": {
			pendingCount = Math.max(0, pendingCount - 1)
			updateBadgeCount(pendingCount)
			scheduleNotify()
			break
		}

		case "session.status": {
			const sessionId = props.sessionID as string
			const newStatusType = (props.status as { type: string })?.type
			if (!sessionId || !newStatusType) break

			const prev = sessions.get(sessionId)
			const prevStatus = prev?.status

			// Update tracked state
			sessions.set(sessionId, {
				status: newStatusType,
				title: prev?.title ?? "",
				directory: directory ?? prev?.directory,
				parentID: prev?.parentID,
			})
			scheduleNotify()

			// Detect busy/retry -> idle transition (agent completed)
			if (
				newStatusType === "idle" &&
				(prevStatus === "busy" || prevStatus === "retry") &&
				!isSubAgent(sessionId)
			) {
				const sessionTitle = sessions.get(sessionId)?.title
				showNotification({
					type: "completed",
					sessionId,
					title: "Agent finished",
					body: sessionTitle || "Task completed",
					directory,
				})
			}
			break
		}

		case "session.error": {
			const sessionId = props.sessionID as string
			const error = props.error as { name?: string } | undefined
			if (!sessionId) break
			if (!isSubAgent(sessionId)) {
				showNotification({
					type: "error",
					sessionId,
					title: "Agent encountered an error",
					body: error?.name ?? "Unknown error",
					directory,
				})
			}
			break
		}

		case "session.created":
		case "session.updated": {
			// Track session title, directory, and parentID for use in notification decisions
			const info = props.info as { id?: string; title?: string; parentID?: string } | undefined
			if (info?.id) {
				const existing = sessions.get(info.id)
				sessions.set(info.id, {
					status: existing?.status ?? "idle",
					title: info.title ?? existing?.title ?? "",
					directory: directory ?? existing?.directory,
					parentID: info.parentID ?? existing?.parentID,
				})
				scheduleNotify()
			}
			break
		}

		// All other events (message.*, todo.*, etc.) are ignored —
		// they're the renderer's domain.
	}
}

// ============================================================
// Helpers
// ============================================================

/** Notify all change listeners (debounced per event loop tick). */
let notifyScheduled = false
function scheduleNotify(): void {
	if (notifyScheduled) return
	notifyScheduled = true
	queueMicrotask(() => {
		notifyScheduled = false
		for (const listener of changeListeners) {
			try {
				listener()
			} catch {
				// Listener errors must not break the watcher
			}
		}
	})
}

/** Check if a session is a sub-agent (has a parent session). */
function isSubAgent(sessionId: string): boolean {
	return !!sessions.get(sessionId)?.parentID
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
	return new Promise((resolve) => {
		if (signal.aborted) {
			resolve()
			return
		}
		const timer = setTimeout(resolve, ms)
		signal.addEventListener(
			"abort",
			() => {
				clearTimeout(timer)
				resolve()
			},
			{ once: true },
		)
	})
}
