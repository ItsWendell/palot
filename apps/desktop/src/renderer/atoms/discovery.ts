import { atom } from "jotai"

// ============================================================
// Types
// ============================================================

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
export interface DiscoveryState {
	loaded: boolean
	loading: boolean
	error: string | null
	projects: DiscoveredProject[]
	sessions: Record<string, DiscoveredSession[]>
}

// ============================================================
// Atoms
// ============================================================

export const discoveryAtom = atom<DiscoveryState>({
	loaded: false,
	loading: false,
	error: null,
	projects: [],
	sessions: {},
})

// Convenience selectors
export const discoveryLoadedAtom = atom((get) => get(discoveryAtom).loaded)
export const discoveryLoadingAtom = atom((get) => get(discoveryAtom).loading)
export const discoveryProjectsAtom = atom((get) => get(discoveryAtom).projects)
export const discoverySessionsAtom = atom((get) => get(discoveryAtom).sessions)
