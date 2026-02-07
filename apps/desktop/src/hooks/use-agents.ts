import { useMemo } from "react"
import type { Agent, AgentStatus, SessionStatus, SidebarProject } from "../lib/types"
import type { DiscoveredProject } from "../stores/app-store"
import { useAppStore } from "../stores/app-store"

/**
 * Maps an OpenCode SessionStatus to our UI AgentStatus.
 */
function deriveAgentStatus(status: SessionStatus, hasPermissions: boolean): AgentStatus {
	if (hasPermissions) return "waiting"
	switch (status.type) {
		case "busy":
			return "running"
		case "retry":
			return "running" // still in progress, just retrying
		case "idle":
			return "idle"
		default:
			return "idle"
	}
}

/**
 * Formats a timestamp as relative time ("just now", "5m ago", "2h ago", "3d ago").
 */
function formatRelativeTime(timestampMs: number): string {
	const seconds = Math.max(0, Math.floor((Date.now() - timestampMs) / 1000))
	if (seconds < 60) return "just now"
	const minutes = Math.floor(seconds / 60)
	if (minutes < 60) return `${minutes}m ago`
	const hours = Math.floor(minutes / 60)
	if (hours < 24) return `${hours}h ago`
	const days = Math.floor(hours / 24)
	if (days < 30) return `${days}d ago`
	const months = Math.floor(days / 30)
	return `${months}mo ago`
}

/**
 * Formats elapsed working time for active sessions ("12s", "3m 24s").
 */
function formatElapsed(startMs: number): string {
	const seconds = Math.max(0, Math.floor((Date.now() - startMs) / 1000))
	if (seconds < 60) return `${seconds}s`
	const minutes = Math.floor(seconds / 60)
	const remainingSeconds = seconds % 60
	if (minutes < 60) return `${minutes}m ${remainingSeconds}s`
	const hours = Math.floor(minutes / 60)
	const remainingMinutes = minutes % 60
	return `${hours}h ${remainingMinutes}m`
}

/**
 * Extracts the project name from a directory path.
 */
function projectNameFromDir(directory: string): string {
	return directory.split("/").pop() || directory
}

/**
 * Hook that returns agents derived from live server sessions + discovered sessions.
 *
 * IMPORTANT: We select raw store references and compute agents inside useMemo.
 * This avoids the "getSnapshot must be cached" infinite loop with React 19.
 */
export function useAgents(): Agent[] {
	const servers = useAppStore((s) => s.servers)
	const discovery = useAppStore((s) => s.discovery)

	return useMemo(() => {
		const agents: Agent[] = []

		// Collect IDs of sessions that are live (connected to a server)
		const liveSessionIds = new Set<string>()

		// 1. Live server sessions — these take priority
		for (const server of Object.values(servers)) {
			for (const entry of Object.values(server.sessions)) {
				const { session, status, permissions } = entry
				liveSessionIds.add(session.id)
				const agentStatus = deriveAgentStatus(status, permissions.length > 0)

				const created = session.time.created
				const lastActiveAt = session.time.updated ?? session.time.created
				const isActive = agentStatus === "running" || agentStatus === "waiting"

				agents.push({
					id: session.id,
					sessionId: session.id,
					serverId: server.id,
					name: session.title || "Untitled",
					status: agentStatus,
					environment: "local" as const,
					project: projectNameFromDir(server.directory),
					directory: server.directory,
					branch: "",
					duration: isActive ? formatElapsed(created) : formatRelativeTime(lastActiveAt),
					tokens: 0,
					cost: 0,
					currentActivity:
						permissions.length > 0
							? `Waiting for approval: ${permissions[0].title}`
							: status.type === "busy"
								? "Working..."
								: undefined,
					activities: [],
					permissions,
					parentId: session.parentID,
					lastActiveAt,
				})
			}
		}

		// 2. Discovered (offline) sessions — only if not already live
		if (discovery.loaded) {
			const projectMap = new Map<string, DiscoveredProject>()
			for (const project of discovery.projects) {
				projectMap.set(project.id, project)
			}

			for (const [projectId, sessions] of Object.entries(discovery.sessions)) {
				const project = projectMap.get(projectId)
				if (!project) continue

				for (const session of sessions) {
					if (liveSessionIds.has(session.id)) continue

					const lastActiveAt = session.time.updated ?? session.time.created

					agents.push({
						id: session.id,
						sessionId: session.id,
						serverId: "", // No live server
						name: session.title || "Untitled",
						status: "completed" as const,
						environment: "local" as const,
						project: projectNameFromDir(project.worktree),
						directory: project.worktree,
						branch: "",
						duration: formatRelativeTime(lastActiveAt),
						tokens: 0,
						cost: 0,
						currentActivity: undefined,
						activities: [],
						permissions: [],
						parentId: session.parentID,
						lastActiveAt,
					})
				}
			}
		}

		return agents
	}, [servers, discovery])
}

