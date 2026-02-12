import { atom } from "jotai"
import type { Part } from "../lib/types"
import { appStore } from "./store"

// ============================================================
// Streaming Buffer — module-scoped (NOT atoms)
// Same pattern as the old streaming-store.ts but notifies
// via a Jotai atom version counter instead of useSyncExternalStore.
// ============================================================

/** Throttle interval for React notifications — ~20 updates/sec */
const FLUSH_THROTTLE_MS = 50

/** Parts keyed by messageID -> Part object, only for actively-streaming parts */
let buffer: Record<string, Record<string, Part>> = {}

/** Throttle state */
let flushScheduled: ReturnType<typeof setTimeout> | undefined
let lastFlush = 0

/**
 * Atom that components subscribe to for streaming overlay.
 * Value is a version counter — bumped at throttled intervals.
 */
export const streamingVersionAtom = atom(0)

// ============================================================
// Internal helpers
// ============================================================

function notify(): void {
	flushScheduled = undefined
	lastFlush = performance.now()
	// Bump the atom version — this triggers React re-renders
	appStore.set(streamingVersionAtom, (v) => v + 1)
}

function scheduleNotify(): void {
	if (flushScheduled) return
	const elapsed = performance.now() - lastFlush
	if (elapsed >= FLUSH_THROTTLE_MS) {
		notify()
	} else {
		flushScheduled = setTimeout(notify, FLUSH_THROTTLE_MS - elapsed)
	}
}

// ============================================================
// Public API — called from the event batcher (non-React code)
// ============================================================

/**
 * Write a part to the streaming buffer.
 * Called by connection-manager on every text/reasoning SSE event.
 */
export function updateStreamingPart(part: Part): void {
	const messageId = part.messageID
	if (!buffer[messageId]) buffer[messageId] = {}
	buffer[messageId][part.id] = part
	scheduleNotify()
}

/**
 * Check if a part type should go through streaming buffer.
 */
export function isStreamingPartType(part: Part): boolean {
	return part.type === "text" || part.type === "reasoning"
}

/**
 * Get streaming parts for a specific message (used in derived atoms).
 */
export function getStreamingPartsForMessage(messageId: string): Record<string, Part> | undefined {
	return buffer[messageId]
}

/**
 * Get all streaming parts.
 */
export function getAllStreamingParts(): Record<string, Record<string, Part>> {
	return buffer
}

/**
 * Check if there are any buffered streaming parts.
 */
export function hasStreamingParts(): boolean {
	return Object.keys(buffer).length > 0
}

/**
 * Get the current streaming part for a given message + part ID.
 */
export function getStreamingPart(messageId: string, partId: string): Part | undefined {
	return buffer[messageId]?.[partId]
}

/**
 * Flush all streaming parts into the main Jotai atoms.
 * Called when a session goes idle.
 * Returns the flushed parts as a flat array for batch upsert.
 */
export function flushStreamingParts(): Part[] {
	if (flushScheduled) {
		clearTimeout(flushScheduled)
		flushScheduled = undefined
	}

	const allParts: Part[] = []
	for (const messageId in buffer) {
		for (const partId in buffer[messageId]) {
			allParts.push(buffer[messageId][partId])
		}
	}

	buffer = {}

	// Notify React that streaming is cleared
	appStore.set(streamingVersionAtom, (v) => v + 1)

	return allParts
}
