import { atom } from "jotai"
import { atomFamily } from "jotai-family"
import type { Message, Part } from "../lib/types"
import { partsFamily } from "./parts"

// ============================================================
// Helpers
// ============================================================

const MAX_MESSAGES_PER_SESSION = 200

/**
 * Binary search for sorted arrays. Returns { found, index }.
 * If found, index is the position of the match.
 * If not found, index is where the item should be inserted.
 */
function binarySearch<T>(
	arr: T[],
	target: string,
	key: (item: T) => string,
): { found: boolean; index: number } {
	let lo = 0
	let hi = arr.length
	while (lo < hi) {
		const mid = (lo + hi) >>> 1
		const cmp = key(arr[mid]).localeCompare(target)
		if (cmp < 0) lo = mid + 1
		else if (cmp > 0) hi = mid
		else return { found: true, index: mid }
	}
	return { found: false, index: lo }
}

// ============================================================
// Per-session message list (sorted by id)
// ============================================================

export const messagesFamily = atomFamily((_sessionId: string) => atom<Message[]>([]))

// ============================================================
// Action atoms
// ============================================================

/**
 * Set messages for a session (initial fetch + merge with existing SSE data).
 */
export const setMessagesAtom = atom(
	null,
	(
		get,
		set,
		args: {
			sessionId: string
			messages: Message[]
			parts: Record<string, Part[]>
		},
	) => {
		const existing = get(messagesFamily(args.sessionId))

		// Fast path: no existing messages — just set everything
		if (!existing || existing.length === 0) {
			set(messagesFamily(args.sessionId), args.messages)
			for (const [messageId, msgParts] of Object.entries(args.parts)) {
				set(partsFamily(messageId), msgParts)
			}
			return
		}

		// Merge: build a combined sorted array. For messages that exist
		// in both the fetched data and the SSE-accumulated store, prefer
		// the SSE version (it's likely newer).
		const existingIds = new Set(existing.map((m) => m.id))
		const merged = existing.slice()
		for (const msg of args.messages) {
			if (!existingIds.has(msg.id)) {
				const result = binarySearch(merged, msg.id, (m) => m.id)
				merged.splice(result.index, 0, msg)
			}
		}

		// Merge parts: fetched parts fill in gaps, SSE parts take priority
		for (const [messageId, fetchedParts] of Object.entries(args.parts)) {
			const existingParts = get(partsFamily(messageId))
			if (!existingParts || existingParts.length === 0) {
				// No SSE parts yet for this message — use fetched
				set(partsFamily(messageId), fetchedParts)
			}
			// Otherwise keep the SSE-accumulated parts (more recent)
		}

		set(messagesFamily(args.sessionId), merged)
	},
)

/**
 * Upsert a single message.
 */
export const upsertMessageAtom = atom(null, (get, set, message: Message) => {
	const sessionId = message.sessionID
	let existing = get(messagesFamily(sessionId))

	// When a real user message arrives, remove the oldest optimistic placeholder.
	if (message.role === "user" && !message.id.startsWith("optimistic-")) {
		const optimisticIndex = existing.findIndex(
			(m) => m.id.startsWith("optimistic-") && m.role === "user",
		)
		if (optimisticIndex !== -1) {
			const optimisticId = existing[optimisticIndex].id
			// Clean up parts for the optimistic message
			set(partsFamily(optimisticId), [])
			existing = existing.filter((_, i) => i !== optimisticIndex)
		}
	}

	const result = binarySearch(existing, message.id, (m) => m.id)

	if (result.found) {
		// Skip if reference-equal (no change)
		if (existing[result.index] === message) return

		const updated = existing.slice()
		updated[result.index] = message
		// Cap at MAX_MESSAGES_PER_SESSION
		if (updated.length > MAX_MESSAGES_PER_SESSION) {
			const removed = updated.shift()!
			set(partsFamily(removed.id), [])
		}
		set(messagesFamily(sessionId), updated)
		return
	}

	const updated = existing.slice()
	updated.splice(result.index, 0, message)
	// Cap at MAX_MESSAGES_PER_SESSION
	if (updated.length > MAX_MESSAGES_PER_SESSION) {
		const removed = updated.shift()!
		set(partsFamily(removed.id), [])
	}
	set(messagesFamily(sessionId), updated)
})

/**
 * Remove a message from a session.
 */
export const removeMessageAtom = atom(
	null,
	(
		get,
		set,
		args: {
			sessionId: string
			messageId: string
		},
	) => {
		const existing = get(messagesFamily(args.sessionId))
		if (!existing) return
		const result = binarySearch(existing, args.messageId, (m) => m.id)
		if (!result.found) return
		const updated = [...existing]
		updated.splice(result.index, 1)
		set(partsFamily(args.messageId), [])
		set(messagesFamily(args.sessionId), updated)
	},
)
