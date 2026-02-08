/**
 * Type definitions for the Electron preload bridge.
 *
 * These types are shared between the preload script and the renderer.
 * The renderer accesses these via `window.codedeck`.
 */

export interface OpenCodeServerInfo {
	url: string
	pid: number | null
	managed: boolean
}

export interface DiscoveredProject {
	id: string
	worktree: string
	vcs: string
	time: { created: number; updated?: number }
}

export interface DiscoveredSession {
	id: string
	slug?: string
	projectID: string
	directory: string
	parentID?: string
	title: string
	version?: string
	time: { created: number; updated?: number }
	summary?: { additions: number; deletions: number; files: number }
}

export interface DiscoveryResult {
	projects: DiscoveredProject[]
	sessions: Record<string, DiscoveredSession[]>
}

export interface MessageEntry {
	info: {
		id: string
		sessionID: string
		role: string
		time: { created: number; completed?: number }
		parentID?: string
		modelID?: string
		providerID?: string
		[key: string]: unknown
	}
	parts: {
		id: string
		sessionID: string
		messageID: string
		type: string
		text?: string
		tool?: string
		callID?: string
		[key: string]: unknown
	}[]
}

export interface MessagesResult {
	messages: MessageEntry[]
}

export interface ModelRef {
	providerID: string
	modelID: string
}

export interface ModelState {
	recent: ModelRef[]
	favorite: ModelRef[]
	variant: Record<string, string | undefined>
}

export interface UpdateState {
	status: "idle" | "checking" | "available" | "downloading" | "ready" | "error"
	version?: string
	releaseNotes?: string
	progress?: {
		percent: number
		bytesPerSecond: number
		transferred: number
		total: number
	}
	error?: string
}

export interface CodedeckAPI {
	ensureOpenCode: () => Promise<OpenCodeServerInfo>
	getServerUrl: () => Promise<string | null>
	stopOpenCode: () => Promise<boolean>
	discover: () => Promise<DiscoveryResult>
	getSessionMessages: (sessionId: string) => Promise<MessagesResult>
	getModelState: () => Promise<ModelState>

	// Auto-updater
	getUpdateState: () => Promise<UpdateState>
	checkForUpdates: () => Promise<void>
	downloadUpdate: () => Promise<void>
	installUpdate: () => Promise<void>
	onUpdateStateChanged: (callback: (state: UpdateState) => void) => () => void
}

declare global {
	interface Window {
		codedeck: CodedeckAPI
	}
}
