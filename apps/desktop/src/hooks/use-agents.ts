import { useMemo } from "react"
import { useShallow } from "zustand/shallow"
import type { Agent, AgentStatus, Project, SessionStatus } from "../lib/types"
import { selectAllSessions, selectProjects, useAppStore } from "../stores/app-store"

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
 * Agents are our UI-facing representation of OpenCode sessions.
 */
export function useAgents(): Agent[] {
	const allSessions = useAppStore(useShallow(selectAllSessions))

	return useMemo(() => {
		return allSessions.map((entry) => {
			const { session, status, permissions, serverId, directory } = entry
			const agentStatus = deriveAgentStatus(status, permissions.length > 0)

			const now = Date.now() / 1000
			const created = session.time.created
			const durationSec = now - created

			return {
				id: session.id,
				sessionId: session.id,
				serverId,
				name: session.title || "Untitled",
				status: agentStatus,
				environment: "local" as const, // For now, all local. Will be enriched later.
				project: projectNameFromDir(directory),
				branch: "", // Will be populated from VCS info later
				duration: formatDuration(durationSec),
				tokens: 0, // Will be populated from message aggregation later
				cost: 0, // Same
				currentActivity:
					permissions.length > 0
						? `Waiting for approval: ${permissions[0].title}`
						: status.type === "busy"
							? "Working..."
							: undefined,
				activities: [], // Will be populated from message parts later
			}
		})
	}, [allSessions])
}

/**
 * Hook that returns the project list for the sidebar.
 */
export function useProjectList(): Project[] {
	return useAppStore(useShallow(selectProjects))
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
