import { useCallback, useEffect, useRef, useState } from "react"
import { fetchSessionMessages } from "../services/codedeck-server"
import { getClient } from "../services/connection-manager"

// ============================================================
// Types — mirrors OpenCode's message/part structure
// ============================================================

export interface ChatMessageInfo {
	id: string
	role: "user" | "assistant"
	parentID?: string
	sessionID?: string
	time: {
		created: number
		completed?: number
	}
	modelID?: string
	providerID?: string
	cost?: number
	tokens?: {
		input: number
		output: number
		reasoning: number
		cache: { read: number; write: number }
	}
	error?: {
		data?: {
			message?: string
		}
	}
	summary?: {
		title?: string
		body?: string
		diffs?: unknown[]
	}
}

export interface ChatPart {
	id: string
	type: string // "text" | "tool" | "reasoning" | "step-start" | "step-finish" | "file"
	text?: string
	tool?: string
	callID?: string
	synthetic?: boolean
	state?: {
		status?: string
		input?: Record<string, unknown>
		output?: string
		title?: string
		error?: string
		metadata?: Record<string, unknown>
		time?: { start?: number; end?: number }
	}
	time?: { start?: number; end?: number }
}

export interface ChatMessageEntry {
	info: ChatMessageInfo
	parts: ChatPart[]
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

/**
 * Groups messages into turns: each user message + subsequent assistant messages
 * that have matching parentID.
 */
function groupIntoTurns(entries: ChatMessageEntry[]): ChatTurn[] {
	const turns: ChatTurn[] = []

	for (let i = 0; i < entries.length; i++) {
		const entry = entries[i]
		if (entry.info.role !== "user") continue

		const assistantMessages: ChatMessageEntry[] = []
		for (let j = i + 1; j < entries.length; j++) {
			const next = entries[j]
			if (next.info.role === "user") break
			if (next.info.role === "assistant") {
				// Include if parentID matches or if there's no parentID tracking
				if (!next.info.parentID || next.info.parentID === entry.info.id) {
					assistantMessages.push(next)
				}
			}
		}

		turns.push({
			id: entry.info.id,
			userMessage: entry,
			assistantMessages,
		})
	}

	return turns
}

/** Polling interval for active sessions (ms) */
const ACTIVE_POLL_INTERVAL = 2000
/** Polling interval for idle sessions after first load (ms) — disabled */
const IDLE_POLL_INTERVAL = 0

/**
 * Hook to load full chat data for a session.
 * Returns structured turns (user + assistant messages with parts)
 * instead of flattened activities.
 *
 * When `isActive` is true (session is running/waiting), polls for updates
 * every 2 seconds to provide near-real-time chat updates.
 */
export function useSessionChat(
	serverId: string | null,
	sessionId: string | null,
	isActive = false,
) {
	const [turns, setTurns] = useState<ChatTurn[]>([])
	const [rawMessages, setRawMessages] = useState<ChatMessageEntry[]>([])
	const [loading, setLoading] = useState(false)
	const [error, setError] = useState<string | null>(null)
	const abortRef = useRef<AbortController | null>(null)
	const pollTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

	const loadMessages = useCallback(
		async (showLoading = true) => {
			if (!sessionId) {
				setTurns([])
				setRawMessages([])
				return
			}

			abortRef.current?.abort()
			const abort = new AbortController()
			abortRef.current = abort

			if (showLoading) {
				setLoading(true)
			}
			setError(null)

			try {
				let messages: ChatMessageEntry[]

				// Try the live OpenCode server first
				const client = serverId ? getClient(serverId) : null
				if (client) {
					const result = await client.session.messages({
						path: { id: sessionId },
					})
					messages = (result.data as unknown as ChatMessageEntry[]) ?? []
				} else {
					// Fallback: read from disk via codedeck backend
					const result = await fetchSessionMessages(sessionId)
					messages = (result.messages as unknown as ChatMessageEntry[]) ?? []
				}

				if (abort.signal.aborted) return

				setRawMessages(messages)
				setTurns(groupIntoTurns(messages))
			} catch (err) {
				if (abort.signal.aborted) return
				console.error("Failed to load chat messages:", err)
				setError(err instanceof Error ? err.message : "Failed to load messages")
				setTurns([])
				setRawMessages([])
			} finally {
				if (!abort.signal.aborted) {
					setLoading(false)
				}
			}
		},
		[serverId, sessionId],
	)

	// Initial load when session changes
	useEffect(() => {
		loadMessages(true)
		return () => {
			abortRef.current?.abort()
		}
	}, [loadMessages])

	// Polling for active sessions — provides near-real-time updates
	// without requiring a full store-based SSE event system
	useEffect(() => {
		if (!isActive || !sessionId) {
			if (pollTimerRef.current) {
				clearTimeout(pollTimerRef.current)
				pollTimerRef.current = undefined
			}
			return
		}

		const interval = isActive ? ACTIVE_POLL_INTERVAL : IDLE_POLL_INTERVAL
		if (interval <= 0) return

		const poll = () => {
			loadMessages(false) // Don't show loading spinner on polls
			pollTimerRef.current = setTimeout(poll, interval)
		}

		pollTimerRef.current = setTimeout(poll, interval)

		return () => {
			if (pollTimerRef.current) {
				clearTimeout(pollTimerRef.current)
				pollTimerRef.current = undefined
			}
		}
	}, [isActive, sessionId, loadMessages])

	return { turns, rawMessages, loading, error, reload: loadMessages }
}
