import { atom } from "jotai"
import { atomFamily } from "jotai-family"
import type { Part } from "../lib/types"

// ============================================================
// Helpers
// ============================================================

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
// Per-message part list (sorted by id)
// ============================================================

export const partsFamily = atomFamily((_messageId: string) => atom<Part[]>([]))

// ============================================================
// Action atoms
// ============================================================

/** Upsert a single part */
export const upsertPartAtom = atom(null, (get, set, part: Part) => {
	const messageId = part.messageID
	const existing = get(partsFamily(messageId))

	// Fast path: no parts yet for this message
	if (!existing || existing.length === 0) {
		set(partsFamily(messageId), [part])
		return
	}

	const result = binarySearch(existing, part.id, (p) => p.id)

	if (result.found) {
		if (existing[result.index] === part) return // reference equality skip
		const updated = existing.slice()
		updated[result.index] = part
		set(partsFamily(messageId), updated)
	} else {
		const updated = existing.slice()
		updated.splice(result.index, 0, part)
		set(partsFamily(messageId), updated)
	}
})

/** Batch upsert multiple parts (used when flushing streaming buffer) */
export const batchUpsertPartsAtom = atom(null, (get, set, parts: Part[]) => {
	if (parts.length === 0) return

	// Group by messageId to minimize atom writes
	const byMessage = new Map<string, Part[]>()
	for (const part of parts) {
		const group = byMessage.get(part.messageID) ?? []
		group.push(part)
		byMessage.set(part.messageID, group)
	}

	for (const [messageId, messageParts] of byMessage) {
		const existing = get(partsFamily(messageId))
		const updated = existing ? [...existing] : []

		for (const part of messageParts) {
			const result = binarySearch(updated, part.id, (p) => p.id)
			if (result.found) {
				updated[result.index] = part
			} else {
				updated.splice(result.index, 0, part)
			}
		}

		set(partsFamily(messageId), updated)
	}
})

/** Remove a part from a message */
export const removePartAtom = atom(
	null,
	(
		get,
		set,
		args: {
			messageId: string
			partId: string
		},
	) => {
		const existing = get(partsFamily(args.messageId))
		if (!existing) return
		const result = binarySearch(existing, args.partId, (p) => p.id)
		if (!result.found) return
		const updated = [...existing]
		updated.splice(result.index, 1)
		set(partsFamily(args.messageId), updated)
	},
)