/**
 * Hook that returns the project list for the sidebar.
 * Merges live server projects with discovered projects.
 * Respects the showSubAgents toggle — when hidden, sub-agent sessions
 * are excluded from counts.
 */
export function useProjectList(): SidebarProject[] {
	const servers = useAppStore((s) => s.servers)
	const discovery = useAppStore((s) => s.discovery)
	const showSubAgents = useAppStore((s) => s.ui.showSubAgents)

	return useMemo(() => {
		const projects = new Map<string, SidebarProject>()

		// Live server projects
		for (const server of Object.values(servers)) {
			const name = projectNameFromDir(server.directory)
			const existing = projects.get(name)
			let sessionCount = 0
			let lastActiveAt = existing?.lastActiveAt ?? 0
			for (const entry of Object.values(server.sessions)) {
				if (!showSubAgents && entry.session.parentID) continue
				sessionCount++
				const t = entry.session.time.updated ?? entry.session.time.created ?? 0
				if (t > lastActiveAt) lastActiveAt = t
			}
			if (existing) {
				existing.agentCount += sessionCount
				if (lastActiveAt > existing.lastActiveAt) existing.lastActiveAt = lastActiveAt
			} else {
				projects.set(name, {
					name,
					directory: server.directory,
					agentCount: sessionCount,
					lastActiveAt,
				})
			}
		}

		// Discovered projects — add sessions not already counted from live servers
		if (discovery.loaded) {
			// Build set of live session IDs
			const liveSessionIds = new Set<string>()
			for (const server of Object.values(servers)) {
				for (const sessionId of Object.keys(server.sessions)) {
					liveSessionIds.add(sessionId)
				}
			}

			for (const project of discovery.projects) {
				const name = projectNameFromDir(project.worktree)
				const sessions = discovery.sessions[project.id] ?? []
				let offlineCount = 0
				let lastActiveAt = projects.get(name)?.lastActiveAt ?? 0
				for (const s of sessions) {
					if (liveSessionIds.has(s.id)) continue
					if (!showSubAgents && s.parentID) continue
					offlineCount++
					const t = s.time.updated ?? s.time.created ?? 0
					if (t > lastActiveAt) lastActiveAt = t
				}

				if (offlineCount === 0 && !projects.has(name)) continue

				const existing = projects.get(name)
				if (existing) {
					existing.agentCount += offlineCount
					if (lastActiveAt > existing.lastActiveAt) existing.lastActiveAt = lastActiveAt
				} else {
					projects.set(name, {
						name,
						directory: project.worktree,
						agentCount: offlineCount,
						lastActiveAt,
					})
				}
			}
		}

		return Array.from(projects.values()).sort((a, b) => b.lastActiveAt - a.lastActiveAt)
	}, [servers, discovery, showSubAgents])
}

/**
 * Individual UI selectors — use these directly instead of a single object
 * to avoid unnecessary re-renders from object spreading.
 */
export const useSelectedSessionId = () => useAppStore((s) => s.ui.selectedSessionId)
export const useCommandPaletteOpen = () => useAppStore((s) => s.ui.commandPaletteOpen)
export const useNewAgentDialogOpen = () => useAppStore((s) => s.ui.newAgentDialogOpen)

export const useSetSelectedSessionId = () => useAppStore((s) => s.setSelectedSessionId)
export const useToggleSelectedSessionId = () => useAppStore((s) => s.toggleSelectedSessionId)
export const useSetCommandPaletteOpen = () => useAppStore((s) => s.setCommandPaletteOpen)
export const useSetNewAgentDialogOpen = () => useAppStore((s) => s.setNewAgentDialogOpen)
export const useShowSubAgents = () => useAppStore((s) => s.ui.showSubAgents)
export const useToggleShowSubAgents = () => useAppStore((s) => s.toggleShowSubAgents)
