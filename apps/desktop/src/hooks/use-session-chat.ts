import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import type { Message, Part } from "../lib/types"
import { fetchSessionMessages } from "../services/codedeck-server"
import { getProjectClient } from "../services/connection-manager"
import { useAppStore } from "../stores/app-store"

/** Sentinel empty array — stable reference to avoid creating new arrays */
const EMPTY_PARTS: Part[] = []
const EMPTY_PARTS_ARRAY: ReadonlyArray<Part[]> = []

// ============================================================
// Types — wrappers around SDK Message + Part
// ============================================================

/** A message with its associated parts — mirrors the API response shape */
export interface ChatMessageEntry {
	info: Message
	parts: Part[]
}

/**
 * A "turn" groups a user message with its assistant responses,
 * following OpenCode's turn-based UI pattern.
 */
export interface ChatTurn {
	id: string
	userMessage: ChatMessageEntry
	assistantMessages: ChatMessageEntry[]
}

// ============================================================
// Turn grouping with structural sharing
// ============================================================

/**
 * Creates a fingerprint for a message entry based on its ID,
 * completion time, and part count. Used for cheap equality checks.
 */
function messageFingerprint(entry: ChatMessageEntry): string {
	const lastPart = entry.parts.at(-1)
	const completed = entry.info.role === "assistant" ? (entry.info.time.completed ?? 0) : 0
	return `${entry.info.id}:${completed}:${entry.parts.length}:${lastPart?.id ?? ""}`
}

/**
 * Creates a fingerprint for a turn. If the fingerprint matches,
 * the turn hasn't changed and the previous object can be reused.
 */
function turnFingerprint(turn: ChatTurn): string {
	const assistantFps = turn.assistantMessages.map(messageFingerprint).join("|")
	return `${messageFingerprint(turn.userMessage)}>${assistantFps}`
}

/**
 * Groups messages into turns: each user message + subsequent assistant messages.
 * Uses structural sharing with `prevTurns` to preserve object references
 * for unchanged turns, so React.memo() can skip re-renders.
 */
function groupIntoTurns(entries: ChatMessageEntry[], prevTurns: ChatTurn[]): ChatTurn[] {
	// Build a map of previous fingerprints -> turn objects for reuse
	const prevMap = new Map<string, ChatTurn>()
	for (const t of prevTurns) {
		prevMap.set(turnFingerprint(t), t)
	}

	const turns: ChatTurn[] = []

	for (let i = 0; i < entries.length; i++) {
		const entry = entries[i]
		if (entry.info.role !== "user") continue

		const assistantMessages: ChatMessageEntry[] = []
		for (let j = i + 1; j < entries.length; j++) {
			const next = entries[j]
			if (next.info.role === "user") break
			if (next.info.role === "assistant") {
				if (!next.info.parentID || next.info.parentID === entry.info.id) {
					assistantMessages.push(next)
				}
			}
		}

		const newTurn: ChatTurn = {
			id: entry.info.id,
			userMessage: entry,
			assistantMessages,
		}

		// Reuse previous turn object if fingerprint matches
		const fp = turnFingerprint(newTurn)
		const prevTurn = prevMap.get(fp)
		turns.push(prevTurn ?? newTurn)
	}

	return turns
}

// ============================================================
// Hook
// ============================================================

/** How many messages to fetch on initial load */
const INITIAL_LIMIT = 100

/**
 * Hook to load chat data for a session.
 *
 * - Reads messages/parts from the Zustand store (populated by SSE events)
 * - Does a one-time initial fetch to hydrate the store
 * - Uses structural sharing in `groupIntoTurns` to preserve React.memo()
 * - No polling — SSE keeps data up to date
 */
export function useSessionChat(
	directory: string | null,
	sessionId: string | null,
	_isActive = false,
) {
	const [loading, setLoading] = useState(false)
	const [error, setError] = useState<string | null>(null)
	/** Track which sessions we've already synced */
	const syncedRef = useRef<Set<string>>(new Set())
	const turnsRef = useRef<ChatTurn[]>([])

	// Read from store — Zustand selector returns stable ref if unchanged
	const storeMessages = useAppStore((s) => s.messages[sessionId ?? ""])

	// Read the raw parts record from the store — this is a stable reference
	// that only changes when parts are actually updated.
	// IMPORTANT: Do NOT use a selector that derives/maps arrays — that creates
	// new references on every getSnapshot call, causing infinite loops with
	// React 19's strict useSyncExternalStore.
	const storeParts = useAppStore((s) => s.parts)

	// Derive per-session parts in useMemo to avoid creating new arrays in the selector
	const sessionParts = useMemo(() => {
		if (!storeMessages) return EMPTY_PARTS_ARRAY
		return storeMessages.map((msg) => storeParts[msg.id] ?? EMPTY_PARTS)
	}, [storeMessages, storeParts])

	// Assemble ChatMessageEntry[] from store state
	const entries: ChatMessageEntry[] = useMemo(() => {
		if (!storeMessages) return []
		return storeMessages.map((msg, i) => ({
			info: msg,
			parts: sessionParts[i] ?? EMPTY_PARTS,
		}))
	}, [storeMessages, sessionParts])

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

				// Try the live OpenCode server first (if we have a connection)
				const client = directory ? getProjectClient(directory) : null
				if (client) {
					const result = await client.session.messages({
						sessionID: sid,
						limit: INITIAL_LIMIT,
					})
					raw = (result.data ?? []) as Array<{ info: Message; parts: Part[] }>
				} else {
					// Fallback: read from disk via the Codedeck backend server
					const result = await fetchSessionMessages(sid)
					raw = (result.messages ?? []) as unknown as Array<{ info: Message; parts: Part[] }>
				}

				// Hydrate the store
				const messages = raw.map((m) => m.info)
				const parts: Record<string, Part[]> = {}
				for (const m of raw) {
					parts[m.info.id] = m.parts
				}
				useAppStore.getState().setMessages(sid, messages, parts)
			} catch (err) {
				console.error("Failed to fetch session messages:", err)
				setError(err instanceof Error ? err.message : "Failed to load messages")
			} finally {
				setLoading(false)
			}
		},
		[directory],
	)

	// Trigger initial fetch when session changes (only once per session)
	useEffect(() => {
		if (!sessionId) return
		if (syncedRef.current.has(sessionId)) return
		syncedRef.current.add(sessionId)
		fetchAndHydrate(sessionId)
	}, [sessionId, fetchAndHydrate])

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
		loadingEarlier: false,
		error,
		/** Whether there are earlier messages that haven't been loaded */
		hasEarlierMessages: false,
		/** Load the full message history (no-op for now, could be implemented later) */
		loadEarlier: async () => {},
		reload: fetchAndHydrate,
	}
}
