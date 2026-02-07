import { create } from "zustand"
import type {
	AgentStatus,
	EnvironmentType,
	Event,
	Permission,
	Session,
	SessionStatus,
} from "../lib/types"

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

interface UIState {
	/** Currently selected project filter (null = all) */
	selectedProject: string | null
	/** Currently selected status filter */
	selectedStatus: AgentStatus | null
	/** Currently selected environment filter */
	selectedEnvironment: EnvironmentType | null
	/** Currently selected session ID (for detail panel) */
	selectedSessionId: string | null
	/** Command palette open state */
	commandPaletteOpen: boolean
	/** New agent dialog open state */
	newAgentDialogOpen: boolean
}

interface AppState {
	/** Connected OpenCode server instances */
	servers: Record<string, ServerConnection>
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

	// ========== UI actions ==========
	setSelectedProject: (project: string | null) => void
	setSelectedStatus: (status: AgentStatus | null) => void
	setSelectedEnvironment: (env: EnvironmentType | null) => void
	setSelectedSessionId: (id: string | null) => void
	toggleSelectedSessionId: (id: string) => void
	setCommandPaletteOpen: (open: boolean) => void
	setNewAgentDialogOpen: (open: boolean) => void

	// ========== Event processing ==========
	processEvent: (serverId: string, event: Event) => void
}

// ============================================================
// Store implementation
// ============================================================

export const useAppStore = create<AppState>((set, get) => ({
	servers: {},
	ui: {
		selectedProject: null,
		selectedStatus: null,
		selectedEnvironment: null,
		selectedSessionId: null,
		commandPaletteOpen: false,
		newAgentDialogOpen: false,
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

	// ========== UI actions ==========

	setSelectedProject: (project) =>
		set((state) => ({ ui: { ...state.ui, selectedProject: project } })),

	setSelectedStatus: (status) => set((state) => ({ ui: { ...state.ui, selectedStatus: status } })),

	setSelectedEnvironment: (env) =>
		set((state) => ({ ui: { ...state.ui, selectedEnvironment: env } })),

	setSelectedSessionId: (id) => set((state) => ({ ui: { ...state.ui, selectedSessionId: id } })),

	toggleSelectedSessionId: (id) =>
		set((state) => ({
			ui: {
				...state.ui,
				selectedSessionId: state.ui.selectedSessionId === id ? null : id,
			},
		})),

	setCommandPaletteOpen: (open) =>
		set((state) => ({ ui: { ...state.ui, commandPaletteOpen: open } })),

	setNewAgentDialogOpen: (open) =>
		set((state) => ({ ui: { ...state.ui, newAgentDialogOpen: open } })),

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

// ============================================================
// Derived selectors (not in the store, computed on read)
// ============================================================

export interface FlatSessionEntry {
	serverId: string
	directory: string
	session: Session
	status: SessionStatus
	permissions: Permission[]
}

/**
 * Plain selector function for getting all sessions.
 * Must be used with useShallow or a custom equality fn to avoid infinite loops.
 */
export function selectAllSessions(state: AppState): FlatSessionEntry[] {
	const entries: FlatSessionEntry[] = []
	for (const server of Object.values(state.servers)) {
		for (const entry of Object.values(server.sessions)) {
			entries.push({
				serverId: server.id,
				directory: server.directory,
				session: entry.session,
				status: entry.status,
				permissions: entry.permissions,
			})
		}
	}
	return entries
}

/**
 * Plain selector function for getting project list.
 * Must be used with useShallow or a custom equality fn to avoid infinite loops.
 */
export function selectProjects(state: AppState): Array<{ name: string; agentCount: number }> {
	const projects = new Map<string, { name: string; directory: string; count: number }>()
	for (const server of Object.values(state.servers)) {
		const name = server.directory.split("/").pop() || server.directory
		const existing = projects.get(server.id)
		const sessionCount = Object.keys(server.sessions).length
		if (existing) {
			existing.count += sessionCount
		} else {
			projects.set(server.id, {
				name,
				directory: server.directory,
				count: sessionCount,
			})
		}
	}
	return Array.from(projects.values()).map((p) => ({
		name: p.name,
		agentCount: p.count,
	}))
}
