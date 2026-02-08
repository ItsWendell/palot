import { useCallback, useEffect, useRef } from "react"
import { usePersistedStore } from "../stores/persisted-store"

/** Key used for the new-chat (landing page) draft */
export const NEW_CHAT_DRAFT_KEY = "__new_chat__"

/**
 * Returns the current draft text for a given key (session ID or NEW_CHAT_DRAFT_KEY).
 */
export function useDraft(key: string): string {
	return usePersistedStore((s) => s.drafts[key] ?? "")
}

/**
 * Hook that returns a debounced setter for persisting draft text,
 * plus a clearDraft function for immediate cleanup (e.g. on send).
 *
 * The setter debounces writes by 500ms to avoid excessive localStorage churn.
 * Pending writes are flushed on unmount so drafts are never lost.
 */
export function useDraftActions(key: string) {
	const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
	const latestTextRef = useRef<string | null>(null)
	const keyRef = useRef(key)
	keyRef.current = key

	const flush = useCallback(() => {
		if (timerRef.current !== null) {
			clearTimeout(timerRef.current)
			timerRef.current = null
		}
		if (latestTextRef.current !== null) {
			const text = latestTextRef.current
			latestTextRef.current = null
			const store = usePersistedStore.getState()
			if (text) {
				store.setDraft(keyRef.current, text)
			} else {
				store.clearDraft(keyRef.current)
			}
		}
	}, [])

	const setDraft = useCallback(
		(text: string) => {
			latestTextRef.current = text
			if (timerRef.current !== null) {
				clearTimeout(timerRef.current)
			}
			timerRef.current = setTimeout(flush, 500)
		},
		[flush],
	)

	const clearDraft = useCallback(() => {
		// Cancel any pending debounced write
		if (timerRef.current !== null) {
			clearTimeout(timerRef.current)
			timerRef.current = null
		}
		latestTextRef.current = null
		usePersistedStore.getState().clearDraft(keyRef.current)
	}, [])

	// Flush pending draft on unmount (e.g. switching sessions)
	useEffect(() => {
		return () => {
			flush()
		}
	}, [flush])

	return { setDraft, clearDraft }
}
