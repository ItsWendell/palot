import { net } from "electron"
import { createLogger } from "./logger"
import { showNotification, updateBadgeCount } from "./notifications"

const log = createLogger("notification-watcher")

// ============================================================
// Types — minimal, only what we need for notification decisions
// ============================================================

interface SessionState {
	status: string // "busy" | "idle" | "retry"
	title: string
}

// ============================================================
// State
// ============================================================

let abortController: AbortController | null = null

/** Minimal session state for transition detection. */
const sessions = new Map<string, SessionState>()

/** Pending permission/question count for badge. */
let pendingCount = 0

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
	log.info("Notification watcher stopped")
}

/**
 * Check if the watcher is currently running.
 */
export function isWatcherRunning(): boolean {
	return abortController !== null && !abortController.signal.aborted
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

	switch (eventType) {
		case "permission.updated": {
			const sessionId = props.sessionID as string
			const title = props.title as string
			pendingCount++
			updateBadgeCount(pendingCount)
			showNotification({
				type: "permission",
				sessionId,
				title: "Agent needs permission",
				body: title || "Approval required",
				meta: { permissionId: props.id as string },
			})
			break
		}

		case "permission.replied": {
			pendingCount = Math.max(0, pendingCount - 1)
			updateBadgeCount(pendingCount)
			break
		}

		case "question.asked": {
			const sessionId = props.sessionID as string
			const questions = props.questions as Array<{ header?: string }> | undefined
			const header = questions?.[0]?.header ?? "Question"
			pendingCount++
			updateBadgeCount(pendingCount)
			showNotification({
				type: "question",
				sessionId,
				title: "Agent has a question",
				body: header,
				meta: { requestId: props.id as string },
			})
			break
		}

		case "question.replied":
		case "question.rejected": {
			pendingCount = Math.max(0, pendingCount - 1)
			updateBadgeCount(pendingCount)
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
			})

			// Detect busy/retry -> idle transition (agent completed)
			if (newStatusType === "idle" && (prevStatus === "busy" || prevStatus === "retry")) {
				const sessionTitle = sessions.get(sessionId)?.title
				showNotification({
					type: "completed",
					sessionId,
					title: "Agent finished",
					body: sessionTitle || "Task completed",
				})
			}
			break
		}

		case "session.error": {
			const sessionId = props.sessionID as string
			const error = props.error as { name?: string } | undefined
			if (!sessionId) break
			showNotification({
				type: "error",
				sessionId,
				title: "Agent encountered an error",
				body: error?.name ?? "Unknown error",
			})
			break
		}

		case "session.created":
		case "session.updated": {
			// Track session title for use in completion notifications
			const info = props.info as { id?: string; title?: string } | undefined
			if (info?.id) {
				const existing = sessions.get(info.id)
				sessions.set(info.id, {
					status: existing?.status ?? "idle",
					title: info.title ?? existing?.title ?? "",
				})
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
