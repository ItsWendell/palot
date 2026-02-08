import type { Part } from "../lib/types"

// ============================================================
// Streaming Store — high-frequency part updates during streaming
// ============================================================
//
// This is a lightweight, purpose-built store for actively-streaming
// text and reasoning part content. It exists because:
//
// 1. The main Zustand app-store triggers React re-renders on every
//    `set()` call. During streaming, text-delta events arrive at
//    hundreds per second — far too many for React to handle.
//
// 2. This store accumulates part updates at full speed but only
//    notifies React subscribers at a throttled cadence (~50ms).
//
// 3. When a streaming session goes idle, the accumulated parts are
//    flushed to the main app-store and cleared from here.
//
// Inspired by the Vercel AI SDK's separate callback channels
// (messages vs. status vs. error) and OpenCode's batched flush.

/** Throttle interval for React notifications — ~20 updates/sec */
const NOTIFY_THROTTLE_MS = 50

type Listener = () => void

/** Parts keyed by messageID -> Part object, only for actively-streaming parts */
let streamingParts: Record<string, Record<string, Part>> = {}

/** Version counter — bumped on every mutation, read by getSnapshot */
let version = 0

/** Subscribers */
const listeners = new Set<Listener>()

/** Throttle state for notifications */
let notifyScheduled: ReturnType<typeof setTimeout> | undefined
let lastNotify = 0

// ============================================================
// Internal helpers
// ============================================================

function notifyListeners() {
	notifyScheduled = undefined
	lastNotify = performance.now()
	for (const listener of listeners) {
		listener()
	}
}

function scheduleNotify() {
	if (notifyScheduled !== undefined) return

	const elapsed = performance.now() - lastNotify
	if (elapsed >= NOTIFY_THROTTLE_MS) {
		// Enough time passed — notify immediately
		notifyListeners()
	} else {
		// Throttle — schedule for later
		notifyScheduled = setTimeout(notifyListeners, NOTIFY_THROTTLE_MS)
	}
}

// ============================================================
// Public API — called from the event batcher (non-React code)
// ============================================================

/**
 * Update a streaming part. Called at full SSE speed.
 * Accumulates the update and schedules a throttled React notification.
 */
export function updateStreamingPart(part: Part): void {
	const messageId = part.messageID
	if (!streamingParts[messageId]) {
		streamingParts[messageId] = {}
	}
	streamingParts[messageId][part.id] = part
	version++
	scheduleNotify()
}

/**
 * Check if a part event should be routed to the streaming store.
 * Only text and reasoning parts during active streaming benefit from
 * the throttled path — other part types (tool, file, etc.) need
 * immediate rendering.
 */
export function isStreamingPartType(part: Part): boolean {
	return part.type === "text" || part.type === "reasoning"
}

/**
 * Flush all accumulated streaming parts to the main app-store and clear.
 * Called when a session transitions from streaming to idle, or on dispose.
 *
 * Returns the accumulated parts so the caller can write them to the main store.
 */
export function flushStreamingParts(): Record<string, Record<string, Part>> {
	const flushed = streamingParts
	streamingParts = {}
	version++

	// Cancel any pending throttled notification since we're flushing
	if (notifyScheduled !== undefined) {
		clearTimeout(notifyScheduled)
		notifyScheduled = undefined
	}

	// Notify immediately so React sees the cleared state
	notifyListeners()

	return flushed
}

/**
 * Get the current streaming part for a given message + part ID.
 * Returns undefined if no streaming override exists.
 */
export function getStreamingPart(messageId: string, partId: string): Part | undefined {
	return streamingParts[messageId]?.[partId]
}

/**
 * Get all streaming parts for a given message.
 * Returns undefined if no streaming parts exist for this message.
 */
export function getStreamingPartsForMessage(messageId: string): Record<string, Part> | undefined {
	return streamingParts[messageId]
}

/**
 * Check if there are any streaming parts at all.
 */
export function hasStreamingParts(): boolean {
	return Object.keys(streamingParts).length > 0
}

// ============================================================
// React integration — useSyncExternalStore compatible
// ============================================================

/**
 * Subscribe to streaming store changes.
 * Notifications are throttled to ~50ms during active streaming.
 */
export function subscribe(listener: Listener): () => void {
	listeners.add(listener)
	return () => {
		listeners.delete(listener)
	}
}

/**
 * Get a snapshot for useSyncExternalStore.
 * Returns the version counter — React uses this to detect changes.
 */
export function getSnapshot(): number {
	return version
}

/**
 * Get all streaming parts (the full record).
 * Used by useSessionChat to merge with main store parts.
 */
export function getAllStreamingParts(): Record<string, Record<string, Part>> {
	return streamingParts
}
