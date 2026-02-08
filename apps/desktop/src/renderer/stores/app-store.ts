import { create } from "zustand"
import type {
	Event,
	Message,
	Part,
	Permission,
	QuestionRequest,
	Session,
	SessionStatus,
	Todo,
} from "../lib/types"

// Error type from session.error events
type SessionError = {
	name: string
	data: Record<string, unknown>
}

// ============================================================
// Store types
// ============================================================

export interface SessionEntry {
	session: Session
	status: SessionStatus
	/** Pending permission requests */
	permissions: Permission[]
	/** Pending question requests */
	questions: QuestionRequest[]
	/** Project directory this session belongs to */
	directory: string
	/** Last session-level error (from session.error events) */
	error?: SessionError
}

/** Single OpenCode server connection state */
interface OpenCodeState {
	url: string | null
	connected: boolean
}

/** A project discovered from OpenCode's local storage */
export interface DiscoveredProject {
	id: string
	worktree: string
	vcs: string
	time: {
		created: number
		updated?: number
	}
}

/** A session discovered from OpenCode's local storage */
export interface DiscoveredSession {
	id: string
	slug?: string
	projectID: string
	directory: string
	parentID?: string
	title: string
	version?: string
	time: {
		created: number
		updated?: number
	}
	summary?: {
		additions: number
		deletions: number
		files: number
	}
}

/** State for discovered (offline) data from local storage */
interface DiscoveryState {
	loaded: boolean
	loading: boolean
	error: string | null
	projects: DiscoveredProject[]
	sessions: Record<string, DiscoveredSession[]>
}

interface UIState {
	commandPaletteOpen: boolean
	showSubAgents: boolean
}

interface AppState {
	/** Single OpenCode server state */
	opencode: OpenCodeState
	/** All sessions (flat, not nested under servers) */
	sessions: Record<string, SessionEntry>
	/** Messages keyed by sessionID, sorted by id */
	messages: Record<string, Message[]>
	/** Parts keyed by messageID, sorted by id */
	parts: Record<string, Part[]>
	/**
	 * Per-session version counter for parts — bumped on every upsertPart/batchUpsertParts.
	 * Allows selectors to subscribe to a specific session's parts changes without
	 * subscribing to the entire `parts` record (which changes on every part update
	 * across all sessions).
	 */
	partsVersion: Record<string, number>
	/** Todos keyed by sessionID — latest task list per session */
	todos: Record<string, Todo[]>
	/** Discovered data from local OpenCode storage */
	discovery: DiscoveryState
	/** UI state */
	ui: UIState

	// ========== Server actions ==========
	setOpenCodeUrl: (url: string) => void
	setOpenCodeConnected: (connected: boolean) => void

	// ========== Session actions ==========
	setSession: (session: Session, directory: string) => void
	removeSession: (sessionId: string) => void
	setSessionStatus: (sessionId: string, status: SessionStatus) => void
	setSessionError: (sessionId: string, error: SessionError) => void
	clearSessionError: (sessionId: string) => void
	addPermission: (sessionId: string, permission: Permission) => void
	removePermission: (sessionId: string, permissionId: string) => void
	addQuestion: (sessionId: string, question: QuestionRequest) => void
	removeQuestion: (sessionId: string, requestId: string) => void
	setSessions: (
		sessions: Session[],
		statuses: Record<string, SessionStatus>,
		directory: string,
	) => void

	// ========== Message/Part actions ==========
	setMessages: (sessionId: string, messages: Message[], parts: Record<string, Part[]>) => void
	upsertMessage: (message: Message) => void
	removeMessage: (sessionId: string, messageId: string) => void
	upsertPart: (part: Part) => void
	/** Batch-upsert multiple parts in a single store update (one spread, one notification). */
	batchUpsertParts: (parts: Part[]) => void
	removePart: (messageId: string, partId: string) => void

	// ========== Todo actions ==========
	setTodos: (sessionId: string, todos: Todo[]) => void

	// ========== Discovery actions ==========
	setDiscoveryLoading: () => void
	setDiscoveryResult: (
		projects: DiscoveredProject[],
		sessions: Record<string, DiscoveredSession[]>,
	) => void
	setDiscoveryError: (error: string) => void

	// ========== UI actions ==========
	setCommandPaletteOpen: (open: boolean) => void
	setShowSubAgents: (show: boolean) => void
	toggleShowSubAgents: () => void

