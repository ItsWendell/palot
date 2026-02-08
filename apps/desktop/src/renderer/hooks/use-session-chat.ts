import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react"
import type { Message, Part } from "../lib/types"
import { fetchSessionMessages } from "../services/backend"
import { getProjectClient } from "../services/connection-manager"
import { useAppStore } from "../stores/app-store"
import {
	getAllStreamingParts,
	getSnapshot as getStreamingSnapshot,
	subscribe as subscribeStreaming,
} from "../stores/streaming-store"

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
 * completion time, part count, and content characteristics.
 * Used for cheap equality checks — includes text content length
 * so that streaming updates (where part count stays the same but
 * content grows) correctly invalidate the fingerprint, and tool
 * state so that tool status transitions (running → completed) and
 * output arrivals also invalidate it.
 */
function messageFingerprint(entry: ChatMessageEntry): string {
	const lastPart = entry.parts.at(-1)
	const completed = entry.info.role === "assistant" ? (entry.info.time.completed ?? 0) : 0
	let textLen = 0
	const toolSegments: string[] = []
	for (const part of entry.parts) {
		if (part.type === "text" || part.type === "reasoning") {
			textLen += part.text.length
		} else if (part.type === "tool") {
			// Include tool status and output length so the fingerprint
			// changes when a tool transitions state or produces output.
			const outLen =
				part.state.status === "completed"
					? part.state.output.length
					: part.state.status === "error"
						? part.state.error.length
						: 0
			toolSegments.push(`${part.id}:${part.state.status}:${outLen}`)
		}
	}
	return `${entry.info.id}:${completed}:${entry.parts.length}:${lastPart?.id ?? ""}:${textLen}:${toolSegments.join(",")}`
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

/** Stable no-op for the loadEarlier fallback (avoids new ref every render) */
const NOOP_ASYNC = async () => {}

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
	/** Track which session we've already synced (no growing Set) */
	const syncedRef = useRef<string | null>(null)
	const turnsRef = useRef<ChatTurn[]>([])

	// Read from store — Zustand selector returns stable ref if unchanged
	const storeMessages = useAppStore((s) => s.messages[sessionId ?? ""])

	// Subscribe to a lightweight per-session version counter instead of the
	// entire `s.parts` record. This avoids re-renders when parts for OTHER
	// sessions change (e.g., a sub-agent streaming in the background).
	// The actual part data is read via getState() inside the useMemo.
	const partsVersion = useAppStore((s) => s.partsVersion[sessionId ?? ""] ?? 0)

	// Subscribe to the streaming store — during active streaming, text/reasoning
	// parts are accumulated here at ~50ms cadence instead of hitting Zustand on
	// every SSE token. The version counter triggers re-renders only when the
	// streaming store's throttled notify fires.
	const streamingVersion = useSyncExternalStore(subscribeStreaming, getStreamingSnapshot)

	// Derive per-session parts in useMemo, merging streaming store overrides
	// on top of main store parts. Streaming parts take priority because they
	// contain the latest content that hasn't been flushed to the main store yet.
	const sessionParts = useMemo(() => {
		if (!storeMessages) return EMPTY_PARTS_ARRAY

		// Read streaming overrides. `streamingVersion` is in the dependency
		// array to trigger recomputation when the streaming store notifies,
		// even when main-store parts haven't been flushed yet.
		void streamingVersion
		// `partsVersion` is in the dependency array to trigger recomputation
		// when this session's parts are updated in the main store.
		void partsVersion
		const streaming = getAllStreamingParts()
		const currentParts = useAppStore.getState().parts

		return storeMessages.map((msg) => {
			const baseParts = currentParts[msg.id] ?? EMPTY_PARTS
			const overrides = streaming[msg.id]

			// Fast path: no streaming overrides for this message
			if (!overrides) return baseParts

			// Overlay streaming parts on top of the base parts
			return baseParts.map((part) => overrides[part.id] ?? part)
		})
	}, [storeMessages, partsVersion, streamingVersion])

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
		if (syncedRef.current === sessionId) return
		syncedRef.current = sessionId
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
		loadEarlier: NOOP_ASYNC,
		reload: fetchAndHydrate,
	}
}
