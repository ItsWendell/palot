import { create } from "zustand"
import type { Event, Permission, Session, SessionStatus } from "../lib/types"

// ============================================================
// Store types
// ============================================================

interface SessionEntry {
	session: Session
	status: SessionStatus
	/** Pending permission requests */
	permissions: Permission[]
}

interface ServerConnection {
	id: string
	url: string
	directory: string
	connected: boolean
	/** Session data keyed by session ID */
	sessions: Record<string, SessionEntry>
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
	/** Whether discovery has been loaded */
	loaded: boolean
	/** Whether discovery is currently loading */
	loading: boolean
	/** Error message if discovery failed */
	error: string | null
	/** Discovered projects */
	projects: DiscoveredProject[]
	/** Discovered sessions, keyed by project ID */
	sessions: Record<string, DiscoveredSession[]>
}

interface UIState {
	commandPaletteOpen: boolean
	showSubAgents: boolean
}

interface AppState {
	/** Connected OpenCode server instances */
	servers: Record<string, ServerConnection>
	/** Discovered data from local OpenCode storage */
	discovery: DiscoveryState
	/** UI state */
	ui: UIState

	// ========== Server actions ==========
	addServer: (id: string, url: string, directory: string) => void
	removeServer: (id: string) => void
	setServerConnected: (id: string, connected: boolean) => void

	// ========== Session actions ==========
	setSession: (serverId: string, session: Session) => void
	removeSession: (serverId: string, sessionId: string) => void
	setSessionStatus: (serverId: string, sessionId: string, status: SessionStatus) => void
	addPermission: (serverId: string, sessionId: string, permission: Permission) => void
	removePermission: (serverId: string, sessionId: string, permissionId: string) => void
	setSessions: (
		serverId: string,
		sessions: Session[],
		statuses: Record<string, SessionStatus>,
	) => void

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
	processEvent: (serverId: string, event: Event) => void
}

// ============================================================
// Store implementation
// ============================================================

export const useAppStore = create<AppState>((set, get) => ({
	servers: {},
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

	addServer: (id, url, directory) =>
		set((state) => ({
			servers: {
				...state.servers,
				[id]: { id, url, directory, connected: false, sessions: {} },
			},
		})),

	removeServer: (id) =>
		set((state) => {
			const { [id]: _, ...rest } = state.servers
			return { servers: rest }
		}),

	setServerConnected: (id, connected) =>
		set((state) => {
			const server = state.servers[id]
			if (!server) return state
			return {
				servers: {
					...state.servers,
					[id]: { ...server, connected },
				},
			}
		}),

	// ========== Session actions ==========

	setSession: (serverId, session) =>
		set((state) => {
			const server = state.servers[serverId]
			if (!server) return state
			const existing = server.sessions[session.id]
			return {
				servers: {
					...state.servers,
					[serverId]: {
						...server,
						sessions: {
							...server.sessions,
							[session.id]: {
								session,
								status: existing?.status ?? { type: "idle" },
								permissions: existing?.permissions ?? [],
							},
						},
					},
				},
			}
		}),

	removeSession: (serverId, sessionId) =>
		set((state) => {
			const server = state.servers[serverId]
			if (!server) return state
			const { [sessionId]: _, ...rest } = server.sessions
			return {
				servers: {
					...state.servers,
					[serverId]: { ...server, sessions: rest },
				},
			}
		}),

	setSessionStatus: (serverId, sessionId, status) =>
		set((state) => {
			const server = state.servers[serverId]
			if (!server) return state
			const entry = server.sessions[sessionId]
			if (!entry) return state
			return {
				servers: {
					...state.servers,
					[serverId]: {
						...server,
						sessions: {
							...server.sessions,
							[sessionId]: { ...entry, status },
						},
					},
				},
			}
		}),

	addPermission: (serverId, sessionId, permission) =>
		set((state) => {
			const server = state.servers[serverId]
			if (!server) return state
			const entry = server.sessions[sessionId]
			if (!entry) return state
			return {
				servers: {
					...state.servers,
					[serverId]: {
						...server,
						sessions: {
							...server.sessions,
							[sessionId]: {
								...entry,
								permissions: [...entry.permissions, permission],
							},
						},
					},
				},
			}
		}),

	removePermission: (serverId, sessionId, permissionId) =>
		set((state) => {
			const server = state.servers[serverId]
			if (!server) return state
			const entry = server.sessions[sessionId]
			if (!entry) return state
			return {
				servers: {
					...state.servers,
					[serverId]: {
						...server,
						sessions: {
							...server.sessions,
							[sessionId]: {
								...entry,
								permissions: entry.permissions.filter((p) => p.id !== permissionId),
							},
						},
					},
				},
			}
		}),

	setSessions: (serverId, sessions, statuses) =>
		set((state) => {
			const server = state.servers[serverId]
			if (!server) return state
			const sessionEntries: Record<string, SessionEntry> = {}
			for (const session of sessions) {
				sessionEntries[session.id] = {
					session,
					status: statuses[session.id] ?? { type: "idle" },
					permissions: server.sessions[session.id]?.permissions ?? [],
				}
			}
			return {
				servers: {
					...state.servers,
					[serverId]: { ...server, sessions: sessionEntries },
				},
			}
		}),

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

	processEvent: (serverId, event) => {
		const state = get()
		switch (event.type) {
			case "server.connected":
				state.setServerConnected(serverId, true)
				break

			case "session.created":
				state.setSession(serverId, event.properties.info)
				break

			case "session.updated":
				state.setSession(serverId, event.properties.info)
				break

			case "session.deleted":
				state.removeSession(serverId, event.properties.info.id)
				break

			case "session.status":
				state.setSessionStatus(serverId, event.properties.sessionID, event.properties.status)
				break

			case "permission.updated":
				state.addPermission(serverId, event.properties.sessionID, event.properties as Permission)
				break

			case "permission.replied":
				state.removePermission(serverId, event.properties.sessionID, event.properties.permissionID)
				break
		}
	},
}))

// Derived selectors have been moved to hooks/use-agents.ts
// They use `useAppStore((s) => s.servers)` + `useMemo` to avoid
// the "getSnapshot must be cached" infinite loop issue.
