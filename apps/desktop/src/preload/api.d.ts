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

// ============================================================
// Git types
// ============================================================

export interface GitBranchInfo {
	current: string
	detached: boolean
	local: string[]
	remote: string[]
}

export interface GitStatusInfo {
	isClean: boolean
	staged: number
	modified: number
	untracked: number
	conflicted: number
	summary: string
}

export interface GitCheckoutResult {
	success: boolean
	error?: string
}

export interface GitStashResult {
	success: boolean
	stashed: boolean
	error?: string
}

// ============================================================
// CLI install types
// ============================================================

export interface CliInstallResult {
	success: boolean
	error?: string
}

export interface AppInfo {
	version: string
	isDev: boolean
}

export interface CodedeckAPI {
	/** The host platform: "darwin", "win32", or "linux". */
	platform: NodeJS.Platform
	getAppInfo: () => Promise<AppInfo>
	ensureOpenCode: () => Promise<OpenCodeServerInfo>
	getServerUrl: () => Promise<string | null>
	stopOpenCode: () => Promise<boolean>
	discover: () => Promise<DiscoveryResult>
	getSessionMessages: (sessionId: string) => Promise<MessagesResult>
	getModelState: () => Promise<ModelState>
	updateModelRecent: (model: ModelRef) => Promise<ModelState>

	// Auto-updater
	getUpdateState: () => Promise<UpdateState>
	checkForUpdates: () => Promise<void>
	downloadUpdate: () => Promise<void>
	installUpdate: () => Promise<void>
	onUpdateStateChanged: (callback: (state: UpdateState) => void) => () => void

	// Git operations
	git: {
		listBranches: (directory: string) => Promise<GitBranchInfo>
		getStatus: (directory: string) => Promise<GitStatusInfo>
		checkout: (directory: string, branch: string) => Promise<GitCheckoutResult>
		stashAndCheckout: (directory: string, branch: string) => Promise<GitStashResult>
		stashPop: (directory: string) => Promise<GitStashResult>
	}

	// CLI install
	cli: {
		isInstalled: () => Promise<boolean>
		install: () => Promise<CliInstallResult>
		uninstall: () => Promise<CliInstallResult>
	}

	// Directory picker
	pickDirectory: () => Promise<string | null>

	// Fetch proxy (bypasses Chromium connection limits)
	fetch: (req: {
		url: string
		method: string
		headers: Record<string, string>
		body: string | null
	}) => Promise<{
		status: number
		statusText: string
		headers: Record<string, string>
		body: string | null
	}>
}

declare global {
	interface Window {
		codedeck: CodedeckAPI
	}
}
