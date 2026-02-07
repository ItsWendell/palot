import { useMemo } from "react"
import type { Agent, AgentStatus, Project, SessionStatus } from "../lib/types"
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
 * Formats a duration in seconds to a human-readable string.
 */
function formatDuration(seconds: number): string {
	if (seconds < 60) return `${Math.round(seconds)}s`
	if (seconds < 3600) return `${Math.round(seconds / 60)}m`
	return `${Math.round(seconds / 3600)}h`
}

/**
 * Extracts the project name from a directory path.
 */
function projectNameFromDir(directory: string): string {
	return directory.split("/").pop() || directory
}

/**
 * Hook that returns agents derived from the store's sessions.
 *
 * IMPORTANT: We select the raw `servers` Record (a single stable reference
 * that only changes when the store mutates it) and compute agents inside
 * useMemo. This avoids the "getSnapshot must be cached" error that occurs
 * when selectors create new arrays/objects on every call.
 */
export function useAgents(): Agent[] {
	const servers = useAppStore((s) => s.servers)

	return useMemo(() => {
		const agents: Agent[] = []
		for (const server of Object.values(servers)) {
			for (const entry of Object.values(server.sessions)) {
				const { session, status, permissions } = entry
				const agentStatus = deriveAgentStatus(status, permissions.length > 0)

				const now = Date.now()
				const created = session.time.created
				// OpenCode timestamps are in milliseconds
				const durationSec = Math.max(0, (now - created) / 1000)

				agents.push({
					id: session.id,
					sessionId: session.id,
					serverId: server.id,
					name: session.title || "Untitled",
					status: agentStatus,
					environment: "local" as const,
					project: projectNameFromDir(server.directory),
					branch: "",
					duration: formatDuration(durationSec),
					tokens: 0,
					cost: 0,
					currentActivity:
						permissions.length > 0
							? `Waiting for approval: ${permissions[0].title}`
							: status.type === "busy"
								? "Working..."
								: undefined,
					activities: [],
				})
			}
		}
		return agents
	}, [servers])
}

/**
 * Hook that returns the project list for the sidebar.
 *
 * Same pattern: select raw `servers` and compute in useMemo.
 */
export function useProjectList(): Project[] {
	const servers = useAppStore((s) => s.servers)

	return useMemo(() => {
		const projects = new Map<string, { name: string; count: number }>()
		for (const server of Object.values(servers)) {
			const name = server.directory.split("/").pop() || server.directory
			const existing = projects.get(server.id)
			const sessionCount = Object.keys(server.sessions).length
			if (existing) {
				existing.count += sessionCount
			} else {
				projects.set(server.id, { name, count: sessionCount })
			}
		}
		return Array.from(projects.values()).map((p) => ({
			name: p.name,
			agentCount: p.count,
		}))
	}, [servers])
}

/**
 * Individual UI selectors — use these directly instead of a single object
 * to avoid unnecessary re-renders from object spreading.
 */
export const useSelectedProject = () => useAppStore((s) => s.ui.selectedProject)
export const useSelectedStatus = () => useAppStore((s) => s.ui.selectedStatus)
export const useSelectedEnvironment = () => useAppStore((s) => s.ui.selectedEnvironment)
export const useSelectedSessionId = () => useAppStore((s) => s.ui.selectedSessionId)
export const useCommandPaletteOpen = () => useAppStore((s) => s.ui.commandPaletteOpen)
export const useNewAgentDialogOpen = () => useAppStore((s) => s.ui.newAgentDialogOpen)

export const useSetSelectedProject = () => useAppStore((s) => s.setSelectedProject)
export const useSetSelectedStatus = () => useAppStore((s) => s.setSelectedStatus)
export const useSetSelectedEnvironment = () => useAppStore((s) => s.setSelectedEnvironment)
export const useSetSelectedSessionId = () => useAppStore((s) => s.setSelectedSessionId)
export const useToggleSelectedSessionId = () => useAppStore((s) => s.toggleSelectedSessionId)
export const useSetCommandPaletteOpen = () => useAppStore((s) => s.setCommandPaletteOpen)
export const useSetNewAgentDialogOpen = () => useAppStore((s) => s.setNewAgentDialogOpen)
