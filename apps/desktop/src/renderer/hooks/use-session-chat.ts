import { useAtomValue } from "jotai"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import {
	type ChatMessageEntry,
	type ChatTurn,
	groupIntoTurns,
	mergeSessionParts,
} from "../atoms/derived/session-chat"
import { messagesFamily, setMessagesAtom } from "../atoms/messages"
import { isMockModeAtom } from "../atoms/mock-mode"
import { partsFamily } from "../atoms/parts"
import { appStore } from "../atoms/store"
import { streamingVersionAtom } from "../atoms/streaming"
import type { Message, Part } from "../lib/types"
import { fetchSessionMessages } from "../services/backend"
import { getProjectClient } from "../services/connection-manager"

// Re-export types for consumers
export type { ChatMessageEntry, ChatTurn }

/** Sentinel empty array — stable reference */
const EMPTY_ENTRIES: ChatMessageEntry[] = []

/** How many messages to fetch on initial load. */
const INITIAL_LIMIT = 30

/**
 * Hook to load chat data for a session.
 *
 * - Reads messages/parts from Jotai atoms (populated by SSE events)
 * - Does a one-time initial fetch to hydrate the store
 * - Uses structural sharing in `groupIntoTurns` to preserve React.memo()
 * - No polling — SSE keeps data up to date
 */
export function useSessionChat(
	directory: string | null,
	sessionId: string | null,
	_isActive = false,
) {
	const isMockMode = useAtomValue(isMockModeAtom)
	const [loading, setLoading] = useState(false)
	const [loadingEarlier, setLoadingEarlier] = useState(false)
	const [error, setError] = useState<string | null>(null)
	const syncedRef = useRef<string | null>(null)
	const turnsRef = useRef<ChatTurn[]>([])
	const hasEarlierRef = useRef(false)

	// Read from Jotai atoms
	const storeMessages = useAtomValue(messagesFamily(sessionId ?? ""))
	const streamingVersion = useAtomValue(streamingVersionAtom)

	// Build ChatMessageEntry[] merging streaming overlay
	const entries: ChatMessageEntry[] = useMemo(() => {
		if (!storeMessages || storeMessages.length === 0) return EMPTY_ENTRIES
		return mergeSessionParts(
			storeMessages,
			(messageId) => appStore.get(partsFamily(messageId)),
			streamingVersion,
		)
	}, [storeMessages, streamingVersion])

	// Group into turns with structural sharing
	const turns = useMemo(() => {
		const result = groupIntoTurns(entries, turnsRef.current)
		turnsRef.current = result
		return result
	}, [entries])

	// One-time fetch to hydrate the store when session changes
	const fetchAndHydrate = useCallback(
		async (sid: string) => {
			setLoading(true)
			setError(null)
			try {
				let raw: Array<{ info: Message; parts: Part[] }>

				const client = directory ? getProjectClient(directory) : null
				if (client) {
					const result = await client.session.messages({
						sessionID: sid,
						limit: INITIAL_LIMIT,
					})
					raw = (result.data ?? []) as Array<{ info: Message; parts: Part[] }>
					hasEarlierRef.current = raw.length >= INITIAL_LIMIT
				} else {
					const result = await fetchSessionMessages(sid)
					raw = (result.messages ?? []) as unknown as Array<{ info: Message; parts: Part[] }>
					hasEarlierRef.current = false
				}

				// Hydrate the Jotai store
				const messages = raw.map((m) => m.info)
				const parts: Record<string, Part[]> = {}
				for (const m of raw) {
					parts[m.info.id] = m.parts
				}
				appStore.set(setMessagesAtom, { sessionId: sid, messages, parts })
			} catch (err) {
				console.error("Failed to fetch session messages:", err)
				setError(err instanceof Error ? err.message : "Failed to load messages")
			} finally {
				setLoading(false)
			}
		},
		[directory],
	)

	// Load all messages (for "load earlier" button)
	const loadEarlier = useCallback(async () => {
		if (!sessionId || !directory || loadingEarlier) return
		const client = getProjectClient(directory)
		if (!client) return

		setLoadingEarlier(true)
		try {
			const result = await client.session.messages({
				sessionID: sessionId,
			})
			const raw = (result.data ?? []) as Array<{ info: Message; parts: Part[] }>
			hasEarlierRef.current = false

			const messages = raw.map((m) => m.info)
			const parts: Record<string, Part[]> = {}
			for (const m of raw) {
				parts[m.info.id] = m.parts
			}
			appStore.set(setMessagesAtom, { sessionId, messages, parts })
		} catch (err) {
			console.error("Failed to load earlier messages:", err)
		} finally {
			setLoadingEarlier(false)
		}
	}, [sessionId, directory, loadingEarlier])

	// Trigger initial fetch when session changes (skip in mock mode -- data is pre-hydrated)
	useEffect(() => {
		if (isMockMode) return
		if (!sessionId) return
		if (syncedRef.current === sessionId) return
		syncedRef.current = sessionId
		fetchAndHydrate(sessionId)
	}, [sessionId, fetchAndHydrate, isMockMode])

	// Reset when session changes
	useEffect(() => {
		if (!sessionId) {
			turnsRef.current = []
		}
	}, [sessionId])

	return {
		turns,
		rawMessages: entries,
		loading,
		loadingEarlier,
		error,
		hasEarlierMessages: hasEarlierRef.current,
		loadEarlier,
		reload: fetchAndHydrate,
	}
}