	// ========== Event processing ==========
	processEvent: (event: Event) => void
}

// ============================================================
// Helpers
// ============================================================

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
// Store implementation
// ============================================================

export const useAppStore = create<AppState>((set, get) => ({
	opencode: {
		url: null,
		connected: false,
	},
	sessions: {},
	messages: {},
	parts: {},
	partsVersion: {},
	todos: {},
	discovery: {
		loaded: false,
		loading: false,
		error: null,
		projects: [],
		sessions: {},
	},
	ui: {
		commandPaletteOpen: false,
		showSubAgents: false,
	},

	// ========== Server actions ==========

	setOpenCodeUrl: (url) =>
		set((state) => ({
			opencode: { ...state.opencode, url },
		})),

	setOpenCodeConnected: (connected) =>
		set((state) => ({
			opencode: { ...state.opencode, connected },
		})),

	// ========== Session actions ==========

	setSession: (session, directory) =>
		set((state) => {
			const existing = state.sessions[session.id]
			return {
				sessions: {
					...state.sessions,
					[session.id]: {
						session,
						status: existing?.status ?? { type: "idle" },
						permissions: existing?.permissions ?? [],
						questions: existing?.questions ?? [],
						directory: existing?.directory ?? directory,
					},
				},
			}
		}),

	removeSession: (sessionId) =>
		set((state) => {
			const { [sessionId]: _, ...rest } = state.sessions
			return { sessions: rest }
		}),

	setSessionStatus: (sessionId, status) =>
		set((state) => {
			const entry = state.sessions[sessionId]
			if (!entry) return state
			return {
				sessions: {
					...state.sessions,
					[sessionId]: { ...entry, status },
				},
			}
		}),

	setSessionError: (sessionId, error) =>
		set((state) => {
			const entry = state.sessions[sessionId]
			if (!entry) return state
			return {
				sessions: {
					...state.sessions,
					[sessionId]: { ...entry, error },
				},
			}
		}),

	clearSessionError: (sessionId) =>
		set((state) => {
			const entry = state.sessions[sessionId]
			if (!entry || !entry.error) return state
			return {
				sessions: {
					...state.sessions,
					[sessionId]: { ...entry, error: undefined },
				},
			}
		}),

	addPermission: (sessionId, permission) =>
		set((state) => {
			const entry = state.sessions[sessionId]
			if (!entry) return state
			return {
				sessions: {
					...state.sessions,
					[sessionId]: {
						...entry,
						permissions: [...entry.permissions, permission],
					},
				},
			}
		}),

	removePermission: (sessionId, permissionId) =>
		set((state) => {
			const entry = state.sessions[sessionId]
			if (!entry) return state
			return {
				sessions: {
					...state.sessions,
					[sessionId]: {
						...entry,
						permissions: entry.permissions.filter((p) => p.id !== permissionId),
					},
				},
			}
		}),

	addQuestion: (sessionId, question) =>
		set((state) => {
			const entry = state.sessions[sessionId]
			if (!entry) return state
			// Avoid duplicates
			if (entry.questions.some((q) => q.id === question.id)) return state
			return {
				sessions: {
					...state.sessions,
					[sessionId]: {
						...entry,
						questions: [...entry.questions, question],
					},
				},
			}
		}),

	removeQuestion: (sessionId, requestId) =>
		set((state) => {
			const entry = state.sessions[sessionId]
			if (!entry) return state
			return {
				sessions: {
					...state.sessions,
					[sessionId]: {
						...entry,
						questions: entry.questions.filter((q) => q.id !== requestId),
					},
				},
			}
		}),

	setSessions: (sessions, statuses, directory) =>
		set((state) => {
			const newSessions = { ...state.sessions }
			for (const session of sessions) {
				const existing = newSessions[session.id]
				newSessions[session.id] = {
					session,
					status: statuses[session.id] ?? existing?.status ?? { type: "idle" },
					permissions: existing?.permissions ?? [],
					questions: existing?.questions ?? [],
					directory,
				}
			}
			return { sessions: newSessions }
		}),

	// ========== Message/Part actions ==========

	setMessages: (sessionId, messages, messageParts) =>
		set((state) => ({
			messages: { ...state.messages, [sessionId]: messages },
			parts: { ...state.parts, ...messageParts },
		})),

	upsertMessage: (message) =>
		set((state) => {
			const sessionId = message.sessionID
			let existing = state.messages[sessionId] ?? []
			let newParts = state.parts

			// When a real user message arrives, remove the oldest optimistic placeholder.
			// Only remove ONE at a time so queued optimistic messages are preserved
			// until their own server-confirmed message arrives.
			if (message.role === "user" && !message.id.startsWith("optimistic-")) {
				const optimisticIndex = existing.findIndex(
					(m) => m.id.startsWith("optimistic-") && m.role === "user",
				)
				if (optimisticIndex !== -1) {
					const optimisticId = existing[optimisticIndex].id
					const cleaned: Record<string, Part[]> = { ...state.parts }
					delete cleaned[optimisticId]
					existing = existing.filter((_, i) => i !== optimisticIndex)
					newParts = cleaned
				}
			}

			const result = binarySearch(existing, message.id, (m) => m.id)

			if (result.found) {
				// Skip if reference-equal (no change)
				if (existing[result.index] === message) return state

				const updated = existing.slice()
				updated[result.index] = message
				// Cap at 200 messages per session (remove oldest + clean up parts)
				if (updated.length > 200) {
					const removed = updated.shift()!
					const { [removed.id]: _, ...restParts } = newParts
					newParts = restParts
				}
				return {
					messages: { ...state.messages, [sessionId]: updated },
					parts: newParts,
				}
			}

			const updated = existing.slice()
			updated.splice(result.index, 0, message)
			// Cap at 200 messages per session (remove oldest + clean up parts)
			if (updated.length > 200) {
				const removed = updated.shift()!
				const { [removed.id]: _, ...restParts } = newParts
				newParts = restParts
			}
			return {
				messages: { ...state.messages, [sessionId]: updated },
				parts: newParts,
			}
		}),

	removeMessage: (sessionId, messageId) =>
		set((state) => {
			const existing = state.messages[sessionId]
			if (!existing) return state
			const result = binarySearch(existing, messageId, (m) => m.id)
			if (!result.found) return state
			const updated = [...existing]
			updated.splice(result.index, 1)
			const { [messageId]: _, ...restParts } = state.parts
			return {
				messages: { ...state.messages, [sessionId]: updated },
				parts: restParts,
			}
		}),

	upsertPart: (part) =>
		set((state) => {
			const messageId = part.messageID
			const sessionId = part.sessionID
			const existing = state.parts[messageId]

			// Bump the per-session version counter so components that only
			// care about this session's parts can use a cheap numeric selector.
			const nextVersion = (state.partsVersion[sessionId] ?? 0) + 1
			const newPartsVersion = { ...state.partsVersion, [sessionId]: nextVersion }

			// Fast path: no parts yet for this message — create a new single-element array
			if (!existing) {
				return {
					parts: { ...state.parts, [messageId]: [part] },
					partsVersion: newPartsVersion,
				}
			}

			const result = binarySearch(existing, part.id, (p) => p.id)

			if (result.found) {
				// Skip update entirely if the object is reference-equal (no change)
				if (existing[result.index] === part) return state

				// Replace in-place: copy only the array, reuse all other Part references
				const updated = existing.slice()
				updated[result.index] = part
				return {
					parts: { ...state.parts, [messageId]: updated },
					partsVersion: newPartsVersion,
				}
			}

			// Insert at sorted position
			const updated = existing.slice()
			updated.splice(result.index, 0, part)
			return {
				parts: { ...state.parts, [messageId]: updated },
				partsVersion: newPartsVersion,
			}
		}),

	batchUpsertParts: (parts) =>
		set((state) => {
			if (parts.length === 0) return state

			// Build a single new parts record in one pass — only one spread
			// of the top-level record instead of one per part.
			const newParts = { ...state.parts }
			const touchedSessions = new Set<string>()
			for (const part of parts) {
				const messageId = part.messageID
				const existing = newParts[messageId] ?? []
				const result = binarySearch(existing, part.id, (p) => p.id)

				if (result.found) {
					if (existing[result.index] === part) continue
					const updated = existing.slice()
					updated[result.index] = part
					newParts[messageId] = updated
				} else {
					const updated = existing.slice()
					updated.splice(result.index, 0, part)
					newParts[messageId] = updated
				}
				touchedSessions.add(part.sessionID)
			}

			// Bump version for all affected sessions
			const newPartsVersion = { ...state.partsVersion }
			for (const sid of touchedSessions) {
				newPartsVersion[sid] = (newPartsVersion[sid] ?? 0) + 1
			}

			return { parts: newParts, partsVersion: newPartsVersion }
		}),

	removePart: (messageId, partId) =>
		set((state) => {
			const existing = state.parts[messageId]
			if (!existing) return state
			const result = binarySearch(existing, partId, (p) => p.id)
			if (!result.found) return state
			const updated = [...existing]
			updated.splice(result.index, 1)
			return {
				parts: { ...state.parts, [messageId]: updated },
			}
		}),

	// ========== Todo actions ==========

	setTodos: (sessionId, todos) =>
		set((state) => ({
			todos: { ...state.todos, [sessionId]: todos },
		})),

	// ========== Discovery actions ==========

	setDiscoveryLoading: () =>
		set((state) => ({
			discovery: { ...state.discovery, loading: true, error: null },
		})),

	setDiscoveryResult: (projects, sessions) =>
		set(() => ({
			discovery: { loaded: true, loading: false, error: null, projects, sessions },
		})),

	setDiscoveryError: (error) =>
		set((state) => ({
			discovery: { ...state.discovery, loading: false, error },
		})),

	// ========== UI actions ==========

	setCommandPaletteOpen: (open) =>
		set((state) => ({ ui: { ...state.ui, commandPaletteOpen: open } })),

	setShowSubAgents: (show) => set((state) => ({ ui: { ...state.ui, showSubAgents: show } })),

	toggleShowSubAgents: () =>
		set((state) => ({ ui: { ...state.ui, showSubAgents: !state.ui.showSubAgents } })),

	// ========== Event processing ==========

	processEvent: (event) => {
		const state = get()

		// Handle question events first — these come from the v2 SDK event union
		// but the root SDK's Event type doesn't include them in its discriminant.
		// We match on the type string before the switch to avoid TS narrowing issues.
		const eventType = event.type as string
		if (eventType === "question.asked") {
			const props = (event as unknown as { properties: QuestionRequest }).properties
			state.addQuestion(props.sessionID, props)
			return
		}
		if (eventType === "question.replied") {
			const props = (event as unknown as { properties: { sessionID: string; requestID: string } })
				.properties
			state.removeQuestion(props.sessionID, props.requestID)
			return
		}
		if (eventType === "question.rejected") {
			const props = (event as unknown as { properties: { sessionID: string; requestID: string } })
				.properties
			state.removeQuestion(props.sessionID, props.requestID)
			return
		}

		switch (event.type) {
			case "server.connected":
				state.setOpenCodeConnected(true)
				break

			case "session.created": {
				const info = event.properties.info
				state.setSession(info, info.directory ?? "")
				break
			}

			case "session.updated": {
				const info = event.properties.info
				state.setSession(info, info.directory ?? "")
				break
			}

			case "session.deleted":
				state.removeSession(event.properties.info.id)
				break

			case "session.status":
				state.setSessionStatus(event.properties.sessionID, event.properties.status)
				// Clear session-level error when the session starts working again
				if (event.properties.status.type !== "idle") {
					state.clearSessionError(event.properties.sessionID)
				}
				break

			case "session.error": {
				const sessionID = event.properties.sessionID
				const error = event.properties.error
				if (sessionID && error) {
					state.setSessionError(sessionID, error as SessionError)
				}
				break
			}

			case "permission.updated":
				state.addPermission(event.properties.sessionID, event.properties as Permission)
				break

			case "permission.replied":
				state.removePermission(event.properties.sessionID, event.properties.permissionID)
				break

			case "message.updated":
				state.upsertMessage(event.properties.info)
				break

			case "message.removed":
				state.removeMessage(event.properties.sessionID, event.properties.messageID)
				break

			case "message.part.updated":
				state.upsertPart(event.properties.part)
				break

			case "message.part.removed":
				state.removePart(event.properties.messageID, event.properties.partID)
				break

			case "todo.updated":
				state.setTodos(event.properties.sessionID, event.properties.todos)
				break
		}
	},
}))

// Derived selectors have been moved to hooks/use-agents.ts
// They use `useAppStore((s) => s.sessions)` and `useAppStore((s) => s.discovery)`
// + `useMemo` to avoid the "getSnapshot must be cached" infinite loop issue.
