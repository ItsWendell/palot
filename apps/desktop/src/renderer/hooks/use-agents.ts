import { useAtomValue, useSetAtom } from "jotai"
import {
	agentsAtom,
	formatElapsed,
	formatRelativeTime,
	projectListAtom,
} from "../atoms/derived/agents"
import { type DisplayMode, displayModeAtom } from "../atoms/preferences"
import { commandPaletteOpenAtom, showSubAgentsAtom, toggleShowSubAgentsAtom } from "../atoms/ui"
import type { Agent, SidebarProject } from "../lib/types"

// Re-export helpers from derived atom module
export { formatRelativeTime, formatElapsed }

/**
 * Hook that returns agents derived from live server sessions + discovered sessions.
 */
export function useAgents(): Agent[] {
	return useAtomValue(agentsAtom)
}

/**
 * Hook that returns the project list for the sidebar.
 */
export function useProjectList(): SidebarProject[] {
	return useAtomValue(projectListAtom)
}

/**
 * Individual UI selectors — thin wrappers around Jotai atoms.
 */
export const useCommandPaletteOpen = () => useAtomValue(commandPaletteOpenAtom)
export const useSetCommandPaletteOpen = () => useSetAtom(commandPaletteOpenAtom)
export const useShowSubAgents = () => useAtomValue(showSubAgentsAtom)
export const useToggleShowSubAgents = () => useSetAtom(toggleShowSubAgentsAtom)
export const useDisplayMode = (): DisplayMode => useAtomValue(displayModeAtom)
export const useSetDisplayMode = () => useSetAtom(displayModeAtom)
